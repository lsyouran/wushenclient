/**
 * tests/resilience.test.ts —— P0「运行时异常边界」（2026-10-13 体检 N1）
 * ============================================================================
 * 体检结论：入站业务链路（`hub.inbound` → session → 内容层）**一处 try/catch 都没有**，
 * 进程级也没有 `uncaughtException` 兜底 ⇒ 一个玩家的内容回调抛错会冒泡成
 * `uncaughtException`，把**整个服务器进程**带走。
 *
 * 本文件用两条独立的断言把它钉住：
 *   ① `hub.inbound` 必须**自己吞掉**回调抛出的异常，并只关掉**那条**连接
 *      （其他连接、连接表、进程都要活下来）；
 *   ② `cli.ts` 提供的进程级兜底必须真的注册两类监听、且监听体**自己不再抛**
 *      （否则等于没装）。
 *
 * ★ 判据落在**区分性字段**上：不是"没抛错就算数"——还要求
 *   `onInternalError` 拿到了**是哪条连接、什么错**（fg-11 同族：只判"有没有"会留下假绿通道）。
 */
import { describe, expect, it, vi } from 'vitest';

import { ConnectionHub } from '../server/net/hub.js';
import type { HubHooks, NetConnection } from '../server/net/hub.js';
import { installProcessErrorGuards } from '../server/cli.js';

class FakeConn implements NetConnection {
  public readonly sent: string[] = [];
  public closeReason: string | null = null;
  public constructor(public readonly id: string) {}
  public send(text: string): void {
    this.sent.push(text);
  }
  public close(reason: string): void {
    this.closeReason = reason;
  }
}

interface InternalErrorRecord {
  readonly connId: string;
  readonly error: unknown;
}

function hubWith(hooks: Partial<HubHooks>): ConnectionHub {
  return new ConnectionHub({
    hooks: {
      onCommand: () => undefined,
      onLogin: () => undefined,
      onPing: () => undefined,
      onReject: () => undefined,
      ...hooks,
    },
  });
}

describe('P0 · hub.inbound 的运行时异常边界', () => {
  it('★ 内容回调抛错 → 该连接被关且被遗忘，异常**不冒泡**（否则进程退出）', () => {
    const errors: InternalErrorRecord[] = [];
    const hub = hubWith({
      onCommand: (conn: NetConnection) => {
        if (conn.id === 'bad') throw new Error('内容回调炸了');
      },
      onInternalError: (conn, error) => errors.push({ connId: conn.id, error }),
    });
    const bad = new FakeConn('bad');
    hub.accept(bad);

    // ★ 核心：它**不该**抛出去。抛出去就是 `uncaughtException` ⇒ 全服退出。
    expect(() => hub.inbound(bad, 'look')).not.toThrow();

    // 只关这一条，并从连接表里摘掉（否则是"服务端忘了它、socket 还开着"）
    expect(hub.has('bad')).toBe(false);
    expect(bad.closeReason).not.toBeNull();

    // 判据落在区分性字段上：报上来的必须是**这条连接 + 那个真实的错**
    expect(errors).toHaveLength(1);
    expect(errors[0]?.connId).toBe('bad');
    expect(errors[0]?.error).toBeInstanceOf(Error);
    expect((errors[0]?.error as Error).message).toBe('内容回调炸了');
  });

  it('★ 一个连接炸了，**其他连接照常工作**（炸掉的只是那一条）', () => {
    const hub = hubWith({
      onCommand: (conn: NetConnection) => {
        if (conn.id === 'bad') throw new Error('boom');
      },
      // 这里不关心上报，只关心"别的连接不受影响" —— 装个空观察口免得刷屏
      onInternalError: () => undefined,
    });
    const bad = new FakeConn('bad');
    const ok = new FakeConn('ok');
    hub.accept(bad);
    hub.accept(ok);

    hub.inbound(bad, 'look');
    expect(hub.has('bad')).toBe(false);

    // 好的那条：还在册、还能处理下一帧、还不抛
    expect(hub.has('ok')).toBe(true);
    expect(() => hub.inbound(ok, 'look')).not.toThrow();
    expect(hub.has('ok')).toBe(true);
    expect(hub.size).toBe(1);
  });

  it('★ 登录回调抛错同样被兜住（不是只包了 command 那一支）', () => {
    const errors: InternalErrorRecord[] = [];
    const hub = hubWith({
      onLogin: () => {
        throw new Error('登录处理炸了');
      },
      onInternalError: (conn, error) => errors.push({ connId: conn.id, error }),
    });
    const conn = new FakeConn('c-login');
    hub.accept(conn);

    const r = hub.inbound(conn, JSON.stringify({ v: 1, type: 'login', token: 'x'.repeat(16), role_id: 'a' }));
    expect(r.kind).toBe('login');
    expect(() => {
      /* 上面的调用本身已覆盖"不抛" */
    }).not.toThrow();
    expect(hub.has('c-login')).toBe(false);
    expect(errors).toHaveLength(1);
  });

  it('没装 onInternalError 时也不静默：默认写 stderr，且**仍然**不抛、仍然关连接', () => {
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      const hub = hubWith({
        onCommand: () => {
          throw new Error('没有观察者也要说一声');
        },
      });
      const conn = new FakeConn('c-quiet');
      hub.accept(conn);

      expect(() => hub.inbound(conn, 'look')).not.toThrow();
      expect(hub.has('c-quiet')).toBe(false);
      expect(spy).toHaveBeenCalled();
      expect(String(spy.mock.calls.at(-1)?.[0] ?? '')).toContain('没有观察者也要说一声');
    } finally {
      spy.mockRestore();
    }
  });
});

describe('P0 · 进程级兜底（cli.ts）', () => {
  it('★ 注册 uncaughtException 与 unhandledRejection 两类监听', () => {
    const on = vi.fn();
    installProcessErrorGuards({ target: { on } as never, onError: () => undefined });
    const events = on.mock.calls.map((c) => c[0]);
    expect(events).toContain('uncaughtException');
    expect(events).toContain('unhandledRejection');
  });

  it('★ 监听体自己**不再抛**（否则等于没装），并把错报出来', () => {
    const registered = new Map<string, (arg: unknown) => void>();
    const target = {
      on: (event: string, listener: (arg: unknown) => void): unknown => {
        registered.set(event, listener);
        return target;
      },
    };
    const logged: string[] = [];
    installProcessErrorGuards({
      target: target as never,
      onError: (kind, error) => logged.push(`${kind}:${String(error)}`),
    });

    const onUncaught = registered.get('uncaughtException');
    const onRejection = registered.get('unhandledRejection');
    expect(onUncaught).toBeTypeOf('function');
    expect(onRejection).toBeTypeOf('function');

    // ★ 关键：处理函数**不能**自己抛（那会变成递归 uncaughtException）
    expect(() => onUncaught?.(new Error('boom'))).not.toThrow();
    expect(() => onRejection?.('why')).not.toThrow();
    expect(logged.join('|')).toContain('boom');
    expect(logged.join('|')).toContain('why');
  });
});

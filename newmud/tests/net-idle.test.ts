/**
 * tests/net-idle.test.ts —— 空闲踢线的回归（★ 26 册 §16.4 F1）
 * ============================================================================
 * 26 册 §16.4 的 F1：**已登录玩家挂机 30 秒会被强制断线**。四个事实叠加：
 *
 *   ① `CONNECTION_IDLE_TIMEOUT_MS`(30s) 只比 `WS_PING_INTERVAL_MS`(30s) —— **零余量**；
 *   ② `lastSeenMs` **只由入站帧**刷新（`hub.inbound`）；
 *   ③ 服务端心跳发的是**协议级** `socket.ping()`，而它的 pong **不触发 `message` 事件** ⇒ 刷新不到 ②；
 *   ④ 前端没有应用级 ping，且 `onClose` 不重连。
 *
 * ★ 本文件的判据必须**有鉴别力**（24 册铁律 6b）：不能只断言"没被踢"，
 *   因为"压根没跑判定"也能满足它。所以每条都配一个**对照组**：
 *   不刷新 ⇒ 必须踢；刷新 ⇒ 不再踢；只延后一个窗口 ⇒ 之后仍会踢。
 *
 * ★ `touch()` 的语义来源是**协议层保活信号**（RFC6455 的 pong）。
 *   浏览器会自动回 pong，因此"服务端认得出活着"**不依赖前端配合** ——
 *   这是本修复优先做服务端侧的原因。
 */
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';

import { CONNECTION_IDLE_TIMEOUT_MS, WS_PING_INTERVAL_MS } from '../shared/constants.js';
import { ConnectionHub } from '../server/net/hub.js';
import type { HubHooks, NetConnection } from '../server/net/hub.js';
import { startWsServer } from '../server/net/ws-server.js';
import type { MudServer } from '../server/net/ws-server.js';

const T0 = 1_700_000_000_000;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

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

const noopHooks: HubHooks = {
  onCommand: () => undefined,
  onLogin: () => undefined,
  onPing: () => undefined,
  onReject: () => undefined,
};

// ---------------------------------------------------------------------------
// 常量：余量
// ---------------------------------------------------------------------------

describe('F1 · 空闲超时必须有余量', () => {
  it('空闲超时必须**严格大于**协议级 ping 间隔（否则 pong 还没回来就先被踢）', () => {
    // 这不是"美观"问题：`ws-server` 的 ping 与 `pruneIdle` 是两个独立定时器，
    // 相位一旦不利，超时窗口(30s)会在 ping(30s)的 pong 到达之前先命中。
    expect(CONNECTION_IDLE_TIMEOUT_MS).toBeGreaterThan(WS_PING_INTERVAL_MS);
  });
});

// ---------------------------------------------------------------------------
// hub.touch()：协议级保活信号必须能刷新 lastSeenMs
// ---------------------------------------------------------------------------

describe('F1 · hub.touch()（协议级 pong 走这里）', () => {
  it('不刷新 ⇒ 到点必踢；刷新 ⇒ 不踢；但只延后一个窗口（不是永久豁免）', () => {
    const hub = new ConnectionHub({ now: () => T0, hooks: noopHooks });

    // —— 对照组：没有任何保活信号 ⇒ 到点必须踢 ——
    const dead = new FakeConn('dead');
    hub.accept(dead); // lastSeenMs = T0
    expect(hub.pruneIdle(T0 + CONNECTION_IDLE_TIMEOUT_MS - 1)).toBe(0); // 差 1ms 还活着
    expect(hub.pruneIdle(T0 + CONNECTION_IDLE_TIMEOUT_MS)).toBe(1); // 到点踢掉
    expect(dead.closeReason).toMatch(/空闲/);

    // —— 实验组：中途来了一次保活信号 ——
    const alive = new FakeConn('alive');
    hub.accept(alive); // lastSeenMs = T0
    hub.touch(alive, T0 + 20_000); // ← pong 到达
    // 原本该踢的时刻，现在**不该**踢（只过了 10s）
    expect(hub.pruneIdle(T0 + CONNECTION_IDLE_TIMEOUT_MS)).toBe(0);
    expect(hub.size).toBe(1);
    // 但保活**只延后一个窗口**，不是永久豁免 —— 之后不再有信号就仍会踢
    expect(hub.pruneIdle(T0 + 20_000 + CONNECTION_IDLE_TIMEOUT_MS - 1)).toBe(0);
    expect(hub.pruneIdle(T0 + 20_000 + CONNECTION_IDLE_TIMEOUT_MS)).toBe(1);
  });

  it('touch() 对未登记的连接是安全空操作（不抛错、不复活已关闭的连接）', () => {
    const hub = new ConnectionHub({ now: () => T0, hooks: noopHooks });
    const ghost = new FakeConn('ghost');
    expect(() => hub.touch(ghost, T0)).not.toThrow();
    expect(hub.size).toBe(0);

    const a = new FakeConn('gone');
    hub.accept(a);
    hub.forget(a);
    expect(() => hub.touch(a, T0 + 1)).not.toThrow();
    expect(hub.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 端到端：真 WebSocket，靠协议级 ping/pong 保活
// ---------------------------------------------------------------------------

let running: MudServer | null = null;

afterEach(async () => {
  await running?.close();
  running = null;
});

function connect(port: number): Promise<{ ws: WebSocket; closed: Promise<number> }> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  let resolveClosed: (code: number) => void;
  const closed = new Promise<number>((r) => {
    resolveClosed = r;
  });
  ws.on('close', (code) => resolveClosed(code));
  return new Promise((resolve, reject) => {
    ws.on('open', () => resolve({ ws, closed }));
    ws.on('error', reject);
  });
}

/** 起一个"短超时 + 短 ping"的服务器，用来在 1 秒量级内跨过多个超时窗口 */
async function startShort(opts: {
  idleTimeoutMs: number;
  pingIntervalMs: number | null;
}): Promise<{ port: number; hub: ConnectionHub }> {
  const hub = new ConnectionHub({ idleTimeoutMs: opts.idleTimeoutMs, hooks: noopHooks });
  const server = await startWsServer({
    port: 0,
    hub,
    pingIntervalMs: opts.pingIntervalMs,
  });
  running = server;
  return { port: server.port, hub };
}

describe('F1 · 端到端：登录后静默不发指令', () => {
  it('有协议级 ping/pong ⇒ 跨过多个超时窗口仍然在线', async () => {
    const idle = 400;
    const { port, hub } = await startShort({ idleTimeoutMs: idle, pingIntervalMs: 100 });
    const { ws } = await connect(port);

    // 跨过 3 个超时窗口，期间**一帧业务数据都不发**
    await sleep(idle * 3);

    expect(hub.pruneIdle()).toBe(0); // 判定跑了，且没踢
    expect(hub.size).toBe(1);
    expect(ws.readyState).toBe(WebSocket.OPEN);
    ws.close();
  });

  it('对照组：不发 ping ⇒ 同样时长下必被踢（证明上一条不是"判定没跑"）', async () => {
    const idle = 400;
    const { port, hub } = await startShort({ idleTimeoutMs: idle, pingIntervalMs: null });
    const { ws, closed } = await connect(port);

    await sleep(idle * 3);

    expect(hub.pruneIdle()).toBe(1);
    expect(await closed).toBe(1011); // 被服务端要求断开
    expect(ws.readyState).toBe(WebSocket.CLOSED);
  });
});

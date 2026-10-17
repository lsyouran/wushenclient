/**
 * tests/net-pipeline.test.ts —— 网络层接线（T1）的回归
 * ============================================================================
 * 26 册 §11.4 的 T1 要求：**接线完成判据必须写成断言，而不是靠记忆**。
 * 那两条判据是：
 *   ① 超过 `RATE_LIMIT_PER_5S` 后必须被拒（而不是"照常执行"）；
 *   ② 断开连接后限流表的 `trackedKeys` 必须下降（否则表单调增长 = 一条 DoS 路径）。
 * 本文件的「T1 判据」两组就是它们。
 *
 * 其余覆盖管线的**顺序与断连判据**：
 *   尺寸 → 限流 → 分诊 → 解析，以及"什么情况断连、什么情况不断连"。
 *
 * ★ 全程不依赖 `ws`：用假连接实现 `NetConnection`，于是这些断言在任何环境都能跑。
 */
import { describe, expect, it } from 'vitest';

import {
  CONNECTION_IDLE_TIMEOUT_MS,
  MAX_BUFFERED_BYTES,
  MAX_CONNECTIONS,
  MAX_CONNECTIONS_PER_IP,
  MAX_MESSAGE_BYTES,
  MAX_OUTBOUND_QUEUE,
  RATE_LIMIT_PER_5S,
} from '../shared/constants.js';
import { PROTOCOL_VERSION } from '../shared/constants.js';
import type { ErrorCode } from '../shared/protocol.js';
import { checkOutboundSize, handleInboundFrame } from '../server/net/frame-pipeline.js';
import type { InboundIntent } from '../server/net/frame-pipeline.js';
import { ConnectionHub } from '../server/net/hub.js';
import type { HubHooks, NetConnection } from '../server/net/hub.js';
import { SlidingWindowRateLimiter } from '../server/net/rate-limit.js';

const T0 = 1_700_000_000_000;

function ctx(connId = 'c1', nowMs = T0, limit = RATE_LIMIT_PER_5S) {
  return { connId, nowMs, limiter: new SlidingWindowRateLimiter(limit, 5_000) };
}

function frame(type: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ v: PROTOCOL_VERSION, type, ...extra });
}

/** 取 reject 的三要素，非 reject 时给出可读的失败信息 */
function asReject(intent: InboundIntent): { code: ErrorCode; detail: string; close: boolean } {
  if (intent.kind !== 'reject') {
    throw new Error(`期望 reject，实际 ${intent.kind}：${JSON.stringify(intent)}`);
  }
  return { code: intent.code, detail: intent.detail, close: intent.close };
}

// ---------------------------------------------------------------------------
// 管线：顺序与断连判据
// ---------------------------------------------------------------------------

describe('入站管线', () => {
  it('尺寸超限：先出局，且不进限流/解析', () => {
    const c = ctx();
    const r = asReject(handleInboundFrame('x'.repeat(MAX_MESSAGE_BYTES + 1), c));
    expect(r.code).toBe('PAYLOAD_TOO_LARGE');
    expect(r.close).toBe(true);
    // 关键：超限帧**不该**消耗配额（它连"是不是指令"都没资格参与）
    expect(c.limiter.remaining('c1', T0)).toBe(c.limiter.limit);
  });

  it('明文 → command（wushen 式直接敲指令）', () => {
    expect(handleInboundFrame('look', ctx())).toMatchObject({ kind: 'command', command: 'look' });
    expect(handleInboundFrame('  向北走  ', ctx())).toMatchObject({ kind: 'command', command: '向北走' });
  });

  it('明文不合规 → 拒但**不断连**（可能只是手滑）', () => {
    const r = asReject(handleInboundFrame('look\u009b2J', ctx()));
    expect(r.code).toBe('PLAINTEXT_NOT_COMMAND');
    expect(r.close).toBe(false);
  });

  it('JSON command / login / ping 各自分流', () => {
    expect(handleInboundFrame(frame('command', { cmd: 'look' }), ctx())).toMatchObject({
      kind: 'command',
      command: 'look',
    });
    expect(
      handleInboundFrame(frame('login', { token: 'a'.repeat(20), role_id: 'r1' }), ctx()),
    ).toMatchObject({ kind: 'login', token: 'a'.repeat(20), roleId: 'r1' });
    expect(handleInboundFrame(frame('ping', { t: 42 }), ctx())).toMatchObject({
      kind: 'ping',
      t: 42,
    });
  });

  it('版本不符 → PROTOCOL_MISMATCH + 断连（与"结构不成包"可区分）', () => {
    const bad = JSON.stringify({ v: PROTOCOL_VERSION + 1, type: 'command', cmd: 'look' });
    const r = asReject(handleInboundFrame(bad, ctx()));
    expect(r.code).toBe('PROTOCOL_MISMATCH');
    expect(r.close).toBe(true);
  });

  it('像 JSON 但**解析不了** → PLAINTEXT_NOT_COMMAND + **不断连**（L6）', () => {
    // ★ 2026-10-17 审查 **L6**：原先"看着像 JSON"就一律进 JSON 通道 ⇒
    //   `JSON.parse` 失败 ⇒ `BAD_PACKET` + **断连**。CLI / 运维工具随手敲一个
    //   `[` 或 `{` 就掉线，而不是回一句"这不是指令"。
    //   ⇒ 现在像 JSON 还得**真能解析**才走 JSON 通道；解析不了的按明文处理
    //     （明文通道的任何失败都不断连，见上面 `reject(..., false)`）。
    const r = asReject(handleInboundFrame('{"v":1,', ctx()));
    expect(r.code).toBe('PLAINTEXT_NOT_COMMAND');
    expect(r.close).toBe(false);
  });

  it('JSON 但字段不合规 → BAD_PACKET + 断连（明文不能绕开 schema）', () => {
    const r = asReject(handleInboundFrame(frame('command', { cmd: '' }), ctx()));
    expect(r.code).toBe('BAD_PACKET');
    expect(r.close).toBe(true);
  });

  it('限流排在解析**之前**：坏包同样消耗配额', () => {
    const c = ctx('c-bad', T0, 2);
    asReject(handleInboundFrame('{"v":1,', c)); // 坏包 1
    asReject(handleInboundFrame('{"v":1,', c)); // 坏包 2
    const third = asReject(handleInboundFrame('{"v":1,', c)); // 第 3 次 → 应当先被限流拦下
    expect(third.code).toBe('RATE_LIMITED');
  });

  it('出站也量一次（拼包出错不该静默吃掉带宽）', () => {
    expect(checkOutboundSize('ok').ok).toBe(true);
    expect(checkOutboundSize('x'.repeat(MAX_MESSAGE_BYTES + 1))).toEqual({
      ok: false,
      bytes: MAX_MESSAGE_BYTES + 1,
    });
  });
});

// ---------------------------------------------------------------------------
// T1 判据 ①：限流真的生效
// ---------------------------------------------------------------------------

describe('T1 判据① · 限流接线', () => {
  it(`窗口内第 ${RATE_LIMIT_PER_5S + 1} 条指令必须被拒（且不断连）`, () => {
    const c = ctx('c-rl');
    for (let i = 0; i < RATE_LIMIT_PER_5S; i += 1) {
      const intent = handleInboundFrame(`look ${i}`, c);
      expect(intent.kind, `第 ${i + 1} 条应当放行`).toBe('command');
    }
    const over = asReject(handleInboundFrame('look overflow', c));
    expect(over.code).toBe('RATE_LIMITED');
    expect(over.close).toBe(false);
  });

  it('窗口滑动后恢复额度（不是"每 5 秒清零"那种可被卡边界的写法）', () => {
    const c = ctx('c-rl2');
    for (let i = 0; i < RATE_LIMIT_PER_5S; i += 1) handleInboundFrame(`a${i}`, c);
    expect(asReject(handleInboundFrame('overflow', c)).code).toBe('RATE_LIMITED');
    // 越过窗口 → 最早那次过期 → 恢复 1 个额度
    const later = { ...c, nowMs: T0 + 5_000 };
    expect(handleInboundFrame('after-window', later).kind).toBe('command');
  });

  it('不同连接各有独立额度', () => {
    const limiter = new SlidingWindowRateLimiter(2, 5_000);
    for (let i = 0; i < 2; i += 1) {
      expect(handleInboundFrame(`a${i}`, { connId: 'A', nowMs: T0, limiter }).kind).toBe('command');
    }
    expect(handleInboundFrame('b0', { connId: 'B', nowMs: T0, limiter }).kind).toBe('command');
  });
});

// ---------------------------------------------------------------------------
// T1 判据 ②：断开后限流表必须收缩
// ---------------------------------------------------------------------------

class FakeConn implements NetConnection {
  public readonly sent: string[] = [];
  public closeReason: string | null = null;
  /**
   * 出站缓冲（FG-14 的背压判据来源）。缺省 0 = "客户端一直在读"。
   * ★ 真实值由适配层给（`WsConnection` 报 `socket.bufferedAmount`）；
   *   假连接把它做成可写字段，于是"积压"这个运行时状态在单测里**够得着**。
   */
  public buffered = 0;
  public constructor(
    public readonly id: string,
    public readonly peerAddress?: string,
  ) {}

  public bufferedBytes(): number {
    return this.buffered;
  }

  public send(text: string): void {
    this.sent.push(text);
  }
  public close(reason: string): void {
    this.closeReason = reason;
  }
}

function makeHub(
  overrides: Partial<HubHooks> = {},
  maxConnections = MAX_CONNECTIONS,
  maxConnectionsPerIp = MAX_CONNECTIONS_PER_IP,
) {
  const calls = {
    commands: [] as string[],
    logins: [] as Array<[string, string]>,
    pings: [] as number[],
    rejects: [] as Array<[ErrorCode, string, boolean]>,
  };
  const hub = new ConnectionHub({
    now: () => T0,
    maxConnections,
    maxConnectionsPerIp,
    hooks: {
      onCommand: (_c, command) => {
        calls.commands.push(command);
      },
      onLogin: (_c, token, roleId) => {
        calls.logins.push([token, roleId]);
      },
      onPing: (_c, t) => {
        calls.pings.push(t);
      },
      onReject: (_c, code, detail, close) => {
        calls.rejects.push([code, detail, close]);
      },
      ...overrides,
    },
  });
  return { hub, calls };
}

describe('T1 判据② · 断连后限流表收缩', () => {
  it('forget() 同时释放限流记录（否则表随历史连接数单调增长）', () => {
    const { hub } = makeHub();
    const a = new FakeConn('A');
    expect(hub.accept(a)).toBe(true);
    hub.inbound(a, 'look');
    expect(hub.limiter.trackedKeys).toBe(1);

    hub.forget(a);
    expect(hub.limiter.trackedKeys).toBe(0);
    expect(hub.size).toBe(0);
  });

  it('被判"断连"的坏包也会自动 forget（异常路径同样不泄漏）', () => {
    const { hub, calls } = makeHub();
    const a = new FakeConn('A2');
    hub.accept(a);
    // ★ 用一个**真会断连**的坏包（合法 JSON、字段不合规 ⇒ `BAD_PACKET` + close）。
    //   `{"v":1,` 这类"像 JSON 但解析不了"的现在走明文通道、**不断连**（L6）⇒ 它不该被这里用。
    hub.inbound(a, frame('command', { cmd: '' })); // BAD_PACKET + close
    expect(calls.rejects.at(-1)?.[0]).toBe('BAD_PACKET');
    expect(hub.size).toBe(0);
    expect(hub.limiter.trackedKeys).toBe(0);
  });

  it('pruneRateLimit() 兜住"进程没收到 close"的异常断开', () => {
    const { hub } = makeHub();
    const a = new FakeConn('A3');
    hub.accept(a);
    hub.inbound(a, 'look');
    expect(hub.limiter.trackedKeys).toBe(1);
    expect(hub.pruneRateLimit(T0 + 60_000)).toBe(1); // 窗口早过，且已不在连接表里
  });
});

// ---------------------------------------------------------------------------
// 三条上限
// ---------------------------------------------------------------------------

describe('连接上限 / 背压 / 空闲踢线', () => {
  it(`连接数达 ${MAX_CONNECTIONS} 后拒绝新连接`, () => {
    const { hub } = makeHub({}, 3);
    expect(hub.accept(new FakeConn('a'))).toBe(true);
    expect(hub.accept(new FakeConn('b'))).toBe(true);
    expect(hub.accept(new FakeConn('c'))).toBe(true);
    expect(hub.accept(new FakeConn('d'))).toBe(false); // 第 4 条
    expect(hub.size).toBe(3);
  });

  it('连接 id 重复视为程序错误（不允许静默覆盖）', () => {
    const { hub } = makeHub();
    hub.accept(new FakeConn('dup'));
    expect(() => hub.accept(new FakeConn('dup'))).toThrow(/重复/);
  });

  it(`出站队列达 ${MAX_OUTBOUND_QUEUE} 即判定背压（enqueue 返回 false）`, () => {
    const { hub } = makeHub();
    const a = new FakeConn('bp');
    hub.accept(a);
    for (let i = 0; i < MAX_OUTBOUND_QUEUE; i += 1) {
      expect(hub.enqueue(a, `第${i}条`)).toBe(true);
    }
    expect(hub.enqueue(a, '溢出')).toBe(false);
    expect(hub.pendingCount('bp')).toBe(MAX_OUTBOUND_QUEUE);
  });

  /**
   * ★★ FG-14（24 册 §5.3 / 26 册 §28.2）：背压的**运行时**可达性。
   *
   * 上面那条只证明"队列满 ⇒ enqueue 返 false"，而生产路径里
   * `session.#send` 是 `enqueue` 完**立刻** `drain`，队列长度恒 ≤ 1 ——
   * 那道判据在运行时一次都碰不到（这正是 FG-14 的内容）。
   * 真实的积压信号在**接收方**身上：`socket.bufferedAmount`。
   * 适配层通过 `NetConnection.bufferedBytes()` 报上来，判据才够得着。
   */
  it(`★ FG-14：出站缓冲超 ${MAX_BUFFERED_BYTES} 字节即判背压（断连），运行时真的够得着`, () => {
    const { hub } = makeHub();
    const a = new FakeConn('bu');
    hub.accept(a);

    // 对照组①：恰好等于上限"还没积压" —— 判据是 `>`，不是 `>=`
    //   （写成 `>=` 会让一条只是短暂的满缓冲被误杀，而那种抖动是正常的）
    a.buffered = MAX_BUFFERED_BYTES;
    expect(hub.enqueue(a, '正常')).toBe(true);
    expect(hub.bufferedBytesOf('bu')).toBe(MAX_BUFFERED_BYTES);

    // 对照组②：真正的积压 —— 多 1 字节就该判死
    a.buffered = MAX_BUFFERED_BYTES + 1;
    expect(hub.enqueue(a, '积压')).toBe(false);
    expect(a.closeReason).toMatch(/积压|缓冲/); // 关连接时给出了**原因**（不是静默消失）
    expect(hub.has('bu')).toBe(false); // 已 forget
    expect(hub.pendingCount('bu')).toBe(0); // 队列也清了，不再往死连接倒数据
  });

  it('★ FG-14 反向：没报缓冲的连接（`bufferedBytes` 缺省）不受这条判据影响', () => {
    const { hub } = makeHub();
    // 一个**不实现** `bufferedBytes` 的连接：判据无从下手时应当走老路（队列长度），
    // 而不是"量不到就当积压"把所有人踢掉。
    class BareConn implements NetConnection {
      public readonly id = 'bare';
      public send(): void {}
      public close(): void {}
    }
    const b = new BareConn();
    hub.accept(b);
    expect(hub.enqueue(b, '随便一条')).toBe(true);
    expect(hub.bufferedBytesOf('bare')).toBe(0);
  });

  it('drain() 取走全部待发并清空', () => {
    const { hub } = makeHub();
    const a = new FakeConn('dr');
    hub.accept(a);
    hub.enqueue(a, '一');
    hub.enqueue(a, '二');
    expect(hub.drain(a)).toEqual(['一', '二']);
    expect(hub.pendingCount('dr')).toBe(0);
  });

  it('pruneIdle() 踢掉超过空闲上限的连接', () => {
    const { hub } = makeHub();
    const a = new FakeConn('idle');
    hub.accept(a);
    hub.inbound(a, 'look');
    expect(hub.pruneIdle(T0 + 1_000)).toBe(0); // 还没到
    // ★ 判据**跟随常量**，不硬编码秒数：窗口是可调的（26 册 §16.4 F1 就调过它），
    //   在测试里写死"60s 够大"等于把常量值抄了第二份，窗口一变大就会假红。
    expect(hub.pruneIdle(T0 + CONNECTION_IDLE_TIMEOUT_MS)).toBe(1);
    expect(a.closeReason).toMatch(/空闲/);
    expect(hub.size).toBe(0);
  });

  it('未登记的连接收到数据 → 拒绝并要求断连（不进业务）', () => {
    const { hub, calls } = makeHub();
    const ghost = new FakeConn('ghost');
    const intent = hub.inbound(ghost, 'look');
    expect(asReject(intent).code).toBe('NOT_LOGGED_IN');
    expect(calls.commands).toHaveLength(0);
  });

  it('正常链路：一帧进、钩子被调（端到端冒烟）', () => {
    const { hub, calls } = makeHub();
    const a = new FakeConn('e2e');
    hub.accept(a);
    hub.inbound(a, 'look');
    hub.inbound(a, frame('ping', { t: 7 }));
    hub.inbound(a, frame('login', { token: 't'.repeat(20), role_id: 'r9' }));
    expect(calls.commands).toEqual(['look']);
    expect(calls.pings).toEqual([7]);
    expect(calls.logins).toEqual([['t'.repeat(20), 'r9']]);
  });
});

// ---------------------------------------------------------------------------
// N4（2026-10-13 体检 / 2026-10-16 审查附录）：按**来源地址**限连接
// ---------------------------------------------------------------------------
//
// ★ 全局上限（`MAX_CONNECTIONS`）拦不住这个：一个地址开 50 条连接赖在起始房，
//   就把**房间容量**与**全局名额**一起吃掉了 —— 之后所有人都登不上，
//   而服务端没有任何踢人手段。相对收益极高、代价极低，是典型的低成本 DoS。
//
// ★ 没有来源地址的连接（旧适配层 / 本文件的假连接）**不参与**这项判定：
//   与 `bufferedBytes()` 同一条原则 —— **量不到的东西不拿来当判据**，
//   否则"实现不全的适配层"会被一律打死（那是拿兼容性换一个假的安全感）。
describe('N4 · 按来源地址限连接', () => {
  it('同一地址接满上限后拒绝下一条；换一个地址照常可接', () => {
    const { hub } = makeHub({}, MAX_CONNECTIONS, 2);
    expect(hub.accept(new FakeConn('a1', '10.0.0.1'))).toBe(true);
    expect(hub.accept(new FakeConn('a2', '10.0.0.1'))).toBe(true);
    // 第 3 条同址 ⇒ 拒
    expect(hub.accept(new FakeConn('a3', '10.0.0.1'))).toBe(false);
    // ★ 对照组：别的地址不受影响（证明拒的是"这一条"而不是"一律拒"）
    expect(hub.accept(new FakeConn('b1', '10.0.0.2'))).toBe(true);
    expect(hub.size).toBe(3);
  });

  it('★ 拒绝原因可区分：服务器满 vs 同址过多（调用方要发不同的话）', () => {
    const perIp = makeHub({}, MAX_CONNECTIONS, 1).hub;
    perIp.accept(new FakeConn('i1', '10.0.0.9'));
    const third = new FakeConn('i2', '10.0.0.9');
    expect(perIp.admissionRefusal(third)).toBe('per-ip');

    const global = makeHub({}, 1, MAX_CONNECTIONS).hub;
    global.accept(new FakeConn('g1', '10.0.0.10'));
    expect(global.admissionRefusal(new FakeConn('g2', '10.0.0.11'))).toBe('full');
  });

  it('forget() 释放地址名额（否则"掉线重连"会被自己的旧账挡住）', () => {
    const { hub } = makeHub({}, MAX_CONNECTIONS, 1);
    const a = new FakeConn('r1', '10.0.0.3');
    expect(hub.accept(a)).toBe(true);
    expect(hub.accept(new FakeConn('r2', '10.0.0.3'))).toBe(false);
    hub.forget(a);
    expect(hub.accept(new FakeConn('r3', '10.0.0.3'))).toBe(true);
  });

  it('【反向锚点】没有来源地址的连接不被 per-IP 上限挡（量不到就不判）', () => {
    const { hub } = makeHub({}, MAX_CONNECTIONS, 1);
    for (let i = 0; i < 5; i += 1) {
      expect(hub.accept(new FakeConn(`n${String(i)}`)), `第 ${String(i + 1)} 条无地址连接`).toBe(true);
    }
  });

  it('【反向锚点】默认上限足够宽：一条地址连 1 条当然通过（别把上限写成 1）', () => {
    const { hub } = makeHub();
    expect(hub.maxConnectionsPerIp).toBe(MAX_CONNECTIONS_PER_IP);
    expect(MAX_CONNECTIONS_PER_IP).toBeGreaterThan(1);
    expect(hub.accept(new FakeConn('d1', '10.0.0.4'))).toBe(true);
  });
});

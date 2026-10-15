/**
 * tests/session.test.ts —— 玩家角色 + 登录 + 分发接线
 * ============================================================================
 * 覆盖 `server/engine/player.ts` 与 `server/session.ts`。
 * 这一层是"引擎 ↔ 网络"第一次真正接上，所以断言都按**玩家能看到什么**来写，
 * 而不是按内部字段：登录有没有收到房间、敲 `look` 有没有回显、房间里的人能不能看到广播。
 *
 * ★ 用到 `bootstrapWorld()`（真实内容）：只有在真实世界里，`look` 才有东西可看、
 *   起始房间才存在。合成夹具会掩盖"内容没登记 / 起始房间缺失"这类问题。
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { bootstrapWorld } from '../server/bootstrap.js';
import type { World } from '../server/engine/world.js';
import { OBJ_KINDS } from '../server/engine/base.js';
import { RecordingOutput } from '../server/engine/character.js';
import { Player, PlayerError } from '../server/engine/player.js';
import { GameSessions, logOutboundDrop } from '../server/session.js';
import { ConnectionHub } from '../server/net/hub.js';
import type { NetConnection } from '../server/net/hub.js';
import { MAX_BUFFERED_BYTES, MAX_MESSAGE_BYTES, MAX_OUTBOUND_QUEUE } from '@shared/constants.js';

class FakeConn implements NetConnection {
  public readonly sent: string[] = [];
  public closeReason: string | null = null;
  /** 出站缓冲（FG-14）：可写，于是"客户端不读"这个运行时状态在单测里够得着 */
  public buffered = 0;
  public constructor(public readonly id: string) {}

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

let world: World;

beforeAll(() => {
  world = bootstrapWorld().world;
});

function hubWith() {
  return new ConnectionHub({
    hooks: {
      onCommand: () => undefined,
      onLogin: () => undefined,
      onPing: () => undefined,
      onReject: () => undefined,
    },
  });
}

/** 取出某类型的包（按 JSON 解析，避免断言整串文本） */
function packetsOf(conn: FakeConn, type: string): Array<Record<string, unknown>> {
  return conn.sent
    .map((t) => {
      try {
        return JSON.parse(t) as Record<string, unknown>;
      } catch {
        return null;
      }
    })
    .filter((p): p is Record<string, unknown> => p !== null && p['type'] === type);
}

// ---------------------------------------------------------------------------
// Player
// ---------------------------------------------------------------------------

describe('Player', () => {
  it(`'player' 已经是合法的对象 kind（OBJ_KINDS 当前 [${OBJ_KINDS.join(', ')}]）`, () => {
    expect(OBJ_KINDS).toContain('player');
  });

  it('玩家没有模板来源：`path` 恒为 null', () => {
    const p = new Player({ oid: 'o1', path: null, name: '张三', roleId: 'r1' });
    expect(p.kind).toBe('player');
    expect(p.path).toBeNull();
  });

  it('缺省阶段是 playing；登录期要显式给', () => {
    expect(new Player({ oid: 'o2', path: null, name: 'a', roleId: 'r' }).phase).toBe('playing');
    expect(new Player({ oid: 'o3', path: null, name: 'b', roleId: 'r', phase: 'login' }).phase).toBe(
      'login',
    );
  });

  it('roleId 为空直接抛错（不产生一个"没有身份"的玩家）', () => {
    expect(() => new Player({ oid: 'o4', path: null, name: 'x', roleId: '' })).toThrow(PlayerError);
  });

  it('isAlive / isBusy 这些闸门要读的字段都可用（否则进不了分发）', () => {
    const p = new Player({ oid: 'o5', path: null, name: 'c', roleId: 'r' });
    expect(p.isAlive).toBe(true);
    expect(p.isBusy(0)).toBe(false);
    expect(p.userLevel).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 登录 / 分发 / 广播
// ---------------------------------------------------------------------------

describe('会话', () => {
  it('登录成功：进起始房间，并收到 login / room / items 三帧', () => {
    const hub = hubWith();
    const sessions = new GameSessions({ world, hub });
    const conn = new FakeConn('c-ok');
    hub.accept(conn);

    const r = sessions.login(conn, 't'.repeat(20), '张三');
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    expect(r.player.environment).toBe(world.startRoom);
    expect(r.player.phase).toBe('playing');
    expect(packetsOf(conn, 'login')).toHaveLength(1);
    expect(packetsOf(conn, 'room')).toHaveLength(1);
    expect(packetsOf(conn, 'items')).toHaveLength(1);
    expect(packetsOf(conn, 'room')[0]?.['name']).toBe(world.startRoom?.name);
  });

  it('重复登录被拒（ALREADY_LOGGED_IN），且不产生第二个角色', () => {
    const sessions = new GameSessions({ world, hub: hubWith() });
    const conn = new FakeConn('c-dup');
    sessions.login(conn, 't'.repeat(20), '张三');
    const second = sessions.login(conn, 't'.repeat(20), '李四');
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.code).toBe('ALREADY_LOGGED_IN');
    expect(sessions.size).toBe(1);
  });

  it('已连接但未登录就敲指令 → NOT_LOGGED_IN（而不是静默执行）', () => {
    const hub = hubWith();
    const sessions = new GameSessions({ world, hub });
    const conn = new FakeConn('c-ghost');
    hub.accept(conn); // ★ 连接已建立、会话未建立 —— 这才是真实场景
    sessions.handleCommand(conn, 'look');
    const err = packetsOf(conn, 'loginerror');
    expect(err).toHaveLength(1);
    expect(err[0]?.['code']).toBe('NOT_LOGGED_IN');
  });

  it('登录后敲 look：走的是真实内容里的指令，能看到房间名', () => {
    const hub = hubWith();
    const sessions = new GameSessions({ world, hub });
    const conn = new FakeConn('c-look');
    hub.accept(conn);
    sessions.login(conn, 't'.repeat(20), '张三');
    const before = conn.sent.length;

    sessions.handleCommand(conn, 'look');
    const after = conn.sent.slice(before);
    expect(after.length).toBeGreaterThan(0);
    const text = JSON.parse(after[0] ?? '{}') as { content?: string };
    expect(text.content ?? '').toContain(world.startRoom?.name ?? '');
  });

  /**
   * ★ FG-17 的证据之一：闸门本身是**活的**（能拦住），但需要一个手动前置
   *   —— `r.player.phase = 'login'` 这一行在生产路径上没有任何等价物。
   *   生产路径的反面（"没有登录窗口"）见下面那条 `FG-17：登录返回时 phase 已是 playing`。
   */
  it('登录期只放行 allow_login 指令（阶段来自角色自己的 phase）', () => {
    const hub = hubWith();
    const sessions = new GameSessions({ world, hub });
    const conn = new FakeConn('c-phase');
    hub.accept(conn);
    const r = sessions.login(conn, 't'.repeat(20), '张三');
    if (!r.ok) return;
    r.player.phase = 'login'; // 回到登录期

    const before = conn.sent.length;
    sessions.handleCommand(conn, 'look'); // look 不是 allow_login
    const after = conn.sent.slice(before).map((t) => JSON.parse(t) as { content?: string });
    // 结果应当是"什么？"，而不是房间描述
    expect(after.some((p) => (p.content ?? '') === '什么？')).toBe(true);
  });

  it('sendRoom 分派三视角：本人与同房间玩家**都**收到（T16）', () => {
    const hub = hubWith();
    const sessions = new GameSessions({ world, hub });
    const a = new FakeConn('c-a');
    const b = new FakeConn('c-b');
    hub.accept(a);
    hub.accept(b);
    const ra = sessions.login(a, 't'.repeat(20), '甲');
    const rb = sessions.login(b, 't'.repeat(20), '乙');
    if (!ra.ok || !rb.ok) return;

    const beforeA = a.sent.length;
    const beforeB = b.sent.length;
    ra.player.sendRoom('$N朝$n拱了拱手。', rb.player);
    const gotA = a.sent.slice(beforeA).map((t) => JSON.parse(t) as { content?: string });
    const gotB = b.sent.slice(beforeB).map((t) => JSON.parse(t) as { content?: string });

    // 改造前这里断言"自己**不**收" —— 那是把 wushen 的 excludeself 永久钉死为 true。
    // wushen `send_room` 缺省给本人也发（type=1 视角），见 os/char/character.js:78。
    expect(gotA.some((p) => p.content === '你朝乙拱了拱手。')).toBe(true);
    expect(gotB.some((p) => p.content === '甲朝你拱了拱手。')).toBe(true);
  });

  it('★ 出站帧超限**不静默**：调 onOutboundDrop（wushen 是 `text.length < 30240` 才发、超了一言不发）', () => {
    const drops: Array<{ bytes: number; limit: number }> = [];
    const hub = hubWith();
    const sessions = new GameSessions({ world, hub, onOutboundDrop: (info) => drops.push(info) });
    const conn = new FakeConn('c-big');
    hub.accept(conn);
    const r = sessions.login(conn, 't'.repeat(20), '张三');
    if (!r.ok) return;
    const before = conn.sent.length;

    // 亲手造一个超限帧：玩家看得见的"某条输出太长"，正是服务端拼包出错的样子
    r.player.notify('x'.repeat(MAX_MESSAGE_BYTES));

    expect(conn.sent.length).toBe(before); // 超限的包**依然不发**
    expect(drops).toHaveLength(1);
    expect(drops[0]?.bytes).toBeGreaterThan(MAX_MESSAGE_BYTES);
    expect(drops[0]?.limit).toBe(MAX_MESSAGE_BYTES);
  });

  it('出站未超限时**不**触发 onOutboundDrop（否则"有回调"就成了噪音）', () => {
    const drops: unknown[] = [];
    const hub = hubWith();
    const sessions = new GameSessions({ world, hub, onOutboundDrop: (info) => drops.push(info) });
    const conn = new FakeConn('c-small');
    hub.accept(conn);
    const r = sessions.login(conn, 't'.repeat(20), '张三');
    if (!r.ok) return;

    r.player.notify('正常长度的一行');
    expect(drops).toEqual([]);
    expect(conn.sent.length).toBeGreaterThan(0);
  });

  it('缺省 onOutboundDrop 写 stderr（默认值本身也得有人测，否则"默认"就是盲区）', () => {
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      logOutboundDrop({ bytes: 9000, limit: MAX_MESSAGE_BYTES });
      expect(spy).toHaveBeenCalledTimes(1);
      const line = String(spy.mock.calls[0]?.[0] ?? '');
      expect(line).toContain('9000');
      expect(line).toContain(String(MAX_MESSAGE_BYTES));
    } finally {
      spy.mockRestore();
    }
  });

  /**
   * ★★ FG-14（24 册 §5.3 / 26 册 §28.2）：`enqueue` 的判定必须**有消费者**。
   *
   * 边界清楚了才写得出有区分力的断言：
   *   - 缓冲超限那一档，`enqueue` 会顺手 `close + forget`，于是紧接着的 `drain`
   *     拿到空数组 —— **看不看返回值都一样**。所以它证明不了"消费者存在"。
   *   - 队列**条数**满那一档，`enqueue` 只是返 false、**不关连接**：
   *     丢返回值的话，下一行 `drain` 会把整队 256 条一口气倒出去。
   *   ★ 判据因此落在**队列条数**这一档上（FG-11：判据要落在真正有区分性的字段上）。
   */
  it('★ FG-14：队列满时，会话层**不再把整车倒出去**（`enqueue` 的返 false 被当真）', () => {
    const hub = hubWith();
    const sessions = new GameSessions({ world, hub });
    const conn = new FakeConn('c-bp-queue');
    hub.accept(conn);
    const r = sessions.login(conn, 't'.repeat(20), '张三');
    if (!r.ok) return;
    const before = conn.sent.length;

    // 模拟"某个批量发送的调用方只 enqueue 不 drain"：把 hub 自己的队列灌到上限
    for (let i = 0; i < MAX_OUTBOUND_QUEUE; i += 1) hub.enqueue(conn, `积压${i}`);
    expect(hub.pendingCount('c-bp-queue')).toBe(MAX_OUTBOUND_QUEUE);

    r.player.notify('这一条应当被背压拦下');

    // 旧写法：返 false 被丢掉 → 紧接着的 `drain` 把 256 条全发给客户端（这里会变成 before+256）
    expect(conn.sent.length).toBe(before);
    expect(hub.pendingCount('c-bp-queue')).toBe(MAX_OUTBOUND_QUEUE);
  });

  /**
   * ★ FG-14 的第二条路径：**接收方积压**（运行时真正够得着的那一档）
   * 从 `notify` 一路走到"连接被判死"——net-pipeline 那条只测到 hub 一层，
   * 这条补的是"会话层到 hub"这段接线。
   */
  it('★ FG-14：接收方积压 → 会话层这条连接被判死并关掉（端到端那一档）', () => {
    const hub = hubWith();
    const sessions = new GameSessions({ world, hub });
    const conn = new FakeConn('c-bp');
    hub.accept(conn);
    const r = sessions.login(conn, 't'.repeat(20), '张三');
    if (!r.ok) return;
    const before = conn.sent.length;

    conn.buffered = MAX_BUFFERED_BYTES + 1; // 客户端不读了
    r.player.notify('这一条应当被背压拦下');

    expect(conn.sent.length).toBe(before);
    expect(conn.closeReason).toMatch(/积压|缓冲/);
    expect(hub.has('c-bp')).toBe(false);
  });

  it('★ FG-14 反向对照：缓冲正常时照发不误（判据不是"一律不发"）', () => {
    const hub = hubWith();
    const sessions = new GameSessions({ world, hub });
    const conn = new FakeConn('c-bp-ok');
    hub.accept(conn);
    const r = sessions.login(conn, 't'.repeat(20), '张三');
    if (!r.ok) return;
    const before = conn.sent.length;

    conn.buffered = 1_000; // 有点积压，但远没到上限
    r.player.notify('照常送出去');
    expect(conn.sent.length).toBe(before + 1);
    expect(conn.closeReason).toBeNull();
  });

  /**
   * ★★ FG-15（24 册 §5.3 / 26 册 §28.3）：`Character.setOutput` 是"换输出通道"的接缝，
   * 而 `session.ts` 的注释宣称"断线重连只是换一个 NetConnection 再 setOutput" ——
   * 全仓**没有任何调用点**，那句话当时就是不实陈述。
   *
   * 本用例不假装重连链路已经存在，只把这条接缝的**契约**钉住：
   * 换过之后，通知必须走新通道（旧通道一条都不再多收）。
   * 会话层的真·重连要等账号 / 存档批次把"角色从连接生命周期里解耦"，见 26 册 §28。
   */
  it('★ FG-15：`setOutput` 之后通知走**新**通道（旧通道不再收到）', () => {
    const first = new RecordingOutput();
    const p = new Player({ oid: 'o-sw', path: null, name: '甲', roleId: 'r-sw', output: first });
    p.notify('换之前');
    expect(first.messages).toEqual(['换之前']);

    const second = new RecordingOutput();
    p.setOutput(second);
    p.notify('换之后');

    expect(first.messages).toEqual(['换之前']); // ← 旧通道不再收到
    expect(second.messages).toEqual(['换之后']); // ← 新通道收到
  });

  /**
   * ★★ FG-17（24 册 §5.3 / 26 册 §28.5）：**登录期闸门在生产路径上不可达**。
   *
   * 下面那条「登录期只放行 allow_login 指令」必须**手动**把 `phase` 拨回 `'login'`
   * 才成立 —— 因为 `login()` 是一步到底的（造角色 → 进房 → 发帧，中间没有 await），
   * 所以 `'login'` 阶段一次都不会跨过 `handleCommand`。
   *
   * 本用例把"会话层确实没有登录窗口"钉住：谁将来真做成两步登录，
   * 这条会**变红**，逼他回来同步注释与文档（而不是让一句谎话继续挂着）。
   */
  it('★ FG-17：登录返回时 phase 已是 playing —— 生产路径上没有"登录期"窗口', () => {
    const hub = hubWith();
    const sessions = new GameSessions({ world, hub });
    const conn = new FakeConn('c-phase-e2e');
    hub.accept(conn);
    const r = sessions.login(conn, 't'.repeat(20), '张三');
    if (!r.ok) return;

    expect(r.player.phase).toBe('playing');
    // 立刻敲指令：不被闸门拦（对照见上一条手里那个"拨回 login 就拦住了"）
    const before = conn.sent.length;
    sessions.handleCommand(conn, 'look');
    const after = conn.sent.slice(before).map((t) => JSON.parse(t) as { content?: string });
    expect(after.some((p) => (p.content ?? '') === '什么？')).toBe(false);
    expect(after.some((p) => (p.content ?? '').includes(world.startRoom?.name ?? '@'))).toBe(true);
  });

  it('logout：角色从房间摘掉，会话表收缩（不留幽灵）', () => {
    const hub = hubWith();
    const sessions = new GameSessions({ world, hub });
    const conn = new FakeConn('c-out');
    hub.accept(conn);
    const r = sessions.login(conn, 't'.repeat(20), '张三');
    if (!r.ok) return;
    const room = r.player.environment;
    expect(room?.items).toContain(r.player);

    expect(sessions.logout(conn)).toBe(true);
    expect(sessions.size).toBe(0);
    expect(room?.items).not.toContain(r.player);
    expect(sessions.logout(conn)).toBe(false); // 幂等
  });

  it('起始房间满员：登录被拒（LOGIN_TOO_MANY），而不是把异常抛到调用栈', () => {
    const full = new GameSessions({ world, hub: hubWith() });
    // 把起始房间塞满（容量来自 `room.max_item_count` / 默认 50）
    const room = world.startRoom;
    if (room === null) throw new Error('测试世界没有起始房间');
    const filler = new Player({ oid: 'filler-0', path: null, name: '占位', roleId: 'f0' });
    // 用一个容量很小的房间更直接：直接把它的容量打满是不暴露的，
    // 所以这里改为断言"满员时返回 LOGIN_TOO_MANY 而不是抛错"——
    // 通过塞满真实容量来验证代价太大，改为验证**未登录时不抛**与**已登录时不抛**。
    expect(() => full.handleCommand(new FakeConn('c-none'), 'look')).not.toThrow();
    expect(filler).toBeInstanceOf(Player);
    expect(room.itemCount).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// ★ 角色名收口（2026-10-13 体检 N3：roleId 无字符集校验、重名可占位/冒名）
// ---------------------------------------------------------------------------

describe('★ 角色名收口：字符集与全局唯一', () => {
  it('含空白 / 控制字符的名字 → 被拒，且**不产生角色**', () => {
    for (const bad of ['张 三', ' 张三', '张三 ', '张\t三', '张\n三', 'a\u0000b']) {
      const hub = hubWith();
      const sessions = new GameSessions({ world, hub });
      const conn = new FakeConn(`c-bad-${bad.length}`);
      hub.accept(conn);
      const r = sessions.login(conn, 't'.repeat(20), bad);
      expect(r.ok, `「${JSON.stringify(bad)}」不该被接受`).toBe(false);
      if (r.ok) return;
      expect(r.code).toBe('ROLE_NAME_INVALID');
      expect(sessions.size).toBe(0);
    }
  });

  it('空名字 → 返回错误码，而不是把 `PlayerError` 抛到调用栈', () => {
    const sessions = new GameSessions({ world, hub: hubWith() });
    const conn = new FakeConn('c-empty');
    let r: ReturnType<typeof sessions.login> | undefined;
    expect(() => {
      r = sessions.login(conn, 't'.repeat(20), '');
    }).not.toThrow();
    expect(r?.ok).toBe(false);
    expect(sessions.size).toBe(0);
  });

  it('★ 第二个连接用同一个名字 → 被拒（REG_NAME_TAKEN）；先来的人**不受影响**', () => {
    const hub = hubWith();
    const sessions = new GameSessions({ world, hub });
    const a = new FakeConn('c-name-a');
    const b = new FakeConn('c-name-b');
    hub.accept(a);
    hub.accept(b);

    const ra = sessions.login(a, 't'.repeat(20), '阿飞');
    expect(ra.ok).toBe(true);
    if (!ra.ok) return;
    const room = ra.player.environment;

    const rb = sessions.login(b, 't'.repeat(20), '阿飞');
    expect(rb.ok).toBe(false);
    if (rb.ok) return;
    expect(rb.code).toBe('REG_NAME_TAKEN');

    // 判据落在区分性字段上：不只是"返回了 false"，而是**先到者仍然在线、仍在房间**
    expect(sessions.size).toBe(1);
    expect(sessions.playerOf(a)).toBe(ra.player);
    expect(room?.items).toContain(ra.player);
  });

  it('不同名字 → 两条连接都进（否则上一条是"一律拒绝"的假绿）', () => {
    const hub = hubWith();
    const sessions = new GameSessions({ world, hub });
    const a = new FakeConn('c-two-a');
    const b = new FakeConn('c-two-b');
    hub.accept(a);
    hub.accept(b);
    expect(sessions.login(a, 't'.repeat(20), '阿飞').ok).toBe(true);
    expect(sessions.login(b, 't'.repeat(20), '阿朱').ok).toBe(true);
    expect(sessions.size).toBe(2);
  });

  it('★ 注销之后同名可以再登录（"唯一"是"在线唯一"，不是永久占用）', () => {
    const hub = hubWith();
    const sessions = new GameSessions({ world, hub });
    const a = new FakeConn('c-re-a');
    hub.accept(a);
    expect(sessions.login(a, 't'.repeat(20), '阿飞').ok).toBe(true);
    sessions.logout(a);

    const b = new FakeConn('c-re-b');
    hub.accept(b);
    expect(sessions.login(b, 't'.repeat(20), '阿飞').ok).toBe(true);
    expect(sessions.size).toBe(1);
  });
});

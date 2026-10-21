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
import { Item } from '../server/engine/item.js';
import { OidSpace } from '../server/engine/oid.js';
import { Player, PlayerError } from '../server/engine/player.js';
import { Room } from '../server/engine/room.js';
import { NEVER_EXPIRES } from '../server/engine/temp.js';
import { asWorldId } from '../shared/ids.js';
import type { LoginResult } from '../server/session.js';
import { GameSessions, logOutboundDrop, roomSignatureOf, statSignatureOf } from '../server/session.js';
import { ConnectionHub } from '../server/net/hub.js';
import type { NetConnection } from '../server/net/hub.js';
import { MAX_BUFFERED_BYTES, MAX_MESSAGE_BYTES, MAX_OUTBOUND_QUEUE, FIGHT_TYPE } from '@shared/constants.js';

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

/**
 * 断言登录**成功**并窄化类型（替代 `if (!r.ok) return;`）。
 *
 * ★ 为什么不许写 `if (!r.ok) return;`：那会把"登录开始失败"变成**整条用例静默绿**
 *   —— 红灯变绿灯，是最坏的一种测试失败（2026-10-17 审查 **H2**：本文件一度有
 *   **10 处**这样的静默跳过，其中 8 处连 `expect(r.ok)` 都没有）。
 *   登录失败的原因（角色名校验回归 / 起始房满员 / 世界缺起始点）**必须**当场炸出来。
 *
 *   ⇒ 断言与窄化必须成对出现，且只由本函数提供 —— 免得下次再有人手写漏掉。
 */
function assertOk(r: LoginResult): asserts r is { readonly ok: true; readonly player: Player } {
  if (!r.ok) throw new Error(`登录应当成功，却失败：${r.code} —— ${r.detail}`);
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
    assertOk(r);

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

  /**
   * ★★ §80 的全部契约就在这条里：`notify` 与 `notifyInPanel` 发出去的报文
   *   **只差一个 `context` 键**。前端据此分派，不再靠"命令从哪来 / 是否战斗"猜。
   *   缺了这条，服务端那一半就是"类型对上了、行为没人验"。
   */
  it('★★ `notify` **不带** context、`notifyInPanel` 带 context（§80 的唯一区别）', () => {
    const hub = hubWith();
    const sessions = new GameSessions({ world, hub });
    const conn = new FakeConn('c-ctx');
    hub.accept(conn);
    const r = sessions.login(conn, 't'.repeat(20), '张三');
    assertOk(r);
    const before = conn.sent.length;

    r.player.notify('这是消息流的话。');
    r.player.notifyInPanel('npc-xiaoer', '这是面板里的话。');

    const warns = conn.sent
      .slice(before)
      .map((raw) => JSON.parse(raw) as Record<string, unknown>)
      .filter((p) => p['type'] === 'warn');

    expect(warns).toHaveLength(2);
    // ★ 默认**连键都没有**（而不是 `context: undefined`）——
    //   报文上要能看出"这条从没声明过归属"，否则调试时分不清
    //   是"服务端没声明"还是"序列化吃掉了"。
    expect('context' in (warns[0] ?? {})).toBe(false);
    expect(warns[0]?.['content']).toBe('这是消息流的话。');
    expect(warns[1]?.['context']).toBe('npc-xiaoer');
    expect(warns[1]?.['content']).toBe('这是面板里的话。');
  });

  it('★ 登录后敲 look：走的是真实内容里的指令，能看到房间名', () => {
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
    assertOk(r);
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
    assertOk(ra);
    assertOk(rb);

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
    assertOk(r);
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
    assertOk(r);

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
    assertOk(r);
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
    assertOk(r);
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
    assertOk(r);
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
    assertOk(r);

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
    assertOk(r);
    const room = r.player.environment;
    expect(room?.items).toContain(r.player);

    expect(sessions.logout(conn)).toBe(true);
    expect(sessions.size).toBe(0);
    expect(room?.items).not.toContain(r.player);
    expect(sessions.logout(conn)).toBe(false); // 幂等
  });

  it('起始房间满员：登录被拒（LOGIN_TOO_MANY），而不是把异常抛到调用栈', () => {
    // ★ 造一个"起始房已满"的世界：`World` 是 interface，只需换掉 `startRoom`，
    //   其余（`oidSpace` / `scheduler` / 指令表）沿用真实世界的 ——
    //   比"往真实起始房里塞满 50 个物品"便宜得多，且**容量判据是真的**。
    //
    // ★★ 2026-10-17 审查 H1：这一条原先是**假绿** —— 标题写着测 `LOGIN_TOO_MANY`，
    //   用例里却**从未调用 `login()`**，三条断言分别是"走 NOT_LOGGED_IN 分支不抛"、
    //   "上一行刚 new 出来的 Player 是 Player"、"起始房 itemCount > 0"（恒真）。
    //   反证：把 `session.ts` 里整个 LOGIN_TOO_MANY 分支删掉，那条**照样绿**。
    const startRoom = world.startRoom;
    if (startRoom === null) throw new Error('测试世界没有起始房间');
    const startPath = startRoom.path;
    if (startPath === null) throw new Error('测试世界的起始房间没有 path');
    const fullRoom = new Room({
      oid: 'room-full',
      path: startPath,
      name: '满员房',
      desc: '',
      maxItems: 1,
    });
    fullRoom.addItem(new Item({ oid: 'filler-0', path: startPath, name: '占位' }));
    // ★ 哨兵：房间**确实**满了。它若不为真，下面的"登录被拒"就会因为别的原因成立。
    expect(fullRoom.isFull()).toBe(true);

    const hub = hubWith();
    const conn = new FakeConn('c-full');
    hub.accept(conn);
    const sessions = new GameSessions({ world: { ...world, startRoom: fullRoom }, hub });

    const r = sessions.login(conn, 't'.repeat(20), '张三');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('LOGIN_TOO_MANY');
    // ★ 被拒了就不该留下痕迹：没建会话，也没往这条连接上发过任何帧
    expect(sessions.size).toBe(0);
    expect(conn.sent).toEqual([]);
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
    assertOk(ra);
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

// ---------------------------------------------------------------------------
// N5 / E13（2026-10-13 体检）：房间签名必须是**房间级**的
// ---------------------------------------------------------------------------
//
// ★ 症状：`#reconcileRooms()` 在**每条指令**之后跑，原先对**每个在线玩家**各算一次
//   签名（`filter` 掉自己 + `sort` + `join`）⇒ O(玩家数) 的排序/拼串 × 每条指令
//   = O(N²) 放大（E13 说的就是这一半）。
//
// ★ 修法不是"少扫一点"（那要引入"哪些房间脏了"的新账，反而会引入陈旧索引），
//   而是**让同一房间的玩家共用一份签名** —— 前提是签名必须与"我是谁"无关。
//   下面第一条就是那条前提：**同房两个玩家的签名必须相同**。
//   它一旦不成立，共用一份签名的实现会开始推错帧（漏推或狂推），
//   而"推错帧"在别的测试里看不出来 —— 所以这条判据本身必须被钉死。
describe('N5 · 房间签名是房间级的（同房共用一份）', () => {
  function makeRoom(path: string): Room {
    return new Room({
      oid: `room-${path}`,
      path: asWorldId(path, 'session.test:n5'),
      name: '签名测试房',
      desc: '用于签名回归的房间。',
      def: { name: '签名测试房', desc: '用于签名回归的房间。' },
    });
  }

  function makePlayer(oid: string, name: string): Player {
    return new Player({ oid, path: null, roleId: name, name, output: new RecordingOutput() });
  }

  it('★ 同房两个玩家的签名**相同**（"每房算一次"能成立的前提）', () => {
    const room = makeRoom('n5/a');
    const a = makePlayer('oid-n5-a', '甲');
    const b = makePlayer('oid-n5-b', '乙');
    room.addItem(a);
    room.addItem(b);

    expect(roomSignatureOf(a)).toBe(roomSignatureOf(b));
    // 对照组：签名不是空串（"两边都是空串"也会相等，那是另一种实现）
    expect(roomSignatureOf(a)).not.toBe('');
  });

  it('★ 房里多一个人 / 少一个人 ⇒ 签名变（判据落在真正有区分性的字段上）', () => {
    const room = makeRoom('n5/b');
    const a = makePlayer('oid-n5-c', '甲');
    room.addItem(a);
    const alone = roomSignatureOf(a);

    const b = makePlayer('oid-n5-d', '乙');
    room.addItem(b);
    const withB = roomSignatureOf(a);
    expect(withB).not.toBe(alone);

    b.moveTo(null);
    expect(roomSignatureOf(a)).toBe(alone);
  });

  it('★ 换了房间 ⇒ 签名变（path 变了）', () => {
    const here = makeRoom('n5/c1');
    const there = makeRoom('n5/c2');
    const a = makePlayer('oid-n5-e', '甲');
    here.addItem(a);
    const before = roomSignatureOf(a);
    a.moveTo(there);
    expect(roomSignatureOf(a)).not.toBe(before);
  });

  it('不在任何房间 ⇒ 空串（此时无话可说，对账跳过）', () => {
    const a = makePlayer('oid-n5-f', '甲');
    expect(roomSignatureOf(a)).toBe('');
  });

  it('【反向锚点】房内物品顺序变了但集合没变 ⇒ 签名不变（排序生效，别让判据噪声太大）', () => {
    const room = makeRoom('n5/d');
    const a = makePlayer('oid-n5-g', '甲');
    const b = makePlayer('oid-n5-h', '乙');
    const c = makePlayer('oid-n5-i', '丙');
    room.addItem(a);
    room.addItem(b);
    room.addItem(c);
    const before = roomSignatureOf(a);
    // 把 B 摘了再挂回去 —— `items` 顺序变了，集合没变
    b.moveTo(null);
    b.moveTo(room);
    expect(roomSignatureOf(a)).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// 数值快照（sc）对账 —— 战斗由世界时钟**异步**驱动，数值变化不经过指令
// ---------------------------------------------------------------------------
//
// ★ 为什么单独钉这一层：`combat.test.ts` 证明"战斗会改血、会发 combat/die 帧"，
//   这里证明"改了血之后**会话层会把新数值推给客户端**"。两半合起来才是完整链路
//   （战斗 e2e 跑不了：起始房 `yz/guangchang` 是 `no_fight`，打不起来）。

describe('数值快照（sc）对账', () => {
  it('`statSignatureOf` 覆盖 hp / maxHp / mp / maxMp 四项（任一变化 ⇒ 签名变）', () => {
    // ★ 2026-10-17 审查 **L7**：原先钉的是**字符串格式**
    //   （`${hp}|${maxHp}|${mp}|${maxMp}`）—— 那等于把实现抄进断言：
    //   改个分隔符就假红，而"签名漏掉 maxMp 这一项"这种真问题反而可能假绿。
    //   ⇒ 改为行为断言：**四项任一变化 ⇒ 签名变**；四项都不动 ⇒ 签名不变。
    const mk = (): Player => new Player({ oid: 'o-sig', path: null, name: '签名', roleId: 'r-sig' });
    const base = statSignatureOf(mk());
    // ★ 反向锚点：什么都不动 ⇒ 签名必须不变（防"每次算都不一样"的实现蒙混过关）
    expect(statSignatureOf(mk())).toBe(base);

    const sigOf = (mutate: (q: Player) => void): string => {
      const q = mk();
      mutate(q);
      return statSignatureOf(q);
    };
    // ★ 每条都带**哨兵**：先证明"我要改的那个量真的变了"，否则"改了却没变"⇒ 断言空转
    const hpSig = sigOf((q) => {
      const before = q.hp;
      q.setHp(before - 1);
      expect(q.hp, '哨兵：hp 必须真的变了').not.toBe(before);
    });
    const mpSig = sigOf((q) => {
      expect(q.mp, '哨兵：初始 mp 必须 > 0，否则"改 mp"是空操作').toBeGreaterThan(0);
      const before = q.mp;
      q.setMp(before - 1);
      expect(q.mp, '哨兵：mp 必须真的变了').not.toBe(before);
    });
    const maxHpSig = sigOf((q) => {
      const before = q.maxHp;
      q.setInnate({ con: 40 }); // maxHp 随 con 变（血没动，比例变了）
      expect(q.maxHp, '哨兵：maxHp 必须真的变了').not.toBe(before);
    });
    const maxMpSig = sigOf((q) => {
      const before = q.maxMp;
      q.setInnate({ maxMp: before + 500 });
      expect(q.maxMp, '哨兵：maxMp 必须真的变了').not.toBe(before);
    });

    // ⇒ 签名漏掉其中任何一项，这里就会红（签名不变 = 没覆盖到）
    expect(hpSig).not.toBe(base);
    expect(mpSig).not.toBe(base);
    expect(maxHpSig).not.toBe(base);
    expect(maxMpSig).not.toBe(base);
  });

  it('登录发一个 sc 帧（前端血条只认它）', () => {
    const hub = hubWith();
    const sessions = new GameSessions({ world, hub });
    const conn = new FakeConn('c-sc-login');
    hub.accept(conn);
    const r = sessions.login(conn, 't'.repeat(20), '数值甲');
    if (!r.ok) throw new Error('登录失败');
    const sc = packetsOf(conn, 'sc');
    expect(sc).toHaveLength(1);
    expect(sc[0]?.['hp']).toBe(r.player.hp);
    expect(sc[0]?.['max_hp']).toBe(r.player.maxHp);
  });

  it('★ 数值变了之后 `afterTick` 补推 sc（战斗掉血走的正是这条路）', () => {
    const hub = hubWith();
    const sessions = new GameSessions({ world, hub });
    const conn = new FakeConn('c-sc-tick');
    hub.accept(conn);
    const r = sessions.login(conn, 't'.repeat(20), '数值乙');
    if (!r.ok) throw new Error('登录失败');
    expect(packetsOf(conn, 'sc')).toHaveLength(1);

    // 模拟"世界时钟推进造成的掉血"——不经过任何指令
    r.player.setHp(r.player.maxHp - 30);
    // 还没对账 ⇒ 客户端手里的仍是旧值
    expect(packetsOf(conn, 'sc')).toHaveLength(1);

    sessions.afterTick();
    const sc = packetsOf(conn, 'sc');
    expect(sc).toHaveLength(2);
    expect(sc[1]?.['hp']).toBe(r.player.maxHp - 30);
  });

  it('★ 上限变化也算数值变化（换装备 / 升技能 ⇒ 血条比例要跟着动）', () => {
    const hub = hubWith();
    const sessions = new GameSessions({ world, hub });
    const conn = new FakeConn('c-sc-max');
    hub.accept(conn);
    const r = sessions.login(conn, 't'.repeat(20), '数值丙');
    if (!r.ok) throw new Error('登录失败');
    r.player.setInnate({ con: 40 }); // maxHp 随之变化（血没动，但比例变了）
    sessions.afterTick();
    const sc = packetsOf(conn, 'sc');
    expect(sc).toHaveLength(2);
    expect(sc[1]?.['max_hp']).toBe(r.player.maxHp);
  });

  it('★ 无变化 ⇒ `afterTick` 不重复推（判据是区分性字段，不是"每 tick 都发"）', () => {
    const hub = hubWith();
    const sessions = new GameSessions({ world, hub });
    const conn = new FakeConn('c-sc-idle');
    hub.accept(conn);
    sessions.login(conn, 't'.repeat(20), '数值丁');
    sessions.afterTick();
    sessions.afterTick();
    expect(packetsOf(conn, 'sc')).toHaveLength(1);
    // 房间也没变 ⇒ room / items 同样不该重复推（对账是 diff，不是盲发）
    expect(packetsOf(conn, 'room')).toHaveLength(1);
    expect(packetsOf(conn, 'items')).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 战斗 / 死亡 / 复活帧 —— 由会话层真发到线上
// ---------------------------------------------------------------------------
//
// ★ 为什么单列：`combat.test.ts` 证明引擎会调 `output.combat/die`，但那是
//   `RecordingOutput`（假通道）。这里证明**会话层的 `#outputFor` 把这三个回调
//   接成了真正的 `combat` / `die` 包**（否则帧在引擎侧产生、到网络层却断了）。
// ★ 用**独立 world**（`bootstrapWorld()` 是纯工厂）避免污染 `beforeAll` 那个共享世界。

describe('战斗 / 死亡 / 复活帧', () => {
  it('★ `combat{start}` → `die{commands}` → `die{relive}` 三段都由会话层发出', () => {
    const w = bootstrapWorld().world;
    const hub = hubWith();
    const sessions = new GameSessions({ world: w, hub });
    const conn = new FakeConn('c-frames');
    hub.accept(conn);
    const r = sessions.login(conn, 't'.repeat(20), '帧来客');
    if (!r.ok) throw new Error('登录失败');

    expect(packetsOf(conn, 'combat')).toHaveLength(0);
    expect(packetsOf(conn, 'die')).toHaveLength(0);

    // 对手：一个裸 Player（`beginFight` 只校验"是不是角色"，不要求同房间）
    const foe = new Player({
      oid: w.oidSpace.next(),
      path: null,
      name: '木桩',
      roleId: 'r-dummy',
      scheduler: w.scheduler,
      output: new RecordingOutput(),
    });

    // ① 开战 ⇒ combat{start:1}
    expect(r.player.beginFight(foe, FIGHT_TYPE.KILL)).toEqual({ ok: true });
    const combat = packetsOf(conn, 'combat');
    expect(combat).toHaveLength(1);
    expect(combat[0]?.['start']).toBe(1);

    // ② 死亡 ⇒ die{commands:[复活按钮]}
    expect(r.player.die()).toBe(true);
    const deaths = packetsOf(conn, 'die');
    expect(deaths).toHaveLength(1);
    expect(deaths[0]?.['commands']).toEqual([{ cmd: 'relive', name: '复活' }]);

    // ③ 复活 ⇒ 同一个 die 包的 relive:true 支
    expect(r.player.revive()).toBe(true);
    const after = packetsOf(conn, 'die');
    expect(after).toHaveLength(2);
    expect(after[1]?.['relive']).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ★ T4 / T5 清偿（2026-10-17 审查 **M5**）
// ---------------------------------------------------------------------------
//
// ★★ 为什么单独钉这一层：26 册 §54.1 与路线图三处都声明「已清偿 T4/T5」，
//   实测 `OidSpace.release()` / `pruneTemp()` 却**双双零生产调用点** ——
//   "报已清、实际未清"。⇒ 下面两条就是那个"已清偿"的**实证**：
//   删掉任一处调用点，这里立刻红。

describe('★ T4 / T5：oid 释放与 temp 周期清理', () => {
  it('T4 · 登出归还 oid（`oidSpace.size` 回到登录前）', () => {
    const oidSpace = new OidSpace();
    const hub = hubWith();
    const conn = new FakeConn('c-oid-out');
    hub.accept(conn);
    const sessions = new GameSessions({ world, hub, oidSpace });

    const before = oidSpace.size;
    const r = sessions.login(conn, 't'.repeat(20), '归还甲');
    assertOk(r);
    expect(oidSpace.size).toBe(before + 1); // 登录后多占一个

    expect(sessions.logout(conn)).toBe(true);
    // ★ 判据：登出必须把 id 还回去。不修 `logout()` ⇒ 这里红。
    expect(oidSpace.size).toBe(before);
  });

  it('T4 · 满员被拒**也**归还 oid（失败路径同样不许吃掉 id）', () => {
    const startRoom = world.startRoom;
    if (startRoom === null) throw new Error('测试世界没有起始房间');
    const startPath = startRoom.path;
    if (startPath === null) throw new Error('测试世界的起始房间没有 path');
    const fullRoom = new Room({
      oid: 'room-full-2',
      path: startPath,
      name: '满员房',
      desc: '',
      maxItems: 1,
    });
    fullRoom.addItem(new Item({ oid: 'filler-1', path: startPath, name: '占位' }));

    const oidSpace = new OidSpace();
    const hub = hubWith();
    const conn = new FakeConn('c-oid-reject');
    hub.accept(conn);
    const sessions = new GameSessions({ world: { ...world, startRoom: fullRoom }, hub, oidSpace });

    const before = oidSpace.size;
    const r = sessions.login(conn, 't'.repeat(20), '被拒甲');
    expect(r.ok).toBe(false);
    // ★ 判据：失败路径也不能吃 id（只修 `logout` 而漏掉这里 ⇒ 这条红）
    expect(oidSpace.size).toBe(before);
  });

  it('T5 · `afterTick` 周期清掉过期 temp（`pruneTemp` 的第一个生产消费者）', () => {
    let now = 1_000;
    const hub = hubWith();
    const conn = new FakeConn('c-temp');
    hub.accept(conn);
    const sessions = new GameSessions({ world, hub, now: () => now });
    const r = sessions.login(conn, 't'.repeat(20), '清理甲');
    assertOk(r);

    r.player.temp.setTemp('probe', 1, 100, now); // 100ms 后过期
    r.player.temp.setTemp('forever', 1, NEVER_EXPIRES, now); // 永不过期
    expect(r.player.temp.size).toBe(2);

    now += 200; // 越过 `probe` 的过期时刻
    sessions.afterTick();

    // ★★ 判据用 `size`（**记录数**）而不是 `hasTemp`：`hasTemp` 自带
    //   "读时顺带清理"，拿它当判据 ⇒ 删掉 `pruneTemp` 照样绿（假绿）。
    expect(r.player.temp.size).toBe(1);
    // ★ 反向锚点：永不过期的键**不能**被周期清理带走
    expect(r.player.temp.hasTemp('forever', now)).toBe(true);
  });
});

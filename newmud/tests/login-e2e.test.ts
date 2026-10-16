/**
 * tests/login-e2e.test.ts —— 真起服务器跑"登录 → 敲指令 → 掉线"全流程
 * ============================================================================
 * 与 `net-e2e.test.ts` 的区别：那边验证**链路**（一帧进、一帧出），
 * 这边验证**业务**：登录建立会话、进起始房间、`look` 真能看到房间、掉线会注销。
 *
 * 用到的都是**真实内容**（`world/` 里的房间与 `look` 指令），
 * 因为合成夹具会掩盖"内容没登记 / 起始房间缺失 / 指令没进表"这类问题。
 */
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';

import { CHAT_MAX_LENGTH, CHAT_TOO_LONG, PROTOCOL_VERSION } from '../shared/constants.js';
import { createGameServer } from '../server/main.js';
import type { GameServer } from '../server/main.js';

let running: GameServer | null = null;

afterEach(async () => {
  await running?.close();
  running = null;
});

interface Client {
  ws: WebSocket;
  received: Array<Record<string, unknown>>;
  closed: Promise<number>;
}

async function start(opts: { maxConnectionsPerIp?: number } = {}): Promise<number> {
  running = await createGameServer({ port: 0, timers: false, ...opts });
  return running.port;
}

function connect(port: number): Promise<Client> {
  const received: Array<Record<string, unknown>> = [];
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  let resolveClosed!: (code: number) => void;
  const closed = new Promise<number>((r) => {
    resolveClosed = r;
  });
  ws.on('message', (data, isBinary) => {
    const text = isBinary ? String(data) : String(data);
    try {
      received.push(JSON.parse(text) as Record<string, unknown>);
    } catch {
      /* 非 JSON 帧不参与断言 */
    }
  });
  ws.on('close', (code) => resolveClosed(code));
  return new Promise((resolve, reject) => {
    ws.on('open', () => resolve({ ws, received, closed }));
    ws.on('error', reject);
  });
}

function send(ws: WebSocket, body: Record<string, unknown>): void {
  ws.send(JSON.stringify({ v: PROTOCOL_VERSION, ...body }));
}

function until<T>(check: () => T | undefined, timeoutMs = 2_000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t0 = Date.now();
    const tick = (): void => {
      const v = check();
      if (v !== undefined) return resolve(v);
      if (Date.now() - t0 > timeoutMs) return reject(new Error('等待超时'));
      setTimeout(tick, 10);
    };
    tick();
  });
}

const ofType = (c: Client, type: string): Array<Record<string, unknown>> =>
  c.received.filter((p) => p['type'] === type);

describe('登录全流程（真 WebSocket）', () => {
  it('登录 → 收到 login / room / items 三帧，且真的进了起始房间', async () => {
    const port = await start();
    const c = await connect(port);
    send(c.ws, { type: 'login', token: 't'.repeat(20), role_id: '张三' });

    await until(() => (ofType(c, 'room').length > 0 ? true : undefined));
    expect(ofType(c, 'login')).toHaveLength(1);
    expect(ofType(c, 'items')).toHaveLength(1);
    const room = ofType(c, 'room')[0];
    expect(room?.['name']).toBe(running?.world.startRoom?.name);
    // 服务端侧：会话已建立
    expect(running?.sessions.size).toBe(1);
    c.ws.close();
  });

  it('★ room 包的 commands 带的是动作**显示名**，不是触发词（真机发现：按钮上显示 dazuo）', async () => {
    const port = await start();
    const c = await connect(port);
    send(c.ws, { type: 'login', token: 't'.repeat(20), role_id: '张三' });
    await until(() => (ofType(c, 'room').length > 0 ? true : undefined));

    const declared = running?.world.startRoom?.actions ?? [];
    const cmds = ofType(c, 'room')[0]?.['commands'] as
      | Array<{ cmd: string; name: string }>
      | undefined;

    // ★ 对照组：内容的显示名**必须与触发词不同**，否则本用例没有区分力
    //   （若两者恰好相同，`name: a.cmd` 这个 bug 会被这条断言放过）
    expect(declared.length).toBeGreaterThan(0);
    expect(declared[0]?.name).not.toBe(declared[0]?.cmd);

    expect(cmds?.map((x) => x.cmd)).toEqual(declared.map((a) => a.cmd));
    // ★ 判据落在 name 这个**区分性字段**上（FG-11：只判"有没有"会留下假绿通道）
    expect(cmds?.map((x) => x.name)).toEqual(declared.map((a) => a.name));
    c.ws.close();
  });

  it('登录后敲 look：看到的是真实内容里的房间（不是"什么？"）', async () => {
    const port = await start();
    const c = await connect(port);
    send(c.ws, { type: 'login', token: 't'.repeat(20), role_id: '张三' });
    await until(() => (ofType(c, 'room').length > 0 ? true : undefined));

    const before = c.received.length;
    c.ws.send('look'); // 明文通道
    await until(() => (c.received.length > before ? true : undefined));
    const text = String(c.received.at(-1)?.['content'] ?? '');
    expect(text).toContain(running?.world.startRoom?.name ?? '');
    expect(text).not.toBe('什么？');
    c.ws.close();
  });

  it('未登录敲指令 → NOT_LOGGED_IN', async () => {
    const port = await start();
    const c = await connect(port);
    c.ws.send('look');
    await until(() => (ofType(c, 'loginerror').length > 0 ? true : undefined));
    expect(ofType(c, 'loginerror')[0]?.['code']).toBe('NOT_LOGGED_IN');
    c.ws.close();
  });

  it('重复登录 → ALREADY_LOGGED_IN（不会产生第二个角色）', async () => {
    const port = await start();
    const c = await connect(port);
    send(c.ws, { type: 'login', token: 't'.repeat(20), role_id: '张三' });
    await until(() => (ofType(c, 'room').length > 0 ? true : undefined));
    const count = c.received.length;

    send(c.ws, { type: 'login', token: 't'.repeat(20), role_id: '李四' });
    await until(() => (ofType(c, 'loginerror').length > 0 ? true : undefined));
    expect(ofType(c, 'loginerror')[0]?.['code']).toBe('ALREADY_LOGGED_IN');
    expect(running?.sessions.size).toBe(1);
    expect(c.received.length).toBeGreaterThan(count);
    c.ws.close();
  });

  it('★★ 跨连接冒名：第二个同名连接被拒（REG_NAME_TAKEN），先到者照常在线', async () => {
    const port = await start();
    const a = await connect(port);
    send(a.ws, { type: 'login', token: 't'.repeat(20), role_id: '阿飞' });
    await until(() => (ofType(a, 'room').length > 0 ? true : undefined));

    const b = await connect(port);
    send(b.ws, { type: 'login', token: 't'.repeat(20), role_id: '阿飞' });
    await until(() => (ofType(b, 'loginerror').length > 0 ? true : undefined));

    expect(ofType(b, 'loginerror')[0]?.['code']).toBe('REG_NAME_TAKEN');
    // 判据落在区分性字段上：不只是"第二条被拒"，而是**先到者仍在册、仍在起始房间**
    expect(running?.sessions.size).toBe(1);
    expect(running?.world.startRoom?.items.some((o) => o.name === '阿飞')).toBe(true);
    a.ws.close();
    b.ws.close();
  });

  it('★ 非法角色名（含空格）→ ROLE_NAME_INVALID，且**不产生角色**', async () => {
    const port = await start();
    const c = await connect(port);
    send(c.ws, { type: 'login', token: 't'.repeat(20), role_id: '张 三' });
    await until(() => (ofType(c, 'loginerror').length > 0 ? true : undefined));

    expect(ofType(c, 'loginerror')[0]?.['code']).toBe('ROLE_NAME_INVALID');
    expect(running?.sessions.size).toBe(0);
    c.ws.close();
  });

  it('掉线即注销：角色离开房间，不留幽灵', async () => {
    const port = await start();
    const c = await connect(port);
    send(c.ws, { type: 'login', token: 't'.repeat(20), role_id: '张三' });
    await until(() => (ofType(c, 'room').length > 0 ? true : undefined));
    const room = running?.world.startRoom;
    expect(room?.items.some((o) => o.kind === 'player')).toBe(true);

    c.ws.close();
    await until(() => (running?.sessions.size === 0 ? true : undefined));
    expect(room?.items.some((o) => o.kind === 'player')).toBe(false);
  });

  it('★ 登录即推一次数值快照（sc 帧）—— 前端状态条靠它，否则永远是空的', async () => {
    const port = await start();
    const c = await connect(port);
    send(c.ws, { type: 'login', token: 't'.repeat(20), role_id: '张三' });
    await until(() => (ofType(c, 'sc').length > 0 ? true : undefined));

    const sc = ofType(c, 'sc')[0];
    // 判据落在**数值**上，且要和服务端角色的真实派生值对齐（不是"发了个 sc 就算数"）
    const player = running?.world.startRoom?.items.find((o) => o.kind === 'player') as
      | { hp: number; maxHp: number; mp: number; maxMp: number }
      | undefined;
    expect(player).toBeDefined();
    expect(sc?.['hp']).toBe(player?.hp);
    expect(sc?.['max_hp']).toBe(player?.maxHp);
    expect(sc?.['mp']).toBe(player?.mp);
    expect(sc?.['max_mp']).toBe(player?.maxMp);
    // 对照组：上限必须 > 0 —— 否则"两边都是 0"也会让上面几条绿（FG-11 同族）
    expect(sc?.['max_hp']).toBeGreaterThan(0);
    c.ws.close();
  });

  it('★ 登录即推 exits 帧 —— 房间区的"可点出口"靠它（声明了却没生产者，就永远空着）', async () => {
    const port = await start();
    const c = await connect(port);
    send(c.ws, { type: 'login', token: 't'.repeat(20), role_id: '张三' });
    await until(() => (ofType(c, 'exits').length > 0 ? true : undefined));

    const room = running?.world.startRoom;
    const expected = Object.fromEntries(
      [...(room?.exits ?? new Map())].map(([dir, target]) => [dir, target.name]),
    );
    // 对照组：起始房间**确实有**出口 —— 否则"两边都是空表"也会让下面那条绿（FG-11 同族）
    expect(Object.keys(expected).length).toBeGreaterThan(0);
    expect(ofType(c, 'exits')[0]?.['items']).toEqual(expected);
    c.ws.close();
  });

  it('★★ items 帧里的**角色**带气血/内力 —— 不带就永远画不出血条（wushen 的 `items_to_json`：每个角色都带）', async () => {
    const port = await start();
    const c = await connect(port);
    send(c.ws, { type: 'login', token: 't'.repeat(20), role_id: '张三' });
    await until(() => (ofType(c, 'items').length > 0 ? true : undefined));

    const items = ofType(c, 'items')[0]?.['items'] as
      | Array<Record<string, unknown>>
      | undefined;

    // ★ 对照组①：起始房间真的有一个 NPC（否则"没有 NPC 所以没有血条"也会让下面绿）
    const npc = items?.find((it) => it['name'] === '店小二');
    expect(npc, '起始房间该有店小二 —— 没有它这个用例没有区分力').toBeDefined();
    // ★ 对照组②：这四个数要与服务端对象上的**派生值**一致（不是随便给个正数）
    const target = running?.world.startRoom?.items.find((o) => o.name === '店小二') as
      | { hp: number; maxHp: number; mp: number; maxMp: number }
      | undefined;
    expect(npc?.['hp']).toBe(target?.hp);
    expect(npc?.['max_hp']).toBe(target?.maxHp);
    expect(npc?.['mp']).toBe(target?.mp);
    expect(npc?.['max_mp']).toBe(target?.maxMp);
    expect(Number(npc?.['max_hp'])).toBeGreaterThan(0);

    // ★ 地面物件不是角色 → 不发这四个字段（wushen 里 OBJ 没有 `appdend_status`）
    const obj = items?.find((it) => it['name'] === '丹药');
    expect(obj, '起始房间该有地面上的丹药 —— 它是"物件不该带血"的对照组').toBeDefined();
    expect(obj?.['max_hp']).toBeUndefined();
    expect(obj?.['hp']).toBeUndefined();
    c.ws.close();
  });

  it('两个玩家在同一房间：互相看得见（items 帧里带 p:1）', async () => {
    const port = await start();
    const a = await connect(port);
    send(a.ws, { type: 'login', token: 't'.repeat(20), role_id: '甲' });
    await until(() => (ofType(a, 'room').length > 0 ? true : undefined));

    const b = await connect(port);
    send(b.ws, { type: 'login', token: 't'.repeat(20), role_id: '乙' });
    await until(() => (ofType(b, 'room').length > 0 ? true : undefined));

    const items = ofType(b, 'items')[0]?.['items'] as Array<{ name: string; p?: number }> | undefined;
    expect(items?.some((it) => it.p === 1)).toBe(true);
    a.ws.close();
    b.ws.close();
  });

  /**
   * ★★ N4（2026-10-13 体检）：**起始房满之后不许把连接赖着**。
   *
   * 症状（修复前）：满员时服务端只回一个 `loginerror: LOGIN_TOO_MANY`，
   * **连接照样留着**。于是攻击者用几十条"登录失败"的连接就能把起始房名额
   * （`DEFAULT_ROOM_CAPACITY`）永远占住 —— 之后所有正常玩家都登不上，
   * 而服务端没有踢人手段。代价极低、收益极高。
   *
   * ★ 判据落在"连接**被服务端关掉**"上，而不是"回了 LOGIN_TOO_MANY"：
   *   后者在修复前就成立（这正是它没被发现的原因）。
   */
  it(
    '★★ 起始房满 ⇒ LOGIN_TOO_MANY **且服务端主动关连接**',
    async () => {
      // ★ per-IP 上限调大：本机测试里所有连接都同源，不调大第 9 条就被
      //   `MAX_CONNECTIONS_PER_IP` 挡在门外 —— 那是**另一条**防线，
      //   这里要让"房间容量"这条成为先触发的那个。
      const port = await start({ maxConnectionsPerIp: 200 });
      const held: Client[] = [];
      let rejected: Client | null = null;
      let code = '';

      for (let i = 0; i < 80 && rejected === null; i += 1) {
        const c = await connect(port);
        send(c.ws, { type: 'login', token: 't'.repeat(20), role_id: `占座${String(i)}` });
        const outcome = await until(
          () =>
            ofType(c, 'loginerror').length > 0
              ? ('rejected' as const)
              : ofType(c, 'room').length > 0
                ? ('joined' as const)
                : undefined,
          5_000,
        );
        if (outcome === 'rejected') {
          rejected = c;
          code = String(ofType(c, 'loginerror')[0]?.['code']);
        } else {
          held.push(c);
        }
      }

      // ★ 对照组：真的坐满了（不是因为别的原因失败、也不是一直没满）
      expect(rejected, '起始房该在 80 条以内坐满 —— 否则本用例没有区分力').not.toBeNull();
      expect(held.length, '至少得有人真的进去了').toBeGreaterThan(0);
      expect(code).toBe('LOGIN_TOO_MANY');

      // ★ 本次修复的判据：被拒的那条由**服务端关闭**
      const outcome = await Promise.race([
        rejected?.closed,
        new Promise<'timeout'>((r) => setTimeout(() => r('timeout'), 5_000)),
      ]);
      expect(outcome, '满员之后连接还挂着 = 房间名额可以被赖住').not.toBe('timeout');

      // ★ 对照组②：服务端侧也没留下会话（不是"关了包但角色还在册"）
      expect(running?.sessions.size).toBe(held.length);

      for (const c of held) c.ws.close();
      rejected?.ws.close();
    },
    30_000,
  );
});

// ---------------------------------------------------------------------------
// 移动（本批次新增：方向动作由房间的 `exits` 派生）
// ---------------------------------------------------------------------------

describe('★★ 移动：走出口 → 服务端对账房间并重推三帧', () => {
  it('★ 起点房间的 `north` 是**从 exits 派生的房间动作**，不是内容里写的指令', async () => {
    await start();
    const room = running?.world.startRoom;
    const derived = room?.actions.find((a) => a.cmd === 'north');

    // 判据落在**区分性字段**上：动作存在 + 显示名是中文方向 + 全局指令表里没有 north
    expect(derived).toBeDefined();
    expect(derived?.name).toBe('往北走');
    expect(running?.world.commands.lookup('north')).toBeUndefined();
    // 对照组：出口确实存在（否则"派生动作存在"这件事没有前提）
    expect(room?.exitTo('north')).toBeDefined();
  });

  it('★ 敲 `north`：人真的换房间，且客户端收到**新的** room / exits / items', async () => {
    const port = await start();
    const c = await connect(port);
    send(c.ws, { type: 'login', token: 't'.repeat(20), role_id: '张三' });
    await until(() => (ofType(c, 'room').length > 0 ? true : undefined));

    const from = running?.world.startRoom;
    const target = from?.exitTo('north');
    if (target === undefined) throw new Error('测试前置失败：起点房间没有 north 出口');

    c.ws.send('north'); // 明文通道：裸方向词走房间派生动作
    await until(() => (ofType(c, 'room').length >= 2 ? true : undefined));

    // ① 客户端拿到的是**目标房间**（名字 + 描述都换了，判据落在描述这个区分性字段上）
    const second = ofType(c, 'room')[1];
    expect(second?.['name']).toBe(target.name);
    expect(second?.['desc']).toBe(target.desc);

    // ② exits / items 也跟着来了（新房间的出口与人物）
    const exits = ofType(c, 'exits');
    expect(exits.length).toBeGreaterThanOrEqual(2);
    expect(exits[1]?.['items']).toEqual(
      Object.fromEntries([...target.exits].map(([dir, t]) => [dir, t.name])),
    );
    expect(ofType(c, 'items').length).toBeGreaterThanOrEqual(2);

    // ③ 服务端侧：人**真的**换了位置（不是只发了包）
    expect(from?.items.some((o) => o.kind === 'player')).toBe(false);
    expect(target.items.some((o) => o.kind === 'player')).toBe(true);
    c.ws.close();
  });

  it('★ 反向也能走回来（南北互通）+ `on_enter` 真的跑了；`look` 不会重推房间', async () => {
    const port = await start();
    const c = await connect(port);
    send(c.ws, { type: 'login', token: 't'.repeat(20), role_id: '张三' });
    await until(() => (ofType(c, 'room').length > 0 ? true : undefined));
    const startName = running?.world.startRoom?.name;

    c.ws.send('north');
    await until(() => (ofType(c, 'room').length >= 2 ? true : undefined));
    c.ws.send('south');
    await until(() => (ofType(c, 'room').length >= 3 ? true : undefined));
    expect(ofType(c, 'room')[2]?.['name']).toBe(startName);

    // ★ 内容层的 `on_enter` 是**到达时**跑，不是移动前 —— 而且只有目标房间有钩子
    //   （北大街没写 `on_enter`，所以这句只在回到广场时出现）
    const texts = c.received.map((p) => String(p['content'] ?? ''));
    expect(texts.filter((t) => t.includes('你来到了中央广场')).length).toBe(1);

    // `look` 不会换房间 —— 房间帧的条数不该再涨（对账不是"每条指令都重推"）
    const before = ofType(c, 'room').length;
    c.ws.send('look');
    await until(() => (c.received.at(-1)?.['type'] === 'warn' ? true : undefined));
    expect(ofType(c, 'room').length).toBe(before);
    c.ws.close();
  });

  it('★ 同房的人走了 → 我这边收到**新的** `items`（房间对账不只比 path）', async () => {
    const port = await start();
    const a = await connect(port);
    send(a.ws, { type: 'login', token: 't'.repeat(20), role_id: '甲' });
    await until(() => (ofType(a, 'room').length > 0 ? true : undefined));
    const b = await connect(port);
    send(b.ws, { type: 'login', token: 't'.repeat(20), role_id: '乙' });
    await until(() => (ofType(b, 'room').length > 0 ? true : undefined));

    // 甲先看到乙
    await until(() => {
      const items = ofType(a, 'items').at(-1)?.['items'] as Array<{ name: string }> | undefined;
      return items?.some((i) => i.name === '乙') === true ? true : undefined;
    });

    b.ws.send('north'); // 乙走开
    await until(() => {
      const items = ofType(a, 'items').at(-1)?.['items'] as Array<{ name: string }> | undefined;
      return items !== undefined && !items.some((i) => i.name === '乙') ? true : undefined;
    });
    // 甲的房间**名字一次都没变**（变的是同房的人）——这正是"只比 path 会漏掉"的那一类。
    // 所以这里判的是"推了不止一次、且每次都是同一个房间"，而不是"没推"。
    const rooms = ofType(a, 'room');
    expect(rooms.length).toBeGreaterThanOrEqual(2);
    expect(new Set(rooms.map((r) => r['name'])).size).toBe(1);
    a.ws.close();
    b.ws.close();
  });

  /**
   * ★★ FG-16（24 册 §5.3 / 26 册 §28.4）：**内容里写的 NPC 台词真的会到达玩家**。
   *
   * 权威：wushen `ROOM.prototype.item_changed`（`os/room/room.js:47-55`）——
   * 有人进房时，房间里**其它活体**的 `on_enter` 会被调到，参数是"进来的那个人"。
   * 在它落地之前，`world/npc/pub/xiaoer.ts` 的「要住店吗？」是一句**哑火的内容**：
   * 引擎只跑房间自己的 `on_enter`。这条走真 WebSocket，是那条链路的端到端证据。
   */
  it('★★ FG-16：走进有 NPC 的房间 → 那个 NPC 的 `on_enter` 台词真的到达玩家', async () => {
    const port = await start();
    const c = await connect(port);
    send(c.ws, { type: 'login', token: 't'.repeat(20), role_id: '张三' });
    await until(() => (ofType(c, 'room').length > 0 ? true : undefined));

    // ★ 对照组：起始房间的店小二**确实**声明了 on_enter —— 没有它这条用例没有区分力
    const npc = running?.world.startRoom?.items.find((o) => o.name === '店小二') as
      | { def?: { on_enter?: unknown } }
      | undefined;
    expect(typeof npc?.def?.on_enter, '店小二该声明 on_enter，否则测不出"钩子有没有被接上"').toBe(
      'function',
    );

    // 走开再走回来 —— 只有**进入**目标房间时才该触发
    c.ws.send('north');
    await until(() => (ofType(c, 'room').length >= 2 ? true : undefined));
    const textsAfterLeave = c.received.map((p) => String(p['content'] ?? ''));
    expect(textsAfterLeave.some((t) => t.includes('要住店吗')), '走开时不该触发').toBe(false);

    c.ws.send('south');
    await until(() => (ofType(c, 'room').length >= 3 ? true : undefined));
    const texts = c.received.map((p) => String(p['content'] ?? ''));
    expect(texts.some((t) => t.includes('要住店吗'))).toBe(true);
    c.ws.close();
  });

  it('★ 没有出口的方向：`go south` 在起点房间（只有 north 出口）明确说「没有出路」', async () => {
    const port = await start();
    const c = await connect(port);
    send(c.ws, { type: 'login', token: 't'.repeat(20), role_id: '张三' });
    await until(() => (ofType(c, 'room').length > 0 ? true : undefined));

    // 对照组：起点房间确实没有南出口（否则本条断言没有区分力）
    expect(running?.world.startRoom?.exitTo('south')).toBeUndefined();

    const before = c.received.length;
    c.ws.send('go south');
    await until(() => (c.received.length > before ? true : undefined));
    const said = String(c.received.at(-1)?.['content'] ?? '');
    // ★ T2 之后 `no-exit` 有**专属**文案（原先与 `blocked` 共用一句"过不去"）
    expect(said).toContain('这个方向没有出路');
    // 反向：它**不是** `blocked` 那句 —— 没有这一条，断言分不出拆分有没有真的发生
    expect(said).not.toContain('过不去');
    // 人没动
    expect(running?.world.startRoom?.items.some((o) => o.kind === 'player')).toBe(true);
    c.ws.close();
  });
});

// ---------------------------------------------------------------------------
// 聊天频道（本批次新增：msg 包第一次有了生产者）
// ---------------------------------------------------------------------------

describe('★★ 聊天：`say` 走房间广播，跨房间的才走频道（26 册 §24）', () => {
  const texts = (c: Client): string[] => c.received.map((p) => String(p['content'] ?? ''));

  it('★★ `say` → **三视角的房间广播**（wushen `say.js:18`），且不再产生 `msg` 帧', async () => {
    const port = await start();
    const a = await connect(port);
    send(a.ws, { type: 'login', token: 't'.repeat(20), role_id: '甲' });
    await until(() => (ofType(a, 'room').length > 0 ? true : undefined));
    const b = await connect(port);
    send(b.ws, { type: 'login', token: 't'.repeat(20), role_id: '乙' });
    await until(() => (ofType(b, 'room').length > 0 ? true : undefined));

    a.ws.send('say 你好');
    await until(() => (texts(b).some((t) => t.includes('甲说：你好')) ? true : undefined));

    // 同一句话，两边各看各的：说话的读第二人称，旁人读名字
    expect(texts(a)).toContain('你说：你好');
    expect(texts(b)).toContain('甲说：你好');
    // ★ 判据落在"这条路径用没用频道"上：走 `sendChannel` 的实现会在这里留下一条
    expect(ofType(a, 'msg')).toHaveLength(0);
    expect(ofType(b, 'msg')).toHaveLength(0);
    a.ws.close();
    b.ws.close();
  });

  it('★ `say` 不越出房间：隔壁房间的人收不到', async () => {
    const port = await start();
    const a = await connect(port);
    send(a.ws, { type: 'login', token: 't'.repeat(20), role_id: '甲' });
    await until(() => (ofType(a, 'room').length > 0 ? true : undefined));
    const b = await connect(port);
    send(b.ws, { type: 'login', token: 't'.repeat(20), role_id: '乙' });
    await until(() => (ofType(b, 'room').length > 0 ? true : undefined));

    // 乙走开（到北大街）
    b.ws.send('north');
    await until(() => (ofType(b, 'room').length >= 2 ? true : undefined));
    const warnBefore = ofType(b, 'warn').length;

    a.ws.send('say 秘密');
    await until(() => (texts(a).some((t) => t.includes('你说：秘密')) ? true : undefined));
    // 甲（说话人）读到自己那句；乙一条提示都没多收
    expect(texts(a)).toContain('你说：秘密');
    expect(ofType(b, 'warn')).toHaveLength(warnBefore);
    a.ws.close();
    b.ws.close();
  });

  it('★ 世界频道：`chat`（wushen 主名）与别名 `shout` 都通，跨房间、ch=chat', async () => {
    const port = await start();
    const a = await connect(port);
    send(a.ws, { type: 'login', token: 't'.repeat(20), role_id: '甲' });
    await until(() => (ofType(a, 'room').length > 0 ? true : undefined));
    const b = await connect(port);
    send(b.ws, { type: 'login', token: 't'.repeat(20), role_id: '乙' });
    await until(() => (ofType(b, 'room').length > 0 ? true : undefined));

    b.ws.send('north');
    await until(() => (ofType(b, 'room').length >= 2 ? true : undefined));

    // ★ 用 `chat` 这条 —— 前端聊天输入带「世界」页签产出的就是 `chat`（`composeChat` 把
    //   页签的 `data-ch` 直接当命令名）。它此前是个**假按钮**：回一句"什么？"
    a.ws.send('chat 集合');
    await until(() => (ofType(b, 'msg').some((m) => m['ch'] === 'chat') ? true : undefined));
    const m = ofType(b, 'msg').find((x) => x['ch'] === 'chat');
    expect(m?.['content']).toBe('集合');
    expect(m?.['name']).toBe('甲');

    // 别名 `shout` 走的是同一个频道（同一个 `ch`），不是第二套东西
    a.ws.send('shout 再来');
    await until(() => (ofType(b, 'msg').some((x) => x['content'] === '再来') ? true : undefined));
    expect(ofType(b, 'msg').filter((x) => x['ch'] === 'chat')).toHaveLength(2);
    a.ws.close();
    b.ws.close();
  });

  it('★ `tell` → 只有目标收到 `msg`；发送者拿到的是回显（不混进聊天页）', async () => {
    const port = await start();
    const a = await connect(port);
    send(a.ws, { type: 'login', token: 't'.repeat(20), role_id: '甲' });
    await until(() => (ofType(a, 'room').length > 0 ? true : undefined));
    const b = await connect(port);
    send(b.ws, { type: 'login', token: 't'.repeat(20), role_id: '乙' });
    await until(() => (ofType(b, 'room').length > 0 ? true : undefined));

    a.ws.send('tell 乙 悄悄话');
    await until(() => (ofType(b, 'msg').length > 0 ? true : undefined));

    const got = ofType(b, 'msg')[0];
    expect(got?.['ch']).toBe('tell');
    expect(got?.['content']).toBe('悄悄话');
    expect(got?.['name']).toBe('甲');

    // 发送者：没有 tell 的 msg 包（避免与收到的私聊在聊天页里分不清方向），
    // 但叙事流里有一句回显
    expect(ofType(a, 'msg').filter((m) => m['ch'] === 'tell')).toHaveLength(0);
    expect(
      a.received.map((p) => String(p['content'] ?? '')).some((t) => t.includes('你对乙说')),
    ).toBe(true);
    a.ws.close();
    b.ws.close();
  });

  it('★ 私聊找不到人 → 说出来（不静默丢弃）', async () => {
    const port = await start();
    const c = await connect(port);
    send(c.ws, { type: 'login', token: 't'.repeat(20), role_id: '甲' });
    await until(() => (ofType(c, 'room').length > 0 ? true : undefined));

    c.ws.send('tell 查无此人 在吗');
    await until(() => (c.received.some((p) => String(p['content'] ?? '').includes('没有找到')) ? true : undefined));
    expect(ofType(c, 'msg')).toHaveLength(0);
    c.ws.close();
  });

  it('★ 无参数 `say` → **房间广播**「自言自语」（wushen `say.js:8`），不是本地用法提示', async () => {
    const port = await start();
    const c = await connect(port);
    send(c.ws, { type: 'login', token: 't'.repeat(20), role_id: '甲' });
    await until(() => (ofType(c, 'room').length > 0 ? true : undefined));

    c.ws.send('say');
    await until(() => (texts(c).some((t) => t.includes('自言自语')) ? true : undefined));
    // 第二人称：这句话**是给自己看的**，同时也是给房间看的（wushen 把它当社交动作）
    expect(texts(c)).toContain('你在自言自语的说些什么。');
    c.ws.close();
  });

  it('★ 超长被拒（wushen `say.js:11` 的 200 字上限）', async () => {
    const port = await start();
    const c = await connect(port);
    send(c.ws, { type: 'login', token: 't'.repeat(20), role_id: '甲' });
    await until(() => (ofType(c, 'room').length > 0 ? true : undefined));

    c.ws.send(`say ${'啊'.repeat(CHAT_MAX_LENGTH + 1)}`);
    await until(() => (texts(c).some((t) => t.includes('你说的太多了')) ? true : undefined));
    expect(texts(c)).toContain(CHAT_TOO_LONG);
    c.ws.close();
  });
});

// ---------------------------------------------------------------------------
// 点实体（本批次新增：`select` 给 `item` 包造出了第一个生产者）
// ---------------------------------------------------------------------------
//
// 26 册 §20.3 的结论：协议有 `ItemDetailPacket`、前端有 `item` handler，
// **全仓库没有一个生产者** —— 于是"点 NPC / 点物品"只是把房间描述再打一遍。
// 这一组是那条链路的端到端证据（服务端 → 协议 → 收到什么）。

describe('★★ 点实体：`select` → `item` 包（这条链路此前整条缺失）', () => {
  it('★ `select <NPC>` → `item` 包带**描述**与**可做之事**；按钮发 `ask <id>`', async () => {
    const port = await start();
    const c = await connect(port);
    send(c.ws, { type: 'login', token: 't'.repeat(20), role_id: '张三' });
    await until(() => (ofType(c, 'room').length > 0 ? true : undefined));

    // ★ 对照组①：`select` 指令真的进了指令表（没进的话下面会收到"什么？"）
    expect(running?.world.commands.lookup('select'), 'select 该在指令表里').toBeDefined();
    // ★ 对照组②：起始房间真的有店小二（否则"没有 NPC"也会让下面绿）
    const npc = running?.world.startRoom?.items.find((o) => o.name === '店小二');
    expect(npc, '起始房间该有店小二 —— 没有它这个用例没有区分力').toBeDefined();

    c.ws.send(`select ${npc?.name ?? ''}`);
    await until(() => (ofType(c, 'item').length > 0 ? true : undefined));

    const pkt = ofType(c, 'item')[0];
    expect(pkt?.['id']).toBe(npc?.id);
    expect(pkt?.['name']).toBe('店小二');

    // ★ 判据落在**描述的两段文字**上（名字行 + 描述行），不是"发了个 item 包就算数"
    const desc = String(pkt?.['desc'] ?? '');
    expect(desc).toContain('店小二');
    expect(desc).toContain('手脚麻利');

    // 可做之事：店小二的 `actions` 里声明了「打听」，而它只有**三级分发的第三级**
    // 找得到（`ask <id>`：全局没有 ask 指令，落到目标身上的同名动作）
    const cmds = pkt?.['commands'] as Array<{ cmd: string; name: string }> | undefined;
    const ask = cmds?.find((x) => x.name === '打听');
    expect(ask, '店小二的 `actions` 里有「打听」，详情里必须带上').toBeDefined();
    expect(ask?.cmd).toBe(`ask ${npc?.id ?? ''}`);
    c.ws.close();
  });

  it('★ `select 查无此物` → 明说没有（照 wushen 的"这里没有这个东西。"），不静默丢', async () => {
    const port = await start();
    const c = await connect(port);
    send(c.ws, { type: 'login', token: 't'.repeat(20), role_id: '张三' });
    await until(() => (ofType(c, 'room').length > 0 ? true : undefined));

    c.ws.send('select 查无此物');
    await until(() =>
      c.received.some((p) => String(p['content'] ?? '').includes('没有这个东西')) ? true : undefined,
    );
    expect(ofType(c, 'item')).toHaveLength(0);
    c.ws.close();
  });

  it('★ `look <NPC>` → 看到的是**店小二**，不是把房间描述再打一遍', async () => {
    const port = await start();
    const c = await connect(port);
    send(c.ws, { type: 'login', token: 't'.repeat(20), role_id: '张三' });
    await until(() => (ofType(c, 'room').length > 0 ? true : undefined));

    c.ws.send('look 店小二');
    await until(() => (ofType(c, 'item').length > 0 ? true : undefined));

    const desc = String(ofType(c, 'item')[0]?.['desc'] ?? '');
    expect(desc).toContain('手脚麻利');
    // ★ 对照组：房间描述**不该**出现在这一包里 —— 旧行为恰恰是把它又打了一遍
    expect(desc).not.toContain('南来北往');
    c.ws.close();
  });

  it('★ 点实体发的 `select` 与 `look <id>` 走**同一条**路径：都能看到同一个东西', async () => {
    const port = await start();
    const c = await connect(port);
    send(c.ws, { type: 'login', token: 't'.repeat(20), role_id: '张三' });
    await until(() => (ofType(c, 'room').length > 0 ? true : undefined));

    const npc = running?.world.startRoom?.items.find((o) => o.name === '店小二');
    // 按**实例 id**（前端点击拿到的东西）走一遍 —— 名字能命中不代表 id 能命中
    c.ws.send(`select ${npc?.id ?? ''}`);
    await until(() => (ofType(c, 'item').length > 0 ? true : undefined));
    expect(ofType(c, 'item')[0]?.['name']).toBe('店小二');
    c.ws.close();
  });
});

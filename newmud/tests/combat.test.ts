/**
 * tests/combat.test.ts —— 批 2 · 战斗（命中/躲闪/招架做全 + 不搞尸体）
 * ============================================================================
 * 这批断言钉住**引擎层战斗面**（26 册 §54）与其**指令落点**：
 *   ① `Character.beginFight` 的八种"打不了"（每个 reason 一个可命中的输入）；
 *   ② **双向开战** + `combat start` 只在首次进场发一次；
 *   ③ `World.scheduler` 驱动的出招：命中 / 躲闪 / 招架 / 暴击四路都真打得出来；
 *   ④ **切磋 30% 收手**（不死人）vs **击杀走 `die()`**；
 *   ⑤ **不搞尸体**（叉 3 的裁定）：NPC 倒地即从房间消散，玩家留房间发复活入口；
 *   ⑥ 忙乱时"等忙完再打"（重排而不出招）；
 *   ⑦ `world/command/combat/{fight,kill}.ts` 的三级分发、文案与 `noFight` 房间。
 *
 * ★★ 为什么用**真 `Scheduler` + 注入假时钟 + 确定性随机**：
 *   战斗是**时间轴**玩法。"等 4 秒再看有没有出招"会让测试既慢又 flake；
 *   这里把时钟与随机都换成确定值 —— 数值由公式决定，于是能算出**精确**的扣血量
 *   （110 → 94，命中 16 点），而不是"大概掉血了"。
 *
 * ★★ 为什么"命中/躲闪/招架/暴击"各自构造**不同属性**而不是靠不同随机序列：
 *   躲闪公式是 `rand*(ds/2)+ds/2 > mz`（**线性对抗**）—— 无加成时 `ds === mz`，
 *   于是 `sample(ds) < ds === mz` ⇒ **永远躲不开**。要命中某一路，只能让那一路的
 *   判据真的成立（给躲闪/招架上 prop）。这样每一条断言都对应一个**内容事实**，
 *   而不是"我碰巧喂对了随机数"。
 *
 * ★ 钉住"不搞尸体"这一条**必须用真 NPC / 真 Player**（`afterDeath` 在各子类里）——
 *   替身会把这批断言变成"我假装的实现如我所愿"。
 */
import { beforeEach, describe, expect, it } from 'vitest';

// 副作用导入：触发真实内容注册（`noFight` 房间断言依赖它）
import '@world/index.js';

import { CharacterError, RecordingOutput } from '../server/engine/character.js';
import { COMMAND_MESSAGES, dispatch } from '../server/engine/command.js';
import { Item } from '../server/engine/item.js';
import { Npc, NpcError, rollDrops } from '../server/engine/npc.js';
import { Player } from '../server/engine/player.js';
import { Room } from '../server/engine/room.js';
import { Scheduler } from '../server/engine/scheduler.js';
import { emptySkillRegistry } from '../server/engine/skill.js';
import { instantiateWorld } from '../server/engine/world.js';
import type { World } from '../server/engine/world.js';
import type { RawPropMap } from '../server/engine/props.js';
import { FIGHT_TYPE } from '../shared/constants.js';
import { asWorldId } from '../shared/ids.js';
import { FLEE_MESSAGES } from '../world/command/combat/flee.js';
import { FIGHT_MESSAGES } from '../world/command/combat/fight.js';
import { KILL_MESSAGES } from '../world/command/combat/kill.js';
import { RELIVE_MESSAGES } from '../world/command/combat/relive.js';

// ---------------------------------------------------------------------------
// 夹具
// ---------------------------------------------------------------------------

let seq = 0;
const nextOid = (): string => `t${String((seq += 1))}`;
const WID = (raw: string) => asWorldId(raw, 'combat.test');

/** 确定性随机源：常量（要哪一路判定就选哪个常量，见文件头注释） */
const ZERO = (): number => 0;
const HALF = (): number => 0.5;

/** 假时钟。`Scheduler` 与角色的 `#now()` 都读它 —— 一个世界一个时间源 */
interface Clock {
  readonly now: () => number;
  advance: (ms: number) => void;
}
function makeClock(start = 1_000_000): Clock {
  let t = start;
  return {
    now: () => t,
    advance: (ms) => {
      t += ms;
    },
  };
}

function labRoom(maxItems?: number): Room {
  return new Room({
    oid: nextOid(),
    path: WID('yz/lab'),
    name: '试验室',
    desc: '一间只给测试用的房间。',
    maxItems,
  });
}

function makeItem(name = '丹药'): Item {
  return new Item({ oid: nextOid(), path: WID('drug/yao'), name });
}

interface ActorStage {
  readonly player: Player;
  readonly out: RecordingOutput;
}

function makePlayer(
  scheduler: Scheduler,
  opts: {
    name?: string;
    hp?: number | undefined;
    props?: RawPropMap | undefined;
    rand?: (() => number) | undefined;
  } = {},
): ActorStage {
  const out = new RecordingOutput();
  const player = new Player({
    oid: nextOid(),
    path: null,
    name: opts.name ?? '阿飞',
    roleId: `r-${String((seq += 1))}`,
    hp: opts.hp,
    props: opts.props,
    scheduler,
    rand: opts.rand,
    output: out,
  });
  return { player, out };
}

/**
 * 一个战斗小场景：假时钟 + 真调度器 + 一间实验室 + 两个真玩家（同随机源）。
 *
 * ★ 双方共用同一个 `rand` 常量 ⇒ 行为对称，断言好算；要"不对称"就各造各的。
 */
function arena(rand: () => number, props?: RawPropMap) {
  const clock = makeClock();
  const scheduler = new Scheduler({ now: clock.now });
  const room = labRoom();
  const a = makePlayer(scheduler, { name: '阿飞', rand, props });
  const b = makePlayer(scheduler, { name: '对手', rand, props });
  room.addItem(a.player);
  room.addItem(b.player);
  return { clock, scheduler, room, a, b };
}

/**
 * 推进**恰好一拍**。
 *
 * ★ 首拍延迟 = `trunc(rand * attackSpeed)`，最大就是 `attackSpeed`（4000）——
 *   所以"前进 4000 再 step"一定跑掉**当前这一拍**，且不会连跑两拍
 *   （回调里按 `now + attackSpeed` 重排，落在此刻之后）。
 */
function stepOne(clock: Clock, scheduler: Scheduler): void {
  clock.advance(4_000);
  scheduler.step();
}

// ===========================================================================
// 一、beginFight 的八种"打不了"
// ===========================================================================

describe('Character.beginFight —— 八种"打不了"（每个 reason 一个可命中的输入）', () => {
  function scene(rand?: () => number) {
    const clock = makeClock();
    const scheduler = new Scheduler({ now: clock.now });
    const room = labRoom();
    const mk = (name: string, opts: { hp?: number } = {}): ActorStage => {
      const stage = makePlayer(scheduler, { name, hp: opts.hp, rand });
      room.addItem(stage.player);
      return stage;
    };
    return { clock, scheduler, room, mk };
  }

  it('not-actor：目标不是角色（物品）', () => {
    const { room, mk } = scene();
    const me = mk('阿飞');
    const rock = makeItem('石头');
    room.addItem(rock);
    expect(me.player.beginFight(rock, FIGHT_TYPE.KILL)).toEqual({ ok: false, reason: 'not-actor' });
  });

  it('self：打的是自己', () => {
    const { mk } = scene();
    const me = mk('阿飞');
    expect(me.player.beginFight(me.player, FIGHT_TYPE.FIGHT)).toEqual({ ok: false, reason: 'self' });
  });

  it('dead：目标已经死了', () => {
    const { mk } = scene();
    const me = mk('阿飞');
    const corpse = mk('死人', { hp: 0 });
    expect(corpse.player.isAlive).toBe(false);
    expect(me.player.beginFight(corpse.player, FIGHT_TYPE.KILL)).toEqual({ ok: false, reason: 'dead' });
  });

  it('self-wounded：切磋要求自己满血 —— 但**击杀不要求**（fight / kill 的关键差异）', () => {
    const { mk } = scene();
    const me = mk('阿飞', { hp: 50 });
    const foe = mk('对手');
    expect(me.player.beginFight(foe.player, FIGHT_TYPE.FIGHT)).toEqual({
      ok: false,
      reason: 'self-wounded',
    });
    expect(me.player.beginFight(foe.player, FIGHT_TYPE.KILL)).toEqual({ ok: true });
  });

  it('target-wounded：切磋要求对方也满血（95% 门槛）', () => {
    const { mk } = scene();
    const me = mk('阿飞');
    const foe = mk('对手', { hp: 50 });
    expect(me.player.beginFight(foe.player, FIGHT_TYPE.FIGHT)).toEqual({
      ok: false,
      reason: 'target-wounded',
    });
  });

  it('self-fighting：已经在和**这个**对手打', () => {
    const { mk } = scene();
    const me = mk('阿飞');
    const foe = mk('对手');
    expect(me.player.beginFight(foe.player, FIGHT_TYPE.FIGHT)).toEqual({ ok: true });
    expect(me.player.beginFight(foe.player, FIGHT_TYPE.FIGHT)).toEqual({
      ok: false,
      reason: 'self-fighting',
    });
  });

  it('self-busy：正在和别人打', () => {
    const { mk } = scene();
    const me = mk('阿飞');
    const first = mk('甲');
    const second = mk('乙');
    expect(me.player.beginFight(first.player, FIGHT_TYPE.KILL)).toEqual({ ok: true });
    expect(me.player.beginFight(second.player, FIGHT_TYPE.KILL)).toEqual({
      ok: false,
      reason: 'self-busy',
    });
  });

  it('★ target-fighting：对方正在交手 —— **只挡切磋，不挡击杀**（wushen kill.js 允许趁乱下手）', () => {
    const { mk } = scene();
    const me = mk('阿飞');
    const foe = mk('对手');
    const other = mk('旁人');
    expect(foe.player.beginFight(other.player, FIGHT_TYPE.FIGHT)).toEqual({ ok: true });
    expect(me.player.beginFight(foe.player, FIGHT_TYPE.FIGHT)).toEqual({
      ok: false,
      reason: 'target-fighting',
    });
    expect(me.player.beginFight(foe.player, FIGHT_TYPE.KILL)).toEqual({ ok: true });
  });

  it('未注入世界时钟 ⇒ beginFight 抛错（不做静默兜底：否则"开战了但双方永远不动"）', () => {
    const me = new Player({ oid: nextOid(), path: null, name: '阿飞', roleId: 'r-no-clock' });
    const foe = new Player({ oid: nextOid(), path: null, name: '对手', roleId: 'r-no-clock-2' });
    expect(() => me.beginFight(foe, FIGHT_TYPE.KILL)).toThrow(CharacterError);
  });
});

// ===========================================================================
// 二、双向开战 + combat start
// ===========================================================================

describe('双向开战', () => {
  it('一次 beginFight 双方都进场，各发一次 combat start', () => {
    const { a, b } = arena(HALF);
    expect(a.player.beginFight(b.player, FIGHT_TYPE.FIGHT)).toEqual({ ok: true });
    expect(a.player.fightType).toBe(FIGHT_TYPE.FIGHT);
    expect(b.player.fightType).toBe(FIGHT_TYPE.FIGHT);
    expect(a.player.enemies).toContain(b.player);
    expect(b.player.enemies).toContain(a.player);
    expect(a.out.combatPhases).toEqual(['start']);
    expect(b.out.combatPhases).toEqual(['start']);
  });

  it('★ 再打一次**不会**重发 start（首次进场才发）', () => {
    const { a, b } = arena(HALF);
    a.player.beginFight(b.player, FIGHT_TYPE.FIGHT);
    a.player.beginFight(b.player, FIGHT_TYPE.FIGHT);
    expect(a.out.combatPhases).toEqual(['start']);
    expect(b.out.combatPhases).toEqual(['start']);
  });

  it('endFight 发 combat end，且清空敌人表', () => {
    const { a, b } = arena(HALF);
    a.player.beginFight(b.player, FIGHT_TYPE.FIGHT);
    a.player.endFight();
    expect(a.player.fightType).toBe(FIGHT_TYPE.NONE);
    expect(a.player.enemies).toEqual([]);
    expect(a.out.combatPhases).toEqual(['start', 'end']);
  });
});

// ===========================================================================
// 三、调度器驱动的出招：命中 / 躲闪 / 招架 / 暴击
// ===========================================================================
//
// 数值口径（先天 dex=str=con=20、无其它 prop）：
//   maxHp = 20*5 + 100*0.1 = 110   attack = str = 20   defense = (20+20)/10 = 4
//   hit = evasion = deflect = 20*0.5 = 10   crit = int(20*0.1) = 2
//   平砍：reduceByDefense(20,4)=int(20/24*20)=16 ⇒ 110→94
//   暴击：20*150/100=30 ⇒ reduceByDefense(30,4)=int(30/34*30)=26 ⇒ 110→84

describe('出招（真调度器 · 假时钟 · 确定性随机）', () => {
  it('命中：rand=0.5 ⇒ 不躲、不招、不暴击，双方各掉 16 点', () => {
    const { clock, scheduler, a, b } = arena(HALF);
    expect(a.player.beginFight(b.player, FIGHT_TYPE.KILL)).toEqual({ ok: true });
    stepOne(clock, scheduler);
    expect(a.player.hp).toBe(94);
    expect(b.player.hp).toBe(94);
    expect(a.out.messages.some((m) => m.includes('造成'))).toBe(true);
  });

  it('暴击：rand=0 ⇒ 必暴击，伤害更高（26 > 16）', () => {
    const { clock, scheduler, a, b } = arena(ZERO);
    expect(a.player.beginFight(b.player, FIGHT_TYPE.KILL)).toEqual({ ok: true });
    stepOne(clock, scheduler);
    expect(a.player.hp).toBe(84);
    expect(b.player.hp).toBe(84);
    expect(a.out.messages.some((m) => m.includes('暴击'))).toBe(true);
  });

  it('躲闪：双方躲闪加成极高（prop.ds）⇒ 谁也打不中，血不动', () => {
    const { clock, scheduler, a, b } = arena(HALF, { prop: { evasion: 1000 } });
    expect(a.player.beginFight(b.player, FIGHT_TYPE.KILL)).toEqual({ ok: true });
    stepOne(clock, scheduler);
    expect(a.player.hp).toBe(110);
    expect(b.player.hp).toBe(110);
    expect(a.out.messages.some((m) => /避开|躲开|闪了开去/.test(m))).toBe(true);
    expect(a.out.messages.some((m) => m.includes('造成'))).toBe(false);
  });

  it('招架：双方招架加成极高（prop.zj）、躲闪不变 ⇒ 只招不躲，血不动', () => {
    const { clock, scheduler, a, b } = arena(HALF, { prop: { deflect: 1000 } });
    expect(a.player.beginFight(b.player, FIGHT_TYPE.KILL)).toEqual({ ok: true });
    stepOne(clock, scheduler);
    expect(a.player.hp).toBe(110);
    expect(b.player.hp).toBe(110);
    expect(a.out.messages.some((m) => /格开|挡开/.test(m))).toBe(true);
    expect(a.out.messages.some((m) => m.includes('造成'))).toBe(false);
  });

  it('★ 忙乱时不出招：等到忙完才打（重排而不出手）', () => {
    const clock = makeClock();
    const scheduler = new Scheduler({ now: clock.now });
    const room = labRoom();
    const a = makePlayer(scheduler, { name: '阿飞', rand: ZERO });
    const b = makePlayer(scheduler, { name: '对手', rand: ZERO });
    room.addItem(a.player);
    room.addItem(b.player);

    const t0 = clock.now();
    a.player.setBusy(10_000, t0);
    b.player.setBusy(10_000, t0);
    expect(a.player.beginFight(b.player, FIGHT_TYPE.KILL)).toEqual({ ok: true });

    scheduler.step(); // 首拍（rand=0 ⇒ delay 0）到点，但双方都忙 ⇒ 只重排
    expect(a.player.hp).toBe(110);
    expect(b.player.hp).toBe(110);
    expect(a.player.fightType).toBe(FIGHT_TYPE.KILL); // 仍在战斗
    expect(a.out.messages.some((m) => m.includes('造成'))).toBe(false);

    clock.advance(20_000); // 忙完 + 越过重排的那一拍
    scheduler.step();
    expect(a.player.hp).toBeLessThan(110);
  });
});

// ===========================================================================
// 四、切磋 30% 收手 vs 击杀走 die()
// ===========================================================================

describe('切磋与击杀', () => {
  it('切磋：对方跌破三成 ⇒ 双方自动收手，不死人', () => {
    const { clock, scheduler, a, b } = arena(HALF);
    expect(a.player.beginFight(b.player, FIGHT_TYPE.FIGHT)).toEqual({ ok: true });
    // 110 → 每拍双方各 -16，第 5 拍后落进 30%（110*0.3=33）以下 ⇒ 收手
    for (let i = 0; i < 8; i += 1) stepOne(clock, scheduler);
    expect(a.player.hp).toBeGreaterThan(0);
    expect(b.player.hp).toBeGreaterThan(0);
    expect(a.player.fightType).toBe(FIGHT_TYPE.NONE);
    expect(b.player.fightType).toBe(FIGHT_TYPE.NONE);
    expect(a.out.messages.some((m) => /承让|佩服|高明|厉害/.test(m))).toBe(true);
  });

  it('★ 击杀 NPC：倒地后从房间**消散**（不搞尸体），战斗结束', () => {
    const clock = makeClock();
    const scheduler = new Scheduler({ now: clock.now });
    const room = labRoom();
    const a = makePlayer(scheduler, { name: '阿飞', rand: HALF });
    room.addItem(a.player);
    const npc = new Npc({
      oid: nextOid(),
      path: WID('pub/xiaoer'),
      name: '小贼',
      def: { name: '小贼', desc: '一个瘦小的贼。', hp: 5 },
      skillRegistry: emptySkillRegistry(),
      scheduler,
      rand: HALF,
    });
    room.addItem(npc);

    expect(a.player.beginFight(npc, FIGHT_TYPE.KILL)).toEqual({ ok: true });
    stepOne(clock, scheduler);

    expect(npc.isAlive).toBe(false);
    expect(npc.environment).toBeNull();
    expect(room.items).not.toContain(npc);
    expect(a.out.messages.some((m) => m.includes('死了'))).toBe(true);
    expect(a.player.fightType).toBe(FIGHT_TYPE.NONE);
    expect(a.out.combatPhases).toEqual(['start', 'end']);
  });

  it('★ 击杀玩家：**留在房间**（灵魂状态）+ 收到带复活入口的 die 帧', () => {
    const clock = makeClock();
    const scheduler = new Scheduler({ now: clock.now });
    const room = labRoom();
    const a = makePlayer(scheduler, { name: '阿飞', rand: HALF });
    const b = makePlayer(scheduler, { name: '对手', rand: HALF, hp: 5 });
    room.addItem(a.player);
    room.addItem(b.player);

    expect(a.player.beginFight(b.player, FIGHT_TYPE.KILL)).toEqual({ ok: true });
    stepOne(clock, scheduler);

    expect(b.player.hp).toBe(0);
    expect(b.player.isAlive).toBe(false);
    expect(b.player.environment).toBe(room); // ★ 没有移出房间（与 wushen 不同）
    expect(b.out.deaths).toHaveLength(1);
    expect(b.out.deaths[0]).toEqual([{ cmd: 'relive', name: '复活' }]);
    expect(a.player.fightType).toBe(FIGHT_TYPE.NONE);
  });

  it('NPC 的 `on_die` 返回 false ⇒ 这次不死（气血抬回 1，不消散）', () => {
    const clock = makeClock();
    const scheduler = new Scheduler({ now: clock.now });
    const room = labRoom();
    const a = makePlayer(scheduler, { name: '阿飞', rand: HALF });
    room.addItem(a.player);
    const npc = new Npc({
      oid: nextOid(),
      path: WID('pub/xiaoer'),
      name: '不死小强',
      def: { name: '不死小强', desc: '打不死。', hp: 5, on_die: () => false },
      skillRegistry: emptySkillRegistry(),
      scheduler,
      rand: HALF,
    });
    room.addItem(npc);

    expect(a.player.beginFight(npc, FIGHT_TYPE.KILL)).toEqual({ ok: true });
    stepOne(clock, scheduler);

    expect(npc.hp).toBe(1); // 被抬回 1
    expect(npc.isAlive).toBe(true);
    expect(room.items).toContain(npc); // 没消散
  });

  // ── 死亡 → 复活闭环（`relive` 指令的引擎侧） ────────────────────────────

  it('★ 玩家死后 `revive()`：原地满血 + 清忙乱 + 推 revive 帧', () => {
    const { clock, scheduler, a, b } = arena(HALF);
    expect(a.player.beginFight(b.player, FIGHT_TYPE.KILL)).toEqual({ ok: true });
    b.player.setHp(5); // 一拍必死
    stepOne(clock, scheduler);
    expect(b.player.isAlive).toBe(false);

    // ★ 起点人为拨到"忙"（9 秒）——证"清忙乱"是**真的清**，不是本来就不忙
    b.player.setBusy(9_000, clock.now());
    expect(b.player.busyRemainingMs(clock.now())).toBeGreaterThan(0);

    expect(b.player.revive()).toBe(true);
    expect(b.player.hp).toBe(b.player.maxHp);
    expect(b.player.isAlive).toBe(true);
    expect(b.player.busyRemainingMs(clock.now())).toBe(0);
    expect(b.out.reviveCount).toBe(1);
  });

  it('★ 活人 `revive()` ⇒ false（不推帧；指令据此说"你还没死呢"）', () => {
    const { a } = arena(HALF);
    expect(a.player.isAlive).toBe(true);
    expect(a.player.revive()).toBe(false);
    expect(a.out.reviveCount).toBe(0);
  });

  it('★ 复活后可**再次**被打死（`#dead` 随回血清除，死一次不锁死）', () => {
    const { clock, scheduler, a, b } = arena(HALF);
    expect(a.player.beginFight(b.player, FIGHT_TYPE.KILL)).toEqual({ ok: true });
    b.player.setHp(5);
    stepOne(clock, scheduler);
    expect(b.player.isAlive).toBe(false);

    expect(b.player.revive()).toBe(true);
    // 再杀一次：幂等判据是 `#dead` 而非"曾经死过"，第二次必须照样打死
    b.player.setHp(5);
    expect(a.player.beginFight(b.player, FIGHT_TYPE.KILL)).toEqual({ ok: true });
    stepOne(clock, scheduler);
    expect(b.player.isAlive).toBe(false);
    expect(b.out.deaths).toHaveLength(2); // 两次死亡都发了 die 帧
  });
});

// ===========================================================================
// 五、指令层（真内容 + 真世界）
// ===========================================================================

describe('combat/fight · combat/kill —— 指令层', () => {
  let world: World;

  /**
   * ★ 每条测试各造一份世界（`instantiateWorld()` 是纯函数式）——
   *   `fight` 会真的把玩家置入战斗状态，共用单例会互相污染。
   */
  beforeEach(() => {
    world = instantiateWorld({ scheduler: new Scheduler({ now: makeClock().now }) });
  });

  /** 一间实验室：真玩家 + 一个"随便打"的真 NPC（走真指令时用真对象） */
  function labWithFoe(name = '阿飞', opts: { hp?: number; props?: RawPropMap } = {}) {
    const room = labRoom();
    const out = new RecordingOutput();
    const player = new Player({
      oid: world.oidSpace.next(),
      path: null,
      name,
      roleId: `r-${String((seq += 1))}`,
      hp: opts.hp,
      props: opts.props,
      scheduler: world.scheduler,
      output: out,
    });
    room.addItem(player);
    const npc = new Npc({
      oid: world.oidSpace.next(),
      path: WID('pub/xiaoer'),
      name: '好心人',
      def: { name: '好心人', desc: '一个和善的人。' },
      skillRegistry: emptySkillRegistry(),
      scheduler: world.scheduler,
    });
    room.addItem(npc);
    return { room, player, npc, out };
  }

  it('`fight 好心人`：走真指令 → 开战 + 房间播报挑战宣言', () => {
    const { player, out } = labWithFoe();
    expect(dispatch(world.commands, player, 'fight 好心人')).toEqual({
      kind: 'executed',
      via: 'command',
      id: 'combat/fight',
    });
    expect(player.fightType).toBe(FIGHT_TYPE.FIGHT);
    expect(out.messages.some((m) => m.includes('领教了'))).toBe(true);
  });

  it('`kill 好心人`：走真指令 → 开战 + 房间播报开杀宣言', () => {
    const { player, out } = labWithFoe();
    expect(dispatch(world.commands, player, 'kill 好心人')).toEqual({
      kind: 'executed',
      via: 'command',
      id: 'combat/kill',
    });
    expect(player.fightType).toBe(FIGHT_TYPE.KILL);
    expect(out.messages.some((m) => m.includes('不是你死就是我活'))).toBe(true);
  });

  it('没给目标 ⇒ 同一句话「你要攻击谁？」（两条指令各自说一次）', () => {
    const { player, out } = labWithFoe();
    dispatch(world.commands, player, 'fight');
    dispatch(world.commands, player, 'kill');
    expect(out.messages).toEqual([FIGHT_MESSAGES.what, KILL_MESSAGES.what]);
  });

  it('找不到目标 ⇒ 也是「你要攻击谁？」', () => {
    const { player, out } = labWithFoe();
    dispatch(world.commands, player, 'fight 不存在的人');
    expect(out.messages).toEqual([FIGHT_MESSAGES.what]);
  });

  it('★ 切磋·自己带伤 ⇒ 被拦；击杀·带伤 ⇒ 照打（difference 在指令层也成立）', () => {
    const { player, out } = labWithFoe('阿飞', { hp: 50 });
    dispatch(world.commands, player, 'fight 好心人');
    expect(out.messages).toEqual([FIGHT_MESSAGES.refuse('self-wounded', '好心人')]);
    expect(player.fightType).toBe(FIGHT_TYPE.NONE);
    dispatch(world.commands, player, 'kill 好心人');
    expect(player.fightType).toBe(FIGHT_TYPE.KILL);
  });

  it('★ 禁武房间（真实内容 `yz/guangchang` 带 `no_fight`）：fight / kill 都被拒', () => {
    const room = world.room('yz/guangchang');
    if (room === undefined) throw new Error('测试用的房间不存在：yz/guangchang');
    const out = new RecordingOutput();
    const player = new Player({
      oid: world.oidSpace.next(),
      path: null,
      name: '阿飞',
      roleId: `r-${String((seq += 1))}`,
      scheduler: world.scheduler,
      output: out,
    });
    room.addItem(player);

    dispatch(world.commands, player, 'fight 店小二');
    dispatch(world.commands, player, 'kill 店小二');
    expect(out.messages).toEqual([FIGHT_MESSAGES.noFight, KILL_MESSAGES.noFight]);
    expect(player.fightType).toBe(FIGHT_TYPE.NONE);
  });
});

// ===========================================================================
// 六、combat/relive —— 复活（死亡之后唯一的出路）
// ===========================================================================

describe('combat/relive —— 复活', () => {
  let world: World;

  beforeEach(() => {
    world = instantiateWorld({ scheduler: new Scheduler({ now: makeClock().now }) });
  });

  /** 一个**真死过**的玩家（`die()` 走完整收尾，含 `die` 帧） */
  function makeDeadPlayer(): { player: Player; out: RecordingOutput } {
    const out = new RecordingOutput();
    const player = new Player({
      oid: world.oidSpace.next(),
      path: null,
      name: '亡者',
      roleId: `r-${String((seq += 1))}`,
      scheduler: world.scheduler,
      output: out,
    });
    labRoom().addItem(player);
    expect(player.die()).toBe(true);
    return { player, out };
  }

  it('死人 `relive`：走真指令 → 原地满血复活 + 推 revive 帧', () => {
    const { player, out } = makeDeadPlayer();
    expect(player.isAlive).toBe(false);
    expect(dispatch(world.commands, player, 'relive')).toEqual({
      kind: 'executed',
      via: 'command',
      id: 'combat/relive',
    });
    expect(player.isAlive).toBe(true);
    expect(player.hp).toBe(player.maxHp);
    expect(out.reviveCount).toBe(1);
  });

  it('活人 `relive`：只说"你还没死呢"，不复活（不推帧）', () => {
    const { player, out } = makeDeadPlayer();
    player.revive();
    out.clear();
    dispatch(world.commands, player, 'relive');
    expect(out.messages).toEqual([RELIVE_MESSAGES.alive]);
    expect(out.reviveCount).toBe(0);
  });

  it('★ `allow_die:true` 必需：死人跑得了 `relive`，却被普通指令的"灵魂状态"挡住', () => {
    const { player } = makeDeadPlayer();
    // 对照：普通指令（无 `allow_die`）在灵魂状态下被闸门拦下
    const blocked = dispatch(world.commands, player, 'fight 谁');
    expect(blocked).toEqual({
      kind: 'blocked',
      via: 'command',
      id: 'combat/fight',
      gate: 'die',
      message: COMMAND_MESSAGES.die,
    });
    // 而 `relive` 放行 —— 缺了 `allow_die:true`，唯一的出路会被闸门自己拦死
    expect(dispatch(world.commands, player, 'relive')).toMatchObject({
      kind: 'executed',
      id: 'combat/relive',
    });
    expect(player.isAlive).toBe(true);
  });
});

// ===========================================================================
// 七、死亡掉落（叉 3：不搞尸体 ⇒ 掉在房间地上）
// ===========================================================================

describe('rollDrops —— 掉落表 roll（wushen `create_by_odds` 口径）', () => {
  const zero = (): number => 0;
  const almostOne = (): number => 0.9999999;

  it('无 drops ⇒ 空', () => {
    expect(rollDrops(undefined, zero)).toEqual([]);
  });

  it('无 odds ⇒ 必掉（缺省 10000 万分比）', () => {
    expect(rollDrops([{ obj: 'drug/yao#0' }], almostOne)).toEqual([{ obj: 'drug/yao#0', count: 1 }]);
  });

  it('★ odds=0 ⇒ **必掉**（wushen `odds || 10000` 的反直觉行为，原样保留）', () => {
    expect(rollDrops([{ obj: 'drug/yao#0', odds: 0 }], almostOne)).toEqual([
      { obj: 'drug/yao#0', count: 1 },
    ]);
  });

  it('odds 是万分比：rand=0.4 命中 5000 ⇒ 掉；rand=0.6 ⇒ 不掉', () => {
    const d = [{ obj: 'drug/yao#0', odds: 5000 }];
    expect(rollDrops(d, () => 0.4)).toEqual([{ obj: 'drug/yao#0', count: 1 }]);
    expect(rollDrops(d, () => 0.6)).toEqual([]);
  });

  it('★ min/max 覆盖 count，闭区间均匀取（rand=0 ⇒ min，rand→1 ⇒ max）', () => {
    expect(rollDrops([{ obj: 'drug/yao#0', count: 5, min: 1, max: 3 }], zero)).toEqual([
      { obj: 'drug/yao#0', count: 1 },
    ]);
    expect(rollDrops([{ obj: 'drug/yao#0', min: 1, max: 3 }], () => 0.999)[0]?.count).toBe(3);
  });

  it('count=0 ⇒ 不掉（数量为 0 的条目被丢弃）', () => {
    expect(rollDrops([{ obj: 'drug/yao#0', count: 0 }], zero)).toEqual([]);
  });
});

describe('Npc 死亡掉落 —— 落点与不静默', () => {
  type DropSpec = { obj: string; min?: number; max?: number; odds?: number; count?: number };

  /** 造一个真 NPC：`drops` 由用例给，`spawnItem` 可给可不给 */
  function dropNpc(opts: {
    room: Room;
    drops?: readonly DropSpec[];
    spawnItem?: ((path: string, count: number) => Item) | undefined;
    rand?: () => number;
  }): Npc {
    const npc = new Npc({
      oid: nextOid(),
      path: WID('pub/xiaoer'),
      name: '财主',
      def: {
        name: '财主',
        desc: '一个身怀宝物的财主。',
        hp: 5,
        ...(opts.drops === undefined ? {} : { drops: opts.drops }),
      },
      skillRegistry: emptySkillRegistry(),
      rand: opts.rand ?? HALF,
      ...(opts.spawnItem === undefined ? {} : { spawnItem: opts.spawnItem }),
    });
    opts.room.addItem(npc);
    return npc;
  }

  it('★ 有 drops + 有铸造器 ⇒ 掉在**原来的房间**（不是尸体容器）', () => {
    const room = labRoom();
    const spawned: Array<{ path: string; count: number }> = [];
    const npc = dropNpc({
      room,
      drops: [{ obj: 'drug/yao#0', min: 1, max: 2 }],
      spawnItem: (path, count) => {
        spawned.push({ path, count });
        return new Item({ oid: nextOid(), path: WID(path), name: '丹药', count });
      },
    });
    expect(room.items).toContain(npc);

    expect(npc.die()).toBe(true);
    expect(npc.environment).toBeNull(); // 人没了（不搞尸体）
    expect(spawned).toEqual([{ path: 'drug/yao#0', count: 2 }]); // rand=0.5 ⇒ floor(0.5*2)+1 = 2
    const dropped = room.items.filter((o) => o instanceof Item);
    expect(dropped).toHaveLength(1);
    expect((dropped[0] as Item).count).toBe(2); // 捡得到
  });

  it('无 drops ⇒ 不掉任何东西（不无中生有）', () => {
    const room = labRoom();
    const npc = dropNpc({
      room,
      spawnItem: (path, count) => new Item({ oid: nextOid(), path: WID(path), name: '丹药', count }),
    });
    npc.die();
    expect(room.items.filter((o) => o instanceof Item)).toHaveLength(0);
  });

  it('★ 有 drops 却**没接铸造器** ⇒ 抛错（不静默吞掉掉落表）', () => {
    const room = labRoom();
    const npc = dropNpc({ room, drops: [{ obj: 'drug/yao#0' }] }); // 不给 spawnItem
    expect(() => npc.die()).toThrow(NpcError);
  });

  it('房间装不下 ⇒ 只掉得进的那些，不抛错、人照样消散', () => {
    // 容量 3：两件占位 + NPC = 满；NPC 死后腾出 1 格，而要掉 2 件 ⇒ 只进 1 件
    const room = labRoom(3);
    room.addItem(makeItem('占位一'));
    room.addItem(makeItem('占位二'));
    const spawned: Array<{ path: string; count: number }> = [];
    const npc = dropNpc({
      room,
      drops: [{ obj: 'drug/yao#0', min: 1, max: 2 }],
      spawnItem: (path, count) => {
        spawned.push({ path, count });
        return new Item({ oid: nextOid(), path: WID(path), name: '丹药', count });
      },
    });
    expect(room.isFull()).toBe(true);

    expect(npc.die()).toBe(true);
    expect(npc.environment).toBeNull();
    expect(spawned).toHaveLength(1); // 第 2 件放不下 ⇒ 被跳过（不抛错）
  });

  it('★ 真实世界：`instantiateWorld` 已把铸造器接进 NPC —— 击杀真店小二 ⇒ 真丹药落地上', () => {
    const clock = makeClock();
    const scheduler = new Scheduler({ now: clock.now });
    const world = instantiateWorld({ scheduler });
    const xiaoer = world.npcsOf('pub/xiaoer')[0];
    if (xiaoer === undefined) throw new Error('pub/xiaoer 不存在');
    const room = labRoom();
    xiaoer.moveTo(room); // 挪到能开打的房间（它的老家 `yz/guangchang` 是 no_fight）
    xiaoer.setHp(1); // 一击必杀（真打要十几拍）

    const { player } = makePlayer(scheduler, {
      name: '阿飞',
      rand: HALF,
      props: { prop: { attack: 9999 } }, // 攻击拉满 ⇒ 一击必中必杀
    });
    room.addItem(player);

    const yaoBefore = world.itemsOf('drug/yao#0').length;
    expect(player.beginFight(xiaoer, FIGHT_TYPE.KILL)).toEqual({ ok: true });
    stepOne(clock, scheduler);

    expect(xiaoer.isAlive).toBe(false);
    expect(xiaoer.environment).toBeNull(); // 消散（不搞尸体）
    expect(world.itemsOf('drug/yao#0').length).toBe(yaoBefore + 1); // 掉了一叠真丹药
    expect(room.items.some((o) => o.path === 'drug/yao#0')).toBe(true);
  });
});

// ===========================================================================
// M3 · 战斗节拍的异常边界（2026-10-17 审查）
// ===========================================================================
//
// ★ 原先 `#attackTick` 是**裸调**的：`#doAttack` → `takeDamage` → `#endAttack`
//   → `target.die()` → `afterDeath`（NPC 掉落 / 内容层 `on_die`）一旦抛错，
//   异常穿过 tick，续排**不会执行** ⇒ `#attackHandle` 已置空、再也不出招，
//   而 `#fightType` 仍是 KILL、客户端收不到 `combat:end` —— 一边停战、一边
//   永远卡在战斗中，且异常只进了调度器的 stderr，看不出是谁卡住了。

describe('★ M3 · `afterDeath` 抛错也不许让节拍永久停摆', () => {
  it('目标已死 ⇒ 战斗收干净（不是"永远卡在战斗中"）', () => {
    const clock = makeClock();
    const scheduler = new Scheduler({ now: clock.now });
    const room = labRoom();
    // ★ 有 `drops` 却**不给** `spawnItem` ⇒ `afterDeath` 会**刻意抛** `NpcError`
    //   （`npc.ts`：声明未实现就要大声抛）。这正是最容易撞上的真实场景。
    const npc = new Npc({
      oid: nextOid(),
      path: WID('pub/xiaoer'),
      name: '财主',
      def: { name: '财主', desc: '一个身怀宝物的财主。', hp: 5, drops: [{ obj: 'drug/yao#0' }] },
      skillRegistry: emptySkillRegistry(),
      scheduler,
      rand: ZERO,
    });
    room.addItem(npc);
    const { player } = makePlayer(scheduler, { rand: ZERO });
    room.addItem(player);

    expect(player.beginFight(npc, FIGHT_TYPE.KILL)).toEqual({ ok: true });
    expect(player.isFighting).toBe(true);

    stepOne(clock, scheduler); // 这一拍把 NPC 打死 ⇒ `afterDeath` 抛错

    // ★ 判据：抛错归抛错，**状态必须收干净**
    expect(npc.isAlive).toBe(false);
    expect(player.fightType).toBe(FIGHT_TYPE.NONE);
    expect(player.isFighting).toBe(false);
  });

  it('目标**还活着** ⇒ 照常续排（三拍后：人在、掉血、仍在战斗）', () => {
    const clock = makeClock();
    const scheduler = new Scheduler({ now: clock.now });
    const room = labRoom();
    // ★ R5（2026-10-17 审查）：原用例有个 `let calls = 0; … calls += 1; expect(calls).toBe(3)`
    //   —— 那**断言的是测试自己的 for 循环计数器**，与被测代码无关（恒真）。已删。
    //   真正要钉的是下面三条**行为**断言：三拍之后人在 / 掉血 / 仍在战斗。
    //   （原标题写"掉落失败不该中止"，但本用例根本没走抛错分支 —— 标题也已订正。）
    // ★ 为什么"血厚打不死"：让 `takeDamage` 之外的环节抛错很难造，这里退一步用
    //   "打不死"来钉住"**没抛错时行为完全不变**"（抛错分支由上面那条用例覆盖）。
    const npc = new Npc({
      oid: nextOid(),
      path: WID('pub/xiaoer'),
      name: '沙包',
      def: { name: '沙包', desc: '血很厚。', hp: 10_000 },
      skillRegistry: emptySkillRegistry(),
      scheduler,
      rand: ZERO,
    });
    room.addItem(npc);
    const { player } = makePlayer(scheduler, { rand: ZERO });
    room.addItem(player);

    player.beginFight(npc, FIGHT_TYPE.KILL);
    for (let i = 0; i < 3; i += 1) stepOne(clock, scheduler);

    // ★ 打了三拍还没死 ⇒ 战斗必须**还在继续**（节拍没停）
    expect(npc.isAlive).toBe(true);
    expect(player.isFighting).toBe(true);
    expect(npc.hp).toBeLessThan(10_000); // 反向锚点：确实打掉了血，不是"根本没出招"
  });
});

// ===========================================================================
// 七、气血状态播报的**主语**必须是被打者（2026-10-20 真机反馈）
// ===========================================================================
//
// ★★ 病型：`#doAttack` 里的播报一律写成 `this.sendRoom(msg, target)`，`this` 是
//    **攻击者**。攻击句（"你对准慕容用力挥出一拳"）与伤害句的主语确实是攻击者，
//    但**气血状态句**（"($N看起来可能有些累了。)"）说的是**被打的那个人** ——
//    主语与发送者错位 ⇒ `sendRoom` 把攻击者判成本人视角 ⇒ `$N` 渲染成"你"，
//    玩家屏幕上出现「**你**气喘嘘嘘」。真机 `fight 木人桩` 复现。
//
// ★ wushen 的写法（`world/extends/char/combat.js:146,155`）：
//   `target.send_combat(query_status_msg(target.hp, target.max_hp))` ——
//   状态句由**被打者**自己发出，谁的状态谁发。
//
// ★ 反向锚点（防"我什么都不做这条也绿"）：断言里**同时**要求
//   ① 攻击句主语是"你"（攻击者的自述没被改坏）② 状态句主语是"慕容"。
//   只写 ② 的话，一个把所有播报都改成第三人称的实现也能过。

describe('气血状态播报的主语 = 被打者（不是攻击者）', () => {
  it('阿飞打慕容：状态句说「慕容…」，攻击句仍说「你…」', () => {
    const clock = makeClock();
    const scheduler = new Scheduler({ now: clock.now });
    const room = labRoom();
    // ★ 两个都是真 `Player`：`sendRoom` 只给 `kind === 'player'` 的成员播报，
    //   用替身会绕过整条视角分支（那正是要测的东西）。
    const { player: attacker, out } = makePlayer(scheduler, { name: '阿飞', rand: ZERO });
    const { player: victim } = makePlayer(scheduler, { name: '慕容', rand: ZERO });
    room.addItem(attacker);
    room.addItem(victim);

    // 切磋要求双方满血 —— 未开打时天然满足
    expect(attacker.beginFight(victim, FIGHT_TYPE.FIGHT)).toEqual({ ok: true });
    out.messages.length = 0; // 只看出招这一拍的播报

    stepOne(clock, scheduler);

    const statusLine = out.messages.find((m) => m.startsWith('('));
    // 反向锚点 ②：状态句必须落在被打者身上
    expect(statusLine).toBeDefined();
    expect(statusLine?.startsWith('(慕容')).toBe(true);
    // 反向锚点 ①：攻击句仍是攻击者的自述 —— 证明这不是"全改第三人称"换来的绿
    expect(out.messages.some((m) => m.includes('你') && !m.startsWith('('))).toBe(true);
    // ⚠️ 不要顺手写"状态句里不许出现『(你』"：战斗是**双向**的，慕容同一拍也会
    //   还手，于是阿飞自己也有一句「(你气喘嘘嘘」—— 那是**对的**（他真在挨打）。
    //   那样一条断言会在正确的实现上红，逼着人把它删掉，反而是噪音。
  });

  it('反向：慕容打阿飞时，阿飞收到的状态句说「你…」（本人视角没坏）', () => {
    const clock = makeClock();
    const scheduler = new Scheduler({ now: clock.now });
    const room = labRoom();
    const { player: victim, out } = makePlayer(scheduler, { name: '阿飞', rand: ZERO });
    const { player: attacker } = makePlayer(scheduler, { name: '慕容', rand: ZERO });
    room.addItem(attacker);
    room.addItem(victim);

    expect(attacker.beginFight(victim, FIGHT_TYPE.FIGHT)).toEqual({ ok: true });
    out.messages.length = 0;

    stepOne(clock, scheduler);

    const statusLine = out.messages.find((m) => m.startsWith('('));
    expect(statusLine?.startsWith('(你')).toBe(true);
  });
});

// ===========================================================================
// 六、脱战：Character.escape + combat/flee（wushen `do_escape`）
// ===========================================================================

describe('Character.escape —— 脱战判定（wushen `chara_move.js:105`）', () => {
  function scene(rand: () => number, props?: RawPropMap) {
    const clock = makeClock();
    const scheduler = new Scheduler({ now: clock.now });
    const room = labRoom();
    const a = makePlayer(scheduler, { name: '阿飞', rand, props });
    const b = makePlayer(scheduler, { name: '对手', rand });
    room.addItem(a.player);
    room.addItem(b.player);
    return { clock, room, a: a.player, b: b.player };
  }

  it('本来就没在战斗 ⇒ not-fighting（wushen `escape.js:6`）', () => {
    const s = scene(ZERO);
    expect(s.a.escape()).toEqual({ ok: false, reason: 'not-fighting' });
  });

  it('躲闪不占优 + 最小随机 ⇒ 被缠住，并进入忙乱', () => {
    const s = scene(ZERO);
    expect(s.a.beginFight(s.b, FIGHT_TYPE.KILL)).toEqual({ ok: true });
    expect(s.a.escape()).toEqual({ ok: false, reason: 'blocked' });
    // ★ 忙乱是"连点逃跑"不会变成"多点几次必成"的唯一原因
    expect(s.a.isBusy(s.clock.now())).toBe(true);
    expect(s.a.isFighting).toBe(true);
  });

  it('躲闪够高 ⇒ 停战 + 给出撤退方向', () => {
    const s = scene(ZERO, { prop: { evasion: 999 } });
    const other = labRoom();
    s.room.linkExit('north', other);
    expect(s.a.beginFight(s.b, FIGHT_TYPE.KILL)).toEqual({ ok: true });
    expect(s.a.escape()).toEqual({ ok: true, dir: 'north' });
    expect(s.a.isFighting).toBe(false);
  });

  it('停战成功但本房间无出口 ⇒ dir=null（能脱战，没地方跑）', () => {
    const s = scene(ZERO, { prop: { evasion: 999 } });
    expect(s.a.beginFight(s.b, FIGHT_TYPE.KILL)).toEqual({ ok: true });
    expect(s.a.escape()).toEqual({ ok: true, dir: null });
    expect(s.a.isFighting).toBe(false);
  });
});

describe('combat/flee —— 指令层（撤退一步到位）', () => {
  let world: World;

  beforeEach(() => {
    world = instantiateWorld({ scheduler: new Scheduler({ now: makeClock().now }) });
  });

  function stage(props?: RawPropMap) {
    const room = labRoom();
    const out = new RecordingOutput();
    const player = new Player({
      oid: world.oidSpace.next(),
      path: null,
      name: '阿飞',
      roleId: `r-${String((seq += 1))}`,
      props,
      scheduler: world.scheduler,
      rand: ZERO, // ★ 脱战是概率判定：不给确定随机源，"逃失败"那条会偶发变绿
      output: out,
    });
    room.addItem(player);
    const npc = new Npc({
      oid: world.oidSpace.next(),
      path: WID('pub/xiaoer'),
      name: '好心人',
      def: { name: '好心人', desc: '一个和善的人。' },
      skillRegistry: emptySkillRegistry(),
      scheduler: world.scheduler,
    });
    room.addItem(npc);
    return { room, player, npc, out };
  }

  it('没在战斗 ⇒ 同一句「你现在没有在战斗」', () => {
    const s = stage();
    expect(dispatch(world.commands, s.player, 'flee')).toEqual({
      kind: 'executed',
      via: 'command',
      id: 'combat/flee',
    });
    expect(s.out.messages).toEqual([FLEE_MESSAGES.notFighting]);
  });

  it('战斗中逃成功 ⇒ 停战 + 自动退到相邻房间', () => {
    const s = stage({ prop: { evasion: 999 } });
    const other = labRoom();
    s.room.linkExit('north', other);
    expect(s.player.beginFight(s.npc, FIGHT_TYPE.KILL)).toEqual({ ok: true });

    dispatch(world.commands, s.player, 'flee');

    expect(s.player.isFighting).toBe(false);
    // ★ 不写 `environment === other`：移动的**结果**是"东西到了那间房"，
    //   用房间的物品表断言，才不会把"字段名改了"当成 bug。
    expect(other.items).toContain(s.player);
    expect(s.out.messages).toContain(FLEE_MESSAGES.free);
  });

  it('战斗中逃失败 ⇒ 被缠住，仍在战斗', () => {
    const s = stage();
    expect(s.player.beginFight(s.npc, FIGHT_TYPE.KILL)).toEqual({ ok: true });
    dispatch(world.commands, s.player, 'flee');
    expect(s.player.isFighting).toBe(true);
    expect(s.out.messages).toContain(FLEE_MESSAGES.blocked);
  });
});

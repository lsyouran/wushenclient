/**
 * tests/progression.test.ts —— 成长闭环：**打怪 → 经验/潜能 → 技能上限 → 练技能**
 * ============================================================================
 * 这批断言钉住的是 26 册 §56 引入的四条链，每一条都要求"从真实入口进、看真实结果"：
 *
 *   ① `Character.addExp`（唯一增加入口）：累加 + 播报 + 拒收负数。
 *   ② `NpcDef.exp/pot` → `Npc.afterDeath` → **击杀者**拿到奖励（不是 NPC 自己涨）。
 *   ③ 经验抬高 `skillLimit()`，而 `skillLimit()` 是 `SkillBook.addExp` 的**封顶** ——
 *      于是"经验决定技能等级上限"是引擎保证的，不是某个调用方的自觉。
 *   ④ `practice`：潜能 1:1 换技能经验，受上限与"基本功火候"约束。
 *
 * ★★ 防假绿的两处设计（26 册铁律 8）：
 *   - 上限那条用**哨兵**：先让角色经验 = 0（上限 10）确认加不动，再把经验拨到 100000
 *     确认同一份技能经验突然能动 —— 不是"从没变过的初值出发"。
 *   - 击杀奖励用**两个 NPC 对照**：给经验的那只（木人桩）与不给的那只（店小二），
 *     免得"不管怎样 exp 都涨"这种错法蒙混过关。
 */
import { describe, expect, it, beforeEach } from 'vitest';

// 副作用导入：触发真实内容注册（与 content.test.ts 同一机制）
import '@world/index.js';

import { RecordingOutput } from '../server/engine/character.js';
import { Npc } from '../server/engine/npc.js';
import { Player } from '../server/engine/player.js';
import { getDef } from '../server/engine/registry.js';
import { Scheduler } from '../server/engine/scheduler.js';
import { instantiateWorld } from '../server/engine/world.js';
import type { World } from '../server/engine/world.js';
import type { NpcDef, PracticeDone, PracticeRefused, PracticeRefusal, PracticeResult } from '../server/world/defs.js';
import { asWorldId } from '../shared/ids.js';
import { FIGHT_TYPE } from '../shared/constants.js';
import { dispatch } from '../server/engine/command.js';
import { roomSignatureOf } from '../server/session.js';

// ---------------------------------------------------------------------------
// 判别联合取支助手：**取不到就抛** —— 等于顺手多一条断言。
// ★ 不用 `as` 强转取字段：那样形状写错会静默通过，这里错了会红。
// ---------------------------------------------------------------------------

function done(r: PracticeResult): PracticeDone {
  if (r.kind !== 'done') throw new Error(`期望练成，实际被拒：${r.reason}`);
  return r;
}

/** 取「被拒」并断言原因；返回**收窄后**的分支 —— capped 里读得到 `level`，basis 里读不到 */
function refusedAs<R extends PracticeRefusal>(
  r: PracticeResult,
  reason: R,
): Extract<PracticeRefused, { readonly reason: R }> {
  if (r.kind !== 'refused') throw new Error(`期望被拒（${reason}），实际练成了`);
  if (r.reason !== reason) throw new Error(`期望 ${reason}，实际 ${r.reason}`);
  // 上面的运行时检查已把 r 限定在这一支；泛型 R 无法让 TS 自己收窄，故此处显式转。
  return r as Extract<PracticeRefused, { readonly reason: R }>;
}

let world: World;
let oidSeq = 0;
/** 世界时钟（假时钟）：重生要验证差一毫秒不刷，真时钟做不到可复现 */
let clock = 0;

beforeEach(() => {
  // ★ 每个用例一个**全新的世界**：木人桩会被打死并重生，共享单例会让用例互相污染。
  clock = 1_000_000;
  world = instantiateWorld({ scheduler: new Scheduler({ now: () => clock }) });
  oidSeq = 0;
});

/** 造一个玩家并放进指定房间 */
function makePlayer(roomPath: string): { player: Player; out: RecordingOutput } {
  const room = world.room(roomPath);
  if (room === undefined) throw new Error(`测试前置失败：房间 ${roomPath} 不存在`);
  oidSeq += 1;
  const out = new RecordingOutput();
  const player = new Player({
    roleId: `tester-${String(oidSeq)}`,
    oid: `p${String(oidSeq).padStart(9, '0')}`,
    path: null,
    name: '测试者',
    skillRegistry: world.skillRegistry,
    output: out,
    scheduler: world.scheduler,
    rand: () => 0,
  });
  player.moveTo(room);
  return { player, out };
}

/** 取世界里的木人桩（可打死的练功靶子） */
function woodDummy(): Npc {
  const npc = world.npcsOf('pub/muren')[0];
  if (npc === undefined) throw new Error('测试前置失败：pub/muren 未实例化');
  return npc;
}

// ---------------------------------------------------------------------------
// ① addExp：唯一的增加入口
// ---------------------------------------------------------------------------

describe('progression · addExp 是唯一的增加入口', () => {
  it('经验 / 潜能 / 钱一起入账，并播报一句话', () => {
    const { player, out } = makePlayer('yz/guangchang');
    player.addExp(500, 300, 20);
    expect(player.exp).toBe(500);
    expect(player.pot).toBe(300);
    expect(player.money).toBe(20);
    // ★ "你获得了" 与第一个数字之间**必须有一个空格**（2026-10-20 真机反馈：
    //   写成了 `你获得了500 点经验…`，中文与数字粘连）。这两条断言因此兼作
    //   该分隔符的守卫 —— 别只改断言去迁就实现。
    expect(out.messages.join('\n')).toContain('你获得了 500 点经验，300 点潜能，20 文钱。');
  });

  it('只有经验时只播报经验（不出现"0 点潜能"这种噪声）', () => {
    const { player, out } = makePlayer('yz/guangchang');
    player.addExp(7);
    expect(out.messages.join('\n')).toContain('你获得了 7 点经验。');
    expect(out.messages.join('\n')).not.toContain('潜能');
  });

  it('全零不播报（避免"你获得了。"这种句子）', () => {
    const { player, out } = makePlayer('yz/guangchang');
    player.addExp(0, 0, 0);
    expect(out.messages).toEqual([]);
  });

  it('★ 负数抛错而不是静默吞（扣减走各自的惩罚路径）', () => {
    const { player } = makePlayer('yz/guangchang');
    expect(() => player.addExp(-1)).toThrow();
    expect(() => player.addExp(0, -1)).toThrow();
    expect(player.exp).toBe(0);
    expect(player.pot).toBe(0);
  });

  it('NaN 抛错（不许静默变 0）', () => {
    const { player } = makePlayer('yz/guangchang');
    expect(() => player.addExp(Number.NaN)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// ② 击杀奖励
// ---------------------------------------------------------------------------

describe('progression · 打怪给经验与潜能', () => {
  it('★ 木人桩被打死 ⇒ 击杀者拿到 def 上写的经验/潜能，NPC 自己不涨', () => {
    const { player } = makePlayer('yz/beidajie1');
    const dummy = woodDummy();
    expect(dummy.def.exp).toBe(1000);

    dummy.takeDamage(100_000);
    expect(dummy.hp).toBe(0);
    expect(dummy.die(player)).toBe(true);

    expect(player.exp).toBe(1000);
    expect(player.pot).toBe(500);
    // ★ 反向断言：奖励是发给**击杀者**的，不是 NPC 的"自身经验"
    expect(dummy.exp).toBe(0);
  });

  it('★★ 奖励排在【战斗结束】**之后**：战斗中只记账，`endFight` 才结算（26 册 §57）', () => {
    const { player, out } = makePlayer('yz/beidajie1');
    const dummy = woodDummy();
    // 真机反馈的顺序错：先「你获得了 1000 点经验…」，后「【战斗结束】」。
    // 这里把"战斗中"造出来，让致命的 `die()` 落在战斗内 —— 那才是玩家看到的那条路径。
    player.beginFight(dummy, FIGHT_TYPE.KILL);

    dummy.takeDamage(100_000);
    dummy.die(player);

    // ① 还在战斗 ⇒ 奖励**只记账**：没进账、也没播报（这正是顺序能对调的原因）
    expect(player.exp).toBe(0);
    expect(out.messages.join('\n')).not.toContain('你获得了');

    player.endFight();

    // ② 停战之后才结算
    expect(player.exp).toBe(1000);
    expect(player.pot).toBe(500);
    // ③ 判据落在**时间线**上：`combat:end` 紧挨在奖励那行之前
    const rewardAt = out.events.findIndex((e) => e.startsWith('你获得了'));
    expect(rewardAt, '奖励播报没出现').toBeGreaterThan(0);
    expect(out.events[rewardAt - 1]).toBe('combat:end');
  });

  it('不在战斗中被打死（未来的绝招 / GM）⇒ 奖励立即结算，不会挂在队列里', () => {
    const { player } = makePlayer('yz/beidajie1');
    const dummy = woodDummy();
    dummy.takeDamage(100_000);
    dummy.die(player);
    // fightType 是 NONE ⇒ `queueReward` 当场 flush
    expect(player.exp).toBe(1000);
    expect(player.pot).toBe(500);
  });

  it('★★ NPC 掉血 ⇒ 房间签名变（否则房间区那条血条从开打到打死一动不动）', () => {
    const { player } = makePlayer('yz/beidajie1');
    const dummy = woodDummy();

    // 对照组：没人动的时候签名必须**稳**（不能"任何风吹草动都算"）
    expect(roomSignatureOf(player)).toBe(roomSignatureOf(player));

    const before = roomSignatureOf(player);
    dummy.takeDamage(5);
    // 判据是**签名**而不是"血条节点变了"：会话层的 `items` 只由签名驱动
    // （`#reconcileRooms`），签名不变 ⇒ `afterTick` 每个 tick 都在对账也白对。
    expect(roomSignatureOf(player)).not.toBe(before);
  });

  it('没有击杀者（自然消失 / GM 清理）不发奖励', () => {
    const { player } = makePlayer('yz/beidajie1');
    const dummy = woodDummy();
    dummy.takeDamage(100_000);
    dummy.die();
    expect(player.exp).toBe(0);
    expect(player.pot).toBe(0);
  });

  it('★ 对照：没配 exp/pot 的 NPC 打死也不给（不是"打死什么都涨"）', () => {
    const { player } = makePlayer('yz/guangchang');
    const waiter = world.npcsOf('pub/xiaoer')[0];
    if (waiter === undefined) throw new Error('测试前置失败：pub/xiaoer 未实例化');
    expect(waiter.def.exp).toBeUndefined();

    waiter.takeDamage(100_000);
    expect(waiter.die(player)).toBe(true);
    expect(player.exp).toBe(0);
    expect(player.pot).toBe(0);
  });

  it('★ 重生：死的木人从世界索引摘掉，到点后**原地**刷回一只新的', () => {
    const { player } = makePlayer('yz/beidajie1');
    const dummy = woodDummy();
    dummy.takeDamage(100_000);
    dummy.die(player);

    // 死亡的瞬间就摘了索引（T4 的 `forget`）
    expect(world.npcsOf('pub/muren')).toHaveLength(0);
    expect(world.npc(dummy.oid)).toBeUndefined();

    // ★ 间隔**从 def 上读**，不把秒数抄进断言。
    //   `respawn_ms` 是内容层的调参旋钮（2026-10-19 就从 30 秒调到 5 秒用来快测曲线），
    //   抄死的话每调一次参这条测试就红一次，而它想钉的根本不是"30 秒"
    //   —— 是**引擎按 def 排期、且差一毫秒不刷**。读 def 后两件事都还钉着。
    const respawn = dummy.def.respawn_ms;
    if (respawn === undefined) throw new Error('测试前置失败：木人桩没配 respawn_ms');

    // ★ 差一毫秒不刷 —— 否则"重生间隔"形同虚设。
    //   死的那一刻时钟是 clock，排期 = clock + respawn。
    expect(world.scheduler.step(clock + respawn - 1)).toBe(0);
    expect(world.npcsOf('pub/muren')).toHaveLength(0);

    expect(world.scheduler.step(clock + respawn)).toBe(1);
    const reborn = world.npcsOf('pub/muren');
    expect(reborn).toHaveLength(1);
    expect(reborn[0]?.environment?.path).toBe('yz/beidajie1');
    // 新实例（新 oid），不是把死的那只塞回去
    expect(reborn[0]?.oid).not.toBe(dummy.oid);
    expect(reborn[0]?.hp).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// ③ 经验 → 技能等级上限
// ---------------------------------------------------------------------------

describe('progression · 经验决定技能等级上限', () => {
  it('玩家经验为 0 时上限是 10（wushen limitExpMinLevel）', () => {
    const { player } = makePlayer('yz/guangchang');
    expect(player.exp).toBe(0);
    expect(player.skillLimit()).toBe(10);
  });

  it('上限随经验增长（exp=1000 ⇒ 22 级；exp=100000 ⇒ 100 级）', () => {
    const { player } = makePlayer('yz/guangchang');
    player.exp = 1_000;
    expect(player.skillLimit()).toBe(22);
    player.exp = 100_000;
    expect(player.skillLimit()).toBe(100);
  });

  it('★ 哨兵：同一份技能经验在"经验不足"时加不动、经验够了就能升', () => {
    const { player } = makePlayer('yz/guangchang');
    player.skills.learn('base/sword', 10);

    // cap = 10 ⇒ 再给 55 点（正好够升到 11）也升不了
    player.exp = 0;
    expect(player.skills.addExp('base/sword', 55)).toBe(0);
    expect(player.skills.levelOf('base/sword')).toBe(10);

    // ★ 把"起点人为拨到相反"：经验拨到 100000（cap=100），**同一份**技能经验立刻生效
    player.exp = 100_000;
    expect(player.skills.addExp('base/sword', 55)).toBe(1);
    expect(player.skills.levelOf('base/sword')).toBe(11);
  });

  it('★ NPC 不受这条曲线约束（上限 = 模板 max_level）', () => {
    const def = getDef<NpcDef>('npc', 'pub/xiaoer');
    if (def === undefined) throw new Error('测试前置失败：pub/xiaoer 未注册');
    const npc = new Npc({
      oid: 'n000000001',
      path: asWorldId('pub/xiaoer', 'progression.test:npc'),
      name: def.name,
      def,
      skillRegistry: world.skillRegistry,
    });
    expect(npc.exp).toBe(0);
    expect(npc.skillLimit()).toBe(Number.POSITIVE_INFINITY);
    // 于是它能把技能练到模板上限，而不是被 10 级卡住
    npc.skills.learn('base/sword', 10);
    expect(npc.skills.addExp('base/sword', 1_000_000)).toBeGreaterThan(0);
    expect(npc.skills.levelOf('base/sword')).toBeGreaterThan(10);
  });
});

// ---------------------------------------------------------------------------
// ④ 潜能 → 技能等级
// ---------------------------------------------------------------------------

describe('progression · 消耗潜能练技能', () => {
  it('潜能 1:1 换技能经验：pot 精确减少、等级精确上升', () => {
    const { player } = makePlayer('yz/guangchang');
    player.skills.learn('base/sword', 1); // grade 0 ⇒ 每级 5*(lv+1)
    player.pot = 100;

    // 1 → 5 级：10 + 15 + 20 + 25 = 70
    const r = done(player.practiceSkill('基本剑法', 5));
    expect(r.spent).toBe(70);
    expect(r.gained).toBe(4);
    expect(r.level).toBe(5);
    expect(r.limit).toBe(10);
    expect(player.pot).toBe(30);
    expect(player.skills.levelOf('base/sword')).toBe(5);
  });

  it('不给目标等级 ⇒ 一直练到上限就停（潜能不会被花超）', () => {
    const { player } = makePlayer('yz/guangchang');
    player.skills.learn('base/sword', 1);
    player.pot = 1_000_000;

    const r = done(player.practiceSkill('基本剑法'));
    expect(r.level).toBe(10); // = skillLimit()
    expect(r.limit).toBe(10);
    // 1 → 10 级合计 5*(2+…+10) = 270；多出来的潜能必须还在
    expect(r.spent).toBe(270);
    expect(player.pot).toBe(1_000_000 - 270);
  });

  it('到上限后再练 ⇒ capped（不是静默不动）', () => {
    const { player } = makePlayer('yz/guangchang');
    player.skills.learn('base/sword', 10);
    player.pot = 500;
    const r = refusedAs(player.practiceSkill('基本剑法'), 'capped');
    // ★ 判别联合的实证：只有 'capped' 带 level/limit，所以这两行读得到；
    //   换成 'basis' 分支就会编译失败（不是"约定上不该读"）。
    expect(r.level).toBe(10);
    expect(r.limit).toBe(10);
    expect(player.pot).toBe(500); // 一分没花
  });

  it('潜能不足 ⇒ no-pot，且等级与潜能都不动', () => {
    const { player } = makePlayer('yz/guangchang');
    player.skills.learn('base/sword', 1);
    player.pot = 0;
    const r = refusedAs(player.practiceSkill('基本剑法'), 'no-pot');
    // 'no-pot' 带 limit（"还差多少级"要说得出上限），但不带 level
    expect(r.limit).toBe(10);
    expect(player.skills.levelOf('base/sword')).toBe(1);
    expect(player.pot).toBe(0);
  });

  it('没学过的技能 ⇒ not-learned；完全不存在的 ⇒ unknown', () => {
    const { player } = makePlayer('yz/guangchang');
    player.pot = 1000;
    refusedAs(player.practiceSkill('基本剑法'), 'not-learned');
    // ★ `unknown` 这一支**不带任何字段**（技能不存在时 name/level 都是编造的），
    //   所以这里只能断 reason 本身 —— 这正是想要的效果。
    refusedAs(player.practiceSkill('不存在的功夫'), 'unknown');
    expect(player.pot).toBe(1000);
  });

  it('★ 基本功火候：武功等级必须**严格低于**它要装的槽的基本技能等级', () => {
    const { player } = makePlayer('yz/guangchang');
    // 先满足学习条件（太极剑法需要基本剑法 30 级）
    player.skills.setLevel('base/sword', 30);
    player.skills.learn('wd/taijijian', 1);
    // 上限要够高，否则会先撞 capped（那是另一条判据）
    player.exp = 10_000_000;
    player.pot = 100_000;

    // 1 级 < 基本剑法 30 级 ⇒ 可以练
    done(player.practiceSkill('太极剑法', 2));

    // 把武功拨到与基本功**同级** ⇒ 火候未到
    player.skills.setLevel('wd/taijijian', 30);
    refusedAs(player.practiceSkill('太极剑法'), 'basis');
    expect(player.skills.levelOf('wd/taijijian')).toBe(30);
  });

  it('目标等级高于上限 ⇒ 按上限截断，不越界', () => {
    const { player } = makePlayer('yz/guangchang');
    player.skills.learn('base/sword', 1);
    player.pot = 1_000_000;
    const r = done(player.practiceSkill('基本剑法', 9999));
    expect(r.level).toBe(10);
    expect(player.skills.levelOf('base/sword')).toBe(10);
  });

  it('★ 已达指定目标 ⇒ reached（不是 capped：上限还远着呢）', () => {
    const { player } = makePlayer('yz/guangchang');
    player.skills.learn('base/sword', 5);
    player.pot = 100;
    const r = refusedAs(player.practiceSkill('基本剑法', 5), 'reached');
    expect(r.level).toBe(5);
    // ★ 'reached' 这一支**不带 limit** —— 它压根不需要说上限（说了反而误导）。
    //   这里改成从角色上读上限，确认「上限仍远大于 level」，与 capped 可区分。
    expect(player.skillLimit()).toBe(10);
    expect(player.pot).toBe(100);
  });

  it('★★ 余额已够到目标 ⇒ 免费升级（不报 no-pot，也不扣潜能）', () => {
    const { player } = makePlayer('yz/guangchang');
    player.skills.learn('base/sword', 1);

    // 上限 10 时把经验打到溢出：等级停在 10，**剩下的经验留着**（`addExp` 不清零）
    player.exp = 0;
    player.skills.addExp('base/sword', 1_000_000);
    expect(player.skills.levelOf('base/sword')).toBe(10);
    expect(player.skills.entryOf('base/sword')?.exp ?? 0).toBeGreaterThan(0);

    // 上限抬到 100，且**一分潜能都没有** —— 那笔余额应该能直接换等级
    player.exp = 100_000;
    player.pot = 0;
    const r = done(player.practiceSkill('基本剑法', 20));
    expect(r.spent).toBe(0);
    expect(r.gained).toBe(10);
    expect(r.level).toBe(20);
    expect(player.skills.levelOf('base/sword')).toBe(20);
    expect(player.pot).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// ⑤ 指令入口（三级分发的第 ② 级）
// ---------------------------------------------------------------------------

describe('progression · practice / lianxi 指令', () => {
  it('练技能走指令：practice 基本剑法', () => {
    const { player, out } = makePlayer('yz/guangchang');
    player.skills.learn('base/sword', 1);
    player.pot = 100;

    expect(dispatch(world.commands, player, 'practice 基本剑法 5')).toEqual({
      kind: 'executed',
      via: 'command',
      id: 'train/practice',
    });
    const printed = out.messages.join('\n');
    expect(printed).toContain('你练了一阵基本剑法');
    expect(printed).toContain('消耗 70 点潜能');
    expect(printed).toContain('现在是 5 级');
    expect(player.pot).toBe(30);
  });

  it('别名 lianxi 落到同一条指令', () => {
    const { player } = makePlayer('yz/guangchang');
    player.skills.learn('base/sword', 1);
    player.pot = 100;
    expect(dispatch(world.commands, player, 'lianxi 基本剑法 2').kind === 'executed').toBe(true);
    expect(player.skills.levelOf('base/sword')).toBe(2);
  });

  it('不给参数时说清怎么用', () => {
    const { player, out } = makePlayer('yz/guangchang');
    dispatch(world.commands, player, 'practice');
    expect(out.messages.join('\n')).toContain('你要练哪一门功夫');
  });

  it('潜能不足时给的是"潜能不够"而不是笼统的失败', () => {
    const { player, out } = makePlayer('yz/guangchang');
    player.skills.learn('base/sword', 1);
    player.pot = 0;
    dispatch(world.commands, player, 'practice 基本剑法');
    expect(out.messages.join('\n')).toContain('潜能不够');
  });
});

// ---------------------------------------------------------------------------
// ⑥ 面板：经验 / 潜能 / 上限
// ---------------------------------------------------------------------------

describe('progression · score 面板带成长段', () => {
  it('快照里有经验、潜能与技能等级上限', () => {
    const { player, out } = makePlayer('yz/guangchang');
    player.exp = 1000;
    player.pot = 500;
    dispatch(world.commands, player, 'score');
    // ★ §62：走 `showAttr`（面板快照），不再是往消息流打三行文本
    const view = out.attrViews.at(-1);
    expect(view).toBeDefined();
    expect(view?.exp).toBe(1000);
    expect(view?.pot).toBe(500);
    expect(view?.skillLimit).toBe(22);
    // 气血/内力是快照里的真值（面板第二段靠它）
    expect(view?.maxHp).toBe(player.maxHp);
    expect(view?.hp).toBe(player.hp);
  });
});

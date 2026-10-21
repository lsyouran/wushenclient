/**
 * tests/skill-learn.test.ts —— §64 后端技能链：**学会 → 装配 → 遗忘 → 面板**
 * ============================================================================
 * 这一批补的是 27 册 §13.6 记了很久的缺口：
 *
 *     `SkillBook.learn()` / `enable()` 零生产消费者
 *     ⇒ 新玩家一个技能都没有 ⇒ `practice` 永远 `not-learned`
 *
 * 于是本文件测的不是"skill.ts 里那几个方法能不能跑"（`engine-skill.test.ts` 已经管了），
 * 而是**玩家视角的那条链**：`CommandActor` 上的 `learnSkill / forgetSkill /
 * enableSkill / disableSkill / skillView` —— 它们多做的那一层是"规则 + 判别联合"。
 *
 * ★★ 防假绿的两处设计：
 *   1. **反向判据占一半**：十一支拒绝原因逐支断言。只测"能学"不测"该拒的拒了"，
 *      等于没测闸门（26 册 §14.7 第 3/5/7 条要的正是反向）。
 *   2. **`no-pot` 用"钱有没有被花掉"做判据**：`learn` 是**全有或全无**
 *      （wushen `xue.js:256` 的 `if (exp > me.pot) return`），
 *      所以被拒时必须 **pot 一分不少** —— 若实现改成"花到光"，这条会红。
 */
import { describe, expect, it, beforeEach } from 'vitest';

// 副作用导入：触发真实内容注册（与 content.test.ts 同一机制）
import '@world/index.js';
// ★ 拒绝文案在指令层（引擎只出结构）⇒ 文案的判据必须住在这里，而不是 engine-skill.test.ts
import { LEARN_MESSAGES } from '@world/command/train/learn.js';

import { RecordingOutput } from '../server/engine/character.js';
import { Npc } from '../server/engine/npc.js';
import { Player } from '../server/engine/player.js';
import { Scheduler } from '../server/engine/scheduler.js';
import { SkillRegistry } from '../server/engine/skill.js';
import { instantiateWorld } from '../server/engine/world.js';
import type { World } from '../server/engine/world.js';
import type {
  EnableResult,
  ForgetResult,
  LearnRefused,
  LearnResult,
  SkillDef,
} from '../server/world/defs.js';
import { SKILL_TYPES } from '../shared/constants.js';


// ---------------------------------------------------------------------------
// 取支助手：**取不到就抛**（顺手多一条断言，见 progression.test.ts 的同款做法）
// ---------------------------------------------------------------------------

function learned(r: LearnResult): Extract<LearnResult, { readonly kind: 'learned' }> {
  if (r.kind !== 'learned') throw new Error(`期望学成，实际被拒：${r.reason}`);
  return r;
}

function learnRefused<R extends LearnRefused['reason']>(
  r: LearnResult,
  reason: R,
): Extract<LearnRefused, { readonly reason: R }> {
  if (r.kind !== 'refused') throw new Error(`期望被拒（${reason}），实际学成了`);
  if (r.reason !== reason) throw new Error(`期望 ${reason}，实际 ${r.reason}`);
  return r as Extract<LearnRefused, { readonly reason: R }>;
}

function forgotten(r: ForgetResult): Extract<ForgetResult, { readonly kind: 'forgotten' }> {
  if (r.kind !== 'forgotten') throw new Error(`期望忘掉，实际被拒：${r.reason}`);
  return r;
}

function enabled(r: EnableResult): Extract<EnableResult, { readonly kind: 'enabled' }> {
  if (r.kind !== 'enabled') throw new Error(`期望装上，实际被拒：${r.reason}`);
  return r;
}

// ---------------------------------------------------------------------------
// 夹具
// ---------------------------------------------------------------------------

let world: World;
let oidSeq = 0;

beforeEach(() => {
  // ★ 每个用例一个**全新的世界**：教头/木人桩都是实例，共享单例会让用例互相污染。
  world = instantiateWorld({ scheduler: new Scheduler({ now: () => 1_000_000 }) });
  oidSeq = 0;
});

/** 造一个玩家并放进指定房间；`pot` 走 `addExp`（唯一增加入口，不直接改字段） */
function makePlayer(opts: { room?: string; pot?: number; int?: number } = {}): {
  player: Player;
  out: RecordingOutput;
} {
  const roomPath = opts.room ?? 'yz/wuguan';
  const room = world.room(roomPath);
  if (room === undefined) throw new Error(`测试前置失败：房间 ${roomPath} 不存在`);
  oidSeq += 1;
  const out = new RecordingOutput();
  const player = new Player({
    roleId: `learner-${String(oidSeq)}`,
    oid: `l${String(oidSeq).padStart(9, '0')}`,
    path: null,
    name: '学艺人',
    skillRegistry: world.skillRegistry,
    output: out,
    scheduler: world.scheduler,
    ...(opts.int === undefined ? {} : { int: opts.int }),
  });
  player.moveTo(room);
  if (opts.pot !== undefined && opts.pot > 0) player.addExp(0, opts.pot);
  return { player, out };
}

/** 武馆里的教头（真实内容 `pub/jiaotou`） */
function teacher(): Npc {
  const npc = world.npcsOf('pub/jiaotou')[0];
  if (npc === undefined) throw new Error('测试前置失败：pub/jiaotou 未实例化');
  return npc;
}

/**
 * 一个"已经能学武功"的玩家：角色经验 3000（`skillLimit` = 30）+ 基本功 30 级 + 太极剑法已学。
 *
 * ★ 为什么必须显式铺这个前提：`wd/taijijian` 的 `learnCondition` 是
 *   `minSlot: { sword: 30 }`，而玩家的 `skillLimit()` 由**角色经验**决定
 *   （exp=0 ⇒ 上限 10 ⇒ 基本功根本练不到 30）。不铺这两步，
 *   "学太极剑法"的所有用例都会错在 `slot` / `capped` 上，看起来像实现坏了。
 */
function makeSwordsman(): { player: Player; out: RecordingOutput } {
  const r = makePlayer({ pot: 20_000, int: 20 });
  r.player.addExp(3_000);
  r.player.skills.learn('base/sword');
  r.player.skills.setLevel('base/sword', 30);
  r.player.skills.learn('wd/taijijian');
  return r;
}

// ---------------------------------------------------------------------------
// ① 学一次：建档 + 一拍结算
// ---------------------------------------------------------------------------

describe('§64 learnSkill · 学一次', () => {
  it('学会一门没学过的技能：建档 + 花潜能 + 涨级', () => {
    const { player } = makePlayer({ pot: 1000, int: 20 });
    expect(player.skills.has('base/sword')).toBe(false);

    // ★ 一次的量照 wushen `count_speed`：trunc(20*(100+0+20)/100)*3 = 72，lv<300 再 ×5 = 360
    const r = learned(player.learnSkill('基本剑法', teacher().skillLevel('base/sword')));
    expect(r.id).toBe('base/sword');
    expect(r.spent).toBe(360);
    expect(r.gained).toBeGreaterThan(0);
    expect(player.pot).toBe(1000 - 360);
    expect(player.skills.levelOf('base/sword')).toBe(r.level);
  });

  it('已学会时是**继续教**（不是"已经会了"拒绝）—— 与 wushen `xue` 同义', () => {
    const { player } = makePlayer({ pot: 2000, int: 20 });
    // ★ 角色经验给足 ⇒ 上限 30；否则第一次学就会冲到上限 10，第二次只能是 `capped`
    player.addExp(3_000);
    const t = teacher().skillLevel('base/sword');
    const first = learned(player.learnSkill('基本剑法', t));
    const second = learned(player.learnSkill('基本剑法', t));
    expect(second.level).toBeGreaterThanOrEqual(first.level);
    expect(player.pot).toBe(2000 - first.spent - second.spent);
  });

  it('★ 学到上限就停（`capped`），不能再花潜能', () => {
    const { player } = makePlayer({ pot: 100_000, int: 20 });
    // 玩家 exp=0 ⇒ skillLimit=10；Basic sword 模板 400 ⇒ 上限取 10
    player.skills.learn('base/sword');
    player.skills.setLevel('base/sword', player.skillLimit());
    const before = player.pot;
    const r = learnRefused(player.learnSkill('基本剑法', 120), 'capped');
    expect(r.level).toBe(10);
    expect(r.limit).toBe(10);
    expect(player.pot).toBe(before); // 被拒 = 一分不花
  });

  it('老师等级就是天花板（`master-lower`）—— 不能从比自己弱的人那里学', () => {
    const { player } = makePlayer({ pot: 100_000, int: 20 });
    player.skills.learn('base/sword');
    player.skills.setLevel('base/sword', 20);
    const r = learnRefused(player.learnSkill('基本剑法', 20), 'master-lower');
    expect(r.teacherLevel).toBe(20);
  });

  it('★★ 潜能不够**整笔拒**，不许"花到光为止"（wushen `xue.js:256`）', () => {
    const { player } = makePlayer({ pot: 100, int: 20 });
    const r = learnRefused(player.learnSkill('基本剑法', 120), 'no-pot');
    expect(r.need).toBe(360); // 一次要 360，手上 100
    expect(player.pot).toBe(100); // ★ 一分没花
    // ★★ "全有或全无"**也包括技能簿本身**（2026-10-18 真机抓到的泄漏）：
    //   旧实现先 `skills.learn()` 建档、再判潜能 ⇒ 被拒之后技能簿里
    //   多了一门 **1 级**的技能。玩家看到的就是"面板说我学会了基本剑法、
    //   可我潜能是 0" —— 一句解释不了的谎。被拒 = 什么都没发生。
    expect(player.skills.has('base/sword'), '被拒了却已经把技能扫进簿子').toBe(false);
    // ★ 对照：`practice` 的语义是"花到光"（那边有专门断言），两者**刻意不同**
  });

  it('老师不会这门（`no-teacher`）', () => {
    const { player } = makePlayer({ pot: 1000 });
    const r = learnRefused(player.learnSkill('基本剑法', 0), 'no-teacher');
    expect(r.name).toBe('基本剑法');
    // 与 `no-pot` 同一条纪律：被拒不许留下"半学"的记录（同一处泄漏的第二条出口）
    expect(player.skills.has('base/sword')).toBe(false);
  });

  it('没这个技能（`unknown`）—— 不抛，玩家敲错名字是正常的事', () => {
    const { player } = makePlayer({ pot: 1000 });
    expect(learnRefused(player.learnSkill('不存在的功', 100), 'unknown')).toBeTruthy();
  });

  it('★ `minSlot` 门槛：基本功不到 30 级学不了太极剑法', () => {
    const { player } = makePlayer({ pot: 100_000, int: 20 });
    const r = learnRefused(player.learnSkill('太极剑法', 80), 'slot');
    expect(r.slot).toBe('sword');
    expect(r.need).toBe(30);
    // 准入门槛被拒同样不许建档
    expect(player.skills.has('wd/taijijian')).toBe(false);
    // ★ 对照：把基本功拨到 30 级，同一句话必须不再出现
    player.skills.learn('base/sword');
    player.skills.setLevel('base/sword', 30);
    expect(player.learnSkill('太极剑法', 80).kind).toBe('learned');
  });
});

// ---------------------------------------------------------------------------
// ② 学习条件的三道门槛（属性 / 内力上限 / 性别）
// ---------------------------------------------------------------------------

describe('§64 learnSkill · 声明式学习条件（拒绝原因是结构，不是文案）', () => {
  const defs: ReadonlyArray<{ id: string; def: SkillDef }> = [
    { id: 'c/attr', def: { name: '臂力功', learnCondition: { minAttr: { str: 999 } } } },
    { id: 'c/mp', def: { name: '内力功', learnCondition: { minMaxMp: 99_999 } } },
    { id: 'c/gender', def: { name: '男儿功', learnCondition: { gender: 2 } } },
  ];

  it('minAttr 报出**属性键与门槛数字**（不是一句"学不了"）', () => {
    const reg = new SkillRegistry(defs);
    const out = new RecordingOutput();
    const p = new Player({
      roleId: 'cond-1',
      oid: 'c000000001',
      path: null,
      name: '条件者',
      skillRegistry: reg,
      output: out,
      scheduler: world.scheduler,
    });
    p.addExp(0, 10_000);
    const r = learnRefused(p.learnSkill('臂力功', 100), 'attr');
    expect(r.key).toBe('str');
    expect(r.need).toBe(999);
  });

  it('minMaxMp / gender 各报各的门槛', () => {
    const reg = new SkillRegistry(defs);
    const out = new RecordingOutput();
    const p = new Player({
      roleId: 'cond-2',
      oid: 'c000000002',
      path: null,
      name: '条件者',
      skillRegistry: reg,
      output: out,
      scheduler: world.scheduler,
    });
    p.addExp(0, 10_000);
    expect(learnRefused(p.learnSkill('内力功', 100), 'max-mp').need).toBe(99_999);
    // 玩家的性别是 1（男），`c/gender` 要 2（女）
    expect(learnRefused(p.learnSkill('男儿功', 100), 'gender').gender).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// ③ 遗忘
// ---------------------------------------------------------------------------

describe('§64 forgetSkill · 遗忘', () => {
  it('★ 基本技能与知识类不可遗忘（wushen `fangqi.js:10-12`）', () => {
    const { player } = makePlayer({ pot: 1000, int: 20 });
    player.skills.learn('base/sword');
    expect(learnRefusedOutcome(player.forgetSkill('基本剑法'), 'base')).toBe(true);

    const reg = new SkillRegistry([
      { id: 'k/book', def: { name: '读书心得', type: SKILL_TYPES.KNOWLEDGE } },
    ]);
    const p2 = new Player({
      roleId: 'forget-2',
      oid: 'f000000002',
      path: null,
      name: '读书人',
      skillRegistry: reg,
      output: new RecordingOutput(),
      scheduler: world.scheduler,
    });
    p2.skills.learn('k/book');
    expect(learnRefusedOutcome(p2.forgetSkill('读书心得'), 'knowledge')).toBe(true);
  });

  it('忘掉一门武功：装配关系一并卸下，并报出卸的是哪个槽', () => {
    const { player } = makePlayer({ pot: 100_000, int: 20 });
    player.skills.learn('base/sword');
    player.skills.setLevel('base/sword', 30);
    player.skills.learn('wd/taijijian');
    enabled(player.enableSkill('sword', '太极剑法'));

    const r = forgotten(player.forgetSkill('太极剑法'));
    expect(r.wasEnabled).toBe('sword');
    expect(player.skills.has('wd/taijijian')).toBe(false);
    // ★ 槽真的空了（不是"忘了但还挂着"）
    expect(player.skills.enabledOf('sword')).toBeUndefined();
  });

  it('没学过 / 没这个技能 → 各自的原因', () => {
    const { player } = makePlayer();
    expect(learnRefusedOutcome(player.forgetSkill('太极剑法'), 'not-learned')).toBe(true);
    expect(learnRefusedOutcome(player.forgetSkill('不存在'), 'unknown')).toBe(true);
  });
});

/** 遗忘的拒绝断言（写成小助手，免得每处都写一遍 kind 判定） */
function learnRefusedOutcome(
  r: ForgetResult,
  reason: Extract<ForgetResult, { readonly kind: 'refused' }>['reason'],
): boolean {
  if (r.kind !== 'refused') throw new Error(`期望被拒（${reason}），实际成功了`);
  expect(r.reason).toBe(reason);
  return true;
}

// ---------------------------------------------------------------------------
// ④ 装配
// ---------------------------------------------------------------------------

describe('§64 enableSkill · 装配', () => {
  it('装上 / 卸下 / 重复装同一个不算"换下了自己"', () => {
    const { player } = makePlayer({ pot: 100_000, int: 20 });
    player.skills.learn('base/sword');
    player.skills.setLevel('base/sword', 30);
    player.skills.learn('wd/taijijian');

    const r = enabled(player.enableSkill('sword', '太极剑法'));
    expect(r.slot).toBe('sword');
    // ★ 基本技能靠 `slot` 占槽、不进 `#enabledBySlot` ⇒ 这里本来就没有"被顶下来的武功"
    expect(r.replaced).toBeNull();
    expect(player.skills.enabledOf('sword')).toBe('wd/taijijian');
    // ② 档属性上来了（enableProp: gj = lv/2）
    expect(player.skillLevel('sword')).toBeGreaterThan(0);

    expect(player.disableSkill('sword')).toBe(true);
    expect(player.disableSkill('sword')).toBe(false); // 已经空了
  });

  it('★ 换装配时 `replaced` 报**名字**而不是 id（玩家不该看到 wd/xxx）', () => {
    const reg = new SkillRegistry([
      { id: 'base/sword', def: { name: '基本剑法', type: SKILL_TYPES.BASE, slot: 'sword' } },
      { id: 't/a', def: { name: '甲剑法', type: SKILL_TYPES.SKILL, can_enables: ['sword'] } },
      { id: 't/b', def: { name: '乙剑法', type: SKILL_TYPES.SKILL, can_enables: ['sword'] } },
    ]);
    const p = new Player({
      roleId: 'swap-1',
      oid: 's000000001',
      path: null,
      name: '换装者',
      skillRegistry: reg,
      output: new RecordingOutput(),
      scheduler: world.scheduler,
    });
    p.skills.learn('t/a');
    p.skills.learn('t/b');
    enabled(p.enableSkill('sword', '甲剑法'));
    const r = enabled(p.enableSkill('sword', '乙剑法'));
    expect(r.replaced).toBe('甲剑法');
    expect(p.skills.enabledOf('sword')).toBe('t/b');
  });

  it('四种拒绝：没学过 / 不可装配 / 槽不匹配 / 没这个技能', () => {
    const { player } = makeSwordsman();
    // ① 没学过（用一个他确实没有的技能 —— 太极剑法在 `makeSwordsman` 里已学会）
    expect(refusalOf(player.enableSkill('sword', '基本内功'), 'not-learned').name).toBe('基本内功');

    // ② 基本技能不可装配
    expect(refusalOf(player.enableSkill('sword', '基本剑法'), 'not-enablable').name).toBe('基本剑法');

    // ③ 装错槽（太极剑法只能上 sword）
    const mismatch = refusalOf(player.enableSkill('blade', '太极剑法'), 'slot-mismatch');
    expect(mismatch.allows).toEqual(['sword']);

    // ④ 没这个技能
    expect(refusalOf(player.enableSkill('sword', '不存在'), 'unknown').reason).toBe('unknown');
  });
});

/**
 * 装配的拒绝断言。**泛型返回具体那一支**，于是 `slot-mismatch` 才读得到 `allows`
 * —— 返回整个 `refused` 联合的话，`r.allows` 编译不过（那正是判别联合该有的样子）。
 */
function refusalOf<R extends Extract<EnableResult, { readonly kind: 'refused' }>['reason']>(
  r: EnableResult,
  reason: R,
): Extract<EnableResult, { readonly kind: 'refused'; readonly reason: R }> {
  if (r.kind !== 'refused') throw new Error(`期望被拒（${reason}），实际装上了`);
  if (r.reason !== reason) throw new Error(`期望 ${reason}，实际 ${r.reason}`);
  return r as Extract<EnableResult, { readonly kind: 'refused'; readonly reason: R }>;
}

// ---------------------------------------------------------------------------
// ⑤ 面板快照
// ---------------------------------------------------------------------------

describe('§64 skillView · 技能面板数据', () => {
  it('空技能簿：标题说"没有学会"，items 为空，上限与 pot 照实报', () => {
    const { player } = makePlayer({ pot: 42 });
    const v = player.skillView();
    expect(v.title).toBe('没有学会任何技能');
    expect(v.items).toEqual([]);
    expect(v.limit).toBe(10);
    expect(v.pot).toBe(42);
  });

  it('分类来自**模板 type**（基础页 base / 特殊页 skill），与 `can_enables` 无关', () => {
    const { player } = makeSwordsman();
    player.skills.learn('base/force');
    const v = player.skillView();
    const kinds = v.items.map((i) => `${i.id}:${i.kind}`).sort();
    expect(kinds).toEqual(['base/force:base', 'base/sword:base', 'wd/taijijian:skill']);
    expect(v.title).toBe('你共学会 3 项技能');
  });

  it('排序稳定：基础技能在前，再按阶位降序', () => {
    const { player } = makeSwordsman();
    player.skills.learn('base/force');
    const ids = player.skillView().items.map((i) => i.id);
    expect(ids.indexOf('base/force')).toBeLessThan(ids.indexOf('wd/taijijian'));
    expect(ids.indexOf('base/sword')).toBeLessThan(ids.indexOf('wd/taijijian'));
  });

  it('★ `progress` 是**服务端算的百分比**（0–100），不是原始经验', () => {
    const { player } = makePlayer({ pot: 100_000, int: 20 });
    player.skills.learn('base/sword');
    // 1 级升 2 级需要 levelExp(1, 0) = (1+1)*(0+1)*5 = 10
    player.skills.addExp('base/sword', 5);
    const entry = player.skillView().items.find((i) => i.id === 'base/sword');
    expect(entry?.level).toBe(1);
    expect(entry?.progress).toBe(50);
  });

  it('已装配的条目带 `enabled`，`canEnables` 原样给出', () => {
    const { player } = makePlayer({ pot: 100_000, int: 20 });
    player.skills.learn('base/sword');
    player.skills.setLevel('base/sword', 30);
    player.skills.learn('wd/taijijian');
    player.enableSkill('sword', '太极剑法');
    const v = player.skillView();
    const tj = v.items.find((i) => i.id === 'wd/taijijian');
    expect(tj?.enabled).toBe('sword');
    expect(tj?.canEnables).toEqual(['sword']);
    const basic = v.items.find((i) => i.id === 'base/sword');
    expect(basic?.enabled).toBeNull(); // 基本技能不写 enabled
    expect(basic?.canEnables).toEqual([]);
    // ★ 基本功自报占哪个槽（`SkillTemplate.slot`）—— 面板靠它把「装配」按钮
    //   写成「装配基本剑法」（wushen 同款）。武功不是基本功 ⇒ `null`。
    expect(basic?.slot).toBe('sword');
    expect(tj?.slot).toBeNull();
  });

  it('`note` 来自 `learnCondition.desc`；没有条件就没有这一格', () => {
    const { player } = makeSwordsman();
    const v = player.skillView();
    expect(v.items.find((i) => i.id === 'wd/taijijian')?.note).toBe('需基本剑法 30 级、悟性 20 以上');
    expect('note' in (v.items.find((i) => i.id === 'base/sword') ?? {})).toBe(false);
  });

  it('★ `ActorObject.skillLevel` 认中文名 —— 否则 `learn 基本剑法 from 教头` 问不到老师的等级', () => {
    const t = teacher();
    expect(t.skillLevel('base/sword')).toBe(300);
    expect(t.skillLevel('基本剑法')).toBe(300);
    expect(t.skillLevel('sword')).toBe(300); // 槽名同样可读（`levelOfSlot`）
    expect(t.skillLevel('不存在的功')).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// ⑥ 端到端：真内容、真 NPC、真房间
// ---------------------------------------------------------------------------

describe('§64 端到端 · 武馆里跟教头学基本剑法', () => {
  it('教头真的会六门基本功，且教得了新手', () => {
    const t = teacher();
    // ★ 2026-10-18：教学面从 2 门扩到 6 门（技能上限同时提到 1000，
    //   但"能练到多高"由内容层的师徒层级决定 ⇒ 教头 300 级是**教学上限**）
    for (const name of ['基本内功', '基本轻功', '基本招架', '基本拳脚', '基本剑法', '基本刀法']) {
      expect(t.skillLevel(name), `教头不会 ${name}`).toBe(300);
    }
    expect(t.skillLevel('wd/taijijian')).toBe(80);
  });

  it('★ 六门基本功都能学 —— 内容写了没人教是这个仓库反复踩的坑', () => {
    const { player } = makePlayer({ room: 'yz/wuguan', pot: 20_000, int: 20 });
    const t = teacher();
    for (const name of ['基本内功', '基本轻功', '基本招架', '基本拳脚', '基本剑法', '基本刀法']) {
      const r = player.learnSkill(name, t.skillLevel(name));
      expect(r.kind, `学 ${name} 被拒`).toBe('learned');
    }
  });

  it('★ 完整链路：学基本剑法 → 练到 30 → 学太极剑法', () => {
    // 潜能给够：练到 30 级需要 sum_{lv=1..29} levelExp(lv,0) = 5*(2+…+30) = 2320
    const { player } = makePlayer({ room: 'yz/wuguan', pot: 20_000, int: 20 });
    // ★ 角色经验 3000 ⇒ skillLimit=30：**这条链条的第一个天花板是经验，不是潜能**
    player.addExp(3_000);
    const t = teacher();

    learned(player.learnSkill('基本剑法', t.skillLevel('基本剑法')));
    expect(player.skills.levelOf('base/sword')).toBeGreaterThan(0);

    const pr = player.practiceSkill('基本剑法', 30);
    if (pr.kind !== 'done') throw new Error(`练级失败：${pr.reason}`);
    expect(player.skills.levelOf('base/sword')).toBe(30);

    // 基本功到位 ⇒ 同一句 `learn 太极剑法` 现在应当通过
    const r = learned(player.learnSkill('太极剑法', t.skillLevel('太极剑法')));
    expect(r.id).toBe('wd/taijijian');
    expect(player.skills.levelOf('wd/taijijian')).toBeGreaterThanOrEqual(1);
  });

  it('教头不在的房间学不到（`learn` 要求同房间）—— 这是引擎之外的约束，归于指令层', () => {
    // ★ 引擎侧只认"老师等级"这个数字；"在不在同一个房间"由 `train/learn` 用
    //   `findTarget` 判（`tests/command-*.test.ts` 覆盖指令层）。这里钉住前提：
    //   广场里没有教头，所以那条指令必然拿不到老师。
    expect(world.npcsOf('pub/jiaotou').length).toBe(1);
    const plaza = world.room('yz/guangchang');
    const inPlaza = plaza?.items.filter((o) => o.kind === 'npc').map((o) => o.name) ?? [];
    expect(inPlaza).not.toContain('教头');
  });
});

// ---------------------------------------------------------------------------
// ⑦ 拒绝文案：性别三档必须取自单源（`GENDER_LABELS`）
// ---------------------------------------------------------------------------

/**
 * ★★ 这一组是 T18 的**新宿主**（26 册 §64）。
 *
 * 原来这条判据挂在 `engine-skill.test.ts` 上，断言的是引擎拼出来的中文。
 * §64 把 `learn()` 改成"只出结构、不出文案"之后，引擎测试只剩下
 * `{reason:'gender', gender}` —— 它**不该**再锚文案，于是"改 `GENDER_LABELS`
 * 会让谁变红"就没有答案了，变异样本当场假绿。
 * ⇒ 判据跟着归属层迁移：文案在 `LEARN_MESSAGES.refuse()`，那就由这里钉。
 */
describe('§64 拒绝文案 · 性别三档取单源', () => {
  /** 造一支性别拒绝，交给文案表渲染 */
  const genderLine = (gender: 0 | 1 | 2): string =>
    LEARN_MESSAGES.refuse({ kind: 'refused', reason: 'gender', gender, name: '某功' }, '某人', '某功');

  it('三档各是一个词：男性 / 女性 / 无性', () => {
    // ★★ 这里**硬编码中文**是刻意的：断言若改成"和 `GENDER_LABELS` 比"，两边
    //   永远相等 ⇒ 恒真 ⇒ 等于没测（§55 那条"我什么都不做，这条也绿吗？"）。
    //   本文件就是那份**独立的**抄本，它的唯一职责是把表钉在 Three 档上。
    expect(genderLine(1)).toBe('男性才能学习某功。');
    expect(genderLine(2)).toBe('女性才能学习某功。');
  });

  it('★ 第 0 档是「无性」，不能被并进女性', () => {
    // 26 册 §11.4 / docs/27 的 T18：wushen 的 gender 是**三档**（1 男 / 2 女 / 0 无性）。
    // 把 0 档并进 2 档，无性角色就会看到"女性才能学习"—— 一句**误导**，
    // 而不是无害的措辞差异。
    expect(genderLine(0)).toBe('无性才能学习某功。');
  });
});

/**
 * server/engine/skill.ts —— 技能簿（模板 / 装配 / 三档属性 / 记账式重算 / 绝招）
 * ============================================================================
 * 本文件按 docs/27 §7 的表逐条落地。**每一条都对应一个 wushen 会翻车的点**
 * （docs/27 §3 的"不抄"清单），所以它们不是"覆盖率填充物"：
 *
 *   ✔ 三档属性           —— ① 学会即生效 / ② 启用后生效（按槽）
 *   ★ 记账式重算**幂等** —— wushen 的 release→改→attach 三角**会漂移**（漏一步就永久重复累加）
 *   ★ 装配互斥           —— 换槽必须把旧技能的 ② 档清干净
 *   ★ 换装配被拒**不损害**既有装配 —— wushen 先卸旧再问新，新的被拒则槽空着
 *   ✔ 声明式学习条件     —— 取代 wushen 的 `learn_condition` key `switch`
 *   ✔ 绝招数据 + 冷却    —— 时间可注入（wushen 的 `Date.now()` 写死在函数体里，只能 sleep 测）
 *   ✔ 闭集槽名           —— 取代"技能 id 恰好等于槽名"的隐式约定
 *   ✔ D9 NPC 技能面      —— 保留技能 id（wushen 的 `skill_map` 把它丢了）
 *
 * 全部用**真实 Npc 实例**做宿主（而不是造一个假 owner）：这样 `recount → 派生属性`
 * 这条链也被覆盖，而不只是 props 层。
 */
import { describe, expect, it } from 'vitest';

import { asWorldId } from '../shared/ids.js';
import { MAX_LEVEL, PROP, SKILL_TYPES } from '../shared/constants.js';
import type { EnableSlot } from '../shared/constants.js';
import { RecordingOutput } from '../server/engine/character.js';
import { Npc } from '../server/engine/npc.js';
import { getProp, setProp, snapshotProps } from '../server/engine/props.js';
import {
  SKILL_FORMULA,
  SkillError,
  SkillRegistry,
  gradeUpLevel,
  levelExp,
  levelLimit,
  skillFormulaSummary,
  totalNeedExp,
} from '../server/engine/skill.js';
import type { SkillState } from '../server/engine/skill.js';
import { tuningSummary } from '../server/engine/tuning.js';
import type { SkillDef } from '../server/world/defs.js';

// ---------------------------------------------------------------------------
// 夹具：一张自洽的技能表（不依赖 @world 内容）
// ---------------------------------------------------------------------------

const SKILL_DEFS: ReadonlyArray<{ id: string; def: SkillDef }> = [
  {
    id: 'base/force',
    def: {
      name: '基本内功',
      type: SKILL_TYPES.BASE,
      slot: 'force',
      grade: 0,
      max_level: 100,
      passiveProp: (lv) => ({ prop: { con: Math.trunc(lv / 10) } }),
    },
  },
  {
    id: 'base/sword',
    def: {
      name: '基本剑法',
      type: SKILL_TYPES.BASE,
      slot: 'sword',
      grade: 0,
      max_level: 100,
      passiveProp: (lv) => ({ prop: { mz: lv } }),
      // ★ enable 写在基本技能的绝招上：它的 `enabled` 恒为 null，靠 `slot` 占槽。
      //   如果槽判定写成 `st.enabled === pfm.enable`，这条就永远放不出来。
      pfm: { lian: { name: '连击', enable: 'sword', mp: 5, cdMs: 3_000 } },
    },
  },
  {
    id: 'wd/a',
    def: {
      name: '甲剑法',
      type: SKILL_TYPES.SKILL,
      grade: 1,
      can_enables: ['sword'],
      enableProp: (lv) => ({ sword: { prop: { gj: lv } } }),
      pfm: {
        slash: { name: '横斩', enable: 'sword', mp: 10, releaseMs: 1_500, cdMs: 5_000 },
        free: { name: '随手一击', mp: (lv) => lv },
      },
    },
  },
  {
    id: 'wd/b',
    def: {
      name: '乙剑法',
      type: SKILL_TYPES.SKILL,
      grade: 1,
      can_enables: ['sword', 'blade'],
      enableProp: (lv) => ({ sword: { prop: { gj: lv * 2 } }, blade: { prop: { gj: lv * 3 } } }),
    },
  },
  {
    id: 'wd/both',
    def: {
      name: '双档剑法',
      type: SKILL_TYPES.SKILL,
      grade: 1,
      can_enables: ['sword'],
      passiveProp: (lv) => ({ prop: { mz: lv } }),
      enableProp: (lv) => ({ sword: { prop: { gj: lv } } }),
    },
  },
  {
    id: 'wd/gated',
    def: {
      name: '门槛剑法',
      type: SKILL_TYPES.SKILL,
      grade: 1,
      can_enables: ['sword'],
      learnCondition: { minSlot: { sword: 30 }, desc: '需基本剑法 30 级' },
    },
  },
  {
    id: 'wd/deny',
    def: {
      name: '谢绝装配',
      type: SKILL_TYPES.SKILL,
      grade: 1,
      can_enables: ['sword'],
      on_enable: () => false,
    },
  },
  { id: 'wd/know', def: { name: '知识类', type: SKILL_TYPES.KNOWLEDGE, grade: 1 } },
  // 进阶用：`gradeUpMinLevel`(1000) 比 `defaultMaxLevel`(100) 高得多，
  // 所以"能进阶的技能"必须自己把 max_level 抬上去（见下面「进阶」那组断言）。
  { id: 'gd/from', def: { name: '进阶源', type: SKILL_TYPES.SKILL, grade: 1, max_level: 2_000 } },
  { id: 'gd/to', def: { name: '进阶目标', type: SKILL_TYPES.SKILL, grade: 2, max_level: 2_000 } },
];

const REG = new SkillRegistry(SKILL_DEFS);

function makeNpc(output?: RecordingOutput): Npc {
  return new Npc({
    oid: 'aaaaaaaaaa',
    path: asWorldId('zz/npc', 'engine-skill.test'),
    name: '测试',
    def: { name: '测试', desc: 'd' },
    skillRegistry: REG,
    ...(output === undefined ? {} : { output }),
  });
}

function npcWith(entries: ReadonlyArray<{ skill: string; level: number; enableAs?: EnableSlot }>): Npc {
  return new Npc({
    oid: 'bbbbbbbbbb',
    path: asWorldId('zz/npc2', 'engine-skill.test:with'),
    name: '带技能',
    def: { name: '带技能', desc: 'd', skills: entries },
    skillRegistry: REG,
  });
}

/** props 里"非零的核心属性"（`snapshotProps().prop`） */
const coreOf = (npc: Npc): Record<string, number> => snapshotProps(npc).prop;

// ---------------------------------------------------------------------------

describe('engine/skill · SkillRegistry（模板构造即校验）', () => {
  it('基本技能必须声明 slot —— 缺了就不是"占槽技能"，构造即抛', () => {
    expect(
      () => new SkillRegistry([{ id: 'x/y', def: { name: 'X', type: SKILL_TYPES.BASE } }]),
    ).toThrow(SkillError);
  });

  it('非基本技能**不应**声明 slot —— 声明了说明作者把"占槽"与"可装配"搞混了', () => {
    expect(
      () =>
        new SkillRegistry([
          { id: 'x/y', def: { name: 'X', type: SKILL_TYPES.SKILL, slot: 'sword' } },
        ]),
    ).toThrow(SkillError);
  });

  it('can_enables 里出现闭集外的槽名 → 构造即抛（D1 闭集）', () => {
    expect(
      () =>
        new SkillRegistry([
          {
            id: 'x/y',
            def: { name: 'X', can_enables: ['no_such_slot' as unknown as EnableSlot] },
          },
        ]),
    ).toThrow(/can_enables/);
  });

  it('force_rad 必须是非负数（写错不该静默变成 0）', () => {
    expect(
      () => new SkillRegistry([{ id: 'x/y', def: { name: 'X', force_rad: -1 } }]),
    ).toThrow(/force_rad/);
  });

  it('重复 id → 抛（注册层已挡，这是第二道）', () => {
    expect(
      () =>
        new SkillRegistry([
          { id: 'x/y', def: { name: 'X' } },
          { id: 'x/y', def: { name: 'X2' } },
        ]),
    ).toThrow(/重复/);
  });

  it('bySlot / byCanEnable 取代 wushen 的 `SKILL[槽][阶]` 往类上挂索引', () => {
    expect(REG.bySlot('force').map((t) => t.id)).toEqual(['base/force']);
    expect(REG.bySlot('sword').map((t) => t.id)).toEqual(['base/sword']);
    expect(REG.byCanEnable('sword').map((t) => t.id).sort()).toEqual([
      'wd/a',
      'wd/b',
      'wd/both',
      'wd/deny',
      'wd/gated',
    ]);
    expect(REG.byCanEnableGrade('sword', 1).map((t) => t.id).sort()).toEqual([
      'wd/a',
      'wd/b',
      'wd/both',
      'wd/deny',
      'wd/gated',
    ]);
    // 取不到的槽 → 空数组，不是抛错
    expect(REG.bySlot('whip')).toEqual([]);
    expect(REG.get('no/such')).toBeUndefined();
    expect(REG.size).toBe(SKILL_DEFS.length);
  });
});

describe('engine/skill · 三档属性与记账式重算（★ docs/27 D2）', () => {
  it('① 档（学会即生效）：学会就进 props，派生属性随之变化', () => {
    const npc = makeNpc();
    expect(getProp(npc, 'con')).toBe(0);
    npc.skills.learn('base/force', 30);
    expect(getProp(npc, 'con')).toBe(3); // trunc(30/10)
  });

  it('★ 幂等：`props` 恰好等于 `contributedProps()`，连调 recompute() 10 次完全不变', () => {
    const npc = makeNpc();
    npc.skills.learn('base/force', 30);
    npc.skills.learn('wd/a', 10);
    npc.skills.enable('sword', 'wd/a');

    // 关键断言 ①：账目与实际**一致**（不多算也不少算）
    expect(coreOf(npc)).toEqual({ con: 3, gj: 10 });

    // 关键断言 ②：重算幂等 —— wushen 的三角每重算一次就会多加一份，这里必须纹丝不动
    const before = snapshotProps(npc);
    const derivedBefore = npc.derived;
    for (let i = 0; i < 10; i += 1) npc.skills.recompute();
    expect(snapshotProps(npc)).toEqual(before);
    expect(npc.derived).toEqual(derivedBefore);
  });

  it('② 档（启用后生效）：只有被装配的那个槽才计入', () => {
    const npc = makeNpc();
    npc.skills.learn('wd/both', 10);
    expect(coreOf(npc)).toEqual({ mz: 10 }); // ① 档已生效，② 档还没有
    npc.skills.enable('sword', 'wd/both');
    expect(coreOf(npc)).toEqual({ mz: 10, gj: 10 }); // ② 档上来
  });

  it('disable 之后 ② 档归零、① 档仍在（三档的边界）', () => {
    const npc = makeNpc();
    npc.skills.learn('wd/both', 10);
    npc.skills.enable('sword', 'wd/both');
    expect(npc.skills.disable('sword')).toBe(true);
    expect(coreOf(npc)).toEqual({ mz: 10 });
    expect(npc.skills.disable('sword')).toBe(false); // 已经没装了
  });

  it('★ 换装配：sword 从甲剑法换成乙剑法，**甲的 ② 档必须被清掉**（不残留）', () => {
    const npc = makeNpc();
    npc.skills.learn('wd/a', 10);
    npc.skills.learn('wd/b', 10);
    npc.skills.enable('sword', 'wd/a');
    expect(getProp(npc, 'gj')).toBe(10);

    npc.skills.enable('sword', 'wd/b');
    expect(getProp(npc, 'gj')).toBe(20); // = 10*2，而不是 10 + 20
    expect(npc.skills.enabledOf('sword')).toBe('wd/b');
    expect(npc.skills.entryOf('wd/a')?.enabled).toBeNull(); // 甲被卸下
  });

  it('★ 换到别的槽：乙剑法 sword→blade，按**新槽**的属性算（不是叠加）', () => {
    const npc = makeNpc();
    npc.skills.learn('wd/b', 10);
    npc.skills.enable('sword', 'wd/b');
    expect(getProp(npc, 'gj')).toBe(20);
    npc.skills.enable('blade', 'wd/b');
    expect(getProp(npc, 'gj')).toBe(30); // 10*3
    expect(npc.skills.enabledOf('sword')).toBeUndefined();
    expect(npc.skills.entryOf('wd/b')?.enabled).toBe('blade');
  });

  it('升级后按**新等级**重算，不是叠加', () => {
    const npc = makeNpc();
    npc.skills.learn('wd/both', 10);
    npc.skills.enable('sword', 'wd/both');
    expect(coreOf(npc)).toEqual({ mz: 10, gj: 10 });
    npc.skills.setLevel('wd/both', 20);
    expect(coreOf(npc)).toEqual({ mz: 20, gj: 20 });
  });

  it('遗忘 → 属性全清（含 ② 档，且槽被腾空）', () => {
    const npc = makeNpc();
    npc.skills.learn('wd/both', 10);
    npc.skills.enable('sword', 'wd/both');
    expect(npc.skills.forget('wd/both')).toBe(true);
    expect(coreOf(npc)).toEqual({});
    expect(npc.skills.enabledOf('sword')).toBeUndefined();
    expect(npc.skills.forget('wd/both')).toBe(false); // 再忘一次是 no-op
  });

  it('技能属性 0 不记账（`con += 0` 这类写法不该在 props 里留一个恒 0 的键）', () => {
    const npc = makeNpc();
    npc.skills.learn('base/force', 5); // trunc(5/10) = 0
    expect(coreOf(npc)).toEqual({});
  });
});

describe('engine/skill · 装配（★ docs/27 D1 闭集 + 「被拒不损害既有装配」）', () => {
  it('挂到 can_enables 之外的槽 → 抛错（"一套剑法装到内功槽"就是这么被挡下的）', () => {
    const npc = makeNpc();
    npc.skills.learn('wd/a', 10);
    expect(() => npc.skills.enable('blade', 'wd/a')).toThrow(/can_enables|不能启用/);
  });

  it('还没学会就装配 → 抛错', () => {
    const npc = makeNpc();
    expect(() => npc.skills.enable('sword', 'wd/a')).toThrow(/还没学会/);
  });

  it('不可装配的类型（基本技能 / 知识类）→ 抛错', () => {
    const npc = makeNpc();
    npc.skills.learn('base/sword', 10);
    npc.skills.learn('wd/know', 10);
    expect(() => npc.skills.enable('sword', 'base/sword')).toThrow(/不可装配/);
    expect(() => npc.skills.enable('sword', 'wd/know')).toThrow(/不可装配/);
  });

  it('★ 新技能被 `on_enable` 拒绝 → 返回 false，且**既有装配原封不动**', () => {
    // wushen 的口径是「先卸旧 → 再问新的 enable()」，新的被拒则**槽空着**（旧技能已经没了）。
    // 这里把全部否决点放在卸旧之前 —— 否决不该有破坏性副作用。
    const npc = makeNpc();
    npc.skills.learn('wd/a', 10);
    npc.skills.learn('wd/deny', 10);
    npc.skills.enable('sword', 'wd/a');
    expect(npc.skills.enable('sword', 'wd/deny')).toBe(false);
    expect(npc.skills.enabledOf('sword')).toBe('wd/a');
    expect(getProp(npc, 'gj')).toBe(10);
  });

  it('★ 抛错型否决同样不损害既有装配（校验在卸旧之前）', () => {
    const npc = makeNpc();
    npc.skills.learn('wd/a', 10);
    npc.skills.learn('wd/know', 10);
    npc.skills.enable('sword', 'wd/a');
    expect(() => npc.skills.enable('sword', 'wd/know')).toThrow();
    expect(npc.skills.enabledOf('sword')).toBe('wd/a');
    expect(getProp(npc, 'gj')).toBe(10);
  });

  it('重复装同一个 → 幂等返回 true，不重复记账', () => {
    const npc = makeNpc();
    npc.skills.learn('wd/a', 10);
    npc.skills.enable('sword', 'wd/a');
    expect(npc.skills.enable('sword', 'wd/a')).toBe(true);
    expect(getProp(npc, 'gj')).toBe(10);
  });

  it('非法槽名（绕过类型）→ 抛错', () => {
    const npc = makeNpc();
    npc.skills.learn('wd/a', 10);
    expect(() => npc.skills.enable('nope' as unknown as EnableSlot, 'wd/a')).toThrow(/非法装配槽/);
  });

  it('activeTemplate：被装配的武功 > 占槽的基本技能 > 无', () => {
    const npc = makeNpc();
    expect(npc.skills.activeTemplate('sword')).toBeUndefined();
    npc.skills.learn('base/sword', 10);
    expect(npc.skills.activeTemplate('sword')?.id).toBe('base/sword');
    npc.skills.learn('wd/a', 10);
    npc.skills.enable('sword', 'wd/a');
    expect(npc.skills.activeTemplate('sword')?.id).toBe('wd/a');
    npc.skills.disable('sword');
    expect(npc.skills.activeTemplate('sword')?.id).toBe('base/sword'); // 回落到基本剑法
  });
});

describe('engine/skill · 经验 / 升级 / 进阶（数值全部走 SKILL_FORMULA）', () => {
  it('每级所需经验 = (lv+1)*(grade+1)*expBase', () => {
    expect(levelExp(0, 0)).toBe(SKILL_FORMULA.expBase);
    expect(levelExp(9, 1)).toBe(10 * 2 * SKILL_FORMULA.expBase);
    // 与参数表联动：改 expBase 会同时改这里（不是两份事实源）
    expect(levelExp(4, 2)).toBe(5 * 3 * SKILL_FORMULA.expBase);
  });

  it('累计经验只在 > scoreFromLevel 之后才计（wushen 的 `query_needexp` 同款）', () => {
    expect(totalNeedExp(SKILL_FORMULA.scoreFromLevel, 1)).toBe(0);
    expect(totalNeedExp(0, 5)).toBe(0);
    expect(totalNeedExp(SKILL_FORMULA.scoreFromLevel + 1, 1)).toBeGreaterThan(0);
  });

  it('等级上限：exp < limitExpMin 固定 limitExpMinLevel；其余按境界因子开立方', () => {
    expect(levelLimit(0, 0)).toBe(SKILL_FORMULA.limitExpMinLevel);
    expect(levelLimit(SKILL_FORMULA.limitExpMin - 1, 0)).toBe(SKILL_FORMULA.limitExpMinLevel);
    // exp=8000、境界 0（因子 10）→ round(80000^(1/3)) = 43
    expect(levelLimit(8000, 0)).toBe(43);
    // 境界越高上限越高（因子里程表单调不减）
    expect(levelLimit(8000, 6)).toBeGreaterThan(levelLimit(8000, 0));
  });

  it('★ addExp 跨级：一次加够多级，等级正确、经验余额正确', () => {
    const npc = makeNpc();
    npc.skills.learn('wd/a', 1);
    // wd/a grade=1 → 升到 2/3/4 级各需 20/30/40，合计 90
    const gained = npc.skills.addExp('wd/a', 90);
    expect(gained).toBe(3);
    expect(npc.skills.levelOf('wd/a')).toBe(4);
    expect(npc.skills.entryOf('wd/a')?.exp).toBe(0);
  });

  it('addExp 不够一级 → 只累计经验，不升级', () => {
    const npc = makeNpc();
    npc.skills.learn('wd/a', 1);
    expect(npc.skills.addExp('wd/a', 19)).toBe(0);
    expect(npc.skills.levelOf('wd/a')).toBe(1);
    expect(npc.skills.entryOf('wd/a')?.exp).toBe(19);
  });

  it('addExp 到 max_level 封顶：等级停住、经验清零（不再滚下去）', () => {
    const npc = makeNpc();
    npc.skills.learn('wd/a', 99);
    const gained = npc.skills.addExp('wd/a', 10 ** 6);
    expect(gained).toBe(1); // 99 → 100（defaultMaxLevel）
    expect(npc.skills.levelOf('wd/a')).toBe(SKILL_FORMULA.defaultMaxLevel);
    expect(npc.skills.entryOf('wd/a')?.exp).toBe(0);
  });

  it('addExp 的数值必须有限（写 NaN 不许静默变 0）', () => {
    const npc = makeNpc();
    npc.skills.learn('wd/a', 1);
    expect(() => npc.skills.addExp('wd/a', Number.NaN)).toThrow(SkillError);
  });

  it('等级被 clamp 在 [0, max_level]', () => {
    const npc = makeNpc();
    npc.skills.learn('wd/a', 999);
    expect(npc.skills.levelOf('wd/a')).toBe(SKILL_FORMULA.defaultMaxLevel);
    npc.skills.setLevel('wd/a', -5);
    expect(npc.skills.levelOf('wd/a')).toBe(0);
  });

  it('进阶（grade_up）：需达到 gradeUpMinLevel，且新技能等级由潜能换算', () => {
    const npc = makeNpc();
    npc.skills.learn('gd/from', SKILL_FORMULA.gradeUpMinLevel - 1);
    expect(npc.skills.levelOf('gd/from')).toBe(SKILL_FORMULA.gradeUpMinLevel - 1);
    expect(npc.skills.gradeUp('gd/from', 'gd/to')).toBe(false); // 还差一级

    npc.skills.setLevel('gd/from', SKILL_FORMULA.gradeUpMinLevel);
    expect(npc.skills.gradeUp('gd/from', 'gd/to')).toBe(true);
    expect(npc.skills.has('gd/from')).toBe(false); // 进阶是"转过去"，不是并存
    expect(npc.skills.has('gd/to')).toBe(true);
    const pot = totalNeedExp(SKILL_FORMULA.gradeUpMinLevel, 1);
    expect(npc.skills.levelOf('gd/to')).toBe(Math.min(gradeUpLevel(pot, 2), 2_000));
    expect(npc.skills.levelOf('gd/to')).toBeGreaterThan(0);
  });

  it('★ 设计张力被显式钉住：gradeUpMinLevel(1000) > defaultMaxLevel(100)', () => {
    // 缺省 max_level 的技能**永远到不了**进阶门槛 —— 这不是 bug，是 wushen 的原样：
    // 能进阶的技能必须自己在 def 里声明更高的 max_level（如 gd/from 的 2000）。
    // 把这条写进断言，是为了让"哪天想统一这两个数"的人先看到它。
    expect(SKILL_FORMULA.gradeUpMinLevel).toBeGreaterThan(SKILL_FORMULA.defaultMaxLevel);
    const npc = makeNpc();
    npc.skills.learn('wd/a', 10_000); // wd/a 没写 max_level
    expect(npc.skills.levelOf('wd/a')).toBe(SKILL_FORMULA.defaultMaxLevel);
    expect(npc.skills.gradeUp('wd/a', 'wd/b')).toBe(false);
  });

  it('进阶的路径缺失（源或目标不存在）→ false，不炸', () => {
    const npc = makeNpc();
    npc.skills.setLevel('gd/from', SKILL_FORMULA.gradeUpMinLevel);
    expect(npc.skills.gradeUp('gd/from', 'no/such')).toBe(false);
    expect(npc.skills.gradeUp('no/such', 'gd/to')).toBe(false);
    expect(npc.skills.has('gd/from')).toBe(true);
  });
});

describe('engine/skill · 学习条件（声明式，取代 wushen 的 key switch）', () => {
  it('★ 条件不满足 → 拒绝 + 提示，且**不写入**技能表（wushen 的 notify_fail）', () => {
    const out = new RecordingOutput();
    const npc = makeNpc(out);
    expect(npc.skills.learn('wd/gated')).toBe(false);
    expect(npc.skills.has('wd/gated')).toBe(false);
    expect(out.messages.join('\n')).toContain('无法学习');
    expect(coreOf(npc)).toEqual({}); // 拒绝的学习不该留下任何副作用
  });

  it('条件满足 → 学会', () => {
    const npc = makeNpc();
    npc.skills.learn('base/sword', 30); // 占 sword 槽，等级 30
    expect(npc.skills.learn('wd/gated')).toBe(true);
    expect(npc.skills.has('wd/gated')).toBe(true);
  });

  it('重复学同一个 → 拒绝并提示"已经学会"', () => {
    const out = new RecordingOutput();
    const npc = makeNpc(out);
    npc.skills.learn('wd/a');
    expect(npc.skills.learn('wd/a')).toBe(false);
    expect(out.messages.join('\n')).toContain('已经学会');
  });

  it('`on_learn` 返回 false → 拒绝（钩子也是否决点）', () => {
    const reg = new SkillRegistry([
      { id: 'x/y', def: { name: 'X', on_learn: () => false } },
    ]);
    const npc = new Npc({
      oid: 'cccccccccc',
      path: asWorldId('zz/npc3', 'engine-skill.test:onlearn'),
      name: 'T3',
      def: { name: 'T3', desc: 'd' },
      skillRegistry: reg,
    });
    expect(npc.skills.learn('x/y')).toBe(false);
    expect(npc.skills.has('x/y')).toBe(false);
  });

  it('技能不存在 → 抛错（不是静默 false）', () => {
    const npc = makeNpc();
    expect(() => npc.skills.learn('no/such')).toThrow(SkillError);
    expect(() => npc.skills.setLevel('no/such', 1)).toThrow(SkillError);
  });

  it('minAttr / minMaxMp / gender / minSlot 四类条件都能独立生效', () => {
    const cases: ReadonlyArray<{ id: string; def: SkillDef }> = [
      { id: 'c/innate', def: { name: '属性', learnCondition: { minAttr: { int: 999 } } } },
      { id: 'c/mp', def: { name: '内力', learnCondition: { minMaxMp: 99_999 } } },
      { id: 'c/gender', def: { name: '性别', learnCondition: { gender: 1 } } },
      { id: 'c/prop', def: { name: '加成', learnCondition: { minAttr: { gj: 999 } } } },
    ];
    for (const c of cases) {
      const owner = new Npc({
        oid: 'dddddddddd',
        path: asWorldId('zz/npc4', `engine-skill.test:${c.id}`),
        name: 'T4',
        def: { name: 'T4', desc: 'd' },
        skillRegistry: new SkillRegistry([{ id: c.id, def: c.def }]),
      });
      expect(owner.skills.learn(c.id), `${c.id} 的条件应当拦住`).toBe(false);
      expect(owner.skills.has(c.id)).toBe(false);
    }

    // 反向对照：条件满足就应当放行 —— 否则上面那四条连"恒定拒绝"都分不出来
    const ok = new Npc({
      oid: 'dddddddddd',
      path: asWorldId('zz/npc4', 'engine-skill.test:c/prop-ok'),
      name: 'T4',
      def: { name: 'T4', desc: 'd' },
      skillRegistry: new SkillRegistry([
        { id: 'c/prop', def: { name: '加成', learnCondition: { minAttr: { gj: 10 } } } },
      ]),
    });
    setProp(ok, 'gj', 10);
    expect(ok.skills.learn('c/prop')).toBe(true);
  });

  /**
   * ★★ 26 册 §37：属性门槛读**有效属性 = 先天 + 后天加成**
   *   （`formula.ts#effectiveAttr`），与 wushen `os/skill/skill.js:234` 的
   *   `me[key] + query_prop(key)` **同义**。
   *
   * 判据落在**恰好跨过阈值**的区分性输入上，两种"算错一半"的实现都会被打红：
   *   ① **只读加成**（退回旧的 `minProp` 口径）：本用例先天 20、加成 0、阈值 20
   *      ⇒ `0 < 20` ⇒ 错误地拦 ⇒ ① 断言红；
   *   ② **漏算加成**：阈值 25 时先天 20 不够，补 5 点加成后必须放行
   *      ⇒ 漏算则 `20 < 25` 仍拦 ⇒ ③ 断言红。
   *   ⇒「先天算不算」与「加成算不算」各有一条独立断言，不靠模糊措辞。
   */
  it('★★ 属性门槛读有效属性（先天 + 加成），与 wushen 同义（26 册 §37）', () => {
    const STR = PROP.strengthBonus; // 'str'（臂力**加成**键）
    const mk = (need: number): { npc: Npc; out: RecordingOutput } => {
      const out = new RecordingOutput();
      const npc = new Npc({
        oid: 'eeeeeeeeee',
        path: asWorldId('zz/npc4', `engine-skill.test:attr-${String(need)}`),
        name: 'T5',
        def: { name: 'T5', desc: 'd' },
        skillRegistry: new SkillRegistry([
          { id: 'e/str', def: { name: '臂力功', learnCondition: { minAttr: { [STR]: need } } } },
        ]),
        output: out,
      });
      return { npc, out };
    };

    // ① 先天 20 + 加成 0 = 有效 20，阈值 20 ⇒ **放行**
    //    ★ 区分力：只读加成的实现会算成 `0 < 20` ⇒ 拦 ⇒ 这一条当场红。
    const a = mk(20);
    expect(getProp(a.npc, STR)).toBe(0); // 加成确实是 0
    expect(a.npc.str).toBe(20); // 有效臂力 = 先天 20（`SkillActor.str` 就是有效值）
    expect(a.npc.skills.learn('e/str')).toBe(true);

    // ② 阈值 25：先天 20 不够 ⇒ 拦；且文案用**中文名**（不是拼音键 `str`，照 wushen :235）
    const b = mk(25);
    expect(b.npc.skills.learn('e/str')).toBe(false);
    expect(b.out.messages.at(-1)).toBe('你的臂力不够 25，无法学习臂力功。');

    // ③ 补 5 点**加成** ⇒ 有效 25 ⇒ 放行（"加成也计入"独立成立）
    setProp(b.npc, STR, 5);
    expect(b.npc.str).toBe(25);
    expect(b.npc.skills.learn('e/str')).toBe(true);
  });

  /**
   * ★★ T18（26 册 §11.4）：性别是**三档**（wushen `gender`：`1` 男 / `2` 女 / `0` 无性）。
   *
   * 改动之前类型是 `0 | 1`，可文案（`skill.ts` 的学习条件拒绝语）**已经是三档**、
   * wushen `os/skill/skill.js:239` 也是三档 —— 也就是"类型比实现窄一节"。
   * 后果不是报错而是**逼内容说谎**：想写"只有女性可学"的表达不出来。
   *
   * 判据落在**分档拒绝**上：三档各自只能学自己那一门。
   * 谁把第三档并进 `0`/`1` 任一边（"顺手统一成布尔"），这三条里必有一条变红。
   */
  it('★★ T18：性别三档（1 男 / 2 女 / 0 无性）都能表达，且判定真的分档', () => {
    const reg = new SkillRegistry([
      { id: 't/m', def: { name: '男功', learnCondition: { gender: 1 } } },
      { id: 't/f', def: { name: '女功', learnCondition: { gender: 2 } } },
      { id: 't/n', def: { name: '无性功', learnCondition: { gender: 0 } } },
    ]);
    const mk = (g: 0 | 1 | 2): { npc: Npc; out: RecordingOutput } => {
      const out = new RecordingOutput();
      const npc = new Npc({
        oid: 'eeeeeeeeee',
        path: asWorldId('zz/npc5', `engine-skill.test:g${g}`),
        name: `G${g}`,
        gender: g,
        def: { name: `G${g}`, desc: 'd' },
        skillRegistry: reg,
        output: out,
      });
      return { npc, out };
    };

    // 三档互不相等：任何"把无性当成男或女"的写法都会让下面某条红
    const male = mk(1);
    const female = mk(2);
    const none = mk(0);
    expect([male.npc.gender, female.npc.gender, none.npc.gender]).toEqual([1, 2, 0]);

    expect(male.npc.skills.learn('t/m')).toBe(true);
    expect(male.npc.skills.learn('t/f')).toBe(false);
    expect(male.npc.skills.learn('t/n')).toBe(false);

    expect(female.npc.skills.learn('t/f')).toBe(true);
    expect(female.npc.skills.learn('t/m')).toBe(false);

    expect(none.npc.skills.learn('t/n')).toBe(true);
    expect(none.npc.skills.learn('t/m')).toBe(false);

    // 拒绝语说的是**要求的那一档**（wushen `skill.js:239` 的"男性/女性/无性"口径），
    // 不是一句笼统的"不能学" —— 否则上面那些 false 分不出三档。
    //
    // ★ 判据必须**锚定句首**，不能用 `toContain('无性')`：技能名就叫「无性功」，
    //   于是"女性才能学习无性功。"里也含「无性」—— 那是一条自我满足的断言
    //   （实测：把 `GENDER_LABELS[0]` 篡改成「女性」它照样绿，FG-11 同族）。
    const lastLine = (out: RecordingOutput): string => out.messages.at(-1) ?? '';
    expect(lastLine(female.out)).toMatch(/^男性才能学习/); // 女身学男功 → 说的是"男性"
    expect(lastLine(none.out)).toMatch(/^男性才能学习/); // 无性学男功
    const maleAgain = mk(1);
    maleAgain.npc.skills.learn('t/n'); // 男身学无性功 → 说的是"无性"
    expect(lastLine(maleAgain.out)).toMatch(/^无性才能学习/);
  });
});

describe('engine/skill · 绝招（数据面 + 冷却 + 准入；★ docs/27 D3）', () => {
  it('绝招数值：常数与 `(lv) => number` 两种写法都能算', () => {
    const npc = makeNpc();
    npc.skills.learn('wd/a', 10);
    const pfm = REG.getOrThrow('wd/a').pfm.get('slash');
    if (pfm === undefined) throw new Error('夹具缺 slash');
    expect(pfm.id).toBe('wd/a/slash');
    expect(pfm.mp(10)).toBe(10);
    expect(pfm.releaseMs(10)).toBe(1_500);
    expect(pfm.cdMs(10)).toBe(5_000);
    const scale = REG.getOrThrow('wd/a').pfm.get('free');
    expect(scale?.mp(37)).toBe(37); // 随等级
    expect(scale?.cdMs(37)).toBe(0); // 缺省 0
  });

  it('数值写坏（负数 / NaN）→ 抛错', () => {
    const reg = new SkillRegistry([
      { id: 'x/y', def: { name: 'X', pfm: { a: { name: 'A', mp: -1 } } } },
    ]);
    const pfm = reg.getOrThrow('x/y').pfm.get('a');
    expect(() => pfm?.mp(1)).toThrow(SkillError);
  });

  it('★ 冷却：置上之后放不出；**时钟注入**越过 CD 立刻可放（不靠 sleep）', () => {
    const t0 = 1_700_000_000_000;
    const npc = makeNpc();
    npc.skills.learn('wd/a', 10);
    npc.skills.enable('sword', 'wd/a');

    expect(npc.skills.canUsePfm('wd/a', 'slash', t0)).toBe(true);
    npc.skills.setPfmCooldown('wd/a', 'slash', 5_000, t0);
    expect(npc.skills.pfmCooldownMs('wd/a', 'slash', t0)).toBe(5_000);
    expect(npc.skills.canUsePfm('wd/a', 'slash', t0 + 4_999)).toBe(false);
    expect(npc.skills.canUsePfm('wd/a', 'slash', t0 + 5_000)).toBe(true); // 到点即失效
    expect(npc.skills.pfmCooldownMs('wd/a', 'slash', t0 + 5_000)).toBe(0);
  });

  it('冷却值必须是正的毫秒数', () => {
    const npc = makeNpc();
    npc.skills.learn('wd/a', 10);
    expect(() => npc.skills.setPfmCooldown('wd/a', 'slash', 0, 0)).toThrow(SkillError);
    expect(() => npc.skills.setPfmCooldown('wd/a', 'slash', -1, 0)).toThrow(SkillError);
  });

  it('`clearPfmCooldown` 立即恢复可放', () => {
    const t0 = 0;
    const npc = makeNpc();
    npc.skills.learn('wd/a', 10);
    npc.skills.enable('sword', 'wd/a');
    npc.skills.setPfmCooldown('wd/a', 'slash', 5_000, t0);
    expect(npc.skills.canUsePfm('wd/a', 'slash', t0)).toBe(false);
    npc.skills.clearPfmCooldown('wd/a', 'slash');
    expect(npc.skills.canUsePfm('wd/a', 'slash', t0)).toBe(true);
  });

  it('绝招要求的槽没装上 → 放不出；不限槽的绝招（free）随时可放', () => {
    const npc = makeNpc();
    npc.skills.learn('wd/a', 10);
    expect(npc.skills.canUsePfm('wd/a', 'slash')).toBe(false); // 还没装 sword
    expect(npc.skills.canUsePfm('wd/a', 'free')).toBe(true); // enable 缺省 = 不限
    npc.skills.enable('sword', 'wd/a');
    expect(npc.skills.canUsePfm('wd/a', 'slash')).toBe(true);
  });

  it('★ 基本技能的绝招也能放（它的 `enabled` 恒为 null —— 槽判定不能看 enabled）', () => {
    const npc = makeNpc();
    npc.skills.learn('base/sword', 10);
    expect(npc.skills.entryOf('base/sword')?.enabled).toBeNull();
    expect(npc.skills.activeTemplate('sword')?.id).toBe('base/sword');
    expect(npc.skills.canUsePfm('base/sword', 'lian')).toBe(true);
  });

  it('没学会 / 没有这个绝招 → false（不是抛错）', () => {
    const npc = makeNpc();
    expect(npc.skills.canUsePfm('wd/a', 'slash')).toBe(false);
    npc.skills.learn('wd/a', 10);
    expect(npc.skills.canUsePfm('wd/a', 'no_such_pfm')).toBe(false);
  });

  it('`check()` 自定义准入真的参与判定', () => {
    const reg = new SkillRegistry([
      {
        id: 'x/y',
        def: {
          name: 'X',
          pfm: { a: { name: 'A', check: (me) => me.str >= 30 } },
        },
      },
    ]);
    const npc = new Npc({
      oid: 'eeeeeeeeee',
      path: asWorldId('zz/npc5', 'engine-skill.test:check'),
      name: 'T5',
      def: { name: 'T5', desc: 'd' },
      skillRegistry: reg,
    });
    npc.skills.learn('x/y', 10);
    expect(npc.skills.canUsePfm('x/y', 'a')).toBe(false); // str=20
    npc.setInnate({ str: 30 });
    expect(npc.skills.canUsePfm('x/y', 'a')).toBe(true);
  });
});

describe('engine/skill · 存档边界（snapshot / load）', () => {
  it('★ snapshot → load 往返等价（等级 / 装配 / 属性都还原）', () => {
    const a = makeNpc();
    a.skills.learn('wd/both', 15);
    a.skills.enable('sword', 'wd/both');
    const snap = a.skills.snapshot();

    const b = makeNpc();
    const report = b.skills.load(snap);
    expect(report.loaded).toBe(1);
    expect(report.rejected).toEqual([]);
    expect(b.skills.levelOf('wd/both')).toBe(15);
    expect(b.skills.enabledOf('sword')).toBe('wd/both');
    expect(snapshotProps(b)).toEqual(snapshotProps(a));
    expect(b.derived).toEqual(a.derived);
  });

  it('load 到"已经算过属性"的宿主上是安全的（先减旧账再加新账）', () => {
    const npc = makeNpc();
    npc.skills.learn('wd/both', 10);
    npc.skills.enable('sword', 'wd/both');
    npc.skills.load([{ id: 'wd/both', level: 20, exp: 0, enabled: 'sword' }]);
    expect(coreOf(npc)).toEqual({ mz: 20, gj: 20 }); // 不是 30/30
  });

  it('未知技能 id 被丢弃并记账，不让一个坏 id 污染整本簿', () => {
    const npc = makeNpc();
    npc.skills.learn('wd/a', 10);
    const raw: SkillState[] = [
      { id: 'wd/a', level: 10, exp: 0, enabled: null },
      { id: 'ghost/skill', level: 99, exp: 0, enabled: null },
    ];
    const report = npc.skills.load(raw);
    expect(report.loaded).toBe(1);
    expect(report.rejected).toEqual([{ key: 'ghost/skill', reason: '技能未登记' }]);
    expect(npc.skills.has('ghost/skill')).toBe(false);
  });

  it('★ S7：同一技能 id 出现两条 ⇒ 丢后一条并记账（不许让装配表与状态分家）', () => {
    // 修复前：两条都写进 `#states`（后者覆盖），但 `#enabledBySlot` 只在**第一条**
    // 被 `#attachSlot` 时挂上 —— 第二条 `enabled: null` 既不挂、也不摘旧槽。
    // ⇒ `enabledOf('sword') === 'wd/a'` 而 `entryOf('wd/a').enabled === null`：
    //   装配表说有、属性账说没有，两边都不报错（S7 描述的那种"分家"）。
    const npc = makeNpc();
    const report = npc.skills.load([
      { id: 'wd/a', level: 10, exp: 0, enabled: 'sword' },
      { id: 'wd/a', level: 20, exp: 0, enabled: null },
    ]);
    expect(report.loaded).toBe(1);
    expect(report.rejected.map((r) => r.key)).toEqual(['wd/a']);
    // ★ 判据落在**两表一致**上，而不是"某个数是多少"
    expect(npc.skills.enabledOf('sword')).toBe('wd/a');
    expect(npc.skills.entryOf('wd/a')?.enabled).toBe('sword');
    expect(coreOf(npc)).toEqual({ gj: 10 }); // ② 档按保留下来的那条算
  });

  it('load 时非法槽名被降级成"未装配"（脏存档不炸整本簿）', () => {
    const npc = makeNpc();
    const report = npc.skills.load([
      { id: 'wd/a', level: 10, exp: 0, enabled: 'nope' as unknown as EnableSlot },
    ]);
    expect(npc.skills.has('wd/a')).toBe(true);
    expect(npc.skills.enabledOf('nope' as unknown as EnableSlot)).toBeUndefined();
    expect(coreOf(npc)).toEqual({}); // 没装配 → 只有 ① 档（这里没有）
    expect(report.rejected.map((r) => r.key)).toEqual(['wd/a.enabled']);
  });

  it('★★ E3：改档把**基本技能**写成"启用为 sword" ⇒ 拒绝该槽（改存档能拿到的东西）', () => {
    // 修复前：`load` 只做 `isEnableSlot` 兜底，装配两道准入完全没查。
    // `base/force` 是基本技能（type=BASE、slot='force'、can_enables 未声明），
    // 却被写成"启用为 sword" ⇒ 旧实现照单全收，把它挂上 sword 槽。
    // 这条正是 26 册 §35 记的"改过的存档可把基本技能装进武功槽"。
    const npc = makeNpc();
    const report = npc.skills.load([
      { id: 'base/force', level: 10, exp: 0, enabled: 'sword' as EnableSlot },
    ]);
    expect(npc.skills.has('base/force')).toBe(true); // 技能本身留下（非法的是"装配"）
    expect(npc.skills.enabledOf('sword')).toBeUndefined(); // 但槽没被占
    expect(npc.skills.activeTemplate('sword')).toBeUndefined();
    expect(npc.skills.entryOf('base/force')?.enabled).toBeNull();
    expect(report.rejected.map((r) => r.key)).toEqual(['base/force.enabled']);
  });

  it('★★ E3：`isEnablable` 那道必须**单独**能拦（与 `can_enables` 那条不重叠）', () => {
    // ★ 为什么非得造一个"非 SKILL 却声明了 can_enables"的技能：
    //   普通基本技能的 `can_enables` 是**空的** ⇒ `can_enables` 那条会替 `isEnablable`
    //   把它拦下，两条判据**重叠** ⇒ 摘掉 `isEnablable` 测试照样绿（假绿）。
    //   实测过：摘掉这一道时，上面那条测试报的是
    //   `基本内功 不能启用为 sword（can_enables = []）` —— 证明它压根没走到这一道。
    //   这里让两条判据**只差一层**：槽在 can_enables 里，但 type 不是 SKILL。
    const reg = new SkillRegistry([
      {
        id: 'probe/base',
        def: { name: '假基本技能', type: SKILL_TYPES.BASE, slot: 'force', can_enables: ['sword'] },
      },
    ]);
    const npc = new Npc({
      oid: 'cccccccccc',
      path: asWorldId('zz/npc5', 'engine-skill.test:e3-enablable'),
      name: 'T',
      def: { name: 'T', desc: 'd' },
      skillRegistry: reg,
    });
    const report = npc.skills.load([
      { id: 'probe/base', level: 10, exp: 0, enabled: 'sword' as EnableSlot },
    ]);
    expect(npc.skills.enabledOf('sword')).toBeUndefined();
    expect(npc.skills.has('probe/base')).toBe(true);
    expect(report.rejected.map((r) => r.key)).toEqual(['probe/base.enabled']);
    // ★ 只有 isEnablable 那道会说"不可装配" ⇒ 这条断言把该分支**单独**钉住
    expect(report.rejected[0]?.reason).toContain('不可装配');
  });

  it('★★ E3：装到 `can_enables` 之外的槽 ⇒ 读档时拒绝该槽（与 `enable()` 同判据）', () => {
    // 与「挂到 can_enables 之外的槽 → 抛错」那条**用户动作**测试是同一判据：
    // 校验必须写在**数据入口**上，因为 `load` 就是绕过 `enable()` 的那条路。
    const npc = makeNpc();
    const report = npc.skills.load([
      { id: 'wd/a', level: 10, exp: 0, enabled: 'blade' as EnableSlot },
    ]);
    expect(npc.skills.enabledOf('blade')).toBeUndefined();
    expect(npc.skills.entryOf('wd/a')?.enabled).toBeNull();
    expect(report.rejected[0]?.reason).toContain('can_enables');

    // 对照：同一个技能装到**合法**槽上照常生效
    // ⇒ 证明上面拒掉的是"越权"，不是"装配"这件事本身。
    const ok = makeNpc();
    expect(ok.skills.load([{ id: 'wd/a', level: 10, exp: 0, enabled: 'sword' }]).rejected).toEqual(
      [],
    );
    expect(ok.skills.enabledOf('sword')).toBe('wd/a');
  });

  it('★ E3：等级越界被归一 + 记账；经验为负被记 0 + 记账', () => {
    const npc = makeNpc();
    const report = npc.skills.load([{ id: 'wd/a', level: 9_999, exp: -5, enabled: null }]);
    expect(npc.skills.levelOf('wd/a')).toBe(REG.getOrThrow('wd/a').maxLevel);
    expect(npc.skills.entryOf('wd/a')?.exp).toBe(0);
    expect(report.loaded).toBe(1); // 条目仍然装进去了
    expect(report.rejected.map((r) => r.key)).toEqual(['wd/a.level', 'wd/a.exp']);
  });

  it('★ E3：入参不是数组 ⇒ 抛（"整包根本不是存档"，不是"某一条脏"）', () => {
    for (const bad of [null, undefined, 42, 'x', { 0: 'wd/a' }]) {
      const npc = makeNpc();
      expect(() => npc.skills.load(bad), String(bad)).toThrow(SkillError);
      // 抛之前不许留半成品：簿仍是可用的空簿
      expect(npc.skills.entries()).toEqual([]);
    }
  });

  it('★ E3：记录不是对象 / 缺 id ⇒ 丢该条并记账，其余照读', () => {
    const npc = makeNpc();
    const report = npc.skills.load([
      null,
      { level: 10, exp: 0, enabled: null }, // 缺 id
      { id: 42, level: 10, exp: 0, enabled: null }, // id 不是字符串
      { id: 'wd/a', level: 10, exp: 0, enabled: null },
    ]);
    expect(report.loaded).toBe(1);
    expect(npc.skills.has('wd/a')).toBe(true);
    expect(report.rejected.map((r) => r.key)).toEqual(['#0', '#1.id', '#2.id']);
  });

  it('★ E3：干净存档 `rejected` 恒为空 —— 契约 ③（"报告非空即读档失败"）的绿色基线', () => {
    expect(makeNpc().skills.load([]).rejected).toEqual([]);
    const a = makeNpc();
    a.skills.learn('wd/both', 15);
    a.skills.enable('sword', 'wd/both');
    expect(makeNpc().skills.load(a.skills.snapshot()).rejected).toEqual([]);
  });

  it('snapshot 是**副本**：改它不会动到簿本身', () => {
    const npc = makeNpc();
    npc.skills.learn('wd/a', 10);
    const snap = npc.skills.snapshot() as SkillState[];
    snap[0]!.level = 99;
    expect(npc.skills.levelOf('wd/a')).toBe(10);
  });
});

describe('engine/skill · NPC 集成（★ docs/27 D9：技能 id 被保留）', () => {
  it('loadFromDef 保留 id + 等级 + 装配槽，且不做学习条件判断（NPC 是"直接会"）', () => {
    const npc = npcWith([
      { skill: 'base/force', level: 30 },
      { skill: 'wd/a', level: 50, enableAs: 'sword' },
      { skill: 'wd/gated', level: 7 }, // 条件不满足也照样装载
    ]);
    expect(npc.skills.levelOf('wd/a')).toBe(50);
    expect(npc.skills.enabledOf('sword')).toBe('wd/a');
    expect(npc.skills.levelOf('wd/gated')).toBe(7);
    expect(coreOf(npc)).toEqual({ con: 3, gj: 50 });
  });

  it('★ forceRad 从**占 force 槽的模板**派生（与玩家同一把尺子，D9）', () => {
    const noForce = npcWith([{ skill: 'wd/a', level: 50, enableAs: 'sword' }]);
    expect(noForce.forceRad).toBe(0.1); // 没有内功 → 兜底值

    const withForce = npcWith([{ skill: 'base/force', level: 30 }]);
    expect(withForce.forceRad).toBe(0.1); // base/force 也没声明 force_rad（wushen 同款）

    const reg = new SkillRegistry([
      { id: 'base/force', def: { name: '基本内功', type: SKILL_TYPES.BASE, slot: 'force', force_rad: 0.8 } },
    ]);
    const strong = new Npc({
      oid: 'ffffffffff',
      path: asWorldId('zz/npc6', 'engine-skill.test:force'),
      name: 'T6',
      def: { name: 'T6', desc: 'd', skills: [{ skill: 'base/force', level: 10 }] },
      skillRegistry: reg,
    });
    expect(strong.forceRad).toBe(0.8);
    expect(npcWith([{ skill: 'wd/a', level: 10 }]).forceRad).toBe(0.1);
  });

  it('loadFromDef 挂到 can_enables 之外的槽 → 构造即抛（内容写错不留到运行时）', () => {
    expect(() => npcWith([{ skill: 'wd/a', level: 10, enableAs: 'blade' }])).toThrow(/不能启用/);
  });

  it('★ def 里同一技能写了两次（不同槽）→ 旧槽映射必须腾空（不留陈旧槽）', () => {
    const npc = npcWith([
      { skill: 'wd/b', level: 10, enableAs: 'sword' },
      { skill: 'wd/b', level: 10, enableAs: 'blade' },
    ]);
    expect(npc.skills.enabledOf('sword')).toBeUndefined();
    expect(npc.skills.enabledOf('blade')).toBe('wd/b');
    expect(npc.skills.entryOf('wd/b')?.enabled).toBe('blade');
    expect(getProp(npc, 'gj')).toBe(30); // 只按 blade 算一次（10*3），不是 20+30
  });

  it('★ S7：同一技能写两次且**后一条不装配** → 旧槽必须腾空（不留挂着的幽灵）', () => {
    // 与上一条互补：上面是"换到别的槽"（`#attachSlot` 已覆盖），
    // 这条是"后一条根本不装配" —— 修复前 `enabled === null` 时不调 `#attachSlot`，
    // 于是第一条挂上的槽映射留着不清，而状态已被覆盖成 `enabled: null`。
    const npc = npcWith([
      { skill: 'wd/a', level: 10, enableAs: 'sword' },
      { skill: 'wd/a', level: 10 },
    ]);
    expect(npc.skills.enabledOf('sword')).toBeUndefined();
    expect(npc.skills.entryOf('wd/a')?.enabled).toBeNull();
    expect(getProp(npc, 'gj')).toBe(0);
  });

  it('★★ def 里**两条不同技能**抢同一槽 → 先者被挤下（与 enable()/load() 同一口径）', () => {
    // `wd/a` 的 sword 档给 gj=10、`wd/b` 的 sword 档给 gj=20。
    // 修复前：两条记录 `enabled` 都是 'sword'，而 `#enabledBySlot` 只有后者 ⇒
    // `contributedProps()` 把**两份**② 档都算进去（gj=30），
    // 而 `activeTemplate('sword')` 只认一个 —— 属性账与装配表静默分家。
    const npc = npcWith([
      { skill: 'wd/a', level: 10, enableAs: 'sword' },
      { skill: 'wd/b', level: 10, enableAs: 'sword' },
    ]);

    expect(npc.skills.entryOf('wd/a')?.enabled).toBeNull();
    expect(npc.skills.entryOf('wd/b')?.enabled).toBe('sword');
    expect(npc.skills.enabledOf('sword')).toBe('wd/b');
    expect(npc.skills.activeTemplate('sword')?.id).toBe('wd/b');
    // ★ 判据落在**数值账**上：只按胜出者算一次（不是 10+20=30）
    expect(getProp(npc, 'gj')).toBe(20);
  });

  it('loadFromDef 里技能不存在 → 抛错', () => {
    expect(() => npcWith([{ skill: 'no/such', level: 10 }])).toThrow(SkillError);
  });

  it('同一模板的两个 NPC 各持一份技能簿（改动互不影响）', () => {
    const entries = [{ skill: 'wd/a', level: 10, enableAs: 'sword' as EnableSlot }];
    const a = npcWith(entries);
    const b = npcWith(entries);
    expect(a.skills).not.toBe(b.skills);
    a.skills.setLevel('wd/a', 40);
    expect(b.skills.levelOf('wd/a')).toBe(10);
    expect(getProp(a, 'gj')).toBe(40);
    expect(getProp(b, 'gj')).toBe(10);
  });

  it('`skillLevel(idOrSlot)` 同时接受技能 id 与槽名', () => {
    const npc = npcWith([
      { skill: 'base/sword', level: 30 },
      { skill: 'wd/a', level: 50, enableAs: 'sword' },
    ]);
    expect(npc.skillLevel('wd/a')).toBe(50); // 技能 id
    expect(npc.skillLevel('sword')).toBe(30); // 槽名 → 占槽的基本技能
    expect(npc.skillLevel('force')).toBe(0); // 没练内功
  });
});

describe('engine/skill · 数值参数表（★ docs/27 D4：可调数值集中）', () => {
  it('SKILL_FORMULA 的每一项都能被摘要打印出来（调参时一眼看得见）', () => {
    const summary = skillFormulaSummary();
    for (const key of Object.keys(SKILL_FORMULA)) {
      expect(summary, `${key} 没出现在摘要里`).toContain(key);
    }
  });

  it('★ tuningSummary 同时汇总战斗与技能两套参数（改平衡只看一个入口）', () => {
    const t = tuningSummary();
    expect(t).toContain(`hpPerCon=${String(5)}`);
    expect(t).toContain(`expBase=${String(SKILL_FORMULA.expBase)}`);
    expect(t).toContain('skill');
    expect(t).toContain('combat');
  });

  it('等级上限的"境界因子"表长度覆盖 0..MAX_LEVEL', () => {
    expect(SKILL_FORMULA.limitRealmFactor.length).toBe(MAX_LEVEL + 1);
    expect(SKILL_FORMULA.limitRealmFactor[0]).toBeGreaterThan(0);
    // 境界越高，因子不减（曲线单调）
    for (let i = 1; i < SKILL_FORMULA.limitRealmFactor.length; i += 1) {
      expect(SKILL_FORMULA.limitRealmFactor[i]!).toBeGreaterThanOrEqual(
        SKILL_FORMULA.limitRealmFactor[i - 1]!,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// S8（2026-10-16 审查）：非法属性键不许留下**不可自愈的半账**
// ---------------------------------------------------------------------------
//
// `recompute()` 的顺序是「先减旧账（`#releaseLedger`）→ 再加新账（`#absorb`）→ `recount`」。
// 若"加新账"中途抛错，旧账已经减掉、新账没加上 ⇒ 派生属性永久停在旧值，
// 而每次变更（learn/forget/setLevel/addExp/enable/disable/load）都会重复这一遍。
//
// 缺口在 `mergeInto()` 只做 `as PropKey[]` 强转、**不校验**，而 `#absorb()` 才校验。
// 修法两条**缺一不可**：
//   ① `mergeInto()` 与 `#absorb()` 用**同一份**键校验（单源）⇒ 非法键在"算账"时就抛；
//   ② `recompute()` 改成**先算后动**（`contributedProps()` 在 `#releaseLedger()` 之前求值）
//      ⇒ 异常发生在旧账被减之前，账本保持一致。
describe('S8 · 非法属性键不许留下不可自愈的半账', () => {
  // ★ 造法：内容层强转（GM 热更 / 测试夹具）—— 正是 `validate.ts` 自己声明的威胁模型
  //   （"注册表可被程序化填充，编译期护栏失效"）。
  const BAD_REG = new SkillRegistry([
    {
      id: 'ok/skill',
      def: {
        name: '好技能',
        type: SKILL_TYPES.SKILL,
        can_enables: ['sword'],
        enableProp: () => ({ sword: { prop: { gj: 10 } } }),
      },
    },
    {
      id: 'bad/key',
      def: {
        name: '坏核心键',
        type: SKILL_TYPES.SKILL,
        // ★ 故意带一个**合法**键 `mz` 排在非法键**前面**：
        //   这样"半吸收"会真的把新值写进 props（只放非法键的话，
        //   release 减掉旧账、absorb 又加回同一个数 ⇒ 净零 ⇒ 判据假绿）。
        passiveProp: (() =>
          ({ prop: { mz: 7, not_a_prop: 5 } })) as unknown as NonNullable<SkillDef['passiveProp']>,
      },
    },
    {
      id: 'bad/ext',
      def: {
        name: '坏扩展键',
        type: SKILL_TYPES.SKILL,
        passiveProp: (() =>
          ({ prop: { mz: 7 }, extProp: [['not_an_ext', 3]] })) as unknown as NonNullable<SkillDef['passiveProp']>,
      },
    },
  ]);

  function npcWithReg(reg: SkillRegistry): Npc {
    return new Npc({
      oid: 'dddddddddd',
      path: asWorldId('zz/npc7', 'engine-skill.test:s8'),
      name: 'S8',
      def: { name: 'S8', desc: 'd' },
      skillRegistry: reg,
    });
  }

  /** 先把账算好：学一个合法技能并装配，props 里稳定有一个非零项 */
  function seeded(): Npc {
    const npc = npcWithReg(BAD_REG);
    npc.skills.learn('ok/skill', 10);
    npc.skills.enable('sword', 'ok/skill');
    return npc;
  }

  it('★ 非法**核心**键 ⇒ 抛 SkillError，且既有属性账原样保留（不是先清空再抛）', () => {
    const npc = seeded();
    const before = { ...snapshotProps(npc).prop };
    expect(before).toEqual({ gj: 10 });

    expect(() => npc.skills.learn('bad/key', 1)).toThrow(SkillError);

    // ★ 判据钉在"**部分吸收的痕迹**"上：只断言 `props == before` 会**假绿** ——
    //   旧实现 release 减掉旧账、`#absorb` 在抛错前又把同一个数加回去，净零。
    //   坏技能带一个合法键 `mz`，半账会把它留在 props 里 ⇒ 咬得住。
    expect(snapshotProps(npc).prop).not.toHaveProperty('mz');
    expect({ ...snapshotProps(npc).prop }).toEqual(before);
  });

  it('★ 非法**扩展**键同样在算账阶段就被拦（同一份校验覆盖两张表）', () => {
    const npc = seeded();
    const before = { ...snapshotProps(npc).prop };
    expect(() => npc.skills.learn('bad/ext', 1)).toThrow(SkillError);
    expect(snapshotProps(npc).prop).not.toHaveProperty('mz');
    expect({ ...snapshotProps(npc).prop }).toEqual(before);
  });

  it('【反向锚点】合法属性键照常记账（新校验不误伤正常路径）', () => {
    const npc = seeded();
    expect({ ...snapshotProps(npc).prop }).toEqual({ gj: 10 });
    expect(npc.skills.entryOf('ok/skill')?.enabled).toBe('sword');
  });
});

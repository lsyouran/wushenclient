/**
 * 基本技能的 ① 档被动曲线 + 6 门技能的真实数值
 * ============================================================================
 * 为什么单独一个文件：2026-10-18 把技能上限交给**经验换算**（`levelLimit`），
 * 同时**不再照抄** wushen 的线性被动（`lv/10`、`zj = lv`）—— 那条曲线在 1000 级
 * 会给出「先天属性 +100 / 派生值 +1000」，而先天只有 20、对抗公式差 2 倍就是绝对碾压。
 *
 * 曲线是三版演进的结果（凹 → 凸的转折见 `server/world/skill-curves.ts` 文件头）：
 *   · 线性（wushen）：后期数值通胀；
 *   · 平方根（本批第一版）：**方向反了** —— 成本涨 1000 倍而收益反而变慢；
 *   · 幂律（本版）：后期更难，但后期每级也更值钱。
 *
 * 本文件钉五件事：
 *   1. **曲线数值表**（`attrPassive` / `derivedPassive`）；
 *   2. ★★ **凸性** —— 后半程的增量必须大于前半程（"越到后期加成越大"）；
 *   3. ★★ **单位成本递增** —— 换 1 点加成所需的角色经验越来越高（"越到后期越难"）；
 *      2 和 3 必须**同时**成立，这正是用户要的那句话的算术形态；
 *   4. **技能上限由经验换算**（1000 只是硬顶，不是人人都能到），且硬顶 = 曲线标定点；
 *   5. ★★ **曲线真的被派生公式消费** —— 学满 6 门之后逐项写死派生值。
 *
 * 第 5 条是"谁在照它做"的答案：改曲线不改这条断言 ⇒ 变异样本会报假绿。
 */
import { describe, expect, it } from 'vitest';

// 副作用导入：触发真实内容注册（下面直接用 `entriesOf('skill')` 读真实技能表）
import '@world/index.js';

import { asWorldId } from '../shared/ids.js';
import { ENABLE_SLOTS, SKILL_TYPES } from '../shared/constants.js';
import type { EnableSlot } from '../shared/constants.js';
import { Npc } from '../server/engine/npc.js';
import { entriesOf } from '../server/engine/registry.js';
import { SKILL_FORMULA, SkillRegistry, levelLimit } from '../server/engine/skill.js';
import { SKILL_CURVE, attrPassive, derivedPassive } from '../server/world/skill-curves.js';
import type { SkillDef } from '../server/world/defs.js';

// ── 真实内容的技能注册表（不是自造夹具：这里断言的就是 world/ 里那 6 份文件）──
const REG = new SkillRegistry(entriesOf('skill').map((e) => ({ id: e.id, def: e.def as SkillDef })));

/** 造一个"什么技能都不会"的裸角色（先天全 20 / 内力 100，与 `Character` 缺省一致） */
function bare(): Npc {
  return new Npc({
    oid: 'cccccccccc',
    path: asWorldId('zz/npc', 'skill-curves:bare'),
    name: '裸角色',
    def: { name: '裸角色', desc: 'd' },
    skillRegistry: REG,
  });
}

/** 造一个"学满 6 门基本武学到 lv 级"的角色 */
function learned(lv: number): Npc {
  return new Npc({
    oid: 'dddddddddd',
    path: asWorldId('zz/npc', 'skill-curves:learned'),
    name: '练家子',
    def: {
      name: '练家子',
      desc: 'd',
      skills: [
        { skill: 'base/force', level: lv },
        { skill: 'base/dodge', level: lv },
        { skill: 'base/parry', level: lv },
        { skill: 'base/unarmed', level: lv },
        { skill: 'base/sword', level: lv },
        { skill: 'base/blade', level: lv },
      ],
    },
    skillRegistry: REG,
  });
}

// ── 曲线本体 ────────────────────────────────────────────────────────────────

describe('基本技能曲线 · attrPassive / derivedPassive（幂律，凸）', () => {
  it('数值表（1000 级 = 属性 +60 / 派生 +120）', () => {
    const attr: ReadonlyArray<readonly [number, number]> = [
      [1, 0],
      [20, 0],
      [30, 1],
      [50, 2],
      [80, 3],
      [100, 4],
      [150, 7],
      [200, 10],
      [300, 15],
      [400, 21],
      [500, 27],
      [700, 40],
      [1000, 60],
    ];
    for (const [lv, want] of attr) expect([lv, attrPassive(lv)]).toEqual([lv, want]);

    const derived: ReadonlyArray<readonly [number, number]> = [
      [1, 0],
      [20, 0],
      [30, 1],
      [50, 2],
      [80, 4],
      [100, 6],
      [200, 14],
      [300, 25],
      [400, 36],
      [500, 48],
      [700, 75],
      [1000, 120],
    ];
    for (const [lv, want] of derived) expect([lv, derivedPassive(lv)]).toEqual([lv, want]);
  });

  it('★★ 凸性：后半程的增量大于前半程（"越到后期加成越大"）', () => {
    // 前半程 0→500，后半程 500→1000。等级跨度相同，增量必须更大。
    expect(derivedPassive(1000) - derivedPassive(500)).toBeGreaterThan(
      derivedPassive(500) - derivedPassive(0),
    );
    expect(attrPassive(1000) - attrPassive(500)).toBeGreaterThan(attrPassive(500) - attrPassive(0));
    // 每级平均增量：末段（800→1000）必须大于中段（100→200）
    const derivedLate = (derivedPassive(1000) - derivedPassive(800)) / 200;
    const derivedMid = (derivedPassive(200) - derivedPassive(100)) / 100;
    expect(derivedLate).toBeGreaterThan(derivedMid);
    const attrLate = (attrPassive(1000) - attrPassive(800)) / 200;
    const attrMid = (attrPassive(200) - attrPassive(100)) / 100;
    expect(attrLate).toBeGreaterThan(attrMid);
  });

  it('★★ 单位成本递增：换 1 点派生所需的**角色经验**越来越高（"越到后期越难"）', () => {
    // `levelLimit(exp) = cbrt(exp * 10)` ⇒ 反解 exp = lv³ / 10
    const expFor = (lv: number): number => lv ** 3 / 10;
    const expPerPoint = (lv: number): number => expFor(lv) / derivedPassive(lv);
    expect(expPerPoint(200)).toBeGreaterThan(expPerPoint(100));
    expect(expPerPoint(400)).toBeGreaterThan(expPerPoint(200));
    expect(expPerPoint(1000)).toBeGreaterThan(expPerPoint(400));
  });

  it('单调不减：等级越高，加成只会更多', () => {
    for (let lv = 1; lv < 1000; lv += 1) {
      expect(attrPassive(lv + 1)).toBeGreaterThanOrEqual(attrPassive(lv));
      expect(derivedPassive(lv + 1)).toBeGreaterThanOrEqual(derivedPassive(lv));
    }
  });

  it('0 / 负数 / NaN / Infinity 一律给 0（内容层写坏一个等级时不许污染 recount）', () => {
    for (const bad of [0, -1, -1000, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(attrPassive(bad)).toBe(0);
      expect(derivedPassive(bad)).toBe(0);
    }
  });

  it('超出标定等级按标定点截断（NPC 的 skillLimit 是 Infinity，需要这道保险）', () => {
    expect(attrPassive(5000)).toBe(attrPassive(1000));
    expect(derivedPassive(5000)).toBe(derivedPassive(1000));
  });

  it('数值上界：属性不超 70、派生不超 130（防"属性通胀"，改数前先改设计）', () => {
    expect(attrPassive(1000)).toBeLessThanOrEqual(70);
    expect(derivedPassive(1000)).toBeLessThanOrEqual(130);
    // 派生与属性的比例 —— 派生是加数、属性是乘数，所以派生必须更大
    expect(SKILL_CURVE.derivedAtRef).toBeGreaterThan(SKILL_CURVE.attrAtRef);
    // 属性指数必须比派生指数小：属性是乘数，太凸会变成气血通胀
    expect(SKILL_CURVE.attrExponent).toBeLessThan(SKILL_CURVE.derivedExponent);
  });
});

// ── 上限由经验换算 ──────────────────────────────────────────────────────────

describe('★★ 技能上限由角色经验换算（1000 只是硬顶）', () => {
  it('境界 0 下，上限 = round(cbrt(exp × 10))', () => {
    expect(levelLimit(800, 0)).toBe(20); // cbrt(8000) = 20
    expect(levelLimit(100_000, 0)).toBe(100); // cbrt(1e6) = 100
    expect(levelLimit(800_000, 0)).toBe(200); // cbrt(8e6) = 200
  });

  it('经验是**立方**关系：上限翻倍要 8 倍经验（"越到后期越难突破"）', () => {
    // `levelLimit` 反解：exp = lv³ / 10
    const expFor = (lv: number): number => lv ** 3 / 10;
    expect(levelLimit(expFor(100), 0)).toBe(100);
    expect(levelLimit(expFor(200), 0)).toBe(200);
    expect(expFor(200) / expFor(100)).toBe(8);
    expect(expFor(400) / expFor(200)).toBe(8);
  });

  it('硬顶 = 曲线标定点：再多的经验也停在同一级（两处单源）', () => {
    expect(SKILL_FORMULA.limitMaxLevel).toBe(SKILL_CURVE.refLevel);
    expect(levelLimit(10 ** 12, 6)).toBe(SKILL_CURVE.refLevel);
    // ★ "练满就拿满额"—— 若硬顶与标定点漂移，这一条会红
    expect(attrPassive(levelLimit(10 ** 12, 6))).toBe(SKILL_CURVE.attrAtRef);
    expect(derivedPassive(levelLimit(10 ** 12, 6))).toBe(SKILL_CURVE.derivedAtRef);
  });

  it('境界把同一份经验放大（但不超过硬顶）', () => {
    expect(levelLimit(100_000, 6)).toBeGreaterThan(levelLimit(100_000, 0));
    expect(levelLimit(100_000, 6)).toBeLessThanOrEqual(SKILL_CURVE.refLevel);
  });
});

// ── 内容层落地 ──────────────────────────────────────────────────────────────

describe('6 门基本技能 · 内容层落地', () => {
  const EXPECTED: ReadonlyArray<readonly [string, EnableSlot, string]> = [
    ['base/force', 'force', '基本内功'],
    ['base/dodge', 'dodge', '基本轻功'],
    ['base/parry', 'parry', '基本招架'],
    ['base/unarmed', 'unarmed', '基本拳脚'],
    ['base/sword', 'sword', '基本剑法'],
    ['base/blade', 'blade', '基本刀法'],
  ];

  it('六门都在注册表里，各自的槽、类型、上限都对', () => {
    for (const [id, slot, name] of EXPECTED) {
      const tpl = REG.get(id);
      expect(tpl, `${id} 未注册`).not.toBeUndefined();
      expect(tpl?.name).toBe(name);
      expect(tpl?.slot).toBe(slot);
      expect(tpl?.type).toBe(SKILL_TYPES.BASE);
      // ★ 模板上限引用曲线标定点，不是写死的 1000
      expect(tpl?.maxLevel).toBe(SKILL_CURVE.refLevel);
      expect(tpl?.grade).toBe(0);
    }
  });

  it('每个基本技能都声明了 ① 档被动（没有被动 = 练了白练）', () => {
    for (const [id] of EXPECTED) {
      const def = entriesOf('skill').find((e) => e.id === id)?.def as SkillDef | undefined;
      expect(def?.passiveProp, `${id} 缺 passiveProp`).toBeTypeOf('function');
      // 100 级已经能拿到非零加成（中低等级内容配置也要有感）
      const p = def?.passiveProp?.(100)?.prop;
      expect(p, `${id} 在 100 级没有给出任何属性`).toBeDefined();
      expect(Object.values(p ?? {}).some((v) => v > 0), `${id} 的被动全是 0`).toBe(true);
    }
  });

  it('★ 属性键走 `PROP` 别名（裸拼音键是数据契约，但内容层不许写）', () => {
    // 这条防的是"某人顺手写回 prop: { attack: 8 }"。G3.A 闸门是主守，这里是第二道：
    // 别名层与数据键的对应关系若被改坏，会先在这里红。
    const blade = entriesOf('skill').find((e) => e.id === 'base/blade')?.def as SkillDef;
    const keys = Object.keys(blade.passiveProp?.(300)?.prop ?? {});
    expect(keys).toEqual(['attack']); // 'attack' 落库仍是 'attack'
  });

  it('扩展空间还在：装配槽闭集保留了尚未落地的槽（暗器/鞭/棍/杖/扑咬）', () => {
    // 这是**刻意的守卫**：6 门是"现在做几门"，不是"槽只有 6 个"。
    // 谁把 ENABLE_SLOTS 收窄，这条会红 —— 提醒他 24 册 §1 的闭集是**接口**不是清单。
    for (const slot of ['staff', 'club', 'whip', 'throwing', 'bite'] as const) {
      expect(ENABLE_SLOTS).toContain(slot);
      expect(REG.bySlot(slot)).toHaveLength(0); // 还没内容，但槽位可用
    }
  });
});

// ── 曲线被派生公式消费 ──────────────────────────────────────────────────────

describe('★★ 曲线真的被派生公式消费', () => {
  // 先天全 20 / maxMp 100 / forceRad 0.1（base/force 没写 force_rad ⇒ 走默认）
  // ⇒ 裸角色基线：attack 20 · defense 4 · hit 10 · evasion 10 · deflect 10 · maxHp 110
  const base = bare();

  it('先确认基线与推导一致（否则下面的增量断言是在比两个错数）', () => {
    const d = base.derived;
    expect(d.attack).toBe(20);
    expect(d.defense).toBe(4);
    expect(d.hit).toBe(10);
    expect(d.evasion).toBe(10);
    expect(d.deflect).toBe(10);
    expect(base.maxHp).toBe(110);
  });

  it('100 级（属性 +4 / 派生 +6）时派生值逐项对上', () => {
    const lv100 = learned(100);
    const d = lv100.derived;
    // attack = str + (gj + str_bonus * str/10) = 20 + (6 + 4*2) = 34
    expect(d.attack).toBe(34);
    // hit = dex/2 + mz = 10 + 6
    expect(d.hit).toBe(16);
    // evasion = dex/2 + ds + dex_bonus*(dex/10) = 10 + 0 + 4*2
    expect(d.evasion).toBe(18);
    // deflect = str/2 + zj + str_bonus*(str/10) = 10 + 6 + 4*2
    expect(d.deflect).toBe(24);
    // maxHp = con*5 + maxMp*forceRad + con_bonus*con = 100 + 10 + 4*20
    expect(lv100.maxHp).toBe(190);
    // defense = (str+con)/10 + con_bonus*con/10 = 4 + 8
    expect(d.defense).toBe(12);
  });

  it('每门技能各自"只"改自己那条线（别技能不会串味）', () => {
    const onlyDodge = new Npc({
      oid: 'eeeeeeeeee',
      path: asWorldId('zz/npc', 'skill-curves:only-dodge'),
      name: '只练轻功',
      def: { name: '只练轻功', desc: 'd', skills: [{ skill: 'base/dodge', level: 100 }] },
      skillRegistry: REG,
    });
    expect(onlyDodge.derived.evasion).toBe(18); // 躲闪涨了（属性加成被公式放大 2 倍）
    expect(onlyDodge.derived.hit).toBe(10); // 命中没动 —— 轻功给的是 dex 加成键，不是 mz
    expect(onlyDodge.derived.attack).toBe(20);
    expect(onlyDodge.derived.deflect).toBe(10);

    const onlySword = new Npc({
      oid: 'ffffffffff',
      path: asWorldId('zz/npc', 'skill-curves:only-sword'),
      name: '只练剑法',
      def: { name: '只练剑法', desc: 'd', skills: [{ skill: 'base/sword', level: 100 }] },
      skillRegistry: REG,
    });
    expect(onlySword.derived.hit).toBe(16);
    expect(onlySword.derived.evasion).toBe(10);
    expect(onlySword.derived.attack).toBe(20);

    const onlyBlade = new Npc({
      oid: 'gggggggggg',
      path: asWorldId('zz/npc', 'skill-curves:only-blade'),
      name: '只练刀法',
      def: { name: '只练刀法', desc: 'd', skills: [{ skill: 'base/blade', level: 100 }] },
      skillRegistry: REG,
    });
    expect(onlyBlade.derived.attack).toBe(26); // 刀法走 gj，不走 mz（有意偏离 wushen）
    expect(onlyBlade.derived.hit).toBe(10);
  });

  it('1000 级拉满（属性 +60 / 派生 +120）：大宗师但不荒谬', () => {
    const maxed = learned(1000);
    const d = maxed.derived;
    // attack = 20 + (120 + 60*2) = 260
    expect(d.attack).toBe(260);
    // hit = 10 + 120
    expect(d.hit).toBe(130);
    // evasion = 10 + 60*2（轻功给 dex 加成，被公式放大 2 倍）
    expect(d.evasion).toBe(130);
    // deflect = 10 + 120 + 60*2
    expect(d.deflect).toBe(250);
    // maxHp = 100 + 10 + 60*20
    expect(maxed.maxHp).toBe(1310);
    // defense = 4 + 60*20/10
    expect(d.defense).toBe(124);
  });
});

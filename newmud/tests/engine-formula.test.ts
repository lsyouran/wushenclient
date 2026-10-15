/**
 * tests/engine-formula.test.ts —— 数值公式的**唯一来源**
 * ============================================================================
 * 本文件存在的理由（22 册 §22.8）：「recount / 伤害公式只有一处定义」。
 * 因此这里逐项对账公式结果 —— 任何一处算式被改动，都会在这里变红，
 * 而不是等到"同一个玩家在不同路径下躲闪值不同"才被发现（wushen #20）。
 *
 * 参数一律从 COMBAT_FORMULA 取，测试里也一样（不硬编码魔数）。
 * ★ prop 键一律走 `PROP` 别名表（`PROP.attack === 'gj'`）—— 与 `formula.ts` 同一套
 *   可读名；数据层仍是 wushen 原键（见 `docs/29` §29.10 的对照表）。
 */
import { describe, expect, it } from 'vitest';

import { PROP } from '@shared/constants.js';
import {
  ATTR_KEYS,
  COMBAT_FORMULA,
  FormulaError,
  computeAttrBreakdowns,
  computeDerived,
  damageAfterDefense,
  effectiveAttr,
  formulaSummary,
} from '../server/engine/formula.js';
import type { InnateStats } from '../server/engine/formula.js';
import { createPropHolder, setProp } from '../server/engine/props.js';

/** 全 20 的基线人物：`forceRad` 取 1 便于手算（**真实兜底值是 0.1**，见 COMBAT_FORMULA）；内力上限 100 */
const BASE: InnateStats = { str: 20, con: 20, dex: 20, int: 20, maxMp: 100, forceRad: 1 };

describe('engine/formula · computeDerived 基线（无任何 prop）', () => {
  it('逐项对账（含 maxHp 里"内力 × 内功系数"那一项）', () => {
    const d = computeDerived(BASE, createPropHolder());
    // maxHp = int(con*5 + (maxMp*forceRad)) = 100 + 100 = 200
    expect(d).toEqual({
      attack: 20, // 臂力 str
      defense: 4, // (str+con)/10 = 4
      hit: 10, // 身法 dex * 0.5
      evasion: 10, // dex * 0.5
      deflect: 10, // str * 0.5
      crit: 2, // int(dex * 0.1)
      attackSpeed: 4000, // 基准攻击间隔
      maxHp: 200,
      damageReductionPer: 0,
      ignoreDefensePer: 0,
    });
  });

  it('取整与 wushen 的 parseInt 同语义（向零截断，非 Math.floor）', () => {
    // dex=25 → hit = 12.5 → 截断 12（floor 也是 12，故再用负向验证）
    const d = computeDerived({ ...BASE, dex: 25 }, createPropHolder());
    expect(d.hit).toBe(12);
  });

  it('先天属性非有限数值 → FormulaError（不让 NaN 传染整条公式）', () => {
    expect(() => computeDerived({ ...BASE, str: Number.NaN }, createPropHolder())).toThrow(FormulaError);
    expect(() => computeDerived({ ...BASE, maxMp: Number.POSITIVE_INFINITY }, createPropHolder())).toThrow(
      FormulaError,
    );
    expect(() => computeDerived({ ...BASE, forceRad: Number.NaN }, createPropHolder())).toThrow(FormulaError);
  });
});

describe('engine/formula · prop 真的进公式', () => {
  it('★ 内容层第一个 prop（暴虐丹 攻击/攻速%）确实生效', () => {
    const p = createPropHolder();
    setProp(p, PROP.attack, 20); // 攻击 +20（wushen 'gj'）
    setProp(p, PROP.attackSpeedPer, -20); // 出手变慢（wushen 'gjsd_per'）

    const d = computeDerived(BASE, p);
    expect(d.attack).toBe(40); // 20 + 20
    // attackSpeed = int(scaled(4000, -(-20))) = int(4000 * 1.2) = 4800（间隔变长 = 出手变慢）
    expect(d.attackSpeed).toBe(4800);
  });

  it('属性换算加成走 propScaleDivisor（臂力加成 × str/10）', () => {
    const p = createPropHolder();
    setProp(p, PROP.strengthBonus, 10); // 10 * (str/10) = 10 * 2 = 20
    expect(computeDerived(BASE, p).attack).toBe(40);
  });

  it('气血加成与气血百分比都生效（且不是同一件事）', () => {
    const p = createPropHolder();
    setProp(p, PROP.maxHpBonus, 100); // 内层 100 + 100 = 200
    expect(computeDerived(BASE, p).maxHp).toBe(300); // 100 + 200
    setProp(p, PROP.hpPer, 10); // 200 → 220
    expect(computeDerived(BASE, p).maxHp).toBe(320);
  });

  it('★ 气血上限的根骨加成项**不除** propScaleDivisor —— 照抄 wushen（29 册 §29.4 偏离① 已闭合）', () => {
    const p = createPropHolder();
    setProp(p, PROP.constitutionBonus, 10); // 根骨**加成** 10；先天 con 仍是 20（两者是两个量，别混）
    // 照抄 wushen `world/extends/char/user.js:3`：`query_prop("con") * this.con`（**不除 10**）
    // ⇒ int(20*5 + (100*1 + 0 + 10*20)) = 100 + 300 = 400
    expect(computeDerived(BASE, p).maxHp).toBe(400);
    // 反向锚点：若有人"顺手统一"成 /10 会得到 220 —— 那正是本批要消灭的那条偏离
    expect(computeDerived(BASE, p).maxHp).not.toBe(220);
  });

  it('★★ 同一个 prop(con) 在 maxHp 与 defense 里算法**不同** —— 原作如此，别顺手统一（29 册 §29.4）', () => {
    const p = createPropHolder();
    setProp(p, PROP.constitutionBonus, 10);
    const d = computeDerived(BASE, p);
    // wushen `world/extends/char/user.js` 同一次 recount 里，同一个 prop("con") 被算了两种：
    //   :3  max_hp → prop("con") * this.con       = 10 * 20     = 200（**不除**）
    //   :17 fy     → prop("con") * this.con / 10  = 10 * 20/10  =  20（**除**）
    // 与「gj 的先天 str 在百分比外」同一族 —— 原作的不一致，逐式照抄。
    expect(d.maxHp).toBe(400); // 100 + (100 + 200)
    expect(d.defense).toBe(24); // int(((20+20)/10 + 0 + 20) * 1) = 4 + 20
  });

  it('命中与躲闪共用同一个先天身法系数（`innateDexPer`）—— 防"调躲闪顺手改了命中"', () => {
    const d = computeDerived(BASE, createPropHolder());
    // wushen 两处都写死 `this.dex / 2`（`world/extends/char/user.js:18` `mz`、`:19` `ds`），
    // 所以这里必须是**一个**常量喂两条公式，而不是各自一个 0.5。
    expect(COMBAT_FORMULA.innateDexPer).toBe(0.5);
    expect(d.hit).toBe(BASE.dex * COMBAT_FORMULA.innateDexPer);
    expect(d.evasion).toBe(BASE.dex * COMBAT_FORMULA.innateDexPer);
    expect(d.hit).toBe(d.evasion); // 先天项必须同步
  });

  it('伤害减免 / 忽视防御 是透传量，原样带出', () => {
    const p = createPropHolder();
    setProp(p, PROP.damageReductionPer, 15);
    setProp(p, PROP.ignoreDefensePer, -5);
    const d = computeDerived(BASE, p);
    expect(d.damageReductionPer).toBe(15);
    expect(d.ignoreDefensePer).toBe(-5);
  });
});

describe('engine/formula · 攻击 attack 的口径（照抄 wushen：先天臂力 str 在百分比**外**）', () => {
  // wushen `world/extends/char/user.js:16`（`world/extends/char/combat.js:8` 同式）：
  //     gj = parseInt(str + (prop_gj + prop_str * str/10) * (100 + gj_per) / 100)
  // ★ 这是五式里**唯一**先天项在百分比外的一个（defense / hit / evasion / deflect 都在内）——
  //   是**原作如此**、不是本项目笔误，2026-10-14 裁定"照抄 wushen"（26 册 §32）。
  //   只靠 `gj_per ≠ 0` 才能把两种口径分开 ⇒ 本组用例专钉这一点。

  it('攻击百分比只放大"装备/技能那部分"，**不**放大先天臂力', () => {
    const p = createPropHolder();
    setProp(p, PROP.attack, 10); // 装备攻击 +10
    setProp(p, PROP.attackPer, 50); // +50%
    // 照 wushen：str + (10 + 0) * 1.5 = 20 + 15 = 35
    // 若误把 str 也乘进百分比：(20 + 10) * 1.5 = 45
    expect(computeDerived(BASE, p).attack).toBe(35);
    expect(computeDerived(BASE, p).attack).not.toBe(45);
  });

  it('纯先天（无任何 prop）时，攻击百分比对 attack **完全无效**（str 不在百分比内）', () => {
    const p = createPropHolder();
    setProp(p, PROP.attackPer, 100);
    // 照 wushen：str + (0) * 2 = 20；若 str 在内则是 20 * 2 = 40
    expect(computeDerived(BASE, p).attack).toBe(20);
  });

  it('属性换算项（臂力加成 × str/10）**在**百分比内 —— 它是"装备那部分"，与攻击加成同类', () => {
    const p = createPropHolder();
    setProp(p, PROP.strengthBonus, 10); // 10 * (20/10) = 20
    setProp(p, PROP.attackPer, 50);
    // 照 wushen：20 + (0 + 20) * 1.5 = 20 + 30 = 50
    expect(computeDerived(BASE, p).attack).toBe(50);
  });

  it('★ 对照组：防御 defense 的先天项**在**百分比内（证明"只有 attack 在外"是有意为之，别顺手统一）', () => {
    const p = createPropHolder();
    setProp(p, PROP.defensePer, 50);
    // defense 的先天内层 = (str + con)/10 = 4；照 wushen 它**在**百分比内 ⇒ int(4 * 1.5) = 6
    // （若"统一"成 attack 那样把先天项提到外面，会得到 int(4) = 4）
    expect(computeDerived(BASE, p).defense).toBe(6);
    expect(computeDerived(BASE, p).defense).not.toBe(4);
  });
});

describe('engine/formula · 攻击间隔有下限（防"攻速堆到 0 死循环"）', () => {
  it('攻速加成把间隔压到低于基准 → 取下限', () => {
    const p = createPropHolder();
    setProp(p, PROP.attackSpeed, 999_999); // 4000 - 999999 < 0
    expect(computeDerived(BASE, p).attackSpeed).toBe(COMBAT_FORMULA.attackIntervalFloorMs);
  });

  it('攻速百分比巨大正修正 → 仍不低于下限', () => {
    const p = createPropHolder();
    setProp(p, PROP.attackSpeedPer, 1_000_000); // 把间隔压成负数
    expect(computeDerived(BASE, p).attackSpeed).toBe(COMBAT_FORMULA.attackIntervalFloorMs);
  });
});

describe('engine/formula · damageAfterDefense（递减减伤）', () => {
  it('伤害<=0 → 0；防御<=0 → 原伤害（不治疗、不空转）', () => {
    expect(damageAfterDefense(0, 100)).toBe(0);
    expect(damageAfterDefense(-5, 100)).toBe(0);
    expect(damageAfterDefense(100, 0)).toBe(100);
    expect(damageAfterDefense(100, -10)).toBe(100);
  });

  it('对防御单调不增（边际收益递减）', () => {
    let prev = Number.POSITIVE_INFINITY;
    for (const defense of [0, 10, 50, 100, 500, 1_000, 5_000, 100_000]) {
      const d = damageAfterDefense(100, defense);
      expect(d).toBeLessThanOrEqual(prev);
      prev = d;
    }
  });

  it('★ 没有"跨过 防御=伤害 就归零"的断崖（与线性 damage-defense 的区别）', () => {
    expect(damageAfterDefense(100, 100)).toBe(50); // 线性法在这里刚好归 0
    expect(damageAfterDefense(100, 200)).toBe(33); // int(100/300*100)
  });

  it('★ 已知边界：防御极大时 int() 截断会把结果压到 0（注释的"永不等于 0"仅指截断前）', () => {
    expect(damageAfterDefense(100, 1_000_000_000)).toBe(0);
  });

  it('非有限参数 → FormulaError', () => {
    expect(() => damageAfterDefense(Number.NaN, 1)).toThrow(FormulaError);
    expect(() => damageAfterDefense(1, Number.POSITIVE_INFINITY)).toThrow(FormulaError);
  });
});

describe('engine/formula · computeAttrBreakdowns（属性三档：先天 / 后天 / 合计）', () => {
  it('★ 合计 === 先天 + 后天加成，且与 effectiveAttr 同值（只有一个口径）', () => {
    const props = createPropHolder();
    setProp(props, PROP.strengthBonus, 5);
    setProp(props, PROP.constitutionBonus, 3);
    for (const r of computeAttrBreakdowns(BASE, props)) {
      expect(r.total).toBe(r.innate + r.bonus);
      expect(r.total).toBe(effectiveAttr(BASE, props, r.key));
    }
  });

  it('★ 后天那一档只读 prop 表（无加成时等于先天；补上加成后合计跟着动）', () => {
    const props = createPropHolder();
    expect(computeAttrBreakdowns(BASE, props).map((r) => [r.bonus, r.total])).toEqual([
      [0, 20],
      [0, 20],
      [0, 20],
      [0, 20],
    ]);
    setProp(props, PROP.intelligenceBonus, 7);
    expect(computeAttrBreakdowns(BASE, props)[3]).toEqual({
      key: 'int',
      innate: 20,
      bonus: 7,
      total: 27,
    });
  });

  it('★ 行序恒为 ATTR_KEYS（面板行序稳定，不随调用先后变）', () => {
    const rows = computeAttrBreakdowns(BASE, createPropHolder());
    expect(rows.map((r) => r.key)).toEqual(['str', 'con', 'dex', 'int']);
    expect(rows).toHaveLength(ATTR_KEYS.length);
  });
});

describe('engine/formula · formulaSummary（启动日志）', () => {
  it('列出全部参数，键值一一对应', () => {
    const s = formulaSummary();
    expect(s).toContain('hpPerCon=5');
    expect(s).toContain('attackIntervalFloorMs=500');
    expect(s.split(' ')).toHaveLength(Object.keys(COMBAT_FORMULA).length);
  });
});

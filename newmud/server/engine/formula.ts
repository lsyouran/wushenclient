/**
 * server/engine/formula.ts — 数值公式的**唯一来源**
 * ============================================================================
 * 本文件存在的理由，就是 22 册 §22.8 验收清单里的这一条：
 *
 *   「□ recount / 伤害公式只有一处定义」
 *
 * ★ wushen 的实际情况（08 册 §8.2.2，21 册第 6 条）：
 *   同一套 `recount` 被**写了两遍**，而且**两遍不一样**。差异不在先天项
 *   （`dex/2`、`str/2` 两边**一模一样**），而在两处：
 *     - `world/extends/char/user.js:2-32`   → 属性加成项除 **10**
 *       （`query_prop("dex") * this.dex / 10`），**且多一层 `dodge_skill` /
 *       `parry_skill` 的 `on_recount_*` 钩子**
 *     - `world/extends/char/combat.js:2-19` → 同样两项但除 **5**
 *       （`query_prop("dex") * this.dex / 5`），无技能钩子
 *   ⚠️ `query_prop("dex")` 是**装备/技能给的身法加成**，不是身法本身 ——
 *      早先这里（连 08 册 §8.2.2）把它简写成 `dex*dex/5`，读起来像"身法的平方"，
 *      已于 2026-10-13 订正（26 册 §25）。
 *   两者的覆盖面是"最后写入者胜"（extends 补丁按加载顺序覆盖原型方法），
 *   于是**同一个玩家**在不同调用路径下躲闪值不同 —— 而这不是任何一次提交的意图，
 *   是两份实现各自演化的结果。
 *
 *   本文件的写法把这件事变成**结构上不可能**：
 *   公式只有这一份，`Character.recount()` 只是调用它；派生结果存在 `Character`
 *   的私有字段里，**只有 `character.ts` 自己能写**（TS 私有字段，子类也碰不到）。
 *   `tools/gate/g6-redline.mjs` 的 **R6.9** 再兜一道：禁止在 formula.ts 之外
 *   重新定义 `COMBAT_FORMULA` / `computeDerived`，堵住"把公式抄成第二份文件"
 *   —— 后者是 TS 私有字段拦不住的形态。
 *
 * ★ 三层结构（08 册 §8.7 第 1 条，照抄 wushen 的好的部分）：
 *     先天属性（str/con/dex/int，人物自带）
 *   + 后天 prop（装备/技能/BUFF 给的加成，全部走 props.ts 访问器）
 *   × 百分比修正（`*_per` 族）
 *   → 派生战斗属性（只读，字段用**英文常见名**，共 **10** 个）：
 *         attack 攻击 · defense 防御 · hit 命中 · evasion 躲闪 · deflect 招架
 *         crit 暴击 · attackSpeed 攻击速度（**毫秒/次，越小越快**）· maxHp 气血上限
 *         damageReductionPer 伤害减免% · ignoreDefensePer 忽视防御%
 *         ★ 后两个是**透传量** —— 不参与派生算术，只是从 prop 原样带出供战斗层消费。
 *     ★ 括号里的英文名是**本项目代码用名**；wushen 的键名仍是
 *       `gj/fy/mz/ds/zj/bj/gjsd/max_hp` —— 数据层照抄 wushen，
 *       人读对照表见 `docs/29` §29.10（代码名 ↔ wushen 键 ↔ 中文）。
 *
 * ★★ 上表是**派生公式**，与「**有效属性**」（`effectiveAttr`，先天值 + 后天加成）
 *   是**两件事**，别合并：前者照抄 wushen 的逐式算术（先天/后天位置不同），
 *   后者是**门槛/限制的唯一口径**。详见 `effectiveAttr()` 的注释。
 *
 * ★ 参数一律进 `COMBAT_FORMULA` 表，不写死在表达式里 —— 调参不必读公式。
 *
 * ★ prop 键**不写裸字符串**：一律走 `shared/constants.ts` 的 `PROP` 别名表
 *   （`PROP.attack` 的值就是 `'gj'`）。代码可读，而落库 / 上网 / 存档
 *   用的仍是 wushen 原键 —— 别在这里写 `'gj'`，也别改 `PROP` 的值。
 */

import { PROP, type PropKey } from '@shared/constants.js';
import { getProp } from './props.js';
import type { PropHolder } from './props.js';

export class FormulaError extends Error {
  public override readonly name = 'FormulaError';
}

/** 可调参数表。**所有**数值都从这里取，公式体只做算术 */
export const COMBAT_FORMULA = {
  /** 气血基础系数：`con * hpPerCon` */
  hpPerCon: 5,
  /** 攻击间隔基准（ms）；wushen 默认 4000 */
  attackIntervalMs: 4000,
  /** 攻击间隔下限（ms）；wushen 写死 500，防止攻速堆到 0 导致死循环 */
  attackIntervalFloorMs: 500,
  /**
   * 先天 dex 的系数（0.5 = `dex/2`）。
   *
   * ★ 命名刻意**中性**（`innateDexPer`，不是 `evasionPerDex`）：它同时喂 `hit`（命中）
   *   与 `evasion`（躲闪）两条公式 —— wushen 这两处都写死 `this.dex / 2`
   *   （`world/extends/char/user.js:18` 的 `mz` 与 `:19` 的 `ds`）。叫 `evasion*` 会让人调躲闪时
   *   顺手改到命中，而且改完两边都"看起来对"（26 册 §25）。两边共用由 `engine-formula.test.ts` 钉住。
   */
  innateDexPer: 0.5,
  /** 招架的先天部分：`str * deflectPerStr`（wushen USER 版 = str/2） */
  deflectPerStr: 0.5,
  /** 防御的先天部分除数：`(str + con) / defenseBaseDivisor` */
  defenseBaseDivisor: 10,
  /** `prop(x) * x / propScaleDivisor` 这个"属性换算加成"的除数 */
  propScaleDivisor: 10,
  /** 暴击的先天部分：`dex * critPerDex` */
  critPerDex: 0.1,

  /**
   * ★ 内功系数的**默认值**（当角色没有任何"占据 `force` 槽的技能"时）。
   *
   * docs/27 决策：这里原先是一个**待定的近似**（`forceSkillLevel * 0.01`，下限 1），
   * 因为当时不知道 wushen 的 `query_force_rad()` 写在哪儿。已核实它在
   * `os/char/chara_prop.js:20-22`：
   *
   *     query_force_rad() {
   *         if (this.force_skill && this.force_skill.force_rad)
   *             return this.force_skill.force_rad || 0.1;
   *         …（无内功 → 0.1）
   *     }
   *
   * 也就是**由生效内功技能模板上的一个常量 `force_rad` 决定**，与等级无关。
   * 本项目的对应物是 `SkillDef.force_rad`（见 `defs.ts`）；角色没有内功时用本默认值。
   *
   * ⚠️ 取值必须照抄 wushen 才是 **0.1**（不是 1）。理由是实测 wushen 全部内功心法的
   *    `force_rad` 都落在 **0.5–0.9**（`world/skill/{force,wudang,shaolin,…}/*.js`，
   *    如 `taijishengong 0.8` / `baiyunxinfa 0.75` / `gaibangxinfa 0.5`），
   *    而**连 wushen 自己的 `base/force` 都没有 `force_rad`** → 也走 0.1 兜底。
   *    所以 0.1 表示"没练内功"这个真实状态，而 1 会让所有裸角色的气血凭空多 10 倍内力项。
   *
   * 数值本身仍集中在可调表里（`server/engine/tuning.ts` 汇总）。
   */
  forceRadDefault: 0.1,
} as const;

/** 先天属性（人物自带，不是 prop） */
export interface InnateStats {
  readonly str: number;
  readonly con: number;
  readonly dex: number;
  readonly int: number;
  /** 内力上限；参与 `max_hp` 计算（wushen 原式如此） */
  readonly maxMp: number;
  /** 内功系数（由生效内功技能的 `force_rad` 决定；见 `COMBAT_FORMULA.forceRadDefault`） */
  readonly forceRad: number;
}

/**
 * 先天四维的键（`InnateStats` 里"人物自带"的那四个）。
 *
 * ★ 值表与类型**同一来源**：`AttrKey` 由 `ATTR_KEYS` 派生 —— 想加/删维度只改这一处，
 *   不会出现"类型改了、值表没跟上"（24 册铁律 4：单源真相）。
 *   公式 / 门槛 / 面板一律遍历 `ATTR_KEYS`，**不各自手写四个键**。
 */
export const ATTR_KEYS = ['str', 'con', 'dex', 'int'] as const;
export type AttrKey = (typeof ATTR_KEYS)[number];

/** 四维 → 它们在 `prop` 里的**加成**键（`PROP.strengthBonus === 'str'` …） */
const ATTR_BONUS = {
  str: PROP.strengthBonus,
  con: PROP.constitutionBonus,
  dex: PROP.dexterityBonus,
  int: PROP.intelligenceBonus,
} as const satisfies Record<AttrKey, PropKey>;

/** `AttrKey` 的运行时判据 —— 与 `ATTR_BONUS` 同生共死（只有一个键表） */
export function isAttrKey(key: string): key is AttrKey {
  return Object.prototype.hasOwnProperty.call(ATTR_BONUS, key);
}

/**
 * **有效属性 = 先天值 + 后天加成**。本项目里"属性"的**唯一口径**。
 *
 * ★ **一切门槛 / 限制都读它** —— `SkillLearnCondition.minAttr`（学习条件）、
 *   将来的装备穿戴要求，都走这一条。四维之外没有"先天"，于是 `getProp` 那一路
 *   就是加成本身（`effectiveAttr` 只接受 `AttrKey`，所以这条不会误用）。
 *
 * ★★ **它不参与派生公式**，这一点是刻意的：`computeDerived()` 里先天与后天加成
 *   出现的位置不同 —— 例 `attack = str + (prop_gj + prop_str*str/10)*(1+gj_per/100)`，
 *   先天 `str` 在百分比**外**、加成在**内**；max_hp 与 defense 里同一个 `prop(con)`
 *   甚至一个除 10 一个不除。那是**逐式照抄 wushen** 的结果（29 册 §29.4）。
 *   把先天与加成先合并再代入会**改变数值、偏离原作** ⇒「门槛」与「公式」必须分开。
 *
 * ★ 为什么要有这个函数、而不是让调用方自己写 `innate + getProp`：
 *   wushen 把 `str1`（先天）/ `str`（先天+加成）/ 其它键（纯加成）三种语义混在
 *   一个 `switch` 里（`os/skill/skill.js:222-237`）—— 同一个"臂力"三个来源。
 *   本项目把"门槛读哪个数"收敛成**一个函数、一个名字**，于是内容层与引擎层
 *   不可能各算各的；`str` 与 `str1` 的二义性在 API 上**不存在**（数据键仍照抄
 *   wushen，那是另一回事，见 `shared/constants.ts` 的 PROPERTIES 注释）。
 *
 * ★ 完整裁定与实证见 **29 册 §29.13** 与 **26 册 §37**。
 */
export function effectiveAttr(
  innate: Readonly<Record<AttrKey, number>>,
  props: PropHolder,
  key: AttrKey,
): number {
  return innate[key] + getProp(props, ATTR_BONUS[key]);
}

/**
 * 单个属性的**三档读数**（面板 / 诊断用）：先天、后天加成、合计。
 *
 * ★ `total` 与 `effectiveAttr()` **同一个数** —— 门槛读的就是它，不会有第二个口径。
 */
export interface AttrBreakdown {
  /** 属性键（`str`/`con`/`dex`/`int`） */
  readonly key: AttrKey;
  /** ① 先天值（人物自带） */
  readonly innate: number;
  /** ② 后天加成（装备 / 技能给的，存在 `prop` 表里） */
  readonly bonus: number;
  /** ③ 合计 = ① + ②，与 `effectiveAttr()` 同值 */
  readonly total: number;
}

/**
 * 四维的三档读数一次取全（面板 / 诊断）。
 *
 * ★ `total` 交给 `effectiveAttr()` 算 —— 于是"有效属性"永远只有**一处实现**；
 *   这里只额外把"先天"与"后天加成"**分开**列出来，好让玩家看到 `臂力 25（先天 20 + 后天 5）`。
 *   wushen 的 `score` 面板正是这么摆的（`world/cmd/dialog/score.js:90-97` 单独发 `str_add` …）。
 *
 * ★ 顺序恒为 `ATTR_KEYS` ⇒ 面板行序稳定，不随谁先调用而变。
 */
export function computeAttrBreakdowns(
  innate: Readonly<Record<AttrKey, number>>,
  props: PropHolder,
): readonly AttrBreakdown[] {
  return ATTR_KEYS.map((key) => ({
    key,
    innate: innate[key],
    bonus: getProp(props, ATTR_BONUS[key]),
    total: effectiveAttr(innate, props, key),
  }));
}

/**
 * 派生战斗属性（**算出来的、只读**）。
 *
 * ★ 字段用**英文常见名**；括号里是 wushen 的原键名 —— 数据层仍照 wushen。
 *   完整的"代码名 ↔ wushen 键 ↔ 中文"对照见 `docs/29` §29.10。
 *
 * ⚠️ 命名冲突警告（wushen 的坑，必须显式对待）：
 *   这里 `maxHp` 是**算出来的上限**；而 `prop` 里也有一个 `'max_hp'`，
 *   它是**加成**（代码里写作 `PROP.maxHpBonus`）。同名不同物 —— 两者在
 *   公式里同时出现，别混。
 *
 * ⚠️ **不许叫 `dodge` / `parry`**（2026-10-14 改名，闸门 **G3.G** 守）：
 *   这两个词在 wushen 里是**技能 id**（`os/const.js` 的 `BASE_SKILLS`：
 *   `DODGE: 'dodge'` / `PARRY: 'parry'`），而且 `ENABLE_SLOTS` 里也是这两个槽名。
 *   数值字段若同名，grep 一下分不清命中的是"躲闪值"还是"轻功技能"。
 *   故数值侧取 `evasion` / `deflect`。
 *   wushen 原作靠"属性=拼音 `ds`/`zj`、技能=英文"分开的正是这条线（`docs/29` §29.10）。
 *   ★ 那两个内容目录在 **wushen** 侧（`wushen/world/skill/dodge|parry/`）；
 *     本项目 `newmud/world/skill/` 下**还没有**这两个目录（内容批次未落）。
 */
export interface DerivedCombat {
  /** 攻击（wushen `gj`） */
  readonly attack: number;
  /** 防御（wushen `fy`）—— 减伤用 */
  readonly defense: number;
  /** 命中（wushen `mz`） */
  readonly hit: number;
  /** 躲闪（wushen `ds`）。★ 不叫 `dodge` —— 那是技能 id（基础轻功） */
  readonly evasion: number;
  /** 招架（wushen `zj`）。★ 不叫 `parry` —— 那是技能 id（基础招架） */
  readonly deflect: number;
  /** 暴击（wushen `bj`） */
  readonly crit: number;
  /** 攻击间隔（毫秒/次，**越小越快**；wushen `gjsd`） */
  readonly attackSpeed: number;
  /** 气血上限（wushen 的 `max_hp` 派生而来，不是加成） */
  readonly maxHp: number;
  /** 伤害减免百分比（透传，供战斗层消费；wushen `diff_sh_per`） */
  readonly damageReductionPer: number;
  /** 忽视对方防御百分比（透传；wushen `diff_fy_per`） */
  readonly ignoreDefensePer: number;
}

function assertFinite(value: number, name: string): void {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new FormulaError(`先天属性 ${name} 必须是有限数值，收到 ${String(value)}`);
  }
}

/** 取整：与 wushen 的 `parseInt` 同语义（向零截断），负值不会被向下取整成 -1 */
function int(value: number): number {
  return Math.trunc(value);
}

/** 百分比修正：`x * (100 + per) / 100` */
function scaled(x: number, per: number): number {
  return (x * (100 + per)) / 100;
}

/**
 * 计算全部派生战斗属性。**纯函数**：不读 `Character`、不写任何状态，
 * 因此可以在单测里逐项对账（见 `tests/engine-formula.test.ts`）。
 */
export function computeDerived(innate: InnateStats, props: PropHolder): DerivedCombat {
  assertFinite(innate.str, 'str');
  assertFinite(innate.con, 'con');
  assertFinite(innate.dex, 'dex');
  assertFinite(innate.int, 'int');
  assertFinite(innate.maxMp, 'maxMp');
  assertFinite(innate.forceRad, 'forceRad');

  const F = COMBAT_FORMULA;
  const str = innate.str;
  const con = innate.con;
  const dex = innate.dex;

  // ── 先把用到的 prop 取成**可读名字** ────────────────────────────────────────
  // 公式体里从此只出现名字，不再出现 `'gj'` 这类拼音键。★ 值仍照 wushen
  // （`PROP.attack === 'gj'`），所以落库 / 上网 / 存档一个字节都没变。
  const attackBonus = getProp(props, PROP.attack); // 攻击加成（wushen 'gj'）
  const defenseBonus = getProp(props, PROP.defense); // 防御加成（'fy'）
  const hitBonus = getProp(props, PROP.hit); // 命中加成（'mz'）
  const evasionBonus = getProp(props, PROP.evasion); // 躲闪加成（'ds'）
  const deflectBonus = getProp(props, PROP.deflect); // 招架加成（'zj'）
  const critBonus = getProp(props, PROP.crit); // 暴击加成（'bj_per'，平加）
  const strengthBonus = getProp(props, PROP.strengthBonus); // 臂力加成（'str'）
  const constitutionBonus = getProp(props, PROP.constitutionBonus); // 根骨加成（'con'）
  const dexterityBonus = getProp(props, PROP.dexterityBonus); // 身法加成（'dex'）
  const maxHpBonus = getProp(props, PROP.maxHpBonus); // 气血加成（'max_hp'）
  const attackSpeedBonus = getProp(props, PROP.attackSpeed); // 攻速加成（'gjsd'）
  const attackPer = getProp(props, PROP.attackPer); // 攻击 +%（'gj_per'）
  const defensePer = getProp(props, PROP.defensePer); // 防御 +%（'fy_per'）
  const hitPer = getProp(props, PROP.hitPer); // 命中 +%（'mz_per'）
  const evasionPer = getProp(props, PROP.evasionPer); // 躲闪 +%（'ds_per'）
  const deflectPer = getProp(props, PROP.deflectPer); // 招架 +%（'zj_per'）
  const attackSpeedPer = getProp(props, PROP.attackSpeedPer); // 攻速 +%（'gjsd_per'）
  const hpPer = getProp(props, PROP.hpPer); // 气血 +%（'hp_per'）

  // 气血上限 = 先天根骨 × 系数，加上「内力上限 × 内功系数 + 气血加成 + 根骨换算加成」，再乘气血百分比
  //
  // ★★ 2026-10-14 裁定：**照抄 wushen**（29 册 §29.4 偏离① 已闭合）。
  //   这里的 `prop(con) * con` **不除** `propScaleDivisor`，这不是笔误 ——
  //     - wushen `world/extends/char/user.js:3`（max_hp 气血）：`prop("con") * this.con`（**不除**）
  //     - wushen `world/extends/char/user.js:17`（fy 防御）　：`prop("con") * this.con / 10`（**除**）
  //   同一个 `prop(con)` 在 wushen 同一次 recount 里被用了**两种算法**，属原作自身的不一致，
  //   与「`gj` 的先天 str 在百分比外」同一族。本项目**逐式照抄**，不代为统一。
  //
  //   ⚠️ 于是本文件里 `constitutionBonus` 出现两次且算法不同（`maxHp` 不除、`defense` 除）——
  //      **这是刻意的**，别顺手"修正"成一致。两处各有一组测试锚点钉住。
  //
  // ★ 这一项**有真实生产者**：`world/skill/base/force.ts` 给 `prop.con = trunc(lv/10)`，
  //   所以练了内功的角色气血会明显增长（原作亦如此 —— 内功是涨血的主要来源）。
  //   ⚠️ 早期这里误写成"影响为零（内容层没有 con 生产者）"，2026-10-14 复查时订正。
  const maxHp = int(
    con * F.hpPerCon +
      scaled(innate.maxMp * innate.forceRad + maxHpBonus + constitutionBonus * con, hpPer),
  );

  // 攻击间隔：基准 − 攻速加成，再乘攻速百分比；无论如何不低于下限
  let attackSpeed = F.attackIntervalMs - attackSpeedBonus;
  if (attackSpeed > F.attackIntervalFloorMs) {
    attackSpeed = int(scaled(attackSpeed, -attackSpeedPer));
    if (attackSpeed < F.attackIntervalFloorMs) attackSpeed = F.attackIntervalFloorMs;
  } else {
    attackSpeed = F.attackIntervalFloorMs;
  }

  // 攻击：★ 照抄 wushen 的**口径** —— 先天臂力 `str` 在百分比**外**
  //   （`world/extends/char/user.js:16`；`world/extends/char/combat.js:8` 同式）：
  //       attack = str + (prop_gj + prop_str * str/10) * (100 + gj_per) / 100
  //   ★ 这是五式里**唯一**先天项在百分比外的一个（defense / hit / evasion / deflect 都在内）——
  //     是**原作如此**、不是本项目笔误。2026-10-14 裁定"照抄 wushen"（26 册 §32、
  //     设计说明见 `docs/29`）；两种口径只在 `gj_per ≠ 0` 时分家，
  //     故 `engine-formula.test.ts` 用 `gj_per = 50 / 100` 的锚点把它钉住。
  const attack = int(
    str + scaled(attackBonus + strengthBonus * (str / F.propScaleDivisor), attackPer),
  );
  const defense = int(
    scaled(
      (str + con) / F.defenseBaseDivisor +
        defenseBonus +
        constitutionBonus * (con / F.propScaleDivisor),
      defensePer,
    ),
  );
  const hit = int(scaled(dex * F.innateDexPer + hitBonus, hitPer));
  const evasion = int(
    scaled(
      dex * F.innateDexPer + evasionBonus + dexterityBonus * (dex / F.propScaleDivisor),
      evasionPer,
    ),
  );
  const deflect = int(
    scaled(
      str * F.deflectPerStr + deflectBonus + strengthBonus * (str / F.propScaleDivisor),
      deflectPer,
    ),
  );
  const crit = int(dex * F.critPerDex + critBonus);

  return {
    attack,
    defense,
    hit,
    evasion,
    deflect,
    crit,
    attackSpeed,
    maxHp,
    damageReductionPer: getProp(props, PROP.damageReductionPer),
    ignoreDefensePer: getProp(props, PROP.ignoreDefensePer),
  };
}

/**
 * 递减减伤（11 册 §11.3，22 册 §22.7 模式 7）：
 *
 *     damage' = int( damage / (damage + defense) * damage )
 *
 * 一行解决"防御堆到无敌"的**断崖**：`defense` 每多一点，`damage'` 单调不增、边际收益递减；
 * 不像 `damage - defense` 那种线性减法则会在 `defense ≥ damage` 时突然归零
 * （`damageAfterDefense(100, 100) === 50`，而线性法在这里刚好 0）。
 *
 * ⚠️ 精确边界（别被"永不归零"这种说法误导）：`int()` 截断之后，结果**会**在
 *   `damage / (damage + defense) * damage < 1` 时被压成 0（例：damage=100、defense=1e9）。
 *   这是刻意的 —— 不做"至少 1 点"的保底，否则低级角色能靠无限次磨把高防目标磨死。
 *   该边界由 `tests/engine-formula.test.ts` 显式钉住（`=== 0`）。
 */
export function damageAfterDefense(damage: number, defense: number): number {
  assertFinite(damage, 'damage.sh');
  assertFinite(defense, 'damage.fy');
  if (damage <= 0) return 0;
  if (defense <= 0) return int(damage);
  return int((damage / (damage + defense)) * damage);
}

/** 便于查看当前参数（启动日志用；`world.ts` 的统计里会带上） */
export function formulaSummary(): string {
  return Object.entries(COMBAT_FORMULA)
    .map(([k, v]) => `${k}=${String(v)}`)
    .join(' ');
}

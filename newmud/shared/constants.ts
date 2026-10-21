/**
 * shared/constants.ts — 全部常量的单一事实源
 * ============================================================================
 * 原则：**游戏里任何一个「字符串枚举」只允许在这里定义一次。**
 * 代码里出现字面量时，类型系统会把它收敛到本文件的联合类型上 —— 写错
 * 就编译不过，而不是像 wushen 那样运行时静默降级（见 21 册 #17）。
 *
 * 证据：对 wushen 源码实测，`query_prop/add_prop` 共出现 121 个不同的属性
 * key，而 `PROPERTIES` 只定义了 70 个 —— 69 个（几乎全是技能专属扩展键，
 * 如 `ylxf_gj` / `whd_sh_max`）根本没登记。因此本文件把属性分成两层：
 *
 *   ├─ CORE  : 引擎明确理解的键，**闭集 + 联合类型**，写错即编译失败
 *   └─ EXT   : 内容层（技能/物品/门派）自造的键，开放集，但必须
 *              registerExtProp() 登记，否则 G3 闸门报红
 */

// ===========================================================================
// 1. 属性（PROPERTIES）
// ===========================================================================

/**
 * 引擎核心属性表：key → 中文显示名。**共 76 个键**。
 *
 * ## 命名法（2026-10-18 §66 起：数据键也是英文）
 *
 * 数据键一律 **英文 snake_case 裸名词**，不加 `Bonus`/`Per` 之类后缀。
 * ★★ 后缀会被卷进派生规则（见 `ModProp`）：核心键若叫 `attackBonus`，
 *   就会派生出 `diff_attackBonus` 这种怪键。**只有核心键的名字是自由的。**
 *
 * ### 与 wushen 的关系：**不再是逐字双射**
 * wushen 这套键是拼音缩写（`gj` 攻击 / `fy` 防御 / `ds` 躲闪 / `zj` 招架 /
 * `mz` 命中 / `bj_per` 暴击 / `gjsd` 攻速 …）。本项目**全栈改成了英文**
 * —— 代码、内容层 `prop:{}`、协议帧、存档都是同一套 snake_case。
 *
 * ⇒ **从 wushen 抄内容时必须过一遍词干替换**。对照表在
 *   `docs/29` §29.11.2（甲 18 词干 / 乙 38 独立键）；全量标识含义见
 *   `docs/32` 标识字典。闸门 **G3.A** 带旧拼音黑名单：内容层写 `gj` 会
 *   当场报「改用 attack」，而不是留一个静默失效的键。
 *
 * ★★ 每条键后面用 `←` 标注 wushen 旧名。**这份标注是给"照抄内容"的人看的**，
 *   不是契约 —— 旧名从此只出现在注释与文档里。
 *
 * ## 派生规则（不逐一枚举，见 `ModProp` 类型）
 * ```
 *   <X>_per`       百分比加成
 *   diff_<X>`      减免 / 抵抗
 *   diff_<X>_per`  减免百分比
 *   add_<X>`       追加
 *   add_<X>_per`   追加百分比
 * ```
 * ★ 表里有些键**既显式登记、又符合派生规则**（`attack_per` = `attack` + `_per`）。
 *   这是有意的：显式登记才拿得到中文名（`propLabel()`）。派生族只保证
 *   **类型上合法**，不保证有中文名。
 *
 * ## 命名空间隔离
 * 数值侧的名字不得与**技能 id / 装配槽**（`ENABLE_SLOTS`，
 * `force/dodge/parry/bite/unarmed/sword/blade/staff/club/whip/throwing`）撞名
 * —— 这正是躲闪/招架叫 `evasion`/`deflect` 而**不叫** `dodge`/`parry` 的原因。
 * 由静态闸门 **G3.G** 守（`CORE ∪ DerivedCombat 字段` ⊥ `ENABLE_SLOTS`）。
 */
export const PROPERTIES = {
  // ═════════════════════════════════════════════════════════════════════════
  // 甲 · 有派生族的词干（18 词干 → 38 键；改词干则整族自动跟随）
  // ═════════════════════════════════════════════════════════════════════════

  // -- 战斗核心：平加 --
  attack: '攻击', // ← gj
  defense: '防御', // ← fy
  evasion: '躲闪', // ← ds　★ 不叫 dodge（那是技能 id）
  deflect: '招架', // ← zj　★ 不叫 parry（那是技能 id）
  hit: '命中', // ← mz
  crit: '暴击', // ← bj_per　★ wushen 名字带 _per 却是**平加**；改裸名词顺手填坑
  damage: '伤害', // ← sh
  crit_damage: '暴击伤害', // ← bjsh
  attack_speed: '攻击速度', // ← gjsd

  // -- 战斗核心：百分比 --
  attack_per: '攻击', // ← gj_per
  defense_per: '防御', // ← fy_per
  evasion_per: '躲闪', // ← ds_per
  deflect_per: '招架', // ← zj_per
  hit_per: '命中', // ← mz_per
  attack_speed_per: '攻击速度', // ← gjsd_per
  diff_defense_per: '忽视对方防御', // ← diff_fy_per
  diff_crit: '暴击抵抗', // ← diff_bj

  // -- 伤害修正（damage 词干整族）--
  add_damage: '伤害增加', // ← add_sh
  add_damage_per: '最终伤害', // ← add_sh_per
  diff_damage: '受到的伤害减少', // ← diff_sh
  diff_damage_per: '伤害减免', // ← diff_sh_per
  add_crit_damage_per: '暴击伤害', // ← add_bjsh_per

  // -- 先天四维（建号时 15-30，和 = 80，见 05 册 5.1.4）--
  //    ★ 与下面的 `innate_*` 是两回事：这四个是**加成池**里的键，
  //      `innate_*` 才是建号时定下的**先天值**。
  str: '臂力', // ← str（不变：通用英文缩写 + D&D 惯例）
  con: '根骨', // ← con
  dex: '身法', // ← dex
  int: '悟性', // ← int

  // -- 绝招节奏 --
  cooldown: '绝招冷却', // ← distime
  cooldown_per: '绝招冷却', // ← distime_per
  cast_time: '绝招释放', // ← releasetime
  cast_time_per: '绝招释放', // ← releasetime_per
  mp_cost: '内力消耗', // ← expend_mp
  mp_cost_per: '内力消耗', // ← expend_mp_per

  // -- 打坐 / 忙乱 --
  meditation: '打坐效率', // ← dazuo
  meditation_per: '打坐效率', // ← dazuo_per
  busy_time: '忙乱时间', // ← busy
  busy_time_per: '忙乱时间', // ← busy_per
  diff_busy_time: '忽视忙乱', // ← diff_busy
  diff_busy_time_per: '忽视忙乱', // ← diff_busy_per

  // ═════════════════════════════════════════════════════════════════════════
  // 乙 · 独立键（无派生族，逐条起名 · 38 个）
  // ═════════════════════════════════════════════════════════════════════════

  // -- 先天四维的**值**（与上面 `str/con/dex/int` 加成池不同一层）--
  innate_con: '先天根骨', // ← con1
  innate_dex: '先天身法', // ← dex1
  innate_int: '先天悟性', // ← int1
  innate_str: '先天臂力', // ← str1

  // -- 基础杂项 --
  luck: '福缘', // ← kar　★ wushen 源码用了但 PROPERTIES 未定义（21 册 #17）
  appearance: '容貌', // ← per　★ 必须改：`per` 本身是核心键，又恰好是派生后缀 `_per` 的词
  age: '年龄', // ← age
  gender: '性别', // ← gender　★ 补齐：character.js 用作基础字段

  // -- 气血 / 内力 --
  max_hp: '气血上限', // ← max_hp（不变）
  max_mp: '内力上限', // ← max_mp（不变）
  limit_mp: '内力上限加成', // ← limit_mp（不变）
  //    ★ 与 `max_mp`（上限本身）是两回事：这个是**内容层给池子的加数**。
  hp_per: '气血', // ← hp_per（本就不变，故不在甲表）

  // -- 形如派生、其实**不在**派生族里（wushen 只"显式定义"）--
  diff_damage_per2: '伤害减免', // ← diff_sh_per2　★ 尾数 2 = 第二档（比试场景才合并）
  diff_defense_per2: '伤害减免', // ← diff_fy_per2　★ 同上
  debuff_resist: '负面状态抵抗', // ← diff_downside　★ 特意改裸名词：它不在 diff_ 族里
  debuff_resist_per: '负面状态抵抗', // ← diff_downside_per

  // -- 活动效率与产出（打坐/练习/采药/挖矿/钓鱼/炼药/闭关）--
  study_efficiency: '学习效率', // ← study_per
  practice_efficiency: '练习效率', // ← lianxi_per
  recovery_efficiency: '疗伤效果', // ← recover_per
  herb_gathering: '采药效率', // ← caiyao1
  herb_exp: '采药经验', // ← caiyao_exp
  herb_potential: '采药潜能', // ← caiyao_pot
  mining: '挖矿效率', // ← kuang1
  mining_exp: '挖矿经验', // ← kuang_exp
  mining_potential: '挖矿潜能', // ← kuang_pot
  fishing: '钓鱼效率', // ← diaoyu1
  fishing_exp: '钓鱼经验', // ← diaoyu_exp
  fishing_potential: '钓鱼潜能', // ← diaoyu_pot
  alchemy: '炼药效率', // ← lianyao1
  alchemy_yield: '丹药产出', // ← lianyao2
  alchemy_exp_efficiency: '炼药获得经验', // ← lianyao_exp_per
  retreat_exp: '闭关经验', // ← xiulian_exp
  dual_cultivation: '双修效率', // ← shuangxiu
  dismantle_yield: '分解获得的玄晶', // ← fenjie

  // -- 控制类 / 副本支付 --
  no_defense: '无法防御', // ← no_fy
  no_special: '禁止绝招', // ← no_pfm
  instance_score: '副本分数', // ← score
  paid_currency: '充值货币', // ← cash_money　★ 补齐
} as const;

export type CoreProp = keyof typeof PROPERTIES;

/** 由规则派生的修正键（无需逐一枚举） */
export type ModProp =
  | `${CoreProp}_per`
  | `diff_${CoreProp}`
  | `diff_${CoreProp}_per`
  | `add_${CoreProp}`
  | `add_${CoreProp}_per`;

/** 引擎允许出现的全部属性键 */
export type PropKey = CoreProp | ModProp;

/**
 * 属性键的**中文名**（`propLabel('str') === '臂力'`）。
 *
 * ★ 为什么要它：面向玩家的文案不该出现 `max_hp` / `attack_speed` 这类机读键
 *   （wushen `os/skill/skill.js:235` 也是用 `PROPERTIES[key]` 拼学习条件拒绝语）。
 * ★ `ModProp` 是**由规则派生**的联合类型（`add_<X>` 等），并不都在 `PROPERTIES` 里
 *   ⇒ 未登记时回落到键本身，不产生 `undefined` 文案。
 */
export function propLabel(key: string): string {
  return (PROPERTIES as Readonly<Record<string, string>>)[key] ?? key;
}

/**
 * ⚠️ **两个易混点（名字撞了，靠 receiver 区分 —— 别写反）**
 *
 * 1. `props.str` 是**臂力加成**（加成池里的键），而 `innateStats.str` 是**先天臂力**
 *    —— 同名不同物，wushen 也是这个坑。改成英文键后**没有**消除它：`str` 在
 *    `PROPERTIES` 里是「臂力」（加成侧），`innate_str` 才是先天值。
 * 2. `props.max_hp` 是气血**加成**，`derived.maxHp` 是算出来的**上限**。
 *
 * ★★ 这两条曾经靠 `PROP.strengthBonus` / `PROP.maxHpBonus` 这类别名**在名字上岔开**。
 *   §66 删掉别名层之后，岔开的手段只剩 **receiver**（`props.*` vs `innateStats.*` vs
 *   `derived.*`）—— 这正是 wushen 的做法，见 `docs/29` §29.11.1 条③「接受它」。
 *   写公式时**先看清自己在读哪个对象**，不要再想着用后缀把两者分开。
 */

/**
 * **历史对照表**：wushen 旧拼音键 → 本项目英文键。**冻结，永不扩充。**
 *
 * ★ 运行时**零消费者** —— 唯一用途是静态闸门 **G3.A** 的报错文案：
 *   内容层若从 wushen 抄来 `prop: { gj: 20 }`，报错要能直接说"请改用 `attack`"，
 *   而不是干巴巴一句"不在允许集内"。这是本次改名**最主要的使用风险**
 *   （29 册 §29.11.4「两处最易翻车」第 2 条）的兜底。
 *
 * ★ 它**不是**第二份键表：
 *   - 类型 `Record<string, CoreProp>` 保证每个值都是**当下**合法的核心键 ⇒
 *     再改一次名，这里会**编译失败**，逼着同步（不会静默漂移）；
 *   - 键（旧拼音）**永远**不该是合法 `PropKey` —— 由
 *     `tests/g3-constants.test.ts` 正向断言钉住；
 *   - 只增不减地"冻结"才有意义：新增键**不必**登记它，它只描述"改名前长什么样"。
 *
 * ★ 人读全量表（含中文名与出处）在 `docs/32` 标识字典。
 *
 * ⚠️ 表里有四个词**在别处也是合法标识符**，别拿这张表去做全仓禁用：
 *   `per`（变量名"百分比"）/ `busy`（`CommandActor.busy` 与 `allow_busy` 闸门）/
 *   `dazuo`（**指令 id**，打坐）/ `score`（**面板名** `dialog:'score'`）。
 *   ⇒ 本表只能用来判"**`prop` 块里的键**是不是从 wushen 抄来的旧名"。
 */
export const LEGACY_PINYIN_KEYS: Readonly<Record<string, CoreProp>> = {
  // 甲 · 词干族
  gj: 'attack',
  gj_per: 'attack_per',
  fy: 'defense',
  fy_per: 'defense_per',
  diff_fy_per: 'diff_defense_per',
  ds: 'evasion',
  ds_per: 'evasion_per',
  zj: 'deflect',
  zj_per: 'deflect_per',
  mz: 'hit',
  mz_per: 'hit_per',
  bj_per: 'crit',
  diff_bj: 'diff_crit',
  sh: 'damage',
  add_sh: 'add_damage',
  add_sh_per: 'add_damage_per',
  diff_sh: 'diff_damage',
  diff_sh_per: 'diff_damage_per',
  bjsh: 'crit_damage',
  add_bjsh_per: 'add_crit_damage_per',
  gjsd: 'attack_speed',
  gjsd_per: 'attack_speed_per',
  distime: 'cooldown',
  distime_per: 'cooldown_per',
  releasetime: 'cast_time',
  releasetime_per: 'cast_time_per',
  expend_mp: 'mp_cost',
  expend_mp_per: 'mp_cost_per',
  dazuo: 'meditation',
  dazuo_per: 'meditation_per',
  busy: 'busy_time',
  busy_per: 'busy_time_per',
  diff_busy: 'diff_busy_time',
  diff_busy_per: 'diff_busy_time_per',
  // 乙 · 独立键
  con1: 'innate_con',
  dex1: 'innate_dex',
  int1: 'innate_int',
  str1: 'innate_str',
  kar: 'luck',
  per: 'appearance',
  diff_sh_per2: 'diff_damage_per2',
  diff_fy_per2: 'diff_defense_per2',
  diff_downside: 'debuff_resist',
  diff_downside_per: 'debuff_resist_per',
  study_per: 'study_efficiency',
  lianxi_per: 'practice_efficiency',
  recover_per: 'recovery_efficiency',
  caiyao1: 'herb_gathering',
  caiyao_exp: 'herb_exp',
  caiyao_pot: 'herb_potential',
  kuang1: 'mining',
  kuang_exp: 'mining_exp',
  kuang_pot: 'mining_potential',
  diaoyu1: 'fishing',
  diaoyu_exp: 'fishing_exp',
  diaoyu_pot: 'fishing_potential',
  lianyao1: 'alchemy',
  lianyao2: 'alchemy_yield',
  lianyao_exp_per: 'alchemy_exp_efficiency',
  xiulian_exp: 'retreat_exp',
  shuangxiu: 'dual_cultivation',
  fenjie: 'dismantle_yield',
  no_fy: 'no_defense',
  no_pfm: 'no_special',
  score: 'instance_score',
  cash_money: 'paid_currency',
};

export function isCoreProp(x: string): x is CoreProp {
  return Object.hasOwn(PROPERTIES, x);
}

/**
 * 运行时守卫：必须与 `PropKey` 类型**逐字符串等价**。
 *
 * ❌ 曾经的实现是「一次性剥掉 `diff_`/`add_` 前缀 + `_per` 后缀，再查核心键」。
 *    那是错的：核心表里本身就有以 `_per` 结尾（`crit_per`、`diff_damage_per`）、
 *    以 `add_`/`diff_` 开头（`add_damage`、`diff_damage_per2`）的键，单次剥离会
 *    **多剥一层**，于是 `add_crit_per`（= `add_` + `crit_per`）、
 *    `diff_damage_per_per`（= `diff_damage_per` + `_per`）等
 *    **22 个类型合法键被误拒**。
 *
 * ✅ 正确做法：**按 6 个族各自独立判定**，任一命中即合法 —— 与类型定义一一对应。
 *    等价性由 `tests/g3-constants.test.ts` 用「类型全量展开 vs 守卫」双向对账守住，
 *    不靠人工枚举。
 *
 * ★ 2026-10-18 §66：`per`（容貌）已改名 `appearance` ⇒ **"核心键恰好等于派生后缀词"
 *   这颗雷拆掉了**（`isPropKey('per')` 现在返回 `false`，不再有歧义）。
 *   但反过来要注意：`appearance` 与形近的 `_per` 后缀不再有任何关系，别把
 *   `appearance_per` 当成"容貌百分比"写进内容 —— 它在类型上是合法的
 *   （= `appearance` + `_per`），语义上却没有消费者。
 */
export function isPropKey(x: string): x is PropKey {
  // 族 1: `c`
  if (isCoreProp(x)) return true;
  // 族 2: `${c}_per`
  if (x.endsWith('_per') && isCoreProp(x.slice(0, -4))) return true;
  // 族 3/4: `diff_${c}` / `diff_${c}_per`
  if (x.startsWith('diff_')) {
    const rest = x.slice(5);
    if (isCoreProp(rest)) return true;
    if (rest.endsWith('_per') && isCoreProp(rest.slice(0, -4))) return true;
  }
  // 族 5/6: `add_${c}` / `add_${c}_per`
  if (x.startsWith('add_')) {
    const rest = x.slice(4);
    if (isCoreProp(rest)) return true;
    if (rest.endsWith('_per') && isCoreProp(rest.slice(0, -4))) return true;
  }
  return false;
}

// ===========================================================================
// 2. 扩展属性（内容层自造）—— 开放集，但必须登记
// ===========================================================================

export interface ExtPropMeta {
  /** 中文显示名（面板/调试用；缺省则直接显示 key） */
  readonly display: string;
  /** 归属：`skill:taijijian` / `item:wd_jian` / `family:wd` ... */
  readonly owner: string;
}

/** 扩展键命名法：小写下划线，禁止大写、禁止连字符 */
export const EXT_PROP_RE = /^[a-z][a-z0-9_]*$/;

declare const EXT_PROP_BRAND: unique symbol;

/**
 * 已登记的扩展属性键。
 *
 * ★ 这是「内容层自造键**必须登记**」在**编译期**的落点：唯一能拿到这个类型的
 *   途径是调用 `registerExtProp()`。因此 `NpcDef.extProp` / `ItemDef.extProp`
 *   只接受登记过的键——**拿不到类型就写不进去**，不必等闸门报红。
 *
 * 残留缺口：`'x' as ExtProp` 这类强转能绕过品牌。该缺口由静态闸门 G3 兜底
 * （禁止在 `extProp` 里出现字符串字面量）。类型管主流、闸门管残留。
 */
export type ExtProp = string & { readonly [EXT_PROP_BRAND]: true };

const extProps = new Map<string, ExtPropMeta>();

/**
 * 登记一个扩展属性键，返回可用于 `extProp` 的**品牌类型**。
 * 内容层在 `world/` 里自造 buff/effect 键时必须调用。
 * 重复登记同一 key 但归属不同 → 抛错（防两处各造一套，即 wushen 的
 * 『两处各覆盖一份 recount()』同类问题，见 21 册 #20）。
 *
 * ★ 守卫必须是 `isPropKey` 而**不是** `isCoreProp`（docs/26 H1）：
 *   核心键空间不只是 PROPERTIES 表里列出的那些，还包括**由规则派生**的 MOD 族
 *   （`add_<c>` / `diff_<c>` / `<c>_per` / `add_<c>_per` / `diff_<c>_per`）。
 *   `add_gj` 这类键不在表里，但类型上就是合法 `PropKey`；只挡 `isCoreProp`
 *   会让同一个字符串同时存在于 `props` 与 `extProps` 两个 Map，
 *   破坏 24 册 §3.3「扩展键**永不**参与核心公式」这条不变量。
 */
export function registerExtProp(key: string, meta: ExtPropMeta): ExtProp {
  if (!EXT_PROP_RE.test(key)) {
    throw new Error(`扩展属性键不符合命名法：${JSON.stringify(key)}`);
  }
  // 两类冲突分开报，便于 24 册 §3.3 的对账与排查
  if (isCoreProp(key)) {
    throw new Error(`扩展属性键与核心属性重名：${key}`);
  }
  if (isPropKey(key)) {
    throw new Error(
      `扩展属性键与派生键（MOD 族）冲突：${key} —— ` +
        `它符合 add_/diff_/_per 派生规则、类型上是合法 PropKey，` +
        `同名同串会同时存在于 props 与 extProps 两个键空间（见 24 册 §3.3）`,
    );
  }
  const prev = extProps.get(key);
  if (prev !== undefined && prev.owner !== meta.owner) {
    throw new Error(
      `扩展属性键重复登记：${key}（已属 ${prev.owner}，又声明属 ${meta.owner}）`,
    );
  }
  extProps.set(key, meta);
  return key as ExtProp;
}

/**
 * 运行时判定：该键是否已登记的扩展属性键。
 *
 * ★ 它是**类型谓词**（`key is ExtProp`）而不是返回 `boolean`：
 *   `ExtProp` 这个品牌的语义就是"已登记"（唯一合法来源是 `registerExtProp()`），
 *   所以"判定通过"与"类型成立"是同一件事。
 *   写成谓词之后，调用方拿到 `true` 就能直接用，不必再写 `as ExtProp`
 *   —— 而 `as` 恰恰是本项目想消灭的东西（24 册 §3.4：类型管主流、闸门管残留，
 *   残留只应该是"绕过校验的强转"，不该是"校验之后的正常用法"）。
 */
export function isExtProp(key: string): key is ExtProp {
  return extProps.has(key);
}

export function extPropMeta(key: string): ExtPropMeta | undefined {
  return extProps.get(key);
}

export function allExtProps(): ReadonlyMap<string, ExtPropMeta> {
  return extProps;
}

// ===========================================================================
// 3. 装备
// ===========================================================================

/**
 * 装备槽位。wushen 缺 `PANTS` 但 `equipment.js` 与 `go.js:95` 都在用
 * （21 册 #17），新项目补齐；为保留与 wushen 的数值对照，追加在末尾。
 */
export const EQUIP_TYPE = {
  WEAPON: 0,
  CLOTH: 1,
  SHOES: 2,
  HEAD: 3,
  CAPE: 4,
  RING: 5,
  NECKLACE: 6,
  JEWELS: 7,
  WRIST: 8,
  WAIST: 9,
  THROWING: 10,
  PANTS: 11, // ★ 补齐
} as const;

export type EquipSlot = (typeof EQUIP_TYPE)[keyof typeof EQUIP_TYPE];
export type EquipSlotName = keyof typeof EQUIP_TYPE;

export const WEAPON_TYPE = {
  NONE: 'unarmed',
  SWORD: 'sword',
  BLADE: 'blade',
  STAFF: 'staff',
  CLUB: 'club',
  WHIP: 'whip',
  THROWING: 'throwing',
} as const;

export type WeaponType = (typeof WEAPON_TYPE)[keyof typeof WEAPON_TYPE];

/**
 * 战斗类型（wushen `this.fight_type`，`os/char/combat.js:10`）。
 *
 * ★ 三个取值是 wushen 的原样（`0` = 不在战斗、`1` = 切磋、`2` = 击杀）：
 *   - `FIGHT`（切磋）：`end_attack` 里对方气血跌破 **30%** 就自动收手
 *     （`os/char/combat.js:145` `target.hp / target.max_hp < 0.3`）；
 *   - `KILL`（击杀）：打到对方 `die()` 为止。
 *   六道闸门的 `allow_fight` 读的就是"`fightType > 0`"（`server/engine/command.ts`）。
 */
export const FIGHT_TYPE = {
  /** 不在战斗中 */
  NONE: 0,
  /** 切磋（点到为止） */
  FIGHT: 1,
  /** 击杀 */
  KILL: 2,
} as const;

export type FightType = (typeof FIGHT_TYPE)[keyof typeof FIGHT_TYPE];

// ===========================================================================
// 4. 技能
// ===========================================================================

export const SKILL_TYPES = {
  BASE: 0,
  SKILL: 1,
  KNOWLEDGE: 2,
} as const;

export type SkillType = (typeof SKILL_TYPES)[keyof typeof SKILL_TYPES];

/** 基本技能 id（任何武功都要 enable 到其中之一） */
export const BASE_SKILLS = {
  FORCE: 'force',
  DODGE: 'dodge',
  PARRY: 'parry',
  BITE: 'bite',
} as const;

export type BaseSkillId = (typeof BASE_SKILLS)[keyof typeof BASE_SKILLS];

/**
 * 装配槽（enable slot）—— **闭集**。武功只能"启用"到这些槽上。
 *
 * ★ 这就是 wushen 里最隐式、也最容易写错的那张表：
 *   它其实是 `BASE_SKILLS ∪ WEAPON_TYPE`（内功系 4 个 + 武器系 7 个），
 *   但 wushen 把它**拆在两处**、且**代码里从不列出全集**
 *   （`init_skill()` 直接用 `query_weapon_type()` 的结果当槽名）。
 *   于是"一个槽名拼错"不会有任何东西报错——它会静默变成一个取不到技能的空槽。
 *
 * 本项目的处理：合并成**一个联合类型**，并提供一个运行时守卫。
 *   - 内容层写 `can_enables: ['sword']` → 槽名写错即**编译失败**；
 *   - 运行时（校验器 / 存档）走 `isEnableSlot()` 兜底；
 *   - 与 `BASE_SKILLS` / `WEAPON_TYPE` 的**集合等价**由 `tests/g3-constants.test.ts` 断言
 *     （等价性是机检的，不靠人眼比对）——见 docs/27 决策 D1。
 */
export const ENABLE_SLOTS = [
  // 内功系（= BASE_SKILLS 的值）
  'force',
  'dodge',
  'parry',
  'bite',
  // 武器系（= WEAPON_TYPE 的值）
  'unarmed',
  'sword',
  'blade',
  'staff',
  'club',
  'whip',
  'throwing',
] as const;

export type EnableSlot = (typeof ENABLE_SLOTS)[number];

/** 运行时守卫（与 `EnableSlot` 类型逐字符串等价；由 g3-constants 测试对账） */
export function isEnableSlot(x: string): x is EnableSlot {
  return (ENABLE_SLOTS as readonly string[]).includes(x);
}

/** 品阶 0-6（`#` 变体与合成数量见 14 册 14.4） */
export const MAX_GRADE = 6;
export const GRADE_COMBINE_COUNT = [10, 10, 30, 50, 100, 200, 500] as const;

/** 境界等级 0-6（百姓 → 武神，见 05 册 5.1.2） */
export const MAX_LEVEL = 6;

// ===========================================================================
// 5. 方向（★ 这里修掉了 wushen 的一个未收录缺陷）
// ===========================================================================

export const DIRECTIONS = [
  'north',
  'south',
  'east',
  'west',
  'northup',
  'southup',
  'eastup',
  'westup',
  'northdown',
  'southdown',
  'eastdown',
  'westdown',
  'northeast',
  'southeast',
  'northwest',
  'southwest',
  'up',
  'down',
  'enter',
  'out',
] as const;

export type Direction = (typeof DIRECTIONS)[number];

/**
 * 方向短写。
 *
 * ⚠️ wushen 的 `world/cmd/action/go.js:50-58` 中 `doors[]` 与
 * `doors_short[]` **两个数组顺序错位**，导致 `s → west`、`w → south`、
 * `se → northwest` 等 13 个短写指向错误方向，而 `go.js:8` 直接
 * `dir = OUTER_DOORS[dir]` 消费它 —— 即『按 s 往西走』。
 * 该缺陷未收录于 21 册 24 条清单，此处为独立复核所得。
 * 新项目按标准对应关系重新定义（G5 闸门会校验方向集合一致性）。
 */
export const DIRECTION_ALIASES: Readonly<Record<string, Direction>> = {
  n: 'north',
  s: 'south',
  e: 'east',
  w: 'west',
  nu: 'northup',
  su: 'southup',
  eu: 'eastup',
  wu: 'westup',
  nd: 'northdown',
  sd: 'southdown',
  ed: 'eastdown',
  wd: 'westdown',
  ne: 'northeast',
  se: 'southeast',
  nw: 'northwest',
  sw: 'southwest',
  u: 'up',
  d: 'down',
};

/** 方向归一化：接受全称或短写 */
export function normalizeDirection(raw: string): Direction | null {
  if ((DIRECTIONS as readonly string[]).includes(raw)) return raw as Direction;
  return DIRECTION_ALIASES[raw] ?? null;
}

/**
 * 方向 → 中文显示名（**单源**）。
 *
 * ★ 为什么放在共享层而不是各端自备一份：
 *   同一份映射有三个消费者，且以前**各写了一半** ——
 *   前端自带一个 `DIR_LABEL`（写全了 12 个方向），服务端一个都没有，
 *   于是房间派生出来的移动动作只能拿英文方向名当按钮文字。
 *   这正是 24 册 §3「单源真相」要消除的第二份：一边改了另一边不知道。
 *
 *   现在唯一的消费者们：`server/engine/room.ts`（派生动作起名）、
 *   前端出口卡片 / 小地图格子（`src/ui/room.ts`、`src/ui/map.ts`，都经过
 *   `src/ui/dirs.ts` 的 `dirLabel()` 再导出）、以及移动被挡时的提示文案。
 *
 * ★ 与 `DIRECTION_ALIASES` 的分工：那张表是**输入归一化**（`n` → `north`），
 *   这张表是**输出显示**，两者都是方向键，但不是同一件事 ——
 *   合并会让"接受哪些写法"与"显示成什么"互相绑死。
 */
export const DIRECTION_LABELS: Readonly<Record<Direction, string>> = {
  north: '北',
  south: '南',
  east: '东',
  west: '西',
  northeast: '东北',
  southeast: '东南',
  northwest: '西北',
  southwest: '西南',
  northup: '北上',
  southup: '南上',
  eastup: '东上',
  westup: '西上',
  northdown: '北下',
  southdown: '南下',
  eastdown: '东下',
  westdown: '西下',
  up: '上',
  down: '下',
  enter: '进入',
  out: '出去',
};

/**
 * 走不动的三种原因（`Character.go()` 的结果里用它）。
 *
 * ★ 为什么不是 `boolean`：**玩家要知道的是"为什么"**，而三句话完全不同 ——
 *   "这个方向没有出路"（看错了方向）/"那边过不去"（内容拦住了）/
 *   "那里人太多了，你过不去"（房间满了，等一下再来）。布尔值逼调用点说一句
 *   笼统的话，就等于把三种情况的区别抹掉。
 *
 * ★ wushen 的对应：`world/cmd/action/go.js:15`（没出路）、`os/char/chara_move.js:27`
 *   （满员）。它那边是**直接 `notify`** 的 —— 本项目把它做成返回值，
 *   让文案留在调用点（内容层 / 派生动作），引擎不产出用户可见文字。
 */
export type MoveBlock = 'no-exit' | 'blocked' | 'full';

/**
 * `Character.go(dir)` 的结果。
 *
 * 判别式联合：`ok: true` 时**没有** `reason` 字段，于是"忘了判 ok 就读 reason"
 * 在类型上写不出来。
 */
export type MoveResult = { readonly ok: true } | { readonly ok: false; readonly reason: MoveBlock };

/**
 * 走不动时的提示语。**每个原因一句，只此一处**。
 *
 * ★ 前两句是 wushen 原句：`go.js:15` 的"这个方向没有出路。"、
 *   `chara_move.js:27` 的"那里人太多了，你过不去。"；
 *   中间那句（内容在 `on_leave` 里拦住）wushen 没有对应文案 ——
 *   它的 `moveto` 返回 false 时是**静默**的，本项目保留自己的这一句。
 *
 * ★ 放在 `shared/` 而不是内容层的理由：它同时被**引擎**（`engine/room.ts`
 *   派生的方向动作）与**内容层**（`world/command/move/go.ts`）用，
 *   而内容层不能 import 引擎（G13）。两处各写一份就是 26 册 §16.7 第 7 条
 *   那类"同一句话写两遍"（FG-21 同族）—— 这条测试钉住了它。
 */
export const MOVE_MESSAGES: Readonly<Record<MoveBlock, string>> = {
  'no-exit': '这个方向没有出路。',
  blocked: '那边过不去。',
  full: '那里人太多了，你过不去。',
};

// ===========================================================================
// 6. 指令权限闸门（六道 + 登录期）
//    默认值取自 wushen `os/command.js:11-14` 与 `character.js:198-222`
// ===========================================================================

export const COMMAND_GATES = [
  'allow_fight',
  'allow_busy',
  'allow_state',
  'allow_die',
  'allow_faint',
  'allow_login',
] as const;

export type CommandGate = (typeof COMMAND_GATES)[number];

/** 注意 `allow_fight` 默认 **true**（战斗中默认可执行），其余为 false */
export const COMMAND_GATE_DEFAULTS: Readonly<Record<CommandGate, boolean>> = {
  allow_fight: true,
  allow_busy: false,
  allow_state: false,
  allow_die: false,
  allow_faint: false,
  allow_login: false,
};

/** GM 等级闸门（`allow_level`），0 = 普通玩家 */
export const DEFAULT_ALLOW_LEVEL = 0;

// ===========================================================================
// 7. 频道（`msg` 包的 `ch` 字段，见 06 册 6.4.1）
// ===========================================================================

/**
 * 聊天 / 消息频道闭集。
 *
 * ★ **判据是"要不要跨出房间"，不是"能不能说话"**（26 册 §24）：
 *   房间里说话走 `Actor.sendRoom`（引擎按三视角逐人渲染，进**主消息流**），
 *   只有**跨房间**的才需要一个频道 id 来告诉会话层"投给谁"。
 *
 *   wushen 就是这么分的 —— `src/dialog/channel.js` 的页签只有
 *   「全部 / 世界 / 队伍 / 门派 / 全区 / 帮派 / 系统」，
 *   `createElement` 的 `switch (data.ch)` 也只有 tm/fam/rumor/sys/es/pty，
 *   **没有「房间」这一档**：`say` 在那边是 `send_room`。
 *
 * ★ 所以这里**没有** `'say'` 和 `'emote'` 两档：
 *   - `'say'` 走 `sendRoom`（内容层 `world/command/chat/say.ts`），
 *     留在闭集里就是一个**零生产者**的档位（24 册 §4 禁止清单第 6 条）；
 *   - `'emote'` 是**包类型**不是频道 —— wushen `world/cmd/channel/emote.js:79`
 *     发的是 `{type:'emote',items:[…]}`（表情清单），前端也已经有 `emote` handler
 *     开面板。把它塞进 `CHANNELS` 会让同一件事有两个名字。
 *
 * ★ `'tell'`（私聊）是**补登记**：wushen 有 `world/cmd/channel/tell.js`，但那个
 *   `enter` 是**空的**（一行都没实现）；本项目实现了它，于是 `msg.ch` 必须有这一档 ——
 *   否则私聊只能借用 `chat`（把私聊广播给全服，是隐私事故）。
 *   按 24 册 §3 的纪律，闭集里缺的那一档在这里补上，而不是在内容层借用别的频道 id。
 *
 * ★ 其余几档（tm / fam / pty / es / rumor / sys）wushen 都有、本项目**还没实现**
 *   对应指令，因此目前**零生产者**。它们留在闭集里是**协议面**的登记，
 *   但"声明了没有生产者"这件事已被 26 册 T19 记为待办（要一条闸门来对账，不是靠人记）。
 */
export const CHANNELS = [
  'chat',
  'tm',
  'fam',
  'pty',
  'es',
  'rumor',
  'tell',
  'sys',
] as const;

export type Channel = (typeof CHANNELS)[number];

/**
 * 说话 / 喊话的正文长度上限（**字符**数）。
 *
 * ★ wushen 两处一字不差：`world/cmd/channel/say.js:11` 与 `chat.js:10`
 *   都是 `if (str.length > 200) return me.notify("你说的太多了。")`。
 *   `>` 不是 `>=`：**200 整是放行的**（边界归测试钉住，不靠读代码确认）。
 *
 * ★ 放 `shared/` 的理由同 `MOVE_MESSAGES`：两条**内容层**指令（say / shout）
 *   都要用，而"同一句话写两遍"是 24 册铁律 4 要消除的第二份真相。
 */
export const CHAT_MAX_LENGTH = 200;

/** 超长时的提示语（wushen `say.js:11` / `chat.js:10` 的原句，两处相同） */
export const CHAT_TOO_LONG = '你说的太多了。';

// ===========================================================================
// 8. 面板（`dialog` 容器的 `dialog` 字段，见 06 册 6.5）
// ===========================================================================

export const DIALOG_NAMES = [
  'pack',
  'pack2',
  'list',
  'shop',
  'score',
  'skills',
  'master',
  'stats',
  'tasks',
  'events',
  'jh',
  'trade',
  'paimai',
  'party',
  'team',
  'relation',
  'message',
  'channel',
  'map',
  'setting',
  'keys',
  'extend',
] as const;

export type DialogName = (typeof DIALOG_NAMES)[number];

/**
 * `dialog` 帧的**控制字段**（与"内容字段"相对）：它们改的是**面板本身**，不是面板里的行。
 *
 * ★ 单源（F4，2026-10-16 审查）：`protocol.ts` 的 `DialogControlShape`（zod schema）
 *   与前端 handler 的分流逻辑都读这份列表 —— 各写一份就会出现"协议声明了、前端不认"
 *   （原先正是如此：`{dialog:'pack', close:true}` 被当成普通字段列成一行 `close: true`）。
 *   `tests/protocol.test.ts` 有一条断言把"schema 认这四个字段"钉住（改了一边会红）。
 */
export const DIALOG_CONTROL_FIELDS = [
  'close',
  'refresh',
  'clear',
  'remove',
] as const;

export type DialogControlField = (typeof DIALOG_CONTROL_FIELDS)[number];

// ===========================================================================
// 9. 金钱（取自 wushen `os/util/util.js:49 moneyToStr`）
//    1 黄金 = 10000 铜板，1 白银 = 100 铜板
//    金额一律以「铜板」为最小单位的整数存储，禁止浮点。
// ===========================================================================

export const MONEY_PER_SILVER = 100;
export const MONEY_PER_GOLD = 10_000;

/**
 * 金额 → 可读串（wushen `os/util/util.js:49 moneyToStr`）。
 *
 * ★ 上面那行注释（"取自 wushen `os/util/util.js:49 moneyToStr`"）写了很久，
 *   但**函数一直没搬过来** —— 于是 `MONEY_PER_SILVER` / `MONEY_PER_GOLD`
 *   两个常量在这之前**一个消费者都没有**。`give <谁> <数目> money` 是它的第一个。
 *
 * ★ **照抄 wushen 的两个边界**（不改，但写下来，免得被当成 bug 去"修"）：
 *   - `value >= 10000` 用 `>=`，而下面白银那一档是 `value > 100`（**不是** `>=`）：
 *     于是 **恰好 100** 会落到铜板档，输出「100个铜板」而不是「1两白银」。
 *   - `if (!value) return ''` —— 金额 0 / 负数输出**空串**，不是「0个铜板」。
 *   ⇒ 本项目照抄：这是**显示**层，偏离只会让两边看起来不一样而没有收益。
 *   （数值本身仍一律以铜板为单位的整数存储，见本节表头。）
 *
 * ★ 颜色标签 `<hiy>` / `<wht>` / `<yel>` 在前端白名单里
 *   （`src/ui/markup.ts` 的 `KNOWN`，大小写不敏感），所以这些标签会**真的上色**。
 */
export function moneyToStr(value: number): string {
  if (!value) return '';
  const parts: string[] = [];
  let rest = value;
  if (rest >= MONEY_PER_GOLD) {
    parts.push(`${String(Math.trunc(rest / MONEY_PER_GOLD))}两<hiy>黄金</hiy>`);
    rest %= MONEY_PER_GOLD;
  }
  if (rest > MONEY_PER_SILVER) {
    parts.push(`${String(Math.trunc(rest / MONEY_PER_SILVER))}两<wht>白银</wht>`);
    rest %= MONEY_PER_SILVER;
  }
  if (rest > 0) {
    parts.push(`${String(rest)}个<yel>铜板</yel>`);
  }
  return parts.join('');
}

/**
 * `give <谁> <数目> money` 里那个保留字（wushen `world/cmd/obj/give.js:10`
 * 的 `objid == "money"`）。
 *
 * ★ 为什么放在 `shared/`：它是**协议级**的字面量 —— 两个内容文件都要用它
 *   （`world/command/item/give.ts` 产出它、`world/npc/pub/xiaoer.ts` 的
 *   `on_accept` 按它分派）。各写一份字面量就是 24 册 §3 那种"第二份真相"
 *   （改一处另一处静默不跟）。
 * ★ 它同时是 `InteractHooks.onAccept` 的 `objId` 参数的一个取值
 *   —— 那个参数**要么**是这个保留字，**要么**是物品的模板 id（`drug/yao#0`）。
 */
export const GIVE_MONEY_KEY = 'money';

// ===========================================================================
// 10. 存档 / 心跳 / 限流（200 人规模基线，见 23 册 §7）
// ===========================================================================

export const PROTOCOL_VERSION = 1;
export const TICK_MS = 200; // 全局战斗 tick
export const WS_PING_INTERVAL_MS = 30_000; // WS 层 ping/pong
export const APP_HEARTBEAT_MS = 5_000; // 业务心跳
export const RATE_LIMIT_PER_5S = 20; // 每连接每 5s 指令上限
export const RATE_LIMIT_WINDOW_MS = 5_000; // ★ 与上面配套的窗口长度（原先是"隐含在常量名里"）

// ---- 网络层（本批落地；消费者见 server/net/**，不是"声明未实现"）----
/** 同时在线连接数上限。超出即拒绝新连接（T1 的三项缺失上限之一） */
export const MAX_CONNECTIONS = 200;
/**
 * **单个来源地址**的连接数上限（2026-10-13 体检 N4）。
 *
 * ★ 为什么全局上限不够：`MAX_CONNECTIONS` 是**全服**名额。一个地址开 50 条连接
 *   赖在起始房，就把房间容量与全局名额一起吃掉 —— 之后所有人登不上，
 *   而服务端没有踢人手段。全局上限越大，这个代价越高。
 * ★ 取 8 的依据：正常玩家一条连接就够；同址多开是"多客户端 / 脚本"的味道。
 *   8 给同一 NAT 后的宿舍 / 家庭留余地，又不至于让一个人吃掉房间容量。
 * ★ **没有来源地址的连接不参与**这项判定（见 `NetConnection.peerAddress`）：
 *   量不到的东西不拿来当判据。
 */
export const MAX_CONNECTIONS_PER_IP = 8;
/**
 * 单连接的**出站队列**上限（条数）。超过即判定"发不出去"，直接断连。
 *
 * ★ 它与下面的 `MAX_BUFFERED_BYTES` 是**两道上限，各管一段**（FG-14）：
 *   - 本项管 hub **自己的**队列（`ConnRecord.outbound`）—— 消费者是"一次 enqueue
 *     之后没能立刻 drain"的调用方（`server/session.ts#send` 是 enqueue+drain，
 *     所以正常情况下长度恒 ≤ 1，这道上限只在**批量发送**的调用方出现时才咬得住）。
 *   - 缓冲那项管**接收方**（socket 的 `bufferedAmount`）。
 *   只留本项的话，"客户端不读"这件事在运行时根本没判据：
 *   `enqueue` 完立刻 `drain`，队列永远攒不起来 —— 这正是 26 册 FG-14。
 */
export const MAX_OUTBOUND_QUEUE = 256;
/**
 * 单连接的**出站缓冲**上限（字节）。来源是适配层报上来的真实积压量
 * （`NetConnection.bufferedBytes()`，ws 侧是 `socket.bufferedAmount`）。
 *
 * ★ 为什么必须问**接收方**而不是只看自己的队列：见 `MAX_OUTBOUND_QUEUE` 的说明。
 *   1 MiB 的量级依据：一条 `items` 帧约 6 KiB，一个完全停止读取的客户端
 *   攒到 1 MiB 意味着上百帧没被消费 —— 那不是抖动，是"不读了"。
 */
export const MAX_BUFFERED_BYTES = 1_048_576;
/**
 * 多久没收到任何帧就踢掉（防半开连接占位）。
 *
 * ★ 26 册 §16.4 F1：原先取 `APP_HEARTBEAT_MS * 6` = **30s**，恰好**等于** `WS_PING_INTERVAL_MS`
 *   —— 零余量。`ws-server` 的 ping 定时器与 `pruneIdle` 是**两个独立定时器**，
 *   相位不利时 `pruneIdle` 会在 pong 回来之前先命中；表现是"挂机一会儿就被踢"，
 *   而日志上只看得到"空闲超过 30000ms"，完全看不出是竞态。
 *   现取 **3 倍 ping 间隔**：`ping 发出 → pong 返回 → 下一轮 prune 才判定`，留足余量。
 *
 * ★ 窗口大小只是**一半**的修法：判据口（`lastSeenMs`）还必须认得"协议级 pong"，
 *   否则放大到多少都只是"沉默多久才踢"，不解决"活着却被踢"。见 `ConnectionHub.touch()`。
 */
export const CONNECTION_IDLE_TIMEOUT_MS = WS_PING_INTERVAL_MS * 3;
export const AUTOSAVE_INTERVAL_MS = 60 * 60 * 1_000; // 全量存档间隔

// ---------------------------------------------------------------------------
// 11. 入站边界（★ docs/26 S1–S2：网络层一落地就必须先有的硬上限）
// ---------------------------------------------------------------------------
//
// 这三条的性质与其它常量不同：它们不是"数值"而是**安全边界**。
// 没有它们时，一个连接就能把内存打满（S1）或绕过全部 schema（S2）。
// 因此它们不是"等网络层再定"，而是**现在就把门槛钉死**。

/**
 * 单帧消息体硬上限（字节）。
 * WS 层应同时设置 `maxPayload`（双保险：库层拒绝 + 业务层拒绝）。
 * 8 KiB 的依据：最大的一帧是房间 `items` 列表 —— **房间容量是 50**
 * （`server/engine/room.ts` 的 `DEFAULT_ROOM_CAPACITY`，含玩家/NPC/物品），
 * 50 项 × 每项 ~60 字节 ≈ **3 KiB**，8 KiB 给它留了 2 倍余量。
 * ⚠️ 旧注释写"百来个物品 × 60 字节 ≈ 6 KiB" —— 与房间容量 50 对不上，已按实际口径重算。
 */
export const MAX_MESSAGE_BYTES = 8 * 1024;

/**
 * WS 层的 `maxPayload`（**库层**先拦一道，业务层再拦一次 —— 两道都要有）。
 * 取 `MAX_MESSAGE_BYTES` 的 2 倍：合法最大帧（房间 items ≈ 3 KiB）留足余量，
 * 又不至于让库层先把内存吃光。消费者：`server/net/ws-server.ts` 的 `new WebSocketServer({ maxPayload })`。
 */
export const WS_MAX_PAYLOAD_BYTES = MAX_MESSAGE_BYTES * 2;

/**
 * 明文字符数上限（含命令与参数）。
 * 明文只承载**一条指令**，不是自由文本；超过这个长度只能是攻击或异常客户端。
 */
export const MAX_PLAINTEXT_CHARS = 256;

/**
 * 出/入站分诊的**唯一**判据：一帧是不是"看起来像 JSON"。
 *
 * ★ 这是**两端共用**的一份（S10，2026-10-16 审查）：服务端 `protocol.ts#routeFrame`
 *   用它决定走 JSON 分支还是明文分支；前端 `net/client.ts#sendCommand` 用它决定
 *   一条指令发明文还是发 `command` 包。两边一旦分叉，表现是"偶尔有一行指令
 *   被当成坏包解析失败并断连"—— 所以放在**双方都能 import 的共享层**，
 *   而不是在 protocol（前端只许 `import type`）与 client 里各写一份。
 *
 * ★ 无 `g` 标志（否则 `test()` 会带 `lastIndex` 状态，跨调用互相污染）。
 */
export const LOOKS_LIKE_JSON_RE = /^\s*[[{]/;

// ---------------------------------------------------------------------------
// 12. 创角四维（★ docs/26 L5：原先只活在报错文案与注释里）
// ---------------------------------------------------------------------------
//
// 原先 `REG_ATTR_RANGE = '四维需在 15-30 之间'`、`REG_ATTR_SUM = '属性之和必须等于 80'`
// 把设计数值**写死在文案里**：改设计时文案与校验逻辑会各自漂移。
// 现在数值在这里，文案由数值生成。

/** 四维单项下限 */
export const REG_ATTR_RANGE_MIN = 15;
/** 四维单项上限 */
export const REG_ATTR_RANGE_MAX = 30;
/** 四维之和 */
export const REG_ATTR_SUM_TOTAL = 80;

// ---------------------------------------------------------------------------
// 13. 性别（★ docs/26 T18：**三档**，不是布尔）
// ---------------------------------------------------------------------------
//
// wushen 的口径是 `1` 男 / `2` 女 / `0` 无性（`os/skill/skill.js:239` 的
// "男性/女性/无性"文案就是按这三档发的）。
//
// ★ 本项目原先只有 `0 | 1` 两档，而**文案已经是三档** —— 于是"想写一门
//   只有女性可学的武功"在类型上表达不出来（只能写成"非男性"）。
//   这是"类型比实现窄一节"的典型：不报错，只是逼内容说谎。
//   24 册 T18 的修法就是把三档收成**一处**（本段）。

export const GENDERS = [0, 1, 2] as const;

/** 性别：`1` 男 / `2` 女 / `0` 无性（wushen 同序） */
export type Gender = (typeof GENDERS)[number];

/**
 * 性别 → 中文。**唯一来源**（`skill.ts` 的学习条件拒绝语用它）。
 *
 * ★ 与 `Character.call3()`（「他 / 她」）**不是同一张表**，别合并：
 *   wushen 的 `call3` 原文只判 `gender == 1`，第三档一律读"她" ——
 *   叙述里的第三人称称谓与"这门武功要什么性别"是两件事。
 */
export const GENDER_LABELS: Readonly<Record<Gender, string>> = {
  0: '无性',
  1: '男性',
  2: '女性',
};

/**
 * **境界名**（0–6 档）—— 面板与 `score` 显示的"这个人练到什么份上"。
 *
 * ★★ 这是本项目的**新造表**，不是从 wushen 抄来的：wushen **没有境界名**，
 *   它只有 27 档「技能火候」描述（`os/char/chara_comm.js:209-235` 的 `skill_levels`：
 *   初学乍练 / 粗通皮毛 / … / 深不可测 / 返璞归真），那是"某**一门**武功练到几成"，
 *   与"这个人整体什么层次"不是一个概念。把两件事混成一张表，就会得到
 *   "你的整体境界是『半生不熟』"这种读起来像骂人的话。
 *
 * ★ 词取自传统 MUD 的通行说法（`登堂入室` / `一代宗师` / `深不可测` 三档在 wushen
 *   那张火候表里也有，属同源措辞；其余是武侠小说里的常见分档）。
 *
 * ★ 档位与**阈值**分开：名字表在这里（显示，前后端都要读），阈值在
 *   `server/engine/skill.ts#SKILL_FORMULA.realmThresholds`（规则，只有引擎读）。
 *   两者靠 `REALM_NAMES.length === realmThresholds.length + 1` 对齐（有单测钉）。
 */
export const REALM_NAMES = [
  '初出茅庐',
  '略知皮毛',
  '崭露头角',
  '登堂入室',
  '融会贯通',
  '一代宗师',
  '深不可测',
] as const;

/** 境界名（先钳到 `0..len-1` 再取；**不抛**：显示层不该因为数错一档就崩） */
export function realmName(realm: number): string {
  const n = Number.isFinite(realm) ? Math.trunc(realm) : 0;
  const i = Math.min(Math.max(n, 0), REALM_NAMES.length - 1);
  // `?? ''` 在 `noUncheckedIndexedAccess` 下是必须的；钳过之后**不可达**
  return REALM_NAMES[i] ?? '';
}

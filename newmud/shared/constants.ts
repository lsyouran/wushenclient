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
 * 引擎核心属性表：key → 中文显示名。
 *
 * 关于 key 的命名法（**数据层不改名、只做收口**）：
 *   - 保留 wushen 的 key 原样（gj/fy/ds/zj/mz/bj/gjsd 等拼音缩写），
 *     因为它们是**数据契约**：内容层 `prop: { gj: 20 }`、协议帧 `max_hp`、
 *     存档都在用，改名就等于把"照抄 wushen 内容"这条路堵死；
 *   - 但把它们收成一个**闭集联合类型**，从此再也无法写出
 *     `attack` / `defence` / `gjsd_peer` 这类拼错却静默通过的键。
 *   - ★ **代码里不要写这些裸字符串** —— 用下面的 `PROP` 别名表（`PROP.attack`），
 *     落库/上网仍是 `'gj'`。人读的完整对照见 29 册 §29.10。
 *
 * 派生规则（不逐一枚举，见 ModProp 类型）：
 *   `<X>_per`       百分比加成
 *   `diff_<X>`      减免 / 抵抗
 *   `diff_<X>_per`  减免百分比
 *   `add_<X>`       追加
 *   `add_<X>_per`   追加百分比
 */
export const PROPERTIES = {
  // -- 先天四维（建号时 15-30，和 = 80，见 05 册 5.1.4） --
  con1: '先天根骨',
  dex1: '先天身法',
  int1: '先天悟性',
  str1: '先天臂力',

  // -- 基础八维 + 福缘 --
  con: '根骨',
  dex: '身法',
  int: '悟性',
  str: '臂力',
  kar: '福缘', // ★ wushen 源码使用了但 PROPERTIES 未定义（21 册 #17）
  per: '容貌',
  age: '年龄',
  gender: '性别', // ★ 补齐：character.js 用作基础字段

  // -- 战斗核心（拼音缩写，保留） --
  //    ★ 保留拼音不只是"照抄 wushen"：它就是与**技能 id**（`dodge`/`parry`/`force`，
  //      全英文）分开的机制。改写成英文全称会与技能 id 撞名 ⇒ 见 `PROP` 表处的说明。
  gj: '攻击',
  fy: '防御',
  ds: '躲闪',
  zj: '招架',
  mz: '命中',
  bj_per: '暴击',
  sh: '伤害',
  bjsh: '暴击伤害',
  gjsd: '攻击速度',

  // -- 气血 / 内力 --
  max_hp: '气血上限',
  max_mp: '内力上限',
  limit_mp: '内力上限加成',

  // -- 绝招节奏 --
  distime: '绝招冷却',
  releasetime: '绝招释放',
  expend_mp: '内力消耗',
  distime_per: '绝招冷却',
  releasetime_per: '绝招释放',
  expend_mp_per: '内力消耗',

  // -- 状态 --
  busy: '忙乱时间',

  // -- 活动效率与产出（打坐/练习/采药/挖矿/钓鱼/炼药/闭关） --
  study_per: '学习效率',
  dazuo: '打坐效率',
  dazuo_per: '打坐效率',
  lianxi_per: '练习效率',
  recover_per: '疗伤效果',
  caiyao1: '采药效率',
  caiyao_exp: '采药经验',
  caiyao_pot: '采药潜能',
  kuang1: '挖矿效率',
  kuang_exp: '挖矿经验',
  kuang_pot: '挖矿潜能',
  diaoyu1: '钓鱼效率',
  diaoyu_exp: '钓鱼经验',
  diaoyu_pot: '钓鱼潜能',
  lianyao1: '炼药效率',
  lianyao2: '丹药产出',
  lianyao_exp_per: '炼药获得经验',
  xiulian_exp: '闭关经验',
  shuangxiu: '双修效率',
  fenjie: '分解获得的玄晶',

  // -- 战斗修正 --
  gj_per: '攻击',
  fy_per: '防御',
  ds_per: '躲闪',
  zj_per: '招架',
  mz_per: '命中',
  hp_per: '气血',
  gjsd_per: '攻击速度',
  add_sh: '伤害增加',
  add_sh_per: '最终伤害',
  add_bjsh_per: '暴击伤害',
  diff_sh: '受到的伤害减少',
  diff_sh_per: '伤害减免',
  diff_sh_per2: '伤害减免',
  diff_fy_per: '忽视对方防御',
  diff_fy_per2: '伤害减免',
  diff_bj: '暴击抵抗',
  diff_busy: '忽视忙乱',
  diff_busy_per: '忽视忙乱',
  diff_downside: '负面状态抵抗',
  diff_downside_per: '负面状态抵抗',
  busy_per: '忙乱时间',

  // -- 控制类 --
  no_fy: '无法防御',
  no_pfm: '禁止绝招',

  // -- 副本 / 支付 --
  score: '副本分数',
  cash_money: '充值货币', // ★ 补齐
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
 * 属性键的**中文名**（wushen `PROPERTIES` 表；`propLabel('str') === '臂力'`）。
 *
 * ★ 为什么要它：面向玩家的文案不该出现 `gj` / `mz` 这类拼音键
 *   （wushen `os/skill/skill.js:235` 也是用 `PROPERTIES[key]` 拼学习条件拒绝语）。
 * ★ `ModProp` 是**由规则派生**的联合类型（`add_<X>` 等），并不都在 `PROPERTIES` 里
 *   ⇒ 未登记时回落到键本身，不产生 `undefined` 文案。
 */
export function propLabel(key: string): string {
  return (PROPERTIES as Readonly<Record<string, string>>)[key] ?? key;
}

/**
 * 属性键的**可读别名表**（`PROP.attack === 'gj'`）。
 *
 * 为什么要有这一层：
 *   - `PROPERTIES` 的键**故意保留 wushen 原样**（`gj`/`fy`/`gj_per`…）—— 它们是
 *     **数据契约**（内容层 / 协议帧 / 存档都在用），改了就把"照抄 wushen 内容"堵死；
 *   - 可**代码**里满屏 `getProp(props, 'gj')` 没人读得懂（`gj` 是拼音缩写）。
 *   ⇒ 中间加一层：**代码写 `PROP.attack`，落库/上网仍是 `'gj'`**。
 *
 * ★ 这一层**不是**第二事实源：
 *   - 值必须 ∈ `PropKey`（`satisfies` 编译期兜底，写错键名直接编译失败）；
 *   - 静态闸门 **G3.F** 逐值对账（∈ CORE∪MOD、**无重复值**、非空）；
 *   - `tests/prop-alias.test.ts` 再双向钉一遍（含"每个别名都有中文名"）。
 * ★ 人读版对照（别名 ↔ wushen 键 ↔ 中文）在 `docs/29` §29.10。
 *
 * ★ **命名空间隔离**（2026-10-14；静态闸门 **G3.G** 守）：别名键**不得**与技能 id /
 *   装配槽重名（`ENABLE_SLOTS` = `force/dodge/parry/bite/sword/…`，见本文件 §4）。
 *   这正是 wushen 拿"属性用拼音、技能用英文"分开的那条线 —— 所以躲闪/招架叫
 *   `evasion`/`deflect`，**不叫** `dodge`/`parry`（后两个是 `BASE_SKILLS` 里的
 *   基础技能 id）。★ **下面这两个目录在 wushen 侧**，本项目内容层尚未落地：
 *   `wushen/world/skill/dodge/`（8 部轻功）、`wushen/world/skill/parry/`（空目录），
 *   基本技能定义在 `wushen/world/skill/base/dodge.js` / `base/parry.js`。
 *   ⚠️ 旧注释漏了 `wushen/` 前缀，读起来像本项目有这两个目录 —— 实际
 *   `newmud/world/skill/` 下只有 `base/force.ts`、`base/sword.ts`、`wd/taijijian.ts`。
 *
 * ⚠️ 两个易混点（别写反）：
 *   1. `PROP.strengthBonus` 取的是 **`'str'` 这个「臂力加成」键**，
 *      与"先天臂力"（`InnateStats.str`）不是一回事；
 *   2. `PROP.maxHpBonus`（`'max_hp'` = 气血**加成**）与派生值 `derived.maxHp`
 *      （算出来的**上限**）同名不同物 —— wushen 也是这个坑。
 */
export const PROP = {
  // -- 先天四维的「加成」键（平加；与裸的先天值 str/con/dex/int 是两回事）--
  strengthBonus: 'str',
  constitutionBonus: 'con',
  dexterityBonus: 'dex',
  intelligenceBonus: 'int',

  // -- 战斗属性：平加 --
  attack: 'gj',
  defense: 'fy',
  hit: 'mz',
  /** 躲闪（`ds`）。★ **不要**写成 `dodge` —— 那是**技能 id**（基础轻功），见本文件 §4 */
  evasion: 'ds',
  /** 招架（`zj`）。★ **不要**写成 `parry` —— 那是**技能 id**（基础招架），见本文件 §4 */
  deflect: 'zj',
  /** 暴击（wushen 键名带 `_per` 但**当平加**用，照抄） */
  crit: 'bj_per',
  /** 攻击速度加成（毫秒，从间隔基准里减） */
  attackSpeed: 'gjsd',

  // -- 战斗属性：百分比修正（写 50 表示 +50%）--
  attackPer: 'gj_per',
  defensePer: 'fy_per',
  hitPer: 'mz_per',
  evasionPer: 'ds_per',
  deflectPer: 'zj_per',
  attackSpeedPer: 'gjsd_per',

  // -- 气血 --
  /** 气血**加成**（不是上限本身，见上面易混点 2） */
  maxHpBonus: 'max_hp',
  hpPer: 'hp_per',

  // -- 透传给战斗层的修正 --
  /** 伤害减免（百分比） */
  damageReductionPer: 'diff_sh_per',
  /** 忽视对方防御（百分比） */
  ignoreDefensePer: 'diff_fy_per',
} as const satisfies Record<string, PropKey>;

/** `PROP` 的别名键（`'attack'` / `'crit'` …） */
export type PropAlias = keyof typeof PROP;

export function isCoreProp(x: string): x is CoreProp {
  return Object.hasOwn(PROPERTIES, x);
}

/**
 * 运行时守卫：必须与 `PropKey` 类型**逐字符串等价**。
 *
 * ❌ 曾经的实现是「一次性剥掉 `diff_`/`add_` 前缀 + `_per` 后缀，再查核心键」。
 *    那是错的：核心表里本身就有以 `_per` 结尾（`bj_per`、`diff_sh_per`）、
 *    以 `add_`/`diff_` 开头（`add_sh`、`diff_fy_per2`）的键，单次剥离会**多剥一层**，
 *    于是 `add_bj_per`（= `add_` + `bj_per`）、`diff_sh_per_per`（= `diff_sh_per` + `_per`）
 *    等 **22 个类型合法键被误拒**。
 *
 * ✅ 正确做法：**按 6 个族各自独立判定**，任一命中即合法 —— 与类型定义一一对应。
 *    等价性由 `tests/g3-constants.test.ts` 用「类型全量展开 vs 守卫」双向对账守住，
 *    不靠人工枚举。
 *
 * ⚠️ 反面样本：`per`（容貌）本身是合法核心键，同时又是派生后缀词，极易被误伤。
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

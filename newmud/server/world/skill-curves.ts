/**
 * server/world/skill-curves.ts — 基本技能 ① 档被动的**曲线**
 * ============================================================================
 * 为什么单独一个文件（不是塞进 `engine/skill.ts` 的 `SKILL_FORMULA`）：
 *
 *   曲线的**调用方是内容层** —— `world/skill/base/*.ts` 的 `passiveProp` 要调它。
 *   而 G13 的 D2 规定「内容层只允许 import `@shared/**` 与 `server/world/**`」
 *   （内容不该依赖引擎内部实现）。若把函数留在 `engine/skill.ts`，
 *   6 个内容文件只能各自写一条曲线 —— 那就是第二份真相。
 *
 *   ★ 于是曲线的**数值**与**函数**都在这里；引擎侧要读它也不违规
 *     （D1 只禁 `server/engine` → `world/**`，不禁 → `server/world/**`）。
 *   ★ 汇总视图仍只有一处：`server/engine/tuning.ts` 把 `SKILL_CURVE` 与
 *     `COMBAT_FORMULA` / `SKILL_FORMULA` 并排列出，启动日志里能看到生效参数。
 *
 * ---------------------------------------------------------------------------
 * ★★ 曲线形状：**凸**（越到后期每级给得越多），不是凹、也不是线性
 *
 * 这是三版演进后的结论，前两版都被推翻过，记在这里免得再走回头路：
 *
 *   ① **wushen 线性**：内功/轻功/拳脚 `lv/10`，招架/刀剑 `lv`。
 *      1000 级会给属性 **+100**（而先天只有 20–30）、派生 **+1000**
 *      （而对抗是线性比较，差 2 倍就绝对碾压）⇒ 不可用。
 *
 *   ② **平方根**（本批第一版，已撤）：`trunc(sqrt(lv) * k)`。
 *      数值上没问题，但**方向是反的** —— 平方根是凹函数，越到后期每级给得越少。
 *      而技能等级上限是**经验立方**换算出来的（`levelLimit`，见 `engine/skill.ts`）：
 *      从 100 级练到 1000 级，角色经验要涨 1000 倍。
 *      成本涨 1000 倍而收益反而变慢 ⇒ **后期练功没有任何意义**。
 *      正确的取向是：**后期更难，但后期每级也更值钱**。
 *
 *   ③ **幂律（本版）**：`trunc(maxGain * (lv / refLevel) ^ exponent)`，`exponent > 1`。
 *      凸函数天然满足「每级增量递增」；而只要 `exponent < 3`（经验是 lv³），
 *      **单位成本的收益仍然递减** —— 两个要求同时成立，不矛盾。
 *
 * ★ 用数字证明这两条同时成立（`refLevel=1000`）：
 *
 *     等级    属性   派生    角色经验     换 1 点派生要多少经验
 *       30     +1     +1         2,700            2,700
 *      100     +4     +6       100,000           16,667
 *      200    +10    +14       800,000           57,143
 *      400    +21    +36     6,400,000          177,778
 *      700    +40    +75    34,300,000          457,333
 *     1000    +60   +120   100,000,000          833,333
 *
 *   · 「后期加成更大」：30 级 +1 → 1000 级 +120，**涨 120 倍**；
 *     每级平均增量也从 0.08/级 升到 0.155/级（凸）。
 *   · 「后期更难」：换 1 点派生所需经验从 2,700 涨到 833,333，**涨 308 倍**。
 *   ⇒ 玩家永远有动力继续练（绝对值在涨），但永远不可能靠一门基本功通吃
 *     （单位成本在涨）。这就是"越到后期越难突破、越难学习，但加成也很大"的算术形态。
 *
 * ★★ 属性与派生为什么用**两个不同的指数**：
 *
 *   属性（`str`/`con`/`dex`）在 `formula.ts#computeDerived` 里是**乘数**，
 *   被放大 2–20 倍（`prop(con) * con` 不除 10、`prop(str) * str / 10` 除 10）。
 *   所以属性指数取 **1.1**（几乎线性、只带一点凸性）：再凸下去，1000 级就不是
 *   "根基深厚"而是"气血通胀"——`exponent` 每多 0.1，满额气血就多两三倍。
 *
 *   派生值（`attack`/`evasion`/`deflect`/`hit`）是**加数**，约 1 倍，可以放开了长。
 *   所以派生指数取 **1.3**，"越练越值钱"的手感主要体现在这一条线上。
 *
 *   两者**同向**（都凸、都满足"后期更值钱"），只是坡度不同 —— 这不是妥协，
 *   而是因为它们进公式的位置不同（乘数 vs 加数）。
 *
 * ★ 想整体调强/调弱，只改 `SKILL_CURVE` 的几个数 —— 6 门基本技能全部走
 *   `attrPassive()` / `derivedPassive()`，内容层没有第二份曲线。
 */

/**
 * 可调系数（**唯一来源**；`tuning.ts` 会把它并进汇总）。
 *
 * ★ `refLevel` 同时是**曲线的标定点**与 `SKILL_FORMULA.limitMaxLevel`
 *   —— 两处必须相等，否则"练到顶也拿不满额加成"。测试里有一条钉住这个等式。
 */
export const SKILL_CURVE = {
  /** 标定等级：这一级拿**满额**加成（同时也是技能等级的硬顶，见 `levelLimit`） */
  refLevel: 1000,
  /** 满额时的**先天属性**加成（`str`/`con`/`dex`）。属性是乘数 ⇒ 满额 60（约为先天 2 倍） */
  attrAtRef: 60,
  /** 属性曲线的凸性指数。**接近 1**（1.1）：属性是乘数，太凸会变成气血通胀 */
  attrExponent: 1.1,
  /** 满额时的**派生战斗值**加成（`attack`/`evasion`/`deflect`/`hit` 族）。派生是加数 ⇒ 满额 120 */
  derivedAtRef: 120,
  /** 派生曲线的凸性指数。**明显凸**（1.3）：这是"越练越值钱"的主要承载者 */
  derivedExponent: 1.3,
} as const;

/**
 * 曲线本体：`trunc(maxGain * (lv / refLevel) ^ exponent)`。
 *
 * `lv` 非法（NaN / 负数 / Infinity）一律返回 0：这是内容层写坏一个等级时
 * **唯一安全**的降级。抛错会让整个 `recount` 炸掉，而 `recount` 跑在登录路径上
 * （读档准入的取舍见 26 册 §40）。
 *
 * ★ 超过 `refLevel` 的部分按 `refLevel` 截断：`levelLimit` 已把玩家上限钳在
 *   同一个数上，这里的 `min` 是给 NPC（`skillLimit()` 返回 `Infinity`）的第二道保险。
 */
function curve(lv: number, maxGain: number, exponent: number): number {
  if (!Number.isFinite(lv) || lv <= 0) return 0;
  const ratio = Math.min(lv, SKILL_CURVE.refLevel) / SKILL_CURVE.refLevel;
  return Math.trunc(maxGain * Math.pow(ratio, exponent));
}

/**
 * 基本技能（`type = BASE`）① 档 —— 施加在**先天属性**（`str`/`con`/`dex`）上的增量。
 *
 * 满额 +60；30 级起 +1（"火候初成，根骨微动"）。
 */
export function attrPassive(lv: number): number {
  return curve(lv, SKILL_CURVE.attrAtRef, SKILL_CURVE.attrExponent);
}

/**
 * 基本技能 ① 档 —— 施加在**派生战斗值**（`attack`/`evasion`/`deflect`/`hit`）上的增量。
 *
 * 满额 +120；30 级起 +1，之后每级增量递增。
 */
export function derivedPassive(lv: number): number {
  return curve(lv, SKILL_CURVE.derivedAtRef, SKILL_CURVE.derivedExponent);
}

/** 启动日志用的一行摘要（与 `tuningSummary()` 拼在一起） */
export function skillCurveSummary(): string {
  return Object.entries(SKILL_CURVE)
    .map(([k, v]) => `${k}=${String(v)}`)
    .join(' ');
}

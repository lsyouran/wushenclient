/**
 * server/engine/tuning.ts — **可调数值的唯一查看入口**
 * ============================================================================
 * 目的（docs/27 决策 D4）：游戏平衡要反复调数值，调参不该去翻公式实现。
 *
 * 这里**不放**任何数值，只把各子系统自己的参数表**汇总**到一处：
 *
 *     战斗/派生   → `formula.ts` 的 COMBAT_FORMULA
 *     技能成长     → `skill.ts`   的 SKILL_FORMULA
 *
 * 于是"改平衡"永远是：**打开这一个文件 → 找到对应的表 → 改那里的数字**。
 * 反向也成立：想确认"线上跑的是哪套参数"，看启动日志的 `tuningSummary()` 即可
 * （`world.ts` 把它塞进 `WorldStats.formula`，`bootstrap.ts` 打印）。
 *
 * ★ 本文件是**再导出（单一来源、多个视图）**，不是第二事实源 ——
 *   数值仍只定义在各自的 `*_FORMULA` 里。
 */

import { COMBAT_FORMULA, formulaSummary } from './formula.js';
import { SKILL_FORMULA, skillFormulaSummary } from './skill.js';

/** 全部可调参数表（只读视图） */
export const TUNING = {
  combat: COMBAT_FORMULA,
  skill: SKILL_FORMULA,
} as const;

/** 启动日志用的一行摘要（生效参数一眼可见） */
export function tuningSummary(): string {
  return `[combat] ${formulaSummary()} [skill] ${skillFormulaSummary()}`;
}

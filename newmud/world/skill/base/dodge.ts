import { defineSkill } from '@engine/world/define.js';
import { SKILL_CURVE, attrPassive } from '@engine/world/skill-curves.js';
import { SKILL_TYPES } from '@shared/constants.js';

/**
 * 基本轻功（`type = BASE`）—— 装配槽 `dodge` 的占槽技能。
 *
 * ★ 与 wushen `world/skill/base/dodge.js` 的对照：
 *   - 被动同为**身法**（`dex`）：它同时喂「命中」与「躲闪」两条派生公式
 *     （`formula.ts` 的 `innateDexPer` 那一段注释解释了为什么两条共用 `dex/2`）。
 *   - 曲线换成 `attrPassive(lv)`（凸幂律，满额 +30），不再照抄线性 `lv/10`
 *     （那会在 1000 级给先天 +100、把躲闪抬成基线的 21 倍）。
 *     形状与数值表见 `server/world/skill-curves.ts`。
 *
 * ★ **为什么这门技能比它看起来重要**：在本项目里 `evasion` 的公式是
 *   `dex * 0.5 + ds + prop(dex) * (dex / 10)` —— 唯一能大幅抬高躲闪的内容入口
 *   就是这门技能（`ds` 那个键也该由它给，但 wushen 走的是 `dex`，这里照抄）。
 *   没有它，玩家的躲闪永远等于先天值，练什么都没用。
 *
 * ★ 它**不带绝招**：wushen 的 dodge 也没有（轻功是纯被动）。
 *
 * ★ `max_level` 引用曲线标定点而非字面量：它只是模板硬顶，玩家实际能到几级
 *   由 `levelLimit(角色经验, 境界)` 换算（见 `base/force.ts` 同一段说明）。
 */
defineSkill('base/dodge', {
  name: '基本轻功',
  // "火候够了"而不是"等级越高"：属性加成 78 级才起步，别写成空头承诺。
  desc: '轻功的基础功法，坚持锻炼会身轻如燕。火候够了身法自会更灵，闪避也更从容。',
  type: SKILL_TYPES.BASE,
  slot: 'dodge',
  grade: 0,
  max_level: SKILL_CURVE.refLevel,
  passiveProp: (lv) => ({ prop: { dex: attrPassive(lv) } }),
});

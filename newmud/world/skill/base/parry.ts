import { defineSkill } from '@engine/world/define.js';
import { SKILL_CURVE, derivedPassive } from '@engine/world/skill-curves.js';
import { SKILL_TYPES } from '@shared/constants.js';

/**
 * 基本招架（`type = BASE`）—— 装配槽 `parry` 的占槽技能。
 *
 * ★ 与 wushen `world/skill/base/parry.js` 的对照：
 *   - 被动同为**招架**（`zj`），照抄 `query_prop = lv => ({ zj: lv })` 的**语义**；
 *   - 曲线换成 `derivedPassive(lv)`（凸幂律，满额 +120）。wushen 是线性的 `zj = lv`，
 *     在 1000 级会给 **+1000 招架**，而招架是**对抗公式**里的一个加数
 *     （`rand*(ds/2)+ds/2 > mz` 那一族）：防守方招架只要超过对方命中 2 倍就
 *     必定挡下，+1000 等于把这条公式整个废掉。
 *
 * ★ wushen 在这个文件里还挂了一堆 `parry_actions` / `weapon_vs_weapon_actions`
 *   （招架时的战斗描述文案）。本项目**没有**这类字段 —— 战斗播报走
 *   `server/engine/combat-text.ts`（引擎内置默认，单源），不由技能模板各自携带一份。
 *   合并进来之前先想清楚：那是文案层的单源，不是技能的属性。
 *
 * ★ 它不带绝招：wushen 的 parry 也没有（招架是纯被动）。
 *
 * ★ `max_level` 引用曲线标定点而非字面量：模板硬顶，玩家实际上限由经验换算。
 */
defineSkill('base/parry', {
  name: '基本招架',
  desc: '招架类技能的基础功法，坚持锻炼会提高你的招架能力。',
  type: SKILL_TYPES.BASE,
  slot: 'parry',
  grade: 0,
  max_level: SKILL_CURVE.refLevel,
  passiveProp: (lv) => ({ prop: { deflect: derivedPassive(lv) } }),
});

import { defineSkill } from '@engine/world/define.js';
import { SKILL_CURVE, attrPassive } from '@engine/world/skill-curves.js';
import { SKILL_TYPES } from '@shared/constants.js';

/**
 * 基本拳脚（`type = BASE`）—— 装配槽 `unarmed` 的占槽技能。
 *
 * ★ 与 wushen `world/skill/base/unarmed.js` 的对照：
 *   - 被动同为**臂力**（`str`）。这一条比看起来划算：裸先天 `str` 出现在
 *     **三条**公式里 —— 攻击（`attack = str + …`，且在百分比**外**）、
 *     防御（`(str+con)/10`）、招架（`str * 0.5`）。所以练拳脚是"攻守兼备"的那条线，
 *     与只涨单条的刀法/剑法形成分工。
 *   - 曲线换成 `attrPassive(lv)`（凸幂律，满额 +30），理由同 `base/dodge`。
 *
 * ★ wushen 在这门技能上挂了绝招 `zhong`（重击，`10 + lv` 附加攻击）。
 *   本项目**刻意不抄**：绝招执行体还没做（docs/27 D3），
 *   现在写 `pfm` 只是一条永远按不动的声明。等战斗批次把执行体接上再加，
 *   那时 `pfm.use` 会按 `attack` 加成实现同一语义。
 *
 * ★ `max_level` 引用曲线标定点而非字面量：模板硬顶，玩家实际上限由经验换算。
 */
defineSkill('base/unarmed', {
  name: '基本拳脚',
  // "火候够了"而不是"等级越高"：属性加成 78 级才起步。
  desc: '拳脚类武功的基础功法，坚持锻炼必成大器。火候够了臂力自会更强，出拳也更重。',
  type: SKILL_TYPES.BASE,
  slot: 'unarmed',
  grade: 0,
  max_level: SKILL_CURVE.refLevel,
  passiveProp: (lv) => ({ prop: { str: attrPassive(lv) } }),
});

import { defineSkill } from '@engine/world/define.js';
import { SKILL_CURVE, derivedPassive } from '@engine/world/skill-curves.js';
import { SKILL_TYPES } from '@shared/constants.js';

/**
 * 基本剑法（`type = BASE`）—— 装配槽 `sword` 的占槽技能。
 *
 * ★ 本文件同时演示两件事：
 *   1. **基本技能也能带绝招**。wushen `world/skill/base/sword.js` 就在 BASE 技能上
 *      挂了 `set_pfm("lian", …)`（连击）。绝招不是"武功专属"。
 *   2. **BASE 技能"占槽"不靠 enable**。基本技能用 `slot` 声明自己占哪个槽，
 *      记录上的 `enabled` 保持 `null`（见 `SkillBook.activeTemplate` 的解析顺序：
 *      被装配的武功 > 占槽的基本技能）。所以它的绝招不需要也不该写 `enable`。
 *
 * ★ ① 档属性：**命中**（`mz`），曲线走 `derivedPassive(lv)`（凸幂律，满额 +120）。
 *   与 wushen 同为 `mz`，但不再是线性 `mz = lv`（1000 级 = +1000 命中，
 *   而对抗公式里命中超过对方躲闪 2 倍就必中，+1000 等于没有对手）。
 *
 * ★ `cdMs` 的单位：wushen 的 `distime` 在 `skill.js:609` 被 `/1000` 之后显示为**秒**，
 *   本项目统一用**毫秒**（`PerformDef.cdMs` 有明说），故 5 秒 = 5000。
 *   这是**可调数值**的一个例子：想改节奏就改这一行，不必碰任何逻辑。
 *
 * ⚠️ `pfm.lian` 目前只有**数据面**（名称/内力/冷却），没有执行体 ——
 *   按下去不会真的连刺两剑。绝招执行体属战斗批次（docs/27 D3），别以为它已经在打。
 *
 * ★ `max_level` 引用曲线标定点而非字面量：模板硬顶，玩家实际上限由经验换算。
 */
defineSkill('base/sword', {
  name: '基本剑法',
  desc: '剑法类技能的基础功法，磨练你的技巧，坚持锻炼会提升自身命中。',
  type: SKILL_TYPES.BASE,
  slot: 'sword',
  grade: 0,
  max_level: SKILL_CURVE.refLevel,
  passiveProp: (lv) => ({ prop: { hit: derivedPassive(lv) } }),
  pfm: {
    lian: {
      name: '连击',
      mp: 5,
      cdMs: 5_000,
      desc: '加快速度，向对手连续刺出两剑。',
    },
  },
});

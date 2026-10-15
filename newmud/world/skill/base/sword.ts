import { defineSkill } from '@engine/world/define.js';
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
 * ★ ① 档属性照抄 wushen：`query_prop = lv => ({ mz: lv })`（命中 = 等级）。
 *
 * ★ `cdMs` 的单位：wushen 的 `distime` 在 `skill.js:609` 被 `/1000` 之后显示为**秒**，
 *   本项目统一用**毫秒**（`PerformDef.cdMs` 有明说），故 5 秒 = 5000。
 *   这是**可调数值**的一个例子：想改节奏就改这一行，不必碰任何逻辑。
 */
defineSkill('base/sword', {
  name: '基本剑法',
  desc: '剑法类技能的基础功法，磨练你的技巧，坚持锻炼会提升自身命中。',
  type: SKILL_TYPES.BASE,
  slot: 'sword',
  grade: 0,
  max_level: 400,
  passiveProp: (lv) => ({ prop: { mz: lv } }),
  pfm: {
    lian: {
      name: '连击',
      mp: 5,
      cdMs: 5_000,
      desc: '加快速度，向对手连续刺出两剑。',
    },
  },
});

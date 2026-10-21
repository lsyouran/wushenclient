import { defineSkill } from '@engine/world/define.js';
import { SKILL_TYPES } from '@shared/constants.js';

/**
 * 太极剑法（门派武功，`type = SKILL`）—— 示范「可装配的武功」的完整写法。
 *
 * ★ 修掉了 docs/27 §9 的 **P1**：原先写的是 `can_enables: ['base/force']` ——
 *   一套**剑法**声明自己可以装到**内功**槽上，而且用的是**内容技能 id** 而不是槽名。
 *   两处毛病都要治：
 *     - 语义：剑法只能装 `sword`（`slot` 闭集，见 `ENABLE_SLOTS`）；
 *     - 空间：`can_enables` 里写的必须是**槽名**，不是技能 id（D1 把双 id 空间收敛成一套）。
 *   改完之后 `can_enables: ['sword']` 一眼可读，写错即编译失败。
 *
 * ★ 三档属性在本技能上齐了两档：
 *   - ① 档（学会即生效）：`passiveProp` —— 剑法本身不白给属性，故省略；
 *   - ② 档（启用后生效）：`enableProp` —— **只在被装到 `sword` 槽时**才计入。
 *     这一档正是 wushen 那个"release→改→attach 三角"最容易算重的地方，
 *     本项目由 `SkillBook` 的记账式重算兜住（连算 N 次结果一致，见 tests/engine-skill.test.ts）。
 *
 * ★ 学习条件是**声明式**的（docs/27 决策 D5），不再是 wushen 那种
 *   `switch (key)` 分派一个混合了"条件键 + 属性键"的字典。
 */
defineSkill('wd/taijijian', {
  name: '太极剑法',
  desc: '武当派绝学，以柔克刚，连绵不绝。',
  type: SKILL_TYPES.SKILL,
  grade: 4,
  max_level: 350,
  can_enables: ['sword'],

  // ② 档：装上 sword 槽之后才生效（攻击随等级，命中取 1/5）
  enableProp: (lv) => ({
    sword: {
      prop: {
        attack: Math.trunc(lv / 2),
        hit: Math.trunc(lv / 5),
      },
    },
  }),

  learnCondition: {
    minSlot: { sword: 30 },
    minAttr: { int: 20 },
    desc: '需基本剑法 30 级、悟性 20 以上',
  },

  pfm: {
    // 绝招（本批只做数据面 + 冷却 + 准入；战斗执行体属战斗批次，见 docs/27 D3）
    lianhuan: {
      name: '连环三剑',
      enable: 'sword',
      mp: (lv) => 10 + Math.trunc(lv / 20),
      releaseMs: 1_500,
      cdMs: 8_000,
      desc: '一口气递出三剑，等级越高内力消耗越大。',
    },
  },
});

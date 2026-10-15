import { defineSkill } from '@engine/world/define.js';
import { SKILL_TYPES } from '@shared/constants.js';

/**
 * 基本内功（`type = BASE`）—— 装配槽 `force` 的**占槽技能**。
 *
 * ★ 与 wushen `world/skill/base/force.js` 的对照（两处刻意不同）：
 *
 *   1. **id 与槽名显式拆开**。wushen 那份写的是 `this.id = "force"` ——
 *      技能 id **恰好等于**槽名。这不是巧合，而是 docs/27 决策 D1 说的
 *      "隐式词汇表"：`init_skill()` 直接拿 `query_weapon_type()` 的结果当槽名，
 *      代码里从不显式列出全部槽，于是槽名拼错不会有任何东西报错。
 *      这里 id 是内容 id `base/force`（受 24 册命名法管），
 *      槽名是 `slot: 'force'`（引擎闭集 `ENABLE_SLOTS`）——
 *      "内容 id 拼错"与"槽名拼错"因此成了两件各自会被拦下的事。
 *
 *   2. **`max_level` 显式给全**。wushen 靠 `set_default()` 与别处的默认值兜底；
 *      这里 `SkillDef.max_level` 缺省走 `SKILL_FORMULA.defaultMaxLevel`，
 *      写出来只是为了与 wushen 的 400 对齐。
 *
 * ★ ① 档属性（学会即生效）照抄 wushen 的 `query_prop`：
 *     `con += lv/10`、`limit_mp += 100 + lv*5`。
 *
 *   ⚠️ wushen 那份返回的对象里**混进了一个 `desc` 键**（见 `base/force.js` 末行），
 *      它会被原样丢给 `change_prop()` —— 一个"文案"进了属性表。
 *      本项目 `PropMap.prop` 是 `Partial<Record<PropKey, number>>`，
 *      那种键**写不出来**（编译期即拒），文案只能另找地方放（`SkillDef.desc`）。
 */
defineSkill('base/force', {
  name: '基本内功',
  desc: '内功的基础功法，坚持锻炼会增强体质。每 10 级增加 1 点后天根骨，并提升内力上限。',
  type: SKILL_TYPES.BASE,
  slot: 'force',
  grade: 0,
  max_level: 400,
  passiveProp: (lv) => ({
    prop: { con: Math.trunc(lv / 10), limit_mp: 100 + lv * 5 },
  }),
});

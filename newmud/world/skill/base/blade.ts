import { defineSkill } from '@engine/world/define.js';
import { SKILL_CURVE, derivedPassive } from '@engine/world/skill-curves.js';
import { SKILL_TYPES } from '@shared/constants.js';

/**
 * 基本刀法（`type = BASE`）—— 装配槽 `blade` 的占槽技能。
 *
 * ★★ 与 wushen `world/skill/base/blade.js` 的**一处有意偏离**（要记进 29 册）：
 *
 *   wushen 给的是 `query_prop = lv => ({ mz: lv })` —— 与 `base/sword.js` **逐字节相同**。
 *   那不是设计，是复制后改名（两者的差别全在绝招：刀 `zhan` 斩击、剑 `lian` 连击）。
 *   本项目现在**没有绝招执行体**，如果被动也照抄，那"练刀"与"练剑"除了名字之外
 *   完全相同 —— 内容层就失去了给玩家做选择的理由。
 *
 *   所以这里把刀法做成**重击**那条线：`PROP.attack`（攻击）而不是 `PROP.hit`（命中）。
 *   两者都是派生值、走同一条 `derivedPassive` 曲线，满额同为 +120，量级同级：
 *     · 命中是**门槛型**收益（对抗公式里差 2 倍就必中，过了阈值再加也没用）；
 *     · 攻击是**线性**收益（每一点都变成伤害）。
 *   于是刀法前期不如剑法"稳"，后期比剑法"疼" —— 这正是两种武器该有的手感差异。
 *
 *   ⚠️ 若日后觉得攻击加得太狠，把这一行的 `PROP.attack` 换成 `PROP.hit` 即可回到
 *      wushen 口径，不影响其它技能（曲线与系数都不在这份文件里）。
 *
 * ★ wushen 的绝招 `zhan`（斩击，附加 `10 + lv` 攻击）等绝招执行体落地后再补。
 *
 * ★ `max_level` 引用曲线标定点而非字面量：模板硬顶，玩家实际上限由经验换算。
 */
defineSkill('base/blade', {
  name: '基本刀法',
  desc: '刀法类武功的基础功法，坚持锻炼会使你的刀势更沉，劈砍更重。',
  type: SKILL_TYPES.BASE,
  slot: 'blade',
  grade: 0,
  max_level: SKILL_CURVE.refLevel,
  passiveProp: (lv) => ({ prop: { attack: derivedPassive(lv) } }),
});

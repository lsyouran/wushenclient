import { defineCommand } from '@engine/world/define.js';

/**
 * `score` / `attr` —— 看自己的**属性面板**。
 *
 * 对照 wushen `world/cmd/dialog/score.js`：它把一整个结构化对象发下去
 * （`{type:"dialog",dialog:"score",str:…,str_add:…}`），前端模板里每个
 * `data-prop="str"` 逐格填值。
 *
 * ★★ 2026-10-18（26 册 §62）之前这里是 `me.notify(文本)` —— 看一眼属性就往
 *   消息流刷九行。日志区是**流水账**，属性是**快照**：混在一起的效果是
 *   "刷完就找不回，想再看一眼还得重敲"。现在改发 `dialog:score` 帧，
 *   落点是 `src/ui/panel.ts` 的数据面板（照 wushen `.dialog-score` 分段渲染）。
 *
 * ★ 数值来自 `CommandActor.attrView()`（→ `formula.ts#computeAttrBreakdowns` /
 *   `computeDerived`），与 `SkillActor.str`、`learnCondition.minAttr` **同一个数**
 *   （先天 + 加成，26 册 §37）—— 面板显示的、门槛判定的、内容层读的，三者不可能各说各话。
 *   战斗那几格同理：面板上的「攻击」就是出招时读的 `#derived.attack`。
 *
 * ★ 别名 `attr` 是英文口令：`ALIAS_RE` 只收 `[a-z][a-z0-9_]*`，中文进不来；
 *   主名 `score` 照抄 wushen。
 *
 * ★ 路径 ↔ id：文件在 `world/command/info/score.ts`，相对 `world/command/` 是
 *   `info/score`，故 id 必须是 `info/score`（G5 闸门校验；`command` 要求 ≥2 段）。
 */
defineCommand('info/score', {
  command: 'score,attr',
  // 看属性不该被"忙 / 打坐 / 灵魂状态"挡住（与 wushen `score.js:3-5` 三行同款）
  allow_busy: true,
  allow_state: true,
  allow_die: true,

  run: (me) => {
    // ★ 内容层只负责"摆"：账全在引擎里算好（见 `AttrView` 的注释）。
    me.showAttr(me.attrView());
  },
});

import { defineCommand } from '@engine/world/define.js';
import { propLabel } from '@shared/constants.js';

/**
 * `score` / `attr` —— 看自己的**属性三档**：合计、先天、后天加成。
 *
 * 对照 wushen `world/cmd/dialog/score.js`（属性面板）。那里把一整个
 * `{type:"dialog",dialog:"score"}` 载荷发给前端弹**对话框**；本项目的前端对话框
 * 子系统尚未接通（26 册 §35 遗留 35-E），所以这里先走 `notify` 把同样的三档数字
 * **打成文本** —— 数据口径与 wushen 一致：`score.js:90-97` 单独发的
 * `str_add/con_add/dex_add/int_add` 就是 `query_prop()`，即"后天加成"那一档。
 *
 * ★ 数值来自 `CommandActor.attrBreakdowns()`（→ `formula.ts#computeAttrBreakdowns`），
 *   与 `SkillActor.str`、`learnCondition.minAttr` **同一个数**（先天 + 加成，
 *   26 册 §37 归一）—— 面板显示的、门槛判定的、内容层读的，三者不可能各说各话。
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
    const lines = ['【属性】'];
    for (const a of me.attrBreakdowns()) {
      const label = propLabel(a.key);
      // 有加成才展开三档；没加成时只报合计，免得每行都是"先天 X + 后天 0"
      lines.push(
        a.bonus === 0
          ? `${label}：${a.total}`
          : `${label}：${a.total}（先天 ${a.innate} + 后天 ${a.bonus}）`,
      );
    }
    me.notify(lines.join('\n'));
  },
});

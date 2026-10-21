/**
 * src/ui/attr.ts — 属性面板（wushen `dialog/score.js` 的分段版）
 * ============================================================================
 * 服务端发 `dialog:score` 帧（`world/command/info/score.ts` ← `Character.attrView()`），
 * 这里把它摆成 **wushen 的属性卡**：五个 `score-section` 竖着排，每段左边一条
 * 灰色竖线、`#111` 凹底，段内「【标签】值」两列对齐。
 *
 * ★★ 形状来源（逐条对得上，不是"看着像"）：
 *   - 分段容器：`wushen/src/styles/dialog.css:152-167` 的 `.dialog-score>.score-section`
 *     （`border-left: 2px solid gray` · `background-color:#111` · `padding:.5em` ·
 *      `margin-bottom:.5em` · `white-space:nowrap` · `overflow-x:auto`）
 *   - 两列：同文件 `:169-179` 的 `.title { width:4.375em }` / `.value { width:6em }`
 *     （`inline-block` + `line-height:1.25em`）
 *   - 颜色标签：`<hic>` 灰 · `<hig>` 亮绿 · `<hiy>` 黄，都是 `ui/markup.ts` 白名单里的
 *   - 段序：基础 → 气血/内力 → 四维 → 战斗 → 门派（我们第五段换成"成长"，
 *     理由见 `AttrView` 的注释：门派系统没落地，摆「无门无派」是假数据）
 *
 * ★★ 安全：**全程 DOM 构造**（`el()` / `textContent`），一个字都不经过 `innerHTML`。
 *   数值是 `number`，服务端给的 `name` 也走 `textContent` —— 角色名里塞标签
 *   只会显示成标签本身（与 `ui/markup.ts` 的同一条判据）。
 *
 * ★ 与 wushen 的两处**刻意**差别：
 *   ① 不抄 `min-width: 360px` / `height: 29em`：我们的面板高度是**自适应**的
 *      （字段少、且要放在房间区的位置里），固定 29em 会留一大片黑。
 *      360px 在 390px 机型上还会横向溢出。
 *   ② 不抄 `score2`（详细面板）与 `titles`（称号）两个页签：那是 wushen 的
 *      `dialog-footer` 页签体系，本项目没有；且 `score2` 的数据（`add_sh` /
 *      `diff_fy` / `add_bj`）引擎还没算。
 */

import { el } from './dom.js';
import { propLabel } from '../../shared/constants.js';
import type { AttrValueView, AttrView } from '../../shared/protocol.js';

/**
 * 建一个**颜色标签元素**（`<hic>` / `<hig>` / `<hiy>` / `<nor>`）。
 *
 * ★ 为什么不用 `dom.ts#el`：它的签名收 `keyof HTMLElementTagNameMap`，
 *   而这几个是**自定义标签**（wushen 的配色体系，`style.css` 末尾有同名规则）。
 *   `document.createElement(string)` 才接受任意标签名。
 * ★ 为什么这些标签**不**经由 `ui/markup.ts` 的解析器：那条路是给"服务端文本"
 *   用的（要防注入）。这里标签是**常量**、内容是数值，直接建节点比往返一趟
 *   字符串解析更直白，也不可能被玩家内容影响。
 */
function tag(name: 'hic' | 'hig' | 'hiy' | 'nor', text: string): HTMLElement {
  const node = document.createElement(name);
  node.textContent = text;
  return node;
}

/** 一段（`.score-section`）里的一个"标签 + 值"格 */
function field(label: string, value: string, tone: 'hic' | 'hig' | 'hiy' = 'hic'): HTMLElement {
  const title = el('span', 'title');
  title.appendChild(tag(tone, `【${label}】`));
  const val = el('span', 'value', value);
  return pair(title, val);
}

/** 把「标签 + 值」包进一段行内流（`title`/`value` 靠 CSS 定宽排成两列） */
function pair(title: HTMLElement, val: HTMLElement): HTMLElement {
  const box = el('span', 'cell');
  box.append(title, val);
  return box;
}

/** 一段 */
function section(...children: readonly HTMLElement[]): HTMLElement {
  const box = el('div', 'score-section');
  for (const c of children) box.appendChild(c);
  return box;
}

/**
 * 四维那一格的写法：**有加成才展开括号**。
 *
 * `臂力：25（先天 20 + 后天 5）` / 没加成时只有 `根骨：18`。
 * ★ 这条口径是从改前的文本版原样搬过来的（`score.ts` 的旧实现）：
 *   每行都写"后天 0"会让四行里三行是噪声，一眼看不出哪个属性真有加成。
 */
function attrCell(a: AttrValueView): HTMLElement {
  const title = el('span', 'title');
  title.appendChild(tag('hiy', `【${propLabel(a.key)}】`));
  const val = el('span', 'value');
  val.appendChild(tag('hiy', String(a.total)));
  if (a.bonus !== 0) {
    // ★ `nor` 是 wushen 的"正常色"标签（`#008000`）—— 括号比主值暗一档，
    //   与它 `score.js` 里 `<NOR>(+<span>5</span>)</NOR>` 的做法一致。
    val.appendChild(tag('nor', `（先天 ${String(a.innate)} + 后天 ${String(a.bonus)}）`));
  }
  return pair(title, val);
}

/**
 * 造出整张属性卡。
 *
 * @param v 服务端 `dialog:score` 帧里的字段（见 `shared/protocol.ts` 的 `AttrView`）
 */
export function buildAttrPanel(v: AttrView): HTMLElement {
  const card = el('div', 'dialog-score');

  // ① 基础：性别 / 境界 / 经验 / 潜能
  //   ★ wushen 这一段的顺序就是「性别 等级 年龄 经验 潜能」（`score.js:117-136`）；
  //     我们减掉"年龄"（引擎无此概念），其余照排。
  //   ★ 2026-10-19：`等级` 改成 `境界`，值用服务端算好的 `realmName` ——
  //     境界是三门基本功**派生**出来的（见 `Character.realm`），前端不查表、不推算。
  card.appendChild(
    section(
      field('性别', genderText(v.gender)),
      field('境界', v.realmName),
      field('经验', String(v.exp), 'hig'),
      field('潜能', String(v.pot), 'hig'),
    ),
  );

  // ② 气血 / 内力（`hig`：wushen 这一段整段用亮绿）
  card.appendChild(
    section(field('气血', `${String(v.hp)} / ${String(v.maxHp)}`, 'hig'), field('内力', `${String(v.mp)} / ${String(v.maxMp)}`, 'hig')),
  );

  // ③ 四维（三档）
  card.appendChild(section(...v.attrs.map(attrCell)));

  // ④ 战斗派生值 —— 与出招时读的是同一份 `#derived`（见 `AttrView` 的注释）
  card.appendChild(
    section(
      field('攻击', String(v.combat.attack)),
      field('防御', String(v.combat.defense)),
      field('命中', String(v.combat.hit)),
      field('躲闪', String(v.combat.evasion)),
      field('招架', String(v.combat.deflect)),
      field('暴击', String(v.combat.crit)),
    ),
  );

  // ⑤ 成长（**本项目独有**，wushen 面板里没有这一格）
  //   ★ 26 册 §56：经验抬高**技能等级上限**，潜能用来在 `practice` 里换等级。
  //     没有这一行，玩家打到经验也不知道那个数有什么用。
  //   ★ NPC 的 `skillLimit()` 是 `Infinity`（它们不走这条曲线），显示成 ∞
  //     而不是天文数字。
  card.appendChild(
    section(
      field('技能上限', Number.isFinite(v.skillLimit) ? `${String(v.skillLimit)} 级` : '∞', 'hig'),
    ),
  );

  return card;
}

/** 性别三档（`Gender`：1 男 / 2 女 / 0 无性）。wushen 发的是中文串，我们发码值 */
function genderText(g: number): string {
  if (g === 1) return '男';
  if (g === 2) return '女';
  return '无性';
}

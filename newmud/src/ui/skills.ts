/**
 * src/ui/skills.ts — 技能面板（wushen `src/dialog/skills.js` 的三段版）
 * ============================================================================
 * 服务端发 `dialog:skills` 帧（`world/command/info/skills.ts` ← `Character.skillView()`），
 * 这里把它摆成**三个区域**：
 *
 *     ┌ 页签（基础 / 特殊）          ← 前端状态，不发请求
 *     ├ 列表（可滚，一行一项）        ← 快照
 *     └ 动作栏（按选中项动态）        ← 发命令
 *
 * ★★ 为什么页签与动作栏**必须分两块**（26 册 §63.5 的判定）：wushen 把这两类
 *   东西塞进同一个 `<span>`，靠"有没有 `cmd=` 属性"隐式分流 ——
 *   `for=` 表示前端状态、`cmd=` 表示服务端命令。混在一起时"点一下到底发生了
 *   什么"只能靠读那个属性名来判断，加第四种交互时无处安放。
 *   这里页签在列表**上方**、动作在列表**下方**，两者不共用容器。
 *
 * ★★ 形状来源（逐条对得上）：
 *   - 行：`wushen/src/dialog/skills.js` 的 `skills_css` —— `.skill-item`
 *     （`line-height:2em` · `padding-left:1.5em` · 左边框 2px · `#111` 底 ·
 *      `margin-bottom:.5em` · `cursor:pointer`）· `.skill-level { float:right }`
 *   - 行的左边框颜色 = 阶位色（`global.css` 的 `.grade0`–`.grade6` 设
 *     `--border-color`），名字同色（`wrap_name()` 的 `level_desc` 表）
 *   - 内容：`✓ + 名字 + 「等级级 / 进度% 阶位」`，与 `createSkillItem` 同序
 *   - 阶位文案：`get_lvdesc()` + `skill_levels`（27 条，含颜色标签）**逐条照抄**
 *   - 动作栏：`item_click()` 的 `装备<基本技能名>` / `取消装备<基本技能名>` /
 *     `遗忘` / `练习`（`查看详细` 不做，见 27 册 §14.6）
 *
 * ★ 与 wushen 的三处**刻意**差别：
 *   ① **没有「学习」按钮**（27 册 §14.5.4）：它依赖"当前房间有没有会这门的
 *      NPC"，为一次性的低频动作加一路"房间老师"查询不划算。学习手敲
 *      `learn <技能> from <目标>`。
 *   ② **遗忘用两步内联确认**，不是 `_confirm fangqi`：`_confirm` 是 wushen
 *      的指令前缀（服务端弹警告框再回送命令），本项目没有这条指令。
 *      内联两步少一次往返，而且误点之后**看得见自己在确认什么**。
 *   ③ `.gradeN` 只用来给**行左边框**上色：wushen 那七条规则还带
 *      `border-color`（给背包格子之类），这里没有第二种消费点，不抄。
 *
 * ★★ 安全：**全程 DOM 构造**（`el()` / `textContent`），一个字都不经过
 *   `innerHTML` —— 技能名是内容层给的（`skill.ts` 的 `name`），但同一条判据
 *   不因"这个字段大概安全"而破例（`ui/dom.ts` 头部）。
 */

import { el, onActivate } from './dom.js';
import { runPanelCommand } from './panel.js';
import type { SkillEntryView, SkillsView } from '../../shared/protocol.js';

/** 哪一页（第三页「书架」不做：秘籍是物品，见 27 册 §14.3 裁定 1） */
type Tab = 'base' | 'special';

const TABS: readonly { readonly tab: Tab; readonly label: string }[] = [
  { tab: 'base', label: '基础' },
  { tab: 'special', label: '特殊' },
];

/**
 * 阶位名 + 它的颜色（**逐条照抄** wushen `skills.js` 的 `skill_levels`）。
 *
 * `level < 1000` ⇒ 每 50 级一档（下标 `level / 50`，共 20 档）；
 * `level >= 1000` ⇒ 每 500 级一档（下标 `+20`，最多到 26）。
 * ★ 这**不是**数值公式的复制：等级由服务端给，这里只把等级翻译成四个字。
 */
const LEVEL_DESCS: readonly (readonly [string, string])[] = [
  ['blu', '初学乍练'],
  ['blu', '不知所以'],
  ['hib', '粗通皮毛'],
  ['hib', '渐有所悟'],
  ['yel', '半生不熟'],
  ['yel', '马马虎虎'],
  ['hiy', '平淡无奇'],
  ['hiy', '触类旁通'],
  ['hig', '心领神会'],
  ['hig', '挥洒自如'],
  ['hic', '驾轻就熟'],
  ['hic', '出类拔萃'],
  ['cyn', '初入佳境'],
  ['cyn', '神乎其技'],
  ['mag', '威不可当'],
  ['hiw', '豁然贯通'],
  ['hiw', '超群绝伦'],
  ['red', '登峰造极'],
  ['wht', '登堂入室'],
  ['him', '一代宗师'],
  ['wht', '超凡入圣'],
  ['hio', '出神入化'],
  ['hio', '独步天下'],
  ['hir', '空前绝后'],
  ['hir', '旷古绝伦'],
  ['hiw', '深不可测'],
  ['hiw', '返璞归真'],
];

/** 阶位 → 名字颜色（wushen `wrap_name()` 的 `level_desc`） */
const GRADE_TAGS: readonly string[] = ['wht', 'hig', 'hic', 'hiy', 'him', 'hio', 'ord'];

const EMPTY_BASE = '还没有学会基本功。可以对教头说：learn 基本剑法 from 教头';
const EMPTY_SPECIAL = '还没有学会武功。基本功练到 30 级才能学太极剑法';

// ---------------------------------------------------------------------------
// 面板内部状态（服务端不知道、也不该知道）
// ---------------------------------------------------------------------------

/** 最近一帧数据 */
let view: SkillsView | null = null;
/** 当前页签 */
let tab: Tab = 'base';
/** 选中项（技能 id）；`null` = 没选 */
let selected: string | null = null;
/** 正在等确认遗忘的技能 id；`null` = 没有待确认动作 */
let confirming: string | null = null;

/** 阶位名（带色）—— 认不出档位就退回一个纯文本节点，不吞掉信息 */
function levelDesc(level: number): DocumentFragment {
  const frag = document.createDocumentFragment();
  const idx = level < 1000 ? Math.trunc(level / 50) : Math.min(6, Math.trunc((level - 1000) / 500)) + 20;
  const hit = LEVEL_DESCS[idx];
  if (hit === undefined) {
    frag.appendChild(document.createTextNode(''));
    return frag;
  }
  const node = document.createElement(hit[0]);
  node.textContent = hit[1];
  frag.appendChild(node);
  return frag;
}

/** 自定义颜色标签节点（`<hig>` 这类；`el()` 只收标准标签名，见 `attr.ts` 同款说明） */
function colorTag(name: string, text: string): HTMLElement {
  const node = document.createElement(name);
  node.textContent = text;
  return node;
}

/** 世界 id 与 `enabled` 都是拼音串，直接拼进命令即可（不含空格） */
function cmdOf(...parts: readonly string[]): string {
  return parts.join(' ');
}

// ---------------------------------------------------------------------------
// 构建
// ---------------------------------------------------------------------------

/**
 * 造出整个技能面板。
 *
 * @param v      `dialog:skills` 帧里的字段（见 `shared/protocol.ts` 的 `SkillsView`）
 * @param redraw 面板给的重画钩子（页签与选中态是**面板内部状态**，服务端不知道）
 */
export function buildSkillsPanel(v: SkillsView, redraw: () => void): HTMLElement {
  view = v;
  const items = itemsOf(v, tab);
  // ★ 选中的那项不在这页了（换了页签 / 服务端刷新后它没了）⇒ 清掉。
  //   否则动作栏会对着一个**看不见的**技能发命令 —— 那是最难解释的一种 bug。
  if (selected !== null && !items.some((i) => i.id === selected)) {
    selected = null;
    confirming = null;
  }

  const box = el('div', 'dialog-skills');
  box.appendChild(tabRow(v, redraw));
  box.appendChild(listBox(items, redraw));
  // ★★ 动作栏拿**整张** `v.items`，不是当前页签那几项：装配按钮要查
  //   "我有没有`sword`槽的基本功"，而基本功住在**另一页**。
  //   传过滤后的那次实测直接让「装配」按钮消失 —— 页签一换就没人装得上了。
  box.appendChild(actionBox(v.items, redraw));
  box.appendChild(metaBox(v));
  return box;
}

/** 某一页的条目（顺序由服务端定，前端只过滤 —— 见 `Character.skillView()`） */
function itemsOf(v: SkillsView, which: Tab): readonly SkillEntryView[] {
  return v.items.filter((i) => (which === 'base' ? i.kind === 'base' : i.kind !== 'base'));
}

/** 页签行。★ 带数目：某一页空着时，玩家一眼知道是"没有"而不是"面板坏了" */
function tabRow(v: SkillsView, redraw: () => void): HTMLElement {
  const row = el('div', 'skill-tabs');
  for (const t of TABS) {
    const n = itemsOf(v, t.tab).length;
    const btn = el('span', `skill-tab${t.tab === tab ? ' is-on' : ''}`, `${t.label} ${String(n)}`);
    btn.dataset['tab'] = t.tab;
    // ★ `role` + `tabindex` + `onActivate`：声明成按钮就得键盘也能按（L2）
    btn.setAttribute('role', 'button');
    btn.tabIndex = 0;
    onActivate(btn, () => {
      if (tab === t.tab) return;
      tab = t.tab;
      selected = null;
      confirming = null;
      redraw();
    });
    row.appendChild(btn);
  }
  return row;
}

function listBox(items: readonly SkillEntryView[], redraw: () => void): HTMLElement {
  const box = el('div', 'skill-list');
  if (items.length === 0) {
    box.appendChild(el('p', 'skill-empty', tab === 'base' ? EMPTY_BASE : EMPTY_SPECIAL));
    return box;
  }
  for (const it of items) box.appendChild(itemRow(it, redraw));
  return box;
}

/** 一行技能 */
function itemRow(it: SkillEntryView, redraw: () => void): HTMLElement {
  const grade = it.grade >= 0 && it.grade < GRADE_TAGS.length ? it.grade : 0;
  const on = it.id === selected;
  const row = el('div', `skill-item grade${String(grade)}${on ? ' is-on' : ''}${it.enabled === null ? '' : ' has-flag'}`);
  row.dataset['skid'] = it.id;
  row.setAttribute('role', 'button');
  row.tabIndex = 0;

  // ① ✓ = 已装配（wushen 的 `.enable-flag`，没装配时它 `display:none`；
  //    这里干脆不建那个节点 —— 空 `<span>` 是给 CSS 留位置的写法，DOM 构造下没必要）
  if (it.enabled !== null) {
    const flag = colorTag('hig', '✓');
    flag.className = 'skill-flag';
    row.appendChild(flag);
  }

  // ② 名字：按**阶位**上色（wushen `wrap_name()`）
  row.appendChild(colorTag(GRADE_TAGS[grade] ?? 'wht', it.name));

  // ③ 右侧：「12 级 / 40% 初学乍练」
  const lv = el('span', 'skill-level', `${String(it.level)} 级 / ${String(it.progress)}% `);
  lv.appendChild(levelDesc(it.level));
  row.appendChild(lv);

  onActivate(row, () => {
    // 点同一项 = 收起动作栏（wushen 的 `.item-commands` 也是"再点一次就没了"）
    selected = on ? null : it.id;
    confirming = null;
    redraw();
  });
  return row;
}

/**
 * 动作栏：**只放真能按的**。
 *
 * @param items **整本技能簿**（`v.items`），不是当前页签那几项 —— 见调用点的说明
 *
 * ★ 装配按钮的判据是"我**自己**会哪门基本功"，不是"这门武功声明能装到哪些槽"
 *   （wushen `item_click` 同款：`const baseSkill = skills[item.can_enables[i]]; if (!baseSkill) continue;`）。
 *   不会基本剑法的人，摆一个「装配基本剑法」按钮，点下去只会被服务端拒 ——
 *   那正是 26 册 §61 要消灭的"点不动的格子"。
 */
function actionBox(items: readonly SkillEntryView[], redraw: () => void): HTMLElement {
  const it = items.find((i) => i.id === selected);
  if (it === undefined) {
    return el('p', 'skill-tip', '点上面一项，这里会出现可做的动作');
  }

  const bar = el('div', 'item-commands skill-actions');
  /** 每次动作之后**重取一次面板数据**（见 `act()` 的说明） */
  const act = (command: string): void => {
    runPanelCommand(command);
    runPanelCommand('skills');
  };

  // ── 装配 / 取消装配：一个槽一颗按钮 ──
  for (const slot of it.canEnables) {
    const base = items.find((i) => i.kind === 'base' && i.slot === slot);
    if (it.enabled === slot) {
      // 已装配 ⇒ 取消（wushen：`装备X` 与 `取消装备X` 是同一颗按钮的两种文案）
      bar.appendChild(button(`取消装配${base?.name ?? ''}`, () => act(cmdOf('enable', slot, 'none'))));
    } else if (base !== undefined) {
      bar.appendChild(button(`装配${base.name}`, () => act(cmdOf('enable', slot, it.id))));
    }
  }
  // 装配到某个槽了，但那个槽的基本功名查不到（数据不全）⇒ 至少给一条"卸下"的路
  if (it.enabled !== null && !it.canEnables.includes(it.enabled)) {
    bar.appendChild(button('取消装配', () => act(cmdOf('enable', it.enabled ?? '', 'none'))));
  }

  // ── 练习：知识类不能练（它不用经验涨级，读了就会） ──
  if (it.kind !== 'knowledge') {
    bar.appendChild(button('练习', () => act(cmdOf('practice', it.id))));
  }

  // ── 遗忘：只有**武功**能忘（基础 / 知识类由引擎拒，见 `forgetSkill`） ──
  if (it.kind === 'skill') {
    if (confirming === it.id) {
      bar.appendChild(button('确定遗忘？', () => act(cmdOf('forget', it.id))));
      bar.appendChild(
        button('算了', () => {
          confirming = null;
          redraw();
        }),
      );
    } else {
      bar.appendChild(
        button('遗忘', () => {
          confirming = it.id;
          redraw();
        }),
      );
    }
  }

  // 一个都不剩（比如知识类没装、也不能练 / 不能忘）⇒ 说一句，不留空条
  if (bar.childElementCount === 0) {
    return el('p', 'skill-tip', '这项技能没有可做的动作');
  }
  // 学习条件（`learnCondition.desc`）跟着动作栏一起出现：玩家看到"遗忘"的同时
  // 也能想起"当初为什么能学" —— 比摆在列表里每行都挤一句更省地方。
  if (it.note !== undefined) {
    const wrap = el('div', 'skill-action-box');
    wrap.append(bar, el('p', 'skill-tip', `学习条件：${it.note}`));
    return wrap;
  }
  return bar;
}

/** 面板底部一行：学会了几项 + 潜能（省一次 `score`） */
function metaBox(v: SkillsView): HTMLElement {
  return el('p', 'skill-meta', `${v.title}　潜能 ${String(v.pot)}`);
}

/** 动作栏里的一颗按钮 */
function button(label: string, onClick: () => void): HTMLElement {
  const node = el('span', '', label);
  node.setAttribute('role', 'button');
  node.tabIndex = 0;
  onActivate(node, onClick);
  return node;
}

// ---------------------------------------------------------------------------
// 状态清理（登出 / 换角色时用）
// ---------------------------------------------------------------------------

/**
 * 忘掉面板内部状态。
 *
 * ★ 为什么必须显式清：`tab` / `selected` 是**模块变量**，登出再登入时它们
 *   还留着上一个角色的选择 —— 新角色的技能簿里没有那一条，于是面板一开
 *   就显示"点了一项不存在的技能"的动作栏。`main.ts` 的 `logout()` 会调它。
 */
export function resetSkillsPanel(): void {
  view = null;
  tab = 'base';
  selected = null;
  confirming = null;
}

/** 当前面板的数据（测试与调试用：`null` = 还没收到帧） */
export function skillsView(): SkillsView | null {
  return view;
}

/** 当前页签 / 选中项（测试用） */
export function skillsState(): { tab: Tab; selected: string | null; confirming: string | null } {
  return { tab, selected, confirming };
}

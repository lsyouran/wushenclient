/**
 * src/ui/panel.ts — 面板 / 提示框（wushen 的 `.dialog` 与 `.warn-dialog`）
 * ============================================================================
 * 面板是**服务端驱动的**：`item` 帧（看物件）· `emote` 帧（表情）· `dialog` 帧
 * （通用容器）各开一次，内容是服务端给的那几行。
 *
 * ★ 这一版刻意**没有**"属性 / 行囊 / 武学"这类常驻页签：那些取数指令
 *   （`hp` / `i` / `skills`）服务端**一条都不认**，点开只会看到"什么？"。
 *   宁可面板少几个入口，也不摆一排点下去没反应的按钮（26 册 §16.8）。
 *   它们将来有了内容层，往 `main.ts` 的 `bindBars` 加一格就行。
 *
 * ★ 面板开着时 `warn` 回显**同时**进面板（`notePanel`）：这就是 wushen 的
 *   dialog 模型 —— 开面板 → 服务端回显 → 填充。于是"点开某人 → 后续交互文本
 *   都在面板里"，不用来回翻消息流。
 */

import { clear, el, need } from './dom.js';
import { renderMarkup } from './markup.js';
import type { CmdItem } from '../../shared/protocol.js';

/** 面板最多留多少行 */
const MAX_ROWS = 200;

/** 当前面板的内容（`null` = 没开） */
let rows: string[] | null = null;

/** 由 `main.ts` 注入：点面板里的命令按钮 */
let runner: (cmd: string) => void = () => undefined;

export function setPanelRunner(fn: (cmd: string) => void): void {
  runner = fn;
}

/**
 * 打开面板。
 *
 * @param title 面板标题（房名 / 物件名 / 面板名）
 * @param lines 正文行（会被当成服务端文本渲染：颜色标签能用，`<script>` 只是文字）
 * @param cmds  面板底部的命令按钮
 */
export function openPanel(title: string, lines: readonly string[], cmds: readonly CmdItem[] = []): void {
  rows = [...lines];
  need('dlgTitle').textContent = title;
  need('dialog').hidden = false;
  need('mask').hidden = false;
  render(cmds);
}

/** 服务端回显进当前面板（面板没开就什么都不做 —— 那是消息流的事） */
export function notePanel(line: string): void {
  if (rows === null) return;
  rows.push(line);
  if (rows.length > MAX_ROWS) rows.splice(0, rows.length - MAX_ROWS);
  render();
}

export function closePanel(): void {
  rows = null;
  need('dialog').hidden = true;
  need('mask').hidden = true;
}

export function isPanelOpen(): boolean {
  return !need('dialog').hidden;
}

/** 面板里当前显示了几行（测试与调试用） */
export function panelRows(): readonly string[] {
  return rows ?? [];
}

function render(cmds: readonly CmdItem[] = []): void {
  const body = need('dlgBody');
  clear(body);
  for (const line of rows ?? []) {
    const p = el('p', 'row');
    renderMarkup(line, p);
    body.appendChild(p);
  }
  if (cmds.length > 0) body.appendChild(cmdRow(cmds));
}

function cmdRow(cmds: readonly CmdItem[]): HTMLElement {
  const box = el('div', 'item-commands');
  for (const c of cmds) {
    const item = el('span', '', c.name === '' ? c.cmd : c.name);
    item.dataset['cmd'] = c.cmd;
    item.addEventListener('click', () => runner(c.cmd));
    box.appendChild(item);
  }
  return box;
}

// ---------------------------------------------------------------------------
// 提示框（`warn` 帧带命令时的落点）
// ---------------------------------------------------------------------------

export function showWarn(content: string, cmds: readonly CmdItem[]): void {
  const text = need('warnText');
  text.replaceChildren();
  renderMarkup(content, text);

  const box = need('warnCmds');
  clear(box);
  for (const c of cmds) {
    const item = el('span', '', c.name === '' ? c.cmd : c.name);
    item.dataset['cmd'] = c.cmd;
    item.addEventListener('click', () => {
      runner(c.cmd);
      closeWarn();
    });
    box.appendChild(item);
  }
  need('warnBox').hidden = false;
}

export function closeWarn(): void {
  need('warnBox').hidden = true;
}

/** 登出 / 断线时清场 */
export function resetPanels(): void {
  closePanel();
  closeWarn();
}

export function bindPanel(): void {
  need('dlgClose').addEventListener('click', closePanel);
  need('mask').addEventListener('click', () => {
    if (isPanelOpen()) closePanel();
  });
}

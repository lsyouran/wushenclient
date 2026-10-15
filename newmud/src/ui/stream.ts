/**
 * src/ui/stream.ts — 消息流（wushen 的 `.content-message`）
 * ============================================================================
 * 服务端的一行行文本按序堆在这里，它是**屏幕的主体**（`.container` 里唯一 `flex:1`）。
 *
 * 与 wushen（`wushen/src/message.js` 的 `MessageQueue`，★ 同名 `message.js` 有 4 份，认准这个目录）：
 *   1. **回收粒度**：两边都**有上界**，差别只在粒度。wushen 往 `<pre>` 页里追加，
 *      `count > max`(666) 换新页，且**已有 ≥ `size`(3) 页时 `queue.splice(0, 1)[0].remove()`
 *      丢最旧一页**（`message.js:41-57`）⇒ 实质界约 `3 × 666 ≈ 2000` 行。本项目改成
 *      **逐行**丢最旧（`MAX_LINES`），界更紧、也更好断言。
 *   2. **贴底才跟随**：视口本来就在底部才滚到底 —— 这条与 wushen **同构，不是差别**：
 *      `scroll2end()` 里 `if (!this.allow_scroll) { 显示浮标; return; }`，而 `allow_scroll`
 *      由 `stopDrag` 在 wheel/touchend 时按 `is_end()` 维护（`message.js:28-40, 72-84`）。
 *   3. 回到底部用**浮标**（即 wushen 的 `.scroll-flag`），翻上去才出现。
 *
 * ★ **F11 订正（2026-10-14）**：本头部原文写的是"wushen 只分页不回收（会堆几十万节点）"
 *   与"wushen `scroll2end()` 无条件滚，翻历史永远被拽回" —— **两条依据都是假的**。
 *   照原文读会得出"`MAX_LINES` / 贴底跟随是我们补上了 wushen 缺的能力"这个**错误结论**；
 *   事实是 wushen **两件都做了**，本项目只是把回收**换成更细的口径**。见 26 册 §31.6。
 *
 * ★ 聊天另有一份**预览**（`.channel`，wushen 也有）：最近几条进那块小区域，
 *   点它打开聊天浮层。主消息流里同样留一份 —— MUD 玩家默认看一条流。
 */

import { delegate, el, need } from './dom.js';
import { renderMarkup } from './markup.js';
import type { CmdItem } from '../../shared/protocol.js';

/** 消息流保留的最大行数（超出丢最旧） */
export const MAX_LINES = 400;

/** `.channel` 预览保留的条数 */
const CHANNEL_LINES = 3;

export type LineKind = 'text' | 'room' | 'sys' | 'err' | 'gain' | 'fight';

const CLASS_OF: Record<LineKind, string> = {
  text: 'ln',
  room: 'ln room',
  sys: 'ln sys',
  err: 'ln err',
  gain: 'ln gain',
  fight: 'ln fight',
};

/**
 * 频道 → 档位类名（着色用）。
 * ★ 未登记的频道**不静默丢**，落到 `.wor`：宁可多显示一条，
 *   也不要出现"服务端发了、界面上哪儿都没有"。
 */
const CHAT_CLASS: Readonly<Record<string, string>> = {
  tell: 'pri',
  chat: 'wor',
  es: 'wor',
  rumor: 'wor',
  tm: 'wor',
  fam: 'wor',
  pty: 'wor',
  sys: 'wor',
};

let output: HTMLElement | null = null;
let channel: HTMLElement | null = null;
let flag: HTMLElement | null = null;

function host(): HTMLElement {
  output ??= need<HTMLElement>('output');
  return output;
}

function channelHost(): HTMLElement {
  channel ??= need<HTMLElement>('channel');
  return channel;
}

/** 距离底部多少 px 以内算"贴底" */
const STICK = 60;

function isAtBottom(node: HTMLElement): boolean {
  return node.scrollHeight - node.scrollTop - node.clientHeight < STICK;
}

function trim(node: HTMLElement, max: number): void {
  while (node.childElementCount > max && node.firstChild !== null) {
    node.removeChild(node.firstChild);
  }
}

/**
 * 把一行挂进消息流：**先量要不要跟随**（用户翻历史时不许被拽回底部），再追加、
 * 裁掉超出 `MAX_LINES` 的最旧行，最后要么贴底要么亮浮标。
 *
 * ★ 抽出来是因为这段记账原先在 `pushLine` / `pushCommands` / `pushChat` 里
 *   **各抄了一份**（FG-21 是同一族："同一段逻辑写两份，改一处漏一处"）。
 */
function appendLine(line: HTMLElement): void {
  const node = host();
  const stick = isAtBottom(node);
  node.appendChild(line);
  trim(node, MAX_LINES);
  if (stick) node.scrollTop = node.scrollHeight;
  else showFlag();
}

/**
 * 追加一行。
 *
 * @param text 服务端文本（**会**解析 `<hir>` 这类颜色标签，但只产出节点）
 *
 * ★ 换行**整段交给解析器**，不 `split('\n')`：`renderMarkup` 把标签之间的原文
 *   原样塞进文本节点（`\n` 是文本的一部分），而 `.ln` 是 `white-space: pre-wrap` ——
 *   于是 `look` 的多行输出真的是多行。曾经这里按 `\n` 拆开逐段渲染，
 *   换行符当场丢掉，三段文字挤成一行（真机截图 `21-点NPC.png`）。
 */
export function pushLine(text: string, kind: LineKind = 'text'): void {
  const line = el('div', CLASS_OF[kind]);
  renderMarkup(text, line);
  appendLine(line);
}

/**
 * 追加一条**命令条**（wushen `Process.item` / `Process.cmds` 里那个 `.item-commands`）。
 *
 * ★ 落点是**消息流**，不是 `.dialog` 面板。wushen 的两条生产者都是
 *   `ReceiveMessage(html)`：物件详情（`process.js:380-403`）与服务端下发的
 *   命令列表（`process.js:406`）都跟着"发生的事"往下走；`.dialog` 留给
 *   地图 / 属性 / 背包那类**面板**。
 *
 * ★ 空 `cmd` 的条目直接丢掉：那种按钮点下去发不出任何东西，
 *   是"点不动的按钮"（`src/index.html` 的工具条注释里立过这条规矩）。
 */
export function pushCommands(cmds: readonly CmdItem[]): void {
  const usable = cmds.filter((c) => c.cmd !== '');
  if (usable.length === 0) return;

  const line = el('div', 'ln');
  const box = el('div', 'item-commands');
  for (const c of usable) {
    // `data-cmd` 而不是拼字符串 —— 事件委托靠它认人（见 `dom.ts` 的 `delegate()`）
    box.appendChild(el('span', '', c.name === '' ? c.cmd : c.name, { cmd: c.cmd }));
  }
  line.appendChild(box);
  appendLine(line);
}

/**
 * 点消息流里的命令按钮 → 发指令。
 * 由 `main.ts` 注入（与面板 / `<CMD>` 标签同一个 `run()`，不另开出口）。
 */
let cmdRunner: (cmd: string) => void = () => {
  /* 未接线时静默：按钮最多是点不动，不该抛错 */
};

export function setStreamRunner(fn: (cmd: string) => void): void {
  cmdRunner = fn;
}

/**
 * 追加一行聊天（`msg` 包）。
 *
 * @param ch   协议频道（`say` / `chat` / `tell` / …）
 * @param who  说话人名字；空串 = 系统播报，不显示名前缀
 * @param text 正文
 */
export function pushChat(ch: string, who: string, text: string): void {
  const line = el('div', `ln chat ${CHAT_CLASS[ch] ?? 'wor'}`);
  if (who !== '') line.appendChild(el('span', 'who', `${who}：`));
  // 与 `pushLine` 同一条规矩：换行整段交给解析器（`.ln` 是 `white-space: pre-wrap`）
  renderMarkup(text, line);
  appendLine(line);

  // ★ 预览区是**同一条消息的第二份视图**，不是第二份事实：
  //   它只留最近几条，纯粹为了"不看消息流也知道有人在说话"。
  const box = channelHost();
  const brief = el('div', `ln chat ${CHAT_CLASS[ch] ?? 'wor'}`);
  if (who !== '') brief.appendChild(el('span', 'who', `${who}：`));
  renderMarkup(text, brief);
  box.appendChild(brief);
  trim(box, CHANNEL_LINES);
  box.scrollTop = box.scrollHeight;
}

/** 分隔线（进新房间这类视觉断点） */
export function pushRule(): void {
  const node = host();
  node.appendChild(el('div', 'rule'));
  trim(node, MAX_LINES);
}

export function clearStream(): void {
  const node = host();
  node.replaceChildren();
  channelHost().replaceChildren();
}

/**
 * 「回到底部」浮标。
 *
 * ★ 只在**没贴底**时出现，点它回到底部并消失 —— 它存在的意义就是
 *   "有新消息在下面"，贴底时那句话是假的。
 */
function showFlag(): void {
  if (flag === null) {
    flag = el('div', 'scroll-flag', '↓');
    flag.addEventListener('click', () => {
      const node = host();
      node.scrollTop = node.scrollHeight;
      flag?.remove();
      flag = null;
    });
  }
  const node = host();
  if (!node.contains(flag)) node.appendChild(flag);
}

/**
 * 用户在消息流里滚动 —— 回到底部就把浮标收掉；
 * 顺带在 `#output` 上**委托一次**命令条的点击（命令条每次都是新节点，
 * 逐节点绑就得跟着重绑，见 `dom.ts` 的 `delegate()`）。
 */
export function bindStream(): void {
  const node = host();
  node.addEventListener('scroll', () => {
    if (isAtBottom(node) && flag !== null) {
      flag.remove();
      flag = null;
    }
  });

  delegate(node, '.item-commands [data-cmd]', 'click', (hit) => {
    const cmd = hit.dataset['cmd'] ?? '';
    if (cmd !== '') cmdRunner(cmd);
  });
}

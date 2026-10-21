/**
 * src/ui/input.ts — 指令浮层 / 聊天浮层
 * ============================================================================
 * wushen 只有**聊天**浮层（`.chat-panel`），指令只能点按钮 —— 纯键盘玩家
 * 在没有可点按钮时就没处下手。这里给指令也开一个，形状照聊天浮层，
 * 两条都是**浮层**：不占常驻高度（MUD 里绝大多数操作是点按钮，
 * 常驻输入框会永久吃掉一行）。
 *
 * ★ 与 wushen 的第二处差别：指令输入有**历史**（↑↓）。挂机打坐时来回
 *   敲同一条指令是常态，没有历史就得一遍遍手打。
 *
 * ★ 私语缺对象时**不发**：半截指令（`tell  在吗`）出门只会换来一句看不懂的
 *   报错。宁可给一句提示。
 */

import { clear, el, need } from './dom.js';
import type { CmdItem } from '../../shared/protocol.js';

export interface InputHooks {
  /** 执行一条指令 */
  run(cmd: string): void;
  /** 需要提示时落一行到消息流（弹窗里放不下，也不该占弹窗） */
  hint(text: string): void;
}

let hooks: InputHooks = { run: () => undefined, hint: () => undefined };

/** 指令历史（最近的在后） */
const history: string[] = [];
let historyAt = -1;

/**
 * 常用指令 chip。
 *
 * ★ 只放**服务端真认**的那几条（`world/command/`：look / select / go / say / chat / tell）。
 *   这是前端自己造的按钮，摆一条不存在的指令就是纯假按钮 ——
 *   点下去回一句"什么？"，玩家只会以为坏了。
 *   （房间动作栏里若出现"打坐"这类点不通的，那是**服务端**下发的，不是这里造的。）
 *
 * ★ 「喊」用 `chat` 而不是 `shout`：`chat` 是 wushen 的**原词**
 *   （`world/cmd/channel/chat.js` 的 `this.command = "chat"`），也是聊天输入带
 *   「世界」页签产出的那个词。两者用同一个主名，才不会出现"页签能发、chip 不能"。
 *   `shout` / `yell` 仍是有效别名，只是不再作为展示用的主名。
 */
const CHIPS: readonly CmdItem[] = [
  { cmd: 'look', name: '看' },
  { cmd: 'go', name: '走' },
  { cmd: 'say', name: '说' },
  { cmd: 'chat', name: '喊' },
  { cmd: 'tell', name: '私' },
  // ★ 「属性」= 服务端 `score`（`world/command/info/score.ts`）。
  //   底部工具条上有一格，但**窄屏（≤480px）会把它收起**（4 格会把气血/内力的
  //   数值挤出可视区，量出来的 `scrollWidth 211 > clientWidth 140`），
  //   于是小屏玩家只有这一个入口 —— 它不能只活在工具条上。
  { cmd: 'score', name: '属性' },
];

/** 需要参数的指令（点 chip / 快捷格只预填）。别名一并登记，换用哪个词都只预填 */
const NEED_ARG = new Set(['go', 'say', 'chat', 'shout', 'yell', 'tell']);

/** 当前聊天频道 */
let channel = 'say';
/** 私语对象（点房间里的人时设定） */
let target: string | null = null;
/** 聊天浮层关着时收到的条数 */
let unread = 0;

// ---------------------------------------------------------------------------
// 开 / 关
// ---------------------------------------------------------------------------

/**
 * 开指令输入带。
 *
 * ★ **再点一次就关**（toggle）：wushen 的「聊天」键就是 `toggleClass('hide')`，
 *   而浮层没有 ✕ 按钮（关掉的路径是"点别处"或再点一次键）。
 *   没有 toggle 的话，玩家想收起输入带只能去点别处 —— 多一步。
 */
export function openCmd(prefill?: string): void {
  if (cmdOpen()) {
    closeInputs();
    return;
  }
  closeInputs();
  need('cmdPop').hidden = false;
  const input = need<HTMLInputElement>('cmdInput');
  if (prefill !== undefined) input.value = prefill;
  input.focus();
}

export function openChat(): void {
  if (chatOpen()) {
    closeInputs();
    return;
  }
  closeInputs();
  need('chatPop').hidden = false;
  need<HTMLInputElement>('chatInput').focus();
  clearUnread();
}

export function closeInputs(): void {
  need('cmdPop').hidden = true;
  need('chatPop').hidden = true;
}

export function cmdOpen(): boolean {
  return !need('cmdPop').hidden;
}

export function chatOpen(): boolean {
  return !need('chatPop').hidden;
}

export function anyInputOpen(): boolean {
  return cmdOpen() || chatOpen();
}

// ---------------------------------------------------------------------------
// 指令
// ---------------------------------------------------------------------------

/** 提交指令框里的内容（去空白；空则不动） */
export function submitCmd(): void {
  const input = need<HTMLInputElement>('cmdInput');
  const text = input.value.trim();
  if (text === '') return;
  history.push(text);
  historyAt = -1;
  input.value = '';
  hooks.run(text);
}

/** 上一条指令（「↻」按钮与 ↑ 共用） */
export function repeatLast(): void {
  const last = history[history.length - 1];
  if (last === undefined) {
    hooks.hint('还没有可重复的指令。');
    return;
  }
  hooks.run(last);
}

/**
 * ↑↓ 翻历史。
 *
 * ★ `-1` 表示"正在编辑新的一行"（不在历史里）：此时按 ↑ 进到最后一条，
 *   而不是先跳到"倒数第二条" —— 玩家按 ↑ 是想拿刚发的那条。
 */
function stepHistory(delta: number): void {
  if (history.length === 0) return;
  if (delta < 0) {
    historyAt = historyAt < 0 ? history.length - 1 : Math.max(0, historyAt - 1);
  } else {
    if (historyAt < 0) return;
    historyAt += 1;
    if (historyAt >= history.length) historyAt = -1;
  }
  const input = need<HTMLInputElement>('cmdInput');
  input.value = historyAt < 0 ? '' : (history[historyAt] ?? '');
}

// ---------------------------------------------------------------------------
// 聊天
// ---------------------------------------------------------------------------

export function composeChat(ch: string, who: string | null, text: string): string | null {
  const body = text.trim();
  if (body === '') return null;
  if (ch === 'tell') {
    const to = (who ?? '').trim();
    if (to === '') return null;
    return `tell ${to} ${body}`;
  }
  return `${ch} ${body}`;
}

export function setChatTarget(name: string | null): void {
  target = name;
}

export function currentChatTarget(): string | null {
  return target;
}

export function setChannel(ch: string): void {
  channel = ch;
  for (const s of Array.from(need('channelBox').querySelectorAll<HTMLElement>('span'))) {
    s.classList.toggle('sel', s.dataset['ch'] === ch);
  }
}

export function currentChannel(): string {
  return channel;
}

export function submitChat(): void {
  const input = need<HTMLInputElement>('chatInput');
  const cmd = composeChat(channel, target, input.value);
  if (cmd === null) {
    hooks.hint(channel === 'tell' && (target === null || target === '')
      ? '私语要先选对象：在「此处有」点一个人。'
      : '说点什么再发送。');
    return;
  }
  input.value = '';
  hooks.run(cmd);
}

/** 收到一条聊天消息：浮层关着就记未读 */
export function noteChat(): void {
  if (chatOpen()) return;
  unread += 1;
  const tag = need('chatTag');
  tag.textContent = String(unread);
  tag.hidden = false;
}

function clearUnread(): void {
  unread = 0;
  need('chatTag').hidden = true;
}

export function unreadCount(): number {
  return unread;
}


// ---------------------------------------------------------------------------
// 绑定
// ---------------------------------------------------------------------------

/** 打开指令带并**预填**（点缺参数的 chip 用）。
    ★ 不走 `openCmd`：那个是 toggle，而此刻浮层本来就开着，调它会把它关掉。 */
function prefillCmd(text: string): void {
  need('cmdPop').hidden = false;
  const input = need<HTMLInputElement>('cmdInput');
  input.value = text;
  input.focus();
}

export function bindInputs(h: InputHooks): void {
  hooks = h;

  // ── 指令带 ──
  renderChips();
  need('cmdSend').addEventListener('click', submitCmd);
  need<HTMLInputElement>('cmdInput').addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') {
      submitCmd();
      return;
    }
    if (ev.key === 'ArrowUp') {
      stepHistory(-1);
      return;
    }
    if (ev.key === 'ArrowDown') stepHistory(1);
  });

  // ── 聊天带 ──
  need('channelBox').addEventListener('click', (ev) => {
    const t = ev.target;
    if (!(t instanceof Element)) return;
    const hit = t.closest('span[data-ch]');
    if (hit === null) return;
    setChannel(hit.getAttribute('data-ch') ?? 'say');
  });
  need('chatSend').addEventListener('click', submitChat);
  need<HTMLInputElement>('chatInput').addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') submitChat();
  });

  // ── 聊天预览区：点它（或 Enter / Space）开聊天浮层 ──
  //    ★ `index.html` 给了它 `role="button" tabindex="0"` + `aria-label`，
  //      那它**就不能是死按钮** —— 声明了能点却不绑事件，比不声明更糟
  //      （读屏器会播报"按钮"，键盘用户按下去毫无反应）。
  //      ⚠️ 旧注释称"wushen 的 `.channel` 只是纯展示区" —— **这句是假的**（2026-10-14 订正）：
  //      wushen `src/process.js:31-32` 本来就给它绑了点击（`ChannelElement.on("click",
  //      Dialog.channel.show…)`）。所以**两边都可点**，不是 newmud 独创。
  //      newmud 多的那一点是**键盘路径**（Enter / Space）—— 这才是真正的增强。
  const brief = need('channel');
  brief.addEventListener('click', () => openChat());
  brief.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Enter' && ev.key !== ' ') return;
    ev.preventDefault(); // Space 默认会滚动页面
    openChat();
  });

  // ── 点别处关掉（wushen 的关闭路径：浮层上没有 ✕，点别处收起）──
  //    ★ 点工具键与聊天预览区要**放行**：那两条路径由 `openCmd/openChat`
  //      的 toggle 处理，这里再关一次会"关了又开"，看着像点了没反应。
  document.addEventListener('click', (ev) => {
    const t = ev.target;
    if (!(t instanceof Element)) return;
    if (t.closest('.pop') !== null) return;
    if (t.closest('.tool-item') !== null) return;
    if (t.closest('#channel') !== null) return;
    if (anyInputOpen()) closeInputs();
  });

  setChannel('say');
}

function renderChips(): void {
  const box = need('cmdChips');
  clear(box);
  for (const c of CHIPS) {
    const chip = el('span', 'chip', c.name);
    chip.dataset['cmd'] = c.cmd;
    chip.addEventListener('click', () => {
      if (NEED_ARG.has(c.cmd)) {
        prefillCmd(`${c.cmd} `);
        return;
      }
      // ★ 无参 chip 执行后**收起浮层**：`look` / `score` 的结果落在消息流里，
      //   而浮层是从底部弹起的卡片，它盖住的正是要读的那一片。
      //   （缺参数的那一支不关：它刚把浮层变成"正在输入"的状态。）
      closeInputs();
      hooks.run(c.cmd);
    });
    box.appendChild(chip);
  }
}

/** 登出 / 断线时清掉未读与私语对象 */
export function resetInputs(): void {
  clearUnread();
  setChatTarget(null);
  closeInputs();
}

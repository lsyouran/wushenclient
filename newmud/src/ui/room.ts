/**
 * src/ui/room.ts — 房间区（wushen 的 `.content-room`）
 * ============================================================================
 * 屏幕最上面那一块：房名 → 描述 → 明显出口 → 此处有（人/物）。
 *
 * ★ 为什么房间信息**不进消息流**：它是"你现在在哪儿"，属于**持续可见**的状态，
 *   而消息流是"发生了什么"。wushen 也是这么分的（`.content-room` 单独一块），
 *   混进消息流的结果就是走两步之后房名被刷没了，玩家只能不停 `look`。
 *
 * ★ 渲染函数全是**纯的**（只产节点）：点击一律由 `bindRoom()` 委托一次完成，
 *   于是列表怎么重建都不用重新绑事件（见 `dom.ts` 的 `delegate`）。
 */

import { clear, delegate, el, need } from './dom.js';
import { plainText, renderMarkup } from './markup.js';
import { dirLabel, isDirection } from './dirs.js';
import { state } from '../state.js';
import type { CmdItem } from '../../shared/protocol.js';

export interface RoomHooks {
  /** 点出口 / 动作 → 直接执行 */
  run(cmd: string): void;
  /** 点房间里的人或物 → 看详情（玩家顺带成为私语对象） */
  pick(id: string, name: string, isPlayer: boolean): void;
}

let hooks: RoomHooks = { run: () => undefined, pick: () => undefined };

/** 重画整个房间区（房名 / 描述 / 出口 / 此处有） */
export function renderScene(): void {
  const room = state.room;

  const name = need('roomName');
  name.replaceChildren();
  renderMarkup(room === null ? '未入江湖' : room.name, name);

  const desc = need('roomDesc');
  desc.replaceChildren();
  if (room !== null) renderMarkup(room.desc, desc);

  renderExits();
  renderItems();
}

/**
 * 明显出口：**只写方向**，不写房名（wushen 的 `exits_dir == 1` 文本分支原样）。
 *
 * ★ wushen 的文本形态（`process.js:334-352`）就是「这里明显的出口有：」+ 方向项，
 *   用 `、` 连接、最后一项前用 ` 和 `；没有出口时照实说"这里没有明显的出口"。
 *   （它那一支写的是**英文方向键**，这里换成中文方向名 —— 显示层的事。）
 *
 * ★ 为什么**不**在这一行写房名（我们一度写了「北·扬州城-北大街」）：
 *   ① wushen 的默认形态是**九宫格**（`.room_exits` 里就是那张 SVG，格子写房名），
 *      文本形态只有方向 —— 一行里再写一遍房名，同一屏同一个目的地就有**两种写法**
 *      （行里带「扬州城-」前缀、图上没有），玩家会以为不是一个地方；
 *   ② 8 个出口时这一行会变成 3 行、把房间区顶高，而且**换行正好断在半截房名上**。
 *   房名没有丢：悬停（`title`）给的就是完整房名，点下去发的仍是方向词。
 */
function renderExits(): void {
  const box = need('roomExits');
  clear(box);

  const dirs = Object.keys(state.exits);
  if (dirs.length === 0) {
    box.appendChild(el('span', 'muted', '这里没有明显的出口。'));
    return;
  }

  box.appendChild(document.createTextNode('这里明显的出口有：'));
  dirs.forEach((dir, i) => {
    if (i > 0) box.appendChild(document.createTextNode(i === dirs.length - 1 ? ' 和 ' : '、'));
    const label = dirLabel(dir);
    const item = el('span', 'exits-item', label);
    item.dataset['dir'] = dir;
    const dest = (state.exits[dir] ?? '').trim();
    if (dest !== '') item.title = plainText(dest);
    box.appendChild(item);
  });
}

/** 此处有：人与物（带气血/内力细条，wushen 的 `.progress`） */
function renderItems(): void {
  const box = need('roomItems');
  clear(box);

  for (const item of state.items) {
    const row = el('div', 'room-item');
    row.dataset['id'] = item.id;
    if (item.p === 1) row.classList.add('pl');

    const name = el('span', 'item-name');
    renderMarkup(item.name, name);
    row.appendChild(name);

    if (item.max_hp !== undefined && item.max_hp > 0) {
      const status = el('span', 'item-status');
      status.appendChild(bar('hp', item.hp ?? 0, item.max_hp));
      if (item.max_mp !== undefined && item.max_mp > 0) {
        status.appendChild(bar('mp', item.mp ?? 0, item.max_mp));
      }
      row.appendChild(status);
    }

    box.appendChild(row);
  }
}

function bar(kind: 'hp' | 'mp', value: number, max: number): HTMLElement {
  const wrap = el('span', `progress ${kind}`);
  const fill = el('i', 'bar');
  fill.style.width = `${String(pct(value, max))}%`;
  wrap.appendChild(fill);
  return wrap;
}

function pct(value: number, max: number): number {
  if (max <= 0) return 0;
  const w = (value / max) * 100;
  return Math.max(0, Math.min(100, Math.round(w)));
}

/**
 * 「可做之事」动作栏（wushen 的 `.room-commands`）。
 *
 * ★ **单点合成**，照 wushen `Combat.create_actions()`（`combat.js:83-88`）：
 *   它把 `actions`（房间）+ `object_actions`（`actions` 包）+ `room_actions`
 *   （`room` 包）三个列表合到**一次 `empty()` 里重画**，任何一次更新都走
 *   `refActions()` —— 于是不存在"某个包把别人的按钮擦掉"。
 *   本仓库此前有 5 条互不知情的写入路径（`room` / `actions` / `addAction` /
 *   `removeAction` / `cmds`），谁后到谁赢；`cmds` 一到就把 `state.actions` 无视掉。
 *   现在**只有这一个函数写 `#verbs`**，各包只更新自己在 `state` 里的那份。
 *
 * ★ 方向动作**不进**这一栏：服务端把方向和内容动作放在同一张表里
 *   （它们确实是同一张动作表），但方向上已经在「明显出口」和小地图里各有一份，
 *   再来一份就是同一个动作三个入口。
 */
export function renderActionBar(): void {
  const cmds = [...(state.room?.commands ?? []), ...state.actions];
  fillCmds(need('verbs'), cmds.filter((c) => c.cmd !== '' && !isDirection(c.cmd)), 'act-item');
}

/** 招式栏（wushen 的 `.combat-commands`）：`perform` 帧的地盘 */
export function renderPfms(cmds: readonly CmdItem[]): void {
  fillCmds(need('pfms'), cmds.filter((c) => c.cmd !== ''), 'pfm-item');
}

function fillCmds(box: HTMLElement, cmds: readonly CmdItem[], cls: string): void {
  clear(box);
  for (const c of cmds) {
    const item = el('span', cls, c.name === '' ? c.cmd : c.name);
    item.dataset['cmd'] = c.cmd;
    box.appendChild(item);
  }
}

/** 重画全部（cmds 帧等"什么都可能变了"的场合） */
export function renderAll(): void {
  renderScene();
  renderActionBar();
}

export function bindRoom(h: RoomHooks): void {
  hooks = h;

  delegate(need('roomExits'), '.exits-item', 'click', (hit) => {
    const dir = hit.dataset['dir'] ?? '';
    if (dir !== '') hooks.run(dir);
  });

  delegate(need('roomItems'), '.room-item', 'click', (hit) => {
    const id = hit.dataset['id'] ?? '';
    if (id === '') return;
    const name = hit.querySelector('.item-name')?.textContent ?? '';
    hooks.pick(id, name, hit.classList.contains('pl'));
  });

  delegate(need('verbs'), '.act-item', 'click', (hit) => {
    const cmd = hit.dataset['cmd'] ?? '';
    if (cmd !== '') hooks.run(cmd);
  });

  delegate(need('pfms'), '.pfm-item', 'click', (hit) => {
    const cmd = hit.dataset['cmd'] ?? '';
    if (cmd !== '') hooks.run(cmd);
  });
}

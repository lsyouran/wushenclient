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

/**
 * 战斗动作栏（wushen 的 `.combat-commands`）。
 *
 * ★ 这一行现在有**两个来源**（2026-10-20）：
 *   - 战斗中的固定动作「逃跑」—— 只在 `state.fighting` 时出现，脱战即消失；
 *   - 服务端给的招式（`perform` 帧），存在 `state.pfms`。
 *   两源合成后整行重画；空行由 CSS 的 `:empty` 收起（不占一条灰带）。
 */
export function renderCombatBar(): void {
  const cmds: CmdItem[] = state.fighting ? [{ cmd: 'flee', name: '逃跑' }] : [];
  cmds.push(...state.pfms);
  fillCmds(need('pfms'), cmds.filter((c) => c.cmd !== ''), 'pfm-item');
}

/** 招式栏更新（`perform` 帧）：先存状态再重画，见 `state.pfms` 的注释 */
export function renderPfms(cmds: readonly CmdItem[]): void {
  state.pfms = cmds;
  renderCombatBar();
}

function fillCmds(box: HTMLElement, cmds: readonly CmdItem[], cls: string): void {
  clear(box);
  for (const c of cmds) {
    const item = el('span', cls, c.name === '' ? c.cmd : c.name);
    item.dataset['cmd'] = c.cmd;
    box.appendChild(item);
  }
  // ★ 行是**整块重画**的，重画会把 inline 的 `background-size` 抹掉 ⇒
  //   每次画完都要把冷却遮罩重新贴回去，并顺手校准推进表。
  applyCooldowns();
}

/**
 * 冷却推进的步长（照 wushen `combat.js:209` 的 `PFM_INTERVAL`）。
 *
 * ★ 为什么不取更小值：遮罩只是"还有多久"的粗略提示，玩家读的是**退没退干净**，
 *   不是毫秒数。300ms 一拍在视觉上已经连续，再密只是多耗电池。
 */
const CD_STEP_MS = 300;

/** 推进表；`null` = 当前没有在走的冷却（空闲即停表） */
let cdTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * 某条指令当前还剩多少冷却。
 *
 * @returns 剩余百分比（0–100）；`null` = 不在冷却中 / 已走完
 *
 * ★ 匹配口径照 wushen `combat.js:214-219`：它拿 `skill.id` 去 `dis_pfms` 里找同 id 项。
 *   本项目动作栏的键是**整条指令**（`CmdItem.cmd`，形如 `perform 3v3cl6ifhs`），
 *   而冷却帧里的 `id` 是**技能 id**。两种口径都接住 —— 否则无论服务端按哪一种发，
 *   界面上都可能出现"一个按钮都盖不上"的静默失效。
 */
export function cooldownRatioOf(cmd: string): number | null {
  const now = Date.now();
  for (const cd of state.cooldowns) {
    if (cd.id !== cmd && cmd.split(' ').pop() !== cd.id) continue;
    const total = cd.time ?? cd.rtime ?? 0;
    const endsAt = cd.endsAt ?? 0;
    if (total <= 0 || endsAt <= now) return null;
    return Math.max(0, Math.min(100, Math.round(((endsAt - now) / total) * 100)));
  }
  return null;
}

/**
 * 把冷却遮罩贴到两条动作栏现有的按钮上。
 *
 * ★ 机制（照 wushen `combat.js:210-242`）：按钮底上铺一层灰色渐变，
 *   `background-size` 的横向比例 = **剩余**比例，靠右对齐
 *   （`background-position: 100% 100%`）⇒ 冷却走完，灰色从右边退干净。
 *   ⚠️ 这套渐变在本仓库的 CSS 里**早就写好了**（`.act-item` / `.pfm-item` 的
 *      `background-image` + `background-size: 0% 100%`），但此前没有任何代码
 *      去推进它 ⇒ 恒为 0%，渐变一直是死代码。这条函数就是补上那个"推"。
 */
export function applyCooldowns(): void {
  for (const id of ['verbs', 'pfms'] as const) {
    const box = need(id);
    // ★ `Array.from` 而不是直接 `for...of`：本工程的 `lib` 没开 `DOM.Iterable`，
    //   `NodeListOf` 在那里没有 `[Symbol.iterator]`（`error TS2488`）。
    for (const item of Array.from(box.querySelectorAll<HTMLElement>('[data-cmd]'))) {
      const ratio = cooldownRatioOf(item.dataset['cmd'] ?? '');
      item.style.backgroundSize = ratio === null ? '' : `${String(ratio)}% 100%`;
    }
  }
  syncCooldownTicker();
}

/**
 * 起 / 停推进表：**有没走完的冷却才跑**。
 *
 * ★ 为什么必须能停：这是一个 300ms 的循环，若留着空转，玩家站在广场上看风景时
 *   也在耗电、也在占用事件循环 —— 而它什么都没在推进。
 * ★ 表只负责「再算一次并贴上去」，比例一律由**墙钟**现算（见 `cooldownRatioOf`），
 *   于是定时器晚到 / 被后台节流都不会让进度走慢。
 */
function syncCooldownTicker(): void {
  const now = Date.now();
  const busy = state.cooldowns.some((cd) => (cd.endsAt ?? 0) > now);
  if (busy && cdTimer === null) {
    cdTimer = setTimeout(() => {
      cdTimer = null;
      applyCooldowns();
    }, CD_STEP_MS);
  } else if (!busy && cdTimer !== null) {
    clearTimeout(cdTimer);
    cdTimer = null;
  }
}

/** 清掉推进表（换角色 / 回认证屏时调用，与 `resetPanels` 同族） */
export function stopCooldownTicker(): void {
  if (cdTimer === null) return;
  clearTimeout(cdTimer);
  cdTimer = null;
}

/** 重画全部（cmds 帧等"什么都可能变了"的场合） */
export function renderAll(): void {
  renderScene();
  renderActionBar();
}

/**
 * 滚轮 → 横向滚动的位移换算（照 wushen `src/combat.js:10-13` 的 `Combat.Scroll`）。
 *
 * ★ 为什么抽成**纯函数**：jsdom **没有布局**，`scrollLeft` 恒为 0，
 *   「在动作栏上滚一下、断言位移」这种用例在那里**永远**测不出来 ——
 *   能被测到的只有这个换算本身（见 `tests/web-ui.test.ts` 的 §79 组）。
 *
 * ★ 为什么**不**无条件吃掉滚轮：栏里只有两三个动作时它并不溢出，
 *   这时把滚轮吃掉 ⇒ "在动作栏上滚一下"变成页面也不动、栏也不动。
 *   所以只有**那个方向还滚得动**才返回非零，接线处据此决定拦不拦事件。
 *
 * @param cur    当前 scrollLeft
 * @param max    可滚动的最大位移（= scrollWidth − clientWidth）
 * @param deltaY 滚轮的竖向位移（向下为正）
 * @returns 实际要施加的横向位移
 */
export function wheelScrollDelta(cur: number, max: number, deltaY: number): number {
  if (deltaY === 0) return 0;
  const target = Math.max(0, Math.min(max, cur + deltaY));
  return target - cur;
}

/**
 * 滚轮 → 横向滚动。
 *
 * ★ 为什么必须自己接：两条动作栏都是 `white-space: nowrap` + `overflow-x: auto`
 *   （`style.css` 的 `.room-commands` / `.combat-commands`），动作一多就横向溢出；
 *   而全站 `scrollbar-width: none`（照 wushen 抄的）**把滚动条藏了起来**。
 *   浏览器不会把竖向滚轮自动翻译成横向滚动 ⇒ 鼠标用户看着右边还有动作，
 *   却没有任何手段滚过去，只能回头去背指令手敲。触屏横滑本来就能滚，缺的正是鼠标这一路。
 */
function bindWheelScroll(box: HTMLElement): void {
  box.addEventListener(
    'wheel',
    (ev) => {
      const e = ev as WheelEvent;
      const delta = wheelScrollDelta(box.scrollLeft, box.scrollWidth - box.clientWidth, e.deltaY);
      if (delta === 0) return;
      box.scrollLeft += delta;
      e.preventDefault(); // 拦住它继续冒泡去滚消息流
    },
    { passive: false },
  );
}

export function bindRoom(h: RoomHooks): void {
  hooks = h;

  // ★ 两条动作栏都要接滚轮（`#verbs` = 房间/目标动作，`#pfms` = 招式）——
  //   它们各自的 `overflow-x` 是独立的，少绑一条就多一处"够不着"。
  bindWheelScroll(need('verbs'));
  bindWheelScroll(need('pfms'));

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

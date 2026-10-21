/**
 * src/state.ts — 前端状态（单一可变对象 + 显式渲染）
 * ============================================================================
 * 刻意**不引入**响应式框架：本项目的价值在协议与闸门，前端只是"把包画出来"。
 * 多加一层框架就意味着多一个要跟协议对账的地方。
 *
 * ★ 与 wushen 前端的差异：wushen 把状态散在 `Process` / `Dialog` / `Combat` 各对象的
 *   字段里（`Process.itemsElement`、`Dialog.pack.items` …），于是"房间里有什么"这个问题
 *   有两个答案。这里所有"服务端告诉我的事实"只有一份，UI 只读不写。
 */

import type { CmdItem, ItemBrief } from '../shared/protocol.js';

/**
 * 玩家数值（`sc` / `login` / `levelup` 帧更新）。
 * ★ 这些值画在**底部状态条**上（`ui/status.ts` 的 `hpFill` / `mpFill`，
 *   wushen 的 `.state-bar`）。这条注释以前写着"当前没有专门的血条 UI、
 *   数值走状态指令的文本回显落右抽屉的属性页"—— 两半都不成立：
 *   血条就在状态条上，而**没有右抽屉**（`§19.4` 的"假按钮"结论之后已移除），
 *   服务端也没有 `hp` 这类取数指令。
 */
export interface Vitals {
  hp: number;
  maxHp: number;
  mp: number;
  maxMp: number;
  qi: number;
  level: number;
}

export interface RoomView {
  path: string;
  name: string;
  desc: string;
  commands: readonly CmdItem[];
}

/**
 * 一个冷却条目（`dispfm` / `disobj` / `changepfm` / `clearDistime` 四包共用）。
 *
 * ★ `endsAt` 是**渲染进度用的到期时间戳**，不在协议里 —— 协议只给「还剩多久」
 *   （`rtime`）与「总共有多久」（`time`）两个**时长**，而画一条会走的进度条需要
 *   一个**时间点**：收到帧的那一刻记下 `Date.now() + 剩余`，之后每拍用「当前 − 到期」
 *   算比例。
 *   ★ 为什么用时间戳而不是照 wushen 那样每拍递减一个固定值
 *     （`combat.js:223` 的 `ani_time -= PFM_INTERVAL`）：递减法把**定时器当钟表用**，
 *     后台标签页被节流、或某一拍晚到了，进度就会走慢、比真实冷却晚退。
 *     时间戳法只依赖墙钟，节流之后回来一拍就跳到正确位置。
 */
export interface CooldownEntry {
  id: string;
  /** 公共冷却（毫秒）——会把所有剩得比它少的招式一起拉到这个刻度 */
  rtime?: number;
  /** 冷却总时长（毫秒） */
  time?: number;
  /** 剩余次数 */
  count?: number;
  /** ★ 到期时间戳（`Date.now()` 基准）；只在 `time`/`rtime` > 0 时写入 */
  endsAt?: number;
}

export interface AppState {
  connected: boolean;
  /** 登录面板里填的角色标识；登录成功后也是它 */
  roleId: string;
  loggedIn: boolean;
  vitals: Vitals;
  room: RoomView | null;
  /** 房间里的人与物（`items` 帧的镜像；`itemadd`/`itemremove` 增量维护它） */
  items: ItemBrief[];
  /** 出口：方向 → 目标显示名 */
  exits: Record<string, string>;
  /** 可点击动作（房间/目标的 `actions` 帧） */
  actions: readonly CmdItem[];
  /** 全局指令（`cmds` 帧） */
  cmds: readonly CmdItem[];
  /** 状态 / BUFF（`status` 帧） */
  statuses: Array<{ id: string; name?: string; duration?: number }>;
  /** 战斗标记（`combat` 帧） */
  fighting: boolean;
  /**
   * 战斗招式（`perform` 帧给的命令）。
   *
   * ★ 与 `cooldowns` 分开存（2026-10-20）：`#pfms` 这一行现在有**两个来源**
   *   —— 战斗中的固定动作（`逃跑`）与服务端给的招式。原先 `renderPfms(cmds)`
   *   直接拿这一次帧的参数整行重画，于是"战斗开始"时没有帧可用，
   *   逃跑按钮就永远出不来。把招式列表存进状态，重画才不依赖某一次帧。
   */
  pfms: readonly CmdItem[];
  /** 冷却显示（dispfm / disobj / changepfm / clearDistime） */
  cooldowns: CooldownEntry[];
}

const ROLE_KEY = 'mud.roleId';

export const state: AppState = {
  connected: false,
  roleId: localStorage.getItem(ROLE_KEY) ?? '',
  loggedIn: false,
  vitals: { hp: 0, maxHp: 0, mp: 0, maxMp: 0, qi: 0, level: 0 },
  room: null,
  items: [],
  exits: {},
  actions: [],
  cmds: [],
  statuses: [],
  fighting: false,
  pfms: [],
  cooldowns: [],
};

export function rememberRole(roleId: string): void {
  state.roleId = roleId;
  localStorage.setItem(ROLE_KEY, roleId);
}

/** 登录 / 断线时把"服务端告诉我的事实"全部清掉（避免残留上一局的数据） */
export function resetWorldFacts(): void {
  state.room = null;
  state.items = [];
  state.exits = {};
  state.actions = [];
  state.cmds = [];
  state.statuses = [];
  state.fighting = false;
  state.pfms = [];
  state.cooldowns = [];
  state.loggedIn = false;
}

/** 增量维护房间列表（`itemadd` / `itemremove`） */
export function addItemBrief(brief: ItemBrief): void {
  if (state.items.some((i) => i.id === brief.id)) return;
  state.items.push(brief);
}

export function removeItemBrief(id: string): void {
  state.items = state.items.filter((i) => i.id !== id);
}

/** `sc` 帧：只更新给到的字段（服务端可能只发 hp） */
export function patchVitals(patch: Partial<Vitals>): void {
  if (patch.hp !== undefined) state.vitals.hp = patch.hp;
  if (patch.maxHp !== undefined) state.vitals.maxHp = patch.maxHp;
  if (patch.mp !== undefined) state.vitals.mp = patch.mp;
  if (patch.maxMp !== undefined) state.vitals.maxMp = patch.maxMp;
  if (patch.level !== undefined) state.vitals.level = patch.level;
}

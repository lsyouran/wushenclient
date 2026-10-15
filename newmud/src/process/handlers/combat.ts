/**
 * src/process/handlers/combat.ts — 战斗 / 状态 / 冷却
 *
 * ⚠️ 战斗系统尚未落地（服务端目前不会发 `combat` / `perform`），
 *    这些 handler 是**协议已声明**的部分：收到就要画出来，否则将来接入时会静默丢帧。
 */

import { registerHandler } from '../registry.js';
import type { CmdItem } from '../../../shared/protocol.js';
import { pushCommands, pushLine } from '../../ui/stream.js';
import { renderStatus } from '../../ui/status.js';
import { renderPfms } from '../../ui/room.js';
import { patchVitals, state } from '../../state.js';

const asString = (v: unknown): string => (typeof v === 'string' ? v : '');
const asNumber = (v: unknown): number | undefined => (typeof v === 'number' ? v : undefined);
const asCmds = (v: unknown): CmdItem[] =>
  Array.isArray(v)
    ? v
        .filter((x): x is Record<string, unknown> => typeof x === 'object' && x !== null)
        .map((x) => ({ cmd: asString(x['cmd']), name: asString(x['name']) }))
    : [];

registerHandler('sc', (p) => {
  // 只更新给到的字段（服务端可能只发 hp）。
  // 逐字段赋值而不是条件展开：`exactOptionalPropertyTypes` 下 `{ hp: undefined }`
  // 与"没这个字段"是两回事，展开写法会把 undefined 塞进去。
  const patch: { hp?: number; maxHp?: number; mp?: number; maxMp?: number } = {};
  const hp = asNumber(p['hp']);
  const maxHp = asNumber(p['max_hp']);
  const mp = asNumber(p['mp']);
  const maxMp = asNumber(p['max_mp']);
  if (hp !== undefined) patch.hp = hp;
  if (maxHp !== undefined) patch.maxHp = maxHp;
  if (mp !== undefined) patch.mp = mp;
  if (maxMp !== undefined) patch.maxMp = maxMp;
  patchVitals(patch);
  const dmg = asNumber(p['damage']);
  if (dmg !== undefined && dmg !== 0) pushLine(`你造成了 ${dmg} 点伤害。`, 'fight');
  renderStatus();
});

registerHandler('combat', (p) => {
  state.fighting = p['start'] === 1;
  pushLine(state.fighting ? '【战斗开始】' : '【战斗结束】', 'fight');
  renderStatus();
});

registerHandler('status', (p) => {
  const action = asString(p['action']);
  const sid = asString(p['id']);
  const name = asString(p['name']);
  if (action === 'clear') {
    state.statuses = [];
  } else if (action === 'remove') {
    state.statuses = state.statuses.filter((s) => s.id !== sid);
  } else {
    const entry: { id: string; name?: string; duration?: number } = { id: sid };
    if (name !== '') entry.name = name;
    const duration = asNumber(p['duration']);
    if (duration !== undefined) entry.duration = duration;
    state.statuses = state.statuses.filter((s) => s.id !== sid);
    state.statuses.push(entry);
  }
  const label = name === '' ? sid : name;
  if (action !== 'refresh') {
    pushLine(action === 'add' ? `【状态】获得 ${label}` : `【状态】${label} 已移除`, 'sys');
  }
  renderStatus();
});

registerHandler('die', (p) => {
  if (p['relive'] === true) pushLine('【复活】你又活过来了。', 'fight');
  else pushLine('【死亡】你倒下了……', 'err');
  // ★ 死亡选项进**消息流**的一条命令条，不写动作栏。
  //   wushen 的 `Process.die` 走 `Process.state({desc, commands})` —— 那是它底部
  //   的"状态"面板，本项目没有对应 UI（26 册 §16.8），所以落到现有的
  //   "这里有几条命令"落点上，而不是去顶掉 `#verbs`（那正是 §20.4 要根治的写法）。
  pushCommands(asCmds(p['commands']));
});

registerHandler('state', (p) => {
  pushLine(`【${asString(p['state'])}】${asString(p['desc'])}`, 'sys');
});

/** 招式进 `.combat-commands`（wushen 把招式与房间动作分成两栏） */
registerHandler('perform', (p) => {
  renderPfms(asCmds(p['items']));
});

// ---- 冷却（四个包共用一套结构：id / rtime / time / count）----

function cooldown(kind: string) {
  return (p: Record<string, unknown>): void => {
    const id = asString(p['id']);
    if (kind === 'clearDistime') {
      state.cooldowns = id === '' ? [] : state.cooldowns.filter((c) => c.id !== id);
      return;
    }
    const entry: { id: string; rtime?: number; time?: number; count?: number } = { id };
    const rtime = asNumber(p['rtime']);
    const time = asNumber(p['time']);
    const count = asNumber(p['count']);
    if (rtime !== undefined) entry.rtime = rtime;
    if (time !== undefined) entry.time = time;
    if (count !== undefined) entry.count = count;
    state.cooldowns = state.cooldowns.filter((c) => c.id !== id);
    state.cooldowns.push(entry);
    // ★ 冷却只落消息流：没有"武学面板"这种东西（服务端没有 skills 指令），
    //   往一个不存在的面板里写行，玩家永远看不到。
    pushLine(`【冷却】${id} ${String(rtime ?? 0)}ms`, 'sys');
  };
}

registerHandler('dispfm', cooldown('dispfm'));
registerHandler('disobj', cooldown('disobj'));
registerHandler('changepfm', cooldown('changepfm'));
registerHandler('clearDistime', cooldown('clearDistime'));

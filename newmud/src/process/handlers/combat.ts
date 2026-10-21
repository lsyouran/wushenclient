/**
 * src/process/handlers/combat.ts — 战斗 / 状态 / 冷却
 *
 * ★ 接线现状（2026-10-16 批 2 订正，原文写"服务端目前不会发 combat"已**不实**）：
 *   - `sc` / `combat` / `die` —— **已有生产者**（`server/session.ts` 的 `#outputFor`
 *     与 `#pushStats`）：登录与每次数值对账推 `sc`；开打 / 停手推 `combat`；
 *     死亡推 `die`（带复活按钮）。
 *   - `perform` / `status` / `state` / 冷却四包（`dispfm` / `disobj` /
 *     `changepfm` / `clearDistime`）—— **仍无生产者**（属技能 / 状态批次）。
 *     这些 handler 是"协议已声明"的部分：收到就要画出来，否则接入时会静默丢帧。
 */

import { registerHandler } from '../registry.js';
import type { CmdItem } from '../../../shared/protocol.js';
import { pushCommands, pushLine } from '../../ui/stream.js';
import { renderStatus } from '../../ui/status.js';
import { applyCooldowns, renderCombatBar, renderPfms } from '../../ui/room.js';
import { patchVitals, state } from '../../state.js';
import type { CooldownEntry } from '../../state.js';

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
  // ★★ 这里原先有一句 `if (state.fighting) stopAbsorb();`（§78 的修法）。
  //   §80 之后整条吸收机制删掉了 —— 战报不带 `context`，按"安全默认"
  //   自然落在消息流，不需要开战时**记得**去关某个标志。
  //   这正是那三次真机反馈的教训：靠"某个时刻记得关掉开关"的修法，
  //   下一个没想到的时刻就会重新漏。
  pushLine(state.fighting ? '【战斗开始】' : '【战斗结束】', 'fight');
  renderStatus();
  // ★ 「逃跑」按钮跟着战斗状态出现 / 消失（wushen `escape` 只在战斗中可用）。
  //   不重画这一行的话，开打后按钮不会冒出来 —— 玩家仍然只能靠背指令。
  renderCombatBar();
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

/**
 * 持续状态（`state` 包，26 册 §75）。
 *
 * ★★ `state === ''` 是**状态结束**那一帧（`{state:'',desc:''}`）——
 *   不要把它渲染成一行「【】」空壳：那不是"发生的事"，是收尾信号。
 *   wushen 那边停止状态时也是静默的（`stopstate.js` 只回一句"你停下来了"）。
 */
registerHandler('state', (p) => {
  const title = asString(p['state']);
  if (title === '') return;
  const desc = asString(p['desc']);
  pushLine(desc === '' ? `【${title}】` : `【${title}】${desc}`, 'sys');
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
      renderStatus(); // ★ R7（2026-10-17 审查）：改了状态就得重绘，否则 `#pFlags` 的"冷却 N"不更新
      // ★ 冷却撤了 ⇒ 按钮上的灰色遮罩也要当场退干净，不能等下一次重画。
      applyCooldowns();
      return;
    }
    const entry: CooldownEntry = { id };
    const rtime = asNumber(p['rtime']);
    const time = asNumber(p['time']);
    const count = asNumber(p['count']);
    if (rtime !== undefined) entry.rtime = rtime;
    if (time !== undefined) entry.time = time;
    if (count !== undefined) entry.count = count;
    // ★ 把"还剩多久"钉成"到什么时候结束"：服务端只在**开始冷却**时发一帧，
    //   之后不会再推 ⇒ 要画一条会走的进度条，前端必须自己记一个时间点。
    const total = time ?? rtime ?? 0;
    if (total > 0) entry.endsAt = Date.now() + total;
    state.cooldowns = state.cooldowns.filter((c) => c.id !== id);
    state.cooldowns.push(entry);
    // ★ 冷却只落消息流：没有"武学面板"这种东西（服务端没有 skills 指令），
    //   往一个不存在的面板里写行，玩家永远看不到。
    pushLine(`【冷却】${id} ${String(rtime ?? 0)}ms`, 'sys');
    // ★ R7（2026-10-17 审查）：本族帧此前只改 `state.cooldowns`、**不重绘**
    //   ⇒ L2 的"让 `renderStatus()` 消费冷却"实际对冷却这批帧是半失效的
    //   （要等下一个 `sc` / `combat` / `status` 帧顺带刷新）。补上。
    renderStatus();
    // ★ 把遮罩贴到按钮上并起推进表：此前 CSS 里那条渐变**没有任何代码去推它**，
    //   于是招式冷却在界面上完全没有视觉反馈。
    applyCooldowns();
  };
}

registerHandler('dispfm', cooldown('dispfm'));
registerHandler('disobj', cooldown('disobj'));
registerHandler('changepfm', cooldown('changepfm'));
registerHandler('clearDistime', cooldown('clearDistime'));

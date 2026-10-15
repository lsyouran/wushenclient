/**
 * src/process/handlers/world.ts — 场景类包（房间 / 出口 / 物件 / 动作 / 地图）
 */

import { registerHandler } from '../registry.js';
import type { CmdItem, ItemBrief } from '../../../shared/protocol.js';
import { pushCommands, pushLine } from '../../ui/stream.js';
import { renderScene, renderActionBar } from '../../ui/room.js';
import { renderMap } from '../../ui/map.js';
import { closePanel } from '../../ui/panel.js';
import { addItemBrief, removeItemBrief, state } from '../../state.js';

const asString = (v: unknown): string => (typeof v === 'string' ? v : '');
const asCmds = (v: unknown): CmdItem[] =>
  Array.isArray(v)
    ? v
        .filter((x): x is Record<string, unknown> => typeof x === 'object' && x !== null)
        .map((x) => ({ cmd: asString(x['cmd']), name: asString(x['name']) }))
    : [];

/**
 * 一个物件条目。
 *
 * ★ `items` 与 `itemadd` **共用这一份**：协议（`ItemBrief`）声明了几个字段，
 *   这里就收几个 —— 挑一半的写法正是上一轮的 bug：`asItems` 只映射了
 *   `hp/max_hp`，把 `mp/max_mp` 丢了，于是 `room.ts` 里读 `item.max_mp`
 *   永远是 `undefined`，**内力条一次都没画出来过**（而服务端 schema 是允许
 *   发这两个字段的）。字段透传完整，才不会"数据一直在、只是被解析层吃了"。
 */
function asItemBrief(x: Record<string, unknown>): ItemBrief {
  return {
    id: asString(x['id']),
    name: asString(x['name']),
    ...(x['p'] === 1 ? { p: 1 as const } : {}),
    ...(x['m'] === 1 ? { m: 1 as const } : {}),
    ...(x['l'] === 1 ? { l: 1 as const } : {}),
    ...(x['f'] === 1 ? { f: 1 as const } : {}),
    ...(x['o'] === 1 ? { o: 1 as const } : {}),
    ...(typeof x['hp'] === 'number' ? { hp: x['hp'] } : {}),
    ...(typeof x['max_hp'] === 'number' ? { max_hp: x['max_hp'] } : {}),
    ...(typeof x['mp'] === 'number' ? { mp: x['mp'] } : {}),
    ...(typeof x['max_mp'] === 'number' ? { max_mp: x['max_mp'] } : {}),
  };
}

const asItems = (v: unknown): ItemBrief[] =>
  Array.isArray(v)
    ? v.filter((x): x is Record<string, unknown> => typeof x === 'object' && x !== null).map(asItemBrief)
    : [];

/**
 * 进/看房间。
 *
 * ★ 房间名与描述**不进消息流**（wushen 也是把它们放在持续可见的那一块里）——
 *   消息流留给"发生的事"。换房间时只加一条分隔线，外加把小地图重画一遍
 *   （出口换了，格子必须跟着换，否则点上去走的是上一个房间的路）。
 */
registerHandler('room', (p) => {
  const changed = state.room?.path !== asString(p['path']);
  state.room = {
    path: asString(p['path']),
    name: asString(p['name']),
    desc: asString(p['desc']),
    commands: asCmds(p['commands']),
  };
  if (changed) {
    closePanel(); // 换房间时面板里的旧详情不该留着
  }
  renderScene();
  renderActionBar();
  renderMap();
});

registerHandler('exits', (p) => {
  const items = p['items'];
  const next: Record<string, string> = {};
  if (typeof items === 'object' && items !== null) {
    for (const [dir, name] of Object.entries(items as Record<string, unknown>)) {
      next[dir] = asString(name);
    }
  }
  state.exits = next;
  renderScene(); // 出口影响房间区与地图
  renderMap();
});

registerHandler('items', (p) => {
  state.items = asItems(p['items']);
  renderScene();
});

registerHandler('itemadd', (p) => {
  // ★ 与 `items` 走**同一个**解析器：增量加入的物件也要带气血/内力，
  //   否则"走两步进来一个人"比"一开始就在的人"少一条血条（字段被这里丢掉）。
  addItemBrief(asItemBrief(p));
  renderScene();
});

registerHandler('itemremove', (p) => {
  removeItemBrief(asString(p['id']));
  renderScene();
});

/**
 * 单个物件的详情 → **消息流**（wushen `Process.item`，`src/process.js:380-403`）。
 *
 * ★ 这里以前 `openPanel(...)` + `renderVerbs(cmds)` —— **两半都不对**：
 *   ① wushen 的物件详情是 `ReceiveMessage(item.desc)` + `ReceiveMessage('.item-commands')`，
 *      落在**消息流**里，`.dialog` 是地图 / 属性 / 背包那些面板的地盘；
 *   ② `renderVerbs(cmds)` 把房间动作栏整块顶掉（`#verbs` 的第 6 条写入路径）。
 *   描述跟着"发生的事"往下走，玩家才看得到"我刚点了谁"。
 */
registerHandler('item', (p) => {
  const desc = asString(p['desc']);
  if (desc !== '') pushLine(desc);
  pushCommands(asCmds(p['commands']));
});

registerHandler('actions', (p) => {
  state.actions = asCmds(p['items']);
  renderActionBar();
});

registerHandler('addAction', (p) => {
  state.actions = [...state.actions, ...asCmds(p['items'])];
  renderActionBar();
});

registerHandler('removeAction', (p) => {
  const id = asString(p['id']);
  const items = asCmds(p['items']);
  state.actions =
    id === ''
      ? state.actions.filter((a) => !items.some((b) => b.cmd === a.cmd))
      : state.actions.filter((a) => a.cmd !== id);
  renderActionBar();
});

/**
 * 服务端下发的命令列表 → **消息流里的一条命令条**（wushen `Process.cmds`）。
 *
 * ★ 它**不写动作栏**：这以前是 `renderAll()`，而 `renderAll` 只重画
 *   `state.room.commands` —— 于是 `cmds` 一到，`state.actions` 里那些动作
 *   就被静默丢掉了（26 册 §20.4 的"两个真相落在同一格"）。
 *   wushen 那边 `Process.cmds` 与动作栏毫无关系，就是往消息流推一条。
 */
registerHandler('cmds', (p) => {
  state.cmds = asCmds(p['items']);
  pushCommands(state.cmds);
});

/**
 * 地图。
 *
 * ★ 小地图**不由这个包驱动**：它读的是 `state.exits`（`src/ui/map.ts`）。
 *   理由：出口表是"这房间能往哪走"的**唯一事实**，而 `map` 包描述的是
 *   更大范围的位置图 —— 后者内容层还没有生产者（见 26 册 §18 的待办）。
 *   所以这里如实说出来，而不是假装处理了（那会让玩家以为地图坏了）。
 */
registerHandler('map', (p) => {
  const rooms = Array.isArray(p['map']) ? p['map'].length : 0;
  pushLine(
    `【地图】收到地图数据（${rooms} 处）—— 小地图目前由出口表驱动，尚未消费该数据`,
    'sys',
  );
});

registerHandler('updatemap', (p) => {
  pushLine(`【地图更新】${asString(p['n'])} —— 小地图目前由出口表驱动`, 'sys');
});

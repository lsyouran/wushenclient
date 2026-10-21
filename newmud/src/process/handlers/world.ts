/**
 * src/process/handlers/world.ts — 场景类包（房间 / 出口 / 物件 / 动作 / 地图）
 */

import { registerHandler } from '../registry.js';
import type { CmdItem, ItemBrief } from '../../../shared/protocol.js';
import { pushCommands, pushLine } from '../../ui/stream.js';
import { renderScene, renderActionBar } from '../../ui/room.js';
import { renderMap } from '../../ui/map.js';
import { closePanel, isPanelOpen, openPanel, setPanelCmds } from '../../ui/panel.js';
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
 * ★ 房间**描述**不进消息流（wushen 也是把它们放在持续可见的那一块里）——
 *   消息流留给"发生的事"。但**换房间这件事本身是事件**，得在流里留个交代：
 *   否则玩家从「中央广场」走到「北大街」时，屏幕上只有房间区悄悄换了内容，
 *   消息流一行不动（2026-10-18 真机走查：`linesBefore === linesAfter`）。
 *   wushen 在 `Process.room`（`src/process.js:297-306`）里保证这一点：默认档
 *   （`Setting.keep_msg == 0`）**清屏**，`keep_msg` 档则
 *   `ReceiveMessage("你来到了" + room.name + "。")`。
 *   本项目保留历史（不清屏）⇒ 照 `keep_msg` 档：一条分隔线 + 一句「你来到了 X。」。
 *
 * ★ 首次进房间（`state.room === null`）**不播报**：那条路上已经有登录欢迎语，
 *   房间自己也可能有 `on_enter`（`world/room/yz/guangchang.ts` 就写着
 *   「你来到了中央广场。」）—— 再来一句就是同一件事说两遍。
 *
 * ★ 换房间时还要把小地图重画一遍（出口换了，格子必须跟着换，
 *   否则点上去走的是上一个房间的路）。
 */
registerHandler('room', (p) => {
  const before = state.room;
  const path = asString(p['path']);
  const changed = before !== null && before.path !== path;
  state.room = {
    path,
    name: asString(p['name']),
    desc: asString(p['desc']),
    commands: asCmds(p['commands']),
  };
  if (before === null || changed) {
    closePanel(); // 换房间时面板里的旧详情不该留着
  }
  if (changed) {
    // ★★ 只留**一句**播报，不再画分隔线（2026-10-20 §74 真机反馈）。
    //   原来这里是 `pushRule()` + 这一句，而 `pushRule` 往消息流插的是一条
    //   1px 发丝线 —— 玩家每换一个房间，日志里就多一道横线 + 一行"你来到了X。"，
    //   观感像"又叠了一个新的日志区"。他的原话："这绝对是有问题的地方"。
    //   ★ 判据不在"好不好看"，而在**wushen 有没有**：`Process.room`
    //     （`src/process.js:297-306`）的 `keep_msg` 档只 `ReceiveMessage("你来到了"+name+"。")`,
    //     默认档直接清屏 —— 两档都**没有**分隔线。这条是当初自己加的戏。
    pushLine(`你来到了${state.room.name}。`);
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
 * 单个物件的详情 → **物件面板**（26 册 §57 订正）。
 *
 * ★★ 这里原先照 wushen 的 `Process.item`（`src/process.js:380-403`）把描述与命令条
 *   **推进消息流**。真机反馈表明那条移植是错的：
 *   点店小二之后，描述在日志区、「打听」按钮也在日志区，接着点「打听」，
 *   下一层的「人字号客房」又落进日志区 —— 玩家的操作**层层叠进历史记录**，
 *   而日志区本该只记"发生了什么"。
 *
 * ★ 现在开**面板**：标题是物件名，正文是描述，底部是它的动作按钮。
 *   面板本来就是 `.dialog` 的地盘（`ui/panel.ts`），且 `notePanel` 早就为
 *   "开面板 → 服务端回显 → 填充"准备好了 —— 只是 `item` 帧没用它。
 *   `name` 字段协议里一直有（`ItemDetailPacket.name`），此处才第一次用上。
 */
registerHandler('item', (p) => {
  const name = asString(p['name']);
  const desc = asString(p['desc']);
  // ★★ 第四参数 = 面板身份（`item.id`）。之后服务端若把某句话声明成
  //   `context: <同一个 id>`（`warn` 帧），它会落进这块面板；其余一切照旧进消息流。
  //   在这之前这里传的是 `{ absorb: true }` —— **一开面板就吸附所有播报**，
  //   于是战报、拒绝文案、房间播报全被吸进来，前端只能靠词表去补救（§78）。
  openPanel(name === '' ? '物件' : name, desc === '' ? [] : [desc], asCmds(p['commands']), asString(p['id']));
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
 * 服务端下发的命令列表。
 *
 * ★ **物件面板开着 ⇒ 换面板底部那排按钮**（26 册 §57）：点「打听」之后得到的
 *   「人字号客房」是**同一个物件**对话的下一层，它不属于"发生了什么"。
 *   真机反馈里它落在日志区，玩家要往回翻才能点。
 * ★ 面板没开（例如登录时房间动作、或 `cmds` 是房间级的）⇒ 仍进消息流，
 *   这是原来那条落点，没有理由改动。
 *
 * ★ 它**不写动作栏**：这以前是 `renderAll()`，而 `renderAll` 只重画
 *   `state.room.commands` —— 于是 `cmds` 一到，`state.actions` 里那些动作
 *   就被静默丢掉了（26 册 §20.4 的"两个真相落在同一格"）。
 */
registerHandler('cmds', (p) => {
  state.cmds = asCmds(p['items']);
  if (isPanelOpen()) {
    setPanelCmds(state.cmds);
    return;
  }
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

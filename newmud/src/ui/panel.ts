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

import { clear, el, need, onActivate } from './dom.js';
import { renderMarkup } from './markup.js';
import type { CmdItem } from '../../shared/protocol.js';

/** 面板最多留多少行 */
const MAX_ROWS = 200;

/** 当前面板的内容（`null` = 没开） */
let rows: string[] | null = null;

/**
 * 面板**底部那颗（那排）按钮**。
 *
 * ★★ 必须和 `rows` 一起存着（26 册 §57）：`notePanel` 每来一行就整块重画，
 *   而它原先用的默认实参 `cmds = []` —— 于是"店里小二点了打听 → 面板多一行回显"
 *   这一步会把底部那颗「人字号客房」**擦掉**。按钮是面板状态的一部分，
 *   不是某一次 `openPanel` 的临时参数。
 */
let panelCmds: CmdItem[] = [];

/**
 * **数据面板**的自定义内容构建器（`openDataPanel` 设的；`null` = 走纯文本行那条路）。
 *
 * ★★ 为什么要第二形态（26 册 §62）：面板里装的东西分两类 ——
 *   - **物件面板**（`item` 帧）：一段对话上下文，正文是服务端给的文本行；
 *   - **数据面板**（`dialog:score` 这类）：一张**结构化快照**（属性分段、将来的
 *     行囊格子），一行一个 `<p>` 盛不下 —— wushen 那边是 `score.js` 自己带模板。
 *
 *   两类在**视觉上**也必须分开：wushen 的 `.dialog` 打开时把 `.content-room`
 *   加 `hide`、自己顶上，**没有遮罩**（`src/dialog/base.js:101-104`）。而物件面板
 *   按 §60 的真机反馈是"贴着被点那一行浮出来 + 遮罩"。混用一套形态的后果是
 *   "看属性时整屏被糊住" —— 那正是要修的东西。
 *
 * ★ 收一个 `redraw`（就是 `render`）：操作型面板的"选中 / 页签"属于**面板内部状态**，
 *   服务端不知道，所以要有个口子让面板自己重画。属性面板不需要它（纯快照）。
 */
let custom: ((redraw: () => void) => HTMLElement) | null = null;

/** `render()` 正在执行（防 `build` 里同步 `redraw()` 的无限递归，见 `render()`） */
let rendering = false;

/** 由 `main.ts` 注入：点面板里的命令按钮 */
let runner: (cmd: string) => void = () => undefined;

/**
 * 面板要贴在**谁的下面**（返回那个元素的底边 y）。
 *
 * ★ 为什么需要它（2026-10-18 真机反馈）：面板原先写死 `bottom: …`（贴屏幕底），
 *   而"此处有"的列表在**屏幕最上面** —— 玩家在上面点人、操作却在下面，
 *   一只手够不着两头。面板的位置是**接线层**的事（谁离它最近只有 `main.ts` 知道），
 *   所以这里只留一个注入口，不自己去猜 DOM。
 */
let anchor: () => number = () => 0;

/** 面板与锚点之间留的空隙（px） */
const GAP = 12;

export function setPanelAnchor(fn: () => number): void {
  anchor = fn;
}

/**
 * 面板该放在哪儿（**纯函数**，好钉：jsdom 没有布局，位置只能这样测）。
 *
 * @param anchor   锚点底边 y（面板贴它下面）
 * @param height   面板实测高度
 * @param viewport 视口高度
 * @param reserve  底部要留给工具条 / 动作栏的高度
 *
 * ★ 两条约束：① 优先贴锚点下面；② 放不下就**往上钳**，且永不越过屏幕顶部（≥ GAP）。
 */
export function panelTop(o: {
  readonly anchor: number;
  readonly height: number;
  readonly viewport: number;
  readonly reserve: number;
}): number {
  const want = o.anchor + GAP;
  const max = o.viewport - o.reserve - o.height;
  return Math.max(GAP, Math.min(want, max));
}

/** 把算好的位置写进 `#dialog`（每次重画后都要重算：内容变了高度就变了） */
function place(): void {
  const dialog = need('dialog');

  // ★ 数据面板走**另一套几何**（§62）：wushen 的 `.dialog` 与 `.content-room`
  //   是同一个布局位（前者打开时后者 `hide`），所以这里直接对齐房间区的矩形 ——
  //   视觉上就是"换了一页"，而不是浮在画面中央。
  //   ★ 房间区高度为 0（jsdom 无布局 / 还没进房间）时**不写 style**，
  //     退回 CSS 里的兜底值，不至于把面板摆到 `top:0` 去。
  if (dialog.classList.contains('is-data')) {
    const rect = document.getElementById('roomPanel')?.getBoundingClientRect();
    if (rect === undefined || rect.height <= 0) return;
    // ★ 上/左/宽**对齐房间区**（wushen 的两者占同一格，视觉上"换了一页"）。
    dialog.style.top = `${String(rect.top)}px`;
    dialog.style.left = `${String(rect.left)}px`;
    dialog.style.width = `${String(rect.width)}px`;
    // ★★ 高度**不**钳到房间区 —— 这是第一版踩的坑（2026-10-18 真机量出来的）：
    //   房间区只有 121px，属性卡要 302px，结果卡被压进去只能滚七分之六。
    //   wushen 那边 `.dialog-score` 写死 `height:29em`(=406px)，打开时会**把消息流
    //   压扁**，而不是把自己塞进房间区。这里等价做法：从房间区顶开始，
    //   往下长到"留给底部两行"为止。
    const max = window.innerHeight - rect.top - bottomReserve();
    dialog.style.maxHeight = `${String(Math.max(120, max))}px`;
    reserveForDataPanel();
    return;
  }

  // ★★ 物件面板走 CSS 的"居中浮层"：`left:50%` + `transform:translateX(-50%)`。
  //   这里**必须清掉**数据面板留下的 inline `left` / `width` ——
  //   inline 优先级高于 CSS，留着 `left:7px` 再叠一个 `translateX(-50%)`，
  //   面板就会**左移半个身位**跑出屏幕（2026-10-20 真机实测：l=−231 / 窗口 582，
  //   右边缘只到 245，右半张脸全看不见）。玩家的说法是"弹窗有时候会偏左，看不全"，
  //   "有时候"正是因为**只有先开过属性卡、再点 NPC** 时才触发。
  dialog.style.left = '';
  dialog.style.width = '';
  dialog.style.top = `${String(
    panelTop({
      anchor: anchor(),
      height: dialog.getBoundingClientRect().height,
      viewport: window.innerHeight,
      reserve: bottomReserve(),
    }),
  )}px`;
}

/** 底部那两行（工具条 + 动作栏）现在占多高（jsdom 下为 0） */
function bottomReserve(): number {
  const bar = document.getElementById('bottomBar');
  const bottom = document.querySelector('.content-bottom');
  return (
    (bar?.getBoundingClientRect().height ?? 0) + (bottom?.getBoundingClientRect().height ?? 0) + GAP
  );
}

/**
 * 让消息流给数据面板**让位**（§62，2026-10-18 真机量出来的）。
 *
 * ★★ 问题：面板是 `position:fixed` 盖在房间区上的，而消息流的位置**不动** ——
 *   于是面板下沿（304px）以下才看得见消息，而消息是从 `#output` 顶部（123px）
 *   开始排的：只有 6 行时它们全在 251px 附近，**一条都露不出来**。
 *   这跟 wushen 的观感正好相反：wushen 的 `.dialog` 参与 flex 布局，
 *   打开时是把消息流**压扁**，最新一条永远贴在底部可见。
 *
 * ★ 做法：给 `#output` 加 `padding-top`（= 面板底 - 消息流顶），等价于把它
 *   的"可用高度"缩到面板下面那一截。滚动容器带 padding 时，**滚到底**
 *   仍然把最后一行送到可见区（自动贴底那条逻辑不受影响）。
 * ★ 不用 `margin-top`：margin 不参与滚动内容，滚到底时最后一行会被
 *   面板压住一半；padding 会，所以贴底是准的。
 */
function reserveForDataPanel(): void {
  const out = document.getElementById('output');
  if (out === null) return;
  const dlgBottom = need('dialog').getBoundingClientRect().bottom;
  const outTop = out.getBoundingClientRect().top;
  // ★ jsdom 里两者都是 0 ⇒ 差值 0 ⇒ 不写 style（不留一个 `padding-top:0px` 的噪声）
  const pad = Math.max(0, dlgBottom - outTop);
  out.style.paddingTop = pad > 0 ? `${String(pad)}px` : '';
  // ★ 加了 padding ⇒ `scrollHeight` 变大 ⇒ 必须重新贴底，否则看到的还是
  //   被面板压住的那一屏（"开了属性面板，消息流像是空的"）。
  //   这里**强制**贴底而不是走 `stream.ts` 的"贴底才跟随"判定：
  //   玩家没有滚动过，只是容器变小了。
  if (pad > 0) out.scrollTop = out.scrollHeight;
}

/** 撤掉给数据面板让的那块空隙（回到物件面板 / 关闭面板时） */
function releaseDataPanelReserve(): void {
  const out = document.getElementById('output');
  if (out !== null) out.style.paddingTop = '';
}

/**
 * 当前物件面板**是谁**（`item` 帧的 `id`）；`null` = 没有物件面板。
 *
 * ★★ 这就是"文本该落到哪儿"的**唯一判据**（2026-10-21 §80）。
 *
 *   在这之前这里是一个 `absorb: boolean`：面板一开就**吸收**所有服务端播报，
 *   于是前端必须拿三个**间接信号**去猜该不该吸 —— 命令从哪来（`issuing`）、
 *   是否在战斗中（`state.fighting`）、面板开着且吸收中（`absorb`）。
 *   启发式必然有漏：§57 点店小二后操作层层叠进日志、§74 请教三次面板堆成三屏、
 *   §78 和木人切磋战报写进「木人桩」的操作框 —— 同一个病三次发作。
 *
 *   ⇒ 判据换成**名字相等**：服务端在 `warn` 帧里声明 `context`，
 *     与这里的 `panelId` 相等才投进面板，否则一律进消息流。
 *     服务端没声明 = 谁也不猜 = 进消息流（安全默认）。
 *
 * ★ 为什么是 id 而不是标题：标题是给人看的、可能重名、还会被改名，
 *   拿它当键迟早对不上；`item` 帧的 `id` 是服务端自己发的，天然同源。
 */
let panelId: string | null = null;

/**
 * 物件面板打开时的**基线行**（物件名 + 描述）—— 每轮对话都在它的**副本**上追加。
 *
 * ★★ 为什么需要基线（2026-10-20 真机反馈，§74）：
 *   原来 `rows` 是**一路追加**的 —— 点教头 → 描述；点「请教」→ 加一句；
 *   学一次 → 又加一句；再学 → 再加…… 面板从 214px 长到 375px，
 *   内容变成"教头 + 三条学习记录 + 七行技能表"。
 *   玩家的话是「每次向教头请教，信息都一直在弹窗里」：**历史永远不清**，
 *   而他在**输入框**里敲的 `learn` 也被吸进来（那本该是日志区的"发生的事"）。
 *   ⇒ 语义改成"**一轮交互**"：面板内再发一条命令 = 新的一轮，正文从基线重来。
 */
let baseRows: string[] = [];

/**
 * 本轮是否已经开始（`false` ⇒ 下一条回显先**重置成基线**再追加）。
 *
 * ★ 不设这个标志就没法区分"新一轮的第一行"与"同一轮的第二行"：
 *   前者要清掉上一轮，后者要接着往上排。
 */
let roundStarted = true;

/**
 * 面板内的按钮发令：先记下"这是一轮新的"（§74 —— 同一块面板里再点一次动作，
 * 正文从基线重来，不把上一轮的回显留着）。
 *
 * ★★ §80 之后这里**只剩这一件事**。原先还有"标记这次发令来自面板"（`issuing`）
 *   和"战斗族命令要关面板"（`CONTEXT_LEAVING_COMMANDS`）两件事，都是为了让
 *   吸收机制知道"什么时候该停"。现在文本自带归属（`warn.context`），
 *   前端不需要知道命令是从哪发的、是打是聊 —— 那两套判据连同它们的词表一起删了。
 *   少一层猜测，就少一处会随新命令 / 新状态漂移的地方。
 */
function panelRun(cmd: string): void {
  roundStarted = false;
  runner(cmd);
}

export function setPanelRunner(fn: (cmd: string) => void): void {
  runner = fn;
}

/**
 * 让**数据面板的自定义内容**发一条命令（技能面板的「装配 / 练习 / 遗忘」用）。
 *
 * ★ 为什么不是把 `runner` 直接塞给 `build` 的第二个参数：`build` 的签名
 *   `(redraw) => HTMLElement` 是 §62 定下的，改签名会连带改测试与调用点；
 *   而"面板里的按钮能发命令"本来就该由**面板**负责 —— 物件面板的
 *   `cmdRow` / `showWarn` 早就是这条路（它们直接用同一个 `runner`）。
 *   于是这里只把那条路开一个口，不新增第二种接线方式。
 */
export function runPanelCommand(cmd: string): void {
  panelRun(cmd);
}

/**
 * 打开面板。
 *
 * @param title   面板标题（房名 / 物件名 / 面板名）
 * @param lines   正文行（会被当成服务端文本渲染：颜色标签能用，`<script>` 只是文字）
 * @param cmds    面板底部的命令按钮
 * @param id      面板身份（`item` 帧的 `id`）：`warn` 帧的 `context` 与它相等才投进来。
 *                缺省 = 这块面板**不接受**任何服务端回显，只显示 `lines`。
 */
export function openPanel(
  title: string,
  lines: readonly string[],
  cmds: readonly CmdItem[] = [],
  id = '',
): void {
  rows = [...lines];
  // ★ 基线：这一轮（以及之后每一轮）都从这几行开始，不累积历史（见 `baseRows`）
  baseRows = [...lines];
  roundStarted = true;
  panelCmds = [...cmds];
  // ★ 只有传了 id 的物件面板才"接得上"服务端回显（§80）。空 id = 谁都不认，
  //   于是这块面板只显示 `lines`，任何 `warn` 都进消息流 —— 安全的一侧。
  panelId = id === '' ? null : id;
  // ★ 回到**物件面板**形态：自定义内容清空、遮罩这一档恢复（拖拽/点的都是它）
  custom = null;
  dataName = null;
  setIcon(DEFAULT_ICON);
  releaseDataPanelReserve();
  need('dialog').classList.remove('is-data');
  need('dlgTitle').textContent = title;
  need('dialog').hidden = false;
  need('mask').hidden = false;
  render();
}

/** 当前数据面板的**协议名**（`score` / 将来的 `pack`…）；`null` = 没开数据面板 */
let dataName: string | null = null;

/**
 * 数据面板的图标（wushen 每个面板自己设：`Dialog.icon(css)`，`score.js:47` 是 `user`）。
 *
 * ★ 图标是"这块在讲什么"的第一眼线索：属性面板顶着通用方块，跟顶着地图针
 *   （§61 修掉的那个）是同一类错 —— 只是程度轻些。**只在认识的协议名上有值**；
 *   认不出的名字退回通用方块，不假装知道。
 */
const DATA_ICONS: Readonly<Record<string, string>> = {
  score: 'glyphicon-user',
};

/** 通用面板图标（`.dialog` 的缺省档，`openPanel` 恢复它） */
const DEFAULT_ICON = 'glyphicon-th-large';

function setIcon(css: string): void {
  need('dlgIcon').className = `dialog-icon glyphicon ${css}`;
}

/**
 * 打开**数据面板**：结构化快照，**无遮罩**（照 wushen 的 `.dialog`）。
 *
 * @param name  协议里的面板名（`score`）—— 用来判"同一个键再按一次 = 收起"
 * @param title 标题（中文名，不是协议名 —— wushen 也是 `Dialog.title` 给中文）
 * @param build 构建正文的工厂。**每次重画都调一次**，所以它必须是**幂等**的：
 *              不返回同一个节点两次（`appendChild` 会搬走它）。
 *
 * ★★ `redraw` 是**操作型面板的地基**（`_63` 分析，26 册 §63）：
 *   属性面板是纯快照（`score` 帧进来 → 重画一次），但背包/技能要"我点了第 3 件，
 *   现在显示它的详情与动作" —— 那个"选中"是**面板内部状态**，服务端不知道也不该知道。
 *   拿到 `redraw` 就能就地把新状态渲染出来，不必编一个帧往返。
 *   ★ 但**不许在 `build` 同步执行期间调它**（会 clear → 再 build → 再 redraw，
 *   无限递归把浏览器卡死）。正确时机是事件回调里。`render()` 那边有防御。
 *
 * ★★ 没有遮罩是**判据的一部分**，不是样式细节（§62）：
 *   wushen 开属性面板时消息流、聊天预览、工具条**全都还在**，玩家能一边看属性
 *   一边看房间里发生了什么。加了遮罩就变成"看属性 = 暂停游戏"，与它正好相反。
 * ★ 也不把 `#roomPanel` 藏起来：面板的几何就是**盖在它上面**（CSS `.is-data`
 *   按房间区的位置定位），藏掉它会让下面的消息流往上跳一截 —— 开开关关就晃。
 */
export function openDataPanel(
  name: string,
  title: string,
  build: (redraw: () => void) => HTMLElement,
): void {
  rows = [];
  panelCmds = [];
  // ★ 数据面板是**快照**，永远不接受回显（§62）：id 置空 ⇒ `notePanel` 恒返回
  //   `false` ⇒ 服务端文本全部落消息流。不再需要一个 `absorb` 标志来表达这件事。
  panelId = null;
  custom = build;
  dataName = name;
  setIcon(DATA_ICONS[name] ?? DEFAULT_ICON);
  need('dlgTitle').textContent = title;
  need('dialog').classList.add('is-data');
  need('dialog').hidden = false;
  need('mask').hidden = true;
  render();
}

/**
 * 当前开着的数据面板是哪一个（协议名）；没开 / 开的是物件面板 ⇒ `null`。
 *
 * ★ 给工具条判"同一个键再按一次收起"用 —— 那是 wushen `Dialog.show` 的行为
 *   （`if (this.isShow && name == this.curItem) return this.hide();`），
 *   也是手机上最顺手的一条：开和关是同一个键。
 */
export function openDataPanelName(): string | null {
  return dataName;
}

/**
 * 换掉面板底部的按钮（`cmds` 帧：**下一层**可做的动作）。
 *
 * ★ 为什么不是"另开一个面板"或"往消息流推一条命令条"（26 册 §57）：
 *   点「打听」得到的是"接下来能做什么"，它仍属于**同一个物件**的对话上下文。
 *   推进消息流就是真机反馈里那句"人字号客房还在日志区"。
 */
export function setPanelCmds(cmds: readonly CmdItem[]): void {
  panelCmds = [...cmds];
  if (rows !== null) render();
}

/**
 * 服务端声明为「属于 `panelId` 这块面板」的一行文本（§80）。
 *
 * @returns 是否真的写进了面板。`false` = **调用方必须把它交给消息流** ——
 *          面板没开、开的是别块、或这是张数据面板快照。
 *
 * ★★ 返回布尔值是这一版的关键：调用方不再是"面板开着就写这里、否则也写这里"
 *   （两条路都写着，靠标志决定走哪条），而是"投递成功了没"。
 *   没投出去就一定要落在消息流 —— 于是"文本彻底消失"在结构上不可能。
 *
 * ★ 判据只有一条：`panelId` 与 `openPanel` 收到的 id **相等**。
 *   不猜内容、不看命令来源、不看是否在战斗中 ——
 *   那些猜法在 §57 / §74 / §78 各错过一次，见 `panelId` 的说明。
 *
 * ★★ **连续重复同一句不追加**（2026-10-18 真机反馈）：身上没钱时连点
 *   「人字号客房」五次，面板就堆了五行一模一样的「你身上没有那么多的钱…」，
 *   面板一路长高（130px → 214px）。回显是**追加**语义没错，但"同一句贴着同一句"
 *   不是新信息 —— 那是把点击次数画成了行数。
 *   （中间换了别的话之后再来同一句，那是新的一句话，照常追加。）
 */
export function notePanel(panelIdOfText: string, line: string): boolean {
  // 面板没开 / 开的是别块 ⇒ 不接（调用方落消息流）
  if (rows === null || panelId === null || panelIdOfText !== panelId) return false;
  // ★ 数据面板是**快照**，回显不往里塞（§62）：属性面板开着时房间里有人说话，
  //   那句话该留在消息流，塞进属性卡会把数值冲散 —— 而关掉就再也找不回来。
  if (custom !== null) return false;
  // ★★ 新一轮 ⇒ 先退回基线（§74）：面板里再点一次动作，正文从物件描述重来，
  //   不把上一轮的回显留着。累积式追加会让面板"越长越高、内容全是历史"。
  if (!roundStarted) {
    rows = [...baseRows];
    roundStarted = true;
  }
  if (rows[rows.length - 1] === line) return true;
  rows.push(line);
  if (rows.length > MAX_ROWS) rows.splice(0, rows.length - MAX_ROWS);
  render();
  return true;
}

export function closePanel(): void {
  rows = null;
  baseRows = [];
  roundStarted = true;
  panelCmds = [];
  panelId = null;
  custom = null;
  dataName = null;
  setIcon(DEFAULT_ICON);
  releaseDataPanelReserve();
  need('dialog').classList.remove('is-data');
  need('dialog').hidden = true;
  need('mask').hidden = true;
}

export function isPanelOpen(): boolean {
  return !need('dialog').hidden;
}

/**
 * 移除面板里**文本等于** `line` 的那一行（对应 `dialog` 帧的 `remove` 控制字段，F4）。
 *
 * @returns 是否确实移除了 —— 调用方可据此判断"服务端要移除的行不在面板里"
 *
 * ★ 行匹配是**整行相等**：面板行就是服务端给的原文（`renderMarkup` 只影响显示层，
 *   `rows` 里存的是原文），所以这里不需要任何解析。
 */
export function removePanelRow(line: string): boolean {
  if (rows === null) return false;
  const idx = rows.indexOf(line);
  if (idx === -1) return false;
  rows.splice(idx, 1);
  render();
  return true;
}

/**
 * 清空面板里的行，**面板保持开着**（对应 `dialog` 帧的 `clear` 控制字段，F4）。
 * ★ 与 `closePanel()` 的差别是这条判据本身：`clear` 是"内容没了"，`close` 才是"面板收起来"。
 */
export function clearPanelRows(): void {
  if (rows === null) return;
  rows = [];
  render();
}

/** 面板里当前显示了几行（测试与调试用） */
export function panelRows(): readonly string[] {
  return rows ?? [];
}

function render(): void {
  // ★★ 防御：`build` 里**同步**调 `redraw()` 会 clear → 再 build → 再 redraw…
  //   无限递归的后果是浏览器卡死（不是抛错），所以这里静默忽略而不是让它跑起来。
  //   合法时机是事件回调（那时 render 早已返回）。回归见 `tests/web-ui.test.ts`
  //   的"`build` 里同步调 `redraw` 不会递归炸栈"。
  if (rendering) return;
  rendering = true;
  try {
    const body = need('dlgBody');
    // ★ 下带（wushen 的 `.dialog > .dialog-footer`）与正文**并列**：每次重画都要清它，
    //   否则上一轮的命令按钮会留在下带上（正文清了、下带没清 = 残影）。
    const foot = need('dlgFoot');
    clear(foot);
    clear(body);
    if (custom !== null) {
      // 数据面板：正文由构建器给（结构化快照 / 列表），不走"一行一个 `<p>`"那条路。
      // ★ 数据面板**不占下带** —— 它自己的动作按钮（技能面板的「装配/练习」）是
      //   正文的一部分，`custom` 建出来就挂在 `#dlgBody` 里（见 `ui/skills.ts`）。
      //   于是 `#dlgFoot` 空着、由 CSS 的 `:empty` 整条隐藏，不会多出一条空灰带。
      body.appendChild(custom(render));
    } else {
      for (const line of rows ?? []) {
        const p = el('p', 'row');
        renderMarkup(line, p);
        body.appendChild(p);
      }
      // ★ 命令按钮落在**下带**，不再是正文末尾：wushen 的 `.dialog-footer` 里
      //   `.item-commands` 是右浮的一排，正文（`.dialog-content`）滚动时它不动。
      if (panelCmds.length > 0) foot.appendChild(cmdRow(panelCmds));
    }
    // ★ 内容变了 ⇒ 高度变了 ⇒ 位置要重算（面板是**贴着锚点**的，不是固定某处）
    place();
  } finally {
    rendering = false;
  }
}

function cmdRow(cmds: readonly CmdItem[]): HTMLElement {
  const box = el('div', 'item-commands');
  for (const c of cmds) {
    const item = el('span', '', c.name === '' ? c.cmd : c.name);
    item.dataset['cmd'] = c.cmd;
    item.addEventListener('click', () => panelRun(c.cmd));
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
      panelRun(c.cmd);
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
  // ★ 用 `onActivate`（click + Enter/Space）而不是裸 click（L2）：`#dlgClose` 声明了
  //   `role="button" tabindex="0"`，只绑 click 就是"读屏器说它是按钮、键盘按下去没反应"。
  onActivate(need('dlgClose'), closePanel);
  need('mask').addEventListener('click', () => {
    if (isPanelOpen()) closePanel();
  });

  // ★★ 视口变化要**重算几何**（2026-10-18 真机量出来的）：数据面板的
  //   left/width/max-height 是开面板那一刻按房间区矩形写死的 inline style，
  //   窗口一窄（390 → 320）它就比房间区还宽（376 vs 306），右边被裁掉。
  //   物件面板的 `top` 同理（它按"锚点 + 面板高度"算）。
  //   ★ 只在面板开着时重画：关着的时候重画一次既没必要，也会把
  //     `#dlgBody` 清空（虽然下次开还会重建，但那是一次无谓的 DOM 抖动）。
  window.addEventListener('resize', () => {
    if (isPanelOpen()) render();
  });
}

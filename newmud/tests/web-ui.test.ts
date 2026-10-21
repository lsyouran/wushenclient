// @vitest-environment jsdom
/**
 * tests/web-ui.test.ts —— 前端在**真 DOM** 里跑一遍
 * ============================================================================
 * 为什么要有这个文件：前端代码"类型检查过"不等于"能跑"。
 * 这一层用 jsdom 加载真实的 `src/index.html` 结构，把服务端包喂给 handler，
 * 断言**屏幕上出现了什么** —— 这是"可运行"最直接的证据。
 *
 * ★ 本文件钉住的四条**结构性约定**（改 UI 时最容易顺手破坏的）：
 *   ① 房间信息在房间区，**不进消息流**（消息流留给"发生的事"）
 *   ② 游戏界面里**没有常驻输入框**（指令 / 聊天各走一个浮层，挂在 `#app` 之外）
 *   ③ 小地图能**点着走**（点格子发出的是英文方向词，中文只是显示）
 *   ④ **XSS 防线**：服务端回显带 `<script>` 的内容时，DOM 里不得产生脚本节点；
 *      连"颜色标签"也得走解析器而不是 `innerHTML`（`src/ui/markup.ts`）
 *
 * 其余断言：
 *   - 注册表**运行期**覆盖 35 种包（G2 扫源码文本；这里是真加载后数一遍）
 *   - 主要包真的把内容画到了 DOM 上（房间 / 出口 / 物件 / 动作 / 数值 / 聊天 / 面板）
 *   - 工具条每一格都有归属（没有点不动的按钮）
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** 把 src/index.html 的 body 装进当前文档（保留 id 与结构） */
function mountHtml(): void {
  const html = readFileSync(join(ROOT, 'src', 'index.html'), 'utf8');
  const body = /<body>([\s\S]*)<\/body>/.exec(html)?.[1] ?? '';
  // 去掉 <script>（模块加载在 jsdom 里会失败，也不需要：我们直接调 handler）
  document.body.innerHTML = body.replace(/<script[\s\S]*?<\/script>/g, '');
  document.body.insertAdjacentHTML('beforeend', '<div id="probe"></div>');
  expect(document.getElementById('app')).not.toBeNull();
}

/**
 * `src/state.ts` 里那个单例的**真实形状**。
 *
 * ★ 为什么用 `typeof import(...)` 而不是手抄一份字段清单：手抄的那份漏了
 *   `fighting` / `statuses` / `cooldowns`（§78 加「战报回消息流」断言时才撞出来
 *   ⇒ `error TS2339: Property 'fighting' does not exist`）。从源派生之后，
 *   `state.ts` 再加字段，测试这边自动跟上 —— 与闸门那条"清单别手抄"（G16.5 /
 *   G17 / `run-all` 自检）是同一族：第二份清单迟早会漂。
 *
 * ★ `import type` 语义：这里只是**类型位置**的引用，不产生运行期依赖，
 *   与 `beforeAll` 里那个 `await import('../src/state.js')` 各管一段，不冲突。
 */
type AppState = typeof import('../src/state.js')['state'];

let mod: {
  dispatchPacket: (type: string, payload: Record<string, unknown>) => boolean;
  registeredTypes: () => readonly string[];
  SERVER_PACKET_TYPES: readonly string[];
  state: () => AppState;
  resetNodeCache: () => void;
  // room
  bindRoom: (h: {
    run(cmd: string): void;
    pick(id: string, name: string, isPlayer: boolean): void;
  }) => void;
  renderScene: () => void;
  renderActionBar: () => void;
  renderAll: () => void;
  /** 滚轮 → 横向滚动的位移换算（纯函数，抽出来就是为了可单测） */
  wheelScrollDelta: (cur: number, max: number, deltaY: number) => number;
  /** 冷却推进表：某条指令当前还剩百分之多少（`null` = 没在冷却） */
  cooldownRatioOf: (cmd: string) => number | null;
  /** 停掉冷却推进表（换角色 / 回认证屏时清模块级状态） */
  stopCooldownTicker: () => void;
  // map
  bindMap: () => void;
  renderMap: () => void;
  setMapRunner: (fn: (cmd: string) => void) => void;
  mappedDirs: () => readonly string[];
  mapOpen: () => boolean;
  shortRoomName: (name: string) => string;
  cellLabel: (name: string) => string;
  cellMaxChars: number;
  // bars
  bindBars: (h: {
    run(cmd: string): void;
    openCmd(): void;
    openChat(): void;
    hint(text: string): void;
  }) => void;
  barActions: () => readonly string[];
  // input
  bindInputs: (h: { run(cmd: string): void; hint(text: string): void }) => void;
  openCmd: (prefill?: string) => void;
  openChat: () => void;
  closeInputs: () => void;
  cmdOpen: () => boolean;
  chatOpen: () => boolean;
  submitCmd: () => void;
  submitChat: () => void;
  setChatTarget: (name: string | null) => void;
  currentChatTarget: () => string | null;
  setChannel: (ch: string) => void;
  currentChannel: () => string;
  composeChat: (ch: string, who: string | null, text: string) => string | null;
  noteChat: () => void;
  unreadCount: () => number;
  resetInputs: () => void;
  // panel
  bindPanel: () => void;
  openPanel: (
    title: string,
    rows: readonly string[],
    cmds?: readonly { cmd: string; name: string }[],
    /** §80：面板身份（`item.id`），`warn.context` 与它相等才投进来 */
    id?: string,
  ) => void;
  /** §74：面板内的按钮发令（= 新一轮交互，正文从基线重来） */
  runPanelCommand: (cmd: string) => void;
  setPanelRunner: (fn: (cmd: string) => void) => void;
  /**
   * 数据面板（`dialog:<name>` 那一档）。
   * ★ `build` 收一个 `redraw`：面板内部状态变了（背包选中/技能页签）就地重画，
   *   不必等下一次服务端推帧。属性面板不用它（快照），操作型面板全靠它。
   */
  openDataPanel: (
    name: string,
    title: string,
    build: (redraw: () => void) => HTMLElement,
  ) => void;
  closePanel: () => void;
  isPanelOpen: () => boolean;
  panelRows: () => readonly string[];
  /** §80：投递一条面板文本；返回是否投出去了（`false` ⇒ 调用方该落消息流） */
  notePanel: (panelId: string, line: string) => boolean;
  panelTop: (o: {
    readonly anchor: number;
    readonly height: number;
    readonly viewport: number;
    readonly reserve: number;
  }) => number;
  setPanelAnchor: (fn: () => number) => void;
  showWarn: (content: string, cmds: readonly { cmd: string; name: string }[]) => void;
  closeWarn: () => void;
  // status / stream
  renderStatus: () => void;
  showGame: () => void;
  pushLine: (text: string, kind?: string) => void;
  clearStream: () => void;
  bindStream: () => void;
  MAX_LINES: number;
  // auth / screens
  bindAuth: (h: { onSubmit(mode: 'login' | 'register', name: string): void }) => void;
  setAuthTab: (mode: 'login' | 'register') => void;
  currentScreen: () => 'auth' | 'game';
  validateName: (name: string) => string | null;
  serverUrl: () => string;
  resetSkillsPanel: () => void;
  skillsState: () => { tab: 'base' | 'special'; selected: string | null; confirming: string | null };
};

/** 委托回调最终会走到这里（测试用它观察"点了之后发什么指令"） */
const fired: string[] = [];
/** 点房间里的人或物时收到的东西 */
const picked: Array<{ id: string; name: string; isPlayer: boolean }> = [];
/** 该落到消息流的提示 */
const hints: string[] = [];
/** 认证界面提交时收到的东西 */
const submitted: Array<{ mode: string; name: string }> = [];

beforeAll(async () => {
  mountHtml();
  const dom = await import('../src/ui/dom.js');
  const process = await import('../src/process/index.js');
  const protocol = await import('../shared/protocol.js');
  const appState = await import('../src/state.js');
  const room = await import('../src/ui/room.js');
  const map = await import('../src/ui/map.js');
  const bars = await import('../src/ui/bars.js');
  const input = await import('../src/ui/input.js');
  const panel = await import('../src/ui/panel.js');
  const status = await import('../src/ui/status.js');
  const stream = await import('../src/ui/stream.js');
  const auth = await import('../src/ui/auth.js');
  const screens = await import('../src/ui/screens.js');
  const skills = await import('../src/ui/skills.js');

  dom.resetNodeCache();

  mod = {
    dispatchPacket: process.dispatchPacket,
    registeredTypes: process.registeredTypes,
    SERVER_PACKET_TYPES: protocol.SERVER_PACKET_TYPES,
    state: () => appState.state,
    resetNodeCache: dom.resetNodeCache,
    bindRoom: room.bindRoom,
    renderScene: room.renderScene,
    renderActionBar: room.renderActionBar,
    renderAll: room.renderAll,
    wheelScrollDelta: room.wheelScrollDelta,
    cooldownRatioOf: room.cooldownRatioOf,
    stopCooldownTicker: room.stopCooldownTicker,
    bindMap: map.bindMap,
    renderMap: map.renderMap,
    setMapRunner: map.setMapRunner,
    mappedDirs: map.mappedDirs,
    mapOpen: map.mapOpen,
    shortRoomName: map.shortRoomName,
    cellLabel: map.cellLabel,
    cellMaxChars: map.cellMaxChars,
    bindBars: bars.bindBars,
    barActions: bars.barActions,
    bindInputs: input.bindInputs,
    openCmd: input.openCmd,
    openChat: input.openChat,
    closeInputs: input.closeInputs,
    cmdOpen: input.cmdOpen,
    chatOpen: input.chatOpen,
    submitCmd: input.submitCmd,
    submitChat: input.submitChat,
    setChatTarget: input.setChatTarget,
    currentChatTarget: input.currentChatTarget,
    setChannel: input.setChannel,
    currentChannel: input.currentChannel,
    composeChat: input.composeChat,
    noteChat: input.noteChat,
    unreadCount: input.unreadCount,
    resetInputs: input.resetInputs,
    bindPanel: panel.bindPanel,
    openPanel: panel.openPanel,
    runPanelCommand: panel.runPanelCommand,
    setPanelRunner: panel.setPanelRunner,
    openDataPanel: panel.openDataPanel,
    closePanel: panel.closePanel,
    isPanelOpen: panel.isPanelOpen,
    panelRows: panel.panelRows,
    notePanel: panel.notePanel,
    panelTop: panel.panelTop,
    setPanelAnchor: panel.setPanelAnchor,
    showWarn: panel.showWarn,
    closeWarn: panel.closeWarn,
    renderStatus: status.renderStatus,
    showGame: status.showGame,
    pushLine: stream.pushLine as (text: string, kind?: string) => void,
    clearStream: stream.clearStream,
    bindStream: stream.bindStream,
    MAX_LINES: stream.MAX_LINES,
    bindAuth: auth.bindAuth,
    setAuthTab: auth.setAuthTab,
    currentScreen: screens.currentScreen,
    validateName: auth.validateName,
    serverUrl: auth.serverUrl,
    // ★ 技能面板的页签 / 选中态是**模块变量**（`ui/skills.ts`）：测试之间不清就串味 ——
    //   上一个用例选中的技能会成为下一个用例的既成事实，于是"点一行"变成了"取消选中"。
    //   生产代码里清它的地方是 `main.ts#backToAuth()`（换角色必须清）。
    resetSkillsPanel: skills.resetSkillsPanel,
    skillsState: skills.skillsState,
  };

  // ── 模拟 main.ts 的接线（**只绑一次**；渲染与绑定分离正是为此）──
  const run = (cmd: string): void => {
    fired.push(cmd);
  };
  mod.bindRoom({
    run,
    pick: (id, name, isPlayer) => {
      picked.push({ id, name, isPlayer });
      if (isPlayer) mod.setChatTarget(name);
      // ★ 照 wushen `process.js:187`：点实体发 `select <id>`，不是把房间描述再打一遍
      fired.push(`select ${id}`);
    },
  });
  mod.setMapRunner(run);
  mod.bindMap();
  mod.bindBars({
    run,
    openCmd: () => mod.openCmd(),
    openChat: () => mod.openChat(),
    hint: (text) => hints.push(text),
  });
  mod.bindInputs({ run, hint: (text) => hints.push(text) });
  mod.bindPanel();
  mod.bindStream();
  const { setPanelRunner } = await import('../src/ui/panel.js');
  setPanelRunner(run);
  // ★ 这里原先有一句 `setCmdRunner(run)` —— 随 `<CMD>` 标签一并删除（审查 S1）：
  //   服务端自由文本里的按钮不再存在，可点指令只走 `CmdItem`。
  const { setStreamRunner } = await import('../src/ui/stream.js');
  setStreamRunner(run);
  mod.bindAuth({ onSubmit: (mode, name) => submitted.push({ mode, name }) });
});

function click(node: Element | null | undefined): void {
  node?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
}

function inputOf(id: string): HTMLInputElement {
  const node = document.getElementById(id);
  if (node === null) throw new Error(`缺少输入框 #${id}`);
  return node as HTMLInputElement;
}

function lastLine(): Element | null {
  const all = document.querySelectorAll('#output .ln');
  return all[all.length - 1] ?? null;
}

// ---------------------------------------------------------------------------
// 协议覆盖
// ---------------------------------------------------------------------------

describe('包处理注册表', () => {
  it('★ 35 种服务端包**每一种**都有 handler（G2 在运行期的那一半）', () => {
    const registered = new Set(mod.registeredTypes());
    expect(registered.size).toBe(mod.SERVER_PACKET_TYPES.length);
  });

  it('未注册的类型返回 false（协议漂移要能被发现，而不是静默丢弃）', () => {
    expect(mod.dispatchPacket('no-such-packet', {})).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 房间区
// ---------------------------------------------------------------------------

describe('房间区（wushen 的 .content-room）', () => {
  it('room 包 → 房名与描述进房间区，**不进消息流**', () => {
    mod.clearStream();
    mod.dispatchPacket('room', {
      path: 'yz/guangchang',
      name: '中央广场',
      desc: '人来人往。',
      commands: [{ cmd: 'look', name: '看' }],
    });
    expect(document.getElementById('roomName')?.textContent).toBe('中央广场');
    expect(document.getElementById('roomDesc')?.textContent).toBe('人来人往。');
    expect(document.getElementById('output')?.textContent ?? '').not.toContain('中央广场');
  });

  it('exits 包 → 出口可点；点它发出的是**英文方向词**（中文只是显示）', () => {
    fired.length = 0;
    mod.dispatchPacket('exits', { items: { north: '北大街', east: '东市' } });
    const nodes = Array.from(document.querySelectorAll('#roomExits .exits-item'));
    expect(nodes).toHaveLength(2);
    expect(nodes[0]?.getAttribute('data-dir')).toBe('north');
    expect(nodes[0]?.textContent).toBe('北');

    click(nodes[0]);
    expect(fired).toEqual(['north']);
  });

  it('★ 出口行只写**方向**，不写房名（房名归九宫格；wushen 的 `exits_dir==1` 文本分支就是这样）', () => {
    mod.dispatchPacket('exits', { items: { north: '扬州城-北大街', east: '东市' } });
    const row = document.getElementById('roomExits')?.textContent ?? '';
    expect(row).toContain('这里明显的出口有：');
    expect(row).toContain('北');
    expect(row).toContain('东');
    // 房名一个字都不该出现在这一行：地图上已经有了，两处写法还不一样（带「扬州城-」前缀）
    expect(row).not.toContain('北大街');
    expect(row).not.toContain('东市');
    // 房名没丢：悬停能看到；点下去发出的仍然是方向词
    const north = document.querySelector('#roomExits .exits-item[data-dir="north"]');
    expect(north?.getAttribute('title')).toContain('扬州城-北大街');
  });

  it('★ 多个出口用「、」和「 和 」连接（照 wushen 文本分支的拼法）', () => {
    mod.dispatchPacket('exits', { items: { north: 'A', south: 'B', east: 'C' } });
    expect(document.getElementById('roomExits')?.textContent).toBe('这里明显的出口有：北、南 和 东');
  });

  it('★ 8 个方向时出口行仍然只有一行（房名不进这一行，就不会换行断在半截房名上）', () => {
    mod.dispatchPacket('exits', {
      items: {
        north: '扬州城-北大街',
        south: '扬州城-南大街',
        east: '扬州城-东大街',
        west: '扬州城-西大街',
        northup: '客栈二层',
        southdown: '地窖',
        enter: '当铺',
        out: '后门',
      },
    });
    const nodes = Array.from(document.querySelectorAll('#roomExits .exits-item'));
    expect(nodes).toHaveLength(8);
    for (const n of nodes) expect([...(n.textContent ?? '')].length).toBeLessThanOrEqual(2);
  });

  it('没有出口时照实说"没有明显的出口"，而不是留一片空白', () => {
    mod.dispatchPacket('exits', { items: {} });
    expect(document.getElementById('roomExits')?.textContent).toContain('没有明显的出口');
  });

  /**
   * ★★ 换房间要有**反馈**（2026-10-18 真机走查）。
   *
   * 走查证据：从「中央广场」走到「北大街」，`#roomName` 变了、`#output` **一行没加**
   * （`linesBefore === linesAfter`）—— 消息流完全不动。只有「北大街」恰好写了
   * `on_enter` 钩子的房间才会说一句，其余房间是静默切换。
   *
   * wushen 不会这样：`Process.room`（`src/process.js:297-306`）在默认档
   * （`Setting.keep_msg == 0`）**清屏**，`keep_msg` 档则
   * `ReceiveMessage("你来到了" + room.name + "。")`。两种档位都保证
   * "换了地方"这件事在屏幕上有个交代。
   *
   * 本项目保留历史（不清屏），于是照 `keep_msg` 档：一条分隔线 + 一句「你来到了 X。」。
   * ★ 这不违反「房间信息在房间区」—— 描述文本仍然只在房间区，进消息流的是一**事件**。
   * ★ 首次进房间（`state.room === null`）**不播报**：那条路径已经有登录欢迎语和
   *   房间自己的 `on_enter`，再来一句就是同一件事说两遍。
   */
  it('★★ 换房间：消息流得到一条分隔线 + 「你来到了 X。」（wushen 的 keep_msg 档）', () => {
    mod.clearStream();
    mod.dispatchPacket('room', {
      path: 'yz/guangchang',
      name: '中央广场',
      desc: '人来人往。',
      commands: [],
    });
    const out = document.getElementById('output');
    // 首次进房间不播报（交给登录欢迎语 / 房间 on_enter）
    expect(out?.textContent ?? '').not.toContain('你来到了');

    mod.dispatchPacket('room', {
      path: 'yz/beidajie',
      name: '北大街',
      desc: '车马不绝。',
      commands: [],
    });
    expect(out?.textContent ?? '').toContain('你来到了北大街。');
    // ★★ 分隔线已删（2026-10-20 §74）：wushen 的 `Process.room` 两档都没有这个元素，
    //   而"换房间"只播一句"你来到了X。"已经足够断开上下文。真机观感是
    //   "每进一个房间就多一块日志区、中间有道横线"。
    //   ⚠️ 这条断言是**反向**的（要求不存在）—— 若有人把 `pushRule` 加回来，它会红。
    expect(out?.querySelectorAll('.rule').length).toBe(0);
    // 房间**描述**仍不进消息流（这一条是 `room` 包的老约定，不能顺手破掉）
    expect(out?.textContent ?? '').not.toContain('车马不绝');

    // 同一房间再推一次 `room` 帧（服务端对账会重推）⇒ 不重复播报
    mod.dispatchPacket('room', {
      path: 'yz/beidajie',
      name: '北大街',
      desc: '车马不绝。',
      commands: [],
    });
    expect((out?.textContent ?? '').match(/你来到了/g)?.length).toBe(1);
  });

  it('items 包 → 列出人与物（玩家带 .pl 档位）；点它 = 看详情', () => {
    fired.length = 0;
    picked.length = 0;
    mod.dispatchPacket('items', {
      items: [
        { id: 'aaa', name: '小二', p: 1 },
        { id: 'bbb', name: '长剑' },
      ],
    });
    const nodes = Array.from(document.querySelectorAll('#roomItems .room-item'));
    expect(nodes).toHaveLength(2);
    expect(nodes[0]?.classList.contains('pl')).toBe(true);

    click(nodes[1]);
    expect(picked).toEqual([{ id: 'bbb', name: '长剑', isPlayer: false }]);
    // ★ 发的是 `select`（wushen 的 `SendCommand("select " + id)`），不是 `look`
    expect(fired).toEqual(['select bbb']);
  });

  it('带气血的物件画出血条（wushen 的 .progress）', () => {
    mod.dispatchPacket('items', { items: [{ id: 'n1', name: '野狼', hp: 30, max_hp: 60 }] });
    const bar = document.querySelector('#roomItems .room-item .progress.hp>.bar') as HTMLElement | null;
    expect(bar?.style.width).toBe('50%');
  });

  /**
   * ★ 反方向也钉住：**没有气血的物件不画条**。
   *
   * 上面那条只断言了"有 `max_hp` ⇒ 有条"。**实测**把 `room.ts` 的守卫改成 `if (true)`
   * （= 整段删掉），上面那条**照样绿** —— 那就成了只会亮不会灭的灯。
   * 用户曾据此怀疑"物品怎么会有血条"，靠单测答不上来（两侧单测各自喂自己的载荷，各自都绿）。
   * 这里补上判据，把"物品无条"变成可机检的。
   *
   * 判据对齐 wushen `src/process.js:269` 的 `if (item.max_hp)`、`os/room/room.js:123`
   * 的 `if (item.appdend_status)`（`appdend_status` 只定义在 `CHARACTER.prototype`）。
   */
  it('★ 没有气血的物件**不画**条 —— 地面物品不该有血条（wushen `if (item.max_hp)` 的反面）', () => {
    mod.dispatchPacket('items', {
      items: [
        { id: 'i1', name: '丹药' },
        { id: 'n1', name: '野狼', hp: 30, max_hp: 60 },
      ],
    });
    const rows = Array.from(document.querySelectorAll('#roomItems .room-item'));
    const item = rows.find((r) => r.getAttribute('data-id') === 'i1');
    const npc = rows.find((r) => r.getAttribute('data-id') === 'n1');

    // ★ 对照组：同一次渲染里**带**气血的那条必须画出条。
    //   没有它，"丹药没有条"也可能只是整块渲染坏了（那样上面的正方向用例才会红，
    //   这里就成了假绿）—— 有对照组，这个用例才真的有区分力。
    expect(npc?.querySelector('.progress.hp'), '带气血的条目没画条 ⇒ 本用例没有区分力').not.toBeNull();

    expect(item?.querySelector('.item-status'), '没有 max_hp 却画了 .item-status 容器').toBeNull();
    expect(item?.querySelectorAll('.progress')).toHaveLength(0);
    // 行里只剩名字一个子元素（与 wushen 的 `create_roomitem` 同形：无 max_hp 就不 push 状态块）
    expect(item?.childElementCount).toBe(1);
  });

  it('★ 列表**重建之后**委托仍然有效（逐节点绑就得重新绑一遍）', () => {
    fired.length = 0;
    mod.dispatchPacket('items', { items: [{ id: 'p3', name: '药丸' }, { id: 'p4', name: '金创药' }] });
    click(document.querySelector('#roomItems .room-item[data-id="p4"]'));
    expect(fired).toEqual(['select p4']);
  });

  it('itemadd / itemremove 增量维护房间列表', () => {
    mod.dispatchPacket('items', { items: [{ id: 'a1', name: '阿飞', p: 1 }] });
    mod.dispatchPacket('itemadd', { id: 'a2', name: '小贩' });
    expect(Array.from(document.querySelectorAll('#roomItems .room-item')).map((n) => n.getAttribute('data-id'))).toEqual([
      'a1',
      'a2',
    ]);
    mod.dispatchPacket('itemremove', { id: 'a1' });
    expect(Array.from(document.querySelectorAll('#roomItems .room-item')).map((n) => n.getAttribute('data-id'))).toEqual([
      'a2',
    ]);
  });

  it('★ 物件的内力细条画得出来（协议声明了 mp/max_mp，解析层不许把它丢掉）', () => {
    mod.dispatchPacket('items', {
      items: [{ id: 'm1', name: '道士', hp: 30, max_hp: 60, mp: 10, max_mp: 40 }],
    });
    const mp = document.querySelector('#roomItems .room-item .progress.mp>.bar') as HTMLElement | null;
    expect(mp, '内力条没画出来 —— mp/max_mp 在解析层被丢了？').not.toBeNull();
    expect(mp?.style.width).toBe('25%');
  });

  it('★ `itemadd` 带气血时同样画血条（增量加入的物件不能少一条）', () => {
    mod.dispatchPacket('items', { items: [] });
    mod.dispatchPacket('itemadd', { id: 'n9', name: '山贼', hp: 15, max_hp: 60 });
    const bar = document.querySelector('#roomItems .room-item[data-id="n9"] .progress.hp>.bar') as HTMLElement | null;
    expect(bar, 'itemadd 把 hp/max_hp 丢了').not.toBeNull();
    expect(bar?.style.width).toBe('25%');
  });

  it('★ 血条**逐值照抄** wushen 的 `.progress`（这是"抄 wushen"的契约，不是审美偏好）', () => {
    const css = readFileSync(join(ROOT, 'src', 'style.css'), 'utf8');
    // wushen `src/styles/main.css:174-183`
    expect(declValue(css, '.progress', 'border')).toBe('1px solid #343434');
    expect(declValue(css, '.progress', 'display')).toBe('block');
    expect(declValue(css, '.progress', 'height')).toBe('0.3em');
    expect(declValue(css, '.progress', 'width')).toBe('6.25em');
    expect(declValue(css, '.progress', 'position')).toBe('relative');
    expect(declValue(css, '.progress', 'margin-top')).toBe('2px');
    // ★ wushen 显式写 content-box：`0.3em` 是**内容高**，加 1px 边后总高 6.8px。
    //   本仓库全局是 border-box，漏了这条总高只剩 4.8px —— 条子肉眼变细一档。
    expect(declValue(css, '.progress', 'box-sizing')).toBe('content-box');

    // wushen `main.css:189-193`：`.progress-bar` = 这里的 `.bar`（同一个东西，只是改了名）
    expect(declValue(css, '.progress>.bar', 'height')).toBe('100%');
    expect(declValue(css, '.progress>.bar', 'border')).toBe('1px solid transparent');
    // ★ `float` 原先是 `right`（wushen 的观感特征：条子钉在右边，掉血时长出来的
    //   是**左边**的空档）。⇒ 2026-10-18 真机反馈：玩家读成"血条只有一半、
    //   还跑到右边去了"，明确说不对（26 册 §60）。现改成**从左往右**填充
    //   （与状态条 `.fill` 同向）—— 这是**登记在册的刻意差别**，不是"照抄 wushen"
    //   的反例：本用例其余七项（边 / 高 / 宽 / 定位 / 边距 / 盒模型 / 内缩 1px）
    //   仍逐值照抄 wushen。
    expect(declValue(css, '.progress>.bar', 'float')).toBe('left');

    // wushen `main.css:161-172`：暗红 / 暗蓝 + 1s 宽度过渡（只 hp 有过渡，mp 没有）
    expect(declValue(css, ':root', '--hp')).toBe('darkred');
    expect(declValue(css, ':root', '--mp')).toBe('darkblue');
    expect(declValue(css, '.progress.hp>.bar', 'background-color')).toBe('var(--hp)');
    expect(declValue(css, '.progress.mp>.bar', 'background-color')).toBe('var(--mp)');
    expect(declValue(css, '.progress.hp>.bar', 'transition-duration')).toBe('1s');
    expect(declValue(css, '.progress.hp>.bar', 'transition-property')).toBe('width');
    expect(declValue(css, '.progress.hp>.bar', 'transition-timing-function')).toBe('ease-out');
  });

  it('★ 两条条子是**上下两行**、贴右边缘（并排是我自己发明的写法，窄屏要吃掉 160px）', () => {
    const css = readFileSync(join(ROOT, 'src', 'style.css'), 'utf8');
    // wushen `main.css:440-443`：右浮 + inline-block，两条 `display:block` 的
    // `.progress` 自然上下堆叠 → 横占 6.25em + 2px 边 ≈ 102px
    expect(declValue(css, '.room-item>.item-status', 'float')).toBe('right');
    expect(declValue(css, '.room-item>.item-status', 'display')).toBe('inline-block');
    // 并排靠 `inline-flex` + `gap` 撑开 —— 那是自己加的，wushen 没有
    expect(
      /\.room-item\s*>\s*\.item-status\s*\{[^}]*\b(gap|inline-flex)\b/s.test(
        css.replace(/\/\*[\s\S]*?\*\//g, ''),
      ),
      '.item-status 又变成并排（inline-flex/gap）了',
    ).toBe(false);
  });

  it('★ 名字的 2em 缩进在 `.item-name` 上、不在行的 padding 上（差别是条子贴不贴右边缘）', () => {
    const css = readFileSync(join(ROOT, 'src', 'style.css'), 'utf8');
    // wushen `main.css:429-432`
    expect(declValue(css, '.room-item>.item-name', 'margin-left')).toBe('2em');
    // 行有 padding-left 时，右浮的 `.item-status` 被一起推进来 2em，条子离右缘空 32px
    const body = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const row = /\.room-item\s*\{([^}]*)\}/s.exec(body)?.[1] ?? '';
    expect(/padding-left/i.test(row), `.room-item 又加了 padding-left：${row}`).toBe(false);
  });

  it('actions 包 → 动作栏；方向动作**不进**动作栏（出口与小地图各有一份了）', () => {
    fired.length = 0;
    // ★ 先把房间那份清掉：`#verbs` 是 `state.room.commands + state.actions` 的
    //   **合成结果**（见下文「动作栏是单点合成」），而本用例要单独验的只是
    //   "`actions` 包怎么落" + "方向动作被滤掉"。不先清，前面某个 `room` 帧
    //   留下的命令（`room` 包是真会带 `commands` 的）会混进这条精确断言。
    mod.dispatchPacket('room', { path: 'yz/nowhere', name: '空房间', desc: '', commands: [] });
    mod.dispatchPacket('actions', {
      items: [{ cmd: 'north', name: '往北走' }, { cmd: 'dazuo', name: '打坐' }],
    });
    const cmds = Array.from(document.querySelectorAll('#verbs .act-item')).map((n) =>
      n.getAttribute('data-cmd'),
    );
    expect(cmds).toEqual(['dazuo']);
    click(document.querySelector('#verbs .act-item'));
    expect(fired).toEqual(['dazuo']);
  });

  it('perform 包 → 招式进 .combat-commands（与房间动作分成两栏）', () => {
    mod.dispatchPacket('perform', { items: [{ cmd: 'perform sword', name: '剑法' }] });
    const pfms = Array.from(document.querySelectorAll('#pfms .pfm-item')).map((n) =>
      n.getAttribute('data-cmd'),
    );
    expect(pfms).toEqual(['perform sword']);
  });

  it('★★ item 包 → 开**物件面板**（描述 + 按钮），消息流**一行不增**（26 册 §57 订正）', () => {
    mod.clearStream();
    mod.closePanel();
    const before = document.querySelectorAll('#output > *').length;
    mod.dispatchPacket('item', { id: 'x', name: '铁剑', desc: '一把铁剑。', commands: [{ cmd: 'get x', name: '拿起' }] });

    // ★ 旧版本这条断言写的是 wushen 的相反结论（"描述与命令条都进消息流、不开面板"）。
    //   真机反馈证明那条移植是错的：点 NPC 之后描述、动作按钮、下一层动作
    //   层层叠进日志区，日志成了操作记录本。现在改开面板，日志一行不增。
    expect(mod.isPanelOpen()).toBe(true);
    expect(document.getElementById('dlgTitle')?.textContent).toBe('铁剑');
    expect(document.getElementById('dlgBody')?.textContent).toContain('一把铁剑。');
    expect(document.querySelectorAll('#output > *')).toHaveLength(before);

    // ★ 命令按钮在**下带**（`#dlgFoot` = wushen `.dialog-footer`），不在正文 `#dlgBody` 里
    const btn = document.querySelector('#dlgFoot .item-commands [data-cmd]');
    expect(btn?.getAttribute('data-cmd')).toBe('get x');
    fired.length = 0;
    click(btn);
    expect(fired).toEqual(['get x']);
  });
});

// ---------------------------------------------------------------------------
// 消息流与数值
// ---------------------------------------------------------------------------

describe('消息流（wushen 的 .content-message）', () => {
  it('warn 包（服务端文本主通道）→ 追加一行', () => {
    mod.clearStream();
    // ★ 前置把面板关掉：物件面板会**吸收**播报（26 册 §57），留着它这条就测不到消息流
    mod.closePanel();
    mod.dispatchPacket('warn', { content: '你看到一只野狼。' });
    expect(document.querySelectorAll('#output .ln')).toHaveLength(1);
    expect(document.getElementById('output')?.textContent).toContain('你看到一只野狼。');
  });

  it('★★ 物件面板开着 + 帧上声明了 `context` ⇒ warn **只进面板**，消息流不加行', () => {
    mod.clearStream();
    mod.dispatchPacket('item', { id: 'n', name: '店小二', desc: '一个店小二。', commands: [] });
    // ★ `context` = 刚才 `item` 帧给的 id（服务端声明"这句话属于这块面板"）
    mod.dispatchPacket('warn', {
      content: '店小二陪笑道：住店要1000文钱，客官。',
      context: 'n',
    });

    expect(document.querySelectorAll('#output .ln')).toHaveLength(0);
    expect(document.getElementById('dlgBody')?.textContent).toContain('住店要1000文钱');
  });

  it('★★ 物件面板开着但帧上**没有** `context` ⇒ 进消息流，面板不动（安全默认）', () => {
    // ★ 与上一条**只差一个字段**。这条钉住的是"面板开着 ≠ 面板吸收"：
    //   §57 起的 `absorb` 机制就是"开着就吸"，§78 那个真机 bug 正是它的直接后果。
    mod.clearStream();
    mod.dispatchPacket('item', { id: 'n', name: '店小二', desc: '一个店小二。', commands: [] });
    mod.dispatchPacket('warn', { content: '店小二陪笑道：住店要1000文钱，客官。' });

    expect(document.getElementById('output')?.textContent).toContain('住店要1000文钱');
    expect(document.getElementById('dlgBody')?.textContent).not.toContain('住店要1000文钱');
    mod.closePanel();
  });

  it('★ 数据面板（`dialog` 帧）**不**接回显：房间广播只进消息流', () => {
    mod.clearStream();
    mod.closePanel();
    mod.dispatchPacket('dialog', { dialog: '属性', hp: 100 });
    mod.dispatchPacket('warn', { content: '有人在你背后走过。' });

    expect(document.getElementById('output')?.textContent).toContain('有人在你背后走过。');
    // ★ §80 推翻了 §74 的"面板是附加视图、同一句两边都写"：落点二选一，
    //   没有 `context` 就只有消息流这一份（数据面板是快照，更不该被播报冲淡）。
    expect(document.getElementById('dlgBody')?.textContent).not.toContain('有人在你背后走过。');
  });

  it('★ 带 cmds 的 warn → 弹提示框，不重复进消息流（那种是要玩家拿主意的）', () => {
    mod.clearStream();
    mod.dispatchPacket('warn', { content: '确定要买吗？', cmds: [{ cmd: 'buy', name: '买' }] });
    expect(document.querySelectorAll('#output .ln')).toHaveLength(0);
    expect(document.getElementById('warnBox')?.hidden).toBe(false);

    fired.length = 0;
    click(document.querySelector('#warnCmds span'));
    expect(fired).toEqual(['buy']);
    expect(document.getElementById('warnBox')?.hidden).toBe(true);
  });

  it('★ 消息流有上限（wushen 也回收、按页；此处是更细的逐行口径，见 26 册 §31.6）', () => {
    mod.clearStream();
    for (let i = 0; i < mod.MAX_LINES + 50; i += 1) mod.pushLine(`第 ${String(i)} 行`);
    expect(document.querySelectorAll('#output .ln').length).toBe(mod.MAX_LINES);
    // 丢的是最旧的
    expect(document.getElementById('output')?.textContent ?? '').not.toContain('第 0 行');
    mod.clearStream();
  });

  it('sc 包 → 状态条的气血 / 内力（条宽 + 数字）', () => {
    mod.dispatchPacket('sc', { hp: 30, max_hp: 60, mp: 45, max_mp: 90 });
    expect(document.getElementById('hpTx')?.textContent).toBe('30/60');
    expect(document.getElementById('mpTx')?.textContent).toBe('45/90');
    expect((document.getElementById('hpFill') as HTMLElement).style.width).toBe('50%');
  });

  it('★ 上限为 0 时显示 `—`（不是 0/0 —— 那会被读成"血空了"）', () => {
    mod.dispatchPacket('sc', { hp: 30, max_hp: 0 });
    expect(document.getElementById('hpTx')?.textContent).toBe('—');
    expect((document.getElementById('hpFill') as HTMLElement).style.width).toBe('0%');
  });

  it('msg 包 → 按频道着色的聊天行 + 预览区 + 未读徽标', () => {
    mod.clearStream();
    mod.resetInputs();
    // `say` 已改走房间广播（26 册 §24），能到这一档的只剩跨房间频道
    mod.dispatchPacket('msg', { ch: 'chat', name: '路人甲', content: '在下路过' });
    const line = lastLine();
    expect(line?.classList.contains('chat')).toBe(true);
    expect(line?.classList.contains('wor')).toBe(true);
    expect(line?.querySelector('.who')?.textContent).toBe('路人甲：');
    expect(document.querySelectorAll('#channel .ln')).toHaveLength(1);
    expect(document.getElementById('chatTag')?.hidden).toBe(false);

    // 打开聊天浮层 → 未读清零
    mod.openChat();
    expect(mod.unreadCount()).toBe(0);
    expect(document.getElementById('chatTag')?.hidden).toBe(true);
    mod.closeInputs();
  });

  it('未登记的频道落到 .wor（不静默丢）', () => {
    mod.clearStream();
    mod.dispatchPacket('msg', { ch: 'future-channel', name: 'x', content: '?' });
    expect(lastLine()?.classList.contains('wor')).toBe(true);
  });

  it('★ 聊天正文里的换行也保住（与 `pushLine` 同一条规矩）', () => {
    mod.clearStream();
    mod.dispatchPacket('msg', { ch: 'chat', name: '路人甲', content: '第一句\n第二句' });
    // `pushChat` 原来**也**按 `\n` 拆开逐段渲染 —— 与 `pushLine` 是同一个缺陷，
    // 只是没有 `look` 那种多行来源所以一直没暴露。两处现在都不拆。
    expect(lastLine()?.textContent).toBe('路人甲：第一句\n第二句');
  });

  it('★ 自己发的**频道**消息显示成「你」（名号与登录身份一致时）', () => {
    // roleId 由 login 帧写入 —— 没登录就没有"我"这个概念
    mod.dispatchPacket('login', { id: '阿飞', level: 1 });
    mod.clearStream();
    mod.dispatchPacket('msg', { ch: 'chat', name: mod.state().roleId, content: '在下阿飞' });
    expect(lastLine()?.querySelector('.who')?.textContent).toBe('你：');
  });
});

// ---------------------------------------------------------------------------
// 小地图
// ---------------------------------------------------------------------------

describe('小地图（点着走）', () => {
  it('exits 包 → 每个方向画一个可点格子', () => {
    mod.dispatchPacket('exits', { items: { north: '北大街', east: '东市' } });
    const cells = Array.from(document.querySelectorAll('#mapSvg .ceg'));
    expect(cells.map((c) => c.getAttribute('data-dir'))).toEqual(['north', 'east']);
    // 格子里写**目的地房名**（不是方向）：方向由"格子摆在九宫格的哪个位置"表达，
    // 玩家认的是房间名 —— 见 map.ts 的 shortRoomName。
    expect(cells[0]?.querySelector('.et')?.textContent).toBe('北大街');
    expect(mod.mappedDirs()).toEqual(['north', 'east']);
  });

  // ---- 格子里写什么（wushen 的 CreateExitsMap 写目的地名）----

  it('★ 格子写房名不是方向（方向由位置表达；出口行里只有方向词）', () => {
    mod.dispatchPacket('exits', { items: { north: '客栈', south: '药铺' } });
    expect(document.querySelector('#mapSvg .ceg[data-dir="north"] .et')?.textContent).toBe('客栈');
    expect(document.querySelector('#mapSvg .ceg[data-dir="south"] .et')?.textContent).toBe('药铺');
    // 不该再出现方向字
    expect(document.querySelector('#mapSvg .ceg[data-dir="north"] .et')?.textContent).not.toBe('北');
  });

  it('★ 房名带「城-」前缀时只留末段（wushen 的 `split("-")` 取末位）', () => {
    expect(mod.shortRoomName('扬州城-北大街')).toBe('北大街');
    expect(mod.shortRoomName('扬州城-中央广场')).toBe('中央广场');
    expect(mod.shortRoomName('客栈')).toBe('客栈');
    // 多段只取最后一段
    expect(mod.shortRoomName('中原-洛阳-南门')).toBe('南门');
  });

  it('★ 房名里的括号内容去掉（wushen 的 `replace(/\\(.*?\\)/, "")`）', () => {
    expect(mod.shortRoomName('扬州城-中央广场(集市)')).toBe('中央广场');
    // 全角括号也要认（wushen 只写了半角，中文房间名里全角同样常见）
    expect(mod.shortRoomName('扬州城-赌坊（后巷）')).toBe('赌坊');
    // 截完什么都不剩就退回原名，不能显示成空
    expect(mod.shortRoomName('扬州城-')).toBe('扬州城-');
  });

  it('★ 服务端没给房名时退回方向名（不留空格子）', () => {
    mod.dispatchPacket('exits', { items: { west: '', north: '客栈' } });
    expect(document.querySelector('#mapSvg .ceg[data-dir="west"] .et')?.textContent).toBe('西');
    expect(document.querySelector('#mapSvg .ceg[data-dir="north"] .et')?.textContent).toBe('客栈');
  });

  it('★ 中心格写当前房间名（同样只留末段）', () => {
    mod.dispatchPacket('room', { name: '扬州城-中央广场', desc: 'x', path: 'yz/guangchang' });
    mod.renderMap();
    expect(document.querySelector('#mapSvg .ccg .cm')?.textContent).toBe('中央广场');
  });

  it('★ 所有格子**字号一致**（不随字数变 —— 曾经按字数缩，同屏出现两种大小）', () => {
    mod.dispatchPacket('exits', {
      items: { north: '扬州城-中央广场东侧长廊', east: '客栈', south: '北大街', west: '扬州城-赌坊（后巷）' },
    });
    const sizes = Array.from(document.querySelectorAll('#mapSvg .ceg .et')).map((t) =>
      t.getAttribute('font-size'),
    );
    expect(sizes.length).toBe(4);
    expect(new Set(sizes).size, `格子字号不一致：${sizes.join(' / ')}`).toBe(1);
    // 中心格也是同一个字号（它和出口格是一排格子，不该大小不同）
    expect(document.querySelector('#mapSvg .ccg .cm')?.getAttribute('font-size')).toBe(sizes[0]);
  });

  it('★ 长名字截断成「前几字 + …」，短名字原样（字数是**格子宽度**定死的）', () => {
    mod.dispatchPacket('exits', { items: { north: '扬州城-中央广场东侧长廊', east: '客栈', south: '北大街' } });
    const label = (dir: string): string =>
      document.querySelector(`#mapSvg .ceg[data-dir="${dir}"] .et`)?.textContent ?? '';
    // 短名字不动
    expect(label('east')).toBe('客栈');
    expect(label('south')).toBe('北大街');
    // 长名字：截到上限，且**总字数**（含「…」）正好等于上限 —— 不能比上限还长
    const long = label('north');
    expect(long.endsWith('…')).toBe(true);
    expect(mod.cellLabel('扬州城-中央广场东侧长廊')).toBe(long);
    expect([...long].length, '省略号也要占一格，否则又超出格子').toBe(mod.cellMaxChars);
  });

  it('★ 内容层最长的真房名「扬州城-中央广场」**原样显示、不被截**（上限按它定的）', () => {
    // 上限定小了就会把最常见的 4 字名截成「中央广…」—— 那才是真难看
    expect(mod.cellLabel('扬州城-中央广场')).toBe('中央广场');
    expect([...'中央广场'].length).toBeLessThanOrEqual(mod.cellMaxChars);
    // 3 字的更不用截
    expect(mod.cellLabel('扬州城-北大街')).toBe('北大街');
  });

  it('★ 截断后的文字**仍装得进格子**（字号固定，靠截断保证不越界）', () => {
    mod.dispatchPacket('exits', {
      items: { north: '扬州城-中央广场东侧长廊', east: '中原-洛阳-南门', south: '铁匠铺' },
    });
    for (const cell of Array.from(document.querySelectorAll('#mapSvg .ceg'))) {
      const text = cell.querySelector('.et');
      const rect = cell.querySelector('rect');
      const fs = Number(text?.getAttribute('font-size'));
      const w = Number(rect?.getAttribute('width'));
      const labelText = text?.textContent ?? '';
      // ★ 这两个系数是**真机量出来的**（probe9.mjs 读 `getComputedTextLength`）：
      //   本站字体栈（Microsoft YaHei UI …）下 CJK 恰好 1.00 em/字（6/7/8/9/10 号都量过），
      //   「…」0.815 em、全角标点 1.00 em、半角 `-` 0.434 em。
      //   曾经按 1.15 em 估，是虚高 —— 它让 4 字房名被无谓地缩小。
      const ELL_EM = 0.815;
      const hasEll = labelText.endsWith('…');
      const hanzi = [...labelText].length - (hasEll ? 1 : 0);
      const need = (hanzi + (hasEll ? ELL_EM : 0)) * fs;
      expect(need, `「${labelText}」约 ${String(Math.round(need))} 宽 > 格子 ${String(w)}`).toBeLessThanOrEqual(w);
    }
  });

  it('★ 房名外面包着颜色标签时不出尖括号（wushen 的 `REG` 会把标签转成格子配色）', () => {
    const label = mod.cellLabel('<hik>扬州城-北大街</hik>');
    expect(label).toBe('北大街');
    expect(label.includes('<')).toBe(false);
  });

  it('★ 格子文字**居中**在格子里（不写 text-anchor 就是左对齐在格心 → 右半边溢出）', () => {
    mod.dispatchPacket('exits', { items: { north: '扬州城-中央广场东侧长廊', east: '客栈' } });
    const nodes = Array.from(document.querySelectorAll('#mapSvg .ceg, #mapSvg .ccg'));
    expect(nodes.length).toBeGreaterThan(0);
    for (const g of nodes) {
      const text = g.querySelector('text');
      const rect = g.querySelector('rect');
      // 属性层能查的两件事 —— 真机量宽度要浏览器排布，那是 probe8.mjs 的活
      expect(text?.getAttribute('text-anchor'), '没写 text-anchor，字会往右溢出').toBe('middle');
      const cx = Number(rect?.getAttribute('x')) + Number(rect?.getAttribute('width')) / 2;
      expect(Number(text?.getAttribute('x'))).toBe(cx);
    }
  });

  it('★ 格子字号只有一个来源（CSS 里再写一份，缩字号就是按另一个数在算）', () => {
    const css = readFileSync(join(ROOT, 'src', 'style.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(/\.ceg\s+text\s*\{[^}]*font-size/s.test(css), 'CSS 又给 .ceg text 配了 font-size').toBe(false);
    expect(/\.ccg\s+text\s*\{[^}]*font-size/s.test(css), 'CSS 又给 .ccg text 配了 font-size').toBe(false);
  });

  it('★ 出口项不加下划线（wushen 的 `.exits-item` 只有一条 `color: #FFFF00`）', () => {
    const css = readFileSync(join(ROOT, 'src', 'style.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const rule = /\.exits-item\s*\{([^}]*)\}/s.exec(css);
    expect(rule, '找不到 .exits-item 这条规则').not.toBeNull();
    const body = (rule?.[1] ?? '').replace(/\s+/g, ' ');
    // 虚线下划线是我们自己加的（看着像超链接），wushen 没有这条
    expect(/border(-bottom)?\s*:/i.test(body), `.exits-item 又加了边框/下划线：${body}`).toBe(false);
    // 分隔符由文本（、/ 和）承担，不该再靠 margin 撑
    expect(/margin-right/i.test(body), `.exits-item 又加了 margin-right：${body}`).toBe(false);
    // 颜色要照 wushen 的黄
    expect(/color\s*:\s*var\(--yellow\)/i.test(body), `.exits-item 颜色不是黄：${body}`).toBe(true);
  });

  it('★ 点格子 → 把方向词发出去（这就是"快速移动"）', () => {
    fired.length = 0;
    mod.dispatchPacket('exits', { items: { southeast: '南小巷' } });
    click(document.querySelector('#mapSvg .ceg[data-dir="southeast"]'));
    expect(fired).toEqual(['southeast']);
  });

  it('点地图中心 → 环顾（`look`）', () => {
    fired.length = 0;
    click(document.querySelector('#mapSvg .ccg'));
    expect(fired).toEqual(['look']);
  });

  it('★ 换房间后格子跟着换（否则点上去走的是上一个房间的路）', () => {
    mod.dispatchPacket('exits', { items: { west: '西门' } });
    expect(Array.from(document.querySelectorAll('#mapSvg .ceg')).map((c) => c.getAttribute('data-dir'))).toEqual([
      'west',
    ]);
  });

  it('地图默认收起，点房名旁的「地图」展开', () => {
    expect(mod.mapOpen()).toBe(false);
    click(document.getElementById('mapBtn'));
    expect(mod.mapOpen()).toBe(true);
    click(document.getElementById('mapBtn'));
    expect(mod.mapOpen()).toBe(false);
  });

  // ★ L2（2026-10-16 审查）：`#mapBtn` 同样声明了 `role="button" tabindex="0"`，
  //   却只绑 click —— 键盘不可达。见「面板」组里 `#dlgClose` 的同类判据。
  it('★ 地图开关可用键盘展开 / 收起（role="button" 的可访问性承诺）', () => {
    const btn = document.getElementById('mapBtn');
    expect(btn?.getAttribute('role'), '这条判据只对 role="button" 成立').toBe('button');

    const before = mod.mapOpen();
    btn?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    expect(mod.mapOpen(), '按 Enter 没切换地图').toBe(!before);

    btn?.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }));
    expect(mod.mapOpen(), '按 Space 没切回来').toBe(before);
  });

  // ---- 方向重叠（wushen 用 `north_2` 这类"退化"处理的，不退化就两个格子叠死）----

  /** 读出画在地图上的格子（坐标是 viewBox 单位） */
  function cellBoxes(): Array<{ dir: string; x: number; y: number; w: number; h: number }> {
    return Array.from(document.querySelectorAll('#mapSvg .ceg rect')).map((r) => ({
      dir: r.parentElement?.getAttribute('data-dir') ?? '',
      x: Number(r.getAttribute('x')),
      y: Number(r.getAttribute('y')),
      w: Number(r.getAttribute('width')),
      h: Number(r.getAttribute('height')),
    }));
  }

  /** 地图框（`viewBox` 是 "minX minY w h"） */
  function viewBoxOf(): { x: number; y: number; w: number; h: number } {
    const raw = (document.getElementById('mapSvg')?.getAttribute('viewBox') ?? '').trim().split(/\s+/);
    return { x: Number(raw[0]), y: Number(raw[1]), w: Number(raw[2]), h: Number(raw[3]) };
  }

  // ---- 地图框跟着方向多少收放（wushen 的 `height`/`t` 是算出来的，不写死）----

  it('★ 地图框**跟着方向多少收放**：只有一个方向的房间不该留出三行的高度', () => {
    mod.dispatchPacket('exits', { items: { north: '客栈' } });
    const one = viewBoxOf();
    expect(one.h).toBeGreaterThan(0);
    // ★ 112 = 满三行的高度（行距 39×2 + 格高 26 + 上下留白 4×2）—— 尺寸随
    //   `map.ts` 的 `CANVAS_W` 那组常数走，改了常数这里的数要跟着重算。
    expect(one.h, '只有一个出口时框还是满高 112 —— 全是空的').toBeLessThan(112);

    mod.dispatchPacket('exits', {
      items: { north: '客栈', south: '药铺', east: '东市', west: '西市', northeast: '巷口' },
    });
    const many = viewBoxOf();
    expect(many.h).toBeGreaterThan(one.h);
    expect(many.h).toBeLessThanOrEqual(112);

    // 宽度**不**跟着收：比例恒定，否则换个房间字号就变了（wushen 也是把格子居中摆在
    // 整个容器宽度里，横向留白是原样照抄的）
    expect(one.w).toBe(many.w);
  });

  it('★ 框收紧了也**不许把格子裁掉**：所有格子都在 viewBox 里（含中心格）', () => {
    const combos: Array<Record<string, string>> = [
      { north: 'A' },
      { east: 'B' },
      { north: 'A', south: 'B' },
      { south: 'B', down: 'C' },
      { north: 'A', south: 'B', east: 'C', west: 'D' },
      { north: 'A', south: 'B', east: 'C', west: 'D', northeast: 'E', southwest: 'F' },
      {
        north: 'A',
        south: 'B',
        east: 'C',
        west: 'D',
        northeast: 'E',
        southwest: 'F',
        northwest: 'G',
        southeast: 'H',
        up: 'I',
        down: 'J',
        enter: 'K',
        out: 'L',
      },
    ];
    for (const items of combos) {
      mod.dispatchPacket('exits', { items });
      const vb = viewBoxOf();
      const label = Object.keys(items).join('/');
      const all = Array.from(document.querySelectorAll('#mapSvg .ceg rect, #mapSvg .ccg rect')).map((r) => ({
        x: Number(r.getAttribute('x')),
        y: Number(r.getAttribute('y')),
        w: Number(r.getAttribute('width')),
        h: Number(r.getAttribute('height')),
      }));
      expect(all.length, `${label} 一个格子都没画`).toBeGreaterThan(0);
      for (const b of all) {
        expect(b.x, `${label}：格子左边被裁`).toBeGreaterThanOrEqual(vb.x);
        expect(b.x + b.w, `${label}：格子右边被裁`).toBeLessThanOrEqual(vb.x + vb.w);
        expect(b.y, `${label}：格子上边被裁`).toBeGreaterThanOrEqual(vb.y);
        expect(b.y + b.h, `${label}：格子下边被裁`).toBeLessThanOrEqual(vb.y + vb.h);
      }
    }
  });

  it('★ 只有东西向时，框的高度就是**一行**（不含南北行的空档）', () => {
    mod.dispatchPacket('exits', { items: { east: '东市', west: '西市' } });
    const vb = viewBoxOf();
    // 一行 = 格子高 26 + 上下留白；留白给足 4 也只到 34
    expect(vb.h).toBeLessThanOrEqual(40);
    // 中心格必须完整在框里
    const centre = document.querySelector('#mapSvg .ccg rect');
    expect(Number(centre?.getAttribute('y'))).toBeGreaterThanOrEqual(vb.y);
    expect(Number(centre?.getAttribute('y')) + 26).toBeLessThanOrEqual(vb.y + vb.h);
  });

  it('★ `north` 与 `up` 同时存在 → 两个格子**不重叠**（否则后画的把先画的盖掉）', () => {
    mod.dispatchPacket('exits', { items: { north: '北大街', up: '楼上' } });
    const boxes = cellBoxes();
    const north = boxes.find((b) => b.dir === 'north');
    const up = boxes.find((b) => b.dir === 'up');
    expect(north).toBeDefined();
    expect(up).toBeDefined();
    expect(`${String(up?.x)},${String(up?.y)}`).not.toBe(`${String(north?.x)},${String(north?.y)}`);
  });

  it('★ `south` 与 `down` 同时存在 → 两个格子**不重叠**', () => {
    mod.dispatchPacket('exits', { items: { south: '南门', down: '地窖' } });
    const boxes = cellBoxes();
    const south = boxes.find((b) => b.dir === 'south');
    const down = boxes.find((b) => b.dir === 'down');
    expect(south).toBeDefined();
    expect(down).toBeDefined();
    expect(`${String(down?.x)},${String(down?.y)}`).not.toBe(`${String(south?.x)},${String(south?.y)}`);
  });

  it('★ 带上下标的方向（`northup` 等 8 个）**能画进地图**，不是只出现在出口行', () => {
    const all = [
      'northup',
      'northdown',
      'southup',
      'southdown',
      'eastup',
      'eastdown',
      'westup',
      'westdown',
    ];
    for (const dir of all) {
      mod.dispatchPacket('exits', { items: { [dir]: '某处' } });
      expect(mod.mappedDirs(), `${dir} 没被画进地图`).toContain(dir);
      expect(cellBoxes().map((b) => b.dir)).toContain(dir);
    }
  });

  it('★ 任意组合下：画出的格子**两两不重叠**，且数量不超过九宫格（画不下的留在出口行）', () => {
    mod.dispatchPacket('exits', {
      items: {
        north: 'A',
        south: 'B',
        east: 'C',
        west: 'D',
        northeast: 'E',
        northwest: 'F',
        southeast: 'G',
        southwest: 'H',
        up: 'I',
        down: 'J',
        enter: 'K',
        out: 'L',
      },
    });
    const boxes = cellBoxes();
    expect(boxes.length).toBeGreaterThan(0);
    expect(boxes.length).toBeLessThanOrEqual(8); // 外围只有 8 格
    for (let i = 0; i < boxes.length; i += 1) {
      for (let j = i + 1; j < boxes.length; j += 1) {
        const a = boxes[i]!;
        const b = boxes[j]!;
        const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
        const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
        expect(ox > 0 && oy > 0, `${a.dir} 与 ${b.dir} 的格子重叠了（${String(ox)}×${String(oy)}）`).toBe(false);
      }
    }
    // 画不下的方向仍然要在出口行里能点（信息不能因为画不下就消失）
    expect(document.querySelectorAll('#roomExits .exits-item').length).toBe(12);
  });
});

// ---------------------------------------------------------------------------
// 工具条 / 浮层 / 面板
// ---------------------------------------------------------------------------

describe('底部工具条', () => {
  it('★ 工具条上**没有点不动的按钮**（每一格都对应一条服务端真认的指令或浮层）', () => {
    const acts = mod.barActions();
    expect(acts.length).toBeGreaterThan(0);
    // 服务端内容层当前认的指令（world/command/）+ 两个浮层
    // ★ `score`（属性）：`world/command/info/score.ts` 已实现（别名 `attr`），
    //   此前**没有前端入口**，玩家只能手敲 —— wushen 的工具条上它就有一格（「属性」）。
    // ★ `skills`（技能）：同理（`world/command/info/skills.ts` + `dialog:skills` 帧，
    //   26 册 §64.10）。★ 这份名单是**白名单**：加一格就必须在这里加一个名字，
    //   于是"点一下回『什么？』"的按钮进不来。
    const owned = new Set(['look', 'cmd', 'chat', 'score', 'skills']);
    expect(acts.filter((a) => !owned.has(a))).toEqual([]);
  });

  it('★ 「属性」格 → 发 `score`（不是自造的假按钮）', () => {
    fired.length = 0;
    click(document.querySelector('.tool-item[data-act="score"]'));
    expect(fired).toEqual(['score']);
  });

  it('点「环顾」→ 发 look', () => {
    fired.length = 0;
    click(document.querySelector('.tool-item[data-act="look"]'));
    expect(fired).toEqual(['look']);
  });

  it('点「指令」→ 开指令浮层；点「聊天」→ 开聊天浮层（互斥）', () => {
    mod.closeInputs();
    click(document.querySelector('.tool-item[data-act="cmd"]'));
    expect(mod.cmdOpen()).toBe(true);
    click(document.querySelector('.tool-item[data-act="chat"]'));
    expect(mod.cmdOpen()).toBe(false);
    expect(mod.chatOpen()).toBe(true);
    mod.closeInputs();
  });

  it('★ 底部两行的先后与 wushen 一致：**工具条在上、动作栏在下**', () => {
    const app = document.getElementById('app');
    const bar = app?.querySelector('.tool-bar.bottom-bar');
    const bottom = app?.querySelector('.content-bottom');
    expect(bar).not.toBeNull();
    expect(bottom).not.toBeNull();
    // 在 DOM 顺序里，动作栏必须排在工具条**之后**
    const rel = bar?.compareDocumentPosition(bottom as Node) ?? 0;
    expect(
      (rel & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
      '动作栏排在工具条之前了（wushen 是工具条在上、动作栏在下）',
    ).toBe(true);
  });
});

describe('面板（服务端驱动）', () => {
  it('`dialog` 帧 → 开面板并列出字段（未知面板也如实列，不假装处理了）', () => {
    mod.dispatchPacket('dialog', { dialog: 'pack', foo: 'bar' });
    expect(mod.isPanelOpen()).toBe(true);
    expect(document.getElementById('dlgTitle')?.textContent).toBe('pack');
    expect(document.getElementById('dlgBody')?.textContent).toContain('foo');
    mod.closePanel();
  });

  // -------------------------------------------------------------------------
  // F4（2026-10-16 审查）：`dialog` 的四个**控制字段**原先一个都没消费
  // -------------------------------------------------------------------------
  //
  // 协议（`protocol.ts` 的 `DialogControlShape`）声明了 `close` / `refresh` / `clear` / `remove`，
  // 而 handler 把它们当**普通字段**列成文本行：服务端发 `{dialog:'pack', close:true}`
  // 得到的是一行 `close: true`，面板**不关**。
  // ⇒ 契约不一致（声明了却不消费）+ 行为错（该关的没关）。
  describe('F4 · dialog 的控制字段', () => {
    it('★ `close: true` → 关面板，而不是把它列成一行文本', () => {
      mod.openPanel('包', ['一些东西']);
      mod.dispatchPacket('dialog', { dialog: 'pack', close: true });

      expect(mod.isPanelOpen()).toBe(false);
      expect(mod.panelRows()).toEqual([]);
    });

    it('★ `remove: <行>` → 从当前面板移除**那一行**', () => {
      mod.openPanel('包', ['铁剑', '布衣']);
      mod.dispatchPacket('dialog', { dialog: 'pack', remove: '铁剑' });

      expect(mod.panelRows()).toEqual(['布衣']);
      mod.closePanel();
    });

    it('★ `clear: true` → 清空行（面板仍开着），不是关掉面板', () => {
      mod.openPanel('包', ['铁剑', '布衣']);
      mod.dispatchPacket('dialog', { dialog: 'pack', clear: true });

      expect(mod.isPanelOpen()).toBe(true);
      expect(mod.panelRows()).toEqual([]);
      mod.closePanel();
    });

    it('★ 控制字段本身**绝不出现在内容行**里（修复前会显示 "remove: 不存在"）', () => {
      mod.openPanel('包', ['铁剑']);
      mod.dispatchPacket('dialog', { dialog: 'pack', remove: '不存在那把' });
      mod.dispatchPacket('dialog', { dialog: 'pack', refresh: 123 });

      expect(mod.panelRows().join('|')).not.toContain('remove:');
      expect(mod.panelRows().join('|')).not.toContain('refresh:');
      mod.closePanel();
    });

    it('【反向锚点】普通字段仍落成内容行（别把 handler 改成只认控制字段）', () => {
      mod.dispatchPacket('dialog', { dialog: 'pack', foo: 'bar' });
      expect(mod.isPanelOpen()).toBe(true);
      expect(mod.panelRows()).toContain('foo: bar');
      mod.closePanel();
    });
  });

  // -------------------------------------------------------------------------
  // §62 属性面板：`dialog:score` 走**数据面板**形态（照 wushen `.dialog-score`）
  // -------------------------------------------------------------------------
  //
  // wushen 的属性面板**不是浮窗**：`Dialog.init()` 把 `.content-room` 加 `hide`
  // 再让 `.dialog` 顶上（`src/dialog/base.js:101-104`），**没有遮罩**。
  // 消息流 / 聊天预览 / 工具条全都在，照样能滚能点。
  // 所以这里断言三件事：分段渲染、没有遮罩、房间区不被藏（盖住即可）。
  it('★ `dialog:score` → 开**数据面板**：分段渲染 + 不遮屏（照 wushen）', () => {
    mod.closePanel();
    mod.dispatchPacket('dialog', {
      dialog: 'score',
      name: '张三',
      gender: 1,
      level: 9,
      exp: 1200,
      pot: 300,
      hp: 80,
      maxHp: 100,
      mp: 40,
      maxMp: 60,
      attrs: [
        { key: 'str', innate: 20, bonus: 5, total: 25 },
        { key: 'con', innate: 18, bonus: 0, total: 18 },
      ],
      combat: { attack: 31, defense: 12, hit: 200, evasion: 180, deflect: 150, crit: 5 },
      skillLimit: 40,
    });

    // ① 标题是中文，不是协议里的 `score`
    expect(document.getElementById('dlgTitle')?.textContent).toBe('属性');

    // ①b 图标是「人」—— wushen 的 `score.js:47` 就是 `Dialog.icon("user")`。
    //     通用方块不是错，但它让"属性"和"某样东西的详情"在第一眼上分不开。
    expect(document.getElementById('dlgIcon')?.className).toContain('glyphicon-user');

    // ② 照 wushen 的 `.score-section` 分段（不是一列 `k: v`）
    const sections = document.querySelectorAll('#dlgBody .score-section');
    expect(sections.length).toBeGreaterThanOrEqual(3);

    // ③ 三档数值：有加成才展开括号，没加成只报合计（与改前的文本口径一致）
    const body = document.getElementById('dlgBody')?.textContent ?? '';
    expect(body).toContain('臂力');
    expect(body).toContain('25');
    expect(body).toContain('先天 20 + 后天 5');
    expect(body).toContain('根骨');
    expect(body).not.toContain('先天 18 + 后天 0');

    // ④ ★ 关键：**没有遮罩**。旧的 `openPanel` 会把 `#mask` 亮出来糊住整屏，
    //    那正是"看属性时什么都不能点"的来源。
    expect(document.getElementById('mask')?.hidden).toBe(true);

    // ⑤ 房间区没被藏（面板盖在它上面，不是把它藏掉 —— 藏了消息流会跳）
    expect(document.getElementById('roomPanel')?.hidden).toBe(false);

    mod.closePanel();
  });

  it('★ 属性面板开着时播报**仍进消息流**（数据面板是快照，不吸收对话）', () => {
    mod.clearStream();
    mod.dispatchPacket('dialog', { dialog: 'score', name: '张三', attrs: [], combat: {} });
    mod.dispatchPacket('warn', { content: '风从北边吹来。' });

    // ① 消息流里有它（房间发生的事必须留得住，关掉面板还找得回来）
    expect(document.getElementById('output')?.textContent).toContain('风从北边吹来。');
    // ② ★ 面板正文里**没有**它 —— 快照就是快照。物件面板才会吸收回显（§57 的对照）。
    expect(document.getElementById('dlgBody')?.textContent ?? '').not.toContain('风从北边吹来。');
    mod.closePanel();
  });

  it('★ 「属性」按第二次 = **收起**（wushen `Dialog.show` 的同键切换）', () => {
    mod.closePanel();
    mod.dispatchPacket('dialog', { dialog: 'score', name: '张三', attrs: [], combat: {} });
    expect(mod.isPanelOpen()).toBe(true);

    fired.length = 0;
    click(document.querySelector('.tool-item[data-act="score"]'));
    // 收起，且**不再发一次指令**（否则服务端又推一份快照，面板刚关又开）
    expect(mod.isPanelOpen()).toBe(false);
    expect(fired).toEqual([]);
  });

  it('★★ 数据面板的 `build` 拿到 `redraw`：面板内部状态变了能就地重画', () => {
    // 场景：背包。点一件物品 → 面板内部"当前选中"变了 → 详情/动作要换。
    // ★ 这是**操作型面板**（背包/技能）的地基：属性面板是纯快照，不需要它，
    //   但第一个操作型面板会把这个签名钉死，所以它必须在写面板之前就成立。
    let picked = '';
    mod.openDataPanel('pack', '行囊', (redraw) => {
      const box = document.createElement('div');
      const btn = document.createElement('span');
      btn.className = 'pick';
      btn.textContent = '挑一件';
      btn.addEventListener('click', () => {
        picked = '丹药';
        redraw();
      });
      box.appendChild(btn);
      box.appendChild(document.createTextNode(`选中:${picked}`));
      return box;
    });

    expect(document.getElementById('dlgBody')?.textContent).toContain('选中:');
    expect(picked).toBe('');

    click(document.querySelector('#dlgBody .pick'));

    // ① 内部状态变了（click 真跑过）
    expect(picked).toBe('丹药');
    // ② 面板**已经重画**：新状态出现在正文里，而不是等下一次服务端推帧
    expect(document.getElementById('dlgBody')?.textContent).toContain('选中:丹药');
    mod.closePanel();
  });

  it('★ `build` 里同步调 `redraw` 不会递归（防递归标志真的在挡）', () => {
    // build 执行期间 `render()` 正在跑；此时再 `redraw()` 会 clear + 重新 build。
    // ★★ 判据不能只是"没崩" —— 没有那道标志时同步递归会栈溢出（RangeError），
    //   而"没崩"在两种实现下都可能成立。真正的判据是 **build 只跑了一次**。
    let calls = 0;
    mod.openDataPanel('pack', '行囊', (redraw) => {
      calls += 1;
      redraw(); // 故意的（合法时机之外）
      const box = document.createElement('div');
      box.textContent = '一';
      return box;
    });
    expect(document.getElementById('dlgBody')?.textContent).toBe('一');
    expect(calls).toBe(1);
    mod.closePanel();
  });

  it('★ 开着**物件面板**时按「属性」→ 换成属性面板（不是"关掉"了事）', () => {
    mod.openPanel('店小二', ['一个手脚麻利的店小二。']);
    fired.length = 0;
    click(document.querySelector('.tool-item[data-act="score"]'));
    // ★ 判据是"开着的**就是**属性面板"，不是"开着一个面板" —— 否则在
    //   店小二详情里按属性只会把详情关掉，什么也不显示。
    expect(fired).toEqual(['score']);
  });

  it('★ 服务端声明 `context` 且与面板 id 相同 ⇒ 文本落进面板（不再镜像进消息流）', () => {
    // ★★ 这一条**推翻**了 §74 的"面板是附加视图，同一句两边都写"：
    //   §80 之后落点是**二选一**，有归属就只进面板，没归属就只进消息流。
    //   两处都写等于同一个信息两份，读的时候要去分辨哪份是新的。
    mod.openPanel('店小二', ['一个跑堂的。'], [], 'npc-xiaoer');
    mod.dispatchPacket('warn', { content: '店小二打量了你一眼。', context: 'npc-xiaoer' });
    expect(mod.panelRows()).toContain('店小二打量了你一眼。');
    expect(document.getElementById('output')?.textContent).not.toContain('店小二打量了你一眼。');
    mod.closePanel();
  });

  it('★★ `context` 与面板 id **对不上** ⇒ 进消息流（不许投给眼前这块面板）', () => {
    // 服务端说这句话属于另一块面板（比如玩家已经点了别人）—— 前端不许"就近投递"。
    mod.openPanel('店小二', ['一个跑堂的。'], [], 'npc-xiaoer');
    const out = document.getElementById('output');
    out!.textContent = '';

    mod.dispatchPacket('warn', { content: '木人桩纹丝不动。', context: 'npc-murenzhuang' });

    expect(out?.textContent ?? '').toContain('木人桩纹丝不动。');
    expect(mod.panelRows()).not.toContain('木人桩纹丝不动。');
    mod.closePanel();
  });

  // ───────────────────────────────────────────────────────────────────────
  // §74（2026-10-20 真机反馈）：面板**不累积历史**
  //   病象：点教头 → 面板；然后在输入框连敲 `learn`，面板从"教头+一句回显"
  //   长到"教头+三条学习记录+七行技能表"，日志区一行不动。
  //   玩家原话：「每次向教头请教，信息都一直在弹窗里」。
  //   ★ §80 改了触发方式（回显靠 `context` 声明，不再靠"命令从哪来"），
  //     但"每一轮从基线重来"这条**判据本身没变**，所以测试照留。
  // ───────────────────────────────────────────────────────────────────────

  it('★ 面板内再发一次命令 ⇒ 正文从**基线**重来，不累积上一轮', () => {
    mod.openPanel(
      '教头',
      ['教头', '一位身材精悍的中年汉子。'],
      [{ cmd: 'ask x', name: '请教' }],
      'npc-jiaotou',
    );

    mod.runPanelCommand('ask x');
    mod.dispatchPacket('warn', { content: '第一轮：想学武？', context: 'npc-jiaotou' });
    expect(mod.panelRows()).toEqual(['教头', '一位身材精悍的中年汉子。', '第一轮：想学武？']);

    mod.runPanelCommand('learn base/sword from 教头');
    mod.dispatchPacket('warn', {
      content: '第二轮：你向教头请教基本剑法。',
      context: 'npc-jiaotou',
    });

    // ★ 判据一：描述还在（基线不丢）
    expect(mod.panelRows()[0]).toBe('教头');
    expect(mod.panelRows()).toContain('一位身材精悍的中年汉子。');
    // ★ 判据二：上一轮那句**必须消失** —— 这才是"不堆叠"
    expect(mod.panelRows()).not.toContain('第一轮：想学武？');
    // ★ 判据三：本轮那句在
    expect(mod.panelRows()).toContain('第二轮：你向教头请教基本剑法。');
    mod.closePanel();
  });

  it('★★ `notePanel` 投递失败时返回 `false` —— 调用方据此落消息流（文本不许消失）', () => {
    // ★ 这是 §80 的结构保证：`system.ts` 只有"投进去了"才 return，
    //   否则一定往下走 `pushLine`。返回 `void` 的话调用方没有依据，只能猜。
    mod.closePanel();
    expect(mod.notePanel('npc-xiaoer', '面板没开时的话')).toBe(false);

    mod.openPanel('教头', ['教头'], [], 'npc-jiaotou');
    // 面板开着，但 id 对不上
    expect(mod.notePanel('npc-xiaoer', '给别块面板的话')).toBe(false);
    // id 对得上
    expect(mod.notePanel('npc-jiaotou', '给这块面板的话')).toBe(true);
    expect(mod.panelRows()).toContain('给这块面板的话');
    mod.closePanel();
  });

  it('★ 数据面板永不接回显（快照不许被播报冲淡）', () => {
    mod.openDataPanel('score', '属性', () => document.createElement('div'));
    expect(mod.notePanel('score', '房间里有人说话。')).toBe(false);
    mod.closePanel();
  });

  // ───────────────────────────────────────────────────────────────────────
  // §78（2026-10-21 真机反馈）：**战斗不属于面板回显**
  //   病象：点木人桩 → 面板 → 点面板里的「比试」→ 开战。
  //   之后每一拍的战报（服务端 `warn`）都被吸进「木人桩」这块面板，
  //   日志区一行不动 —— 玩家原话："我和木人切磋，居然数据写在木人的操作框里"。
  //   当时根因：`absorb` 的边界只按"命令从哪来"判（§74），而**战斗是一条长会话**，
  //   从面板里点一次「比试」，整场战斗都被算成"这条命令的回显"。
  //   ★ §80 之后这批用例的**判据没变**（战报必须进消息流），
  //     但保它的机制变了：不再靠词表 + 开战清标志，而是靠"战报本来就不带 context"。
  //     所以下面这些用例保留原样跑 —— 它们是**回归网**，不该跟着实现一起重写。
  // ───────────────────────────────────────────────────────────────────────

  it('★★ 从面板点「比试」开战后，战报必须回到消息流（面板不许吞战斗播报）', () => {
    mod.openPanel(
      '木人桩',
      ['木人桩', '一具用硬木扎成的假人。'],
      [{ cmd: 'fight 3v3cl6ifhs', name: '比试' }],
      'npc-murenzhuang',
    );
    mod.runPanelCommand('fight 3v3cl6ifhs');
    mod.dispatchPacket('combat', { start: 1 });

    const out = document.getElementById('output');
    out!.textContent = '';
    mod.dispatchPacket('warn', { content: '木人桩的状态不是很好，你想趁人之危吗？' });

    expect(out?.textContent ?? '').toContain('木人桩的状态不是很好');
    expect(mod.panelRows()).not.toContain('木人桩的状态不是很好，你想趁人之危吗？');
    mod.closePanel();
  });

  // ★ 原有一条"开战那一帧本身就把吸收关掉 —— 脱战后也不会续上旧面板的吸收"，
  //   已随 §80 撤销：它测的是 `stopAbsorb()` 这个调用，而那个 API 连同 `absorb`
  //   标志一起删掉了。等价判据由下面两条覆盖 ——
  //   ① "面板开着 + 不带 context ⇒ 进消息流"（脱战后当然也不带 context）；
  //   ② "`notePanel` 投递失败返回 false"（没有开关可忘了关，也就没有"续上"可言）。

  it('★★ 面板里点「比试」被拒 ⇒ 拒绝文案必须进消息流（不许留在木人桩面板里）', () => {
    // ★ 这是用户报的那个形态：切磋被拒（`target-wounded`），
    //   文案却写进了「木人桩」这块面板，日志区一行不动。
    mod.openPanel(
      '木人桩',
      ['木人桩', '一具用硬木扎成的假人。'],
      [{ cmd: 'fight 3v3cl6ifhs', name: '比试' }],
      'npc-murenzhuang',
    );
    mod.runPanelCommand('fight 3v3cl6ifhs');

    const out = document.getElementById('output');
    out!.textContent = '';
    mod.dispatchPacket('warn', { content: '木人桩的状态不是很好，你想趁人之危吗？' });

    expect(out?.textContent ?? '').toContain('趁人之危');
    expect(mod.panelRows()).not.toContain('木人桩的状态不是很好，你想趁人之危吗？');
    mod.closePanel();
  });

  it('★ 对照：面板里点「打听」的回显**仍留在面板**（靠 context 声明，不靠词表）', () => {
    // ★ 守卫自身也要证不误伤：§74 的"打听 → 下一层"必须照旧留在面板，
    //   否则这次修法就把上一批的真机反馈又打回去了。
    //   ★ 与上面两条的差别**只在帧上有没有 `context`** —— 命令词是什么不参与判断。
    mod.openPanel(
      '店小二',
      ['一个手脚麻利的店小二。'],
      [{ cmd: 'ask 3x', name: '打听' }],
      'npc-xiaoer',
    );
    mod.runPanelCommand('ask 3x');
    mod.dispatchPacket('warn', { content: '你想打听什么？', context: 'npc-xiaoer' });
    expect(mod.panelRows()).toContain('你想打听什么？');
    mod.closePanel();
  });

  it('★★ 同一条命令、同一句话，只因为帧上多一个 `context` 落点就不同', () => {
    // ★ 这条是 §80 的**核心判据**：落点由声明决定，与命令词、与当前局面无关。
    //   两条一模一样的前置（都从面板点「打听」），只改 `context`：
    const run = (context?: string): { inPanel: boolean; inStream: boolean } => {
      mod.openPanel('店小二', ['店小二'], [{ cmd: 'ask 3x', name: '打听' }], 'npc-xiaoer');
      mod.runPanelCommand('ask 3x');
      const out = document.getElementById('output');
      out!.textContent = '';
      const p = context === undefined ? { content: '你想打听什么？' } : { content: '你想打听什么？', context };
      mod.dispatchPacket('warn', p);
      const r = {
        inPanel: mod.panelRows().includes('你想打听什么？'),
        inStream: (out?.textContent ?? '').includes('你想打听什么？'),
      };
      mod.closePanel();
      return r;
    };

    // 服务端声明了归属 ⇒ 只进面板
    expect(run('npc-xiaoer')).toEqual({ inPanel: true, inStream: false });
    // 服务端没声明 ⇒ 只进消息流（**默认安全**：漏写只会掉到流里，不会掉进面板）
    expect(run(undefined)).toEqual({ inPanel: false, inStream: true });
  });

  // ───────────────────────────────────────────────────────────────────────
  // §80（2026-10-21）：**文本自带归属**，前端不再猜
  //   §57 / §74 / §78 三次真机反馈是同一个病：`warn` 帧只有一根字符串，
  //   前端用"命令从哪来 + 是否战斗中 + 面板是否吸收"三个**间接信号**猜落点。
  //   启发式必然有漏 —— 每加一个状态就漏一次。修法是把默认方向反过来：
  //   **不声明归属的文本一律进消息流**，要进面板必须由服务端在帧里点名。
  // ───────────────────────────────────────────────────────────────────────

  it('★★ 面板开着 + 不带 context 的 warn ⇒ 必须进消息流（安全默认：不声明就不进面板）', () => {
    // 这条是 §78 那个真机 bug 的**根本判据**：不靠战斗词表、不靠 fighting 判断，
    // 只要服务端没说"这条属于这块面板"，它就不许被吸进去。
    mod.openPanel(
      '木人桩',
      ['木人桩', '一具用硬木扎成的假人。'],
      [{ cmd: 'fight x', name: '比试' }],
      'npc-murenzhuang',
    );
    const out = document.getElementById('output');
    out!.textContent = '';

    mod.dispatchPacket('warn', { content: '木人桩的状态不是很好，你想趁人之危吗？' });

    expect(out?.textContent ?? '').toContain('趁人之危');
    expect(mod.panelRows()).not.toContain('木人桩的状态不是很好，你想趁人之危吗？');
    mod.closePanel();
  });

  it('★★ 数据面板 → 物件面板：inline left/width 必须清掉（否则左移半个身位跑出屏幕）', () => {    const dialog = document.getElementById('dialog')!;
    mod.openDataPanel('score', '属性', () => {
      const box = document.createElement('div');
      return box;
    });
    // `place()` 在数据面板分支写下的几何（jsdom 量不到真实矩形，这里手工模拟）
    dialog.style.left = '7px';
    dialog.style.width = '568px';

    mod.openPanel('教头', ['教头']);

    // ★ 物件面板靠 CSS 的 `left:50% + translateX(-50%)` 居中；inline 一留着，
    //   就是 `left:7px` 再左移一半宽度 —— 真机实测 l=−231（窗口 582）。
    expect(dialog.style.left).toBe('');
    expect(dialog.style.width).toBe('');
    mod.closePanel();
  });

  it('**没开面板时**回显只进消息流（不许偷偷攒在一个看不见的地方）', () => {
    mod.closePanel();
    mod.dispatchPacket('warn', { content: '风从北边吹来。' });
    expect(mod.panelRows()).toEqual([]);
  });

  it('点关闭按钮 / 遮罩都能收起面板', () => {
    mod.openPanel('某处', ['一行字。']);
    click(document.getElementById('dlgClose'));
    expect(mod.isPanelOpen()).toBe(false);

    mod.openPanel('某处', ['一行字。']);
    click(document.getElementById('mask'));
    expect(mod.isPanelOpen()).toBe(false);
  });

  // ★ L2（2026-10-16 审查）：`#dlgClose` 声明了 `role="button" tabindex="0"`，
  //   却只绑了 click —— 键盘用户 Tab 到它、按 Enter/Space 毫无反应。
  //   项目自己在 `ui/input.ts` 为 `#channel` 立过这条规矩（"声明了能点却不绑事件，
  //   比不声明更糟：读屏器会播报'按钮'，键盘用户按下去毫无反应"），这两处恰好违反。
  it('★ 关闭按钮可用键盘操作（role="button" 的可访问性承诺）', () => {
    const close = document.getElementById('dlgClose');
    expect(close?.getAttribute('role'), '这条判据只对 role="button" 成立').toBe('button');

    for (const key of ['Enter', ' ']) {
      mod.openPanel('某处', ['一行字。']);
      close?.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
      expect(mod.isPanelOpen(), `按 ${key} 没能收起面板`).toBe(false);
    }
  });

  it('面板底部的命令按钮点了就执行', () => {
    fired.length = 0;
    mod.openPanel('铁剑', ['一把铁剑。'], [{ cmd: 'get x', name: '拿起' }]);
    // 命令按钮在**下带** `#dlgFoot`（wushen `.dialog-footer`）
    click(document.querySelector('#dlgFoot .item-commands span'));
    expect(fired).toEqual(['get x']);
    mod.closePanel();
  });

  // -------------------------------------------------------------------------
  // 2026-10-18 真机反馈：点在**上面**的人/物，操作面板却贴在**屏幕底部**
  // （`bottom: calc(var(--bottom-chrome) + 0.5em)`）⇒ 两头跑、两只手。
  // -------------------------------------------------------------------------
  describe('面板贴在**被点的东西旁边**（不贴屏幕底）', () => {
    it('★ `panelTop` 把面板放在锚点正下方（差一个 gap）', () => {
      expect(mod.panelTop({ anchor: 300, height: 130, viewport: 900, reserve: 100 })).toBe(312);
    });

    it('★ 放不下时**往上钳**，不许越过底部的工具条/动作栏', () => {
      // 锚点在 800，面板 300 高 ⇒ 312+300=612 > 900-100 ⇒ 贴到 500
      expect(mod.panelTop({ anchor: 800, height: 300, viewport: 900, reserve: 100 })).toBe(500);
    });

    it('★ 锚点很低、面板又很高时也不会被顶出屏幕（top 不为负）', () => {
      expect(mod.panelTop({ anchor: 890, height: 1000, viewport: 900, reserve: 100 })).toBe(12);
    });

    it('★ 开面板时真的把算出来的 top 写进 `#dialog`', () => {
      mod.setPanelAnchor(() => 400);
      mod.openPanel('店小二', ['一个跑堂的。']);
      const top = document.getElementById('dialog')?.style.top ?? '';
      expect(top === '', '面板还靠 CSS 贴底定位，没有就近落点').toBe(false);
      mod.closePanel();
      mod.setPanelAnchor(() => 0);
    });
  });

  // -------------------------------------------------------------------------
  // 2026-10-18 真机反馈：没钱时连点「人字号客房」五次 ⇒ 同一句回显堆 5 行、
  // 面板一路长高（130px → 214px）。
  // -------------------------------------------------------------------------
  it('★ 连续重复同一句回显**不堆叠**（点几次都只留一行）', () => {
    mod.openPanel('店小二', ['一个跑堂的。'], [], 'npc-xiaoer');
    const before = mod.panelRows().length;
    for (let i = 0; i < 5; i += 1) mod.notePanel('npc-xiaoer', '你身上没有那么多的钱给店小二。');
    expect(mod.panelRows().length, '同一句被重复追加了').toBe(before + 1);
    // 中间换一句，之后再重复那一句 ⇒ 仍只追加（"最后一行相同"才算重复）
    mod.notePanel('npc-xiaoer', '店小二摇了摇头。');
    mod.notePanel('npc-xiaoer', '你身上没有那么多的钱给店小二。');
    expect(mod.panelRows().length).toBe(before + 3);
    expect(mod.panelRows().at(-1)).toBe('你身上没有那么多的钱给店小二。');
    mod.closePanel();
  });
});

describe('★★ 技能面板（wushen `dialog/skills.js` 的三段版，26 册 §64.10）', () => {
  /** 一门基本功：占 `sword` 槽，`canEnables` 空、`enabled` 恒 null */
  const baseSword = {
    id: 'base/sword',
    name: '基本剑法',
    kind: 'base',
    grade: 0,
    level: 12,
    progress: 40,
    enabled: null,
    canEnables: [],
    slot: 'sword',
  };
  /** 一门武功：能装到 `sword`，`slot` 是 null（它不是基本功） */
  const taiji = {
    id: 'wd/taijijian',
    name: '太极剑法',
    kind: 'skill',
    grade: 3,
    level: 1,
    progress: 10,
    enabled: null,
    canEnables: ['sword'],
    slot: null,
    note: '需基本剑法 30 级',
  };

  /** 发一帧 `dialog:skills` 并返回面板根节点里的三段容器 */
  function openSkills(items: readonly unknown[]): {
    tabs: Element[];
    rows: Element[];
    actions: Element | null;
  } {
    mod.dispatchPacket('dialog', {
      dialog: 'skills',
      title: `你共学会 ${String(items.length)} 项技能`,
      limit: 22,
      pot: 1300,
      items,
    });
    return {
      tabs: Array.from(document.querySelectorAll('#dlgBody .skill-tab')),
      rows: Array.from(document.querySelectorAll('#dlgBody .skill-item')),
      actions: document.querySelector('#dlgBody .item-commands'),
    };
  }

  const tabOf = (label: string): Element | undefined =>
    Array.from(document.querySelectorAll('#dlgBody .skill-tab')).find((n) => n.textContent === label);

  afterEach(() => {
    mod.closePanel();
    mod.resetSkillsPanel();
    fired.length = 0;
  });

  it('帧一到就开**数据面板**：无遮罩 · 标题带技能上限 · 三段齐全', () => {
    const { tabs, rows } = openSkills([baseSword, taiji]);
    expect(document.getElementById('dialog')?.classList.contains('is-data')).toBe(true);
    expect(document.getElementById('mask')?.hidden).toBe(true);
    expect(document.getElementById('dlgTitle')?.textContent).toBe('技能 · 上限 22 级');
    // 页签：**带数目**（空页与坏页要分得开）
    expect(tabs.map((n) => n.textContent)).toEqual(['基础 1', '特殊 1']);
    // 默认在「基础」页 ⇒ 只看得见基本功
    expect(rows.length).toBe(1);
    expect(rows[0]?.textContent).toContain('基本剑法');
    // 底部统计：学会几项 + 潜能（省一次 score）
    expect(document.querySelector('#dlgBody .skill-meta')?.textContent).toContain('潜能 1300');
  });

  it('★ 换页签是**前端状态**：不发任何命令，只是换一批行', () => {
    const { rows } = openSkills([baseSword, taiji]);
    fired.length = 0;
    click(tabOf('特殊 1'));
    expect(fired, '换页签竟然发了命令').toEqual([]);
    const now = Array.from(document.querySelectorAll('#dlgBody .skill-item'));
    expect(now.length).toBe(1);
    expect(now[0]?.textContent).toContain('太极剑法');
    // 页签的选中态也换了（`is-on` 只有一个）
    expect(document.querySelectorAll('#dlgBody .skill-tab.is-on').length).toBe(1);
    expect(rows.length).toBe(1);
  });

  it('★ 已装配的行带 ✓；没装配的不带（`enable-flag` 只在装上的那一行出现）', () => {
    openSkills([baseSword, taiji]);
    click(tabOf('特殊 1'));
    expect(document.querySelector('#dlgBody .skill-item .skill-flag')).toBeNull();
    openSkills([baseSword, { ...taiji, enabled: 'sword' }]);
    click(tabOf('特殊 1'));
    expect(document.querySelector('#dlgBody .skill-item .skill-flag')?.textContent).toBe('✓');
  });

  it('★★ 选中武功 → 动作栏出现「装配基本剑法」（基本功在**另一页**也要查得到）', () => {
    openSkills([baseSword, taiji]);
    click(tabOf('特殊 1'));
    click(document.querySelector('#dlgBody .skill-item'));
    const labels = Array.from(document.querySelectorAll('#dlgBody .item-commands span')).map(
      (n) => n.textContent,
    );
    // 装配按钮的文案来自**基本功自己的名字**（wushen `装备基本剑法` 同款），
    // 不是拼音槽名 —— 也正因为要查名字，基本功在另一页时最容易漏掉。
    expect(labels).toContain('装配基本剑法');
    expect(labels).toContain('练习');
    expect(labels).toContain('遗忘');
  });

  it('装配 = 发 `enable <槽> <技能id>`，再**重取一次面板**（否则数据是旧的）', () => {
    openSkills([baseSword, taiji]);
    click(tabOf('特殊 1'));
    click(document.querySelector('#dlgBody .skill-item'));
    const btn = Array.from(document.querySelectorAll('#dlgBody .item-commands span')).find(
      (n) => n.textContent === '装配基本剑法',
    );
    fired.length = 0;
    click(btn);
    expect(fired).toEqual(['enable sword wd/taijijian', 'skills']);
  });

  it('★ 不会基本功就没有「装配」按钮 —— 不留点不动的格子', () => {
    // 只有武功、没有 `base/sword`：装配到 sword 的前提不成立
    openSkills([taiji]);
    click(tabOf('特殊 1'));
    click(document.querySelector('#dlgBody .skill-item'));
    const labels = Array.from(document.querySelectorAll('#dlgBody .item-commands span')).map(
      (n) => n.textContent,
    );
    expect(labels).not.toContain('装配基本剑法');
    expect(labels).toContain('练习'); // 别的动作照常
  });

  it('★ 遗忘要**两步**（第一步只换个按钮，不发命令）', () => {
    openSkills([baseSword, taiji]);
    click(tabOf('特殊 1'));
    click(document.querySelector('#dlgBody .skill-item'));
    const forget = (): Element | undefined =>
      Array.from(document.querySelectorAll('#dlgBody .item-commands span')).find(
        (n) => n.textContent === '遗忘',
      );
    fired.length = 0;
    click(forget());
    expect(fired, '第一次点「遗忘」就发出去了 —— 误触即永久遗忘').toEqual([]);
    const confirm = Array.from(document.querySelectorAll('#dlgBody .item-commands span')).find(
      (n) => n.textContent === '确定遗忘？',
    );
    expect(confirm).toBeDefined();
    click(confirm);
    expect(fired).toEqual(['forget wd/taijijian', 'skills']);
  });

  it('★ 基本功没有「遗忘」（引擎会拒，面板不该摆一颗必然失败的按钮）', () => {
    openSkills([baseSword, taiji]);
    click(document.querySelector('#dlgBody .skill-item')); // 基础页那一行
    const labels = Array.from(document.querySelectorAll('#dlgBody .item-commands span')).map(
      (n) => n.textContent,
    );
    expect(labels).not.toContain('遗忘');
    expect(labels).toContain('练习');
  });

  it('缺字段的条目被跳过、进度被钳在 0–100（面板不显示 `NaN` / `130%`）', () => {
    mod.dispatchPacket('dialog', {
      dialog: 'skills',
      title: '',
      limit: 10,
      pot: 0,
      items: [
        { name: '没有 id 的项' },
        { ...baseSword, progress: 130 },
        { ...baseSword, id: 'base/force', name: '基本内功', progress: -5 },
      ],
    });
    const rows = Array.from(document.querySelectorAll('#dlgBody .skill-item'));
    expect(rows.length).toBe(2);
    expect(rows[0]?.textContent).toContain('100%');
    expect(rows[1]?.textContent).toContain('0%');
  });

  it('★ 工具条「技能」格：点一下发 `skills`，再点一次收起（与「属性」同一条判据）', () => {
    const btn = Array.from(document.querySelectorAll('#app .tool-item')).find(
      (n) => n.getAttribute('data-act') === 'skills',
    );
    expect(btn, '工具条上没有「技能」这一格').toBeDefined();
    fired.length = 0;
    click(btn);
    expect(fired).toEqual(['skills']);
    // 面板开着时再点 = 收起（wushen `Dialog.show` 的同一个键开关）
    mod.openDataPanel('skills', '技能 · 上限 22 级', () => document.createElement('div'));
    fired.length = 0;
    click(btn);
    expect(fired).toEqual([]);
    expect(mod.isPanelOpen()).toBe(false);
  });
});

describe('气血条（房间列表）', () => {
  it('★ 填充比例 = hp/max（满血占满、半血一半）', () => {
    mod.dispatchPacket('items', { items: [{ id: 'n1', name: '店小二', hp: 50, max_hp: 100 }] });
    const bar = document.querySelector('#roomItems .progress.hp>.bar') as HTMLElement | null;
    expect(bar?.style.width).toBe('50%');
  });
});

describe('指令浮层（wushen 没有的那一个）', () => {
  it('提交 → 发出指令且清空输入框', () => {
    fired.length = 0;
    mod.openCmd();
    inputOf('cmdInput').value = '  look  ';
    click(document.getElementById('cmdSend'));
    expect(fired).toEqual(['look']);
    expect(inputOf('cmdInput').value).toBe('');
  });

  it('输入框里回车即提交', () => {
    fired.length = 0;
    const input = inputOf('cmdInput');
    input.value = 'dazuo';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    expect(fired).toEqual(['dazuo']);
  });

  it('★ ↑ 翻上一条指令（挂机时来回敲同一条是常态）', () => {
    fired.length = 0;
    mod.openCmd();
    inputOf('cmdInput').value = 'dazuo';
    click(document.getElementById('cmdSend'));
    inputOf('cmdInput').value = '';
    inputOf('cmdInput').dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }),
    );
    expect(inputOf('cmdInput').value).toBe('dazuo');
    mod.closeInputs();
  });

  it('★★ 聊天输入带的每个页签都指向**服务端真认**的指令（`data-ch` 就是命令名）', () => {
    // `composeChat` 拼的是 `${ch} ${正文}`（`tell` 是特例），也就是**页签的 data-ch
    // 直接当命令名**。所以页签写一个不存在的词 = 一个假页签：
    // 点上去只会回"什么？"。这条断言就是为这一类坏掉的（26 册 §24.3）。
    const chs = Array.from(document.querySelectorAll('#channelBox span[data-ch]')).map((n) =>
      n.getAttribute('data-ch'),
    );
    expect(chs.length).toBeGreaterThan(0);
    const real = new Set(['say', 'chat', 'shout', 'tell']);
    expect(chs.filter((c) => c === null || !real.has(c))).toEqual([]);
  });

  it('★ 快捷 chip 只用**服务端真认**的指令（前端自己造的按钮不许是假的）', () => {
    const cmds = Array.from(document.querySelectorAll('#cmdChips .chip')).map((n) =>
      n.getAttribute('data-cmd'),
    );
    // ★ `score`：服务端 `info/score.ts` 已实现。窄屏（≤480px）底部工具条会把
    //   「属性」那一格收起（4 格挤掉气血/内力的数值，见 style.css 的媒体查询），
    //   于是它是小屏上唯一的属性入口 —— 不能只挂在工具条上。
    const real = new Set(['look', 'go', 'say', 'chat', 'shout', 'tell', 'score']);
    expect(cmds.length).toBeGreaterThan(0);
    expect(cmds.filter((c) => c === null || !real.has(c))).toEqual([]);
    // ★ 上面那条是"只许"型 —— 把 `score` 从 CHIPS 里删掉它照样绿。
    //   所以这里再钉一次"必须有"：小屏的工具条上没有「属性」格，这是唯一入口。
    expect(cmds, '小屏唯一的属性入口是这条 chip').toContain('score');
  });

  it('★ 点 `score` chip → 执行并把浮层收起（否则属性文本被卡片挡着看不见）', () => {
    fired.length = 0;
    mod.openCmd();
    click(document.querySelector('#cmdChips .chip[data-cmd="score"]'));
    expect(fired).toEqual(['score']);
    expect(mod.cmdOpen(), '无参 chip 执行后浮层应关闭：结果在消息流里，卡片会挡住它').toBe(false);
  });

  it('点常用 chip（看）→ 直接执行；点缺参数的 chip（走）→ 只预填', () => {
    fired.length = 0;
    mod.openCmd();
    click(document.querySelector('#cmdChips .chip[data-cmd="look"]'));
    expect(fired).toEqual(['look']);

    click(document.querySelector('#cmdChips .chip[data-cmd="go"]'));
    expect(fired).toEqual(['look']); // 没多发
    expect(inputOf('cmdInput').value).toBe('go ');
    mod.closeInputs();
  });
});

describe('聊天浮层（wushen 的 .chat-panel）', () => {
  it('★ 点聊天预览区 → 开聊天浮层（它有 role="button"，就不能是个死按钮）', () => {
    mod.closeInputs();
    const brief = document.getElementById('channel');
    expect(brief, '聊天预览区 #channel 不存在').not.toBeNull();
    expect(brief?.getAttribute('role')).toBe('button');
    click(brief);
    expect(mod.chatOpen(), '点了 #channel 聊天浮层没开').toBe(true);
    mod.closeInputs();
  });

  it('★ 聊天预览区可用键盘唤起（role="button" + tabindex 的可访问性承诺）', () => {
    mod.closeInputs();
    const brief = document.getElementById('channel');
    brief?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    expect(mod.chatOpen()).toBe(true);
    mod.closeInputs();
  });

  it('切换频道只改选中态', () => {
    mod.openChat();
    click(document.querySelector('#channelBox span[data-ch="chat"]'));
    expect(mod.currentChannel()).toBe('chat');
    expect(document.querySelector('#channelBox span[data-ch="chat"]')?.classList.contains('sel')).toBe(true);
  });

  it('composeChat 只拼指令，不发包（能不能说话由服务端裁决）', () => {
    expect(mod.composeChat('say', null, '你好')).toBe('say 你好');
    expect(mod.composeChat('shout', null, '  大伙  ')).toBe('shout 大伙');
    expect(mod.composeChat('tell', '阿飞', '借一步')).toBe('tell 阿飞 借一步');
    expect(mod.composeChat('tell', null, '借一步')).toBeNull();
    expect(mod.composeChat('say', null, '   ')).toBeNull();
  });

  it('★ 私语缺对象 → 只给提示，不发指令（半截指令不该出门）', () => {
    fired.length = 0;
    hints.length = 0;
    mod.setChatTarget(null);
    mod.openChat();
    mod.setChannel('tell');
    inputOf('chatInput').value = '在吗';
    click(document.getElementById('chatSend'));
    expect(fired).toEqual([]);
    expect(hints).toHaveLength(1);

    mod.setChatTarget('阿飞');
    fired.length = 0;
    click(document.getElementById('chatSend'));
    expect(fired).toEqual(['tell 阿飞 在吗']);
    expect(inputOf('chatInput').value).toBe('');
    mod.closeInputs();
  });
});

// ---------------------------------------------------------------------------
// 屏幕与输入边界
// ---------------------------------------------------------------------------

describe('两块屏幕互斥（认证 ↔ 游戏）', () => {
  it('★ 游戏界面里**没有常驻输入框**（指令 / 聊天都是浮层，挂在 #app 之外）', () => {
    const app = document.getElementById('app');
    expect(app).not.toBeNull();
    expect(app?.querySelector('input')).toBeNull();
    expect(app?.querySelector('textarea')).toBeNull();

    // 全页的输入框只可能在**认证界面**或两个浮层里
    for (const i of Array.from(document.querySelectorAll('input'))) {
      const owner = i.closest('#auth') ?? i.closest('#cmdPop') ?? i.closest('#chatPop');
      expect(owner, `输入框 #${i.id} 既不在认证界面也不在浮层里`).not.toBeNull();
    }
  });

  it('★ 界面上不存在"手输服务器地址"（同源推导，只读展示）', () => {
    expect(document.getElementById('urlInput')).toBeNull();
    for (const i of Array.from(document.querySelectorAll('input'))) {
      expect(i.value).not.toMatch(/^wss?:\/\//);
      expect(i.getAttribute('placeholder') ?? '').not.toMatch(/wss?:\/\//);
    }
    const label = document.getElementById('serverLabel');
    expect(label).not.toBeNull();
    expect(label?.tagName).not.toBe('INPUT');
  });

  it('登入 / 新建名号是**两个互斥面板**', () => {
    const login = document.getElementById('panelLogin');
    const reg = document.getElementById('panelRegister');
    mod.setAuthTab('register');
    expect(login?.hidden).toBe(true);
    expect(reg?.hidden).toBe(false);
    mod.setAuthTab('login');
    expect(login?.hidden).toBe(false);
    expect(reg?.hidden).toBe(true);
  });

  it('两块面板各自提交，名号两端去空白', () => {
    submitted.length = 0;
    inputOf('loginName').value = '  阿飞  ';
    inputOf('regName').value = '阿飞';
    click(document.getElementById('loginBtn'));
    click(document.getElementById('regBtn'));
    expect(submitted).toEqual([
      { mode: 'login', name: '阿飞' },
      { mode: 'register', name: '阿飞' },
    ]);
  });

  it('名号校验：空 / 含空格 / 超长 都被挡下（服务端仍是最终裁决者）', () => {
    expect(mod.validateName('')).not.toBeNull();
    expect(mod.validateName('阿 飞')).not.toBeNull();
    expect(mod.validateName('x'.repeat(40))).not.toBeNull();
    expect(mod.validateName('阿飞')).toBeNull();
  });

  it('服务器地址由**同源**推导（页面怎么来的，就往哪儿连）', () => {
    expect(mod.serverUrl()).toMatch(/^wss?:\/\/[^/]+\/ws$/);
  });

  it('★ 收到 login 包 → 才切到游戏界面（"连上了" ≠ "进游戏了"）', () => {
    mod.dispatchPacket('login', { id: '阿飞', level: 3 });
    expect(mod.currentScreen()).toBe('game');
    expect(document.getElementById('auth')?.hidden).toBe(true);
    expect(document.getElementById('app')?.hidden).toBe(false);
    expect(document.getElementById('pName')?.textContent).toBe('阿飞');
    expect(document.getElementById('pLevel')?.textContent).toBe('Lv.3');
  });
});

// ---------------------------------------------------------------------------
// XSS 防线（颜色标签走解析器，不走 innerHTML）
// ---------------------------------------------------------------------------

describe('XSS 防线', () => {
  it('★ 服务端回显 HTML/脚本时只作为**文本**出现，不产生 DOM 节点', () => {
    const evil = '<img src=x onerror="window.__pwned=1"><script>window.__pwned=2</script>';
    mod.clearStream();
    mod.dispatchPacket('warn', { content: evil });

    const output = document.getElementById('output');
    expect(output?.querySelector('img')).toBeNull();
    expect(output?.querySelector('script')).toBeNull();
    expect((window as unknown as Record<string, unknown>)['__pwned']).toBeUndefined();
    expect(output?.textContent).toContain('<script>');
  });

  it('物品名 / 房间名 / 聊天内容同样只作为文本渲染', () => {
    mod.dispatchPacket('items', { items: [{ id: 'x1', name: '<b>加粗</b>' }] });
    const items = document.getElementById('roomItems');
    expect(items?.querySelector('b')).toBeNull();
    expect(items?.textContent).toContain('<b>加粗</b>');

    mod.clearStream();
    mod.dispatchPacket('msg', { ch: 'chat', name: '<i>某人</i>', content: '<script>alert(1)</script>' });
    expect(lastLine()?.querySelector('i')).toBeNull();
    expect(lastLine()?.querySelector('script')).toBeNull();

    mod.dispatchPacket('room', { path: 'yz/evil', name: '<img src=x onerror=1>', desc: '<script>alert(2)</script>', commands: [] });
    expect(document.getElementById('roomName')?.querySelector('img')).toBeNull();
    expect(document.getElementById('roomDesc')?.querySelector('script')).toBeNull();
    expect(document.getElementById('roomName')?.textContent).toContain('<img');
  });

  it('颜色标签被解析成**真节点**（wushen 那套 `<hir>` 能用，但不是靠 innerHTML）', () => {
    mod.clearStream();
    mod.dispatchPacket('warn', { content: '<hir>危险</hir>前方有敌' });
    const line = lastLine();
    expect(line?.querySelector('HIR')?.textContent).toBe('危险');
    expect(line?.textContent).toBe('危险前方有敌');
  });

  it('★ 白名单之外的标签全部当文本（`<script>` 是八个字符，不是一个节点）', () => {
    mod.clearStream();
    mod.dispatchPacket('warn', { content: '<script>alert(1)</script><span>x</span>' });
    const line = lastLine();
    expect(line?.querySelector('script')).toBeNull();
    expect(line?.querySelector('span')).toBeNull();
    expect(line?.textContent).toBe('<script>alert(1)</script><span>x</span>');
  });

  it('★ wushen 的版式标签也要认得（`<mem>` / `<opt>` / 背景色 `<BBLK>` 等）', () => {
    mod.clearStream();
    mod.dispatchPacket('warn', { content: '<mem>旁注</mem><BBLK>白底</BBLK><HBRED>红底</HBRED><opt>选项</opt>' });
    const line = lastLine();
    expect(line?.querySelector('mem')?.textContent).toBe('旁注');
    expect(line?.querySelector('BBLK')?.textContent).toBe('白底');
    expect(line?.querySelector('HBRED')?.textContent).toBe('红底');
    expect(line?.querySelector('opt')?.textContent).toBe('选项');
    // 关键：不能把标签当字面文本吐出来
    expect(line?.textContent).toBe('旁注白底红底选项');
  });

  /**
   * ★ 这条原先断言的是"`CMD` 可点、点了发它的指令" —— 2026-10-16 审查 S1 之后
   *   反过来了：自由文本里的按钮被**删除**，因为 `<CMD>` 在白名单内、语义是"点一下
   *   发一条指令"，于是任何玩家可控文本都能在别人屏幕上植一颗按钮（最强的一条是
   *   角色名 —— 不用开口，站在房间里就生效）。可点指令只剩 `CmdItem` 那条结构化通道。
   *   ⇒ 现在的判据：`<CMD>` 与 `<script>` 同等，**原样显示为字符**，点了什么都不发。
   */
  it('`<CMD>` 不可点 —— 自由文本里没有可执行按钮（S1）', () => {
    fired.length = 0;
    mod.clearStream();
    mod.dispatchPacket('warn', { content: "<cmd cmd='dazuo'>打坐</cmd>" });
    const line = lastLine();

    expect(line?.querySelector('CMD')).toBeNull();
    // ★ 与 `<script>` 同等处置：白名单外 ⇒ 原样可见（不是被吃掉、也不是可执行）
    expect(line?.textContent ?? '').toContain('<cmd');
    click(line);
    expect(fired).toEqual([]);
  });

  it('【反向锚点】可点按钮仍在，但只走 `CmdItem` 通道（S1 不能把按钮一起误删）', () => {
    fired.length = 0;
    mod.openPanel('蒲团', ['面前有个蒲团'], [{ cmd: 'dazuo', name: '打坐' }]);

    // ★ 判据落在"按钮确实存在且可执行"上：这是删掉 `<CMD>` 之后**唯一**的按钮来源
    const btn = document.querySelector('[data-cmd="dazuo"]');
    expect(btn).not.toBeNull();
    expect(btn?.textContent).toBe('打坐');
    click(btn);
    expect(fired).toEqual(['dazuo']);

    mod.closePanel();
  });
});

// ---------------------------------------------------------------------------
// 颜色标签 ↔ 样式表：**成对**才成立
// ---------------------------------------------------------------------------
//
// ★ 为什么要有这一组：`src/ui/markup.ts` 的白名单决定"哪些标签能被**认出来**"，
//   而"认出来之后长什么样"只写在 `src/style.css` 里。两边漂移之后的表现是
//   **同一段服务端文本在 wushen 与这里长得不一样** —— 而且极难查：标签反正
//   被认下来了，DOM 里也有节点，没人会想到去翻样式表。
//   实测就漏过一条：`ORD` 一直在白名单里，样式表里没有 —— `<ord>妖元</ord>`
//   在 wushen 是橙红，在这里是默认色。
//
// ★ 色值为什么也写死：这是"抄 wushen"这件事的**契约**。wushen 的底色同样是
//   纯黑（`global.css` 的 `body { background-color: black }`），没有"底色不同
//   所以需要调"的余地。要改色就得改这张表，并且在这里写清楚为什么。

/** wushen `global.css` 的标签 → 属性 → 值（逐条抄） */
const TAG_STYLE: ReadonlyArray<readonly [tag: string, prop: string, value: string]> = [
  // 暗色（NOR/BLK/…）
  ['NOR', 'color', '#008000'],
  ['GRE', 'color', '#008000'],
  ['BLK', 'color', '#505050'],
  ['BLU', 'color', '#000080'],
  ['CYN', 'color', '#008080'],
  ['RED', 'color', '#800000'],
  ['MAG', 'color', '#800080'],
  ['YEL', 'color', '#808000'],
  ['WHT', 'color', '#c0c0c0'],
  ['ORA', 'color', '#d26900'],
  // 亮色（HIK/…）
  ['HIK', 'color', '#808080'],
  ['HIB', 'color', '#0000ff'],
  ['HIG', 'color', '#00ff00'],
  ['HIC', 'color', '#00ffff'],
  ['HIR', 'color', '#ff0000'],
  ['HIM', 'color', '#ff00ff'],
  ['HIY', 'color', '#ffff00'],
  ['HIW', 'color', '#ffffff'],
  ['HIO', 'color', '#ffa500'],
  ['HIJ', 'color', '#ffd700'],
  ['HIZ', 'color', '#912cee'],
  // 妖元 / 高品名的橙红（wushen `os/item/obj.js` 的 `grade_color` 末位）
  ['ORD', 'color', '#ff4500'],
  // 背景色（`B*` 与 `HB*` 两族）
  ['BBLK', 'background-color', '#ffffff'],
  ['BBLU', 'background-color', '#000080'],
  ['BCYN', 'background-color', '#008080'],
  ['BRED', 'background-color', '#800000'],
  ['BMAG', 'background-color', '#800080'],
  ['BYEL', 'background-color', '#808000'],
  ['BWHT', 'background-color', '#c0c0c0'],
  ['BHIK', 'background-color', '#808080'],
  ['HBBLU', 'background-color', '#0000ff'],
  ['HBGRN', 'background-color', '#00ff00'],
  ['HBCYN', 'background-color', '#00ffff'],
  ['HBRED', 'background-color', '#ff0000'],
  ['HBMAG', 'background-color', '#ff00ff'],
  ['HBYEL', 'background-color', '#ffff00'],
  ['HBWHT', 'background-color', '#ffffff'],
];

/**
 * 只被"认下来"、没有颜色可言的标签（wushen 里同样不带色）。
 *
 * ★ `CMD` 已**不在**这份清单里（2026-10-16 审查 S1）：它原是白名单内唯一"可点"的标签，
 *   语义是"点一下发一条指令" ⇒ 玩家可控文本（尤其是角色名）能在别人屏幕上植按钮。
 *   可点指令现在只有 `CmdItem` 一条结构化通道，详见 `src/ui/markup.ts` 的 `§CMD`。
 */
const TAG_PLAIN: readonly string[] = ['DEL', 'MEM', 'OPT', 'FLA', 'LINE'];

/** 从 `src/ui/markup.ts` 的源码里取出白名单（`const KNOWN = new Set([...])`） */
function knownTags(): string[] {
  const src = readFileSync(join(ROOT, 'src', 'ui', 'markup.ts'), 'utf8');
  const block = /const KNOWN = new Set\(\[([\s\S]*?)\]\)/.exec(src)?.[1];
  expect(block, '没在 markup.ts 里找到 KNOWN 白名单').toBeTruthy();
  return [...(block ?? '').matchAll(/'([A-Za-z][A-Za-z0-9]*)'/g)].map((m) => m[1] as string);
}

interface CssRule {
  readonly selectors: readonly string[];
  readonly decls: string;
}

/** 去掉注释、切成 `选择器 → 声明块`（嵌套的 `@media` / `@keyframes` 会各自成条） */
function cssRules(css: string): CssRule[] {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out: CssRule[] = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(clean)) !== null) {
    out.push({
      selectors: (m[1] ?? '').split(',').map((s) => s.trim()),
      decls: m[2] ?? '',
    });
  }
  return out;
}

/**
 * 取某条规则里某个属性的值（小写、去空白）。
 *
 * ★ 同一个属性只允许声明**一次**：写两遍就是"两个真相"，谁生效只看文件顺序
 *   —— 这里判红。（选择器可以出现多次：`:root` 在 `@media` 里改 `--shell`/`--fs`
 *   是正当的，但改的是别的属性。）
 */
function declValue(css: string, sel: string, prop: string): string {
  const hits = cssRules(css).filter((r) => r.selectors.includes(sel));
  expect(hits.length, `style.css 里没有 ${sel} 这条规则`).toBeGreaterThan(0);
  const values = hits
    .flatMap((r) => r.decls.split(';'))
    .map((d) => d.trim())
    .filter((d) => d.toLowerCase().startsWith(`${prop.toLowerCase()}:`))
    .map((d) => d.slice(prop.length + 1).trim().toLowerCase());
  expect(
    values.length,
    `${sel} 里 ${prop} 声明了 ${String(values.length)} 次，应该只有一次`,
  ).toBe(1);
  return values[0] ?? '';
}

// ---------------------------------------------------------------------------
// ★★ 点实体：详情落在**物件面板**（26 册 §57 订正 wushen 的落点）
// ---------------------------------------------------------------------------
//
// wushen 的落点是消息流（`process.js:380-403`）：
//   `ReceiveMessage(item.desc)`                       → 描述一行
//   `ReceiveMessage("<div class='item-commands'>…")`  → 命令条一行
// 本项目**照抄过这一条，然后改掉了**（26 册 §57，真机反馈）：
//   照抄的表现是"点店小二 → 描述进日志 → 点打听 → 人字号客房进日志"，
//   玩家的每一次操作都变成历史记录里的一行，下一层按钮要往回翻才点得到。
//   现在改为开物件面板（描述 + 底部按钮），并且**吸收**这期间的播报。
//   `cmds` 包在面板开着时换按钮、面板没开时仍落消息流（保留原来那条落点）。
//
// ⚠️ 历史上另有一条相反的订正（26 册 §20.3）：`item` 包曾被接给 `openPanel`，
//   而当时**全仓库没有生产者**，于是整条链路是死的、点谁都只是把房间描述再打一遍。
//   那条说的是"生产者缺席"，本条说的是"有生产者之后该落在哪"—— 两回事，别互相推翻。

describe('★★ 点实体：详情落在**物件面板**（26 册 §57 订正）', () => {
  it('★ `item` 包 → 面板标题是物件名、正文是描述、底部一条**可点**命令', () => {
    mod.clearStream();
    mod.closePanel();
    mod.dispatchPacket('item', {
      id: 'npc1',
      name: '店小二',
      desc: '店小二\n一个手脚麻利、见人就笑的店小二。',
      commands: [{ cmd: 'ask npc1', name: '打听' }],
    });

    expect(mod.isPanelOpen()).toBe(true);
    expect(document.getElementById('dlgTitle')?.textContent).toBe('店小二');
    // 判据落在**描述文字**上（不是"面板开了就算数"）
    expect(document.getElementById('dlgBody')?.textContent).toContain('手脚麻利');

    // 命令条在**下带** `#dlgFoot`（wushen `.dialog-footer`）里
    const btn = document.querySelector('#dlgFoot .item-commands [data-cmd]') as HTMLElement | null;
    expect(btn, '命令条要在面板里，而且得是**可点**节点').not.toBeNull();
    expect(btn?.textContent).toBe('打听');
    fired.length = 0;
    click(btn);
    expect(fired).toEqual(['ask npc1']);
  });

  it('★ 服务端文本里的换行要保住（`look` 的多行输出不许挤成一行）', () => {
    mod.clearStream();
    mod.pushLine('第一行\n第二行');
    const line = document.getElementById('output')?.firstElementChild;
    // `pushLine` 原来把 `\n` 拆开丢掉，三行输出挤成一行（真机截图 `21-点NPC.png` 可见）
    expect(line?.textContent).toBe('第一行\n第二行');
  });

  it('★ `cmds` 包（面板**没开**）→ 仍是**一条命令条**，不是"全局指令表"', () => {
    mod.clearStream();
    mod.closePanel();
    mod.dispatchPacket('cmds', { items: [{ cmd: 'give x/1000 money', name: '交镖银' }] });
    const btn = document.querySelector('#output .item-commands [data-cmd]');
    expect(btn?.getAttribute('data-cmd')).toBe('give x/1000 money');
    expect(btn?.textContent).toBe('交镖银');
  });

  it('★★ `cmds` 包（物件面板**开着**）→ 换掉面板底部的按钮，不落日志（26 册 §57）', () => {
    mod.clearStream();
    mod.dispatchPacket('item', {
      id: 'npc1',
      name: '店小二',
      desc: '一个店小二。',
      commands: [{ cmd: 'ask npc1', name: '打听' }],
    });
    // 点「打听」之后服务端发回下一层动作
    mod.dispatchPacket('cmds', { items: [{ cmd: 'give npc1 1000 money', name: '人字号客房' }] });

    // 按钮换了（不是"多了一条"）
    const btns = Array.from(document.querySelectorAll('#dlgFoot .item-commands [data-cmd]'));
    expect(btns.map((b) => b.getAttribute('data-cmd'))).toEqual(['give npc1 1000 money']);
    expect(btns[0]?.textContent).toBe('人字号客房');
    // 日志区一行都没有 —— 这就是真机反馈里"人字号客房还在日志区"的修复
    expect(document.querySelectorAll('#output .ln')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// ★★ 动作栏是**单点合成**（wushen `Combat.create_actions`）
// ---------------------------------------------------------------------------
//
// wushen 的 `.room-commands` 只有**一个**写入点：`Combat.create_actions()`
// （`combat.js:83-88`）先 `empty()` 再按序 append
// `actions`（def_actions + 房间扩展）· `object_actions`（`actions` 包）·
// `room_actions`（`room` 包）。任何一次更新都走 `refActions()`，不存在
// "某个包把别人的按钮擦掉"。
//
// 本仓库此前有 **5 条互不知情的写入路径**（`room` / `actions` / `addAction` /
// `removeAction` / `cmds`），谁后到谁赢 —— `cmds` 一到就把 `state.actions` 无视掉。
// 今天动作栏里只有「打坐」一条所以看不出症状；`actions` 一旦真开始发东西，
// 下一次 `room` 帧就会把它静默擦掉。

describe('★★ 动作栏是单点合成（wushen `Combat.create_actions`）', () => {
  const roomFrame = (): void => {
    mod.dispatchPacket('room', {
      path: 'a/b',
      name: '广场',
      desc: '',
      commands: [{ cmd: 'dazuo', name: '打坐' }],
    });
  };

  it('★ `room` 帧与 `actions` 帧**不互相擦**；再推一次 room 也不丢 actions', () => {
    roomFrame();
    mod.dispatchPacket('actions', { items: [{ cmd: 'ask npc1', name: '打听' }] });

    const verbs = document.getElementById('verbs') as HTMLElement;
    expect(verbs.textContent).toContain('打坐');
    expect(verbs.textContent, '`actions` 帧把 room 的动作整块换掉了').toContain('打听');

    // 再推一次 `room`（换房间 / 房间对账重推）—— actions 必须还在
    roomFrame();
    expect(verbs.textContent, '`room` 帧把 actions 整块换掉了').toContain('打听');
  });

  it('★ 点出来的动作发的是服务端给的指令（`data-cmd`），不是按钮上的显示名', () => {
    fired.length = 0;
    mod.dispatchPacket('actions', { items: [{ cmd: 'ask npc1', name: '打听' }] });
    // 按 `data-cmd` 取那一格（而不是"第一格"）：上面那条用例刚推过 `room` 帧，
    // 房间里还留着「打坐」；本用例要验的是"显示名 ≠ 发出去的指令"，
    // 与这一栏里还有别的按钮无关。
    const btn = document.querySelector('#verbs .act-item[data-cmd="ask npc1"]') as HTMLElement | null;
    expect(btn, '服务端给的动作为什么没进动作栏？').not.toBeNull();
    expect(btn?.textContent, '按钮显示名').toBe('打听');
    click(btn);
    expect(fired, '点下去发的必须是 data-cmd，不是显示名').toEqual(['ask npc1']);
  });
});

// ---------------------------------------------------------------------------
// ★★ 动作栏横向可滚（照 wushen `src/combat.js:10-13` 的 `Combat.Scroll`）
// ---------------------------------------------------------------------------
//
// 两条动作栏都是 `white-space: nowrap` + `overflow-x: auto`：动作一多就横向
// 溢出，而全站 `scrollbar-width: none` 又把滚动条藏了。触屏能横滑，鼠标却
// **什么都没有** —— wushen 靠 `Combat.Scroll` 把竖向滚轮的 `deltaY` 加到
// `scrollLeft` 上补这一路，本仓库此前完全没接。
//
// ★ 判据为什么要先"造出溢出条件"：jsdom **没有布局**，`scrollWidth` /
//   `clientWidth` 恒为 0 ⇒ 换算出的位移恒为 0 ⇒ 不拦事件。直接派一次滚轮
//   会得到一条"我什么都不做它也绿"的假断言（铁律 8），所以几何要手工装上。

describe('动作栏横向可滚（滚轮 → scrollLeft）', () => {
  // ★ 冷却推进表是 `ui/room.ts` 的**模块级**状态：不清就会跨用例残留。
  //   实测踩到：上一条用例 arm 出去的定时器还挂着 ⇒ 下一条里
  //   `cdTimer === null` 不成立 ⇒ 表没被重新 arm ⇒ fake timers 推了 1500ms
  //   却什么也没发生（断言拿到上一拍的 100%）。与 `resetSkillsPanel` 同一条规矩。
  afterEach(() => {
    mod.stopCooldownTicker();
  });

  /** jsdom 无布局：临时给盒子装上"可横向滚动"的几何，用完**必须**恢复 */
  function withOverflow(box: HTMLElement, client: number, total: number, fn: () => void): void {
    let left = 0;
    const defs: Array<[string, PropertyDescriptor]> = [
      ['clientWidth', { value: client, configurable: true }],
      ['scrollWidth', { value: total, configurable: true }],
      ['scrollLeft', { get: () => left, set: (v: number) => { left = v; }, configurable: true }],
    ];
    for (const [key, desc] of defs) Object.defineProperty(box, key, desc);
    try {
      fn();
    } finally {
      // 实例属性是 configurable ⇒ 删掉就回到原型上的原生实现
      for (const [key] of defs) delete (box as unknown as Record<string, unknown>)[key];
    }
  }

  it('★ 位移换算：钳在 [0, max] 内，滚到头就不再给位移', () => {
    expect(mod.wheelScrollDelta(50, 300, 120)).toBe(120); // 正常
    expect(mod.wheelScrollDelta(0, 300, -120)).toBe(0); // 已在最左
    expect(mod.wheelScrollDelta(280, 300, 120)).toBe(20); // 只够滚 20 到最右
    expect(mod.wheelScrollDelta(300, 300, 120)).toBe(0); // 已在最右
    expect(mod.wheelScrollDelta(50, 300, 0)).toBe(0); // 没有竖向位移
  });

  for (const id of ['verbs', 'pfms'] as const) {
    it(`★ \`#${id}\` 上的滚轮必须转成横向滚动（动作溢出时鼠标也够得着）`, () => {
      const box = document.getElementById(id) as HTMLElement;
      withOverflow(box, 100, 400, () => {
        const ev = new WheelEvent('wheel', { deltaY: 120, cancelable: true });
        box.dispatchEvent(ev);
        expect(box.scrollLeft, '滚轮没被转成横向位移').toBe(120);
        expect(ev.defaultPrevented, '滚得动时要拦住，别再冒泡去滚消息流').toBe(true);
      });
    });
  }

  it('★ 已在最左还往上滚 ⇒ 不拦事件（让消息流照常滚）', () => {
    const box = document.getElementById('verbs') as HTMLElement;
    withOverflow(box, 100, 400, () => {
      box.scrollLeft = 0;
      const ev = new WheelEvent('wheel', { deltaY: -120, cancelable: true });
      box.dispatchEvent(ev);
      expect(box.scrollLeft).toBe(0);
      expect(ev.defaultPrevented, '不该把滚轮白白吃掉').toBe(false);
    });
  });

  // ───────────────────────────────────────────────────────────────────────
  // ★★ 冷却要有**视觉进度**（照 wushen `combat.js:173-242`）
  //   wushen 给每个招式铺一层灰色渐变，横向比例 = 剩余比例，靠右对齐
  //   （`background-size: N% 100%` + `background-position: 100% 100%`），
  //   每 300ms 推进一拍 ⇒ 冷却走完，灰色从右边退干净。
  //   本仓库的 CSS 把这条渐变**写好了**，却没有任何代码去推它 ⇒ 恒为 0%，
  //   招式冷却在界面上等于没有反馈（只能去 `pFlags` 看「冷却 N」几个字）。
  // ───────────────────────────────────────────────────────────────────────

  it('★ `dispfm` 帧 ⇒ 对应按钮盖上冷却遮罩（`background-size` = 剩余比例）', () => {
    mod.dispatchPacket('perform', {
      items: [{ cmd: 'perform 3v3cl6ifhs', name: '降龙十八掌' }],
    });
    mod.dispatchPacket('dispfm', { id: '3v3cl6ifhs', time: 3000, rtime: 3000 });

    const btn = document.querySelector('#pfms .pfm-item[data-cmd="perform 3v3cl6ifhs"]');
    expect(btn, '招式按钮为什么没进招式栏？').not.toBeNull();
    // ★ 刚发帧 ⇒ 剩余 ≈ 100%（遮罩几乎盖满整格）
    expect(Number.parseFloat((btn as HTMLElement).style.backgroundSize)).toBeGreaterThan(90);
  });

  it('★ 冷却会**自己走完** ⇒ 到点遮罩退干净（不留一条灰）', () => {
    vi.useFakeTimers();
    try {
      mod.dispatchPacket('perform', { items: [{ cmd: 'perform abc', name: '某招' }] });
      mod.dispatchPacket('dispfm', { id: 'abc', time: 3000, rtime: 3000 });

      const btn = () => document.querySelector('#pfms .pfm-item[data-cmd="perform abc"]') as HTMLElement;
      expect(Number.parseFloat(btn().style.backgroundSize)).toBeGreaterThan(90);

      vi.advanceTimersByTime(1500);
      // ★ 走了一半 ⇒ 遮罩也退掉一半（这里正是"以前永远不动"的那条）
      const mid = Number.parseFloat(btn().style.backgroundSize);
      expect(mid).toBeGreaterThan(40);
      expect(mid).toBeLessThan(60);

      vi.advanceTimersByTime(1600);
      expect(btn().style.backgroundSize, '冷却走完了，遮罩就该退干净').toBe('');
    } finally {
      vi.useRealTimers();
    }
  });

  it('★ 没有冷却的按钮：不许凭空多出一条遮罩', () => {
    mod.dispatchPacket('perform', {
      items: [
        { cmd: 'perform x', name: '甲' },
        { cmd: 'perform y', name: '乙' },
      ],
    });
    mod.dispatchPacket('dispfm', { id: 'x', time: 3000, rtime: 3000 });

    const other = document.querySelector('#pfms .pfm-item[data-cmd="perform y"]') as HTMLElement;
    expect(other.style.backgroundSize, '没在冷却的按钮不该被盖').toBe('');
  });
});

// ---------------------------------------------------------------------------
// ★★ 房间区**只留一个滚动器**（wushen 的 `.content-room` 一条 CSS 规则都没有）
// ---------------------------------------------------------------------------
//
// wushen `src/styles/*.css` 里**搜不到** `.content-room`（grep 过整个目录）：
// 它不限高、不滚、用 flex 默认的 `0 1 auto`（空间不够时被压缩）。
// 唯一带滚动的是 `.room_items` —— `game/main.js:36` 的 inline
// `style="max-height: 8rem; overflow-y: auto;"`（由 `Setting.item_autoheight` 控制）。
//
// 本仓库自己给 `.content-room` 加了 `max-height: 42%` + `overflow-y: auto`
// （外加 `flex: none` 挡住压缩），于是**两个滚动器同时存在**：实测
// `.content-room` 304/323 与 `.room_items` 120/306，物件区底边跑到房间区
// 可视区之外；而全站是 `scrollbar-width: none`（两边都抄了 wushen 这条），
// 既没有滚动条、也没有别的东西提示"下面还有 8 个"（26 册 §20.6）。

describe('房间区只留一个滚动器（照 wushen）', () => {
  it('★ `.content-room` 不许有 max-height / overflow / flex 声明', () => {
    const css = readFileSync(join(ROOT, 'src', 'style.css'), 'utf8');
    const decls = cssRules(css)
      .filter((r) => r.selectors.includes('.content-room'))
      .map((r) => r.decls)
      .join(';');
    expect(decls, 'wushen 的 `.content-room` 在 styles 里一条规则都没有').not.toMatch(/max-height/);
    expect(decls, '外层再滚一次 = 嵌套滚动').not.toMatch(/overflow/);
    expect(decls, '`flex: none` 挡住压缩 —— wushen 用的是默认的 `0 1 auto`').not.toMatch(
      /(^|;)\s*flex\s*:/,
    );
  });

  it('★ 唯一那个滚动器是 `.room_items`，值照 wushen 的 inline style', () => {
    const css = readFileSync(join(ROOT, 'src', 'style.css'), 'utf8');
    expect(declValue(css, '.room_items', 'max-height')).toBe('8rem');
    expect(declValue(css, '.room_items', 'overflow-y')).toBe('auto');
  });
});

/** 标签名 → 声明块（只认"整个选择器就是一个纯标识符"的那种规则） */
function tagRules(): Map<string, string[]> {
  const css = readFileSync(join(ROOT, 'src', 'style.css'), 'utf8');
  const map = new Map<string, string[]>();
  for (const rule of cssRules(css)) {
    for (const sel of rule.selectors) {
      if (!/^[A-Za-z][A-Za-z0-9]*$/.test(sel)) continue;
      const key = sel.toUpperCase();
      map.set(key, [...(map.get(key) ?? []), rule.decls]);
    }
  }
  return map;
}

describe('颜色标签 ↔ 样式表（成对）', () => {
  it('★ 白名单里的每个标签，样式表里都有同名规则（漏一个 = 同一段文本两边长得不一样）', () => {
    const rules = tagRules();
    const missing = knownTags().filter((t) => !rules.has(t));
    expect(missing, `style.css 里缺这些标签的规则：${missing.join(', ')}`).toEqual([]);
  });

  it('★ 白名单不多不少，就是 wushen 那一套（删一个、加一个都要在这里说明）', () => {
    const expected = [...TAG_STYLE.map(([t]) => t), ...TAG_PLAIN].sort();
    expect([...knownTags()].sort()).toEqual(expected);
  });

  it('★ 每个有色标签的色值与 wushen 一致（这是"抄 wushen"的契约，不是审美偏好）', () => {
    const rules = tagRules();
    const wrong: string[] = [];
    for (const [tag, prop, value] of TAG_STYLE) {
      const decls = rules.get(tag) ?? [];
      const hit = decls.some((d) =>
        new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`, 'i').exec(d)?.[1]?.trim().toLowerCase() === value,
      );
      if (!hit) {
        const got = decls.map((d) => `${tag}{${d.trim()}}`).join(' ') || `${tag} 没有任何规则`;
        wrong.push(`${tag} 期望 ${prop}: ${value}，实际 ${got}`);
      }
    }
    expect(wrong, wrong.join('\n')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// #pFlags · 战斗 / 状态 / 冷却摘要
// ---------------------------------------------------------------------------

describe('#pFlags · 战斗 / 状态 / 冷却摘要（R6 / R7，2026-10-17 审查）', () => {
  // ★ L2 把 `state.fighting` / `statuses` / `cooldowns` 接到 `#pFlags`，但**一个字都没测**
  //   —— 本批审查 R6 抓到的"改了没人守"。这里补齐：三族帧各驱动一次，断言 DOM 上的摘要。
  const flags = (): string => document.getElementById('pFlags')?.textContent ?? '';

  it('combat 帧 → 摘要出现「战斗中」；停手 → 消失', () => {
    mod.dispatchPacket('combat', { start: 1 });
    expect(flags()).toContain('战斗中');
    mod.dispatchPacket('combat', { start: 0 });
    expect(flags()).not.toContain('战斗中');
  });

  it('★ combat 开打 → #pfms 出现「逃跑」；停手 → 收起（战斗动作入口）', () => {
    // 先清掉上一条用例可能留在 state.pfms 里的招式（本文件没有逐例重置状态）
    mod.dispatchPacket('perform', { items: [] });

    const labels = (): string[] =>
      Array.from(document.querySelectorAll('#pfms .pfm-item')).map((n) => n.textContent ?? '');

    mod.dispatchPacket('combat', { start: 1 });
    expect(labels()).toEqual(['逃跑']);
    // 点下去的触发词必须是 `flee`（服务端 `combat/flee` 的别名之一）
    expect(document.querySelector('#pfms .pfm-item')?.getAttribute('data-cmd')).toBe('flee');

    mod.dispatchPacket('combat', { start: 0 });
    expect(labels()).toEqual([]);
  });

  it('status 帧 → 名字进摘要；clear → 清空', () => {
    mod.dispatchPacket('status', { action: 'add', id: 'poison', name: '中毒' });
    expect(flags()).toContain('中毒');
    mod.dispatchPacket('status', { action: 'clear' });
    expect(flags()).not.toContain('中毒');
  });

  it('★ 冷却帧 → 「冷却 N」出现，且 clear 后消失（R7：不补 `renderStatus()` 这条会红）', () => {
    // 干净起点：先清一次（`clearDistime` 自己也会重绘）
    mod.dispatchPacket('clearDistime', {});
    mod.dispatchPacket('dispfm', { id: 'sword', rtime: 100 });
    // ★ 判据：`dispfm` 改完 `state.cooldowns` 必须**立即重绘**。若 handler 只改状态、
    //   不调 `renderStatus()`（R7 修的问题）⇒ 这里读到的是**上一次**绘制的旧值 ⇒ 红。
    expect(flags()).toContain('冷却 1');
    mod.dispatchPacket('clearDistime', {});
    expect(flags()).not.toContain('冷却');
  });
});

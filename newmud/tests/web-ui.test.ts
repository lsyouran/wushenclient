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
import { beforeAll, describe, expect, it } from 'vitest';
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

type Vitals = { hp: number; maxHp: number; mp: number; maxMp: number; qi: number; level: number };

let mod: {
  dispatchPacket: (type: string, payload: Record<string, unknown>) => boolean;
  registeredTypes: () => readonly string[];
  SERVER_PACKET_TYPES: readonly string[];
  state: () => { vitals: Vitals; roleId: string; items: readonly unknown[] };
  resetNodeCache: () => void;
  // room
  bindRoom: (h: {
    run(cmd: string): void;
    pick(id: string, name: string, isPlayer: boolean): void;
  }) => void;
  renderScene: () => void;
  renderActionBar: () => void;
  renderAll: () => void;
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
  openPanel: (title: string, rows: readonly string[], cmds?: readonly { cmd: string; name: string }[]) => void;
  closePanel: () => void;
  isPanelOpen: () => boolean;
  panelRows: () => readonly string[];
  notePanel: (line: string) => void;
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
    closePanel: panel.closePanel,
    isPanelOpen: panel.isPanelOpen,
    panelRows: panel.panelRows,
    notePanel: panel.notePanel,
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
    // ★ `float: right` 是观感特征：条子钉在右边，掉血时长出来的是**左边**的空档
    expect(declValue(css, '.progress>.bar', 'float')).toBe('right');

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

  it('★★ item 包 → 描述与命令条都进**消息流**，**不开**面板（wushen `Process.item`）', () => {
    mod.clearStream();
    mod.closePanel();
    mod.dispatchPacket('item', { id: 'x', name: '铁剑', desc: '一把铁剑。', commands: [{ cmd: 'get x', name: '拿起' }] });

    // wushen `process.js:380-403`：`ReceiveMessage(item.desc)` + 命令条 `item-commands`
    // 都落消息流；`.dialog` 是地图 / 属性 / 背包那些面板的地盘，不接物件详情。
    expect(document.getElementById('output')?.textContent).toContain('一把铁剑。');
    expect(mod.isPanelOpen(), 'wushen 的物件详情不进 .dialog').toBe(false);

    const btn = document.querySelector('#output .item-commands [data-cmd]');
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
    mod.dispatchPacket('warn', { content: '你看到一只野狼。' });
    expect(document.querySelectorAll('#output .ln')).toHaveLength(1);
    expect(document.getElementById('output')?.textContent).toContain('你看到一只野狼。');
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
    expect(one.h, '只有一个出口时框还是满高 96 —— 全是空的').toBeLessThan(96);

    mod.dispatchPacket('exits', {
      items: { north: '客栈', south: '药铺', east: '东市', west: '西市', northeast: '巷口' },
    });
    const many = viewBoxOf();
    expect(many.h).toBeGreaterThan(one.h);
    expect(many.h).toBeLessThanOrEqual(96);

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
    // 一行 = 格子高 18 + 上下留白；留白给足 4 也只到 26
    expect(vb.h).toBeLessThanOrEqual(30);
    // 中心格必须完整在框里
    const centre = document.querySelector('#mapSvg .ccg rect');
    expect(Number(centre?.getAttribute('y'))).toBeGreaterThanOrEqual(vb.y);
    expect(Number(centre?.getAttribute('y')) + 18).toBeLessThanOrEqual(vb.y + vb.h);
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
    const owned = new Set(['look', 'cmd', 'chat']);
    expect(acts.filter((a) => !owned.has(a))).toEqual([]);
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

  it('★ 面板开着时 `warn` 回显同时进面板（wushen 的 dialog 模型）', () => {
    mod.openPanel('店小二', ['一个跑堂的。']);
    mod.dispatchPacket('warn', { content: '店小二打量了你一眼。' });
    expect(mod.panelRows()).toContain('店小二打量了你一眼。');
    // 消息流里照样有一份（面板是附加视图，不是替代）
    expect(document.getElementById('output')?.textContent).toContain('店小二打量了你一眼。');
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
    click(document.querySelector('#dlgBody .item-commands span'));
    expect(fired).toEqual(['get x']);
    mod.closePanel();
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
    const real = new Set(['look', 'go', 'say', 'chat', 'shout', 'tell']);
    expect(cmds.length).toBeGreaterThan(0);
    expect(cmds.filter((c) => c === null || !real.has(c))).toEqual([]);
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
// ★★ 点实体：详情落在**消息流**（wushen `Process.item` / `Process.cmds`）
// ---------------------------------------------------------------------------
//
// wushen 里这条链路的落点就是消息流（`process.js:380-403`）：
//   `ReceiveMessage(item.desc)`                       → 描述一行
//   `ReceiveMessage("<div class='item-commands'>…")`  → 命令条一行
// 它**不开** dialog —— `.dialog` 是地图 / 属性 / 背包 / 技能那些面板的地盘。
// 本仓库此前把 `item` 包接给了 `openPanel`，而**全仓库没有任何生产者**，
// 于是整条链路是死的：点谁都只是把房间描述再打一遍（真机复核，26 册 §20.3）。

describe('★★ 点实体：详情落在消息流（wushen `Process.item`）', () => {
  it('★ `item` 包 → 描述进消息流 + 一条**可点**的命令条；不开面板', () => {
    mod.clearStream();
    mod.closePanel();
    mod.dispatchPacket('item', {
      id: 'npc1',
      name: '店小二',
      desc: '店小二\n一个手脚麻利、见人就笑的店小二。',
      commands: [{ cmd: 'ask npc1', name: '打听' }],
    });

    const out = document.getElementById('output') as HTMLElement;
    // 判据落在**描述文字**上（不是"消息流多了一个节点就算数"）
    expect(out.textContent).toContain('手脚麻利');
    expect(mod.isPanelOpen(), 'wushen 的物件详情进消息流，不开 .dialog').toBe(false);

    const btn = out.querySelector('.item-commands [data-cmd]') as HTMLElement | null;
    expect(btn, '命令条要在消息流里，而且得是**可点**节点').not.toBeNull();
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

  it('★ `cmds` 包 = **一条命令条**（wushen `Process.cmds`），不是"全局指令表"', () => {
    mod.clearStream();
    mod.dispatchPacket('cmds', { items: [{ cmd: 'give x/1000 money', name: '交镖银' }] });
    const btn = document.querySelector('#output .item-commands [data-cmd]');
    expect(btn?.getAttribute('data-cmd')).toBe('give x/1000 money');
    expect(btn?.textContent).toBe('交镖银');
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

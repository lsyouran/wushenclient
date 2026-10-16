/**
 * src/main.ts — 前端入口（接线层）
 * ============================================================================
 * 接线顺序：DOM 就绪 → 绑定各块（认证 / 房间 / 地图 / 工具条 / 输入浮层 / 面板）
 * → 等玩家提交名号 → 连接 → 登录 → 切屏。
 *
 * ★ 与 wushen 的 `startup.js` 的差别：wushen 把连接、登录、面板初始化散在
 *   `Process` / `Dialog` / `Combat` 三个对象里互相调用（`Process.init()` 依赖
 *   `Dialog`，`Dialog` 又依赖 `Process`）。这里**单向**：main 认识所有模块，
 *   模块之间不互相 import 彼此的 UI 状态 —— 于是"谁先初始化"不存在悬念。
 *
 * ★ 指令只有**一个出口** `run()`：房间动作、小地图格子、工具条、浮层、
 *   面板里的命令按钮都走它（回显也只在那里写一次）。
 */

import { MudClient } from './net/client.js';
import { LOGIN_TIMEOUT_MS, LoginWatchdog } from './net/login-watchdog.js';
import { ReconnectPolicy, decideOnClose } from './net/reconnect.js';
import { dispatchPacket, setErrorSink } from './process/index.js';
import { bindStream, clearStream, pushLine, pushRule, setStreamRunner } from './ui/stream.js';
import { bindRoom, renderActionBar, renderAll, renderScene } from './ui/room.js';
import { bindMap, renderMap, setMapRunner } from './ui/map.js';
import { bindBars } from './ui/bars.js';
import {
  anyInputOpen,
  bindInputs,
  closeInputs,
  openChat,
  openCmd,
  resetInputs,
  setChatTarget,
} from './ui/input.js';
import { bindPanel, closePanel, closeWarn, openPanel, resetPanels, setPanelRunner } from './ui/panel.js';
import { renderStatus } from './ui/status.js';
import {
  bindAuth,
  prefillName,
  renderServerLabel,
  serverReachable,
  serverUrl,
  setAuthBusy,
  setAuthStatus,
  setAuthTab,
  validateName,
} from './ui/auth.js';
import { showScreen } from './ui/screens.js';
import { rememberRole, resetWorldFacts, state } from './state.js';

// ---------------------------------------------------------------------------
// 会话状态
// ---------------------------------------------------------------------------

/** 本次要登录的名号；`onOpen` 用它拼 `login` 包 */
let pendingName: string | null = null;

/**
 * 掉线后的退避重连（F3，2026-10-16 审查）。
 *
 * ★ 策略是纯的（`net/reconnect.ts`，可单测）；**定时器留在这里** —— 它是接线层的事。
 * ★ 重连成功后 `onOpen` 会拿 `pendingName` 重新发 `login`，所以重连途中**不清**它。
 */
const reconnectPolicy = new ReconnectPolicy();
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

function clearReconnectTimer(): void {
  if (reconnectTimer === null) return;
  clearTimeout(reconnectTimer);
  reconnectTimer = null;
}

/**
 * 登录看门狗（F2，2026-10-16 审查）。
 *
 * 原先 `onOpen` 发出 `login` 之后**没有任何出口**：服务端若握手成功却不回 `login`
 * （崩了 / 卡了 / 版本不匹配），界面永久停在"正在进入江湖……"，玩家只能刷新页面。
 */
const loginWatchdog = new LoginWatchdog(LOGIN_TIMEOUT_MS, () => {
  client.close();
  pendingName = null;
  backToAuth();
  setAuthStatus('服务器没有响应登录请求，请稍后重试。', 'error');
});

// ★ 这里原先有一个 `ignoreNextClose` 标记，用来区分"自己关的"与"掉线"
//   （2026-10-16 审查 S3 已移除）。它的问题是**会被别人消耗掉**：
//   多条 socket 并存时（而这在 CONNECTING 窗口里很容易发生 —— 见 `beginSession`
//   的说明），孤儿那条的 `close` 会先把标记吃掉，于是**真正的掉线**反而被当成
//   自愿关闭、一声不吭；反过来，孤儿迟到的 `close` 也会把正在游戏的玩家带回认证屏。
//
//   ⇒ 现在这件事由**socket 身份**判定（`src/net/client.ts` 的 `#isCurrent()`）：
//     只有"当前被跟踪的那条"的 `close` 才算数。每条连接对自己负责，
//     不需要一个会被别人抄走的全局标记。

// ---------------------------------------------------------------------------
// 发指令（唯一出口）
// ---------------------------------------------------------------------------

/**
 * 发指令（唯一出口）。
 *
 * ★ **不回显**。wushen 的 `SendCommand` 只做 `Dialog.extend.record(cmd)`
 *   （`client.js:68`）—— 记进 ↑ 键的历史，不往消息流写一行。本项目照着它
 *   去掉了回显：一则点出来的动作会把 `look 1lz6o89mxp` 这种 10 位随机 id
 *   写进屏幕（26 册 §20.5），二则输入历史本来就由 `ui/input.ts` 自己管
 *   （↑ 翻上一条的断言在 `tests/web-ui.test.ts`），两处各写一份才是重复。
 */
function run(cmd: string): void {
  const text = cmd.trim();
  if (text === '') return;
  client.sendCommand(text);
}

/** 需要提示时落一行到消息流（浮层里放不下、也不该占浮层的地方） */
function hint(text: string): void {
  pushLine(text, 'sys');
}

// ---------------------------------------------------------------------------
// 客户端
// ---------------------------------------------------------------------------

const client = new MudClient({
  onOpen: () => {
    state.connected = true;
    // 连上了 ⇒ 取消待触发的重连、退避归零（下一次断线从最短延迟重新开始）
    clearReconnectTimer();
    reconnectPolicy.reset();
    if (pendingName === null) return;
    setAuthStatus('已连接，正在进入江湖……', 'busy');
    client.sendPacket({ type: 'login', token: ensureToken(), role_id: pendingName });
    // ★ 发完 login 就开始盯表（F2）：服务端迟迟不回，到点把玩家放回认证屏并说明原因
    loginWatchdog.arm();
  },
  onClose: (code, reason) => {
    // ★ 能走到这里的一定是"当前那一条"断了（作废过的 socket 的事件进不来，
    //   见 `src/net/client.ts` 的身份判定）⇒ 不用再猜是不是自己关的。
    const wasPlaying = state.loggedIn;
    const why = reason === '' ? '' : ` ${reason}`;
    state.connected = false;
    loginWatchdog.disarm(); // 断线本身就是"登录请求有结果了"的一种：别再报超时

    // ★ 该不该重连只有一个判据（`net/reconnect.ts#decideOnClose`，可单测）
    const decision = decideOnClose(wasPlaying, reconnectPolicy);

    if (decision.kind === 'report-only') {
      // 认证期断线（没进过游戏）：多半是没启动服务 ⇒ 如实报错，不浪费重试次数
      pendingName = null;
      backToAuth();
      setAuthStatus(`无法连接服务器（${code}${why}）。请确认服务已启动。`, 'error');
      return;
    }

    if (decision.kind === 'give-up') {
      pendingName = null;
      reconnectPolicy.reset();
      backToAuth();
      setAuthStatus(`与服务器断开（${code}${why}），重连多次未成功，请重新进入。`, 'error');
      return;
    }

    // 曾在游戏里断线 ⇒ 回认证屏等一会儿再连（`pendingName` 留给 `onOpen` 重新发 login）。
    //   ⚠️ 当前服务端**没有存档**（T12 未落地）⇒ 重连等于开一个新会话，
    //      角色状态不会恢复（见 26 册 §14.6 缺口 2）。这条提示如实说"重连"，不说"恢复到原处"。
    backToAuth();
    setAuthStatus(`与服务器断开，${String(Math.round(decision.delayMs / 1000))} 秒后重连……`, 'busy');
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      client.connect(serverUrl());
    }, decision.delayMs);
  },
  onPacket: (type, payload) => {
    // ★ 登录请求有结果了（成功 / 失败）⇒ 停表（F2）
    if (type === 'login' || type === 'loginerror') loginWatchdog.disarm();
    const handled = dispatchPacket(type, payload);
    // ★ 没 handler 的包必须**说出来**：否则协议漂移表现为"某些功能静默失效"
    if (!handled) pushLine(`【未处理的包】${type}`, 'err');
  },
  onText: (text) => {
    pushLine(text);
  },
  onError: (message) => {
    // 还没进游戏时，该说的是"认证界面上出错了"，而不是往（隐藏的）消息流里塞一行
    if (!state.loggedIn) setAuthStatus(message, 'error');
    else pushLine(message, 'err');
  },
});

setErrorSink((type, e) => {
  pushLine(`【包处理出错】${type}：${e instanceof Error ? e.message : String(e)}`, 'err');
});

// ---------------------------------------------------------------------------
// 认证 ↔ 游戏（切屏、清场）
// ---------------------------------------------------------------------------

/** 回到认证界面，并把这一局的所有界面状态清干净 */
function backToAuth(): void {
  resetWorldFacts();
  resetPanels();
  resetInputs();
  closeWarn();
  clearStream();
  setAuthBusy(false);
  setAuthTab('login');
  showScreen('auth');
}

/**
 * 提交名号 → 发起连接。
 *
 * ★ `mode === 'register'` 时换一个**新的** token：登入是"回到原身份"，新建是"另起一个"
 *   —— 服务端目前不验签（只校验长度），这只是把两个入口的语义分开，不假装它是安全边界。
 */
function beginSession(mode: 'login' | 'register', rawName: string): void {
  const name = rawName.trim();
  const problem = validateName(name);
  if (problem !== null) {
    setAuthStatus(problem, 'error');
    return;
  }
  if (!serverReachable()) {
    setAuthStatus('请用 `npm start` 启动服务后，经 http 地址打开本页（不要直接双击网页文件）。', 'error');
    return;
  }

  if (mode === 'register') newToken();
  rememberRole(name);
  pendingName = name;

  setAuthBusy(true);
  setAuthStatus(`正在连接 ${serverUrl()} ……`, 'busy');

  // ★ 正在连接途中 ⇒ **忽略**这次提交（2026-10-16 审查 S3）。
  //   判据必须是 `occupied`（含 CONNECTING）而不是 `connected`（只认 OPEN）：
  //   握手未完成的那段时间里旧写法会放行，于是每一条提交都再开一条 socket。
  //   而输入框的 Enter 通道不受"按钮已 disable"约束（`ui/auth.ts` 只 disable 按钮），
  //   按住 Enter 几秒就能造出几十条 —— 服务端那边每条都占着一个名额。
  //   ⇒ 收口的落点选在这里而不是 `ui/auth.ts`：Enter 与按钮两条入口都归到本函数，
  //     一处拦住，不会出现"按钮挡住了、Enter 没挡住"的口径分家。
  // ★ 玩家主动重新进入 ⇒ 清掉挂着的重连、退避归零（F3）：他刚才的意思就是"现在就试"
  clearReconnectTimer();
  reconnectPolicy.reset();

  if (client.occupied) return;

  client.connect(serverUrl());
}

/** 登出 / 换号：收回连接，回到认证界面 */
function logout(): void {
  const wasPlaying = state.loggedIn;
  // ★ 主动登出 ⇒ 取消挂着的重连（F3）：别让"我退出了"过一会儿又被自动连回去
  clearReconnectTimer();
  reconnectPolicy.reset();
  loginWatchdog.disarm();
  // 收连接不需要判状态：`close()` 对"没连 / 还在握手"都是幂等的（见 `MudClient`）
  client.close();
  pendingName = null;
  backToAuth();
  setAuthStatus(wasPlaying ? '已退出江湖。' : '尚未连接', 'idle');
}

// ---------------------------------------------------------------------------
// 会话 token
// ---------------------------------------------------------------------------

/**
 * ⚠️ token 是**本地生成的临时标识**，不是凭据：服务端目前只校验长度（16–256），
 *   没有验签（docs/26 §14.6 的 T12）。这里不假装它是安全的 —— 变量名叫 `token`
 *   而不叫 `password`，注释也写清楚。
 */
const TOKEN_KEY = 'mud.token';

/** 登入：复用本机已存的标识；没有就新生成一个（同一台机器 = 同一个身份） */
function ensureToken(): string {
  const saved = localStorage.getItem(TOKEN_KEY);
  if (saved !== null && saved.length >= 16) return saved;
  return newToken();
}

/** 生成并保存一个新的随机标识 */
function newToken(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const buf = new Uint8Array(24);
  crypto.getRandomValues(buf);
  let out = '';
  for (const b of buf) out += chars[b % chars.length];
  localStorage.setItem(TOKEN_KEY, out);
  return out;
}

// ---------------------------------------------------------------------------
// 绑定
// ---------------------------------------------------------------------------

function bind(): void {
  bindAuth({ onSubmit: beginSession });

  // ① 房间区：点出口直接走，点人/物看详情（顺带成为私语对象）
  //    ★ 点实体发的是 `select <id>`（wushen `process.js:187` 的
  //      `SendCommand("select " + id)`）—— `look` 看的是房间，`select` 看的是那个东西。
  bindRoom({
    run: (cmd) => run(cmd),
    pick: (id, name, isPlayer) => {
      if (isPlayer) setChatTarget(name);
      run(`select ${id}`);
    },
  });

  // ② 小地图：点格子 = 往那个方向走
  setMapRunner(run);
  bindMap();

  // ③ 工具条：环顾 / 指令 / 聊天（只有服务端认的指令才配按钮）
  bindBars({
    run: (cmd) => run(cmd),
    openCmd: () => openCmd(),
    openChat: () => openChat(),
    hint: (text) => hint(text),
  });

  // ④ 输入浮层（指令 / 聊天）
  bindInputs({ run: (cmd) => run(cmd), hint: (text) => hint(text) });

  // ⑤ 面板（属性 / 行囊 …）与提示框
  setPanelRunner(run);
  bindPanel();

  // ⑥ 消息流：滚到底就把"回到底部"浮标收掉；点命令条里的按钮也走 `run()`
  setStreamRunner(run);
  bindStream();

  // ⑦ 这里原先还有一句 `setCmdRunner(run)` —— 已随 `<CMD>` 一并删除（审查 S1）。
  //    服务端**自由文本**里的按钮已不存在：可点指令只有 `CmdItem` 一条路
  //    （`cmds` / `actions` 帧、`showWarn`、`openPanel`、消息流的命令行），
  //    它们是数据与显示分离的，玩家文本掺不进去。见 `src/ui/markup.ts` 的 `§CMD`。

  // ⑧ Esc 一键收场（浮层 → 面板 → 提示框）
  document.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Escape') return;
    if (anyInputOpen()) {
      closeInputs();
      return;
    }
    closeWarn();
    closePanel();
  });
}

// ---------------------------------------------------------------------------
// 首屏
// ---------------------------------------------------------------------------

renderServerLabel();
prefillName(state.roleId);
setAuthStatus(serverReachable() ? '尚未连接' : '未通过服务器打开', serverReachable() ? 'idle' : 'error');
showScreen('auth');
bind();

// 便于在控制台调试（不影响正常使用）
Object.assign(window as unknown as Record<string, unknown>, {
  mud: {
    client,
    state,
    run,
    logout,
    openCmd,
    openChat,
    openPanel,
    closePanel,
    renderScene,
    renderActionBar,
    renderMap,
    renderAll,
    renderStatus,
    pushRule,
  },
});

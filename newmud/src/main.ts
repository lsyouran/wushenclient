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
import { setCmdRunner } from './ui/markup.js';
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
 * 这一次 `onClose` 是**我们自己**关的（**登出**），不是掉线 —— 别拿它当异常报。
 *
 * ⚠️ 旧注释写的是"（重连/登出）"，但**前端目前没有重连**（2026-10-14 复查确认：
 * `src/` 下无任何 reconnect / 退避重试实现，`onClose` 一律 `backToAuth()`）。
 * 重连归账号批次 ⇒ 注释已从"重连/登出"改为"登出"，避免读者以为有这条路。
 */
let ignoreNextClose = false;

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
    if (pendingName === null) return;
    setAuthStatus('已连接，正在进入江湖……', 'busy');
    client.sendPacket({ type: 'login', token: ensureToken(), role_id: pendingName });
  },
  onClose: (code, reason) => {
    if (ignoreNextClose) {
      ignoreNextClose = false;
      return;
    }
    const wasPlaying = state.loggedIn;
    state.connected = false;
    pendingName = null;
    backToAuth();
    const why = reason === '' ? '' : ` ${reason}`;
    setAuthStatus(
      wasPlaying
        ? `与服务器断开（${code}${why}），请重新进入。`
        : `无法连接服务器（${code}${why}）。请确认服务已启动。`,
      'error',
    );
  },
  onPacket: (type, payload) => {
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
  // 旧连接还在就先收回（连一次就是一条 socket，别让它悬着）
  if (client.connected) {
    ignoreNextClose = true;
    client.close();
  }
  client.connect(serverUrl());
}

/** 登出 / 换号：收回连接，回到认证界面 */
function logout(): void {
  const wasPlaying = state.loggedIn;
  if (client.connected) {
    ignoreNextClose = true;
    client.close();
  }
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

  // ⑦ 服务端文本里的 `<CMD>` 标签点了也要能执行
  setCmdRunner(run);

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

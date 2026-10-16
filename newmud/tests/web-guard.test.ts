// @vitest-environment jsdom
/**
 * tests/web-guard.test.ts —— 会话边界的两道守卫（审查报告 S2 / S3 的回归）
 * ============================================================================
 * 来源：`D:/ts-mud/_audit-代码缺陷与安全审查-2026-10-16.md`（2026-10-16 只读审查）。
 * 本文件是那两条的**落地判据**，写于修复之前（项目 fix-before-assert 铁律）。
 *
 * ── S2：`loginerror` 不是"只会在认证界面到达"的帧 ────────────────────────
 *   服务端 `session.ts#errorPacket` 把**所有**错误都包成 `loginerror`，
 *   于是「游戏中被限流」也走这条通道：`RATE_LIMIT_PER_5S = 20`，玩家连点地图格子
 *   就能在 5 秒内打出第 21 帧 ⇒ `frame-pipeline.ts` 回 `RATE_LIMITED`（`close=false`）。
 *   旧实现（`role.ts:47-55`）无条件 `showScreen('auth')` ⇒ 连接完好、角色在线，
 *   人却被甩回登录页，还写着"登录失败"。
 *   ⇒ 判据：**已登录时不切屏**，原因进消息流。
 *
 * ── S3：`MudClient.connect()` 不回收仍在 CONNECTING 的旧 socket ────────────
 *   `connected` 只认 `OPEN` ⇒ CONNECTING 期间守卫失效 ⇒ 在名号框按住 Enter
 *   （`auth.ts` 的 Enter 通道不受 `setAuthBusy` 管制）每按一次新建一条 WebSocket，
 *   旧的不关、监听还挂着：
 *     ① 孤儿 connection 因浏览器自动回 pong 而一直刷新 `lastSeenMs` ⇒ 服务端
 *        `pruneIdle()` 永远踢不掉 ⇒ 占死 `MAX_CONNECTIONS` 名额；
 *     ② 孤儿一旦关闭，`ignoreNextClose` 早被消耗 ⇒ 正在游戏的玩家被带回认证屏。
 *   ⇒ 判据：**每条 socket 只对"我是不是当前被跟踪的那条"负责**（身份判断），
 *     取代那种会被别人消耗掉的一次性标记。
 *
 * ★ 两条都留了**反向锚点**：本该切屏 / 本该回调的时候必须照做 ——
 *   否则就是把 bugs 修成了"永不回认证 / 永不报断线"。
 */

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PROTOCOL_VERSION } from '../shared/constants.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// ---------------------------------------------------------------------------
// S2：DOM 装置（与 `tests/web-ui.test.ts` 同一套做法）
// ---------------------------------------------------------------------------

type Mods = {
  dispatchPacket: (type: string, payload: Record<string, unknown>) => boolean;
  currentScreen: () => 'auth' | 'game';
  showScreen: (which: 'auth' | 'game') => void;
  state: { loggedIn: boolean };
  resetNodeCache: () => void;
  pushLine: (text: string, kind?: string) => void;
  clearStream: () => void;
  streamText: () => string;
  authStatusText: () => string;
  setAuthStatus: (text: string, kind?: 'idle' | 'busy' | 'error') => void;
};

let mod: Mods;

function mountHtml(): void {
  const html = readFileSync(join(ROOT, 'src', 'index.html'), 'utf8');
  const body = /<body>([\s\S]*)<\/body>/.exec(html)?.[1] ?? '';
  document.body.innerHTML = body.replace(/<script[\s\S]*?<\/script>/g, '');
}

beforeAll(async () => {
  mountHtml();
  const dom = await import('../src/ui/dom.js');
  const process = await import('../src/process/index.js');
  const appState = await import('../src/state.js');
  const stream = await import('../src/ui/stream.js');
  const screens = await import('../src/ui/screens.js');
  const authStatus = await import('../src/ui/auth.js');

  dom.resetNodeCache();

  mod = {
    dispatchPacket: process.dispatchPacket,
    currentScreen: screens.currentScreen,
    showScreen: screens.showScreen,
    state: appState.state,
    resetNodeCache: dom.resetNodeCache,
    pushLine: stream.pushLine as (text: string, kind?: string) => void,
    clearStream: stream.clearStream,
    streamText: () => document.getElementById('output')?.textContent ?? '',
    authStatusText: () => document.getElementById('authStatus')?.textContent ?? '',
    setAuthStatus: authStatus.setAuthStatus,
  };
});

/**
 * 统一的初始状态。
 *
 * ★★ **`showScreen('game')` 这一步不能省**（FG-14 那类教训）：#app 初始是 `hidden`，
 *   也就是"本来就在 auth 屏"。若从这里出发，"收到 loginerror 后仍在 auth"与
 *   "handler 把它拨回 auth"是**同一个观察值** ⇒ 反向锚点会变成恒绿的假判据。
 *   把起点人为拨到 game，两个方向才都咬得住。
 */
const STATUS_SENTINEL = '【哨兵】本条不该被改写';

function intoLoggedInGame(): void {
  mod.resetNodeCache();
  mod.clearStream();
  mod.setAuthStatus(STATUS_SENTINEL);
  mod.state.loggedIn = true;
  mod.showScreen('game');
}

function intoUnloggedStart(): void {
  mod.resetNodeCache();
  mod.clearStream();
  mod.setAuthStatus(STATUS_SENTINEL);
  mod.state.loggedIn = false;
  mod.showScreen('game'); // 同上：起点拨到 game，才看得出 handler 有没有把它拨回来
}

describe('S2 · loginerror 的屏幕归属', () => {
  it('【反向锚点】未登录时收到 loginerror → 拨回认证屏，且报出失败原因', () => {
    intoUnloggedStart();

    expect(mod.dispatchPacket('loginerror', { code: 'REG_NAME_TAKEN', msg: '角色名已有人用' })).toBe(
      true,
    );

    expect(mod.currentScreen()).toBe('auth');
    expect(mod.authStatusText()).toContain('角色名已有人用');
  });

  it('已登录时收到 loginerror → 留在游戏屏，不被甩回登录页', () => {
    intoLoggedInGame();

    mod.dispatchPacket('loginerror', { code: 'RATE_LIMITED', msg: '操作过于频繁' });

    // ★ 判据落在**屏幕归属**上（区分性字段：修正前后唯一的差别就是这里）
    expect(mod.currentScreen()).toBe('game');
  });

  it('已登录时被拒 → 原因进消息流，且不伪装成"登录失败"', () => {
    intoLoggedInGame();

    mod.dispatchPacket('loginerror', { code: 'RATE_LIMITED', msg: '操作过于频繁' });

    const text = mod.streamText();
    expect(text).toContain('操作过于频繁');
    // ★ "登录失败"是所有错误复用 loginerror 通道时期留下的措辞；
    //   它还出现在消息流里，就说明"已登录"这一支没走到
    expect(text).not.toContain('登录失败');
  });

  it('已登录时被拒 → 不去写认证界面的状态栏（那一栏此刻不可见，写了是误导）', () => {
    intoLoggedInGame();

    mod.dispatchPacket('loginerror', { code: 'RATE_LIMITED', msg: '操作过于频繁' });

    expect(mod.authStatusText()).toBe(STATUS_SENTINEL);
  });
});

// ---------------------------------------------------------------------------
// S3：假 WebSocket（可控状态机；真实 socket 的状态由浏览器决定，测不了这些路径）
// ---------------------------------------------------------------------------

const CONNECTING = 0;
const OPEN = 1;
const CLOSED = 3;

interface CloseEventLike {
  readonly code: number;
  readonly reason: string;
}

class FakeSocket {
  // ★ 与浏览器 `WebSocket` 同名的静态常量：`MudClient` 的每个守卫都写
  //   `readyState === WebSocket.OPEN` —— 夹具缺了它们，那些守卫就永远为假
  //   （表现是"发什么都没反应"，而不是测试失败），曾让 S10 的反向锚点假红。
  public static readonly CONNECTING = CONNECTING;
  public static readonly OPEN = OPEN;
  public static readonly CLOSING = 2;
  public static readonly CLOSED = CLOSED;

  public readyState: number = CONNECTING;
  public readonly closed: CloseEventLike[] = [];
  public readonly sent: string[] = [];
  readonly #listeners = new Map<string, Set<(ev: unknown) => void>>();

  public constructor(public readonly url: string) {
    FakeSocket.created.push(this);
  }

  public addEventListener(type: string, fn: (ev: unknown) => void): void {
    const set = this.#listeners.get(type) ?? new Set();
    set.add(fn);
    this.#listeners.set(type, set);
  }

  public close(code = 1000, reason = ''): void {
    this.closed.push({ code, reason });
    this.readyState = CLOSED;
    // 真实的 close 事件是**异步**到达的 —— 正是这一点让旧实现的
    // "把 #socket 置 null 就算完"成为漏洞：事件回来时没人认得它。
    FakeSocket.flush(() => this.#emit('close', { code, reason }));
  }

  /** 测试驱动：这条 socket 连上了 */
  public reachOpen(): void {
    this.readyState = OPEN;
    this.#emit('open', {});
  }

  /** 测试驱动：服务端把它关了 */
  public serverClosed(code = 1011, reason = '服务端断了'): void {
    this.readyState = CLOSED;
    this.#emit('close', { code, reason });
  }

  public send(text: string): void {
    if (this.readyState !== OPEN) throw new Error('socket 不是 OPEN');
    this.sent.push(text);
  }

  #emit(type: string, ev: unknown): void {
    for (const fn of this.#listeners.get(type) ?? []) fn(ev);
  }

  // ── 观测面 ──────────────────────────────────────────────────────────────
  /** 全部被构造出来的 socket（含已回收的孤儿） */
  public static readonly created: FakeSocket[] = [];
  /** 待执行的微任务（惰性执行，测试决定何时推进到"下一拍"） */
  public static flush(fn: () => void): void {
    FakeSocket.queue.push(fn);
  }
  public static readonly queue: Array<() => void> = [];

  public static drain(): void {
    const pending = FakeSocket.queue.splice(0);
    for (const fn of pending) fn();
  }

  public static resetAll(): void {
    FakeSocket.created.length = 0;
    FakeSocket.queue.length = 0;
  }
}

function installFakeWebSocket(): void {
  // FakeSocket 只需实现 `MudClient` 用到的那几个成员
  (globalThis as unknown as { WebSocket: unknown }).WebSocket = FakeSocket;
}

let events: { opened: number; closed: Array<{ code: number; reason: string }>; errors: string[] } = {
  opened: 0,
  closed: [],
  errors: [],
};

function resetEvents(): void {
  events = { opened: 0, closed: [], errors: [] };
}

async function makeClient() {
  const { MudClient } = await import('../src/net/client.js');
  return new MudClient({
    onOpen: () => {
      events.opened += 1;
    },
    onClose: (code, reason) => {
      events.closed.push({ code, reason });
    },
    onPacket: () => undefined,
    onText: () => undefined,
    onError: (m) => {
      events.errors.push(m);
    },
  });
}

describe('S3 · MudClient 的连接回收', () => {
  beforeEach(() => {
    FakeSocket.resetAll();
    resetEvents();
    installFakeWebSocket();
  });

  it('重复 connect（旧连接仍在 CONNECTING）→ 旧的必须被收掉', async () => {
    const client = await makeClient();
    client.connect('ws://h/ws');
    const first = FakeSocket.created[0];
    expect(first).toBeDefined();

    client.connect('ws://h/ws');

    // ★ 判据：第一条被主动关闭。旧实现直接把 `#socket` 覆盖掉，
    //   旧 socket 从此悬着 —— 服务端那边的名额就再也腾不出来了。
    expect(first?.closed.length ?? 0).toBe(1);
  });

  it('已被回收的孤儿 socket 之后连上 → 不得触发 onOpen', async () => {
    const client = await makeClient();
    client.connect('ws://h/ws');
    const orphan = FakeSocket.created[0]!;
    client.connect('ws://h/ws');

    FakeSocket.drain();
    orphan.reachOpen();

    expect(events.opened).toBe(0);
  });

  it('【反向锚点】当前这条连上了 → onOpen 照常触发', async () => {
    const client = await makeClient();
    client.connect('ws://h/ws');
    const live = FakeSocket.created[0]!;

    live.reachOpen();

    expect(events.opened).toBe(1);
  });

  it('occupied 覆盖 CONNECTING（旧 connected 只认 OPEN，CONNECTING 期守卫形同虚设）', async () => {
    const client = await makeClient();
    expect(client.occupied).toBe(false);

    client.connect('ws://h/ws');
    expect(client.occupied).toBe(true); // ← 此刻仍是 CONNECTING
    expect(client.connected).toBe(false);

    client.close();
    expect(client.occupied).toBe(false);
  });

  it('主动 close 之后迟到的 close 事件 → 不得当成"掉线"（取代 ignoreNextClose）', async () => {
    const client = await makeClient();
    client.connect('ws://h/ws');
    FakeSocket.created[0]!.reachOpen();

    client.close();
    FakeSocket.drain(); // 推进到"close 事件到达"的那一拍

    expect(events.closed).toEqual([]);
  });

  it('【反向锚点】服务端把当前的这条关掉 → onClose 必须报出来', async () => {
    const client = await makeClient();
    client.connect('ws://h/ws');
    const live = FakeSocket.created[0]!;
    live.reachOpen();

    live.serverClosed(1011, '服务器内部错误');

    expect(events.closed).toEqual([{ code: 1011, reason: '服务器内部错误' }]);
  });

  it('已回收的孤儿之后被服务端关掉 → 不得把正在游戏的玩家带回认证界面', async () => {
    const client = await makeClient();
    client.connect('ws://h/ws');
    const orphan = FakeSocket.created[0]!;
    client.connect('ws://h/ws');
    FakeSocket.drain();

    // 这正是审查里那条"随机掉线"：孤儿断开时 `ignoreNextClose` 早已被消耗
    orphan.serverClosed(1006, '');

    expect(events.closed).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// S10（2026-10-16 审查）：`{` / `[` 开头的输入被服务端**主动断连**
// ---------------------------------------------------------------------------
//
// 服务端 `routeFrame()` 按**首字符**分诊：看起来像 JSON 的一律走 JSON 分支
// （`/^\s*[[{]/`）。于是玩家敲 `{公告}` 或粘贴一段带前导空格的 JSON 时：
// 明文帧被判成 JSON → `JSON.parse` 抛 → `reject('BAD_PACKET', close=true)` ⇒ **断线**。
//
// 协议里早就声明了结构化的 `command` 包（服务端 `frame-pipeline.ts` 也接受它），
// 只是前端 `client.ts` **从不使用**。这里把它接上：只要首字符像 JSON，就走 `command` 包。
describe('S10 · 看起来像 JSON 的指令改走 `command` 包（而不是发明文被断连）', () => {
  beforeEach(() => {
    FakeSocket.resetAll();
    resetEvents();
    installFakeWebSocket();
  });

  async function openClient(): Promise<{ client: Awaited<ReturnType<typeof makeClient>>; sock: FakeSocket }> {
    const client = await makeClient();
    client.connect('ws://h/ws');
    const sock = FakeSocket.created[0]!;
    sock.reachOpen();
    return { client, sock };
  }

  it('★ `{` 开头 → 发结构化 `command` 包（明文会被判成坏 JSON 并断连）', async () => {
    const { client, sock } = await openClient();

    client.sendCommand('{ojbk}');

    expect(sock.sent).toHaveLength(1);
    const pkt = JSON.parse(sock.sent[0]!) as Record<string, unknown>;
    expect(pkt['type']).toBe('command');
    expect(pkt['cmd']).toBe('{ojbk}');
    expect(pkt['v']).toBe(PROTOCOL_VERSION);
  });

  it('★ `[` 开头（含前导空白）同样走 `command` 包', async () => {
    const { client, sock } = await openClient();

    client.sendCommand('  [公告]');

    const pkt = JSON.parse(sock.sent[0]!) as Record<string, unknown>;
    expect(pkt['type']).toBe('command');
    expect(pkt['cmd']).toBe('[公告]');
  });

  it('【反向锚点】普通指令仍走**明文**（别把整条通道都改成 JSON）', async () => {
    const { client, sock } = await openClient();

    client.sendCommand('look');

    expect(sock.sent).toEqual(['look']);
  });

  it('【反向锚点】空白 / 空串不产生任何帧', async () => {
    const { client, sock } = await openClient();

    client.sendCommand('   ');
    client.sendCommand('');

    expect(sock.sent).toEqual([]);
  });
});

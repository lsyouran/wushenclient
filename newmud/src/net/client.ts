/**
 * src/net/client.ts — WebSocket 客户端
 * ============================================================================
 * 与服务端的 `frame-pipeline.ts` 是**同一个契约的两头**，规则必须一致：
 *
 *   出站：指令默认走**明文**（服务端 `checkPlaintext` 只接受一条指令、且禁控制字符）；
 *         但**首字符像 JSON 的指令改走 `command` 包** —— 否则服务端的首字符分诊
 *         会把它当成坏 JSON 并**断连**（S10）。登录这类结构化数据同样走 JSON。
 *   入站：以 `{` / `[` 开头 → JSON 包；否则 → 明文一行文本。
 *
 * ★ 分诊只看**首字符**，判据是 `shared/constants.ts#LOOKS_LIKE_JSON_RE` ——
 *   与服务端 `routeFrame` **同一份**（S10 后单源；原先两边各写一份是分叉风险）。
 */

import { LOOKS_LIKE_JSON_RE, PROTOCOL_VERSION } from '../../shared/constants.js';

export interface ClientHooks {
  onOpen(): void;
  onClose(code: number, reason: string): void;
  /** 收到一个 JSON 包 */
  onPacket(type: string, payload: Record<string, unknown>): void;
  /** 收到一行明文（不是 JSON） */
  onText(text: string): void;
  /** 连不上 / 协议错误 */
  onError(message: string): void;
}

/** 与服务端分诊**同一份**判据（`shared/constants.ts#LOOKS_LIKE_JSON_RE`，S10 后单源） */

export class MudClient {
  #socket: WebSocket | null = null;
  readonly #hooks: ClientHooks;
  #url = '';

  public constructor(hooks: ClientHooks) {
    this.#hooks = hooks;
  }

  public get connected(): boolean {
    return this.#socket !== null && this.#socket.readyState === WebSocket.OPEN;
  }

  /**
   * 是否**占着一条** socket —— **含还在 `CONNECTING` 的那一条**。
   *
   * ★ 为什么必须有一个比 `connected` 更宽的判定（2026-10-16 审查 S3）：
   *   `connected` 只认 `OPEN`，于是"正在握手"这段时间里它返回 false ——
   *   调用方写的 `if (client.connected) 先关旧的` 因此**形同虚设**，
   *   每一次提交都又建一条 WebSocket。而握手未完成的那条既不会被代码关掉、
   *   也不会发出数据，它是**孤儿**：服务端那边照常占了 `MAX_CONNECTIONS` 的名额，
   *   又因为浏览器会自动回 pong 而不断刷新 `lastSeenMs` ⇒ `pruneIdle()` 永远踢不掉。
   *
   *   ⇒ 调用方要问的是"**我还能不能再发起一条**"，本 getter 就是给那个问题用的。
   */
  public get occupied(): boolean {
    return this.#socket !== null;
  }

  /**
   * 作废当前 socket：**先把它从跟踪里摘掉，再关**。
   *
   * ★ 顺序是这件事的全部内容（S3）：先摘 ⇒ 之后从这条 socket 上到达的
   *   `open` / `close` / `message` **一律不当数**（`isCurrent()` 判身份），
   *   于是"孤儿连上了""孤儿被服务端关了"都不再影响接线层。
   *   反过来（先 close 后摘）就有一个窗口，那条 socket 的事件还会走回调 ——
   *   而 `close` 是**异步**到达的，这个窗口必然会被踩到。
   */
  #discard(): void {
    const old = this.#socket;
    if (old === null) return;
    this.#socket = null;
    old.close(1000, '连接已作废');
  }

  /** 这条 socket 是不是"**当前**被跟踪的那条" */
  #isCurrent(socket: WebSocket): boolean {
    return this.#socket === socket;
  }

  public connect(url: string): void {
    // ★ 建新的之前先把旧的作废：一次 connect 就是一条 socket，别让它悬着
    this.#discard();
    this.#url = url;
    let socket: WebSocket;
    try {
      socket = new WebSocket(url);
    } catch (e) {
      this.#hooks.onError(`地址无效：${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    this.#socket = socket;
    // ★ 每个回调都先验身份：作废过的 socket 的事件不进 hooks。
    //   这是取代 `ignoreNextClose` 那种"一次性标记"的写法 —— 那种标记会被
    //   **别人的** close 消耗掉，于是真断线时反过来又被当成自愿关闭。
    socket.addEventListener('open', () => {
      if (!this.#isCurrent(socket)) return;
      this.#hooks.onOpen();
    });
    socket.addEventListener('close', (ev) => {
      if (!this.#isCurrent(socket)) return;
      this.#discard();
      this.#hooks.onClose(ev.code, ev.reason);
    });
    socket.addEventListener('error', () => {
      if (!this.#isCurrent(socket)) return;
      // 浏览器的 error 事件不带原因（安全限制），只能给个可行动的提示
      this.#hooks.onError(`连接失败：${this.#url}`);
    });
    socket.addEventListener('message', (ev) => {
      if (!this.#isCurrent(socket)) return;
      if (typeof ev.data !== 'string') return; // 服务端目前只发文本帧
      this.#route(ev.data);
    });
  }

  #route(raw: string): void {
    if (!LOOKS_LIKE_JSON_RE.test(raw)) {
      this.#hooks.onText(raw);
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      this.#hooks.onError(`收到无法解析的包：${raw.slice(0, 80)}`);
      return;
    }
    if (typeof parsed !== 'object' || parsed === null) {
      this.#hooks.onError('收到非对象包');
      return;
    }
    const obj = parsed as Record<string, unknown>;
    const type = obj['type'];
    if (typeof type !== 'string') {
      this.#hooks.onError('包缺少 type');
      return;
    }
    this.#hooks.onPacket(type, obj);
  }

  /**
   * 发一条指令。
   *
   * ★ 首字符像 JSON 的**必须**走结构化的 `command` 包（S10，2026-10-16 审查）：
   *   服务端 `routeFrame()` 按首字符分诊（`/^\s*[[{]/`）—— 明文帧一旦长这样就会被
   *   判成 JSON → `JSON.parse` 抛 → `reject('BAD_PACKET', close=true)` ⇒ **主动断连**。
   *   玩家敲 `{公告}`、或粘贴一段带前导空格的 JSON，都会踩到（S1 的伪装按钮还能
   *   让受害者一点就发出这种指令，把受害者踢下线）。
   *
   *   协议里早有 `command` 包、服务端也已接受（`server/net/frame-pipeline.ts#route` 的
   *   `case 'command'` 直接取 `packet.data.cmd`），只是这里**从不使用** —— 这就是它的用途。
   */
  public sendCommand(text: string): void {
    const command = text.trim();
    if (command === '') return;
    if (LOOKS_LIKE_JSON_RE.test(command)) {
      this.sendPacket({ type: 'command', cmd: command });
      return;
    }
    this.#raw(command);
  }

  /** 发一个 JSON 包（登录 / ping） */
  public sendPacket(body: Record<string, unknown>): void {
    this.#raw(JSON.stringify({ v: PROTOCOL_VERSION, ...body }));
  }

  #raw(text: string): void {
    if (text === '') return;
    if (this.#socket === null || this.#socket.readyState !== WebSocket.OPEN) {
      this.#hooks.onError('还没连上');
      return;
    }
    this.#socket.send(text);
  }

  /**
   * 主动断开。
   *
   * ★ 走 `#discard()` 而不是"先 close 再把引用置 null"（S3）：
   *   那条被关掉的 socket 的 `close` 事件是**异步**到达的，
   *   届时它已经不是"当前被跟踪的那条" ⇒ 回调被身份判断拦住，
   *   于是"我自己关的"不会被报成"掉线" —— 这件事由 **socket 身份**保证，
   *   不再需要调用方维护一个会被别人消耗掉的一次性标记。
   */
  public close(): void {
    this.#discard();
  }
}

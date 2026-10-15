/**
 * src/net/client.ts — WebSocket 客户端
 * ============================================================================
 * 与服务端的 `frame-pipeline.ts` 是**同一个契约的两头**，规则必须一致：
 *
 *   出站：指令走**明文**（服务端 `checkPlaintext` 只接受一条指令，
 *         且禁控制字符）；登录这类结构化数据走 JSON。
 *   入站：以 `{` / `[` 开头 → JSON 包；否则 → 明文一行文本。
 *
 * ★ 分诊只看**首字符**，与服务端 `routeFrame` 的 `LOOKS_LIKE_JSON_RE` 同源。
 *   两边一旦分叉，表现是"偶尔有一行被当成包解析失败"—— 所以这条要写在一起说清楚。
 */

import { PROTOCOL_VERSION } from '../../shared/constants.js';

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

const LOOKS_LIKE_JSON = /^\s*[[{]/;

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

  public connect(url: string): void {
    this.#url = url;
    let socket: WebSocket;
    try {
      socket = new WebSocket(url);
    } catch (e) {
      this.#hooks.onError(`地址无效：${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    this.#socket = socket;
    socket.addEventListener('open', () => this.#hooks.onOpen());
    socket.addEventListener('close', (ev) => this.#hooks.onClose(ev.code, ev.reason));
    socket.addEventListener('error', () => {
      // 浏览器的 error 事件不带原因（安全限制），只能给个可行动的提示
      this.#hooks.onError(`连接失败：${this.#url}`);
    });
    socket.addEventListener('message', (ev) => {
      if (typeof ev.data !== 'string') return; // 服务端目前只发文本帧
      this.#route(ev.data);
    });
  }

  #route(raw: string): void {
    if (!LOOKS_LIKE_JSON.test(raw)) {
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

  /** 发一条**明文指令**（走服务端的明文通道） */
  public sendCommand(text: string): void {
    this.#raw(text.trim());
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

  public close(): void {
    this.#socket?.close(1000, '客户端主动断开');
    this.#socket = null;
  }
}

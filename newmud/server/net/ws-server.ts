/**
 * server/net/ws-server.ts — WebSocket 适配层
 * ============================================================================
 * 本文件是**唯一**接触 `ws` 库的地方。上面两层都刻意不依赖它：
 *   - `frame-pipeline.ts` 管"一帧怎么处理"（纯逻辑）
 *   - `hub.ts`              管"一堆连接怎么管"（只认 `NetConnection` 接口）
 * 于是换传输（ws / uWebSockets / 测试用假连接）只需替换本文件。
 *
 * ★ 三个"库层也要设"的硬上限（业务层之外的第一道闸）：
 *   ① `maxPayload = WS_MAX_PAYLOAD_BYTES` —— 库层先拦，业务层的 `checkPayloadSize` 再拦一次
 *   ② `MAX_CONNECTIONS` —— 由 hub 判（accept 返回 false 时这里直接关掉）
 *   ③ 背压 —— 判据在 hub 的 `enqueue()`（两档：接收方缓冲 + 自己的队列）。
 *      **适配层的职责就是把读数喂上去**（`WsConnection.bufferedBytes` → `socket.bufferedAmount`），
 *      因为那个数值只有这里拿得到。见 26 册 FG-14 / §28.2。
 *
 * ★ 心跳与清理：`setInterval` 必须在 `close()` 里清掉，否则测试进程不会退出。
 *
 * ★ **收口两道**（2026-10-13 体检 N2）：只接受 `WS_PATH`（`/ws`）上的升级，
 *   且只接受**同源** `Origin`（缺 Origin 的非浏览器客户端放行，见 `isSameOriginRequest`）。
 *   监听地址缺省 `DEFAULT_WS_HOST`（`127.0.0.1`），要对外必须显式 `--host`。
 */

import { WebSocketServer } from 'ws';
import type { RawData, WebSocket } from 'ws';
import type { IncomingMessage, Server } from 'node:http';
import { APP_HEARTBEAT_MS, WS_MAX_PAYLOAD_BYTES, WS_PING_INTERVAL_MS } from '@shared/constants.js';
import { OidSpace } from '../engine/oid.js';
import type { ConnectionHub, NetConnection } from './hub.js';

/**
 * WebSocket 端点路径 —— **服务端侧的唯一定义点**。
 *
 * ⚠️ **"只此一处"这句话是假的**（2026-10-14 复查订正），别被旧注释误导：
 *   全仓实际有 **3 个** `/ws` 字面量，因为三处**不共享模块**，无法直接 import：
 *     - 本常量 `WS_PATH`（服务端唯一定义点）→ 只被 `ws-server.ts` 自己消费；
 *     - `server/cli.ts`（启动日志里打印 `ws://host/ws`）；
 *     - `src/ui/auth.ts` 的 `serverUrl()`（前端 `ws://${location.host}/ws`）。
 *   ⇒ 改这个值时**必须三处一起改**。★ 一致性目前**没有闸门对账**
 *     （`tools/gate` 下零覆盖；`tests/web-ui.test.ts` 那条正则也是硬编码 `/ws`，
 *     改值不会让它红）—— 这是已知缺口，补闸门时本注释同步改。
 *
 * ★ 为什么要显式限定路径（2026-10-13 体检 N2）：不设 `path` 时，服务器会接受
 *   **任意路径**的升级请求。限定成 `/ws` 让"这个端口上还有没有别的 HTTP 面"
 *   不再是一个需要靠约定维持的事。
 */
export const WS_PATH = '/ws';

/**
 * 缺省监听地址。
 *
 * ★ 为什么不绑 `0.0.0.0`/`::`（2026-10-13 体检 N2）：此前 `listen(port)` 不传 host
 *   ⇒ 绑到全部网卡，局域网上任何人可直连；而启动日志却写着 `127.0.0.1`，
 *   两者不符会让人误以为"只有本机能连"。开发期的 MUD 缺省只对本机开放，
 *   要对外就用 `--host 0.0.0.0` 显式声明。
 */
export const DEFAULT_WS_HOST = '127.0.0.1';

/** ws 关闭码：策略违规（跨站 Origin 被拒）。1011 是"服务端内部原因"，语义不同 */
const WS_CLOSE_POLICY_VIOLATION = 1008;

/**
 * 归一化来源地址（N4）。
 *
 * ★ 为什么必须归一：同一台机器经 IPv6 回环连过来时，`remoteAddress` 是
 *   **IPv4-mapped IPv6** 形态 `::ffff:127.0.0.1`，而它和 `127.0.0.1` 是同一个地址。
 *   不归一的话，攻击者可以在两种写法之间来回切，**per-IP 上限直接失效**
 *   （每条连接都算"新地址"）。
 * ★ 空串 / undefined ⇒ 返回 `undefined`：交给 hub 判"这条连接不参与 per-IP"
 *   （`NetConnection.peerAddress` 的契约）。
 */
export function normalizePeerAddress(raw: string | undefined): string | undefined {
  if (raw === undefined || raw === '') return undefined;
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(raw);
  return mapped === null ? raw : (mapped[1] ?? raw);
}

/**
 * 同源校验（CSWSH 防线）。
 *
 * ★ 浏览器发起 WebSocket 时**必定**带 `Origin`；且**不会**被页面的 JS 伪造成别的值。
 *   于是"Origin 与请求的 Host 不同源"就等价于"这是别的站点发起的连接"。
 * ★ `Origin` 缺失时**放行**：非浏览器客户端（Node 的 `ws`、CLI 工具）不带这个头，
 *   而它们本来就不具备"拿着受害者的 cookie 跨站发起连接"的条件 —— 卡它们只会
 *   把合法的非浏览器客户端一起打死（测试与运维工具都用这类客户端）。
 */
function isSameOriginRequest(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (origin === undefined) return true;
  const host = req.headers.host;
  if (typeof host !== 'string' || host === '') return false;
  try {
    return new URL(origin).host === host;
  } catch {
    // `Origin: null`（sandbox / file://）与任何不成 URL 的值一律拒
    return false;
  }
}

/**
 * ws 的 `RawData` → 管线能吃的帧。
 *
 * ★ **必须按 `isBinary` 分**：ws 把 **text frame 也交给 `Buffer`**，
 *   只凭"拿到的类型"根本分不出文本帧与二进制帧。
 *   若一律按 `Uint8Array` 处理，`routeFrame()` 会把它判进 **JSON 通道**
 *   （它对非 string 一律返 `json`），于是玩家敲的 `look` 走到 `JSON.parse` 而炸成
 *   BAD_PACKET —— 明文通道形同虚设。这是接 ws 时最容易踩的一个坑。
 */
export function toFrame(data: RawData, isBinary: boolean): string | Uint8Array {
  const raw = Array.isArray(data) ? Buffer.concat(data as Buffer[]) : data;
  if (!isBinary) return raw.toString();
  if (raw instanceof ArrayBuffer) return new Uint8Array(raw);
  return raw as Buffer; // Buffer 是 Uint8Array 的子类
}

/** 把一条 ws 连接包装成 hub 认得的 `NetConnection` */
class WsConnection implements NetConnection {
  public constructor(
    public readonly id: string,
    private readonly socket: WebSocket,
    /** 来源地址（已归一，`normalizePeerAddress`）—— hub 的 per-IP 上限要用它 */
    public readonly peerAddress?: string | undefined,
  ) {}

  public send(text: string): void {
    if (this.socket.readyState === this.socket.OPEN) this.socket.send(text);
  }

  /**
   * 接收方的真实积压（字节）—— hub 的背压判据就建在这上面（FG-14）。
   *
   * ★ 为什么必须是 `bufferedAmount` 而不是 hub 自己的队列长度：
   *   hub 的队列在 `session.#send` 里 enqueue 完立刻 drain，长度恒 ≤ 1，
   *   拿它当判据等于没有判据。`bufferedAmount` 是**对面还没收走**的量，
   *   客户端一旦停止读取它就会单调增长 —— 那才是"不读了"的直接证据。
   *
   * ★ 也没法用可写回调（`'drain'`）替代：那是 `net.Socket` 的信号，
   *   `ws` 的 WebSocket 不保证转发它。轮询一个数值比等一个可能不来的事件可靠。
   */
  public bufferedBytes(): number {
    return this.socket.bufferedAmount;
  }

  public close(reason: string): void {
    // 1011 = 服务端内部原因；客户端只需知道"被要求断开"
    // ★ 必须截断（N6，2026-10-16 审查）：>123 字节时 `ws` 的 `close()` 抛 `RangeError` ——
    //   一旦抛，"关连接"这件事就**失败了**，异常顺着调用栈冒进入站处理，
    //   落进 N1 那条崩溃路径（一个本该被踢掉的连接反而把进程带走）。
    //   当前所有 detail 都 ≤87 字节（暂不可触发），但那是**潜伏**状态：多一条长 detail 就成真。
    this.socket.close(1011, truncateCloseReason(reason));
  }
}

/**
 * WS close reason 的**字节上限** —— `ws` 对 >123 字节的 reason 抛 `RangeError`（审查 N6）。
 * ★ 留 0 字节余量：123 就是协议/库的硬限，取满即可（理由字符串越完整越好诊断）。
 */
export const WS_CLOSE_REASON_MAX_BYTES = 123;

/**
 * 把 close reason 截到字节上限之内（N6）。
 *
 * ★ 按**码点**逐步累加，而不是 `Buffer.subarray(...).toString('utf8')`：
 *   后者会在多字节字符中间切断，产出替换字符（U+FFFD）—— 客户端那边看到一串乱码，
 *   而且"断在半个汉字上"还会让长度比预期少 1–2 字节。
 * ★ 必须按**字节**而不是字符数判：reason 里有中文时，123 个字符可能是 369 字节。
 */
export function truncateCloseReason(reason: string): string {
  if (Buffer.byteLength(reason, 'utf8') <= WS_CLOSE_REASON_MAX_BYTES) return reason;
  let out = '';
  for (const ch of reason) {
    if (Buffer.byteLength(out + ch, 'utf8') > WS_CLOSE_REASON_MAX_BYTES) break;
    out += ch;
  }
  return out;
}

export interface WsServerOptions {
  readonly port: number;
  /**
   * 监听地址（缺省 `DEFAULT_WS_HOST` = `127.0.0.1`）。
   *
   * ★ 要对外提供服务必须**显式**传 `'0.0.0.0'`（或具体网卡地址）——
   *   见 `DEFAULT_WS_HOST` 的说明（2026-10-13 体检 N2）。
   */
  readonly host?: string;
  /**
   * 由调用方持有的连接表。
   * ★ 刻意**不**在这里新建：hub 是"所有连接的权威状态"，
   *   若适配层自己造一个，调用方拿到的那个就是副本 —— 于是
   *   `hub.size` 与实际连接数对不上，这种不一致最难查。
   */
  readonly hub: ConnectionHub;
  /** 关闭周期任务（纯逻辑测试不需要心跳） */
  readonly timers?: boolean;
  /**
   * 协议级 ping 间隔（ms）。`null` = **不发**（用于"不发 ping 会被踢"的对照测试）。
   * 缺省 `WS_PING_INTERVAL_MS`。
   *
   * ★ 它必须**显著小于** `hub.idleTimeoutMs`：ping 与 `pruneIdle` 是两个独立定时器，
   *   若两者相等就没有余量，相位不利时会在 pong 回来之前先踢（26 册 §16.4 F1）。
   *   这条不变式由 `tests/net-idle.test.ts` 钉住。
   */
  readonly pingIntervalMs?: number | null;
  /**
   * 挂到**已有的** http 服务器上（于是静态资源与 WebSocket 共用**一个端口**）。
   *
   * ★ 为什么必须能同端口：前端 `defaultUrl()` 是**同源**的
   *   （`ws://${location.host}/ws`）—— 页面从哪个端口来就连哪个端口。
   *   若 WS 另开一个端口，浏览器打开页面后连的是"静态服务器"，那条路上根本没有
   *   WebSocket 端点，表现是页面能开、点了进不去。
   *
   * 契约：传入的服务器**必须尚未 listen** —— 由本层负责 `listen(options.port)`
   *   与关闭，端口 0（系统分配）的取值也统一在这里，不留两个 owner。
   *   不传则维持原行为（自建一个只跑 WS 的服务器），历史调用点与测试无需改动。
   */
  readonly httpServer?: Server;
}

export interface MudServer {
  readonly port: number;
  /** 实际监听地址（与 `port` 一起构成运维可见的"我开在哪"） */
  readonly host: string;
  readonly hub: ConnectionHub;
  /** 关掉监听、清掉定时器、断开全部连接 */
  close(): Promise<void>;
}

export function startWsServer(options: WsServerOptions): Promise<MudServer> {
  const host = options.host ?? DEFAULT_WS_HOST;
  const owner = options.httpServer;
  const wss =
    owner === undefined
      ? new WebSocketServer({
          host,
          port: options.port,
          path: WS_PATH,
          // ★ 库层第一道闸：业务层的 checkPayloadSize 是第二道，两道都要有
          maxPayload: WS_MAX_PAYLOAD_BYTES,
        })
      : new WebSocketServer({
          server: owner,
          path: WS_PATH,
          maxPayload: WS_MAX_PAYLOAD_BYTES,
        });
  const hub = options.hub;
  const connIds = new OidSpace();
  const sockets = new Map<string, WebSocket>();
  const pingIntervalMs =
    options.pingIntervalMs === undefined ? WS_PING_INTERVAL_MS : options.pingIntervalMs;

  wss.on('connection', (socket, req) => {
    // ★ 收口第一道：只认同源 Origin（2026-10-13 体检 N2）。
    //   必须在 `hub.accept` **之前**判 —— 否则连接已经进了连接表、占了名额、
    //   还可能被算进"在线人数"，之后再关就得处理"半注册"状态。
    if (!isSameOriginRequest(req)) {
      socket.close(WS_CLOSE_POLICY_VIOLATION, 'Origin 不被允许');
      return;
    }
    const id = connIds.next();
    const conn = new WsConnection(id, socket, normalizePeerAddress(req.socket.remoteAddress));
    if (!hub.accept(conn)) {
      // 被拒的原因要**说清楚**（N4）：服务器满 与 同址连接过多 是两件事，
      // 玩家的处置也不同（过会儿再来 vs 别多开）。两条都用 1013 = Try Again Later。
      const refusal = hub.admissionRefusal(conn);
      socket.close(1013, refusal === 'per-ip' ? '同一地址连接过多' : '服务器人数已满');
      connIds.release(id);
      return;
    }
    sockets.set(id, socket);

    socket.on('message', (data, isBinary) => {
      hub.inbound(conn, toFrame(data, isBinary));
      // 入站即刷新空闲计时（hub 内部已做）。
      // ★ 这一行 drain 现在是**兜底**：正常路径下 `session.#send` 已经 enqueue+drain 过了。
      //   留着它是为了"某个调用方只 enqueue 不 drain"时不至于把消息永远埋在队列里
      //   —— 但真正的背压判据不在这里，在 `hub.enqueue()`（FG-14）。
      const pending = hub.drain(conn);
      for (const text of pending) conn.send(text);
    });

    socket.on('pong', () => {
      // ★ 协议级保活信号的**唯一**入口（26 册 §16.4 F1）。
      //   ws 收到 pong 只触发 `'pong'` 事件，**不会**触发 `'message'` ——
      //   不接这一条，`hub` 就永远看不到"这条连接还活着"，
      //   `pruneIdle()` 会把"沉默但健康"的连接当成半开踢掉。
      //   浏览器与非浏览器客户端都会自动回 pong（RFC6455），所以这一条**不依赖前端配合**。
      hub.touch(conn);
    });

    socket.on('close', () => {
      hub.forget(conn);
      connIds.release(id);
      sockets.delete(id);
    });

    socket.on('error', () => {
      // 异常断开：hub.forget 会同时释放限流记录（hub 里的注释说明了为什么必须）
      hub.forget(conn);
      connIds.release(id);
      sockets.delete(id);
    });
  });

  // ── 周期任务：心跳 + 踢掉半开连接 ────────────────────────────────────────
  const timers: NodeJS.Timeout[] = [];
  if (options.timers !== false) {
    // `null` = 显式不发协议级 ping（对照测试用）——此时连接只能靠入站帧维持
    if (pingIntervalMs !== null) {
      timers.push(
        setInterval(() => {
          for (const socket of sockets.values()) {
            if (socket.readyState === socket.OPEN) socket.ping();
          }
        }, pingIntervalMs),
      );
    }
    timers.push(
      setInterval(() => {
        hub.pruneIdle();
        hub.pruneRateLimit();
      }, APP_HEARTBEAT_MS),
    );
  }

  return new Promise<MudServer>((resolve) => {
    const listening = (): void => {
      const addr = (owner ?? wss).address() as { port: number } | null;
      resolve({
        // 端口 0 时由系统分配，取实际端口（测试依赖这个）
        port: addr?.port ?? options.port,
        host,
        hub,
        close: async () => {
          for (const t of timers) clearInterval(t);
          for (const socket of sockets.values()) socket.terminate();
          sockets.clear();
          await new Promise<void>((done) => wss.close(() => done()));
          if (owner !== undefined) {
            // ★ 浏览器会留 keep-alive 连接。不主动断掉，`close()` 的回调永远不来，
            //   于是"关服"变成一个挂住的 Promise。
            const http = owner;
            http.closeAllConnections();
            await new Promise<void>((done) => http.close(() => done()));
          }
        },
      });
    };
    // 挂在外部服务器上时由本层负责 listen（契约见 WsServerOptions.httpServer）
    if (owner === undefined) wss.on('listening', listening);
    else owner.listen(options.port, host, listening);
  });
}

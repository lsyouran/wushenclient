/**
 * server/net/hub.ts — 连接管理（接线 T1 的另一半）
 * ============================================================================
 * `frame-pipeline.ts` 管"一帧怎么处理"，本文件管"一堆连接怎么管"。
 * 两者都不依赖 `ws`：适配层只需实现 `NetConnection`（`send` / `close`）。
 *
 * ★ 三条上限（T1 点名"当前完全缺失"的三项，这里补齐并都有真实消费者）：
 *   ① **连接数上限** `MAX_CONNECTIONS`   —— `accept()` 拒绝第 N+1 条
 *   ② **出站上限两档** —— 队列条数 `MAX_OUTBOUND_QUEUE` + 接收方缓冲字节 `MAX_BUFFERED_BYTES`。
 *      ⚠️ **两档的处置不同，别混为一谈**（详见 `enqueue()` 的说明，以那里为准）：
 *        - ① 档（接收方缓冲字节 `MAX_BUFFERED_BYTES`）超 ⇒ **断连并遗忘**
 *          —— 这条是运行时真正会碰到的判据（FG-14）；
 *        - ② 档（队列条数 `MAX_OUTBOUND_QUEUE`）超 ⇒ **本次不入队**，`enqueue()` 返回 `false`
 *          （**不断连**）。它是"某调用方只 enqueue 不 drain"时的兜底档，
 *          恒 ≤1 条，**不是运行时判据**。
 *      ★ 两档缺一不可：只有队列那档时，判据在运行时一次都碰不到（FG-14）。
 *   ③ **空闲超时** `CONNECTION_IDLE_TIMEOUT_MS` —— `pruneIdle()` 踢掉半开连接。
 *      ★ 判定口是 `lastSeenMs`，它有**两个**刷新来源：**入站帧**（`inbound()`）
 *        与**协议级 pong**（适配层调 `touch()`）。少了后者，"活着但一直不说话"会被
 *        误判成半开 —— 这正是 26 册 §16.4 F1（挂机 30s 被踢）的成因。
 *
 * ★ 出站为什么由 hub 排队，而不是直接 `socket.send()`：
 *   直接发的话，"客户端不读"会表现为缓冲区无限增长（ws 的 `bufferedAmount`），
 *   服务端毫不知情，直到进程内存被打满。
 *   让 hub 持有队列，上限才有东西可判 —— 背压必须是**看得见的**。
 *
 * ★ 但"看得见"这件事有两层，26 册 §28.2 把第二层补上了：
 *   队列长度只说明"我们排了多少"，说明不了"对面收了多少"。
 *   所以适配层额外把**接收方的积压**（`bufferedBytes()`）报上来，
 *   由 `enqueue()` 一起判 —— 那才是真正决定一条连接该不该被关的信号。
 *
 * ★ **运行时异常边界**（2026-10-13 体检 N1）：`inbound()` 的 switch 整体包在 `try/catch` 里，
 *   回调抛错 ⇒ 只断这一条连接 + `forget`，**不 rethrow**。
 *   在此之前入站链路一处 try/catch 都没有 ⇒ 一个玩家的内容回调抛错会冒泡成
 *   `uncaughtException`，把整个进程带走。这是"闸门全绿 ≠ 打不死"那一条的正面修复。
 */

import {
  CONNECTION_IDLE_TIMEOUT_MS,
  MAX_BUFFERED_BYTES,
  MAX_CONNECTIONS,
  MAX_OUTBOUND_QUEUE,
} from '@shared/constants.js';
import { SlidingWindowRateLimiter } from './rate-limit.js';
import { handleInboundFrame } from './frame-pipeline.js';
import type { InboundIntent } from './frame-pipeline.js';
import type { ErrorCode } from '@shared/protocol.js';

export class HubError extends Error {
  public override readonly name = 'HubError';
}

/**
 * 适配层要实现的**最小连接面**。
 * hub 只用它发数据与关连接，不关心底下是 WebSocket / TCP / 测试用的假连接。
 */
export interface NetConnection {
  readonly id: string;
  /** 真正把一帧发出去（hub 已做完大小守卫，适配层不必再判） */
  send(text: string): void;
  /** 关闭。`reason` 用于日志（不发给客户端） */
  close(reason: string): void;
  /**
   * **接收方**当前未消费的出站字节数（ws 侧 = `socket.bufferedAmount`）。
   *
   * ★ 可选：不是所有传输都报得出来（旧测试夹具 / 假连接）。**量不到就当不积压**
   *   —— 判据只能建在有读数的东西上，"量不到就踢人"会把所有实现不全的适配层打死。
   * ★ 这条读数的唯一用途是 `enqueue()` 的背压判定（FG-14 / 26 册 §28.2）。
   */
  readonly bufferedBytes?: (() => number) | undefined;
}

export interface HubHooks {
  /** 通过全部校验的一条指令（明文或 JSON 都归一到这里） */
  onCommand(conn: NetConnection, command: string): void;
  onLogin(conn: NetConnection, token: string, roleId: string): void;
  onPing(conn: NetConnection, t: number): void;
  /** 被拒。适配层用它给客户端回一个错误包 */
  onReject(conn: NetConnection, code: ErrorCode, detail: string, close: boolean): void;
  /**
   * 连接已被遗忘（正常断开 / 被拒断连 / 空闲踢线）。
   * ★ 会话层必须在这里注销角色 —— 否则玩家会**留在房间里**，
   *   表现为"人已经掉线，同房间的人还看得见他"（wushen 的幽灵玩家问题）。
   */
  onClose?(conn: NetConnection): void;
  /**
   * 入站回调（内容层 / 会话层）抛了异常，该连接已被断开并遗忘。
   *
   * ★ 为什么必须有这道边界（2026-10-13 体检 N1）：入站链路此前**一处 `try/catch` 都没有**，
   *   一个玩家触发的回调抛错会冒泡到 `ws` 的 `'message'` 事件、再冒泡成
   *   `uncaughtException` ⇒ **整个服务器进程退出**。一个玩家的坏输入不该打死全服。
   *
   * ★ 观察口是**可选**的：不装时默认写 stderr（见 `#reportInternalError`）——
   *   项目纪律是"异常可以不致命，但**不许静默**"（与 `session.onOutboundDrop` 同一取向）。
   */
  onInternalError?(conn: NetConnection, error: unknown): void;
}

interface ConnRecord {
  readonly conn: NetConnection;
  readonly outbound: string[];
  lastSeenMs: number;
  closed: boolean;
}

export interface HubOptions {
  /** 可注入时钟（测试用） */
  readonly now?: () => number;
  readonly limiter?: SlidingWindowRateLimiter;
  /** 覆盖 `MAX_CONNECTIONS`（测试用） */
  readonly maxConnections?: number;
  /** 覆盖 `MAX_BUFFERED_BYTES`（测试用） */
  readonly maxBufferedBytes?: number;
  /** 覆盖 `CONNECTION_IDLE_TIMEOUT_MS`（测试用） */
  readonly idleTimeoutMs?: number;
  readonly hooks: HubHooks;
}

export class ConnectionHub {
  readonly #conns = new Map<string, ConnRecord>();
  readonly #limiter: SlidingWindowRateLimiter;
  readonly #hooks: HubHooks;
  readonly #now: () => number;
  readonly #maxConnections: number;
  readonly #maxBufferedBytes: number;
  readonly #idleTimeoutMs: number;

  public constructor(options: HubOptions) {
    this.#hooks = options.hooks;
    this.#now = options.now ?? (() => Date.now());
    this.#limiter = options.limiter ?? new SlidingWindowRateLimiter();
    this.#maxConnections = options.maxConnections ?? MAX_CONNECTIONS;
    this.#maxBufferedBytes = options.maxBufferedBytes ?? MAX_BUFFERED_BYTES;
    this.#idleTimeoutMs = options.idleTimeoutMs ?? CONNECTION_IDLE_TIMEOUT_MS;
  }

  public get size(): number {
    return this.#conns.size;
  }

  public get maxConnections(): number {
    return this.#maxConnections;
  }

  /** 空闲判定窗口（测试与运维用；来源是 `CONNECTION_IDLE_TIMEOUT_MS` 或注入值） */
  public get idleTimeoutMs(): number {
    return this.#idleTimeoutMs;
  }

  /** 限流器的观测面（测试与运维用） */
  public get limiter(): SlidingWindowRateLimiter {
    return this.#limiter;
  }

  public has(connId: string): boolean {
    return this.#conns.has(connId);
  }

  /**
   * 刷新某连接的最后活跃时刻（**只动时间戳，不动连接表**）。
   *
   * ★ 为什么需要它（26 册 §16.4 F1）：`lastSeenMs` 原先**只由入站帧**刷新，
   *   而 ws 的协议级 `ping/pong` 走 `'pong'` 事件、**不触发** `'message'` ——
   *   于是"这条连接还活着"这个信号根本进不来，空闲判定退化成"沉默 N 秒就踢"。
   *   适配层收到 pong（以及任何**协议层**保活证据）时调本方法。
   *
   * ★ 必须容忍"未登记 / 已关闭"：pong 完全可能晚于 `close` 到达，
   *   那种情况下它应当被安静丢弃，而不是抛错或者把连接**复活**
   *   （复活会让已被 `forget` 的连接重新占住限流表与连接数）。
   *
   * @returns 是否确实刷新了一条在册连接
   */
  public touch(conn: NetConnection, nowMs: number = this.#now()): boolean {
    const rec = this.#conns.get(conn.id);
    if (rec === undefined || rec.closed) return false;
    rec.lastSeenMs = nowMs;
    return true;
  }

  /**
   * 接入一条连接。已达上限返回 **false**（调用方应当直接关闭它）。
   * 重名 id 视为程序错误（连接 id 必须唯一）。
   */
  public accept(conn: NetConnection): boolean {
    if (this.#conns.has(conn.id)) {
      throw new HubError(`连接 id 重复：${conn.id}`);
    }
    if (this.#conns.size >= this.#maxConnections) return false;
    this.#conns.set(conn.id, {
      conn,
      outbound: [],
      lastSeenMs: this.#now(),
      closed: false,
    });
    return true;
  }

  /** 处理一帧入站数据（分派意图 / 回绝） */
  public inbound(conn: NetConnection, raw: string | Uint8Array): InboundIntent {
    const rec = this.#conns.get(conn.id);
    if (rec === undefined || rec.closed) {
      return { kind: 'reject', code: 'NOT_LOGGED_IN', detail: '连接未登记或已关闭', close: true };
    }
    rec.lastSeenMs = this.#now();

    const intent = handleInboundFrame(raw, {
      connId: conn.id,
      nowMs: rec.lastSeenMs,
      limiter: this.#limiter,
    });

    // ★ 运行时异常边界（2026-10-13 体检 N1）：
    //   下面这个 switch 里跑的是**外挂进来的**回调（内容层 `on_enter`、会话层的登录/指令处理）。
    //   它们由内容作者书写，抛错是**可能发生的输入**，不是"程序员的 bug 不可能发生"。
    //   不包住的后果不是"这一帧失败"，而是**整个进程**退出 —— 一个玩家的坏输入打死全服。
    //
    //   `handleInboundFrame(...)` 刻意留在 try **之外**：它是纯逻辑 + 校验，
    //   那里抛错属于程序员错误，应当照常冒泡（会由进程级兜底记下来），
    //   不该被这里的"内容层兜底"顺手吞掉、变得更难查。
    try {
      switch (intent.kind) {
        case 'command':
          this.#hooks.onCommand(conn, intent.command);
          break;
        case 'login':
          this.#hooks.onLogin(conn, intent.token, intent.roleId);
          break;
        case 'ping':
          this.#hooks.onPing(conn, intent.t);
          break;
        case 'reject':
          // ★ 先回调（此时连接**还在**，适配层还能把错误包发回去），再决定断连。
          //   顺序反了就成了"客户端什么都没收到就被关"，那种失败最难查。
          this.#hooks.onReject(conn, intent.code, intent.detail, intent.close);
          if (intent.close) {
            // ★ 断连必须由 hub **主动**做：只 `forget()` 等于"服务端忘了这条连接，
            //   socket 却还开着" —— 客户端以为一切正常，而它发的每一帧都会收到
            //   NOT_LOGGED_IN。适配层不会自己猜"我是不是该关了"。
            conn.close(intent.detail);
            this.forget(conn);
          }
          break;
      }
    } catch (error) {
      // 断连 + 遗忘这一条连接，其他人不受影响。**不 rethrow**。
      this.#reportInternalError(conn, error);
      try {
        conn.close('服务器内部错误');
      } catch {
        // 连关闭都失败（例如 close 的 reason 被底层拒绝）也要继续遗忘，
        // 否则这条连接会永久留在连接表里 —— 比"关不上"更糟。
      }
      this.forget(conn);
    }
    return intent;
  }

  /**
   * 排队一条出站消息。
   *
   * ★ 判据是**两档**（FG-14 / 26 册 §28.2），任一超出都算"这条连接发不出去"：
   *   ① 接收方的缓冲积压（`conn.bufferedBytes()` > `maxBufferedBytes`）
   *      —— **这才是运行时真正咬得住的那一档**：`session.#send` 是 enqueue+drain，
   *      队列长度恒 ≤ 1，只看队列的话判定一次都不会成立。
   *   ② 自己的队列条数（`outbound.length` ≥ `MAX_OUTBOUND_QUEUE`）
   *      —— 兜住"一次 enqueue 之后很久不 drain"的调用方（批量发送）。
   *
   * ★ 判定成立时 hub **自己**把连接关掉并遗忘（照 `inbound()` 那条断连的同一纪律：
   *   "只 forget 不 close"等于服务端忘了它、socket 还开着）。原因写进 `close(reason)`。
   *
   * ★ 这里**不调 `onReject`**（与 `inbound()` 不同），原因是重入：
   *   `onReject` 的默认实现是 `sessions.sendError()`，它自己会再走一次 `enqueue` ——
   *   缓冲还是超的，于是再判死、再回调 …… 无限递归。
   *   客户端侧不会一无所知：`close()` 会发出 1011 关闭帧。
   *
   * @returns 是否入队成功；false = 该连接积压过多，已被关掉
   */
  public enqueue(conn: NetConnection, text: string): boolean {
    const rec = this.#conns.get(conn.id);
    if (rec === undefined || rec.closed) return false;

    // ① 接收方积压（缺 `bufferedBytes` 的实现报到 0，等于不判这一档）
    if (this.bufferedBytesOf(conn.id) > this.#maxBufferedBytes) {
      conn.close(`出站缓冲积压超过 ${this.#maxBufferedBytes} 字节（客户端不读）`);
      this.forget(conn);
      return false;
    }
    // ② 自己的队列条数
    if (rec.outbound.length >= MAX_OUTBOUND_QUEUE) return false;

    rec.outbound.push(text);
    return true;
  }

  /**
   * 某连接当前报上来的出站积压字节数（未登记 / 适配层不报时为 0）。
   * ★ 只读观测面：测试与运维用它，判定本身在 `enqueue()` 里（一处）。
   */
  public bufferedBytesOf(connId: string): number {
    const rec = this.#conns.get(connId);
    if (rec === undefined) return 0;
    return rec.conn.bufferedBytes?.() ?? 0;
  }

  /** 取出该连接的全部待发并清空队列（适配层在 socket 可写时调用） */
  public drain(conn: NetConnection): readonly string[] {
    const rec = this.#conns.get(conn.id);
    if (rec === undefined) return [];
    const out = rec.outbound.slice();
    rec.outbound.length = 0;
    return out;
  }

  public pendingCount(connId: string): number {
    return this.#conns.get(connId)?.outbound.length ?? 0;
  }

  /**
   * 断开并遗忘。**限流记录一同释放** —— 否则限流表会随"曾经连过的连接数"
   * 单调增长，那本身就是一条 DoS 路径（rate-limit.ts 顶部注明的第二点）。
   */
  public forget(conn: NetConnection): boolean {
    const rec = this.#conns.get(conn.id);
    if (rec === undefined) return false;
    rec.closed = true;
    rec.outbound.length = 0;
    this.#conns.delete(conn.id);
    this.#limiter.forget(conn.id);
    this.#hooks.onClose?.(conn);
    return true;
  }

  /**
   * 把"入站回调抛了异常"这件事报出来（并保证**这一步自己也不再抛**）。
   *
   * ★ 不许静默：默认写 stderr。装 `onInternalError` 的调用方（会话层 / 测试）可以改成
   *   自己的日志或指标。观察者自己抛错时**只吞掉它**，不再向上冒泡 ——
   *   否则"上报异常"这一步会变成新的未捕获异常，边界就破了。
   */
  #reportInternalError(conn: NetConnection, error: unknown): void {
    const hook = this.#hooks.onInternalError;
    if (hook !== undefined) {
      try {
        hook(conn, error);
      } catch {
        // 观察者的错不该再次打穿链路
      }
      return;
    }
    let detail: string;
    try {
      detail = error instanceof Error ? (error.stack ?? error.message) : String(error);
    } catch {
      detail = '<无法序列化的错误>';
    }
    process.stderr.write(
      `[hub] 入站回调抛出异常（连接 ${conn.id} 已断开，其他连接不受影响）：${detail}\n`,
    );
  }

  /** 踢掉所有超过空闲上限的连接，返回踢掉的个数 */
  public pruneIdle(nowMs: number = this.#now()): number {    let removed = 0;
    for (const rec of [...this.#conns.values()]) {
      if (nowMs - rec.lastSeenMs >= this.#idleTimeoutMs) {
        rec.conn.close(`空闲超过 ${this.#idleTimeoutMs}ms`);
        this.forget(rec.conn);
        removed += 1;
      }
    }
    return removed;
  }

  /**
   * 周期清理限流表里"窗口内已无记录"的 key。
   * `forget()` 已处理正常断开，这一道兜住**异常断开**（进程没收到 close 事件）。
   */
  public pruneRateLimit(nowMs: number = this.#now()): number {
    return this.#limiter.prune(nowMs);
  }

  /** 最近一次收到该连接数据的时刻（未登记返回 null） */
  public lastSeenMsOf(connId: string): number | null {
    return this.#conns.get(connId)?.lastSeenMs ?? null;
  }
}

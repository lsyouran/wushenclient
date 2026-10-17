/**
 * server/main.ts — 启动入口（把三层接起来）
 * ============================================================================
 * 组合根的最后一环：`bootstrapWorld()` 造世界 → `GameSessions` 管角色
 * → `startWsServer()` 开监听。本文件**不含玩法逻辑**，只负责把回调接对。
 *
 * 依赖方向（与 bootstrap.ts 同一条纪律）：
 *   main ──> session ──> engine ──> (不碰 @world/**)
 *   main ──> net（ws 只在 net/ws-server.ts 里出现）
 *
 * ★ 本文件**只导出 `createGameServer()`**，没有任何顶层副作用 —— 所以"被 import"
 *   绝不会自动开端口，端口只由调用方的 `options.port` 决定。
 *
 * ⚠️ 这里原先还有一句「后者靠 `import.meta.url === argv[1]` 判断」的"直接运行"入口描述 ——
 *   **那是不实描述，已删**：全仓 `server/` 里没有任何 `argv` 用法。
 *   （这条靠"真机跑一次"才现形：想做端到端验证时发现根本没法启动。26 册 §16.12 F4 = FG-19。）
 *
 * ✅ 现状（26 册 §17）：命令行入口**已经有了，但不在本文件**，入口链是
 *     `npm start` → `tools/start.mjs`（先注册 TS 解析钩子）→ `server/cli.ts` 的 `main()`。
 *   本文件仍然保持"纯工厂"的定位：**cli 是调用方**，它顺手建一个 http 服务器
 *   （`server/static.ts`）并通过 `options.httpServer` 传进来，让静态资源与 WS 共用同一端口
 *   —— 前端的默认地址是同源的（`ws://${location.host}/ws`），分两个端口连不上。
 */

import { bootstrapWorld } from './bootstrap.js';
import type { Server as HttpServer } from 'node:http';
import type { Scheduler } from './engine/scheduler.js';
import type { World } from './engine/world.js';
import type { WorldProblem } from './world/validate.js';
import { GameSessions } from './session.js';
import { ConnectionHub, reportTimerError } from './net/hub.js';
import type { HubHooks, NetConnection } from './net/hub.js';
import { startWsServer } from './net/ws-server.js';
import type { MudServer } from './net/ws-server.js';
import { TICK_MS } from '@shared/constants.js';
import type { ErrorCode } from '@shared/protocol.js';
import { isFatalLoginFailure } from '@shared/error-codes.js';

export interface GameServerOptions {
  /** 0 = 由系统分配（测试用） */
  readonly port: number;
  /**
   * 监听地址。缺省交给 `ws-server.ts` 的 `DEFAULT_WS_HOST`（`127.0.0.1`）。
   * ★ 本层不设缺省值，避免"两处各写一个默认 host"（24 册铁律 4）。
   */
  readonly host?: string;
  /** 关掉心跳与周期清理（测试用） */
  readonly timers?: boolean;
  readonly maxConnections?: number;
  /** 覆盖 `MAX_CONNECTIONS_PER_IP`（N4；测试与同址多人场景要调大） */
  readonly maxConnectionsPerIp?: number;
  /**
   * 把 WebSocket 挂到**已有的** http 服务器上（静态资源与 WS 共用同一端口）。
   *
   * ★ 为什么需要：前端默认地址是同源的（`ws://${location.host}/ws`）。
   *   不传就维持原状（WS 自建一个端口的服务器，测试一直这么用）。
   *   契约：传入的服务器必须**尚未 listen** —— 见 `WsServerOptions.httpServer`。
   */
  readonly httpServer?: HttpServer;
}

export interface GameServer extends MudServer {
  readonly world: World;
  readonly sessions: GameSessions;
  /** 启动期的世界校验结果（启动日志用） */
  readonly problems: readonly WorldProblem[];
  /**
   * 周期调度器（战斗出招 / 心跳的状态机时钟）。
   *
   * ★ 暴露出来是为了**测试能推进它**（`scheduler.step(t)`）—— 否则
   *   一次平a 要真等 `attackSpeed`（数千毫秒）才能端到端验证。
   *   生产路径的时钟由下面那个 `setInterval(…, TICK_MS)` 注入。
   */
  readonly scheduler: Scheduler;
}

export async function createGameServer(options: GameServerOptions): Promise<GameServer> {
  const { world, problems } = bootstrapWorld();
  // ★ 引擎侧的时钟与网络层的清理定时器**分开**（后者在 `ws-server.ts` 里）：
  //   本调度器只管"到点了跑一段玩法逻辑"，不认识 socket。
  //   ★ 取 `world.scheduler` 而不是这里 `new` 一个：造 NPC 的是 `instantiateWorld`，
  //     而角色要"自己排下一拍"⇒ 角色手里的时钟必须与 tick 推进的**是同一个**。
  const scheduler = world.scheduler;

  // 会话在 hub 之后创建（hub 的回调要用它），但回调是**延迟执行**的，
  // 所以用一个可变引用来打破这个构造顺序上的环 —— 比"把 sessions 设成可空成员"干净。
  let sessions: GameSessions | null = null;

  const hooks: HubHooks = {
    onCommand: (conn: NetConnection, command: string) => {
      sessions?.handleCommand(conn, command);
    },
    onLogin: (conn: NetConnection, token: string, roleId: string) => {
      const r = sessions?.login(conn, token, roleId);
      // 登录失败也要**明确告诉客户端**，而不是让它一直等
      if (r !== undefined && !r.ok) {
        sessions?.sendError(conn, r.code);
        // ★ 起始房满 / 服务器满这类失败要**连连接一起收掉**（N4）：
        //   失败却留着连接 = 几十条连接就能把起始房名额赖住，之后谁也登不上。
        //   什么时候该断、什么时候该留，看 `LOGIN_FATAL_CODES`（闭集 + 有测试）。
        // ★ `close` 之后必须紧跟 `forget`（2026-10-17 审查 **L4**）：
        //   `close()` 只是发起**优雅关闭握手**，名额（`#conns` / `#perPeer`）要等
        //   握手真正完成才释放；不回 close 帧的客户端就能把名额赖住最长 30s ——
        //   那正是 `LOGIN_FATAL_CODES` 要防的事。其余所有断连路径都是 close+forget 成对。
        if (isFatalLoginFailure(r.code)) {
          conn.close(`登录失败：${r.code}`);
          hub.forget(conn);
        }
      }
    },
    // 心跳由 ws 层的 ping/pong 处理，业务层无需动作
    onPing: () => undefined,
    onReject: (conn: NetConnection, code: ErrorCode) => {
      sessions?.sendError(conn, code);
    },
    // ★ 掉线即注销：否则玩家会留在房间里变成"幽灵"
    //   （wushen 的同类问题：掉线后同房间的人还看得见他）
    onClose: (conn: NetConnection) => {
      sessions?.logout(conn);
    },
  };

  const hub = new ConnectionHub({
    hooks,
    ...(options.maxConnections === undefined ? {} : { maxConnections: options.maxConnections }),
    ...(options.maxConnectionsPerIp === undefined
      ? {}
      : { maxConnectionsPerIp: options.maxConnectionsPerIp }),
  });
  sessions = new GameSessions({ world, hub });

  const server = await startWsServer({
    port: options.port,
    hub,
    ...(options.host === undefined ? {} : { host: options.host }),
    ...(options.timers === undefined ? {} : { timers: options.timers }),
    ...(options.httpServer === undefined ? {} : { httpServer: options.httpServer }),
  });

  // ★ 角色调度器 tick：`TICK_MS`（200ms）推进一次。与网络层共用 `timers` 开关
  //   —— 测试要"关掉真实定时器、自己 step 推进"时，这两处必须一起停。
  //   ★ tick 之后 **必须** 让会话对一次账（`afterTick`）：战斗改的是数值与房间内容，
  //     它们都不经过指令 ⇒ 不对账的话"打起来了但血条不动、尸体不消失"。
  let tickTimer: NodeJS.Timeout | null = null;
  if (options.timers !== false) {
    tickTimer = setInterval(() => {
      // ★ 异常边界（M6）：`afterTick` 跑的是会话对账（发帧、读角色数值），
      //   `scheduler.step()` 内部虽已逐个 catch，内容层钩子仍可能从这里冒泡。
      //   裸调 ⇒ `uncaughtException`；作为库被用（测试 / 嵌入）时会直接崩进程。
      try {
        scheduler.step();
        sessions?.afterTick();
      } catch (error) {
        reportTimerError('world-tick', error);
      }
    }, TICK_MS);
  }

  return {
    port: server.port,
    host: server.host,
    hub,
    world,
    sessions,
    scheduler,
    problems,
    close: async () => {
      if (tickTimer !== null) clearInterval(tickTimer);
      scheduler.clear();
      await server.close();
    },
  };
}

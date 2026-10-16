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
import type { World } from './engine/world.js';
import type { WorldProblem } from './world/validate.js';
import { GameSessions } from './session.js';
import { ConnectionHub } from './net/hub.js';
import type { HubHooks, NetConnection } from './net/hub.js';
import { startWsServer } from './net/ws-server.js';
import type { MudServer } from './net/ws-server.js';
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
}

export async function createGameServer(options: GameServerOptions): Promise<GameServer> {
  const { world, problems } = bootstrapWorld();

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
        if (isFatalLoginFailure(r.code)) conn.close(`登录失败：${r.code}`);
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

  return {
    port: server.port,
    host: server.host,
    hub,
    world,
    sessions,
    problems,
    close: server.close,
  };
}

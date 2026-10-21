/**
 * server/cli.ts — 命令行启动入口（`npm start` 真正跑的就是这里）
 * ============================================================================
 * 链路：`package.json` 的 `start` → `tools/start.mjs`（注册"TS 直跑"钩子）
 *       → 动态 import 本文件 → `main(process.argv.slice(2))`。
 *
 * ★ 本文件**只导出函数，没有顶层副作用** —— 与 `main.ts` 同一条纪律：
 *   被 import 不会开端口、不会抢信号、不会自己退出。可测性全靠这一条。
 *   （进程级异常兜底是 `main()` **被调用时**才装的，不在 import 时装 —— 见 `installProcessErrorGuards`。）
 *
 * 起的是什么（**一个**端口，两条路）：
 *   ├─ http 服务器（`createWebServer`）：发 `dist/web/` 里的前端产物
 *   └─ 同一个 http 服务器上的 WebSocket（`createGameServer({ httpServer })`）
 *
 * ★ 同端口不是"顺手"，是**必须**：前端 `defaultUrl()` 是**同源**的
 *   （`ws://${location.host}/ws`）——页面从哪个端口来，就往哪个端口连。
 *   分成两个端口的表现是"页面能打开、点了进不去"，很难查。
 *
 * ⚠️ 输出里有一行机器可读的 `READY {"port":N}`，给 `tests/launcher.test.ts` 用。
 *   刻意与给人看的日志分开：人不该去解析给人看的那段，脚本也不该去解析中文。
 */

import { existsSync } from 'node:fs';
import type { Server as HttpServer } from 'node:http';
import { isAbsolute, join, resolve } from 'node:path';
import { networkInterfaces } from 'node:os';

import { describeWorld } from './bootstrap.js';
import { createGameServer } from './main.js';
import { DEFAULT_WS_HOST } from './net/ws-server.js';
import { PROJECT_ROOT } from './paths.js';
import { DEFAULT_INDEX_PATH, createWebServer } from './static.js';

/** 缺省监听端口。8600+ 段避开常见开发端口（3000/5173/8080 之类） */
export const DEFAULT_PORT = 8123;

/** 参数用法错误（与"运行期故障"分开：前者要打 usage，后者只打原因） */
export class UsageError extends Error {
  public override readonly name = 'UsageError';
}

/** 进程级兜底要报的两类事件 */
export type ProcessErrorKind = 'uncaughtException' | 'unhandledRejection';

export interface ProcessErrorGuardOptions {
  /** 装监听的目标（缺省 `process`；测试注入假 target 用） */
  readonly target?: NodeJS.Process;
  /** 观察口（缺省写 stderr） */
  readonly onError?: (kind: ProcessErrorKind, error: unknown) => void;
}

/**
 * 装**进程级**异常兜底：`uncaughtException` / `unhandledRejection` 只记录、**不退出**。
 *
 * ★ 为什么需要（2026-10-13 体检 N1 的后半段）：`hub.inbound` 的 try/catch 挡的是
 *   "入站回调"那一类；但 `ws` 的事件回调、定时器、`await` 链上任何一处漏掉的异常
 *   仍会变成进程级未捕获异常。没有这个兜底时，Node 的缺省行为是**打印堆栈并退出** ——
 *   于是"某条路径的一个错"= 全服下线。
 *
 * ★ 为什么不退出：MUD 是长连接的在线服务，"某一个连接/某一帧坏了"与"整个服务该停"
 *   不是一回事。这里选择**活下来 + 大声记录**，而不是把它升级成全服故障。
 *   （真正的致命错误仍会通过日志暴露；运维看到的是"进程还在 + stderr 有堆栈"。）
 *
 * ★ 监听体自己**必须不再抛**：在 `uncaughtException` 处理函数里抛错会变成递归，
 *   直接把兜底本身打穿（见 `tests/resilience.test.ts` 的那条断言）。
 */
export function installProcessErrorGuards(options: ProcessErrorGuardOptions = {}): void {
  const target = options.target ?? process;
  const onError = options.onError ?? writeProcessError;
  const guard = (kind: ProcessErrorKind, error: unknown): void => {
    try {
      onError(kind, error);
    } catch {
      // 兜底自己不许再抛 —— 那会变成 uncaughtException 递归
    }
  };
  target.on('uncaughtException', (error) => {
    guard('uncaughtException', error);
  });
  target.on('unhandledRejection', (reason) => {
    guard('unhandledRejection', reason);
  });
}

/**
 * 缺省观察口：写 stderr（**不许静默**）。
 * 序列化本身也可能抛错，那时退回一个固定串 —— 兜底路径不允许再制造异常。
 */
function writeProcessError(kind: ProcessErrorKind, error: unknown): void {
  let detail: string;
  try {
    detail = error instanceof Error ? (error.stack ?? error.message) : String(error);
  } catch {
    detail = '<无法序列化的错误>';
  }
  process.stderr.write(`[${kind}] 未捕获异常（进程继续运行，请查这条）：${detail}\n`);
}

/**
 * "通配地址"：监听它 = 放开到**全部网卡**（局域网可达）。
 * ★ 与 `DEFAULT_WS_HOST`（只绑本机）相对；启动日志按这里分流提示。
 */
export const WILDCARD_HOSTS: readonly string[] = ['0.0.0.0', '::'];

export function isWildcardHost(host: string): boolean {
  return WILDCARD_HOSTS.includes(host);
}

/**
 * 本机的局域网 IPv4 地址（供启动日志打印"手机连这个"）。
 * ★ 只要**非内部**的 IPv4：`::1`/`127.x` 是本机回环，`169.254.x` 是没连上的
 *   链路本地地址 —— 打印出来都是噪音。
 */
export function lanAddresses(): string[] {
  const out: string[] = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const ni of list ?? []) {
      if (ni.internal || ni.family !== 'IPv4') continue;
      if (ni.address.startsWith('169.254.')) continue;
      out.push(ni.address);
    }
  }
  return out;
}

export interface CliOptions {
  readonly port: number;
  /** 监听地址（缺省 `127.0.0.1`；对外要显式 `--host 0.0.0.0`） */
  readonly host: string;
  /** 是否同时把前端产物发出去 */
  readonly serveWeb: boolean;
  /** 前端产物根目录（绝对路径） */
  readonly webRoot: string;
  readonly maxConnections: number | undefined;
  /** 单个来源地址的连接上限（N4） */
  readonly maxConnectionsPerIp: number | undefined;
  readonly help: boolean;
}

export function usage(): string {
  const index = DEFAULT_INDEX_PATH;
  return [
    '用法：npm start [-- 选项]',
    '      node tools/start.mjs [选项]',
    '',
    '选项：',
    '  --port <n>             监听端口（缺省 ' + String(DEFAULT_PORT) + '；0 = 由系统分配）',
    '  --host <addr>          监听地址（缺省 ' + DEFAULT_WS_HOST + '；对外请显式给 0.0.0.0）',
    '  --lan                  局域网可连（等价 --host 0.0.0.0；启动后打印局域网地址）',
    '  --web-root <dir>       前端产物目录（缺省在项目根下的 dist/web）',
    '  --no-web               只提供 WebSocket，不发前端',
    '  --max-connections <n>  同时在线人数上限（缺省取常量表里的 MAX_CONNECTIONS）',
    '  --max-connections-per-ip <n>',
    '                         单个来源地址的连接上限（缺省 MAX_CONNECTIONS_PER_IP）',
    '                         ★ 同一 NAT 后多人玩 / 压测时把它调大',
    '  -h, --help             显示这段说明',
    '',
    '起来之后：',
    '  页面       http://127.0.0.1:' + String(DEFAULT_PORT) + '/   （会跳到 ' + index + '）',
    '  WebSocket  同一个端口的 /ws 路径 —— 前端默认地址就是同源，不需要配置',
    '',
    '注意：`npm start` 会先自动构建前端（prestart）；直接跑 node tools/start.mjs',
    '      则要求 dist/web 已存在，否则页面打不开（会打印提示）。',
    '',
  ].join('\n');
}

function readInt(flag: string, raw: string, min: number, max: number): number {
  if (!/^\d+$/.test(raw)) {
    throw new UsageError(`${flag} 需要一个整数，收到 ${JSON.stringify(raw)}。`);
  }
  const n = Number(raw);
  if (n < min || n > max) throw new UsageError(`${flag} 超出范围 ${min}–${max}：${n}`);
  return n;
}

/**
 * 监听地址只做**最低限度**的合法性检查：非空、无空白。
 * 刻意不在这里校验"是不是一块真实网卡" —— 那是 listen 的职责，
 * 它给出的错误（EADDRNOTAVAIL）比我们能编的任何提示都准确。
 */
function readHost(flag: string, raw: string): string {
  if (raw.trim() === '' || /\s/.test(raw)) {
    throw new UsageError(`${flag} 需要一个地址，收到 ${JSON.stringify(raw)}。`);
  }
  return raw;
}

/**
 * 解析 argv（纯函数，不碰端口也不碰文件系统 —— 所以能被逐条钉住）。
 * 坏输入一律抛 `UsageError`，**不静默忽略**：写错的参数被吞掉，
 * 表现是"我明明指定了端口，它却还在 8123 上"。
 */
export function parseArgs(argv: readonly string[]): CliOptions {
  let port = DEFAULT_PORT;
  let host = DEFAULT_WS_HOST;
  let serveWeb = true;
  let rawWebRoot: string | null = null;
  let maxConnections: number | undefined;
  let maxConnectionsPerIp: number | undefined;
  let help = false;

  const rest = [...argv];
  while (rest.length > 0) {
    const arg = rest.shift() ?? '';
    const eq = arg.indexOf('=');
    const flag = eq === -1 ? arg : arg.slice(0, eq);
    const inline = eq === -1 ? null : arg.slice(eq + 1);
    const takeValue = (): string => {
      if (inline !== null) return inline;
      const next = rest.shift();
      if (next === undefined) throw new UsageError(`${flag} 缺少值。\n\n${usage()}`);
      return next;
    };

    switch (flag) {
      case '--port':
        port = readInt('--port', takeValue(), 0, 65535);
        break;
      case '--host':
        host = readHost('--host', takeValue());
        break;
      case '--lan':
        host = '0.0.0.0';
        break;
      case '--max-connections':
        maxConnections = readInt('--max-connections', takeValue(), 1, 100_000);
        break;
      case '--max-connections-per-ip':
        maxConnectionsPerIp = readInt('--max-connections-per-ip', takeValue(), 1, 100_000);
        break;
      case '--web-root':
        rawWebRoot = takeValue();
        break;
      case '--no-web':
        serveWeb = false;
        break;
      case '--help':
      case '-h':
        help = true;
        break;
      default:
        throw new UsageError(`无法识别的参数 ${JSON.stringify(arg)}。\n\n${usage()}`);
    }
  }

  return {
    port,
    host,
    serveWeb,
    // 相对路径一律按**项目根**解析：与"从哪个目录启动"无关（R3 的同一条纪律）
    webRoot:
      rawWebRoot === null
        ? join(PROJECT_ROOT, 'dist', 'web')
        : isAbsolute(rawWebRoot)
          ? resolve(rawWebRoot)
          : resolve(PROJECT_ROOT, rawWebRoot),
    maxConnections,
    maxConnectionsPerIp,
    help,
  };
}

/**
 * 启动。
 *
 * 先做**缺前端产物**的提示而不是直接退出：WebSocket 侧依然是可用的，
 * 而"到底该跑哪条命令"要是没人说，就得翻文档（这正是原先的处境）。
 */
export async function main(argv: readonly string[]): Promise<void> {
  // ★ 进程级兜底要在**任何**工作之前装好：它要覆盖的是"起服务之后任何一处漏网的异常"，
  //   而这类异常恰恰最可能在启动之后才出现。
  installProcessErrorGuards();

  const options = parseArgs(argv);
  if (options.help) {
    process.stdout.write(usage());
    return;
  }

  const indexFile = join(options.webRoot, DEFAULT_INDEX_PATH);
  let httpServer: HttpServer | undefined;
  if (options.serveWeb) {
    if (!existsSync(indexFile)) {
      process.stderr.write(
        `⚠️  前端产物不存在：${indexFile}\n` +
          '    先生成：npm run build:web\n' +
          '    本次仍会启动 WebSocket，但浏览器打开页面会是 404。\n\n',
      );
    }
    httpServer = createWebServer({ rootDir: options.webRoot });
  }

  const server = await createGameServer({
    port: options.port,
    host: options.host,
    ...(httpServer === undefined ? {} : { httpServer }),
    ...(options.maxConnections === undefined
      ? {}
      : { maxConnections: options.maxConnections }),
    ...(options.maxConnectionsPerIp === undefined
      ? {}
      : { maxConnectionsPerIp: options.maxConnectionsPerIp }),
  });

  const host = options.host;
  // ★ 不写死 `ws://` 字面量：G6 R6.5 禁止硬编码该协议前缀（将来上 TLS 要能整体换 wss）
  const wsScheme = 'ws';
  const wsUrl = `${wsScheme}://${host}:${server.port}/ws`;

  process.stdout.write(`${describeWorld(server.world.stats)}\n`);
  for (const p of server.problems) {
    process.stdout.write(`  [${p.level}] ${p.where}：${p.message}\n`);
  }
  if (options.serveWeb) {
    process.stdout.write(`页面      http://${host}:${server.port}/\n`);
  }
  process.stdout.write(`WebSocket ${wsUrl}\n`);
  // ★ 局域网提示（显式不静默）：绑了通配地址就把"手机/别的机器连哪个"打出来；
  //   只绑本机时也要说一句怎么放开 —— 否则"手机上打不开"只能靠翻源码。
  if (isWildcardHost(host)) {
    const lan = lanAddresses();
    if (lan.length === 0) {
      process.stdout.write('局域网    未检测到局域网网卡（没联网？）——本机浏览器仍可访问上面的地址\n');
    } else {
      for (const ip of lan) {
        process.stdout.write(`局域网    http://${ip}:${String(server.port)}/   （手机/其他机器连这个）\n`);
      }
    }
  } else {
    process.stdout.write('（当前只监听本机；要让手机/局域网设备连入：npm start -- --lan）\n');
  }
  process.stdout.write(`READY ${JSON.stringify({ port: server.port })}\n`);

  // 收到信号就优雅关闭：清定时器 → 断连接 → 关监听 → 事件循环自然排空后退出
  let closing = false;
  const shutdown = (signal: string): void => {
    if (closing) return;
    closing = true;
    process.stdout.write(`\n收到 ${signal}，正在关闭……\n`);
    server.close().then(
      () => {
        process.stdout.write('已关闭。\n');
      },
      (e: unknown) => {
        process.stderr.write(`关闭时出错：${e instanceof Error ? e.message : String(e)}\n`);
        process.exitCode = 1;
      },
    );
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

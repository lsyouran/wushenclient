#!/usr/bin/env node
/**
 * tools/serve-phone.mjs — 给"手机连本机后端"用的启动器（`npm run start:phone`）
 * ============================================================================
 * 和 `npm run start:lan` 的区别只有一个，但那个区别就是本脚本存在的理由：
 *
 *   `--lan` 打印的是 **http** 地址（`局域网 http://192.168.1.5:8123/ …`），
 *   而安卓客户端要填的是 **ws** 地址（`ws://192.168.1.5:8123/ws`）。
 *   ★ 服务端那行 `WebSocket ws://0.0.0.0:8123/ws` 也不能直接抄 —— `0.0.0.0`
 *     是"监听全部网卡"的通配地址，**不是**一个能拨的地址；手机填它必然连不上。
 *   ⇒ 本脚本负责把"该填什么"算准，并在起服务之后**真的拨一次**验证。
 *
 * 为什么值得多一个脚本，而不是让人自己拼字符串：
 *   ① 拼错的代价是"手机上点了没反应/一直转圈"，而报错里**不会出现地址长得对不对**；
 *   ② 起得来 ≠ 手机连得上（防火墙是另一层）。所以这里做一次**真实握手**自检，
 *      把"服务没起" / "只通回环" / "这块网卡通" 分开报；
 *   ③ 端口被占是最常见的失败（`npm run dev` 还开着）——先预检，别让它变成
 *      "服务好像起来了、其实是另一个进程在答话"。
 *
 * ★ 判据的边界（不许说过头）：自检成功只证明"**这台机器**能通过这块网卡的地址
 *   完成 WebSocket 握手"。Windows 防火墙通常**不拦本机到本机**的连接，
 *   所以自检绿了手机仍可能连不上 —— 那种情况看输出最后一段。
 *
 * ★ 退出码语义与闸门同一套（`tools/gate/lib.mjs`）：`0` 正常 / `1` 失败。
 *   不写裸数字（G6 R6.7 会拦）。本文件**不 export 任何东西**（G17：tools/ 的导出
 *   必须有外部消费者，这里没有）。
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { connect as netConnect } from 'node:net';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { WebSocket } from 'ws';

import { EXIT_FAIL, EXIT_PASS } from './gate/lib.mjs';

/** 与 `server/cli.ts` 同一条纪律：不写死协议前缀，将来上 TLS 只改这一处 */
const WS_SCHEME = 'ws';

/** 自检的单次握手超时。本机连本机，1.5s 已经很宽松 */
const PROBE_TIMEOUT_MS = 1500;

/** 等"服务真的开始监听"的总时长上限（世界加载 + 监听，冷启动给足余量） */
const READY_TIMEOUT_MS = 20_000;

const USAGE = `用法：npm run start:phone [-- 选项]

选项：
  --port <n>     监听端口（缺省 8123，与 server/cli.ts 的 DEFAULT_PORT 一致）
  --no-build     跳过前端构建（默认每次都构建，免得页面上跑的是旧产物）
  -h, --help     显示这段说明

它做的事：
  ① 预检端口是不是已经被别的进程占了
  ② 构建前端（dist/web）
  ③ 以 0.0.0.0 起服务（= --lan），并打印**手机要填的那一行地址**
  ④ 真的拨一次 WebSocket，把"通到哪一层"分开报出来
`;

/** 打印一段给人看的块（前后各留一个空行，免得混在服务端日志里看不清） */
function block(lines) {
  process.stdout.write(`\n${lines.join('\n')}\n\n`);
}

/** 从 `--port 8123` / `--port=8123` 取端口；没给返回 null */
function readPort(argv) {
  const inline = argv.find((a) => a.startsWith('--port='));
  if (inline !== undefined) return Number(inline.slice('--port='.length));
  const i = argv.indexOf('--port');
  if (i === -1) return null;
  const raw = argv[i + 1];
  return raw === undefined ? Number.NaN : Number(raw);
}

/**
 * TCP 连一下 127.0.0.1:port，连得上 = 有人在听。
 *
 * ★ 为什么用"连一下"而不是"bind 一下"：Windows 上 `SO_REUSEADDR` 语义宽松，
 *   两个进程可以同时 bind 同一个端口（本项目踩过）。bind 成功**不证明**没别人在听；
 *   连得上才证明有人在听。
 */
function probeTcp(port, timeoutMs = 400) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (busy) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        sock?.destroy();
      } catch {
        /* 已销毁，忽略 */
      }
      resolve(busy);
    };
    const sock = netConnect({ port, host: '127.0.0.1' });
    const timer = setTimeout(() => done(false), timeoutMs);
    sock.on('connect', () => done(true));
    sock.on('error', () => done(false));
  });
}

/** 拨一次 WebSocket，只看**握手**成不成（连上就立刻关） */
function probeWs(url) {
  return new Promise((resolve) => {
    let settled = false;
    let ws;
    const finish = (ok, detail) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        ws?.close();
      } catch {
        /* 已经关了，忽略 */
      }
      resolve({ ok, detail });
    };
    try {
      ws = new WebSocket(url);
    } catch (e) {
      resolve({ ok: false, detail: e instanceof Error ? e.message : String(e) });
      return;
    }
    const timer = setTimeout(
      () => finish(false, `${String(PROBE_TIMEOUT_MS)}ms 内没有握手成功`),
      PROBE_TIMEOUT_MS,
    );
    ws.on('open', () => finish(true, ''));
    ws.on('error', () => finish(false, '握手被拒或网络不通'));
  });
}

/** 等到 loopback 连得上为止（服务端是"先加载世界再 listen"，不能立刻拨） */
async function waitUntilListening(port) {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await probeTcp(port)) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

/** 跑一个子进程并等它退出，返回退出码 */
function runNode(scriptUrl, args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [fileURLToPath(scriptUrl), ...args], { stdio: 'inherit' });
    child.on('error', () => resolve(EXIT_FAIL));
    // ★ 退出码为 null 表示"被杀掉"（不是正常退出）—— 不能当成功
    child.on('exit', (code) => resolve(code === null ? EXIT_FAIL : code));
  });
}

async function main(argv) {
  if (argv.includes('-h') || argv.includes('--help')) {
    process.stdout.write(USAGE);
    return EXIT_PASS;
  }

  // ── ① 载入项目自己的启动链（与 `tools/start.mjs` 同一条路，不复制逻辑）──────
  let cli;
  let projectRoot;
  try {
    const { registerTsHooks } = await import('./dev/ts-loader.ts');
    registerTsHooks();
    cli = await import('../server/cli.ts');
    ({ PROJECT_ROOT: projectRoot } = await import('../server/paths.ts'));
  } catch (e) {
    process.stderr.write(`启动失败（加载 server/cli.ts）：${e instanceof Error ? e.message : String(e)}\n`);
    return EXIT_FAIL;
  }

  const rawPort = readPort(argv);
  const port = rawPort ?? cli.DEFAULT_PORT;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    process.stderr.write(`--port 要给 1..65535 的整数，收到 ${JSON.stringify(rawPort)}\n\n${USAGE}`);
    return EXIT_FAIL;
  }

  // ── ② 端口预检 ────────────────────────────────────────────────────────────
  if (await probeTcp(port)) {
    process.stderr.write(
      `端口 ${String(port)} 已经有进程在听 —— 直接起会撞上，而且更像"服务起来了其实是别人在答话"。\n` +
        `  先确认是谁：netstat -ano -p tcp | findstr :${String(port)}\n` +
        `  要么关掉它，要么换端口：npm run start:phone -- --port ${String(port + 1)}\n`,
    );
    return EXIT_FAIL;
  }

  // ── ③ 构建前端（默认每次都建，避免手机打开的是旧产物）──────────────────────
  const webIndex = join(projectRoot, 'dist', 'web', 'src', 'index.html');
  if (argv.includes('--no-build')) {
    process.stdout.write('（--no-build：跳过前端构建）\n');
  } else {
    process.stdout.write('构建前端……\n');
    const code = await runNode(new URL('./build-web.mjs', import.meta.url), []);
    if (code !== EXIT_PASS) {
      process.stderr.write('前端构建失败，已停止（没有可用前端产物就别起服务，否则手机打开是 404）。\n');
      return EXIT_FAIL;
    }
    if (!existsSync(webIndex)) {
      // 构建"成功"但产物不在预期位置 ⇒ 别让"页面打不开"变成要翻代码才懂的事
      process.stderr.write(`构建完成但没找到前端入口：${webIndex}\n（若产物目录结构变了，改这里的探测路径）\n`);
      return EXIT_FAIL;
    }
  }

  // ── ④ 起服务（`--lan` = 绑 0.0.0.0）──────────────────────────────────────
  const lanIps = cli.lanAddresses();
  process.stdout.write(`以 0.0.0.0:${String(port)} 起服务……\n`);
  // ★ 不 await：`main()` 一直挂着（等关闭信号），await 会永远停在这里
  void Promise.resolve(cli.main(['--lan', '--port', String(port)])).catch((e) => {
    process.stderr.write(`服务启动失败：${e instanceof Error ? e.message : String(e)}\n`);
    process.exitCode = EXIT_FAIL;
  });

  if (!(await waitUntilListening(port))) {
    process.stderr.write(
      `${String(READY_TIMEOUT_MS / 1000)}s 内没能连上 127.0.0.1:${String(port)} —— 服务没起来（看上面的日志）。\n`,
    );
    return EXIT_FAIL;
  }

  // ── ⑤ 自检：回环 + 每块局域网网卡各拨一次 ─────────────────────────────────
  const loop = await probeWs(`${WS_SCHEME}://127.0.0.1:${String(port)}/ws`);
  const lines = [
    '─── 自检（真的拨了一次 WebSocket 握手）────────────────────────',
    `  ${loop.ok ? '✅' : '❌'} 127.0.0.1:${String(port)}/ws  ${loop.ok ? '通' : loop.detail}`,
  ];

  const good = [];
  for (const ip of lanIps) {
    const r = await probeWs(`${WS_SCHEME}://${ip}:${String(port)}/ws`);
    lines.push(`  ${r.ok ? '✅' : '❌'} ${ip}:${String(port)}/ws  ${r.ok ? '通' : r.detail}`);
    if (r.ok) good.push(ip);
  }
  if (lanIps.length === 0) {
    lines.push('  ⚠️  没检测到局域网 IPv4 网卡（没连 WiFi/网线？）—— 手机连不上，先让电脑和手机同一个网。');
  }

  // ── ⑥ 手机要填什么 ───────────────────────────────────────────────────────
  if (good.length > 0) {
    lines.push('');
    lines.push('─── 手机上填这个 ───────────────────────────────────────────────');
    for (const ip of good) {
      lines.push(`  WebSocket 地址：${WS_SCHEME}://${ip}:${String(port)}/ws`);
    }
    lines.push(`  先拿手机浏览器开一下：http://${good[0]}:${String(port)}/`);
    lines.push('  （能打开页面 = 网络与防火墙都通了，再装 APK 就基本不会有连接问题）');
    lines.push('');
    lines.push(`  ★ 登录屏的地址框只填「${good[0]}:${String(port)}」就够了`);
    lines.push('    —— 协议前缀与 `/ws` 由 App 自己补（`core/Url.kt#normalizeWsUrl`，有单测）。');
    lines.push('    连成功一次之后这个地址会被记住，下次打开不用再填。');
    if (good.length > 1) {
      lines.push(`  ★ 这台机器有多块网卡（${good.join(' / ')}）：挑**和手机同一网段**的那个。`);
    }
  } else if (loop.ok) {
    lines.push('');
    lines.push('─── 结论：只有回环通，局域网这块没通 ───────────────────────────');
    lines.push('  回环 ✅ 说明服务本身没问题，问题在网络这层，通常是这两个：');
    lines.push('  1) Windows 防火墙拦了入站：允许应用通过防火墙 → 勾上 Node.js（专用网络）。');
    lines.push('     或临时放行端口：');
    lines.push(
      `     netsh advfirewall firewall add rule name="mud-dev" dir=in action=allow protocol=TCP localport=${String(port)}`,
    );
    lines.push('  2) 手机和电脑不在同一个网（手机用了流量 / 连了 5GHz 而电脑在别的网 / 路由器开了 AP 隔离）。');
  }

  lines.push('');
  lines.push('按 Ctrl+C 停止服务。');
  block(lines);
  return EXIT_PASS;
}

const code = await main(process.argv.slice(2));
// ★ 服务在跑时不能退出（未 await 的那条链路还活着）。只有"没起到服务"才走到这里。
if (code !== EXIT_PASS) process.exit(code);

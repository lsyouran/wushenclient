/**
 * tests/launcher.test.ts —— `npm start` 的端到端冒烟（真起子进程）
 * ============================================================================
 * 这是"项目能不能跑起来"的唯一自动化证据。前面的单测各自钉住一块拼图
 * （加载器 / 参数解析 / 静态服务 / ws 挂载），但**只有真 spawn 一次**才能证明
 * 它们串起来能用 —— 尤其是这三件最容易在接缝处坏掉的事：
 *
 *   ① **TS 直跑**：裸 node 认不认别名与 `.js` 说明符（`tools/dev/ts-loader.ts`）
 *   ② **同端口**：页面与 WebSocket 在**同一个端口**上（前端默认地址是同源的，
 *      分成两个端口的表现是"页面能开、点了进不去"）
 *   ③ **能关掉**：SIGTERM 之后进程真的退出（监听没关干净就会挂住，
 *      而这个故障在开发时表现为"Ctrl+C 没反应"）
 *
 * ⚠️ 用 `--web-root` 指向源码树：源码树里同样有 `src/index.html`，
 *   于是本测试**不依赖 `dist/web` 是否已构建**，也就不必在测试里跑构建。
 *
 * ⚠️ 子进程的 stdin 必须是 `'ignore'`：pipe 在 Windows 上会 EBUSY（实测踩过）。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import WebSocket from 'ws';

import { PROJECT_ROOT } from '../server/paths.js';

const ENTRY = join(PROJECT_ROOT, 'tools', 'start.mjs');

interface Launched {
  readonly child: ChildProcess;
  readonly port: number;
  readonly lines: string[];
}

let running: ChildProcess | null = null;

afterEach(async () => {
  const child = running;
  running = null;
  if (child === null || child.exitCode !== null) return;
  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
  child.kill('SIGTERM');
  await Promise.race([exited, new Promise((r) => setTimeout(r, 5_000))]);
  if (child.exitCode === null) child.kill('SIGKILL');
});

function spawnEntry(args: readonly string[]): { child: ChildProcess; lines: string[] } {
  const lines: string[] = [];
  const child = spawn(process.execPath, [ENTRY, ...args], {
    cwd: PROJECT_ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout?.setEncoding('utf8');
  child.stderr?.setEncoding('utf8');
  child.stdout?.on('data', (chunk: string) => {
    for (const line of chunk.split('\n')) if (line !== '') lines.push(line);
  });
  child.stderr?.on('data', (chunk: string) => {
    for (const line of chunk.split('\n')) if (line !== '') lines.push(`[stderr] ${line}`);
  });
  return { child, lines };
}

/** 等那一行机器可读的 `READY {"port":N}` —— 不去解析给人类看的中文日志 */
async function waitReady(child: ChildProcess, lines: string[]): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`20s 内没等到 READY 行。已收到：\n${lines.join('\n')}`));
    }, 20_000);
    const stop = (): void => {
      clearTimeout(timer);
      child.stdout?.off('data', onData);
    };
    const onData = (): void => {
      const line = lines.find((l) => l.startsWith('READY '));
      if (line === undefined) return;
      stop();
      const payload = JSON.parse(line.slice('READY '.length)) as { port: number };
      resolve(payload.port);
    };
    child.stdout?.on('data', onData);
    onData(); // 可能在我们挂上监听之前就已经打印了
    child.once('exit', (code) => {
      stop();
      reject(new Error(`启动器提前退出（code ${String(code)}）：\n${lines.join('\n')}`));
    });
  });
}

async function launch(args: readonly string[]): Promise<Launched> {
  const { child, lines } = spawnEntry(args);
  running = child;
  const port = await waitReady(child, lines);
  return { child, port, lines };
}

function runToExit(args: readonly string[]): Promise<{ code: number | null; lines: string[] }> {
  const { child, lines } = spawnEntry(args);
  return new Promise((resolve) => {
    child.once('exit', (code) => resolve({ code, lines }));
  });
}

/** 连一次 WebSocket 并等第一个包（用来证明 `/ws` 真的在这个端口上） */
function firstFrame(port: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const timer = setTimeout(() => {
      ws.terminate();
      reject(new Error('WebSocket 5s 内没有收到任何帧'));
    }, 5_000);
    ws.on('open', () => {
      ws.send(
        JSON.stringify({ v: 1, type: 'login', token: 'abcdefghijklmnop', role_id: 'launcher-test' }),
      );
    });
    ws.on('message', (data) => {
      clearTimeout(timer);
      const text = String(data);
      ws.close();
      resolve(text);
    });
    ws.on('error', (e: Error) => {
      clearTimeout(timer);
      reject(e);
    });
  });
}

// ---------------------------------------------------------------------------

describe('命令行入口（不起服务的那几条）', () => {
  it('--help 打印用法并以 0 退出（不去 listen）', async () => {
    const { code, lines } = await runToExit(['--help']);
    expect(code).toBe(0);
    expect(lines.join('\n')).toContain('用法');
  });

  it('★ 无法识别的参数 → 退出码 1 且打印用法（不许静默吞掉）', async () => {
    const { code, lines } = await runToExit(['--port', '8123', '--typo']);
    expect(code).toBe(1);
    expect(lines.join('\n')).toContain('--typo');
    expect(lines.join('\n')).toContain('用法');
  });
});

describe('★ 真启动（`npm start` 等价路径）', () => {
  it('同一个端口上：页面能取到，/ws 也能连上并收到登录回包', async () => {
    const { port, child } = await launch(['--port', '0', '--web-root', PROJECT_ROOT]);

    // ① 页面（走重定向到首页）
    const page = await fetch(`http://127.0.0.1:${port}/src/index.html`);
    expect(page.status).toBe(200);
    expect(page.headers.get('content-type')).toContain('text/html');

    // ② 静态通路 + JS MIME（浏览器对 <script type="module"> 做严格 MIME 校验）
    const mjs = await fetch(`http://127.0.0.1:${port}/tools/gate/lib.mjs`);
    expect(mjs.status).toBe(200);
    expect(mjs.headers.get('content-type')).toContain('text/javascript');

    // ③ **同一个端口**上的 WebSocket —— 这正是"同源默认地址"能成立的原因。
    //    若二者分处两个端口，这一步会连到静态服务器上，表现是页面能开、点了进不去。
    const frame = JSON.parse(await firstFrame(port)) as { type: string };
    expect(frame.type).toBe('login');

    expect(child.exitCode).toBeNull(); // 跑完这些它应该还活着
  });

  it('被要求停止后会退出（不挂住）', async () => {
    // ⚠️ 在 Windows 上 `kill('SIGTERM')` **不会**投递真的信号（node 直接终止进程），
    //    因此这里**不能**断言退出码 —— 那是平台差异，不是代码差异。
    //    这里只断言"能停下来、不挂住"，这一条在任何平台都成立。
    //    "关得干净"（keep-alive 连接不会让 close() 挂住）由
    //    `tests/static-web.test.ts` 的『同端口接线』在**进程内**直接钉住。
    const { child, port } = await launch(['--port', '0', '--web-root', PROJECT_ROOT]);
    expect(port).toBeGreaterThan(0);

    const exited = new Promise<number | null>((resolve) =>
      child.once('exit', (code) => resolve(code)),
    );
    child.kill('SIGTERM');
    const outcome = await Promise.race([
      exited,
      new Promise<'timeout'>((r) => setTimeout(() => r('timeout'), 10_000)),
    ]);
    expect(outcome).not.toBe('timeout');
  });

  it('--no-web：只跑 WebSocket，页面不存在', async () => {
    const { port } = await launch(['--port', '0', '--no-web']);
    // 这一路上没有静态处理器：ws 自己那个服务器对普通 GET 回 426 Upgrade Required
    // （不是 200，也就拿不到页面）
    const page = await fetch(`http://127.0.0.1:${port}/src/index.html`);
    expect(page.status).not.toBe(200);
    // 但 /ws 是活的
    const frame = JSON.parse(await firstFrame(port)) as { type: string };
    expect(frame.type).toBe('login');
  });
});

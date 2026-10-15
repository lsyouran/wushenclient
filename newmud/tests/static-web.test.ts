/**
 * tests/static-web.test.ts —— 静态 Web 服务（把前端产物发给浏览器）
 * ============================================================================
 * 为什么需要它：前端 `defaultUrl()` 是**同源**的（`ws://${location.host}/ws`），
 * 所以页面与 WebSocket 必须由**同一个端口**提供 —— 那个端口就是这个 http 服务器。
 *
 * ★ 断言带对照组：穿越（`..`）那条只说"被拒"是不够的，
 *   必须同时证明**被拒的目标在根之外确实存在**，否则护栏拆掉测试照样绿。
 *
 * ★ MIME 不是小事：浏览器对 `<script type="module">` 做**严格 MIME 校验**，
 *   `.js` 头不对（例如 `text/plain`）会直接拒绝执行 —— 表现是白屏，
 *   而 Network 面板里那个请求是 200，很容易查错方向。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import type { Server } from 'node:http';
import { createConnection } from 'node:net';
import { join } from 'node:path';
import WebSocket from 'ws';

import { createGameServer } from '../server/main.js';
import type { GameServer } from '../server/main.js';
import { parseArgs } from '../server/cli.js';
import { PROJECT_ROOT } from '../server/paths.js';
import {
  DEFAULT_INDEX_PATH,
  createWebServer,
  guessContentType,
  resolveRequestPath,
} from '../server/static.js';

const open: Server[] = [];
let game: GameServer | null = null;

async function listen(rootDir: string, indexPath?: string): Promise<string> {
  const server = createWebServer({
    rootDir,
    ...(indexPath === undefined ? {} : { indexPath }),
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  open.push(server);
  const addr = server.address() as { port: number };
  return `http://127.0.0.1:${addr.port}`;
}

afterEach(async () => {
  if (game !== null) {
    const closing = game;
    game = null;
    await closing.close();
  }
  for (const server of open) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  open.length = 0;
});

/** 直接写裸 HTTP 请求：绕开 `fetch` / 浏览器对 URL 的规范化（见下面穿越那条用例） */
function rawRequest(port: number, target: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: '127.0.0.1', port }, () => {
      socket.write(`GET ${target} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n`);
    });
    socket.setEncoding('utf8');
    let buf = '';
    socket.on('data', (chunk) => {
      buf += chunk;
    });
    socket.on('end', () => resolve(buf));
    socket.on('error', reject);
  });
}

// ---------------------------------------------------------------------------
// 纯函数：MIME
// ---------------------------------------------------------------------------

describe('guessContentType', () => {
  it('浏览器需要的四类一定认得', () => {
    expect(guessContentType('a.js')).toContain('text/javascript');
    expect(guessContentType('a.mjs')).toContain('text/javascript');
    expect(guessContentType('a.html')).toContain('text/html');
    expect(guessContentType('a.css')).toContain('text/css');
  });

  it('大小写不敏感', () => {
    expect(guessContentType('A.JS')).toContain('text/javascript');
  });

  it('认不出来的扩展名退化为二进制流（不猜、不乱报 text/html）', () => {
    expect(guessContentType('a.zzz')).toBe('application/octet-stream');
    expect(guessContentType('noext')).toBe('application/octet-stream');
  });
});

// ---------------------------------------------------------------------------
// 纯函数：URL 路径 → 文件路径（含穿越护栏）
// ---------------------------------------------------------------------------

describe('resolveRequestPath', () => {
  const root = PROJECT_ROOT;

  it('普通路径落在根之下', () => {
    expect(resolveRequestPath(root, '/src/index.html')).toBe(join(root, 'src', 'index.html'));
  });

  it('丢掉 query 与 hash', () => {
    expect(resolveRequestPath(root, '/a/b.js?v=1#frag')).toBe(join(root, 'a', 'b.js'));
  });

  it('百分号编码先解码再判定（否则 %2e%2e 就是后门）', () => {
    expect(resolveRequestPath(root, '/%61/b')).toBe(join(root, 'a', 'b'));
    expect(resolveRequestPath(root, '/%2e%2e/%2e%2e/etc')).toBe(null);
  });

  it('各种形态的穿越一律返回 null', () => {
    for (const bad of ['/../x', '/a/../../x', '/%2e%2e/x', '/a/%2e%2e/%2e%2e/x', '/..%5cx']) {
      expect(resolveRequestPath(root, bad), bad).toBe(null);
    }
  });

  it('NUL 与畸形编码返回 null（不让它走到文件系统）', () => {
    expect(resolveRequestPath(root, '/%00x')).toBe(null);
    expect(resolveRequestPath(root, '/%zz')).toBe(null);
  });

  it('对照组：同一函数对正常路径必须给非 null（证明它不是"永远返回 null"）', () => {
    expect(resolveRequestPath(root, '/package.json')).not.toBe(null);
  });
});

// ---------------------------------------------------------------------------
// HTTP 层：真起服务器（端口 0）
// ---------------------------------------------------------------------------

describe('createWebServer', () => {
  it('/ 会重定向到首页（不能直接吐内容 —— 相对引用会错位到根）', async () => {
    const base = await listen(PROJECT_ROOT);
    const res = await fetch(`${base}/`, { redirect: 'manual' });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(`/${DEFAULT_INDEX_PATH}`);
  });

  it('重定向落点真的能取到 HTML', async () => {
    const base = await listen(PROJECT_ROOT);
    const res = await fetch(`${base}/${DEFAULT_INDEX_PATH}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect((await res.text()).toLowerCase()).toContain('<!doctype html');
  });

  it('静态文件带对 MIME（.js/.mjs 必须是 JS MIME，否则 ESM 被浏览器拒绝）', async () => {
    const base = await listen(PROJECT_ROOT);
    const css = await fetch(`${base}/src/style.css`);
    expect(css.status).toBe(200);
    expect(css.headers.get('content-type')).toContain('text/css');

    const js = await fetch(`${base}/tools/gate/lib.mjs`);
    expect(js.status).toBe(200);
    expect(js.headers.get('content-type')).toContain('text/javascript');
  });

  it('不存在的路径 → 404', async () => {
    const base = await listen(PROJECT_ROOT);
    const res = await fetch(`${base}/nope-nope-nope.js`);
    expect(res.status).toBe(404);
  });

  it('浏览器自动请求的 /favicon.ico → 204（不该刷 404 噪音）', async () => {
    const base = await listen(PROJECT_ROOT);
    const res = await fetch(`${base}/favicon.ico`);
    expect(res.status).toBe(204);
  });

  it('★ 穿越请求拿不到根之外的文件（用原始 socket，绕过 URL 规范化）', async () => {
    // 根设为 src/，于是 ../package.json 正好落在根外、且**真实存在**
    const srcRoot = join(PROJECT_ROOT, 'src');
    expect(existsSync(join(PROJECT_ROOT, 'package.json'))).toBe(true);

    const base = await listen(srcRoot, 'index.html');
    const port = Number(new URL(base).port);

    // ★ 为什么必须用裸 socket：`fetch`（以及浏览器）会按 WHATWG URL 规范**先规范化**
    //   `%2e%2e` → `..` → 再往上吃掉一层，于是请求根本没带穿越到达服务器
    //   （实测：用 fetch 发 `/%2e%2e/package.json`，服务端收到的是 `/package.json`）。
    //   要验证护栏本身，就得发一个**不经过规范化**的原始请求 —— 这也是
    //   curl --path-as-is / 手写客户端能做到的事。
    for (const target of ['/../package.json', '/%2e%2e/package.json', '/..%5cpackage.json']) {
      const raw = await rawRequest(port, target);
      expect(raw.split('\r\n')[0], target).toContain('403');
    }
  });

  it('对照组：同一个根下正常的文件仍可取到（证明 403 是护栏而不是全盘拒绝）', async () => {
    const srcRoot = join(PROJECT_ROOT, 'src');
    const base = await listen(srcRoot, 'index.html');
    const ok = await fetch(`${base}/index.html`);
    expect(ok.status).toBe(200);
    const main = await fetch(`${base}/main.ts`);
    expect(main.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// 与 WebSocket 同端口 —— 前端"同源默认地址"能成立的前提
// ---------------------------------------------------------------------------

describe('与 WebSocket 同端口（接线）', () => {
  it('★ 一个端口既发页面又接 /ws；且带 keep-alive 连接时 close() 也不挂住', async () => {
    const web = createWebServer({ rootDir: PROJECT_ROOT });
    game = await createGameServer({ port: 0, httpServer: web, timers: false });
    const port = game.port;

    // ① 静态那一半：页面取得到
    const page = await fetch(`http://127.0.0.1:${port}/src/index.html`);
    expect(page.status).toBe(200);

    // ② WebSocket 那一半：**同一个端口**、路径 /ws
    const socket = await new Promise<WebSocket>((resolve, reject) => {
      const s = new WebSocket(`ws://127.0.0.1:${port}/ws`);
      s.on('open', () => resolve(s));
      s.on('error', reject);
    });
    expect(socket.readyState).toBe(WebSocket.OPEN);

    // ③ 刻意**不**主动断开 ws、也不等 http 的 keep-alive 释放：
    //    真实浏览器就是这样（会留连接），close() 必须照样返回。
    //    否则"关服"会变成一个挂住的 Promise —— 开发时表现为 Ctrl+C 没反应。
    const outcome = await Promise.race([
      game.close().then(() => 'closed' as const),
      new Promise<'timeout'>((r) => setTimeout(() => r('timeout'), 8_000)),
    ]);
    game = null;
    expect(outcome).toBe('closed');
  });
});

// ---------------------------------------------------------------------------
// 布局知识只有一处：服务端认的首页路径 = 构建产物真的写出的路径
// ---------------------------------------------------------------------------

describe('产物布局对账', () => {
  it('★ DEFAULT_INDEX_PATH / 缺省 webRoot 与 copy-web-assets 的产出路径一致', () => {
    const text = readFileSync(join(PROJECT_ROOT, 'tools', 'copy-web-assets.mjs'), 'utf8');
    const block = /const ASSETS\s*=\s*\[([\s\S]*?)\];/.exec(text);
    expect(block, '提不出 ASSETS 表 —— 改了写法请同步更新本测试').not.toBe(null);

    const pairs = [...(block?.[1] ?? '').matchAll(/\[\s*'([^']+)'\s*,\s*'([^']+)'\s*\]/g)].map(
      (m) => [m[1] ?? '', m[2] ?? ''] as const,
    );
    // 死提取守卫：提不出东西时上面那条会红，但这里再挡一次"空表也算过"
    expect(pairs.length).toBeGreaterThan(0);

    const indexPair = pairs.find(([from]) => from === 'src/index.html');
    expect(indexPair, '构建产物里必须有一份首页').toBeDefined();
    const to = indexPair?.[1] ?? '';

    // 服务端认的首页（相对产物根）= 构建写出的首页（相对产物根）
    expect(DEFAULT_INDEX_PATH).toBe(to.replace(/^dist\/web\//, ''));
    // 缺省产物根（CLI）+ 首页 = 构建真的写到的那条绝对路径
    expect(join(parseArgs([]).webRoot, DEFAULT_INDEX_PATH)).toBe(join(PROJECT_ROOT, to));
  });
});

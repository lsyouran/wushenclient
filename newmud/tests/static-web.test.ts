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
  SECURITY_HEADERS,
  createWebServer,
  guessContentType,
  resolveRequestPath,
} from '../server/static.js';
import { MAX_PLAINTEXT_CHARS } from '../shared/constants.js';
import { ROLE_NAME_MAX_LENGTH } from '../shared/protocol.js';

const open: Server[] = [];
let game: GameServer | null = null;

/** 源码树里的首页原文（S10 / L1 都要拿它做静态检查） */
function indexHtml(): string {
  return readFileSync(join(PROJECT_ROOT, 'src', 'index.html'), 'utf8');
}

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

// ---------------------------------------------------------------------------
// S10（2026-10-16 审查）：输入框没有 `maxlength`
// ---------------------------------------------------------------------------
//
// 四个文本输入框原先**都没有** `maxlength` —— 玩家可以粘贴任意长的文本。
// 后果不是崩溃，而是"报错说不到点上"：超长输入被服务端的明文上限拒掉后，
// 走 `loginerror` 通道把玩家甩回登录页（见审查 S2/S10），界面上也看不出"太长"。
//
// ★ HTML 里写不出 `import { … }`，所以这里必须**抄**一份数字 ——
//   但"抄"不能没人看着：本组断言把"HTML 的 maxlength == 服务端常量"钉住，
//   改常量却忘了改 HTML ⇒ 这里红。
describe('S10 · 输入框 maxlength 必须与服务端常量一致', () => {
  const html = indexHtml;

  /** 取指定 id 的整个 `<input …>` 标签（属性跨行，所以用 `[^>]*`） */
  function inputTag(source: string, id: string): string {
    const m = new RegExp(`<input\\b[^>]*\\bid="${id}"[^>]*>`, 's').exec(source);
    if (m === null) throw new Error(`找不到 id="${id}" 的 input —— 改了 id 请同步本测试`);
    return m[0];
  }

  it('★ 四个输入框的 maxlength 与各自的上限常量一一对应', () => {
    const src = html();
    const expected: ReadonlyArray<readonly [string, number]> = [
      // 名号：创角/登录名 → 与服务端 `isRoleName` 同一上限
      ['loginName', ROLE_NAME_MAX_LENGTH],
      ['regName', ROLE_NAME_MAX_LENGTH],
      // 指令框与聊天框提交的都是"一条指令" → 与明文通道上限同一口径
      //   （聊天正文另有 CHAT_MAX_LENGTH=200，由服务端在 say/shout/tell 里判）
      ['cmdInput', MAX_PLAINTEXT_CHARS],
      ['chatInput', MAX_PLAINTEXT_CHARS],
    ];
    for (const [id, limit] of expected) {
      const tag = inputTag(src, id);
      const m = /maxlength="(\d+)"/.exec(tag);
      expect(m, `${id} 缺 maxlength`).not.toBeNull();
      expect(Number(m?.[1]), `${id} 的 maxlength 与服务端常量不符`).toBe(limit);
    }
  });

  it('★ 不存在"没有 maxlength 的文本输入框"（漏一个就回到无限长输入）', () => {
    const src = html();
    const inputs = [...src.matchAll(/<input\b[^>]*>/g)].map((m) => m[0]);
    expect(inputs.length).toBeGreaterThan(0); // 死提取守卫：一个都没提出来说明正则失效

    const missing = inputs
      .filter((t) => !/\bmaxlength="/.test(t))
      .map((t) => /id="([^"]+)"/.exec(t)?.[1] ?? '(无 id)');
    expect(missing, `这些输入框缺 maxlength：${missing.join(', ')}`).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// L1（2026-10-16 审查）：静态服务器缺安全响应头
// ---------------------------------------------------------------------------
//
// ★ 为什么"开发期无所谓"仍然要补：`--host 0.0.0.0` 是对外暴露那条路径，
//   而它今天就存在（N2 修完后默认绑 127.0.0.1，但 `--host` 是个开关）。
//   缺 `frame-ancestors` / `X-Frame-Options` ⇒ 任意站点可以把我嵌进 iframe
//   做点击劫持；缺 CSP ⇒ 一旦有任何一处文本渲染漏成 HTML，就直接变成 XSS 执行点；
//   缺 `Referrer-Policy` ⇒ 页面 URL（可能含信息）随外链请求泄漏出去。
//   WS 侧的 TLS 是**部署项**（见 `docs/00` 运维册），不是本文件能解决的。
describe('L1 · 安全响应头', () => {
  it('HTML 页面带上 CSP / X-Frame-Options / Referrer-Policy / nosniff', async () => {
    const base = await listen(PROJECT_ROOT);
    const res = await fetch(`${base}/${DEFAULT_INDEX_PATH}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-security-policy')).toBe(
      SECURITY_HEADERS['content-security-policy'],
    );
    expect(res.headers.get('x-frame-options')).toBe('DENY');
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('★ 四段响应都带安全头（成功 / 404 / 204 / 302 一视同仁）', async () => {
    const base = await listen(PROJECT_ROOT);
    const cases: readonly (readonly [string, number])[] = [
      [`/${DEFAULT_INDEX_PATH}`, 200],
      ['/nope-nope-nope.js', 404],
      ['/favicon.ico', 204],
      ['/', 302],
    ];
    for (const [path, status] of cases) {
      const res = await fetch(`${base}${path}`, { redirect: 'manual' });
      expect(res.status, path).toBe(status);
      expect(res.headers.get('x-frame-options'), path).toBe('DENY');
      expect(res.headers.get('referrer-policy'), path).toBe('no-referrer');
      expect(res.headers.get('content-security-policy'), path).not.toBeNull();
    }
  });

  it('★ CSP 不放行 unsafe-inline / unsafe-eval（放行就等于没写）', () => {
    const csp = SECURITY_HEADERS['content-security-policy'] ?? '';
    expect(csp).not.toContain('unsafe-inline');
    expect(csp).not.toContain('unsafe-eval');
    // 同源 WebSocket 必须被允许，否则页面连不上服务端（表现是"点了没反应"）
    expect(csp).toContain("connect-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
  });

  it('★ 前端不写"会被上面这条 CSP 拦下"的内联写法（否则白屏）', () => {
    const src = indexHtml();
    // ① 无 `<style>` 块、无 `style="…"` 属性、无内联事件处理器
    expect(src, '出现 <style> 块会被 style-src 拦下').not.toMatch(/<style[\s>]/i);
    expect(src, '出现 style="…" 属性会被 style-src 拦下').not.toMatch(/\sstyle="/i);
    expect(src, '出现 onclick="…" 之类的内联处理器会被 script-src 拦下').not.toMatch(
      /\son[a-z]+\s*=/i,
    );
    // ② 每个 <script> 都必须有 src（内联脚本体会被 script-src 拦下）
    const scripts = [...src.matchAll(/<script\b[^>]*>/gi)].map((m) => m[0]);
    expect(scripts.length).toBeGreaterThan(0); // 死提取守卫
    for (const tag of scripts) expect(tag, `${tag} 是内联脚本`).toMatch(/\ssrc="/i);
  });
});

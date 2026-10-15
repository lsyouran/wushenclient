/**
 * server/static.ts — 把前端产物发给浏览器（与 WebSocket **同端口**）
 * ============================================================================
 * 为什么需要它：前端 `src/main.ts` 的 `defaultUrl()` 是**同源**的
 *   （`ws://${location.host}/ws`）—— 页面从哪个端口来，就往哪个端口连。
 *   所以"页面"和"WebSocket"必须是同一个 http 服务器上的两条路。
 *   这也是 `startWsServer({ httpServer })` 存在的原因：本文件造服务器，
 *   ws 适配层往它身上挂 upgrade。
 *
 * 三条容易踩的约定（各自都曾让人查错方向）：
 *   ① **必须 302 而不是直接吐内容**：页面的 `./style.css` / `./main.js` 是
 *      相对 `index.html` 的位置写的。若把首页内容直接挂在 `/`，相对引用会
 *      解析到 `/style.css`、`/main.js` → 404 → 一片白的页面（Network 里全是 404）。
 *   ② **`.js` 必须是 JS MIME**：浏览器对 `<script type="module">` 做严格 MIME
 *      校验，头不对就直接拒绝执行，且表现同样是白屏。
 *   ③ **穿越护栏要在解码之后判**：`%2e%2e` 解码后才看得出是 `..`。
 *
 * 目录布局的知识只此一处：产物根是 `dist/web/`，首页在 `src/index.html`
 *   （由 `tools/copy-web-assets.mjs` 产出，见 docs/26 §15.2 的补注）。
 */

import { createReadStream, statSync } from 'node:fs';
import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { extname, isAbsolute, relative, resolve } from 'node:path';

/** 产物里的首页（相对产物根）。刻意不含前导斜杠。 */
export const DEFAULT_INDEX_PATH = 'src/index.html';

/** 浏览器会自动请求它；没有就回 204，免得刷一屏 404 噪音 */
const FAVICON_PATH = '/favicon.ico';

const CHARSET = '; charset=utf-8';

/**
 * 扩展名 → MIME。
 * ★ 只列**产物里真会出现**的类型：认不出来的一律退化为二进制流，
 *   而不是乱猜 `text/html`（乱猜会让浏览器把二进制当文档渲染）。
 */
const MIME: Readonly<Record<string, string>> = {
  '.html': `text/html${CHARSET}`,
  '.css': `text/css${CHARSET}`,
  '.js': `text/javascript${CHARSET}`,
  '.mjs': `text/javascript${CHARSET}`,
  '.json': `application/json${CHARSET}`,
  '.map': `application/json${CHARSET}`,
  '.txt': `text/plain${CHARSET}`,
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};

const OCTET_STREAM = 'application/octet-stream';

export function guessContentType(filePath: string): string {
  return MIME[extname(filePath).toLowerCase()] ?? OCTET_STREAM;
}

/**
 * URL 路径 → 磁盘绝对路径。越界（含各种形态的 `..`）返回 `null`。
 *
 * 纯函数、不碰文件系统：判定"越界"只用**路径代数**，能不能读到由调用方 stat。
 * 这样护栏本身可以被逐条钉死（见 tests/static-web.test.ts）。
 *
 * 顺序上有一处**不能省**：先解码、再判。`%2e%2e` 在解码前只是普通字符串，
 * 解出来才是 `..` —— 反过来写就是一个可用的目录穿越后门。
 * 反斜杠统一成 `/`：Windows 上 `\` 也是分隔符，`..%5c` 同样得拦住。
 */
export function resolveRequestPath(rootDir: string, urlPath: string): string | null {
  const noQuery = (urlPath.split('?')[0] ?? '').split('#')[0] ?? '';
  let decoded: string;
  try {
    decoded = decodeURIComponent(noQuery);
  } catch {
    return null; // 畸形百分号编码（例如 /%zz）—— 交给 400/404，别让它走到文件系统
  }
  if (decoded.includes('\0')) return null;

  const rel = decoded.replace(/\\/g, '/').replace(/^\/+/, '');
  const target = resolve(rootDir, rel);
  const back = relative(rootDir, target);
  if (back === '') return target; // 根目录自身
  if (back.startsWith('..') || isAbsolute(back)) return null; // 越界
  return target;
}

export interface WebServerOptions {
  readonly rootDir: string;
  /** 首页位置（相对 `rootDir`）；缺省 `DEFAULT_INDEX_PATH` */
  readonly indexPath?: string;
}

/**
 * 造一个只管"发静态文件"的 http 服务器（**不 listen** —— 端口由调用方决定）。
 *
 * 不 listen 是刻意的：WebSocket 适配层要挂到同一个服务器上，
 * 谁 listen 谁负责 close，只留一个 owner，避免"关了一半"的半开状态。
 */
export function createWebServer(options: WebServerOptions): Server {
  const rootDir = resolve(options.rootDir);
  const indexPath = options.indexPath ?? DEFAULT_INDEX_PATH;
  return createServer((req, res) => {
    handleRequest(req, res, rootDir, indexPath);
  });
}

function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  rootDir: string,
  indexPath: string,
): void {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    sendText(res, 405, 'Method Not Allowed');
    return;
  }

  const url = req.url ?? '/';
  const pathOnly = url.split('?')[0] ?? '/';

  // ① 首页走重定向，而不是"内容挂在 /"——否则相对引用错位（见文件头）
  if (pathOnly === '/') {
    res.writeHead(302, { location: `/${indexPath}`, 'cache-control': 'no-store' });
    res.end();
    return;
  }

  const target = resolveRequestPath(rootDir, url);
  if (target === null) {
    sendText(res, 403, 'Forbidden');
    return;
  }
  const stat = statFile(target);
  if (stat === null) {
    // favicon 缺失很常见，回 204 而不是 404：它是浏览器自动请求的，不是页面需求
    if (pathOnly === FAVICON_PATH) {
      res.writeHead(204, { 'cache-control': 'no-store' });
      res.end();
      return;
    }
    sendText(res, 404, 'Not Found');
    return;
  }

  res.writeHead(200, {
    'content-type': guessContentType(target),
    'content-length': stat.size,
    // 开发期优先"改完刷新就看到"，不缓存
    'cache-control': 'no-store',
    // 浏览器不许再猜类型（与上面严格的 MIME 表配套）
    'x-content-type-options': 'nosniff',
  });
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  const stream = createReadStream(target);
  stream.on('error', () => {
    // 头已发出去就只能炸掉连接，别让它挂成"永远加载中"
    if (res.headersSent) res.destroy();
    else sendText(res, 500, 'Read Error');
  });
  stream.pipe(res);
}

function statFile(target: string): { size: number } | null {
  try {
    const s = statSync(target);
    return s.isFile() ? { size: s.size } : null;
  } catch {
    return null;
  }
}

function sendText(res: ServerResponse, status: number, body: string): void {
  res.writeHead(status, {
    'content-type': `text/plain${CHARSET}`,
    'cache-control': 'no-store',
  });
  res.end(body);
}

#!/usr/bin/env node
/**
 * tools/copy-web-assets.mjs — 把前端的静态资源复制到构建产物目录
 * ============================================================================
 * `tsc` 只编译 .ts，不会搬 .html / .css。少了这一步，产物目录里就只有 .js，
 * 打开是一片白 —— 而"为什么白"要翻很久才想到是资源没复制。
 *
 * 用法：`npm run build:web`（先 tsc，再跑本脚本）
 */

import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXIT_FAIL } from './gate/lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
// tools/ 的上一级就是项目根（与闸门 lib.mjs 同一套定位方式，不硬编码目录名）
const ROOT = join(HERE, '..');

/** 源 → 产物（相对项目根） */
const ASSETS = [
  ['src/index.html', 'dist/web/src/index.html'],
  ['src/style.css', 'dist/web/src/style.css'],
  // ★ 工具条按钮的图标字体（wushen 用的 Glyphicons Halflings，SIL 开源）。
  //   与 `style.css` 里的 `@font-face` 是同一条链：CSS 引 `./fonts/…`，
  //   所以产物里必须保持同样的相对位置 —— 少复制一个，按钮上就是一格空白。
  ['src/fonts/glyphicons-halflings-regular.woff2', 'dist/web/src/fonts/glyphicons-halflings-regular.woff2'],
  ['src/fonts/glyphicons-halflings-regular.woff', 'dist/web/src/fonts/glyphicons-halflings-regular.woff'],
];

let copied = 0;
const problems = [];

for (const [from, to] of ASSETS) {
  const src = join(ROOT, from);
  const dst = join(ROOT, to);
  if (!existsSync(src)) {
    problems.push(`缺少源文件：${from}`);
    continue;
  }
  mkdirSync(dirname(dst), { recursive: true });
  copyFileSync(src, dst);
  copied += 1;
}

console.log(`  复制静态资源：${copied}/${ASSETS.length}`);

// ---------------------------------------------------------------------------
// 孤儿产物：`tsc` **不会**清理"源文件已删掉"的那些 .js
// ---------------------------------------------------------------------------
/**
 * `dist/web/` 是**实际对外服务的目录**（静态资源与 WS 同端口，见 docs/26 §17），
 * 一个删掉的模块会一直躺在那里被 HTTP 发出去 —— 既没人 import、也没人读，
 * 却能被请求到。实测到过 `dist/web/src/ui/chrome.js`：源码 `src/ui/chrome.ts`
 * 早就删了，产物还在，且 `tsc` 每次重建都不会动它。
 *
 * 判据：产物里的每个 `*.js` 都必须有对应的 `*.ts`。
 * `tsconfig.web.json` 没开 `allowJs`，所以 `dist` 里的 `.js` 只能由 `.ts` 编译而来
 * —— 找不到源的那个必然是残留（`src/index.html` / `style.css` / 字体不走这条路）。
 */
function collectJs(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  const stack = [dir];
  while (stack.length > 0) {
    const cur = stack.pop();
    for (const name of readdirSync(cur)) {
      const p = join(cur, name);
      if (statSync(p).isDirectory()) stack.push(p);
      else if (name.endsWith('.js')) out.push(p);
    }
  }
  return out;
}

const outRoot = join(ROOT, 'dist', 'web');
let cleaned = 0;
for (const js of collectJs(outRoot)) {
  const relJs = relative(outRoot, js).split(sep).join('/');
  if (existsSync(join(ROOT, relJs.replace(/\.js$/, '.ts')))) continue;
  rmSync(js, { force: true });
  cleaned += 1;
  console.log(`  🧹 清掉孤儿产物：dist/web/${relJs}（对应的 .ts 已不存在）`);
}
if (cleaned > 0) {
  console.log(`  共清理 ${cleaned} 个孤儿产物（tsc 不会自己清）`);
}

if (problems.length > 0) {
  for (const p of problems) console.error(`  ❌ ${p}`);
  // tools/ 内不写裸数字退出码（G6 R6.7）——统一从 lib.mjs 取
  process.exit(EXIT_FAIL);
}
console.log('  ✅ 前端产物就绪：dist/web/src/index.html');

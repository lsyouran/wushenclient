#!/usr/bin/env node
/**
 * tools/run.mjs — 一键开服：构建前端 → 起服务 → 开浏览器，`--watch` 时持续重建前端
 * ============================================================================
 * 为什么还要有它（`npm start` 已经能起服务）：
 *   前端产物在 `dist/web/`，`tsc` 只认 `.ts`，`style.css` / `index.html` 还得由
 *   `copy-web-assets.mjs` 搬过去。**忘了重建**是本项目真实踩过的坑 ——
 *   `static.ts` 是 `cache-control: no-store`，所以 F5 也救不回来，页面上就是旧 JS。
 *   这里把那条纪律变成一个动作：
 *     · 缺省 **先构建一次**再起服务（不存在"起来了但跑的是旧前端"）；
 *     · `--watch` 持续盯 `src/` 与 `shared/`，改完自动重建，人只需要 F5。
 *
 * 用法：
 *   npm run dev                            # = node tools/run.mjs --watch
 *   node tools/run.mjs                     # 构建一次 → 起服务 → 开浏览器
 *   node tools/run.mjs --no-open           # 不开浏览器（服务器 / 测试机）
 *   node tools/run.mjs --skip-build        # 跳过构建（前端没改，想秒起）
 *   node tools/run.mjs --port 9000 --lan   # 其余参数**原样**交给 server/cli.ts
 *
 * ★ 退出码沿用闸门那套（`EXIT_PASS` / `EXIT_FAIL`），tools/ 内不写裸数字（G6 R6.7）。
 * ★ 一切路径从 `import.meta.url` 上溯，不用 `process.cwd()`（G12 R3）。
 * ★ 构建逻辑只有一处（`tools/build-web.mjs`）—— 本文件不重复拼 tsc 参数。
 */

import { spawn } from 'node:child_process';
import { watch } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildFrontend } from './build-web.mjs';
import { EXIT_FAIL, EXIT_PASS } from './gate/lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

const argv = process.argv.slice(2);
const wantWatch = argv.includes('--watch');
const wantOpen = !argv.includes('--no-open');
const skipBuild = argv.includes('--skip-build');
/** 本脚本自己的开关不往 `cli.ts` 里传（它不认这些，会当成用法错误） */
const serverArgs = argv.filter((a) => a !== '--watch' && a !== '--no-open' && a !== '--skip-build');

/**
 * 盯 `src/` 与 `shared/`（前端会 import 后者）自动重建。
 * ★ 防抖 250ms：编辑器保存常常连发两三个事件，不防抖会同时跑两次 tsc。
 * ★ 重建期间又改文件 ⇒ 记一个 `dirty`，本轮结束后**再跑一次**（不丢最后一次改动）。
 * @returns {() => void} 关掉全部监听（**Ctrl+C 时必须调**，见下方 `onShutdown`）
 */
function startWatch() {
  const targets = [join(ROOT, 'src'), join(ROOT, 'shared')];
  const RELEVANT = ['.ts', '.css', '.html', '.woff', '.woff2'];
  let timer = null;
  let building = false;
  let dirty = null;
  const watchers = [];

  const rebuild = (why) => {
    if (building) {
      dirty = why;
      return;
    }
    building = true;
    process.stdout.write(`\n🔁 ${why} → 重建前端…\n`);
    const ok = buildFrontend();
    building = false;
    if (dirty !== null) {
      const next = dirty;
      dirty = null;
      rebuild(next);
      return;
    }
    process.stdout.write(ok ? '  ↻ 刷新浏览器（F5）就看到了\n' : '  ⚠️ 重建失败，产物仍是上一版\n');
  };

  for (const dir of targets) {
    watchers.push(
      watch(dir, { recursive: true }, (_ev, file) => {
        if (file === null) return;
        if (!RELEVANT.some((ext) => file.endsWith(ext))) return;
        if (timer !== null) clearTimeout(timer);
        timer = setTimeout(() => {
          timer = null;
          rebuild(relative(ROOT, join(dir, file)).split('\\').join('/'));
        }, 250);
      }),
    );
  }
  process.stdout.write('👀 已开启监听：src/ 与 shared/ 一改就重建前端（Ctrl+C 退出）\n');

  return () => {
    if (timer !== null) clearTimeout(timer);
    for (const w of watchers) w.close();
  };
}

/**
 * `--watch` 会留下 `fs.watch` 句柄 —— **它们也会让事件循环不退出**。
 * 实测（代码审视，不是真机）：不关的话 `cli.ts` 打完「已关闭。」进程仍挂着，
 * 表现是"Ctrl+C 之后窗口没回来"，而日志已经说关了 —— 比报错更难查。
 */
const closers = [];
function onShutdown() {
  for (const close of closers) close();
  closers.length = 0;
}

/** 用系统默认浏览器打开（Windows 走 `start`；不等待、不占用本进程） */
function openBrowser(url) {
  const win = process.platform === 'win32';
  const cmd = win
    ? (process.env['ComSpec'] ?? 'cmd.exe')
    : process.platform === 'darwin'
      ? 'open'
      : 'xdg-open';
  const args = win ? ['/c', 'start', '', url] : [url];
  const child = spawn(cmd, args, { stdio: 'ignore', detached: true });
  child.unref();
}

// ---------------------------------------------------------------------------
// 1) 构建前端（缺省一次；失败即中止 —— 旧产物还在，可用 --skip-build 先跑）
// ---------------------------------------------------------------------------
process.stdout.write('🛠  构建前端…\n');
if (!skipBuild && !buildFrontend()) {
  process.stdout.write('\n前端构建失败，已中止（旧产物仍可用：node tools/run.mjs --skip-build）\n');
  process.exit(EXIT_FAIL);
}

// ---------------------------------------------------------------------------
// 2) 起服务：先装 "TS 直跑" 钩子，才能 import `server/cli.ts`
//    READY 行由 `cli.ts` 打印（机器可读）—— 端口可能是 `--port 0` 分配的，
//    所以**不能**自己按参数猜端口，只能等它说出来。
// ---------------------------------------------------------------------------
const originalWrite = process.stdout.write.bind(process.stdout);
/** `server/cli.ts` 的模块命名空间（catch 里要借它的 `UsageError` 区分用法错与起不来） */
let cli = null;

try {
  const { registerTsHooks } = await import('./dev/ts-loader.ts');
  registerTsHooks();
  cli = await import('../server/cli.ts');

  process.stdout.write = (chunk, ...rest) => {
    const ok = originalWrite(chunk, ...rest);
    const text = typeof chunk === 'string' ? chunk : String(chunk);
    if (!text.startsWith('READY ')) return ok;
    const m = /\{"port":(\d+)\}/.exec(text);
    if (m === null) return ok;
    // ★ 先把 READY 原样写出去，再打自己的那几行 —— 否则提示会跑到 READY 前面，
    //   而日志顺序正是脚本化调用方判读的依据。
    process.stdout.write = originalWrite;
    const url = `http://127.0.0.1:${m[1]}/`;
    if (wantOpen) {
      openBrowser(url);
      process.stdout.write(`\n🌐 已用默认浏览器打开 ${url}\n`);
    } else {
      process.stdout.write(`\n🌐 打开 ${url}\n`);
    }
    if (wantWatch) {
      closers.push(startWatch());
      // `cli.ts` 自己的 SIGINT/SIGTERM 负责优雅关服务；这里只负责把监听摘掉，
      // 否则它会把"已关闭"之后的进程继续吊在事件循环里（顺序无关，各关各的）
      process.once('SIGINT', onShutdown);
      process.once('SIGTERM', onShutdown);
    }
    return ok;
  };

  await cli.main(serverArgs);
} catch (e) {
  process.stdout.write = originalWrite;
  const usage = cli !== null && e instanceof cli.UsageError;
  process.stdout.write(`${usage ? '' : '启动失败：'}${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(EXIT_FAIL);
}

// 走到这里说明服务器已监听；事件循环由服务与（可能的）watcher 撑着
process.exitCode = EXIT_PASS;

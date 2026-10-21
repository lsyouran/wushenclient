#!/usr/bin/env node
/**
 * tools/build-web.mjs — 「怎么构建前端」的**唯一一处**
 * ============================================================================
 * 这段逻辑原先散着：`package.json` 的 `build:web` 写了一遍，`prestart` 调它，
 * `tools/run.mjs` 又要自己拼一遍 `tsc` 参数 —— 三处只要有一处漏了
 * （少 `-p tsconfig.web.json`、少了复制静态资源、少了增量开关），
 * 就会出现"这条命令建出来的产物是新的、那条是旧的"，而两边日志都写着"成功"。
 * ⇒ 收成模块：CLI 与 `run.mjs` 都调这里（`npm run build:web` 仍然是最短路径）。
 *
 * 两个必需步骤，顺序不能反：
 *   ① `tsc -p tsconfig.web.json` 编译 .ts → `dist/web/`
 *   ② `copy-web-assets.mjs` 搬 .html / .css / 字体，并清掉孤儿产物
 *
 * ★ `--incremental`：产物目录在 `dist/`（已被 `.gitignore` 忽略），
 *   构建信息落在 `dist/.tsbuildinfo-web`，不污染工作区。
 *   实测冷构建 ~10s、热构建 ~4s —— `--watch` 连续重建时差别很明显。
 *
 * 用法：`node tools/build-web.mjs`（= `npm run build:web`）
 */

import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { EXIT_FAIL, EXIT_PASS } from './gate/lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const TSC = join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc');

/** 子进程统一用**当前这个 node**：PATH 里可能还有另一个版本，语义会飘 */
function runNode(args, label) {
  const r = spawnSync(process.execPath, args, {
    cwd: ROOT,
    // ★ stdin 必须忽略：继承终端会把交互挂死（本项目踩过）
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  if (r.status !== 0) process.stdout.write(`  ❌ ${label} 失败（code=${String(r.status)}）\n`);
  return r.status === 0;
}

/**
 * 构建前端产物。
 * @returns {boolean} 成功与否（**不抛错**：调用方决定"失败能不能继续"）
 */
export function buildFrontend() {
  const t0 = Date.now();
  const ok =
    runNode(
      [TSC, '-p', 'tsconfig.web.json', '--incremental', '--tsBuildInfoFile', 'dist/.tsbuildinfo-web'],
      '前端编译（tsc）',
    ) && runNode([join(HERE, 'copy-web-assets.mjs')], '静态资源复制');
  if (ok) process.stdout.write(`  ✅ 前端产物已更新（${((Date.now() - t0) / 1000).toFixed(1)}s）\n`);
  return ok;
}

/** 直接执行时才构建；被 `run.mjs` import 时只导出函数（不产生副作用） */
if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = buildFrontend() ? EXIT_PASS : EXIT_FAIL;
}

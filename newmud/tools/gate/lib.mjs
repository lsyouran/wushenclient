/**
 * tools/gate/lib.mjs — 闸门公共库
 * ============================================================================
 * 约定：每个闸门是**独立可执行脚本**，退出码语义：
 *   0 = 通过   1 = 有违规   2 = 跳过（前置条件未满足，**不是**通过）
 *   3 = **崩溃**（闸门自身抛了未捕获异常 —— 与"有违规"**必须**分开，见 EXIT_CRASH）
 *
 * 项目根与项目名均为**运行时读取**（不写死），因此所有闸门都跟随改名。
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const GATE_DIR = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(GATE_DIR, '..', '..');
/** ★ 运行时读取目录名 —— 改名后自动跟随 */
export const PROJECT_NAME = basename(ROOT);

export const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  'data',
  'logs',
  'coverage',
  '.git',
  '.tmp-build',
]);

export const SCAN_EXT = new Set(['.ts', '.mts', '.cts', '.js', '.mjs', '.cjs']);

export const EXIT_PASS = 0;
export const EXIT_FAIL = 1;
export const EXIT_SKIP = 2;

/**
 * ★ **崩溃**的专用退出码（FG-23，见 26 册 §27）。
 *
 * 为什么非要有这个码：node 在未捕获异常时的退出码是 **1** —— 与 `EXIT_FAIL`
 * **完全同码**。于是"闸门自己死了"和"闸门说'你错了'"在调用方眼里是**同一件事**。
 * 这既不是假绿也不是假红，而是**判据的取值域太窄**：FG-11 要求"判据要落在区分性
 * 字段上"，这里则是**判据字段本身没有区分性**，而所有人都以为它有。
 *
 * 受伤最重的是元闸门 `mutation-test.mjs`：它只读 `spawnSync().status`，判据为
 * `before !== 1 && after === 1 && restored === before` ⇒
 * **一个"碰到违规就崩"的闸门会被记成「这条规则可证明会红」**。
 * 2026-10-13 现场（26 册 §26.8）：G2 忘了 import `rel` → 抛 `ReferenceError` →
 * 退出码 1 → 元闸门判据**全绿**（`restored` 也是 0，因为它还原后不崩）。
 *
 * 用法：每个 `tools/gate/*.mjs` 在 import 之后**立刻**调用一次
 * `installCrashGuard('<id>')`。必须是**显式**调用、不能在 lib.mjs 里自动装 ——
 * `tools/start.mjs`（游戏服务端启动器）与 `tools/copy-web-assets.mjs` 也 import
 * 本文件，自动装会把它们的崩溃退出码一起改掉。"有没有忘装"由 G6 **R6.11** 机械兜住。
 */
export const EXIT_CRASH = 3;

/**
 * 退出码 → 短名。**全项目唯一一份映射**（run-all 的汇总表与元闸门的判定列都用它；
 * 各写一份就是 24 册铁律 4 说的"第二份真相"）。
 * `-1` 是调用方的**内部**约定：子进程根本没启动起来（`spawnSync().error`）。
 */
export function exitName(code) {
  if (code === EXIT_PASS) return 'PASS';
  if (code === EXIT_FAIL) return 'FAIL';
  if (code === EXIT_SKIP) return 'SKIP';
  if (code === EXIT_CRASH) return 'CRASH';
  if (code === -1) return 'ERR';
  return `?${code}`;
}

/** 退出码 → 带图标的可读标签（汇总表用） */
export function exitLabel(code) {
  // `-1`（spawn 启动失败）的历史文案是 `⚠️ ERROR`，FG-3 的记录里就是这么印的
  // —— 不为了"整齐"去改它，否则文档与现实就对不上了（铁律 7）。
  if (code === -1) return '⚠️ ERROR';
  const icon =
    code === EXIT_PASS ? '✅' : code === EXIT_FAIL ? '❌' : code === EXIT_SKIP ? '⏭️' : code === EXIT_CRASH ? '💥' : '⚠️';
  return `${icon} ${exitName(code)}`;
}

let crashGuardInstalled = false;

/**
 * 装崩溃守卫：未捕获异常 / 未处理的 Promise 拒绝 → 以 `EXIT_CRASH` 退出，
 * 并在 stderr 上**明确写出"这不是发现违规"**（否则日志里两者长得一样，
 * 人也会跟着误判 —— 这正是 FG-23 的成因）。
 *
 * ★ **局限（如实记档，别当成全覆盖）**：只接得住守卫安装**之后**发生的异常。
 *   安装之前抛出的（本模块自身的求值期、或更早的 import）仍是 node 默认的 1。
 *   要做到"连模块加载期都算"，得由调用方用 `--import` 预载 —— 属独立的加固批次。
 *
 * @param {string} toolName 打印用标识；缺省取 `process.argv[1]` 的文件名
 */
export function installCrashGuard(toolName = basename(process.argv[1] ?? '<unknown>')) {
  if (crashGuardInstalled) return;
  crashGuardInstalled = true;
  const onFatal = (kind) => (err) => {
    const detail = err instanceof Error ? (err.stack ?? err.message) : String(err);
    process.stderr.write(
      `\n💥 ${toolName} 内部崩溃（${kind}）—— **这不是「发现违规」**，` +
        `退出码 ${EXIT_CRASH}（${exitName(EXIT_CRASH)}）：\n${detail}\n`,
    );
    process.exit(EXIT_CRASH);
  };
  process.on('uncaughtException', onFatal('未捕获异常'));
  process.on('unhandledRejection', onFatal('未处理的 Promise 拒绝'));
}

export function rel(abs) {
  return relative(ROOT, abs).split(sep).join('/');
}

export function abs(relPath) {
  return join(ROOT, relPath);
}

export function exists(p) {
  try {
    statSync(p);
    return true;
  } catch {
    return false;
  }
}

export function isDir(p) {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/**
 * 递归收集文件（可按扩展名过滤）。
 *
 * ★ 默认**跳过零字节文件**（`includeEmpty: true` 可关闭）。
 *
 *   这不是权宜之计，而是语义等价：空文件里**没有**任何声明 ——
 *   没有 import、没有 `defineX(...)`、没有 eval、没有路径字面量。
 *   对任何「扫描 + 对账」型闸门，"空文件"与"文件不存在"的判定必然相同。
 *
 *   它同时是本项目变异测试的**还原机制**：
 *   受限环境禁止批量删除（宿主策略 `SAFE_DELETE_BULK_CONFIRM_REQUIRED`，
 *   阈值 50/轮；`renameSync` 同样被计入），所以 `putFile` 的还原是
 *   「把内容写成空」而不是「把文件删掉」。
 *   如果 walk 不跳过空文件，夹具残留就会污染下一次「变异前」基线 → 假绿。
 *
 *   ⚠️ 由此产生一个**盲区**：内容层真被清空（事故）时别的闸门也看不见。
 *      该盲区由 G6 R6.8 显式接管（空源码文件 = 红线，`__mut*` 夹具除外）。
 */
export function walk(dir, { exts = SCAN_EXT, includeEmpty = false } = {}) {
  const out = [];
  const stack = [dir];
  while (stack.length > 0) {
    const cur = stack.pop();
    let entries;
    try {
      entries = readdirSync(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = join(cur, e.name);
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) stack.push(full);
        continue;
      }
      if (!e.isFile()) continue;
      const dot = e.name.lastIndexOf('.');
      if (dot === -1 || !exts.has(e.name.slice(dot))) continue;
      if (!includeEmpty && sizeOf(full) === 0) continue;
      out.push(full);
    }
  }
  return out.sort();
}

/** 文件字节数；读不到时返回 -1（调用方按"非空"处理，宁可误报不可漏报） */
export function sizeOf(p) {
  try {
    return statSync(p).size;
  } catch {
    return -1;
  }
}

export function readText(p) {
  return readFileSync(p, 'utf8');
}

/**
 * 去掉注释（保留字符串内容）。
 * 必须保留字符串：路径字面量、import 说明符都在字符串里。
 * 必须去掉注释：注释里会合法地出现 `process.cwd()`、`new Function(` 等词，
 * 否则闸门持续误报 → 最终被开发者关掉，比没有闸门更糟。
 */
export function stripComments(line, state) {
  let out = '';
  let quote = null;
  let i = 0;
  while (i < line.length) {
    const c = line[i];
    const n = line[i + 1];
    if (state.block) {
      if (c === '*' && n === '/') {
        state.block = false;
        i += 2;
        continue;
      }
      i++;
      continue;
    }
    if (quote !== null) {
      out += c;
      if (c === '\\') {
        if (n !== undefined) out += n;
        i += 2;
        continue;
      }
      if (c === quote) quote = null;
      i++;
      continue;
    }
    if (c === '/' && n === '*') {
      state.block = true;
      i += 2;
      continue;
    }
    if (c === '/' && n === '/') break;
    if (c === '"' || c === "'" || c === '`') {
      quote = c;
      out += c;
      i++;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/** 返回 `{ raw, code }` 两个平行数组（行号 = 下标 + 1） */
export function readCode(p) {
  const raw = readText(p).split(/\r?\n/);
  const state = { block: false };
  const code = raw.map((l) => stripComments(l, state));
  return { raw, code };
}

export function header(id, name, extra = {}) {
  console.log(`${id} · ${name}`);
  for (const [k, v] of Object.entries(extra)) console.log(`  ${k}: ${v}`);
}

export function report(violations, { passText = '通过', failText = '发现违规' } = {}) {
  if (violations.length === 0) {
    console.log(`  ✅ ${passText}`);
    return EXIT_PASS;
  }
  console.log(`  ❌ ${failText}（${violations.length} 处）：\n`);
  for (const v of violations) {
    console.log(`  [${v.rule}] ${v.where}`);
    console.log(`       ${v.message}`);
  }
  return EXIT_FAIL;
}

export function skip(reason) {
  console.log(`  ⏭️  SKIP：${reason}`);
  return EXIT_SKIP;
}

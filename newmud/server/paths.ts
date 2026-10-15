/**
 * server/paths.ts — 项目路径解析（**可重命名安全**）
 * ============================================================================
 * 三条硬规则（详见 `docs/24-命名与标识符规范.md` §2.7）：
 *   R1 代码内禁止出现绝对路径字面量
 *   R2 代码内禁止硬编码项目目录名（目录名可能随时改）
 *   R3 禁止用 process.cwd() 拼资源路径（启动目录 ≠ 项目目录）
 *
 * 求根方式：从**本文件自身位置**向上查找特征文件（package.json + tsconfig.json）。
 *   - 不依赖「目录叫什么名字」→ 整个工程可以随意改名 / 移动
 *   - 不依赖「从哪个目录启动」→ 不受 process.cwd() 影响
 *   - 不假设固定层级 → 源码布局 (`server/paths.ts`) 与产物布局
 *     (`dist/server/paths.js`) 都能正确定位
 *
 * 归属：`server/`（Node 专属）。`shared/` 保持零 Node 依赖，浏览器端可直接复用。
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { KINDS } from '@shared/ids.js';
import type { Kind } from '@shared/ids.js';

/** 项目根的特征文件（存在即认定该目录为项目根） */
const ROOT_MARKERS = ['package.json', 'tsconfig.json'] as const;

/** 向上查找的最大层数，防止在异常环境下无限上溯 */
const MAX_UP = 6;

const THIS_FILE = fileURLToPath(import.meta.url);
const THIS_DIR = dirname(THIS_FILE);

function isRoot(dir: string): boolean {
  return ROOT_MARKERS.every((m) => existsSync(join(dir, m)));
}

/**
 * 从 `startDir` 向上逐级查找项目根。
 * 判据是**特征文件存在性**，而不是目录名 —— 这正是 rename-safe 的关键。
 */
export function findProjectRoot(startDir: string = THIS_DIR): string {
  let dir = resolve(startDir);
  for (let i = 0; i < MAX_UP; i += 1) {
    if (isRoot(dir)) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(
    `项目根定位失败：从 ${startDir} 向上 ${MAX_UP} 层未找到 ${ROOT_MARKERS.join(' + ')}。`,
  );
}

/** 项目根。与目录名、CWD、层级深度均无关。 */
export const PROJECT_ROOT: string = findProjectRoot();

/** 标准一级目录（全部由 PROJECT_ROOT 派生，不允许写死） */
export const SHARED_DIR: string = join(PROJECT_ROOT, 'shared');
export const SERVER_DIR: string = join(PROJECT_ROOT, 'server');
export const SRC_DIR: string = join(PROJECT_ROOT, 'src');
export const WORLD_DIR: string = join(PROJECT_ROOT, 'world');
export const TOOLS_DIR: string = join(PROJECT_ROOT, 'tools');
export const DATA_DIR: string = join(PROJECT_ROOT, 'data');
export const LOG_DIR: string = join(PROJECT_ROOT, 'logs');

/**
 * 世界内容按 kind 分目录：`world/<kind>/`（与 shared/ids.ts 的约定一致）。
 *
 * ★ docs/26 M8：这里曾是**全项目唯一**把 `Kind` 退化成 `string` 的地方，
 *   于是 `worldKindDir('../../etc')` 会越出 `world/`。
 *   现在参数收紧为 `Kind`，并再加一道运行时兜底 —— 类型管主流，
 *   运行时管 `'x' as Kind` 这类强转（与 props.ts 的 EXT 键同一个套路）。
 */
export function worldKindDir(kind: Kind): string {
  if (!(KINDS as readonly string[]).includes(kind)) {
    throw new Error(`worldKindDir: 非法 kind ${JSON.stringify(kind)}（允许：${KINDS.join('/')}）`);
  }
  return join(WORLD_DIR, kind);
}

/** 备份目录（存档前备份，见 23 册 §7） */
export function backupDir(): string {
  return join(DATA_DIR, 'backup');
}

/**
 * 启动自检：确认定位到的根**确实**是可用的项目根。
 *
 * ★ docs/26 M4：旧实现是 `if (!isRoot(PROJECT_ROOT)) throw ...` —— **同义反复**。
 *   因为 `PROJECT_ROOT` 正是 `findProjectRoot()` 的返回值，而后者只在
 *   `isRoot(dir)` 为真时返回。那个函数**不可能抛错**，却让
 *   `bootstrapWorld()` 看起来"启动第一件事就校验了根目录"。
 *
 * 现在检查三件**有信息量**的事：
 *   ① `root` 真的是个目录；
 *   ② 结构性依赖目录（`shared/` `server/`）全部存在 —— 缺一即无法启动；
 *   ③ `package.json` 可读、是合法 JSON、且有非空 `name`（用它证明"找对了项目"）。
 *
 * "有没有信息量"是可判定的：换一个不成立的目录进来，它必须抛错。
 * 该性质由 `tests/paths.test.ts` 钉住。
 *
 * @param root 仅用于测试/诊断；生产调用不传参，用 `PROJECT_ROOT`
 */
export function assertProjectRoot(root: string = PROJECT_ROOT): ProjectRootReport {
  if (!isDir(root)) {
    throw new Error(`项目根自检失败：${root} 不是一个目录。`);
  }
  const report = inspectProjectRoot(root);
  if (report.missingRequired.length > 0) {
    throw new Error(
      `项目根自检失败：${root} 下缺少结构性目录 ` +
        `${report.missingRequired.join(' / ')}。`,
    );
  }
  // 读不到 / 不是合法 JSON / 没有 name → 抛错（这三点任一都说明"这不是我们的项目根"）
  const name = readPackageName(root);
  return { ...report, name };
}

/** 结构性依赖目录：缺一即无法启动（协议与引擎代码就在这两个目录里） */
export const REQUIRED_PROJECT_DIRS = ['shared', 'server'] as const;

/**
 * 仅登记存在性的目录：按阶段逐步建立，缺失**不算错误**，但要让人看见
 * （例：`src/` 属阶段 0-1 的前端骨架，现在还不存在）。
 */
export const INVENTORY_PROJECT_DIRS = [
  'world',
  'src',
  'tools',
  'tests',
  'data',
  'logs',
] as const;

export interface ProjectRootReport {
  readonly root: string;
  /** `package.json` 的 `name`；读不出来时为空串（`assertProjectRoot` 会因此抛错） */
  readonly name: string;
  readonly required: readonly string[];
  /** `required ∪ inventory` 中**存在**的目录 */
  readonly present: readonly string[];
  /** `required ∪ inventory` 中**缺失**的目录 */
  readonly missing: readonly string[];
  /** `missing ∩ required`：真正会导致启动失败的子集 */
  readonly missingRequired: readonly string[];
}

function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function readPackageName(root: string): string {
  const p = join(root, 'package.json');
  let raw: string;
  try {
    raw = readFileSync(p, 'utf8');
  } catch {
    throw new Error(`项目根自检失败：读不到 ${p}（该目录不是项目根？）。`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(
      `项目根自检失败：${p} 不是合法 JSON（${e instanceof Error ? e.message : String(e)}）。`,
    );
  }
  const name = (parsed as { name?: unknown } | null)?.name;
  if (typeof name !== 'string' || name.trim() === '') {
    throw new Error(`项目根自检失败：${p} 缺少非空 name 字段。`);
  }
  return name;
}

/**
 * 只**观测**、不抛错：返回目录清单与 `package.json` name（读不出来则空串）。
 * 供启动日志、诊断、以及 `assertProjectRoot` 复用。
 */
export function inspectProjectRoot(root: string = PROJECT_ROOT): ProjectRootReport {
  const present: string[] = [];
  const missing: string[] = [];
  for (const d of [...REQUIRED_PROJECT_DIRS, ...INVENTORY_PROJECT_DIRS]) {
    if (isDir(join(root, d))) present.push(d);
    else missing.push(d);
  }
  let name = '';
  try {
    name = readPackageName(root);
  } catch {
    name = '';
  }
  return {
    root,
    name,
    required: REQUIRED_PROJECT_DIRS,
    present,
    missing,
    missingRequired: REQUIRED_PROJECT_DIRS.filter((d) => missing.includes(d)),
  };
}

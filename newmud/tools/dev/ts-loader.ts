/**
 * tools/dev/ts-loader.ts — 让**裸 node** 直接跑本工程的 TypeScript
 * ============================================================================
 * 这是 `npm start` 的地基。本工程源码用 TS 写，且用了三样 node 默认不认的东西：
 *
 *   ① 路径别名 `@shared/` `@engine/` `@world/`（声明在 tsconfig 的 `paths`）
 *   ② `.js` 说明符指向 `.ts` 源 —— TS 的 ESM 约定。
 *      只有**浏览器产物**里才真有 .js（`tsc` 逐文件搬过去，说明符原样保留），
 *      所以源码这边必须由加载器把 `.js` 重新指回 `.ts`。
 *   ③ 参数属性 `constructor(public readonly x: T)`（`server/net/ws-server.ts` 在用）
 *      —— 这是"类型剥离（strip）"模式**不允许**的语法（会抛
 *      `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`），必须走 transform 模式。
 *
 * ★ 零依赖：只用 node 内建。这是本工程"运行时依赖只有 ws + zod"得以成立的前提
 *   （引入 tsx 之类的第三方 loader 会当场破坏它；三条路的取舍见 26 册 T23）。
 *
 * ★ 本文件刻意**只 import `node:*`**：启动器必须在**钩子生效之前**加载它，
 *   而那时"相对导入的 `.js` → `.ts`"还没人管。只依赖内建 ⇒ node 能原生加载本文件
 *   （实测可行），于是 `tools/start.mjs` 只剩几行、且没有第二份解析逻辑。
 *
 * ★ 无顶层副作用：所有副作用收在 `registerTsHooks()` 里，其余都是纯函数，
 *   因此可以被逐条钉住（`tests/ts-loader.test.ts`）。
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { registerHooks, stripTypeScriptTypes } from 'node:module';
import type { LoadHookSync, ResolveHookSync } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** 项目根的特征文件（与 `server/paths.ts` 同一判据 —— 两边结论必须一致） */
const ROOT_MARKERS = ['package.json', 'tsconfig.json'] as const;

/** 上溯上限：防止在异常环境下无限向上找 */
const MAX_UP = 6;

const NODE_MODULES = 'node_modules';

/**
 * 从 `startDir` 向上找项目根。
 *
 * 判据是**特征文件存在性**，不是目录名 —— 与 `server/paths.ts` 同一条纪律
 * （R2：目录名随时可能改，代码里不许写死）。这里是一次**独立实现**：
 * 加载器不能 import `server/paths.ts`（那时 TS 还加载不了），所以两份实现并存 ——
 * 代价由 `tests/ts-loader.test.ts` 收掉：两者结论必须一致。
 */
export function findProjectRoot(startDir: string): string {
  let dir = resolve(startDir);
  for (let i = 0; i < MAX_UP; i += 1) {
    if (ROOT_MARKERS.every((m) => existsSync(join(dir, m)))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(
    `找不到项目根：从 ${startDir} 向上 ${MAX_UP} 层都没有 ${ROOT_MARKERS.join(' + ')}。`,
  );
}

/**
 * 读 tsconfig 的 `compilerOptions.paths`，转成 `[前缀, 目标目录]` 表。
 *
 * ★ 刻意**读文件**而不是在加载器里再存一份镜像：别名表已经有四处声明
 *   （tsconfig / G13 / G14 / vitest.config），再多一份就是第五处。
 *   `tests/alias-single-source.test.ts` 负责让那四处保持一致（FG-20）。
 *
 * ⚠️ 要求 tsconfig.json 是**纯 JSON**（不能带注释）——因为 `JSON.parse` 读它。
 *   目前它确实是纯 JSON；真要加注释，就得把 `paths` 挪到单独的文件里。
 */
export function readPathAliases(rootDir: string): ReadonlyArray<readonly [string, string]> {
  const file = join(rootDir, 'tsconfig.json');
  const raw = readFileSync(file, 'utf8'); // 读不到就抛（调用方按"根不对"处理）
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(
      `${file} 不是纯 JSON（${e instanceof Error ? e.message : String(e)}）。` +
        '启动器要读它解析路径别名，请把注释去掉、或把 paths 挪到单独的文件。',
    );
  }
  const paths =
    (parsed as { compilerOptions?: { paths?: Record<string, readonly string[]> } } | null)
      ?.compilerOptions?.paths ?? {};
  return Object.entries(paths).map(
    ([key, values]): readonly [string, string] => [
      key.replace(/\*$/, ''),
      (values[0] ?? '').replace(/\*$/, ''),
    ],
  );
}

export interface TsLoaderConfig {
  readonly rootDir: string;
  readonly aliases: ReadonlyArray<readonly [string, string]>;
}

export function buildLoaderConfig(rootDir: string): TsLoaderConfig {
  return { rootDir, aliases: readPathAliases(rootDir) };
}

/**
 * `.js` 说明符 → 候选文件（**顺序即优先级**）。
 *
 * ★ 候选里**绝不出现 `.d.ts`**。这是踩过一次的坑：zod 的
 *   `node_modules/zod/v3/external.js` 旁边就躺着 `external.d.ts`，
 *   若把 `.d.ts` 当候选，加载器会把**类型声明**当成运行时代码去跑，
 *   整条启动链当场炸在这上面。类型声明在运行期**没有任何东西可加载**。
 */
export function candidateFiles(absBase: string): string[] {
  if (absBase.endsWith('.js')) {
    const stem = absBase.slice(0, -'.js'.length);
    return [`${stem}.ts`, absBase];
  }
  return [
    `${absBase}.ts`,
    `${absBase}.js`,
    join(absBase, 'index.ts'),
    join(absBase, 'index.js'),
  ];
}

/**
 * 是不是"依赖里的文件"。
 *
 * 依赖内部的相对导入**一律不改写**，原样交给默认解析 —— 理由与 node 自己一致：
 * node 也明确**拒绝对 node_modules 下的文件做类型剥离**
 * （`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`）。我们照同一条规则走，
 * 否则就会出现"我们比 node 更激进地改写依赖"这种没人预期的行为。
 */
function isDependencyFile(absPath: string): boolean {
  return absPath.split(/[\\/]/).includes(NODE_MODULES);
}

function isFile(p: string): boolean {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

/** 说明符 → 绝对路径基名；**不该由我们插手**的一律返回 null */
function specifierToBasePath(
  specifier: string,
  parentFile: string,
  config: TsLoaderConfig,
): string | null {
  let base: string | null = null;
  if (specifier.startsWith('./') || specifier.startsWith('../')) {
    base = resolve(dirname(parentFile), specifier);
  } else {
    for (const [prefix, target] of config.aliases) {
      if (specifier.startsWith(prefix)) {
        base = join(config.rootDir, target + specifier.slice(prefix.length));
        break;
      }
    }
  }
  if (base === null) return null; // 裸包名（zod）/ `node:` 内建 / 完整 URL
  if (isDependencyFile(base)) return null; // 依赖内部：交给默认解析
  return base;
}

/**
 * `resolve` 钩子：把别名与 `.js` 指回源码 `.ts`。
 *
 * ★ 找不到对应文件时**交还给默认解析**，而不是自己报错 ——
 *   这样 node 的原始报错（含"从哪个文件导入的"）能原样保留，
 *   排错时不会拿到一条我们编的、信息更少的错误。
 */
export function makeResolveHook(config: TsLoaderConfig): ResolveHookSync {
  return (specifier, context, nextResolve) => {
    const parentURL = context.parentURL;
    if (parentURL === undefined) return nextResolve(specifier, context);
    let parentFile: string;
    try {
      parentFile = fileURLToPath(parentURL);
    } catch {
      return nextResolve(specifier, context); // 不是 file:（例如 data:）—— 不插手
    }
    const base = specifierToBasePath(specifier, parentFile, config);
    if (base === null) return nextResolve(specifier, context);
    const found = candidateFiles(base).find(isFile);
    if (found === undefined) return nextResolve(specifier, context);
    return { url: pathToFileURL(found).href, shortCircuit: true };
  };
}

/**
 * `load` 钩子：`.ts` 走 **transform** 模式剥离类型。
 *
 * ★ 必须是 transform 而不是 strip：`server/net/ws-server.ts` 用了参数属性，
 *   strip-only 模式对它直接抛 `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`。
 *   transform 会把参数属性展开成 `this.x = x`（实测输出已由测试钉住）。
 *
 * ⚠️ 这条链依赖 node 的 `stripTypeScriptTypes`（实验特性），启动时会打印一条
 *   `ExperimentalWarning`。**不去屏蔽它**：那是一条真实的信息 ——
 *   "TS 直跑"靠的是 node 的实验能力，而不是我们自己的编译器。
 */
export function makeLoadHook(): LoadHookSync {
  return (url, context, nextLoad) => {
    if (!url.startsWith('file:')) return nextLoad(url, context);
    if (!url.endsWith('.ts') && !url.endsWith('.mts')) return nextLoad(url, context);
    let file: string;
    try {
      file = fileURLToPath(url);
    } catch {
      return nextLoad(url, context);
    }
    if (isDependencyFile(file)) return nextLoad(url, context);
    const source = readFileSync(file, 'utf8');
    return {
      format: 'module',
      source: stripTypeScriptTypes(source, { mode: 'transform', sourceUrl: url }),
      shortCircuit: true,
    };
  };
}

/**
 * 注册钩子。**唯一有副作用的地方** —— 由 `tools/start.mjs` 调用。
 *
 * 之所以能"先加载本文件再注册"：本文件只用 node 内建，node 能原生加载它；
 * 钩子一注册，后续所有 `.ts` 就都能加载了。
 *
 * @param startDir 只用于测试/嵌入；生产不传，从本文件位置推出项目根
 */
export function registerTsHooks(startDir?: string): TsLoaderConfig {
  const from = startDir ?? dirname(fileURLToPath(import.meta.url));
  const config = buildLoaderConfig(findProjectRoot(from));
  registerHooks({
    resolve: makeResolveHook(config),
    load: makeLoadHook(),
  });
  return config;
}

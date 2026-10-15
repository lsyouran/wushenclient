/**
 * tests/ts-loader.test.ts —— 零依赖 TS 加载器（`npm start` 的地基）
 * ============================================================================
 * 加载器要解决两件 **node 自己不管**的事：
 *   ① 路径别名 `@shared/` / `@engine/` / `@world/`
 *   ② `.js` 说明符指向 `.ts` 源（TS 的 ESM 约定；只有浏览器产物里才真有 .js）
 * 外加一件 node 的**类型剥离**管不了的事：参数属性（`constructor(public x)`）
 *   ⇒ 必须用 `stripTypeScriptTypes(mode:'transform')`，见 `makeLoadHook` 的断言。
 *
 * ★ 这里每条断言都尽量带**对照组**。理由（24 册 §5.3 FG-11）：
 *   "断言为真"和"断言有区分力"是两件事。最容易糊弄的一条是
 *   "node_modules 内的相对导入不改写" —— 光断言返回 null 毫无意义，
 *   必须同时证明**不改写就会踩到 `.d.ts`**（zod 的 `v3/external.js` 旁边
 *   就躺着 `external.d.ts`，实测踩过一次，整条启动链当场炸）。
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { registerHooks, stripTypeScriptTypes } from 'node:module';
import type {
  LoadFnOutput,
  LoadHookContext,
  ResolveFnOutput,
  ResolveHookContext,
} from 'node:module';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { PROJECT_ROOT } from '../server/paths.js';
import {
  buildLoaderConfig,
  candidateFiles,
  findProjectRoot,
  makeLoadHook,
  makeResolveHook,
  readPathAliases,
} from '../tools/dev/ts-loader.js';

/** 真实的 `ResolveHookContext` / `LoadHookContext`（钩子拿到的就是这个形状） */
const resolveCtx = (parentFile: string): ResolveHookContext => ({
  conditions: ['node', 'import'],
  importAttributes: {},
  parentURL: pathToFileURL(parentFile).href,
});

const loadCtx = (): LoadHookContext => ({
  conditions: ['node', 'import'],
  format: undefined,
  importAttributes: {},
});

type NextResolve = (
  specifier: string,
  context?: Partial<ResolveHookContext>,
) => ResolveFnOutput;

type NextLoad = (url: string, context?: Partial<LoadHookContext>) => LoadFnOutput;

/** 假的 `next`：只记录"有没有落到默认解析"，避免真的去解析不存在的模块 */
function makeNextResolve(): { fn: NextResolve; calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    fn: (specifier) => {
      calls.push(specifier);
      return { url: `default:${specifier}` };
    },
  };
}

function makeNextLoad(): { fn: NextLoad; calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    fn: (url) => {
      calls.push(url);
      return { format: null };
    },
  };
}

const cfg = buildLoaderConfig(PROJECT_ROOT);

function resolveWith(
  specifier: string,
  parentFile: string,
): { url: string; calls: string[] } {
  const next = makeNextResolve();
  const out = makeResolveHook(cfg)(specifier, resolveCtx(parentFile), next.fn);
  return { url: out.url, calls: next.calls };
}

const fileAt = (...parts: string[]): string => join(PROJECT_ROOT, ...parts);

// ---------------------------------------------------------------------------
// 项目根定位 —— 与 server/paths.ts 是**两份独立实现**，必须给出同一个答案
// ---------------------------------------------------------------------------

describe('findProjectRoot', () => {
  it('从子目录上溯也能定位到项目根', () => {
    expect(findProjectRoot(fileAt('server', 'engine'))).toBe(PROJECT_ROOT);
  });

  it('与 server/paths.ts 的独立实现结论一致（两份实现不许分家）', () => {
    expect(findProjectRoot(PROJECT_ROOT)).toBe(PROJECT_ROOT);
    expect(findProjectRoot(fileAt('shared'))).toBe(PROJECT_ROOT);
  });

  it('超出上溯上限会抛错，而不是无限上溯', () => {
    const tooDeep = fileAt('a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i');
    expect(() => findProjectRoot(tooDeep)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// 别名表：**读 tsconfig.json**，而不是在加载器里再存一份
// ---------------------------------------------------------------------------

describe('readPathAliases', () => {
  it('解析出三条别名（不是 0 条也不是 5 条）', () => {
    const aliases = readPathAliases(PROJECT_ROOT);
    expect(aliases.length).toBe(3);
    expect(aliases.map(([p]) => p)).toEqual(['@shared/', '@engine/', '@world/']);
  });

  it('每个别名的目标目录都真实存在', () => {
    for (const [prefix, target] of readPathAliases(PROJECT_ROOT)) {
      expect(existsSync(join(PROJECT_ROOT, target)), `${prefix} → ${target}`).toBe(true);
    }
  });

  it('★ 真的在读盘：根目录不存在时必须抛错（硬编码实现不会抛）', () => {
    expect(() => readPathAliases(fileAt('definitely-not-here'))).toThrow();
  });
});

// ---------------------------------------------------------------------------
// .js → .ts 候选顺序
// ---------------------------------------------------------------------------

describe('candidateFiles', () => {
  it('.js 说明符优先找同名 .ts，其次才是真 .js', () => {
    expect(candidateFiles(fileAt('shared', 'ids.js'))).toEqual([
      fileAt('shared', 'ids.ts'),
      fileAt('shared', 'ids.js'),
    ]);
  });

  it('★ 候选里**永远不出现 `.d.ts`**（那是类型声明，运行期加载它必炸）', () => {
    for (const base of [fileAt('shared', 'ids.js'), fileAt('shared', 'ids'), fileAt('x.mjs')]) {
      for (const c of candidateFiles(base)) expect(c.endsWith('.d.ts')).toBe(false);
    }
  });

  it('省略扩展名时补 .ts / .js，并兜目录默认文件', () => {
    expect(candidateFiles(fileAt('shared', 'ids'))).toEqual([
      fileAt('shared', 'ids.ts'),
      fileAt('shared', 'ids.js'),
      fileAt('shared', 'ids', 'index.ts'),
      fileAt('shared', 'ids', 'index.js'),
    ]);
  });
});

// ---------------------------------------------------------------------------
// resolve 钩子
// ---------------------------------------------------------------------------

describe('makeResolveHook', () => {
  it('别名 → 项目内真实 .ts 文件', () => {
    const r = resolveWith('@shared/ids.js', fileAt('server', 'engine', 'registry.ts'));
    expect(r.calls).toEqual([]);
    expect(r.url).toBe(pathToFileURL(fileAt('shared', 'ids.ts')).href);
    expect(existsSync(fileURLToPath(r.url))).toBe(true);
  });

  it('相对 .js 说明符 → 同级 .ts', () => {
    const r = resolveWith('./bootstrap.js', fileAt('server', 'main.ts'));
    expect(r.calls).toEqual([]);
    expect(r.url).toBe(pathToFileURL(fileAt('server', 'bootstrap.ts')).href);
  });

  it('裸包名 / node: 内建模块一律交给默认解析（不插手）', () => {
    expect(resolveWith('zod', fileAt('shared', 'protocol.ts')).calls).toEqual(['zod']);
    expect(resolveWith('node:fs', fileAt('server', 'main.ts')).calls).toEqual(['node:fs']);
  });

  it('找不到对应文件时也交给默认解析（让 node 报它自己的错，不要去猜）', () => {
    expect(resolveWith('./nope.js', fileAt('server', 'main.ts')).calls).toEqual(['./nope.js']);
  });

  it('★ node_modules 内的相对导入**不许改写**（否则会加载到同名的 .d.ts）', () => {
    const zodIndex = fileAt('node_modules', 'zod', 'index.js');
    const trap = fileAt('node_modules', 'zod', 'v3', 'external.d.ts');
    // 对照组：陷阱真的存在 —— 不设护栏时 candidateFiles 必然命中它
    expect(existsSync(trap)).toBe(true);
    expect(candidateFiles(fileAt('node_modules', 'zod', 'v3', 'external.js'))).toContain(
      fileAt('node_modules', 'zod', 'v3', 'external.ts'),
    );
    const r = resolveWith('./v3/external.js', zodIndex);
    expect(r.calls).toEqual(['./v3/external.js']);
    expect(r.url).not.toContain('external.d.ts');
  });
});

// ---------------------------------------------------------------------------
// load 钩子：类型剥离必须用 **transform** 模式
// ---------------------------------------------------------------------------

describe('makeLoadHook', () => {
  const load = makeLoadHook();

  it('★ .ts 会被转换，且参数属性被展开（strip-only 模式在这里直接抛错）', () => {
    const url = pathToFileURL(fileAt('server', 'net', 'ws-server.ts')).href;
    const next = makeNextLoad();
    const out = load(url, loadCtx(), next.fn);
    expect(next.calls).toEqual([]);
    expect(out.format).toBe('module');
    expect(out.source).toContain('this.id = id');
    // 转换后不该再留下 TS 专属语法
    expect(out.source).not.toContain('public readonly id: string');
  });

  it('非 .ts 交给默认加载器', () => {
    const next = makeNextLoad();
    const jsUrl = pathToFileURL(fileAt('tools', 'gate', 'lib.mjs')).href;
    load(jsUrl, loadCtx(), next.fn);
    expect(next.calls).toEqual([jsUrl]);
  });

  it('node_modules 内的 .ts 不代劳（node 自己也不允许对依赖做类型剥离）', () => {
    const next = makeNextLoad();
    const dep = pathToFileURL(fileAt('node_modules', 'zod', 'v3', 'external.d.ts')).href;
    load(dep, loadCtx(), next.fn);
    expect(next.calls).toEqual([dep]);
  });

  it('URL 不是 file: 协议时不碰（例如 node: 内建）', () => {
    const next = makeNextLoad();
    load('node:fs', loadCtx(), next.fn);
    expect(next.calls).toEqual(['node:fs']);
  });
});

// ---------------------------------------------------------------------------
// 运行时门槛：`engines` 是**断言**，不是装饰（24 册 铁律 7）
// ---------------------------------------------------------------------------
//
// 加载器调的两个 API 都有引入版本，而 `engines.node` 一旦写得比真实门槛低，
// 就是一句**不实声明**——低版本 node 会装得下、跑不起来，且失败点在 import 阶段，
// 报错信息完全看不出"版本不够"。
//
//   来源：node 官方 API 文档（本批次已核对）
//     `module.registerHooks`      —— Added in v22.15.0   ← 加载器的**硬门槛**
//     `module.stripTypeScriptTypes` —— Added in v22.13.0
//

/** 把 `a.b.c` 化成可比较的数字（缺位补 0），只支持数字形版本 */
const versionParts = (v: string): number[] =>
  v.split('.').map((p) => (p === '' ? 0 : Number.parseInt(p, 10)));

/** `a >= b`？逐段比较，多出来的段按 0 处理 */
const atLeast = (a: string, b: string): boolean => {
  const [x, y] = [versionParts(a), versionParts(b)];
  const len = Math.max(x.length, y.length);
  for (let i = 0; i < len; i += 1) {
    const [p, q] = [x[i] ?? 0, y[i] ?? 0];
    if (p !== q) return p > q;
  }
  return true;
};

/** 加载器两个 API 的引入版本（改这里必须同时改上面的注释出处） */
const API_FLOOR = '22.15.0';

describe('运行时门槛（engines 与真 API 对齐）', () => {
  it('加载器依赖的 node API 在**当前**运行时确实存在', () => {
    // 这条保证"测试跑得起来"这件事本身不是巧合
    expect(typeof registerHooks, 'module.registerHooks 不存在 → node 版本不够').toBe(
      'function',
    );
    expect(typeof stripTypeScriptTypes).toBe('function');
  });

  it('★ package.json 的 engines.node 不低于 API 真实门槛', () => {
    const pkg = JSON.parse(readFileSync(join(PROJECT_ROOT, 'package.json'), 'utf8')) as {
      engines?: { node?: string };
    };
    const range = pkg.engines?.node;
    expect(range, 'package.json 必须声明 engines.node').toBeTruthy();

    // 只认 `>=x.y.z` 这一种写法：换成 `^`/`~`/`||` 时这条断言要**红**，
    // 而不是被静默放过（否则"低报门槛"又能藏回来）
    const m = /^>=\s*(\d+\.\d+\.\d+)$/.exec(range as string);
    expect(m, `engines.node 应为 ">=x.y.z" 形式，实际是 ${String(range)}`).not.toBeNull();

    // m 一定非空（上一行已断言）；这里的兜底只是为了让类型收窄，且兜底值必红
    const declared = m?.[1] ?? '';
    expect(
      atLeast(declared, API_FLOOR),
      `engines.node=${String(range)} 低于真实门槛 >=${API_FLOOR}（registerHooks 引入版本）`,
    ).toBe(true);
  });
});

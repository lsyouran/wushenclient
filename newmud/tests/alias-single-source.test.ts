/**
 * tests/alias-single-source.test.ts —— 路径别名**只准有一个真相**
 * ============================================================================
 * 本工程有四处声明同一张别名表（`@shared/` `@engine/` `@world/`）：
 *
 *   1. `tsconfig.json`                      —— 类型检查用（**唯一真相**）
 *   2. `tools/gate/g13-deps.mjs`            —— 依赖方向闸门
 *   3. `tools/gate/g14-webgraph.mjs`        —— 前端依赖图闸门
 *   4. `vitest.config.ts`                   —— 测试运行时解析
 *   （外加新增的 `tools/dev/ts-loader.ts`，但它**读的是 tsconfig.json**，不是第五份表）
 *
 * 从前 2/3/4 各自带一句"改 tsconfig 时此处同步"的注释 —— 而
 * `vitest.config.ts` 更进一步宣称 **"G12/G13 闸门会做交叉核对"**。
 * 实测：**没有任何闸门或测试做过这件事**（G13/G14 只是各自 mirror 一份，
 * G12 根本不看别名）。这就是 FG-20：一句**不成立**的保护声明。
 *
 * 处置按 24 册 §5.3 的纪律：**补实现**（真的做出核对），而不是把注释改软。
 * 于是有了本文件 —— 四条来源必须逐字一致，任何一条漂移当场变红。
 *
 * ⚠️ 闸门脚本**不能 import**：它们顶层就会 `process.exit()`。
 *    所以这里做**文本提取**；提取不到就抛错（而不是悄悄跳过）——
 *    否则改个写法就能让本文件变成"永远绿"。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PROJECT_ROOT } from '../server/paths.js';
import { readPathAliases } from '../tools/dev/ts-loader.js';

type Pair = readonly [string, string];

function readText(relPath: string): string {
  return readFileSync(join(PROJECT_ROOT, relPath), 'utf8');
}

/** 来源 1：tsconfig.json 的 `compilerOptions.paths` —— 唯一真相 */
function fromTsconfig(): Pair[] {
  const cfg = JSON.parse(readText('tsconfig.json')) as {
    compilerOptions?: { paths?: Record<string, readonly string[]> };
  };
  const paths = cfg.compilerOptions?.paths ?? {};
  return Object.entries(paths).map(
    ([key, values]): Pair => [key.replace(/\*$/, ''), (values[0] ?? '').replace(/\*$/, '')],
  );
}

/** 来源 2/3：闸门脚本里的 `const ALIASES = [...]` */
function fromGate(relPath: string): Pair[] {
  const block = /const ALIASES\s*=\s*\[([\s\S]*?)\];/.exec(readText(relPath));
  if (block === null) {
    throw new Error(
      `从 ${relPath} 里提不出 ALIASES 表 —— 若你改了它的写法，请同步更新本测试（不要删断言）`,
    );
  }
  const out: Pair[] = [];
  for (const m of (block[1] ?? '').matchAll(/\[\s*'([^']+)'\s*,\s*'([^']+)'\s*\]/g)) {
    out.push([m[1] ?? '', m[2] ?? '']);
  }
  return out;
}

/** 来源 4：`vitest.config.ts` 的 `resolve.alias` */
function fromVitestConfig(): Pair[] {
  const out: Pair[] = [];
  for (const line of readText('vitest.config.ts').split(/\r?\n/)) {
    const found = /find:\s*\/\^@(\w+)\\\//.exec(line);
    const target = /replacement:\s*resolve\(ROOT,\s*'([^']+)'\)/.exec(line);
    if (found !== null && target !== null) out.push([`@${found[1] ?? ''}/`, `${target[1] ?? ''}/`]);
  }
  return out;
}

describe('路径别名：四条来源必须一致', () => {
  it('tsconfig.json 是唯一真相，且恰好三条（不是 0 条也不是 5 条）', () => {
    const truth = fromTsconfig();
    expect(truth.length).toBe(3);
    expect(truth.map(([p]) => p)).toEqual(['@shared/', '@engine/', '@world/']);
  });

  it('加载器读出来的表 = tsconfig.json（说明它没在别处再存一份）', () => {
    expect(readPathAliases(PROJECT_ROOT)).toEqual(fromTsconfig());
  });

  it('G13（依赖方向闸门）与 tsconfig.json 一致', () => {
    expect(fromGate('tools/gate/g13-deps.mjs')).toEqual(fromTsconfig());
  });

  it('G14（前端依赖图闸门）与 tsconfig.json 一致', () => {
    expect(fromGate('tools/gate/g14-webgraph.mjs')).toEqual(fromTsconfig());
  });

  it('vitest.config.ts 与 tsconfig.json 一致', () => {
    expect(fromVitestConfig()).toEqual(fromTsconfig());
  });

  it('★ 提取器本身有效：故意喂一个不存在的写法必须抛错（否则本文件可被"改成永远绿"）', () => {
    expect(() => fromGate('package.json')).toThrow();
    expect(fromVitestConfig().length).toBe(3);
  });
});

#!/usr/bin/env node
/**
 * G5 · 命名闸门
 * ============================================================================
 * 守住 docs/24 §1 两条结构性约定：
 *   G5.1 world 文件路径必须是 `world/<kind>/<...>.ts`，且 <kind> 合法
 *   G5.2 文件里 define* 的 kind 必须与所在目录一致
 *   G5.3 文件里 define* 的 id（去掉 #变体）必须等于「路径推出来的 id」
 *   G5.4 每个 world 文件都必须在 world/index.ts 的 CONTENT_MODULES 里登记
 *   G5.5 CONTENT_MODULES 里登记的每一项都必须在磁盘上存在
 *   G5.6 CONTENT_MODULES 里登记的每一项都必须在 world/index.ts 里被 **import**
 *        （★ docs/26 H2：登记 ≠ 加载。只登记不 import 的内容**不会被执行**，
 *          被引用的对象会在 G4 校验时报「引用不存在」，而**孤立内容会彻底静默消失**）
 *   G5.7 反过来：index.ts 里 import 的每个内容文件都必须在 CONTENT_MODULES 里登记
 *
 *   G5.6 / G5.7 合起来 = 「import 集合 ≡ CONTENT_MODULES 集合」（双向差集为空）。
 *   为什么必须双向：index.ts 里是**两份平行清单**（7 条 import + 7 项登记），
 *   只核对其中一份，就只守住了一半方向。
 *
 * 退出码：0 通过 / 1 违规 / 2 跳过 / 3 崩溃（闸门自身异常，见 26 册 §27）
 */

import { join } from 'node:path';
import {
  EXIT_FAIL,
  EXIT_PASS,
  EXIT_SKIP,
  ROOT,
  exists,
  header,
  installCrashGuard,
  isDir,
  readCode,
  readText,
  rel,
  report,
  walk,
} from './lib.mjs';

installCrashGuard('G5');

const KINDS = ['room', 'area', 'npc', 'item', 'skill', 'family', 'command', 'task'];
const FN_TO_KIND = {
  Room: 'room',
  Area: 'area',
  Npc: 'npc',
  Item: 'item',
  Skill: 'skill',
  Family: 'family',
  Command: 'command',
  Task: 'task',
};
const DEFINE_RE = /define(Room|Area|Npc|Item|Skill|Family|Command|Task)\(\s*(['"])([^'"]+)\2/g;

const violations = [];
const push = (rule, where, message) => violations.push({ rule, where, message });

const worldDir = join(ROOT, 'world');
if (!isDir(worldDir)) {
  header('G5', '命名');
  // ★ docs/26 L6：用常量而不是裸 2（其余闸门都用常量，裸数字是漂移温床）
  console.log('  ⏭️  SKIP：world/ 目录不存在');
  process.exit(EXIT_SKIP);
}

// ---- 读 world/index.ts：两份平行清单（import 语句 + CONTENT_MODULES）----
const indexFile = join(worldDir, 'index.ts');
let listed = [];
/**
 * `import './area/yz.js';` → `area/yz.ts`
 * 内容层用 `.js` 说明符指向 `.ts` 源文件（ESM 惯例），故此处做一次后缀归一。
 * 非相对 import（如第三方包）不参与本规则。
 */
function importSpecToWorldPath(spec) {
  return `${spec.replace(/\.(m?js|m?ts|tsx?|mts|cts)$/, '')}.ts`;
}
const IMPORT_RE = /^\s*import\s+['"](\.\/[^'"]+)['"]\s*;?\s*$/gm;
let indexText = null;
let imports = [];

if (exists(indexFile)) {
  indexText = readText(indexFile);
  const block = /CONTENT_MODULES[^=]*=\s*\[([\s\S]*?)\]/.exec(indexText);
  if (block?.[1] !== undefined) {
    listed = [...block[1].matchAll(/'([^']+)'|"([^"]+)"/g)]
      .map((m) => m[1] ?? m[2])
      .filter((x) => x !== undefined);
  }
  imports = [...indexText.matchAll(IMPORT_RE)]
    .map((m) => importSpecToWorldPath((m[1] ?? '').slice(2)))
    .filter((x) => x !== '');
} else {
  push('G5.4', 'world/index.ts', '缺少显式加载清单文件');
}
const listedSet = new Set(listed);
const importSet = new Set(imports);

// ---- 遍历 world 下的内容文件 ----
const files = walk(worldDir, { exts: new Set(['.ts']) }).filter(
  (f) => rel(f) !== 'world/index.ts',
);

for (const file of files) {
  const relWorld = rel(file).slice('world/'.length); // 如 room/yz/guangchang.ts
  const where = `world/${relWorld}`;

  const segs = relWorld.replace(/\.ts$/, '').split('/');
  const dirKind = segs[0];
  const idBase = segs.slice(1).join('/');

  if (dirKind === undefined || !KINDS.includes(dirKind)) {
    push('G5.1', where, `一级目录 "${dirKind}" 不是合法 kind（允许：${KINDS.join('/')}）`);
    continue;
  }
  if (segs.length < 2) {
    push('G5.1', where, `内容文件必须位于 world/<kind>/<...>.ts，当前层级不足`);
    continue;
  }

  if (!listedSet.has(relWorld)) {
    push('G5.4', where, '未在 world/index.ts 的 CONTENT_MODULES 中登记（不会被打包加载）');
  }

  const { code } = readCode(file);
  const text = code.join('\n');
  const found = [...text.matchAll(DEFINE_RE)];

  if (found.length === 0) {
    push('G5.2', where, '文件中没有任何 define* 调用');
    continue;
  }

  for (const m of found) {
    const fnKind = FN_TO_KIND[m[1]];
    const id = m[3];
    if (fnKind !== dirKind) {
      push('G5.2', where, `define${m[1]}() 与目录 kind "${dirKind}" 不一致`);
    }
    const base = id.includes('#') ? id.slice(0, id.indexOf('#')) : id;
    if (base !== idBase) {
      push(
        'G5.3',
        where,
        `define 的 id "${id}"（基路径 "${base}"）与文件路径推出的 id "${idBase}" 不一致`,
      );
    }
  }
}

// ---- G5.5 登记项必须存在于磁盘 ----
for (const item of listed) {
  if (!exists(join(worldDir, item))) {
    push('G5.5', 'world/index.ts', `登记了不存在的文件 "${item}"`);
  }
}

// ---- G5.6 登记项必须被 import（★ docs/26 H2）----
// 「登记」只说明"这个文件应该加载"，真正让内容生效的是 import 语句。
// 只登记不 import 时，被引用的对象会在 G4 校验阶段暴露成"引用不存在"，
// 而**不被任何东西引用**的内容（孤立房间/任务/没人掉的物品）会静默消失。
for (const item of listed) {
  if (!importSet.has(item)) {
    push(
      'G5.6',
      'world/index.ts',
      `"${item}" 登记在 CONTENT_MODULES 里，但本文件没有 import 它 —— ` +
        `该文件**不会被执行**，其内容不会进入注册表（登记 ≠ 加载）`,
    );
  }
}

// ---- G5.7 反向：import 的内容必须登记 ----
for (const item of imports) {
  if (!listedSet.has(item)) {
    push(
      'G5.7',
      'world/index.ts',
      `import 了 "${item}"，但 CONTENT_MODULES 里没有登记 —— ` +
        `两份清单已发散（import 集合与登记集合必须双向一致）`,
    );
  }
}

// ---- 重复项：import 两次同一个文件看似无害，实为清单本身已开始漂移 ----
const dupImports = imports.filter((x, i) => imports.indexOf(x) !== i);
for (const item of [...new Set(dupImports)]) {
  push('G5.7', 'world/index.ts', `import 出现重复："${item}"`);
}

header('G5', '命名（路径 ↔ id ↔ 登记 ↔ 加载）', {
  内容文件: files.length,
  登记项: listed.length,
  import语句: imports.length,
});

if (violations.length === 0) {
  // ── DEAD-RULE GUARD（24 册 FG-7：覆盖 0 = 死规则，必须判失败）─────────────
  // ★ 与 G6 / G15 同形（2026-10-15 补，26 册 §36）。G5.1–G5.3 是**按文件**判的：
  //   一旦 `walk` 扫不到 world/*.ts（改形 / 过滤器写错 / 行为变化），`files` 归零
  //   而 `listed`/`imports` 仍互相自洽 ⇒ 输出"✅ 五者一致"，其实一条 G5.1–G5.3 都没判。
  //   （world/ 目录整个不存在是另一回事，那条走上面的 SKIP，语义已分开。）
  if (files.length === 0) {
    console.log('  ❌ 死规则守卫：扫描到 0 个 world 内容文件 —— 判失败');
    console.log('      （覆盖 0 = G5.1–G5.3 此刻是死的；world/ 为空与"未发现违规"必须可区分）');
    process.exit(EXIT_FAIL);
  }
  console.log('  ✅ 通过：文件路径 / kind / id / 登记 / import 五者一致');
  process.exit(EXIT_PASS);
}
process.exit(report(violations, { failText: '命名不一致' }));

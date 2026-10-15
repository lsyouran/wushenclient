#!/usr/bin/env node
/**
 * G14 · 前端依赖图（浏览器可解析性）
 * ============================================================================
 * 硬约束（见 26 册 §15.3）：
 *   E1  前端**可达图**里不得出现裸包名（`zod` / `node:*` / 任何 npm 包）
 *       —— 浏览器解析不了裸模块说明符。踩中的形态是
 *          **`npm run build:web` 报成功 + 浏览器白屏**：编译期没有任何人反对。
 *   E2  前端**可达图**里不得有断链（说明符解析不到磁盘上的文件）
 *       —— 同样只表现为 404 + 白屏，构建照旧成功。
 *
 * 为什么必须单独成一道闸门（而不是塞进 G13）：
 *   G13 只做「依赖方向」（server/engine ↔ world ↔ server/world），而且它对
 *   **裸包名是显式放行**的 —— 那里 `resolveSpec()` 返回 null 就 `continue`，
 *   分工是"谁可以 import 谁"，不是"浏览器能不能解析"。
 *   同时 `src/` 也不在 G13 的三条规则范围内。
 *   于是「前端不得触达 zod 依赖」这条硬约束在 G13 里是**真空**：挡不住。
 *
 * ★ 判据是**可达性**，不是"把 `src/` 的文本扫一遍" —— 这两者的差别是实的：
 *   - `src/` 里的死代码（不在入口的可达图上）浏览器根本不加载，报红是**假红**；
 *   - 反过来，`shared/constants.ts` 这种**被前端合法引用**的共享模块新增一行
 *     `import 'zod'`，一样会让页面白屏 —— 只扫 `src/` 会**漏掉**。
 *   所以入口不写死在脚本里，而是从 `src/index.html` 的
 *   `<script type="module" src=...>` 读出：**浏览器加载哪个文件，闸门就从哪个
 *   文件出发**（入口只有一份，不在这里再抄一份）。
 *
 * ★ 必须剥离 `import type` / `export type` / 内联 `{ type A }`：
 *   类型导入在编译期被擦除（`verbatimModuleSyntax` 下尤其确定），把它们算进
 *   可达图会**误报** —— 前端对 `shared/protocol.js` 的引用**全部**是类型导入。
 *   假红比漏报更伤：挡不住真问题，却会消耗掉"闸门可信"这件事（见 24 册 FG-6/FG-12）。
 *   反向的假绿同样要防：只按"这一行里出现过 `import type`"来判，会漏掉
 *   `export type { A } from 'x'` 与 `import { type A, B } from 'x'`（B 是值）。
 *   本闸门逐声明解析子句，只有**整条子句都是类型**时才跳过。
 *
 * 退出码：0 通过 / 1 违规 / 3 崩溃（闸门自身异常，见 26 册 §27）
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import * as posix from 'node:path/posix';
import {
  EXIT_FAIL,
  EXIT_PASS,
  ROOT,
  header,
  installCrashGuard,
  readCode,
  readText,
  report,
} from './lib.mjs';

installCrashGuard('G14');

/** tsconfig `paths` 的镜像（改 tsconfig 时此处同步 —— 与 G13 同源） */
const ALIASES = [
  ['@shared/', 'shared/'],
  ['@engine/', 'server/'],
  ['@world/', 'world/'],
];

const ENTRY_HTML = 'src/index.html';
const ENTRY_DIR = 'src';

/** 浏览器带 `.js` 说明符指向 TS 源；其余是"省略扩展名"与"目录默认文件" */
const EXT_REWRITE = [
  ['.js', '.ts'],
  ['.jsx', '.tsx'],
  ['.mjs', '.mts'],
  ['.cjs', '.cts'],
];

// ── 入口：从 index.html 读，而不是在脚本里写死 ──────────────────────────────

/** 取出所有 `<script type="module" src="...">` 的 src（属性顺序无关） */
function readEntries() {
  const p = join(ROOT, ENTRY_HTML);
  if (!existsSync(p)) return { entries: [], reason: `${ENTRY_HTML} 不存在` };
  const entries = [];
  for (const m of readText(p).matchAll(/<script\b[^>]*>/gi)) {
    const tag = m[0];
    if (!/\btype\s*=\s*["']module["']/i.test(tag)) continue;
    const src = /\bsrc\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
    if (src === undefined) continue;
    entries.push(posix.normalize(posix.join(ENTRY_DIR, src)));
  }
  return {
    entries,
    reason: entries.length === 0 ? `${ENTRY_HTML} 里没有 <script type="module" src=...>` : '',
  };
}

// ── 说明符采集 ──────────────────────────────────────────────────────────────

/**
 * 声明式 import / export：
 *   `import ... from 'x'` · `export ... from 'x'`（含 `export * from`）
 *   ★ `^[ \t]*` 前缀把匹配钉在**行首**：这样字符串字面量里出现的
 *     `"...from 'y'"` 不会被当成真声明（import 语句总在行首）。
 *   ★ `[^;'"]*?` 可跨行（取反字符类包含换行），因此多行 import 子句也能吃下；
 *     用 `;` 收口避免"一条 import 把大半个文件吞进去"。
 */
const STATEMENT_RE = /^[ \t]*(import|export)\s+([^;'"]*?)\s*from\s*['"]([^'"]+)['"]/gm;

/** 副作用导入：`import 'x'`（无 `from`）。G13 曾因漏掉这一种而记 FG-1。 */
const SIDE_EFFECT_RE = /^[ \t]*import\s*['"]([^'"]+)['"]/gm;

/** 动态导入：`import('x')`（可出现在任意位置） */
const DYNAMIC_RE = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

/**
 * 整条子句都是类型吗？
 *   `type { A }` / `type X` / `type * as ns`  → 是
 *   `{ type A, type B }`                     → 是（逐项都是类型）
 *   `{ type A, B }`                          → 否（B 是值，必须进可达图）
 *   `{ A }` / `X` / `* as ns`                → 否
 */
function isTypeOnlyClause(clause) {
  const c = clause.trim();
  if (/^type(?:\s|\{|$)/.test(c)) return true;
  if (!c.startsWith('{')) return false;
  const close = c.lastIndexOf('}');
  const inner = close === -1 ? c.slice(1) : c.slice(1, close);
  const parts = inner
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return parts.length > 0 && parts.every((p) => /^type\s+\S/.test(p));
}

/** 采集一个文件里**所有会进可达图**的说明符 */
function collectSpecs(code) {
  const out = [];
  for (const m of code.matchAll(STATEMENT_RE)) {
    if (isTypeOnlyClause(m[2] ?? '')) continue;
    out.push({ spec: m[3] ?? '', kind: `${m[1]} ... from` });
  }
  for (const m of code.matchAll(SIDE_EFFECT_RE)) {
    out.push({ spec: m[1] ?? '', kind: 'import（副作用）' });
  }
  for (const m of code.matchAll(DYNAMIC_RE)) {
    out.push({ spec: m[1] ?? '', kind: 'import(...)' });
  }
  return out.filter((s) => s.spec.length > 0);
}

// ── 说明符 → 项目内文件 ─────────────────────────────────────────────────────

/** 解析为项目内相对路径；**裸包名返回 null**（这正是 E1 要判的东西） */
function resolveRel(fromRel, spec) {
  if (spec.startsWith('.')) return posix.normalize(posix.join(posix.dirname(fromRel), spec));
  for (const [alias, target] of ALIASES) {
    if (spec.startsWith(alias)) return target + spec.slice(alias.length);
  }
  return null;
}

/** 落到一个真实存在的文件；找不到返回 null（E2） */
function toExistingFile(relPath) {
  const cands = [];
  for (const [from, to] of EXT_REWRITE) {
    if (relPath.endsWith(from)) cands.push(relPath.slice(0, -from.length) + to);
  }
  cands.push(relPath, `${relPath}.ts`, `${relPath}.tsx`);
  cands.push(`${relPath}/index.ts`, `${relPath}/index.tsx`, `${relPath}/index.js`);
  for (const c of cands) if (existsSync(join(ROOT, c))) return c;
  return null;
}

// ── 从入口做可达性遍历 ──────────────────────────────────────────────────────

const { entries, reason } = readEntries();

const violations = [];
const seen = new Set();
/** 反向边：file → 谁 import 的它（用来回放"链"） */
const parent = new Map();
const queue = [];

for (const e of entries) {
  const f = toExistingFile(e);
  if (f === null) {
    violations.push({
      rule: 'G14.2',
      where: ENTRY_HTML,
      message: `入口脚本解析不到文件：<script src="${e}">`,
    });
    continue;
  }
  if (!seen.has(f)) {
    parent.set(f, null);
    queue.push(f);
  }
}

/** 回放 import 链：入口 → … → 当前文件 */
function chainOf(of) {
  const parts = [];
  let p = of;
  while (p !== undefined && p !== null) {
    parts.unshift(p);
    p = parent.get(p);
  }
  return parts.length > 1 ? `\n           链：${parts.join(' → ')}` : '';
}

while (queue.length > 0) {
  const cur = queue.shift();
  if (cur === undefined || seen.has(cur)) continue;
  seen.add(cur);

  const code = readCode(join(ROOT, cur)).code.join('\n');
  for (const { spec, kind } of collectSpecs(code)) {
    const resolved = resolveRel(cur, spec);

    // E1 裸包名 —— 浏览器解析不了，且 **构建会成功**
    if (resolved === null) {
      violations.push({
        rule: 'G14.1',
        where: cur,
        message:
          `前端可达图里出现裸包名：${kind} "${spec}"` +
          '（浏览器解析不了裸模块说明符；`npm run build:web` 仍会报成功，表现为页面白屏）' +
          chainOf(cur),
      });
      continue;
    }

    // E2 断链
    const file = toExistingFile(resolved);
    if (file === null) {
      violations.push({
        rule: 'G14.2',
        where: cur,
        message: `${kind} "${spec}" 解析为 ${resolved}，但磁盘上不存在（404 → 白屏）`,
      });
      continue;
    }

    if (!seen.has(file)) {
      parent.set(file, cur);
      queue.push(file);
    }
  }
}

// ── 报告 ────────────────────────────────────────────────────────────────────

header('G14', '前端依赖图', {
  入口: entries.length > 0 ? entries.join(' · ') : '(无)',
  可达文件: seen.size,
  判据: 'E1 无裸包名 / E2 无断链',
});

// ★ DEAD-RULE GUARD（见 24 册 FG-7「0 覆盖 = 死规则」）：覆盖 0 文件 = **判失败**。
//   这一个分支同时兜住"入口缺失"（`entries` 为空）与"入口存在却一个模块都没走到"。
//   ★ 它**不走 SKIP**：一个没有模块入口的前端本来就是坏的，而 SKIP 的语义是
//     "前置条件未满足"（如 G2 在前端尚未建立时）—— 那是"现在还轮不到我查"，
//     与"我要查的范围内一个对象都没有"是两件事，混起来就会出现 FG-7 那种"谁也看不见的空白"。
//   若 0 覆盖的同时已经抓到违规（入口指向了不存在的文件），**优先报违规** —— 那更可操作。
if (seen.size === 0) {
  if (violations.length > 0) {
    process.exit(report(violations, { failText: '前端依赖图违规（入口就没走通）' }));
  }
  console.log(`  ❌ 死规则守卫：前端可达文件数为 0 —— ${reason || '入口存在却一个模块都没走到'}，判失败`);
  console.log(`      （入口取自 ${ENTRY_HTML} 的 <script type="module" src=...>；覆盖 0 文件不算通过）`);
  process.exit(EXIT_FAIL);
}

if (violations.length === 0) {
  console.log(`  ✅ 通过：前端可达图 ${seen.size} 个文件，无裸包名、无断链`);
  process.exit(EXIT_PASS);
}
process.exit(report(violations, { failText: '前端依赖图违规' }));

#!/usr/bin/env node
/**
 * G12 · 路径与改名闸门
 * ============================================================================
 * 保证「把工程目录改名后，不会爆出一堆路径错误」。
 * 对应 24 册 §2.7 的 R1-R4。
 *
 * 用法：node tools/gate/check-paths.mjs
 * 退出码：0 通过 / 1 违规 / 2 跳过 / 3 崩溃（闸门自身异常，见 26 册 §27）
 */

import { join } from 'node:path';
import {
  EXIT_FAIL,
  EXIT_PASS,
  PROJECT_NAME,
  ROOT,
  SCAN_EXT,
  header,
  installCrashGuard,
  isDir,
  readCode,
  rel,
  report,
  walk,
} from './lib.mjs';

installCrashGuard('G12');

/**
 * 扫描范围。
 * ★ `tools/` 与 `tests/` 必须在列：闸门脚本与测试同样是"改名会炸"的地方，
 *   漏掉它们就会出现"改名后只有测试报错、而路径闸门仍绿"的盲区。
 *   `docs/` 刻意排除：文档里出现项目名是合法的（本规范自己就在写）。
 */
const SCAN_DIRS = ['shared', 'server', 'src', 'world', 'tools', 'tests'];

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 行内豁免标记：`// g12-allow R1` 或 `// g12-allow R1,R3`
 *
 * 用途：闸门脚本自身的**规则定义**与**变异样本**天然包含被禁字面量
 * （例如本文件里 R3 的显示名、`mutation-test.mjs` 里 R1/R3 的夹具）。
 *
 * ★ 设计上就没有后门：正则要求**必须紧跟至少一个规则号**。
 *   因此裸写 `// g12-allow` 不构成标记（该行照旧报红），
 *   也就不需要在文档里反复解释"能不能省略规则号"。
 *   被豁免的次数会打印在表头，便于审计。
 */
const ALLOW_RE = /\/\/\s*g12-allow:?[ \t]+((?:R[0-9])[ \t]*(?:,[ \t]*R[0-9])*)/;

function allowedRulesOf(rawLine) {
  const m = ALLOW_RE.exec(rawLine);
  if (m === null) return null;
  return [...(m[1] ?? '').matchAll(/\bR[0-9]\b/g)].map((x) => x[0]);
}

const RULES = [
  {
    id: 'R1',
    name: '绝对路径字面量',
    // ★ 盘符必须**位于词边界**：否则 `node:/`、`ws:\/`、`http://` 里的 `e:/`、`s:\`、`p:/`
    //   都会被当成盘符 —— 这正是首轮把扫描范围扩到 tools/ 时炸出的 2 处误报。
    //   持续误报的闸门最终会被开发者关掉，比没有闸门更糟。
    re: /(?:^|[^A-Za-z0-9_$])[A-Za-z]:[\\/]|(?:^|[^A-Za-z0-9._])\/(?:Users|home|mnt)\//,
    appliesTo: () => true,
  },
  {
    id: 'R2',
    name: `硬编码项目目录名「${PROJECT_NAME}」`,
    re: new RegExp(
      `(?:^|[^A-Za-z0-9_-])${escapeRe(PROJECT_NAME)}(?:[^A-Za-z0-9_-]|$)`,
    ),
    appliesTo: () => true,
  },
  {
    id: 'R3',
    name: 'process.cwd() 参与资源路径', // g12-allow R3  ← 规则显示名自身含该模式
    re: /process\.cwd\s*\(/,
    appliesTo: () => true,
  },
  {
    id: 'R4',
    name: 'shared/ 内 import node:*',
    re: /(?:from|import)\s*\(?\s*['"]node:/,
    appliesTo: (relPosix) => relPosix.startsWith('shared/'),
  },
];

let scanned = 0;
let exempted = 0;
const violations = [];

for (const d of SCAN_DIRS) {
  const dir = join(ROOT, d);
  if (!isDir(dir)) continue;
  for (const file of walk(dir, { exts: SCAN_EXT })) {
    scanned += 1;
    const relPosix = rel(file);
    const { raw, code } = readCode(file);
    const allowedByLine = raw.map(allowedRulesOf);

    for (const rule of RULES) {
      if (!rule.appliesTo(relPosix)) continue;
      code.forEach((line, i) => {
        if (!rule.re.test(line)) return;
        if (allowedByLine[i]?.includes(rule.id) === true) {
          exempted += 1;
          return;
        }
        violations.push({
          rule: rule.id,
          where: `${relPosix}:${i + 1}`,
          message: `${rule.name}  →  ${(raw[i] ?? '').trim().slice(0, 90)}`,
        });
      });
    }
  }
}

header('G12', '路径与改名', {
  项目根: ROOT,
  目录名: `${PROJECT_NAME}（运行时读取，改名后自动跟随）`,
  扫描文件: scanned,
  行内豁免: exempted,
});

// ── DEAD-RULE GUARD（24 册 FG-7：覆盖 0 = 死规则，必须判失败）───────────────
// ★ 与 G6 / G15 同形（2026-10-15 补，26 册 §36）。守的是"扫描范围 ≠ 判定范围"：
//   `SCAN_DIRS` 一旦被改错（或 `walk`/`readCode` 的行为变了），`scanned` 会**静默**
//   归零，而输出仍是"✅ 通过：未发现路径硬编码" —— 一条什么都没判过的绿。
if (scanned === 0) {
  console.log('  ❌ 死规则守卫：本次扫描 0 个文件 —— 判失败');
  console.log(`      （扫描目录：${SCAN_DIRS.join(' / ')}。覆盖 0 = 这条规则此刻是死的）`);
  process.exit(EXIT_FAIL);
}

if (violations.length === 0) {
  console.log('  ✅ 通过：未发现路径硬编码');
  process.exit(EXIT_PASS);
}
process.exit(report(violations, { failText: '发现路径硬编码' }));

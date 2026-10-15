#!/usr/bin/env node
/**
 * G13 · 依赖方向闸门
 * ============================================================================
 * 硬约束（见 server/bootstrap.ts 顶部注释）：
 *   D1  server/engine/**  不得 import 具体内容（world/**）
 *   D2  world/**（内容）  只允许 import @shared/** 与 server/world/**（define API）
 *   D3  server/world/**   不得 import world/**
 *
 * 目的：引擎对"有哪些房间/NPC"一无所知 → 可单测、内容可独立演进。
 *
 * 实现要点（两处曾经的假绿，已修）：
 *   ★ 说明符必须**解析成项目内相对路径**再判断，不能只做字符串前缀匹配。
 *     否则 `import '../../world/room/yz/guangchang.js'` 这种相对路径逃逸完全看不见。
 *   ★ 必须覆盖**副作用式静态 import**（`import 'x'`）与 `export ... from`，
 *     只匹配 `from` / `import(` 会漏掉 `import '@world/index.js';`。
 *
 * 退出码：0 通过 / 1 违规 / 3 崩溃（闸门自身异常，见 26 册 §27）
 */

import { join } from 'node:path';
import * as posix from 'node:path/posix';
import {
  EXIT_FAIL,
  EXIT_PASS,
  ROOT,
  header,
  installCrashGuard,
  isDir,
  readCode,
  rel,
  report,
  walk,
} from './lib.mjs';

installCrashGuard('G13');

/** tsconfig `paths` 的镜像（改 tsconfig 时此处同步） */
const ALIASES = [
  ['@shared/', 'shared/'],
  ['@engine/', 'server/'],
  ['@world/', 'world/'],
];

/**
 * 采集 import 说明符。
 * 覆盖：`import ... from 'x'` / `export ... from 'x'` / `import('x')` / `import 'x'`
 */
const IMPORT_RE = /(?:from\s*|import\s*\(\s*|import\s+)['"]([^'"]+)['"]/g;

/** 把说明符解析为项目内相对路径（posix 风格）；裸包名返回 null */
function resolveSpec(fromRel, spec) {
  if (spec.startsWith('.')) {
    return posix.normalize(posix.join(posix.dirname(fromRel), spec));
  }
  for (const [alias, target] of ALIASES) {
    if (spec.startsWith(alias)) return target + spec.slice(alias.length);
  }
  return null;
}

const rules = [
  {
    id: 'D1',
    scope: 'server/engine/',
    forbidden: (p) => p.startsWith('world/'),
    message: (spec) => `引擎不得依赖具体内容：import "${spec}"（请通过 registry 读取）`,
  },
  {
    id: 'D3',
    scope: 'server/world/',
    forbidden: (p) => p.startsWith('world/'),
    message: (spec) => `内容框架层不得反向依赖内容：import "${spec}"`,
  },
  {
    id: 'D2',
    scope: 'world/',
    forbidden: (p) => p.startsWith('server/') && !p.startsWith('server/world/'),
    message: (spec) => `内容层只能 import @engine/world/ 或 @shared/：import "${spec}"`,
  },
];

const violations = [];
const scanned = new Set();

for (const rule of rules) {
  const dir = join(ROOT, rule.scope.replace(/\/$/, ''));
  if (!isDir(dir)) continue;
  for (const file of walk(dir)) {
    const relPosix = rel(file);
    if (!relPosix.startsWith(rule.scope)) continue;
    scanned.add(relPosix);
    const { code } = readCode(file);
    for (const line of code) {
      for (const m of line.matchAll(IMPORT_RE)) {
        const spec = m[1];
        if (spec === undefined) continue;
        const resolved = resolveSpec(relPosix, spec);
        if (resolved === null) continue; // 裸包名（zod / node:* 等）
        if (rule.forbidden(resolved)) {
          violations.push({
            rule: rule.id,
            where: relPosix,
            message: rule.message(spec) + `（解析为 ${resolved}）`,
          });
        }
      }
    }
  }
}

header('G13', '依赖方向', { 扫描文件: scanned.size });

// ── DEAD-RULE GUARD（24 册 FG-7：覆盖 0 = 死规则，必须判失败）───────────────
// ★ 与 G6 / G15 同形（2026-10-15 补，26 册 §36）。三条规则的 `scope` 若被改形、
//   或 `walk`/`readCode` 行为变了，`scanned` 会**静默**归零，输出仍是
//   "✅ 通过：三层依赖方向正确" —— 一条什么都没判过的绿（FG-7 的典型形态）。
if (scanned.size === 0) {
  console.log('  ❌ 死规则守卫：本次扫描 0 个文件 —— 判失败');
  console.log(`      （规则 scope：${rules.map((r) => r.scope).join(' / ')}。覆盖 0 = 这条规则此刻是死的）`);
  process.exit(EXIT_FAIL);
}

if (violations.length === 0) {
  console.log('  ✅ 通过：引擎 / 内容框架 / 内容三层依赖方向正确');
  process.exit(EXIT_PASS);
}
process.exit(report(violations, { failText: '依赖方向违规' }));

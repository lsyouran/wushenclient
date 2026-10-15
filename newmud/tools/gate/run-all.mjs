#!/usr/bin/env node
/**
 * 闸门总控 —— 依次运行所有静态闸门并汇总
 * ============================================================================
 * 退出码：0 全部通过；1 有闸门失败；3 总控自身崩溃（见 26 册 §27）。
 * ⏭️ SKIP（退出码 2）**不计为通过**，在汇总里单列。
 * 💥 CRASH（退出码 3）**更不算通过**：它是"闸门自己死了"，与"发现违规"分开单列 ——
 *    在 FG-23 之前两者同码（node 未捕获异常也是 1），汇总里看起来一模一样。
 *
 * 完整门禁（含需要执行 TS 的门）：
 *   npm run check = typecheck(G1) + test(G4/G8) + gate(G2/G5/G6/G12/G13)
 */

import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import {
  EXIT_CRASH,
  EXIT_FAIL,
  EXIT_PASS,
  GATE_DIR,
  PROJECT_NAME,
  ROOT,
  exitLabel,
  installCrashGuard,
} from './lib.mjs';

installCrashGuard('run-all');

const GATES = [
  { id: 'G2', name: '协议对账', script: 'g2-protocol.mjs' },
  { id: 'G3', name: '常量对账', script: 'g3-propkeys.mjs' },
  { id: 'G5', name: '命名', script: 'g5-naming.mjs' },
  { id: 'G6', name: '红线扫描', script: 'g6-redline.mjs' },
  { id: 'G12', name: '路径与改名', script: 'check-paths.mjs' },
  { id: 'G13', name: '依赖方向', script: 'g13-deps.mjs' },
  { id: 'G14', name: '前端依赖图', script: 'g14-webgraph.mjs' },
  { id: 'G15', name: '文档引用', script: 'g15-docrefs.mjs' },
];

console.log('='.repeat(64));
console.log(`闸门套件  |  项目根 ${ROOT}`);
console.log(`          |  目录名 ${PROJECT_NAME}（运行时读取）`);
console.log('='.repeat(64));

const results = [];
for (const g of GATES) {
  console.log('');
  const r = spawnSync(process.execPath, [join(GATE_DIR, g.script)], {
    stdio: 'inherit',
  });
  // ★ 不得用 `r.status ?? 1` 兜底：spawn 失败（脚本本身没跑起来）与
  //   「闸门发现违规」是两码事，混为一谈会掩盖环境问题、制造假红。
  if (r.error) {
    console.log(`  ⚠️  启动失败：${r.error.code ?? ''} ${r.error.message}`);
    results.push({ ...g, code: -1, spawnError: `${r.error.code ?? ''} ${r.error.message}` });
    continue;
  }
  results.push({ ...g, code: r.status ?? -1 });
}

console.log('');
console.log('='.repeat(64));
console.log('汇总');
console.log('='.repeat(64));
const label = exitLabel;

for (const r of results) {
  console.log(`  ${label(r.code)}  ${r.id.padEnd(5)} ${r.name}`);
}
console.log('');
console.log('  由测试覆盖（需执行 TS，见 npm test）：');
console.log('    G3  常量对账（类型↔守卫等价 / 表内部一致） tests/g3-constants.test.ts');
console.log('    G3  属性访问器（键类型 / 数值守卫 / 读档边界） tests/props.test.ts');
console.log('    G4  世界引用校验   tests/validate.test.ts');
console.log('    G8  不变式 / 注册约束 tests/define.test.ts, tests/content.test.ts');
console.log('');
console.log('  暂缓（见 docs/25，商业化前不实施）：G10 支付 / G11 GM');
console.log('');
console.log('  改动任一闸门后，必须跑 `npm run gate:mutation` 证明它仍会变红。');

const failed = results.filter((r) => r.code !== 0 && r.code !== 2);
const crashed = results.filter((r) => r.code === EXIT_CRASH);
const skipped = results.filter((r) => r.code === 2);
console.log('');
if (crashed.length > 0) {
  console.log(
    `💥 有闸门**自身崩溃**（不是"发现违规"，堆栈见上方各闸门自己的输出）：` +
      `${crashed.map((c) => c.id).join(', ')}`,
  );
}
if (failed.length > 0) {
  console.log(
    `❌ 静态闸门未通过：${failed
      .map((f) => `${f.id}${f.code === -1 ? '(启动失败)' : f.code === EXIT_CRASH ? '(崩溃)' : ''}`)
      .join(', ')}`,
  );
  process.exit(EXIT_FAIL);
}
if (skipped.length > 0) {
  console.log(`⚠️  另有 ${skipped.length} 项 SKIP（前置条件未满足，不计为通过）：${skipped.map((s) => s.id).join(', ')}`);
}
console.log('✅ 静态闸门全部通过');
process.exit(EXIT_PASS);

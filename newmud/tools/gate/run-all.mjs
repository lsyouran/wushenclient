#!/usr/bin/env node
/**
 * 闸门总控 —— 依次运行所有静态闸门并汇总
 * ============================================================================
 * 退出码：0 全部通过；1 有闸门失败**或有闸门 SKIP**；3 总控自身崩溃（见 26 册 §27）。
 * ⏭️ SKIP（退出码 2）**不计为通过** —— ★ 2026-10-19 起它在**退出码上**也不计为通过（本文件末尾）：
 *    以前只打一行警告就 exit 0，于是"不计入通过"只发生在显示层。
 * 💥 CRASH（退出码 3）**更不算通过**：它是"闸门自己死了"，与"发现违规"分开单列 ——
 *    在 FG-23 之前两者同码（node 未捕获异常也是 1），汇总里看起来一模一样。
 *
 * 用法：
 *   node tools/gate/run-all.mjs                 # 全量（取证只用这一种）
 *   node tools/gate/run-all.mjs --only=G16      # 迭代用；会大声声明"不是全量结论"
 *
 * 完整门禁（含需要执行 TS 的门）：
 *   npm run check = typecheck(G1) + test(G4/G8) + gate（下面 GATES 里的全部静态闸门）
 * ★ 这里原写的是 `gate(G2/G5/G6/G12/G13)` —— 一份**手写的旧清单**，在 G13 之后
 *   连续加了 G14/G15/G16/G17 都没回来改。注释里的清单和第二份真相是同一个病：
 *   **能少写一个具体清单，就别写**。要查有哪些闸门，看 `GATES`。
 */

import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  EXIT_CRASH,
  EXIT_FAIL,
  EXIT_PASS,
  EXIT_SKIP,
  GATE_DIR,
  PROJECT_NAME,
  ROOT,
  exitLabel,
  installCrashGuard,
} from './lib.mjs';

installCrashGuard('run-all');

/**
 * 崩溃守卫的**预载**地址（`node --import …`）。
 * ★ 必须由**调用方**挂：闸门里那句 `installCrashGuard()` 跑在 import 图加载**之后**，
 *   接不住"被 import 的模块有语法错误"。实测现场见 `preload.mjs` 头部。
 * ★ 用 `pathToFileURL` 而不是拼字符串：Windows 盘符路径不是合法 URL
 *   （`file://D:/…` 会被 ESM loader 拒绝，实测报 `ERR_UNSUPPORTED_ESM_URL_SCHEME`）。
 */
const PRELOAD_URL = pathToFileURL(join(GATE_DIR, 'preload.mjs')).href;

const GATES = [
  { id: 'G2', name: '协议对账', script: 'g2-protocol.mjs' },
  { id: 'G3', name: '常量对账', script: 'g3-propkeys.mjs' },
  { id: 'G5', name: '命名', script: 'g5-naming.mjs' },
  { id: 'G6', name: '红线扫描', script: 'g6-redline.mjs' },
  { id: 'G12', name: '路径与改名', script: 'check-paths.mjs' },
  { id: 'G13', name: '依赖方向', script: 'g13-deps.mjs' },
  { id: 'G14', name: '前端依赖图', script: 'g14-webgraph.mjs' },
  { id: 'G15', name: '文档引用', script: 'g15-docrefs.mjs' },
  { id: 'G16', name: '文档内部引用', script: 'g16-docsrefs.mjs' },
  { id: 'G17', name: '导出符号消费者', script: 'g17-exports.mjs' },
  { id: 'G18', name: '标识清单对账', script: 'g18-ids.mjs' },
  // ★ 2026-10-20（26 册 §76）：前端第一道**契约**闸门 —— 后端有 G2/G3 管协议与键，
  //   而前端从包里读什么键此前无人核对（G14 只管依赖图）。
  { id: 'G19', name: '前端包字段对账', script: 'g19-frontend-contract.mjs' },
];

/**
 * ★ 本目录里**不是闸门**的 .mjs（白名单，逐条说明为什么）：
 *   lib.mjs           —— 公共库，被各闸门 import
 *   preload.mjs       —— 崩溃守卫的预载（由本文件用 `--import` 挂上），不是闸门
 *   docs-index.mjs    —— 文档册索引，被 G15/G16 import（同上）
 *   mutation-test.mjs —— 元闸门，**不能**由 run-all 调用：它自己 spawn 各闸门 ×2 遍，
 *                        跑一次约 10 分钟，属于 `npm run gate:mutation` 的活
 *   run-all.mjs       —— 本文件
 */
const NOT_A_GATE = new Set(['lib.mjs', 'docs-index.mjs', 'preload.mjs', 'mutation-test.mjs', 'run-all.mjs']);

/**
 * ── 未登记闸门自检 ───────────────────────────────────────────────────────────
 * ★ 为什么这条自检本身值得存在：`GATES` 是**手写清单**，而闸门文件是**磁盘上的事实**。
 *   两者之间没有任何约束 —— 新增 `g17-xxx.mjs` 却忘了登记，那个闸门**永远不会被执行**，
 *   而 `run-all` 照样打 `✅ 静态闸门全部通过`。
 *   这正是 24 册 FG-7「规则在、输入归零、日志仍绿」的**元层形态**：
 *   不是"规则没对象"，而是"规则没被调用"，两者的日志长得完全一样。
 *   ⇒ 用磁盘事实反查清单，让"忘记登记"变成一次当场失败，而不是一次安静的漏跑。
 * ★ 反面：为什么不改成"扫目录自动发现"？因为闸门的 id 与中文名写在各自脚本**内部**
 *   （`header('G15', …)`），要自动发现就得把元数据搬到目录名或另一个注册表里 ——
 *   那只是把"第二份清单"换个地方，并没有消灭它。显式清单 + 反查，代价最小。
 */
const registered = new Set(GATES.map((g) => g.script));
const orphans = readdirSync(GATE_DIR)
  .filter((f) => f.endsWith('.mjs') && !registered.has(f) && !NOT_A_GATE.has(f))
  .sort();

/**
 * ── `--only=<子串>`（2026-10-19 补）──────────────────────────────────────────
 * ★ 30 册 §3.2 早就写着"`run-all.mjs` 支持 `--only=<子串>`"，可**代码里从来没有**
 *   （`grep argv tools/gate/run-all.mjs` 零命中）—— 文档替代码做了一个不成立的承诺。
 *   这是 33 册 §33.3 第 ③ 条「注释/文档也会撒谎」的同族：**承诺没被人跑过，就等于没有**。
 *   补上它，让那句话变成真的；同时保留它的**危险**：取证不许带过滤，所以一进来就大声声明
 *   （与 `mutation-test.mjs` 同款做法，两处口径一致）。
 */
const ONLY_ARG = process.argv.find((a) => a.startsWith('--only='));
const ONLY = ONLY_ARG === undefined ? '' : ONLY_ARG.slice('--only='.length);
const SELECTED =
  ONLY === '' ? GATES : GATES.filter((g) => `${g.id} ${g.name} ${g.script}`.includes(ONLY));

if (SELECTED.length === 0) {
  console.log(`❌ --only=${ONLY} 没有匹配到任何闸门`);
  console.log(`   现有：${GATES.map((g) => `${g.id}(${g.name})`).join(' / ')}`);
  process.exit(EXIT_FAIL);
}

if (orphans.length > 0) {
  console.log('='.repeat(64));
  console.log('❌ 有闸门脚本**没有登记**进 run-all.mjs 的 GATES 清单');
  console.log('='.repeat(64));
  for (const f of orphans) console.log(`   tools/gate/${f}`);
  console.log('');
  console.log('   没登记的闸门**永远不会被执行**，而本文件仍会打"全部通过" ——');
  console.log('   那是 FG-7 的元层形态（规则在、没人调用、日志全绿）。');
  console.log('   要么把它加进 GATES，要么把它加进 NOT_A_GATE 并写明理由。');
  process.exit(EXIT_FAIL);
}

console.log('='.repeat(64));
console.log(`闸门套件  |  项目根 ${ROOT}`);
console.log(`          |  目录名 ${PROJECT_NAME}（运行时读取）`);
console.log('='.repeat(64));
if (ONLY !== '') {
  console.log('');
  console.log(`⚠️  --only=${ONLY}：本次只跑 ${SELECTED.length}/${GATES.length} 道闸门。`);
  console.log('    **这不是全量结论，不能当通过证据**（30 册 §3.2：取证不许带 --only）。');
}

const results = [];
for (const g of SELECTED) {
  console.log('');
  // ★ 必须带 --import preload：否则「闸门 import 的模块有语法错误」会在守卫安装**之前**
  //   以 exit 1 结束，与发现违规同码且**零输出**（2026-10-19 实测踩过）。
  const r = spawnSync(process.execPath, ['--import', PRELOAD_URL, join(GATE_DIR, g.script)], {
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

const passed = results.filter((r) => r.code === EXIT_PASS);
const failed = results.filter((r) => r.code === EXIT_FAIL);
const crashed = results.filter((r) => r.code === EXIT_CRASH);
const skipped = results.filter((r) => r.code === EXIT_SKIP);
const broken = results.filter((r) => r.code === -1);

if (crashed.length > 0) {
  console.log(
    `💥 有闸门**自身崩溃**（不是"发现违规"，堆栈见上方各闸门自己的输出）：` +
      `${crashed.map((c) => c.id).join(', ')}`,
  );
}
if (broken.length > 0) {
  console.log(`⚠️  有闸门**根本没启动起来**（环境问题，不是发现违规）：${broken.map((b) => b.id).join(', ')}`);
}
if (failed.length > 0) {
  console.log(
    `❌ 静态闸门未通过：${failed
      .map((f) => `${f.id}${f.code === EXIT_CRASH ? '(崩溃)' : ''}`)
      .join(', ')}`,
  );
  process.exit(EXIT_FAIL);
}

/**
 * ★★ SKIP **也是未通过**（2026-10-19 修）。
 *
 * 修之前这里只打一行 ⚠️ 警告，然后照样 `✅ 静态闸门全部通过` + `exit 0` ——
 * 而 24 册 §5.1 写的是"SKIP **不计入通过**"。于是那句话只发生在**显示层**：
 * 调用方（`npm run check`、CI、以及只看最后一行的读者）看到的仍是绿的。
 *
 * 现成的例子就在 G2：`src/` 不在时它 `EXIT_SKIP` 跳过"前端 handler ↔ 服务端包类型"那一半对账
 * （`g2-protocol.mjs` 最后一行），而那是 G2 最贵的一半。
 * "跳过"与"查过且没问题"必须可区分 —— 这是本项目从 FG 家族里反复学到的一条，
 * 那就得让它在**退出码**上成立，不能只靠人去读警告。
 *
 * ⇒ 判据：**只有全部 PASS 才允许 exit 0**；SKIP 归入"未通过"并单列。
 */
if (skipped.length > 0) {
  console.log(
    `❌ 有 ${skipped.length} 项 **SKIP**（前置条件未满足 ⇒ 那部分**没被检查**，不计为通过）：` +
      `${skipped.map((s) => s.id).join(', ')}`,
  );
  console.log('    —— 若这是"目录还没建 / 依赖还没装"，请补齐后再跑；补齐前不要把它当通过证据。');
  process.exit(EXIT_FAIL);
}

if (ONLY !== '') {
  console.log(`⚠️  --only 过滤模式：${passed.length}/${GATES.length} 道通过；**其余 ${GATES.length - passed.length} 道本次没跑**。`);
  process.exit(EXIT_PASS);
}
console.log(`✅ 静态闸门全部通过（${passed.length}/${results.length}，无 SKIP）`);
process.exit(EXIT_PASS);

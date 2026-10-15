#!/usr/bin/env node
/**
 * G2 · 协议对账闸门
 * ============================================================================
 *   G2.1 SERVER_PACKET_TYPES 内不得有重复条目
 *   G2.2 每个服务端包类型都应有 zod schema（**脚手架期告警，不失败**）
 *   G2.3 前端 handler 注册表 ↔ 服务端包类型 双向差集必须为空
 *        （src/ 尚未建立时 SKIP，绝不算"通过"）
 *   G2.8 服务端**实际发送点** ↔ `SERVER_PACKET_TYPES` 双向对账（★ 26 册 §26 / T19）
 *
 * ── ★ G2.8 为什么叫 8 而不是 4（编号漂移，别改回去）─────────────────────────
 *   26 册 §16 的 T19 条目写的是"G2 补 **G2.4**"。那条建议写在 2026-10-11，
 *   而 **G2.4–G2.7 已经被 `tests/protocol.test.ts` 占用**（信封版本协商 / 未知字段 /
 *   schema 覆盖率 / schema 与类型一致）。G2 是一个**跨文件的编号空间**
 *   （脚本占 G2.1–G2.3、测试占 G2.4–G2.7），所以本条顺延为 **G2.8**。
 *   ⇒ 教训与 §25.2.1 同族：**拿旧条目动手前先看当下代码**。
 *
 * ── ★ 为什么 G2.8 要锚定在 `packet(` 调用体内 ──────────────────────────────
 *   最省事的写法是"扫全文的 `type: 'x'`"。那是**假红工厂**：内容层完全可能合法地
 *   写 `{ type: 'npc' }` 这类数据字段，一命中就报"发出了未声明的包"。
 *   假红比漏报更糟 —— 它挡不住真问题，还会逼人把闸门关掉（见 24 册 §5.3）。
 *   所以只认**协议帧的构造点**：`packet({ ... type: 'x' ... })`。
 *
 * ── ★ G2.8 的死规则守卫（FG-7）────────────────────────────────────────────
 *   扫描目录与判定范围必须分开声明，并且"**一个文件都没扫到**"要判**失败**，
 *   不能报"通过" —— 否则规则会变成"永远匹配不到任何东西却一直绿"的空白。
 *   样本见 `mutation-test.mjs` 的「G2 死规则守卫」。
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

installCrashGuard('G2');

const protoFile = join(ROOT, 'shared', 'protocol.ts');
if (!exists(protoFile)) {
  header('G2', '协议对账');
  console.log('  ❌ shared/protocol.ts 不存在');
  process.exit(EXIT_FAIL);
}

const text = readText(protoFile);

const listBlock = /SERVER_PACKET_TYPES\s*=\s*\[([\s\S]*?)\]\s*as const/.exec(text);
const types = listBlock?.[1]
  ? [...listBlock[1].matchAll(/'([^']+)'|"([^"]+)"/g)]
      .map((m) => m[1] ?? m[2])
      .filter((x) => x !== undefined)
  : [];

const schemasBlock = /SERVER_PACKET_SCHEMAS[\s\S]*?=\s*\{([\s\S]*?)\n\};/.exec(text);
const schemaKeys = schemasBlock?.[1]
  ? [...schemasBlock[1].matchAll(/^ {2}([A-Za-z_][A-Za-z0-9_]*):/gm)].map((m) => m[1])
  : [];

const violations = [];

const seen = new Set();
for (const t of types) {
  if (seen.has(t)) {
    violations.push({ rule: 'G2.1', where: 'shared/protocol.ts', message: `包类型重复：${t}` });
  }
  seen.add(t);
}

const missing = types.filter((t) => !schemaKeys.includes(t));

// ---- 前端 handler 对账 ----
const srcProcess = join(ROOT, 'src', 'process');
let frontStatus = null;
if (!isDir(join(ROOT, 'src'))) {
  frontStatus = { skipped: true, reason: 'src/ 尚未建立（前端骨架属阶段 0-1）' };
} else if (!isDir(srcProcess)) {
  frontStatus = { skipped: true, reason: 'src/process/ 尚未建立' };
} else {
  const handlers = new Set();
  for (const f of walk(srcProcess, { exts: new Set(['.ts']) })) {
    // ★ 必须扫**剥离注释后**的代码：前端文档里会写 `registerHandler('类型')` 这种示例，
    //   按原文扫就会把它当成一次真注册 → 报"前端注册但服务端不存在的包：类型"。
    //   这是**假红**，而假红的后果比漏报更糟（挡不住真问题，还会逼人关掉闸门）。
    //   `readCode()` 本来就是为这件事准备的（见 lib.mjs 的注释）。
    const t = readCode(f).code.join('\n');
    for (const m of t.matchAll(/registerHandler\(\s*['"]([^'"]+)['"]/g)) handlers.add(m[1]);
    for (const m of t.matchAll(/case\s+['"]([^'"]+)['"]\s*:/g)) handlers.add(m[1]);
  }
  const onlyServer = types.filter((t) => !handlers.has(t));
  const onlyFront = [...handlers].filter((h) => !types.includes(h));
  frontStatus = { skipped: false, onlyServer, onlyFront, count: handlers.size };
  for (const t of onlyServer) {
    violations.push({ rule: 'G2.3', where: 'src/process', message: `服务端会发但前端无 handler：${t}` });
  }
  for (const h of onlyFront) {
    violations.push({ rule: 'G2.3', where: 'src/process', message: `前端注册但服务端不存在的包：${h}` });
  }
}

// ---- G2.8 服务端发送点 ↔ 声明类型（26 册 §26 / T19）----
// ★ 扫描范围（`dirs`）与判定范围分开声明：本规则只认"协议帧的构造点"，
//   不认文件里任何别的 `type:` 字段（那会造成假红）。

/** 服务端出站帧的构造代码在这两棵目录下 */
const PRODUCER_DIRS = ['server', 'world'];

/**
 * 收集一段**已剥注释**的源码里所有 `packet({ ... })` 调用体的 `type` 取值。
 *
 * 判据是"这个位置产出了一个协议帧"，所以必须从 `packet(` 起按括号配平取出实参，
 * 再在实参里找 `type:`。字符串字面量里的括号要跳过（否则 `'你(笑)'` 会打乱配平）。
 */
function packetTypesOf(code) {
  const out = [];
  const re = /\bpacket\s*\(/g;
  let m;
  while ((m = re.exec(code)) !== null) {
    const open = m.index + m[0].length - 1; // 指向 '('
    let depth = 0;
    let quote = null;
    let end = -1;
    for (let i = open; i < code.length; i += 1) {
      const c = code[i];
      if (quote !== null) {
        if (c === '\\') i += 1;
        else if (c === quote) quote = null;
        continue;
      }
      if (c === '"' || c === "'" || c === '`') {
        quote = c;
        continue;
      }
      if (c === '(') depth += 1;
      else if (c === ')') {
        depth -= 1;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    if (end === -1) continue;
    const body = code.slice(open + 1, end);
    const t = /\btype\s*:\s*['"]([^'"]+)['"]/.exec(body);
    if (t !== null) {
      const line = code.slice(0, m.index).split('\n').length;
      out.push({ type: t[1], line });
    }
  }
  return out;
}

const producerSites = [];
let scannedProducerFiles = 0;
for (const d of PRODUCER_DIRS) {
  const dir = join(ROOT, d);
  if (!isDir(dir)) continue;
  for (const f of walk(dir, { exts: new Set(['.ts']) })) {
    scannedProducerFiles += 1;
    const { code } = readCode(f);
    for (const hit of packetTypesOf(code.join('\n'))) {
      producerSites.push({ type: hit.type, where: `${rel(f)}:${hit.line}` });
    }
  }
}
const produced = new Set(producerSites.map((s) => s.type));

const ledgerBlock = /SERVER_PACKET_UNWIRED\s*=\s*\[([\s\S]*?)\]\s*as const/.exec(text);
const unwired = ledgerBlock?.[1]
  ? [...ledgerBlock[1].matchAll(/'([^']+)'|"([^"]+)"/g)]
      .map((mm) => mm[1] ?? mm[2])
      .filter((x) => x !== undefined)
  : [];

// (a) 生产者发出未声明的类型 —— 前端没有 handler，包会被静默丢掉
for (const t of produced) {
  if (types.includes(t)) continue;
  const sites = producerSites
    .filter((s) => s.type === t)
    .map((s) => s.where)
    .join(', ');
  violations.push({
    rule: 'G2.8',
    where: sites,
    message: `服务端发出未声明的包类型：${t}（前端不会有 handler，会被静默丢弃）`,
  });
}
// (b) 悬空声明：既没有生产者、又不在台账里
for (const t of types) {
  if (produced.has(t) || unwired.includes(t)) continue;
  violations.push({
    rule: 'G2.8',
    where: 'shared/protocol.ts',
    message: `悬空声明：${t} 既没有生产者、也不在 SERVER_PACKET_UNWIRED 台账里`,
  });
}
// (c) 账目过期：已经有生产者了，却还挂在台账上
for (const t of unwired) {
  if (!produced.has(t)) continue;
  violations.push({
    rule: 'G2.8',
    where: 'shared/protocol.ts',
    message: `台账过期：${t} 已经有生产者，请从 SERVER_PACKET_UNWIRED 里销账`,
  });
}
// (d) 台账里出现了不存在的包类型（拼错 / 删漏）
for (const t of unwired) {
  if (types.includes(t)) continue;
  violations.push({
    rule: 'G2.8',
    where: 'shared/protocol.ts',
    message: `台账里的名字不是声明过的包类型：${t}`,
  });
}
// (e) 台账自身重复（会让"记账 N 条"这个数字失真）
const ledgerSeen = new Set();
for (const t of unwired) {
  if (ledgerSeen.has(t)) {
    violations.push({ rule: 'G2.8', where: 'shared/protocol.ts', message: `台账重复条目：${t}` });
  }
  ledgerSeen.add(t);
}
// (f) ★ 死规则守卫（FG-7）：扫描目录一个文件都没扫到 ⇒ 该规则不可能变红，判**失败**
if (scannedProducerFiles === 0) {
  violations.push({
    rule: 'G2.8',
    where: `(${PRODUCER_DIRS.join(', ')})`,
    message: `死规则：扫描目录内没有任何 .ts 文件，该规则不可能变红`,
  });
}

header('G2', '协议对账', {
  服务端包类型: types.length,
  已登记schema: `${types.length - missing.length}/${types.length}`,
  前端handler: frontStatus.skipped ? '未建立' : `${frontStatus.count} 个`,
  服务端发送点: `${produced.size} 种 / 扫 ${scannedProducerFiles} 文件`,
  待接线台账: `${unwired.length} 种`,
});

if (missing.length > 0) {
  console.log(`  ⚠️  未登记 zod schema 的包（脚手架期允许，逐步补齐）：`);
  console.log(`       ${missing.join(', ')}`);
}
if (frontStatus.skipped) {
  console.log(`  ⏭️  前端 handler 对账 SKIP：${frontStatus.reason}`);
} else if (frontStatus.onlyServer.length === 0 && frontStatus.onlyFront.length === 0) {
  console.log('  ✅ 前后端包类型双向完全一致');
}

// ★ 把三方关系打印出来：`发送点 + 台账 = 声明`。这一行就是"人手写计数会漂"的解药
//   （00 册先后写过 6 → 8 → 10，见 26 册 §21.9）。
//   ★ 必须**如实算出和**再比：写成"10 + 24 = 35"这种固定句式会在账不平的时候骗人。
const reconciled = produced.size + unwired.length === types.length;
console.log(
  `  ${reconciled ? '✅' : '❌'} 出站对账：发送点 ${produced.size} 种 + 未接线台账 ${unwired.length} 种 = ${produced.size + unwired.length} 种（声明 ${types.length} 种）`,
);

if (violations.length === 0) {
  console.log('  ✅ 通过（无重复条目 · 出站发送点与台账一致）');
  // ★ 这里是 `EXIT_SKIP` 而不是字面量 `2`：虽然 G6 R6.7 的正则只认
  //   "`process.exit(` 后紧跟数字字面量"这一种形态（`cond ? 2 : x` 它抓不到），
  //   但**规则够不着**不等于**可以那样写**。R6.7 的这条窄口已记档
  //   （26 册 §27.5），别把它当成许可。
  process.exit(frontStatus.skipped ? EXIT_SKIP : EXIT_PASS);
}
process.exit(report(violations, { failText: '协议对账不一致' }));

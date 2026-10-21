#!/usr/bin/env node
/**
 * G19 · 前端读取的包字段（协议 schema ↔ 前端 handler）
 * ============================================================================
 * 规则：
 *   G19.1 前端 `registerHandler('<包>', (p) => …)` 里读的 `p['x']`，
 *         `x` 必须是该包 **schema 的顶层字段**（`SERVER_PACKET_SCHEMAS[<包>].shape`）。
 *
 * ── 为什么需要这一道（26 册 §76）────────────────────────────────────────────
 * 前端读服务端包**全是软访问**：`asString(p['desc'])`、`typeof x['hp'] === 'number' ? …`。
 * 键写错、或服务端改了字段名，**一行都不会红** —— 它只是安静地变成 `''` / `undefined`，
 * 界面上少一块东西，而所有测试与闸门照旧全绿。
 *
 * 这不是假设：`src/process/handlers/world.ts#asItems` 曾经只映射 `hp/max_hp`，
 * 把 `mp/max_mp` 丢了 —— 房间列表的**内力条一次都没画出来过**（26 册 §20.4）。
 * 那份代码的每一个字都"读起来对"，错的是**键与服务端不在同一张表上**。
 *
 * ⇒ 这是后端早就有一道、前端一道都没有的对账：
 *   后端有 `G2`（发送点 ↔ 声明 ↔ 台账）与 `G3`（常量键 ↔ 守卫），
 *   而前端**从协议里读什么键**，此前没有任何东西核对过（G14 只管依赖图）。
 *
 * ── 判据为什么落在"顶层字段"上 ─────────────────────────────────────────────
 *   · `p['items']` 这种是**包字段**，判得了、也不会漂；
 *   · `x['hp']`（数组元素、嵌套对象）判不了 —— 元素的形状在 schema 里是
 *     `z.array(z.object({…}))`，要递归下去才能取。**本闸门刻意不做递归**：
 *     嵌套层级一旦深，误报率会随深度上升，而误报会训练人忽略报警（26 册 §71.8.2）。
 *     ⇒ 已知窄口，写在这里而不是假装覆盖了。
 *
 * ── 反向不判 ───────────────────────────────────────────────────────────────
 *   "schema 有、前端没读"**不算违规**：`v` / `type` 这类信封字段人人都有，
 *   服务端为将来留的字段也不该逼前端立刻消费。只分析不报错（见 `--verbose`）。
 *
 * 退出码：0 通过 / 1 违规 / 3 崩溃（见 26 册 §27）
 */

import { join } from 'node:path';

import {
  EXIT_FAIL,
  EXIT_PASS,
  ROOT,
  header,
  installCrashGuard,
  readCode,
  report,
  walk,
} from './lib.mjs';

installCrashGuard('G19');

const VERBOSE = process.argv.includes('--verbose');

/** handler 目录（相对工程根） */
const HANDLER_DIR = 'src/process/handlers';

// ── ① 协议侧：每个包类型的顶层字段 ──────────────────────────────────────────
//
// ★ 这里**必须**读运行期 schema，不能像 G2 那样解析源码文本：
//   `z.object({...})` 的字段名是对象键，文本解析要处理嵌套/联合/`.extend` 继承，
//   而那正是"判据自己先漂了"的高发地带。`.shape` 是 zod 给出的**唯一事实**。
//
// ★★ 为什么这里要先注册 TS 钩子（别的闸门都不这么做）：
//   `tools/gate/preload.mjs` 只装**崩溃守卫**，**不装 ts-loader** —— 所以闸门脚本
//   平时 `import` 不到 `.ts`。而 schema 是运行期的 zod 对象，文本解析不出来。
//   ⇒ 这一道是**唯一**需要真加载 TS 的闸门：成本是加载 `protocol.ts → constants.ts`，
//   两者都只依赖 zod，几十毫秒。
const { registerTsHooks } = await import('../dev/ts-loader.ts');
registerTsHooks();

const protocol = await import('../../shared/protocol.js');
const { SERVER_PACKET_SCHEMAS: SCHEMAS, SERVER_PACKET_TYPES: TYPES } = protocol;

/** 包类型 → 顶层字段集合 */
const fieldsOf = new Map();
for (const t of TYPES) {
  const shape = SCHEMAS[t]?.shape;
  // ★ 取不到 shape 不是"这个包没有字段"，而是**schema 写坏了**（不是 z.object）
  if (shape === undefined || shape === null) {
    header('G19', '前端读取的包字段');
    process.stdout.write(`\n  ❌ ${t} 的 schema 没有 .shape —— 它必须是一个 z.object\n`);
    process.exit(EXIT_FAIL);
  }
  fieldsOf.set(t, new Set(Object.keys(shape)));
}

// ── ② 前端侧：每个 handler 读了哪些键 ───────────────────────────────────────

/**
 * 把一个 handler 文件切成 `[包类型, 块文本]`。
 *
 * ★ 只收**内联实现**：`registerHandler('x', (p) => …)` / `('x', function …)`。
 *   `registerHandler('dispfm', cooldown('dispfm'))` 这种**共享工厂**跳过 ——
 *   函数体在别处、被四个包共用，硬算归属只会冤枉其中一个（实测就这么冤枉过
 *   `perform`：`cooldown()` 的 `p['count']` 被算到了它头上）。
 *
 * ★ 块尾 = 下一个 `registerHandler(` **或**下一个顶层 `function` 声明，取更近的那个。
 *   不截 `function` 的话，handler 后面紧跟的辅助函数会把字段倒灌回来（同上）。
 *   代价：handler 体内部若在顶层位置写了具名函数会提前截断 —— 当前零处，且那种写法
 *   本来也不该出现在 handler 里。
 */
function splitHandlers(code) {
  const out = [];
  // ★ 包类型是**驼峰**（`addAction` / `clearDistime` / `changepfm`）——
  //   第一版写成 `[a-z][a-z0-9]*`，于是这三个 handler 根本没被算进去，
  //   上一个 handler 的块一路吞到 `p['id']`，报出一条**假红**。
  const re = /registerHandler\(\s*['"]([a-zA-Z][a-zA-Z0-9]*)['"]\s*,\s*(?:\(|function\b)/g;
  const hits = [];
  let m;
  while ((m = re.exec(code)) !== null) hits.push({ type: m[1], at: m.index });
  const fnRe = /^function\s/gm;
  const fnAt = [];
  while ((m = fnRe.exec(code)) !== null) fnAt.push(m.index);
  for (let i = 0; i < hits.length; i += 1) {
    const start = hits[i].at;
    const nextHandler = i + 1 < hits.length ? hits[i + 1].at : code.length;
    const nextFn = fnAt.find((at) => at > start) ?? code.length;
    const end = Math.min(nextHandler, nextFn);
    out.push({ type: hits[i].type, body: code.slice(start, end) });
  }
  return out;
}

/** 块里读的 `p['x']`（只认字面量键；`p[k]` 这种动态键判不了，跳过） */
function readKeys(body) {
  const keys = new Set();
  const re = /\bp\[\s*['"]([a-zA-Z_][a-zA-Z0-9_]*)['"]\s*\]/g;
  let m;
  while ((m = re.exec(body)) !== null) keys.add(m[1]);
  return keys;
}

const violations = [];
const scanned = [];

const files = walk(join(ROOT, HANDLER_DIR)).filter((f) => f.endsWith('.ts'));
for (const file of files.sort()) {
  // ★ `readCode` 返回 `{ raw, code }`，两者都是**行数组**（行号 = 下标 + 1）——
  //   不是字符串。第一版直接当字符串用，`splitHandlers` 收到一个对象 ⇒ 静默 0 个 handler。
  const { code: lines } = readCode(file);
  const code = lines.join('\n');
  for (const { type, body } of splitHandlers(code)) {
    const known = fieldsOf.get(type);
    if (known === undefined) {
      // 注册了一个协议里没有的包 —— 那是 G2 的领域（双向对账），这里只记一笔
      violations.push({
        rule: 'G19.2',
        where: file,
        message: `handler 注册了协议里不存在的包类型 ${JSON.stringify(type)}（G2 应已拦下）`,
      });
      continue;
    }
    const keys = readKeys(body);
    scanned.push({ type, file, keys: [...keys] });
    for (const key of [...keys].sort()) {
      if (!known.has(key)) {
        violations.push({
          rule: 'G19.1',
          where: `${file} · ${type}`,
          message:
            `包 ${JSON.stringify(type)} 读了 p['${key}']，但 schema 里的顶层字段是 ` +
            `[${[...known].sort().join(', ')}] —— 键写错了，或服务端改字段时前端没跟`,
        });
      }
    }
  }
}

// ── ③ 输出 ──────────────────────────────────────────────────────────────────

header('G19', '前端读取的包字段（协议 schema ↔ handler）', {
  扫描: `${scanned.length} 个 handler`,
  包类型: `${TYPES.length} 个`,
});

if (VERBOSE) {
  process.stdout.write('\n  未读的包字段（只分析，不判红）：\n');
  for (const [t, fields] of [...fieldsOf].sort()) {
    const used = new Set(scanned.filter((s) => s.type === t).flatMap((s) => s.keys));
    const idle = [...fields].filter((f) => !used.has(f)).sort();
    if (idle.length > 0) process.stdout.write(`    ${t}: ${idle.join(', ')}\n`);
  }
}

// ★★ **覆盖数归零即失败**（FG-7 / 33 册铁律 4）：本闸门平时输出的违规数是 **0**，
//   于是"解析全废了"与"一切都对"在日志里长得**一模一样**。
//   这条守卫把"没有对象可判"变成一个**显式失败** —— 否则把 `registerHandler` 拼错一个字母，
//   整道闸门会永远绿灯，而它保护的东西一件也没被检查。
if (scanned.length === 0) {
  process.stdout.write(
    '\n  ❌ 一个 handler 都没解析出来 —— 覆盖数归零，这条规则此刻什么都没判（FG-7）\n' +
      `  期望至少扫到 ${HANDLER_DIR}/ 下的内联 handler；0 个说明解析器坏了或目录空了\n`,
  );
  process.exit(EXIT_FAIL);
}

const code = report(violations, {
  passText: `通过：${scanned.length} 个 handler 读取的每个键都是该包的顶层字段`,
  failText: '前端读了 schema 里不存在的字段',
});
process.exit(code === EXIT_PASS ? EXIT_PASS : EXIT_FAIL);

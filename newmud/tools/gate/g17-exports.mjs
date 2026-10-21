#!/usr/bin/env node
/**
 * G17 · 导出符号的消费者（公共契约 ↔ 实际引用）
 * ============================================================================
 * 规则：
 *   G17.1 **死代码**：某个 `export` 符号在扫描面内**一处引用都没有**（连本文件都不用它）
 *   G17.2 **假契约**：某个 `export` 符号**只在本文件内部使用**，外部零引用
 *
 * ── 为什么这条值得单独一道闸门 ──────────────────────────────────────────────
 * 24 册的 FG-7 讲的是「规则在、没人调用、日志仍绿」，它以**闸门规则**的形态被反复踩到。
 * 2026-10-19 做 G16 时发现了它在**代码**上的同一个形态：
 *   `docs-index.mjs` 导出了 `hasBook()`，全仓**零调用** —— 一段 4 行的残骸，
 *   而它长得像一个"G15 会用的东西"（注释里还写着「G15 只需要这一层」），
 *   于是任何读代码的人都会以为存在这条路径。**假契约比死代码更有害**：
 *   死代码只浪费行数；假契约会让后来者基于一个**不存在的调用点**做判断。
 *
 * `export` 在 ESM 里的语义就是"这是本模块对外的契约"。一个只有本文件在用的
 * `export` 是在说假话 —— 它把一个实现细节标注成了公开 API，让人不敢改。
 * 而真正"为了可测性而导出"的场景，应该由**测试真的去 import 它**来证明
 * （那时 external > 0，本闸门自动放行）—— 这正是本闸门要逼出来的动作。
 *
 * ── ★★ 它和 run-all 的「未登记闸门」自检是同一个病 ─────────────────────────
 * run-all 守的是：**闸门文件（磁盘事实）↔ `GATES` 清单（手写声明）**。
 * G17 守的是：**导出的符号（代码声明）↔ 引用它的代码（代码事实）**。
 * 两者都是"有人在纸上写了一句话，后来没人核对它是否还对"。
 * 这类判据的共性：**只在"有人新增"时才会红，平时永远绿** —— 所以它们必须
 * 拿变异样本自己证明"会红"，否则与装饰无异（FG-7 / 铁律 4）。
 *
 * ── 已知窄口（如实记档，不是许可）──────────────────────────────────────────
 *   · 判据是**词匹配**（`\bNAME\b`），但语料先经**两层剥离**：去注释（`readCode`）
 *     + 去字符串内容（`blankStrings`，保留模板里 `${…}` 的求值）。
 *     ★★ 这两层都是**被自己的样本打出来的**，不是设计时想到的：
 *       ① 第一版没去注释 ⇒ `hasBook` 逃掉了 —— 因为**本文件头部**为了解释这条规则，
 *          把 `hasBook` 写了两遍。闸门的注释把自己要抓的目标救了下来。
 *       ② 补了去注释后样本**仍然假绿** ⇒ 因为样本名写在 `mutation-test.mjs` 的
 *          **字符串**里，而 `readCode` 刻意保留字符串（G6/G12 要靠路径字面量）。
 *     ⇒ 连续两次同一个病：**判据的观察对象包含了判据自己的说明书**。
 *       教训不是"再补一个特例"，而是"G17 的语料必须只剩代码"。
 *       这条与 G16 用"反引号位置"、G15 用"code 里也有 ⇒ 是数据"是同一条纪律：
 *       **判据要落在位置上，不能落在这段文本长得像什么上。**
 *   · 剩下的失败方向是**漏报**（假绿）：除去注释与字符串后，仍然是"提到即算使用"。
 *     刻意选这个方向 —— 误报会让人把正当的导出删掉，漏报只是少抓一条。
 *   · 若某导出真的**只在字符串里**被动态引用（`import('./x.mjs').then(m => m[name])`），
 *     本闸门会误报。当前零处；真出现时把那一处写成显式 `import`，不要放宽判据。
 *   · 不识别 `export * from` / `export { x } from` / `export default`（**re-export 与默认导出**）。
 *     ★★ 实测（2026-10-19）：**`.mjs` 面零处**，但 **`.ts` 面有 4 处** ——
 *     `src/process/index.ts` / `server/world/define.ts` / `shared/protocol.ts` 各一条
 *     `export {…} from`，`vitest.config.ts` 一条 `export default`。
 *     本闸门只扫 `.mjs`，所以**看不见**它们。这是刻意的（`export {…} from` 的符号
 *     定义在**别处**，把它算成"这里定义的导出"会让归属变糊），但必须在窄口里写清。
 *     ★ 第一版这里写的是「当前一处都没有」—— **那是一句假断言**：`.ts` 里明明有 4 处，
 *       只是不在扫描面内。**把"我看不见"写成"不存在"**，正是 FG 家族的经典形态
 *       （判据的盲区被伪装成事实的空缺）。写完 20 分钟就被自己复核出来了。
 *   · 只扫 `.mjs`。★ `.ts` 侧"导出了但没人 import"**目前没有任何工具在管** ——
 *     这**不是**"tsc 的领域"（第一版这么写过，错）：tsc 能兜的是"import 了一个不存在的符号"，
 *     而 `noUnusedLocals` / `noUnusedParameters` **都不管导出符号**（导出即"可能被外部用"）。
 *     ⇒ 这是一块真空，属独立批次；且不能照搬本闸门的词匹配 —— `.ts` 里同名的
 *     字符串字面量 / 类型标注太多，必须做符号级分析。
 *   · **不放 SKIP 出口**：扫描面取不到不等于"没法判"，而等于**仓库坏了**
 *     （同 `docs-index.mjs#ok` 的理由 —— 出 SKIP 会让一次误删安静地变成"跳过"）。
 *
 * 退出码：0 通过 / 1 违规 / 3 崩溃（见 26 册 §27）
 */

import { join } from 'node:path';
import {
  EXIT_FAIL,
  EXIT_PASS,
  ROOT,
  SCAN_EXT,
  exists,
  header,
  installCrashGuard,
  isDir,
  readCode,
  rel,
  report,
  walk,
} from './lib.mjs';

installCrashGuard('G17');

/**
 * **定义面**：ESM `export` 目前只出现在 `tools/`（实测 `server/` `src/` `shared/`
 * `world/` `tests/` 全是 `.ts`，走 tsc 而非 node 直接加载）。
 * ★ 写整棵 `tools/` 而不是 `tools/gate/`：`tools/` 下此刻零导出（实测），
 *   所以放宽扫描面**不会**误伤；而将来谁在 `tools/` 里加了共享模块，它就自动被守。
 */
const DEF_PREFIX = 'tools/';

/**
 * **引用面**：一个导出可能被测试用（`tests/`）、被服务端用（`server/`）……
 * 少扫一个 root 就会把真实消费者漏掉 ⇒ **假红** ⇒ 有人会去删正当导出。
 * 所以这个清单必须显式、且每个 root 都要检查存在性（见下面的前置断言）。
 */
const USE_ROOTS = ['tools', 'tests', 'server', 'src', 'shared', 'world'];

/** `export function f` / `export const X` / `export class C` / `export async function g` */
const EXPORT_RE = /^export\s+(?:async\s+)?(?:function\s*\*?|const|let|var|class)\s+([A-Za-z_$][\w$]*)/;

const failures = [];
const counts = { G17_1: 0, G17_2: 0 };

// ── 前置断言：引用面必须完整 ────────────────────────────────────────────────
// ★ 这是本闸门**唯一的假红来源**：某个 root 被改名/搬走后 walk 返回空，
//   于是"外部引用"统计偏低，正当导出会被判成"没人用"。
//   ⇒ 宁可整体判失败并明确说出是哪个目录没了，也不要给出一批假红。
const missingRoots = USE_ROOTS.filter((r) => !isDir(join(ROOT, r)));
if (missingRoots.length > 0) {
  header('G17', '导出符号的消费者（公共契约 ↔ 实际引用）');
  console.log(`  ❌ 引用面不完整：${missingRoots.map((r) => `\`${r}/\``).join(' ')} 不存在（或不是目录）`);
  console.log('      —— 少扫一个 root 会把真实消费者漏掉（假红），故**判失败**而不是继续。');
  console.log('      （若某个 root 真的退役了，改本文件顶部的 USE_ROOTS 清单，不要放宽判据。）');
  process.exit(EXIT_FAIL);
}

// ── 读语料（一次全读进内存；引用面约 200 文件，量化成本可忽略）──────────────
/**
 * ★★ **必须去注释**（`readCode` 的 `code` 数组），这是第一版栽的地方：
 *   最初的实现用 `readText().split()` 建语料，结果 `hasBook` 这个真死代码**没被抓到** ——
 *   因为**本文件头部的注释里为了解释这条规则，把 `hasBook` 写了两遍**。
 *   闸门的注释把自己要抓的目标"救"了。这是 FG 形态里最讽刺的一种：
 *   **判据的观察对象包含了判据自己的说明书。**
 *   ⇒ 词匹配本身不够，必须叠一层"看不看注释"的位置判据（同 G16 用反引号位置判据的道理）。
 *
 * 保留 `raw` 只用于报错时回显原文（`code` 里的注释已被抹成空串，回显会残缺）。
 * @type {Map<string, {raw: string[], code: string[], isDefFile: boolean}>}
 */
const corpus = new Map();
for (const root of USE_ROOTS) {
  for (const abs of walk(join(ROOT, root), { exts: SCAN_EXT })) {
    const { raw, code } = readCode(abs);
    corpus.set(abs, {
      raw,
      // ★ 两层的第二层：去注释之后再去字符串（`blankStrings` 是函数声明，提升可用）
      code: code.map(blankStrings),
      isDefFile: rel(abs).startsWith(DEF_PREFIX) && abs.endsWith('.mjs'),
    });
  }
}

// ── 收集定义 ────────────────────────────────────────────────────────────────
/** @type {{name: string, file: string, line: number, lineText: string}[]} */
const defs = [];
for (const [file, { code, isDefFile }] of corpus) {
  if (!isDefFile) continue;
  code.forEach((lineText, i) => {
    const m = EXPORT_RE.exec(lineText);
    if (m === null) return;
    defs.push({ name: m[1] ?? '', file, line: i + 1, lineText });
  });
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * 把字符串字面量的**内容**抹成空格（长度保持，方便报错时对位）。
 * 保留模板字符串里的 `${…}`：那是真的求值，算使用。
 *
 * ★★ 为什么必须要这一层（本闸门第二次栽的地方，2026-10-19）：
 *   第一层修正是"去注释"（`readCode`），因为 `hasBook` 被写进了**本文件的注释**。
 *   修完之后样本仍然**假绿** —— 因为样本名里写着
 *   「加一个 `export const __mutNobodyUses = 1`」，而 `mutation-test.mjs`
 *   的那段说明是一个**字符串字面量**，`readCode` **刻意保留字符串**
 *   （G6/G12 需要路径字面量）。于是闸门又一次把它自己的说明书当成了调用点。
 *
 *   ⇒ 结论不是"再补一个特例"，而是：**G17 的语料必须只剩"代码"** ——
 *     注释不是代码，字符串里的名字也不是代码。两层都去掉才叫"代码里在用"。
 *   `readCode(p).code` 给第一层，本函数给第二层。
 */
function blankStrings(line) {
  return line.replace(/(['"`])(?:\\.|(?!\1)[^\\])*\1/g, (str) => {
    let out = '';
    let i = 0;
    while (i < str.length) {
      if (str[i] === '$' && str[i + 1] === '{') {
        const end = str.indexOf('}', i);
        if (end !== -1) {
          out += str.slice(i, end + 1);
          i = end + 1;
          continue;
        }
      }
      out += ' ';
      i += 1;
    }
    return out;
  });
}

// ── 逐个数引用 ──────────────────────────────────────────────────────────────
/** @type {{def: object, own: number, other: number}[]} */
const checked = [];
for (const def of defs) {
  const re = new RegExp(`(?<![\\w$])${escapeRe(def.name)}(?![\\w$])`, 'g');
  let own = 0;
  let other = 0;
  for (const [file, { code }] of corpus) {
    let hit = 0;
    for (const line of code) hit += line.match(re)?.length ?? 0;
    if (file === def.file) own += hit;
    else other += hit;
  }
  // ★ 扣掉"定义行自己那一次"。用**定义行内的实际出现次数**扣，而不是写死 1 ——
  //   否则 `export const A = A + 1` 这种自引用会被算成"内部有使用"从而漏报。
  own -= (def.lineText.match(re) ?? []).length;
  checked.push({ def, own, other });
}

for (const { def, own, other } of checked) {
  const at = `${rel(def.file)}:${def.line}`;
  const rawLine = (corpus.get(def.file)?.raw[def.line - 1] ?? '').trim();
  if (other === 0 && own === 0) {
    counts.G17_1 += 1;
    failures.push({
      rule: 'G17.1',
      where: at,
      message:
        `导出的 \`${def.name}\` 在扫描面内**一处引用都没有**（本文件也没用）—— 死代码\n` +
        `       ★ 直接删掉。若它其实是"准备给未来用"的，那正是 FG-7 的形态：` +
        `写了契约、没有调用点、日志永远绿，而后来者会以为存在这条路径\n` +
        `       ${rawLine}`,
    });
    continue;
  }
  if (other === 0) {
    counts.G17_2 += 1;
    failures.push({
      rule: 'G17.2',
      where: at,
      message:
        `导出的 \`${def.name}\` **只在本文件内部使用**（内部 ${own} 处，外部 0 处）—— 假契约\n` +
        `       ★ 两种正当修法：① 去掉 \`export\` 关键字（它是实现细节）` +
        ` ② 让真正该用它的地方去 import（比如给它补单测）\n` +
        `       ★ \`export\` 在 ESM 里就是"对外契约"的声明；只有本文件用却在导出，是在说假话\n` +
        `       ${rawLine}`,
    });
  }
}

const withExternal = checked.filter((c) => c.other > 0).length;
const scannedDefFiles = [...corpus.values()].filter((v) => v.isDefFile).length;

header('G17', '导出符号的消费者（公共契约 ↔ 实际引用）', {
  '引用面目录': USE_ROOTS.map((r) => `${r}/`).join(' '),
  '语料文件': corpus.size,
  '含导出的文件': scannedDefFiles,
  'export 符号总数': defs.length,
  'G17.1 死代码': counts.G17_1,
  'G17.2 假契约': counts.G17_2,
  '有外部消费者': withExternal,
});

// ── DEAD-RULE GUARD（24 册 FG-7：0 覆盖 = 死规则，必须判失败）───────────────
// ★ 三个数各自守着一种"解析静默失效"：
//   · `export 符号总数 = 0` —— `EXPORT_RE` 被写坏，或定义面定位错（谁把 gate 目录搬了）
//   · `含导出的文件 = 0` —— 同上，另一条通道
//   · `有外部消费者 = 0` —— ★★ **最要命的一条**：引用统计整体坏了（比如 corpus 只装了
//     定义文件、或正则永远匹配不上）时，**每个**导出都会同时被判成死代码 ——
//     那时日志会以"发现 30 条违规"的形式出现，看着像"仓库烂了"，其实是闸门烂了。
//     这一条把那种情况钉成"闸门自己坏了"。
if (defs.length === 0 || scannedDefFiles === 0 || withExternal === 0) {
  console.log(
    `  ❌ 死规则守卫：定义面 \`${DEF_PREFIX}\`、引用面 ${USE_ROOTS.length} 个 root；` +
      `解析出 ${defs.length} 个 export（分布 ${scannedDefFiles} 个文件），` +
      `其中**有外部消费者**的 ${withExternal} 个 —— 判失败`,
  );
  console.log(
    '      （导出数 0 = 解析器坏了；有外部消费者 0 = 引用统计坏了。' +
      '两者都会让"每个导出都是死代码"这种假红批量冒出来，见 24 册 FG-7）',
  );
  process.exit(EXIT_FAIL);
}

if (failures.length === 0) {
  // 走到这里 ⇒ G17.1/G17.2 都没命中 ⇒ 每个导出都有**外部**消费者（`withExternal === defs.length`）
  console.log(
    `  ✅ 通过：${defs.length} 个 export 符号**全部**被本文件之外的代码 import（无死代码、无假契约）`,
  );
  process.exit(EXIT_PASS);
}
process.exit(report(failures, { failText: '导出符号没有消费者（死代码 / 假契约）' }));

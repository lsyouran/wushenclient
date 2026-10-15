#!/usr/bin/env node
/**
 * G15 · 文档引用（**册号存在性**）
 * ============================================================================
 * 规则：
 *   G15.1 源码 / 测试**注释**里出现的 `NN 册` 必须在「实际存在的册号集合」内
 *   G15.2 源码 / 测试**注释**里出现的 `docs/NN`（含 `docs/wushen/NN`）同样必须指向真实册号
 *
 * ── ★ 为什么补 G15.2（2026-10-15，26 册 §36）─────────────────────────────────
 *   G15.1 只认 `NN 册` 这一种写法，而代码注释里**另一种同样常见的写法是路径**
 *   `docs/26-代码审查记录.md`。实测全仓有 **136 处** `docs/NN`（其中 109 处在注释里），
 *   在 G15.1 眼里**一处都看不见** —— 那是 FG-13 幽灵册号的**第二条通道**。
 *   ★ 判据与 G15.1 完全同构（同一份 `known` 集合、同一条"code 里也有 ⇒ 是数据"过滤），
 *     所以补它是**零新增概念**的覆盖扩展，不是新机制。
 *
 * ── 为什么要有这道闸门（26 册 §28.10 的实证）──────────────────────────────────
 * 本项目的文档册号有**两套**：**项目册**（`docs/` 下 `00 / 24 / 25 / 26 / 27`）
 * 与 **wushen 册**（`docs/wushen/` 下 `00`–`23`）。两者的并集**恰好是 `00`–`27`** ——
 * 于是 `28 册` 是一个"看着像存在、其实不存在"的号。
 * 而写注释的人**刚在 26 册里新开了 §28**（读作"第 28 节"），把**节号写成了册号**。
 *
 * ★★ 上面这段是**当时**的情形，**原文保留**（00 册纪律 1）。**2026-10-13 起它已消解**：
 *   新建了 `docs/28-存档与持久化设计.md`，`28` **进了册号空间**（本文件的册号集合是
 *   运行时从磁盘读的，所以**没有改一行代码它就自动生效了** —— 那正是"单源真相"的收益）。
 *   ⚠️ 但**别把这件事当成"问题解决了"**：幽灵号只是**换了位置**（下一个是 `29`）。
 *   连带的处理见 28 册 §28.10，其中最要紧的一条是：
 *   `mutation-test.mjs` 里证明"本规则会红"的样本**原本注入的就是 `28 册`** ——
 *   本册一建，那条样本就**失效**了（G15 放行 ⇒ 元闸门判"该规则无法证明会红"）。
 *   已把样本改用 `99`（两位号的极值，**不会被正常演进碰到**）⇒ 判据与册号空间解耦。
 *   ★ 教训：**任何"靠某个号不存在"的判据都是脆的**；判据要么锚在结构上，
 *     要么锚在一个不会被正常演进碰到的值上。
 *
 * FG-13 是同一个缺陷（T21 刚修掉 7 处指向 `docs/28` 的注释），当时的结论是
 * 「目前**没有任何闸门扫描文档引用**，这类漂移只能靠'改编号时全仓 grep 旧编号'
 * 这条人工纪律」—— 该纪律在**几小时后**就被**同一个人**违反了（26 册 §28.10）。
 * 本闸门把那句话变成机械判据。
 *
 * ── 册号集合**运行时从磁盘读** ──────────────────────────────────────────────
 * ★ 不许在脚本里再抄一份册号清单（铁律 4：单源真相）。
 *   新增一册（`docs/28-*.md`）后它**自动生效**，不需要改这里。
 *
 * ── ★★ 判据只认「**只出现在注释里**」的册号引用 ────────────────────────────────
 * 实现方式：逐行比对 `raw` 与 `code`（`readCode()` 已把注释剥掉、**字符串留下**）——
 * 同一行里若 `code` 也含这段文本，说明它在**字符串字面量**里（那是数据，不是引用），
 * 于是不计。
 * 这与 G6 **R6.7**「只认语句位置的裸数字，不认字符串字面量里的同名文本」同族：
 * **判据要落在位置上，不能落在"文本长得像"上**。
 *
 * ★ **自指问题有两处**，各用一种**结构性**办法解决（都不引入行内豁免标记）：
 *   ① **变异样本**：注入文本在 `mutation-test.mjs` 里是**字符串**（模板字面量），
 *      按上面那条判据**天然不计** —— 它落在"`code` 里也有"的那一侧。
 *   ② **本文件自己**（规则的定义处）：它必须能**逐字**讨论所守的那个号（与 `docs/` 同理），
 *      所以 **G15 不扫自己**。豁免由 `import.meta.url` 推出（**自指**，不是写死文件名 ——
 *      改名、搬目录都跟随，也不存在"第二个文件偷偷豁免"的可能），并在表头打印供审计。
 *   对照：G12 不得不发明 `// g12-allow R1` 行内标记，是因为它扫的是**裸文本**、
 *   而且规则显示名自身就含被禁模式 —— 它没有可退的结构化位置。
 *
 * ── ★★ 不扫 `docs/` ──────────────────────────────────────────────────────────
 * 文档必须有能力**讨论**一个不存在的册号 —— 那正是缺陷记录本身：
 * 26 册 §28.10 与 24 册的 FG-13 行里都**明文写着**「28 册」。
 * 把 `docs/` 纳入扫描 = 当场假红，而**假红比漏报更伤**（它会消耗掉"闸门可信"这件事）。
 * 这条边界是刻意的，记在这里，免得后来者以为是漏了。
 *
 * ── ★ 已知窄口（**如实记档，不是许可**）──────────────────────────────────────
 * 只判**册号存在性**，**不判 `§节号` 是否真存在于该册**。
 * 不可机械化的原因是实的：`§` 引用常指向**非标题**的东西（`26 册 §16.4 F1` 的 `F1`、
 * `24 册 §5.3` 的表格行），且 `§28.10` 与 `§28.1` 存在前缀关系 ——
 * 机械解析会制造一批假红，那比现在的窄口更糟。
 *
 * 退出码：0 通过 / 1 违规 / 2 跳过（docs/ 不可达）/ 3 崩溃（闸门自身异常，见 26 册 §27）
 */

import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  EXIT_FAIL,
  EXIT_PASS,
  EXIT_SKIP,
  ROOT,
  header,
  installCrashGuard,
  isDir,
  readCode,
  rel,
  report,
  walk,
} from './lib.mjs';

installCrashGuard('G15');

/** ★ 规则**不判自己**（理由见头部）：路径自指推出，不写死文件名 */
const SELF = rel(fileURLToPath(import.meta.url));

/**
 * 文档目录是工程根的**兄弟目录**（`D:/ts-mud/{newmud,docs}`），
 * 所以这里必须向上走一层 —— 但仍**不写死任何目录名**：
 * 工程根名与册号都取自磁盘，改名/复制副本（见 24 册 §5.4 的 G12 实验）都跟随。
 */
const DOCS_DIR = join(ROOT, '..', 'docs');
const WUSHEN_DOCS_DIR = join(DOCS_DIR, 'wushen');

/** 扫哪里：本方声明（铁律 5），不与别的闸门共用一份清单 */
const SCAN_DIRS = ['server', 'shared', 'tests', 'src', 'tools', 'world'];

/** 文件名前缀的两位册号：`26-代码审查记录.md` → `26` */
const BOOK_NO_RE = /^(\d{2})-/;

/**
 * 册号引用 `NN 册`。
 * ★ 两侧的 `(?<!\d)` / `(?!\d)` 不是装饰：没有它，`123 册` 会被切出 `23 册`
 *   —— 一个"看起来很对"的假命中。
 */
const REF_RE = /(?<!\d)(\d{2}) 册(?!\d)/g;

/**
 * `docs/NN` / `docs/wushen/NN` 形态的册号引用（G15.2）。
 * ★ `(?<!\d)`/`(?!\d)` 与 G15.1 同理：没有它，`docs/123` 会被切出 `docs/12`。
 *   尾部允许 `-`（真实文件名是 `docs/26-代码审查记录.md`）。
 */
const DOCS_REF_RE = /(?<!\d)docs\/(?:wushen\/)?(\d{2})(?!\d)/g;

/** 从目录里的文件名前缀收集册号（读不到目录就返回空集，由调用方判前置） */
function bookNumbersOf(dir) {
  const out = new Set();
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    const m = BOOK_NO_RE.exec(name);
    if (m !== null) out.add(m[1]);
  }
  return out;
}

if (!isDir(DOCS_DIR)) {
  header('G15', '文档引用（册号存在性）');
  console.log(`  ⏭️  SKIP：文档目录不可达（${DOCS_DIR}）`);
  console.log('      —— 取不到册号集合就谈不上判据，比照 G2 的语义**不做结论**（SKIP 不计为通过）');
  process.exit(EXIT_SKIP);
}

const known = new Set([...bookNumbersOf(DOCS_DIR), ...bookNumbersOf(WUSHEN_DOCS_DIR)]);
const knownList = [...known].sort().join(' / ');

const violations = [];
let scanned = 0;
let refs = 0;
let docsRefs = 0;
const selfSkipped = [];

for (const dirName of SCAN_DIRS) {
  const dir = join(ROOT, dirName);
  if (!isDir(dir)) continue;
  for (const file of walk(dir)) {
    const relPath = rel(file);
    // ★ 规则不判自己（理由见头部）：本文件需要逐字讨论幽灵册号。
    if (relPath === SELF) {
      selfSkipped.push(relPath);
      continue;
    }
    scanned += 1;
    const { raw, code } = readCode(file);
    for (let i = 0; i < raw.length; i++) {
      const line = raw[i] ?? '';
      for (const m of line.matchAll(REF_RE)) {
        // ★ 见头部：同一行在 `code` 里也有 ⇒ 它在字符串字面量里 ⇒ 是数据不是引用。
        if ((code[i] ?? '').includes(m[0])) continue;
        refs += 1;
        if (known.has(m[1] ?? '')) continue;
        violations.push({
          rule: 'G15.1',
          where: `${rel(file)}:${i + 1}`,
          message:
            `引用了**不存在**的册号「${m[0]}」。存在的册号：${knownList}\n` +
            `       （项目册在 docs/，wushen 册在 docs/wushen/ —— 两套号并排存在，` +
            `写引用时**必须带册号**，光写 \`§N\` 是歧义）\n` +
            `       ${line.trim()}`,
        });
      }
      // G15.2 · `docs/NN` 形态（判据同 G15.1，只是正则不同）
      for (const m of line.matchAll(DOCS_REF_RE)) {
        if ((code[i] ?? '').includes(m[0])) continue;
        docsRefs += 1;
        if (known.has(m[1] ?? '')) continue;
        violations.push({
          rule: 'G15.2',
          where: `${rel(file)}:${i + 1}`,
          message:
            `引用了**不存在**的文档路径「${m[0]}」（\`docs/NN\` 形态）。存在的册号：${knownList}\n` +
            `       （G15.1 只认 \`NN 册\`；\`docs/NN\` 是同一个幽灵册号的第二条通道）\n` +
            `       ${line.trim()}`,
        });
      }
    }
  }
}

header('G15', '文档引用（册号存在性）', {
  扫描目录: SCAN_DIRS.join(' / '),
  扫描文件: scanned,
  自身豁免: selfSkipped.length > 0 ? selfSkipped.join(' / ') : '(无)',
  '注释里的册号引用（G15.1 `NN 册`）': refs,
  '注释里的文档路径引用（G15.2 `docs/NN`）': docsRefs,
  存在的册号: knownList,
});

// ── DEAD-RULE GUARD（24 册 FG-7：0 覆盖 = 死规则，必须判失败）───────────────
// ★ 为什么 `refs === 0` 也算失败：本规则的判据是**正则命中**，正则一旦写错
//   （或 `readCode` 的行为变了），命中数会**静默**变成 0 —— 那时打印的仍是
//   "✅ 通过"，而它其实什么都没判过。G6 的 R6.7 当初就是这样一条"永远绿"的规则。
//   把"没有对象可判"与"判过且没问题"分开，是本项目反复要求的事。
// ★ G15.2 同理：两条子规则各判一个覆盖数，任一条归零都说明**它**成了死规则。
if (scanned === 0 || refs === 0 || docsRefs === 0) {
  console.log(
    `  ❌ 死规则守卫：本次扫描 ${scanned} 个文件、` +
      `判到 ${refs} 条 \`NN 册\`、${docsRefs} 条 \`docs/NN\`（三者都不该为 0）—— 判失败`,
  );
  console.log(`      （扫描目录：${SCAN_DIRS.join(' / ')}。覆盖 0 = 该规则此刻是死的）`);
  process.exit(EXIT_FAIL);
}

if (violations.length === 0) {
  console.log(`  ✅ 通过：${scanned} 个文件、${refs} 条 \`NN 册\` + ${docsRefs} 条 \`docs/NN\` 引用全部指向真实存在的册`);
  process.exit(EXIT_PASS);
}
process.exit(report(violations, { failText: '引用了不存在的册号' }));

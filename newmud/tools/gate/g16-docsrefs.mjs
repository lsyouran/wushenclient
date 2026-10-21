#!/usr/bin/env node
/**
 * G16 · 文档内部引用（**册号 + 节号存在性**）
 * ============================================================================
 * 规则：
 *   G16.1 文档里写的 `NN 册` 必须指向**真实存在的册**
 *   G16.2 文档里写的 `docs/NN` / `docs/wushen/NN` 路径必须指向真实册号
 *   G16.3 **绑定式**节引用 `NN 册 §X`（册号与 `§` 紧邻、同属一个 token 串）
 *         必须在该册的标题里真的存在
 *   G16.4 `本册 §X` 必须在本册里真的存在
 *   G16.5 **00 册 §2 的册清单 ⊥ 磁盘上的册文件**（双向：漏登记的册 / 幽灵册行）
 *
 * ── 为什么 G15 明确"不扫 docs/"，而 G16 反过来只扫 docs/ ─────────────────────
 * G15 的头部写着：**不扫 `docs/`**，因为文档必须有能力**讨论**一个不存在的册号
 * （那正是缺陷记录本身，26 册 §28.10 与 24 册的 FG-13 行都明文写着「28 册」）。
 * 那条边界在 G15 的语义下是对的 —— G15 问的是"注释里这个号存不存在"。
 *
 * G16 问的是**另一个问题**：文档里那一句"见 X 册 §Y"**现在还能不能按图索骥找得到**。
 * 这正是 2026-10-19 那批真错（8 处，比如 27 册 §15.1 的现行口径表里引用着已被
 * §67 删除的 `[PROP.x]` 与已撤销的 G3.F）能活到被人工读出来的原因：
 * **文档层从来没有闸门**，而改代码那一批只改了自己那一册。
 *
 * 两册闸门的分工因此是**互补**的，不是重复：
 *   G15 = 代码 ↔ 册号的**出边**；G16 = 册 ↔ 册的**内部边**。
 *
 * ── ★★ 怎么处理"记录错误的那些行"（本闸门最关键的一条设计）────────────────
 * 26 册 §29.3 有一张表，逐行写着"`26 册 §5.3` 实为 `24 册 §5.3`"——
 * 那是**缺陷记录**，而 `26 册 §5.3` 这个写法**恰好就是**它要记的那个错。
 * 若机械判，记录错误的地方必然被判红（这是本册反复出现的 FG 形态）。
 *
 * ★ 解法**不是**"含某某关键词就豁免"（那种关键词表会随文案漂，且能被无意触发），
 *   而是**位置判据**：**行内代码 span（`…`）里的引用是"被引用/被展示的文本"，
 *   不是"断言某处存在"**。这与 G15 用"这一行在 `code` 里也有 ⇒ 是数据不是引用"
 *   是**同一条纪律**（判据落在位置上，不落在"文本长得像"上，见 G15 头部）。
 *   实测：26 册里全部 9 处"记录错引用"的行，被记录的错引用都写在反引号里。
 *
 *   代价（如实记档）：把一条真引用塞进反引号就能绕过本闸门。
 *   接受这个代价的理由是 —— 反引号在本文档集里的语义就是"这是字面量 / 是代码 / 是被引用的原文"，
 *   治理"有人滥用反引号"属于评审职责，不属于静态闸门（33 册 §33.10 的边界表）。
 *
 * ── ★★ 已知窄口（**如实记档，不是许可**）─────────────────────────────────────
 * **不判"裸 `§X`"**（前面没有册号的那种）。理由不是懒，是实测：
 * 全仓 `§` 引用 1790 处，其中 **906 处是裸引用**，而它们**并非**"本册自指"——
 *   24 册 §133 的「这正是 §29 要人来做的那一层」指的是 **26 册 §29**；
 *   26 册：8617 的「| §33.0 | 三条根因…」指的是 **33 册 §33.0**；
 *   26 册：1558 的「`docs/wushen/08` §8.2.2」指 wushen 08。
 * 若按"裸引用 = 本册"判，107 条假红里有 80 条来自这一个假设 ——
 * 那正是 2026-10-19 核对器 v1 翻车的原因（当时假红 32 条）。
 * ⇒ **归属不可判的地方就判"不可判"，不猜**。裸引用改由"引用必须带册号"这条
 *   人工纪律约束（33 册 §33.9 红牌），本闸门不越位。
 *
 * 其它窄口：
 *   · 只认标题（`#`–`######`）为节，不认正文里的 `1.` `2.` 列表
 *   · 只判 `NN 册 §X` 这种**册号在前**的绑定式。`§X（NN 册）` 这种后置括号写法不判
 *   · 不判跨册的"节号 vs 标题内容是否对题"（`§29.10` 存在但讲的是别的事，静态查不出）
 *
 * ── 册号/节号从哪来 ──────────────────────────────────────────────────────────
 * **不在这里再抄一份**（24 册铁律 4）：一律走 `docs-index.mjs`，与 G15 共用同一份。
 * 新增一册（`docs/NN-*.md`）后本闸门**自动生效**，无需改代码。
 * ★ 这里**不能写一个具体的未来册号**当例子 —— 第一版写的是"新增 `docs/` 下某个还没建的号
 *   后自动生效"，当场被 G15.2 判红。那是**规则判对了**：注释里出现的路径也是断言，
 *   拿一个不存在的号当例子就是在断言一个不存在的文件。改法是把例子写成 `NN`。
 *
 * 退出码：0 通过 / 1 违规 / 2 跳过（docs/ 不可达）/ 3 崩溃（闸门自身异常，见 26 册 §27）
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  EXIT_FAIL,
  EXIT_PASS,
  EXIT_SKIP,
  header,
  installCrashGuard,
  rel,
  report,
} from './lib.mjs';
import {
  BOOK_FILE_RE,
  DOCS_DIR,
  WUSHEN_DOCS_DIR,
  inInlineCode,
  loadDocsIndex,
  resolveBook,
} from './docs-index.mjs';

installCrashGuard('G16');

/** `NN 册` —— 两侧 `(?<!\d)`/`(?!\d)` 防止把 `123 册` 切成 `23 册`（同 G15） */
const BOOK_REF = /(?<!\d)(\d{2})\s*册/g;
/** `docs/NN` / `docs/wushen/NN` */
const DOCS_PATH_REF = /(?<!\d)docs\/(?:wushen\/)?(\d{2})(?!\d)/g;
/** ★ 绑定式：`NN 册 §X` 一体匹配 —— 归属**由正则结构决定**，不靠"就近猜" */
const BOUND_SEC_REF = /(?<!\d)(\d{2})\s*册\s*§\s*(\d+(?:\.\d+)*)/g;
/** 显式自指：`本册 §X` */
const SELF_SEC_REF = /本册\s*§\s*(\d+(?:\.\d+)*)/g;

const index = loadDocsIndex();
if (!index.ok) {
  header('G16', '文档内部引用（册号 + 节号存在性）');
  console.log(`  ⏭️  SKIP：文档目录不可达或为空（${DOCS_DIR}）`);
  console.log('      —— 取不到册与节，就谈不上判据，**不做结论**（SKIP 不计为通过，同 G15）');
  process.exit(EXIT_SKIP);
}

/**
 * 扫哪里：本方声明（铁律 5）。
 * ★ 两套都扫，但**各自按自己那一套优先解析**（`resolveBook` 的 prefer）——
 *   否则 wushen 册里的 `00 册` 会解析到项目 00 册，制造一批假红。
 */
const SCAN = [
  { dir: DOCS_DIR, scope: 'project' },
  { dir: WUSHEN_DOCS_DIR, scope: 'wushen' },
];

const violations = [];
const counts = { G16_1: 0, G16_2: 0, G16_3: 0, G16_4: 0, G16_5: 0 };
/**
 * ★ 被"反引号 = 展示"豁免掉的条数，**必须打印出来**。
 * 豁免是闸门的黑洞：藏起来的豁免和删掉的规则一样危险 —— 所以它的规模要能被一眼看到。
 * （若某天它涨到与 counts 同量级，"反引号"就不再是"少量特例"，判据该重新设计。）
 */
const exempt = { G16_1: 0, G16_3: 0, G16_4: 0 };
let scanned = 0;

for (const { dir, scope } of SCAN) {
  let names;
  try {
    names = readdirSync(dir);
  } catch {
    continue;
  }
  for (const name of names.sort()) {
    if (!name.endsWith('.md')) continue;
    const file = join(dir, name);
    const lines = readFileSync(file, 'utf8').split(/\r?\n/);
    scanned += 1;
    /** 本文件所属的那一册（用于 `本册 §X`）；非册文件（README）为 null */
    const selfNo = /^(\d{2})-/.exec(name)?.[1] ?? null;
    const selfBook = selfNo === null ? undefined : resolveBook(index, selfNo);

    lines.forEach((line, i) => {
      const at = `${rel(file)}:${i + 1}`;
      const quoted = (pos) => inInlineCode(line, pos);

      // ── G16.1 册号存在性 ──────────────────────────────────────────────────
      for (const m of line.matchAll(BOOK_REF)) {
        const no = m[1] ?? '';
        if (quoted(m.index)) { exempt.G16_1 += 1; continue; } // 展示性引用（见头部）
        counts.G16_1 += 1;
        if (resolveBook(index, no) !== undefined) continue;
        violations.push({
          rule: 'G16.1',
          where: at,
          message:
            `引用了**不存在**的册号「${m[0]}」。存在的册号：${index.knownList}\n` +
            `       ★ 若这是在**记录一个错误**（"某某写成了 X 册"），请把它放进反引号里 —— ` +
            `反引号 = 被引用的原文，判据只认反引号外的那部分\n` +
            `       ${line.trim()}`,
        });
      }

      // ── G16.2 文档路径存在性 ──────────────────────────────────────────────
      // ★ **本子规则不用反引号豁免**，与 G16.1/G16.3 有意不对称。理由（实测，2026-10-19）：
      //   全仓 `docs/NN` 引用 **95 条，95 条都在反引号里**，且**全部有效** ——
      //   因为路径是**标识符**，"写路径"的默认写法就是反引号，反引号不改变"它指向哪里"。
      //   而 `NN 册 §X` 不同：被反引号包住的 `26 册 §5.3` 实例里，9/9 都是
      //   **被记录的错引用**（26 册 §29.3 那张表），那里反引号**确实**改变了语义。
      //   ⇒ 若这里也豁免，G16.2 的覆盖数当场归零（死规则守卫会判失败）——
      //     那等于"为了不误判，把规则删了"。不对称是有据的，不是随手。
      for (const m of line.matchAll(DOCS_PATH_REF)) {
        const no = m[1] ?? '';
        counts.G16_2 += 1;
        if (resolveBook(index, no) !== undefined) continue;
        violations.push({
          rule: 'G16.2',
          where: at,
          message:
            `引用了**不存在**的文档路径「${m[0]}」（\`docs/NN\` 形态）。存在的册号：${index.knownList}\n` +
            `       （G16.1 只认 \`NN 册\`；\`docs/NN\` 是同一个幽灵号的第二条通道，同 G15.2 的理由）\n` +
            `       ${line.trim()}`,
        });
      }

      // ── G16.3 绑定式节号存在性 ────────────────────────────────────────────
      for (const m of line.matchAll(BOUND_SEC_REF)) {
        const no = m[1] ?? '';
        const sec = m[2] ?? '';
        counts.G16_3 += 1;
        // ★ 先判"报价"再判对错：被反引号包住的整段（含册号）是展示，不是断言。
        //   `§` 的位置比 match 起点靠后，用 match 起点判即可（同一 token 串内）。
        if (quoted(m.index)) { exempt.G16_3 += 1; continue; }
        const book = resolveBook(index, no);
        if (book === undefined) {
          // 册号本身不存在 —— 归 G16.1 报（同一行会重复，所以这里只记账不重复报）
          continue;
        }
        if (book.sections.has(sec)) continue;
        violations.push({
          rule: 'G16.3',
          where: at,
          message:
            `「${m[0]}」引用的节号在该册里**不存在**（${book.scope === 'wushen' ? 'wushen' : '项目'}册 ` +
            `\`${rel(book.file)}\`，共 ${book.sections.size} 个节号）\n` +
            `       ★ 两种可能：① 节号写错了 ② 该节后来被改名/合并/删除，引用没跟着改\n` +
            `       ★ 若这是在**记录错误**，把整段放进反引号里\n` +
            `       ${line.trim()}`,
        });
      }

      // ── G16.4 显式自指 `本册 §X` ──────────────────────────────────────────
      for (const m of line.matchAll(SELF_SEC_REF)) {
        const sec = m[1] ?? '';
        counts.G16_4 += 1;
        if (quoted(m.index)) { exempt.G16_4 += 1; continue; }
        if (selfBook === undefined) continue; // 非册文件里写"本册"无从判
        if (selfBook.sections.has(sec)) continue;
        violations.push({
          rule: 'G16.4',
          where: at,
          message:
            `「${m[0]}」在本册里**不存在**（\`${rel(selfBook.file)}\`，共 ${selfBook.sections.size} 个节号）\n` +
            `       ${line.trim()}`,
        });
      }
    });
  }
}

// ── G16.5 00 册 §2 的册清单 ⊥ 磁盘上的册文件 ────────────────────────────────
// ★ 为什么它属于本闸门而不是新开一道：G16 问的是"引用指向的东西存在吗"，
//   G16.5 问的是"存在的东西被登记了吗"—— 方向相反，但**同一对集合**
//   （册号集合 ↔ 磁盘事实），而且都要走 `docs-index.mjs`。分两道就要各自
//   再解析一次册清单，那是 24 册铁律 4 的第二份真相。
//
// ★ 它和 run-all 的「未登记闸门」自检、G17 的「导出有没有消费者」是同一个病：
//   **手写的清单 vs 磁盘上的事实，两者之间没有任何约束**。
//   00 册 §2 那张表是 `docs/` 的唯一入口，新增一册却忘了登记 ⇒ 那册在索引里
//   等于不存在，而所有闸门照样全绿。2026-10-19 实测：11 行表格与 11 个文件
//   **恰好**相等 —— 那是巧合，不是机制。
//
// ★ 判据收得很窄：只判"册号集合相等"，**不判标题、不判职责、不判状态**。
//   那些是人写的判断，机械判会立刻假红（同 33 册 §33.10 的边界表）。
const INDEX_ROW_RE = /^\|\s*\*\*(\d{2})\*\*\s*\|/;
const indexBook = index.project.get('00');
if (indexBook !== undefined) {
  const listed = new Set();
  for (const line of readFileSync(indexBook.file, 'utf8').split(/\r?\n/)) {
    const m = INDEX_ROW_RE.exec(line);
    if (m !== null) listed.add(m[1] ?? '');
  }
  // 覆盖数 = 登记行数（死规则守卫靠它判断"那张表还在不在"）
  counts.G16_5 = listed.size;
  // ★ 磁盘事实取 `readdirSync` 而不是 `index.project.keys()`：后者是"读成功了的册"，
  //   与"磁盘上有这册"不是一回事（某个文件读不了时会静默缺席，然后被误判成"行是残留"）。
  const onDisk = new Set(
    readdirSync(DOCS_DIR)
      .map((n) => BOOK_FILE_RE.exec(n)?.[1])
      .filter((no) => no !== undefined),
  );
  for (const no of [...onDisk].sort()) {
    if (listed.has(no)) continue;
    violations.push({
      rule: 'G16.5',
      where: rel(indexBook.file),
      message:
        `磁盘上有 \`${no}-*.md\`，但 00 册 §2 的册清单里**没有登记**它\n` +
        `       ★ 00 册是 \`docs/\` 的唯一入口：没登记 = 在这套文档里等于不存在，` +
        `而所有闸门照样全绿\n` +
        `       ★ 修法：往 §2 的表格里补一行（标题 / 状态 / 职责 / 什么时候读）`,
    });
  }
  for (const no of [...listed].sort()) {
    if (onDisk.has(no)) continue;
    violations.push({
      rule: 'G16.5',
      where: rel(indexBook.file),
      message:
        `00 册 §2 登记了 \`${no}\` 册，但磁盘上**没有** \`${no}-*.md\`\n` +
        `       ★ 两种可能：① 行是残留（该册被删/改名了）② 册号写错了\n` +
        `       （G16.1 只判"正文里引用了一个不存在的册号"，管不到索引表自己）`,
    });
  }
}

header('G16', '文档内部引用（册号 + 节号存在性）', {
  扫描文件: scanned,
  '项目册': index.project.size,
  'wushen 册': index.wushen.size,
  'G16.1 册号引用': counts.G16_1,
  'G16.2 文档路径引用': counts.G16_2,
  'G16.3 绑定式节引用': counts.G16_3,
  'G16.4 本册自指': counts.G16_4,
  'G16.5 00 册登记行': counts.G16_5,
  '反引号内豁免（展示性引用）': `G16.1=${exempt.G16_1} / G16.3=${exempt.G16_3} / G16.4=${exempt.G16_4}`,
});

// ── DEAD-RULE GUARD（24 册 FG-7：0 覆盖 = 死规则，必须判失败）───────────────
// ★ 四条子规则各判一个覆盖数：正则一旦被写坏、或解析器行为变了，命中数会**静默归零**，
//   而那时打印的仍是"✅ 通过" —— 它其实一条都没判过。
// ★ 若某条真的因为"这种写法在文档里消失了"而归零，正确动作是**回来这里判断**：
//   是留（并补一处正当引用）还是删（连同本闸门的这段规则一起删），
//   **不是**把守卫放宽。
// ★ 判据是"覆盖数"，不是"扫过文件"：`docs/` 被清空时 scanned 可能仍 >0（wushen 还在），
//   但项目册 0 本 ⇒ 所有 `NN 册` 都会判悬空 —— 那说明的是**仓库坏了**，不是"文档写错了"。
//   把它归到"判失败"里、并明确写出来，免得被当成一批真违规去逐个改。
const dead = Object.entries(counts).filter(([, n]) => n === 0);
if (scanned === 0 || index.project.size === 0 || dead.length > 0) {
  console.log(
    `  ❌ 死规则守卫：扫描 ${scanned} 个文件、项目册 ${index.project.size} 本；覆盖数 ` +
      Object.entries(counts)
        .map(([k, n]) => `${k.replace('_', '.')}=${n}`)
        .join(' / ') +
      (dead.length === 0 ? '' : `（${dead.map(([k]) => k.replace('_', '.')).join('、')} 归零）`) +
      ' —— 判失败',
  );
  console.log(
    '      （覆盖 0 = 该子规则此刻是死的，不能算通过；项目册 0 本 = 仓库不完整。见 24 册 FG-7）',
  );
  process.exit(EXIT_FAIL);
}

if (violations.length === 0) {
  console.log(
    `  ✅ 通过：${scanned} 个文档、${counts.G16_1} 条册号 + ${counts.G16_2} 条路径 + ` +
      `${counts.G16_3} 条绑定式节号 + ${counts.G16_4} 条本册自指，全部指向真实存在的册/节；` +
      `00 册 §2 的 ${counts.G16_5} 行册清单与磁盘 ${index.project.size} 个册文件一一对应`,
  );
  process.exit(EXIT_PASS);
}
process.exit(report(violations, { failText: '文档内部引用了不存在的册/节' }));

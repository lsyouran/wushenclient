/**
 * tools/gate/docs-index.mjs — 文档册索引（册号 / 节号）的**唯一解析处**
 * ============================================================================
 * 为什么单独成模块：G15（源码注释里的册号）与 G16（docs/ 内部的册号与节号）
 * 需要的是**同一份**"哪些册存在、每册有哪些节"。各写一份就是 24 册铁律 4 说的
 * **第二份真相** —— 而且是最容易漂的那种（册号集合一旦有第二份，新建一册后
 * 两份会各自成长，而"哪个才是对的"没人知道）。
 *
 * ── ★★ 册号在**两套**目录里并存，而且 `00` 是重复的 ─────────────────────────
 * 实测（2026-10-19）：`docs/` 有 `00,24…33`，`docs/wushen/` 有 `00…23`。
 * 两者的并集是 `00`–`33`，但 **`00` 同时存在于两边** ——
 * 这不是理论问题：G16 的探针 v1 把 `00 册 §2` 解析到 `docs/wushen/00`，
 * 于是 27 条**真实存在**的引用被判成"悬空"（假红 27 条，全是这一个碰撞）。
 *
 * 所以本模块**不做扁平并集**，解析顺序是**无条件项目册优先**：
 *     ① `docs/NN-*.md` 命中 ⇒ 就是它
 *     ② 不是项目册 ⇒ 回落到 `docs/wushen/NN-*.md`
 *
 * 为什么这样对：
 *   · 号段是错开的（项目 `00,24–33`，wushen `01–23`），**唯一重叠是 `00`**；
 *   · 重叠处的语义由"项目优先"这条**约定**钉死，且有实例佐证：
 *     wushen 06 册里那句「00 册 §4 纪律 6」指的是**项目 00 册 §4**（维护纪律），
 *     若按"住在哪套就先查哪套"解析到 wushen 00，会当场假红；
 *   · wushen 册的节号用的是**中文数字**（`## 一、项目速览`），`§数字` 在那里
 *     本来就不存在 ⇒ 带 `§数字` 的引用**只可能**指项目册。
 * ★ 这是一条**约定**，不是可推导的事实 ⇒ 记在这里，并由 G16 的表头打印。
 *   一旦以后改成"两套都得带限定词"，就只有 `resolveBook` 这一处要改。
 *
 * ★ 曾经写成"先看引用所在的那一套"，被上面那条 wushen 06 的实例证伪（假红 1 条）。
 *   记下来：**"住在哪里"不等于"指的是哪里"**。
 *
 * ── 节号集合怎么来 ──────────────────────────────────────────────────────────
 * 只认**标题**（`#`–`######`），不认正文里的 `1.` `2.` 列表 —— 那会把
 * "正文里恰好以数字开头的行"也算成节，判据就失去区分性了。
 * 两种标题写法都要认：
 *     `## 50. 收口批`   /   `## §50 收口批`   /   `## §52.1 原文`
 * 前者是本项目 24/29 册的风格，后者是 26 册的风格（`#` 后直接跟 `§`）。
 *
 * ★ **父节自动算存在**：有 `## 29.10` 就有 `§29`。这是文档的常规语义
 *   （子节存在蕴含父节存在），实测若不做这一步，`§29` 一族会产生 10+ 条假红。
 *
 * ★ 一级标题（`# 29 · 属性与派生数值设计`）**不算节号**：它的数字是**册号**。
 *   若把它算成节，`§29` 就会在 29 册里永远为真 —— 一个"永远不会红"的漏洞。
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, exists } from './lib.mjs';

/** 文档目录是工程根的**兄弟目录**（`D:/ts-mud/{newmud,docs}`）；不写死目录名 */
export const DOCS_DIR = join(ROOT, '..', 'docs');
export const WUSHEN_DOCS_DIR = join(DOCS_DIR, 'wushen');

/**
 * `26-代码审查记录.md` → `['26', '代码审查记录']`；非册文件（如 `README.md`）返回 null
 * ★ 导出是因为 G16.5 需要"磁盘上有哪些册"这个**事实**，而事实的定义就是这条正则。
 *   让它被两边各写一份，就是 24 册铁律 4 的第二份真相（而且是最容易漂的那种：
 *   某天册文件命名改了，两份正则只改一份 ⇒ 一个闸门永远绿）。
 */
export const BOOK_FILE_RE = /^(\d{2})-(.+)\.md$/;

/**
 * 从一册的正文里抽出**节号集合**（含父节）。
 *
 * ★ 不带 `export`：全仓只有 `scanBooks` 在用它（G17 判据，2026-10-19）。
 *   若将来要为它写单测，把 `export` 加回来**并由测试真的 import** —— 那时 G17
 *   的 external 计数会变成 > 0，自动放行。（"为了可测所以先导出"不算数：那正是假契约。）
 * @param {string} text 全文
 * @param {string} bookNo 本册册号（用来排除一级标题里的册号）
 */
function sectionsOf(text, bookNo) {
  const out = new Set();
  for (const line of text.split(/\r?\n/)) {
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h === null) continue;
    const depth = h[1].length;
    // `## §50 收口批` → 去掉 `§` 再取前导数字
    const title = (h[2] ?? '').trim().replace(/^§\s*/, '');
    const m = /^(\d+(?:\.\d+)*)/.exec(title);
    if (m === null) continue;
    const num = m[1];
    // ★ 一级标题是册名，不是节名（见头部）：`# 29 · …` 里的 29 是册号。
    if (depth === 1 && num === bookNo) continue;
    const seg = num.split('.');
    for (let i = 1; i <= seg.length; i++) out.add(seg.slice(0, i).join('.'));
  }
  return out;
}

/**
 * 扫一个目录，返回 `Map<册号, {no, scope, file, title, sections}>`。
 * 目录不可达时返回空 Map（调用方判定"能不能下结论"）。
 *
 * ★ 不带 `export`：只有 `loadDocsIndex` 在调它（G17 判据，2026-10-19）。
 */
function scanBooks(dir, scope) {
  const out = new Map();
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries.sort()) {
    const m = BOOK_FILE_RE.exec(name);
    if (m === null) continue;
    const file = join(dir, name);
    let text;
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    const no = m[1] ?? '';
    out.set(no, {
      no,
      scope,
      file,
      title: m[2] ?? '',
      sections: sectionsOf(text, no),
    });
  }
  return out;
}

/**
 * 读全部册。
 * @returns {{project: Map, wushen: Map, ok: boolean, describe: (no: string) => string}}
 */
export function loadDocsIndex() {
  const project = scanBooks(DOCS_DIR, 'project');
  const wushen = scanBooks(WUSHEN_DOCS_DIR, 'wushen');
  return {
    project,
    wushen,
    /**
     * 判据的前提：`docs/` 可读。**只判"目录在不在"，不判"里面有没有册"** ——
     * 后者归各闸门的死规则守卫管（目录被清空 = 覆盖数归零 = 判失败），
     * 若在这里就把"空目录"算成 SKIP，一次误删 `docs/` 会安静地变成"跳过"而不是"失败"。
     */
    ok: exists(DOCS_DIR),
    /** 全部册号的稳定排序文本（报错文案用） */
    get knownList() {
      return [...new Set([...project.keys(), ...wushen.keys()])].sort().join(' / ');
    },
  };
}

/**
 * 解析 `NN 册` → 具体那一册。**无条件项目册优先，否则回落 wushen 册**（理由见头部）。
 * @param {object} index `loadDocsIndex()` 的返回值
 * @param {string} no 两位册号
 * @returns {{no: string, scope: 'project'|'wushen', file: string, title: string, sections: Set<string>} | undefined}
 */
export function resolveBook(index, no) {
  return index.project.get(no) ?? index.wushen.get(no);
}

/**
 * 位置 `pos` 是否落在**行内代码 span**（反引号之间）里。
 *
 * ★ 这是 G16「记录错误的行不被判红」的**唯一**机制：`NN 册 §X` 被反引号包住时，
 *   它是"被展示的原文"，不是"断言某处存在"—— 26 册 §29.3 那张错误表 9/9 都长这样。
 * ★ 放在本模块而不是闸门里：闸门脚本一 import 就会跑完整个扫描并 `process.exit`，
 *   没法被任何测试引用；本模块是**纯函数**（无 IO、无副作用），至少理论上可测。
 *
 * ⚠️ **如实记档：它现在没有单测**。原因是实的 —— `vitest.config.ts` 的 include 是
 *   `tests` 目录下的 `*.test.ts`（写 glob 时**不能用星号斜杠**，它会提前闭合本注释块 —— 踩过），而这条函数住在 `.mjs` 里；从 TS 测试 import 它需要
 *   `allowJs` 或给 `.mjs` 写声明文件，两样都是为了一个函数改全局配置。
 *   现状是**用真实语料代替单测**：本批全绿时 109 条引用走了"被反引号包住 ⇒ 豁免"这条路径
 *   （66 + 56 + 1），其中 26 册 §29.3 那张错误表的 9 条正是它的设计对象。
 *   ★ **未被覆盖的分支**：等长反引号配对（`` ``…`` ``）与"反引号未闭合"两条。
 *     后者的默认行为是**判"不在代码里"**（照常判红）—— 失败方向是**多报**不是漏报，
 *     这是刻意选的。要补这两条，先把 `.test.mjs` 加进 vitest 的 include，属独立批次。
 *
 * 支持 `` ``…`` `` 这种等长配对；**未闭合的反引号按普通字符处理**（宁可判"不在代码里"）：
 * 那样真引用会照常被判，不会因为一个手滑的孤立反引号把后面整段都豁免掉。
 */
export function inInlineCode(line, pos) {
  let i = 0;
  while (i < pos) {
    if (line[i] !== '`') {
      i += 1;
      continue;
    }
    let n = 0;
    while (line[i + n] === '`') n += 1;
    // 找等长的收尾串
    let j = i + n;
    let closed = -1;
    while (j < line.length) {
      if (line[j] === '`') {
        let k = 0;
        while (line[j + k] === '`') k += 1;
        if (k === n) {
          closed = j + k;
          break;
        }
        j += k;
        continue;
      }
      j += 1;
    }
    if (closed === -1) {
      i += n;
      continue;
    }
    if (i < pos && pos < closed) return true;
    i = closed;
  }
  return false;
}

/** 供两册集合做并集文本，保持排序稳定 */
export function bookNumberList(index) {
  return [...new Set([...index.project.keys(), ...index.wushen.keys()])].sort();
}

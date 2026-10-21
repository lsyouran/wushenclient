/**
 * tools/ids-index.mjs —— 标识清单的**唯一解析处**（CLI 与闸门共用）
 * ============================================================================
 * 为什么单独成模块：`tools/ids.mjs`（CLI，给人跑）与 `tools/gate/g18-ids.mjs`
 * （闸门，给套件跑）需要**同一份**"从代码枚举出哪些标识"的逻辑。
 * 各写一份就是 24 册铁律 4 的第二份真相 —— 而且是最容易漂的那种：
 * 某天 `world/skill/` 的目录约定变了，两份解析器只改一份 ⇒ 一个永远绿。
 * （G15/G16 共用 `gate/docs-index.mjs` 是同一个先例。）
 *
 * ── 数据源（全部是 `shared/` 与内容目录里的单源，本模块**不新增第三份真相**）──
 *   command  ← `world/command/<area>/<name>.ts` 的**路径**
 *   skill    ← `world/skill/<path>.ts` 的路径
 *   packet   ← `shared/protocol.ts#SERVER_PACKET_TYPES`（**服务端 → 客户端**）
 *   clientPacket ← `shared/protocol.ts#CLIENT_PACKET_TYPES`（**客户端 → 服务端**）
 *   error    ← `shared/error-codes.ts#ERROR_CODES` 的键
 *   prop     ← `shared/constants.ts#PROPERTIES` 的键
 *   kind     ← `shared/ids.ts#KINDS`
 *   reserved ← `shared/ids.ts#RESERVED_AREAS`（含 `...KINDS` 展开）
 *   slot     ← `shared/constants.ts#ENABLE_SLOTS`
 *
 * ★★ **`packet` 与 `clientPacket` 必须分开（2026-10-19 §71.8 实测）**：
 *   32 册 §32.8 原先把两个方向混在一张表里，于是 `command` / `ping`
 *   （**只存在于 `CLIENT_PACKET_TYPES`**）被当成了服务端帧写进"播报/其他"那一行，
 *   同时漏掉了 `disobj` / `changepfm` / `clearDistime`。
 *   ⇒ 一份"看起来完整、实际既多又少"的名单，**比没有名单更危险**。
 *   分组这一步本身就漏过一组 —— 这是"手写清单 vs 磁盘/代码事实"的第四处同病。
 *
 * ★ **路径即 id 不是本模块的假设，是 G5 的既有判据**：G5 要求
 *   "路径推出的 id = `defineCommand` / `defineSkill` 里写的 id"。
 *   所以这里读路径而不是解析源码 —— 少一次正则，也少一个可能漂的解析器。
 *
 * ★ **解析用括号配平，不是"找到下一个 `]`"**：`RESERVED_AREAS` 是
 *   `new Set<string>([...KINDS, 'shared', …])`，找第一个闭合符会截断。
 *   第一版就栽在这里（reserved 组报 0 项）。
 */

import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, readCode } from './gate/lib.mjs';

/** 32 册 —— 生成块的宿主 */
export const DOC_PATH = join(ROOT, '..', 'docs', '32-标识字典.md');

const walkTs = (dir, out = []) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walkTs(p, out);
    else if (e.name.endsWith('.ts')) out.push(p);
  }
  return out;
};

/** 目录树 → id 列表（路径即 id，去掉 .ts）；目录不存在返回 null */
const idsFromDir = (dir) => {
  const abs = join(ROOT, dir);
  if (!statSync(abs, { throwIfNoEntry: false })) return null;
  return walkTs(abs)
    .map((p) =>
      p
        .slice(abs.length + 1)
        .replace(/\\/g, '/')
        .replace(/\.ts$/, ''),
    )
    .sort();
};

/**
 * 取某个 `export const NAME = [ … ]` / `= { … }` / `= new Set([ … ])` 的**内容行**（已去注释）。
 */
const blockOf = (file, declStart) => {
  const { code: lines } = readCode(join(ROOT, file));
  const start = lines.findIndex((l) => l.includes(declStart));
  if (start === -1) return null;
  // 起始括号要**往后找第一个 `[` 或 `{`**：
  // `RESERVED_AREAS: ReadonlySet<string> = new Set<string>([` 的声明后第一个字符是 `:`。
  let openChar = null;
  for (let i = start; i < lines.length && openChar === null; i++) {
    const from = i === start ? lines[i].indexOf(declStart) + declStart.length : 0;
    const seg = lines[i].slice(from);
    const at = seg.search(/[[{]/);
    if (at !== -1) openChar = seg[at];
  }
  if (openChar === null) return null;
  const closeChar = openChar === '[' ? ']' : '}';
  let depth = 0;
  let begun = false;
  const out = [];
  for (let i = start; i < lines.length; i++) {
    const line = lines[i];
    for (const ch of line) {
      if (ch === openChar) {
        depth += 1;
        begun = true;
      } else if (ch === closeChar) {
        depth -= 1;
      }
    }
    if (begun) out.push(line);
    if (begun && depth === 0) break;
  }
  return out;
};

/** 块内所有 `'…'` / `"…"` 字面量（数组型名单） */
const stringsIn = (lines) => {
  const out = [];
  for (const l of lines ?? []) {
    for (const m of l.matchAll(/'([^']*)'|"([^"]*)"/g)) out.push(m[1] ?? m[2]);
  }
  return out;
};

/** 块内所有 `键:` 形态的键名（对象型名单），跳过展开运算符与计算键 */
const keysIn = (lines) => {
  const out = [];
  for (const l of lines ?? []) {
    const m = /^\s*([A-Za-z_$][\w$]*)\s*:/.exec(l);
    if (m !== null) out.push(m[1]);
  }
  return out;
};

/**
 * 各组的定义。
 * `blocked: true` = 该组在 32 册里有**生成块**，参与 `--check` / `--write` / G18。
 * ★ 没有标记块却参与对账的组会永远报"块缺失"，所以这个标记是必需的，不是装饰。
 *
 * ★★ **2026-10-19 §71.8 起九组全部建块**（此前只有 `skill`）。
 *   当初给 `command` 留的手写理由是"那张表是 area 分组 + 触发词 + 目录的人写组织" ——
 *   这个理由**仍然成立**，所以处置不是"整表生成"，而是**分离两个东西**：
 *     · **名单**（"有哪些 id"）→ 生成块，机器管；
 *     · **解释**（"各自干什么 / 触发词 / 目录 / 教训"）→ 人写表，原样保留。
 *   两者靠块后那句"名单以 §32.14 为准，本表解释含义"锚住，而不是靠人记得同步。
 */
export const GROUPS = {
  command: {
    label: '内容层指令 id',
    src: 'world/command/**（路径即 id）',
    blocked: true,
    get: () => idsFromDir('world/command'),
  },
  skill: {
    label: '技能内容 id',
    src: 'world/skill/**（路径即 id）',
    blocked: true,
    get: () => idsFromDir('world/skill'),
  },
  packet: {
    label: '服务端帧（server → client）',
    src: 'shared/protocol.ts#SERVER_PACKET_TYPES',
    blocked: true,
    get: () => stringsIn(blockOf('shared/protocol.ts', 'SERVER_PACKET_TYPES =')),
  },
  clientPacket: {
    label: '客户端帧（client → server）',
    src: 'shared/protocol.ts#CLIENT_PACKET_TYPES',
    blocked: true,
    get: () => stringsIn(blockOf('shared/protocol.ts', 'CLIENT_PACKET_TYPES =')),
  },
  error: {
    label: '错误码',
    src: 'shared/error-codes.ts#ERROR_CODES',
    blocked: true,
    get: () => keysIn(blockOf('shared/error-codes.ts', 'ERROR_CODES =')),
  },
  prop: {
    label: '属性键',
    src: 'shared/constants.ts#PROPERTIES',
    blocked: true,
    get: () => keysIn(blockOf('shared/constants.ts', 'PROPERTIES =')),
  },
  kind: {
    label: '内容对象 kind',
    src: 'shared/ids.ts#KINDS',
    blocked: true,
    get: () => stringsIn(blockOf('shared/ids.ts', 'KINDS =')),
  },
  slot: {
    label: '装配槽',
    src: 'shared/constants.ts#ENABLE_SLOTS',
    blocked: true,
    get: () => stringsIn(blockOf('shared/constants.ts', 'ENABLE_SLOTS =')),
  },
  reserved: {
    label: '保留 area',
    src: 'shared/ids.ts#RESERVED_AREAS（含 ...KINDS）',
    blocked: true,
    get: () => {
      const lines = blockOf('shared/ids.ts', 'RESERVED_AREAS');
      const own = stringsIn(lines);
      // `...KINDS` 展开：把 KINDS 的值也并进来（否则报的比实际少）
      const spreadKinds = (lines ?? []).some((l) => l.includes('...KINDS'));
      const kinds = spreadKinds ? stringsIn(blockOf('shared/ids.ts', 'KINDS =')) : [];
      return [...new Set([...kinds, ...own])];
    },
  },
};

/** 有生成块的组（`--check` / `--write` / G18 的默认范围） */
export const BLOCK_GROUPS = Object.keys(GROUPS).filter((g) => GROUPS[g].blocked === true);

/**
 * 采集。
 * @param {string[]} selected 组名
 * @returns {{data: Record<string, string[]>, failed: string[]}}
 */
export function collect(selected) {
  const data = {};
  const failed = [];
  for (const g of selected) {
    const list = GROUPS[g].get();
    if (list === null || list.length === 0) {
      failed.push(g);
      continue;
    }
    data[g] = list;
  }
  return { data, failed };
}

/** 块内正文（不含标记注释）—— 内部用，不导出 */
const renderBody = (g, list) => {
  const { label, src } = GROUPS[g];
  return [
    `**${label}**（${list.length} 个）—— 来源 \`${src}\``,
    '',
    '| # | id |',
    '|---:|---|',
    ...list.map((id, i) => `| ${i + 1} | \`${id}\` |`),
  ].join('\n');
};

/** 完整块（含标记注释）—— `--md` 打印它，`--check` 逐字比对它，`--write` 写入它 */
export function renderBlock(g, list) {
  return `<!-- ids:begin ${g} -->\n${renderBody(g, list)}\n<!-- ids:end ${g} -->`;
}

/** 从一段块里抽出 id（表格第二列）；用于"多了谁 / 少了谁"的差异报告 */
export function idsInBlock(block) {
  return [...block.matchAll(/^\|\s*\d+\s*\|\s*`([^`]+)`\s*\|/gm)].map((m) => m[1]);
}

/** 找文档里某一组的块；找不到返回 null */
export function findBlock(docText, g) {
  const re = new RegExp(`<!-- ids:begin ${g} -->[\\s\\S]*?<!-- ids:end ${g} -->`);
  return re.exec(docText);
}

#!/usr/bin/env node
/**
 * tools/ids.mjs —— 标识清单的 CLI（薄壳）
 * ============================================================================
 * **解析逻辑一个字都不在这里** —— 全部在 `tools/ids-index.mjs`，与闸门
 * `tools/gate/g18-ids.mjs` 共用同一份。本文件只负责"参数 → 调用 → 打印/写回"。
 * （理由见 ids-index.mjs 头部：两份解析器就是第二份真相。）
 *
 * ── 为什么要有它 ───────────────────────────────────────────────────────────
 * 32 册里那些"全表"原来**手抄**，而手抄必然漂。2026-10-19 实测：32.6 的技能内容 id
 * 只举了 3 个例子（`base/force` / `base/dodge` / `wd/taijijian`），代码里当时已经有
 * **7 个** —— 少了 `blade` / `parry` / `sword` / `unarmed`。
 * 那不是"忘了改"，而是**那格本来就只有举例**，而**省略号永远不会红**。
 *
 * ── 用法 ───────────────────────────────────────────────────────────────────
 *   node tools/ids.mjs                 # 人读：分组打印 + 数量
 *   node tools/ids.mjs --json          # 机器读
 *   node tools/ids.mjs --md            # markdown 生成块（贴进文档用）
 *   node tools/ids.mjs --md --group=skill
 *   node tools/ids.mjs --group=command,skill
 *   node tools/ids.mjs --check         # 文档生成块 ⊥ 代码枚举（G18 也走这条，但走库不走 CLI）
 *   node tools/ids.mjs --write         # 把生成块写回文档（**只动标记块内**）
 *
 * ── ★★ 为什么是"标记块"而不是"整篇生成" ──────────────────────────────────
 * 32 册的价值一半在名单，一半在**人的判断**（中文含义、wushen 旧键对照、
 * "为什么是 `train/` 而不是 `skill/`"这类教训）。整篇生成会把后者冲掉。
 * ⇒ 只有被 `<!-- ids:begin X -->` … `<!-- ids:end X -->` 包住的**那一段**是产物。
 *   `--write` 只替换块内，块外**一个字不碰**（实测：`--write` 后与备份 `diff` 为空）。
 *
 * ★ 反过来，`--write` **不会替你创建标记块**：块不存在 ⇒ 报错退出。
 *   自动插入会让"文档结构"也变成脚本说了算，那是另一件更大的事。
 *
 * 退出码：0 正常 / 1 解析失败或 `--check` 不一致 / 3 崩溃
 */

import { readFileSync, writeFileSync } from 'node:fs';
import {
  BLOCK_GROUPS,
  DOC_PATH,
  GROUPS,
  collect,
  findBlock,
  idsInBlock,
  renderBlock,
} from './ids-index.mjs';
import { EXIT_FAIL, EXIT_PASS, installCrashGuard, rel } from './gate/lib.mjs';

installCrashGuard('ids');

const argv = process.argv.slice(2);
const wantJson = argv.includes('--json');
const wantMd = argv.includes('--md');
const wantCheck = argv.includes('--check');
const wantWrite = argv.includes('--write');
const groupArg = argv.find((a) => a.startsWith('--group='));
const explicit = groupArg
  ?.slice('--group='.length)
  .split(',')
  .map((s) => s.trim())
  .filter((s) => s !== '');

const selected = explicit ?? (wantCheck || wantWrite ? BLOCK_GROUPS : Object.keys(GROUPS));

const unknown = selected.filter((g) => GROUPS[g] === undefined);
if (unknown.length > 0) {
  console.error(`❌ 未知的组：${unknown.join(', ')}`);
  console.error(`   可用：${Object.keys(GROUPS).join(' / ')}`);
  process.exit(EXIT_FAIL);
}

// ── 采集 ────────────────────────────────────────────────────────────────────
const { data, failed } = collect(selected);

/**
 * ★ 解析出 0 项 = 解析器坏了，不是"这个仓库没有标识"。
 *   若在这里报 0 还打 ✅，就是 FG-7 的形态（规则在、输入归零、日志仍绿）。
 */
if (failed.length > 0) {
  console.error(`❌ 这些组解析出 0 项：${failed.join(', ')}`);
  console.error('   （单源被改名/搬家，或括号配平解析失效。**判失败**，不当作"空清单"。）');
  process.exit(EXIT_FAIL);
}

// ── 输出 ────────────────────────────────────────────────────────────────────
if (wantJson) {
  console.log(JSON.stringify(data, null, 2));
  process.exit(EXIT_PASS);
}

if (wantMd) {
  for (const [g, list] of Object.entries(data)) {
    console.log(renderBlock(g, list));
    console.log('');
  }
  process.exit(EXIT_PASS);
}

// ── --check / --write：文档里的生成块 ⊥ 代码枚举 ─────────────────────────────
if (wantCheck || wantWrite) {
  let doc;
  try {
    doc = readFileSync(DOC_PATH, 'utf8');
  } catch (e) {
    console.error(`❌ 读不到 ${rel(DOC_PATH)}：${e.message}`);
    process.exit(EXIT_FAIL);
  }

  let problems = 0;
  let out = doc;
  for (const [g, list] of Object.entries(data)) {
    const found = findBlock(doc, g);
    if (found === null) {
      console.error(`❌ ${rel(DOC_PATH)} 里找不到标记块 \`ids:begin ${g}\` … \`ids:end ${g}\``);
      console.error('   （本工具**不会**替你插入块 —— 文档结构不由脚本决定。请先手工加块。）');
      problems += 1;
      continue;
    }
    const want = renderBlock(g, list);
    if (found[0] === want) {
      console.log(`✅ ${g}：${list.length} 个 id 与文档一致`);
      continue;
    }
    // 不一致 —— 报出"多了谁 / 少了谁"，而不是只报"不一样"
    const have = new Set(idsInBlock(found[0]));
    const wantSet = new Set(list);
    const missing = list.filter((x) => !have.has(x));
    const extra = [...have].filter((x) => !wantSet.has(x));
    problems += 1;
    console.error(`❌ ${g}：文档与代码不一致（代码 ${list.length} 个 / 文档块 ${have.size} 个）`);
    if (missing.length > 0) console.error(`   ★ 代码有、文档缺：${missing.join(' ')}`);
    if (extra.length > 0) console.error(`   ★ 文档有、代码无：${extra.join(' ')}`);
    if (missing.length === 0 && extra.length === 0) {
      console.error('   ★ 集合相同但**顺序或格式**不同（正常：按 id 排序，不要手改块内）');
    }
    out = out.replace(found[0], () => want);
  }

  if (problems === 0) {
    console.log(`✅ 全部 ${Object.keys(data).length} 个生成块与代码枚举一致`);
    process.exit(EXIT_PASS);
  }
  if (wantWrite) {
    writeFileSync(DOC_PATH, out, 'utf8');
    console.log(`✍️  已重写 ${rel(DOC_PATH)} 的生成块（块外未改动）—— 请复跑 --check 确认`);
    process.exit(EXIT_PASS);
  }
  console.error('');
  console.error('⇒ 修法：`node tools/ids.mjs --write`（只重写标记块内的内容）');
  process.exit(EXIT_FAIL);
}

for (const [g, list] of Object.entries(data)) {
  const { label, src } = GROUPS[g];
  console.log(`${label}（${list.length}）  ← ${src}`);
  console.log(`  ${list.join('  ')}`);
  console.log('');
}
process.exit(EXIT_PASS);

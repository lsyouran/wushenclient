#!/usr/bin/env node
/**
 * G18 · 文档生成块 ⊥ 代码枚举（标识清单不漂）
 * ============================================================================
 * 规则：
 *   G18.1 32 册里每个 `<!-- ids:begin X --> … <!-- ids:end X -->` 块，
 *         其内容必须与 `tools/ids-index.mjs` 从代码枚举出的清单**逐字**一致
 *
 * ── 为什么需要它（不是理论，是实测出来的空档）──────────────────────────────
 * 2026-10-19 复核 32 册时数出来的：
 *
 * | 名单 | 代码 | 32 册写的 | 差异 |
 * |---|---|---|---|
 * | 指令 id | 19 | 19 | 一致（那张表本来就完整） |
 * | 技能 id | **7** | 3 个例子 + `…` | **缺 blade / parry / sword / unarmed** |
 * | 服务端帧 | **35** | 34 个，且混进了 2 个客户端帧 | **多 command/ping、少 disobj/changepfm/clearDistime** |
 *
 * 缺的这 4 个技能**不是"忘了改"** —— 那格从写下第一天起就只有举例，
 * 而 **省略号永远不会红**。所以问题的形状不是"有人偷懒"，
 * 而是"文档持有了一份**不完整**的副本，且没有任何机制说它不完整"。
 *
 * ★★ 服务端帧那一行更糟：它不是"少"，而是**既多又少** ——
 * 多出来的 `command` / `ping` 是**客户端帧**（`CLIENT_PACKET_TYPES`），
 * 被抄进了服务端那张表；少的三个夹在 `dispfm` 与 `msg` 之间被肉眼跳过。
 * 一份"看起来很完整、实际上两处都错"的名单，比没有名单更危险：
 * 读者会拿它去判断"这个帧到底存不存在"。
 *
 * ⇒ 这类登记只能靠"文档的副本 = 代码的事实"来守，人手核对必然漏（这次就漏了 4 个 + 错 5 个）。
 *
 * ── ★ 为什么闸门只对"生成块"判，而不对整册判 ──────────────────────────────
 * 32 册一半是名单、一半是人的判断（中文含义 / wushen 旧键对照 / 踩过的坑）。
 * 对整册做机械对账会把这些判断也当成"数据"，于是要么假红、要么被迫删内容。
 * ⇒ 只有被标记块包住的那一段被声明为"产物"，闸门只管它。
 *   块的边界是**人画的**，所以闸门不会自己去猜"哪一行算清单"。
 *
 * ── ★★ 为什么不判"文档里出现的每个 id 都必须存在"（一个看起来更简单的方案）──
 * 因为它会把**有意记录"未做项"**的写法判红。现成的反例就在 32 册里：
 * `base/bite` 是 `ENABLE_SLOTS` 里真实存在的**槽**，但 `world/skill/` 下没有这门武功
 * （wushen 有、本项目没做），文档**故意**记着它。
 * 这与 G16"记录错误的行不该被记录者判红"是同一个坑，解法也一样：
 * **判据落在位置上**（只在标记块内判），不落在"这段文本长得像不像 id"上。
 *
 * ── 已知窄口（如实记档）──────────────────────────────────────────────────
 *   · **2026-10-19 §71.8 起九组全部建块**（此前只有 `skill`）。当时留的三条窄口现状：
 *       ① 「只覆盖 `skill`」—— **已消解**（`BLOCK_GROUPS` 现在是九组）；
 *       ② 「`command` 那张表是人写组织」—— **仍然成立**，但处置改成**分离名单与解释**：
 *          名单进 §32.13 生成块，触发词/目录/分组留 §32.7 人写表；
 *       ③ 「`--write` 不替你写、闸门不偷偷改文档」—— 不变。
 *   · ★★ 建块过程本身抓到一个大洞：32 册 §32.8 把 `command` / `ping`
 *     （**服务端根本不存在**，只在 `CLIENT_PACKET_TYPES` 里）当成服务端帧，
 *     同时漏了 `disobj` / `changepfm` / `clearDistime`。
 *     ⇒ **枚举器原先也少一组**（没有 `CLIENT_PACKET_TYPES`），本批补上。
 *     教训：**"我列了几组"这件事本身也是手写清单** —— 分组这一步没人守。
 *   · 判据是**逐字**比对（含顺序）。顺序由 `ids-index` 排序保证，所以"集合相同但
 *     顺序不同"也算红 —— 那通常意味着有人手改了块内，本来就该红。
 *   · 仍**不判**"块外的人写表是否完整"：§32.2 的 76 行、§32.7 的 19 行都可能漏，
 *     闸门只保证"§32.13 的名单是全的"。这是刻意的 —— 人写表里允许出现
 *     "记录未做项"的行（`base/bite`），全文判会假红（见上）。
 *
 * 退出码：0 通过 / 1 违规 / 3 崩溃（见 26 册 §27）。**不设 SKIP**：
 *         读不到 32 册不是"没法判"，是**仓库不完整**。
 */

import { readFileSync } from 'node:fs';
import {
  BLOCK_GROUPS,
  DOC_PATH,
  collect,
  findBlock,
  idsInBlock,
  renderBlock,
} from '../ids-index.mjs';
import { EXIT_FAIL, EXIT_PASS, header, installCrashGuard, rel, report } from './lib.mjs';

installCrashGuard('G18');

const { data, failed } = collect(BLOCK_GROUPS);

header('G18', '文档生成块 ⊥ 代码枚举（标识清单不漂）', {
  '生成块组': BLOCK_GROUPS.join(' / ') || '（无）',
  '文档': rel(DOC_PATH),
  '各组 id 数': Object.entries(data)
    .map(([g, l]) => `${g}=${l.length}`)
    .join(' / '),
});

// ── DEAD-RULE GUARD（24 册 FG-7：0 覆盖 = 死规则，必须判失败）───────────────
// ★ 两种"解析静默失效"：
//   ① `BLOCK_GROUPS` 为空 —— 所有组都被去掉了 blocked 标记，闸门变成空转
//   ② 某组解析出 0 项 —— 单源被改名/搬家，或括号配平解析器坏了
//   两者都会让日志呈现"没有违规"，而实际什么都没查。
if (BLOCK_GROUPS.length === 0 || failed.length > 0) {
  console.log(
    `  ❌ 死规则守卫：生成块组 ${BLOCK_GROUPS.length} 个` +
      (failed.length === 0 ? '' : `；解析出 0 项的组：${failed.join(', ')}`) +
      ' —— 判失败',
  );
  console.log(
    '      （组数 0 = 闸门空转；某组 0 项 = 单源搬了家或解析器坏了。见 24 册 FG-7）',
  );
  process.exit(EXIT_FAIL);
}

let doc;
try {
  doc = readFileSync(DOC_PATH, 'utf8');
} catch (e) {
  console.log(`  ❌ 读不到 ${rel(DOC_PATH)}：${e.message}`);
  console.log('      —— 32 册是这套文档的"标识字典"，读不到 = 仓库不完整，**判失败**（不出 SKIP）');
  process.exit(EXIT_FAIL);
}

const violations = [];
for (const [g, list] of Object.entries(data)) {
  const found = findBlock(doc, g);
  if (found === null) {
    violations.push({
      rule: 'G18.1',
      where: rel(DOC_PATH),
      message:
        `找不到标记块 \`<!-- ids:begin ${g} -->\` … \`<!-- ids:end ${g} -->\`\n` +
        `       ★ 代码里这一组有 ${list.length} 个 id，但文档里没有对应的产物段\n` +
        `       ★ 修法：手工插入标记块（内容用 \`npm run ids --md --group=${g}\` 生成）` +
        ` —— 闸门**不会**替你插入，文档结构不由脚本决定`,
    });
    continue;
  }
  const want = renderBlock(g, list);
  if (found[0] === want) continue;
  const have = new Set(idsInBlock(found[0]));
  const wantSet = new Set(list);
  const missing = list.filter((x) => !have.has(x));
  const extra = [...have].filter((x) => !wantSet.has(x));
  violations.push({
    rule: 'G18.1',
    where: rel(DOC_PATH),
    message:
      `生成块 \`${g}\` 与代码不一致（代码 ${list.length} 个 / 文档块 ${have.size} 个）\n` +
      (missing.length > 0 ? `       ★ 代码有、文档缺：${missing.join(' ')}\n` : '') +
      (extra.length > 0 ? `       ★ 文档有、代码无：${extra.join(' ')}\n` : '') +
      (missing.length === 0 && extra.length === 0
        ? '       ★ 集合相同但**顺序或格式**不同 —— 块内被人手改过（块内是产物，别手改）\n'
        : '') +
      `       ★ 修法：\`npm run ids --write\`（只重写标记块内，块外一个字不碰）`,
  });
}

if (violations.length === 0) {
  const total = Object.values(data).reduce((n, l) => n + l.length, 0);
  console.log(
    `  ✅ 通过：${BLOCK_GROUPS.length} 个生成块、共 ${total} 个 id 与代码枚举逐字一致`,
  );
  process.exit(EXIT_PASS);
}
process.exit(report(violations, { failText: '文档的标识清单与代码不一致' }));

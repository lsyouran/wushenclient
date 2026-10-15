#!/usr/bin/env node
/**
 * G6 · 红线扫描闸门
 * ============================================================================
 * 扫描 23 册 §4.2 / 25 册 §5 的禁止项（注释已剥离，不会误报注释里的讨论）：
 *   R6.1 eval()
 *   R6.2 new Function()
 *   R6.3 node:vm（内容层不再用 vm 沙箱，引擎也不需要）
 *   R6.4 MD5（会话/密码必须用 argon2id/bcrypt）
 *   R6.5 硬编码 ws://
 *   R6.6 在别处重写「过滤 error 并抛错」的校验收口逻辑
 *        （★ docs/26 M3：24 册 §4 禁止清单第 8 条「同一逻辑在两处各写一份」。
 *          `bootstrapWorld` 曾把 `validateWorld` 的那段重写了一遍，而
 *          `assertWorldValid()` 反倒成了死代码。唯一合法位置 = server/world/validate.ts）
 *   R6.7 tools/ 内出现裸数字退出码（必须用 lib.mjs 的 EXIT_PASS/EXIT_FAIL/EXIT_SKIP）
 *        （★ docs/26 L6：退出码语义是**接口**，裸 2 与 EXIT_SKIP 会在后续改动中分叉）
 *   R6.8 源码文件被清空（★ 与 lib.mjs `walk()` 跳过零字节文件配套的反向约束）
 *   R6.9 在 formula.ts 之外重新定义派生属性公式
 *        （COMBAT_FORMULA / computeDerived 只允许定义在 server/engine/formula.ts）
 *        （★ 22 册 §22.8「recount / 伤害公式只有一处定义」。wushen 把同一套 recount
 *          写了两遍、且两遍不一样（07 册 §7.3 / 21 册第 6 条），本规则兜住其复发形态。
 *          TS 的私有字段挡住了"同一处被改两次"，但**挡不住**把公式抄成第二份文件）
 *   R6.10 在 skill.ts 之外重新定义技能属性挂载（release/attach prop 三角）
 *        （★ docs/27 §3 第 6 条：wushen 的增量三角漏一步就永久重复累加且**不报错**，
 *          本项目收成 `SkillBook.recompute()` 的记账式重算 —— 只允许有一处）
 *   R6.11 闸门脚本未安装崩溃守卫（每个 tools/gate/*.mjs 必须调一次 installCrashGuard）
 *        （★ docs/26 §27 / FG-23：node 未捕获异常的退出码也是 1，与"发现违规"同码
 *          ⇒ 漏装守卫的闸门崩溃时，调用方分不出"它死了"还是"它说你错了"。
 *          本规则是 RULES 里唯一的 `must` 型 —— 判据是**文件级的存在性**）
 *
 * ── 三种判定模式（互斥）──────────────────────────────────────────────────────
 *   `re`    → 行级"禁止命中"（默认）
 *   `empty` → 文件级"必须是 0 字节"（R6.8；与 `walk()` 跳过零字节文件配套）
 *   `must`  → 文件级"必须至少命中一行"（R6.11）
 *
 * ── 为什么每条规则自带 `dirs`，而不是共用一份 `SCAN_DIRS` ────────────────────
 * ★ 本闸门曾有一版把 `R6.7` 挂在共用扫描目录 `['shared','server','world','src']` 上，
 *   而 `R6.7` 的 `appliesTo` 只认 `tools/` —— 两者交集为空。
 *   结果是：**这条规则永远匹配不到任何文件，却一直报"✅ 通过"**。
 *   更糟的是它当时**无法被变异测试证伪**（注入样例不在扫描范围里，
 *   注入前后都是 0），于是既不是"绿"也不是"红"，是一片谁也看不见的空白。
 *
 *   同类空洞只能靠**结构**堵：规则声明自己扫哪里 + `0 覆盖 = 判失败`。
 *   见下方 DEAD-RULE GUARD。
 *
 * 退出码：0 通过 / 1 违规 / 3 崩溃（闸门自身异常，见 26 册 §27）
 */

import { join } from 'node:path';
import {
  EXIT_PASS,
  ROOT,
  header,
  installCrashGuard,
  isDir,
  readCode,
  rel,
  report,
  sizeOf,
  walk,
} from './lib.mjs';

installCrashGuard('G6');

/** 产品源码（会被打包 / 被引擎加载的那部分） */
const PRODUCT_DIRS = ['shared', 'server', 'world', 'src'];
/** 工具链自身（闸门脚本、变异测试、生成器） */
const TOOL_DIRS = ['tools'];

/** 「过滤 error」的教学位置：校验收口只允许在这里出现一次 */
const VALIDATE_FILE = 'server/world/validate.ts';

/** 「派生属性公式」的唯一来源：COMBAT_FORMULA / computeDerived 只允许在这里定义 */
const FORMULA_FILE = 'server/engine/formula.ts';

/** 「技能属性挂载」的唯一来源：记账式重算只允许在 skill.ts 里 */
const SKILL_FILE = 'server/engine/skill.ts';

/** 夹具前缀：变异测试的临时文件一律以此开头，是**保留命名空间**（见 .gitignore） */
const FIXTURE_RE = /(?:^|\/)__mut/;

const RULES = [
  { id: 'R6.1', name: 'eval()', re: /(?:^|[^A-Za-z0-9_$.])eval\s*\(/, dirs: PRODUCT_DIRS },
  { id: 'R6.2', name: 'new Function()', re: /new\s+Function\s*\(/, dirs: PRODUCT_DIRS },
  { id: 'R6.3', name: 'node:vm', re: /['"]node:vm['"]/, dirs: PRODUCT_DIRS },
  { id: 'R6.4', name: 'MD5 摘要', re: /['"]md5['"]|\bmd5\s*\(/i, dirs: PRODUCT_DIRS },
  { id: 'R6.5', name: '硬编码 ws://', re: /['"]ws:\/\//, dirs: PRODUCT_DIRS },
  {
    id: 'R6.6',
    name: `重写校验收口逻辑（只允许出现在 ${VALIDATE_FILE}）`,
    re: /\.filter\s*\(\s*\(?\s*[A-Za-z_$][A-Za-z0-9_$]*\s*\)?\s*=>\s*[A-Za-z_$][A-Za-z0-9_$]*\.level\s*===\s*['"]error['"]/,
    dirs: PRODUCT_DIRS,
    appliesTo: (relPosix) => relPosix !== VALIDATE_FILE,
  },
  {
    id: 'R6.7',
    name: '裸数字退出码（tools/ 内必须用 EXIT_PASS / EXIT_FAIL / EXIT_SKIP）',
    // ★ 只认**语句位置**的裸数字，不认字符串字面量里的同名文本。
    //   变异样本本身要把 `process.exit(9);` 当**数据**写进数组字面量，
    //   若不加这个前置断言，闸门会把自己的夹具判成违规（实测踩到）。
    //   前置 = 行首 / 空白 / `;` / `{` / `}` —— 覆盖 `process.exit(1);`、
    //   `if (x) { process.exit(2); }` 这类真实写法。
    re: /(?:^|[\s;{}])process\.exit\(\s*\d+\s*\)/,
    dirs: TOOL_DIRS,
  },
  {
    id: 'R6.8',
    name: '源码文件为空（空文件对其它闸门不可见 —— 由本规则显式接住）',
    // 不是行级规则：命中条件 = 文件零字节。夹具位（__mut*）是"还原即写空"的产物，豁免。
    empty: true,
    dirs: PRODUCT_DIRS,
    appliesTo: (relPosix) => !FIXTURE_RE.test(relPosix),
  },
  {
    id: 'R6.9',
    name: `重写派生属性公式（COMBAT_FORMULA / computeDerived 只允许定义在 ${FORMULA_FILE}）`,
    // ★ 只认**定义**（const/let/var/function + 目标名），不认 import 与成员访问：
    //   `import { COMBAT_FORMULA } from './formula.js'`  （无 const/var/function）
    //   `Math.max(COMBAT_FORMULA.forceRadFloor, ...)`     （同上）
    //   都不该命中。若写成"只要出现 COMBAT_FORMULA 就算"就会持续误报，
    //   而**持续误报的闸门最终会被开发者关掉，比没有更糟**（见文件顶部）。
    re: /(?:^|[^A-Za-z0-9_$.])(?:export\s+)?(?:const|let|var|function)\s+(?:COMBAT_FORMULA|computeDerived)\b/,
    dirs: PRODUCT_DIRS,
    appliesTo: (relPosix) => relPosix !== FORMULA_FILE,
  },
  {
    id: 'R6.10',
    name: `重写技能属性挂载三角（release/attach prop 只允许出现在 ${SKILL_FILE}）`,
    // ★ 守的是 wushen `os/skill/skill.js` 的
    //     `release_prop(me, lv)` → 改等级 → `attach_prop(me, lv)`
    //   这个**增量三角**。它的问题不是"写得丑"，而是**漏一步不会有任何报错**：
    //   换技能 / 升级 / 热更任一环节少走一步，`prop` 就永久重复累加，
    //   只表现为"数值偏高"，事后没人能定位（docs/27 §3 第 6 条、决策 D2）。
    //   本项目把它收成 `SkillBook.recompute()` 的**记账式重算**（幂等、可自检）。
    //   本规则挡的是"把那套三角抄成第二份"——与 R6.9 同类：
    //   TS 的私有字段挡住了"同一处被改两次"，但**挡不住**把写法复制到别的文件。
    //
    //   认定口径与 R6.9 一致：只看**定义**（const/let/var/function + 目标名）。
    //   于是注释里的讨论、`import`、成员访问都不会误报。
    re: /(?:^|[^A-Za-z0-9_$.])(?:export\s+)?(?:const|let|var|function)\s+(?:release_prop|attach_prop|releaseProp|attachProp|release_skill_prop|attach_skill_prop)\b/,
    dirs: PRODUCT_DIRS,
    appliesTo: (relPosix) => relPosix !== SKILL_FILE,
  },
  {
    id: 'R6.11',
    name: '闸门脚本未安装崩溃守卫（每个 `tools/gate/*.mjs` 必须调一次 `installCrashGuard`）',
    // ★ 本规则是 RULES 里**唯一一条"必须命中"型**（`must`），与 R6.8 的 `empty`
    //   同族：判据落在**文件级的存在性**上，而不是"某一行写了什么"。
    //   它守的是 FG-23 的修法自身 —— 漏装守卫的闸门崩溃时仍旧退回退出码 1
    //   ⇒ "崩溃"与"发现违规"在**那个**闸门里又变得不可区分（26 册 §27）。
    //   不加这条的话，"新写一个闸门脚本"就是一个纯靠人记得的窗口。
    //
    //   范围只认**入口脚本**（`tools/gate/*.mjs`，不含子目录）：`lib.mjs` 是
    //   守卫的**定义处**、`tools/dev/ts-loader.ts` 之类根本不是闸门。
    must: /installCrashGuard\s*\(/,
    dirs: TOOL_DIRS,
    appliesTo: (relPosix) =>
      /^tools\/gate\/[^/]+\.mjs$/.test(relPosix) && relPosix !== 'tools/gate/lib.mjs',
  },
];

// ── 扫描 ────────────────────────────────────────────────────────────────────
// 逐规则独立遍历（不同规则扫不同目录），而不是"遍历一次套所有规则"。

const violations = [];
const covered = new Map(); // ruleId → 实际被该规则检查过的文件数
const allFiles = new Set();

for (const rule of RULES) {
  let n = 0;
  const wantEmpty = rule.empty === true;
  // ★ 三种判定模式，互斥（一条规则只能选一种）：
  //   `re`    → 行级"禁止命中"（默认）
  //   `empty` → 文件级"必须是 0 字节"（R6.8）
  //   `must`  → 文件级"必须至少命中一行"（R6.11）
  const wantMust = rule.must !== undefined;
  for (const d of rule.dirs) {
    const dir = join(ROOT, d);
    if (!isDir(dir)) continue;
    // 空文件规则必须**看得见**空文件；其余规则按 walk 默认跳过零字节文件。
    for (const file of walk(dir, wantEmpty ? { includeEmpty: true } : {})) {
      const relPosix = rel(file);
      // 夹具不算"被扫描的源码"：它们是变异测试的空壳（__mut*），
      // 统计进去只会让表头数字随测试运行而跳动。
      if (!FIXTURE_RE.test(relPosix)) allFiles.add(relPosix);
      if (rule.appliesTo !== undefined && !rule.appliesTo(relPosix)) continue;
      n += 1;

      if (wantEmpty) {
        if (sizeOf(file) === 0) {
          violations.push({
            rule: rule.id,
            where: relPosix,
            message: `${rule.name}  →  （0 字节）`,
          });
        }
        continue;
      }

      const { raw, code } = readCode(file);

      if (wantMust) {
        if (!code.some((line) => rule.must.test(line))) {
          violations.push({
            rule: rule.id,
            where: relPosix,
            message: `${rule.name}  →  整个文件里找不到任何匹配 ${String(rule.must)} 的行`,
          });
        }
        continue;
      }

      code.forEach((line, i) => {
        if (rule.re.test(line)) {
          violations.push({
            rule: rule.id,
            where: `${relPosix}:${i + 1}`,
            message: `${rule.name}  →  ${(raw[i] ?? '').trim().slice(0, 90)}`,
          });
        }
      });
    }
  }
  covered.set(rule.id, n);
}

// ── DEAD-RULE GUARD ─────────────────────────────────────────────────────────
// 一条规则若覆盖不到任何文件，它既不会红也不会绿 —— 它根本不存在。
// 把它当**违规**报出来，而不是当"通过"。
for (const rule of RULES) {
  if ((covered.get(rule.id) ?? 0) === 0) {
    violations.push({
      rule: rule.id,
      where: '(规则本身)',
      message: `${rule.name}  →  死规则：扫描目录 [${rule.dirs.join(', ')}] 内没有任何文件通过 appliesTo，该规则不可能变红`,
    });
  }
}

// ── 报告 ────────────────────────────────────────────────────────────────────

header('G6', '红线扫描', {
  扫描文件: allFiles.size,
  规则: RULES.length,
});
console.log('  规则覆盖：');
for (const rule of RULES) {
  const n = covered.get(rule.id) ?? 0;
  const mark = n === 0 ? '❌ 死规则' : `${n} 文件`;
  console.log(`    ${rule.id.padEnd(6)}${rule.name.slice(0, 30).padEnd(32)}${mark}`);
}
console.log('');

if (violations.length === 0) {
  console.log('  ✅ 通过：未发现红线写法');
  process.exit(EXIT_PASS);
}
process.exit(report(violations, { failText: '发现红线写法' }));

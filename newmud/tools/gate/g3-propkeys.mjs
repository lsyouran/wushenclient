#!/usr/bin/env node
/**
 * G3 · 常量对账闸门（静态部分）
 * ============================================================================
 * 依据 docs/24 §3。守住「属性键」这一层：
 *   G3.A  内容层 `prop: { ... }` 的字面量键 ∈ CORE ∪ MOD
 *   G3.B  内容层 `extProp: [...]` 内**不得出现字符串字面量**
 *         （扩展键必须来自 registerExtProp() 的返回值，否则等于绕过登记）
 *   G3.C  引擎层属性读写调用的键字面量 ∈ CORE ∪ MOD
 *   G3.D  每个 registerExtProp() 调用：命名法合法、不与 CORE **或 MOD** 重名、
 *         owner 前缀与所在 `world/<kind>/` 目录一致、无跨 owner 抢键
 *   G3.E  禁止绕过访问器直接操作 `.props` / `.extProps` 的 Map 方法
 *   G3.F  `shared/constants.ts` 的 **PROP 别名表**：值 ∈ CORE ∪ MOD、**互不重复**、非空
 *         （★ 2026-10-14 新增：`server/engine/formula.ts` 改用 `PROP.attack` 之后，
 *          G3.C 在 `server/` 里再也扫不到键**字面量** ⇒ 覆盖会静默归零。
 *          这不是"没有违规"，是**规则失去了输入**（FG-7 的死规则形态）。
 *          于是把别名表本身纳入对账：它是别名层唯一的键来源。）
 *   G3.G  命名空间隔离：**数值侧的名字**（`PROP` 别名键 ∪ `DerivedCombat` 字段名）
 *         与**技能槽词表**（`ENABLE_SLOTS`）必须不相交
 *         （★ 2026-10-14 新增：见下方 §4.5 的长说明）
 *
 * ★ 无输入时 **SKIP(2) 而不是 PASS(0)**：
 *   内容层还没用 `prop`/`extProp` 时，本闸门扫到 0 个入口点。
 *   若此时报「✅ 通过」，就是典型的假绿——检查过与没检查过必须可区分。
 *
 * 退出码：0 通过 / 1 违规 / 2 跳过（前置条件未满足，**不是**通过）/ 3 崩溃（闸门自身异常，见 26 册 §27）
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

installCrashGuard('G3');

// ── 1. 从源码解析出「允许集」的门票 ────────────────────────────────────────

const constFile = join(ROOT, 'shared', 'constants.ts');
if (!exists(constFile)) {
  header('G3', '常量对账');
  console.log('  ❌ shared/constants.ts 不存在');
  process.exit(EXIT_FAIL);
}

const constText = readText(constFile);
const propsBlock = /export const PROPERTIES\s*=\s*\{([\s\S]*?)\n\}\s*as const;/.exec(constText);
/** PROPERTIES 的键（全部缩进 2 空格） */
const CORE = propsBlock?.[1]
  ? [...propsBlock[1].matchAll(/^ {2}([a-z][a-z0-9_]*):/gm)].map((m) => m[1]).filter((x) => x !== undefined)
  : [];

if (CORE.length === 0) {
  // 解析不到键 = 闸门自己坏了，必须报错而不是静默放行
  header('G3', '常量对账');
  console.log('  ❌ 无法从 shared/constants.ts 解析出 PROPERTIES 键（闸门自身失效）');
  process.exit(EXIT_FAIL);
}

/** MOD 闭集：与 `ModProp` 类型的 5 个派生族一一对应 */
const MOD = new Set();
for (const c of CORE) {
  MOD.add(`${c}_per`);
  MOD.add(`diff_${c}`);
  MOD.add(`diff_${c}_per`);
  MOD.add(`add_${c}`);
  MOD.add(`add_${c}_per`);
}
const ALLOWED = new Set([...CORE, ...MOD]);
const CORE_SET = new Set(CORE);
const EXT_PROP_RE = /^[a-z][a-z0-9_]*$/;

// ── 2. 小工具：字符串感知的括号配对 + 顶层键提取 ────────────────────────────
//    必须字符串感知：`prop: { name: '}' }` 里的花括号不能参与计数，
//    否则切片错位 → 误报（持续误报的闸门最终会被开发者关掉，比没有更糟）。

function findBalanced(text, openIdx) {
  const open = text[openIdx];
  const close = open === '{' ? '}' : open === '[' ? ']' : open === '(' ? ')' : null;
  if (close === null) return null;
  let depth = 0;
  let quote = null;
  for (let i = openIdx; i < text.length; i += 1) {
    const c = text[i];
    if (quote !== null) {
      if (c === '\\') {
        i += 1;
        continue;
      }
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      quote = c;
      continue;
    }
    if (c === open) depth += 1;
    else if (c === close) {
      depth -= 1;
      if (depth === 0) return text.slice(openIdx, i + 1);
    }
  }
  return null; // 未闭合
}

/** 取对象字面量体内的**顶层**键（跳过嵌套对象/数组与字符串内容、跳过展开项） */
function topLevelKeys(body) {
  const keys = [];
  let depth = 0;
  let quote = null;
  let expectKey = true;
  let pending = null;
  for (let i = 0; i < body.length; i += 1) {
    const c = body[i];
    if (quote !== null) {
      if (c === '\\') {
        i += 1;
        continue;
      }
      if (c === quote) quote = null;
      else if (expectKey && depth === 0 && pending !== null) pending += c;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      quote = c;
      if (expectKey && depth === 0) pending = '';
      continue;
    }
    if (c === '{' || c === '[' || c === '(') {
      depth += 1;
      continue;
    }
    if (c === '}' || c === ']' || c === ')') {
      depth -= 1;
      continue;
    }
    if (depth !== 0) continue;
    if (c === ',') {
      expectKey = true;
      pending = null;
      continue;
    }
    if (c === ':' && expectKey && pending !== null) {
      keys.push(pending);
      expectKey = false;
      pending = null;
      continue;
    }
    if (expectKey && /[A-Za-z0-9_$]/.test(c)) {
      pending = (pending ?? '') + c;
    }
  }
  return keys;
}

// ── 3. 扫描 ─────────────────────────────────────────────────────────────────

const violations = [];
const push = (rule, where, message) => violations.push({ rule, where, message });

const counts = {
  内容prop字面量: 0,
  内容extProp块: 0,
  引擎属性调用: 0,
  ext登记: 0,
  别名键: 0,
  技能槽名: 0,
  派生字段: 0,
};

function scanWorldFile(file) {
  const relPosix = rel(file);
  const body = readCode(file).code.join('\n');

  // G3.A · `prop: { ... }` 的字面量键
  for (const m of body.matchAll(/\bprop\s*:\s*\{/g)) {
    const openIdx = m.index + m[0].length - 1;
    const slice = findBalanced(body, openIdx);
    if (slice === null) {
      push('G3.A', relPosix, `prop 对象字面量未闭合（无法静态对账）`);
      continue;
    }
    counts.内容prop字面量 += 1;
    for (const key of topLevelKeys(slice.slice(1, -1))) {
      if (!ALLOWED.has(key)) {
        push(
          'G3.A',
          relPosix,
          `prop 里出现非核心属性键 ${JSON.stringify(key)}（不在 CORE∪MOD 内；` +
            `内容层自造键请改用 extProp + registerExtProp()）`,
        );
      }
    }
  }

  // G3.B · `extProp: [...]` 内不得有字符串字面量
  for (const m of body.matchAll(/\bextProp\s*:\s*\[/g)) {
    const openIdx = m.index + m[0].length - 1;
    const slice = findBalanced(body, openIdx);
    if (slice === null) {
      push('G3.B', relPosix, `extProp 数组未闭合（无法静态对账）`);
      continue;
    }
    counts.内容extProp块 += 1;
    for (const lit of slice.matchAll(/(['"])([^'"]+)\1/g)) {
      push(
        'G3.B',
        relPosix,
        `extProp 里出现字符串字面量 ${JSON.stringify(lit[2])}：` +
          `必须改用 registerExtProp() 的返回值，否则等于绕过登记`,
      );
    }
  }

  // G3.D · registerExtProp(...) 调用对账
  for (const m of body.matchAll(/registerExtProp\(\s*(['"])([^'"]+)\1\s*,\s*\{/g)) {
    counts.ext登记 += 1;
    const key = m[2];
    const tailIdx = m.index + m[0].length - 1;
    const slice = findBalanced(body, tailIdx);
    const meta = slice ?? '';

    if (key === undefined || !EXT_PROP_RE.test(key)) {
      push('G3.D', relPosix, `扩展键命名法非法：${JSON.stringify(key)}`);
      continue;
    }
    if (CORE_SET.has(key)) {
      push('G3.D', relPosix, `扩展键与核心属性重名：${key}`);
    } else if (ALLOWED.has(key)) {
      // ★ docs/26 H1：与 **MOD 派生键**冲突同样致命。`add_gj` / `diff_mz` / `con_per`
      //   不在 PROPERTIES 表里，但类型上是合法 PropKey —— 放行它会让同一字符串
      //   同时存在于 props 与 extProps 两个键空间（24 册 §3.3 不变量失效）。
      push(
        'G3.D',
        relPosix,
        `扩展键与派生键（MOD 族）冲突：${key} —— 它符合 add_/diff_/_per 派生规则，` +
          `类型上是合法 PropKey；请改用真正自造的键名（如 <owner前缀>_<语义>）`,
      );
    }
    const owner = /owner\s*:\s*(['"])([^'"]+)\1/.exec(meta)?.[2];
    if (owner !== undefined) {
      const kind = owner.split(':')[0];
      const dirKind = relPosix.split('/')[1]; // world/<kind>/...
      if (kind !== dirKind) {
        push(
          'G3.D',
          relPosix,
          `owner "${owner}" 的 kind "${String(kind)}" 与所在目录 "world/${String(dirKind)}/" 不一致`,
        );
      }
    }
  }
}

const worldDir = join(ROOT, 'world');
if (isDir(worldDir)) {
  for (const f of walk(worldDir, { exts: new Set(['.ts']) })) scanWorldFile(f);
}

// G3.C · 引擎层属性读写调用的键字面量
//         名字与 server/engine/props.ts 的真实 API 对齐：
//         get/set/add/remove/has + Prop|ExtProp
// G3.E · 禁止绕过访问器直接操作 .props / .extProps 上的 Map 方法
//        唯一豁免 server/engine/props.ts（访问器就实现在那里）
const serverDir = join(ROOT, 'server');
const PROPS_IMPL = 'server/engine/props.ts';

const ENGINE_PROP_CALL_RE =
  /\b((?:get|set|add|remove|has)(?:Ext)?Prop)\s*\(\s*[^,()]+,\s*(['"])([^'"]+)\2/g;
const DIRECT_PROP_ACCESS_RE = /\.(?:extProps|props)\s*\.\s*(?:get|set|has|delete|clear)\s*\(/g;

if (isDir(serverDir)) {
  for (const f of walk(serverDir, { exts: new Set(['.ts']) })) {
    const relPosix = rel(f);
    for (const line of readCode(f).code) {
      // G3.C
      for (const m of line.matchAll(ENGINE_PROP_CALL_RE)) {
        counts.引擎属性调用 += 1;
        const fn = m[1] ?? '';
        const key = m[3];
        if (key === undefined) continue;
        if (fn.includes('Ext')) {
          // §3.3：引擎层只允许读写 CORE/MOD，扩展键应由内容层以 ExtProp 值传入，
          // 绝不在引擎里硬编码字面量。
          push(
            'G3.C',
            relPosix,
            `引擎层硬编码扩展属性键 ${JSON.stringify(key)}：扩展键应作为 ExtProp 参数传入（24 册 §3.3）`,
          );
        } else if (!ALLOWED.has(key)) {
          push(
            'G3.C',
            relPosix,
            `引擎层使用了非核心属性键 ${JSON.stringify(key)}（引擎只认 CORE∪MOD，见 24 册 §3.3）`,
          );
        }
      }

      // G3.E
      if (relPosix !== PROPS_IMPL) {
        for (const m of line.matchAll(DIRECT_PROP_ACCESS_RE)) {
          push(
            'G3.E',
            relPosix,
            `绕过访问器直接操作属性表 ${JSON.stringify(m[0].trim())}：` +
              `必须改用 props.ts 的 get/set/add/remove/has 系列`,
          );
        }
      }
    }
  }
}

// ── 4. G3.F · 别名表 `PROP` 的值对账 ────────────────────────────────────────
//
//  ★ 见文件头 G3.F 的说明：别名层一旦成为 `formula.ts` 唯一的键来源，
//    G3.C 的字面量计数就归零 —— 必须由本规则接住"键到底对不对"这件事。
//  判定范围就是这个文件本身（`shared/constants.ts`），不是扫描。
const aliasBlock = /export const PROP\s*=\s*\{([\s\S]*?)\n\}\s*as const\s+satisfies\s+Record<string,\s*PropKey>;/.exec(
  constText,
);
const aliasEntries = aliasBlock?.[1]
  ? [...aliasBlock[1].matchAll(/^ {2}([A-Za-z][A-Za-z0-9]*):\s*'([^']+)'/gm)].map((m) => [m[1], m[2]])
  : null;

if (aliasEntries === null) {
  // 块找不到 = 别名表被改形或闸门正则失效 —— 必须报红，不许静默放行
  push('G3.F', 'shared/constants.ts', '解析不出 `PROP` 别名块（块被改形，或本规则的正则失效）');
} else if (aliasEntries.length === 0) {
  push(
    'G3.F',
    'shared/constants.ts',
    '`PROP` 别名块是空的 —— 别名层现在承担"引擎用哪些键"的全部信息，空表等于没对账',
  );
} else {
  counts.别名键 += aliasEntries.length;
  const seenKey = new Map();
  for (const [alias, key] of aliasEntries) {
    if (!ALLOWED.has(key)) {
      push(
        'G3.F',
        'shared/constants.ts',
        `PROP.${String(alias)} 指向了非核心属性键 ${JSON.stringify(key)}（不在 CORE∪MOD 内 —— 拼错？）`,
      );
    }
    const prev = seenKey.get(key);
    if (prev !== undefined) {
      push(
        'G3.F',
        'shared/constants.ts',
        `PROP.${String(prev)} 与 PROP.${String(alias)} 指向同一个键 ${JSON.stringify(key)}` +
          `（别名应互不重复 —— 否则读代码的人会以为它们不同）`,
      );
    } else {
      seenKey.set(key, alias);
    }
  }
}

// ── 4.5 G3.G · 命名空间隔离：数值侧的名字 ⊥ 技能槽词表 ───────────────────────
//
//  ★ 为什么需要这条（2026-10-14）：
//    wushen 拿"**属性用拼音**（`ds`/`zj`）、**技能用英文**（`dodge`/`parry`）"
//    把两个命名空间分开（`os/const.js`）。本项目把属性改成了英文可读名之后，
//    **重新踩到了**这条线：躲闪/招架一度叫 `dodge`/`parry`，而那正是
//    `BASE_SKILLS` 的**技能 id**（★ 那两个内容目录在 **wushen** 侧：
//    `wushen/world/skill/dodge|parry/`；本项目 `newmud/world/skill/` 下还没有），
//    也是 `ENABLE_SLOTS` 里的槽名 ⇒ 读代码 / 复刻 wushen 时 grep 分不清
//    命中的到底是"躲闪值"还是"轻功技能"。故数值侧取 `evasion` / `deflect`。
//
//  判定：`PROP` 别名键 ∪ `DerivedCombat` 字段名，与 `ENABLE_SLOTS` **不相交**。
//  ★ 两侧任一解析失败或为空 ⇒ 判红（FG-7：规则失去输入不是"通过"）。
//    这里的形态与 G3.F 同类 —— 正则解析 + "解析不出来就报红"，不给静默放行留口子。
const slotsBlock = /export const ENABLE_SLOTS\s*=\s*\[([\s\S]*?)\]\s*as const;/.exec(constText);
const slots = slotsBlock?.[1]
  ? [...slotsBlock[1].matchAll(/'([^']+)'/g)].map((m) => m[1]).filter((x) => x !== undefined)
  : null;

const formulaPath = join(ROOT, 'server', 'engine', 'formula.ts');
const derivedBlock = exists(formulaPath)
  ? /export interface DerivedCombat\s*\{([\s\S]*?)\n\}/.exec(readText(formulaPath))
  : null;
const derivedFields = derivedBlock?.[1]
  ? [...derivedBlock[1].matchAll(/readonly\s+([A-Za-z][A-Za-z0-9_]*)\s*:/g)].map((m) => m[1])
  : null;

if (slots === null || slots.length === 0) {
  push('G3.G', 'shared/constants.ts', '解析不出 `ENABLE_SLOTS` 槽名（块被改形，或本规则的正则失效）');
} else if (derivedFields === null || derivedFields.length === 0) {
  push('G3.G', 'server/engine/formula.ts', '解析不出 `DerivedCombat` 字段（接口被改形，或本规则的正则失效）');
} else {
  counts.技能槽名 += slots.length;
  counts.派生字段 += derivedFields.length;
  const slotSet = new Set(slots);
  // 别名侧：aliasEntries 为 null 时 G3.F 已判红（整体仍是不通过），这里不重复报
  for (const [alias] of aliasEntries ?? []) {
    if (slotSet.has(alias)) {
      push(
        'G3.G',
        'shared/constants.ts',
        `PROP 别名键 ${JSON.stringify(alias)} 与技能槽 / 技能 id 重名 —— ` +
          `数值侧必须换个词（对照见 docs/29 §29.10）`,
      );
    }
  }
  for (const field of derivedFields) {
    if (slotSet.has(field)) {
      push(
        'G3.G',
        'server/engine/formula.ts',
        `派生字段 ${JSON.stringify(field)} 与技能槽 / 技能 id 重名 —— ` +
          `数值侧必须换个词（对照见 docs/29 §29.10）`,
      );
    }
  }
}

// ── 5. 汇总 ─────────────────────────────────────────────────────────────────

const entries =
  counts.内容prop字面量 +
  counts.内容extProp块 +
  counts.引擎属性调用 +
  counts.ext登记 +
  counts.别名键 +
  counts.技能槽名 +
  counts.派生字段;

header('G3', '常量对账', {
  'CORE 键（解析所得）': CORE.length,
  'MOD 闭集': MOD.size,
  'prop 字面量块': counts.内容prop字面量,
  'extProp 块': counts.内容extProp块,
  '引擎属性调用': counts.引擎属性调用,
  'registerExtProp 调用': counts.ext登记,
  'PROP 别名键': counts.别名键,
  '技能槽名': counts.技能槽名,
  '派生字段': counts.派生字段,
});

if (violations.length > 0) {
  process.exit(report(violations, { failText: '常量对账不一致' }));
}

if (entries === 0) {
  console.log(
    '  ⏭️  SKIP：内容层尚未使用 `prop` / `extProp`，且引擎尚无属性读写调用 —— ' +
      '本闸门当前**没有可对账的输入**。',
  );
  console.log(
    '       这不是通过。一旦内容层写出第一个 `prop: { ... }` 或 `extProp: [...]`，本闸门立即转为实检。',
  );
  process.exit(EXIT_SKIP);
}

// ── DEAD-RULE GUARD（24 册 FG-7：0 覆盖 = 死规则，必须判失败）───────────────
// ★ 逐子规则列出"输入数"与"是否必须有输入"（2026-10-15 补，26 册 §36）。
//   为什么不是"每条都必须 > 0"：G3.B / G3.C / G3.D 守的是**尚未启用的能力** ——
//   内容层还没写 `extProp`、还没 `registerExtProp`，而引擎已改用 `PROP` 别名
//   （"引擎用了哪些键"这件事由 G3.F 接住，见文件头 G3.F 说明）。它们的 0 是
//   **当前事实**、不是缺陷；强制 > 0 会当场假红（假红比漏报更伤，见 G15 头）。
//   ★ 但**必须显式声明**：某条能力启用后，把它这一列的 `false` 改成 `true` ——
//     这份表就是那条"改了要动这里"的锚。
const COVERAGE = [
  ['G3.A 内容 `prop` 字面量', counts.内容prop字面量, true],
  ['G3.B 内容 `extProp` 块', counts.内容extProp块, false], // 内容层尚未使用 extProp
  ['G3.C 引擎属性调用', counts.引擎属性调用, false], // 引擎已改用 PROP 别名（→ G3.F 接住）
  ['G3.D registerExtProp 调用', counts.ext登记, false], // 尚无内容登记扩展键
  ['G3.F `PROP` 别名表', counts.别名键, true],
  ['G3.G 技能槽名', counts.技能槽名, true],
  ['G3.G 派生字段', counts.派生字段, true],
];
const deadRules = COVERAGE.filter(([, n, required]) => required && n === 0);
if (deadRules.length > 0) {
  console.log('  ❌ 死规则守卫：以下规则本次**没有任何输入**（0 覆盖 = 死规则）—— 判失败');
  for (const [label] of deadRules) console.log(`       · ${label}`);
  console.log(
    '      （它们不该为 0。若确实暂时无输入，请把 COVERAGE 表里那一项的 `true` 改成 `false` 并写明原因。）',
  );
  process.exit(EXIT_FAIL);
}

console.log(`  ✅ 通过：${entries} 个入口点的属性键均在允许集内`);
process.exit(EXIT_PASS);

#!/usr/bin/env node
/**
 * G3 · 常量对账闸门（静态部分）
 * ============================================================================
 * 依据 docs/24 §3。守住「属性键」这一层：
 *   G3.A  内容层 `prop: { ... }` 的顶层键：**必须是字面量键**、且 ∈ CORE ∪ MOD；
 *         **旧 wushen 拼音键**（`gj`/`fy`/`ds`…）当场报「改用哪个英文键」
 *   G3.B  内容层 `extProp: [...]` 内**不得出现字符串字面量**
 *         （扩展键必须来自 registerExtProp() 的返回值，否则等于绕过登记）
 *   G3.C  引擎层属性读写调用的键字面量 ∈ CORE ∪ MOD
 *   G3.D  每个 registerExtProp() 调用：命名法合法、不与 CORE **或 MOD** 重名、
 *         owner 前缀与所在 `world/<kind>/` 目录一致、无跨 owner 抢键
 *   G3.E  禁止绕过访问器直接操作 `.props` / `.extProps` 的 Map 方法
 *   G3.G  命名空间隔离：**数值侧的名字**（`PROPERTIES` 核心键 ∪ `DerivedCombat` 字段名）
 *         与**技能槽词表**（`ENABLE_SLOTS`）必须不相交
 *         （★ 2026-10-14 新增；2026-10-18 §66 把判定对象从"别名键"换成"核心键"）
 *
 * ★★ **2026-10-18 §66 的结构性变化**（读这段之前先看，否则会以为闸门退化了）：
 *   - 数据键全改英文（`gj`→`attack`），`PROP` 别名层**已删除**；
 *   - 于是内容层**不再**写 `[PROP.attack]` 计算键，而是直接写 `attack: 20`；
 *   - **G3.F 已撤销**（它守的是别名表的值，别名表没了，对账对象消失）；
 *   - **G3.C 恢复为唯一守卫**（`formula.ts` 又写裸字面量了，它的输入回来了 ——
 *     这正是 G3.F 当初存在的理由，理由消失就该删规则，而不是留一条永远通过的规则）；
 *   - G3.A 反向新增"**不许写计算键**"：`prop: { [X]: 1 }` 静态解析不出真实键名，
 *     放行它等于给对账开一个后门（24 册 FG-7 死规则的同族）。
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

// ── 1.5 解析「旧拼音 → 新英文」历史对照表（只用于 G3.A 的报错文案）───────────
//
//  ★ 为什么闸门要读它（2026-10-18 §66）：数据键改英文之后**唯一没有变**的
//    事实是"wushen 那边还叫 `gj`" —— 于是从 wushen 抄内容时写回 `gj` 是本
//    次改造**最主要的使用风险**（29 册 §29.11.4 第 2 条：wushen 20+ 册文档里
//    全是拼音键，与代码永久错位）。报错若只说"不在允许集内"，抄的人还得去
//    翻文档；能直接说"请改用 attack"才真正把这条风险压下去。
//  ★ 表本身住在 `shared/constants.ts#LEGACY_PINYIN_KEYS`（单一来源）：
//    它的类型是 `Record<string, CoreProp>` ⇒ 再改一次名会**编译失败**，逼着同步。
//  ★ 解析失败**不判红**：G3.A 的判据不依赖它（只用它挑更好的文案）。
//    若把它做成"解析不出就判红"，改一次注释格式就会假红 —— 收益不值这个风险。
const legacyBlock = /export const LEGACY_PINYIN_KEYS[^=]*=\s*\{([\s\S]*?)\n\};/.exec(constText);
const LEGACY_TO_KEY = new Map();
for (const m of legacyBlock?.[1]?.matchAll(/^ {2}([a-z][a-z0-9_]*):\s*'([^']+)'/gm) ?? []) {
  LEGACY_TO_KEY.set(m[1], m[2]);
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

/**
 * 取 `prop: { ... }` 体内的**顶层键**，并区分书写形态：
 *
 *     { attack: 1 }           → { via: 'literal', key: 'attack' }
 *     { 'max_hp': 1 }         → { via: 'literal', key: 'max_hp' }
 *     { [PROP.attack]: 1 }    → { via: 'computed', expr: 'PROP.attack' }
 *
 * ★ 计算键**照样要解析出来**（而不是像最早的实现对 `[...]` 走"括号 → 深度 +1
 *   → 整段跳过"）。理由两次都一样：
 *   - 2026-10-18 上午：内容层改用 `[PROP.xxx]` 之后，旧实现返回**空数组**，
 *     块数照旧 8、日志照旧 ✅，但一个键都没验（24 册 FG-7 死规则形态）；
 *   - 2026-10-18 §66：数据键英文化 + 删别名层之后，计算键成了**违规写法**
 *     （静态解析不出真实键名）⇒ 必须能被识别出来判红，而不是默默跳过。
 *   ⇒ 一条判据：**看得见的东西才验得动**。解析不出来就别放行。
 */
function topLevelPropEntries(body) {
  const out = [];
  let depth = 0;
  let quote = null;
  let expectKey = true;
  let literal = null;
  let computedExpr = null;

  for (let i = 0; i < body.length; i += 1) {
    const c = body[i];

    if (quote !== null) {
      if (c === '\\') {
        i += 1;
        continue;
      }
      if (c === quote) quote = null;
      else if (expectKey && literal !== null) literal += c;
      continue;
    }

    if (c === '"' || c === "'" || c === '`') {
      quote = c;
      if (expectKey && depth === 0) literal = '';
      continue;
    }

    if (depth === 0 && expectKey && c === '[') {
      // 计算键：整段 `[...]` 取出来（内部可能是 `PROP.attack` 或任意表达式）
      let d = 0;
      let end = -1;
      for (let j = i; j < body.length; j += 1) {
        if (body[j] === '[') d += 1;
        else if (body[j] === ']') {
          d -= 1;
          if (d === 0) {
            end = j;
            break;
          }
        }
      }
      if (end < 0) break;
      computedExpr = body.slice(i + 1, end).trim();
      i = end;
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
      literal = null;
      computedExpr = null;
      continue;
    }

    if (c === ':' && expectKey) {
      if (computedExpr !== null) out.push({ via: 'computed', expr: computedExpr });
      else if (literal !== null) out.push({ via: 'literal', key: literal });
      expectKey = false;
      literal = null;
      computedExpr = null;
      continue;
    }

    if (expectKey && /[A-Za-z0-9_$]/.test(c)) literal = (literal ?? '') + c;
  }
  return out;
}

// ── 3. 扫描 ─────────────────────────────────────────────────────────────────

const violations = [];
const push = (rule, where, message) => violations.push({ rule, where, message });

const counts = {
  内容prop块: 0,
  内容prop字面量: 0,
  内容prop计算键: 0,
  内容extProp块: 0,
  引擎属性调用: 0,
  ext登记: 0,
  技能槽名: 0,
  派生字段: 0,
};

function scanWorldFile(file) {
  const relPosix = rel(file);
  const body = readCode(file).code.join('\n');

  // G3.A · `prop: { ... }` 的顶层键（**只认字面量**）
  for (const m of body.matchAll(/\bprop\s*:\s*\{/g)) {
    const openIdx = m.index + m[0].length - 1;
    const slice = findBalanced(body, openIdx);
    if (slice === null) {
      push('G3.A', relPosix, `prop 对象字面量未闭合（无法静态对账）`);
      continue;
    }
    counts.内容prop块 += 1;
    const items = topLevelPropEntries(slice.slice(1, -1));
    // ★ 一个 `prop` 块至少要能解析出 1 个键。0 个 = 写法不被本规则识别
    //   （或真的写了空对象）—— 不能当"空块"放过去，那又回到死规则。
    if (items.length === 0) {
      push('G3.A', relPosix, `prop 块里没有解析出任何键（新写法没被识别，或真的写了空对象）`);
      continue;
    }
    for (const item of items) {
      if (item.via === 'computed') {
        counts.内容prop计算键 += 1;
        // ★ 计算键在静态闸门眼里是**不透明的**：`{ [X]: 1 }` 到底写了哪个键，
        //   要真的算一遍才知道，而闸门不执行代码。2026-10-18 §66 删掉别名层之后
        //   它也确实没有必要存在了 —— 键名本身就是英文可读名，直接写字面量即可。
        //   ⇒ 判红，而不是"跳过"（跳过 = FG-7，上午刚被这条坑过）。
        push(
          'G3.A',
          relPosix,
          `prop 里用了计算键 [${item.expr}]：静态闸门解析不出真实键名 ⇒ 请直接写字面量键` +
            `（例如 \`attack: 20\`）。§66 起键名已是英文可读名，不再需要 [PROP.x] 间接层。`,
        );
        continue;
      }

      counts.内容prop字面量 += 1;
      // ① 旧 wushen 拼音键：单列一条，报错直接给出新名字（本次改造的主要风险点）
      const modern = LEGACY_TO_KEY.get(item.key);
      if (modern !== undefined) {
        push(
          'G3.A',
          relPosix,
          `prop 里写了 wushen 旧拼音键 ${JSON.stringify(item.key)}：请改用 ` +
            `${JSON.stringify(modern)}（数据键 §66 起全英文；词干表见 docs/29 §29.11.2，` +
            `全量对照见 docs/32 标识字典）`,
        );
        continue;
      }
      // ② 非核心键
      if (!ALLOWED.has(item.key)) {
        push(
          'G3.A',
          relPosix,
          `prop 里出现非核心属性键 ${JSON.stringify(item.key)}（不在 CORE∪MOD 内；` +
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

// ── 4. G3.F（**已撤销**，2026-10-18 §66）─────────────────────────────────────
//
//  ★ 保留这段注释是为了让后来人知道"这条规则曾经存在、为什么现在不在"。
//    G3.F 守的是 `PROP` 别名表的值（∈ CORE∪MOD、互不重复、非空）。它当初
//    存在的理由很具体：`formula.ts` 改写成 `getProp(props, PROP.attack)` 之后，
//    源码里再没有键**字面量**，G3.C 的计数归零 —— 那是 FG-7 的死规则形态，
//    于是把"引擎用的是哪些键"这件事挪到别名表上继续对账。
//
//  ★ §66 把数据键改成英文、别名层删掉、`formula.ts` 又写裸字面量 ⇒
//    **理由消失了**。判据是铁律 4 的镜像：**一条永远通过的规则比没有更糟**
//    （它会让人以为这里有守卫）。⇒ 删规则，让 G3.C 重新成为唯一守卫。
//    ★ 删掉的东西：本段判定、`counts.别名键`、COVERAGE 里的 `G3.F` 行、
//      2 条 G3.F 变异样本、`tests/prop-alias.test.ts`。

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
//  判定：`PROPERTIES` **核心键** ∪ `DerivedCombat` 字段名，与 `ENABLE_SLOTS` **不相交**。
//  ★ §66 之前判的是"别名键"；别名层删掉后改判**核心键** —— 覆盖面反而更广
//    （76 个键全查，而不是当初那 30 个别名）。
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
  // 核心键侧（§66 之前判的是别名键；别名层删掉后直接判核心键，覆盖面更广）
  for (const key of CORE) {
    if (slotSet.has(key)) {
      push(
        'G3.G',
        'shared/constants.ts',
        `核心属性键 ${JSON.stringify(key)} 与技能槽 / 技能 id 重名 —— ` +
          `数值侧必须换个词（对照见 docs/29 §29.10 与 docs/32 标识字典）`,
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
  counts.内容prop块 +
  counts.内容prop字面量 +
  counts.内容prop计算键 +
  counts.内容extProp块 +
  counts.引擎属性调用 +
  counts.ext登记 +
  counts.技能槽名 +
  counts.派生字段;

header('G3', '常量对账', {
  'CORE 键（解析所得）': CORE.length,
  'MOD 闭集': MOD.size,
  'prop 块数': counts.内容prop块,
  'prop 字面量键': counts.内容prop字面量,
  'prop 计算键（应恒为 0）': counts.内容prop计算键,
  'extProp 块': counts.内容extProp块,
  '引擎属性调用': counts.引擎属性调用,
  'registerExtProp 调用': counts.ext登记,
  '旧拼音对照表条目': LEGACY_TO_KEY.size,
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
//   为什么不是"每条都必须 > 0"：G3.B / G3.D 守的是**尚未启用的能力** ——
//   内容层还没写 `extProp`、还没 `registerExtProp`。它们的 0 是
//   **当前事实**、不是缺陷；强制 > 0 会当场假红（假红比漏报更伤，见 G15 头）。
//   ★ 但**必须显式声明**：某条能力启用后，把它这一列的 `false` 改成 `true` ——
//     这份表就是那条"改了要动这里"的锚。
const COVERAGE = [
  ['G3.A 内容 `prop` 块', counts.内容prop块, true],
  // ★★ 2026-10-18 §66：这一项从 `false` 改回 `true`。理由是"输入回来了"——
  //   别名层删掉之后内容层必须写字面量键，于是字面量计数**必然** > 0。
  //   ★ 这正是 §66 撤掉 G3.F 的前提：G3.C/G3.A 的输入没有消失，撤规则不会留白。
  ['G3.A 内容 `prop` 字面量键', counts.内容prop字面量, true],
  // 计算键**不设 required**：它是"一律判红"的形态，任何一条都会直接进 violations，
  // 于是"有输入"的那一轮必然是红轮 —— 拿它当覆盖判据只会制造假红。
  ['G3.A 内容 `prop` 计算键（应恒 0）', counts.内容prop计算键, false],
  ['G3.B 内容 `extProp` 块', counts.内容extProp块, false], // 内容层尚未使用 extProp
  // ★★ 2026-10-18 §66：从 `false` 改回 `true`。`formula.ts` 又写裸字面量了
  //   （`getProp(props, 'attack')`），这条规则的输入恢复 ⇒ 它重新成为唯一守卫。
  ['G3.C 引擎属性调用', counts.引擎属性调用, true],
  // ★ 这一项必须有输入：它撑起 G3.A 的"旧拼音键 ⇒ 请改用 X"文案。表被改形 /
  //   解析正则失效时 size 归 0 —— 那样 G3.A 对旧拼音只剩一句泛泛的"不在允许集内"，
  //   本次改名最主要的移植风险就没人兜了。⇒ 判失败，而不是静默降级。
  ['G3.A 旧拼音对照表', LEGACY_TO_KEY.size, true],
  ['G3.D registerExtProp 调用', counts.ext登记, false], // 尚无内容登记扩展键
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

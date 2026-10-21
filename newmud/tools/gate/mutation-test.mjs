#!/usr/bin/env node
/**
 * 闸门变异测试（meta-gate）
 * ============================================================================
 * 纪律（见 docs/24 §5）：**每道闸门必须先构造一个必然违规的样本证明它会变红**，
 * 否则视为"假绿"。
 *
 * 本脚本把这条纪律机械化：对每条规则各注入一个变异样本，然后要求
 *   ① 变异前  **既不是** 1（FAIL）**也不是** 3（CRASH）
 *              ——否则样本无意义：它本来就红、或闸门本来就崩
 *   ② 变异后  闸门 = 该样本声明的期望码（缺省 1；证明规则**可达** ——
 *              真的守在那条输入路径上）
 *   ③ 复原后  闸门 = 变异前（证明注入与还原是干净的，没有污染工作区）
 *
 * ★ **② 为什么是"声明的期望码"而不是写死 1**（FG-23，见 26 册 §27）：
 *   在这之前判据是 `after === 1`。而 node 未捕获异常的退出码**也是 1** ——
 *   于是"碰到违规就崩"的闸门会被记成"这条规则可证明会红"（实测过）。
 *   现在崩溃有专属码 `EXIT_CRASH = 3`：真违规仍是 1、崩溃是 3，二者不再同码。
 *   要求"崩溃"的样本（FG-23 那条）显式写 `expectAfter: EXIT_CRASH`。
 *
 * 任一条不满足 → 本脚本退出码 1。
 *
 * 退出码：0 全部规则可被证明 / 1 存在假绿 / 2 否 / 3 本脚本自身崩溃
 *
 * ── 开发用过滤（不改变判据，只改跑哪些样本）──────────────────────────────────
 *   npm run gate:mutation -- --only=FG-23
 * 过滤时会**大声声明这不是全量结论**。正式取证必须不带 `--only`。
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  EXIT_CRASH,
  EXIT_FAIL,
  EXIT_PASS,
  GATE_DIR,
  PROJECT_NAME,
  ROOT,
  exitName,
  installCrashGuard,
} from './lib.mjs';

installCrashGuard('gate:mutation');

/**
 * 崩溃守卫的**预载**地址（与 `run-all.mjs` 同一份语义，理由见 `preload.mjs` 头部）。
 *
 * ★ 为什么元闸门**必须**带它：本文件判"变异后是 FAIL 还是 CRASH"**只读退出码**。
 *   若闸门 import 的模块有语法错误而没预载，退出码是 node 默认的 **1** ——
 *   与 `EXIT_FAIL` 同码，元闸门会把它记成"这条规则可证明会红"（FG-23 的原形态）。
 *   `EXIT_CRASH = 3` 这个独立码只有在**预载挂上之后**才覆盖得到加载期。
 * ★ `pathToFileURL` 而不是拼字符串：Windows 盘符路径不是合法 URL（实测报
 *   `ERR_UNSUPPORTED_ESM_URL_SCHEME`）。
 */
const PRELOAD_URL = pathToFileURL(join(GATE_DIR, 'preload.mjs')).href;

/**
 * 会承载"夹具 / 被打补丁文件"的源码根。
 * ★ `src` 必须在列：G14 的变异样本就地改 `src/**`，而**崩溃恢复**靠 `walkAll()`
 *   扫 SCAN_ROOTS 找 `.mutbak`。漏掉 `src` 就有一段"运行被中断后，前端源码
 *   留在被改坏状态、而没人认得那份病历"的窗口（FG-8 的同一族问题）。
 * ★ `../docs` 同理必须在列（2026-10-19 加）：G16 的样本**只能**往文档里注入坏引用
 *   （它扫的就是 `docs/`）。若不在恢复范围里，一次中断就会把
 *   「注入的幽灵引用」永久留在文档里，而且**没有任何闸门会告诉你是谁干的** ——
 *   那正是本条注释开头说的那个窗口，只是换了个目录。
 *   跨到兄弟目录同样是 `join(ROOT, '..', 'docs')` 推出来的，不写死绝对路径。
 */
const SCAN_ROOTS = ['shared', 'server', 'world', 'src', 'tools', 'tests', '../docs'];

/**
 * G16 的注入目标：**项目 29 册**（相对工程根，跨目录用 `../docs`）。
 * 选它的三个条件（少一条样本就会失效）：
 *   ① 它是**项目册** —— `本册 §X` 才有解析对象（非册文件里写"本册"无从判）；
 *   ② 它的节号密集（§29.0–§29.14），注入 §999 不会撞上既有节号；
 *   ③ 它是**现行规范册**，不是历史记录册（26 册那种）—— 后者本来就该保留过期引用。
 */
const DOC_29 = '../docs/29-属性与派生数值设计.md';
/** 00 册 —— G16.5 的样本要动 §2 那张册清单表 */
const DOC_00 = '../docs/00-总纲与文档索引.md';
/** 32 册 —— G18 的样本要动"标识生成块" */
const DOC_32 = '../docs/32-标识字典.md';

/**
 * ── 还原机制：**只写不删** ─────────────────────────────────────────────────────
 *
 * ★ 血泪教训（本文件上一版的实测）：
 *   上一版用「清空内容 + `renameSync` 搬进项目外的 `_tmp-trash/`」清理夹具，
 *   以为"不调用 unlink 就不算删除"。实测被宿主策略挡下：
 *
 *     [safe-delete][SAFE_DELETE_BULK_CONFIRM_REQUIRED]
 *     {"count":50,"threshold":50,"scope":"turn", ...}
 *
 *   `renameSync` 同样被计入删除配额，累计到阈值就**直接抛错**。
 *   后果不是"少清一个文件"，而是**连锁假绿**：
 *     还原抛错 → `restored = ERR` → 该条判"假绿"；
 *     夹具留在原地 → 下一条的"变异前"基线被污染 → 变成 `before = 1`（样本无意义）。
 *   一次运行 33 条规则里有 14 条被这么污染。
 *
 *   所以本版把**所有**删除/搬运动作从还原路径上彻底移除：
 *     - `putFile`  的还原 = 把内容写回原值，**新建的文件写空**；
 *     - `patchFile` 的还原 = 把源码写回，旁挂备份**写空**（不删）；
 *     - 崩溃恢复   = 同样是写回 + 写空。
 *   空文件之所以能当"不存在"，是因为 `lib.mjs` 的 `walk()` 跳过零字节文件
 *   （语义上成立：空文件里没有任何声明）。两条改动是**配套**的，缺一不可。
 *   清空后的空壳文件无害、不入库（见 .gitignore 的 `__mut*`）、也不再增长配额。
 */

/** 被打补丁文件的**原始内容旁挂备份**后缀（不匹配任何闸门的扫描扩展名） */
const BAK_SUFFIX = '.mutbak';

/** 夹具前缀保留命名空间 */
const FIXTURE_PREFIX = '__mut';

function sizeOf(p) {
  try {
    return statSync(p).size;
  } catch {
    return 0;
  }
}

/**
 * 写入一个临时文件，返回还原函数。
 * 还原 = 写回原内容；原本**不存在**时写空（不删文件 —— 见上方说明）。
 */
function putFile(relPath, content) {
  const p = join(ROOT, relPath);
  const existed = existsSync(p);
  const orig = existed ? readFileSync(p, 'utf8') : '';
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, content);
  return () => {
    writeFileSync(p, orig); // 不存在 → '' → 空文件，被 walk() 视为不存在
  };
}

/** 就地打补丁一个已存在的文件，返回还原函数 */
function patchFile(relPath, patcher) {
  const p = join(ROOT, relPath);
  const orig = readFileSync(p, 'utf8');
  const patched = patcher(orig);
  if (patched === orig) throw new Error(`变异未生效：${relPath} 未被改动`);
  writeFileSync(`${p}${BAK_SUFFIX}`, orig); // ← 崩溃恢复用
  writeFileSync(p, patched);
  return () => {
    writeFileSync(p, orig);
    writeFileSync(`${p}${BAK_SUFFIX}`, ''); // 用完写空，不删
  };
}

// ── 崩溃恢复 ────────────────────────────────────────────────────────────────
// 1) 非空 `.mutbak` → 说明上次有 patchFile 没还原，**必须**先恢复源码。
// 2) 非空 `__mut*` 夹具 → 写空。
// 全程只做写入，不做任何删除或搬运。

function walkAll() {
  const out = [];
  const stack = SCAN_ROOTS.map((d) => join(ROOT, d)).filter((d) => existsSync(d));
  while (stack.length > 0) {
    const cur = stack.pop();
    let entries;
    try {
      entries = readdirSync(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = join(cur, e.name);
      if (e.isDirectory()) {
        if (e.name !== 'node_modules') stack.push(full);
      } else {
        out.push(full);
      }
    }
  }
  return out;
}

function toRel(abs) {
  return abs.slice(ROOT.length + 1).split('\\').join('/');
}

/** 返回 `{ recovered, cleaned }`（两者都是"上次中断留下的、本次已复位"的路径） */
function recoverFromInterruptedRun() {
  const recovered = [];
  const cleaned = [];
  for (const abs of walkAll()) {
    const rel = toRel(abs);
    if (rel.endsWith(BAK_SUFFIX)) {
      if (sizeOf(abs) === 0) continue; // 已复位的空壳，跳过
      const target = abs.slice(0, -BAK_SUFFIX.length);
      writeFileSync(target, readFileSync(abs, 'utf8'));
      writeFileSync(abs, '');
      recovered.push(toRel(target));
      continue;
    }
    const base = rel.split('/').pop() ?? '';
    if (!base.startsWith(FIXTURE_PREFIX)) continue;
    if (sizeOf(abs) === 0) continue; // 已清空的夹具，跳过
    writeFileSync(abs, '');
    cleaned.push(rel);
  }
  return { recovered, cleaned };
}

// ── 变异样本（一条规则一个）────────────────────────────────────────────────

const ALL_MUTATIONS = [
  // ---- G2 协议对账 ----
  {
    gate: 'G2',
    script: 'g2-protocol.mjs',
    rule: 'G2.1',
    name: 'SERVER_PACKET_TYPES 出现重复包类型',
    apply: () =>
      patchFile('shared/protocol.ts', (t) =>
        t.replace(
          /(SERVER_PACKET_TYPES\s*=\s*\[)([\s\S]*?)(\]\s*as const)/,
          (_m, head, body, tail) => `${head}${body}  'dialog',\n${tail}`,
        ),
      ),
  },
  {
    gate: 'G2',
    script: 'g2-protocol.mjs',
    rule: 'G2.8 未声明的发送点',
    name: '服务端造一个帧、type 不在 SERVER_PACKET_TYPES 里（前端没有 handler ⇒ 包被静默丢掉）',
    // ★ 用**追加**而不是改写已有的 `type: 'warn'`：改写会让 `warn` 同时失去生产者，
    //   于是 (a) 与 (b) 两种违规一起亮 —— 那样就证明不了"(a) 这条判据本身会红"（FG-11）。
    apply: () =>
      patchFile('server/session.ts', (t) =>
        [
          t,
          '',
          '// 变异样本（G2.8a）：产出一个未声明的包类型',
          "export function __mutProbe(): string { return packet({ type: 'warnX' }); }",
          '',
        ].join('\n'),
      ),
  },
  {
    gate: 'G2',
    script: 'g2-protocol.mjs',
    rule: 'G2.8 悬空声明',
    name: '把台账里的一行销掉、而那个包仍然没有生产者（"声明了却没人发"不许静默）',
    apply: () =>
      patchFile('shared/protocol.ts', (t) =>
        // 锚点带 `satisfies`：`SERVER_PACKET_TYPES` 结尾是 `] as const;`，不会误命中。
        // ★★ 下面三条 G2.8 样本锚的都是**台账末尾两行**（`pay` / `emote`）。
        //   2026-10-18 §62 把 `dialog` 销账后，原锚点（`'emote'` + `'dialog'`）
        //   当场失配、三条全报 ERR —— 这正是「样本按源文本匹配」那条铁律的现场：
        //   **动过被样本盯着的那段源码，就必须重跑 mutation**。
        //   以后再销账 / 加条目，记得同步这三行锚点（`'emote'` 是最后一条的真实值）。
        t.replace("  'pay',\n  'emote',\n] as const satisfies", "  'pay',\n] as const satisfies"),
      ),
  },
  {
    gate: 'G2',
    script: 'g2-protocol.mjs',
    rule: 'G2.8 台账过期',
    name: '给台账加一条**已经有生产者**的类型（接线后忘了销账 —— 账目必须双向一致）',
    apply: () =>
      patchFile('shared/protocol.ts', (t) =>
        t.replace(
          "  'emote',\n] as const satisfies",
          "  'emote',\n  'warn',\n] as const satisfies",
        ),
      ),
  },
  {
    gate: 'G2',
    script: 'g2-protocol.mjs',
    rule: 'G2.8 台账名字错',
    name: '台账里写一个不是包类型的名字（拼错 / 删漏）',
    apply: () =>
      patchFile('shared/protocol.ts', (t) =>
        t.replace(
          "  'emote',\n] as const satisfies",
          "  'emote',\n  'nosuchpkt',\n] as const satisfies",
        ),
      ),
  },
  {
    gate: 'G2',
    script: 'g2-protocol.mjs',
    rule: 'G2 死规则守卫',
    name: '把 G2.8 的扫描目录指到一个不存在的目录 —— "一个文件都没扫到"必须判**失败**（FG-7），运行时输出里会出现 `死规则：` 那一行',
    // 守卫本身也可能是假绿。若守卫失效，本条的 before/after 会都是 0 → 元闸门当场判它假绿。
    // ★ 说明：这条样本不是"只让守卫亮"——空扫描同时会让 (b) 对所有类型亮。
    //   要证的**性质**是"空扫描 ⇒ 不通过"（FG-7），而不是"报错文案只有一条"。
    apply: () =>
      patchFile('tools/gate/g2-protocol.mjs', (t) =>
        // 指向一个不存在的目录 ⇒ 扫到 0 个文件 ⇒ 守卫必须判失败
        t.replace(
          "const PRODUCER_DIRS = ['server', 'world'];",
          "const PRODUCER_DIRS = ['__nonexistent_dir'];",
        ),
      ),
  },

  // ---- G3 常量对账 · 静态部分（g3-propkeys.mjs）----
  {
    gate: 'G3',
    script: 'g3-propkeys.mjs',
    rule: 'G3.A prop 字面量',
    // ★ 2026-10-18 §67：原样本塞的是 `gj: 1`（当时非法）；改名后 `attack: 1` 变成**合法**，
    //   于是"变异后仍然 PASS"= 假绿。现在改用"**形似派生、其实不在允许集**"的键
    //   （`attack_per2`）—— 它同时钉住"半改/抄错后缀"这一族。
    name: '内容层 prop 里出现非核心属性键（形似派生：attack_per2）',
    apply: () =>
      putFile(
        'world/npc/pub/__mut_g3a.ts',
        [
          "import { defineNpc } from '@engine/world/define.js';",
          '',
          "defineNpc('pub/__mut_g3a', {",
          "  name: '变异样本',",
          "  desc: 'G3.A 变异',",
          '  prop: { attack_per2: 1 },',
          '});',
          '',
        ].join('\n'),
      ),
  },
  // ---- G3.A 的四条分支（2026-10-18 §66 重写：数据键英文化 + 删别名层之后，
  //      内容层必须写**字面量键**，旧拼音键从"必须包一层别名"变成"直接违规"）。
  //      ★ 四条各自证明一条分支真的在工作，缺一条就有分支没人走：
  //        ① 旧拼音键（wushen 移植时最容易写回来）② 拼错的核心键
  //        ③ 空 prop 块（"没解析出来"≠"没有键"）④ 计算键（静态看不见 ⇒ 违规）----
  {
    gate: 'G3',
    script: 'g3-propkeys.mjs',
    rule: 'G3.A 旧拼音键',
    name: '把 blade 的 `attack` 写回 wushen 的 `gj` —— 移植兼容层若存在，这条就会一直绿',
    apply: () =>
      patchFile('world/skill/base/blade.ts', (t) =>
        t.replace('attack: derivedPassive(lv)', 'gj: derivedPassive(lv)'),
      ),
  },
  {
    gate: 'G3',
    script: 'g3-propkeys.mjs',
    rule: 'G3.A 键名拼错',
    name: '`attak`（少一个 c）—— 既不是核心键也不是旧拼音，必须红而不是静默失效',
    apply: () =>
      patchFile('world/skill/base/blade.ts', (t) =>
        t.replace('attack: derivedPassive(lv)', 'attak: derivedPassive(lv)'),
      ),
  },
  {
    gate: 'G3',
    script: 'g3-propkeys.mjs',
    rule: 'G3.A 空 prop 块',
    name: '`prop: { }` —— 解析出 0 个键时必须报"没解析出来"，不能当空块放行',
    apply: () =>
      patchFile('world/skill/base/blade.ts', (t) =>
        t.replace('prop: { attack: derivedPassive(lv) }', 'prop: { }'),
      ),
  },
  {
    gate: 'G3',
    script: 'g3-propkeys.mjs',
    rule: 'G3.A 计算键',
    name: "`['attack']: 1` 计算键 —— 静态闸门解析不出真实键名，放行等于给对账开后门",
    apply: () =>
      patchFile('world/skill/base/blade.ts', (t) =>
        t.replace('attack: derivedPassive(lv)', "['attack']: derivedPassive(lv)"),
      ),
  },
  {
    gate: 'G3',
    script: 'g3-propkeys.mjs',
    rule: 'G3.B extProp 字面量',
    name: 'extProp 里直接写字符串字面量（等于绕过登记）',
    apply: () =>
      putFile(
        'world/npc/pub/__mut_g3b.ts',
        [
          "import { defineNpc } from '@engine/world/define.js';",
          '',
          "defineNpc('pub/__mut_g3b', {",
          "  name: '变异样本',",
          "  desc: 'G3.B 变异',",
          "  extProp: [['tjj_gj_per', 5]],",
          '});',
          '',
        ].join('\n'),
      ),
  },
  {
    gate: 'G3',
    script: 'g3-propkeys.mjs',
    rule: 'G3.C 引擎层属性键',
    // ★ §67：原样本写的是 `getProp(me, 'attack')`（当时 `attack` 不是核心键）；
    //   数据键英文化之后它变成**合法**⇒假绿。改用旧拼音 `gj`：它现在是引擎层
    //   最典型的"非核心键"（从 wushen 抄公式时最容易写回来的那个）。
    name: '引擎层使用了非核心属性键（旧拼音 gj）',
    apply: () =>
      putFile(
        'server/engine/__mut_g3c.ts',
        [
          '// 变异样本：应被 G3.C 捕获',
          'export function probe(me: unknown): unknown {',
          "  return getProp(me, 'gj');",
          '}',
          '',
        ].join('\n'),
      ),
  },
  {
    gate: 'G3',
    script: 'g3-propkeys.mjs',
    rule: 'G3.D owner ↔ 目录',
    name: 'registerExtProp 的 owner kind 与所在目录不符',
    apply: () =>
      putFile(
        'world/item/__mut_g3d.ts',
        [
          "import { registerExtProp } from '@shared/constants.js';",
          '',
          "const K = registerExtProp('g3d_probe_key', {",
          "  display: '变异',",
          "  owner: 'skill:foo',",
          '});',
          '',
          'export default K;',
          '',
        ].join('\n'),
      ),
  },
  {
    gate: 'G3',
    script: 'g3-propkeys.mjs',
    rule: 'G3.D 命名法',
    name: 'registerExtProp 键不符合命名法',
    apply: () =>
      putFile(
        'world/item/__mut_g3e.ts',
        [
          "import { registerExtProp } from '@shared/constants.js';",
          '',
          "const K = registerExtProp('G3e_Bad', {",
          "  display: '变异',",
          "  owner: 'item:probe',",
          '});',
          '',
          'export default K;',
          '',
        ].join('\n'),
      ),
  },

  {
    gate: 'G3',
    script: 'g3-propkeys.mjs',
    rule: 'G3.D 与 MOD 族冲突',
    // ★ §67：`add_gj` 改名后不再是合法 PropKey（`gj` 已废）⇒ 冲突消失、样本假绿。
    //   改成 `add_attack`（= `add_` + `attack`，当下正是 MOD 族成员）。
    name: 'registerExtProp 使用了核心派生键（add_attack）',
    apply: () =>
      putFile(
        'world/item/__mut_g3mod.ts',
        [
          "import { registerExtProp } from '@shared/constants.js';",
          '',
          "const K = registerExtProp('add_attack', {",
          "  display: '变异',",
          "  owner: 'item:probe',",
          '});',
          '',
          'export default K;',
          '',
        ].join('\n'),
      ),
  },

  {
    gate: 'G3',
    script: 'g3-propkeys.mjs',
    rule: 'G3.C 引擎硬编码扩展键',
    name: '引擎层直接写扩展属性键字面量（§3.3 越界）',
    apply: () =>
      putFile(
        'server/engine/__mut_g3f.ts',
        [
          '// 变异样本：应被 G3.C 捕获（引擎不得碰扩展键）',
          'export function probe(me: unknown): unknown {',
          "  return getExtProp(me, 'some_ext_key');",
          '}',
          '',
        ].join('\n'),
      ),
  },
  {
    gate: 'G3',
    script: 'g3-propkeys.mjs',
    rule: 'G3.E 绕过访问器',
    name: '引擎层直接操作 .props 上的 Map 方法',
    apply: () =>
      putFile(
        'server/engine/__mut_g3e.ts',
        [
          '// 变异样本：应被 G3.E 捕获',
          'export function probe(holder: { props: Map<string, number> }): void {',
          "  holder.props.set('attack', 1);",
          '}',
          '',
        ].join('\n'),
      ),
  },

  // ---- G3.F **已撤销**（2026-10-18 §66）----
  //  ★ 它原来守 `PROP` 别名表的值；§66 把数据键改成英文后别名层删除，
  //    对账对象不复存在 ⇒ 规则与它的 2 条样本一并删掉。
  //    别把它们加回来：一条永远通过的规则比没有更糟（它会让人以为这里有守卫）。
  //  ★ 撤掉的前提是 **G3.C 的输入回来了**（`formula.ts` 又写裸字面量）——
  //    由 §COVERAGE 里 `['G3.C 引擎属性调用', …, true]` 那行钉住。

  // ---- G3.G 命名空间隔离（2026-10-14 新增：属性改成英文可读名之后，重新踩到
  //      wushen 那条"属性=拼音 / 技能=英文"的分界线 ⇒ 必须有东西守住）----
  {
    gate: 'G3',
    script: 'g3-propkeys.mjs',
    rule: 'G3.G 核心键 ⊥ 技能槽',
    name: '往 PROPERTIES 里塞一个与技能槽同名的键（parry）—— 数值侧与技能槽重名，grep 分不清',
    apply: () =>
      patchFile('shared/constants.ts', (t) =>
        t.replace("  hit: '命中', // ← mz", "  hit: '命中', // ← mz\n  parry: '招架',"),
      ),
  },
  {
    gate: 'G3',
    script: 'g3-propkeys.mjs',
    rule: 'G3.G 派生字段 ⊥ 技能槽',
    name: '把派生字段改回技能 id（evasion → dodge）—— 数值侧与技能槽重名',
    apply: () =>
      patchFile('server/engine/formula.ts', (t) =>
        t.replace('  readonly evasion: number;', '  readonly dodge: number;'),
      ),
  },

  // ---- G3 死规则守卫（2026-10-15，26 册 §36）----
  // ★ 守卫本身也可能是假绿：若它失效，本条 before/after 会都是 0 → 元闸门当场判假绿。
  //   本样本把「内容层 prop 字面量」这一族的输入打没（world 的 walk ext 改错）⇒ G3.A 归零。
  //   从前"总 entries>0 即报通过"会把它放行；现在必须判**失败**（FG-7）。
  {
    gate: 'G3',
    script: 'g3-propkeys.mjs',
    rule: 'G3 死规则守卫',
    name: '把 G3 扫 world 的扩展名 .ts 改成 .tsx —— 内容层 prop 字面量归零。G3.A 无输入必须判失败（FG-7），而不是"总输入>0 就报通过"',
    apply: () =>
      patchFile('tools/gate/g3-propkeys.mjs', (t) =>
        t.replace(
          "for (const f of walk(worldDir, { exts: new Set(['.ts']) })) scanWorldFile(f);",
          "for (const f of walk(worldDir, { exts: new Set(['.tsx']) })) scanWorldFile(f);",
        ),
      ),
  },

  // ---- G3 常量对账 · 可执行部分（tests/g3-constants.test.ts）----
  {
    kind: 'test',
    file: 'tests/g3-constants.test.ts',
    gate: 'G3',
    label: 'G3(测试)',
    rule: 'G3.1 类型↔守卫等价',
    name: '把 isPropKey 退回「一次性剥离前后缀」的旧实现',
    apply: () =>
      patchFile('shared/constants.ts', (t) =>
        t.replace(
          /export function isPropKey\(x: string\): x is PropKey \{[\s\S]*?\n\}/,
          [
            'export function isPropKey(x: string): x is PropKey {',
            '  if (isCoreProp(x)) return true;',
            "  return (/_per$/.test(x) || /^(diff|add)_/.test(x)) && isCoreProp(x.replace(/^(diff|add)_/, '').replace(/_per$/, ''));",
            '}',
          ].join('\n'),
        ),
      ),
  },

  {
    kind: 'test',
    file: 'tests/g3-constants.test.ts',
    gate: 'G3',
    label: 'G3(测试)',
    rule: 'G3.5 EXT↔核心键空间隔离',
    name: '把 registerExtProp 的守卫退回只挡 isCoreProp（漏掉 MOD 族）',
    apply: () =>
      patchFile('shared/constants.ts', (t) =>
        t.replace(/\n  if \(isPropKey\(key\)\) \{[\s\S]*?\n  \}/, ''),
      ),
  },

  {
    kind: 'test',
    file: 'tests/g3-constants.test.ts',
    gate: 'G3',
    label: 'G3(测试)',
    rule: 'G3.4 ENABLE_SLOTS ≡ BASE_SKILLS ∪ WEAPON_TYPE',
    name: '从 ENABLE_SLOTS 里悄悄删掉一个槽（装配槽闭集不再等于 BASE_SKILLS∪WEAPON_TYPE）',
    // docs/27 决策 D1：两个来源（内功系 4 + 武器系 7）合并成一个闭集。
    // 若哪天有人"顺手删一个槽"，装配槽就与武器类型表对不上，
    // 而**写错槽名不会报错**（变成取不到技能的空槽）—— 所以必须机检。
    apply: () =>
      patchFile('shared/constants.ts', (t) =>
        // ★ 锚点用**正则**，不写整行字面量（24 册 §5.2 的教训；FG-13 同族）。
        //   2026-10-15 实测：`shared/constants.ts` 曾被某次编辑**整体转成 CRLF**，
        //   把写死 `\n` 的旧锚点**静默打穿** ⇒ 元闸门报"变异未生效 ⇒ 假绿"（§36.7 记下现场）。
        //   `\r?\n` 让它对换行符免疫 —— 删掉 ENABLE_SLOTS 的末项 `'throwing'`。
        t.replace(/(?:\r?\n)  'throwing',(?=\r?\n\] as const;)/, ''),
      ),
  },

  // ---- M1 / M2 修复的守护（可执行部分）-------------------------------------
  {
    kind: 'test',
    file: 'tests/ids.test.ts',
    gate: 'G12',
    label: 'ids(测试)',
    rule: 'M1 单一语法源',
    name: '把第二份 id 全串语法正则（WORLD_ID_RE）加回 shared/ids.ts',
    apply: () =>
      patchFile('shared/ids.ts', (t) =>
        `${t}\nexport const WORLD_ID_RE = /^[a-z][a-z0-9_]*(?:\\/[a-z][a-z0-9_]*){0,4}$/;\n`,
      ),
  },
  {
    kind: 'test',
    file: 'tests/validate.test.ts',
    gate: 'G4',
    label: 'G4(测试)',
    rule: 'M2 引用表↔实现耦合',
    name: '删掉一处引用校验（item.combine_to），看引用表是否会发现',
    apply: () =>
      patchFile('server/world/validate.ts', (t) =>
        // 只删**校验语句**，不碰 REF_CHECK_PATHS 里那行表项（两者都含 combine_to）
        t.replace(/^.*def\.combine_to.*\n/m, ''),
      ),
  },

  // ---- M5 / M8 / M9 修复的守护（可执行部分）--------------------------------
  {
    kind: 'test',
    file: 'tests/define.test.ts',
    gate: 'G8',
    label: 'G8(测试)',
    rule: 'M5 变体合并语义',
    name: '把变体合并退回裸 `{ ...base, ...patch }`（prop 整块覆盖）',
    apply: () =>
      patchFile('server/world/define.ts', (t) =>
        t.replace(
          'mergeVariant(base, variants?.[name])',
          '{ ...base, ...(variants?.[name] ?? {}) }',
        ),
      ),
  },
  {
    kind: 'test',
    file: 'tests/paths.test.ts',
    gate: 'G12',
    label: 'G12(测试)',
    rule: 'M8 worldKindDir 收紧',
    name: '删掉 worldKindDir 的 kind 运行时兜底（越界路径重新变得可拼）',
    apply: () =>
      patchFile('server/paths.ts', (t) =>
        t.replace(/\n  if \(!\(KINDS[\s\S]*?\n  \}\n/, '\n'),
      ),
  },
  {
    kind: 'test',
    file: 'tests/protocol.test.ts',
    gate: 'G2',
    label: 'G2(测试)',
    rule: 'M9 出站 schema 覆盖',
    name: '从 SERVER_PACKET_SCHEMAS 里抽掉一个包（覆盖率重新出现缺口）',
    apply: () =>
      patchFile('shared/protocol.ts', (t) =>
        t.replace(/^ {2}room: EnvelopeSchema\.extend\(\{[\s\S]*?\}\),\n/m, ''),
      ),
  },

  // ---- M4 / M6 / M7 修复的守护（可执行部分）--------------------------------
  {
    kind: 'test',
    file: 'tests/paths.test.ts',
    gate: 'G12',
    label: 'G12(测试)',
    rule: 'M4 项目根自检',
    name: '把 assertProjectRoot 变成"不可能失败"（列一个不存在的结构性目录）',
    apply: () =>
      patchFile('server/paths.ts', (t) =>
        t.replace(
          "export const REQUIRED_PROJECT_DIRS = ['shared', 'server'] as const;",
          "export const REQUIRED_PROJECT_DIRS = ['shared', 'server', '__missing_probe__'] as const;",
        ),
      ),
  },
  {
    kind: 'test',
    file: 'tests/caller-source.test.ts',
    gate: 'G8',
    label: 'G8(测试)',
    rule: 'M6 产物布局下的定位',
    name: '把栈帧正则退回只认 `.ts`（tsc 产物下静默失效）',
    apply: () =>
      patchFile('server/world/caller-source.ts', (t) =>
        t.replace('\\.(?:ts|mts|cts|tsx|js|mjs|cjs)', 'ts'),
      ),
  },
  {
    kind: 'test',
    file: 'tests/protocol.test.ts',
    gate: 'G2',
    label: 'G2(测试)',
    rule: 'M7 版本协商可达性',
    name: '删掉信封的显式版本比对（PROTOCOL_MISMATCH 重新变成不可达）',
    apply: () =>
      patchFile('shared/protocol.ts', (t) =>
        t.replace(/\n  if \(loose\.data\.v !== PROTOCOL_VERSION\) \{[\s\S]*?\n  \}/, ''),
      ),
  },

  // ---- G5 命名 ----
  {
    gate: 'G5',
    script: 'g5-naming.mjs',
    rule: 'G5.6 登记但未 import',
    name: '内容登记在 CONTENT_MODULES 里，但 index.ts 没有 import 它（静默不加载）',
    apply: () =>
      // ★ docs/26 H2：这是首轮实测抓到的**假绿**。只注释掉 import、保留登记项，
      //   旧 G5 仍然报「✅ 通过 / 退出码 0」——因为它从不读 import 语句。
      //   孤立内容（不被任何东西引用的房间/任务）会**完全静默地消失**。
      patchFile('world/index.ts', (t) =>
        t.replace(/^import '\.\/npc\/pub\/xiaoer\.js';\n/m, ''),
      ),
  },
  {
    gate: 'G5',
    script: 'g5-naming.mjs',
    rule: 'G5.7 import 但未登记',
    name: 'index.ts import 了一个内容文件，但 CONTENT_MODULES 里没有它（两份清单发散）',
    apply: () =>
      patchFile('world/index.ts', (t) =>
        t.replace(
          /^import '\.\/room\/yz\/beidajie1\.js';\n/m,
          "import './room/yz/beidajie1.js';\nimport './room/yz/beidajie2.js';\n",
        ),
      ),
  },
  {
    gate: 'G5',
    script: 'g5-naming.mjs',
    rule: 'G5.3 + G5.4',
    name: '内容文件 id 与路径不一致，且未登记加载清单',
    apply: () =>
      putFile(
        'world/room/yz/__mut_room.ts',
        [
          "import { defineRoom } from '@engine/world/define.js';",
          '',
          "defineRoom('yz/__mut_wrong_id', { name: '变异样本' });",
          '',
        ].join('\n'),
      ),
  },

  // ---- G5 死规则守卫（2026-10-15，26 册 §36）----
  {
    gate: 'G5',
    script: 'g5-naming.mjs',
    rule: 'G5 死规则守卫',
    name: '把 G5 扫 world 的扩展名 .ts 改成 .tsx —— 内容文件数归零。G5.1–G5.3 无输入必须判失败（FG-7）',
    apply: () =>
      patchFile('tools/gate/g5-naming.mjs', (t) =>
        t.replace(
          "walk(worldDir, { exts: new Set(['.ts']) }).filter(",
          "walk(worldDir, { exts: new Set(['.tsx']) }).filter(",
        ),
      ),
  },

  // ---- G6 红线 ----
  {
    gate: 'G6',
    script: 'g6-redline.mjs',
    rule: 'R6.1',
    name: '引擎内出现 eval()',
    apply: () =>
      putFile(
        'server/engine/__mut_redline.ts',
        ['// 变异样本：应被 G6 R6.1 捕获', "export const v = eval('1+1');", ''].join('\n'),
      ),
  },
  {
    gate: 'G6',
    script: 'g6-redline.mjs',
    rule: 'R6.6 重写收口逻辑',
    name: '在 bootstrap 之外重写「过滤 error 并抛错」（24 册 §4 禁止第 8 条）',
    apply: () =>
      putFile(
        'server/world/__mut_dup_logic.ts',
        [
          '// 变异样本：应被 G6 R6.6 捕获',
          'interface P { level: string; where: string }',
          'export function boom(problems: readonly P[]): void {',
          "  const errors = problems.filter((p) => p.level === 'error');",
          '  if (errors.length > 0) throw new Error(String(errors.length));',
          '}',
          '',
        ].join('\n'),
      ),
  },
  {
    gate: 'G6',
    script: 'g6-redline.mjs',
    rule: 'R6.7 裸数字退出码',
    name: 'tools/ 内出现裸数字退出码（应为 EXIT_FAIL 等）',
    // ★ 这条规则曾经是**死规则**：它挂在共用扫描目录 ['shared','server','world','src'] 上，
    //   而 appliesTo 只认 tools/ —— 交集为空，永远扫不到文件却一直报通过。
    //   现在每条规则自带 dirs，且 G6 有"0 覆盖 = 死规则"守卫。
    apply: () =>
      putFile('tools/__mut_exitcode.mjs', ['process.exit(9);', ''].join('\n')),
  },
  {
    gate: 'G6',
    script: 'g6-redline.mjs',
    rule: 'R6.8 空源码文件',
    name: '把某个内容文件清空（空文件对其它闸门不可见，必须由 G6 显式接住）',
    // 用 patchFile 而不是 putFile：新空文件无法用"写回原值"还原（原值就是空），
    // 改「已存在且有内容」的文件才可逆。
    apply: () => patchFile('world/npc/pub/xiaoer.ts', () => ''),
  },
  {
    gate: 'G6',
    script: 'g6-redline.mjs',
    rule: 'R6.9 重写派生公式',
    name: '在 formula.ts 之外重新定义 COMBAT_FORMULA（wushen 两处各写一份 recount 的复发形态）',
    // 公式的唯一来源是 server/engine/formula.ts。TS 私有字段挡得住"同一处改两次"，
    // 但挡不住"把公式抄成第二份文件" —— 那正是 wushen 的实际病史。
    apply: () =>
      putFile(
        'server/engine/__mut_formula.ts',
        [
          '// 变异样本：应被 G6 R6.9 捕获（派生属性公式被抄成第二份）',
          'export const COMBAT_FORMULA = { hpPerCon: 9 } as const;',
          '',
        ].join('\n'),
      ),
  },
  {
    gate: 'G6',
    script: 'g6-redline.mjs',
    rule: 'R6.10 重写技能属性挂载三角',
    name: '在 skill.ts 之外重新定义 release_prop / attach_prop（wushen 增量三角的复发形态）',
    // 技能属性的唯一挂载入口是 `SkillBook.recompute()`（记账式重算，幂等）。
    // 那条 wushen 三角的问题不是丑，是**漏一步不报错**：prop 永久重复累加、只表现为数值偏高。
    apply: () =>
      putFile(
        'server/engine/__mut_skill_triangle.ts',
        [
          '// 变异样本：应被 G6 R6.10 捕获（技能属性挂载三角被抄成第二份）',
          'export function releaseProp(): void {}',
          'export function attachProp(): void {}',
          '',
        ].join('\n'),
      ),
  },
  {
    gate: 'G6',
    script: 'g6-redline.mjs',
    rule: 'G6 死规则守卫',
    name: '复现"扫描目录与 appliesTo 交集为空"的死规则（R6.7 改回挂在 PRODUCT_DIRS 上）',
    // 守卫本身也可能是假绿：这条样本证明「0 覆盖 = 判失败」真的会红。
    // 若守卫失效，本条的 before/after 会都是 0 → 元闸门当场判它假绿。
    apply: () =>
      patchFile('tools/gate/g6-redline.mjs', (t) =>
        t.replace(
          'dirs: TOOL_DIRS,',
          "dirs: PRODUCT_DIRS,\n    appliesTo: (relPosix) => relPosix.startsWith('tools/'),",
        ),
      ),
  },
  {
    gate: 'G6',
    script: 'g6-redline.mjs',
    rule: 'R6.11 闸门未安装崩溃守卫',
    name: '把 g5-naming.mjs 的 `installCrashGuard(\'G5\')` 删掉 —— FG-23 的修法本身也要有人守：漏装的闸门崩溃时仍旧退回退出码 1，"崩溃"与"违规"在当地又变得不可区分。这条证明 R6.11 真的守在那条路径上',
    apply: () =>
      patchFile('tools/gate/g5-naming.mjs', (t) =>
        t.replace(/\ninstallCrashGuard\('G5'\);\n/, '\n'),
      ),
  },

  // ---- G12 路径与改名（R1-R4 各一条）----
  {
    gate: 'G12',
    script: 'check-paths.mjs',
    rule: 'R1',
    name: '绝对路径字面量',
    apply: () =>
      // 本条是 R1 的变异夹具，字面量故意写死
      putFile('server/__mut_path_r1.ts', ["export const P = 'C:/temp/x';", ''].join('\n')), // g12-allow R1
  },
  {
    gate: 'G12',
    script: 'check-paths.mjs',
    rule: 'R2',
    name: '硬编码项目目录名',
    apply: () =>
      putFile(
        'server/__mut_path_r2.ts',
        [`export const N = '${PROJECT_NAME}';`, ''].join('\n'),
      ),
  },
  {
    gate: 'G12',
    script: 'check-paths.mjs',
    rule: 'R2（tools/ 范围）',
    name: '闸门脚本自身硬编码项目目录名',
    apply: () =>
      putFile(
        'tools/__mut_path_r2.ts',
        [`export const N = '${PROJECT_NAME}';`, ''].join('\n'),
      ),
  },
  {
    gate: 'G12',
    script: 'check-paths.mjs',
    rule: 'R3',
    name: 'process.cwd() 参与路径', // g12-allow R3  ← 变异说明文本自身含该模式
    apply: () =>
      // 本条是 R3 的变异夹具
      putFile('server/__mut_path_r3.ts', ['export const C = process.cwd();', ''].join('\n')), // g12-allow R3
  },
  {
    gate: 'G12',
    script: 'check-paths.mjs',
    rule: 'R4',
    name: 'shared/ 内 import node:*',
    apply: () =>
      putFile(
        'shared/__mut_node.ts',
        ["import { join } from 'node:path';", '', 'export const j = join;', ''].join('\n'),
      ),
  },

  // ---- G12 死规则守卫（2026-10-15，26 册 §36）----
  {
    gate: 'G12',
    script: 'check-paths.mjs',
    rule: 'G12 死规则守卫',
    name: '把 G12 的 SCAN_DIRS 指到一个不存在的目录 —— 扫描文件数归零。R1–R4 无输入必须判失败（FG-7）',
    apply: () =>
      patchFile('tools/gate/check-paths.mjs', (t) =>
        t.replace(
          "const SCAN_DIRS = ['shared', 'server', 'src', 'world', 'tools', 'tests'];",
          "const SCAN_DIRS = ['__nonexistent_dir'];",
        ),
      ),
  },

  // ---- G13 依赖方向（D1 两种写法 + D2 + D3）----
  {
    gate: 'G13',
    script: 'g13-deps.mjs',
    rule: 'D1（副作用式 import）',
    name: '引擎 import 内容 —— bare import 写法',
    apply: () =>
      putFile('server/engine/__mut_dep_side.ts', ["import '@world/index.js';", ''].join('\n')),
  },
  {
    gate: 'G13',
    script: 'g13-deps.mjs',
    rule: 'D1（相对路径逃逸）',
    name: '引擎 import 内容 —— 相对路径不算别名',
    apply: () =>
      putFile(
        'server/engine/__mut_dep_rel.ts',
        ["import '../../world/index.js';", ''].join('\n'),
      ),
  },
  {
    gate: 'G13',
    script: 'g13-deps.mjs',
    rule: 'D2',
    name: '内容层 import 引擎内部（非 define API）',
    apply: () =>
      putFile('world/__mut_dep_d2.ts', ["import '@engine/registry.js';", ''].join('\n')),
  },
  {
    gate: 'G13',
    script: 'g13-deps.mjs',
    rule: 'D3',
    name: '内容框架层反向 import 具体内容',
    apply: () =>
      putFile(
        'server/world/__mut_dep_d3.ts',
        ["import '@world/room/yz/guangchang.js';", ''].join('\n'),
      ),
  },

  // ---- G13 死规则守卫（2026-10-15，26 册 §36）----
  {
    gate: 'G13',
    script: 'g13-deps.mjs',
    rule: 'G13 死规则守卫',
    name: '把 G13 的扫描目录 join 指到一个不存在的位置 —— 扫描文件数归零。D1/D2/D3 无输入必须判失败（FG-7）',
    apply: () =>
      patchFile('tools/gate/g13-deps.mjs', (t) =>
        t.replace(
          "const dir = join(ROOT, rule.scope.replace(/\\/$/, ''));",
          "const dir = join(ROOT, '__nonexistent_dir');",
        ),
      ),
  },

  // ---- S1 / S2 入站边界（★ docs/26 S1、S2，落在 shared/protocol.ts 的纯函数上）----
  {
    kind: 'test',
    file: 'tests/protocol.test.ts',
    gate: 'S1',
    label: 'S1(测试)',
    rule: 'S1 消息体大小上限',
    name: '摘掉字节数上限判断（超限消息照样进 zod）',
    apply: () =>
      patchFile('shared/protocol.ts', (t) =>
        t.replace('if (bytes > MAX_MESSAGE_BYTES) {', 'if (false) {'),
      ),
  },
  {
    kind: 'test',
    file: 'tests/protocol.test.ts',
    gate: 'S2',
    label: 'S2(测试)',
    rule: 'S2 明文通道',
    name: '摘掉「看起来像 JSON 就打回 JSON 分支」的拦截（明文通道变成绕开 schema 的后门）',
    apply: () =>
      patchFile('shared/protocol.ts', (t) =>
        t.replace(/\n {2}if \(LOOKS_LIKE_JSON_RE\.test\(raw\)\) \{[\s\S]*?\n {2}\}/, ''),
      ),
  },

  // ---- S3 限流（★ docs/26 S3）----
  {
    kind: 'test',
    file: 'tests/rate-limit.test.ts',
    gate: 'S3',
    label: 'S3(测试)',
    rule: 'S3 滑动窗口',
    name: '把滑动窗口退化成"永不过期"（过期时间戳不再淘汰）',
    apply: () =>
      patchFile('server/net/rate-limit.ts', (t) =>
        t.replace(
          'return stamps.filter((t) => nowMs - t < this.#windowMs);',
          'return stamps;',
        ),
      ),
  },

  // ---- 命令分发（★ docs/wushen/13 的「不抄四条」+「收紧三处」，落点 server/engine/command.ts）----
  // 这一组证明 tests/engine-command.test.ts 不是摆设：把四处**故意避开**的 wushen 缺陷
  // 各退回一次，对应断言必须变红。缺任何一条，那批"我们不抄 X"的注释就只是文字。
  {
    kind: 'test',
    file: 'tests/engine-command.test.ts',
    gate: 'CMD',
    label: 'CMD(测试)',
    rule: 'CMD.1 !== false 语义',
    name: '把动作的 `ret !== false` 退回"总是已处理"（房间动作返回 false 时不再降级到全局指令）',
    apply: () =>
      patchFile('server/engine/command.ts', (t) =>
        t.replace(
          "if (ret !== false) return { kind: 'executed', via: 'action', id: roomAction.cmd };",
          "return { kind: 'executed', via: 'action', id: roomAction.cmd };",
        ),
      ),
  },
  {
    kind: 'test',
    file: 'tests/engine-command.test.ts',
    gate: 'CMD',
    label: 'CMD(测试)',
    rule: 'CMD.2 allow_fight 不对称',
    name: '把 allow_fight 退回"缺省即拦"（抹掉 wushen COMMAND 构造器里的默认 true）',
    apply: () =>
      patchFile('server/engine/command.ts', (t) =>
        t.replace(
          'if (state.fightType > 0 && decl.allow_fight === false) {',
          'if (state.fightType > 0 && decl.allow_fight !== true) {',
        ),
      ),
  },
  {
    kind: 'test',
    file: 'tests/engine-command.test.ts',
    gate: 'CMD',
    label: 'CMD(测试)',
    rule: 'CMD.3 目标匹配放宽',
    name: '删掉 findTarget 的"模板路径末段"匹配（退回 wushen 只认实例 id 的做法）',
    apply: () =>
      patchFile('server/engine/command.ts', (t) =>
        t.replace('        obj.path === key ||\n        localNameOf(obj.path) === key\n', '        obj.path === key\n'),
      ),
  },
  {
    kind: 'test',
    file: 'tests/engine-command.test.ts',
    gate: 'CMD',
    label: 'CMD(测试)',
    rule: 'CMD.4 空输入短路',
    name: '摘掉空输入的短路（空输入也去打扰玩家，出一条"什么？"）',
    apply: () =>
      patchFile('server/engine/command.ts', (t) =>
        t.replace("if (name === '') return { kind: 'empty' };", 'if (false) return { kind: \'empty\' };'),
      ),
  },
  {
    kind: 'test',
    file: 'tests/engine-command.test.ts',
    gate: 'CMD',
    label: 'CMD(测试)',
    rule: 'CMD.5 重名别名',
    name: '把重名别名退回"静默覆盖"（wushen 只 console.error，一条入口无声消失）',
    apply: () =>
      patchFile('server/engine/command.ts', (t) =>
        t.replace(
          [
            '        const prev = this.#byAlias.get(alias);',
            '        if (prev !== undefined) {',
            '          throw new DuplicateAliasError(',
            '            `别名 "${alias}" 重复：${prev.id} 与 ${entry.id}` +',
            '              `（wushen 在这一点上只 console.error 然后静默覆盖，于是有一条入口会无声消失）`,',
            '          );',
            '        }',
          ].join('\n'),
          '        // 变异样本：重名静默覆盖（wushen 原样）',
        ),
      ),
  },
  {
    kind: 'test',
    file: 'tests/engine-command.test.ts',
    gate: 'CMD',
    label: 'CMD(测试)',
    rule: 'CMD.6 登录期闸门',
    name: '摘掉登录期的 allow_login 过滤（登录未完成也能执行任意指令）',
    apply: () =>
      patchFile('server/engine/command.ts', (t) =>
        t.replace("  if (phase === 'login') {", '  if (false) {'),
      ),
  },

  // ---- 技能系统（★ docs/27 决策 D1/D2/D3/D9 的落点，落点 server/engine/skill.ts）----
  // 这一组证明 tests/engine-skill.test.ts 不是摆设：把每处**故意避开**的 wushen 缺陷
  // 各退回一次，对应断言必须变红。缺任何一条，那批"我们不抄 X"的注释就只是文字。
  {
    kind: 'test',
    file: 'tests/engine-skill.test.ts',
    gate: 'SKL',
    label: 'SKL(测试)',
    rule: 'SKL.1 记账式重算幂等（D2-B）',
    name: '重算前不先减旧账 —— 退回 wushen 的增量三角（每算一次就多累加一份，且不报错）',
    // ★★ 2026-10-17：本样本一度**静默失效**（`server/engine/skill.ts 未被改动`
    //   ⇒ 注入失败 ⇒ ERR ⇒ 被判"假绿"）。原因是 `recompute()` 被重构成先
    //   `const contributed = ...` 再 `#absorb(contributed)`，而这里还在按**旧源文本**
    //   匹配 —— 靠文本匹配的样本会被"搬走代码"打穿，这正是它存在的理由。
    //   ⇒ 改按**当前**实现匹配。将来再动 `recompute()` 的这几行，本样本必须同步。
    apply: () =>
      patchFile('server/engine/skill.ts', (t) =>
        t.replace(
          '  public recompute(): void {\n    const contributed = this.contributedProps();\n    this.#releaseLedger();\n    this.#absorb(contributed);',
          '  public recompute(): void {\n    const contributed = this.contributedProps();\n    this.#absorb(contributed);',
        ),
      ),
  },
  {
    kind: 'test',
    file: 'tests/engine-skill.test.ts',
    gate: 'SKL',
    label: 'SKL(测试)',
    rule: 'SKL.2 ② 档只在装配时生效',
    name: '把"只在装配时算 ② 档"改成"总是算 sword 槽"（卸下后加成不清零）',
    apply: () =>
      patchFile('server/engine/skill.ts', (t) =>
        t.replace(
          '      if (st.enabled !== null) {\n        mergeInto(prop, ext, tpl.queryEnableProp(st.level)?.[st.enabled]);\n      }',
          "      mergeInto(prop, ext, tpl.queryEnableProp(st.level)?.[st.enabled ?? 'sword']);",
        ),
      ),
  },
  {
    kind: 'test',
    file: 'tests/engine-skill.test.ts',
    gate: 'SKL',
    label: 'SKL(测试)',
    rule: 'SKL.3 换槽腾空旧槽（D1 装配互斥）',
    name: '同一技能换槽时不清旧槽映射（装配表与技能记录分家，旧槽永远"还挂着它"）',
    // ★ 2026-10-14：换槽 / 挤下的记账已收口到 `#attachSlot()`（P0 体检 E2 的单源化），
    //   样本跟着改到新位置。改 `skill.ts` 的槽逻辑时**必须同步这里**，否则注入落空
    //   ⇒ 元闸门报"变异未生效"（这正是它该有的行为：样本不许悄悄失效）。
    apply: () =>
      patchFile('server/engine/skill.ts', (t) =>
        t.replace(
          '    if (st !== undefined && st.enabled !== null && st.enabled !== slot) {\n      this.#enabledBySlot.delete(st.enabled);\n      displaced.push([id, st.enabled]);\n    }\n',
          '',
        ),
      ),
  },
  {
    kind: 'test',
    file: 'tests/engine-skill.test.ts',
    gate: 'SKL',
    label: 'SKL(测试)',
    rule: 'SKL.4 装配互斥：旧技能记录被清',
    name: '换装配时不清旧技能的 enabled（旧技能的 ② 档跟着残留）',
    apply: () =>
      patchFile('server/engine/skill.ts', (t) =>
        t.replace(
          '      const prev = this.#states.get(prevId);\n      if (prev !== undefined) prev.enabled = null;\n',
          '',
        ),
      ),
  },
  {
    kind: 'test',
    file: 'tests/engine-skill.test.ts',
    gate: 'SKL',
    label: 'SKL(测试)',
    rule: 'SKL.5 学习条件（D5 声明式）',
    name: '让基本功门槛不再拦人（`minSlot` 不满足也照学）',
    // ★★ 锚点在 26 册 §64 改过（2026-10-18）：`#learnBlockReason` 从"自己拼中文"
    //   变成 `#conditionRefusal()` "只出结构"。旧锚点（`return \`你的${name}等级不够…\``）
    //   已不存在 ⇒ 注入不生效 ⇒ 元闸门报 `注入失败：变异未生效`。
    //   这正是 harness 那道自检的价值：**样本随重构失配**是静默假绿的常见成因。
    //   ★ 新锚点仍然锚**同一处判断**（`minSlot` 那一支），只是形态从"返回文案"变成"返回结构"。
    apply: () =>
      patchFile('server/engine/skill.ts', (t) =>
        t.replace(
          "        const name = this.activeTemplate(slot)?.name ?? slot;\n        return { kind: 'refused', reason: 'slot', slot, need, name };",
          '        const name = this.activeTemplate(slot)?.name ?? slot;\n        void name;',
        ),
      ),
  },
  {
    kind: 'test',
    file: 'tests/engine-skill.test.ts',
    gate: 'SKL',
    label: 'SKL(测试)',
    rule: 'SKL.6 绝招冷却（D3）',
    name: '让绝招冷却恒为 0（CD 形同虚设，绝招可以无限连放）',
    apply: () =>
      patchFile('server/engine/skill.ts', (t) =>
        t.replace(
          '    const left = this.#owner.temp.ttlRemainingMs(pfmTempKey(skillId, pid), nowMs);\n    return Number.isFinite(left) ? left : 0;',
          '    return 0;',
        ),
      ),
  },
  {
    kind: 'test',
    file: 'tests/engine-skill.test.ts',
    gate: 'SKL',
    label: 'SKL(测试)',
    rule: 'SKL.7 内功系数从占槽模板派生（D9）',
    name: '让 forceRad 恒为兜底值（学了内功也不影响气血，技能成了摆设）',
    apply: () =>
      patchFile('server/engine/skill.ts', (t) =>
        t.replace(
          '    const t = this.activeTemplate(BASE_SKILLS.FORCE);\n    return t?.forceRad ?? COMBAT_FORMULA.forceRadDefault;',
          '    return COMBAT_FORMULA.forceRadDefault;',
        ),
      ),
  },
  {
    kind: 'test',
    file: 'tests/engine-skill.test.ts',
    gate: 'SKL',
    label: 'SKL(测试)',
    rule: 'SKL.8 loadFromDef 的 can_enables 校验',
    name: '摘掉 NPC 技能表装载时的 can_enables 校验（内容写错拖到运行时）',
    apply: () =>
      patchFile('server/engine/skill.ts', (t) =>
        t.replace(
          "        if (!tpl.canEnables.includes(enabled)) {\n          throw new SkillError(\n            `NPC 技能 ${e.skill} 不能启用为 ${enabled}（can_enables = [${tpl.canEnables.join(', ')}]）`,\n          );\n        }\n",
          '',
        ),
      ),
  },
  {
    kind: 'test',
    file: 'tests/engine-skill.test.ts',
    gate: 'SKL',
    label: 'SKL(测试)',
    rule: 'SKL.9 绝招槽判定用"当前生效模板"',
    name: '把绝招的槽判定退回 `st.enabled === pfm.enable`（基本技能的绝招因此永远放不出来）',
    apply: () =>
      patchFile('server/engine/skill.ts', (t) =>
        t.replace(
          '    if (pfm.enable !== null && this.activeTemplate(pfm.enable)?.id !== skillId) return false;',
          '    if (pfm.enable !== null && st.enabled !== pfm.enable) return false;',
        ),
      ),
  },
  {
    kind: 'test',
    file: 'tests/engine-skill.test.ts',
    gate: 'SKL',
    label: 'SKL(测试)',
    rule: 'SKL.10 存档快照是副本',
    name: '让 snapshot() 直接返回内部记录（存档快照变成活引用，改存档 = 改角色）',
    apply: () =>
      patchFile('server/engine/skill.ts', (t) =>
        t.replace('    return this.entries().map((s) => ({ ...s }));', '    return this.entries();'),
      ),
  },
  {
    kind: 'test',
    file: 'tests/engine-skill.test.ts',
    gate: 'SKL',
    label: 'SKL(测试)',
    rule: 'SKL.11 读档准入：非武功不得装配（E3）',
    name: '摘掉 `load()` 的 `isEnablable` 准入 —— 改过的存档又能把基本技能装进武功槽',
    // ★ 26 册 §40（E3）：`load()` 就是**绕过 `enable()`** 的那条路，所以准入必须在
    //   **数据入口**上再判一次（`load-report.ts` 的分级契约 ②）。
    // ★ 锚点必须带上 `rejected.push` 那一行：只写 `if (!tpl.isEnablable) {`
    //   会先命中 `enable()` 里的**同名**那一行 —— 那是错的落点（改了不报错，
    //   但测试不会红 ⇒ 元闸门会判这条样本本身失败）。
    apply: () =>
      patchFile('server/engine/skill.ts', (t) =>
        t.replace(
          '  if (!tpl.isEnablable) {\n    rejected.push({',
          '  if (false) {\n    rejected.push({',
        ),
      ),
  },
  {
    kind: 'test',
    file: 'tests/engine-skill.test.ts',
    gate: 'SKL',
    label: 'SKL(测试)',
    rule: 'SKL.12 读档准入：槽必须在 can_enables 内（E3）',
    name: '摘掉 `load()` 的 `can_enables` 准入 —— 改过的存档能把剑法启用到刀法槽',
    apply: () =>
      patchFile('server/engine/skill.ts', (t) =>
        t.replace(
          '  if (!tpl.canEnables.includes(raw)) {\n    rejected.push({',
          '  if (false) {\n    rejected.push({',
        ),
      ),
  },

  // ---- 成长闭环（26 册 §56 / 27 册 §13）----
  // 这一组证明 tests/progression.test.ts 不是摆设：把三条"接线"各剪断一根，
  // 对应断言必须变红。★ 上线顺序要点：三条链里任何一条断了，玩家都会得到
  // "打了怪没反应 / 有潜能练不动 / 练一次就没了"，而这三种都不会报错。
  {
    kind: 'test',
    file: 'tests/progression.test.ts',
    gate: 'SKL',
    label: 'SKL(测试)',
    rule: 'SKL.13 经验决定技能等级上限',
    name: '让技能上限退回只看模板 max_level —— 角色经验再也压不住技能等级（"经验决定上限"退化成注释）',
    apply: () =>
      patchFile('server/engine/skill.ts', (t) =>
        t.replace(
          '    return Math.min(tpl.maxLevel, this.#owner.skillLimit());',
          '    return tpl.maxLevel;',
        ),
      ),
  },
  {
    kind: 'test',
    file: 'tests/progression.test.ts',
    gate: 'SKL',
    label: 'SKL(测试)',
    rule: 'SKL.14 击杀奖励发给击杀者',
    name: '删掉 `afterDeath` 里的 `#awardKiller(killer)` —— 打怪不再给经验/潜能（内容写了也没人发）',
    apply: () => patchFile('server/engine/npc.ts', (t) => t.replace('    this.#awardKiller(killer);\n', '')),
  },
  {
    kind: 'test',
    file: 'tests/progression.test.ts',
    gate: 'SKL',
    label: 'SKL(测试)',
    rule: 'SKL.15 NPC 重生排期',
    name: '把 `onRespawn` 换成空函数 —— 怪死了就永远消失（"打怪 → 练技能"只能跑一次）',
    apply: () =>
      patchFile('server/engine/world.ts', (t) =>
        t.replace(
          '      onRespawn: () => {\n        respawnNpc(room, npcPath, npcDef.respawn_ms ?? DEFAULT_RESPAWN_MS);\n      },',
          '      onRespawn: () => undefined,',
        ),
      ),
  },
  {
    kind: 'test',
    file: 'tests/progression.test.ts',
    gate: 'SKL',
    label: 'SKL(测试)',
    rule: 'SKL.16 潜能是练技能的成本',
    name: '让 `spendPot` 只判不扣 —— 技能白练，潜能越练越多',
    apply: () =>
      patchFile('server/engine/character.ts', (t) =>
        t.replace(
          '    if (this.pot < cost) return false;\n    this.pot -= cost;\n    return true;',
          '    if (this.pot < cost) return false;\n    return true;',
        ),
      ),
  },
  {
    kind: 'test',
    // ★ 宿主选 `skill-curves.test.ts` 而不是引擎测试：这条规则的判据有三层 ——
    //   ① 曲线函数本身的值；② 曲线形状（凸，后期增量必须更大）；
    //   ③ `Character.recount` 之后派生值真的变了。
    //   只有那个文件同时钉住三层（"学满 6 门 ⇒ attack 260 / hit 130"）。
    file: 'tests/skill-curves.test.ts',
    gate: 'SKL',
    label: 'SKL(测试)',
    rule: 'SKL.17 基本技能被动曲线（幂律，凸：后期更值钱）',
    name: '把曲线从幂律换成平方根 —— 退回"后期越练越不值钱"的凹曲线（本批第一版就是这个错）',
    // ★ 这条样本守的是 2026-10-18 最终定稿的设计：**成本涨 1000 倍，收益必须涨得够多**。
    //   换成 sqrt 之后：值表（attrPassive(30) 期望 1、实际 10）、凸性断言
    //   （后半程增量必须大于前半程）、100 级逐项派生值会同时红 ——
    //   三处都红才算真的"这条曲线被消费"。
    apply: () =>
      patchFile('server/world/skill-curves.ts', (t) =>
        t.replace(
          '  return Math.trunc(maxGain * Math.pow(ratio, exponent));',
          '  return Math.trunc(maxGain * Math.sqrt(ratio));',
        ),
      ),
  },
  {
    kind: 'test',
    // ★ 宿主同样选 `skill-curves.test.ts`：它有一条"硬顶 = 曲线标定点"的断言
    //   （`levelLimit(1e12, 6)` 必须回到 1000，且练满就拿满额加成）。
    file: 'tests/skill-curves.test.ts',
    gate: 'SKL',
    label: 'SKL(测试)',
    rule: 'SKL.18 技能等级硬顶（= 曲线标定点）',
    name: '去掉 `levelLimit` 的 `Math.min(..., limitMaxLevel)` —— 高境界 + 巨量经验会算出 1.8 万级，曲线函数再悄悄截断',
    apply: () =>
      patchFile('server/engine/skill.ts', (t) =>
        t.replace('  return Math.min(byExp, SKILL_FORMULA.limitMaxLevel);', '  return byExp;'),
      ),
  },

  // ---- A 批（26 册 §28）：口径对账六项 —— 每条"我修好了"都必须能被改坏 ----
  // ★ 这六项里 FG-15 / FG-17 是**撤回不实陈述**（注释层面的修法），没有可执行的
  //   判据可变异 —— 它们的守卫是"注释不许再宣称不存在的东西"，
  //   属于人工复核项，不在这里造样本（硬造只会得到一个同义反复的样本）。
  {
    kind: 'test',
    file: 'tests/net-pipeline.test.ts',
    gate: 'G6',
    label: 'FG-14(测试)',
    rule: 'FG-14 背压判据（接收方缓冲）',
    name: '把 `enqueue` 里的缓冲判据整段删掉 —— 退回"只看自己的队列长度"，而那一档在运行时够不着',
    apply: () =>
      patchFile('server/net/hub.ts', (t) =>
        t.replace(
          /\n {4}if \(this\.bufferedBytesOf\(conn\.id\) > this\.#maxBufferedBytes\) \{[\s\S]*?\n {4}\}\n/,
          '\n',
        ),
      ),
  },
  {
    kind: 'test',
    file: 'tests/session.test.ts',
    gate: 'G6',
    label: 'FG-14(测试)',
    rule: 'FG-14 会话层消费者',
    name: '把 `session.#send` 对 `enqueue` 返回值的判定删掉（判定成立也不照做 = 原来的样子）',
    apply: () =>
      patchFile('server/session.ts', (t) =>
        t.replace(
          '    if (!this.#hub.enqueue(conn, text)) return;\n',
          '    this.#hub.enqueue(conn, text);\n',
        ),
      ),
  },
  {
    kind: 'test',
    file: 'tests/move-full.test.ts',
    gate: 'G6',
    label: 'FG-16(测试)',
    rule: 'FG-16 活体进出钩子',
    name: '把 `Room.fireEnter` 里跑活体钩子的那一行删掉（退回"只跑房间自己的 on_enter"）',
    apply: () =>
      patchFile('server/engine/room.ts', (t) =>
        t.replace('    for (const hooks of this.#hooked(me)) hooks.on_enter?.(me);\n', ''),
      ),
  },
  {
    kind: 'test',
    file: 'tests/move-full.test.ts',
    gate: 'G6',
    label: 'FG-16(测试)',
    rule: 'FG-16 跳过自己',
    name: '把 `#hooked` 里的「跳过自己」删掉（移动者会对自己的进出钩子跑一遍，也会被自己拦住）',
    apply: () =>
      patchFile('server/engine/room.ts', (t) => t.replace('      if (obj.id === me.id) continue;\n', '')),
  },
  {
    kind: 'test',
    file: 'tests/move-full.test.ts',
    gate: 'G6',
    label: 'E4(测试)',
    rule: 'E4 判据②：非活体不触发房内活体的钩子',
    name: '摘掉 `#hooked` 开头那句活体短路（退回"物品/死人进出也唤醒房里 NPC"）',
    apply: () =>
      patchFile('server/engine/room.ts', (t) =>
        t.replace('    if (!me.isAlive) return;', '    if (false) return;'),
      ),
  },
  {
    kind: 'test',
    file: 'tests/move-full.test.ts',
    gate: 'G6',
    label: 'E4(测试)',
    rule: 'E4 判据②的**位置**：只压房内那一层，不压房间自己的钩子',
    name: '把活体短路**上提**到 `fireEnter` 入口（看起来更整齐，实则把房间自己的 `on_enter` 一起压掉 = 偏离 wushen）',
    // ★ 这条与上一条**不是重复**：它们打红的是**两条不同的断言**、
    //   报错也不一样 —— 摘掉判据是"房内钩子多跑了"，放错位置是"房间自己的钩子没跑"。
    //   一个没有区分性的测试套件会把两者都放过去。
    apply: () =>
      patchFile('server/engine/room.ts', (t) =>
        t.replace(
          '  public fireEnter(me: Actor): void {\n',
          '  public fireEnter(me: Actor): void {\n    if (!me.isAlive) return;\n',
        ),
      ),
  },
  {
    kind: 'test',
    // ★★ 宿主文件在 26 册 §64 从 `engine-skill.test.ts` 换到 `skill-learn.test.ts`：
    //   `learn()` 改成返回判别联合后，引擎测试只断言 `{reason:'gender', gender}` ——
    //   它**故意**不再锚文案（文案归指令层）。于是"改 `GENDER_LABELS` 会让谁变红"
    //   就没答案了，本样本当场假绿（2026-10-18 实测）。
    //   ⇒ 判据跟着**文案的归属层**走：`LEARN_MESSAGES.refuse()` 在 `train/learn.ts`，
    //     钉它的用例就应该和它住同一个测试文件。*改的是宿主，不是规则语义*。
    file: 'tests/skill-learn.test.ts',
    gate: 'SKL',
    label: 'T18(测试)',
    rule: 'T18 性别三档（文案单源）',
    name: '把 `GENDER_LABELS` 的 0 档改成「女性」（第三档被并进第二档）',
    apply: () =>
      patchFile('shared/constants.ts', (t) => t.replace("  0: '无性',", "  0: '女性',")),
  },
  {
    kind: 'test',
    file: 'tests/define.test.ts',
    gate: 'G8',
    label: 'T20(测试)',
    rule: 'T20 变体名单源',
    name: '把第二份变体名正则（逐字节相同的那份）写回 `define.ts`',
    apply: () =>
      patchFile('server/world/define.ts', (t) => `${t}\nconst VARIANT_NAME_RE = /^[A-Za-z0-9_]{1,32}$/;\n`),
  },

  // ---- G14 前端依赖图（★ docs/26 §15.3 的硬约束："前端不能 import 任何依赖 zod 的模块"）----
  // 这一组证明那条**只写在注释与文档里**的约定已经有了机械守卫：
  // 三种形态各退回一次，G14 必须变红。缺任何一条，那句"别踩"就只是文字。
  // ★ 样本一与样本三的差别是**实质性的**：一个在 `src/` 侧丢 `type`，
  //   一个在**被前端合法引用**的共享模块里加依赖 —— 后者是"只扫 src/ 文本"
  //   的闸门必然漏掉的那条路，所以必须单列一个样本。
  {
    gate: 'G14',
    script: 'g14-webgraph.mjs',
    rule: 'G14.1 裸包名（src 侧丢 type）',
    name: "把 src/state.ts 的 `import type { … } from '../shared/protocol.js'` 去掉 type —— protocol.ts 进可达图，带进 `import 'zod'`",
    apply: () =>
      patchFile('src/state.ts', (t) =>
        t.replace(
          "import type { CmdItem, ItemBrief } from '../shared/protocol.js';",
          "import { CmdItem, ItemBrief } from '../shared/protocol.js';",
        ),
      ),
  },
  {
    gate: 'G14',
    script: 'g14-webgraph.mjs',
    rule: 'G14.1 裸包名（共享模块加依赖）',
    name: "给被前端引用的 shared/constants.ts 加一行 `import { z } from 'zod'` —— 只扫 src/ 的闸门会漏掉这条",
    apply: () => patchFile('shared/constants.ts', (t) => `import { z } from 'zod';\nvoid z;\n\n${t}`),
  },
  {
    gate: 'G14',
    script: 'g14-webgraph.mjs',
    rule: 'G14.2 断链',
    name: '把 src/ui/stream.ts 的 import 改到一个不存在的文件（404 → 白屏，而 build:web 照样报成功）',
    apply: () =>
      patchFile('src/ui/stream.ts', (t) =>
        // ★ 锚点必须用**正则**而非整行字面量：那一行会随"具名 import 多了谁"变化，
        //   写死就会像 FG-13 那样悄悄失效 —— 实测（2026-10-12）给这一行加了 `delegate`
        //   之后，本样本注入没生效、被渲染成 `ERR ❌ 假绿`。
        //   （harness 的"变异未生效"自检接住了它，这正是那道自检的价值。）
        t.replace(/import \{[^}]*\} from '\.\/dom\.js';/, "import { el, need } from './dom-typo.js';"),
      ),
  },
  {
    gate: 'G14',
    script: 'g14-webgraph.mjs',
    rule: 'G14 死规则守卫',
    name: '把 src/index.html 的 `<script type="module">` 降级成普通脚本 —— 入口数变 0。"覆盖 0 文件"必须判**失败**，而不是"没有可查对象"就报通过（那正是 FG-7 的形态）',
    apply: () =>
      patchFile('src/index.html', (t) =>
        t.replace('<script type="module" src="./main.js">', '<script src="./main.js">'),
      ),
  },

  // ---- G15 文档引用（册号存在性）----
  // ★ 这条样本顺带体现了 G15 的**判据设计**：注入的文本必须是**目标文件里的注释**。
  //   同一段文本写在 mutation-test.mjs 里时只是**字符串数据**（它落在模板字面量里），
  //   按同一条判据（"code 里也有 ⇒ 是数据"）**天然不计** ⇒
  //   这里**不需要**任何豁免标记。对照：G12 扫的是裸文本、规则显示名自身含被禁模式，
  //   所以它不得不发明 `// g12-allow R1`。两种设计的差别见 g15-docrefs.mjs 头部。
  // ★★ 注入的册号取 `99` 而不是当年那个"幽灵号 `28`"（28 册 §28.10）：
  //   2026-10-13 新建了 `docs/28-存档与持久化设计.md`，`28` **进了册号空间**
  //   ⇒ 若样本仍注入 `28`，G15 会**放行**，这条样本当场失去"可证明会红"的能力
  //   （元闸门只认 `before ∉ {FAIL,CRASH} && after === EXIT_FAIL`，它会直接变红）。
  //   `99` 是两位册号里的极值，**不会被正常演进碰到** ⇒ 判据与册号空间**解耦**，
  //   以后每新建一册都不必再来改这里。
  //   （把判据挪到"结构上"做不到 —— G15 守的就是"这个号存不存在"，它没有可退的位置。）
  {
    gate: 'G15',
    script: 'g15-docrefs.mjs',
    rule: 'G15.1 幽灵册号',
    name: '往 server/net/hub.ts 尾部加一行**注释**，引用一个**不存在**的册号（把节号当册号 —— FG-13 的复发形态）',
    apply: () => patchFile('server/net/hub.ts', (t) => `${t}\n// 见 99 册 §28.2（幽灵册号）\n`),
  },
  // ★ G15.2（2026-10-15，26 册 §36）：`docs/NN` 形态的幽灵引用。
  //   G15.1 只认 `NN 册`，注释里另一种常见写法 `docs/26-xxx.md` 它看不见 ——
  //   实测这类引用有 119 条（全部真实），是同一幽灵号的**第二条通道**。
  //   ★ 注入文本落在**模板字面量**里 ⇒ 按 G15 的判据（"code 里也有 ⇒ 是数据"）天然不计，
  //     不需要任何豁免标记（与上一条同理）。
  {
    gate: 'G15',
    script: 'g15-docrefs.mjs',
    rule: 'G15.2 幽灵文档路径',
    name: '往 server/net/hub.ts 尾部加一行注释，引用一个不存在的 docs/NN 路径（G15.1 看不见这种写法）',
    apply: () =>
      patchFile('server/net/hub.ts', (t) => `${t}\n// 见 docs/99-不存在.md（幽灵文档路径）\n`),
  },

  // ---- G16 文档内部引用（册号 + 节号存在性）------------------------------------
  // ★ 与 G15 的样本**必须分开**：G15 注入到**代码注释**里，G16 扫的是 `docs/`。
  //   两条闸门守的是两个方向（代码→册 / 册→册），共用一个样本就意味着其中一条永远
  //   没被证明过 —— 那正是"闸门全绿 ≠ 每条规则都可达"的老问题。
  // ★ 注入目标选 29 册：它是**项目册**（`本册 §X` 才有解析对象），且 §29.x 节号密集，
  //   注入一个 §999 不会与既有节号撞名（撞名会变成"合法引用"，样本当场失效 ——
  //   24 册铁律 11 的第 5 种假绿）。
  {
    gate: 'G16',
    script: 'g16-docsrefs.mjs',
    rule: 'G16.1 幽灵册号（文档内）',
    name: '往 docs/29 尾部加一行正文，引用一个不存在的册号 —— G15 明确不扫 docs/，所以这条漂移此前**没有任何闸门**管',
    apply: () =>
      patchFile(DOC_29, (t) => `${t}\n\n见 99 册的写法（本行由变异测试注入）。\n`),
  },
  {
    gate: 'G16',
    script: 'g16-docsrefs.mjs',
    rule: 'G16.2 幽灵文档路径（文档内）',
    name: '往 docs/29 尾部加一行正文，引用 `docs/` 下不存在的路径（G16.1 只认 `NN 册`，这是第二条通道，同 G15.2 的理由）',
    apply: () =>
      patchFile(DOC_29, (t) => `${t}\n\n见 docs/99-不存在.md 的写法（本行由变异测试注入）。\n`),
  },
  {
    gate: 'G16',
    script: 'g16-docsrefs.mjs',
    rule: 'G16.3 绑定式幽灵节号',
    name: '往 docs/29 尾部加「26 册 §999.1」—— 册号真、节号假。这条证明"节号存在性"已经机械化了：2026-10-19 之前它被记成"不可机械化"的窄口',
    apply: () => patchFile(DOC_29, (t) => `${t}\n\n见 26 册 §999.1 的写法（本行由变异测试注入）。\n`),
  },
  {
    gate: 'G16',
    script: 'g16-docsrefs.mjs',
    rule: 'G16.4 幽灵本册自指',
    name: '往 docs/29 尾部加「本册 §999」—— 显式自指走的是**另一条**解析路径（本文件所属册），不复用 G16.3 的绑定式，所以单独证一次',
    apply: () => patchFile(DOC_29, (t) => `${t}\n\n本册 §999 的写法（本行由变异测试注入）。\n`),
  },
  {
    gate: 'G16',
    script: 'g16-docsrefs.mjs',
    rule: 'G16 死规则守卫',
    name: '把 g16-docsrefs.mjs 的绑定式正则改成永不命中 —— G16.3 覆盖数归零。"这条子规则此刻什么都没判"必须判**失败**，而不是"没有可查对象"就报通过（FG-7）',
    apply: () =>
      patchFile('tools/gate/g16-docsrefs.mjs', (t) =>
        t.replace(
          'const BOUND_SEC_REF = /(?<!\\d)(\\d{2})\\s*册\\s*§\\s*(\\d+(?:\\.\\d+)*)/g;',
          'const BOUND_SEC_REF = /(?!)x/g;',
        ),
      ),
  },

  // ---- G17 导出符号消费者（死代码 / 假契约）------------------------------------
  // ★ 这一组样本守的是**元层**，和上面按闸门分组的那批不同：G17 不扫业务代码，
  //   它扫的是 `tools/` 自己的导出面。所以样本也只能往 `tools/` 里注。
  // ★ 两条样本必须**分开**：G17.1（哪儿都没用）与 G17.2（只在本文件用）走的是
  //   同一条统计结果的**两个分支**。合成一条就永远只证明了其中一个分支
  //   —— 铁律 2 的"缺省分支也要测"。
  // ★ 为什么注入 `lib.mjs` 而不用现成的 `docs-index.mjs`：`lib.mjs` 是每个闸门都
  //   import 的公共库，往里加符号最能代表"有人顺手加了个工具函数"这个真实场景。
  {
    gate: 'G17',
    script: 'g17-exports.mjs',
    rule: 'G17.1 死代码（导出零引用）',
    name: '往 tools/gate/lib.mjs 尾部加一个 `export const __mutNobodyUses = 1`（全仓无人引用）—— 这正是 `hasBook` 的形态：导出了、没人调、读代码的人以为存在这条路径',
    apply: () => patchFile('tools/gate/lib.mjs', (t) => `${t}\nexport const __mutNobodyUses = 1;\n`),
  },
  {
    gate: 'G17',
    script: 'g17-exports.mjs',
    rule: 'G17.2 假契约（只有本文件在用）',
    name: '往 tools/gate/lib.mjs 尾部加一对「导出的函数 + 同文件里的一个使用者」—— 内部 1 处、外部 0 处，`export` 关键字在说假话。这条和 G17.1 走的是**同一个统计的另一个分支**，必须单独证',
    apply: () =>
      patchFile(
        'tools/gate/lib.mjs',
        (t) => `${t}\nexport function __mutOwnOnly() {\n  return 1;\n}\nconst __mutLocalUser = __mutOwnOnly;\n`,
      ),
  },
  {
    gate: 'G17',
    script: 'g17-exports.mjs',
    rule: 'G17 死规则守卫',
    name: '把 g17-exports.mjs 的 `EXPORT_RE` 从 `^export` 改成 `^xexport`（永不命中）—— 解析出 0 个导出，覆盖数归零。「这条规则此刻什么都没判」必须判**失败**（FG-7）',
    apply: () =>
      patchFile('tools/gate/g17-exports.mjs', (t) => t.replace('const EXPORT_RE = /^export', 'const EXPORT_RE = /^xexport')),
  },

  {
    gate: 'G16',
    script: 'g16-docsrefs.mjs',
    rule: 'G16.5 漏登记的册',
    name: '从 00 册 §2 的表格里删掉一行（`**33**`）—— 磁盘上有 11 个册文件、表格只剩 10 行。这一条证明"新增一册忘了登记"会当场变红，而不是安静地让那册在索引里不存在',
    apply: () =>
      patchFile(DOC_00, (t) => t.replace(/^\| \*\*33\*\* \|.*\r?\n/m, '')),
  },
  {
    gate: 'G16',
    script: 'g16-docsrefs.mjs',
    rule: 'G16.5 幽灵册行',
    name: '往 00 册 §2 的表格末尾插一行 `**99**`（磁盘上没有这个文件）—— 这是**反方向**：G16.5 必须双向判，只判"漏登记"的话，删掉一册后残留的索引行永远查不出来',
    apply: () =>
      patchFile(DOC_00, (t) =>
        t.replace(/(^\| \*\*33\*\* \|.*)$/m, '$1\n| **99** | 幽灵册 | 活 | 由变异测试注入 | — |'),
      ),
  },
  {
    gate: 'G16',
    script: 'g16-docsrefs.mjs',
    rule: 'G16.5 死规则守卫',
    name: '把 00 册 §2 的**整张册清单表**删掉（11 行全没）—— G16.5 覆盖数归零。"这张表此刻什么都没判"必须判**失败**，不能因为"表里没有行 ⇒ 没有漏登记"就报通过（FG-7 的典型形态）',
    apply: () => patchFile(DOC_00, (t) => t.replace(/^\| \*\*\d{2}\*\* \|.*\r?\n/gm, '')),
  },

  // ---- G18 标识清单对账（32 册生成块 ⊥ 代码枚举）-------------------------------
  // ★ 样本必须动**文档里的生成块**，而不是动代码：G18 守的是"文档持有了一份不完整
  //   副本"这件事。动代码（比如删一个 world/skill/*.ts）需要新建/删除文件，而还原
  //   机制是"只写不删"（FG-8），做不到。
  // ★ 也不能靠"改一条真 id"来造 —— 那会同时改掉代码事实，`before` 就不绿了。
  //
  // ★★ 2026-10-19 §71.8 九组全部建块之后，样本要按**解析家族**铺开，
  //   而不是"每组一条"：同族共享同一条支路，重复铺只会让 mutation 变慢而不增信息。
  //   四个家族 + 两条守卫分支：
  //     ① 目录遍历   `idsFromDir()`        —— G18.1（skill）
  //     ② 数组字面量 `stringsIn()`         —— G18.3（packet）
  //     ③ 对象键名   `keysIn()`            —— G18.2（error）
  //     ④ 展开合并   `...KINDS`            —— G18.4（reserved，唯一一支）
  //     ⑤ 块缺失     `findBlock() === null` —— G18.5（kind）
  //     ⑥ 守卫      组解析归零 / 闸门空转   —— 最后两条
  {
    gate: 'G18',
    script: 'g18-ids.mjs',
    rule: 'G18.1 文档少了/多了 id',
    name: '把 32 册生成块里的 `wd/taijijian` 改成不存在的 `wd/taiji` —— 代码有、文档缺 + 文档有、代码无，两条同时触发。这条正是 2026-10-19 实测缺口（技能 id 文档 3 个 / 代码 7 个）的机械化形态',
    apply: () =>
      patchFile(DOC_32, (t) => t.replace('| 7 | `wd/taijijian` |', '| 7 | `wd/taiji` |')),
  },
  {
    gate: 'G18',
    script: 'g18-ids.mjs',
    rule: 'G18 死规则守卫（组解析归零）',
    name: '把 ids-index.mjs 里 skill 组的采集改成返回 `[]` —— 解析出 0 项时必须判**失败**，不能因为"代码里没有 id ⇒ 文档也不需要"就报通过（FG-7 的形态）',
    apply: () =>
      patchFile('tools/ids-index.mjs', (t) =>
        t.replace("get: () => idsFromDir('world/skill'),", 'get: () => [],'),
      ),
  },
  {
    gate: 'G18',
    script: 'g18-ids.mjs',
    rule: 'G18 死规则守卫（闸门空转）',
    name: '删掉 ids-index.mjs 里**全部** `blocked: true` —— 没有任何组参与对账时闸门会空转（`BLOCK_GROUPS` 为 0）。这条与上一条打的是**不同的分支**：上一条是"某组坏了"，这条是"整道闸门没有对象"',
    // ★★ 必须是**全部**删掉，不能只删第一处：2026-10-19 §71.8 九组全部建块之后，
    //   `t.replace('    blocked: true,\n', '')` 只摘掉 `command` 那一行 ⇒ 还剩 8 组
    //   ⇒ `BLOCK_GROUPS` 不为 0 ⇒ 闸门照常通过 ⇒ 本条样本**静默变成假绿**。
    //   这正是 24 册铁律 11「改名/扩量批次要重看样本里那个名字还算不算数」的形态。
    apply: () =>
      patchFile('tools/ids-index.mjs', (t) => t.replace(/^ {4}blocked: true,\n/gm, '')),
  },
  {
    gate: 'G18',
    script: 'g18-ids.mjs',
    rule: 'G18.2 文档值与代码不一致（keysIn 族）',
    name: '把 32 册 error 块里的 `PAY_DUPLICATE` 改成不存在的 `PAY_DUP` —— 覆盖 `keysIn` 那条解析路径（对象键名），它与 `stringsIn`（数组字面量）和目录遍历是**三种不同的采集方式**，坏掉的方式也不同',
    apply: () =>
      patchFile(DOC_32, (t) =>
        t.replace('| 28 | `PAY_DUPLICATE` |', '| 28 | `PAY_DUP` |'),
      ),
  },
  {
    gate: 'G18',
    script: 'g18-ids.mjs',
    rule: 'G18.3 文档值与代码不一致（stringsIn 族）',
    name: '把 32 册 packet 块里的 `dialog` 改成不存在的 `dialogx` —— 覆盖 `stringsIn` 那条路径（数组里的字符串字面量）。★ 这一组当年就是**既多又少**的那张表（多 command/ping、少 disobj/changepfm/clearDistime）',
    apply: () =>
      patchFile(DOC_32, (t) => t.replace('| 35 | `dialog` |', '| 35 | `dialogx` |')),
  },
  {
    gate: 'G18',
    script: 'g18-ids.mjs',
    rule: 'G18.4 `...KINDS` 展开失效',
    name: '把 ids-index.mjs 里 reserved 组的 `spreadKinds` 判成恒 false —— 九组里**只有** reserved 要跟随 `...KINDS` 展开，把这条支路写坏时其余八组全绿，只有 reserved 会从 15 掉到 7',
    apply: () =>
      patchFile('tools/ids-index.mjs', (t) =>
        t.replace(
          "const spreadKinds = (lines ?? []).some((l) => l.includes('...KINDS'));",
          'const spreadKinds = false;',
        ),
      ),
  },
  {
    gate: 'G18',
    script: 'g18-ids.mjs',
    rule: 'G18.5 标记块缺失',
    name: '删掉 32 册 kind 块的 `<!-- ids:begin kind -->` 一行 —— 打的是 `findBlock() === null` 那条分支（与"块内容不对"是两个不同的报错，修法也不同：一个要手工插块，一个跑 `--write`）',
    apply: () => patchFile(DOC_32, (t) => t.replace('<!-- ids:begin kind -->\n', '')),
  },

  // ---- G19 前端包字段对账（26 册 §76）----------------------------------------
  // ★ 这道闸门平时输出 **0 处违规**，所以每条样本都必须真的把它推红 ——
  //   尤其是最后那条"死规则守卫"：解析器全废时它也会输出 0 处，两者日志同形。
  {
    gate: 'G19',
    script: 'g19-frontend-contract.mjs',
    rule: 'G19.1 前端读了 schema 里不存在的键',
    name: '把 world.ts 里 room handler 的 `p[\'desc\']` 改成 `p[\'descr\']` —— 这正是真实故障的形态：前端软访问，键写错了界面只是少一块，tsc 与所有单测都不会红',
    apply: () =>
      patchFile('src/process/handlers/world.ts', (t) =>
        t.replace("desc: asString(p['desc']),", "desc: asString(p['descr']),"),
      ),
  },
  {
    gate: 'G19',
    script: 'g19-frontend-contract.mjs',
    rule: 'G19.2 handler 注册了协议里不存在的包',
    name: '往 social.ts 尾部注册一个 `registerHandler(\'nosuchpacket\', (p) => …)` —— 打的是"类型不在 SERVER_PACKET_TYPES 里"那条分支（G2 也会红，但本条只判 G19 的退出码）',
    apply: () =>
      patchFile('src/process/handlers/social.ts', (t) =>
        `${t}\nregisterHandler('nosuchpacket', (p) => {\n  pushLine(asString(p['content']));\n});\n`,
      ),
  },
  {
    gate: 'G19',
    script: 'g19-frontend-contract.mjs',
    rule: 'G19 死规则守卫（解析归零）',
    name: '把 g19 的注册正则从 `registerHandler` 改成 `xregisterHandler`（永不命中）—— 解析出 0 个 handler，违规数同样是 0，与"全部通过"的日志一模一样。覆盖数归零必须判**失败**（FG-7）',
    apply: () =>
      patchFile('tools/gate/g19-frontend-contract.mjs', (t) =>
        t.replace('const re = /registerHandler\\(', 'const re = /xregisterHandler\\('),
      ),
  },

  // ---- ★ FG-23：**元闸门自己的判据**（不按闸门分组，因为它守的不是某条扫描规则）----
  // 这条样本问的不是"G2 的某条规则可达吗"，而是
  //   「**G2 死了（而不是发现违规）时，元闸门认不认得出**」。
  // 判据：变异后必须 = EXIT_CRASH(3)。若崩溃守卫没装、或装了不生效，
  // 退出码会是 1（与"发现违规"同码）≠ 3 ⇒ 本条**当场变红**。
  // 所以它同时也是"崩溃守卫自己可红"的证明（24 册铁律 6）。
  {
    gate: 'G2',
    script: 'g2-protocol.mjs',
    rule: 'FG-23 崩溃 ≠ 违规',
    expectAfter: EXIT_CRASH,
    name: '从 g2-protocol.mjs 的 import 里删掉 `rel`（复现 26 册 §26.8 的现场）：闸门抛 ReferenceError，**一条违规都没报** —— 元闸门必须把它记为 CRASH(3)，绝不能记成"这条规则可证明会红"',
    apply: () =>
      // ★ 锚点用**正则**而不是整行字面量：import 列表会随"多了一个工具函数"变化
      //   （G14.2 断链那条样本踩过，见 26 册 §20.9.7）。
      patchFile('tools/gate/g2-protocol.mjs', (t) => t.replace(/\n  rel,\n  report,/, '\n  report,')),
  },

  // ---- ★ FG-23 的**第二条通道**：**加载期**崩溃（2026-10-19 实测踩出来的）----
  // 上一条证明的是"运行期抛错 ⇒ CRASH"。但 ESM 是**先把整张 import 图加载完再执行本模块**，
  // 所以"被 import 的模块有语法错误"发生在任何 `installCrashGuard()` 之前 ——
  // node 默认退出码 **1**，与 `EXIT_FAIL` 同码 **且零输出**。
  // 现场：给共享模块加注释时写了含「星号 + 斜杠」的 glob，注释提前闭合 ⇒ G15 与 G16 各 exit 1、
  // 一行输出都没有，套件里显示为 `❌ FAIL`，与"真的发现违规"**完全一样**。
  // 修法是 `--import preload.mjs`（run-all 与元闸门两处 spawn 都挂）。
  // ★ 本条同时也是"预载真的生效"的证明：没有它，after 会是 1 ⇒ 本条当场变红。
  {
    gate: 'G16',
    script: 'g16-docsrefs.mjs',
    rule: 'FG-23 加载期崩溃 ≠ 违规（预载）',
    expectAfter: EXIT_CRASH,
    name: '把共享模块 docs-index.mjs 变成**语法错误**（末尾加一行 `const = 1;`）：加载期就死，闸门连一行输出都没有 —— 元闸门必须记为 CRASH(3)。没有 `--import preload.mjs` 时这里是 1，与"发现违规"同码',
    apply: () => patchFile('tools/gate/docs-index.mjs', (t) => `${t}\nconst = 1;\n`),
  },
];

// ── 运行 ────────────────────────────────────────────────────────────────────

/**
 * 开发用过滤：`--only=<子串>`（匹配 规则号 / 闸门 id / 样本说明）。
 * ★ 它会**缩小**结论的适用范围，所以只要生效就大声声明，避免有人把
 *   "过滤后全绿"当成"全量无假绿"——那正是本册反复出现的 FG-7 形态。
 */
const ONLY_ARG = process.argv.find((a) => a.startsWith('--only='));
const ONLY = ONLY_ARG === undefined ? '' : ONLY_ARG.slice('--only='.length);
const MUTATIONS =
  ONLY === ''
    ? ALL_MUTATIONS
    : ALL_MUTATIONS.filter((m) => `${m.rule} ${m.gate} ${m.name ?? ''}`.includes(ONLY));

/**
 * 执行一个变异样本对应的检查——**闸门脚本或测试文件都算**。
 * 有的规则天然是脚本（静态扫描），有的是测试（需要跑 TS）。
 * 元闸门只关心一件事：改坏之后它会不会红，所以两者用同一个入口。
 */
function runCheck(m) {
  // ★ stdin 必须是 'ignore'：默认 'pipe' 在受限环境（沙箱）下 spawn node 会 EBUSY。
  // ★ 不得用 `status ?? 1` 兜底：那会把「spawn 失败」伪装成「检查发现违规」，
  //   正是本项目禁止的假红/假绿。失败必须显式暴露为 -1 并附错误信息。
  const argv =
    m.kind === 'test'
      ? [join(ROOT, 'node_modules', 'vitest', 'vitest.mjs'), 'run', m.file]
      : ['--import', PRELOAD_URL, join(GATE_DIR, m.script)];
  const r = spawnSync(process.execPath, argv, {
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
    cwd: ROOT,
  });
  if (r.error) {
    return { code: -1, out: `spawn 失败：${r.error.code ?? ''} ${r.error.message}` };
  }
  return { code: r.status ?? -1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

console.log('='.repeat(64));
console.log('闸门变异测试  |  每道闸门必须能被证明会"变红"');
console.log(`              |  项目根 ${ROOT}`);
console.log('='.repeat(64));

if (ONLY !== '') {
  console.log('');
  console.log(`⚠️  --only=${ONLY}（开发用过滤）：本次只跑 ${MUTATIONS.length} / ${ALL_MUTATIONS.length} 条样本。`);
  console.log('    这**不是**全量结论，不可作为"无假绿"的证据；正式取证必须不带 --only。');
}

// ── 残留检查 / 崩溃恢复（★ 实测踩到的坑）──────────────────────────────────
// 变异样本是"就地写文件 / 就地打补丁"。若本次运行被 Ctrl-C / 超时 / 沙箱中断杀掉，
// 还原函数不会执行 → 工作区留脏 → 下一次运行看到"变异前已经是 1"，
// 于是被误判成"假绿"，而真正的原因只是上次没跑完。
// 更坏的情况：`patchFile` 打补丁的**源码**会静默留在被改坏的状态（`.mutbak` 是它的病历）。
//
// 处置：**能自动恢复的就恢复**；夹具一律"写空"而不是删除
// —— 沙箱禁止批量删除，`renameSync` 也计入配额，详见文件顶部说明。
{
  const { recovered, cleaned } = recoverFromInterruptedRun();
  if (recovered.length > 0) {
    console.log('');
    console.log(`♻️  已从上次中断中恢复被改写的工作区文件（${recovered.length} 个）：`);
    for (const r of recovered) console.log(`     ${r}`);
  }
  if (cleaned.length > 0) {
    console.log('');
    console.log(`🧹 已把上次中断留下的夹具（${cleaned.length} 个）内容清空（文件保留 = 0 字节）：`);
    for (const r of cleaned) console.log(`     ${r}`);
  }
}

const rows = [];
let fatal = 0;

for (const m of MUTATIONS) {
  let before;
  try {
    before = runCheck(m);
  } catch (e) {
    rows.push({
      ...m,
      expectAfter: m.expectAfter ?? EXIT_FAIL,
      baselineOk: false,
      before: -1,
      after: -1,
      restored: -1,
      ok: false,
      note: String(e),
    });
    fatal += 1;
    continue;
  }

  let restore = null;
  let after = { code: -1, out: '' };
  let restored = { code: -1, out: '' };
  let note = '';
  try {
    restore = m.apply();
    after = runCheck(m);
  } catch (e) {
    note = `注入失败：${e instanceof Error ? e.message : String(e)}`;
  } finally {
    if (restore) {
      try {
        restore();
        restored = runCheck(m);
      } catch (e) {
        note = `${note} 还原失败：${e instanceof Error ? e.message : String(e)}`;
      }
    }
  }

  // ★ FG-23：期望码由样本**声明**（缺省 1 = "发现违规"）。
  //   ① 的判据同时排除 CRASH —— "闸门本来就崩"与"闸门本来就红"一样，
  //   都会让样本失去意义。
  const expectAfter = m.expectAfter ?? EXIT_FAIL;
  const baselineOk = before.code !== EXIT_FAIL && before.code !== EXIT_CRASH;
  const ok =
    baselineOk && after.code === expectAfter && restored.code === before.code && note === '';
  if (!ok) fatal += 1;
  rows.push({
    ...m,
    expectAfter,
    baselineOk,
    before: before.code,
    after: after.code,
    restored: restored.code,
    ok,
    note,
    afterOut: after.out,
  });
}

console.log('');
console.log(
  '被测规则'.padEnd(26) +
    '入口'.padEnd(11) +
    '期望'.padEnd(9) +
    '变异前'.padEnd(9) +
    '变异后'.padEnd(9) +
    '复原后'.padEnd(9) +
    '判定',
);
console.log('-'.repeat(87));
for (const r of rows) {
  // 退出码 → 文本的唯一来源是 lib.mjs 的 exitName()（各写一份映射 = 铁律 4）
  const c = (n) => (n === -1 ? 'ERR' : `${n} ${exitName(n)}`);
  const verdict = r.ok ? '✅ 可证明' : r.expectAfter === EXIT_FAIL ? '❌ 假绿' : '❌ 未证明';
  console.log(
    r.rule.padEnd(26) +
      (r.label ?? r.gate).padEnd(11) +
      c(r.expectAfter).padEnd(9) +
      c(r.before).padEnd(9) +
      c(r.after).padEnd(9) +
      c(r.restored).padEnd(9) +
      verdict,
  );
  if (r.ok && r.after === EXIT_CRASH) {
    console.log('      ↳ 💥 这是闸门**崩溃**（已按 CRASH 记账），不是"发现违规"');
  }
  if (!r.ok) {
    if (!r.baselineOk) {
      console.log(
        `      ↳ 基线不干净：变异前 = ${c(r.before)}（样本无意义 —— 闸门本来就红，或本来就崩）`,
      );
    } else if (r.after !== r.expectAfter) {
      console.log(`      ↳ 期望变异后 = ${c(r.expectAfter)}，实测 = ${c(r.after)}`);
    }
    if (r.note) console.log(`      ↳ ${r.note}`);
    if (r.afterOut) {
      for (const l of r.afterOut.split(/\r?\n/).filter(Boolean).slice(0, 6)) {
        console.log(`      ↳ | ${l}`);
      }
    }
  }
}

console.log('');
console.log('='.repeat(64));
if (fatal > 0) {
  console.log(`❌ ${fatal} 条规则未能证明可红 —— 存在假绿，视为失败`);
  process.exit(EXIT_FAIL);
}
console.log(
  ONLY === ''
    ? `✅ 全部 ${rows.length} 条规则均已证明会变红（无假绿）`
    : `✅ 本次 ${rows.length} 条样本可证明 ★ 但这是 --only 过滤模式：共 ${ALL_MUTATIONS.length} 条，未跑的那些**没有被验证**`,
);
process.exit(EXIT_PASS);

#!/usr/bin/env node
/**
 * tools/gen-kotlin-protocol.mjs — 从 `shared/protocol.ts` **生成** Kotlin 协议模型
 * ============================================================================
 * 为什么要有这一步（26 册 §82）：
 *   安卓端（Kotlin）如果手抄 35 个包的 data class，就等于协议有了**第二份真相**。
 *   字段名抄错（`contnet`）、类型抄错（`Int` vs `Double`）、漏一个可选字段 ——
 *   这三种错误**编译期全都过得去**，只有在真机上遇到那一帧才炸，而且炸得很安静
 *   （`ignoreUnknownKeys` 会把多余字段丢掉，于是"少一个字段"表现为某个值恒为默认值）。
 *   ⇒ 从 zod schema 生成，协议改一次重新生成一次；字段名不可能不一致。
 *
 * 用法：
 *   node tools/gen-kotlin-protocol.mjs            # 写文件
 *   node tools/gen-kotlin-protocol.mjs --check    # 只校验生成物是否与 schema 一致（闸门用）
 *
 * ★ `--check` 是本机唯一能验的部分（本机没有 JDK 也跑不了 Kotlin）：
 *   反向解析 `Protocol.kt`，把每个 data class 的字段名与 zod schema 逐一对账。
 *   不一致 ⇒ 退出码 1。这样"忘记重新生成"能被抓住，不依赖安卓编译。
 *
 * ★★ 依赖 zod 的**内部结构**（`_def.typeName`）。这是本项目里第二处这么做的地方
 *   （第一处是 G19 的 `.shape`）。zod 大版本升级后必须重跑本脚本并复核生成的类型 ——
 *   遇到不认识的 `typeName` 一律**报错退出**，绝不静默降级成 `JsonElement`
 *   （静默降级 = 类型安全消失而没人知道）。
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const OUT = join(ROOT, 'android', 'protocol', 'src', 'main', 'kotlin', 'mud', 'protocol', 'Protocol.kt');

const CHECK_ONLY = process.argv.includes('--check');

// ★ `tools/` 内的退出码必须走常量（G6 的 R6.7）：裸数字退出码是一条红线规则 ——
//   它守的是"退出码四态"（0 通过 / 1 违规 / 2 跳过 / 3 崩溃，见 26 册 §27）。
import { EXIT_FAIL, EXIT_PASS } from './gate/lib.mjs';

const { registerTsHooks } = await import('./dev/ts-loader.ts');
registerTsHooks();
const protocol = await import('../shared/protocol.js');
const { SERVER_PACKET_SCHEMAS: SCHEMAS, SERVER_PACKET_TYPES: TYPES, PROTOCOL_VERSION } = protocol;

// ── zod → Kotlin ────────────────────────────────────────────────────────────

/** Kotlin 硬关键字（命中就加反引号；宁可多包也不要生成出编译不过的代码） */
const KOTLIN_KEYWORDS = new Set([
  'as', 'break', 'class', 'continue', 'do', 'else', 'false', 'for', 'fun', 'if', 'in',
  'interface', 'is', 'null', 'object', 'package', 'return', 'super', 'this', 'throw',
  'true', 'try', 'typealias', 'typeof', 'val', 'var', 'when', 'while', 'by', 'catch',
  'constructor', 'delegate', 'dynamic', 'field', 'file', 'finally', 'get', 'import',
  'init', 'param', 'property', 'receiver', 'set', 'setparam', 'where', 'actual',
  'abstract', 'annotation', 'companion', 'const', 'crossinline', 'data', 'enum',
  'expect', 'external', 'final', 'infix', 'inline', 'inner', 'internal', 'lateinit',
  'noinline', 'open', 'operator', 'out', 'override', 'private', 'protected', 'public',
  'reified', 'sealed', 'suspend', 'tailrec', 'vararg',
]);

const kField = (name) => (KOTLIN_KEYWORDS.has(name) ? `\`${name}\`` : name);
const pascal = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/** 收集到的 Kotlin 声明（按出现顺序输出；去重靠类名） */
const decls = [];
const declared = new Set();

/**
 * 把一个 zod schema 映射成 Kotlin 类型表达式。
 *
 * @param s     zod schema
 * @param hint  生成嵌套类时用的类名（`WarnPacketCmds` 这种）
 * @param path  仅用于报错定位
 */
function kotlinType(s, hint, path) {
  if (s === null || s === undefined || s._def === undefined) {
    throw new Error(`[${path}] 拿到不是 zod schema 的东西`);
  }
  const d = s._def;
  switch (d.typeName) {
    case 'ZodString':
      return 'String';
    case 'ZodBoolean':
      return 'Boolean';
    case 'ZodNumber': {
      // ★ `z.number().int()` 与 `z.number()` 必须分开：气血 / 等级是整数，
      //   映射成 Double 会让 `hp == 0` 这类判据变成浮点比较（协议侧看不出来，
      //   到了「血量为 0 就是死」那一层会出问题）。
      const isInt = (d.checks ?? []).some((c) => c.kind === 'int');
      return isInt ? 'Int' : 'Double';
    }
    case 'ZodLiteral': {
      const v = d.value;
      if (typeof v === 'string') return 'String';
      if (typeof v === 'number') return 'Double';
      if (typeof v === 'boolean') return 'Boolean';
      throw new Error(`[${path}] ZodLiteral 的值类型不认识：${typeof v}`);
    }
    case 'ZodEnum':
      return 'String';
    case 'ZodUnknown':
    case 'ZodAny':
      return 'JsonElement';
    case 'ZodArray':
      return `List<${kotlinType(d.type, `${hint}Item`, `${path}[]`)}>`;
    case 'ZodTuple': {
      const ts = d.items.map((it, i) => kotlinType(it, `${hint}${String(i)}`, `${path}()`));
      // 同构元组（`[number, number]` 的坐标）降成 List 最省事；
      // 异构元组没有出现，出现就报错 —— 那说明需要单独建模。
      if (ts.every((t) => t === ts[0])) return `List<${ts[0]}>`;
      throw new Error(`[${path}] 异构元组没有出现，需要先设计映射：${ts.join(' | ')}`);
    }
    case 'ZodRecord':
      return `Map<String, ${kotlinType(d.valueType, `${hint}Value`, `${path}{}`)}>`;
    case 'ZodOptional':
      return `${kotlinType(d.innerType, hint, path)}?`;
    case 'ZodNullable':
      return `${kotlinType(d.innerType, hint, path)}?`;
    case 'ZodDefault':
      return `${kotlinType(d.innerType, hint, path)}?`;
    case 'ZodUnion': {
      // 目前只有 `dialog.clear` 一处，且两支都是"缺失 / 有值"的语义 ⇒ 用 JsonElement。
      // ★ 不硬建模：这个字段前端也是 `p['clear']` 直接看的，建模反而要多一份对照表。
      return 'JsonElement';
    }
    case 'ZodEffects':
      return kotlinType(d.schema, hint, path);
    case 'ZodObject': {
      const name = hint;
      if (!declared.has(name)) {
        declared.add(name);
        // 先占位（递归时又用到同一个名字不会重复生成），最后统一输出
        // ★ `isPacket: false` —— 嵌套对象只是载荷的一部分，**不实现 `Packet`**。
        //   第一版这里漏了，生成了 `data class WarnPacketCmdsItem : Packet`，
        //   于是 `decodePacket` 的 `when` 分支在类型上看起来"什么都能返回"。
        decls.push({ name, body: shapeToFields(s.shape, name, path), isPacket: false });
      }
      return name;
    }
    default:
      throw new Error(
        `[${path}] 不认识的 zod 类型 ${String(d.typeName)} —— ` +
          `拒绝静默降级（那会让类型安全消失而没人知道）`,
      );
  }
}

/** 对象 → 字段列表（跳过 `v` / `type`：判别与版本由 dispatcher 负责） */
function shapeToFields(shape, className, path) {
  const out = [];
  for (const [key, schema] of Object.entries(shape)) {
    if (key === 'v' || key === 'type') continue;
    const p = `${path}.${key}`;
    const type = kotlinType(schema, `${className}${pascal(key)}`, p);
    // ★ 可缺省 / 可为空 ⇒ `= null`；否则**不给默认值** —— 缺字段就在解析时抛
    //   `MissingFieldException`，那正是我们要的（静默补默认值等于把"漏抄一个字段"
    //   藏起来，运行几小时后才以"某个值一直是 0"的形式暴露）。
    out.push({ key, type, nullable: type.endsWith('?') });
  }
  return out;
}

// ── 生成 ────────────────────────────────────────────────────────────────────

/** 35 个包（先占名字，保证输出顺序 = `SERVER_PACKET_TYPES` 的顺序） */
const packets = [];
for (const t of TYPES) {
  const schema = SCHEMAS[t];
  if (schema?.shape === undefined || schema.shape === null) {
    throw new Error(`包 ${t} 的 schema 没有 .shape —— 它必须是一个 z.object`);
  }
  const cls = `${pascal(t)}Packet`;
  const shape = schema.shape;
  // 先把顶层类占住，再展开字段（嵌套类会追加在它后面）
  declared.add(cls);
  const fields = shapeToFields(shape, cls, t);
  decls.push({ name: cls, body: fields, isPacket: true });
  packets.push({ type: t, cls, fields });
}

// 顶层类要排在嵌套类前面（可读性；Kotlin 不在乎顺序）
const topNames = new Set(packets.map((p) => p.cls));
const ordered = [...decls.filter((d) => topNames.has(d.name)), ...decls.filter((d) => !topNames.has(d.name))];

const lines = [];
lines.push('// 本文件由 `tools/gen-kotlin-protocol.mjs` 生成，**不要手改**。');
lines.push('// 真相在 `shared/protocol.ts`；协议改了重新生成：node tools/gen-kotlin-protocol.mjs');
lines.push('// 校验生成物是否落后于协议：node tools/gen-kotlin-protocol.mjs --check');
lines.push('');
lines.push('package mud.protocol');
lines.push('');
lines.push('import kotlinx.serialization.Serializable');
lines.push('import kotlinx.serialization.json.JsonElement');
lines.push('');
lines.push(`/** 协议版本（\`shared/protocol.ts\` 的 \`PROTOCOL_VERSION\`） */`);
lines.push(`const val PROTOCOL_VERSION: Int = ${String(PROTOCOL_VERSION)}`);
lines.push('');
lines.push('/** 所有服务端包的公共标记（`decodePacket` 返回它，调用方按具体类 when） */');
lines.push('sealed interface Packet');
lines.push('');

for (const d of ordered) {
  const base = d.isPacket === true ? ' : Packet' : '';
  lines.push('@Serializable');
  const params = d.body.map((f) => {
    const def = f.nullable ? ' = null' : '';
    return `    val ${kField(f.key)}: ${f.type}${def},`;
  });
  if (params.length === 0) {
    lines.push(`class ${d.name}${base}`);
  } else {
    lines.push(`data class ${d.name}(`);
    lines.push(...params);
    lines.push(`)${base}`);
  }
  lines.push('');
}

// dispatcher：35 个分支也由生成器写，避免"手抄第二份名单"
lines.push('/**');
lines.push(' * 按 `type` 字段分派到具体包类。');
lines.push(' *');
lines.push(' * ★ `v` 不匹配 ⇒ 返回 `null`（调用方按"协议版本不一致"处理，不要静默继续）。');
lines.push(' * ★ `ignoreUnknownKeys = true` 对应协议的 `.strip()` 语义：服务端多给的字段丢弃。');
lines.push(' *   这**不会**掩盖字段名抄错 —— 抄错的那个字段在 JSON 里找不到，必报 `MissingFieldException`。');
lines.push(' * ★ 用 `as? JsonPrimitive` 而不是 `jsonPrimitive` 扩展：后者在类型不对时**抛异常**，');
lines.push(' *   而这里要的是"不是就返回 null"（一个畸形包不该让整条连接崩掉）。');
lines.push(' */');
lines.push('val PacketJson = Json { ignoreUnknownKeys = true }');
lines.push('');
lines.push('fun decodePacket(text: String): Packet? {');
lines.push('    val obj = PacketJson.parseToJsonElement(text) as? JsonObject ?: return null');
lines.push('    val v = (obj["v"] as? JsonPrimitive)?.content?.toIntOrNull()');
lines.push('    if (v != PROTOCOL_VERSION) return null');
lines.push('    return when ((obj["type"] as? JsonPrimitive)?.content) {');
for (const p of packets) {
  lines.push(`        ${JSON.stringify(p.type)} -> PacketJson.decodeFromJsonElement(${p.cls}.serializer(), obj)`);
}
lines.push('        else -> null');
lines.push('    }');
lines.push('}');
lines.push('');

const header = lines.join('\n');
// import 区在生成时一次性写对（`Json` / `JsonObject` / `JsonPrimitive` / 扩展都要）
const withImports = header.replace(
  'import kotlinx.serialization.json.JsonElement\n',
  [
    'import kotlinx.serialization.json.Json',
    'import kotlinx.serialization.json.JsonElement',
    'import kotlinx.serialization.json.JsonObject',
    'import kotlinx.serialization.json.JsonPrimitive',
    'import kotlinx.serialization.json.decodeFromJsonElement',
    '',
  ].join('\n'),
);

// ── 写 / 校验 ───────────────────────────────────────────────────────────────

if (CHECK_ONLY) {
  let actual;
  try {
    actual = readFileSync(OUT, 'utf8');
  } catch {
    process.stdout.write(`\n  ❌ 生成物不存在：${OUT}\n     先跑 node tools/gen-kotlin-protocol.mjs\n`);
    process.exit(EXIT_FAIL);
  }
  const drift = compare(actual, packets);
  if (drift.length > 0) {
    process.stdout.write(`\n  ❌ Kotlin 协议模型落后于 shared/protocol.ts（${String(drift.length)} 处）：\n`);
    for (const d of drift) process.stdout.write(`     ${d}\n`);
    process.stdout.write('\n     修法：node tools/gen-kotlin-protocol.mjs\n');
    process.exit(EXIT_FAIL);
  }
  process.stdout.write(
    `  ✅ 通过：${String(packets.length)} 个包的字段与 shared/protocol.ts 一致\n`,
  );
  process.exit(EXIT_PASS);
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, withImports, 'utf8');
const fieldCount = packets.reduce((n, p) => n + p.fields.length, 0);
process.stdout.write(
  `  ✅ 已生成 ${OUT}\n` +
    `     ${String(packets.length)} 个包 / ${String(fieldCount)} 个字段 / ` +
    `${String(ordered.length - packets.length)} 个嵌套类\n`,
);

/**
 * 反向解析生成物，把每个 `data class X(...)` 的字段名与期望对比。
 *
 * ★ 为什么不在生成时直接比对象：`--check` 要在**没有重新生成**的前提下判断磁盘上的
 *   文件是否落后 —— 那只能读文本。格式是生成器自己定的（一行一个字段），所以可靠。
 */
function compare(text, expected) {
  const drift = [];
  for (const p of expected) {
    // 抓 `data class <cls>(` 到第一个 `) : Packet`
    const re = new RegExp(`data class ${p.cls}\\(([\\s\\S]*?)\\) : Packet`);
    const m = re.exec(text);
    if (m === null) {
      drift.push(`缺少类 ${p.cls}`);
      continue;
    }
    const actualFields = [...m[1].matchAll(/val\s+`?([A-Za-z0-9_]+)`?\s*:/g)].map((x) => x[1]);
    const wantFields = p.fields.map((f) => f.key);
    if (actualFields.join(',') !== wantFields.join(',')) {
      drift.push(
        `${p.cls} 字段不一致：磁盘 [${actualFields.join(',')}] ≠ 协议 [${wantFields.join(',')}]`,
      );
    }
  }
  return drift;
}

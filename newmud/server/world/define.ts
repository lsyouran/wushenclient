/**
 * server/world/define.ts — 内容层唯一注册入口
 * ============================================================================
 * 取代 wushen 的"脚本体 + vm.compileFunction"：
 *   内容是普通 TS 模块，通过 `define*()` 显式声明对象。
 *   好处：可静态分析、可编译期查错、可 tree-shake、无需 vm 沙箱（24 册 D 系列决策）。
 *
 * 每个 define* 做三件事：
 *   ① 校验 id 语法（asWorldId）
 *   ② 展开 `variants`（`#0` / `#1` …，等价 wushen 的 `#` 变体参数）
 *   ③ 写注册表（重复即抛错）
 *
 * ⚠️ 文件路径 ↔ id 的一致性**不在这里校验**（运行时拿文件路径不可靠），
 *    由静态闸门 G5 负责（见 tools/gate/）。
 */

import { asWorldIdForKind, IdError, VARIANT_RE } from '@shared/ids.js';
import type { Kind, WorldId } from '@shared/ids.js';
import { register } from '../engine/registry.js';
import { bestEffortCallerSource } from './caller-source.js';
import type { DefMap } from './defs.js';

// ★ 变体名正则**不在这里**（T20）：它只有一份，在 `shared/ids.ts` 的 `VARIANT_RE`，
//   与 `parseWorldId()` 校验 `id#变体` 时用的是同一个。
//   这里原先自留了一份逐字节相同的 `VARIANT_NAME_RE` —— 教科书式的"第二份真相"：
//   两处今天一致不代表明天一致，改一处另一处静默漂移（24 册 §3）。
//   `tests/define.test.ts` 用两组断言钉住：行为等价 + 源码里不许再出现第二份。

/** 去掉 `variants` 字段（展开基对象时用） */
function stripVariants<T extends object>(def: T): T {
  const copy = { ...def } as T & { variants?: unknown };
  delete copy.variants;
  return copy;
}

function isPlainObject(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

/**
 * `extProp` 的并集：按 `[key, value]` 的 key 合并，**变体赢**，且保持基对象顺序。
 * 基对象里有、变体里没有的键必须留住 —— 否则"只调一个属性"就得复制整张表。
 */
function unionExtProp(base: readonly unknown[], patch: readonly unknown[]): unknown[] {
  const order: string[] = [];
  const byKey = new Map<string, unknown>();
  for (const pair of [...base, ...patch]) {
    if (!Array.isArray(pair) || pair.length === 0) continue;
    const key = String(pair[0]);
    if (!byKey.has(key)) order.push(key);
    byKey.set(key, pair);
  }
  return order.map((k) => byKey.get(k));
}

/**
 * 变体合并语义（★ docs/26 M5 —— 之前是"整块覆盖"且**没有文档**）：
 *
 *   - **键值映射型字段**（`prop` / `extProp`）：**并集**，变体赢。
 *     理由：这两个字段的整个意义就是"一组数值修正"。整块替换会让
 *     `variants: { '1': { prop: { gj: 20 } } }` 把基对象的其余属性**全部丢掉**，
 *     而作者的本意几乎必然是"攻击改成 20，别的照旧"。
 *   - **其余字段**（标量 / 数组 / 函数）：**覆盖**语义（变体给了就以变体为准）。
 *     数组不做拼接：`drops` 这类"完整清单"被拼接会得到无法预测的掉落表。
 *
 * 两种语义都由 `tests/define.test.ts` 显式钉住 —— 不靠"看代码猜"。
 */
function mergeVariant(base: object, patch: object | undefined): object {
  const b = base as unknown as Record<string, unknown>;
  const p = (patch ?? {}) as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = { ...b, ...p };

  // 变体里再写 `variants` 没有意义（不支持嵌套变体），一律剥掉
  delete out['variants'];

  const bp = b['prop'];
  const vp = p['prop'];
  if (isPlainObject(bp) && isPlainObject(vp)) out['prop'] = { ...bp, ...vp };

  const be = b['extProp'];
  const ve = p['extProp'];
  if (Array.isArray(be) && Array.isArray(ve)) out['extProp'] = unionExtProp(be, ve);

  return out;
}

function define<K extends Kind>(kind: K, rawId: string, def: DefMap[K]): void {
  const id = asWorldIdForKind(rawId, kind, `define:${kind}`);
  const source = bestEffortCallerSource();
  const variants = (def as { variants?: Record<string, Record<string, unknown>> })
    .variants;
  const base = stripVariants(def);

  // 先把所有变体名与 id 校验完，再统一落库：
  // 避免"基对象已注册、变体校验失败"留下的半个对象。
  // 注意类型是 `WorldId`（品牌）而不是 `string`：registry.register 只收已校验的 id。
  const variantIds: Array<[string, WorldId]> = [];
  if (variants !== undefined) {
    for (const name of Object.keys(variants)) {
      if (!VARIANT_RE.test(name)) {
        throw new IdError(`非法变体名 ${JSON.stringify(name)}（${kind} "${id}"）`);
      }
      variantIds.push([
        name,
        asWorldIdForKind(`${id}#${name}`, kind, `variant:${kind}`),
      ]);
    }
  }

  register(kind, id, base, { source });

  for (const [name, variantId] of variantIds) {
    register(kind, variantId, mergeVariant(base, variants?.[name]), {
      source,
      variantOf: id,
    });
  }
}

// ---------------------------------------------------------------------------
// 对外 API（内容层只从这里 import）
// ---------------------------------------------------------------------------

export function defineRoom(id: string, def: DefMap['room']): void {
  define('room', id, def);
}

export function defineArea(id: string, def: DefMap['area']): void {
  define('area', id, def);
}

export function defineNpc(id: string, def: DefMap['npc']): void {
  define('npc', id, def);
}

export function defineItem(id: string, def: DefMap['item']): void {
  define('item', id, def);
}

export function defineSkill(id: string, def: DefMap['skill']): void {
  define('skill', id, def);
}

export function defineFamily(id: string, def: DefMap['family']): void {
  define('family', id, def);
}

export function defineCommand(id: string, def: DefMap['command']): void {
  define('command', id, def);
}

export function defineTask(id: string, def: DefMap['task']): void {
  define('task', id, def);
}

export type { DefMap };

/**
 * 目标查找（`<id>` / 名字 / 模板路径 / 路径末段任一命中）。
 *
 * ★ 定义在 `server/engine/command.ts`（它是 `dispatch` 第 ③ 级的实现），
 *   但**内容层的指令需要它**：wushen 的 `select.js` / `look.js` 就是
 *   `me.environment.find_obj(arg)` —— 指令自己解析目标是那条链路的原生形态。
 *
 * ★ 为什么用**转出**（re-export）而不是让内容直接 `import '@engine/engine/command.js'`：
 *   G13 闸门的 **D2** 明令内容层（`world/**`）只能 import `@shared/**` 与
 *   `server/world/**`，不得触碰 `server/engine/**`（否则引擎与内容黏死、
 *   引擎一改内容全崩）。`server/world/define.ts` 是内容层的**唯一对外出口**
 *   （见上方 "对外 API" 一节），转出正好把引擎能力"开一个受控的口"给内容用。
 *
 * ★ 无环：`engine/command.ts` 对世界的依赖全部是 `import type`（编译期抹除），
 *   运行时零 import —— 于是 `define.ts → command.ts` 这条边不会绕回来。
 */
export { findTarget } from '../engine/command.js';

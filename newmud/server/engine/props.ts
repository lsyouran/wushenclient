/**
 * server/engine/props.ts — 属性读写的**唯一入口**
 * ============================================================================
 * 取代 wushen 的 `CHARACTER.prototype.query_prop / add_prop / clear_prop`
 * （`os/char/chara_prop.js:3-19`）。四处关键差异，每一处都是对既有缺陷的根治：
 *
 * 1. **键有类型**
 *    核心访问器只接受 `PropKey`（CORE + 派生 MOD）；扩展键必须走 `getExtProp`
 *    系列，只接受品牌类型 `ExtProp`（唯一来源是 `registerExtProp()`）。
 *    引擎与内容的属性边界由类型系统强制，不再靠自觉（24 册 §3.3）。
 *
 * 2. **数值必须有限**（wushen 实际缺陷，见下）
 *    wushen 的 `add_prop` 只做了 `if (!p) return`，对值**不做任何检查**：
 *      `add_prop('gj', undefined)` → `0 + undefined` = **NaN**
 *      `add_prop('gj', '5')`       → `0 + '5'`       = **'05'**（字符串）
 *    两种都**静默**污染后续所有公式，事后极难定位。这里改为抛 `PropValueError`。
 *
 * 3. **核心 / 扩展物理隔离**
 *    两套属性存在**两个 Map** 里（`props` / `extProps`），而不是一个大桶。
 *    这样「扩展键永不参与核心公式」不只是类型约定，而是存储层不变量。
 *
 * 4. **不可信数据有闸口**
 *    存档 / 协议 / 内容热更进来的键值一律先过 `loadProps()`：逐键校验，
 *    未登记的键**记账到 `rejected` 而不写进表**。wushen 的 121 vs 70
 *    （使用了 121 个键、只定义 70 个）就是缺了这一层：写进去也没人拦，
 *    于是错键一路静默到运行时。
 *    ★ **分级口径（结构性抛 / 条目级丢+记账 / 调用方"报告非空即失败"）是三处共用的契约**，
 *      单源在 `server/engine/load-report.ts`（temp / skill 同此），理由与后果见该文件头注释
 *      与 28 册 §28.5.5。
 *
 * ⚠️ 除本文件外，任何地方都不得直接访问 `.props` / `.extProps`
 *    （由 G3.E 闸门扫描；本文件是唯一豁免，因为访问器就实现在这里）。
 */

import { isExtProp, isPropKey } from '@shared/constants.js';
import type { ExtProp, PropKey } from '@shared/constants.js';
import { describeValue, isPlainRecord } from './load-report.js';
import type { LoadReport, RejectedEntry } from './load-report.js';

// ---------------------------------------------------------------------------
// 容器
// ---------------------------------------------------------------------------

/** 属性值非法（NaN / Infinity / 非数值 / 未登记的扩展键） */
export class PropValueError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PropValueError';
  }
}

/**
 * 属性容器的最小契约。
 * `Character` / NPC / Item 实例都实现它即可被本模块的函数操作，
 * 不需要它们继承任何引擎基类（与 `server/world/defs.ts` 的 `Actor` 同一取向）。
 */
export interface PropHolder {
  /** 核心属性（CORE + 派生 MOD）。**引擎公式只读这里** */
  readonly props: Map<string, number>;
  /** 扩展属性（内容层自造，已登记）。**永不参与核心公式** */
  readonly extProps: Map<string, number>;
}

export function createPropHolder(): PropHolder {
  return { props: new Map(), extProps: new Map() };
}

// `describeValue` 与「是不是普通对象」的判定现在住在 `load-report.ts`
// —— 那是「从不可信数据装载」的统一契约，props / temp / skill 三处共用一份
// （原先 props 与 temp 各有一份，且**行为已经不同**：temp 那份漏了数组分支）。

function assertFiniteNumber(value: unknown, op: string, key: string): void {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new PropValueError(
      `${op}("${key}") 的属性值必须是有限数值，收到 ${describeValue(value)}；` +
        `wushen 在这种情况下会静默写成 NaN 并污染后续所有公式`,
    );
  }
}

/**
 * 运行时兜底：`'x' as ExtProp` 这类强转能绕过品牌类型，
 * 但绕不过这里 —— 未登记就是未登记。
 */
function assertRegisteredExt(key: string): void {
  if (!isExtProp(key)) {
    throw new PropValueError(
      `扩展属性键未登记：${JSON.stringify(key)}（必须先用 registerExtProp() 登记）`,
    );
  }
}

// ---------------------------------------------------------------------------
// 核心属性（引擎层）
// ---------------------------------------------------------------------------

/** 读核心属性。未设置返回 **0**（与 wushen `query_prop` 一致，不是 undefined） */
export function getProp(holder: PropHolder, key: PropKey): number {
  return holder.props.get(key) ?? 0;
}

/** 该键是否被显式写过（`getProp` 返回 0 时无法区分"没写过"与"就是 0"） */
export function hasProp(holder: PropHolder, key: PropKey): boolean {
  return holder.props.has(key);
}

export function setProp(holder: PropHolder, key: PropKey, value: number): void {
  assertFiniteNumber(value, 'setProp', key);
  holder.props.set(key, value);
}

/** 累加（对应 wushen `add_prop`），返回累加后的新值 */
export function addProp(holder: PropHolder, key: PropKey, delta: number): number {
  assertFiniteNumber(delta, 'addProp', key);
  const next = (holder.props.get(key) ?? 0) + delta;
  holder.props.set(key, next);
  return next;
}

/** 删除该键，返回是否确实存在过 */
export function removeProp(holder: PropHolder, key: PropKey): boolean {
  return holder.props.delete(key);
}

/** 清空全部核心属性（对应 wushen `clear_prop`） */
export function clearProps(holder: PropHolder): void {
  holder.props.clear();
}

// ---------------------------------------------------------------------------
// 扩展属性（内容层）—— 与核心属性物理隔离
// ---------------------------------------------------------------------------

export function getExtProp(holder: PropHolder, key: ExtProp): number {
  assertRegisteredExt(key);
  return holder.extProps.get(key) ?? 0;
}

export function hasExtProp(holder: PropHolder, key: ExtProp): boolean {
  assertRegisteredExt(key);
  return holder.extProps.has(key);
}

export function setExtProp(holder: PropHolder, key: ExtProp, value: number): void {
  assertRegisteredExt(key);
  assertFiniteNumber(value, 'setExtProp', key);
  holder.extProps.set(key, value);
}

/** 累加扩展属性，返回累加后的新值 */
export function addExtProp(holder: PropHolder, key: ExtProp, delta: number): number {
  assertRegisteredExt(key);
  assertFiniteNumber(delta, 'addExtProp', key);
  const next = (holder.extProps.get(key) ?? 0) + delta;
  holder.extProps.set(key, next);
  return next;
}

export function removeExtProp(holder: PropHolder, key: ExtProp): boolean {
  assertRegisteredExt(key);
  return holder.extProps.delete(key);
}

export function clearExtProps(holder: PropHolder): void {
  holder.extProps.clear();
}

/** 同时清空两套（新建角色 / 重算前重置） */
export function clearAllProps(holder: PropHolder): void {
  holder.props.clear();
  holder.extProps.clear();
}

/**
 * 从**内容层定义**装载属性（`define*` 的 `prop` / `extProp` 字段）。
 *
 * 刻意只收**结构类型**（`Record<string, number>`）而不是 `defs.ts` 的 `PropMap`：
 * `props.ts` 不该知道内容层的存在（依赖方向），而结构类型已经足够，
 * 且 `PropMap` 天然可赋值给它。
 *
 * 走 `setProp` / `setExtProp` 而不是直接写 Map —— 于是内容层写错键、写 NaN
 * 都会在**实例化时**就抛错并定位到具体键，而不是等到某次战斗数值不对。
 */
export interface RawPropMap {
  readonly prop?: Readonly<Partial<Record<string, number>>>;
  readonly extProp?: ReadonlyArray<readonly [string, number]>;
}

export function applyPropMap(holder: PropHolder, map: RawPropMap): void {
  for (const [key, value] of Object.entries(map.prop ?? {})) {
    if (value === undefined) continue;
    if (!isPropKey(key)) {
      throw new PropValueError(
        `applyPropMap: 内容层 prop 里出现非核心属性键 ${JSON.stringify(key)}（只认 CORE∪MOD）`,
      );
    }
    setProp(holder, key, value);
  }
  for (const entry of map.extProp ?? []) {
    const key = entry[0];
    const value = entry[1];
    if (!isExtProp(key)) {
      throw new PropValueError(
        `applyPropMap: 扩展属性键未登记 ${JSON.stringify(key)}（必须来自 registerExtProp()）`,
      );
    }
    setExtProp(holder, key, value);
  }
}

// ---------------------------------------------------------------------------
// 存档 / 读档边界
// ---------------------------------------------------------------------------

export interface PropSnapshot {
  readonly prop: Record<string, number>;
  readonly ext: Record<string, number>;
}

export function snapshotProps(holder: PropHolder): PropSnapshot {
  return {
    prop: Object.fromEntries(holder.props),
    ext: Object.fromEntries(holder.extProps),
  };
}

const SNAPSHOT_FIELDS = new Set(['prop', 'ext']);

/**
 * 从**不可信**数据装载属性（存档 / 协议 / 热更）。
 *
 * 语义：**合并**（不先清空）；需要整体替换时先 `clearAllProps()`。
 * 逐键校验，不合格的键**不写进表**并记入 `rejected` —— 宁可少装一个键，
 * 也不要让一个未登记/非数值的键静默污染整局。
 *
 * 入参要求 `{ prop?: {...}, ext?: {...} }` 形状（`snapshotProps` 的输出）。
 *
 * ★ **数组不是快照**（2026-10-13 补，26 册 §25）：`typeof [] === 'object'`，
 *   只用 `typeof` 判会放行它，而 `Object.entries([])` 是空的 —— 于是一个空数组
 *   会"成功地装进 0 个属性"，调用方完全看不出自己传错了形状。顶层与嵌套层都拦。
 *
 * ★ **分级**（E3 裁定，26 册 §40，与 `load-report.ts` 的契约一致）：
 *   容器种类不对 ⇒ **抛**；条目级异常（不认识的键 / 非数值）⇒ **丢该条 + 记账**。
 *   ★ 顶层那个"不认识的字段"属于**条目级**（记账），不是结构性 ——
 *     因为新版本多加一个字段、旧代码回滚后必须能忽略它，而不是全体砖档。
 */
export function loadProps(holder: PropHolder, raw: unknown): LoadReport {
  if (!isPlainRecord(raw)) {
    throw new PropValueError(`loadProps 需要对象，收到 ${describeValue(raw)}`);
  }

  const rejected: RejectedEntry[] = [];
  let loaded = 0;

  for (const [field, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!SNAPSHOT_FIELDS.has(field)) {
      rejected.push({ key: field, reason: '快照里不认识的字段' });
      continue;
    }
    if (value === null || value === undefined) continue;
    if (!isPlainRecord(value)) {
      rejected.push({ key: field, reason: `必须是对象，收到 ${describeValue(value)}` });
      continue;
    }

    const isCore = field === 'prop';
    const target = isCore ? holder.props : holder.extProps;

    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      if (isCore ? !isPropKey(key) : !isExtProp(key)) {
        rejected.push({
          key: `${field}.${key}`,
          reason: isCore ? '不是核心属性键（CORE∪MOD）' : '扩展属性未登记',
        });
        continue;
      }
      if (typeof v !== 'number' || !Number.isFinite(v)) {
        rejected.push({ key: `${field}.${key}`, reason: `值不是有限数值（${describeValue(v)}）` });
        continue;
      }
      target.set(key, v);
      loaded += 1;
    }
  }

  return { loaded, rejected };
}

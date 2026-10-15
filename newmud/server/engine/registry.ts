/**
 * server/engine/registry.ts — 世界对象注册表（分 kind 的 Map）
 * ============================================================================
 * 取代 wushen 的 `WORLD.*` 全局裸变量 + 拼错索引：
 *   - 全部用 Map（O(1)），不再线性扫描
 *   - 索引名只在这里出现一次（`OBJ_STROE`/`OBJ_STORE` 混写的根治）
 *   - **重复注册直接抛错**，不再 console.error 后覆盖（wushen 13 册 13.1）
 *
 * 依赖方向（docs/24 §2.6 之外的硬约束）：
 *   content(world/) ──> define* ──> registry
 *   engine 只读 registry，**不 import 任何具体内容**。
 */

import type { Kind, WorldId } from '@shared/ids.js';
import { IdError, KINDS, parseWorldId } from '@shared/ids.js';

export interface RegistryEntry {
  /** 完整 id（含 `#variant`） */
  readonly id: string;
  readonly kind: Kind;
  /** 注册来源模块（best-effort，用于报错定位；可为空串） */
  readonly source: string;
  readonly def: unknown;
  /** 变体对象指向的基对象 id；非变体为 null */
  readonly variantOf: string | null;
}

export class DuplicateRegistrationError extends Error {
  public override readonly name = 'DuplicateRegistrationError';
}

const tables: Record<Kind, Map<string, RegistryEntry>> = {
  room: new Map(),
  area: new Map(),
  npc: new Map(),
  item: new Map(),
  skill: new Map(),
  family: new Map(),
  command: new Map(),
  task: new Map(),
};

/**
 * 注册一个对象。重复（同 kind 同 id）直接抛错，绝不静默覆盖。
 *
 * ★ docs/26 L9：`id` 参数收紧为品牌类型 `WorldId`，并加一道运行时兜底。
 *   原来它是裸 `string` 且**不校验 id** —— 只要绕过 `define*` 直接调用，
 *   全部 id 语法校验就失效了。现在"没校验过就写不进来"：
 *   类型挡住普通写法，运行时挡住 `'Bad/Id' as WorldId` 这类强转。
 */
export function register(
  kind: Kind,
  id: WorldId,
  def: unknown,
  options: { source?: string; variantOf?: string | null } = {},
): RegistryEntry {
  if (parseWorldId(id) === null) {
    throw new IdError(`register: 非法 world id ${JSON.stringify(id)}（必须来自 asWorldId* 校验）`);
  }
  const table = tables[kind];
  const existing = table.get(id);
  if (existing !== undefined) {
    const a = existing.source === '' ? '未知来源' : existing.source;
    const b = options.source === undefined || options.source === '' ? '未知来源' : options.source;
    throw new DuplicateRegistrationError(
      `重复注册 ${kind} "${id}"：\n  - ${a}\n  - ${b}`,
    );
  }
  const entry: RegistryEntry = {
    id,
    kind,
    source: options.source ?? '',
    def,
    variantOf: options.variantOf ?? null,
  };
  table.set(id, entry);
  return entry;
}

export function getEntry(kind: Kind, id: string): RegistryEntry | undefined {
  return tables[kind].get(id);
}

export function has(kind: Kind, id: string): boolean {
  return tables[kind].has(id);
}

/** 取定义体（调用方自行收窄类型） */
export function getDef<T>(kind: Kind, id: string): T | undefined {
  const e = tables[kind].get(id);
  return e === undefined ? undefined : (e.def as T);
}

export function idsOf(kind: Kind): string[] {
  return [...tables[kind].keys()];
}

export function entriesOf(kind: Kind): RegistryEntry[] {
  return [...tables[kind].values()];
}

export function countOf(kind: Kind): number {
  return tables[kind].size;
}

/** 各 kind 计数快照（启动日志 / 闸门用） */
export function snapshot(): Record<Kind, number> {
  const out = {} as Record<Kind, number>;
  for (const k of KINDS) out[k] = tables[k].size;
  return out;
}

/**
 * 清空注册表。**仅测试与热重载使用**。
 * 生产代码不得调用（否则等于引入 wushen 的热更新数据破坏风险）。
 */
export function clearAll(): void {
  for (const k of KINDS) tables[k].clear();
}

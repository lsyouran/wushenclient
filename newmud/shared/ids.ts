/**
 * shared/ids.ts — 世界对象标识符（World ID）· 单一事实源
 * ============================================================================
 * 命名方案： **C（路径 + 显式 kind）**
 *
 *   id   := <area> ( '/' <segment> )* [ '#' <variant> ]      ← 段数 1~5
 *           · 非 area 的 kind 至少 2 段（见 MIN_SEGMENTS_BY_KIND）
 *           · area 允许单段（wushen 语义：区域 id 就是 `yz`）
 *   kind := 不写进 id；由 define* 函数 / 注册表桶承载
 *
 * 一致性三条（取消一切中间映射表）：
 *   1. 磁盘路径 = `world/<kind>/<id>.ts`
 *   2. 代码里的 id 字面量 = 该文件相对 `world/<kind>/` 的路径（去 .ts）
 *   3. 引用（exits / set_npc / set_drop ...）里的 id 只是字符串，
 *      其**期望 kind 由引用点声明**，由 G4 世界校验闸门比对注册表
 *
 * 设计依据：`docs/24-命名与标识符规范.md`
 * 反面教材：wushen 的 `map/`(房间) 与 `cmd/`(指令) 目录名 ≠ 类型名，
 *          且 id 与目录绑定，导致『目录→类型』需要一张翻译表 —— 漂移温床。
 */

// ---------------------------------------------------------------------------
// 1. kind（对象大类）—— 与 define* 函数一一对应
// ---------------------------------------------------------------------------

export const KINDS = [
  'room',
  'area',
  'npc',
  'item',
  'skill',
  'family',
  'command',
  'task',
] as const;

export type Kind = (typeof KINDS)[number];

/** kind → 在 world/ 下的目录名。**恒等于 kind 名本身**（方案 C 的核心约定）。 */
// ★ 不再提供 `kindToDir(kind)` / `KIND_REGISTRY` 这类"映射函数/映射表"：
//   它们要么恒等于入参（`kindToDir(kind) === kind`，纯粹是给不存在的翻译表留位置），
//   要么是与 server/engine/registry.ts 硬编码表**平行**的第二份事实源，两边会漂移。
//   目录名 === kind 名这条约定由 G5 闸门直接校验，不需要中间层。
//   （docs/26 M1 与 L7 的处置：删掉"带说明书的地雷"，而不是留着等人踩。）

// ---------------------------------------------------------------------------
// 2. subtype（子类型）—— 不参与 id，只作为对象字段
//    wushen 用继承区分（NPC vs MONSTER、OBJ vs EQUIPMENT），
//    新项目在 kind 之外再记一个 subtype，供序列化 / 校验 / 前端图标使用。
// ---------------------------------------------------------------------------

export const SUBTYPES = [
  'monster', // npc 子类
  'obj',
  'equipment',
  'container',
  'corpse',
  'money', // item 子类
] as const;

export type Subtype = (typeof SUBTYPES)[number];

/** kind → 该 kind 允许出现的 subtype（空数组 = 无子类型） */
export const SUBTYPES_BY_KIND: Readonly<Record<Kind, readonly Subtype[]>> = {
  room: [],
  area: [],
  npc: ['monster'],
  item: ['obj', 'equipment', 'container', 'corpse', 'money'],
  skill: [],
  family: [],
  command: [],
  task: [],
};

// ---------------------------------------------------------------------------
// 3. 语法
// ---------------------------------------------------------------------------

/** 单个路径段：小写字母开头，允许小写字母 / 数字 / 下划线 */
export const SEGMENT_RE = /^[a-z][a-z0-9_]*$/;

/**
 * 变体名：允许大小写（`drug/yao#taijijian`），仅作后缀不参与目录。
 *
 * ★ **唯一一处**（T20）。`define.ts` 展开 `variants` 时用的就是本正则（它曾经
 *   自留了一份逐字节相同的副本）；`parseWorldId()` 校验 `id#变体` 也走它。
 *   谁要改变体名的允许范围，改这里一处即可 —— 别在别处再写一遍。
 */
export const VARIANT_RE = /^[A-Za-z0-9_]{1,32}$/;

/**
 * 完整 id 的语法**只有一处**：`parseWorldId()`（用下面的 SEGMENT_RE / VARIANT_RE
 * 逐段校验，并附带保留 area 与长度上限检查）。
 *
 * ★ docs/26 M1：这里曾经还有一个便利正则 `WORLD_ID_RE`，注释还写着
 *   「G5 命名闸门直接复用此正则」。实测它与 `parseWorldId` 已在 **9/15** 个用例上
 *   发散（不查 `RESERVED_AREAS`、没有长度上限）—— 谁照那句注释去用，
 *   G5 就会开始放行 `room/x`、`server/x` 这类保留 area 的 id。
 *   那是一颗**带说明书的地雷**，已删除。
 *
 * 守卫：`tests/ids.test.ts` 断言本模块导出的 RegExp 恰好只有下面这两个 ——
 * 再想加"第二份全串语法正则"就必须先改那个断言，无法悄悄加回来。
 */

export const ID_MAX_LENGTH = 128;
/** 语法层最小段数。**注意**：各 kind 的最小段数见 MIN_SEGMENTS_BY_KIND。 */
export const ID_MIN_SEGMENTS = 1;
export const ID_MAX_SEGMENTS = 5;

/**
 * 各 kind 的最小段数。
 *
 * `area` 是唯一允许**单段** id 的 kind（wushen 语义：区域 id 就是 `yz`），
 * 其余 kind 必须是 `<area>/<...>` 形态。kind 相关的约束放在这里而不是
 * 正则里，是为了让 `parseWorldId` 保持与 kind 无关、可被闸门通用复用。
 */
export const MIN_SEGMENTS_BY_KIND: Readonly<Record<Kind, number>> = {
  area: 1,
  room: 2,
  npc: 2,
  item: 2,
  skill: 2,
  family: 2,
  command: 2,
  task: 2,
};

/**
 * 保留 area：不得与 kind 重名，也不得占用工程保留字。
 * 例：area 叫 `item` 会让 `item/gj` 这类 id 产生歧义。
 */
export const RESERVED_AREAS: ReadonlySet<string> = new Set<string>([
  ...KINDS,
  'shared',
  'server',
  'src',
  'tools',
  'index',
  'test',
  'tests',
]);

// ---------------------------------------------------------------------------
// 4. 品牌类型
// ---------------------------------------------------------------------------

declare const WORLD_ID_BRAND: unique symbol;

/**
 * 已校验的 world id。
 * 只允许通过 `asWorldId()` / `makeWorldId()` 构造，借此把
 * 『字符串』与『已验证的 id』在类型层面分开 —— 这正是要挡住的
 * wushen 缺陷 #13（`.id` / `.ID` 混用、字段名拼错静默 undefined）。
 */
export type WorldId = string & { readonly [WORLD_ID_BRAND]: true };

// ---------------------------------------------------------------------------
// 5. 错误
// ---------------------------------------------------------------------------

export class IdError extends Error {
  public override readonly name = 'IdError';
  public constructor(message: string) {
    super(message);
  }
}

// ---------------------------------------------------------------------------
// 6. 解析 / 构造 / 校验
// ---------------------------------------------------------------------------

export interface ParsedWorldId {
  /** 一级分组（地理区域或功能分类），如 `yz` / `pub` / `action` */
  readonly area: string;
  /** 去掉变体的完整 id，如 `yz/guangchang`（= 磁盘路径依据） */
  readonly path: string;
  /** 去掉 area 的部分，如 `guangchang` / `bj/guanwai/xiong` */
  readonly localname: string;
  /** 变体名；无变体为 null */
  readonly variant: string | null;
  readonly segments: readonly string[];
}

/**
 * 解析并校验一个世界 id。非法返回 null（不抛错，便于闸门批量扫描）。
 */
export function parseWorldId(raw: unknown): ParsedWorldId | null {
  if (typeof raw !== 'string') return null;
  if (raw.length === 0 || raw.length > ID_MAX_LENGTH) return null;

  const hash = raw.indexOf('#');
  const base = hash === -1 ? raw : raw.slice(0, hash);
  const variant = hash === -1 ? null : raw.slice(hash + 1);

  if (variant !== null && !VARIANT_RE.test(variant)) return null;

  const segments = base.split('/');
  if (segments.length < ID_MIN_SEGMENTS || segments.length > ID_MAX_SEGMENTS) {
    return null;
  }
  for (const seg of segments) {
    if (!SEGMENT_RE.test(seg)) return null;
  }

  const area = segments[0];
  if (area === undefined) return null;
  if (RESERVED_AREAS.has(area)) return null;

  return {
    area,
    path: base,
    localname: segments.slice(1).join('/'),
    variant,
    segments,
  };
}

/** 类型守卫版本，供 `if (isWorldId(x))` 使用 */
export function isWorldId(x: unknown): x is WorldId {
  return parseWorldId(x) !== null;
}

/**
 * 断言并收窄为 WorldId。`ctx` 用于在报错里指出调用点（对账用）。
 */
export function asWorldId(raw: string, ctx = ''): WorldId {
  const parsed = parseWorldId(raw);
  if (parsed === null) {
    const where = ctx === '' ? '' : `（调用点：${ctx}）`;
    throw new IdError(`非法 world id：${JSON.stringify(raw)}${where}`);
  }
  return raw as WorldId;
}

/** 由分段构造 id（推荐写法，天然避免拼串出错） */
export function makeWorldId(
  area: string,
  localname: string,
  variant?: string,
): WorldId {
  const base = `${area}/${localname}`;
  const full = variant === undefined ? base : `${base}#${variant}`;
  return asWorldId(full, 'makeWorldId');
}

/**
 * 断言 + **kind 相关的最小段数校验**。
 * 内容层注册入口（define.ts）必须走这个函数，而不是裸 asWorldId。
 */
export function asWorldIdForKind(
  raw: string,
  kind: Kind,
  ctx = '',
): WorldId {
  const parsed = parseWorldId(raw);
  const where = ctx === '' ? '' : `（调用点：${ctx}）`;
  if (parsed === null) {
    throw new IdError(`非法 world id：${JSON.stringify(raw)}${where}`);
  }
  const min = MIN_SEGMENTS_BY_KIND[kind];
  if (parsed.segments.length < min) {
    throw new IdError(
      `id ${JSON.stringify(raw)} 对于 kind=${kind} 段数不足：` +
        `需要至少 ${min} 段（形如 <area>/<localname>）${where}`,
    );
  }
  return raw as WorldId;
}

/** 去掉变体后的 id（用于『同模板不同变体』的归并、去重） */
export function worldIdBase(raw: string): string | null {
  return parseWorldId(raw)?.path ?? null;
}

/** 两个 id 是否指向同一模板（忽略变体） */
export function sameIdTemplate(a: string, b: string): boolean {
  const pa = worldIdBase(a);
  const pb = worldIdBase(b);
  return pa !== null && pa === pb;
}

// ---------------------------------------------------------------------------
// 7. 磁盘映射：world/<kind>/<id>.ts  ←→  id
// ---------------------------------------------------------------------------

export const WORLD_ROOT = 'world';

/** id + kind → 磁盘相对路径。变体不改变文件位置（同文件派生多对象）。 */
export function worldIdToFile(
  id: WorldId | string,
  kind: Kind,
  root: string = WORLD_ROOT,
): string {
  const parsed = parseWorldId(id);
  if (parsed === null) {
    throw new IdError(`worldIdToFile: 非法 id ${JSON.stringify(id)}`);
  }
  return `${root}/${kind}/${parsed.path}.ts`;
}

/** 磁盘路径 → 期望 kind（G5 闸门用：校验文件放的目录对不对） */
export function fileToKind(
  file: string,
  root: string = WORLD_ROOT,
): Kind | null {
  const norm = file.replace(/\\/g, '/');
  const prefix = `${root}/`;
  if (!norm.startsWith(prefix)) return null;
  const rest = norm.slice(prefix.length).replace(/\.ts$/, '');
  const first = rest.split('/')[0];
  if (first === undefined) return null;
  return (KINDS as readonly string[]).includes(first) ? (first as Kind) : null;
}

/** 磁盘路径 → id（不含 kind；失败返回 null） */
export function fileToWorldId(
  file: string,
  root: string = WORLD_ROOT,
): WorldId | null {
  const norm = file.replace(/\\/g, '/');
  const prefix = `${root}/`;
  if (!norm.startsWith(prefix)) return null;
  const rest = norm.slice(prefix.length).replace(/\.ts$/, '');
  const segs = rest.split('/');
  // 至少 `kind/<id>` 两段（id 自身可能是单段，如 area）
  if (segs.length < 2) return null;
  const id = segs.slice(1).join('/');
  return isWorldId(id) ? id : null;
}

// ---------------------------------------------------------------------------
// 8. 引用期望 kind
// ---------------------------------------------------------------------------
//
// ★ docs/26 M2：这里曾经有一张 `REF_EXPECTS`（`set_npc: 'npc'` / `set_obj: 'item'`
//   / `set_drop_obj: 'item'` / `map_id: 'room'` …）。两个问题：
//     ① 字段名与实现**早已不符** —— `validate.ts` 实际校验的是
//        `npcs` / `objects` / `drops`，不是 `set_npc` / `set_obj` / `set_drop_obj`；
//     ② 它零使用，于是"已与实现不符"这件事没有任何东西能发现。
//
//   处置：**删除**。"哪个字段引用哪种对象"的权威表就放在
//   `server/world/validate.ts` 的 `REF_CHECK_PATHS` 里 —— 那张表是**可执行的**：
//   `tests/validate.test.ts` 构造"每个引用点都坏掉"的世界，
//   断言每个声明的引用点都真的产生了 error。加了表却没加校验会立刻变红。
//
//   教训（24 册 §4 禁止清单第 8 条「同一逻辑在两处各写一份」的变体）：
//   只要存在"实现 + 一份描述它的表"，就必须让表**参与断言**，否则它迟早变成谎言。

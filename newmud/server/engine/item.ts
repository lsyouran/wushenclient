/**
 * server/engine/item.ts — 物品
 * ============================================================================
 * 对照 wushen `os/item/obj.js`（09 册）。
 *
 * ★ 本批次的范围：只做**能被放进容器、能堆叠、能装备**的最小物品。
 *   `CONTAINER`（可打开的箱子）、`CORPSE`（尸体）、`MONEY`（货币）
 *   等子类留到 09 册那一批 —— 这里不预留空壳方法（"声明未实现"是 26 册 L8 的病）。
 *
 * ★ 物品**不持有 prop**（与 `Character` 的区别）：
 *   wushen 里装备的属性不是加在装备自己身上，而是穿戴时由 `attach_prop`
 *   加到**穿的人**身上（08 册 §8.2.3）。所以 `Item` 不是 `PropHolder`，
 *   装备加成属于装备系统（09/12 册）落地时的事。
 *
 * ★ 堆叠与 wushen 的差异：
 *   wushen 把"是否可堆叠"隐含在 `combined` 字段 + 各处 `if (obj.combined)` 里，
 *   于是"能不能跟这件合并"的判据散落在多个调用点。这里收成**一个方法**
 *   `canStackWith()`，调用方不再各自解释 `combined` 的含义。
 *
 * ★ **持 `def`（2026-10-16，B 批）**：在此之前 `Item` **只把 `def` 的几个标量抄进
 *   实例**（`name`/`desc`/`value`/`unit`/`grade`/`combined`/`equipType`/`weaponType`），
 *   **钩子面一个都没接** —— 于是 `world/item/drug/yao.ts` 里写着 `on_use`、
 *   `ItemDef` 里写着 `on_use`/`on_study`/`on_open`/`transable`，
 *   而 `Item` 实例**够不着任何一个**："这枚丹药能不能吃"在运行时无从回答。
 *   ⇒ 现在与 `Npc` / `Room` 同款：实例持模板引用（`def`），
 *     并把内容层要用的那一小块派生成 `interact`（见下）。
 */

import type { EquipSlot, WeaponType } from '@shared/constants.js';
import type { WorldId } from '@shared/ids.js';
import { GameObject } from './base.js';
import type { InteractHooks, ItemDef } from '../world/defs.js';

export class ItemError extends Error {
  public override readonly name = 'ItemError';
}

export interface ItemInit {
  readonly oid: string;
  readonly path: WorldId;
  readonly name: string;
  /**
   * 模板定义。**可选**：只有"从注册表实例化"的物品才有它
   * （`world.ts#makeItem`），测试里直接 `new Item({...})` 的那种没有。
   * 与 `Room.def` / `Npc.def` 同款语义：有它才有钩子。
   */
  readonly def?: ItemDef | undefined;
  /** 一句话描述（`look <物>` / 详情用）。`ItemDef.desc` 缺省时为空串 */
  readonly desc?: string | undefined;
  // 带 `| undefined`：`exactOptionalPropertyTypes` 下要能写
  // `{ value: def.value }`（def 里可能就是 undefined）。
  readonly count?: number | undefined;
  readonly value?: number | undefined;
  readonly unit?: string | undefined;
  readonly grade?: number | undefined;
  readonly combined?: boolean | undefined;
  readonly equipType?: EquipSlot | undefined;
  readonly weaponType?: WeaponType | undefined;
  /**
   * 销毁回调（世界实例化期注入；T4，26 册 §55）。
   *
   * ★ 与 `Npc.onDestroy` 同源：物品被用光（`count` 归零）时要从世界索引摘除并
   *   **释放 oid**，而索引只在 `instantiateWorld` 里可达。
   * ★ 缺省（测试里裸构造的 `Item`）= 不入索引 ⇒ `destroy()` 是空操作。
   */
  readonly onDestroy?: (() => void) | undefined;
}

export class Item extends GameObject {
  /** 堆叠数量。恒 ≥ 1 —— 归零即应当被销毁（`isDepleted`），而不是留一个 count=0 的幽灵 */
  #count: number;
  /**
   * 一句话描述（`ActorObject.desc`），来自 `ItemDef.desc`。
   *
   * ★ 以前它**根本没被读进来**：`ItemDef.desc` 在 `world/item/drug/yao.ts` 里写着，
   *   而 `instantiateWorld` 构造 `Item` 时没传 —— 于是 `look 丹药` 说不出"这是什么"。
   *   现在补上（并在 `engine/world.ts` 的构造处接上 `def.desc`）。
   */
  public readonly desc: string;
  /** 单价（铜板）。卖店 / 掉落折算用 */
  public readonly value: number;
  /** 量词（"枚"/"把"），`look` 与背包面板用 */
  public readonly unit: string | undefined;
  public readonly grade: number;
  public readonly combined: boolean;
  public readonly equipType: EquipSlot | undefined;
  public readonly weaponType: WeaponType | undefined;
  /** 模板定义（钩子与静态数据都从这里取）。`undefined` = 无模板来源的实例 */
  public readonly def: ItemDef | undefined;
  /**
   * 内容层可见的**交互面**（`ActorObject.interact`）。
   *
   * ★ 在构造时由 `def` **派生一次**，而不是每次访问现拼一个对象 —— 它是个不可变的
   *   投影，重建只会让"同一个物品两次读到的不是同一个对象"变成可能。
   * ★ `def` 缺席（测试里裸构造的 Item）时是 `undefined` —— 于是"无钩子"
   *   只需调用点写一个 `?.`，不必再多一个布尔分支（同 `Npc.actions` 的取向）。
   */
  public readonly interact: InteractHooks | undefined;
  /** 销毁回调（世界实例化期注入；`undefined` = 这个物品不在世界索引里） */
  readonly #onDestroy: (() => void) | undefined;

  public constructor(init: ItemInit) {
    super({ oid: init.oid, path: init.path, kind: 'item', name: init.name });
    const count = init.count ?? 1;
    if (!Number.isInteger(count) || count < 1) {
      throw new ItemError(`物品数量必须是 ≥1 的整数，收到 ${String(init.count)}`);
    }
    this.#count = count;
    this.desc = init.desc ?? '';
    this.value = init.value ?? 0;
    this.unit = init.unit;
    this.grade = init.grade ?? 0;
    this.combined = init.combined ?? false;
    this.equipType = init.equipType;
    this.weaponType = init.weaponType;
    this.def = init.def;
    this.interact = deriveInteract(init.def);
    this.#onDestroy = init.onDestroy;
  }

  public get count(): number {
    return this.#count;
  }

  /** 数量归零（应当由上层销毁并释放 oid） */
  public get isDepleted(): boolean {
    return this.#count <= 0;
  }

  /**
   * **销毁**这一件：通知世界把自己从索引里摘掉并释放 oid（T4）。
   *
   * ★ 只管"世界侧"，**不管容器**：从背包/房间里脱钩是 `removeItem` 的事，
   *   两者由调用方（`Character.spendItem`）按顺序做完 —— 拆开是为了让
   *   "不在任何容器里但还在索引里"这种中间态不可能被忘掉一半。
   */
  public destroy(): void {
    this.#onDestroy?.();
  }

  public get isEquipment(): boolean {
    return this.equipType !== undefined;
  }

  /** 总价（单价 × 数量），避免各调用点各写一次乘法 */
  public get totalValue(): number {
    return this.value * this.#count;
  }

  /**
   * 能否与另一件物品堆叠。
   * 判据只有一条：**同一模板 + 双方都可堆叠**。
   * 不看 `name`（同名不同源不合并）、不看实例 oid（否则永远合不上）。
   */
  public canStackWith(other: Item): boolean {
    return this.combined && other.combined && this.path === other.path;
  }

  /** 加数量，返回新值 */
  public addCount(delta: number): number {
    if (!Number.isInteger(delta)) {
      throw new ItemError(`数量增减必须是整数，收到 ${String(delta)}`);
    }
    const next = this.#count + delta;
    if (next < 0) {
      throw new ItemError(`数量不能为负：${this.#count} + ${delta} = ${next}`);
    }
    this.#count = next;
    return next;
  }

  public override toString(): string {
    return `${super.toString()}${this.#count > 1 ? `×${this.#count}` : ''}`;
  }
}

/**
 * `ItemDef` → 内容层交互面。**这是"物品模板的钩子"与"指令看得见什么"之间唯一的桥**。
 *
 * ★ 为什么在这里派生、而不是让指令自己读 `Item.def`：
 *   内容层（`world/command/**`）**不能 import 引擎**（G13 D2），所以它拿到的
 *   只能是 `ActorObject` 这个结构视图。把要用的那一小块派生成 `interact`，
 *   于是"指令能用物品的哪些能力"是**一张显式清单**，而不是"随便读 def 的哪个字段"。
 *
 * ★ 字段**原样搬运**（不做 `=== true` 归一）：`noGet` 保持 `boolean | undefined`，
 *   判据留给调用点写 `... === true`。若在这里归一会得到第二个真相 ——
 *   将来加字段时容易漏掉这层归一，而"漏掉"的后果是本该拦住的没拦住。
 */
function deriveInteract(def: ItemDef | undefined): InteractHooks | undefined {
  if (def === undefined) return undefined;
  return {
    noGet: def.no_get,
    noDrop: def.no_drop,
    noConsume: def.no_consume,
    onGet: def.on_get,
    onUse: def.on_use,
  };
}

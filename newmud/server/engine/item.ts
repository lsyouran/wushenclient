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
 */

import type { EquipSlot, WeaponType } from '@shared/constants.js';
import type { WorldId } from '@shared/ids.js';
import { GameObject } from './base.js';

export class ItemError extends Error {
  public override readonly name = 'ItemError';
}

export interface ItemInit {
  readonly oid: string;
  readonly path: WorldId;
  readonly name: string;
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
  }

  public get count(): number {
    return this.#count;
  }

  /** 数量归零（应当由上层销毁并释放 oid） */
  public get isDepleted(): boolean {
    return this.#count <= 0;
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

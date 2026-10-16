/**
 * server/engine/base.ts — 对象模型的最底层：位置 + 容器语义
 * ============================================================================
 * 对照 wushen `os/base.js` / `os/item.js` / `os/room/room.js`（07 册 §7.2）。
 *
 * ★ 抄过来的设计（22 册 §22.7 模式 4「房间即容器」）：
 *   把"位置关系"做成**容器**语义 —— 房间、角色都是容器，物品可以放进任何容器。
 *   于是「玩家在房间里」与「剑在地上」走**同一套**代码，
 *   `environment` / `items` 不需要各写一份。
 *
 * ★ 明确不抄的（07 册 §7.3、§7.9 的复刻建议）：
 *
 *   1. **双继承机制** —— wushen 同时有 `util.inherits`（类之间）与
 *      `BASE.prototype.inherits`（实例级 `__proto__` 整体替换，并自带源码注释承认
 *      "会改变父对象的原型"）。这里只用标准 `extends`。
 *
 *   2. **`Object.create(base)` 模板克隆** —— wushen 用它让 1000 只怪共享一份原型，
 *      代价是 `CHARACTER.prototype.clone` 必须手工重建 `temp`/`prop`/`equipment`/`items`，
 *      否则**两只怪共用同一份 `prop`**，`add_prop` 互相污染（`character.js:235-264`）。
 *      本项目改为**工厂实例化**：`new Npc(...)` 每次都是全新的字段，
 *      "共享可变状态"这个 bug **在结构上不存在**，也就不需要 `CLONE_FIELDS` 清单
 *      （见 `world.ts` 的 `spawnNpc`）。`tests/engine-world.test.ts` 用
 *      「同一 def 生成的两个实例互不影响」把这条钉住。
 *
 *   3. **`__proto__` 篡改式热更新** —— 见 15 册，本批次不涉及。
 *
 * ★ 位置关系为什么用**模块私有 WeakMap**：
 *   `environment` 必须与 `Container.items` 永远一致（双向）。若把 `environment`
 *   做成可写字段，就会出现"room.items 里有剑、剑却说自己在别处"的失配状态。
 *   把存储放在模块私有 WeakMap 里，`Container.addItem/removeItem` 是**唯一**能改它的
 *   代码路径 —— 外部即便拿到对象也无法绕过（不是"请勿直接改"的君子协定）。
 */

import type { WorldId } from '@shared/ids.js';

/**
 * 能作为"世界对象"存在的 kind。
 *
 * ★ 与 `shared/ids.ts` 的 `KINDS` 是**两套东西**，别混：
 *   - `KINDS`（9 个）= **内容层**的分类，决定 `world/<kind>/<id>.ts` 的目录；
 *     玩家角色不在内容目录里（它由存档构造），所以那里没有 `player`。
 *   - `OBJ_KINDS`（4 个）= **运行时**物体的分类，决定"这是什么东西"。
 *     玩家与 NPC 都是角色，但**必须可分** —— 广播"房间里的人"、判断
 *     `is_player`（wushen 到处用这个标志）、存档分桶，全都依赖这个区分。
 *     wushen 用 `is_player` 布尔标志散落各处，这里改成 kind，判据只有一处。
 */
export const OBJ_KINDS = ['item', 'room', 'npc', 'player'] as const;
export type ObjKind = (typeof OBJ_KINDS)[number];

export class GameObjectError extends Error {
  public override readonly name = 'GameObjectError';
}

export class ContainerError extends Error {
  public override readonly name = 'ContainerError';
}

// ---------------------------------------------------------------------------
// 位置关系存储（模块私有）
// ---------------------------------------------------------------------------

const ENVIRONMENT = new WeakMap<GameObject, Container | null>();

function envOf(obj: GameObject): Container | null {
  return ENVIRONMENT.get(obj) ?? null;
}

export interface GameObjectInit {
  readonly oid: string;
  /** 模板 id；**没有模板来源**的对象（玩家角色）传 null */
  readonly path: WorldId | null;
  readonly kind: ObjKind;
  readonly name: string;
}

export abstract class GameObject {
  /** 运行时唯一实例 id（客户端 `get <id>` 用它，见 `oid.ts`） */
  public readonly oid: string;
  /**
   * 模板 id（来自注册表；同一模板可生成多个实例）。
   * `null` = 没有模板来源 —— 玩家角色由存档直接构造，不在 `world/` 里。
   */
  public readonly path: WorldId | null;
  public readonly kind: ObjKind;
  public name: string;

  protected constructor(init: GameObjectInit) {
    this.oid = init.oid;
    this.path = init.path;
    this.kind = init.kind;
    this.name = init.name;
    ENVIRONMENT.set(this, null);
  }

  /** 我在哪个容器里（房间 / 角色 / 背包）。不在任何容器里则为 null */
  public get environment(): Container | null {
    return envOf(this);
  }

  /**
   * 运行时实例 id 的**内容层别名**。
   *
   * `oid` 是引擎/框架内部用名（`OidSpace`、`findByOid`）；对外（内容层钩子、
   * 客户端 `get <id>`）统一叫 `id` —— 与 `ActorObject.id`、`Character.id` 对齐。
   * 24 册 §4 第 1 条禁止的是 `.ID` / `.id` **两套名字并存**，
   * 而这里是同一个值的两个入口：`oid` 表示"引擎分配的那串随机 id"，
   * `id` 表示"内容层看到的实例标识"，语义不同、不并存歧义。
   */
  public get id(): string {
    return this.oid;
  }

  /**
   * 我在哪个房间（沿容器链往上找；自己就是房间时返回自己）。
   *
   * ★ 26 册 §11.2 R1：这里的 `while` 原来**没有上界**。`addItem` 只挡住了
   *   `child === this` 的自环，挡不住**互环**（A 装 B、B 再装 A）：
   *   一旦成环，本 getter 就是**同步死循环** —— 不是报错，是整个进程挂住
   *   （实测：测试 worker 被 SIGTERM 杀掉，连 testTimeout 都救不回来）。
   *
   *   位置链在正常语义下是**树**（一个对象只有一个 environment），所以成环
   *   必然是数据损坏；这里按"链走完了"处理（返回 null），并带上 `seen`
   *   兜住一切形态的环（二元 / 三元 / 更长）。
   */
  public get room(): Container | null {
    const seen = new Set<GameObject>();
    let cur: GameObject | null = this;
    while (cur !== null) {
      if (cur.kind === 'room') return cur as Container;
      if (seen.has(cur)) return null; // 环：位置链不可能正常成环，视作"不在任何房间"
      seen.add(cur);
      cur = envOf(cur);
    }
    return null;
  }

  /**
   * 移动到目标容器（`null` = 移出到"无处"，即销毁前的脱钩）。
   * 返回是否真的发生了移动（已在目标容器里则返回 false）。
   *
   * 这是**唯一**的公开移动入口；两侧的一致性由 `Container` 保证。
   */
  public moveTo(dest: Container | null): boolean {
    if (dest === envOf(this)) return false;
    if (dest === null) {
      // 已在某容器里才需要摘掉；在顶层则无需动作
      envOf(this)?.removeItem(this);
      return true;
    }
    // 自环 / 成环检查在 `Container.addItem` 里（`child === this` 与"child 恰是祖先"）——
    // 那里两边都是 `Container`，类型上才说得通。
    dest.addItem(this);
    return true;
  }

  public toString(): string {
    return `${this.kind}:${this.path ?? '(无模板)'}(${this.oid})`;
  }
}

export abstract class Container extends GameObject {
  readonly #items: GameObject[] = [];
  /**
   * 容量上限。**基类缺省是"不限"** —— 具体种类的缺省由**子类**给，不在基类里写死：
   * 房间 `DEFAULT_ROOM_CAPACITY`(50) / 玩家 `DEFAULT_CHARACTER_CAPACITY`(50) / NPC `DEFAULT_NPC_CAPACITY`(10)。
   * 三档各自单源于 `room.ts` / `character.ts` / `npc.ts`，回归在 `tests/engine-capacity.test.ts`（26 册 §32）。
   */
  public readonly maxItems: number;

  protected constructor(init: GameObjectInit, maxItems: number = Number.POSITIVE_INFINITY) {
    super(init);
    this.maxItems = maxItems;
  }

  /** 内容物。只读视图 —— 要改内容请用 `moveTo()` 或下面的两个方法 */
  public get items(): readonly GameObject[] {
    return this.#items;
  }

  /**
   * 满了没有（wushen `CONTAINER.prototype.is_full`，`os/char/chara_move.js:22` 用它判移动）。
   *
   * ★ 容量判据**只此一处**：`addItem` 的抛错阈值也调它，不再各写一遍
   *   `length >= maxItems`（那种"同一条件写两遍"正是 24 册 §3 要消除的第二份真相）。
   *   两处一旦漂移，就会出现"`isFull()` 说没满、`addItem` 却抛"的鬼故事。
   */
  public isFull(): boolean {
    return this.#items.length >= this.maxItems;
  }

  public get itemCount(): number {
    return this.#items.length;
  }

  /**
   * 收进来。会同时把 `child.environment` 指向本容器（双向一致）。
   * 已在别的容器里则先摘掉（等价于移动）。
   */
  public addItem(child: GameObject): void {
    if (envOf(child) === this) return;
    if (child === this) {
      throw new ContainerError(`不能把 ${this.oid} 放进它自己里面`);
    }
    // ★ 环判定（S6，2026-10-16 审查）：`child` 若是**本容器的祖先**，收进来就成环
    //   （`a.moveTo(b); b.moveTo(a)` 两次调用即可，零报错）。
    //   读取侧（`room` getter）有 `seen` 兜住不死循环，但那是"兜" ——
    //   写入侧必须直接拒，别让损坏结构进得去。
    //   `seen` 同样带在这里：结构若**已经**坏了，这个上溯也不能变成死循环。
    const seen = new Set<GameObject>();
    for (let cur: GameObject | null = envOf(this); cur !== null; cur = envOf(cur)) {
      if (cur === child) {
        throw new ContainerError(
          `不能把 ${child.oid} 放进它的后代 ${this.oid}(${this.name}) 里面（会成环）`,
        );
      }
      if (seen.has(cur)) break; // 链已损坏（历史遗留的环）：交给读取侧兜，这里不追
      seen.add(cur);
    }
    if (this.isFull()) {
      throw new ContainerError(
        `${this.oid}(${this.name}) 已满：容量 ${this.maxItems}，无法放入 ${child.oid}`,
      );
    }
    envOf(child)?.removeItem(child);
    this.#items.push(child);
    ENVIRONMENT.set(child, this);
  }

  /** 摘出去。返回是否确实装有它 */
  public removeItem(child: GameObject): boolean {
    const idx = this.#items.indexOf(child);
    if (idx === -1) return false;
    this.#items.splice(idx, 1);
    if (envOf(child) === this) ENVIRONMENT.set(child, null);
    return true;
  }

  public hasItem(child: GameObject): boolean {
    return this.#items.includes(child);
  }

  public findByOid(oid: string): GameObject | undefined {
    return this.#items.find((x) => x.oid === oid);
  }
}

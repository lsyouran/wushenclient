/**
 * server/engine/npc.ts — NPC
 * ============================================================================
 * 对照 wushen `os/char/npc.js`（08 册 §8.1）。
 *
 * ★ 本批次的范围：NPC 的**数据面**（属性、技能簿、模板引用）
 *   与"同一模板可生成多个互不影响的实例"这一条结构保证。
 *   商店 / 对话 / 复活定时器 / 师徒属于后续批次 —— 这里不留空壳方法。
 *
 * ★ 技能簿（docs/27 决策 D9）：wushen 的 NPC 技能用 `skill_map(...)`
 *   建一个「槽 → 等级」的简化表，**把技能 id 丢了**（于是 NPC 说不出"它练的是太极剑法"）。
 *   这里改用与玩家同一套 `SkillBook`，**完整保留技能 id + 等级 + 装配槽**；
 *   内功系数也从簿上派生，玩家与 NPC 口径归一。
 */

import type { WorldId } from '@shared/ids.js';
import type { Container } from './base.js';
import { Character } from './character.js';
import type { CharacterInit } from './character.js';
import type { Item } from './item.js';
import type { RawPropMap } from './props.js';
import type { SkillRegistry } from './skill.js';
import type { ActionDef, DropDef, InteractHooks, NpcDef } from '../world/defs.js';

export class NpcError extends Error {
  public override readonly name = 'NpcError';
}

/**
 * 掉落铸造器：按模板路径 + 数量铸**一件新物品**。
 *
 * ★ 为什么是注入的闭包而不是引擎自己 `new Item`：铸物品要**新的 oid** 与**模板定义**，
 *   两者都只在**世界实例化期**可达（`world.ts#makeItem` 持有 `oidSpace` 与注册表）。
 *   引擎（`Npc`）拿不到它们 —— 与 `get`/`drop` 只能整叠搬运是**同一个结构约束**。
 *   于是照 `scheduler` / `rand` 的成例，由 `instantiateWorld` 把铸造器注入进来。
 */
export type ItemSpawner = (path: string, count: number) => Item;

export interface NpcInit extends CharacterInit {
  /** NPC 一定有模板来源（与玩家角色的区别） */
  readonly path: WorldId;
  readonly def: NpcDef;
  /** 技能注册表（NPC 的技能表要靠它把 id 解析成模板） */
  readonly skillRegistry: SkillRegistry;
  /** 掉落铸造器（世界实例化期注入；有 `drops` 的 NPC 缺少它会在死亡时**抛错**） */
  readonly spawnItem?: ItemSpawner | undefined;
  /**
   * 销毁回调（世界实例化期注入；T4）。
   *
   * ★ 与 `spawnItem` 同源同因：NPC 消散时要从世界索引里摘掉自己并**释放 oid**，
   *   而 `oidSpace` / 索引都只在 `instantiateWorld` 里可达 —— 引擎够不着。
   * ★ 缺省（测试里裸构造的 NPC）= 不入索引 ⇒ 无需摘除，`#onDestroy?.()` 是空操作。
   */
  readonly onDestroy?: (() => void) | undefined;
}

/**
 * NPC 的**默认容量**（照 wushen `os/char/follower.js:12` = 10）。
 * 玩家角色不在此列 —— 它走 `DEFAULT_CHARACTER_CAPACITY`（50，见 `character.ts`）。
 */
export const DEFAULT_NPC_CAPACITY = 10;

/** 一条掉落 roll 的产物：模板路径 + 份数（还未铸造） */
export interface DropRoll {
  readonly obj: string;
  readonly count: number;
}

/**
 * 按掉落表 roll 出"这一轮掉什么"（wushen `OBJ.create_by_odds`，`os/item/obj.js:204`）。
 *
 * ★ 口径**照抄 wushen**，逐条注明来源：
 *   1. `odds` 是**万分比**（不是百分比）：`Math.random()*10000 < odds` 才掉。
 *   2. ★ `(drop.odds || 10000)` —— 用的是 `||` 而非 `??`：`odds === 0` 会落到缺省
 *      `10000`，于是 **`odds: 0` 的语义是"必掉"而不是"不掉"**。这个反直觉的行为
 *      **原样保留**（改了就是第二份真相）；内容想表达"不掉"就直接**不写这条 drop**。
 *   3. 数量：缺省 1；**`min`+`max` 同时在场时，闭区间 `[min, max]` 均匀取并覆盖
 *      `count`**（wushen 原文就是这个顺序 —— `min && max` 的分支写在 `count` 之后）。
 *      ⚠️ 与 wushen 的一处细微偏离：wushen 用**真值**判 `if (drop.min && drop.max)`，
 *      于是 `min: 0` 会被当成"没写"；这里用 `!== undefined` 判，`min: 0` 算在场
 *      （`exactOptionalPropertyTypes` 代码库的统一写法）。`min: 0` 的语义是
 *      "可能掉 0 个"，本实现随后按 `count > 0` 把它滤掉。
 *   4. ★ 本实现**没有** `fall_obj`（wushen"没命中就掉替代物"那一支）：newmud 的
 *      `DropDef` 未声明该字段 —— 命中不了就是**不掉**，不是掉别的东西。
 *
 * 纯函数（只依赖传入的 `rand`）⇒ 可脱离角色/调度器单测。
 */
export function rollDrops(
  drops: readonly DropDef[] | undefined,
  rand: () => number,
): readonly DropRoll[] {
  const out: DropRoll[] = [];
  if (drops === undefined) return out;
  for (const d of drops) {
    // wushen 原文即 `(drop.odds || 10000)`；`odds=0` ⇒ 10000 ⇒ 必掉（见上）
    const odds = d.odds === undefined || d.odds === 0 ? 10_000 : d.odds;
    if (!(rand() * 10_000 < odds)) continue;
    let count = d.count ?? 1;
    if (d.min !== undefined && d.max !== undefined) {
      count = Math.floor(rand() * (d.max - d.min + 1)) + d.min;
    }
    if (count > 0) out.push({ obj: d.obj, count });
  }
  return out;
}

export class Npc extends Character {
  /** 模板定义（钩子与静态数据都从这里取） */
  public readonly def: NpcDef;
  /** 是否可被拜师（`on_master`） */
  public readonly onMaster: boolean;
  /** 掉落铸造器（世界实例化期注入；`undefined` = 世界没接，有 `drops` 时会抛） */
  readonly #spawnItem: ItemSpawner | undefined;
  /** 销毁回调（世界实例化期注入；`undefined` = 这个 NPC 不在世界索引里） */
  readonly #onDestroy: (() => void) | undefined;

  public constructor(init: NpcInit) {
    const d = init.def;
    // `exactOptionalPropertyTypes` 下不能直接写 `{ prop: d.prop }`（可能是 undefined），
    // 所以要按"有才给"的方式拼。见 character.ts 里 CharacterInit 的同一处理。
    const props: RawPropMap =
      init.props ??
      {
        ...(d.prop === undefined ? {} : { prop: d.prop }),
        ...(d.extProp === undefined ? {} : { extProp: d.extProp }),
      };
    // 属性一律从 def 来（模板说了算）；调用方传入的值只作为 def 缺省时的兜底。
    super(
      {
        oid: init.oid,
        path: init.path,
        name: init.name,
        str: d.str ?? init.str,
        con: d.con ?? init.con,
        dex: d.dex ?? init.dex,
        int: d.int ?? init.int,
        hp: d.hp ?? init.hp,
        mp: d.mp ?? init.mp,
        maxMp: d.max_mp ?? init.maxMp,
        per: d.per ?? init.per,
        age: d.age ?? init.age,
        gender: d.gender ?? init.gender,
        money: init.money,
        maxItems: init.maxItems ?? DEFAULT_NPC_CAPACITY,
        props,
        skillRegistry: init.skillRegistry,
        output: init.output,
        scheduler: init.scheduler,
        rand: init.rand,
      },
      'npc',
    );
    this.def = d;
    this.onMaster = d.on_master ?? false;
    this.#spawnItem = init.spawnItem;
    this.#onDestroy = init.onDestroy;

    // ★ 构造收尾：`super()` 里算派生属性时技能簿还是空的（见 character.ts 的说明），
    //   所以这里装载技能并用真实的内功系数重算一次。这是唯一一处"构造完再算"，
    //   且它是**幂等**的 —— 即便重复调用也只是重算同一个值。
    //   `loadFromDef` 对应 wushen `skill_map(...)`：**不做学习条件判断**（NPC 是"直接会"）。
    this.skills.loadFromDef(d.skills ?? []);
  }

  /**
   * 本 NPC 的"可点击动作"（模板里声明的，如 `ask`）。
   * 它是三级分发的**第三级**宿主：`ask xiaoer` 里 `xiaoer` 是目标，
   * 全局没有 `ask xiaoer` 这个指令时，查的就是目标身上的动作（docs/wushen/13 §13.3）。
   */
  public get actions(): readonly ActionDef[] {
    return this.def.actions ?? [];
  }

  /**
   * 一句话描述（`ActorObject.desc`）。
   *
   * ★ 从 `def` 取而不是在实例上另存一份：wushen 的 `NPC.prototype.query_commands_json`
   *   也是读 `this.desc`（那是模板写进实例的），这里让"同一模板的多个实例"
   *   共享一个不可变字符串，少一处可以漂移的地方。
   */
  public get desc(): string {
    return this.def.desc;
  }

  /**
   * 交互面（`ActorObject.interact`）。NPC 目前只贡献一项：**收不收别人的东西**
   * （`NpcDef.on_accept`，wushen `target.on_accept(player, objId, count)`）。
   *
   * ★ 为什么物品那几项（`noGet` / `onUse`…）不在这里填 `false`：
   *   它们是**物品专属**的字段，"NPC 的 `noGet` 是 false"是个没有意义的命题。
   *   留空（`undefined`）表达的正是"这个 kind 与此项无关"，而 `?.` 判据下
   *   两种情形（`undefined` / 字段缺席）行为一致 —— 不必要地填会掩盖语义。
   */
  public get interact(): InteractHooks {
    return { onAccept: this.def.on_accept };
  }

  // ── 死亡 ─────────────────────────────────────────────────────────────────

  /**
   * 死亡准入（wushen `NPC.prototype.die` 的 `if (this.on_die && this.on_die(killer) == false)`，
   * `os/char/npc.js:124`）。内容钩子返回 `false` ⇒ 这次不死（气血抬回 1）。
   */
  protected override canDie(killer?: Character): boolean {
    const hook = this.def.on_die;
    return hook === undefined || hook(killer ?? this) !== false;
  }

  /**
   * 死亡收尾：**掉落 + 从房间消散**（叉 3 裁定：不搞尸体）。
   *
   * ★ wushen 是"留一具 corpse（`new CORPSE(); corpse.init(this)`）+ `item_changed(this, false)`
   *   把人摘出房间"（`os/char/npc.js:133-142`）。本项目**不建尸体容器**
   *   —— 掉落**直接落在原来的房间地上**（玩家 `get` 捡），人随即"倒下、不见了"。
   *   ⇒ 表现上少了一个容器，掉落与拾取的玩法闭环不变。
   * ★ 定时重刷（wushen 的 `this.call_out(this.relive, 300000)`）属后续批次。
   */
  protected override afterDeath(_killer?: Character): void {
    // ★ 先摘出房间、再掉落：`#dropLoot` 抛错（见下）时人也已经消失，
    //   不会留下"死而不消散"的幽灵；掉落要掉在**原来那个**房间，所以先抓住引用。
    const room = this.environment;
    this.moveTo(null);
    // ★ T4（26 册 §55）：人没了 ⇒ 从世界的实例索引里摘掉、**把 oid 还回去**。
    //   不摘的话 `world.npcs` 只增不减，而每次击杀还会铸新掉落物进 `world.items`。
    this.#onDestroy?.();
    if (room !== null) this.#dropLoot(room);
  }

  /**
   * 把掉落表 roll 出来的东西放进（死时所在的）房间地上。
   *
   * ★ 装不下（房间满）时**跳过剩余掉落**：房间容量是内容层配置问题，不该让
   *   一次死亡把调度器的这一拍整个打断（掉落丢失，但战斗循环继续）。
   *   取舍记在这里，免得日后被当成"掉落时有时无"的 bug 去查。
   */
  #dropLoot(room: Container): void {
    const rolls = rollDrops(this.def.drops, this.rand);
    if (rolls.length === 0) return;
    if (this.#spawnItem === undefined) {
      // ★ 内容声明了 `drops`、世界却没注入铸造器 ⇒ **大声抛**，不静默
      //   （26 册 L8 的"声明未实现"病：写了掉落表却永远不掉，是最难查的那类静默）。
      throw new NpcError(
        `NPC ${this.path}（${this.name}）声明了 drops，但世界未注入 spawnItem：掉落无处铸造`,
      );
    }
    for (const r of rolls) {
      if (room.isFull()) break; // 地上满了 ⇒ 剩下的掉不下来（见方法头注）
      room.addItem(this.#spawnItem(r.obj, r.count));
    }
  }
}

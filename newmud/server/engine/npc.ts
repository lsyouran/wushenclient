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
import { Character } from './character.js';
import type { CharacterInit } from './character.js';
import type { RawPropMap } from './props.js';
import type { SkillRegistry } from './skill.js';
import type { ActionDef, NpcDef } from '../world/defs.js';

export interface NpcInit extends CharacterInit {
  /** NPC 一定有模板来源（与玩家角色的区别） */
  readonly path: WorldId;
  readonly def: NpcDef;
  /** 技能注册表（NPC 的技能表要靠它把 id 解析成模板） */
  readonly skillRegistry: SkillRegistry;
}

/**
 * NPC 的**默认容量**（照 wushen `os/char/follower.js:12` = 10）。
 * 玩家角色不在此列 —— 它走 `DEFAULT_CHARACTER_CAPACITY`（50，见 `character.ts`）。
 */
export const DEFAULT_NPC_CAPACITY = 10;

export class Npc extends Character {
  /** 模板定义（钩子与静态数据都从这里取） */
  public readonly def: NpcDef;
  /** 是否可被拜师（`on_master`） */
  public readonly onMaster: boolean;

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
      },
      'npc',
    );
    this.def = d;
    this.onMaster = d.on_master ?? false;

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
}

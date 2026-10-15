/**
 * server/engine/world.ts — 世界实例化
 * ============================================================================
 * 把"注册表里的定义"变成"能走动、能装东西的世界"。这是 07 册 §7.4
 * 「工厂函数（从文件造对象）」在本项目的对应物。
 *
 * ★ 与 wushen 的工厂（`BASE.CREATE` / `BASE.NEW` / `NPC.CLONE`）的三点差异：
 *
 *   1. **不执行脚本体**。wushen 的 `func.apply(obj)` 把内容文件当构造器跑，
 *      `this` 指向新对象；本项目的内容文件只**声明数据**（`defineRoom(...)`），
 *      实例化是显式构造。于是加载顺序不再是"谁能覆盖谁"的博弈。
 *
 *   2. **模板 → 实例是"复制字段"，不是"原型委托"**。
 *      wushen 用 `Object.create(base)`，1000 只怪共享一份原型 ——
 *      于是 `CHARACTER.prototype.clone` 必须手工重建 `prop`/`temp`/`equipment`
 *      （07 册 §7.3 明确记了"两只怪共用同一份 prop，add_prop 互相污染"）。
 *      这里每个实例都是 `new Npc(...)`，可变状态天然隔离。
 *      `tests/engine-world.test.ts` 用「同一 def 生成的两个实例互不影响」钉住这条。
 *
 *   3. **出口在实例化时解析成引用**。wushen 运行时到处用字符串查
 *      `WORLD.ROOMS[path]`；这里一次性连好 `Room.exitTo(dir)` 直接拿对象。
 *      （定义层仍然写字符串 —— 那是"避免内容文件互相 import"的必要妥协，
 *      见 10 册 §10.2 / 22 册模式 5。）
 */

import type { WorldId } from '@shared/ids.js';
import { asWorldId } from '@shared/ids.js';
import { CommandTable } from './command.js';
import type { CommandEntry } from './command.js';
import { Item } from './item.js';
import { Npc } from './npc.js';
import { OidSpace } from './oid.js';
import { entriesOf, getDef } from './registry.js';
import { Room, exitPairsOf } from './room.js';
import { SkillRegistry } from './skill.js';
import { tuningSummary } from './tuning.js';
import type { AreaDef, CommandDef, ItemDef, NpcDef, RoomDef, SkillDef } from '../world/defs.js';

export class WorldError extends Error {
  public override readonly name = 'WorldError';
}

export interface WorldStats {
  readonly rooms: number;
  readonly npcs: number;
  readonly items: number;
  readonly areas: number;
  readonly exits: number;
  /** 指令**条目**数（一个条目可有多个别名） */
  readonly commands: number;
  /** 指令别名总数 */
  readonly commandAliases: number;
  /** 技能模板总数 */
  readonly skills: number;
  /** 当前生效的**全部可调参数**（启动日志用；调参时一眼能看见生效值） */
  readonly formula: string;
  readonly oidsIssued: number;
}

export interface World {
  readonly oidSpace: OidSpace;
  /** 房间是**模板单例**（一个模板一个实例），故按 path 索引 */
  readonly rooms: ReadonlyMap<string, Room>;
  /** 角色/物品是**实例**（同一模板可有很多个），故按 oid 索引 */
  readonly npcs: ReadonlyMap<string, Npc>;
  readonly items: ReadonlyMap<string, Item>;
  /** 起始房间（取第一个区域的 `first`；没有区域则为 null） */
  readonly startRoom: Room | null;
  /** 指令表（别名 → 指令；取代 wushen 的 `WORLD.COMMANDS` 裸对象） */
  readonly commands: CommandTable;
  /** 技能注册表（模板；取代 wushen 的 `WORLD.SKILLS` + `SKILL[slot][grade]`） */
  readonly skillRegistry: SkillRegistry;
  readonly stats: WorldStats;

  room(path: string): Room | undefined;
  npc(oid: string): Npc | undefined;
  item(oid: string): Item | undefined;
  /** 某模板的**全部** NPC 实例（同一模板可能被多个房间各放一个） */
  npcsOf(path: string): readonly Npc[];
  itemsOf(path: string): readonly Item[];
}

export interface InstantiateOptions {
  /** 复用外部 id 空间（测试 / 读档恢复场景）；缺省自建 */
  readonly oidSpace?: OidSpace;
}

function brand(id: string, ctx: string): WorldId {
  return asWorldId(id, ctx);
}

/** 从注册表造出整个世界。**纯函数式**：不写全局、不改注册表 */
export function instantiateWorld(options: InstantiateOptions = {}): World {
  const oidSpace = options.oidSpace ?? new OidSpace();

  // ── 0. 技能注册表（模板；NPC 技能表要靠它解析 id）────────────────────────
  //    构造时即校验每个技能定义（基本技能必须声明 slot、can_enables 只能是闭集槽名 …），
  //    于是"内容里的技能写错了"在世界实例化的**那一刻**就炸，而不是等某次战斗。
  const skillRegistry = new SkillRegistry(
    entriesOf('skill').map((e) => ({ id: e.id, def: e.def as SkillDef })),
  );

  const rooms = new Map<string, Room>();
  const npcs = new Map<string, Npc>();
  const items = new Map<string, Item>();
  const npcsByPath = new Map<string, Npc[]>();
  const itemsByPath = new Map<string, Item[]>();
  let exits = 0;

  // ── 1. 物品（先造，房间要往里放）────────────────────────────────────────
  const makeItem = (path: string): Item => {
    const def = getDef<ItemDef>('item', path);
    if (def === undefined) {
      throw new WorldError(`item 模板不存在：${path}`);
    }
    const item = new Item({
      oid: oidSpace.next(),
      path: brand(path, 'instantiateWorld:item'),
      name: def.name,
      desc: def.desc,
      count: 1,
      value: def.value,
      unit: def.unit,
      grade: def.grade,
      combined: def.combined,
      equipType: def.equipType,
      weaponType: def.weaponType,
    });
    items.set(item.oid, item);
    const list = itemsByPath.get(path);
    if (list === undefined) itemsByPath.set(path, [item]);
    else list.push(item);
    return item;
  };

  // ── 2. 房间骨架（先把所有房间造出来，出口才有东西可连）──────────────────
  for (const entry of entriesOf('room')) {
    const def = getDef<RoomDef>('room', entry.id);
    if (def === undefined) continue;
    const room = new Room({
      oid: oidSpace.next(),
      path: brand(entry.id, 'instantiateWorld:room'),
      name: def.name,
      desc: def.desc,
      noFight: def.no_fight,
      maxItems: def.max_item_count,
      def,
    });
    rooms.set(entry.id, room);
  }

  // ── 3. 出口（定义层是字符串，运行时是引用）──────────────────────────────
  for (const entry of entriesOf('room')) {
    const room = rooms.get(entry.id);
    const def = getDef<RoomDef>('room', entry.id);
    if (room === undefined || def === undefined) continue;
    for (const pair of exitPairsOf(def)) {
      const target = rooms.get(pair.target);
      if (target === undefined) {
        // G4 闸门已保证不会走到这里；兜一道，避免"内容坏了但世界照跑"
        throw new WorldError(`${entry.id} 的出口 "${pair.dir}" 指向不存在的房间 ${pair.target}`);
      }
      room.linkExit(pair.dir, target);
      exits += 1;
    }
  }

  // ── 4. 往房间里放 NPC 与物品 ─────────────────────────────────────────────
  for (const entry of entriesOf('room')) {
    const room = rooms.get(entry.id);
    const def = getDef<RoomDef>('room', entry.id);
    if (room === undefined || def === undefined) continue;

    for (const npcPath of def.npcs ?? []) {
      const npcDef = getDef<NpcDef>('npc', npcPath);
      if (npcDef === undefined) {
        throw new WorldError(`${entry.id} 里的 NPC 模板不存在：${npcPath}`);
      }
      const npc = new Npc({
        oid: oidSpace.next(),
        path: brand(npcPath, 'instantiateWorld:npc'),
        name: npcDef.name,
        def: npcDef,
        skillRegistry,
      });
      npcs.set(npc.oid, npc);
      const list = npcsByPath.get(npcPath);
      if (list === undefined) npcsByPath.set(npcPath, [npc]);
      else list.push(npc);
      room.addItem(npc);
    }

    for (const itemPath of def.objects ?? []) {
      room.addItem(makeItem(itemPath));
    }
  }

  // ── 5. 起始房间 ─────────────────────────────────────────────────────────
  let startRoom: Room | null = null;
  for (const entry of entriesOf('area')) {
    const areaDef = getDef<AreaDef>('area', entry.id);
    if (areaDef === undefined) continue;
    const first = rooms.get(areaDef.first);
    if (first === undefined) {
      throw new WorldError(`区域 ${entry.id} 的 first 指向不存在的房间 ${areaDef.first}`);
    }
    // 取**第一个**区域的 first（G4 已保证 first 存在）；多区域的世界入口还需再做一层规则
    startRoom ??= first;
  }

  // ── 6. 指令表 ───────────────────────────────────────────────────────────
  // registry 只存 `unknown`，真正的声明校验在 `CommandTable` 里做
  // （parseAliases 会拒掉：空 command、非法别名、别名自重复、带 g/y 的 regex）。
  // 重名别名在这一步**抛错**（wushen 只 console.error 后静默覆盖）。
  const commands = new CommandTable(
    entriesOf('command').map((e): CommandEntry => ({ id: e.id, def: e.def as CommandDef })),
  );

  const world: World = {
    oidSpace,
    rooms,
    npcs,
    items,
    startRoom,
    commands,
    skillRegistry,
    stats: {
      rooms: rooms.size,
      npcs: npcs.size,
      items: items.size,
      areas: entriesOf('area').length,
      exits,
      commands: commands.size,
      commandAliases: commands.aliasCount,
      skills: skillRegistry.size,
      formula: tuningSummary(),
      oidsIssued: oidSpace.size,
    },
    room: (path) => rooms.get(path),
    npc: (oid) => npcs.get(oid),
    item: (oid) => items.get(oid),
    npcsOf: (path) => npcsByPath.get(path) ?? [],
    itemsOf: (path) => itemsByPath.get(path) ?? [],
  };
  return world;
}

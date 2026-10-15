/**
 * server/engine/room.ts — 房间
 * ============================================================================
 * 对照 wushen `os/room/room.js`（10 册）。
 *
 * ★ 从 wushen 抄的两个设计（22 册 §22.7）：
 *   - 模式 4「房间即容器」：房间是容器，NPC 与物品的"在里面"与
 *     "剑在背包里"是同一套位置语义（`Container`）。
 *   - 模式 5「出口用 path 字符串」：定义层用 `{ north: 'yz/beidajie1' }`，
 *     避免内容文件之间互相 import 造成循环引用（也让热更新不必解引用）。
 *     这里在**实例化时**把 path 解析成实例引用（`world.ts` 负责），
 *     于是运行时走的是对象引用、没有字符串查找开销。
 *
 * ★ 与 wushen 的差异：
 *   wushen 的出口表是双向手写 + 单向失配只能靠肉眼。这里 `linkExit` 只允许
 *   设置一次（重复设同一方向直接抛错），并且**不给反向出口**——反向是否连通
 *   由内容显式声明（"北大街的南口通往广场"是**内容事实**，不是引擎推论）。
 *   单向通道（陷阱、滑梯）因此天然合法，不需要 `one_way` 这类开关。
 *
 * ★ 进出钩子是**两层**（FG-16）：房间自己的 `on_enter` / `on_leave`，
 *   加上房间里其它**活体**（NPC）的同名钩子 —— wushen 的后半层在
 *   `ROOM.prototype.item_changed`（`os/room/room.js:47-55`）里，见本文件末尾。
 */

import type { Direction } from '@shared/constants.js';
import { DIRECTION_LABELS, MOVE_MESSAGES } from '@shared/constants.js';
import type { WorldId } from '@shared/ids.js';
import { Container } from './base.js';
import type { GameObject } from './base.js';
import type { ActionDef, Actor, EnterLeaveHooks, RoomDef } from '../world/defs.js';

export class RoomError extends Error {
  public override readonly name = 'RoomError';
}

export const DEFAULT_ROOM_CAPACITY = 50;

export interface RoomInit {
  readonly oid: string;
  readonly path: WorldId;
  readonly name: string;
  readonly desc: string;
  // 带 `| undefined`：`exactOptionalPropertyTypes` 下要能写 `{ noFight: def.no_fight }`
  readonly noFight?: boolean | undefined;
  readonly maxItems?: number | undefined;
  readonly def?: RoomDef | undefined;
}

export class Room extends Container {
  public readonly desc: string;
  public readonly noFight: boolean;
  /** 出口表：方向 → 目标房间（实例化时解析，`linkExit` 是唯一写入口） */
  readonly #exits = new Map<Direction, Room>();
  /** 派生的移动动作缓存；由 `linkExit` 置空（出口表的唯一写入口） */
  #moveActions: ActionDef[] | null = null;
  /** 定义体（`on_enter` / `on_leave` / `actions` 等钩子从这里取） */
  public readonly def: RoomDef | undefined;

  public constructor(init: RoomInit) {
    super(
      { oid: init.oid, path: init.path, kind: 'room', name: init.name },
      init.maxItems ?? DEFAULT_ROOM_CAPACITY,
    );
    this.desc = init.desc;
    this.noFight = init.noFight ?? false;
    this.def = init.def;
  }

  // ── 出口 ────────────────────────────────────────────────────────────────

  /**
   * 本房间的"可点击动作"（模板里声明的 + **从出口派生出来的移动动作**）。
   *
   * ★ 它是三级分发的**第一级**宿主：房间动作**优先于**同名全局指令，
   *   于是"在这个房间里打坐有事发生"天然可能（docs/wushen/13 §13.3）。
   *   触发词可以是单个词（`dazuo`）也可以是多词（`goto home`）。
   *
   * ★ 为什么移动动作**派生于 `exits` 而不是各写一份内容**：
   *   出口表是方向键的（`{ north: 'yz/beidajie1' }`），"往北能走"因此
   *   已经是**内容事实**；再写一遍 `<dir>` 指令就是同一件事的第二份 ——
   *   24 册 §3 要消除的正是这种。派生还顺手拿到两样东西：
   *     ① 六道闸门（打坐 / 昏迷 / 忙碌时走不动）—— 无需在移动指令里重复；
   *     ② 新加一条出口，可走方向自动跟着出现，不会"出口画了但走不了"。
   *
   * ★ 顺序：**声明的在前、派生的在后**。客户端拿到的 `commands` 因此
   *   头几条仍是内容作者写下的动作（`dazuo`），行为不因本改动而漂移。
   *
   * ★ wushen 对照：原作把移动做成**全局** `go` 指令 + `doors[]` 短写表
   *   （`world/cmd/action/go.js`），于是"这个房间的出口"与"能走的方向"
   *   是两处各自维护的；这里改成一处派生。短写（`n`/`s`…）不在这里展开 ——
   *   那是**输入归一化**（`DIRECTION_ALIASES`），属分发的输入侧。
   */
  public get actions(): readonly ActionDef[] {
    // 无出口时不必重建数组（绝大多数房间外的场景走这条）
    if (this.#exits.size === 0) return this.def?.actions ?? [];
    return [...(this.def?.actions ?? []), ...this.#derivedMoveActions()];
  }

  /**
   * 每个出口派生一条同名动作：`north` → 「往北走」。
   *
   * 缓存由 `linkExit` 失效（它是出口表的**唯一**写入口），
   * 因此"先连出口后取用"与"先取用后连出口"两种时序都拿到正确结果。
   */
  #derivedMoveActions(): readonly ActionDef[] {
    if (this.#moveActions === null) {
      this.#moveActions = [...this.#exits.keys()].map((dir): ActionDef => ({
        cmd: dir,
        name: `往${DIRECTION_LABELS[dir]}走`,
        // ★ 闸门用**缺省值**：忙碌 / 打坐 / 昏迷 / 灵魂状态下一律走不动，
        //   战斗中可以（`allow_fight` 缺省 true，与 wushen 一致）。
        run: (me) => {
          // 文案按**原因**分（26 册 T2）：没出路 / 内容拦住 / 房间满员 ——
          // 与 `world/command/move/go.ts` 共用 `MOVE_MESSAGES` 这一份
          // （以前这里和那边各写一遍 '那边过不去。'，改一处另一处不动）。
          const r = me.go(dir);
          if (!r.ok) me.notify(MOVE_MESSAGES[r.reason]);
        },
      }));
    }
    return this.#moveActions;
  }

  public get exits(): ReadonlyMap<Direction, Room> {
    return this.#exits;
  }

  public exitCount(): number {
    return this.#exits.size;
  }

  /** 从这个方向能走到哪（没有出口返回 undefined） */
  public exitTo(dir: Direction): Room | undefined {
    return this.#exits.get(dir);
  }

  /**
   * 连一条出口。**同方向重复连直接抛错** —— 静默覆盖会让"内容文件里改了一行"
   * 变成一条无声消失的通道，而那正是 wushen 出口表最难查的那类 bug。
   */
  public linkExit(dir: Direction, target: Room): void {
    if (this.#exits.has(dir)) {
      const prev = this.#exits.get(dir);
      throw new RoomError(
        `${this.path} 的出口 "${dir}" 已有目标 ${prev?.path ?? '?'}，` +
          `不能再连到 ${target.path}（重复声明出口；单向通道请只声明一次）`,
      );
    }
    if (target === this) {
      throw new RoomError(`${this.path} 的出口 "${dir}" 指向自己`);
    }
    this.#exits.set(dir, target);
    this.#moveActions = null; // 出口表变了 → 派生的移动动作作废（见 get actions）
  }

  // ── 进出钩子 ────────────────────────────────────────────────────────────
  // 钩子的**参数契约**是 `defs.ts` 的 `Actor`（最小面：notify/sendRoom/sendCommands），
  // 而不是完整的 `Character` —— 内容层不该依赖引擎内部结构。
  //
  // ★ FG-16：进出**是两层钩子**，不是一层。wushen `ROOM.prototype.do_enter/do_leave`
  //   除了跑房间自己的 `on_enter` / `on_leave`，还经 `item_changed`（`room.js:47-55`）
  //   跑**房间里其它活体**的钩子 —— 参数是"进来的那个人"。
  //   在接上之前，内容里写的 NPC 台词是一句**到不了玩家的死内容**
  //   （`world/npc/pub/npc/xiaoer.ts` 的「这位客官，要住店吗？」），
  //   而那正是最典型的"内容写了、引擎没接"。

  /**
   * 进入本房间。**顺序照 wushen**：先房间里的活体（`item_changed`，`room.js:26`），
   * 再房间自己（`room.js:27`）。
   *
   * ★ `me` 不是活体时，**房内活体的钩子全部跳过**，但**房间自己的 `on_enter` 照跑**
   *   （wushen `do_enter` 里 `this.on_enter` 是无条件的）—— 边界由 `#hooked()` 把守。
   */
  public fireEnter(me: Actor): void {
    for (const hooks of this.#hooked(me)) hooks.on_enter?.(me);
    this.def?.on_enter?.(me);
  }

  /**
   * 是否允许从某方向离开。**顺序照 wushen**：先房间自己（`room.js:12`），
   * 再房间里的活体（`room.js:15` → `item_changed` → `:52`）；任一返回 `false` 即拦住
   * （wushen 是 `== false` 的严格判定，返回 `undefined` 不算拦）。
   *
   * 默认允许 —— 没有钩子的房间（绝大多数）走这条。
   *
   * ★ `me` 不是活体时，**房内活体的 `on_leave` 全部跳过**，但**房间自己的 `on_leave` 照跑**
   *   （wushen `do_leave` 里 `this.on_leave` 在 `item_changed` **之前**且无条件）——
   *   边界同样由 `#hooked()` 把守。
   */
  public allowLeave(me: Actor, dir: Direction): boolean {
    if (this.def?.on_leave?.(me, dir) === false) return false;
    for (const hooks of this.#hooked(me)) {
      if (hooks.on_leave?.(me, dir) === false) return false;
    }
    return true;
  }

  /**
   * 房间里**该被调到的活体**（= NPC），**不含 `me` 自己**；**`me` 不是活体时一个都不给**。
   *
   * ★ 两条判据都在这儿（E4 / wushen `ROOM.item_changed`）：
   *   ① 房内对象**自己有钩子**（`hooksOf` 判 `def`）—— 见下面的函数注释；
   *   ② 进出者**是活体**（wushen `if (obj.hp)`，`os/room/room.js:48`）。
   *
   * ★★ ② 的位置是要害：**只压"房内活体"这一层**。房间自己的 `on_enter` / `on_leave`
   *   由调用方**无条件**跑（wushen `do_enter` / `do_leave` 亦然）——
   *   所以**不能**把这个判定提到 `fireEnter()` / `allowLeave()` 的开头，
   *   那会连房间自己的钩子一起压掉（看起来更整齐，但偏离 wushen）。
   *   `tests/move-full.test.ts` 的「非活体进出」那两条把这条边界钉住了。
   *
   * ★ 放在生成器**开头判一次**：wushen 是写在 `for (item of this.items)` **里面**的，
   *   同一个 `obj` 被反复判 N 遍；而它本质是"这次事件该不该发生"的**全局前置条件**，
   *   不是"逐个房内对象"的过滤条件。
   *
   * ★ 为什么这条今天"看起来多余"、仍需保留：今天只有 `Character.go()` 能触发进出，
   *   而 `hp <= 0` 的角色过不了命令闸门（`allow_die` 缺省 false，见 `checkCommandGates`）。
   *   但它是**将来的洞** —— NPC 自主移动、或"灵魂态可移动"一落地就会炸，
   *   而且炸的样子很荒谬：**死人"走进"客栈，店小二还会招呼他**。
   *
   * ★ 跳过 `me` 是硬要求，不是优化：`fireEnter` 是在 `moveTo` **之后**跑的，
   *   那一刻移动者已经在 `this.items` 里了 —— 不跳的话，一个会走路的 NPC
   *   每走一步都会触发自己的 `on_enter`、并被自己的 `on_leave` 拦住
   *   （wushen `item_changed` 的 `if (item == obj) continue;` 就是干这个的；
   *   `tests/move-full.test.ts` 的「跳过自己」那两条钉住了它）。
   *
   * ★ 用 `id` 比而不是比对象引用：`Actor` 与 `GameObject` 在类型上没有交集，
   *   直接比对象会让 TS 报"这两个永远不会相等"。`id` 就是全局唯一的 oid，等价。
   *
   * ★ 两个调用点共用它，于是"谁算活体 / 跳过谁"只有一处定义（FG-21 同类问题）。
   */
  *#hooked(me: Actor): Generator<EnterLeaveHooks> {
    if (!me.isAlive) return; // ← 判据 ②（wushen `os/room/room.js:48` 的 `if (obj.hp)`）
    for (const obj of this.items) {
      if (obj.id === me.id) continue;
      const hooks = hooksOf(obj);
      if (hooks !== undefined) yield hooks;
    }
  }
}

/**
 * 取一个房间内对象的进出钩子声明；**没有 `def` 的东西返回 `undefined`**。
 *
 * ★ 这是"谁算活体"的判据 **①**（wushen 是 `item.on_enter` 存在与否）：
 *   本项目只有 `Npc`（与 `Room`）持 `def`，`Item` / `Player` 都不持 ——
 *   于是"有钩子"天然等于"是 NPC"。
 *   ★ 判据 **②**（进出者必须活着）不在这里，在 `#hooked()` 的开头 ——
 *     它问的是**另一个对象**，别混进来（E4，见 `defs.ts` 的 `EnterLeaveHooks`）。
 *
 * ★ 为什么不写 `obj instanceof Npc`：`character.ts` 已经**运行时** import 了本文件
 *   （`go()` 里的 `instanceof Room`），这里再 import `npc.ts` 就成了
 *   `room → npc → character → room` 的循环（ESM 下是 TDZ 地雷，不是编译错）。
 *   结构判据在语义上也更准：内容层要的是"这个 def 有没有钩子"，不是"它是什么类"。
 */
function hooksOf(obj: GameObject): EnterLeaveHooks | undefined {
  return (obj as Partial<{ readonly def: EnterLeaveHooks | undefined }>).def;
}

/** 拍平后的出口声明：方向 → 目标模板 id */
export interface ExitPair {
  readonly dir: Direction;
  readonly target: string;
}

/**
 * 定义层的出口表 → 方向/目标对列表。
 *
 * `defs.ts` 里 `exits` 的类型是 `Partial<Record<Direction, RefId>>`，
 * 这里把它拍平成数组，便于 `world.ts` 逐条解析成实例引用。
 */
export function exitPairsOf(def: RoomDef): readonly ExitPair[] {
  const exits = def.exits;
  if (exits === undefined) return [];
  const out: ExitPair[] = [];
  for (const [dir, target] of Object.entries(exits)) {
    if (target === undefined) continue;
    out.push({ dir: dir as Direction, target });
  }
  return out;
}

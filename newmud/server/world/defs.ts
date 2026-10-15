/**
 * server/world/defs.ts — 内容层对象定义类型（`define*` 的入参契约）
 * ============================================================================
 * 这是"写内容的人"看到的类型。设计取舍：
 *
 * - **引用 id 用宽松的 `string`**（`RefId`），不用 `WorldId` 品牌类型。
 *   原因：品牌类型会强迫内容作者到处写 `asWorldId('yz/guangchang')`，可读性差。
 *   代价是错误从"编译期"后移到"注册期 + 闸门期"——由 define* 的运行时校验
 *   与 G4/G5 闸门补上，报错依然定位到具体 id。
 *
 * - **钩子参数用最小契约 `Actor`**，而不是完整的 Character 类型：
 *   内容不应该依赖引擎内部结构（否则引擎一改全崩）。
 *   待引擎落地后再按需扩宽。
 */

import type {
  Channel,
  Direction,
  EnableSlot,
  EquipSlot,
  ExtProp,
  Gender,
  MoveResult,
  PropKey,
  SkillType,
  WeaponType,
} from '@shared/constants.js';
import type { ObjKind } from '../engine/base.js';
import type { ViewSubject } from '../engine/view-text.js';
import type { AttrBreakdown } from '../engine/formula.js';
import type { WorldId } from '@shared/ids.js';

/** 内容层书写的引用 id（注册时统一校验，见 define.ts） */
export type RefId = string;

/**
 * 属性映射。**刻意拆成两个字段**，而不是 `Partial<Record<PropKey | ExtProp, number>>`：
 * 后者会让 `Record<ExtProp, number>` 退化成 `{ [x: string]: number }` 索引签名，
 * 于是 `prop: { attack: 1 }` 这种错键又能编译通过 —— 闭集护栏当场失效。
 *
 * 拆开之后还额外贯彻了 24 册 §3.3 的边界：
 *   - `prop`    只认引擎核心键（CORE + 派生 MOD），**参与核心公式**
 *   - `extProp` 只认 `registerExtProp()` 产出的品牌键，**永不参与核心公式**
 *               （这正是 wushen #20「两处各覆盖一份 recount」的根治办法）
 */
export interface PropMap {
  readonly prop?: Readonly<Partial<Record<PropKey, number>>>;
  readonly extProp?: ReadonlyArray<readonly [ExtProp, number]>;
}

/**
 * 一个对象的**详情**（wushen `query_commands()` 返回的那个 `{type:"item",…}` 载荷）。
 *
 * ★ 为什么不让内容层自己拼 JSON 字符串：wushen 的 `select` 命令是
 *   `me.notify(target.query_commands(me))` —— 把一个 JSON **当文本**发出去，
 *   客户端再试着 `JSON.parse` 回来认包。那是一条"文本里夹协议"的隐式约定：
 *   `notify("这里没有这个东西。")` 与 `notify('{"type":"item",…}')` 走同一个出口，
 *   只靠"首字符是不是 `{`"区分（`select.js` 与 `npc.js:113` 合起来才看得懂）。
 *   这里改成**显式的结构化出口**（`Actor.showItem`），由会话层负责包成 `item` 帧 ——
 *   内容层不认识协议，协议层也不用猜文本。
 */
export interface ItemDetailView {
  readonly id: string;
  readonly name: string;
  /**
   * 展示用正文：**名字行 + 描述行**（对应 wushen `OBJ.get_desc()` 的
   * `this.color_name + "\n" + this.desc`）。
   * wushen 的 NPC 那一支只给 `this.desc`（不带名字），两边不统一；
   * 这里统一成 `get_desc()` 的形态 —— 不然玩家点完只看到"一个手脚麻利的店小二。"
   * 却不知道点的是谁（这条链路的命令回显已经按 wushen 去掉了）。
   */
  readonly desc: string;
  readonly commands: readonly { readonly cmd: string; readonly name: string }[];
}

/** 钩子里能拿到的角色最小契约 */
export interface Actor {
  readonly id: string;
  readonly name: string;
  notify(text: string): void;
  /**
   * 向**本房间**广播一句话（wushen `CHARACTER.prototype.send_room`，
   * `os/char/character.js:71`）。
   *
   * ★ 文案里的 `$` 占位符**按收件人分别渲染**（三视角，见
   *   `engine/view-text.ts`）：同一句 `'$N朝$n拱了拱手。'`，
   *   本人口中是「**你**朝慕容拱了拱手」，目标口中是「阿飞朝**你**拱了拱手」，
   *   旁人眼中是「阿飞朝慕容拱了拱手」。内容层只写**一份**文案。
   *
   * ★ 受众是**房间里的玩家角色**（wushen 的 `is_player` 过滤）：
   *   NPC 收不到房间广播，但 NPC **可以发** —— 它说的话会到房间里每个玩家手上
   *   （所以这是内容层写 NPC 台词的通道）。
   *
   * @param target      这一句所针对的对象（`$n/$p/$i` 的来源）。它本人拿到
   *                    第二人称版本；没传、或它不在本房间时，所有人都拿第三人称版本。
   * @param excludeself 连**自己**都不发（wushen 的第三个实参，缺省 false）
   */
  sendRoom(text: string, target?: ViewSubject | null, excludeself?: boolean): void;
  sendCommands(...cmdNamePairs: string[]): void;
  /**
   * 把某个对象的**详情**发给本人（wushen `select` 命令的
   * `me.notify(target.query_commands(me))`）。
   *
   * 落点是消息流里的"描述 + 命令条"（`src/ui/stream.ts` 的 `pushCommands`），
   * **不是** `.dialog` 面板 —— wushen 的 `Process.item` 就是 `ReceiveMessage`。
   */
  showItem(detail: ItemDetailView): void;
  /**
   * 往某个**频道**发一条（说 / 喊 / 私聊…）。
   *
   * ★ 为什么不能拿 `sendRoom` 顶：`sendRoom` 是"房间内广播"这一种受众，
   *   `msg` 包的 `ch` 却是**闭集频道**且受众随频道而变（本地 / 全服 / 定向）。
   *   受众解析需要"现在有哪些连接"，那是会话层的知识 ——
   *   所以内容层只声明**发到哪个频道**，投递由 `server/session.ts` 一处裁决。
   *
   * @param to 仅定向频道（`'tell'`）使用：目标角色的**名字**。
   *           找不到目标时由会话层回一句提示，而不是静默丢弃。
   */
  sendChannel(ch: Channel, content: string, to?: string): void;
}

/**
 * 内容层可见的"世界对象"最小面（房间 / NPC / 物品共用）。
 *
 * ★ 只用**结构**描述（`id` / `name` / `kind`），不 import 引擎的 `GameObject`：
 *   内容层不该依赖引擎内部结构（引擎一改全崩）。引擎侧的对象只要长出这三个
 *   字段就自动满足它（`GameObject` 见 `engine/base.ts`）。
 */
export interface ActorObject {
  /** 运行时实例 id（客户端 `get <id>` 用的就是它，见 `engine/oid.ts`） */
  readonly id: string;
  readonly name: string;
  readonly kind: ObjKind;
  /** 模板 id（来自注册表）；玩家角色为 null。指令可用它做"是不是某类东西"的判断 */
  readonly path: WorldId | null;
  /** 该对象自己的"可点击动作"（房间 / NPC 有；物品暂无） */
  readonly actions?: readonly ActionDef[] | undefined;
  /**
   * 一句话描述（`look <目标>` / 详情正文用；对应 wushen 的 `this.desc`）。
   * 房间一定有；NPC 与物品可能有。缺省 = 没有可看的描述。
   */
  readonly desc?: string | undefined;
}

/**
 * 六道权限 / 状态闸门的**声明**（指令与房间・物件动作共用）。
 *
 * 每个入口自己声明"什么条件下可用"，闸门集中在校验一处
 * （`engine/command.ts` 的 `checkCommandGates`）——
 * 这是 docs/wushen/13 §13.10 建议 2 的落点：
 * 避免每个指令里写重复的 `if (me.isBusy()) return`。
 *
 * ★ 缺省值的**不对称**（照抄 wushen，别"顺手统一"）：
 *   - `allow_level` 缺省 0  → 人人可用
 *   - `allow_fight` 缺省 **true** → 战斗中**默认可用**
 *   - `allow_busy` / `allow_state` / `allow_die` / `allow_faint` 缺省 false → 相应状态下**不可用**
 */
export interface CommandGateDecl {
  /** 最低 GM 等级（wushen `allow_level`）。0 = 人人可用 */
  readonly allow_level?: number;
  /** 战斗中可用（**默认 true**，与 wushen 一致） */
  readonly allow_fight?: boolean;
  /** 忙碌中可用（默认 false） */
  readonly allow_busy?: boolean;
  /** 打坐 / 疗伤等状态中可用（默认 false） */
  readonly allow_state?: boolean;
  /** 灵魂状态（hp<=0）可用（默认 false） */
  readonly allow_die?: boolean;
  /** 昏迷中可用（默认 false） */
  readonly allow_faint?: boolean;
}

/** 内容层可见的"所在环境"（房间 / 背包 / 容器） */
export interface ActorEnvironment extends ActorObject {
  readonly items: readonly ActorObject[];
  /** 房间有描述；角色 / 背包这类容器没有 */
  readonly desc?: string | undefined;
}

/**
 * 指令与动作钩子能拿到的角色面。
 *
 * ★ 为什么比 `Actor` 宽：指令必须能看到"我在哪、身上有什么、我能不能动"，
 *   否则 `look` / `get` / `kill` 这类指令根本无从写起。
 *   wushen 的 `enter` 直接拿到整个 `CHARACTER`（引擎与内容黏死）；
 *   这里改成**结构视图**，内容层不必 import 引擎内部类型。
 *
 * ★ `fightType` / `state` / `isFaint` 属战斗与状态系统（11 / 12 册），
 *   在那两处落地前恒为"无"（不在战斗 / 不在状态 / 未昏迷）。
 *   但六道闸门**现在**就按它们判定 —— 于是闸门是可达、可测的，
 *   而不是等系统齐了再补（`engine/command.ts` 的 `checkCommandGates`）。
 */
export interface CommandActor extends Actor {
  /** 我在哪个容器里（房间 / 背包）。不在任何容器里则为 null */
  readonly environment: ActorEnvironment | null;
  /** 我在哪个房间（沿容器链往上找；自己就是房间时返回自己） */
  readonly room: ActorEnvironment | null;
  /** 我的内容物（背包 / 身上的东西） */
  readonly items: readonly ActorObject[];
  /** 是否存活（`hp > 0`） */
  readonly isAlive: boolean;
  /**
   * 四维的**三档读数**（先天 / 后天加成 / 合计）—— 面板与诊断用。
   *
   * ★ 合计与 `SkillActor.str/con/dex/int` 读的是**同一个数**（都走
   *   `formula.ts#effectiveAttr`：先天值 + 后天加成，见 26 册 §37）；这里多做的只是
   *   把"先天"与"后天"**分开**列出来，好显示 `臂力 25（先天 20 + 后天 5）`。
   *   wushen 的 `score` 面板正是这么摆的（`world/cmd/dialog/score.js:90-97`）。
   *
   * ★ 只覆盖受"先天 + 加成"双影响的四维；`max_mp` 没有"加成"这一路，不在其中。
   */
  attrBreakdowns(): readonly AttrBreakdown[];
  /** 是否忙碌中（带 TTL；见 `engine/temp.ts`） */
  isBusy(nowMs?: number): boolean;
  /** GM 等级（wushen `user_level`）：0 = 普通玩家。`allow_level` 按它判定 */
  readonly userLevel: number;
  /** 战斗类型；0 = 不在战斗中（wushen `fight_type`） */
  readonly fightType?: number | undefined;
  /** 当前状态（打坐 / 疗伤…）；null = 无（wushen `state`） */
  readonly state?: { readonly title: string } | null | undefined;
  /** 是否昏迷（wushen `is_faint`） */
  readonly isFaint?: boolean | undefined;
  /**
   * 朝某方向走一步。**引擎**负责查出口、跑 `on_leave` / `on_enter`、
   * 维护位置一致性（`Container` 的双向绑定）。
   *
   * ★ 为什么是"方向"而不是"目标房间"：
   *   内容层看得到的是**出口表**（`RoomDef.exits` 用方向键声明），
   *   而房间实例是引擎内部对象 —— 把实例交给内容层，等于让它持有
   *   一个可以在引擎背后改位置的句柄（`moveTo` 只保证两侧一致，
   *   不保证 `on_enter` / `on_leave` 这类**内容侧**的约定被跑到）。
   *   按方向走，这些约定就只有一个执行点（`Character.go`）。
   *
   * ★ 返回**原因**（`MoveResult`）而不是布尔（26 册 T2）：走不动有三种 ——
   *   `no-exit` / `blocked` / `full`，对应三句不同的话
   *   （`MOVE_MESSAGES`，`shared/constants.ts`）。布尔值会逼调用点说一句
   *   笼统的"过不去"，玩家分不清是路不通还是人满。
   */
  go(direction: Direction): MoveResult;
}

/**
 * 技能钩子 / 绝招准入能拿到的角色面。
 *
 * ★ 与 `CommandActor` 同一取向：**只描述"技能计算需要读什么"**，不 import 引擎类型，
 *   于是内容层写 `learnCondition` / `check()` 时不必知道 `Character` 长什么样。
 * ★ `skillLevel(idOrSlot)` 同时接受**技能 id**（`wd/taijijian`）与**装配槽名**（`sword`），
 *   对应 wushen 的 `query_skill(name)`——wushen 里两者恰好同名前缀，这里显式都支持。
 */
export interface SkillActor extends Actor {
  /**
   * ★★ 四维是**有效属性**（先天值 + 后天加成），**不是裸先天值** —— 见
   *   `formula.ts#effectiveAttr` 与 26 册 §37。内容层写 `check()` 读 `me.str`
   *   拿到的就是门槛判定的那个数（同一个口径，不可能各算各的）。
   *   裸先天值只在引擎内部（`Character.innateSnapshot()`）可见。
   */
  readonly str: number;
  readonly con: number;
  readonly dex: number;
  readonly int: number;
  /** 内力上限（**不含**任何加成；`max_mp` 在本项目没有"加成"这一路） */
  readonly maxMp: number;
  readonly mp: number;
  /** 性别三档（`Gender`：1 男 / 2 女 / 0 无性）。学习条件按它对 */
  readonly gender: Gender;
  /** 某技能 / 某装配槽的当前等级；0 = 不会 */
  skillLevel(idOrSlot: string): number;
}

/** 所有定义共有的字段 */
export interface BaseDef {
  readonly name: string;
  /**
   * 变体：`{ '0': {...}, '1': {...} }` → 额外注册 `id#0` / `id#1`。
   * 对应 wushen 的 `#` 变体参数（24 册 D2 决定保留该语义）。
   */
  readonly variants?: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
}

/**
 * 房间 / NPC 的"可点击动作"。
 *
 * ★ 返回值语义与 `CommandDef.run` 一致：返回 **`false`** 表示"我没处理，继续往下找"
 *   （对应 wushen `enter` 的 `!== false` 判定）。其余返回值（含 `void`）视为已处理。
 */
export interface ActionDef extends CommandGateDecl {
  /** 触发词。可以是单个词（`dazuo`）也可以是多词（`goto home`） */
  readonly cmd: string;
  readonly name: string;
  readonly run: (me: CommandActor, ...args: (string | undefined)[]) => unknown;
}

/**
 * "有人进出我所在的房间"这组钩子。**房间与 NPC 共用同一份契约**（FG-16）。
 *
 * 权威：wushen `os/room/room.js`。两处各跑一次，**时机不同**：
 *
 *     ROOM.prototype.do_leave = function (obj, dir, leave_msg) {
 *         if (this.on_leave && this.on_leave(obj, dir) == false) return false;  // 房间先
 *         if (this.item_changed(obj, false, leave_msg, dir) == false) return false; // 房间里的活体后
 *     }
 *     ROOM.prototype.do_enter = function (obj, isshow, in_msg) {
 *         … this.item_changed(obj, true, in_msg);   // 房间里的活体先（room.js:47-55）
 *         this.on_enter && this.on_enter(obj);      // 房间自己后
 *     }
 *
 * 而 `item_changed` 里对**非玩家**项只做一件事：
 *
 *     else { if (obj.hp) {                     // ← 进来的那个必须是**活体**
 *         if (isin && item.on_enter) item.on_enter(obj);
 *         else if (!isin && item.on_leave) { if (item.on_leave(obj, dir) == false) return false; }
 *     } }
 *
 * ★ 所以 wushen 里"谁该被调到"的判据是**两条**：
 *     ① **房内那个对象**自己有钩子（`item.on_enter` / `item.on_leave`）；
 *     ② **进来/出去的那一个**是活体（`if (obj.hp)`）。
 *   —— 这是**两个不同对象**上的两条判据，别合并。
 *
 * ⚠️ **本项目目前只实现了 ①，② 缺失**（2026-10-14 复查确认，旧注释把两条混成了一条）：
 *   `engine/room.ts` 的 `#hooked()` 只判"房内对象有没有 `def`"（= ①）+ 跳过自己，
 *   **没有**对进出者做"是活体"的判断（wushen 的 `if (obj.hp)`）。
 *   ⇒ 后果：非活体（如物品、或将来"灵魂状态"的角色）进出房间时也会触发 NPC 钩子。
 *
 *   ★ 为什么不直接补 ②：当前 `Actor` 契约里**没有** `hp` / `isAlive`，补判据要先扩接口，
 *     属"活体钩子"批次的活 ⇒ 现状记为**已知偏离**，不动代码。
 *   ★ 旧注释写的"只有 Npc 持 def ⇒ '有没有钩子'天然就是'是不是活体'"是**错的**：
 *     它把判据 ②（看进出者）偷换成了判据 ①（看房内对象）。
 *   ★ 旧注释引用的 `engine/room.ts#runHooksOf` **不存在**（实际函数叫 `hooksOf`，见 `room.ts`）。
 *
 * ★ `on_leave` 返回 `false` = **阻止这次移动**（不是"提示一下"）。房间与活体
 *   都是这个语义，谁先返回 false 就谁拦住。
 */
export interface EnterLeaveHooks {
  readonly on_enter?: ((me: Actor) => void) | undefined;
  /** 返回 false 可阻止离开 */
  readonly on_leave?: ((me: Actor, dir: Direction) => boolean | void) | undefined;
}

// ---------------------------------------------------------------------------
// room / area
// ---------------------------------------------------------------------------

export interface RoomDef extends BaseDef, EnterLeaveHooks {
  readonly desc: string;
  /** 出口：方向 → **目标房间 id**（G4 会校验目标存在） */
  readonly exits?: Readonly<Partial<Record<Direction, RefId>>>;
  /** 放 NPC（必须解析为 npc 注册表里的条目） */
  readonly npcs?: readonly RefId[];
  /** 放物品 */
  readonly objects?: readonly RefId[];
  readonly no_fight?: boolean;
  readonly max_item_count?: number;
  readonly is_shadow?: boolean;
  readonly actions?: readonly ActionDef[];
}

export interface AreaDef extends BaseDef {
  readonly desc?: string;
  /** 入口房间 id */
  readonly first: RefId;
  readonly is_public?: boolean;
  readonly is_copy?: boolean;
  readonly index?: number;
  readonly actions?: readonly ActionDef[];
}

// ---------------------------------------------------------------------------
// npc
// ---------------------------------------------------------------------------

export interface SkillMapEntry {
  readonly skill: RefId;
  readonly level: number;
  /**
   * 启用为哪个**装配槽**（见 `ENABLE_SLOTS`）。缺省 = 只学会、不装配。
   *
   * ★ docs/26 L3 + docs/27 D1：这里曾经有**两套 id 空间** —— 既接受裸名 `force`
   *   （`BASE_SKILLS`）又接受注册 id `base/force`。现在收敛成**一个闭集**
   *   （`EnableSlot`）：写错即编译失败，运行时由 G4 兜底。
   */
  readonly enableAs?: EnableSlot;
}

export interface DropDef {
  readonly obj: RefId;
  readonly min?: number;
  readonly max?: number;
  readonly odds?: number;
  readonly count?: number;
}

export interface NpcDef extends BaseDef, PropMap, EnterLeaveHooks {
  readonly desc: string;
  readonly gender?: Gender;
  readonly age?: number;
  readonly per?: number;
  readonly con?: number;
  readonly dex?: number;
  readonly int?: number;
  readonly str?: number;
  readonly hp?: number;
  /**
   * ⚠️ **引擎不消费此字段**（保留它只是为了与 wushen 的 NPC 内容脚本同形：
   *   `docs/wushen/14` 的样例 NPC 都写 `hp/max_hp`）。
   *   本项目的 `maxHp` 一律由 `formula.ts` 派生，`hp` 只是**初始血量**、
   *   会被 `setHp()` 按派生上限截断。要调上限请走 `prop: { max_hp: N }`
   *   （那是 `PropKey`，会真的进公式），不要写这个字段。
   */
  readonly max_hp?: number;
  readonly mp?: number;
  readonly max_mp?: number;
  readonly score?: number;
  readonly skills?: readonly SkillMapEntry[];
  readonly drops?: readonly DropDef[];
  readonly no_refresh?: boolean;
  readonly on_master?: boolean;
  readonly on_checkskill?: boolean;
  readonly actions?: readonly ActionDef[];
  readonly on_kill?: (me: Actor) => boolean | void;
  readonly on_die?: (killer: Actor) => boolean | void;
  readonly on_accept?: (me: Actor, objId: string, count: number) => boolean | void;
}

// ---------------------------------------------------------------------------
// item
// ---------------------------------------------------------------------------

export interface ItemDef extends BaseDef, PropMap {
  readonly desc?: string;
  readonly unit?: string;
  readonly value?: number;
  readonly grade?: number;
  readonly combined?: boolean;
  readonly transable?: boolean;
  readonly distime?: number;
  readonly equipType?: EquipSlot;
  readonly weaponType?: WeaponType;
  readonly combine_count?: number;
  readonly combine_to?: RefId;
  readonly on_use?: (me: Actor) => boolean | void;
  readonly on_study?: (me: Actor) => boolean | void;
  readonly on_open?: (me: Actor) => boolean | void;
}

// ---------------------------------------------------------------------------
// skill / family / command / task
// ---------------------------------------------------------------------------

/**
 * 学习条件（docs/27 决策 D5：**声明式**，取代 wushen `learn_condition` 的 key `switch`）。
 *
 * wushen 把一个字典用 `switch (key)` 分派：`skill` / `str1` / `str` / `gender` / 其它当 prop。
 * 于是"条件键"和"属性键"混在**一个命名空间**里（`str1` 是先天、`str` 是含 prop 的合计），
 * 极难校验、也极难读懂。这里拆成显式字段，每个字段的语义与取值范围都由类型钉住。
 *
 * ★★ 2026-10-15 归一（26 册 §37）：**属性门槛只有 `minAttr` 一个字段，读"有效属性"
 *   = 先天值 + 后天加成**（`formula.ts#effectiveAttr`）。wushen 的 `str1`(纯先天) /
 *   `str`(先天+加成) 二义性在 API 上被消除 —— 只剩"有效值"一个概念。
 *   （此前是 `minProp`(只读加成) + `minInnate`(只读先天) 两个字段，合起来才顶 wushen 一支。
 *     实测 wushen 全仓 94 个 `learn_condition` 的键只有 `skill`/`max_mp`/`dex1`/`int1`，
 *     合并后能力不减 —— 见 29 册 §29.13。）
 *
 * 全部条件之间是 **AND**。缺省字段不参与判定。
 */
export interface SkillLearnCondition {
  /** 各装配槽的**最低生效等级**（按"该槽当前生效技能"的等级；见 `SkillBook.activeTemplate`） */
  readonly minSlot?: Readonly<Partial<Record<EnableSlot, number>>>;
  /**
   * **属性门槛**：读**有效属性** = 先天值 + 后天加成（`formula.ts#effectiveAttr`）。
   *
   * ★ 四维（`str`/`con`/`dex`/`int`）读的是"先天 + 装备/技能加成"的**合计**；
   *   其余键没有先天项，等于纯加成。
   *   ⇒ `minAttr: { str: 30 }` 读作"**臂力（含加成）到 30** 才学"，
   *     与 wushen `os/skill/skill.js:234` 的 `me[key] + query_prop(key)` **同义**。
   *
   * ⚠️ 内力上限不在这一路（wushen 的 `max_mp` 是独立一支）⇒ 走 `minMaxMp`。
   *
   * 拒绝文案用 `PROPERTIES` 的中文名（与 wushen `os/skill/skill.js:235` 同口径），
   * 于是玩家不会看到 `str` / `gj` 这种拼音键。
   */
  readonly minAttr?: Readonly<Partial<Record<PropKey, number>>>;
  /** 内力上限下限（wushen 的 `max_mp`） */
  readonly minMaxMp?: number;
  /** 性别要求（三档：1 男 / 2 女 / 0 无性，见 `Gender`） */
  readonly gender?: Gender;
  /** 展示用说明（学习按钮上的文字） */
  readonly desc?: string;
}

/** 绝招（PFM）定义。数值字段可写成 `(lv) => number`，于是"随等级成长"不必另开公式 */
export interface PerformDef {
  readonly name: string;
  /**
   * 该绝招要求的装配槽；缺省 = 不限。
   * 判定口径：**该技能此刻是否在这个槽上"生效"**（`SkillBook.activeTemplate(slot)`），
   * 于是基本技能（靠 `slot` 占槽、`enabled` 恒为 null）与武功（靠 `enable` 装配）
   * 走同一条路径 —— wushen 的 `base/sword` 也挂了绝招（连击），按 `enabled` 判会永远放不出来。
   */
  readonly enable?: EnableSlot;
  /** 内力消耗（缺省 0） */
  readonly mp?: number | ((lv: number) => number);
  /** 出招时间 / 硬直（ms，缺省 0） */
  readonly releaseMs?: number | ((lv: number) => number);
  /** 冷却（ms，缺省 0） */
  readonly cdMs?: number | ((lv: number) => number);
  /** 忙碌中是否可放（缺省 false） */
  readonly allowBusy?: boolean;
  /**
   * 额外准入条件（等级 / 内力 / 冷却之外）。返回 `false` = 当前不可用。
   * 消费点为 `SkillBook.canUsePfm()`——本批**不接战斗**，但"能不能放"是可测的。
   */
  readonly check?: (me: SkillActor, lv: number) => boolean;
  readonly desc?: string;
}

/**
 * 技能定义（取代 wushen `os/skill/skill.js`）。
 *
 * ★ 三档属性（docs/wushen/12 §12.1.2）拆成三个/两个回调：
 *   ① `passiveProp(lv)`         —— 学会即生效
 *   ② `enableProp(lv)[slot]`    —— 启用后生效（按装配槽）
 *   ③ 「进阶附加」(`query_addin_prop`) **本批不做**：它依赖一套"进阶词条表"，
 *      属独立子系统，等有内容需求再加（避免留没有消费者的空接口）。
 *
 * ★ 与 wushen 的差异（都用 TS 的结构能力把"要人记的规矩"变成"写不出来的错"）：
 *   - `can_enables` 是 **`EnableSlot[]` 闭集**（wushen 是裸字符串数组）；
 *   - `slot` **显式**声明（wushen 靠"基本技能 id 恰好等于槽名"这条隐式约定）；
 *   - 属性一律走 `PropMap`（核心/扩展两张表分开），不再让技能往一个裸对象里乱塞键；
 *   - 不再有 `SKILL[slot][grade] = [...]` 这种"往类上挂索引"的写法（见 `SkillRegistry`）。
 */
export interface SkillDef extends BaseDef {
  readonly desc?: string;
  readonly type?: SkillType;
  readonly grade?: number;
  /** 等级上限（缺省见 `SKILL_FORMULA.defaultMaxLevel`） */
  readonly max_level?: number;
  /**
   * **仅基本技能（type = BASE）**：占据哪个装配槽。
   * 非基本技能声明它 → 构造 `SkillTemplate` 时直接抛错。
   */
  readonly slot?: EnableSlot;
  /**
   * 内功系数（wushen `force_skill.force_rad`，见 `formula.ts`）。
   * 只有"启用/占据 `force` 槽的技能"的这个值会被 `Character.forceRad` 读到。
   */
  readonly force_rad?: number;
  /** 可启用到的装配槽（type = SKILL 时有效） */
  readonly can_enables?: readonly EnableSlot[];
  readonly learnCondition?: SkillLearnCondition;
  readonly pfm?: Readonly<Record<string, PerformDef>>;
  /** ① 学会即生效的属性 */
  readonly passiveProp?: (lv: number) => PropMap | undefined;
  /** ② 启用后生效的属性（按装配槽） */
  readonly enableProp?: (lv: number) => Readonly<Partial<Record<EnableSlot, PropMap>>> | undefined;
  /** 学会前置检查（返回 `false` 拒绝） */
  readonly on_learn?: (me: Actor) => boolean | void;
  /** 遗忘回调 */
  readonly on_remove?: (me: Actor) => boolean | void;
  /** 启用前置检查（返回 `false` 拒绝） */
  readonly on_enable?: (me: Actor, slot: EnableSlot) => boolean | void;
  /** 停用回调 */
  readonly on_disable?: (me: Actor, slot: EnableSlot) => boolean | void;
  /** 研读秘籍（物品驱动；属装备/物品批次，此处保留既有字段） */
  readonly on_study?: (me: Actor) => boolean | void;
}

export interface FamilyDef extends BaseDef {
  readonly desc?: string;
  readonly family_area?: RefId;
  readonly skills?: readonly RefId[];
}

export interface CommandDef extends CommandGateDecl {
  /** 逗号分隔的别名，如 `'look,l'`（wushen 同款，一行搞定多个别名） */
  readonly command: string;
  /** 可选参数正则。捕获组**按序**映射到 `run` 的第 2..N 个形参 */
  readonly regex?: RegExp;
  /**
   * **登录未完成阶段**可执行。登录期只放行这一类指令，
   * 对应 wushen `extends/login.js` 的 `wait_login`（注意它**不在** `check_command` 里，
   * 见 `docs/wushen/13` §13.9）。本项目的登录流程属另一批次，但这条规则现在就可测。
   */
  readonly allow_login?: boolean;
  readonly help?: string;
  /**
   * 业务入口。
   * 返回 **`false`** = "我没处理" → 分发器继续往下一级找（wushen 的 `!== false` 语义）。
   */
  readonly run: (me: CommandActor, ...pars: (string | undefined)[]) => unknown;
}

export interface TaskDef {
  readonly title: string;
  readonly desc?: string;
  readonly on_accept?: (me: Actor) => boolean | void;
  readonly on_finish?: (me: Actor) => boolean | void;
}

/** kind → 定义类型 */
export interface DefMap {
  room: RoomDef;
  area: AreaDef;
  npc: NpcDef;
  item: ItemDef;
  skill: SkillDef;
  family: FamilyDef;
  command: CommandDef;
  task: TaskDef;
}

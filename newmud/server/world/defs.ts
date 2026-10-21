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
  FightType,
  Gender,
  MoveResult,
  PropKey,
  SkillType,
  WeaponType,
} from '@shared/constants.js';
import type { ObjKind } from '../engine/base.js';
import type { ViewSubject } from '../engine/view-text.js';
import type { AttrBreakdown } from '../engine/formula.js';
import type { AttrView, SkillsView } from '@shared/protocol.js';
import type { WorldId } from '@shared/ids.js';

/**
 * `AttrView` 的**形状**住在 `shared/protocol.ts`（它是线上载荷，前端也要读），
 * 这里只是把名字转出去，好让内容层写 `showAttr(view: AttrView)` 时
 * 不用同时记两个模块。★ 不是第二份定义 —— `defs.ts` 里再写一遍就等于两份真相。
 */
export type { AttrView, AttrCombatView, AttrValueView } from '@shared/protocol.js';

/**
 * `SkillsView` 同理：形状住在 `shared/protocol.ts`（线上载荷，前端 `src/ui/skills.ts`
 * 直接 import），这里只转名字。★ 再写一遍就等于第二份真相。
 */
export type { SkillsView, SkillEntryView } from '@shared/protocol.js';

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
  /**
   * 是否**活体**（`hp > 0`）—— 对应 wushen 的 `CHARACTER.prototype.is_living()`。
   *
   * ★ 提到 `Actor` 这一层（2026-10-14 体检 **E4**）是为了**堵住"两种写法"的洞**：
   *   `Actor` 是**所有内容钩子的参数类型**（`on_kill` / `on_die` / `on_accept` /
   *   `on_use` / `on_study` / `on_learn` / `on_open` / `on_finish` …），
   *   而 wushen 的内容代码到处要问这一句 —— 于是它**手写了七八遍**：
   *     `world/cmd/action/go.js:6`   `if (me.hp <= 0) return;`
   *     `os/char/chara_skill.js:183` `if (this.hp <= 0) return false;`
   *     `os/char/combat.js:135`      `return this.hp > 0 && …`
   *     `os/room/room.js:48`         `if (obj.hp) { … }`   ← 鸭子类型，且在**循环内**重复判
   *     `os/char/character.js:23`    `is_living = function () { return this.hp > 0; }`  ← 已有谓词却没人用
   *   ⇒ 同一个概念 **5 种写法**。本项目收成**一个成员**，`checkCommandGates` 的
   *     `allow_die`（`engine/command.ts`）读的是它，房间进出钩子读的也是它。
   *
   * ★★ 为什么是**属性**而不是方法：wushen `os/char/npc.js:16` 写的是
   *   `if (!this.is_fighting() && this.is_living && this.chat_msg)` —— **漏了括号**。
   *   `this.is_living` 是函数对象，恒为真 ⇒ 那个判据**是死的**（NPC 死了照样说话）。
   *   属性形态让"忘写括号"这件事**在语法上不可能发生**。
   *
   * ★ 实现方**必须**给出真值，不能靠"缺省 falsy"：一个忘了实现的类型会被静默当成
   *   非活体（钩子一声不响地不触发）—— 与 wushen 的 `obj.hp` 是同一种坏味道。
   *   上提到契约上之后，`tsc` 会逐处点名（良性破坏）。
   *
   * ★ 非角色对象（`Item` / `Room`）**不是** `Actor`，所以它们压根不会被传进进出钩子 ——
   *   这就把 wushen 用 `if (obj.hp)` 拦"物品进出误触发钩子"那一半，交给了**类型系统**。
   */
  readonly isAlive: boolean;
  /** 给本人看一行文本，落在**消息流**（安全默认，见 `notifyInPanel`） */
  notify(text: string): void;
  /**
   * 给本人看一行文本，落在**某块物件面板**里。
   *
   * ★★ 为什么内容层需要这条（2026-10-21 §80）：点 NPC 打开面板之后，
   *   后续交互的文本（"你想打听什么？"、"你身上没有那么多的钱"）属于
   *   **这段对话**，留在面板；而房间播报、战报属于"发生了什么"，进消息流。
   *   以前这个区分没有表达渠道 —— 内容层两条都只能 `notify`，
   *   由前端拿启发式去猜，猜错了就是真机上那句
   *   "和木人切磋，数据写在木人的操作框里"。
   *
   * ★ 用法：`panelId` 就是刚 `showItem` 出去的那个 `id`
   *   （`me.showItem({ id: target.id, … }); me.notifyInPanel(target.id, '…')`）。
   *   两者不同源的话，前端会因为 id 对不上而**退回消息流** ——
   *   那是安全的一侧（文本不会丢，只是没进面板）。
   */
  notifyInPanel(panelId: string, text: string): void;
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
   * 把**属性面板**的数据发给本人（wushen `score` 指令的 `{type:"dialog", dialog:"score"}`
   * 那一支，见 `world/cmd/dialog/score.js`）。
   *
   * ★ 为什么与 `showItem` 分成两条而不是一个 `showPanel(x)`：
   *   两者的**落点不同** —— `showItem` 进消息流（wushen `Process.item` 也是
   *   `ReceiveMessage`），而属性是一张**会一直开着、随时能翻**的面板快照。
   *   混成一个方法会让调用点必须自己带"这次该走哪条"的标记，那正是
   *   本仓库在 `PracticeResult` 上刚收掉的形状（判别联合优于布尔开关）。
   */
  showAttr(view: AttrView): void;
  /**
   * 把**技能面板**的数据发给本人（wushen `cha` 指令的
   * `{type:"dialog",dialog:"skills",items:[…]}` 那一支，见 `world/cmd/dialog/cha.js`）。
   *
   * ★ 与 `showAttr` 并列而不是合并成 `showPanel(dialog, view)`：
   *   合并就得把 `dialog` 名字当参数传，而**帧的 `dialog` 字段是分支的唯一判据**
   *   （前端 `ui/panel.ts` 按它选 `build`）。两个独立方法让"发错面板"变成
   *   编译期问题（`showSkills` 收不到 `AttrView`），而不是运行时排查。
   */
  showSkills(view: SkillsView): void;
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
 * 一个对象**能被怎么操作**（内容层可见的交互面）。
 *
 * ★ 为什么单开一个成员、而不把这些字段摊平进 `ActorObject`：
 *   它们**只对某些 kind 有意义** —— `onAccept` 只在 NPC 上（`NpcDef.on_accept`）、
 *   `noGet` / `onUse` 只在物品上（`ItemDef`）。分成一坨之后：
 *     ① "这个对象有没有交互面"本身成了一个可判的东西（没有模板的玩家就是 `undefined`）；
 *     ② `ActorObject` 的其余字段（`id`/`name`/`kind`/`path`/`desc`）保持
 *        **所有 kind 都成立**这条不变式 —— 摊平会让"每个东西都可能有 `noUse`"
 *        这种假命题写进类型里。
 *
 * ★★ 只放**当前有消费者**的字段（26 册 L8 的病：声明未实现）：
 *   下面 6 个字段的消费者就在 `world/command/item/{get,give,use}.ts` 三条指令里。
 *   以下**刻意不在这里**（做了才算，别提前写进来当"预留"）：
 *     - `onStudy` / `onOpen` —— 秘籍 / 箱子属后续批次，没有读者；
 *     - 使用冷却（`ItemDef.distime`）—— 需要往角色的 `TempStore` 写键，
 *       而 `CommandActor` 不暴露 temp 写入（那是并发/生命周期有讲究的能力，
 *       不该顺手开给内容层）。属"道具冷却"专项批次。
 *     - 装备类物品"必须先装备才能用"（wushen `use.js:22`）—— 装备系统未落地。
 */
export interface InteractHooks {
  /** 捡不起来（`ItemDef.no_get`，wushen `obj.no_get`） */
  readonly noGet?: boolean | undefined;
  /** 丢不掉（`ItemDef.no_drop`，wushen `obj.no_drop`） */
  readonly noDrop?: boolean | undefined;
  /** 用后**不消耗**（`ItemDef.no_consume`，wushen `obj.no_consume`） */
  readonly noConsume?: boolean | undefined;
  /**
   * 被捡起之前的钩子（wushen `obj.on_get(player) === false` ⇒ 拦住）。
   * 返回 `false` 表示"这次别捡"，其余返回值（含 `void`）视为放行。
   */
  readonly onGet?: ((me: Actor) => boolean | void) | undefined;
  /**
   * 使用（wushen `obj.on_use(player, par)`）。**缺省即"这个东西不能用"**
   * —— 所以"能不能用"的判据是**这个钩子在不在**，不是另立一个布尔开关。
   */
  readonly onUse?: ((me: Actor, par?: string) => boolean | void) | undefined;
  /**
   * 这本书教哪门技能（`ItemDef.studySkill` 的投影，wushen `book.skill`）。
   * 消费者：`world/command/train/study.ts`。**没有它就"不能研读"** ——
   * 与 `onUse` 同一条判据：能力由数据/钩子的**存在性**决定，不另立开关。
   */
  readonly studySkill?: string | undefined;
  /** 这本书能教到的等级上限（`ItemDef.studyMaxLevel`，缺省 100） */
  readonly studyMaxLevel?: number | undefined;
  /** 研读时每拍的内容钩子（wushen `book.on_study`；`study.js:119-121` 已注释掉，本项目保留） */
  readonly onStudy?: ((me: Actor) => boolean | void) | undefined;
  /**
   * 别人**给我**东西时的准入（wushen `target.on_accept(player, objId, count)`）。
   *
   * ★ `objId` 是物品的**模板 id**（`drug/yao#0`）或字符串 `'money'`
   *   —— 与 wushen 一致（它的 money 分支就是拿 `objid == "money"` 判的）。
   * ★ 返回**真**才收下；`void` / `false` 都算拒收（wushen `&&` 短路）。
   *
   * ★★ **"纯谓词"的边界：不许播报结果**（26 册 §57，真机反馈抓到的矛盾消息）。
   *   引擎的顺序是 `onAccept(...)` → 扣减 → 播报结果。所以这里说"收下了"是**抢跑**：
   *   一旦后续扣减失败（钱不够 / 物品不够），玩家会先看到"收下了"再看到"你没有那么多"。
   *   允许在这里说的只有**拒收的理由**（"住店要 1000 文钱"），因为那句与返回值同真同假。
   */
  readonly onAccept?:
    | ((me: Actor, objId: string, count: number) => boolean | void)
    | undefined;
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
   * **拒绝切磋**（wushen `target.no_fight`，`world/cmd/battle/fight.js:41`）。
   *
   * ★ 与房间的 `noFight` 是两道不同的闸：
   *   - 房间 `noFight` = "这块地方不许动手"（广场 / 武馆）；
   *   - 这个人 `noFight` = "这个人不想跟你动手"（老师、店主）。
   *   两者任一为真，「比试」按钮都不出现，指令也拒绝。
   */
  readonly noFight?: boolean | undefined;
  /**
   * **不可击杀**（wushen `kill.js:11` 的 `!target.do_kill` 等价物）。
   *
   * ★ 为真时「击杀」按钮不出现，`kill` 指令也拒绝 —— 用于老师 / 店主这类
   *   "杀掉了内容就断了"的 NPC。玩家角色不实现这一面（`undefined` = 可杀）。
   */
  readonly noKill?: boolean | undefined;
  /**
   * 交互面（物品的 `no_get` / `on_use`…，NPC 的 `on_accept`）。
   * 由引擎从模板派生（`Item.interact` / `Npc.interact`）；玩家角色没有。
   */
  readonly interact?: InteractHooks | undefined;
  /**
   * 一句话描述（`look <目标>` / 详情正文用；对应 wushen 的 `this.desc`）。
   * 房间一定有；NPC 与物品可能有。缺省 = 没有可看的描述。
   */
  readonly desc?: string | undefined;
  /**
   * **某技能的等级**（0 = 不会）。只有**角色**有这一面；房间 / 物品没有 ⇒ 可选。
   *
   * ★ 用途只有一个：`learn <技能> from <目标>` 判"这个人教不教得了"
   *   （wushen `xue.js:38` 的 `target.skills[sk]`、`:191` 的等级比较）。
   *   本项目的 NPC 用与玩家同一套 `SkillBook`（27 册决策 D9，`Npc` 继承 `Character`），
   *   于是它天然满足这个形状 —— **不需要为教学单开一个接口**。
   *
   * ★ 为什么写成可选方法而不是 `readonly skills?: SkillBook`：
   *   后者会把整个技能簿（含 `learn/forget/enable` 这些**变更**入口）交到内容层手上，
   *   等于给指令一把能改别人技能簿的钥匙。这里只开"读等级"这一个口。
   */
  readonly skillLevel?: ((id: string) => number) | undefined;
  /**
   * **这个人会哪些技能**（只读清单，`skills <目标>` 用）。
   *
   * ★ 与 `skillLevel` 同族的窄口：只给"名字 / 等级 / 占哪个槽"，
   *   不给 `SkillBook` 句柄（那会连 `learn` / `forget` 一起交出去）。
   * ★ 可选：房间 / 物品没有这一面 —— 读不到就是"没有技能清单"，正是我们要的语义。
   */
  readonly skillList?: (() => readonly SkillBrief[]) | undefined;
}

/**
 * 一条"他会这门技能"的只读记录（`ActorObject.skillList` 的元素）。
 *
 * ★ 为什么不复用 `SkillsView` 的元素：那份带 `progress` / `skillLimit` / `pot`，
 *   全是"对自己才有意义"的字段。看别人"会什么"不需要它们。
 */
export interface SkillBrief {
  readonly id: string;
  readonly name: string;
  readonly level: number;
  /** 基本功占哪个槽（`force` / `sword`…）；特殊武学没有这一项 */
  readonly slot?: string;
}

// ---------------------------------------------------------------------------
// 持续状态（wushen `me.state` · `os/char/state.js`）
// ---------------------------------------------------------------------------

/** 状态在界面上的样子（与协议 `StatePacket` 同构） */
export interface StateView {
  readonly id: string;
  readonly title: string;
  readonly desc: string;
}

/**
 * 起一个持续状态的**规格**（`CommandActor.startState` 的入参）。
 *
 * ★ 心跳间隔 `intervalMs` 缺省 5 秒，照 wushen：
 *   `lianxi` / `study` / `dazuo` 的 `on_enter` 都是每 5 秒跑一次
 *   （`WORLD` 的 `set_state` 心跳，见 `world/cmd/skill/lianxi.js:167` 的 `do_learn`）。
 *
 * ★ `tick` 返回 `false` ⇒ 状态**自动结束**（wushen 的 `on_enter` 返回 false
 *   同样是"这次不做了、退出状态"）。返回其它值（含 `undefined`）⇒ 继续下一拍。
 */
export interface StateSpec {
  /** 状态 id（`study` / `lianxi` / `dazuo`…）—— 用于"我正在做同一件事吗"的判定 */
  readonly id: string;
  /** 显示名（"读书" / "练习技能"），闸门拦人时读它（`stateBlockedMessage`） */
  readonly title: string;
  /** 状态进行中的一句播报（wushen `state.desc`） */
  readonly desc?: string;
  /** 心跳间隔（毫秒），缺省 5000 */
  readonly intervalMs?: number;
  /** 每一拍要做的事。返回 `false` = 结束状态 */
  readonly tick: (me: CommandActor) => boolean | void;
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
  /**
   * 这个环境**禁止战斗**（wushen `room.no_fight`，`world/cmd/battle/fight.js:14`）。
   * ★ 房间用它表达"这块地方禁武"（`Room.noFight`）；背包 / 容器缺省 `undefined`
   *   （= 不禁止）。`fight` / `kill` 指令读它给"这里不允许战斗。"。
   * ★ 另有一道**不在这里**的闸：NPC 模板自己可以声明 `no_fight` / `no_kill`
   *   （见 `ActorObject.noFight`）—— 那道闸管的是"这个人"，不是"这块地方"。
   */
  readonly noFight?: boolean | undefined;
}

/**
 * 开战的结果。**失败给原因而不是布尔**（26 册 T2）：`fight` / `kill` 有六种不同的
 * "打不了"，每种对应一句不同的话（wushen 各处 `notify`），布尔会逼调用点说笼统话。
 *
 * ★ 每个取值 ↔ 一句文案的对应关系见 `world/command/combat/fight.ts` 的 `FIGHT_MESSAGES`。
 */
export type FightStart =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly reason:
        /** 那不是个能打的角色（物品 / 房间） */
        | 'not-actor'
        /** 打的是自己 */
        | 'self'
        /** 目标已经死了 */
        | 'dead'
        /** 自己气血未满 —— 切磋要求双方满血（wushen `fight.js:24`） */
        | 'self-wounded'
        /** 对方气血未满（wushen `fight.js:21`） */
        | 'target-wounded'
        /** 已经在和**这个**对手打（wushen "加油，加油！！"） */
        | 'self-fighting'
        /** 正在和别人打（wushen "等你打完再和别人比试吧！"） */
        | 'self-busy'
        /** 对方正在和别人打（wushen "对方正在切磋…"） */
        | 'target-fighting';
    };

/**
 * 脱战的结果（`escape` / `flee` / 战斗中 `go` 的落点）。
 *
 * ★ 与 `FightStart` 同一取向：失败给**原因**，成功给**该往哪退**。
 *   wushen `do_escape`（`os/char/chara_move.js:105-121`）成功时只返回布尔，
 *   真正"跑掉"靠调用方接着 `go`（`go.js:24`）；把方向一起返回，
 *   内容层就不用自己想办法从房间出口表里挑一个（那是引擎的随机源）。
 */
export type EscapeResult =
  | {
      readonly ok: true;
      /**
       * 撤到哪个方向；`null` = 本房间没有出口（能脱战，但没地方跑）。
       * ★ `go` 指令会忽略它（它已经有一个明确方向），`flee` 用它。
       */
      readonly dir: Direction | null;
    }
  | {
      readonly ok: false;
      readonly reason:
        /** 本来就没在战斗 */
        | 'not-fighting'
        /** 被对手缠住（wushen 判定失败会加 `busy`，`chara_move.js:113-118`） */
        | 'blocked';
    };

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
/** 给拒绝分支挂上 `kind` 标记（`T & {kind}` 不引入联合，不会破坏判别） */
type Refused<T extends { readonly reason: string }> = T & { readonly kind: 'refused' };

/**
 * 「没练成」—— 七种原因，**每种只带自己文案真正要用的字段**。
 *
 * ★★ 为什么不是 `{ ok: false; reason: PracticeRefusal; name; level; limit }`
 *   这种"一个袋子装全部字段"的写法：那个形状**允许合法但不存在**的组合
 *   （`ok: true` 且 `reason: 'capped'`、`reason: 'unknown'` 且 `level: 0`），
 *   读的人必须先想"哪个字段说了算"，写的人被迫在六个分支里各填两个恒为 0 的
 *   `spent`/`gained`。改成判别联合之后，非法状态**写不出来**，编译器直接挡。
 *
 * ★ 字段为什么逐个分支声明：`basis` 分支读不到 `level`，`reached` 分支读不到
 *   `limit` —— 想读就得先证明自己已经把它算出来了。可选字段（`level?: number`）
 *   做不到这一点，它只是把"读的人要处理 undefined"的负担往后传。
 */
export type PracticeRefused =
  /** 没有这个技能（id 与名字都没命中）。文案不需要任何字段 */
  | Refused<{ readonly reason: 'unknown' }>
  /** 有这个技能，但你没学 */
  | Refused<{ readonly reason: 'not-learned'; readonly name: string }>
  /** 知识类技能只能靠读书（wushen `lianxi.js:20` 的 KNOWLEDGE 分支） */
  | Refused<{ readonly reason: 'knowledge'; readonly name: string }>
  /** 已经到当前上限（`skillLimit()` 或模板 `max_level`）——要报出"上限是多少" */
  | Refused<{ readonly reason: 'capped'; readonly name: string; readonly level: number; readonly limit: number }>
  /** 已经达到**你指定的目标等级**（不是上限；用于区分"还没到头，只是到点了"） */
  | Refused<{ readonly reason: 'reached'; readonly name: string; readonly level: number }>
  /** 基本功火候未到（wushen `check_skill` 的 `can_enables` 门槛） */
  | Refused<{ readonly reason: 'basis'; readonly name: string }>
  /** 潜能不足 */
  | Refused<{ readonly reason: 'no-pot'; readonly name: string; readonly limit: number }>;

/**
 * 拒绝原因的**标签联合**（由上面派生，不再手抄第二份）。
 *
 * ★ 派生而非重写：`PracticeRefused` 加一支、这里自动跟着变 —— 两份清单会漂移。
 */
export type PracticeRefusal = PracticeRefused['reason'];

/** 「练成了」—— `spent`/`gained` 在这里才有意义 */
export interface PracticeDone {
  readonly kind: 'done';
  /** 技能的**显示名**；文案用它，免得给玩家看 `wd/taijijian` */
  readonly name: string;
  /** 实际消耗的潜能（可能小于预算：到上限就停） */
  readonly spent: number;
  /** 涨了几级（可能为 0：潜能不够升一级，但经验已经累进去了） */
  readonly gained: number;
  /** 练完之后的等级 */
  readonly level: number;
  /** 当前上限 */
  readonly limit: number;
}

/**
 * 一次"练技能"的结果（`CommandActor.practiceSkill`）。
 *
 * ★★ 判别联合，不是"布尔标记 + 可选原因"：`kind` 是唯一判据，
 *   于是 `if (r.kind === 'refused')` 之后编译器就知道 `spent`/`gained` 不存在，
 *   `switch (r.reason)` 里每一支的字段都是精确的（漏一支编译不过）。
 */
export type PracticeResult = PracticeDone | PracticeRefused;

/**
 * 一次**读书**的结果（`CommandActor.studySkill`）—— 对照 wushen `study.js`。
 *
 * ★★ 读书与"跟师父学"是**两条不同的路**，不是同一条的两种说法：
 *   - 学（`learn`）要**有老师、有潜能**，一次结算，等级受**老师等级**压着；
 *   - 读（`study`）要**有书**，不花潜能，按智力每拍涨经验，等级受**书的上限**压着。
 *   ⇒ 结果类型也分开：读书没有"老师太低"这一支，但多了"书太浅"。
 *
 * ★ `blocked` 这一支复用 `LearnRefused`：**读书不能绕过基本功门槛**。
 *   wushen `study.js:105-113` 的 `check_skill` 做的正是同一件事 ——
 *   少了它，"基本功 30 级才能学太极剑法"会被一本书直接绕过去。
 */
export type StudyResult =
  /** 没有这个技能（书里写的 id 在注册表里找不到 —— 内容层写错了） */
  | Refused<{ readonly reason: 'unknown' }>
  /** 书太浅：你已经到（甚至超过）这本书能教的等级（wushen `study.js:96-97`「这本书上的内容对你来说太浅了」） */
  | Refused<{
      readonly reason: 'too-shallow';
      readonly name: string;
      readonly level: number;
      readonly bookMax: number;
    }>
  /** 准入不满足（与 `learn` 同一份拒绝清单，见上面的注释） */
  | { readonly kind: 'blocked'; readonly refusal: LearnRefused }
  /** 读进了一段经验（`gained` 可能是 0：还没攒够一级） */
  | {
      readonly kind: 'ok';
      readonly name: string;
      readonly gained: number;
      readonly level: number;
      readonly limit: number;
    };

// ── 学技能 / 遗忘 / 装配（27 册 §14 · 26 册 §64）─────────────────────────────
//
// ★★ 三组结果都做成**判别联合**，与 `PracticeResult` 同一条纪律（26 册 §56.8）：
//   `kind` 是唯一判据，`switch` 不写 `default`，漏一支编译失败。
//   ⚠️ 别退回"布尔 + 可选原因"—— 那会允许"成功却带拒绝原因"这种状态存在。

/**
 * 学技能被拒的原因。
 *
 * ★ 每一支都对应**玩家该做的下一件事不同**，这不是"文案细分"而是**决策树**：
 *   去打怪（`no-pot`）、去练基本功（`slot`）、去涨经验（`capped`）、换个人教（`no-teacher`）。
 *   合并任意两支，玩家就会收到一条"不知道该怎么办"的提示。
 */
export type LearnRefused =
  /** 没有这个技能（id 与中文名都没命中） */
  | Refused<{ readonly reason: 'unknown' }>
  /** 已经会了（wushen `xue.js` 对已学技能是**继续教**，所以这一支只在"建档"路径上出现） */
  | Refused<{ readonly reason: 'already'; readonly name: string }>
  /** 装配槽门槛：`minSlot`（wushen「基本功火候未到」） */
  | Refused<{
      readonly reason: 'slot';
      readonly slot: EnableSlot;
      readonly need: number;
      /** 该槽**当前生效技能**的名字（`基本剑法`）；槽空着时退回槽名（`sword`） */
      readonly name: string;
    }>
  /** 属性门槛（`minAttr`，读**有效属性**：先天 + 后天加成） */
  | Refused<{ readonly reason: 'attr'; readonly key: PropKey; readonly need: number; readonly name: string }>
  /** 内力上限门槛（`minMaxMp`） */
  | Refused<{ readonly reason: 'max-mp'; readonly need: number; readonly name: string }>
  /** 性别门槛（三档，`GENDER_LABELS`） */
  | Refused<{ readonly reason: 'gender'; readonly gender: Gender; readonly name: string }>
  /** 老师不会这门（`teacherLevel === 0`）—— wushen `xue.js:38`「X不会这个技能」 */
  | Refused<{ readonly reason: 'no-teacher'; readonly name: string }>
  /**
   * 你的程度已经不低于老师（wushen `xue.js:191`「已经不输你师父了」）。
   * ★ 不带老师的名字：引擎只收到一个等级数字（老师的名字是内容层的事），
   *   名字由指令层从 `findTarget` 的结果里说 —— 引擎不该知道"老师长什么样"。
   */
  | Refused<{ readonly reason: 'master-lower'; readonly teacherLevel: number; readonly name: string }>
  /** 自己到了**技能等级上限**（经验决定的那条曲线），老师再高也学不动 */
  | Refused<{ readonly reason: 'capped'; readonly name: string; readonly level: number; readonly limit: number }>
  /** 潜能不够这一次的量（wushen 是"全有或全无"，不是花到光 —— 见 27 册 §14.3） */
  | Refused<{ readonly reason: 'no-pot'; readonly name: string; readonly need: number }>
  /** 内容层的 `on_learn` 钩子否决 */
  | Refused<{ readonly reason: 'hook'; readonly name: string }>;

/** 学一次成功：`spent` 与 `gained` 在这里才有意义 */
export interface LearnDone {
  readonly kind: 'learned';
  readonly id: string;
  readonly name: string;
  /** 学完之后的等级 */
  readonly level: number;
  /** 花掉的潜能（wushen 一拍的量，见 27 册 §14.3 的 `count_speed`） */
  readonly spent: number;
  /** 涨了几级（可能是 0：经验只累进去，没够升级） */
  readonly gained: number;
}

/** 一次"学技能"的结果（`CommandActor.learnSkill`） */
export type LearnResult = LearnDone | LearnRefused;

/**
 * 遗忘被拒的原因。
 *
 * ★ `base` / `knowledge` 两条规则**在引擎里**（不在指令里）：
 *   wushen 写在 `fangqi.js:10-12`，但它照抄的是"基础知识不能丢"这条**领域规则**。
 *   放指令里就等于每个未来会遗忘的入口（GM 指令、面板、脚本）都要重抄一遍。
 */
export type ForgetRefused =
  | Refused<{ readonly reason: 'unknown' }>
  | Refused<{ readonly reason: 'not-learned'; readonly name: string }>
  | Refused<{ readonly reason: 'base'; readonly name: string }>
  | Refused<{ readonly reason: 'knowledge'; readonly name: string }>;

export interface ForgetDone {
  readonly kind: 'forgotten';
  readonly id: string;
  readonly name: string;
  /** 忘掉之前被装配在哪个槽（null = 本来就没装配）；文案用它说"已经卸下" */
  readonly wasEnabled: EnableSlot | null;
}

/** 一次"遗忘"的结果（`CommandActor.forgetSkill`） */
export type ForgetResult = ForgetDone | ForgetRefused;

/**
 * 装配被拒的原因。
 *
 * ★ 与 `SkillBook.enable()` 的关系：那一层在**调用方写错**时抛 `SkillError`
 *   （非法槽名、`can_enables` 配置矛盾），那是程序员的错；
 *   这里只描述**玩家会犯的错**（没学、装错槽）。
 *   ⇒ 先在这里判一遍，通过后再调 `enable()`，于是玩家看到的是提示而不是 500。
 */
export type EnableRefused =
  | Refused<{ readonly reason: 'unknown' }>
  | Refused<{ readonly reason: 'not-learned'; readonly name: string }>
  /** 基本技能 / 知识类不可装配（只有 `type === SKILL` 的武功可以） */
  | Refused<{ readonly reason: 'not-enablable'; readonly name: string }>
  /** 这门武功装不到这个槽（`can_enables` 不含它） */
  | Refused<{
      readonly reason: 'slot-mismatch';
      readonly name: string;
      readonly slot: EnableSlot;
      readonly allows: readonly EnableSlot[];
    }>
  /** 内容层的 `on_enable` 钩子否决 */
  | Refused<{ readonly reason: 'hook'; readonly name: string }>;

export interface EnableDone {
  readonly kind: 'enabled';
  readonly id: string;
  readonly name: string;
  readonly slot: EnableSlot;
  /**
   * 被顶下来的那个技能的**显示名**（null = 这个槽本来是空的，或你装的就是它自己）。
   * ★ 是名字不是 id：这一格只被文案用（"原先的X已卸下"），而玩家不该看到 `wd/taijijian`。
   *   面板要"取消装配"时用的是**自己这条**的 id，与这里无关。
   */
  readonly replaced: string | null;
}

/** 一次"装配"的结果（`CommandActor.enableSkill`） */
export type EnableResult = EnableDone | EnableRefused;

export interface CommandActor extends Actor {
  /** 我在哪个容器里（房间 / 背包）。不在任何容器里则为 null */
  readonly environment: ActorEnvironment | null;
  /** 我在哪个房间（沿容器链往上找；自己就是房间时返回自己） */
  readonly room: ActorEnvironment | null;
  /** 我的内容物（背包 / 身上的东西） */
  readonly items: readonly ActorObject[];
  // ★ `isAlive`（活体判据）**已上提到 `Actor`** —— 全项目单源，理由见 `Actor` 上的注释（E4）。
  //   原先只挂在这里，于是房间进出钩子拿到的 `Actor` 问不到"他还活着吗"。

  // ── 物品搬运（内容层唯一入口；位置一致性由引擎保证）─────────────────────
  //
  // ★★ 为什么不是 `addItem` / `removeItem`：`Character` 继承 `Container`，
  //   而 `Container` 上**已经有** `addItem(child: GameObject)` / `removeItem(child)`
  //   —— 同名成员会被**静默**当成那个实现（方法参数是双变的、少参数可赋值给多参数，
  //   所以 `tsc` 一声不响）。那两个方法**不处理数量**（`removeItem` 摘整件、
  //   `addItem` 不收 `count`），拿来当"消耗 1 个"用会得到一个**编译通过、语义错误**
  //   的实现。⇒ 下面几个原语一律另起名字，让"接错线"在语法上不可能。
  //
  // ★ 为什么不把 `Container` 直接开给内容层（比如给一个 `container` 句柄）：
  //   那等于把"改位置"的能力开放出去 —— `moveTo` 只保证**两侧引用一致**，
  //   不保证 `on_enter` / `on_leave` 这类**内容侧**的约定被跑到（同 `go()` 的理由）。
  //   走下面这几个原语，搬运这件事只有一个执行点。

  /**
   * 把一件东西**收进我身上**（wushen `CHARACTER.prototype.add_obj`）。
   * 返回 `false` = 装不下（我的容量满了）。
   *
   * ★ 缺省含义就是"装不下"：非物品那一档由**指令先挡**（`get` 判 `kind !== 'item'`），
   *   所以它不是一个"什么都可能失败"的布尔 —— 两个失败源挤一个出口会让
   *   调用点只能给一句笼统的话（26 册 T2 的教训）。
   */
  takeItem(item: ActorObject): boolean;
  /**
   * 把我身上的一件东西**放到我所在的房间**（wushen `WORLD.add_recover_obj`）。
   * 返回 `false` = 房间满了。
   *
   * ★ 与 `takeItem` 同样的收敛：另外两个失败源（"这东西不在我身上"由指令
   *   先 `findTarget` 过一遍、"我不在任何房间"在游戏内**构造上不可达**）
   *   都不该让这句话变形 —— 这是 `Character.go` 那句"`from` 不是房间"防御分支的同款处理。
   */
  dropItem(item: ActorObject): boolean;
  /**
   * 从我身上**失去** n 个（缺省 1）：给出去了、或用掉了（wushen `remove_obj`）。
   * 数量归零即销毁；返回 `false` = 我身上没这么多。
   *
   * ★ 少了它，`give` 与 `use` 就得各自去动 `count` —— 而"归零要销毁"
   *   这条约定就会有两份（24 册 §3 要消除的正是这种）。
   * ★ 为什么 `give <谁> <个数> <东西>` 能支持任意个数而**不需要拆分物品**：
   *   wushen 的 `give` 在非师徒分支里**只从给出方扣掉**、由对方 `on_accept`
   *   自行处置（`world/cmd/obj/give.js:57-62`）—— 物品并没有真的换容器，
   *   于是"扣 1 个"不产生新对象、不需要新 oid。见 `world/command/item/give.ts`。
   */
  spendItem(item: ActorObject, count?: number): boolean;
  /**
   * 掏钱（wushen `player.money -= count`）。返回 `false` = 身上的钱不够。
   *
   * ★ 与 `spendItem` 分开而不是合成一个 `pay(amount)`：物品与钱是两套账
   *   （物品有实例 / oid，钱只是一个整数），合并会逼调用点先判断"这是哪种"。
   * ★ 只给"花掉"这个方向，不给 `money` 读写口：钱的**增加**属于
   *   掉落 / 任务奖励 / 卖店，各有自己的入口与审计点。
   */
  spendMoney(amount: number): boolean;

  // ── 成长（经验 / 潜能 / 练技能）───────────────────────────────────────────
  //
  // ★★ 与 `money` 的取用方式**刻意不同**：`money` 只给"花"，因为钱的**增加**
  //   有各自的入口（掉落 / 任务奖励 / 卖店）且要审计；而 `exp` / `pot` 的**增加**
  //   在本项目**只有一个入口**——`Character.addExp()`（wushen 同名方法，
  //   `os/char/character.js:304`）。所以这里只读不写，写入留给那个方法。

  /**
   * 自身**经验**（wushen `this.exp`）。它决定技能等级上限（见 `SkillActor.skillLimit`）。
   * ★ 与 `NpcDef.exp`（击杀奖励）不是一回事，别混。
   */
  readonly exp: number;
  /** **潜能**（wushen `this.pot`）：练习技能的燃料 */
  readonly pot: number;
  /**
   * 花掉潜能（wushen `lianxi.js` 的 `me.pot -= exp`）。返回 `false` = 不够。
   * ★ 与 `spendItem` / `spendMoney` 同一族：只给"花"这个方向。
   */
  spendPot(amount: number): boolean;
  /**
   * **直接发放经验 / 潜能**（`addxp` 等测试、补偿指令的唯一合法写入通道）。
   *
   * ★ 为什么这条写入口可以存在，而 `money` 仍然只能"花"：
   *   经验与潜能**本来就只有一个增加入口**（`Character.addExp`），
   *   这里只是把它转出来；而钱的增加要分掉落 / 任务 / 卖店三种审计点，
   *   不能给一个笼统的 `addMoney`。
   *
   * ★★ **权限不在引擎判**：调用方（指令）自己判 GM 等级或测试开关。
   *   引擎不认识"测试模式"这种运营概念。
   */
  grantExp(exp: number, pot?: number): void;
  /**
   * 当前**技能等级上限**（与 `SkillActor.skillLimit` 是同一个数）。
   *
   * ★ 为什么这里再声明一次：`CommandActor` 与 `SkillActor` 是**两条平行的契约**
   *   （前者"指令宿主"，后者"能学技能的角色"），彼此不继承；面板类指令（`score`）
   *   要显示上限，就得从自己这条链上拿到它。`Character` 同时满足两者，
   *   运行时只有一个实现 —— 不是两份真相。
   */
  skillLimit(): number;
  /**
   * **练技能**：把潜能按 1:1 换成技能经验（wushen `lianxi.js:169-176` 的
   * `me.pot -= exp; skill.add_exp(me, exp)`，其中 `exp = count_speed(me)`）。
   *
   * @param idOrName  技能 id（`wd/taijijian`）或中文名（`太极剑法`）
   * @param targetLevel 练到多少级；缺省 = 当前上限。给超过上限的值按上限截断。
   *
   * ★ 账目全在引擎里算（消耗多少、涨几级、有没有到上限），内容层只负责文案 ——
   *   否则"够不够潜能"这类判断会在每个指令里各写一遍。
   */
  practiceSkill(idOrName: string, targetLevel?: number): PracticeResult;

  /**
   * **读书**一次（`study` 指令的每一拍落点）：给某门技能加 `exp` 点经验。
   *
   * ★ 与 `practiceSkill` 的差别只在**账从哪来**：练是 `pot → 技能经验`（1:1），
   *   读是**凭空加**（wushen `study.js:128`：`exp = (int + int加成) × 2`）。
   *   两者最后都落到 `SkillBook.addExp`（上限钳制、升级、重算被动都在那一处）。
   *
   * @param bookMax 书能教到的等级上限：到顶就返回 `too-shallow`，
   *   而不是"继续加但加不进去"（后者玩家会以为书坏了）。
   */
  studySkill(idOrName: string, exp: number, bookMax: number): StudyResult;

  // ── 技能簿的另外三个动作（27 册 §14 · 26 册 §64）────────────────────────
  //
  // ★★ 为什么这几个也收进引擎、而不是让指令自己调 `me.skills.learn(...)`：
  //   ① `SkillBook` 是**引擎对象**，内容层拿不到（`CommandActor` 上没有 `skills` 字段）；
  //   ② 三条动作都有**规则**（学习条件 / 基础不可忘 / 只能装到 `can_enables` 的槽），
  //      规则散进内容层就等于每个入口各抄一遍（`forget` 将来还会有 GM 与面板两个入口）；
  //   ③ 它们都要在**同一个原子操作里**改状态并 `recompute()`，内容层做不到这一点。

  /**
   * **学一次**（wushen `xue <技能> from <老师>` 的一次结算）。
   *
   * 前两道闸：① 未学会时走 `learnCondition`（`minSlot` / `minAttr` / `minMaxMp` / `gender`）；
   * ② 老师得会这门（`teacherLevel > 0`）且**你的等级低于老师**。
   * 结算照抄 wushen 的 `count_speed`（27 册 §14.3）：**全有或全无** ——
   * 潜能不够这一次的量就整笔拒绝，不做"花到光为止"（那是 `practice` 的行为）。
   *
   * @param idOrName    技能 id 或中文名
   * @param teacherLevel 老师的这门技能等级（由指令层从 `ActorObject.skillLevel` 取）；
   *                     `0` = 老师不会。★ 传数字而不是传 `ActorObject`：
   *                     引擎不该知道"老师长什么样"，它只需要那一个数。
   */
  learnSkill(idOrName: string, teacherLevel: number): LearnResult;
  /**
   * **遗忘**一个技能。基础技能与知识类不可遗忘（wushen `fangqi.js:10-12`）。
   * 若它正被装配，一并卸下（`SkillBook.forget` 内部已保证）。
   */
  forgetSkill(idOrName: string): ForgetResult;
  /**
   * 把一门武功**装配**到某个槽（wushen `enable <基本技能> <技能>`）。
   *
   * ★ `SkillBook.enable()` 是"先判后卸"的：被拒不损害既有装配
   *   （wushen 是先卸旧、再问新技能，新的被拒则槽空着 —— 见那里的注释）。
   */
  enableSkill(slot: EnableSlot, idOrName: string): EnableResult;
  /** 卸下某槽的武功。返回 `false` = 那个槽本来就没装东西 */
  disableSkill(slot: EnableSlot): boolean;
  /**
   * **技能面板的整张快照**（`skills` 指令的取数口，见 `SkillsView`）。
   *
   * ★ 与 `attrView()` 同一条纪律：技能等级 / 经验 / 装配关系 / 上限都在引擎里，
   *   一次取全，于是"面板显示的值"与"练习真正用的上限"不可能有两条取数路径。
   *   `progress` 也在这里算 —— 经验公式只有 `skill.ts` 一份。
   */
  skillView(): SkillsView;

  // ★ `isAlive`（活体判据）**已上提到 `Actor`** —— 全项目单源，理由见 `Actor` 上的注释（E4）。
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
  /**
   * **属性面板的整张快照**（`score` 指令的取数口，见 `AttrView`）。
   *
   * ★★ 为什么收成引擎原语、而不是让 `score.ts` 自己拼：
   *   面板要的 `attack` / `defense` / `crit` 在 `Character.#derived` 里，
   *   `hp` / `mp` 也是角色私有状态 —— 内容层看都看不到。散着开一堆 getter
   *   会让"面板显示的值"与"战斗真正用的值"有两条取数路径（本项目刚在
   *   §37 把属性合成一条）。这里一次取全，两个读者读的是同一份快照。
   *   与 `practiceSkill` 同一条纪律：账目在引擎里算，内容层只负责摆。
   */
  attrView(): AttrView;
  /** 是否忙碌中（带 TTL；见 `engine/temp.ts`） */
  isBusy(nowMs?: number): boolean;
  /** GM 等级（wushen `user_level`）：0 = 普通玩家。`allow_level` 按它判定 */
  readonly userLevel: number;
  /** 战斗类型；0 = 不在战斗中（wushen `fight_type`） */
  readonly fightType?: number | undefined;
  /** 当前状态（读书 / 练习 / 打坐…）；null = 无（wushen `state`） */
  readonly state?: StateView | null | undefined;
  /**
   * 开始一个**持续状态**（wushen `me.set_state({...})`，`os/char/state.js`）。
   *
   * ★★ 为什么必须收进引擎：wushen 的"练习 / 读书 / 打坐"**没有一个是一次结算的** ——
   *   `lianxi.js:55` / `study.js:61` / `dazuo.js` 都是 `set_state` 之后由心跳每 N 秒
   *   调一次 `on_enter`（`do_learn`）。做成"敲一次涨 N 级"就丢掉了三件事：
   *   ① **可以中断**（`stop`）；② **有过程**（屏幕上一句"你对X似乎有些心得"）；
   *   ③ **消耗是渐进的**（潜能一点点花，不会一次点掉一半）。
   *   这三条也正是"技能系统做了一半"的那半 —— 见 26 册 §75。
   *
   * @returns 是否真的开始了；`false` = 已经在某个状态里（先 `stopState`）
   */
  startState(spec: StateSpec): boolean;
  /**
   * 结束当前状态（wushen `me.clear_state()` / `stopstate` 指令）。
   * @returns 是否确实停掉了一个状态
   */
  stopState(): boolean;
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

  // ── 战斗（`fight` / `kill` 指令的落点）────────────────────────────────────
  //
  // ★ 为什么"开战"要做成引擎原语、而不是让指令自己拼：
  //   ① 战斗状态（`fight_type` / 敌人表 / 下一拍的调度句柄）是**角色私有**的，
  //      内容层拿到的 `ActorObject` 上根本没有这些字段；
  //   ② wushen 的 `fight.js` 要读 `target.hp` / `target.max_hp` 判"满不满血"
  //      （`fight.js:21-26`）—— 而本项目的内容层看不到血量（它们是角色内部状态）。
  //      把那几条门槛收进引擎，内容层只读**原因**。
  // ★ 这是**双向**的：wushen 的 `do_kill` 里 `this.begin_attack(target,2)` 之后
  //   紧跟 `target.begin_attack(this,2)`（`os/char/combat.js:35`）—— 开战天然是互相的。

  /**
   * 对某个对象**开战**（`fight` = 切磋，`kill` = 击杀）。
   *
   * 成功的副作用：双方进入战斗、各自开始出招（第一次调用会发 `combat start` 帧）。
   * 失败不改变任何状态，只返回**原因**。
   */
  beginFight(target: ActorObject, type: FightType): FightStart;

  /**
   * **尝试脱离战斗**（wushen `do_escape`，`os/char/chara_move.js:105`）。
   *
   * ★ 判定读的是角色私有派生值（躲闪 vs 对方命中），内容层看不到 ——
   *   所以必须收进引擎，内容层只读**结果**。
   * ★ 成功时**立刻停战**（发 `combat:end`）并返回一个可选撤退方向；
   *   失败时会给自己加一段忙乱（wushen `add_status({id:'busy'})`），
   *   于是"连续猛点逃跑"不会变成无限重试。
   */
  escape(): EscapeResult;

  /**
   * **复活**（`relive` 指令的落点）。返回 `false` = 本来就没死。
   *
   * ★ 为什么收进引擎：复活要改**气血**、清**忙乱**，两者都是角色私有状态，
   *   内容层看不到（与 `beginFight` 同一条理由）。
   * ★ 成功时会推一个 `die` 包的 `relive:true` 帧（前端据此显示"你又活过来了"），
   *   内容层不必、也无法自己发这个包。
   */
  revive(): boolean;
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
  /**
   * **技能等级上限**（wushen `CHARACTER.prototype.skill_limit`，`os/char/chara_skill.js:87`）：
   * 由**角色自身经验**（`Character.exp`）与境界（`Character.level`）决定。
   *
   * ★★ 它不是一个"给人看的数字"，而是 `SkillBook.addExp()` 的**封顶** ——
   *   "经验决定技能等级上限"因此是引擎保证的规则，不靠每个调用方自觉
   *   （26 册 §56：先有单一封顶点，才谈得上"所有加经验的入口都受约束"）。
   *
   * ★ 玩家与 NPC 的差异：wushen 里只有玩家走这条曲线（NPC 的 `exp` 是击杀奖励，
   *   不是自身经验）。本项目的 `Npc` 覆写为 `Infinity`，理由见 `npc.ts`。
   */
  skillLimit(): number;
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
 * ★ **两条判据都已实现**（② 于 E4 批次补上，2026-10-15）：
 *   ① 房内那个对象自己有钩子 ⇒ `engine/room.ts#hooksOf()`（判 `def` 存在性）；
 *   ② 进出者是**活体** ⇒ `Actor.isAlive`，在 `#hooked()` 生成器**开头短路一次**。
 *
 *   ★★ **短路的位置是要害 —— 别图省事提到 `fireEnter()` / `allowLeave()` 开头**：
 *     wushen `do_enter` = `item_changed(obj,true)`（**有** `obj.hp` 判据）
 *     **然后** `this.on_enter(obj)`（**无条件**）；`do_leave` 反过来 ——
 *     `this.on_leave` 先跑且**无条件**。⇒ 一个非活体走进来，被压掉的是**房内活体**的钩子，
 *     **房间自己的 `on_enter` 照跑**。提到函数开头会连房间自己的钩子一起压掉 ——
 *     偏离 wushen，而且看起来"更整齐"，特别容易写错。
 *
 *   ★ **为什么不连"房内那个对象自己是不是活体"一起判（假想中的判据③）**：
 *     wushen 靠 `NPC.prototype.die()` 里的 `item_changed(this, false)` 把**死 NPC 移出房间**
 *     （原地留一个 corpse，`os/char/npc.js:123-142`）来达到同样效果 —— 本项目照此
 *     （死 = 离开房间）。再加一条判据等于**两条机制做同一件事**，只会漂移。
 *
 *   ★ 结构上本项目还多一层保障：`Item` **不是** `Actor`（没有 notify / sendRoom /
 *     sendCommands），所以"物品进出误触发钩子"在**类型层**就被挡住了 ——
 *     wushen 要在运行时用 `if (obj.hp)` 拦的那一半，这里编译期就成立。
 *
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
  /**
   * **击杀奖励**：击杀者获得的经验 / 潜能（wushen 内容层的写法就是 `exp: 500, pot: 500`，
   * 见 `world/area/fb1/fb1.js:12-13`）。
   *
   * ★★ 它与 `Character.exp`（角色**自身**积累的经验，决定技能等级上限）是**两个概念**：
   *   这里是"这只怪值多少"，那里是"这个人攒了多少"。同名不同义 —— 所以写在这里，
   *   而不是把 NPC 的 `exp` 塞进 `Character.exp`（那样打死一只怪就等于自己练了一级）。
   *
   * ★ 缺省 = 0（不给）。`Npc.afterDeath` 只把这两个数交给**击杀者**，不写进自己。
   */
  readonly exp?: number;
  readonly pot?: number;
  /**
   * 死亡后多久原地重生（毫秒）。缺省 `Npc.DEFAULT_RESPAWN_MS`（wushen `npc.js:145` 的 300000）。
   * ★ 对 `no_refresh: true` 的模板**无效**（那种怪死了就是死了）。
   */
  readonly respawn_ms?: number;
  readonly skills?: readonly SkillMapEntry[];
  readonly drops?: readonly DropDef[];
  readonly no_refresh?: boolean;
  /** 拒绝切磋（见 `ActorObject.noFight`；wushen `fight.js:41`） */
  readonly no_fight?: boolean;
  /** 不可击杀（见 `ActorObject.noKill`；老师的"杀掉了就没人教了"闸） */
  readonly no_kill?: boolean;
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
  /**
   * 捡不起来（wushen `obj.no_get`，`world/cmd/obj/get.js:35`）。
   * 消费者：`world/command/item/get.ts`。典型用途是"固定在场景里的东西"
   * （告示牌、雕像）—— 它存在于房间，但不该进任何人的背包。
   */
  readonly no_get?: boolean;
  /** 丢不掉（wushen `obj.no_drop`，`drop.js:13`）。消费者：`item/drop.ts` */
  readonly no_drop?: boolean;
  /** 用后**不消耗**（wushen `obj.no_consume`，`use.js:59`）。消费者：`item/use.ts` */
  readonly no_consume?: boolean;
  /**
   * 被捡起之前的钩子（wushen `obj.on_get(player)`，`get.js:38`）。
   * 返回 `false` 拦住这次拾取。消费者：`item/get.ts`。
   */
  readonly on_get?: (me: Actor) => boolean | void;
  readonly on_use?: (me: Actor, par?: string) => boolean | void;
  readonly on_study?: (me: Actor) => boolean | void;
  /**
   * 这本书教**哪门技能**（wushen `book.skill`，见 `world/cmd/skill/study.js:16`）。
   * 消费者：`world/command/train/study.ts`。
   * ★ 与 `on_study` 的分工：这个字段是**数据**（读它涨哪门），
   *   `on_study` 是**钩子**（内容层想在读书时插一手时用）。有前者才进"研读"状态机。
   */
  readonly studySkill?: RefId;
  /** 这本书能教到的等级上限（wushen `book.max_level`，缺省 100） */
  readonly studyMaxLevel?: number;
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
   * 于是玩家不会看到 `str` / `attack` 这种键名。
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

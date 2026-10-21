/**
 * server/engine/character.ts — 角色基类（玩家与 NPC 的共同部分）
 * ============================================================================
 * 对照 wushen `os/char/character.js`（08 册 §8.1/§8.2）。
 *
 * ★ 继承关系与 wushen 的区别（07 册 §7.2 的"角色继承自物品"）：
 *   wushen: `CHARACTER.inherits(ITEM)` —— 理由是"角色本质是能放进房间的物品"。
 *   本实现保留**这个结论**（Character 是容器，可以装东西、可以被放进房间），
 *   但把层次写成 `GameObject → Container → Character`：
 *   物品不是容器，角色和房间是 —— 这样 `items[]` 不会凭空长在剑上。
 *
 * ★ 输出通道不直连 socket（`CharacterOutput`）：
 *   wushen 的 `USER.send()` 直接操作 `this.socket`，于是**任何**要测
 *   "角色会说什么"的代码都得先伪造一个 socket。这里把输出抽成接口：
 *   NPC 用 `RecordingOutput`（写内存），玩家挂真实连接，且可以**换**
 *   （对应 22 册模式 15「顶号保留对象、替换 socket」—— 断线重连换的是连接，
 *   不是角色对象）。
 *   `notify / sendRoom / sendCommands` 三个方法因此天然可测，
 *   且与 `server/world/defs.ts` 的 `Actor` 契约**结构一致** ——
 *   内容层的钩子拿到的正是这个对象。
 */

import type { WorldId } from '@shared/ids.js';
import { BASE_SKILLS, FIGHT_TYPE, SKILL_TYPES, isEnableSlot, realmName } from '@shared/constants.js';
import type { EnableSlot } from '@shared/constants.js';
import type { Channel, Direction, FightType, Gender, MoveResult } from '@shared/constants.js';
import { Container } from './base.js';
import type { ObjKind } from './base.js';
import {
  ATTACK_ACTIONS,
  DIE_MESSAGES,
  DODGE_ACTIONS,
  PARRY_ACTIONS,
  WINNER_MESSAGES,
  damageMessage,
  pick,
  queryStatusMessage,
} from './combat-text.js';
import { Item } from './item.js';
import { Room } from './room.js';
import { Scheduler } from './scheduler.js';
import type { TaskHandle } from './scheduler.js';
import { TempStore } from './temp.js';
// `import type` 会被完全擦除，所以引擎 ↔ 内容层的类型引用不产生运行时环。
import type {
  ActorObject,
  AttrView,
  CommandActor,
  EnableResult,
  EscapeResult,
  FightStart,
  ForgetResult,
  ItemDetailView,
  LearnResult,
  PracticeResult,
  SkillBrief,
  SkillsView,
  StateSpec,
  StateView,
  StudyResult,
} from '../world/defs.js';
import {
  COMBAT_FORMULA,
  applyCritDamage,
  computeAttrBreakdowns,
  computeDamage,
  computeDerived,
  effectiveAttr,
  rollCrit,
  rollDefense,
} from './formula.js';
import type { AttrBreakdown, DerivedCombat, InnateStats } from './formula.js';
import { applyPropMap, createPropHolder, getProp, loadProps, snapshotProps } from './props.js';
import type { LoadReport } from './load-report.js';
import type { PropHolder, PropSnapshot, RawPropMap } from './props.js';
import { SkillBook, emptySkillRegistry, levelLimit, realmOf } from './skill.js';
import type { SkillRegistry } from './skill.js';
import { VIEW_OTHER, VIEW_SELF, VIEW_TARGET, renderViewText } from './view-text.js';
import type { ViewSubject } from './view-text.js';

export class CharacterError extends Error {
  public override readonly name = 'CharacterError';
}

/** 一个可点击按钮（`die` 包的复活入口用；与 `ItemDetailView.commands` 同形状） */
export interface CommandButton {
  readonly cmd: string;
  readonly name: string;
}

/** 角色的输出通道。玩家挂真实连接，NPC / 测试用内存实现 */
export interface CharacterOutput {
  /**
   * 给玩家看的一行文本 —— **进消息流**。
   *
   * ★★ 这是"安全默认"（2026-10-21 §80）：不带归属的文本一律落在消息流。
   *   要进某块面板必须用 `notifyInPanel` **点名**，不许让接收端去猜。
   */
  notify(text: string): void;
  /**
   * 一行文本，**属于某块物件面板**（`panelId` = `item` 帧的 `id`）。
   *
   * ★★ 为什么单开一条而不是给 `notify` 加可选参数（§80）：
   *   可选参数在调用点看起来跟不带一样（`notify(text)` 与 `notify(text, id)`
   *   只差一个逗号），写漏了**没有任何编译期提示**，还是掉回消息流。
   *   单开一个方法则要求调用点**必须**说出 `panelId` —— "这条属于谁"从
   *   "可以事后补的判断"变成"写下来才能编译过的参数"。
   *
   * ★ 前端收到后只做一件事：`context` 与当前面板 id 相等就投进面板，
   *   否则（面板没开 / 开的是别块）退回消息流。没有第二个判据。
   */
  notifyInPanel(panelId: string, text: string): void;
  sendCommands(...cmdNamePairs: string[]): void;
  /** 频道播报（见 `defs.ts` 的 `Actor.sendChannel`）。受众由会话层裁决 */
  sendChannel(ch: Channel, content: string, to?: string): void;
  /** 对象详情（见 `defs.ts` 的 `Actor.showItem` / `ItemDetailView`） */
  showItem(detail: ItemDetailView): void;
  /**
   * 属性面板快照（见 `defs.ts` 的 `Actor.showAttr` / `AttrView`）。
   * ★ 落点是 `dialog:score` 帧，**不是**消息流 —— wushen 的 `score` 也是面板。
   */
  showAttr(view: AttrView): void;
  /**
   * 技能面板快照（见 `defs.ts` 的 `Actor.showSkills` / `SkillsView`）。
   * ★ 落点是 `dialog:skills` 帧 —— wushen 的 `cha` 也是面板（`world/cmd/dialog/cha.js`）。
   */
  showSkills(view: SkillsView): void;
  /**
   * 战斗开始 / 结束（`combat` 包）。前端据此切换"战斗中"界面。
   * ★ 对照 wushen `this.send('{type:"combat",start:1}')`（`os/char/combat.js:22`）。
   */
  combat(phase: 'start' | 'end'): void;
  /**
   * 死亡（`die` 包，带复活入口）。
   * ★ 对照 wushen `USER.check_state()` 发的 `{type:"die",commands:[…]}`（`os/char/user.js:401`）。
   *   NPC 没有连接，用不到它 —— 但通道是统一的（`RecordingOutput` 也记）。
   */
  die(commands: readonly CommandButton[]): void;
  /**
   * 复活（同一 `die` 包族的 `relive:true` 那一支）。
   * ★ 对照 wushen `relive.js:46` 的 `me.notify('{type:"die",relive:true}')` ——
   *   原作把"复活"做成 `die` 包的一个变体（前端 `combat.ts` 的 `die` handler 就是靠
   *   `p['relive'] === true` 分支成"你又活过来了"）。
   */
  revive(): void;
  /**
   * **持续状态**的开始 / 结束（`state` 包：`{ state: 标题, desc: 一句播报 }`）。
   * 传 `null` = 状态结束（前端据此把那条状态收起来）。
   *
   * ★ 协议里 `state` 包**早就有**（`shared/protocol.ts` 的 `StatePacket`），
   *   前端也注册了 handler —— 但服务端**零发送点**：那正是"技能做了一半"
   *   的直接证据（26 册 §75）。wushen 的 `set_state` 会立刻推一帧
   *   `me.send('{type:"state",state:"' + state.title + '"…}')`（`lianxi.js:132`）。
   */
  state(view: StateView | null): void;
}

/**
 * 内存输出缓冲的**单通道上限**。
 *
 * ★ 26 册 §11.2 R5：`RecordingOutput` 是 NPC 与"当前没有连接的角色"的默认通道，
 *   而 `messages` 原来是**无上界**数组 —— 一个活了几天、每秒被 notify 几次的 NPC
 *   会把它单调撑大，谁也不会去读（它的用途就是诊断）。这是一条安静的内存泄漏。
 *
 *   处理：满了丢**最旧的**，保留最近 N 条 —— 诊断要看的正是最近发生了什么。
 */
export const RECORDING_OUTPUT_LIMIT = 1000;

/** 丢最旧、留最近（满了才动，正常路径零开销） */
function pushCapped<T>(buf: T[], item: T, limit: number = RECORDING_OUTPUT_LIMIT): void {
  buf.push(item);
  if (buf.length > limit) buf.splice(0, buf.length - limit);
}

/**
 * 默认输出：把消息记进内存。
 * **不抛错** —— 于是"没有连接的角色"（NPC、离线玩家、测试）也能安全跑完逻辑。
 */
export class RecordingOutput implements CharacterOutput {
  public readonly messages: string[] = [];
  public readonly commands: string[][] = [];
  /** 频道播报（`ch` + 内容 + 可选目标）。诊断用，与 `messages` 分开记 */
  public readonly channelMessages: Array<{ ch: Channel; content: string; to?: string }> = [];
  /** 对象详情（`showItem` 收到的东西）。诊断与测试用 */
  public readonly items: ItemDetailView[] = [];
  /** 收到的 `combat` 帧（开始 / 结束）。诊断与测试用 */
  public readonly combatPhases: Array<'start' | 'end'> = [];
  /** 收到的 `die` 帧（复活按钮）。诊断与测试用 */
  public readonly deaths: Array<readonly CommandButton[]> = [];
  /** 收到的**复活**帧数（`die` 包的 `relive:true` 那一支）。诊断与测试用 */
  public reviveCount = 0;

  /**
   * ★ **事件时间线**：`notify` 的文本与 `combat` 的相位都记进同一个数组。
   *
   * 为什么不能只靠 `messages` / `combatPhases`：那两个数组各自有序、**彼此无序**，
   * 于是"【战斗结束】在『你获得了…』之前"这种断言根本写不出来（26 册 §57 的
   * 战斗奖励顺序就是靠这条时间线钉住的）。
   */
  public readonly events: string[] = [];

  /**
   * **面板内**文本（§80）：`{ panelId, text }`。
   *
   * ★ 与 `messages` 分开记而不是同一份：`messages` 回答"看到什么"，
   *   这里回答"落在哪儿"。两者都要能单独断言，否则"文本没丢但落错框"
   *   这种缺陷（正是 §78 那个）在服务端侧根本测不出来。
   */
  public readonly panelMessages: Array<{ panelId: string; text: string }> = [];

  public notify(text: string): void {
    pushCapped(this.messages, text);
    pushCapped(this.events, text);
  }

  /**
   * 面板内文本（§80）。
   *
   * ★ 也记进 `messages` / `events`：**"玩家看到了这句话"这件事没变**，
   *   变的只是落点。测试若想区分落点，读 `panelMessages`。
   */
  public notifyInPanel(panelId: string, text: string): void {
    pushCapped(this.panelMessages, { panelId, text });
    this.notify(text);
  }

  public sendCommands(...cmdNamePairs: string[]): void {
    pushCapped(this.commands, [...cmdNamePairs]);
  }

  public sendChannel(ch: Channel, content: string, to?: string): void {
    pushCapped(this.channelMessages, to === undefined ? { ch, content } : { ch, content, to });
  }

  public showItem(detail: ItemDetailView): void {
    pushCapped(this.items, detail);
  }

  /** 属性面板快照（诊断 / 测试用；与 `items` 同一条"留最近 N 条"的口径） */
  public readonly attrViews: AttrView[] = [];
  public showAttr(view: AttrView): void {
    pushCapped(this.attrViews, view);
  }

  /** 技能面板快照（同上口径） */
  public readonly skillViews: SkillsView[] = [];
  public showSkills(view: SkillsView): void {
    pushCapped(this.skillViews, view);
  }

  public combat(phase: 'start' | 'end'): void {
    pushCapped(this.combatPhases, phase);
    pushCapped(this.events, `combat:${phase}`);
  }

  public die(commands: readonly CommandButton[]): void {
    pushCapped(this.deaths, commands);
  }

  public revive(): void {
    this.reviveCount += 1;
  }

  /** 收到的 `state` 帧。`null` 表示"状态结束"那一帧 —— 与 `combat:'end'` 同一口径 */
  public readonly stateViews: Array<StateView | null> = [];
  public state(view: StateView | null): void {
    pushCapped(this.stateViews, view);
    pushCapped(this.events, view === null ? 'state:end' : `state:${view.id}`);
  }

  public clear(): void {
    this.messages.length = 0;
    this.commands.length = 0;
    this.channelMessages.length = 0;
    this.items.length = 0;
    this.combatPhases.length = 0;
    this.deaths.length = 0;
    this.reviveCount = 0;
    this.stateViews.length = 0;
  }
}

/** 角色初始化参数 */
export interface CharacterInit {
  readonly oid: string;
  /** 模板 id；玩家角色传 null（没有模板来源） */
  readonly path: WorldId | null;
  readonly name: string;
  // 下面这些显式带 `| undefined`：`exactOptionalPropertyTypes` 下
  // `{ str: def.str ?? init.str }` 这种"透传可能为 undefined 的值"否则写不出来。
  readonly hp?: number | undefined;
  readonly mp?: number | undefined;
  readonly maxMp?: number | undefined;
  readonly str?: number | undefined;
  readonly con?: number | undefined;
  readonly dex?: number | undefined;
  readonly int?: number | undefined;
  readonly per?: number | undefined;
  readonly age?: number | undefined;
  readonly gender?: Gender | undefined;
  readonly money?: number | undefined;
  /** GM 等级（0 = 普通玩家）。见 `Character.userLevel` */
  readonly userLevel?: number | undefined;
  readonly maxItems?: number | undefined;
  readonly props?: RawPropMap | undefined;
  /**
   * 技能注册表。技能簿靠它把 id 解析成模板。
   * 缺省 = 空注册表（此时 `learn()` 会报"技能不存在"）——玩家角色在加载存档前就是这种状态。
   */
  readonly skillRegistry?: SkillRegistry | undefined;
  readonly output?: CharacterOutput | undefined;
  /**
   * 世界时钟（战斗节拍）。缺省 = **没有时钟** ⇒ `beginFight()` 会抛错。
   * ★ 不做静默兜底：一个"忘了注入时钟"的角色若安静地不排拍，
   *   表现是"战斗开始了但双方永远不动"—— 那种 bug 只有真打一次才看得见。
   */
  readonly scheduler?: Scheduler | undefined;
  /** 战斗随机源（测试注入确定性序列）；缺省 `Math.random` */
  readonly rand?: (() => number) | undefined;
}

/**
 * 先天属性补丁（`setInnate` 的入参）。改完自动 `recount()`。
 * 注意**没有** `forceRad`：内功系数是**派生**的（见 `forceRad` getter），
 * 不该由外部直接写 —— 否则"技能升级了但系数没变"又会变成一个要人记的步骤。
 */
export interface InnatePatch {
  readonly str?: number;
  readonly con?: number;
  readonly dex?: number;
  readonly int?: number;
  readonly maxMp?: number;
}

/** 忙碌标记在 temp 里的键名 */
const BUSY_KEY = 'busy';

/**
 * 「刚学会」的等级 —— `SkillBook.learn()` 的缺省建档等级（**两处必须一致**）。
 *
 * ★ 为什么 `learnSkill` 需要一个常量：它要在**建档之前**预演"学完之后几级"，
 *   才能判断 `master-lower` / `capped`（见 `learnSkill` 的顺序说明）。
 *   两处漂移的后果只是新技能的拒绝文案里那个 `level` 差一档，不会算错账 ——
 *   但仍然写在这里并对照 `skill.ts#learn(level = 1)`，免得读者去猜。
 */
const NEW_SKILL_LEVEL = 1;

/**
 * `busy`（忙乱）的**硬上界**。
 *
 * ★ 2026-10-16 拍板（E5）：`busy` 是**动作锁**，不是长时状态。
 *   wushen 里它由技能 / 逃跑 buff 的 `duration` 赋值（`os/char/chara_skill.js:367`、
 *   `os/char/chara_move.js:117` 的 `add_status({is_busy:true, duration})`），
 *   另有地图事件直接写（`world/map/wudao/ta.js:98` `me.is_busy = 1000`）。
 *   量级在数百 ms ~ 数秒 ⇒ 本项目取 **15s** 为上限，任何来源都不超过它。
 *   ★ 需要"更久不能动"的内容请用 `state`（状态系统）—— 别把 busy 当第二套状态用。
 */
export const BUSY_MAX_MS = 15_000;

/** 可写的先天属性键。**收成闭集**：拼错（`st`、`maxMp_`）会当场报错而不是静默新建一个字段 */
export const INNATE_KEYS = ['str', 'con', 'dex', 'int', 'maxMp'] as const;
export type InnateKey = (typeof INNATE_KEYS)[number];

function isInnateKey(x: string): x is InnateKey {
  return (INNATE_KEYS as readonly string[]).includes(x);
}

/**
 * 角色（玩家）背包的**默认容量**。
 *
 * ★ **有意偏离 wushen**：wushen `os/char/user.js:5` 是 **20**，本项目裁定取 **50**
 *   （与房间同档）—— 见 26 册 §32 与 `docs/29`。NPC 走 `DEFAULT_NPC_CAPACITY`（10）。
 * ★ 这是"具体种类的缺省"，不是基类语义：泛型 `Container` 不给缺省时仍是**不限**
 *   （`engine-base.test.ts` 的「默认容量不限」钉住那一条）。
 */
export const DEFAULT_CHARACTER_CAPACITY = 50;

export abstract class Character extends Container implements PropHolder {
  readonly #holder: PropHolder = createPropHolder();
  public readonly temp: TempStore = new TempStore();
  /**
   * 技能簿（学 / 升 / 装 / 卸 + 三档属性 + 绝招冷却）。
   * ★ 所有变更（含"改完属性要重算"）都收口在 `SkillBook` 内部，见 `server/engine/skill.ts`。
   */
  public readonly skills: SkillBook;

  #output: CharacterOutput;

  readonly #innate: {
    str: number;
    con: number;
    dex: number;
    int: number;
    maxMp: number;
  };

  #hp: number;
  #mp: number;
  #derived: DerivedCombat;

  /** 世界时钟（战斗节拍）。undefined = 未注入（`beginFight` 会抛） */
  readonly #scheduler: Scheduler | undefined;
  /** 战斗随机源 */
  readonly #rand: () => number;
  /** 当前战斗类型（`FIGHT_TYPE`） */
  #fightType: FightType = FIGHT_TYPE.NONE;
  /** 敌人列表（可能多个；`queryEnemy()` 取第一个还站着的） */
  #enemies: Character[] = [];
  /** 下一拍的调度句柄（停战 / 重排时取消） */
  #attackHandle: TaskHandle | null = null;
  /**
   * 挂着还没结算的击杀奖励（见 `queueReward`）。
   *
   * ★ 用两个数字而不是 `{exp, pot} | null`：同一拍里可能连杀两刀多只 NPC，
   *   累加比"覆盖"安全 —— 覆盖会静默吞掉前一只的奖励。
   */
  #pendingExp = 0;
  #pendingPot = 0;
  /**
   * 是否已经**死过**（`afterDeath` 收尾跑过）。`die()` 的**幂等判据**。
   *
   * ★ 为什么不是用 `hp<=0` 当判据（26 册 §54 订正，本批实测踩到）：
   *   调用方（`#endAttack`）在调 `die()` **之前**已经用 `takeDamage` 把人打到 0 ——
   *   那一刻 `isAlive` 已经是 false。若拿"hp<=0 就不做事"当守卫，
   *   **收尾永不执行**：NPC 不消散（留一具"看不见的尸体"占着房间位）、
   *   玩家收不到复活入口。这正是 wushen 不这么写的原因 ——
   *   它的 `NPC.die` 守卫是 `!this.environment`、`USER.die` 干脆没有守卫，
   *   都**不是** hp 判据（`os/char/npc.js:124`、`os/char/user.js:379`）。
   *   ★ 不变式：`#dead === true ⇒ hp === 0`（由 `setHp` 维护，见那里）。
   */
  #dead = false;

  public per: number;
  public age: number;
  /** 性别三档（`Gender`，来源 `shared/constants.ts`）：1 男 / 2 女 / 0 无性 */
  public gender: Gender;
  public money: number;
  public exp: number;
  public pot: number;
  // ★ 原先这里是 `public level: number`（恒 0 的字段）。2026-10-19 改成**派生**：
  //   `level` 现在是 `realm` 的别名 getter，见「成长」那一段的注释。
  //   删掉字段而不是留着不用，是为了让"境界到底存在哪"只有一个答案
  //   —— 留一个永不同步的字段，下一个人一定会去读它。
  /**
   * GM 等级（wushen `user_level`）。0 = 普通玩家。
   *
   * ★ 它的**唯一消费者**就是六道闸门里的 `allow_level`（`engine/command.ts`）
   *   —— 不是"声明未实现"：GM 指令的准入判定现在就走这个字段。
   *   赋值方是登录 / GM 授权流程（属另一批次）；在此之前恒为 0 是正确的。
   */
  public userLevel: number;

  protected constructor(init: CharacterInit, kind: ObjKind) {
    super(
      { oid: init.oid, path: init.path, kind, name: init.name },
      init.maxItems ?? DEFAULT_CHARACTER_CAPACITY,
    );

    this.#output = init.output ?? new RecordingOutput();
    this.#scheduler = init.scheduler;
    this.#rand = init.rand ?? Math.random;
    this.skills = new SkillBook(init.skillRegistry ?? emptySkillRegistry(), this);
    this.#innate = {
      str: init.str ?? 20,
      con: init.con ?? 20,
      dex: init.dex ?? 20,
      int: init.int ?? 20,
      maxMp: init.maxMp ?? 100,
    };
    this.per = init.per ?? 20;
    this.age = init.age ?? 18;
    this.gender = init.gender ?? 0;
    this.money = init.money ?? 0;
    this.userLevel = init.userLevel ?? 0;
    this.exp = 0;
    this.pot = 0;

    // 顺序要紧：**先装 prop 再算派生**，否则 max_hp 之类的加成
    // 不会体现在初始满血上（"新建的怪一进场就少血"这类怪现象）。
    if (init.props !== undefined) applyPropMap(this.#holder, init.props);

    // ★ 这里**故意不调 `this.forceRad`**：它是可覆写成员，而覆写者（`Npc`）
    //   的技能表要到 `super()` 返回之后才存在 —— 构造期调虚成员会读到 undefined。
    //   初始一律按默认内功系数算，由子类在构造收尾时自己 `recount()`。
    this.#derived = computeDerived(
      { ...this.#innate, forceRad: COMBAT_FORMULA.forceRadDefault },
      this.#holder,
    );
    this.#hp = init.hp ?? this.#derived.maxHp;
    this.#mp = init.mp ?? this.#innate.maxMp;
    this.setHp(this.#hp);
    this.setMp(this.#mp);
  }

  // ── PropHolder（属性表本体；读写请走 props.ts 的访问器）────────────────────

  public get props(): Map<string, number> {
    return this.#holder.props;
  }

  public get extProps(): Map<string, number> {
    return this.#holder.extProps;
  }

  // ── Actor 契约（内容层钩子拿到的就是这些）──────────────────────────────────
  // `id` 不再在这里本地定义：`GameObject` 已经把 `oid` 暴露成 `id` 别名，
  // 于是 Character / Npc / Item / Room 对内容层是同一套字段（见 base.ts）。

  /**
   * 第三人称称谓（wushen `CHARACTER.prototype.call3()`，`os/char/chara_comm.js:41`）。
   * `$P` / `$p` 用它 —— 与 `$N` / `$n`（给**名字**）的分工：
   * 点名用名字，叙述用称谓（「**他**拂袖而去」而不是「阿飞拂袖而去」）。
   *
   * ★ wushen 原文（`os/char/chara_comm.js:41`）只判 `gender == 1`，所以另一档一律"她"。
   *   本项目照抄**两档**，第三档（`0` 无性）也读"她" —— 这不是没跟上 T18：
   *   T18 补的是**类型**（`0 | 1 | 2`，见 `shared/constants.ts` 的 `Gender`）
   *   与"这门武功要什么性别"的文案（`GENDER_LABELS`），
   *   而**叙述里的第三人称称谓**在 wushen 就是两档，改它才是偏离原作。
   */
  public call3(): string {
    return this.gender === 1 ? '他' : '她';
  }

  public notify(text: string): void {
    this.#output.notify(text);
  }

  /**
   * 面板内文本（§80）：这段文本属于 `panelId` 那块物件面板。
   *
   * ★ 调用点的正确形态：内容层手里已经有物件对象时用它的 id ——
   *   `me.notifyInPanel(target.id, '你想打听什么？')`，
   *   与 `me.showItem({ id: target.id, … })` 用的是**同一个 id**。
   *   于是"面板开的是谁"和"这句话给谁"天然对齐，不需要再传第二份标识。
   */
  public notifyInPanel(panelId: string, text: string): void {
    this.#output.notifyInPanel(panelId, text);
  }

  /**
   * 房间广播：**同一句话，每个收件人看到自己那一句**（三视角）。
   *
   * 对照 wushen `CHARACTER.prototype.send_room`（`os/char/character.js:71-87`）：
   * 遍历 `environment.items` → 取其中的**玩家** → 按视角渲染后各自 `notify`。
   *
   * ★ 受众在**引擎**解析，而不是像 `sendChannel` 那样交给会话层：
   *   频道受众依赖"现在有哪些连接"（会话层的知识）；房间受众只是**房间里的角色对象**，
   *   引擎本来就看得到。更关键的是 **NPC 没有连接** —— 若把投递交给会话层遍历连接，
   *   内容层写的 NPC 台词会静默消失。
   *
   * ★ 第三人称那一份**只渲染一次**、所有旁观者共用（wushen 的 `th_vision` 缓存）。
   */
  public sendRoom(text: string, target?: ViewSubject | null, excludeself = false): void {
    const env = this.environment;
    if (env === null || !text) return;
    const aimed = target ?? null;
    let third: string | undefined;
    for (const obj of env.items) {
      if (obj.kind !== 'player' || !(obj instanceof Character)) continue;
      if (obj === this) {
        if (!excludeself) obj.notify(renderViewText(this, text, VIEW_SELF, aimed));
      } else if (obj === aimed) {
        obj.notify(renderViewText(this, text, VIEW_TARGET, aimed));
      } else {
        if (third === undefined) third = renderViewText(this, text, VIEW_OTHER, aimed);
        obj.notify(third);
      }
    }
  }

  public sendCommands(...cmdNamePairs: string[]): void {
    this.#output.sendCommands(...cmdNamePairs);
  }

  public sendChannel(ch: Channel, content: string, to?: string): void {
    this.#output.sendChannel(ch, content, to);
  }

  public showItem(detail: ItemDetailView): void {
    this.#output.showItem(detail);
  }

  public showAttr(view: AttrView): void {
    this.#output.showAttr(view);
  }

  public showSkills(view: SkillsView): void {
    this.#output.showSkills(view);
  }

  // ── 物品搬运（`defs.ts` 的 `CommandActor` 四原语）────────────────────────
  //
  // ★ 为什么内容层拿到的是**三个动词**而不是一个 `Container` 句柄：
  //   位置一致性（`environment` ↔ `Container.items` 双向）必须由**一个**代码路径保证
  //   （`base.ts` 的模块私有 `ENVIRONMENT` WeakMap 就是为此）。把句柄交出去，
  //   内容层就能绕过 `moveTo` 直接改位置 —— 那正是 `base.ts` 花力气堵掉的那类失配。
  //
  // ★ 三处都用 `instanceof Item` 而不是"信调用方传的是物品"：
  //   `ActorObject` 是**结构**视图，房间里的一切（NPC / 玩家 / 物品）都满足它。
  //   一个 `spendItem(npc)` 若只靠鸭子类型会走到 `npc.count`（`undefined`），
  //   而 `undefined < 1` 是 `false` —— 判据静默放行，随后 `addCount` 抛 TypeError。
  //   同族的还有 `takeItem`：wushen 用 `if (obj.is_living())` 拦"背不动人"
  //   （`get.js:32`），这里由类型（`instanceof Item`）直接挡掉。
  //
  // ★ 内容层视图 → 引擎对象的**转换点只有这里**：`ActorObject` 在运行时**就是**
  //   那个 `Item` 实例（`findTarget` 返回的是 `env.items` 里的元素），
  //   所以 `as unknown as` 不是"猜类型"，是"把已经持有的结构视图还原成具体类型"。
  //   `instanceof` 同时充当这道转换的**运行时校验**。

  /** 把内容层视图还原成引擎对象；不是 `Item` 则 `undefined`（见上方注释） */
  #asItem(view: ActorObject): Item | undefined {
    return view instanceof Item ? view : undefined;
  }

  public takeItem(view: ActorObject): boolean {
    const item = this.#asItem(view);
    if (item === undefined) return false;
    if (this.isFull()) return false;
    item.moveTo(this);
    return true;
  }

  public dropItem(view: ActorObject): boolean {
    const item = this.#asItem(view);
    if (item === undefined) return false;
    const env = this.environment;
    if (env === null || env.isFull()) return false;
    item.moveTo(env);
    return true;
  }

  public spendItem(view: ActorObject, count = 1): boolean {
    const item = this.#asItem(view);
    if (item === undefined) return false;
    if (!Number.isInteger(count) || count < 1) {
      throw new CharacterError(`消耗数量必须是 ≥1 的整数，收到 ${String(count)}`);
    }
    if (item.count < count) return false;
    item.addCount(-count);
    // 归零即销毁：`Item` 的注释写着"恒 ≥ 1 —— 归零即应当被销毁，
    // 而不是留一个 count=0 的幽灵"。销毁 = 从容器里摘掉（位置脱钩）。
    if (item.isDepleted) {
      this.removeItem(item); // 位置脱钩（从本容器摘掉）
      // ★ T4（26 册 §55）：还要让世界把它忘掉并**释放 oid** ——
      //   只 `removeItem` 的话 `world.items` 里会一直留着"已经不存在"的物品。
      item.destroy();
    }
    return true;
  }

  public spendMoney(amount: number): boolean {
    if (!Number.isInteger(amount) || amount < 1) {
      throw new CharacterError(`支付金额必须是 ≥1 的整数，收到 ${String(amount)}`);
    }
    if (this.money < amount) return false;
    this.money -= amount;
    return true;
  }

  /**
   * 朝某方向走一步（`defs.ts` 的 `CommandActor.go` 的实现）。
   *
   * ★ 这里是**唯一**把"查 → 判 → 问 → 移 → 到达"按序做全的地方，**顺序本身是契约**：
   *   查出口（`Room.exitTo`）→ 判满员（`Room.isFull`）→ 问内容准不准走
   *   （`Room.allowLeave` → `on_leave`）→ 移（`Container` 双向绑定）
   *   → 跑到达钩子（`Room.fireEnter` → `on_enter`）。
   *   顺序反了有两种可见的怪现象：① 人还没到、房间已经在欢迎他；② 一次**失败**的移动
   *   也跑进了内容层的 `on_leave`（wushen 不会，见下面那条）。
   *
   * ★ 返回**原因**而不是布尔（26 册 T2）：走不动有三种，话不一样 ——
   *   没出路 / 内容拦住 / 房间满员。布尔值会逼调用点说一句笼统的"过不去"。
   *
   * ★ 满员走的是**预检查**（wushen `chara_move.js:22` 的 `is_full()`），
   *   不是"接住 `ContainerError`"——两种语义不该挤在同一个出口上：
   *   - `Container.addItem` 的抛错是给**内容 / 实例化路径**的 fail-fast
   *     （"内容写错了"该当场炸，那个语义要保住）；
   *   - "玩家走进一个满房间"是**正常运行时事件**，该被拒绝并给一句话。
   *
   * ★ 原先这里是 `try { moveTo } catch { return false }` —— catch-all 会把
   *   `on_leave` / `on_enter` 里内容层抛的**任何**错误也静默翻译成"过不去"，
   *   真 bug 从此查不到。现在没有任何 catch：异常照常往上抛
   *   （`tests/move-full.test.ts` 有两条反向验证过会红的用例钉住它）。
   *
   * ★ 为什么没有"走不进的房间"这一类（§11.4 原建议里的 `reason: 'self'`）：
   *   自环出口在 `Room.linkExit` 就被拒了（"指向自己"直接抛 `RoomError`），
   *   所以 `target` 恒不等于 `from`，第四种 `reason` 没有可命中的输入 ——
   *   枚举里多留一档就是 FG-19 那类"注释/类型宣称了一个不存在的情况"。
   */
  public go(direction: Direction): MoveResult {
    const from = this.room;
    // 防御分支：不在任何房间。**构造上不可达** —— 方向动作由 `Room.#derivedMoveActions`
    // 派生（不在房间就没有这个动作），`go <dir>` 也只在有房间时才有出口可查。
    // 真到了这里，"内容拦住"那句是错的译文，所以它若有一天变得可达，要给它自己的 reason。
    if (!(from instanceof Room)) return { ok: false, reason: 'blocked' };

    // ★ 判定顺序照 wushen 分两段拼起来（**不是风格问题**，见 §23.5）：
    //   ① `world/cmd/action/go.js:15`  先查出口；
    //   ② `os/char/chara_move.js:22,30` 再查满员，**最后**才 `do_leave`。
    //   `on_leave` 是内容层代码、可能有副作用（扣道具 / 发提示）——
    //   顺序错了，一次**失败**的移动也会跑进内容层的钩子里，而 wushen 不会。
    const target = from.exitTo(direction);
    if (target === undefined) return { ok: false, reason: 'no-exit' };
    if (target.isFull()) return { ok: false, reason: 'full' };
    if (!from.allowLeave(this, direction)) return { ok: false, reason: 'blocked' };

    this.moveTo(target);
    target.fireEnter(this);
    // ★ 会话层在**每条指令之后**对账房间（`session.ts#syncRoom`），
    //   所以这里不必、也不该自己往外发包 —— 内容层不知道协议长什么样。
    return { ok: true };
  }

  /**
   * 换输出通道（断线重连 / 顶号）。角色对象本身**不重建**，所以状态天然保留。
   *
   * ★ FG-15（24 册 §5.3 / 26 册 §28.3）：这是一个**目前还没有调用点的接缝**。
   *   会话层做不到"跨连接存活的角色"（`session.logout()` 掉线即注销），
   *   所以真·重连要先等账号 / 存档批次把角色从连接生命周期里解耦。
   *   在那之前别把它当作"重连已经通了"的证据 —— 它的契约单独由
   *   `tests/session.test.ts` 的「FG-15」用例钉住（换过之后通知走新通道）。
   */
  public setOutput(output: CharacterOutput): void {
    this.#output = output;
  }

  // ── 属性 ──────────────────────────────────────────────────────────────────
  //
  // ★★ 四维（`str/con/dex/int`）对外是**有效属性**（先天 + 后天加成），不是裸先天值。
  //   2026-10-15 归一（26 册 §37）：内容层"看到的属性"与门槛"判定的属性"必须同一个数，
  //   否则 `me.str` 与 `learnCondition.minAttr.str` 会各说各话 —— wushen 的
  //   `str1`(先天)/`str`(先天+加成) 二义性正是这么来的（`os/skill/skill.js:222-237`）。
  //   ⚠️ **裸先天值**在 `#innate`（私有）里，派生公式经 `innateSnapshot()` 取 ——
  //   `computeDerived()` 要的是**分开的**先天，不是合计（见 `effectiveAttr` 注释）。
  //   `maxMp` **不在此列**：它不是先天四维，且 `max_mp` 没有"加成"这一路。

  public get str(): number {
    return effectiveAttr(this.#innate, this.#holder, 'str');
  }

  public get con(): number {
    return effectiveAttr(this.#innate, this.#holder, 'con');
  }

  public get dex(): number {
    return effectiveAttr(this.#innate, this.#holder, 'dex');
  }

  public get int(): number {
    return effectiveAttr(this.#innate, this.#holder, 'int');
  }

  public get maxMp(): number {
    return this.#innate.maxMp;
  }

  /**
   * 四维的**三档读数**（先天 / 后天加成 / 合计）—— 面板与诊断用（`CommandActor` 契约）。
   *
   * ★ 合计与上面四个 getter **同值**（都走 `effectiveAttr`）；额外给出的只是
   *   "先天"与"后天"两档，正是面板要的 `臂力 25（先天 20 + 后天 5）`。
   */
  public attrBreakdowns(): readonly AttrBreakdown[] {
    return computeAttrBreakdowns(this.#innate, this.#holder);
  }

  /**
   * **属性面板整张快照**（`CommandActor.attrView` 的实现，供 `score` 指令）。
   *
   * ★ 所有数都从**同一个** `#derived` / `#innate` 取，没有第二份算法：
   *   面板上的「攻击」就是出招时读的 `#derived.attack`，不可能一边显示 31
   *   一边按 30 结算。
   * ★ `mp` / `maxMp` 走 `SkillActor` 那对 getter（`maxMp` 不含加成，
   *   见 26 册 §29.4 的数值偏离登记）。
   */
  public attrView(): AttrView {
    const d = this.#derived;
    return {
      name: this.name,
      gender: this.gender,
      level: this.realm,
      realmName: realmName(this.realm),
      exp: this.exp,
      pot: this.pot,
      hp: this.hp,
      maxHp: this.maxHp,
      mp: this.mp,
      maxMp: this.maxMp,
      attrs: this.attrBreakdowns(),
      combat: {
        attack: d.attack,
        defense: d.defense,
        hit: d.hit,
        evasion: d.evasion,
        deflect: d.deflect,
        crit: d.crit,
      },
      skillLimit: this.skillLimit(),
    };
  }

  /**
   * 内功系数（wushen `query_force_rad`，本体在 `os/char/chara_prop.js:20`）：
   * 取**当前占据 `force` 槽的生效技能模板**上的 `force_rad`；没有内功则用
   * `COMBAT_FORMULA.forceRadDefault`。于是"学了内功 → 气血公式的乘数变了"
   * 是自动的，没人需要手动同步这个值。
   */
  public get forceRad(): number {
    return this.skills.activeForceRad();
  }

  /**
   * 某技能 / 某装配槽的当前等级（0 = 不会）。
   *
   * 三种输入都认，**判定顺序不能换**：
   *   ① **槽名**（`sword`）→ 该槽占位的基本技能等级（wushen `query_skill('sword')`）；
   *   ② **技能 id**（`wd/taijijian`）→ 直接查记录；
   *   ③ **中文名**（`太极剑法`）→ 先按名解析。
   *
   * ★ ③ 是 §64 加的：`learn <中文名> from <老师>` 要问"老师这门练到几级"，
   *   而玩家敲的是中文名。槽名先判是**必要的**：`sword` 既是槽名也可能是某技能 id 的末段，
   *   而槽名这一支读的是"基本技能等级"，与"职业记录等级"是两个数（可能不等）。
   */
  public skillLevel(idOrSlot: string): number {
    if (isEnableSlot(idOrSlot)) return this.skills.levelOfSlot(idOrSlot);
    const byId = this.skills.levelOf(idOrSlot);
    return byId > 0 ? byId : this.skills.levelOfName(idOrSlot);
  }

  /**
   * **这个人会哪些技能**（只读清单）—— `skills <目标>` 看 NPC 用。
   *
   * ★ 为什么不是把 `skillView()` 直接开放给内容层：那份快照里有
   *   `progress` / `skillLimit` / `pot` 这些**只对"自己"有意义**的字段
   *   （问一个 NPC"你离下一级还差多少经验"没有用途），而且它带着面板的排序与标题。
   *   这里只给"名字 + 等级 + 占哪个槽"，是"看得懂他会什么"的最小集合。
   *
   * ★ 与 `skillLevel()` 的分工：那个回答"他这门几级"（`learn` 判师用），
   *   这个回答"他总共有几门"（展示用）。**两者读同一个 `SkillBook`**，
   *   所以不会出现"清单里没有、但能跟他学"的矛盾。
   */
  public skillList(): readonly SkillBrief[] {
    const out: SkillBrief[] = [];
    for (const state of this.skills.entries()) {
      const tpl = this.skills.templateOf(state.id);
      // 存档里可能有已下线的技能（与 `skillView` 同一条）
      if (tpl === undefined) continue;
      out.push({
        id: tpl.id,
        name: tpl.name,
        level: state.level,
        // `tpl.slot` 的类型是 `EnableSlot | null`（特殊武学没槽）—— 归一成"没有这一项"
        ...(tpl.slot === null ? {} : { slot: tpl.slot }),
      });
    }
    // 等级高的在前；同级的按名字 —— 顺序由服务端定，免得两个面板各排一套
    out.sort((a, b) => (a.level === b.level ? (a.name < b.name ? -1 : a.name > b.name ? 1 : 0) : b.level - a.level));
    return out;
  }

  // ── 成长：经验 / 潜能 / 技能上限 ──────────────────────────────────────────
  // 对照 wushen：`os/char/character.js:304`（`add_exp`）、
  // `os/char/chara_skill.js:87`（`skill_limit`）、`world/cmd/skill/lianxi.js`（练习）。

  /**
   * **境界**（0–6）：内功 / 轻功 / 招架**三槽等级的最小值**落在第几档。
   *
   * ★★ 与 wushen 的**根本差异**：wushen 的 `level` 是一个**存下来的字段**
   *   （由任务/门派推上去），本项目的境界是**派生**的 —— 三样基本功练到哪，境界就在哪。
   *   好处：① 少一个可写字段 ⇒ "存档里的境界与技能对不上"这种状态**不可能存在**；
   *   ② 玩家看得见怎么涨（"把这三门练上去"是可执行的话）。
   *   代价：境界不能由任务/剧情单独推高。真需要时再加"额外境界加成"字段，
   *   但**不要**把它变回一个可以直接赋值的 `level`。
   *
   * ★ 规则与阈值在 `skill.ts#realmOf` / `SKILL_FORMULA.realmThresholds`（单源）。
   */
  public get realm(): number {
    return realmOf(
      this.skills.levelOfSlot(BASE_SKILLS.FORCE),
      this.skills.levelOfSlot(BASE_SKILLS.DODGE),
      this.skills.levelOfSlot(BASE_SKILLS.PARRY),
    );
  }

  /**
   * 境界的**旧名字**。wushen 与协议里都叫 `level`，面板也照它取数 ——
   * 保留它是为了不动协议形状；它**不是**第二个字段，就是 `realm`。
   */
  public get level(): number {
    return this.realm;
  }

  /**
   * 技能等级上限（wushen `skill_limit`）：由**自身经验**与境界决定。
   * 消费者是 `SkillBook.addExp()` 的封顶 —— 见 `SkillActor.skillLimit`。
   *
   * ★ wushen 的 `switch (this.level)` 把境界当**因子**（10/20/…/60），本实现照抄。
   *   ★ 2026-10-19 起 `level` 不再是恒 0 的字段，而是 `realm` 的别名 ⇒
   *     函数体一字未改，行为却从"因子恒 10"变成"随三槽等级放大"。
   *     这是**派生优于字段**的一个正例：升级规则只改了数据来源，调用点没动。
   */
  public skillLimit(): number {
    return levelLimit(this.exp, this.realm);
  }

  /**
   * 获得经验 / 潜能 / 钱（wushen `add_exp(exp, pot, money)`）。
   *
   * ★★ 这是**唯一**的增加入口：打怪奖励、任务奖励、GM 补给都走它，
   *   于是"给了却没播报 / 播报的数与实际入账不一致"只可能有一处错。
   *
   * ★ 与 wushen 的差异（有意）：**负数抛错**。wushen 用同一个方法两头通吃，
   *   于是掉经验也会播成"你获得了-500点经验"；而扣经验属于"死亡惩罚 / GM 调整"
   *   那类独立玩法，该有自己的文案与审计点，不该混进"获得"。
   */
  public addExp(exp: number, pot = 0, money = 0): void {
    for (const [label, value] of [
      ['经验', exp],
      ['潜能', pot],
      ['钱', money],
    ] as const) {
      if (!Number.isFinite(value)) {
        throw new CharacterError(`addExp 的${label}必须是有限数值，收到 ${String(value)}`);
      }
      if (value < 0) {
        throw new CharacterError(`addExp 只收非负的${label}（扣减走各自的惩罚路径），收到 ${String(value)}`);
      }
    }
    this.exp += Math.trunc(exp);
    this.pot += Math.trunc(pot);
    this.money += Math.trunc(money);

    const parts: string[] = [];
    if (exp > 0) parts.push(`${String(Math.trunc(exp))} 点经验`);
    if (pot > 0) parts.push(`${String(Math.trunc(pot))} 点潜能`);
    if (money > 0) parts.push(`${String(Math.trunc(money))} 文钱`);
    if (parts.length === 0) return;
    // ★ 数字与"你获得了"之间**必须**有空格：写成 `你获得了100 点经验` 会渲染成
    //   "你获得了100 点经验"（中文与数字粘连）。数值本身已在上面拼好带空格的量词，
    //   缺口只在句首这一个位置 —— 真正的播报入口全项目只此一处（33 册铁律 3）。
    this.notify(`你获得了 ${parts.join('，')}。`);
  }

  /**
   * **直接发放经验 / 潜能**（测试与补偿用）。
   *
   * ★ 与 `addExp` 的关系：它**就是** `addExp` 的转发，不另立账、不另写播报。
   *   留着这个别名是为了让 `CommandActor` 有一条**显式**的写入通道 ——
   *   之前那条契约写的是"成长面只读不写"（钱只给花、经验只给看），
   *   于是测试指令没有任何合法的写入路径，只能绕开引擎去改字段（更糟）。
   *
   * ★★ **准入在调用方**（`world/command/admin/addxp.ts`：GM 等级 ≥9 或 `MUD_TEST=1`），
   *   引擎这一层不判权限 —— 引擎不认识"测试模式"这种运营概念，
   *   而且同一条方法将来还要给任务奖励 / GM 补偿用。
   */
  public grantExp(exp: number, pot = 0): void {
    this.addExp(exp, pot);
  }

  /**
   * **记下一笔击杀奖励，等战斗收尾后再结算**（`Npc.afterDeath` 调用）。
   *
   * ★★ 为什么不能直接 `addExp`（26 册 §57，真机反馈）：
   *   致命一刀的顺序是 `#doAttack`（打死）→ `#endAttack` → `die()` → `afterDeath`
   *   → 奖励播报 → 回到 `#endAttack` 尾部才 `endFight()` 发 `combat:end`。
   *   于是玩家的屏幕上是「你获得了 1000 点经验和 500 点潜能」**之后**才出现
   *   「【战斗结束】」—— 因果颠倒：先有了战果，才说战斗结束。
   *   `endFight()` 会先发 `combat:end` 再调本方法里的 `#flushReward()`，
   *   于是顺序变成"战斗结束 → 结算奖励"。
   *
   * ★ 仍然**只有 `addExp` 一个增加入口**（成长闭环的单点没有被绕开）：
   *   这里只是把"什么时候播报"推后，钱与经验还是那一个方法加的。
   *
   * ★ 不在战斗中（`#fightType === NONE`）⇒ 立即结算：非战斗途径打死的 NPC
   *   （未来的绝招、陷阱、GM）不该把奖励永远挂在队列里。
   */
  public queueReward(exp: number, pot: number): void {
    if (exp <= 0 && pot <= 0) return;
    this.#pendingExp += Math.trunc(exp);
    this.#pendingPot += Math.trunc(pot);
    if (this.#fightType === FIGHT_TYPE.NONE) this.#flushReward();
  }

  /** 把挂着的击杀奖励真正结算（`endFight` 发完 `combat:end` 之后调用） */
  #flushReward(): void {
    const exp = this.#pendingExp;
    const pot = this.#pendingPot;
    this.#pendingExp = 0;
    this.#pendingPot = 0;
    if (exp <= 0 && pot <= 0) return;
    this.addExp(exp, pot);
  }

  /** 花掉潜能（wushen `lianxi.js` 的 `me.pot -= exp`）。返回 `false` = 不够 */
  public spendPot(amount: number): boolean {
    if (!Number.isFinite(amount) || amount < 0) {
      throw new CharacterError(`spendPot 需要 ≥0 的有限数值，收到 ${String(amount)}`);
    }
    const cost = Math.trunc(amount);
    if (this.pot < cost) return false;
    this.pot -= cost;
    return true;
  }

  /**
   * 练技能（内容层 `practice` 指令的落点）。账目全在 `SkillBook.practice` 里算，
   * 这里只做委派 —— 于是"潜能 1:1 换技能经验"只有一份实现。
   */
  public practiceSkill(idOrName: string, targetLevel?: number): PracticeResult {
    return this.skills.practice(idOrName, targetLevel);
  }

  /**
   * 读一段书（`study` 指令的每一拍落点）。账目全在 `SkillBook.study` 里，
   * 这里只做委派 —— 「书的上限 / 准入 / 加经验」只有一份实现。
   */
  public studySkill(idOrName: string, exp: number, bookMax: number): StudyResult {
    return this.skills.study(idOrName, exp, bookMax);
  }

  // ── 持续状态（wushen `me.state` · 26 册 §75）──────────────────────────────
  //
  // ★★ 为什么这一段之前一直缺：技能族（`practice` / `study` / `dazuo`）在 wushen
  //    **全部**是 `set_state` 之后靠心跳推进的，而本项目把它们做成了"敲一次结算一次"。
  //    结果是三个能力一起丢：不能中断、没有过程、消耗是一次性的。
  //    ⇒ 状态机是"技能做全"的前提，不是可选装饰。

  /** 心跳间隔的缺省值（wushen 的 `lianxi` / `study` / `dazuo` 都是 5 秒一拍） */
  public static readonly DEFAULT_STATE_INTERVAL_MS = 5_000;

  /** 正在跑的状态；`null` = 空闲 */
  #state: {
    readonly id: string;
    readonly title: string;
    readonly desc: string;
    readonly tick: (me: CommandActor) => boolean | void;
    handle: TaskHandle | null;
  } | null = null;

  /** 当前状态（`null` = 空闲）。闸门 `allow_state` 读它的 `title` 去拦人 */
  public get state(): StateView | null {
    return this.#state === null ? null : { id: this.#state.id, title: this.#state.title, desc: this.#state.desc };
  }

  /**
   * 起一个持续状态。
   *
   * ★ `tick` 抛错 ⇒ **结束状态**（不吞）：状态里跑的是内容层代码，
   *   跟战斗 `#attackTick` 同一条理由 —— 抛错后继续排拍只会让同一个错误每秒刷屏。
   *   玩家看到的是一句"…中断了"，而不是卡在一个永远推进不了的状态里。
   *
   * @returns `false` = 已经在某个状态里（先 `stopState()`）；`true` = 已开始
   */
  public startState(spec: StateSpec): boolean {
    if (this.#state !== null) return false;
    if (this.#scheduler === undefined) {
      throw new CharacterError('startState 需要世界时钟：构造时未注入 scheduler');
    }
    const intervalMs =
      spec.intervalMs === undefined
        ? Character.DEFAULT_STATE_INTERVAL_MS
        : Math.max(1, Math.trunc(spec.intervalMs));
    const running = {
      id: spec.id,
      title: spec.title,
      desc: spec.desc ?? '',
      tick: spec.tick,
      handle: null as TaskHandle | null,
    };
    this.#state = running;
    this.#output.state({ id: running.id, title: running.title, desc: running.desc });
    // ★ 与第一拍的间隔：wushen 的 `on_enter` 也是"过一拍才开始"，不是立刻跑一次
    //   （`lianxi` 里先 `notify("你开始练习…")` 再排期）。
    running.handle = this.#scheduler.every(intervalMs, () => {
      this.#stateTick();
    });
    return true;
  }

  /** 一拍。结束条件：`tick` 返回 `false` / 抛错 / 状态已被 `stopState` 摘掉 */
  #stateTick(): void {
    const running = this.#state;
    if (running === null) return;
    let keep: unknown;
    try {
      keep = running.tick(this as unknown as CommandActor);
    } catch (e) {
      // 与 `#attackTick` 同一条处理：记下来，然后**结束**这个状态
      const detail = e instanceof Error ? e.message : String(e);
      process.stderr.write(`[state:${running.id}] ${this.name} 的状态心跳抛出异常，已中断：${detail}\n`);
      keep = false;
    }
    if (keep === false) this.stopState();
  }

  /**
   * 结束当前状态（wushen `stopstate` / `clear_state`）。
   * @returns 是否确实停掉了一个状态
   */
  public stopState(): boolean {
    const running = this.#state;
    if (running === null) return false;
    this.#state = null;
    if (running.handle !== null) this.#scheduler?.cancel(running.handle);
    this.#output.state(null);
    return true;
  }

  // ── 技能簿的三个动作 + 面板快照（27 册 §14 · 26 册 §64）─────────────────

  /**
   * 学一次（wushen `xue <技能> from <老师>` 的一次结算）。
   *
   * 顺序（**不能换**，每一道都决定下一句该说什么）：
   *   ① 技能存在 → `unknown`
   *   ② 未学会 ⇒ 走 `learnCondition` 准入（`minSlot`/`minAttr`/`minMaxMp`/`gender`）
   *   ③ 老师会不会（`teacherLevel === 0`）→ `no-teacher`
   *   ④ 你的等级是否已经不输老师 → `master-lower`（**先于** ⑤：
   *      老师就到 30 级时，说"我已经 30 级了"比"你到上限了"更贴近处境）
   *   ⑤ 自己是否到了技能上限（经验曲线 / 模板顶）→ `capped`
   *   ⑥ 潜能够不够**这一整笔** → `no-pot`（wushen 是全有或全无，不像 `practice` 花到光）
   *   ── 以上全部通过 ⇒ **这里才开始动状态**（建档 → 扣潜能 → 加经验）
   *
   * ★★ 「全有或全无」**也包括技能簿**（26 册 §64.11）：原实现把建档放在 ②，
   *   ③–⑥ 的拒绝全都发生在建档之后 ⇒ 被拒后技能簿里多一门 1 级技能。
   *   真机上是这么露出来的：潜能 0 的新人敲 `learn 基本剑法 from 教头`，
   *   日志说"潜能不够"，而 `skills` 面板显示「基本剑法 1 级」。
   *   ⇒ 现在 ② 只做**只读**检查（`SkillBook.conditionOf`），建档挪到 ⑥ 之后。
   *
   * ★ 与 wushen 的差异（**形态**）：原作是"每 5 秒一拍"的持续状态；
   *   这里一次结算一拍的量。账目口径完全一致（`me.pot -= exp; add_exp(me, exp)`）。
   */
  public learnSkill(idOrName: string, teacherLevel: number): LearnResult {
    if (!Number.isFinite(teacherLevel) || teacherLevel < 0) {
      throw new CharacterError(`learnSkill 的老师等级必须是 ≥0 的有限数值，收到 ${String(teacherLevel)}`);
    }
    const teacher = Math.trunc(teacherLevel);
    const tpl = this.skills.templateOf(idOrName);
    if (tpl === undefined) return { kind: 'refused', reason: 'unknown' };

    const known = this.skills.has(tpl.id);
    if (!known) {
      // ② 只读准入（`learnCondition` 仍是学习准入的**唯一**闸门，只是这次不建档）
      const gate = this.skills.conditionOf(tpl.id);
      if (gate !== null) return gate;
    }
    // 未学过时按"建档后的等级"预演 ③④⑤ —— 与 `SkillBook.learn()` 的缺省一致
    const level = known ? this.skills.levelOf(tpl.id) : NEW_SKILL_LEVEL;

    // ③ 老师不会
    if (teacher === 0) {
      return { kind: 'refused', reason: 'no-teacher', name: tpl.name };
    }
    // ④ 已经不输老师
    if (level >= teacher) {
      return { kind: 'refused', reason: 'master-lower', teacherLevel: teacher, name: tpl.name };
    }
    // ⑤ 自己的上限（模板顶 与 经验曲线 取小；老师能教到哪也一并算进来）
    const cap = Math.min(this.skills.capOf(tpl.id), teacher);
    if (level >= cap) {
      return { kind: 'refused', reason: 'capped', name: tpl.name, level, limit: cap };
    }

    // ⑥ 一拍的量（wushen `xue.js:241-251`）
    const gain = this.learnGain(tpl.type, level);
    if (gain > this.pot) {
      return { kind: 'refused', reason: 'no-pot', name: tpl.name, need: gain };
    }

    // ── 到这里所有拒绝都不可能发生了 ⇒ 现在才动状态 ──
    if (!known) {
      // `learn()` 内部会再跑一次准入（同一个 `#conditionRefusal`，幂等）+ `onLearn` 钩子
      const created = this.skills.learn(tpl.id);
      if (created.kind === 'refused') return created;
    }
    if (!this.spendPot(gain)) {
      // 上面刚比过 `pot`：走到这里说明两本账不一致 —— 大声报，不要静默涨级。
      throw new CharacterError('learnSkill 结账失败：pot 与 spendPot 读数不一致');
    }
    this.skills.addExp(tpl.id, gain);
    const after = this.skills.entryOf(tpl.id);
    if (after === undefined) {
      // 刚建档/刚加过经验，档案不可能不在 —— 不在就是有 bug，不许静默返回 1 级
      throw new CharacterError(`learnSkill 结算后找不到技能档案：${tpl.id}`);
    }
    return {
      kind: 'learned',
      id: tpl.id,
      name: tpl.name,
      level: after.level,
      spent: gain,
      gained: after.level - level,
    };
  }

  /**
   * 教学一拍的技能经验（wushen `xue.js:273-278` 的 `count_speed` × 倍率）。
   *
   * ```
   * speed = trunc(int * (100 + study_efficiency + int) / 100) * 3
   * gain  = speed * 5   (lv < 300；知识类再 ×2)
   *       = speed       (lv >= 300；知识类 ×10)
   * ```
   *
   * ★ 与 wushen 的一处**口径归一**：wushen 公式里 `me.int`（先天）与
   *   `me.query_prop("int")`（加成）各出现一次，而本项目 `Character.int` 就是
   *   **有效属性**（先天 + 加成，§37 归一）。这里两处都用有效 `int`，
   *   于是"学了加悟性的内功之后学得更快"自动成立，不需要第二个人肉加法。
   *   数值上与 wushen 最多差一个 `加成` 的平方项（微乎其微），换来的是**一个口径**。
   *
   * ★ `family.study_efficiency` / `WORLD.DATA.study_efficiency` 两路没有对应物 ⇒ 记 0。
   *   不另造接口（26 册 L8：不为"整齐"加字段）。
   */
  private learnGain(type: number, level: number): number {
    const int = this.int;
    const per = getProp(this, 'study_efficiency');
    const speed = Math.trunc((int * (100 + per + int)) / 100) * 3;
    const base = level < 300 ? speed * 5 : speed;
    return type === SKILL_TYPES.KNOWLEDGE ? base * (level < 300 ? 2 : 10) : base;
  }

  /**
   * 遗忘一个技能。基础技能与知识类不可遗忘（wushen `fangqi.js:10-12`）。
   *
   * ★ 规则放引擎而不是指令：将来 GM 指令、面板、脚本都会遗忘，
   *   三条入口各抄一遍"基础不可忘"迟早会有一条漏。
   */
  public forgetSkill(idOrName: string): ForgetResult {
    const tpl = this.skills.templateOf(idOrName);
    if (tpl === undefined) return { kind: 'refused', reason: 'unknown' };
    const st = this.skills.entryOf(tpl.id);
    if (st === undefined) return { kind: 'refused', reason: 'not-learned', name: tpl.name };
    if (tpl.type === SKILL_TYPES.BASE) return { kind: 'refused', reason: 'base', name: tpl.name };
    if (tpl.type === SKILL_TYPES.KNOWLEDGE) {
      return { kind: 'refused', reason: 'knowledge', name: tpl.name };
    }
    const wasEnabled = st.enabled;
    // `SkillBook.forget` 内部会先 `#detachSlot`（装配关系一并卸下）再 `recompute()`。
    this.skills.forget(tpl.id);
    return { kind: 'forgotten', id: tpl.id, name: tpl.name, wasEnabled };
  }

  /**
   * 把一门武功装配到某个槽（wushen `enable <基本技能> <技能>`）。
   *
   * ★ 这里判的都是**玩家会犯的错**（没学 / 装错槽 / 基本技能不可装）；
   *   非法槽名这类**调用方写错**仍然抛 `CharacterError` —— 那是 bug，不是提示。
   */
  public enableSkill(slot: EnableSlot, idOrName: string): EnableResult {
    if (!isEnableSlot(slot)) {
      throw new CharacterError(`enableSkill: 非法装配槽 ${JSON.stringify(slot)}`);
    }
    const tpl = this.skills.templateOf(idOrName);
    if (tpl === undefined) return { kind: 'refused', reason: 'unknown' };
    if (!this.skills.has(tpl.id)) return { kind: 'refused', reason: 'not-learned', name: tpl.name };
    if (!tpl.isEnablable) return { kind: 'refused', reason: 'not-enablable', name: tpl.name };
    if (!tpl.canEnables.includes(slot)) {
      return {
        kind: 'refused',
        reason: 'slot-mismatch',
        name: tpl.name,
        slot,
        allows: tpl.canEnables,
      };
    }
    const prev = this.skills.enabledOf(slot);
    if (!this.skills.enable(slot, tpl.id)) {
      return { kind: 'refused', reason: 'hook', name: tpl.name };
    }
    // ★ 报**显示名**而不是 id（`EnableDone.replaced` 的注释有理由）；
    //   重复装配同一个（`enable()` 内部是 no-op 并返回 true）不报"你换下了它自己"。
    const replaced =
      prev === undefined || prev === tpl.id ? null : (this.skills.templateOf(prev)?.name ?? prev);
    return { kind: 'enabled', id: tpl.id, name: tpl.name, slot, replaced };
  }

  /** 卸下某槽的武功。`false` = 那个槽本来就没装东西（不是错误） */
  public disableSkill(slot: EnableSlot): boolean {
    if (!isEnableSlot(slot)) {
      throw new CharacterError(`disableSkill: 非法装配槽 ${JSON.stringify(slot)}`);
    }
    return this.skills.disable(slot);
  }

  /**
   * 技能面板快照（`skills` 指令 → `dialog:skills` 帧）。
   *
   * ★ 一次取全（等级 / 进度 / 装配 / 上限），与 `attrView()` 同一条纪律：
   *   面板显示的值与练习真正用的上限必须是同一份读数。
   *   `progress` 走 `SkillBook.progressOf` —— 经验公式只有 `skill.ts` 一份。
   *
   * ★ 排序在这里定（服务端），前端只按 `kind` 过滤：两页各自的顺序一致，
   *   不会因为前端实现不同而看起来像两套数据。顺序：基础页在前 → 阶位高的在前 → 名字。
   */
  public skillView(): SkillsView {
    const items = [];
    for (const st of this.skills.entries()) {
      const tpl = this.skills.templateOf(st.id);
      // 存档里可能有已下线的技能；不认识的模板直接跳过（与 `contributedProps` 同款）
      if (tpl === undefined) continue;
      const entry = {
        id: tpl.id,
        name: tpl.name,
        kind:
          tpl.type === SKILL_TYPES.BASE
            ? 'base'
            : tpl.type === SKILL_TYPES.KNOWLEDGE
              ? 'knowledge'
              : 'skill',
        grade: tpl.grade,
        level: st.level,
        progress: this.skills.progressOf(tpl, st),
        enabled: st.enabled,
        canEnables: [...tpl.canEnables],
        // ★ 基本功占哪个槽：面板据此把「装配」按钮写成「装配基本剑法」
        //   （wushen `skills.js:item_click` 同款）。非基本功是 `null`。
        slot: tpl.slot,
        ...(tpl.learnCondition?.desc === undefined ? {} : { note: tpl.learnCondition.desc }),
      };
      items.push(entry);
    }
    const rank = (kind: string): number => (kind === 'base' ? 0 : 1);
    items.sort((a, b) => {
      if (a.kind !== b.kind) return rank(a.kind) - rank(b.kind);
      if (a.grade !== b.grade) return b.grade - a.grade;
      return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
    });
    return {
      title: items.length > 0 ? `你共学会 ${String(items.length)} 项技能` : '没有学会任何技能',
      limit: this.skillLimit(),
      pot: this.pot,
      items,
    };
  }

  /** 交给 `formula.ts` 的先天属性快照（含派生出来的 `forceRad`） */
  protected innateSnapshot(): InnateStats {
    return { ...this.#innate, forceRad: this.forceRad };
  }

  /**
   * 改先天属性。**改完自动 `recount()`** —— 不提供"只改不重算"的入口，
   * 于是"改了 `str` 却忘了重算攻击"这个 wushen 里反复出现的错
   * 在结构上无法发生。
   */
  public setInnate(patch: InnatePatch): void {
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) continue;
      if (!isInnateKey(key)) {
        throw new CharacterError(`setInnate: 未知的先天属性 ${JSON.stringify(key)}`);
      }
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new CharacterError(`setInnate: ${key} 必须是有限数值，收到 ${String(value)}`);
      }
      if (value < 0) {
        throw new CharacterError(`setInnate: ${key} 不能为负，收到 ${String(value)}`);
      }
      this.#innate[key] = value;
    }
    this.recount();
  }

  // ── 派生属性 ──────────────────────────────────────────────────────────────

  /** 派生战斗属性（只读快照；由 `recount()` 写入） */
  public get derived(): DerivedCombat {
    return this.#derived;
  }

  public get maxHp(): number {
    return this.#derived.maxHp;
  }

  public get hp(): number {
    return this.#hp;
  }

  public setHp(value: number): void {
    if (!Number.isFinite(value)) {
      throw new CharacterError(`setHp 需要有限数值，收到 ${String(value)}`);
    }
    this.#hp = Math.max(0, Math.min(Math.trunc(value), this.maxHp));
    // ★ 任何把气血抬回 >0 的写入都算"活过来了" ⇒ 清掉"已死"标记，
    //   使 `die()` 重新可用（复活 / 治疗路径）。维护不变式 `#dead ⇒ hp===0`，
    //   免得出现"复活了却再也死不了"这种要靠人记住的状态漂移。
    if (this.#hp > 0) this.#dead = false;
  }

  public get mp(): number {
    return this.#mp;
  }

  public setMp(value: number): void {
    if (!Number.isFinite(value)) {
      throw new CharacterError(`setMp 需要有限数值，收到 ${String(value)}`);
    }
    this.#mp = Math.max(0, Math.min(Math.trunc(value), this.maxMp));
  }

  public get isAlive(): boolean {
    return this.#hp > 0;
  }

  /** 重算派生属性。公式在 `formula.ts`，这里只负责"把结果装回去" */
  public recount(): void {
    this.#derived = computeDerived(this.innateSnapshot(), this.#holder);
    if (this.#hp > this.maxHp) this.#hp = this.maxHp;
  }

  /**
   * 承受伤害。返回**实际扣掉**的血量。
   *
   * 完整减伤链路（伤害减免% → 忽视防御% → 递减减伤）在 `formula.ts#computeDamage`，
   * 这里只负责"取我的派生值 → 调公式 → 装回去"。
   *
   * @param ignoreDefensePer 攻击方的**忽视防御%**（`DerivedCombat.ignoreDefensePer`）；缺省 0
   */
  public takeDamage(raw: number, ignoreDefensePer = 0): number {
    const dealt = computeDamage(
      raw,
      this.#derived.defense,
      this.#derived.damageReductionPer,
      ignoreDefensePer,
      // ★ 第 ⑤ 步的固定减伤（数据键 `diff_damage`，wushen 叫 `diff_sh`）。
      //   它是**核心表里的 prop**，不是派生值 ⇒ 这里直读，不进 `computeDerived`
      //   （wushen 同样是在 `damage()` 里 `query_prop("diff_sh")` 现取的）。
      getProp(this.#holder, 'diff_damage'),
    );
    const before = this.#hp;
    this.setHp(before - dealt);
    return before - this.#hp;
  }

  // ── 战斗 ─────────────────────────────────────────────────────────────────
  // 对照 wushen：`os/char/combat.js`（脚手架：开打 / 停手 / 选敌）、
  // `world/extends/char/auto_combat.js`（攻击循环 `auto_attack`）、
  // `world/extends/char/combat.js`（一次结算 `do_attack` / `end_attack`）。
  //
  // ★ 节拍由 `World.scheduler` 驱动（wushen 的 `this.call_out(...)`）：每出一招，
  //   按**当时的** `attackSpeed` 排下一拍 —— 所以是"回调里再排"，不是固定 `every`
  //   （攻速可能随状态变，固定周期读不到最新值）。
  // ★ 全部判定走 `formula.ts` 的纯函数（单源），这里只"取数 → 调公式 → 播报 → 落账"。
  // ★ 播报走 `sendRoom`（三视角）；受众是**房间里的玩家**（wushen `send_combat` 同）。

  /** 当前战斗类型（`FIGHT_TYPE`：0 不在战斗 / 1 切磋 / 2 击杀） */
  public get fightType(): number {
    return this.#fightType;
  }

  public get isFighting(): boolean {
    return this.#fightType !== FIGHT_TYPE.NONE;
  }

  /** 敌人列表（快照；诊断与测试用） */
  public get enemies(): readonly Character[] {
    return this.#enemies;
  }

  /** 现在时刻（读世界时钟；未注入时退回 `Date.now`） */
  #now(): number {
    return this.#scheduler?.now() ?? Date.now();
  }

  #isHere(other: Character): boolean {
    const env = this.environment;
    return env !== null && other.environment === env;
  }

  /**
   * 从敌人表里剔除"已经不该打的"（死了 / 离开本房间 / 已停战），返回**当前该打的那个**。
   * 对照 wushen `query_enemy`（`os/char/combat.js:123`）。
   */
  public queryEnemy(): Character | undefined {
    this.#enemies = this.#enemies.filter((e) => e.isAlive && this.#isHere(e) && e.isFighting);
    return this.#enemies[0];
  }

  /**
   * 开战（内容层入口，`fight` / `kill` 指令的落点）。见 `defs.ts` 的 `FightStart`。
   *
   * ★ **双向**：wushen `do_kill` 里 `this.begin_attack(target,2)` 之后紧跟
   *   `target.begin_attack(this,2)`（`os/char/combat.js:34-35`）—— 一次开战双方都进场。
   * ★ 切磋要求双方"状态好"（wushen `fight.js:21-26` 的两条血量门槛）—— 那两条在
   *   **这里**判，因为它们读的是角色内部血量，内容层看不到。
   */
  public beginFight(target: ActorObject, type: FightType): FightStart {
    if (!(target instanceof Character)) return { ok: false, reason: 'not-actor' };
    if (target === this) return { ok: false, reason: 'self' };
    if (!target.isAlive) return { ok: false, reason: 'dead' };
    if (this.#scheduler === undefined) {
      throw new CharacterError('beginFight 需要世界时钟：构造时未注入 scheduler');
    }
    if (type === FIGHT_TYPE.FIGHT) {
      if (this.hp < this.maxHp) return { ok: false, reason: 'self-wounded' };
      if (target.hp < target.maxHp * 0.95) return { ok: false, reason: 'target-wounded' };
    }
    if (this.isFighting) {
      return { ok: false, reason: this.#enemies.includes(target) ? 'self-fighting' : 'self-busy' };
    }
    // ★ "对方正在打"**只对切磋**是障碍（wushen `fight.js:33`）。
    //   `kill` 里没有这条判据（`kill.js` 允许趁人交手时下杀手）。
    if (target.isFighting && type === FIGHT_TYPE.FIGHT) {
      return { ok: false, reason: 'target-fighting' };
    }

    this.#startFight(target, type);
    target.#startFight(this, type);
    return { ok: true };
  }

  /**
   * **单向**进入战斗（wushen `begin_attack` 的主体，`os/char/combat.js:3`）。
   *
   * ★ `type` 只能**升**（1 切磋 → 2 击杀）；`type <= 当前` 时静默无操作（wushen 同）。
   * ★ 首次进入战斗才排第一拍，且**错开**一个 `rand*attackSpeed` 的延迟
   *   （wushen `call_out(auto_attack, Math.random()*gjsd)`）—— 否则两人互相 `kill`
   *   会同刻出招、永远同刻。
   */
  #startFight(target: Character, type: FightType): void {
    if (!this.#enemies.includes(target)) this.#enemies.push(target);
    if (type <= this.#fightType) return;
    const wasIdle = this.#fightType === FIGHT_TYPE.NONE;
    this.#fightType = type;
    if (wasIdle) {
      this.sendCombatPhase('start');
      this.#scheduleAttack(Math.trunc(this.#rand() * this.#derived.attackSpeed));
    }
  }

  /**
   * **尝试脱离战斗**（wushen `do_escape`，`os/char/chara_move.js:105-121`）。
   *
   * ★ 判据照抄：`random(躲闪 / 2) + 躲闪 > 对方命中`。
   *   wushen 的 `ds` / `mz` 就是本项目的 `derived.evasion` / `derived.hit`
   *   （`formula.ts` 的中性命名注释里写明同源）。
   * ★ 失败时加一段**忙乱**（wushen `add_status({id:'busy', duration:gjsd})`）：
   *   没有它，玩家可以在一个指令节拍里反复 `flee`，把概率判定变成"多点几次必成"。
   * ★ 成功时**立即停战**：`#attackTick` 的下一拍 `queryEnemy()` 会因此剔除自己
   *   —— 对方也会停手，不会出现"我脱战了但对方还在隔空打我"。
   */
  public escape(): EscapeResult {
    if (!this.isFighting) return { ok: false, reason: 'not-fighting' };

    const enemy = this.queryEnemy();
    // 敌人已经不在 / 已停战：直接收尾（wushen 同路径返回 true）
    if (enemy === undefined) {
      this.endFight();
      return { ok: true, dir: this.#randomExit() };
    }

    const dodge = this.#derived.evasion;
    const hit = enemy.#derived.hit;
    const escaped = this.#rand() * Math.trunc(dodge / 2) + dodge > hit;
    if (!escaped) {
      // ★ 与 wushen 一致：失败不是"白点一次"，而是**被缠住**一个出招节拍。
      this.addBusy(this.#derived.attackSpeed);
      return { ok: false, reason: 'blocked' };
    }

    this.endFight();
    return { ok: true, dir: this.#randomExit() };
  }

  /** 本房间的随机出口（无出口 / 不在房间里 ⇒ `null`） */
  #randomExit(): Direction | null {
    const env = this.environment;
    if (!(env instanceof Room)) return null;
    const dirs = [...env.exits.keys()];
    if (dirs.length === 0) return null;
    return dirs[Math.trunc(this.#rand() * dirs.length)] ?? null;
  }

  /** 停战（wushen `end_fight`，`os/char/combat.js:109`） */
  public endFight(): void {
    if (this.#attackHandle !== null) {
      this.#scheduler?.cancel(this.#attackHandle);
      this.#attackHandle = null;
    }
    this.#enemies.length = 0;
    if (this.#fightType !== FIGHT_TYPE.NONE) {
      this.#fightType = FIGHT_TYPE.NONE;
      this.sendCombatPhase('end');
    }
    // ★★ 结算顺序（26 册 §57）：`combat:end` 先发，挂着的击杀奖励**之后**才播报。
    //   原实现在 `FIGHT_TYPE.NONE` 时直接 `return`，于是这条路径上挂着的那笔
    //   奖励再没有出口（"打完没给经验"的一种，比顺序错更难发现）。
    this.#flushReward();
  }

  /** 排下一拍（先取消旧的，避免双句柄） */
  #scheduleAttack(delayMs: number): void {
    const scheduler = this.#scheduler;
    if (scheduler === undefined) return;
    if (this.#attackHandle !== null) scheduler.cancel(this.#attackHandle);
    this.#attackHandle = scheduler.schedule(delayMs, () => {
      this.#attackTick();
    });
  }

  /**
   * 一次出招（wushen `auto_attack` 的一轮，`world/extends/char/auto_combat.js:7`）。
   *
   * ★ 本批**未做**的 wushen 分支（都因输入还不存在）：`is_faint` 等待、
   *   `release_time` 绝招硬直、忙乱时的自动 PFM（`auto_pfm` / `check_pfms`）。
   *   忙乱那支做了（等忙完再打）—— 它是"不能动就别出招"的通用规则，不需要 PFM。
   */
  #attackTick(): void {
    this.#attackHandle = null;
    const target = this.queryEnemy();
    if (this.hp <= 0 || target === undefined) {
      this.endFight();
      return;
    }
    const now = this.#now();
    if (this.isBusy(now)) {
      this.#scheduleAttack(Math.max(1, this.busyRemainingMs(now)));
      return;
    }
    // ★★ 异常边界（2026-10-17 审查 **M3**）：`#doAttack` → `takeDamage` → `die()`
    //   → `afterDeath`（NPC 掉落 / 内容层 `on_die` 钩子）跑的是**外挂进来的代码**，
    //   抛错是可能发生的输入（例：`Npc` 声明了 `drops` 而世界没注入铸造器 ⇒ 刻意抛）。
    //
    //   不兜住的后果不是"这一拍失败"，而是**节拍永久停摆**：`#attackHandle`
    //   已在 tick 开头置空、续排又没执行 ⇒ 再也不出招；而 `#fightType` 仍是 KILL、
    //   `#enemies` 仍含已死目标、客户端收不到 `combat:end` —— 一边停战、一边永远
    //   卡在战斗中，且**没有任何报错指向真正的原因**（异常只进了调度器的 stderr）。
    //
    //   ⇒ 兜住后必须**明确二选一**：目标已死 ⇒ 收尾停战；否则照常续排。
    let keepGoing = false;
    try {
      this.#doAttack(target, now);
      keepGoing = this.#endAttack(target);
    } catch (error) {
      this.#reportFightError(error);
      keepGoing = target.isAlive && this.#fightType !== FIGHT_TYPE.NONE;
      // 目标没了 ⇒ 把战斗状态收干净（否则"战斗中的死人"会一直挂在敌人列表里）
      if (!keepGoing) this.endFight();
    }
    if (keepGoing) this.#scheduleAttack(this.#derived.attackSpeed);
  }

  /**
   * 战斗回调里冒出来的异常：**写 stderr，不 rethrow**。
   *
   * ★ 为什么不用 `throw`：这一层已经没有更上的调用方了（`Scheduler.step` 只会
   *   把它再吞一次），而节拍由下面的 `keepGoing` 明确决定 —— 责任的落点在
   *   "还要不要继续打"，不是"要不要崩"。
   */
  #reportFightError(error: unknown): void {
    let detail: string;
    try {
      detail = error instanceof Error ? (error.stack ?? error.message) : String(error);
    } catch {
      detail = '<无法序列化的错误>';
    }
    process.stderr.write(`[fight] ${this.name} 出招时抛出异常（战斗按目标状态决定停/续）：${detail}\n`);
  }

  /**
   * 结算一次攻击（wushen `do_attack` 的判定段，`world/extends/char/combat.js:27`）。
   * 返回**实际造成的伤害**。
   */
  #doAttack(target: Character, now: number): number {
    // 攻击动作先播（wushen 也是先 send_combat(attack_msg) 再判命中）
    this.sendRoom(pick(ATTACK_ACTIONS, this.#rand), target);

    const outcome = rollDefense(
      {
        hit: this.#derived.hit,
        evasion: target.derived.evasion,
        deflect: target.derived.deflect,
        defenderBusy: target.isBusy(now),
      },
      this.#rand,
    );
    if (outcome.dodged) {
      this.sendRoom(pick(DODGE_ACTIONS, this.#rand), target);
      return 0;
    }
    if (outcome.parried) {
      this.sendRoom(pick(PARRY_ACTIONS, this.#rand), target);
      return 0;
    }

    const isCrit = rollCrit(this.#derived.crit, this.#rand);
    let sh = this.#derived.attack;
    if (isCrit) sh = applyCritDamage(sh);
    const dealt = target.takeDamage(sh, this.#derived.ignoreDefensePer);
    this.sendRoom(damageMessage(dealt, target.hp, isCrit), target);
    // ★★ 状态句由**被打者**自己发出，不是攻击者（2026-10-20 真机反馈）。
    //   `queryStatusMessage` 说的是"**被打的人**现在什么状态"（`$N` 指被打者），
    //   而上面三句（攻击 / 躲闪 / 招架 / 伤害）的 `$N` 是**攻击者** ——
    //   两句主语不同，却共用一个发送者 ⇒ 必然有一句视角错位。
    //   写成 `this.sendRoom(...)` 时，`sendRoom` 把攻击者判成"本人视角"，
    //   `$N` 渲染成"你"，玩家屏幕上就是「**你**气喘嘘嘘」（打的是木人桩）。
    //   wushen 的写法同样是"谁的状态谁发"：
    //   `target.send_combat(query_status_msg(target.hp, target.max_hp))`
    //   （`world/extends/char/combat.js:146,155`）。
    //   换了发送者之后：打 NPC ⇒ 玩家是旁人 ⇒ 第三人称「木人桩气喘嘘嘘」；
    //   被打的是自己 ⇒ 本人视角「你气喘嘘嘘」。两条都由测试钉住。
    target.sendRoom(queryStatusMessage(target.hp, target.maxHp), target);
    return dealt;
  }

  /**
   * 出招之后的分流（wushen `end_attack`，`os/char/combat.js:138`）。
   * 返回 `true` = **继续打**（排下一拍）。
   */
  #endAttack(target: Character): boolean {
    if (this.#fightType === FIGHT_TYPE.NONE) return false;
    // 切磋：对方气血跌破 30% 自动收手
    const ratio = target.maxHp > 0 ? target.hp / target.maxHp : 0;
    if (this.#fightType === FIGHT_TYPE.FIGHT && ratio < 0.3) {
      if (target.hp <= 0) target.setHp(1);
      this.sendRoom(pick(WINNER_MESSAGES, this.#rand), target);
      target.endFight();
      this.endFight();
      return false;
    }
    // 击杀：打到对方 die
    if (target.hp <= 0 && target.die(this) !== false) {
      target.endFight();
      this.#enemies = this.#enemies.filter((e) => e !== target);
      if (this.#enemies.length === 0) {
        if (this.hp <= 0) this.setHp(1);
        this.endFight();
        return false;
      }
    }
    return true;
  }

  /**
   * 死亡（wushen `NPC.prototype.die` / `USER.prototype.die`）。
   * 返回 `false` = **没死**（`canDie` 钩子拦住了，气血被抬回 1）。
   *
   * ★ 共性收在这里（判钩子 → 归零 → 播报 → 停战 → `afterDeath`）；
   *   "死之后怎样"（NPC 消散 / 玩家发复活入口 / 掉落）由子类在 `afterDeath` 里做。
   *
   * ★★ 幂等判据是 `#dead`（**不是** `!isAlive`，26 册 §54）：调用方在调 `die()` 前
   *   已经把人打到 0 血，用 hp 判据会让收尾**永不执行**。见 `#dead` 字段的说明。
   */
  public die(killer?: Character): boolean {
    if (this.#dead) return true;
    if (!this.canDie(killer)) {
      this.setHp(1);
      return false;
    }
    this.setHp(0);
    this.#dead = true;
    this.sendRoom(pick(DIE_MESSAGES, this.#rand));
    this.endFight();
    this.afterDeath(killer);
    return true;
  }

  /**
   * 复活（气血归满、清忙乱 + 推 `die` 包族的 `relive:true` 帧）。
   * 返回 `false` = **本来就没死**（调用方据此说"你还没死呢"）。
   *
   * ★ 对照 wushen `world/cmd/battle/relive.js`，本批取**简化档**：
   *   原作有"去武庙复活（hp=1 + 换房间）"与"原地复活（消耗天师符，5 秒后满血）"两档，
   *   前者依赖 `recover_room`、后者依赖 `cash/tianshifu` 道具与 `call_out` 延时 ——
   *   这些前缀都不存在。本批让玩家**原地满血复活**（玩家死后本就留房间，见
   *   `Player.afterDeath`）：先让"死亡→复活"闭环成立，避免死一次就永久卡死
   *   （`die` 帧给了复活按钮，若没有这条指令，点下去只会得到"什么？"）。
   *   ⚠️ 于是本批**没有死亡惩罚**；武庙 / 天师符 / 掉经验属后续批次。
   *
   * ★ `setHp(maxHp)` 顺带把 `#dead` 标记清掉（见 `setHp` 的不变式），
   *   于是复活后能再次被打死 —— 不需要额外的复位步骤。
   */
  public revive(): boolean {
    if (this.isAlive) return false;
    this.setHp(this.maxHp);
    this.clearBusy();
    this.#output.revive();
    return true;
  }

  /**
   * 能不能死（子类覆写；`false` = 拦下这次死亡）。基类默认允许。
   * ★ wushen 里对应 `on_die(killer) == false` 那一句（`os/char/npc.js:124`）。
   */
  protected canDie(_killer?: Character): boolean {
    return true;
  }

  /** 死了之后的收尾（子类覆写：NPC 消散、玩家发复活入口、掉落…） */
  protected afterDeath(_killer?: Character): void {
    // 基类无收尾
  }

  /** 发一个 `combat` 帧（受保护：子类不必碰输出通道的细节） */
  protected sendCombatPhase(phase: 'start' | 'end'): void {
    this.#output.combat(phase);
  }

  /** 发一个 `die` 帧（带复活入口）；受保护，同上 */
  protected sendDieFrame(commands: readonly CommandButton[]): void {
    this.#output.die(commands);
  }

  /**
   * 随机源（受保护）。让子类（`Npc` 的掉落 roll）与战斗判定**共用同一个**源
   * —— 构造时注入的那一个（`init.rand ?? Math.random`），而不是各自再取一个
   * `Math.random`（那会让"同一实例内两次 roll 的随机性对不上号"）。
   */
  protected get rand(): () => number {
    return this.#rand;
  }

  // ── 忙碌（`busy`）────────────────────────────────────────────────────────
  // wushen 用 `busy` 做指令门禁（08 册 §8.2.4）。这里用带 TTL 的 TempStore 实现，
  // 于是**不需要任何清理代码**：到点自然失效，读路径顺手删除。
  // ★ 订正（S11，2026-10-16 审查）：原注释写"`pruneTemp` 顺手回收"是**假的** ——
  //   `pruneTemp` 当时全仓零调用点（项目还没有周期性的心跳调度器）。
  //   真正在清理的是 `TempStore.ttlRemainingMs()` 的"到点即删"（它也是本类
  //   `busyRemainingMs()` / `isBusy()` 的唯一读路径）。
  // `TTL` 也因此有了真实消费者（此前它只是"存了不用"的装饰）。
  // ★ 写入口两档（E5，2026-10-16 拍板）：`setBusy` = **赋值**、`addBusy` = **叠加**，
  //   两条路共用一个硬上界 `BUSY_MAX_MS`（15s）。**别把 busy 当长时状态用** ——
  //   需要"更久不能动"的内容走 `state`；`busy` 只管短时动作锁。
  // ★ 别与**属性** `busy` 混淆：`props.ts` 里的 `'busy'` 是 wushen 的"忙乱时间"
  //   （技能侧加成，影响"该忙多久"），这里的 `BUSY_KEY` 是**当前剩余的忙乱锁**。

  /**
   * **赋值**：把忙乱剩余时间**设为** `ms`（超出 `BUSY_MAX_MS` 则钳到上限）。
   *
   * ★ 与 wushen 对齐（E5，2026-10-16 拍板）：原作就是赋值 ——
   *   `os/char/chara_skill.js:367` `this.is_busy = buff.duration`、`:382` `= 0`；
   *   `world/map/wudao/ta.js:98` `me.is_busy = 1000`。
   *   旧实现是"在剩余时间上叠加"，症状是**重复触发无限延长**：一个每帧都重新赋
   *   `duration` 的定身 buff，在本项目会一次比一次久（直到撞上 15s 上界），而原作
   *   每次都回到 `duration`。⇒ "重设"用 `setBusy`、"延长"用 `addBusy`，语义写在调用点上。
   *
   * ★ 谁该调它（**当前无生产调用点**，等 Skill / 状态系统落地）：
   *   ① 技能 / 逃跑的忙乱 buff —— 对应 wushen `add_status({is_busy:true, duration})`；
   *   ② 地图 / 事件脚本里的定身 —— 对应 wushen `world/map/wudao/ta.js:98` 那种直接赋值。
   *   ②那种"上一条还没完又触发一次"的场景，若语义是**延长**而不是**重设**，请用 `addBusy`。
   */
  /**
   * ★ 时间源（2026-10-17 审查 **L1**）：这四个入口的缺省时间原本是 `Date.now()`，
   *   而战斗节拍读的是 `this.#now()`（= `world.scheduler.now()`）——
   *   **同一个概念有两个时间源**。生产里两者恰好都是真实时钟才没出事；一旦注入时钟
   *   （测试用 `makeClock`、将来的回放/存档续跑），`setBusy(10_000)` 写进去的
   *   过期时刻是真实时间戳 `~1.7e12`，而 `isBusy(schedulerNow)` 拿 `0` 去比
   *   ⇒ `rec.e <= nowMs` 恒假 ⇒ **忙乱永不结束**。
   *
   *   ⇒ 缺省一律走 `this.#now()`：有调度器就用世界的时钟，没有才退回 `Date.now()`。
   */
  public setBusy(ms: number, nowMs: number = this.#now()): void {
    this.#assertBusyMs(ms, 'setBusy');
    this.#armBusy(ms, nowMs);
  }

  /**
   * **叠加**：在当前**剩余**忙乱之上再加 `ms`（总时长同样受 `BUSY_MAX_MS` 钳制）。
   *
   * ★ 没在忙时等价于 `setBusy(ms)` —— "剩余为 0"是正常起点，不是错误。
   * ★ 与 `setBusy` 的分工：`setBusy` = 从**现在**重新计时；`addBusy` = 在**已有剩余**上延长。
   */
  public addBusy(ms: number, nowMs: number = this.#now()): void {
    this.#assertBusyMs(ms, 'addBusy');
    this.#armBusy(this.busyRemainingMs(nowMs) + ms, nowMs);
  }

  /**
   * 忙乱时长校验 —— **先于任何写入**，非法输入绝不污染既有状态。
   *
   * 两个边界分两档（不是一个）：
   *   - **非法**：非有限（`NaN` / `Infinity`）或 ≤0 ⇒ **抛**。这些不是"多久"，是编程错误。
   *     （想解除忙乱用 `clearBusy()`；`0` 不是"忙 0 秒"。）
   *   - **过大**：有限但 > `BUSY_MAX_MS` ⇒ 在 `#armBusy` 里**钳到上限**，不抛。
   *     忙乱时长常由内容/公式算出（如 `buff.duration`），超大值应当被限制住，
   *     而不是让整条技能执行崩掉。
   */
  #assertBusyMs(ms: number, op: string): void {
    if (!Number.isFinite(ms) || ms <= 0) {
      throw new CharacterError(`${op} 需要正的有限毫秒数，收到 ${String(ms)}`);
    }
  }

  /**
   * 忙乱的**唯一写入口** —— `Math.min(…, BUSY_MAX_MS)` 只在这里出现一次，
   * `setBusy` / `addBusy` 两条路因此不可能各自漏掉上界。
   */
  #armBusy(total: number, nowMs: number): void {
    this.temp.setTemp(BUSY_KEY, true, Math.min(total, BUSY_MAX_MS), nowMs);
  }

  /**
   * ★ 判据复用 `busyRemainingMs()`，**不自己去读 `ttlRemainingMs`**（2026-10-16 审查 S4）：
   *   自己读的那版是 `ttlRemainingMs(...) > 0`，而 `busyRemainingMs()` 把非有限值钳成 0 ——
   *   于是同一条"永不过期"的 busy 记录会同时得到
   *   `isBusy() === true`（`Infinity > 0`）与 `busyRemainingMs() === 0`。
   *   表现是面板显示"还需 0 毫秒"、而指令闸门永远拦着，两边都不报错。
   *
   *   ⇒ 同一个概念只许有一个答案。取 `busyRemainingMs()` 那一版还顺带定下了
   *     "永不过期的 busy 视为**无效**"（僵直总有尽头，没有尽头的那个是脏数据）。
   */
  public isBusy(nowMs: number = this.#now()): boolean {
    return this.busyRemainingMs(nowMs) > 0;
  }

  public busyRemainingMs(nowMs: number = this.#now()): number {
    const left = this.temp.ttlRemainingMs(BUSY_KEY, nowMs);
    return Number.isFinite(left) ? left : 0;
  }

  public clearBusy(): void {
    this.temp.removeTemp(BUSY_KEY);
  }

  // ── 存档边界 ──────────────────────────────────────────────────────────────

  public snapshotProps(): PropSnapshot {
    return snapshotProps(this.#holder);
  }

  public loadProps(raw: unknown): LoadReport {
    const report = loadProps(this.#holder, raw);
    this.recount();
    return report;
  }
}

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
import type { Channel, Direction, Gender, MoveResult } from '@shared/constants.js';
import { isEnableSlot } from '@shared/constants.js';
import { Container } from './base.js';
import type { ObjKind } from './base.js';
import { Room } from './room.js';
import { TempStore } from './temp.js';
// `import type` 会被完全擦除，所以引擎 ↔ 内容层的类型引用不产生运行时环。
import type { ItemDetailView } from '../world/defs.js';import {
  COMBAT_FORMULA,
  computeAttrBreakdowns,
  computeDerived,
  damageAfterDefense,
  effectiveAttr,
} from './formula.js';
import type { AttrBreakdown, DerivedCombat, InnateStats } from './formula.js';
import { applyPropMap, createPropHolder, loadProps, snapshotProps } from './props.js';
import type { LoadReport } from './load-report.js';
import type { PropHolder, PropSnapshot, RawPropMap } from './props.js';
import { SkillBook, emptySkillRegistry } from './skill.js';
import type { SkillRegistry } from './skill.js';
import { VIEW_OTHER, VIEW_SELF, VIEW_TARGET, renderViewText } from './view-text.js';
import type { ViewSubject } from './view-text.js';

export class CharacterError extends Error {
  public override readonly name = 'CharacterError';
}

/** 角色的输出通道。玩家挂真实连接，NPC / 测试用内存实现 */
export interface CharacterOutput {
  notify(text: string): void;
  sendCommands(...cmdNamePairs: string[]): void;
  /** 频道播报（见 `defs.ts` 的 `Actor.sendChannel`）。受众由会话层裁决 */
  sendChannel(ch: Channel, content: string, to?: string): void;
  /** 对象详情（见 `defs.ts` 的 `Actor.showItem` / `ItemDetailView`） */
  showItem(detail: ItemDetailView): void;
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

  public notify(text: string): void {
    pushCapped(this.messages, text);
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

  public clear(): void {
    this.messages.length = 0;
    this.commands.length = 0;
    this.channelMessages.length = 0;
    this.items.length = 0;
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

  public per: number;
  public age: number;
  /** 性别三档（`Gender`，来源 `shared/constants.ts`）：1 男 / 2 女 / 0 无性 */
  public gender: Gender;
  public money: number;
  public exp: number;
  public pot: number;
  public level: number;
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
    this.level = 0;

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
   * 同时接受技能 id 与槽名 —— 对应 wushen `query_skill(name)`（两者在 wushen 里同名前缀）。
   */
  public skillLevel(idOrSlot: string): number {
    return isEnableSlot(idOrSlot)
      ? this.skills.levelOfSlot(idOrSlot)
      : this.skills.levelOf(idOrSlot);
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
   * 减伤公式（递减）在 `formula.ts`，这里不做算术。
   */
  public takeDamage(raw: number): number {
    const after = damageAfterDefense(raw, this.#derived.defense);
    const before = this.#hp;
    this.setHp(before - after);
    return before - this.#hp;
  }

  // ── 忙碌（`busy`）────────────────────────────────────────────────────────
  // wushen 用 `busy` 做指令门禁（08 册 §8.2.4）。这里用带 TTL 的 TempStore 实现，
  // 于是**不需要任何清理代码**：到点自然失效，`pruneTemp` 顺手回收。
  // `TTL` 也因此有了真实消费者（此前它只是"存了不用"的装饰）。

  public setBusy(ms: number, nowMs: number = Date.now()): void {
    if (!Number.isFinite(ms) || ms <= 0) {
      throw new CharacterError(`setBusy 需要正的毫秒数，收到 ${String(ms)}`);
    }
    // 已在忙 → 在剩余时间上**叠加**（对应"被又打了一下，僵直更长"）
    const remaining = this.busyRemainingMs(nowMs);
    this.temp.setTemp(BUSY_KEY, true, remaining + ms, nowMs);
  }

  public isBusy(nowMs: number = Date.now()): boolean {
    return this.temp.ttlRemainingMs(BUSY_KEY, nowMs) > 0;
  }

  public busyRemainingMs(nowMs: number = Date.now()): number {
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

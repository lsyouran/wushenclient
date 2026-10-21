/**
 * shared/protocol.ts — 前后端协议的单一事实源
 * ============================================================================
 * 本文件同时是：① TypeScript 类型定义 ② zod 运行期校验 schema
 * 两端（server / src）**只能**从这里引入协议类型，禁止各写一份。
 * （wushen 的反面教材：`.id/.name` 与 `.ID/.Name` 两套字段名并存，
 *   跨服路径必然取到 undefined —— 21 册 #13。）
 *
 * 与 wushen 的三处关键差异：
 *   1. 全部走 `JSON.stringify`，**不存在**手工拼字符串 / 无引号 key；
 *   2. 每个包带 `v` 版本号，用于客户端协商与灰度；
 *   3. `items` 数组末尾的 `0` 哨兵（room.js:139）**取消**。
 */

import { z } from 'zod';
import { ERROR_CODES } from './error-codes.js';
import type { ErrorCode } from './error-codes.js';
import type { Channel, DialogName, Direction } from './constants.js';
import {
  CHANNELS,
  DIALOG_NAMES,
  DIRECTIONS,
  LOOKS_LIKE_JSON_RE,
  MAX_MESSAGE_BYTES,
  MAX_PLAINTEXT_CHARS,
  PROTOCOL_VERSION,
} from './constants.js';
import { ID_MAX_LENGTH, parseWorldId } from './ids.js';
import type { WorldId } from './ids.js';

export { PROTOCOL_VERSION };

// ===========================================================================
// 1. 错误码（替代 wushen 把裸中文字符串直接当结果用的做法）
// ===========================================================================

/**
 * ★ 错误码表本体在 `shared/error-codes.ts`（**零依赖**，浏览器可直接 import）。
 *   这里 re-export 是为了不 breaking 现有导入点；本文件仍然依赖 zod，
 *   前端**不要** import 本文件的运行期值。
 */
export { ERROR_CODES, errorTextOf, UNKNOWN_ERROR_TEXT } from './error-codes.js';
export type { ErrorCode } from './error-codes.js';

export const ErrorCodeSchema = z.enum(
  Object.keys(ERROR_CODES) as [ErrorCode, ...ErrorCode[]],
);

// ===========================================================================
// 2. 信封（所有 JSON 包共有）
// ===========================================================================
//
// ★ docs/26 M7：`v` 曾经只校验 `int 1..9999`，**从不与 PROTOCOL_VERSION 比对**，
//   于是 `ERROR_CODES.PROTOCOL_MISMATCH` 成了不可达代码。现在分两层：
//
//   ① `LooseEnvelopeSchema` —— 只判"这到底是不是一个信封"（与版本无关），
//      用于把「不是包」和「版本不对」两个错误分开诊断；
//   ② `EnvelopeSchema` —— 在 ① 之上把 `v` 钉死为 `z.literal(PROTOCOL_VERSION)`。
//
// ★ `.strip()`（原为 `.passthrough()`）：未知字段一律丢弃。
//   实测当前 zod 版本下 passthrough 不构成原型注入，但那是**实现细节不是契约**；
//   而保留未知字段会让"字段注入面"无谓扩大、且没有任何收益。

/** 结构层信封：只要求「是一个带 v/type 的对象」，不判版本 */
export const LooseEnvelopeSchema = z
  .object({
    v: z.number().int(),
    type: z.string().min(1).max(64),
  })
  .strip();

/** 入站信封：版本必须**精确等于** PROTOCOL_VERSION。未知字段丢弃。 */
export const EnvelopeSchema = z
  .object({
    v: z.literal(PROTOCOL_VERSION),
    type: z.string().min(1).max(64),
  })
  .strip();

export interface Envelope {
  readonly v: number;
  readonly type: string;
}

/** 所有服务端 → 客户端包 */
export interface PacketBase extends Envelope {
  readonly type: string;
}

export type EnvelopeCheck =
  | { readonly ok: true; readonly v: number; readonly type: string }
  | { readonly ok: false; readonly code: ErrorCode; readonly detail: string };

/**
 * 入站信封检查（协议边界第一步）。
 *
 * 分两步走，是为了让**两个不同的失败可区分**：
 *   - 结构不成包      → `BAD_PACKET`
 *   - 结构对但版本不符 → `PROTOCOL_MISMATCH`（可据此提示客户端升级）
 *
 * 只做 ① 不做 ② 时，版本不符会掉进 ③ 被报成笼统的 BAD_PACKET ——
 * 那样 `PROTOCOL_MISMATCH` 依然是不可达代码。
 */
export function checkEnvelope(raw: unknown): EnvelopeCheck {
  const loose = LooseEnvelopeSchema.safeParse(raw);
  if (!loose.success) {
    return { ok: false, code: 'BAD_PACKET', detail: '信封结构不合法（缺 v/type 或类型错误）' };
  }
  if (loose.data.v !== PROTOCOL_VERSION) {
    return {
      ok: false,
      code: 'PROTOCOL_MISMATCH',
      detail: `客户端协议版本 ${String(loose.data.v)} ≠ 服务端 ${String(PROTOCOL_VERSION)}`,
    };
  }
  const strict = EnvelopeSchema.safeParse(raw);
  if (!strict.success) {
    return { ok: false, code: 'BAD_PACKET', detail: '信封字段不合法' };
  }
  return { ok: true, v: strict.data.v, type: strict.data.type };
}

// ===========================================================================
// 3. 公共结构
// ===========================================================================

export interface CmdItem {
  readonly cmd: string;
  readonly name: string;
}

/** 房间物件列表项（`items` / `itemadd` 共用） */
export interface ItemBrief {
  readonly id: string;
  readonly name: string;
  readonly p?: 1; // 玩家
  readonly m?: 1; // NPC 可查技能 / 师父
  readonly l?: 1; // NPC 有商店
  readonly f?: 1; // NPC 有 master
  readonly o?: 1; // 倒地 / 尸体
  readonly hp?: number;
  readonly max_hp?: number;
  readonly mp?: number;
  readonly max_mp?: number;
}

// ===========================================================================
// 4. 服务端 → 客户端：包类型定义（对照 05/06 册速查表逐条建模）
// ===========================================================================

// ---- 4.1 连接与登录（05 册 5.1）----

export interface RoleBrief {
  readonly id: string;
  readonly name: string;
  readonly title: string;
}

export interface RolesPacket extends PacketBase {
  readonly type: 'roles';
  readonly roles: readonly RoleBrief[];
}

export interface LoginPacket extends PacketBase {
  readonly type: 'login';
  readonly id: string;
  readonly level: number;
  readonly setting?: Readonly<Record<string, unknown>>;
}

export interface LoginErrorPacket extends PacketBase {
  readonly type: 'loginerror';
  readonly code: ErrorCode;
  readonly msg: string;
}

export interface RegistPacket extends PacketBase {
  readonly type: 'regist';
  readonly ok: boolean;
  readonly code?: ErrorCode;
  readonly result: string;
}

export interface DeleteRolePacket extends PacketBase {
  readonly type: 'deleterole';
  readonly roleid: string;
}

export interface CrossPacket extends PacketBase {
  readonly type: 'cross';
  readonly sid: number;
  readonly pid: string;
  readonly cross_type: string;
}

export interface LevelUpPacket extends PacketBase {
  readonly type: 'levelup';
  readonly level: number;
}

// ---- 4.2 房间与场景（05 册 5.2 / 5.3）----

export interface RoomPacket extends PacketBase {
  readonly type: 'room';
  readonly path: WorldId;
  readonly name: string;
  readonly desc: string;
  readonly commands: readonly CmdItem[];
}

export interface ExitsPacket extends PacketBase {
  readonly type: 'exits';
  /** 方向 → 目标房间**显示名**（不是 path） */
  readonly items: Readonly<Record<string, string>>;
}

export interface ItemsPacket extends PacketBase {
  readonly type: 'items';
  readonly items: readonly ItemBrief[];
}

export interface ItemAddPacket extends PacketBase, ItemBrief {
  readonly type: 'itemadd';
}

export interface ItemRemovePacket extends PacketBase {
  readonly type: 'itemremove';
  readonly id: string;
}

export interface ItemDetailPacket extends PacketBase {
  readonly type: 'item';
  readonly id: string;
  readonly name: string;
  readonly desc: string;
  readonly commands: readonly CmdItem[];
}

export interface ActionsPacket extends PacketBase {
  readonly type: 'actions';
  readonly items: readonly CmdItem[];
}

export interface ActionChangePacket extends PacketBase {
  readonly type: 'addAction' | 'removeAction';
  readonly id?: string;
  readonly items?: readonly CmdItem[];
}

export interface CmdsPacket extends PacketBase {
  readonly type: 'cmds';
  readonly items: readonly CmdItem[];
}

// ---- 4.3 地图 ----

export interface MapRoom {
  /** 显示名 */
  readonly n: string;
  /** 房间 id（= world path） */
  readonly id: WorldId;
  /** 坐标 [x, y] */
  readonly p: readonly [number, number];
  /** 出口编码串，正则 /^([a-z]{1,2})(\d)?([d|l])?$/ */
  readonly exits: readonly string[];
}

export interface MapPacket extends PacketBase {
  readonly type: 'map';
  readonly path: string;
  readonly map: readonly MapRoom[];
}

export interface UpdateMapPacket extends PacketBase {
  readonly type: 'updatemap';
  readonly map: string;
  readonly id: WorldId;
  readonly n: string;
  readonly pos: readonly [number, number];
}

// ---- 4.4 系统交互（05 册 5.4）----

export interface WarnPacket extends PacketBase {
  readonly type: 'warn';
  readonly content: string;
  readonly time?: number;
  readonly cmds: readonly CmdItem[];
  /**
   * **这段文本属于哪块面板**（`item` 帧的 `id`）；缺省 = 进消息流。
   *
   * ★★ 为什么必须有这个字段（2026-10-21 §80）：在这之前 `warn` 只有一根
   *   `content` 字符串，前端根本不知道"这句话属于谁"，于是拿三个**间接信号**
   *   去猜落点 —— 命令从哪来（`issuing`）、是否在战斗中（`state.fighting`）、
   *   面板是否开着并吸收（`absorb`）。
   *   启发式必然有漏，于是同一个病在 §57 / §74 / §78 三次真机反馈里各发作一次：
   *   点店小二后操作层层叠进日志区、请教三次面板堆成三屏、
   *   和木人切磋战报却写进「木人桩」的操作框。
   *   ⇒ 把归属**声明**出来，前端只做"有就按名字投递、没有就进消息流"这一件事。
   *
   * ★ 为什么是**可选**而不是必填：绝大多数文本（房间播报、战斗战报、指令回显）
   *   本来就不属于任何面板。可选字段让"安全默认"成立 ——
   *   **不声明就不进面板**，写漏了会掉进消息流（可接受），不会掉进某块面板（不可接受）。
   */
  readonly context?: string;
}

export interface SettingPacket extends PacketBase {
  readonly type: 'setting';
  readonly items: Readonly<Record<string, unknown>>;
}

export interface PayPacket extends PacketBase {
  readonly type: 'pay';
  /** 支付二维码内容或跳转 URL */
  readonly url: string;
  /** 商户订单号（幂等键） */
  readonly order_id: string;
}

export interface EmotePacket extends PacketBase {
  readonly type: 'emote';
  readonly items: readonly string[];
}

// ---- 4.5 战斗 / 技能 / 状态（06 册 6.1 / 6.2）----

export interface CombatPacket extends PacketBase {
  readonly type: 'combat';
  readonly start?: 1;
  readonly end?: 1;
}

export interface ScPacket extends PacketBase {
  readonly type: 'sc';
  readonly id: string;
  readonly hp?: number;
  readonly max_hp?: number;
  readonly mp?: number;
  readonly max_mp?: number;
  /** 该玩家累计造成的伤害（接收方开启 show_damage 时） */
  readonly damage?: number;
}

/** 状态动作。★ 类型由常量派生（而非各写一份），运行期校验直接用同一个常量。 */
export const STATUS_ACTIONS = ['add', 'remove', 'refresh', 'override', 'clear'] as const;
export type StatusAction = (typeof STATUS_ACTIONS)[number];

export interface StatusPacket extends PacketBase {
  readonly type: 'status';
  readonly id: string;
  readonly action: StatusAction;
  readonly sid?: readonly string[];
  readonly name?: string;
  readonly duration?: number;
  readonly count?: number;
}

export interface DiePacket extends PacketBase {
  readonly type: 'die';
  readonly relive?: true;
  readonly commands?: readonly CmdItem[];
}

export interface StatePacket extends PacketBase {
  readonly type: 'state';
  readonly state: string;
  readonly desc: string;
}

export interface PerformPacket extends PacketBase {
  readonly type: 'perform';
  readonly items: readonly CmdItem[];
}

export interface CooldownPacket extends PacketBase {
  readonly type: 'dispfm' | 'disobj' | 'changepfm' | 'clearDistime';
  /** `all` 表示整组；clearDistime 无参数时省略 */
  readonly id?: string;
  /** 冷却毫秒（dispfm / disobj / changepfm） */
  readonly rtime?: number;
  readonly time?: number;
  readonly count?: number;
}

// ---- 4.6 社交 / 通用容器（06 册 6.4 / 6.5）----

export interface MsgPacket extends PacketBase {
  readonly type: 'msg';
  readonly ch: Channel;
  readonly content: string;
  readonly uid?: number;
  readonly name?: string;
  readonly fam?: string;
  readonly lv?: number;
}

/** 通用面板控制字段 */
export interface DialogControl {
  readonly close?: true;
  readonly refresh?: number;
  readonly clear?: true | string;
  readonly remove?: string;
}

/**
 * `dialog` 通用容器（★ wushen 最好的设计，保留但加类型）。
 * 已知面板见 `DialogName`；带强类型载荷的面板在此逐一定义，
 * 其余先落到 open 形态，后续按『最小交付单元』补齐。
 */
export interface DialogPacket extends PacketBase, DialogControl {
  readonly type: 'dialog';
  readonly dialog: DialogName;
  readonly [k: string]: unknown;
}

// ---------------------------------------------------------------------------
// 4.6b `dialog:score` 的载荷（属性面板）
// ---------------------------------------------------------------------------

/**
 * **属性面板**的数据快照（`score` 指令 → `dialog:score` 帧）。
 *
 * 对照 wushen `world/cmd/dialog/score.js`：它把一整个结构化对象发下去，
 * 面板模板里每个 `data-prop="str"` 逐格填值。本项目走同一条路 ——
 * 服务端不拼显示串，前端不必从文本里猜哪个数是臂力。
 *
 * ★ 形状住在 `shared/` 而不是 `server/world/defs.ts`：它**是线上载荷**，
 *   前端 `src/ui/attr.ts` 要照着渲染，而 `tsconfig.web.json` 只 include
 *   `shared/**` 与 `src/**`（前端 import 不到 `server/`）。
 *   内容层的 `defs.ts` 只是把名字转出去（`export type { AttrView }`）。
 *
 * ★★ 只放**真的有值**的字段（26 册 L8 的病：声明未实现）。与 wushen 的差别
 *   逐条登记在这里，免得下一批当成"漏了"：
 *     - **不发** `age` / `jingli` / `limit_mp` / `gongji`：引擎里没有这些概念
 *       （年龄未落地、精力与内力上限属后续批次、功绩要门派）。
 *     - **不发** `family` / `master`：门派 / 师徒系统未落地。填「无门无派」
 *       是假数据 —— 玩家会以为功能坏了，那比少一行更伤。
 *     - **不发** `per`（容貌）：`INNATE_KEYS` 里没有它，`computeDerived` 也没读。
 *     - **不发** `gjsd`：`DerivedCombat.attackSpeed` 是**毫秒间隔**而非 wushen 面板上
 *       那个"数值越大越快"的分值，直接摆上去会被读反（越小越快 ≠ 越大越好）。
 *     - **多发** `skillLimit`：本项目独有（26 册 §56 的成长闭环），
 *       wushen 面板里没有这一格，但没有它玩家不知道经验有什么用。
 */
export interface AttrView {
  readonly name: string;
  /** 性别三档（`Gender`：1 男 / 2 女 / 0 无性） */
  readonly gender: number;
  /** 境界（`Character.realm`，0–6）—— 由内功 / 轻功 / 招架三槽等级派生的，不是存下来的字段 */
  readonly level: number;
  /** 境界名（`REALM_NAMES[level]`，如「登堂入室」）—— 面板直接显示这个词，不再自己查表 */
  readonly realmName: string;
  readonly exp: number;
  readonly pot: number;
  readonly hp: number;
  readonly maxHp: number;
  readonly mp: number;
  readonly maxMp: number;
  /** 四维三档（`ATTR_KEYS` 顺序，口径见 `formula.ts#computeAttrBreakdowns`） */
  readonly attrs: readonly AttrValueView[];
  /** 战斗派生值（`formula.ts#computeDerived` 的快照，与真实出招读同一份） */
  readonly combat: AttrCombatView;
  /** 技能等级上限（`SkillActor.skillLimit()`；NPC 为 `Infinity`） */
  readonly skillLimit: number;
}

/**
 * 单维的三档读数（`AttrBreakdown` 的**协议侧**形状）。
 * ★ `key` 是 `string` 而不是引擎的 `AttrKey`：协议边界不认引擎内部类型
 *   （`shared/` 不依赖 `server/engine/`）。两者靠 `Character.attrView()`
 *   的返回类型对齐 —— 引擎那边多一维、这边少一维，`tsc` 当场报错。
 */
export interface AttrValueView {
  readonly key: string;
  readonly innate: number;
  readonly bonus: number;
  readonly total: number;
}

/** `AttrView.combat` 的那几格（键名与 `DerivedCombat` 一致，值的含义也一致） */
export interface AttrCombatView {
  readonly attack: number;
  readonly defense: number;
  readonly hit: number;
  readonly evasion: number;
  readonly deflect: number;
  readonly crit: number;
}

// ---------------------------------------------------------------------------
// 4.6c `dialog:skills` 的载荷（技能面板）
// ---------------------------------------------------------------------------

/**
 * **技能面板**的数据快照（`skills` / `cha` 指令 → `dialog:skills` 帧）。
 *
 * 对照 wushen `world/cmd/dialog/cha.js`：它把 `{items, title, limit, pot, sk_group}`
 * 拼成 JSON 发下去，前端 `dialog/skills.js` 逐项渲染。
 * 本项目照这条分工：**服务端给数据，面板不拼公式**。
 *
 * ★ 与 `AttrView` 同一取向（形状住 `shared/`）：前端 `src/ui/skills.ts` 要照着渲染，
 *   而 `tsconfig.web.json` 只 include `shared/**` 与 `src/**`。
 *
 * ★★ `progress` **必须服务端算**：`levelExp(lv, grade)` 在 `server/engine/skill.ts`，
 *   前端自己算就是第二份经验公式（26 册铁律"单源真相"）。wushen 也是在服务端算
 *   （`os/skill/skill.js:305` 的 `exp * 100 / level_exp(...)`）。
 *
 * ★ 不发的字段（不是漏了）：
 *   - **`sk_group`**：wushen 的"技能分组显示（1/2/3 组）"是个纯前端的收纳开关，
 *     我们还没有分组概念；发一个恒 0 的字段会让前端以为能用。
 *   - **`title` 里的"共学会 N 项"**：句子由服务端拼（`title`），前端不数 `items.length`
 *     —— 数出来的是"本页有几条"，不是"学会了几个"（知识类可能不摆）。
 */
export interface SkillsView {
  /** 面板标题的第二段（`你共学会 3 项技能` / `没有学会任何技能`） */
  readonly title: string;
  /** 技能等级上限（`skillLimit()`，与 `AttrView.skillLimit` 同源同一个数） */
  readonly limit: number;
  /** 潜能（面板底部显示，省一次 `score`） */
  readonly pot: number;
  readonly items: readonly SkillEntryView[];
}

/**
 * 技能面板里的一行。
 *
 * ★ `kind` 决定页签（`'base'` = 基础页，其余 = 特殊页），来自**模板** `type`
 *   —— 不是 `canEnables` 是否为空（wushen 的判据，见 27 册 §14.3 裁定 1）。
 */
export interface SkillEntryView {
  /** 技能 id（`wd/taijijian`）—— 动作按钮拼命令时用的就是它 */
  readonly id: string;
  readonly name: string;
  /** `'base' | 'skill' | 'knowledge'` */
  readonly kind: string;
  readonly grade: number;
  readonly level: number;
  /** 到下一级的百分比（0–100，已截断） */
  readonly progress: number;
  /** 被装配到的槽；null = 只学会、未装配 */
  readonly enabled: string | null;
  /** 可装配到的槽（`can_enables`）；空数组 = 基本功 / 知识类 */
  readonly canEnables: readonly string[];
  /**
   * **基本功**占据的槽（`SkillTemplate.slot`）；非基本功为 `null`。
   *
   * ★ 面板为什么要它（26 册 §64.10）：wushen 的装配按钮长这样 ——
   *   `装备<基本技能名>`，比如「装备基本剑法」。要拼出那个名字，前端得知道
   *   "剑法这门武功的 `sword` 槽，对应我技能簿里的哪一项"。
   *   ★ 不在前端维护"槽 → 中文"表：那会是**第二份**中文化（服务端的技能名
   *     才是唯一那份），而且槽名是拼音 id（`sword`/`blade`），直出给玩家看
   *     就是英文混中文。读基本功自己的名字即可，一个字都不用新造。
   */
  readonly slot: string | null;
  /** 一句话说明（`learnCondition.desc`）；无则缺省 */
  readonly note?: string;
}

// ---- 4.7 联合类型 ----

export type ServerPacket =
  | RolesPacket
  | LoginPacket
  | LoginErrorPacket
  | RegistPacket
  | DeleteRolePacket
  | CrossPacket
  | LevelUpPacket
  | RoomPacket
  | ExitsPacket
  | ItemsPacket
  | ItemAddPacket
  | ItemRemovePacket
  | ItemDetailPacket
  | ActionsPacket
  | ActionChangePacket
  | CmdsPacket
  | MapPacket
  | UpdateMapPacket
  | WarnPacket
  | SettingPacket
  | PayPacket
  | EmotePacket
  | CombatPacket
  | ScPacket
  | StatusPacket
  | DiePacket
  | StatePacket
  | PerformPacket
  | CooldownPacket
  | MsgPacket
  | DialogPacket;

// ===========================================================================
// 5. 客户端 → 服务端
// ===========================================================================

export interface ClientCommandPacket extends Envelope {
  readonly type: 'command';
  readonly cmd: string;
}

export interface ClientLoginPacket extends Envelope {
  readonly type: 'login';
  /** 服务端 session token（**不含密码**，见 23 册 §4.2） */
  readonly token: string;
  readonly role_id: string;
}

export interface ClientPingPacket extends Envelope {
  readonly type: 'ping';
  readonly t: number;
}

export type ClientPacket =
  | ClientCommandPacket
  | ClientLoginPacket
  | ClientPingPacket;

// ===========================================================================
// 6. 包类型清单（供 G2 协议对账闸门使用）
//    —— 服务端发出的 type 集合必须与前端 handler 注册表**双向相等**
// ===========================================================================

export const SERVER_PACKET_TYPES = [
  'roles',
  'login',
  'loginerror',
  'regist',
  'deleterole',
  'cross',
  'levelup',
  'room',
  'exits',
  'items',
  'itemadd',
  'itemremove',
  'item',
  'actions',
  'addAction',
  'removeAction',
  'cmds',
  'map',
  'updatemap',
  'warn',
  'setting',
  'pay',
  'emote',
  'combat',
  'sc',
  'status',
  'die',
  'state',
  'perform',
  'dispfm',
  'disobj',
  'changepfm',
  'clearDistime',
  'msg',
  'dialog',
] as const;

export type ServerPacketType = (typeof SERVER_PACKET_TYPES)[number];

/**
 * ★ G2.8（26 册 §26 / 待办 T19）：**已声明、但服务端还没有生产者**的包类型 —— 显式台账。
 *
 * ── 为什么需要这张账 ─────────────────────────────────────────────────────
 * `SERVER_PACKET_TYPES` 是**协议面**的闭集（前端按它注册 handler），
 * 而"服务端真的会发哪几种"是**实现进度**的函数 —— 两者天然不同步。
 * 没有这条账时，"声明了却没人发"只能靠人记，而实测就是这么漂的：
 * 00 册先后写过 6 → 8 → **10** 三个数（26 册 §21.9），
 * **没有任何一条规则会发现那个数字已经过期**。
 *
 * ── 判据（`tools/gate/g2-protocol.mjs` 的 G2.8，**双向**）────────────────
 *   - 生产者发出一个不在 `SERVER_PACKET_TYPES` 里的 `type` ⇒ **失败**
 *     （前端没有对应 handler，包会被静默丢掉）；
 *   - 一个声明**既没有生产者、又不在本表** ⇒ **失败**（悬空声明必须记账）；
 *   - 一个类型**既有生产者、又在表里** ⇒ **失败**（账目过期：接线后忘了销账）；
 *   - 本表里出现一个不在 `SERVER_PACKET_TYPES` 的名字 ⇒ **失败**（拼错/删漏）。
 *
 * ── 记账纪律 ─────────────────────────────────────────────────────────────
 * ⚠️ **接线一个就销一行；本表只许缩短**。不许"顺手加一行让闸门变绿" ——
 *    加一行等于公开声明"这个包在可预见的将来不会发"。
 * ⚠️ 本表**不是** `SERVER_PACKET_TYPES` 的第二份真相：谁都不定义"包长什么样"，
 *    只记"有没有人发"。`satisfies` 保证这里的每个名字都必须是真包类型（写错即编译失败）。
 */
export const SERVER_PACKET_UNWIRED = [
  // ── 账号 / 选角（等 T12 账号系统与存档）──
  'roles',
  'regist',
  'deleterole',
  'cross',
  // ── 等级（等经验/等级流程）──
  'levelup',
  // ── 战斗（`combat` / `die` / `state` 已接线：`session.ts` 的 `#outputFor`；
  //      其余属状态 / 绝招批次，`on_use` 之外的消费者还没落地）──
  // ★ `state` 于 2026-10-20 从本台账**划掉**（26 册 §75）：消费者是
  //   `Character.startState` / `stopState` → `session.#outputFor` 的 `state` 出口，
  //   由 `train/study`（研读）与 `train/stop`（中断）驱动。
  'status',
  'perform',
  'dispfm',
  'disobj',
  'changepfm',
  'clearDistime',
  // ── 物品进出房间（等物品/装备批次）──
  'itemadd',
  'itemremove',
  // ── 房间动作与地图（内容层还没有 actions / map 数据）──
  'actions',
  'addAction',
  'removeAction',
  'map',
  'updatemap',
  // ── 面板 / 设置 / 表情 / 支付（支付见 25 册，商业化前不做）──
  // ★ dialog 已接线（26 册 §62）：server/session.ts 的 showAttr 出口发属性快照，
  //   消费者是 world/command/info/score.ts。注意这行只能用**反引号或裸词**，
  //   别写单引号串 —— G2 会把台账区块里任何引号字面量当成条目（踩过一次）。
  'setting',
  'pay',
  'emote',
] as const satisfies readonly ServerPacketType[];

export const CLIENT_PACKET_TYPES = ['command', 'login', 'ping'] as const;
export type ClientPacketType = (typeof CLIENT_PACKET_TYPES)[number];

/** 非 JSON 的纯文本消息（以非 `{` / `[` 开头），前端走消息流而非分发表 */
export const PLAINTEXT_CHANNEL = 'text';

// ===========================================================================
// 7. zod 运行期校验（协议边界第一道闸门，见 23 册 §4.1）
//    ★ 规则：所有**入站**数据必须过 schema，失败即断连。
// ===========================================================================

// ---- 7.1 公共片段（与第 3 节的接口一一对应，不另立一份事实源）----

const CmdItemSchema = z.object({
  cmd: z.string().min(1).max(64),
  name: z.string().min(1).max(64),
});

const ItemBriefSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(64),
  p: z.literal(1).optional(),
  m: z.literal(1).optional(),
  l: z.literal(1).optional(),
  f: z.literal(1).optional(),
  o: z.literal(1).optional(),
  hp: z.number().optional(),
  max_hp: z.number().optional(),
  mp: z.number().optional(),
  max_mp: z.number().optional(),
});

const RoleBriefSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(64),
  title: z.string().max(64),
});

/**
 * ★ docs/26 M9：`room.path` 原来只是 `z.string()`，与声明的 `WorldId` 不符 ——
 *   schema 因此**不能**充当类型契约的守卫。现在复用 `parseWorldId` 同一份语法，
 *   这样"合法 id"只有一处定义（与 G5 闸门守同一条）。
 */
export const WorldIdSchema = z
  .string()
  .max(ID_MAX_LENGTH)
  .refine((s) => parseWorldId(s) !== null, { message: '非法 world id' });

export const ChannelSchema = z.enum([...CHANNELS] as [Channel, ...Channel[]]);
export const DialogNameSchema = z.enum([...DIALOG_NAMES] as [DialogName, ...DialogName[]]);
export const StatusActionSchema = z.enum(STATUS_ACTIONS);

/**
 * 方向闭集（S9，2026-10-16 审查）。
 *
 * `exits` 帧的方向键用它 —— 与内容层 `validate.ts` 的方向校验**同一份** `DIRECTIONS`。
 * ★ 为什么协议层也必须校验（原先只有内容层有，是双口径）：
 *   前端把 key **原样**存进 `state.exits`、点击即 `runner(dir)` ——
 *   一个非法键会在中文方向列表里显示成裸串，点它等于把裸串当命令发出去。
 */
export const DirectionSchema = z.enum([...DIRECTIONS] as [Direction, ...Direction[]]);

/** 地图出口编码（`MapRoom.exits` 每一项）：字母 + 可选序号 + 可选 d/l 标记 */
const EXIT_CODE_RE = /^([a-z]{1,2})(\d)?([d|l])?$/;

const MapRoomSchema = z.object({
  n: z.string(),
  id: WorldIdSchema,
  p: z.tuple([z.number(), z.number()]),
  // ★ S9：注释一直要求匹配 `EXIT_CODE_RE`，schema 却是裸 `z.string()` —— 注释没落成校验
  exits: z.array(z.string().regex(EXIT_CODE_RE, '非法出口编码')),
});

const CooldownShape = {
  id: z.string().optional(),
  rtime: z.number().optional(),
  time: z.number().optional(),
  count: z.number().optional(),
};

const DialogControlShape = {
  close: z.literal(true).optional(),
  refresh: z.number().optional(),
  clear: z.union([z.literal(true), z.string()]).optional(),
  remove: z.string().optional(),
};

// ---- 7.2 入站 ----

/**
 * 角色名 / `role_id` 的长度上限。**只此一处**：`ClientLoginSchema` 与
 * `session.login()` 的名字校验共用它（24 册铁律 4：不许有第二份数字）。
 */
export const ROLE_NAME_MAX_LENGTH = 64;

/**
 * 角色名合法性：非空、≤ `ROLE_NAME_MAX_LENGTH`、**不含空白与控制字符**。
 *
 * ★ 只判"结构是否可用"，不判"像不像人名"（"2-5 个汉字"那种规则属于创角流程，
 *   见 `ERROR_CODES.REG_BAD_NAME` 与 T12）。
 *
 * ★ 为什么必须挡住空白与控制字符（2026-10-13 体检 N3）：
 *   ① `roleId` 现在**直接当角色名**用，而 `tell <名> <内容>` 是按空白分词的 ——
 *      名字里带空格会让"私聊谁"产生歧义；
 *   ② 换行 / `\t` / NUL 这类字符会污染服务端日志与前端叙事流的排版。
 *   这两件事都发生在**渲染之前**，所以要在入口挡住，而不是在展示层打补丁。
 *
 * ★ 为什么还要挡住 `<`（**2026-10-16 审查 S1**）：
 *   角色名会被 `$N` 替换进**每一句**涉及该角色的播报（`$N说：…`、`$N走了进来`），
 *   而 `<CMD>` 在前端 `markup.ts` 的白名单**之内**、语义是"点一下发一条指令"。
 *   ⇒ 一个名字里带 `<CMD cmd="…">` 的角色，**不用开口**，只要站在房间里就在给
 *      全房间的人植一个按钮 —— 这比"在聊天里注入"更强（不需要说话这个动作）。
 *   ⇒ 名字是**持久标识**，本来就不该含标签字符；从源头拒掉比到渲染层打补丁干净。
 *   ※ 这里是三道防线里的**第一道**；另两道见 `server/engine/view-text.ts`
 *     `neutralizePlayerText` 的注释（`view-text` 层 + 聊天指令出口）。
 */
/**
 * **任何**进站文本都不允许出现的字符：C0 控制字符（含 NUL / 换行 / 回车 / **ESC**）、
 * DEL，以及 **C1 控制区（U+0080–U+009F）**。
 *
 * ★ 26 册 §11.2 R4：原来只写了 `\u0000-\u001f\u007f`，漏掉 C1 区。
 *   C1 里的 **U+009B 是 8 位 CSI**：它不需要先发 ESC(0x1B) 就能让终端
 *   执行转义序列（清屏 / 移动光标 / 改写状态行）。也就是说"禁了 ESC"
 *   **不等于**禁了终端注入 —— 只挡 7 位表示法会把这条后门留着。
 *   U+0085（NEL）同理：在不少日志查看器里会被当成换行，可用来伪造日志行。
 *
 * ★★ 2026-10-17 审查 **M1**：这把刀原先**只架在明文通道上**（`checkPlaintext`），
 *   而 JSON 通道的 `cmd` 只有 `min(1).max(512)` ⇒ 客户端发
 *   `{"type":"command","cmd":"say a\u001b[2J"}` 就能把 ESC / C0 / C1 送进 `say`，
 *   再经 `sendRoom` 广播给全房间（`neutralizePlayerText` 只替换 `<`，不管控制字符）。
 *   ⇒ 两条通道**共用同一份判据**，不许再各写一遍（各写一遍早晚有一处漏）。
 */
export const FORBIDDEN_CONTROL_RE = /[\u0000-\u001f\u007f-\u009f]/;

export function isRoleName(raw: unknown): raw is string {
  if (typeof raw !== 'string') return false;
  if (raw.length === 0 || raw.length > ROLE_NAME_MAX_LENGTH) return false;
  // `\s` 覆盖空白与换行；`\u0000-\u001f` / `\u007f-\u009f` 覆盖 C0/C1 控制字符
  if (/[\s\u0000-\u001f\u007f-\u009f]/u.test(raw)) return false;
  // ★ 标签起始符：见上方注释（S1）。※ 只禁 `<`，不禁 `>` —— 没有 `<` 就不成标签；
  //   全角书名号 `《》`（U+300A / U+300B）与本条无关，照常允许（别忘了它们是常见中文标点）。
  return !raw.includes('<');
}

export const ClientCommandSchema = EnvelopeSchema.extend({
  type: z.literal('command'),
  // ★ 控制字符在这里被拒（M1，2026-10-17 审查）：与明文通道**同一把刀**，
  //   见 `FORBIDDEN_CONTROL_RE` 的注释。zod 失败 ⇒ `BAD_PACKET`，
  //   包根本进不到 `dispatch`，也就进不到 `say` 的广播出口。
  cmd: z
    .string()
    .min(1)
    .max(512)
    .refine((s) => !FORBIDDEN_CONTROL_RE.test(s), { message: 'cmd 含控制字符' }),
});

export const ClientLoginSchema = EnvelopeSchema.extend({
  type: z.literal('login'),
  token: z.string().min(16).max(256),
  role_id: z.string().min(1).max(ROLE_NAME_MAX_LENGTH),
});

export const ClientPingSchema = EnvelopeSchema.extend({
  type: z.literal('ping'),
  t: z.number().int().nonnegative(),
});

export const ClientPacketSchema = z.discriminatedUnion('type', [
  ClientCommandSchema,
  ClientLoginSchema,
  ClientPingSchema,
]);

// ---- 7.3 出站 ----

/**
 * 出站包 schema 注册表。
 *
 * ★ 类型是**完整**的 `Record<ServerPacketType, …>`，不是 `Partial<…>`：
 *   于是"新增一个包类型却忘了写 schema"是**编译错误**，而不是运行期告警。
 *   （docs/26 M9：这张表原来只覆盖 6/35，且用 `Partial` 让缺口合法化 ——
 *     `missingPacketSchemas()` 便成了"永远有 29 个"的装饰品。）
 *
 * `missingPacketSchemas()` 仍然保留：G2 闸门从**源码文本**解析这张表，
 * 它需要一个运行期视图来发现"表里少了一个 key"。
 */
export const SERVER_PACKET_SCHEMAS: Record<ServerPacketType, z.ZodTypeAny> = {
  roles: EnvelopeSchema.extend({ type: z.literal('roles'), roles: z.array(RoleBriefSchema) }),
  login: EnvelopeSchema.extend({
    type: z.literal('login'),
    id: z.string().min(1).max(64),
    level: z.number().int(),
    setting: z.record(z.unknown()).optional(),
  }),
  loginerror: EnvelopeSchema.extend({
    type: z.literal('loginerror'),
    code: ErrorCodeSchema,
    msg: z.string(),
  }),
  regist: EnvelopeSchema.extend({
    type: z.literal('regist'),
    ok: z.boolean(),
    code: ErrorCodeSchema.optional(),
    result: z.string(),
  }),
  deleterole: EnvelopeSchema.extend({ type: z.literal('deleterole'), roleid: z.string() }),
  cross: EnvelopeSchema.extend({
    type: z.literal('cross'),
    sid: z.number().int(),
    pid: z.string(),
    cross_type: z.string(),
  }),
  levelup: EnvelopeSchema.extend({ type: z.literal('levelup'), level: z.number().int() }),
  room: EnvelopeSchema.extend({
    type: z.literal('room'),
    path: WorldIdSchema,
    name: z.string(),
    desc: z.string(),
    commands: z.array(CmdItemSchema),
  }),
  // ★ S9：方向键必须是闭集（原先 `z.record(z.string())` 收任何键）
  exits: EnvelopeSchema.extend({ type: z.literal('exits'), items: z.record(DirectionSchema, z.string()) }),
  items: EnvelopeSchema.extend({ type: z.literal('items'), items: z.array(ItemBriefSchema) }),
  itemadd: EnvelopeSchema.extend({ type: z.literal('itemadd'), ...ItemBriefSchema.shape }),
  itemremove: EnvelopeSchema.extend({ type: z.literal('itemremove'), id: z.string() }),
  item: EnvelopeSchema.extend({
    type: z.literal('item'),
    id: z.string(),
    name: z.string(),
    desc: z.string(),
    commands: z.array(CmdItemSchema),
  }),
  actions: EnvelopeSchema.extend({ type: z.literal('actions'), items: z.array(CmdItemSchema) }),
  addAction: EnvelopeSchema.extend({
    type: z.literal('addAction'),
    id: z.string().optional(),
    items: z.array(CmdItemSchema).optional(),
  }),
  removeAction: EnvelopeSchema.extend({
    type: z.literal('removeAction'),
    id: z.string().optional(),
    items: z.array(CmdItemSchema).optional(),
  }),
  cmds: EnvelopeSchema.extend({ type: z.literal('cmds'), items: z.array(CmdItemSchema) }),
  map: EnvelopeSchema.extend({
    type: z.literal('map'),
    path: z.string(),
    map: z.array(MapRoomSchema),
  }),
  updatemap: EnvelopeSchema.extend({
    type: z.literal('updatemap'),
    map: z.string(),
    id: WorldIdSchema,
    n: z.string(),
    pos: z.tuple([z.number(), z.number()]),
  }),
  warn: EnvelopeSchema.extend({
    type: z.literal('warn'),
    content: z.string(),
    time: z.number().optional(),
    cmds: z.array(CmdItemSchema),
    // ★ 缺省 = 进消息流（见 `WarnPacket.context` 的说明）
    context: z.string().optional(),
  }),
  setting: EnvelopeSchema.extend({ type: z.literal('setting'), items: z.record(z.unknown()) }),
  pay: EnvelopeSchema.extend({
    type: z.literal('pay'),
    url: z.string(),
    order_id: z.string().min(1),
  }),
  emote: EnvelopeSchema.extend({ type: z.literal('emote'), items: z.array(z.string()) }),
  combat: EnvelopeSchema.extend({
    type: z.literal('combat'),
    start: z.literal(1).optional(),
    end: z.literal(1).optional(),
  }),
  sc: EnvelopeSchema.extend({
    type: z.literal('sc'),
    id: z.string(),
    hp: z.number().optional(),
    max_hp: z.number().optional(),
    mp: z.number().optional(),
    max_mp: z.number().optional(),
    damage: z.number().optional(),
  }),
  status: EnvelopeSchema.extend({
    type: z.literal('status'),
    id: z.string(),
    action: StatusActionSchema,
    sid: z.array(z.string()).optional(),
    name: z.string().optional(),
    duration: z.number().optional(),
    count: z.number().optional(),
  }),
  die: EnvelopeSchema.extend({
    type: z.literal('die'),
    relive: z.literal(true).optional(),
    commands: z.array(CmdItemSchema).optional(),
  }),
  state: EnvelopeSchema.extend({
    type: z.literal('state'),
    state: z.string(),
    desc: z.string(),
  }),
  perform: EnvelopeSchema.extend({ type: z.literal('perform'), items: z.array(CmdItemSchema) }),
  dispfm: EnvelopeSchema.extend({ type: z.literal('dispfm'), ...CooldownShape }),
  disobj: EnvelopeSchema.extend({ type: z.literal('disobj'), ...CooldownShape }),
  changepfm: EnvelopeSchema.extend({ type: z.literal('changepfm'), ...CooldownShape }),
  clearDistime: EnvelopeSchema.extend({ type: z.literal('clearDistime'), ...CooldownShape }),
  msg: EnvelopeSchema.extend({
    type: z.literal('msg'),
    ch: ChannelSchema,
    content: z.string(),
    uid: z.number().int().optional(),
    name: z.string().optional(),
    fam: z.string().optional(),
    lv: z.number().int().optional(),
  }),
  // `dialog` 是**刻意**保留未知字段的通用容器（见 `DialogPacket` 的索引签名）。
  // 这里显式 `.passthrough()` 并留 TODO：等各面板载荷逐一建模后收紧为 `.strip()`。
  // 已知面板见 DialogNameSchema —— 连 `dialog` 名都写错必须被拦。
  // TODO(契约收敛)：dialog 载荷逐面板建模，然后删掉 passthrough。
  dialog: EnvelopeSchema.extend({
    type: z.literal('dialog'),
    dialog: DialogNameSchema,
    ...DialogControlShape,
  }).passthrough(),
};

/** G2 闸门用：返回尚未登记 schema 的包类型（当前应为空） */
export function missingPacketSchemas(): readonly ServerPacketType[] {
  return SERVER_PACKET_TYPES.filter(
    (t) => (SERVER_PACKET_SCHEMAS as Partial<Record<string, unknown>>)[t] === undefined,
  );
}

// ===========================================================================
// 8. 入站边界：消息体大小 / 明文通道（★ docs/26 S1、S2）
// ===========================================================================
//
// 这两条与 schema 校验**不同性质**：
//   schema 管"字段对不对"，这里管"**要不要解析它**"。
//   顺序必须是：先量大小 → 再判是不是 JSON → 才轮到 zod。
//   （旧实现在 schema 之前没有任何门槛：单帧就能把内存打满；
//     而明文路径干脆**完全绕过** schema。见 docs/26 §4。）

const textEncoder = new TextEncoder();

/** 取字节数（UTF-8）。字符串与二进制帧走同一条口径。 */
export function byteLengthOf(raw: string | Uint8Array): number {
  return typeof raw === 'string' ? textEncoder.encode(raw).byteLength : raw.byteLength;
}

export type PayloadCheck =
  | { readonly ok: true; readonly bytes: number }
  | { readonly ok: false; readonly code: ErrorCode; readonly detail: string };

/**
 * S1 · 消息体大小硬上限。
 * WS 层应**同时**设置 `maxPayload`：库层拦住的不必进业务，业务层再拦一次兜底。
 */
export function checkPayloadSize(raw: string | Uint8Array): PayloadCheck {
  const bytes = byteLengthOf(raw);
  if (bytes > MAX_MESSAGE_BYTES) {
    return {
      ok: false,
      code: 'PAYLOAD_TOO_LARGE',
      detail: `消息体 ${bytes} 字节超过上限 ${MAX_MESSAGE_BYTES}`,
    };
  }
  return { ok: true, bytes };
}

// ★ `LOOKS_LIKE_JSON_RE` 已上移到 `constants.ts`（S10，2026-10-16 审查）：
//   前端 `net/client.ts` 也要用**同一份**判据（决定一条指令发明文还是发 `command` 包），
//   而前端只许 `import type` 本文件 ⇒ 放在双方都能 import 的共享层。
//   原先各写一份，注释自己都警告"两边一旦分叉会偶尔断连"。

// ---- 帧分流：S1 + L8 的合并落点 -------------------------------------------

/**
 * 帧的两条通道。
 * ★ docs/26 L8：`PLAINTEXT_CHANNEL` 原先"声明后零使用"（与 M7 同属"声明未实现"）。
 *   这里给它一个**唯一的真消费者** —— 帧分流函数，而不是继续挂着一个没人读的常量。
 */
export type FrameChannel = 'json' | typeof PLAINTEXT_CHANNEL;

export type FrameRoute =
  | { readonly ok: true; readonly channel: FrameChannel; readonly bytes: number }
  | { readonly ok: false; readonly code: ErrorCode; readonly detail: string };

/**
 * 入站帧的第一道分诊：**先量大小 → 再判是不是 JSON**。
 *
 * 这么排是有原因的（见本段开头）：schema 管"字段对不对"，这一步管"**要不要解析它**"。
 * 旧实现在 schema 之前没有任何门槛 —— 单帧即可打满内存，
 * 而明文路径干脆**完全绕过** schema。
 *
 * 二进制帧一律按 JSON 处理（明文通道只承载可读文本）。
 *
 * @example WS 层接线
 * ```ts
 * const route = routeFrame(raw);
 * if (!route.ok) return close(route.code);
 * if (route.channel === PLAINTEXT_CHANNEL) { ...checkPlaintext... }
 * else { ...checkEnvelope + zod... }
 * ```
 */
export function routeFrame(raw: string | Uint8Array): FrameRoute {
  const size = checkPayloadSize(raw);
  if (!size.ok) return size; // 尺寸不过关先出局，连"是不是 JSON"都不必看
  if (typeof raw !== 'string') return { ok: true, channel: 'json', bytes: size.bytes };
  // ★★ 2026-10-17 审查 **L6 回退订正**（§55 修复自身引入的回归）：
  //   上一版把"像 JSON 还得**真能解析**才走 JSON 通道"实现成了**在这里 `JSON.parse`**
  //   —— 但本函数跑在**限流之前**（`frame-pipeline.ts`：① 尺寸 → ② 限流 → ③ 分诊 → ④ 解析），
  //   于是每个 `{`/`[` 开头的帧都在限流前被完整解析一次（且管线里还会再 parse 一次 = 双解析）。
  //   这违反本文件 13–19 行写死的"**限流必须排在解析之前**"（否则高频大包可未限流烧 CPU）。
  //   ⇒ 分流**只做形状判定**（首字符）；"像 JSON 但解析不了怎么办"交给**管线**在
  //     解析阶段（已在限流之后）处理，见 `frame-pipeline.ts` 的 JSON 分支回落。
  if (LOOKS_LIKE_JSON_RE.test(raw)) {
    return { ok: true, channel: 'json', bytes: size.bytes };
  }
  return { ok: true, channel: PLAINTEXT_CHANNEL, bytes: size.bytes };
}

export type PlaintextCheck =
  | { readonly ok: true; readonly command: string }
  | { readonly ok: false; readonly code: ErrorCode; readonly detail: string };

/**
 * S2 · 明文通道（`PLAINTEXT_CHANNEL`）的唯一入口。
 *
 * 明文是 wushen 式的"直接敲命令"路径，它**不经过 zod**。因此必须在这里
 * 把能管住的全管住，而不是指望下游：
 *   - 只承载**一条指令**（不是一个自由文本通道）；
 *   - 长度上限、禁控制字符（防日志注入 / 终端逃逸序列）；
 *   - 看起来像 JSON 的一律打回 JSON 分支（否则明文路径会变成绕开 schema 的后门）。
 *
 * ★ 调用方必须**先**调 `checkPayloadSize` 再调本函数（字节上限优先级更高）。
 */
export function checkPlaintext(raw: unknown): PlaintextCheck {
  if (typeof raw !== 'string') {
    return { ok: false, code: 'BAD_PACKET', detail: '明文帧必须是字符串' };
  }
  if (LOOKS_LIKE_JSON_RE.test(raw)) {
    // ★ 走到这里 = 一条"长得像 JSON 的明文指令"：正常分流下真 JSON 走 JSON 通道，
    //   只有"像 JSON 但 `JSON.parse` 失败"的帧才会被**管线**回落到本函数（L6）。
    //   回 `PLAINTEXT_NOT_COMMAND`（**不断连**），而不是 `BAD_PACKET`。
    return {
      ok: false,
      code: 'PLAINTEXT_NOT_COMMAND',
      detail: '看起来是 JSON 但解析不了 —— 明文通道只承载指令',
    };
  }
  const command = raw.trim();
  if (command === '') {
    return { ok: false, code: 'PLAINTEXT_NOT_COMMAND', detail: '空明文不构成指令' };
  }
  if (command.length > MAX_PLAINTEXT_CHARS) {
    return {
      ok: false,
      code: 'PLAINTEXT_NOT_COMMAND',
      detail: `明文 ${command.length} 字符超过上限 ${MAX_PLAINTEXT_CHARS}`,
    };
  }
  const bad = FORBIDDEN_CONTROL_RE.exec(command);
  if (bad !== null) {
    return {
      ok: false,
      code: 'PLAINTEXT_NOT_COMMAND',
      detail: `明文含控制字符 ${JSON.stringify(bad[0])}`,
    };
  }
  return { ok: true, command };
}

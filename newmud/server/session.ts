/**
 * server/session.ts — 会话层：连接 ↔ 玩家角色 ↔ 指令分发
 * ============================================================================
 * 这是继 `bootstrap.ts` 之后的第二个**组合根**：把引擎（角色、指令、世界）
 * 与网络层（连接、限流、出站）接到一起。它自己不含玩法逻辑，只做三件事：
 *
 *   ① 登录：建立"连接 → 玩家"的绑定，把玩家放进起始房间
 *   ② 输出：把 `CharacterOutput`（引擎侧接口）接到"发一个协议包"上
 *   ③ 分发：一行指令 → `dispatch()`，并把阶段（登录期 / 游戏中）传下去
 *
 * ★ 为什么单独成文件而不是塞进 `bootstrap.ts`：
 *   bootstrap 是"一次性把世界造出来"，本文件是"每条连接都要跑一遍"。
 *   两者的生命周期完全不同，混在一起会让"启动期"与"运行期"的边界模糊。
 *
 * ⚠️ **本批次的登录是"最小可用"，不是真账号系统**：
 *   - token 只做了格式校验（16–256 字符，由 zod 保证），**没有验签**；
 *   - 角色没有存档，`roleId` 直接当名字，属性取 `Character` 的默认值。
 *   这两项都在 `docs/26 §14.6` 记为待办，这里**不留假接口**（没有"假装验签"的函数）。
 *
 * ✅ **已收口的两件**（2026-10-13 体检 N3，P0）：
 *   ① 角色名**字符集**校验（`isRoleName`：非空 / 限长 / 无空白与控制字符）⇒ `ROLE_NAME_INVALID`；
 *   ② 角色名**在线唯一**（`#byRoleId`）⇒ 重名回 `REG_NAME_TAKEN`，不再"取第一个匹配"。
 *   这两条消掉的是**冒名**路径（抢先注册某名字后，所有指向该名字的交互都落到攻击者），
 *   但不等于账号系统 —— 真正的"全局唯一 + 身份不可伪造"仍要 T12（存档 + token 验签）。
 */

import { ERROR_CODES, PROTOCOL_VERSION, ROLE_NAME_MAX_LENGTH, isRoleName } from '@shared/protocol.js';
import type { ErrorCode } from '@shared/protocol.js';
import type { Channel } from '@shared/constants.js';
import { MAX_MESSAGE_BYTES } from '@shared/constants.js';
import { dispatch } from './engine/command.js';
import { Character } from './engine/character.js';
import { OidSpace } from './engine/oid.js';
import { Player } from './engine/player.js';
import { checkOutboundSize } from './net/frame-pipeline.js';
import { ConnectionHub } from './net/hub.js';
import type { NetConnection } from './net/hub.js';
import type { World } from './engine/world.js';
import type { GameObject } from './engine/base.js';
import type { CharacterOutput } from './engine/character.js';
import type { CmdItem, ItemBrief } from '@shared/protocol.js';

// ---------------------------------------------------------------------------
// 出站包的构造（集中一处：协议版本号只在这里出现一次）
// ---------------------------------------------------------------------------

function packet(body: Record<string, unknown>): string {
  return JSON.stringify({ v: PROTOCOL_VERSION, ...body });
}

/**
 * 给玩家看的**一行文本**。
 *
 * ★ 走 `warn` 而不是 `msg`：`msg` 的 `ch` 是**必填的频道归属**，前端据此上色
 *   并把它算进**聊天**（预览区 + 未读徽标）。而"给某个人看的一行输出"
 *   根本不属于任何频道 —— 硬塞进 `sys`（系统**频道**）会让它跑到聊天页里去，
 *   可它本该落在**主消息流**（房间描述、`say`、指令提示都在那儿）。
 *   `warn` 的语义正是"系统提示 + 可选按钮"，对应 MUD 的一行输出。
 *
 * ⚠️ 这里原先写的是"`msg` 要求 `ch` 是闭集频道（**没有"系统"这一档**）"——
 *   那句话在写下的当天就已经不成立：`CHANNELS` 里一直有 `sys`
 *   （`shared/constants.ts`）。属于 FG-20 那类"注释宣称了一件事、而事实相反"，
 *   已于 2026-10-13 随 26 册 §24 一并改正。
 */
function textPacket(content: string, context?: string): string {
  // ★ 不带归属时**不写这个键**（而不是写 `context: undefined`）：JSON.stringify
  //   会把 `undefined` 值丢掉，但显式写出来会让"这条有没有声明归属"在报文上
  //   看起来一样，调试时分不清是"服务端没声明"还是"序列化吃掉了"。
  return packet({
    type: 'warn',
    content,
    cmds: [] as CmdItem[],
    ...(context === undefined ? {} : { context }),
  });
}

function errorPacket(code: ErrorCode): string {
  return packet({ type: 'loginerror', code, msg: ERROR_CODES[code] });
}

function cmdsPacket(pairs: readonly string[]): string {
  const items: CmdItem[] = [];
  for (let i = 0; i + 1 < pairs.length; i += 2) {
    items.push({ cmd: pairs[i] ?? '', name: pairs[i + 1] ?? '' });
  }
  return packet({ type: 'cmds', items });
}

/**
 * 把世界对象压成 `ItemBrief`（前端列表用）。
 *
 * ★ **角色**（玩家与 NPC）要带气血 / 内力。这是 wushen `ROOM.prototype.items_to_json`
 *   （`os/room/room.js:105`）的做法：
 *
 *       if (item.appdend_status) { …,mp:,hp:,max_mp:,max_hp: }
 *
 *   而 `appdend_status` 定义在 `CHARACTER.prototype`（`os/char/chara_skill.js:397`）——
 *   也就是**每个角色都带这四个数**；地面物件（OBJ）没有这个方法，所以不带。
 *
 * ★ 漏掉这四个数的后果不是"少个子段"：前端 `ui/room.ts` 的
 *   `if (item.max_hp !== undefined && item.max_hp > 0)` **永远为假** →
 *   **气血/内力条一次都画不出来**（真机复核：`state.items` 里只有 `id`/`name`）。
 *   前端与它的 CSS 早就写好了，两边单测各自喂自己的载荷所以各自都绿 ——
 *   26 册 §16.12 那类"两端都对、接线错了"，只有真跑一次才看得见。
 *
 * ★ `max_hp`/`max_mp` 取**派生值**（`character.maxHp` / `maxMp`），不是存档里的数：
 *   上限的唯一来源是 `formula.ts`，与 `sc` 帧（`#statusPacket`）走的是同一个口子。
 *
 * ★ `m`(师父) / `l`(商人) / `f`(随从) / `o`(倒地) **不发**：协议里声明了、解析层也收了，
 *   但 `ui/room.ts` 没有任何消费者（wushen 自己前端列表里同样不显示它们，
 *   `create_roomitem` 从不读 `item.type`）—— 不发没有消费者的字段。
 */
function briefOf(obj: GameObject): ItemBrief {
  if (obj instanceof Character) {
    return {
      id: obj.id,
      name: obj.name,
      ...(obj instanceof Player ? { p: 1 as const } : {}),
      hp: obj.hp,
      max_hp: obj.maxHp,
      mp: obj.mp,
      max_mp: obj.maxMp,
    };
  }
  return { id: obj.id, name: obj.name };
}

// ---------------------------------------------------------------------------
// 频道受众（**单源**）
// ---------------------------------------------------------------------------

/**
 * 每个频道的受众范围。
 *
 * ★ 为什么受众表必须在**会话层**：受众是"现在有哪些连接、谁和谁同处一室"
 *   的函数 —— 那是会话层独有的知识。内容层的聊天指令只声明"发到哪个频道"
 *   （`Actor.sendChannel`），投递一处裁决，于是"改了受众"不会变成
 *   要在每条聊天指令里各改一遍。
 *
 * ★ 为什么不用 `if (ch === 'chat') … else if …`：新增频道时漏改一支会**静默**
 *   落到兜底（通常是"全服"），那是隐私事故的典型形态。用 `Record<Channel, …>`
 *   全量声明，漏一个键就编译不过。
 *
 * ★ 作用域里**没有 `'room'`**（26 册 §24）：房间范围的播报走 `Actor.sendRoom`
 *   —— 引擎逐人三视角渲染，根本不经过这里，`say` 就是这样。
 *   先前那一档的唯一成员就是 `say`，它一走就成了**没有任何频道的死分支**。
 *   若将来真出现"以房间为范围、但确实是一条频道消息"的东西，
 *   这里就是它该回来的地方（届时 `'room'` 要连 `#deliverChannel` 的分支一起加）。
 *
 * ★ `tm` / `fam` / `pty` 目前登记为 `'world'` 是**降级**（§21.6 末条已记）：
 *   队伍 / 门派 / 帮派系统还没做，没有"队友是谁"可查，只能退回全服。
 *   它们各自的目标作用域**不是** `'room'` —— 别把降级当成设计。
 */
const CHANNEL_SCOPE: Readonly<Record<Channel, 'world' | 'self' | 'target'>> = {
  chat: 'world',
  es: 'world',
  rumor: 'world',
  tm: 'world',
  fam: 'world',
  pty: 'world',
  tell: 'target',
  sys: 'self',
};

/**
 * "客户端看到的房间"的签名：房间 path + 房内**全部**对象（排序）。
 *
 * ★ 排序后再拼接：`items` 的顺序会随进出变化，不排序的话"两个人交换了位置"
 *   也会被当成变化 —— 那会让判据噪声大到没人敢用（见 FG-11：判据要落在
 *   真正有区分性的字段上，而不是"任何风吹草动都算"）。
 *
 * ★★ **含自己**（N5/E13，2026-10-16）：旧版是 `o !== player` 把**自己排掉**，
 *   于是同房两个玩家拿到**两个不同**的签名，`#reconcileRooms()` 只能按
 *   **玩家数**各算一遍（filter + sort + join），而它被**每条指令**触发一次
 *   ⇒ O(N²) 放大。签名是"**房间这个事实**"（房里有多少人多少物），
 *   对房里每个人是**同一个**事实 ⇒ 去掉"我是谁"这一层，就能每房只算一次。
 *
 * ★ 排除自己**不是**正确性需要？—— 逐条查过，含自己**不会漏掉任何一次该推的更新**：
 *   - 自己换了房间 ⇒ `path` 变 ⇒ 签名变；
 *   - 房里有人进/出 ⇒ id 集合变 ⇒ 签名变（房内每个人都会收到新 `items`）。
 *   ★★ 2026-10-17 订正（26 册 §57）：原文写的是"签名变 ⟺ 人员/物件**集合**变了"，
 *      现在**不再成立** —— NPC 掉血也进签名（否则血条不动）。准确的说法是：
 *      **签名变 ⟺ 集合变了 ∨ 某个 NPC 的气血/内力变了**，两者都是"房里每个人
 *      的视图都变了"，所以"不会多推"那半句仍然站得住。
 *   `tests/session.test.ts` 的『同房两玩家签名相同 / 多一人少一人签名变』
 *   与 `tests/login-e2e.test.ts` 的『同房的人走了 → 我这边收到新的 items』
 *   一起把这条钉住（前者是同房共用的**前提**，后者是端到端的行为）；
 *   『NPC 掉血 ⇒ 签名变』由 `tests/session.test.ts` 的 §57 组钉住。
 *
 * ★ 不在房间 / 房间没有模板 path → 空串（此时无话可说，`#reconcileRooms` 跳过）。
 */
export function roomSignatureOf(player: Player): string {
  const env = player.environment;
  if (env === null || env.path === null) return '';
  // ★★ 带上 NPC 的**气血 / 内力**（26 册 §57，真机反馈"打木人桩血条不动"）：
  //   只拼 id 的话，木人桩从满血打到 0 血时 id 一字不变 ⇒ `#reconcileRooms` 判定
  //   "客户端已知这个房间"、`items` 不再重推 ⇒ 房间区那条血条从开打到打死一动不动
  //   （而 `afterTick` 每个 tick 都在对账，等于白对）。
  //
  // ★ 只取**非玩家**角色：玩家自己的气血由 `statSignatureOf` 的 `sc` 帧负责，
  //   重复纳入只会让"我掉一滴血"也触发一次整房重推。
  // ★ "谁是玩家"对房里所有人是**同一个事实** ⇒ 同房签名仍然相同（N5 的前提不变）。
  const ids = env.items
    .map((o) =>
      o instanceof Character && !(o instanceof Player)
        ? `${o.id}:${String(o.hp)}|${String(o.mp)}`
        : o.id,
    )
    .sort()
    .join(',');
  return `${env.path}|${ids}`;
}

/**
 * 一个角色的**数值签名**（`hp|maxHp|mp|maxMp`）—— `#reconcileStats` 的判据。
 *
 * ★ 与 `roomSignatureOf` 同一形态：它是"客户端状态条应当显示什么"的**事实**，
 *   会话层拿它比对"已经推过什么"，不一致才补推 `sc`。
 *   `maxHp` / `maxMp` 也在内：换了装备 / 升了技能会上限变化，那时血条**比例**也得跟着动。
 */
export function statSignatureOf(player: Player): string {
  return `${String(player.hp)}|${String(player.maxHp)}|${String(player.mp)}|${String(player.maxMp)}`;
}

// ---------------------------------------------------------------------------
// 会话
// ---------------------------------------------------------------------------

export interface SessionDeps {
  readonly world: World;
  readonly hub: ConnectionHub;
  /** 给玩家发 oid；缺省复用 `world.oidSpace` */
  readonly oidSpace?: OidSpace;
  /** 可注入时钟（测试用） */
  readonly now?: () => number;
  /**
   * 出站帧因**超限**被丢弃时的回调。缺省 `logOutboundDrop`（写 stderr）。
   *
   * ★ 存在的理由就是"不让它静默"：wushen 是 `text.length < 30240` 才发、
   *   超了**什么都不说**（`os/char/user.js:23,28`），于是"服务端拼包出错"
   *   对外只表现为"客户端莫名其妙没反应"，日志上什么都查不到。
   *   见 26 册 §16.7 第 3 条 / §25。
   */
  readonly onOutboundDrop?: (info: OutboundDropInfo) => void;
}

/** 一条出站帧被丢弃的原因（`bytes` 是**实际**字节数，不是字符数） */
export interface OutboundDropInfo {
  readonly bytes: number;
  readonly limit: number;
}

/**
 * 缺省处置：往 stderr 写一行。
 * 导出是为了让"默认值"本身也有测试 —— 否则默认分支就是个没人看见的盲区。
 */
export function logOutboundDrop(info: OutboundDropInfo): void {
  process.stderr.write(`[session] 出站帧超限被丢弃：${info.bytes} 字节 > 上限 ${info.limit} 字节\n`);
}

export type LoginResult =
  | { readonly ok: true; readonly player: Player }
  | { readonly ok: false; readonly code: ErrorCode; readonly detail: string };

export class GameSessions {
  readonly #world: World;
  readonly #hub: ConnectionHub;
  readonly #oidSpace: OidSpace;
  readonly #now: () => number;
  /** 连接 id → 玩家 */
  readonly #players = new Map<string, Player>();
  /**
   * 角色名（= `roleId`）→ 玩家。**在线唯一性**的唯一判据。
   *
   * ★ 为什么需要它（2026-10-13 体检 N3）：`roleId` 直接当名字用，而 `#playerNamed`
   *   原先按名字**取第一个匹配** ⇒ 抢先注册「阿飞」之后，所有 `tell 阿飞`
   *   都落进攻击者手里（冒名）。有了这张表，"名字 → 玩家"是一个**有唯一答案**的映射。
   * ★ 注意这是**在线**唯一（登录时插入、`logout` 时删除），不是"永久占用"。
   *   真正的全局唯一要等账号 / 存档批次（T12）从持久层判定。
   */
  readonly #byRoleId = new Map<string, Player>();
  /** 连接 id → 连接（发回包要用） */
  readonly #conns = new Map<string, NetConnection>();
  /** 玩家 → 连接（广播反查；WeakMap：玩家没了映射自动消失） */
  readonly #connOfPlayer = new WeakMap<Player, NetConnection>();
  /**
   * 连接 id → **已经推给该客户端**的房间签名。
   *
   * ★ 这是"房间事实对账"的一半（另一半是 `Player.environment`）：
   *   客户端看到的房间是服务端**主动推**的，于是"服务端以为推过了、
   *   客户端其实没有"这类漂移必须有一个判据能发现。判据就是这张表 ——
   *   `#reconcileRooms()` 每条指令之后拿它比对，不一致就补推。
   *
   *   ⚠️ 它**不是**缓存（不是"避免重复发包"的优化）：它是"客户端已知什么"
   *      的记账。删掉它不会变慢，会变成"走了房间但画面还停在上一个房间"。
   */
  readonly #sentRooms = new Map<string, string>();
  /**
   * 连接 id → **已经推给该客户端的数值签名**（`hp|maxHp|mp|maxMp`）。
   *
   * ★ 与 `#sentRooms` 同一条纪律：**不是缓存，是"客户端已知什么"的记账**。
   *   战斗是**世界时钟异步驱动**的（`World.scheduler`），掉血不经过任何指令 ⇒
   *   `handleCommand` 那条路看不到它。于是 tick 之后要对一次账（`afterTick`），
   *   判据就是这张表 —— 不一致才补推一个 `sc` 帧。
   *   ⚠️ 少了它，表现是"打起来了、消息在滚，可血条一直不动"（真机才看得见）。
   */
  readonly #sentStats = new Map<string, string>();
  /** 出站超限时的处置（缺省写 stderr） */
  readonly #onOutboundDrop: (info: OutboundDropInfo) => void;

  public constructor(deps: SessionDeps) {
    this.#world = deps.world;
    this.#hub = deps.hub;
    this.#oidSpace = deps.oidSpace ?? deps.world.oidSpace;
    this.#now = deps.now ?? (() => Date.now());
    this.#onOutboundDrop = deps.onOutboundDrop ?? logOutboundDrop;
  }

  public get size(): number {
    return this.#players.size;
  }

  public playerOf(conn: NetConnection): Player | undefined {
    return this.#players.get(conn.id);
  }

  // ── 登录 ────────────────────────────────────────────────────────────────

  /**
   * 建立会话。
   *
   * 顺序刻意如此：**先造角色 → 再进房间 → 最后才发第一个包**。
   * 反过来（先发 login 包再进房间）会有一个时间窗：客户端已经拿到 `login`
   * 却还没收到房间，期间玩家敲的任何指令都会作用在"不在任何房间"的角色上。
   *
   * ★ FG-17（24 册 §5.3 / 26 册 §28.5）：这个顺序还有一个副作用 —— 本方法**一步到底、没有 await**，
   *   所以"角色已登记但还在登录期"的状态**只存在于本函数内部**，
   *   一次 `handleCommand` 都不会跨过它。于是 `Player.phase` 的 `'login'` 档
   *   在生产路径上**不可达**，`command.ts` 的 `allow_login` 闸门一次都不会被触发。
   *
   *   这里因此**不写** `phase: 'login'` + 随后 `phase = 'playing'` 那对"看着像在
   *   开合闸门"的赋值：那两行合起来是恒等变换，却暗示"窗口存在且被关上了"。
   *   闸门本身没删 —— 它在引擎层是活的（`phase` 由角色自己的字段派生，
   *   `tests/session.test.ts` 手动把 phase 拨回 `'login'` 就拦得住命令），
   *   等到"两步登录 / 选角 / 读档"落地时它会自动变成生产可达的。
   */
  public login(conn: NetConnection, _token: string, roleId: string): LoginResult {
    if (this.#players.has(conn.id)) {
      return { ok: false, code: 'ALREADY_LOGGED_IN', detail: `连接 ${conn.id} 已登录` };
    }
    // ★ 名字的**字符集**收口（2026-10-13 体检 N3）：先挡非法输入，再做任何世界侧的事。
    //   放在这里而不是 zod 里，是为了能回一个**玩家看得懂的错误码**（zod 失败只会得到 BAD_PACKET）。
    if (!isRoleName(roleId)) {
      return {
        ok: false,
        code: 'ROLE_NAME_INVALID',
        detail: `角色名不合法（需 1–${String(ROLE_NAME_MAX_LENGTH)} 个字符，且不含空白 / 控制字符）`,
      };
    }
    // ★ 在线唯一：重名直接拒，**不覆盖**先到者。
    //   这挡住的正是"抢先注册某个名字，之后所有指向该名字的交互都落到我身上"的冒名路径。
    if (this.#byRoleId.has(roleId)) {
      return { ok: false, code: 'REG_NAME_TAKEN', detail: `角色名「${roleId}」已有人用` };
    }
    const startRoom = this.#world.startRoom;
    if (startRoom === null) {
      return { ok: false, code: 'NOT_FOUND', detail: '世界没有起始房间（area.first 缺失）' };
    }

    const player = new Player({
      oid: this.#oidSpace.next(),
      path: null,
      name: roleId,
      roleId,
      output: this.#outputFor(conn),
      // ★ 世界时钟：战斗节拍要它。世界是角色的时钟来源（单源，见 `World.scheduler`）。
      scheduler: this.#world.scheduler,
      // ★★ 技能注册表（§64）：**不传的话玩家用的是 `EMPTY_REGISTRY`**
      //   —— 于是 `learn` / `practice` 全都报"没有这个技能"，
      //   而这类失败看起来像"内容没写"，其实是"没接线"。
      //   第一版就是漏了这一行，真机探针才把它抓出来（单元测试里 `makePlayer`
      //   一直显式传了 registry，所以单测一直是绿的 —— 这正是"必须真机走一遍"的理由）。
      skillRegistry: this.#world.skillRegistry,
    });

    try {
      startRoom.addItem(player);
    } catch (e) {
      // ★ 人没进世界 ⇒ 上面刚发出的 oid 必须还回去。
      //   否则"满员被拒"这种**失败**路径也会永久吃掉一个 id（见 `logout` 的 T4 注释）。
      this.#oidSpace.release(player.id);
      // 房间容量满：与"服务器人数过多"同语义，玩家应当稍后再试
      return {
        ok: false,
        code: 'LOGIN_TOO_MANY',
        detail: `起始房间 ${startRoom.path} 已满（${e instanceof Error ? e.message : String(e)}）`,
      };
    }

    this.#players.set(conn.id, player);
    this.#byRoleId.set(roleId, player);
    this.#conns.set(conn.id, conn);
    this.#connOfPlayer.set(player, conn);
    // ★ 这里原先有一行 `player.phase = 'playing'`，配合上面 `phase: 'login'`。
    //   两行合起来是恒等变换（缺省就是 `'playing'`），却让人以为"登录期窗口在这里关上"。
    //   见本方法头部 FG-17 的说明：窗口不存在，所以没有要关的东西。

    this.#sendLoginOk(conn, player);
    this.#sendRoom(conn, player);
    // ★ 新来的人也要让**同房的人**知道（否则"他站在我面前我这边看不到"）。
    //   自己这一轮的签名已经由 `#sendRoom` 记下，所以这里不会再被重推一遍。
    this.#reconcileRooms();
    return { ok: true, player };
  }

  /** 断开会话（连接本身由网络层关）。角色先摘出房间，免得留在房间里当幽灵 */
  public logout(conn: NetConnection): boolean {
    const player = this.#players.get(conn.id);
    if (player === undefined) return false;
    player.moveTo(null); // 从房间摘掉（moveTo(null) 不会抛容量错）
    // ★ T4（26 册 §55）：oid 一度**只发不收** —— `login()` 每次发一个，
    //   而这里是唯一"角色离开世界"的出口 ⇒ 不释放的话 `#used` 随历史登录次数
    //   单调增长，启动日志的"已发 id"也会持续漂移。
    this.#oidSpace.release(player.id);
    this.#players.delete(conn.id);
    // ★ 名字的占用随下线释放：否则"重名检查"会退化成"这个名被永久占死"
    this.#byRoleId.delete(player.roleId);
    this.#conns.delete(conn.id);
    this.#sentRooms.delete(conn.id);
    this.#sentStats.delete(conn.id);
    return true;
  }

  /** 给这条连接发一个错误包（网络层拒帧时也要让客户端知道原因） */
  public sendError(conn: NetConnection, code: ErrorCode): void {
    this.#send(conn, errorPacket(code));
  }

  // ── 指令 ────────────────────────────────────────────────────────────────

  /**
   * 一次**世界 tick** 之后的对账。
   *
   * ★ 为什么 tick 之后要同时对账房间与数值：战斗由世界时钟**异步**驱动
   *   （`World.scheduler`），一次出招既能改数值（掉血），也能改房间内容
   *   （NPC 被打死 ⇒ 从房间消失）。会话层不知道哪条路径改了什么，
   *   于是复用与 `handleCommand` 同一套"diff 之后补推"。
   * ★ 生产路径由 `main.ts` 的 `setInterval(…, TICK_MS)` 调；测试手动调
   *   （`timers: false` 时定时器不建，测试自己 `scheduler.step()` + `afterTick()`）。
   */
  public afterTick(): void {
    this.#reconcileRooms();
    this.#reconcileStats();
    this.#pruneTemps();
  }

  /**
   * ★ T5（26 册 §55）：周期清掉**所有活体**的过期 temp 键 —— `Scheduler` 落地后
   *   一直在等的那个消费者（此前 `pruneTemp()` 全仓零生产调用点）。
   *
   * 为什么必须周期跑：`TempStore` 是自由键值袋。`busy` 靠"到点即删"自清，
   * 但冷却（`pfm/<skill>/<pid>`）只在 `canUsePfm()` **被问到时**才清；
   * 写过一次就不再读的键（任务进度、一次性 BUFF）会长期驻留。
   * ⇒ 长寿命对象（常驻 NPC、长期在线的玩家）身上尤其明显。
   */
  #pruneTemps(): void {
    const now = this.#now();
    for (const p of this.#players.values()) p.temp.pruneTemp(now);
    for (const n of this.#world.npcs.values()) n.temp.pruneTemp(now);
  }

  /**
   * 一行指令进来 → `dispatch()`。
   *
   * ★ 阶段由**角色自己的** `phase` 派生，不是这里另记一份：
   *   登录期只放行 `allow_login` 指令这条规则因此只有一处判据（`engine/command.ts`）。
   *
   * ★ 执行完**一律对账一次房间**（`#reconcileRooms`）：移动不再是某种
   *   "特殊指令"—— 任何让角色换了房间的东西（走路、传送、被踢、任务剧情）
   *   都会在这里被发现。会话层因此不必知道"哪条指令会移动"。
   */
  public handleCommand(conn: NetConnection, command: string): void {
    const player = this.#players.get(conn.id);
    if (player === undefined) {
      this.#send(conn, errorPacket('NOT_LOGGED_IN'));
      return;
    }
    dispatch(this.#world.commands, player, command, {
      phase: player.phase,
      nowMs: this.#now(),
    });
    this.#reconcileRooms();
    // ★ 指令也可能改数值（吃药回血、将来的花费内力…），与房间对账同一处理
    this.#reconcileStats();
  }

  // ── 输出通道 ────────────────────────────────────────────────────────────

  /**
   * 把 `CharacterOutput`（引擎侧接口）接到"往这条连接发包"上。
   *
   * ★ FG-15（24 册 §5.3 / 26 册 §28.3）：「断线重连因此只是换一个 `NetConnection` 再
   *   `player.setOutput(...)`」这句话**当时是不实陈述** —— 全仓没有任何
   *   `setOutput` 调用点，而且**构造上不可能有**：`logout()` 会把角色从房间摘掉、
   *   从 `#players` 删掉（"掉线即注销"），所以不存在"跨连接存活的角色"可以换输出通道。
   *
   *   现在这句话只说它**是**什么：本方法负责**新建**一条连接的输出通道。
   *   真·重连（角色对象不重建、状态天然保留，22 册模式 15）要等账号 / 存档批次
   *   把角色从连接生命周期里解耦 —— 在那之前，`Character.setOutput` 是一个
   *   **还没有调用点的接缝**，它的契约由 `tests/session.test.ts` 钉住（见 26 册 §28.3）。
   */
  #outputFor(conn: NetConnection): CharacterOutput {
    return {
      notify: (text) => {
        this.#send(conn, textPacket(text));
      },
      // ★ 面板内文本 → `warn` 帧带 `context`（§80）。**只转不判断**：
      //   "这块面板是不是还开着"是前端的知识，这里多看一层只会多一份会漂的判据。
      //   前端对不上就退回消息流，文本不会丢。
      notifyInPanel: (panelId, text) => {
        this.#send(conn, textPacket(text, panelId));
      },
      sendCommands: (...pairs) => {
        this.#send(conn, cmdsPacket(pairs));
      },
      // ★ 对象详情 → `item` 帧。**这一条以前没人实现**：
      //   协议里 `ItemDetailPacket` 写着、前端 `item` handler 也写着（开面板），
      //   但全仓库没有任何生产者 —— 于是"点 NPC / 点物品"点下去只是把房间描述
      //   再打一遍（26 册 §20.3 的真机记录）。现在由 `select` 指令喂它。
      showItem: (detail) => {
        this.#send(conn, packet({ type: 'item', ...detail }));
      },
      // ★ 属性面板 → `dialog:score` 帧（§62）。wushen 的 `score` 就是
      //   `{type:"dialog",dialog:"score",…}`（`world/cmd/dialog/score.js`），
      //   前端 `src/process/handlers/social.ts` 按 `dialog` 名分派到专用渲染器。
      //   ★ 这里**只转**不加工：`AttrView` 的字段名与前端读的一一对应，
      //     中间加一层改名就会多出一份"谁叫什么"的对照表（24 册铁律 4）。
      showAttr: (view) => {
        this.#send(conn, packet({ type: 'dialog', dialog: 'score', ...view }));
      },
      // ★ 技能面板 → `dialog:skills` 帧（§64）。wushen 的 `cha` 就是
      //   `{type:"dialog",dialog:"skills",items:[…],title,limit,pot}`（`world/cmd/dialog/cha.js`）。
      //   ★ `title` / `limit` / `pot` 与 `items` 都是**服务端算好**的字段名，
      //     这里一个都不改名 —— 改名会多出一份对照表。
      showSkills: (view) => {
        this.#send(conn, packet({ type: 'dialog', dialog: 'skills', ...view }));
      },
      sendChannel: (ch, content, to) => {
        const me = this.#players.get(conn.id);
        if (me === undefined) return;
        this.#deliverChannel(conn, me, ch, content, to);
      },
      // ★ 战斗开始 / 结束 → `combat` 帧。**这一条以前没有生产者**：
      //   协议里 `CombatPacket` 写着、前端也有对应 handler，但全仓零发送点
      //   （与 `showItem` 同一类，26 册 §20.3）。现在由战斗引擎喂它。
      combat: (phase) => {
        this.#send(conn, packet({ type: 'combat', [phase]: 1 }));
      },
      // ★ 死亡 → `die` 帧（带复活按钮）。对照 wushen `USER.check_state()`
      //   （`os/char/user.js:401` 的 `{type:"die",commands:[…]}`）。
      die: (commands) => {
        this.#send(conn, packet({ type: 'die', commands }));
      },
      // ★ 复活 → 同一个 `die` 包的 `relive:true` 那一支（wushen `relive.js:46`）。
      //   前端 `combat.ts` 的 `die` handler 靠 `p['relive'] === true` 分支成"你又活过来了"。
      revive: () => {
        this.#send(conn, packet({ type: 'die', relive: true }));
      },
      // ★ 持续状态 → `state` 帧（26 册 §75）。**这一条以前同样没有生产者**：
      //   协议里 `StatePacket` 写着、前端 `handlers/combat.ts` 也注册了 handler，
      //   但全仓零发送点 —— 于是 wushen 那套"读书 / 练习 / 打坐"的持续状态
      //   在本项目里根本无从表达（`practice` 只能做成一次结算）。
      //   现在由 `Character.startState` / `stopState` 喂它。
      //   ★ `null`（状态结束）也发一帧：`{state:'',desc:''}` —— 前端据此把那条状态收起来。
      state: (view) => {
        this.#send(conn, packet({ type: 'state', state: view?.title ?? '', desc: view?.desc ?? '' }));
      },
    };
  }

  // ── 内部 ────────────────────────────────────────────────────────────────

  #send(conn: NetConnection, text: string): void {
    // 出站也量一次（拼包出错不该静默吃掉带宽）
    const size = checkOutboundSize(text);
    if (!size.ok) {
      // ★ 超限的包**依然不发**，但不再一言不发。
      //   这不是"玩家说错了话"（那种情况在内容层就被 `CHAT_MAX_LENGTH` 拦了），
      //   而是**服务端拼包出错**的信号，所以要给运维侧留一条痕迹；玩家侧不提示
      //   （错不在他，提示反而误导）。26 册 §16.7 第 3 条 / §25。
      this.#onOutboundDrop({ bytes: size.bytes, limit: MAX_MESSAGE_BYTES });
      return;
    }
    // ★ FG-14：`enqueue` 的返回值**必须看**。它 false 的含义是"这条连接已经发不出去"
    //   （接收方积压超限 —— hub 会顺手把连接关掉并遗忘）。旧写法把返回值丢掉，
    //   于是包照样往一条判死的连接上倒。
    if (!this.#hub.enqueue(conn, text)) return;
    for (const out of this.#hub.drain(conn)) conn.send(out);
  }

  // ── 频道投递 ────────────────────────────────────────────────────────────

  /**
   * 把一条频道消息投给该收到的人（受众由 `CHANNEL_SCOPE` 裁决）。
   *
   * ★ 发出去的是**同一条** `msg`（`name` = 发送者），没有第二人称变体：
   *   "阿飞说：你好" 对所有人一样。这样播报文本只有一份，
   *   而"谁说的话"由 `name` 字段承担 —— 前端按 `name === 自己的名字`
   *   渲染成「你」，不需要服务端为每个收件人各拼一遍。
   */
  #deliverChannel(
    self: NetConnection,
    me: Player,
    ch: Channel,
    content: string,
    to?: string,
  ): void {
    const frame = (name: string): string => packet({ type: 'msg', ch, content, name });

    switch (CHANNEL_SCOPE[ch]) {
      case 'self':
        this.#send(self, frame(me.name));
        return;

      case 'world': {
        for (const conn of this.#conns.values()) this.#send(conn, frame(me.name));
        return;
      }

      case 'target': {
        const target = this.#playerNamed(to ?? '');
        if (target === undefined) {
          // 找不到人要说出来：否则玩家以为"发出去了但对方没回"
          this.#send(self, textPacket(`没有找到叫「${to ?? ''}」的人。`));
          return;
        }
        const conn = this.#connOfPlayer.get(target);
        if (conn !== undefined) this.#send(conn, frame(me.name));
        // 发送者这边走回显（叙事流）：`msg` 里没有"这条是我发的"标记，
        // 硬塞进聊天页会和收到的私聊混在一起分不清方向。
        this.#send(self, textPacket(`你对${target.name}说：${content}`));
        return;
      }
    }
  }

  /**
   * 按**角色名**找在线玩家（私聊目标）。
   *
   * ★ 唯一答案（2026-10-13 体检 N3）：走 `#byRoleId` 而不是"遍历所有玩家取第一个
   *   名字匹配的"。原实现的"取第一个"配合"重名可注册"就是一条**冒名**路径。
   * ★ 现在 `name === roleId`，所以按 roleId 查等价于按名字查；
   *   等 T12（存档批次）让角色名独立于 `roleId` 后，这里要改成按名字建索引
   *   —— 26 册 §24 已记该待办（前端 `who === state.roleId` 届时会静默退化）。
   */
  #playerNamed(name: string): Player | undefined {
    const want = name.trim();
    if (want === '') return undefined;
    return this.#byRoleId.get(want);
  }

  // ── 房间对账 ────────────────────────────────────────────────────────────

  /**
   * 一条指令之后，把"服务端知道的房间"与"客户端已知的房间"对账。
   *
   * ★ 判据是**签名**而不是"房间 path"：
   *   `path|同房其它对象 id 排序`。
   *   只比 path 会漏掉一大类变化 —— 有人走进来 / 走了 / 地上多了件东西 ——
   *   那时 path 没变，但客户端手里那份 `items` 已经过期，
   *   表现是"他明明站在我面前，我这边看不到他"。
   */
  #reconcileRooms(): void {
    // ★ 每个房间**只算一次**签名（N5/E13）：签名是"房间这个事实"，同房的人共享一份。
    //   旧实现在循环里对每个玩家各算一次 ⇒ 每条指令 O(玩家数) 次排序+拼串 = O(N²)。
    //   这里先把"path → 签名"建好（`roomSignatureOf` 现在含自己，所以同房必相同 ——
    //   那正是这份 memo 合法的前提，由 `tests/session.test.ts` 的 N5 组钉住）。
    const sigByRoom = new Map<string, string>();
    for (const player of this.#players.values()) {
      const env = player.environment;
      if (env === null || env.path === null) continue;
      if (!sigByRoom.has(env.path)) sigByRoom.set(env.path, roomSignatureOf(player));
    }

    for (const [cid, player] of this.#players) {
      const env = player.environment;
      if (env === null || env.path === null) continue;
      const signature = sigByRoom.get(env.path) ?? '';
      if (signature === '' || this.#sentRooms.get(cid) === signature) continue;
      const conn = this.#conns.get(cid);
      if (conn !== undefined) this.#sendRoom(conn, player);
    }
  }

  #sendLoginOk(conn: NetConnection, player: Player): void {
    this.#send(conn, packet({ type: 'login', id: player.roleId, level: player.level }));
    // ★ 登录后的**数值快照**：前端状态条（气血 / 内力）只认这一帧。
    //   不发它就是"协议里声明了 sc、却从来没有生产者"—— 与 T19 同族，
    //   表现为前端那条血条永远显示 `—`（真机复核时抓到的）。
    this.#pushStats(conn, player);
  }

  /** 推一个 `sc` 帧并**记账**（"客户端已知这个数值"） */
  #pushStats(conn: NetConnection, player: Player): void {
    this.#send(conn, this.#statusPacket(player));
    this.#sentStats.set(conn.id, statSignatureOf(player));
  }

  /**
   * 数值对账：把"服务端现在的数值"与"已经推给客户端的数值"比对，不一致才补推。
   * ★ 与 `#reconcileRooms` 同一处理 —— 会话层不必知道"哪条路径改了血"
   *   （指令 / 世界 tick / 将来的状态系统），只要数值变了就同步。
   */
  #reconcileStats(): void {
    for (const [cid, player] of this.#players) {
      const signature = statSignatureOf(player);
      if (this.#sentStats.get(cid) === signature) continue;
      const conn = this.#conns.get(cid);
      if (conn !== undefined) this.#pushStats(conn, player);
    }
  }

  /** `sc`：角色当前数值（前端 `sc` handler 逐字段合并，缺字段不动） */
  #statusPacket(player: Player): string {
    return packet({
      type: 'sc',
      id: player.id,
      hp: player.hp,
      max_hp: player.maxHp,
      mp: player.mp,
      max_mp: player.maxMp,
    });
  }

  /** 房间描述 + 房间里的人与物（对应 wushen 进房间后推的那几帧） */
  #sendRoom(conn: NetConnection, player: Player): void {
    const env = player.environment;
    if (env === null || env.path === null) return;
    // 从世界表取回 `Room`（`environment` 在类型上只是 `Container`，拿不到 desc/actions）
    const room = this.#world.rooms.get(env.path);
    if (room === undefined) return;
    // ★ 记账必须有：客户端从此"已知这个房间"。漏了这一步，下一条指令
    //   就会把它当成没推过而**重复推**（`#reconcileRooms` 的判据在它身上）。
    this.#sentRooms.set(conn.id, roomSignatureOf(player));
    this.#send(
      conn,
      packet({
        type: 'room',
        path: room.path ?? '',
        name: room.name,
        desc: room.desc,
        // ★ `name` 必须取内容的**显示名**，不能图省事写 `a.cmd`（触发词）。
        //   两者在内容里本来就不一样（`dazuo` vs `打坐`），写成 `a.cmd` 时
        //   界面上那个动词按钮会直接显示原始触发词 —— 而**两边的单测各自都是绿的**：
        //   前端 `web-ui.test.ts` 喂的是正确载荷，服务端测的是别的字段。
        //   这类"两端都对、接线错了"的问题只有真跑一次才看得见（26 册 §16.12）。
        //   回归：`tests/login-e2e.test.ts`（判据落在 `name` 这个区分性字段上）
        commands: room.actions.map((a) => ({ cmd: a.cmd, name: a.name })),
      }),
    );
    this.#send(
      conn,
      packet({
        type: 'exits',
        // 方向 → 目标房间的**名字**（前端把方向显示成中文、点下去发的是方向词，
        // 见 `src/ui/dirs.ts`；出口行与九宫格共用这一份表）
        items: Object.fromEntries([...room.exits].map(([dir, target]) => [dir, target.name])),
      }),
    );
    this.#send(
      conn,
      packet({
        type: 'items',
        items: room.items.filter((o) => o !== player).map((o) => briefOf(o)),
      }),
    );
  }
}

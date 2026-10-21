package mud.core

/**
 * 安卓端的界面状态 —— **不可变数据**，由 [Reduce] 从协议包一步步推出来。
 *
 * ★ 为什么是一整棵树而不是几个 observable 字段（26 册 §83.2）：
 *   网页端出过四次"文本进错框"，每次的根因都是**同一件事分散在两处状态里**
 *   （`absorb` 标志 + `issuing` 命令来源 + `state.fighting`）而某次判断只更新了其中一处。
 *   把"面板开着 + 面板是谁 + 这一轮开始没开始"收进一个不可变对象，
 *   任何一次状态变化都必须**整体**给出新对象 —— 于是"更新了一半"在类型上就写不出来。
 *
 * ★ 这一层不认识 Compose，也不认识 OkHttp：它只认识协议包。
 *   于是全部规则都能在 JVM 上断言（`gradle :core:test`），不需要模拟器。
 */

/** 消息流里一行的种类（对应网页端 `stream.ts` 的 `LineKind`）。 */
enum class LogKind {
    /** 普通服务端文本 */
    TEXT,

    /** 系统提示（本端自己产生的：连接状态、协议问题） */
    SYS,

    /** 出错的回执 */
    ERR,

    /** 进账 / 得物 */
    GAIN,

    /** 战斗回显 */
    FIGHT,

    /** 聊天：私聊（另一个色调） */
    CHAT_TELL,

    /** 聊天：其它频道 */
    CHAT,
}

/**
 * 消息流里的一行。
 *
 * @param text 服务端原文（可能带 `<HIR>` 这类颜色标签；渲染时才解析，见 [parseMarkup]）
 * @param cmds 挂在这一行下面的命令按钮（`cmds` 帧在面板没开时的落点）
 */
data class LogLine(
    val kind: LogKind,
    val text: String,
    val cmds: List<Cmd> = emptyList(),
)

/** 一条命令按钮（协议里的 `CmdItem`：`cmd` 是指令、`name` 是给人看的字） */
data class Cmd(val cmd: String, val name: String) {
    /** 界面上显示的文案：`name` 为空时退回指令本身（与网页端一致） */
    val label: String get() = name.ifEmpty { cmd }
}

/** 房间（`room` 帧） */
data class RoomInfo(
    val path: String,
    val name: String,
    val desc: String,
    val commands: List<Cmd> = emptyList(),
)

/** 房间里的人与物（`items` / `itemadd` 帧；`hp`/`mp` 可能没有） */
data class ActorBrief(
    val id: String,
    val name: String,
    /**
     * 是不是玩家（协议里的 `p === 1`）。
     *
     * ★ 为什么要区分：界面上要能一眼看出"这里还有别的活人"（网页端给 `pl` 类换个色）。
     *   没有这个字段时，玩家和 NPC 长得一样 —— 而这两类东西点开之后的行为不同
     *   （玩家还能私聊）。
     */
    val isPlayer: Boolean = false,
    val hp: Double? = null,
    val maxHp: Double? = null,
    val mp: Double? = null,
    val maxMp: Double? = null,
)

/** 自己（`login` + `sc` 帧拼出来的） */
data class MeState(
    val id: String,
    val level: Int,
    val hp: Double? = null,
    val maxHp: Double? = null,
    val mp: Double? = null,
    val maxMp: Double? = null,
)

/**
 * 物件面板（`item` 帧）。
 *
 * ★★ `id` 是"文本该落到哪儿"的**唯一判据**（§80）：
 *   服务端在 `warn` 帧里声明 `context`，只有与它**相等**时才写进这块面板；
 *   否则一律进消息流。`id == null` = 这块面板不接受任何回显（安全的一侧）。
 *
 * ★ `baseRows` + `roundStarted` 是"一轮交互"的语义（§74）：
 *   面板里再点一次动作 = 新的一轮，正文从物件描述**重来**，不累积历史。
 *   网页端第一版是一路追加，真机上表现为"请教三次，面板堆成三屏"。
 */
data class PanelState(
    val title: String,
    val id: String?,
    val rows: List<String>,
    val baseRows: List<String>,
    val cmds: List<Cmd>,
    val roundStarted: Boolean,
)

/**
 * 提示框（`warn` 帧带命令时）。
 *
 * ★ 与面板的分工不是审美：**带命令的 warn 是"要玩家拿主意"**（确认 / 选择），
 *   它必须盖在最上面、点掉才消失；纯播报进消息流。网页端这条判断从第一版起就在，
 *   是整条路由里唯一不需要猜的分支。
 */
data class PromptState(val text: String, val cmds: List<Cmd>)

/** 登录前的角色列表项（`roles` 帧）；本端目前只用它做"选角界面"，暂未接线（见 §83.6） */
data class RoleBrief(val id: String, val name: String, val title: String)

/** 连接阶段 */
enum class Phase {
    /** 还没连 */
    Idle,

    /** 正在建连接 */
    Connecting,

    /** 连上了但还没登录（可以发 `login`） */
    Connected,

    /** 已登录，在游戏里 */
    InGame,

    /** 断了 / 被踢 */
    Closed,
}

/**
 * 整个界面状态。
 *
 * ★ 字段顺序即"渲染时从上到下"：状态条 → 房间 → 消息流 → 动作栏 → 输入。
 */
data class UiState(
    val phase: Phase = Phase.Idle,
    val log: List<LogLine> = emptyList(),
    val room: RoomInfo? = null,
    val exits: Map<String, String> = emptyMap(),
    val actors: List<ActorBrief> = emptyList(),
    val actions: List<Cmd> = emptyList(),
    val me: MeState? = null,
    val panel: PanelState? = null,
    val prompt: PromptState? = null,
    val status: String = "",
    val fighting: Boolean = false,
    val roles: List<RoleBrief> = emptyList(),
    val authMessage: String = "",
    /**
     * 聊天浮层是不是开着。
     *
     * ★ 这是**唯一**一条"界面开关"进 [UiState] 的字段，理由不是偷懒：
     *   未读计数要不要 +1 依赖它（`Reduce` 收到 `msg` 帧时判断）。
     *   把它留在 `:app` 的 `remember` 里，就得把"加不加未读"这条判断也搬上去 ——
     *   而 §57/§74/§78 三次翻车的根因正是"判断跟着界面状态跑"。
     */
    val chatOpen: Boolean = false,
    /** 聊天未读数（浮层关着时每来一条 +1，打开时清零） */
    val unreadChat: Int = 0,
    /** 当前聊天频道（默认「房间」= `say`） */
    val chatChannel: ChatChannel = ChatChannel.SAY,
    /** 私聊对象（点房间里的**玩家**时设定；NPC 不设） */
    val chatTarget: String? = null,
) {
    /** 追加一行，超出上限丢最旧（与网页端 `MAX_LINES = 400` 同口径） */
    fun withLine(kind: LogKind, text: String, cmds: List<Cmd> = emptyList()): UiState {
        val next = log + LogLine(kind, text, cmds)
        return copy(log = if (next.size > MAX_LOG_LINES) next.takeLast(MAX_LOG_LINES) else next)
    }

    companion object {
        const val MAX_LOG_LINES: Int = 400
        /** 面板最多留多少行（网页端 `panel.ts` 的 `MAX_ROWS`） */
        const val MAX_PANEL_ROWS: Int = 200
    }
}

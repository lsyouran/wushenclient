package mud.core

import mud.protocol.ActionsPacket
import mud.protocol.AddActionPacket
import mud.protocol.ChangepfmPacket
import mud.protocol.ClearDistimePacket
import mud.protocol.CmdsPacket
import mud.protocol.CombatPacket
import mud.protocol.CrossPacket
import mud.protocol.DeleterolePacket
import mud.protocol.DialogPacket
import mud.protocol.DiePacket
import mud.protocol.DispfmPacket
import mud.protocol.DisobjPacket
import mud.protocol.EmotePacket
import mud.protocol.ExitsPacket
import mud.protocol.ItemPacket
import mud.protocol.ItemaddPacket
import mud.protocol.ItemremovePacket
import mud.protocol.ItemsPacket
import mud.protocol.LevelupPacket
import mud.protocol.LoginPacket
import mud.protocol.LoginerrorPacket
import mud.protocol.MapPacket
import mud.protocol.MsgPacket
import mud.protocol.Packet
import mud.protocol.PayPacket
import mud.protocol.PerformPacket
import mud.protocol.RegistPacket
import mud.protocol.RemoveActionPacket
import mud.protocol.RolesPacket
import mud.protocol.RoomPacket
import mud.protocol.ScPacket
import mud.protocol.SettingPacket
import mud.protocol.StatePacket
import mud.protocol.StatusPacket
import mud.protocol.UpdatemapPacket
import mud.protocol.WarnPacket

/**
 * 协议包 → 新状态。**纯函数**：没有 IO、没有时间、没有全局变量。
 *
 * ★★ `when` **没有 `else` 分支**，这是刻意的（33 册的开发规范里那条"类型也是闸门"）：
 *   协议新增一个包类型 ⇒ `Packet` 多一个实现 ⇒ 这里**编译报错**，必须回来决定它的落点。
 *   写 `else -> state` 就得到"新包被静默吞掉" —— 那正是网页端 §80 修了四轮的那类问题
 *   （问题不报错，只是某个界面永远不更新）。
 *
 * ★ 每个"暂时不处理"的分支都**显式列出类名并写明原因**，不用通配：
 *   显式列出 = 新增类型仍然会撞出编译错误；通配 = 新增类型自动被吞。
 */
fun reduce(state: UiState, packet: Packet): UiState = when (packet) {
    is RolesPacket ->
        state.copy(roles = packet.roles.map { RoleBrief(it.id, it.name, it.title) })

    is LoginPacket ->
        // ★★ 登录成功 = **新会话开始**，上一轮的东西必须清掉。
        //   不清的后果是实测出来的：断线重连后，屏幕上还挂着上回的
        //   "连接被拒绝 / 令牌太短"——玩家分不清哪些是这次发生的。
        //   清的是"属于那一次会话的"：消息流、残留弹窗、未读数；
        //   房间/出口/在场者**不清**（服务端登录后会重新发，清空反而先闪一屏空白）。
        state.copy(
            phase = Phase.InGame,
            me = MeState(id = packet.id, level = packet.level),
            authMessage = "",
            log = emptyList(),
            panel = null,
            prompt = null,
            unreadChat = 0,
        )

    is LoginerrorPacket ->
        // ★ 登录失败**不改** `phase`（还停在 Connected，可以重试）。
        //   把错误文案放 `authMessage`，由界面显示 —— 不要 push 进消息流：
        //   那时还没有消息流可看。
        state.copy(authMessage = packet.msg)

    is RegistPacket -> state.copy(authMessage = packet.result)

    is DeleterolePacket ->
        state.copy(roles = state.roles.filter { it.id != packet.roleid })

    // 账号 / 跨服 / 等级：服务端目前**没有生产者**（`SERVER_PACKET_UNWIRED` 台账）。
    // 仍然给一句人话：真发来了能看见，而不是"什么都没发生"。
    is CrossPacket ->
        state.withLine(LogKind.SYS, "【跨服】sid=${packet.sid} 类型=${packet.cross_type} —— 跨服功能尚未启用")

    is LevelupPacket ->
        state.withLine(LogKind.GAIN, "你升到了 ${packet.level} 级。")

    is RoomPacket -> {
        val room = RoomInfo(
            path = packet.path,
            name = packet.name,
            desc = packet.desc,
            commands = packet.commands.map { Cmd(it.cmd, it.name) },
        )
        val changed = state.room != null && state.room.path != packet.path
        // ★ 首次进房间 / 换房间 ⇒ 关面板（旧物件的详情不该留在新房子里）。
        //   单纯 `look` 同一间房（path 没变）不关 —— 否则看物件时一按"环顾"面板就没了。
        val base = if (state.room == null || changed) state.copy(panel = null) else state
        val next = base.copy(room = room)
        // ★ 房间描述**不进消息流**（它在房间区常驻），但"换房间"这件事是事件：
        //   不给一句交代的话，屏幕上只有房间区悄悄换字，消息流一行不动。
        //   首次进房间不播报：登录欢迎语已经说过了（网页端 `world.ts` 同一条判据）。
        if (changed) next.withLine(LogKind.TEXT, "你来到了${room.name}。") else next
    }

    is ExitsPacket -> state.copy(exits = packet.items)

    // ★ 一律用具名实参：`ActorBrief` 的字段顺序是"给不变量看的"，不是给调用点看的 ——
    //   位置实参在**插入一个新字段**时会静默错位（Kotlin 能挡住类型不同的，
    //   挡不住 `hp` 与 `maxHp` 这种同类型的）。
    is ItemsPacket ->
        state.copy(
            actors = packet.items.map {
                ActorBrief(
                    id = it.id,
                    name = it.name,
                    isPlayer = it.p == 1.0,
                    hp = it.hp,
                    maxHp = it.max_hp,
                    mp = it.mp,
                    maxMp = it.max_mp,
                )
            },
        )

    is ItemaddPacket -> {
        val brief = ActorBrief(
            id = packet.id,
            name = packet.name,
            isPlayer = packet.p == 1.0,
            hp = packet.hp,
            maxHp = packet.max_hp,
            mp = packet.mp,
            maxMp = packet.max_mp,
        )
        state.copy(actors = state.actors.filterNot { it.id == brief.id } + brief)
    }

    is ItemremovePacket ->
        state.copy(actors = state.actors.filterNot { it.id == packet.id })

    // ★★ 物件面板：`id` 必须带过去（第四参数），否则之后服务端声明 `context` 的那句话
    //   找不到落脚点，只能进消息流 —— 面板就成了"只读的一次性快照"（§80）。
    is ItemPacket -> {
        val rows = if (packet.desc.isEmpty()) emptyList() else listOf(packet.desc)
        state.copy(
            panel = PanelState(
                title = packet.name.ifEmpty { "物件" },
                id = packet.id.ifEmpty { null },
                rows = rows,
                baseRows = rows,
                cmds = packet.commands.map { Cmd(it.cmd, it.name) },
                roundStarted = true,
            ),
        )
    }

    is ActionsPacket -> state.copy(actions = packet.items.map { Cmd(it.cmd, it.name) })

    is AddActionPacket ->
        state.copy(actions = state.actions + packet.items.orEmpty().map { Cmd(it.cmd, it.name) })

    is RemoveActionPacket -> {
        val items = packet.items.orEmpty().map { Cmd(it.cmd, it.name) }
        val id = packet.id.orEmpty()
        state.copy(
            actions = if (id.isEmpty()) {
                state.actions.filterNot { a -> items.any { it.cmd == a.cmd } }
            } else {
                state.actions.filterNot { it.cmd == id }
            },
        )
    }

    // ★ 面板开着 ⇒ 换面板底部那排按钮（点「打听」得到的「人字号客房」仍属同一个物件的对话）；
    //   面板没开 ⇒ 进消息流（这是登录时房间级动作的落点）。
    //   ★ 这里**不能**顺手写动作栏：那会让 `state.actions`（来自 `actions` 帧）被覆盖掉。
    is CmdsPacket -> {
        val cmds = packet.items.map { Cmd(it.cmd, it.name) }
        val panel = state.panel
        if (panel != null) {
            state.copy(panel = panel.copy(cmds = cmds))
        } else {
            state.withLine(LogKind.TEXT, "", cmds)
        }
    }

    // 地图：小地图由出口表驱动，`map` / `updatemap` 里的数据目前没有消费者（内容层也没有生产者）。
    // 如实说出来，而不是假装处理了 —— 玩家至少知道"不是界面坏了"。
    is MapPacket ->
        state.withLine(LogKind.SYS, "【地图】收到地图数据（${packet.map.size} 处）—— 小地图目前由出口表驱动")

    is UpdatemapPacket ->
        state.withLine(LogKind.SYS, "【地图更新】${packet.n} —— 小地图目前由出口表驱动")

    is WarnPacket -> placeText(
        state = state,
        text = packet.content,
        cmds = packet.cmds.map { Cmd(it.cmd, it.name) },
        context = packet.context,
    )

    // 客户端设置：本端没有"设置"界面（网页端也只是把值存在 `state.setting`）。
    is SettingPacket ->
        state.withLine(LogKind.SYS, "【设置】服务端下发了 ${packet.items.size} 项设置 —— 本端暂未消费")

    is PayPacket ->
        state.withLine(LogKind.SYS, "【支付】订单 ${packet.order_id} —— 支付功能尚未启用")

    is EmotePacket ->
        packet.items.fold(state) { acc, line -> acc.withLine(LogKind.TEXT, line) }

    is CombatPacket -> when {
        packet.start != null -> state.copy(fighting = true)
        packet.end != null -> state.copy(fighting = false)
        else -> state
    }

    is ScPacket -> {
        // ★ `id` 可能是自己，也可能是别人（战斗里对方的血条）—— 两处都要更新：
        //   只更新自己的话，界面上对方的血条永远不动。
        val mine = state.me
        val nextMe = if (mine != null && mine.id == packet.id) {
            mine.copy(
                hp = packet.hp ?: mine.hp,
                maxHp = packet.max_hp ?: mine.maxHp,
                mp = packet.mp ?: mine.mp,
                maxMp = packet.max_mp ?: mine.maxMp,
            )
        } else {
            mine
        }
        val nextActors = state.actors.map {
            if (it.id == packet.id) {
                it.copy(
                    hp = packet.hp ?: it.hp,
                    maxHp = packet.max_hp ?: it.maxHp,
                    mp = packet.mp ?: it.mp,
                    maxMp = packet.max_mp ?: it.maxMp,
                )
            } else {
                it
            }
        }
        state.copy(me = nextMe, actors = nextActors)
    }

    // 状态图标（`status` 帧）：安卓端**还没画那一排图标**，属已知缺口（26 册 §83.6）。
    // 显式列出而不是落到通配 —— 于是它不会因为"多一个分支"而被无声吞掉。
    is StatusPacket -> state

    is DiePacket -> {
        val cmds = packet.commands.orEmpty().map { Cmd(it.cmd, it.name) }
        val died = state.copy(fighting = false, status = "你已阵亡")
        val logged = died.withLine(LogKind.ERR, "你眼前一黑，倒了下去。")
        if (cmds.isEmpty()) logged else logged.copy(prompt = PromptState("你已阵亡。", cmds))
    }

    is StatePacket -> state.copy(status = packet.desc)

    // 下面的四组 + `perform` 属于**绝招 / 冷却**面：数据在、消费者没落地
    // （`SERVER_PACKET_UNWIRED` 台账里写着）。安卓端不做技能面板，先不消费。
    is PerformPacket, is DispfmPacket, is DisobjPacket, is ChangepfmPacket, is ClearDistimePacket -> state

    is MsgPacket -> {
        val who = packet.name.orEmpty()
        // ★ 自己说的话显示成「你」：`msg` 里只有说话人名字，没有"这条是我发的"标记。
        //   ⚠️ 这条比较依赖「名号 == 登录身份」（`login.id`）—— 存档批次落地后角色名
        //      会独立于身份，届时它会**静默退化**成显示自己的名字（不会报错）。
        //      与网页端 `social.ts` 是同一个已知前提，记在同一处待办里。
        val shown = if (who.isNotEmpty() && who == state.me?.id) "你" else who
        val text = if (shown.isEmpty()) packet.content else "$shown：${packet.content}"
        val kind = if (packet.ch == "tell") LogKind.CHAT_TELL else LogKind.CHAT
        val next = state.withLine(kind, text)
        // ★ 未读只在**浮层关着**时累加（与网页端 `noteChat()` 的 `if (chatOpen()) return` 同源）：
        //   浮层开着时玩家正看着，多出来的角标数字是假的（关掉再打开又会清零，看着像丢了消息）。
        if (state.chatOpen) next else next.copy(unreadChat = next.unreadChat + 1)
    }

    is DialogPacket -> {
        val panel = state.panel
        when {
            // `close` 是"面板收起来"；`clear` 只是"内容没了"—— 两者不能合并（F4）
            packet.close == true -> state.copy(panel = null)
            panel == null -> state
            else -> {
                var rows = panel.rows
                val remove = packet.remove
                if (remove != null) rows = rows.toMutableList().also { it.remove(remove) }
                // `clear` 可以是 `true`，也可以是一段（要清的说明文字）；两种都清空行
                if (packet.clear != null) rows = emptyList()
                // 认不出的面板名：如实说一句，别假装渲染了。
                // `score` / `skills` 是结构化面板（分段 / 页签），安卓端还没做（§83.6）。
                state.copy(panel = panel.copy(rows = rows))
            }
        }
    }
}

/**
 * 服务端一段文本的落点 —— **整个安卓端唯一的文本路由判断**（§80）。
 *
 * 三条规则，按顺序：
 *   ① 带命令 ⇒ **提示框**（"要玩家拿主意"：确认 / 选择）；
 *   ② 声明了 `context` 且与面板身份相等 ⇒ **物件面板**；投递失败就往下走；
 *   ③ 其余 ⇒ **消息流**。
 *
 * ★★ 关键的默认方向：**没声明就进消息流**。
 *   网页端在这之前是"面板开着就吸" —— 于是必须拿三个间接信号去猜该不该吸
 *   （命令从哪来 / 是否在战斗 / 面板开着没），§57 / §74 / §78 各错一次，
 *   玩家看到的就是"点 NPC 之后，战报写在木人的操作框里"。
 *   ⇒ 现在没有任何判断依赖"当前局面"，只依赖帧上的一个字段。
 */
fun placeText(
    state: UiState,
    text: String,
    cmds: List<Cmd> = emptyList(),
    context: String? = null,
): UiState {
    if (text.isEmpty()) return state
    if (cmds.isNotEmpty()) return state.copy(prompt = PromptState(text, cmds))

    if (context != null && context.isNotEmpty()) {
        val panel = noteInPanel(state.panel, context, text)
        // ★ 投递失败（面板没开 / 开的是别块）**必须**往下落消息流：
        //   一句话不能因为"它说自己属于某块面板"就消失。
        if (panel != null) return state.copy(panel = panel)
    }
    return state.withLine(LogKind.TEXT, text)
}

/**
 * 把一行声明了归属的文本写进面板；投不出去返回 `null`。
 *
 * 三条判据：
 *   ① 面板没开 / 身份不匹配 ⇒ `null`（调用方落消息流）；
 *   ② 本轮还没开始（上一次是面板内发令）⇒ 先退回 `baseRows`，正文从描述重来（§74）；
 *   ③ 与上一行**逐字相同** ⇒ 不追加（连点五次不该画成五行）。
 */
internal fun noteInPanel(panel: PanelState?, context: String, text: String): PanelState? {
    if (panel == null) return null
    if (panel.id == null || panel.id != context) return null

    var rows = panel.rows
    var started = panel.roundStarted
    if (!started) {
        rows = panel.baseRows
        started = true
    }
    if (rows.lastOrNull() == text) return panel.copy(roundStarted = started)

    rows = rows + text
    if (rows.size > UiState.MAX_PANEL_ROWS) rows = rows.takeLast(UiState.MAX_PANEL_ROWS)
    return panel.copy(rows = rows, roundStarted = started)
}

/**
 * 面板里点了一颗命令按钮：**下一行回显开始新的一轮**（正文从基线重来）。
 *
 * ★ 这是 `panel.ts#panelRun` 在安卓端的等价物，也是它**全部**的语义（§80 之后）。
 *   放在 core 里，是为了让"点面板里的按钮之后面板会重置"这条能在 JVM 上断言 ——
 *   它以前在网页端是靠 DOM 断言间接验的。
 */
fun panelCommandIssued(state: UiState): UiState {
    val panel = state.panel ?: return state
    return state.copy(panel = panel.copy(roundStarted = false))
}

/** 关掉提示框（玩家点了其中一颗按钮 / 点了外面） */
fun dismissPrompt(state: UiState): UiState = state.copy(prompt = null)

/** 关掉物件面板（右上角的 ×、遮罩、换房间） */
fun closePanel(state: UiState): UiState = state.copy(panel = null)

/** 本端自己产生的一行系统消息（连接状态、协议问题）；不经服务端 */
fun systemLine(state: UiState, text: String): UiState = state.withLine(LogKind.SYS, text)

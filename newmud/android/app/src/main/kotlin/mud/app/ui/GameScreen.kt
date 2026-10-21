package mud.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.systemBars
import mud.app.MudViewModel
import mud.core.ActorBrief
import mud.core.Cmd
import mud.core.LogKind
import mud.core.LogLine
import mud.core.MeState
import mud.core.PanelState
import mud.core.Phase
import mud.core.PromptState
import mud.core.UiState
import mud.core.actionBarCommands
import mud.core.exitRows
import mud.core.planMap

/**
 * 主屏：状态条 → 房间 → 消息流 → 动作栏 → 输入。
 *
 * ★ 这个文件里**没有判断**：哪一行该是红的、哪句话该进面板，全部由 [UiState] 决定
 *   （判断在 `:core` 的 `Reduce`，有 JVM 单测）。这里只决定"用什么形状画"。
 *
 * ★ 面板与提示框用 `Dialog` 而不是"盖在消息流上面的一层 View"：
 *   网页端那套是自己算 `top` 的绝对定位，真机上出过"偏左看不全""按钮跑出屏幕"（§60 / §81）。
 *   Compose 的 `Dialog` 由系统负责居中与避让，**没有可以算错的位置**。
 *   代价是它一定会遮住正文 —— 所以只有"要玩家拿主意"和"单个物件的对话"才用它，
 *   纯播报一律进消息流（这条也正是 §80 的结论）。
 */
@Composable
fun GameScreen(vm: MudViewModel, state: UiState) {
    // ★ 根是 `Box`：聊天浮层要**盖在**底部输入框之上，而 `Column` 里做不到"叠一层"。
    //   浮层不占常驻高度（照网页端的 `.pop`），所以不挤消息流。
    Box(modifier = Modifier.fillMaxSize()) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .background(MudColors.Background)
                .windowInsetsPadding(WindowInsets.systemBars)
                .imePadding(),
        ) {
            StatusBar(state.me, state.status, state.fighting)
            if (state.phase == Phase.Closed) {
                ReconnectBar(onReconnect = vm::reconnect)
            }
            RoomSection(state, onCommand = vm::send, onPick = vm::select)
            MessageStream(state.log, vm::send, Modifier.weight(1f))
            // ★ 方向动作**不进**动作栏：它们在出口行和小地图里各有一份（`actionBarCommands`）。
            val cmds = actionBarCommands(state)
            if (cmds.isNotEmpty()) {
                CommandBar(cmds, onCommand = vm::send)
            }
            InputRow(unread = state.unreadChat, onChat = vm::openChat, onSend = vm::send)
        }

        if (state.chatOpen) {
            ChatSheet(
                state = state,
                onChannel = vm::selectChannel,
                onSend = vm::submitChat,
                onClose = vm::closeChat,
                // 底部导航条不归 `imePadding` 管，浮层贴底时要自己让开
                modifier = Modifier.align(Alignment.BottomCenter).navigationBarsPadding(),
            )
        }
    }

    state.panel?.let { panel ->
        PanelDialog(
            panel = panel,
            onCommand = vm::sendPanel,
            onClose = vm::closePanel,
        )
    }
    state.prompt?.let { prompt ->
        PromptDialog(
            prompt = prompt,
            onCommand = { cmd ->
                // ★ 顺序：先发令再关框。反过来的话，服务端的回显可能先到（假传输就是），
                //   而这句回显本该进消息流 —— 它不依赖提示框是否还开着，所以顺序其实不影响结果；
                //   保持一致只是为了让"点一下 = 一件事"读起来清楚。
                vm.send(cmd)
                vm.dismissPrompt()
            },
            onDismiss = vm::dismissPrompt,
        )
    }
}

// ── 状态条 ──────────────────────────────────────────────────────────────────

@Composable
private fun StatusBar(me: MeState?, status: String, fighting: Boolean) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(MudColors.Surface)
            .padding(horizontal = 12.dp, vertical = 6.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                text = me?.let { "${it.id} · ${it.level} 级" } ?: "未登录",
                style = MaterialTheme.typography.bodyMedium.copy(color = MudColors.Text),
                modifier = Modifier.weight(1f),
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            if (fighting) {
                Text("战斗中", color = MudColors.Fight, style = MaterialTheme.typography.bodySmall)
            }
        }
        if (me != null) {
            ResourceBar("气血", me.hp, me.maxHp, MudColors.Error)
            ResourceBar("内力", me.mp, me.maxMp, MudColors.Accent)
        }
        if (status.isNotEmpty()) {
            Text(status, color = MudColors.Dim, style = MaterialTheme.typography.bodySmall, maxLines = 1)
        }
    }
}

/**
 * 一档数值条。
 *
 * ★ 不手算宽度百分比之外的东西：**没有绝对定位**，所以不存在"条跑出屏幕"这种错。
 *   `maxHp` 缺失（服务端可以不发）时不画条，只画数字 —— 画一条满的会撒谎。
 */
@Composable
private fun ResourceBar(label: String, value: Double?, max: Double?, color: androidx.compose.ui.graphics.Color) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier.padding(top = 2.dp),
    ) {
        Text(
            text = label,
            color = MudColors.Dim,
            style = MaterialTheme.typography.bodySmall,
            modifier = Modifier.width(32.dp),
        )
        val fraction = if (value != null && max != null && max > 0) {
            (value / max).coerceIn(0.0, 1.0).toFloat()
        } else {
            0f
        }
        Box(
            modifier = Modifier
                .weight(1f)
                .height(6.dp)
                .background(MudColors.SurfaceAlt, RoundedCornerShape(3.dp)),
        ) {
            if (fraction > 0f) {
                Box(
                    modifier = Modifier
                        .fillMaxWidth(fraction)
                        .height(6.dp)
                        .background(color, RoundedCornerShape(3.dp)),
                )
            }
        }
        Text(
            text = if (value == null || max == null) "—" else "${value.toInt()}/${max.toInt()}",
            color = MudColors.Dim,
            style = MaterialTheme.typography.bodySmall,
            modifier = Modifier.padding(start = 8.dp),
        )
    }
}

@Composable
private fun ReconnectBar(onReconnect: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(MudColors.SurfaceAlt)
            .padding(horizontal = 12.dp, vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text("连接已断开", color = MudColors.Error, style = MaterialTheme.typography.bodySmall, modifier = Modifier.weight(1f))
        TextButton(onClick = onReconnect) { Text("重连", color = MudColors.Accent) }
    }
}

// ── 房间 ────────────────────────────────────────────────────────────────────

/**
 * 房间区：房名 → 描述 →（小地图）→ 明显出口 → 此处有。
 *
 * ★★ 与网页端 `src/ui/room.ts` 的三块**一一对应**，只是形状从 DOM 换成 Compose：
 *   `renderExits` → 出口行、`renderItems` → 人与物、`renderMap` → [MapPanel]。
 *   三块的**内容**（哪些方向、哪些实体、点了发什么）全部来自 `:core`
 *   （`exitRows` / `selectCommandFor` / `planMap`），这里只决定怎么摆。
 *
 * ★ 两处**刻意的形状差异**，都是为了触屏：
 *   ① 网页端的出口是行内可点的 `span`（鼠标点 12px 高的字很好点），
 *      这里必须给每个方向一块独立的、够大的点击区（安卓最小可点尺寸 48dp）；
 *      于是放弃「、」「和」这组分隔符 —— 分离的方块本身就是分隔。
 *   ② 小地图默认**收起**（网页端同样默认 `hidden`，点房名旁的图标才出）：
 *      手机上它要占掉一整段高度，而多数时候玩家只需要出口行。
 *      位置也从"房间区之上"挪到描述之后：展开时房名仍在视野里，
 *      而"不知道自己在哪儿"正是最容易迷路的时刻。
 */
@Composable
private fun RoomSection(state: UiState, onCommand: (String) -> Unit, onPick: (String) -> Unit) {
    var mapOpen by rememberSaveable { mutableStateOf(false) }
    // ★ `remember(键)` 而不是每次重组都算：地图要遍历出口表、算 12 个格位，
    //   而消息流每来一行都会重组整屏。键是"出口表 + 房名"——它们变，图才该变。
    val plan = remember(state.exits, state.room?.name) {
        planMap(state.exits, state.room?.name.orEmpty())
    }
    val exits = remember(state.exits) { exitRows(state.exits) }

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(MudColors.SurfaceAlt)
            // ★ 房间描述可以很长（`look` 出来的详情是"名字 + 描述"两段）。
            //   不收着点，一条长描述就能把消息流挤成一条缝。
            .heightIn(max = ROOM_SECTION_MAX_H)
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 12.dp, vertical = 8.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            // 房名可能带颜色标签（`room` 帧的 `name` 不保证是纯文本）
            MarkupText(
                raw = state.room?.name ?: "未入江湖",
                modifier = Modifier.weight(1f),
                color = MudColors.Accent,
            )
            TextButton(onClick = { mapOpen = !mapOpen }) {
                Text(
                    text = if (mapOpen) "收起地图" else "地图",
                    color = MudColors.Accent,
                    style = MaterialTheme.typography.bodySmall,
                )
            }
        }

        val room = state.room
        if (room != null && room.desc.isNotEmpty()) {
            MarkupText(room.desc, Modifier.padding(top = 4.dp), MudColors.Dim)
        }

        if (mapOpen) {
            MapPanel(plan, onCommand)
        }

        if (exits.isEmpty()) {
            Text(
                text = "这里没有明显的出口。",
                color = MudColors.Dim,
                style = MaterialTheme.typography.bodySmall,
                modifier = Modifier.padding(top = 4.dp),
            )
        } else {
            LazyRow(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                modifier = Modifier.padding(top = 4.dp),
            ) {
                item {
                    Text(
                        text = "这里明显的出口有：",
                        color = MudColors.Dim,
                        style = MaterialTheme.typography.bodySmall,
                        modifier = Modifier.padding(top = 6.dp),
                    )
                }
                items(exits) { row ->
                    // ★ 发的是**方向键本身**（`row.dir`），不是中文 —— 中文只是显示
                    SmallButton(row.label) { onCommand(row.dir) }
                }
            }
        }

        if (state.actors.isNotEmpty()) {
            LazyRow(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                modifier = Modifier.padding(top = 6.dp),
            ) {
                item {
                    Text(
                        text = "这里有：",
                        color = MudColors.Dim,
                        style = MaterialTheme.typography.bodySmall,
                        modifier = Modifier.padding(top = 6.dp),
                    )
                }
                items(state.actors) { actor ->
                    // ★ 点实体 ⇒ 发 `select <id>`（**不是** `look`，见 `:core` 的 `selectCommandFor`）
                    ActorChip(actor) { onPick(actor.id) }
                }
            }
        }
    }
}

/** 房间区最多占多高（超过就内部滚动）—— 给消息流留出可见面积 */
private val ROOM_SECTION_MAX_H = 280.dp

/**
 * 一个人 / 物。
 *
 * ★ 气血内力细条照网页端 `renderItems`：`max_hp > 0` 才画（服务端可以不发血量，
 *   画一条满的会撒谎）。玩家换个边框色 —— 一眼能看出"这里还有别的活人"。
 */
@Composable
private fun ActorChip(actor: ActorBrief, onClick: () -> Unit) {
    Column(
        modifier = Modifier
            .border(
                width = 1.dp,
                color = if (actor.isPlayer) MudColors.Accent else MudColors.Border,
                shape = RoundedCornerShape(4.dp),
            )
            .clickable(onClick = onClick)
            .padding(horizontal = 8.dp, vertical = 4.dp),
    ) {
        MarkupText(
            raw = actor.name,
            color = if (actor.isPlayer) MudColors.Accent else MudColors.Text,
            // ★ 名字按钮按内容宽度收，不能吃掉整行
            fillWidth = false,
        )
        val maxHp = actor.maxHp
        if (maxHp != null && maxHp > 0) {
            MiniBar(actor.hp ?: 0.0, maxHp, MudColors.Error)
            val maxMp = actor.maxMp
            if (maxMp != null && maxMp > 0) {
                MiniBar(actor.mp ?: 0.0, maxMp, MudColors.Accent)
            }
        }
    }
}

/** 宽度固定的小细条（不用测量：宽度写死 48dp，只按比例填色） */
@Composable
private fun MiniBar(value: Double, max: Double, color: androidx.compose.ui.graphics.Color) {
    val fraction = if (max > 0) (value / max).coerceIn(0.0, 1.0).toFloat() else 0f
    Box(
        modifier = Modifier
            .padding(top = 2.dp)
            .width(48.dp)
            .height(3.dp)
            .background(MudColors.Surface, RoundedCornerShape(2.dp)),
    ) {
        if (fraction > 0f) {
            Box(
                modifier = Modifier
                    .fillMaxWidth(fraction)
                    .height(3.dp)
                    .background(color, RoundedCornerShape(2.dp)),
            )
        }
    }
}

// ── 消息流 ──────────────────────────────────────────────────────────────────

@Composable
private fun MessageStream(log: List<LogLine>, onCommand: (String) -> Unit, modifier: Modifier = Modifier) {
    val listState = rememberLazyListState()
    // ★ 新行进来就贴底。网页端是"本来就在底部才跟随"（翻历史时不被拽回来）；
    //   这里先做简单的那一半 —— **翻历史时会被拽回底部**是已知缺口（26 册 §83.6）。
    // ★★ 键用 `log` 而**不是** `log.size`：消息流有 400 行上限（`MAX_LOG_LINES`），
    //   到顶之后 size 恒等于 400 —— 拿 size 当键，第 401 行进来**不会触发**这个 effect，
    //   界面从此再也不贴底（长会话必然踩到，看起来像"消息流卡住不动"）。
    //   `withLine` 每次追加都产出一个新 list 实例，结构相等性因此能区分"又来了新行"。
    LaunchedEffect(log) {
        if (log.isNotEmpty()) listState.animateScrollToItem(log.lastIndex)
    }
    LazyColumn(
        state = listState,
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = 12.dp, vertical = 4.dp),
    ) {
        items(log) { line -> LogRow(line, onCommand) }
    }
}

@Composable
private fun LogRow(line: LogLine, onCommand: (String) -> Unit) {
    Column(modifier = Modifier.padding(vertical = 2.dp)) {
        MarkupText(line.text, color = colorOf(line.kind))
        if (line.cmds.isNotEmpty()) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(top = 2.dp)) {
                for (cmd in line.cmds) SmallButton(cmd.label) { onCommand(cmd.cmd) }
            }
        }
    }
}

private fun colorOf(kind: LogKind): androidx.compose.ui.graphics.Color = when (kind) {
    LogKind.TEXT -> MudColors.Text
    LogKind.SYS -> MudColors.Dim
    LogKind.ERR -> MudColors.Error
    LogKind.GAIN -> MudColors.Gain
    LogKind.FIGHT -> MudColors.Fight
    LogKind.CHAT_TELL -> MudColors.Tell
    LogKind.CHAT -> MudColors.Accent
}

// ── 动作栏 / 输入 ───────────────────────────────────────────────────────────

@Composable
private fun CommandBar(cmds: List<Cmd>, onCommand: (String) -> Unit) {
    LazyRow(
        modifier = Modifier
            .fillMaxWidth()
            .background(MudColors.Surface)
            .padding(horizontal = 8.dp, vertical = 4.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        items(cmds) { cmd -> SmallButton(cmd.label) { onCommand(cmd.cmd) } }
    }
}

@Composable
private fun SmallButton(label: String, onClick: () -> Unit) {
    Box(
        modifier = Modifier
            .border(1.dp, MudColors.Border, RoundedCornerShape(4.dp))
            .clickable(onClick = onClick)
            .padding(horizontal = 10.dp, vertical = 6.dp),
    ) {
        Text(label, color = MudColors.Accent, style = MaterialTheme.typography.bodySmall)
    }
}

/**
 * 指令输入行 + 聊天入口。
 *
 * ★ 聊天**不占**常驻的一行：照网页端 `#chatPop` 做成浮层（[ChatSheet]），这里只放入口。
 *   手机上多一行常驻输入框就是少一行消息流，而玩家多数时候点的是按钮不是打字。
 *
 * ★ 未读数住在 `:core`（`Reduce` 的 `msg` 分支：浮层**关着**才 +1，打开清零），
 *   这里只决定画成什么样：0 不画，超过 99 画 `99+`。
 */
@Composable
private fun InputRow(unread: Int, onChat: () -> Unit, onSend: (String) -> Unit) {
    var text by rememberSaveable { mutableStateOf("") }
    val send = {
        if (text.isNotBlank()) {
            onSend(text)
            text = ""
        }
    }
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(MudColors.Surface)
            .padding(horizontal = 8.dp, vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        ChatEntry(unread = unread, onClick = onChat)
        OutlinedTextField(
            value = text,
            onValueChange = { text = it },
            modifier = Modifier.weight(1f),
            placeholder = { Text("输入指令…", color = MudColors.Dim) },
            singleLine = true,
            textStyle = MaterialTheme.typography.bodyMedium.copy(color = MudColors.Text),
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send),
            keyboardActions = KeyboardActions(onSend = { send() }),
        )
        TextButton(onClick = send) { Text("发送", color = MudColors.Accent) }
    }
}

/**
 * 「聊天」入口 + 未读角标。
 *
 * ★ 角标是**反色**（`Error` 底 + `Background` 字）：深色主题下红底上写红字读不出来，
 *   而这一格的全部信息就是那个数字。
 * ★ 读屏靠 [contentDescription] 一次说清"聊天，N 条未读"—— 数字只有视觉呈现，
 *   不写这一句，TalkBack 用户永远不知道有人在说话（`mergeDescendants` 免得
 *   把"聊天"和数字分两次念）。
 */
@Composable
private fun ChatEntry(unread: Int, onClick: () -> Unit) {
    Row(
        modifier = Modifier
            .padding(end = 6.dp)
            .border(
                width = 1.dp,
                color = if (unread > 0) MudColors.Accent else MudColors.Border,
                shape = RoundedCornerShape(4.dp),
            )
            .clickable(onClick = onClick)
            .padding(horizontal = 10.dp, vertical = 8.dp)
            .semantics(mergeDescendants = true) {
                contentDescription = if (unread > 0) "聊天，$unread 条未读" else "聊天"
            },
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text("聊天", color = MudColors.Accent, style = MaterialTheme.typography.bodySmall)
        if (unread > 0) {
            Box(
                modifier = Modifier
                    .padding(start = 4.dp)
                    .background(MudColors.Error, RoundedCornerShape(8.dp))
                    .padding(horizontal = 5.dp, vertical = 1.dp),
            ) {
                Text(
                    text = if (unread > 99) "99+" else unread.toString(),
                    color = MudColors.Background,
                    style = MaterialTheme.typography.bodySmall,
                )
            }
        }
    }
}

// ── 面板 / 提示框 ───────────────────────────────────────────────────────────

@Composable
private fun PanelDialog(panel: PanelState, onCommand: (String) -> Unit, onClose: () -> Unit) {
    androidx.compose.ui.window.Dialog(onDismissRequest = onClose) {
        Surface(
            shape = RoundedCornerShape(8.dp),
            color = MudColors.Surface,
            modifier = Modifier.fillMaxWidth(),
        ) {
            Column(modifier = Modifier.padding(12.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        text = panel.title,
                        color = MudColors.Accent,
                        style = MaterialTheme.typography.bodyMedium,
                        modifier = Modifier.weight(1f),
                    )
                    TextButton(onClick = onClose) { Text("关闭", color = MudColors.Dim) }
                }
                // ★ 正文可滚：长描述不能把底部按钮挤出屏幕（网页端 §81 量过这一条）
                LazyColumn(modifier = Modifier.weight(1f, fill = false)) {
                    items(panel.rows) { row ->
                        MarkupText(row, Modifier.padding(vertical = 2.dp))
                    }
                }
                if (panel.cmds.isNotEmpty()) {
                    Row(
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        modifier = Modifier.padding(top = 8.dp),
                    ) {
                        for (cmd in panel.cmds) SmallButton(cmd.label) { onCommand(cmd.cmd) }
                    }
                }
            }
        }
    }
}

@Composable
private fun PromptDialog(prompt: PromptState, onCommand: (String) -> Unit, onDismiss: () -> Unit) {
    androidx.compose.ui.window.Dialog(onDismissRequest = onDismiss) {
        Surface(shape = RoundedCornerShape(8.dp), color = MudColors.Surface) {
            Column(modifier = Modifier.padding(14.dp)) {
                MarkupText(prompt.text)
                Row(
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    modifier = Modifier.padding(top = 10.dp).fillMaxWidth(),
                ) {
                    for (cmd in prompt.cmds) SmallButton(cmd.label) { onCommand(cmd.cmd) }
                }
            }
        }
    }
}

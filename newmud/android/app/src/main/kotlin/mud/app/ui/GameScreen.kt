@file:OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)

package mud.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
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
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextAlign
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

/**
 * 顶部状态条。
 *
 * ★ 三行压成两行半：名字与"战斗中"同一行，气血/内力各一行但只占 5dp 高，
 *   最后一行留给服务端发来的 `status`。原来每块都各占一行、各带一份上下内边距，
 *   在 5 英寸屏上白吃掉将近 40dp —— 那是三行消息的高度。
 *
 * ★ 数值**右对齐且定宽**：不定宽的话"12/100"和"100/100"会把条形推来推去，
 *   每次掉血都看到条在左右抖。
 */
@Composable
private fun StatusBar(me: MeState?, status: String, fighting: Boolean) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(MudColors.Surface)
            .padding(horizontal = 12.dp, vertical = 6.dp),
        verticalArrangement = Arrangement.spacedBy(3.dp),
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
                // ★ 做成一颗反色小牌而不是一行同色小字：战斗状态是"现在正发生什么"，
                //   它得能在余光里被扫到 —— 同色 bodySmall 在深色底上等于没有
                Text(
                    text = "战斗中",
                    color = MudColors.Background,
                    style = MaterialTheme.typography.bodySmall,
                    modifier = Modifier
                        .background(MudColors.Fight, MudShapes.Sharp)
                        .padding(horizontal = 6.dp, vertical = 1.dp),
                )
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
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text(
            text = label,
            color = MudColors.Dim,
            style = MaterialTheme.typography.bodySmall,
            modifier = Modifier.width(28.dp),
        )
        val fraction = if (value != null && max != null && max > 0) {
            (value / max).coerceIn(0.0, 1.0).toFloat()
        } else {
            0f
        }
        Box(
            modifier = Modifier
                .weight(1f)
                .height(5.dp)
                .background(MudColors.SurfaceAlt, MudShapes.Sharp),
        ) {
            if (fraction > 0f) {
                Box(
                    modifier = Modifier
                        .fillMaxWidth(fraction)
                        .height(5.dp)
                        .background(color, MudShapes.Sharp),
                )
            }
        }
        Text(
            text = if (value == null || max == null) "—" else "${value.toInt()}/${max.toInt()}",
            color = MudColors.Dim,
            style = MaterialTheme.typography.bodySmall,
            // ★ 定宽 + 右对齐：数值长短变化时条形不会跟着伸缩（见上面那段）
            modifier = Modifier
                .width(64.dp)
                .padding(start = 8.dp),
            textAlign = TextAlign.End,
            maxLines = 1,
        )
    }
}

@Composable
private fun ReconnectBar(onReconnect: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(MudColors.Error.copy(alpha = 0.14f))
            .padding(horizontal = 12.dp, vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text(
            text = "连接已断开",
            color = MudColors.Error,
            style = MaterialTheme.typography.bodySmall,
            modifier = Modifier.weight(1f),
        )
        MudAction(label = "重连", onClick = onReconnect)
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
 *      这里必须给每个方向一块独立的、够大的点击区（[MudAction] 的 44dp 最小高度）；
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
            MudAction(
                label = if (mapOpen) "关地图" else "小地图",
                onClick = { mapOpen = !mapOpen },
                selected = mapOpen,
            )
        }

        val room = state.room
        if (room != null && room.desc.isNotEmpty()) {
            MarkupText(room.desc, Modifier.padding(top = 4.dp), MudColors.Dim)
        }

        if (mapOpen) {
            MapPanel(plan, onCommand)
        }

        // ★★ 分组标题「出口」**放在 LazyRow 外面**。
        //   原来是 `LazyRow` 的第一个 item，于是往右一滑它就跟着滑走了 ——
        //   剩下的是一排方向名字，看起来像按钮栏而不是"从哪儿出去"。
        //   代价是标题常驻 30dp 宽，换来的是"这一排是什么"永远在场。
        if (exits.isEmpty()) {
            Text(
                text = "这里没有明显的出口。",
                color = MudColors.Dim,
                style = MaterialTheme.typography.bodySmall,
                modifier = Modifier.padding(top = 4.dp),
            )
        } else {
            LabelledRow(label = "出口") {
                items(exits) { row ->
                    // ★ 发的是**方向键本身**（`row.dir`），不是中文 —— 中文只是显示
                    MudAction(label = row.label, onClick = { onCommand(row.dir) })
                }
            }
        }

        if (state.actors.isNotEmpty()) {
            LabelledRow(label = "此处") {
                items(state.actors) { actor ->
                    // ★ 点实体 ⇒ 发 `select <id>`（**不是** `look`，见 `:core` 的 `selectCommandFor`）
                    ActorChip(actor) { onPick(actor.id) }
                }
            }
        }
    }
}

/**
 * 「固定标题 + 横向可滑的一排」。
 *
 * ★ 抽出来是因为出口和在场者用的是同一个形状：标题不动、内容滑。
 *   两处各写一遍的话，改一处忘另一处就又不齐了（这个文件里已经有过一次：
 *   出口 6dp、在场者 6dp，但"明显出口有"是长句子而"这里有"是短句，字宽不同）。
 */
@Composable
private fun LabelledRow(label: String, content: androidx.compose.foundation.lazy.LazyListScope.() -> Unit) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier.padding(top = 6.dp),
    ) {
        Text(
            text = label,
            color = MudColors.Dim,
            style = MaterialTheme.typography.bodySmall,
            // ★ 定宽：出口和在场者两块要对齐成一条竖线，否则两块标题长短不同、内容起点错开
            modifier = Modifier.width(32.dp),
        )
        LazyRow(
            modifier = Modifier.weight(1f),
            horizontalArrangement = Arrangement.spacedBy(6.dp),
            content = content,
        )
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
            // 与 MudAction 同一套尺寸，否则"点方向"和"点人"两排手感不一样
            .defaultMinSize(minHeight = 44.dp)
            .border(
                width = 1.dp,
                color = if (actor.isPlayer) MudColors.Accent else MudColors.Border,
                shape = MudShapes.Sharp,
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
            .background(MudColors.Surface, MudShapes.Sharp),
    ) {
        if (fraction > 0f) {
            Box(
                modifier = Modifier
                    .fillMaxWidth(fraction)
                    .height(3.dp)
                    .background(color, MudShapes.Sharp),
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
            // ★ `FlowRow` 而不是 `Row`：一行消息后面可以挂任意多个按钮（面板类文本常见），
            //   `Row` 超出屏幕的部分**直接被裁掉**且没有任何提示 —— 玩家只会觉得"少了个选项"
            FlowRow(
                horizontalArrangement = Arrangement.spacedBy(6.dp),
                verticalArrangement = Arrangement.spacedBy(6.dp),
                modifier = Modifier.padding(top = 4.dp),
            ) {
                for (cmd in line.cmds) {
                    MudAction(label = cmd.label, onClick = { onCommand(cmd.cmd) })
                }
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
            .padding(horizontal = 8.dp, vertical = 6.dp),
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        items(cmds) { cmd -> MudAction(label = cmd.label, onClick = { onCommand(cmd.cmd) }) }
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
            .padding(horizontal = 8.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        ChatEntry(unread = unread, onClick = onChat)
        MudField(
            value = text,
            onValueChange = { text = it },
            placeholder = "输入指令…",
            modifier = Modifier.weight(1f),
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send),
            keyboardActions = KeyboardActions(onSend = { send() }),
        )
        MudAction(label = "发送", onClick = send)
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
            .defaultMinSize(minHeight = 44.dp)
            .background(
                color = if (unread > 0) MudColors.Accent.copy(alpha = 0.12f) else Color.Transparent,
                shape = MudShapes.Sharp,
            )
            .border(
                width = 1.dp,
                color = if (unread > 0) MudColors.Accent else MudColors.Border,
                shape = MudShapes.Sharp,
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
                    .background(MudColors.Error, MudShapes.Soft)
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

/**
 * 物件面板。
 *
 * ★★ 三处改动都是"真机上会坏"的地方，不是审美：
 *   ① 标题下加一条分隔线 —— 原来标题和正文同色同字号，读起来像"标题是第一行正文"；
 *   ② 正文 `LazyColumn` 给死上限（[PANEL_BODY_MAX_H]），按钮区才有位置：
 *      原来靠 `weight(1f, fill=false)`，而外层 `Column` 的高度是**由内容决定的**，
 *      行多时按钮会被顶出对话框；
 *   ③ 按钮改 `FlowRow`：一排横着摆，按钮一多就**溢出到屏幕外**（网页端 §81 量过同一处）。
 */
@Composable
private fun PanelDialog(panel: PanelState, onCommand: (String) -> Unit, onClose: () -> Unit) {
    androidx.compose.ui.window.Dialog(onDismissRequest = onClose) {
        MudPanel(modifier = Modifier.fillMaxWidth()) {
            Column {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    modifier = Modifier.padding(start = 14.dp, end = 6.dp, top = 6.dp, bottom = 6.dp),
                ) {
                    Text(
                        text = panel.title,
                        color = MudColors.Accent,
                        style = MaterialTheme.typography.bodyMedium,
                        modifier = Modifier.weight(1f),
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis,
                    )
                    MudAction(label = "关闭", onClick = onClose)
                }
                HorizontalDivider(thickness = 1.dp, color = MudColors.Border)
                // ★ 正文可滚：长描述不能把底部按钮挤出屏幕（网页端 §81 量过这一条）
                LazyColumn(
                    modifier = Modifier
                        .heightIn(max = PANEL_BODY_MAX_H)
                        .padding(horizontal = 14.dp, vertical = 8.dp),
                ) {
                    items(panel.rows) { row ->
                        MarkupText(row, Modifier.padding(vertical = 2.dp))
                    }
                }
                if (panel.cmds.isNotEmpty()) {
                    HorizontalDivider(thickness = 1.dp, color = MudColors.Border)
                    FlowRow(
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                        modifier = Modifier.padding(10.dp),
                    ) {
                        for (cmd in panel.cmds) {
                            MudAction(label = cmd.label, onClick = { onCommand(cmd.cmd) })
                        }
                    }
                }
            }
        }
    }
}

/** 面板正文的最大高度：留出标题 + 按钮区，剩下都归它滚 */
private val PANEL_BODY_MAX_H = 320.dp

/**
 * 提示框（服务端问一句、等一个答复）。
 *
 * ★ 与 [PanelDialog] 分开是因为**它不该被随手关掉**：面板是"看看有什么"，
 *   提示框是"你得选一个"。所以这里没有"关闭"按钮 —— 只有服务端给的选项，
 *   以及点框外（`onDismissRequest`）表示"我不选"。
 */
@Composable
private fun PromptDialog(prompt: PromptState, onCommand: (String) -> Unit, onDismiss: () -> Unit) {
    androidx.compose.ui.window.Dialog(onDismissRequest = onDismiss) {
        MudPanel(modifier = Modifier.fillMaxWidth()) {
            Column(
                modifier = Modifier.padding(14.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                // 长提示同样要能滚（`look` 一个物件常有几百字）
                Column(
                    modifier = Modifier
                        .heightIn(max = PROMPT_BODY_MAX_H)
                        .verticalScroll(rememberScrollState()),
                ) {
                    MarkupText(prompt.text)
                }
                FlowRow(
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    for (cmd in prompt.cmds) {
                        MudAction(label = cmd.label, onClick = { onCommand(cmd.cmd) })
                    }
                }
            }
        }
    }
}

/** 提示框正文的最大高度 */
private val PROMPT_BODY_MAX_H = 260.dp

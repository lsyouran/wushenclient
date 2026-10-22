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
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.systemBars
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Badge
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.minimumInteractiveComponentSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
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
 * 主屏：状态条 →（断线条）→ 房间 → 消息流 → 动作栏 → 输入。
 *
 * ★ 这个文件里**没有判断**：哪一行该是红的、哪句话该进面板，全部由 [UiState] 决定
 *   （判断在 `:core` 的 `Reduce`，有 JVM 单测）。这里只决定"用什么形状画"。
 *
 * ★★ **版式照 wushen 的分区法重排**（§92.5.1）：
 *   · 全屏**只有一个底色** `Background`(#000)；
 *   · 区块之间**只用一条 `Hairline`(#343434) 发丝线**分隔，线画在**上一个**区块的下沿；
 *   · `Recessed`(#111) 在主屏里**只给状态条**（与断线条）；
 *   · `Band`(#222) **只归浮层的头脚带**（主屏里一条都没有）。
 *
 * ★★ **全屏只有一个竖向滚动器**：消息流（[MessageStream]）。
 *   房间区改回 wushen 的"不限高、内部不滚"（`style.css:345-356` 把"两个滚动器"当教训记着），
 *   长描述靠 **`maxLines = ` [MudSizes.RoomDescLines] + 「展开」**兜住 ——
 *   展开态房间区与消息流各 `weight(1f)` ⇒ 各占一半，但房间区**仍然不滚**。
 *   代价要写清：展开态下消息流只剩半屏。这是刻意的 —— "我在读房间详情"时消息流本就次要，
 *   而"两个滚动器"的代价（不知道该滚哪个）比"半屏消息流"大。
 *
 * ★ 面板与提示框用 `Dialog` 而不是"盖在消息流上面的一层 View"：
 *   网页端那套是自己算 `top` 的绝对定位，真机上出过"偏左看不全""按钮跑出屏幕"（§60 / §81）。
 *   Compose 的 `Dialog` 由系统负责居中与避让，**没有可以算错的位置**。
 *   代价是它一定会遮住正文 —— 所以只有"要玩家拿主意"和"单个物件的对话"才用它，
 *   纯播报一律进消息流（这条也正是 §80 的结论）。
 *
 * ★★ **§94（2026-10-22）只重排了房间区里的地图，理由来自"点"和"看"的距离：**
 *
 *   ① 房名行的开关与地图**必须挨着**。上一版把地图做成"底部弹出卡片"（`MapSheet`），
 *      开关在房名行、卡片在屏幕最下面，中间隔着整屏消息流 —— 点完还得跨屏看结果，
 *      而且卡片会盖住输入行与动作栏（正是它们要用的东西）。wushen 里 `.map-panel`
 *      就在 `.room-title` 旁边（`wushen/src/game/main.js:30-33`），开关 `.room-title>.map-icon`
 *      也在房名行里 —— **点开的东西必须紧贴点它的东西**。这是用户改判，不是我们改主意。
 *   ② 全屏**仍然只有一个竖向滚动器**（消息流）：地图是**固定高度**的，
 *      **不给地图加滚动** —— 给它开滚动就是第二个滚动器
 *      （`style.css:345-356` 把这条当过教训），而且"看地图"这个动作本来就不该需要滚。
 *   ③ 高度预算（360dp 宽的竖屏，逐块列来源；改版式前先照这张表算一遍）：
 *
 *      | 块 | 高 | 来源 |
 *      |---|---|---|
 *      | 状态条 | ≈ 80 | 行1 `bodyMedium` 20 + 行2 `bodySmall` 16 + 行3 `bodySmall` 16 + `Gap1`×4 + `Gap2`×2 + `HairlineW`（me 有但 status 空 ≈ 61；未登录只有一行 ≈ 41） |
 *      | 房名行 | 32 | `ChipH` |
 *      | 地图 | ≈ 118 | `frameOf()` 满格 112 + `Gap2` |
 *      | 描述 | 120 | `RoomDescLines` 6 × 20sp 行高 |
 *      | 出口行 | ≈ 38 | `ChipH` + `Gap2` |
 *      | 此处行 | ≈ 50 | `ControlH` + `Gap2` |
 *      | 区块上下内边距 | 16 | `BlockPadV` × 2 |
 *      | 动作栏 | ≈ 48 | `ChipH` + `BlockPadV` × 2 |
 *      | 输入行 | ≈ 72 | `MudField` 自然高 56 + `BlockPadV` × 2 |
 *      | 发丝线 | 2 | `HairlineW` × 2 |
 *
 *      **地图那 112 怎么来的**（`core/MapLayout.kt` 的 `frameOf()`，别用估的）：
 *      格高 `MAP_CELL_H` 26、三行格位的中心 `MAP_CY` 与 `±39`，上下各 `MAP_FRAME_PAD_Y` 4：
 *      上沿 `25−13=12`、下沿 `103+13=116` ⇒ `104 + 8 = 112`（**满 8 格的最坏情形**）；
 *      只有中心格（空房间）时 `26 + 8 = 34`。
 *      ★ 常见的错算有两种：按"3 × 26 + 2 × 4 = 86"算**漏了行与行之间 13dp 的空隙**
 *        （行距 39 − 格高 26 = 13，共两段）；按"156"算是把格高估成了 52。
 *
 *      ⇒ 固定块：**地图关着 ≈ 458dp**、**地图全开 ≈ 576dp**。
 *        360×640 扣掉系统栏后可用高约 568dp ⇒ 地图关着时消息流 ≈ 110dp（5 行），
 *        全开时 ≈ 0dp。
 *
 *      ⇒ 结论：地图是**固定 112dp（空房 34dp）的九宫格，最多 3 行格位**，不会自己长大；
 *        **不要**给它加滚动，也**不要**再动描述的限行数（[MudSizes.RoomDescLines] 是
 *        长描述唯一的出口）。
 *      ⚠️ 但"小屏 + 满格地图 + 6 行描述"这一档确实贴着 0（这正是 §94 讨论过的）：
 *        真要再省，正路只有两条 —— ① 窄屏（< 300dp）把侧向格位收成 2 行（改 `:core`）；
 *        ② 明确立一个"描述再矮一档"的需求。**不是**给地图加滚动，也**不是**在这里
 *        悄悄改 `RoomDescLines`。
 */
@Composable
fun GameScreen(vm: MudViewModel, state: UiState) {
    // ★★ 房间区展开态住在**主屏**而不是 `RoomSection` 里：展开时要给房间区加 `weight(1f)`，
    //   而权重只能由父亲（`Column`）分配 —— 子组件自己拿不到"我要不要分一半"这件事。
    var roomExpanded by rememberSaveable { mutableStateOf(false) }

    // ★★ 地图的开合也住在**主屏**而不是 `RoomSection` 里：它要顺手把 `roomExpanded` 关掉
    //   （描述展开态与地图都吃高度，两个一起开就把消息流压没了），
    //   而 `roomExpanded` 也归这一屏 —— 只有主屏同时够得着这两个开关。
    var mapOpen by rememberSaveable { mutableStateOf(false) }

    // ★★ **不再与聊天浮层互斥**（§94）。上一版互斥的理由是"两张卡片都贴在根 Box 的底部，
    //   同时开着会互相盖住，而玩家只看到最上面那一张 —— 另一张就成了'点了没反应'"。
    //   地图搬进房间区（房名行下方就地展开）之后，根 Box 的底部只剩 [ChatSheet] 一张，
    //   **没有第二张可盖** ⇒ 那条理由已经不存在。留着互斥反而有害：
    //   "看一眼地图就必须丢掉聊天里的半行字"是凭空多出来的限制。
    //   ⇒ 这里只做一件仍然必要的事：开地图时收起描述的展开态（见上面的高度预算）。
    val toggleMap = {
        val next = !mapOpen
        mapOpen = next
        if (next) roomExpanded = false
    }

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
            StatusBar(me = state.me, status = state.status, fighting = state.fighting)
            if (state.phase == Phase.Closed) {
                ReconnectBar(onReconnect = vm::reconnect)
            }
            RoomSection(
                state = state,
                expanded = roomExpanded,
                mapOpen = mapOpen,
                onToggleExpand = { roomExpanded = !roomExpanded },
                onToggleMap = toggleMap,
                onCommand = vm::send,
                onPick = vm::select,
                modifier = if (roomExpanded) Modifier.weight(1f) else Modifier,
            )
            MessageStream(log = state.log, onCommand = vm::send, modifier = Modifier.weight(1f))
            // ★ 消息流与下面两块之间各一条发丝线（"区块之间只用一条线"）
            HorizontalDivider(
                color = MudColors.Hairline,
                thickness = MudSizes.HairlineW,
            )
            // ★ 方向动作**不进**动作栏：它们在出口行和小地图里各有一份（`actionBarCommands`）。
            val cmds = actionBarCommands(state)
            if (cmds.isNotEmpty()) {
                CommandBar(cmds = cmds, onCommand = vm::send)
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
                modifier = Modifier
                    .align(alignment = Alignment.BottomCenter)
                    .navigationBarsPadding(),
            )
        }

        // ★ 地图**不在这个 Box 里**（§94）：它搬进了 [RoomSection]，紧跟房名行就地展开。
        //   ⇒ 这里不再有第二张贴底卡片，也就不需要"谁关谁"的互斥（见上面 `toggleMap`）。
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
 * 顶部状态条：**全屏唯一一块凹面**（§92.4）。
 *
 * ★★ 三行（待定项 #2 的裁决）：行1 名号 + 等级 +「战斗中」／行2 气血 + 内力／行3 status。
 *   wushen 是"一行 + 横向滚动"（`style.css:780` 的 `overflow-x: auto`），
 *   这里**不照抄**，理由：名号 + 两条 + 数值塞不进 360dp，横滚会让"随时要看的东西"
 *   有一半在屏幕外 —— 状态条是最不该需要滚动的地方。
 *
 * ★ 三件形状照抄 wushen `.state-bar`（`style.css:786-790`）：
 *   ① `#111` 底（`--panel`）；② `border-radius: 0.5em` ⇒ [MudShapes.Control]；
 *   ③ **左侧 2px 绿竖线**（`border-left: 2px solid var(--fg)`）⇒ [MudSizes.MarkerW]。
 *
 * ★ 名号用 `Name`(#FFFF00) 而不是 `Ui`(#C0C0C0)：照 wushen `.state-bar>.who{color:var(--yellow)}`
 *   （`style.css:806`）。旧版这里用的是界面灰 —— 于是"我是谁"和"这是个按钮"同色，
 *   这正是用户说"最上方个人信息黑乎乎一片"的根因（§92.1 第 1 条）。
 *
 * ★ 数值**右对齐且定宽**：不定宽的话"12/100"和"100/100"会把条形推来推去，
 *   每次掉血都看到条在左右抖。
 */
@Composable
private fun StatusBar(me: MeState?, status: String, fighting: Boolean) {
    Column(modifier = Modifier.fillMaxWidth()) {
        // 凹面卡片：外圈留屏边距 ⇒ 卡片是"嵌在页里的一块"，不是"又一层整屏底"
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = MudSizes.ScreenPadH, vertical = MudSizes.Gap2)
                .clip(shape = MudShapes.Control)
                .background(color = MudColors.Recessed)
                // ▍左竖线用 `drawBehind` 而不是再叠一个 `Box`：它的高度要等于卡片高度，
                //   而卡片高度由内容决定 —— 叠 Box 得靠 `fillMaxHeight`，那在
                //   "父亲是 wrap content" 时会拿到**无界**约束（§92.5.1 踩过一次）。
                .drawBehind {
                    drawRect(
                        color = MudColors.Text,
                        topLeft = Offset.Zero,
                        size = Size(width = MudSizes.MarkerW.toPx(), height = size.height),
                    )
                }
                .padding(
                    start = MudSizes.MarkerW + MudSizes.Gap1,
                    end = MudSizes.Gap2,
                    top = MudSizes.Gap1,
                    bottom = MudSizes.Gap1,
                ),
            verticalArrangement = Arrangement.spacedBy(space = MudSizes.Gap1),
        ) {
            // ── 行 1：名号（黄）+ 等级（灰）+ 战斗中 ──
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    text = me?.id ?: "未登录",
                    color = MudColors.Name,
                    style = MaterialTheme.typography.bodyMedium,
                    modifier = Modifier.weight(weight = 1f),
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                if (me != null) {
                    Text(
                        text = "${me.level} 级",
                        color = MudColors.Dim,
                        style = MaterialTheme.typography.bodySmall,
                        modifier = Modifier.padding(start = MudSizes.Gap2),
                        maxLines = 1,
                    )
                }
                if (fighting) {
                    // ★ 做成一颗反色小牌而不是一行同色小字：战斗状态是"现在正发生什么"，
                    //   它得能在余光里被扫到 —— 同色 bodySmall 在深色底上等于没有
                    Text(
                        text = "战斗中",
                        color = MudColors.Background,
                        style = MaterialTheme.typography.bodySmall,
                        modifier = Modifier
                            .padding(start = MudSizes.Gap2)
                            .background(color = MudColors.Fight, shape = MudShapes.Tag)
                            .padding(
                                horizontal = MudSizes.Gap2,
                                vertical = MudSizes.HairlineW,
                            ),
                    )
                }
            }

            // ── 行 2：气血 / 内力，两条各 `weight(1f)` ──
            if (me != null) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(space = MudSizes.Gap3),
                ) {
                    Box(modifier = Modifier.weight(weight = 1f)) {
                        ResourceBar(
                            label = "气血",
                            value = me.hp,
                            max = me.maxHp,
                            color = MudColors.Hp,
                        )
                    }
                    Box(modifier = Modifier.weight(weight = 1f)) {
                        ResourceBar(
                            label = "内力",
                            value = me.mp,
                            max = me.maxMp,
                            color = MudColors.Mp,
                        )
                    }
                }
            }

            // ── 行 3：服务端给的 status（有才画）──
            if (status.isNotEmpty()) {
                Text(
                    text = status,
                    color = MudColors.Dim,
                    style = MaterialTheme.typography.bodySmall,
                    maxLines = 1,
                )
            }
        }
        // 下沿发丝线：状态条与下面一块的分界（§92.6.4）
        HorizontalDivider(color = MudColors.Hairline, thickness = MudSizes.HairlineW)
    }
}

/**
 * 一档数值条（状态条行 2 的左右两半）。
 *
 * ★★ 现在就是 Material3 的 [LinearProgressIndicator]，只喂颜色 ——
 *   不再是自己算比例、用 `fillMaxWidth(fraction)` 画的那个嵌套 `Box`。
 *   换掉的理由不是省代码（省不了几行），是组件自带 `progress` 的**语义**：
 *   读屏会把它读成"进度 42%"，而自绘的方块对无障碍来说只是两个装饰矩形。
 *
 * ★ `max` 缺失（服务端可以不发）时**不画条**，只画数字 —— 画一条满的会撒谎。
 *   这时走占位分支（整条不画），而不是传 `null` 让 LPI 画流动的条 ——
 *   那同样是撒谎。
 *
 * ★ `trackColor` 用 `Hairline`：wushen 的 `.progress` 有一道 1px 边框把条形框住，
 *   而 `darkred` / `darkblue` 在纯黑底上几乎看不见 —— 轨道就是那道边框的替代品。
 *
 * ★ `strokeCap = Round`：条在方形端头下像一根被切齐的棍子，
 *   圆头让它读起来是"一截填充"而不是"一块被裁掉的矩形"。
 */
@Composable
private fun ResourceBar(label: String, value: Double?, max: Double?, color: Color) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text(
            text = label,
            // ★ 标签用最弱的一档：它是"这一格是什么"，不该跟数值抢视线
            color = MudColors.Faint,
            style = MaterialTheme.typography.bodySmall,
            modifier = Modifier.width(width = MudSizes.LabelW),
        )
        // ★ 先落到局部 val 再判空：`value` / `max` 是参数，Kotlin 不对参数做 smart cast
        //   （它们可能被捕获进闭包），于是 `value / max` 会在括号里报"需要 !!"
        val v = value
        val m = max
        if (v != null && m != null && m > 0) {
            val fraction = (v / m).coerceIn(minimumValue = 0.0, maximumValue = 1.0).toFloat()
            LinearProgressIndicator(
                progress = { fraction },
                modifier = Modifier
                    .weight(weight = 1f)
                    .height(height = MudSizes.BarH),
                color = color,
                trackColor = MudColors.Hairline,
                strokeCap = StrokeCap.Round,
            )
        } else {
            // 占位：把"该有条形"的位置留出来，否则有血量和没血量两行会左右错位
            Box(
                modifier = Modifier
                    .weight(weight = 1f)
                    .height(height = MudSizes.BarH),
            )
        }
        Text(
            text = if (v != null && m != null && m > 0) "${v.toInt()}/${m.toInt()}" else "—",
            color = MudColors.Dim,
            style = MaterialTheme.typography.bodySmall,
            // ★ 定宽 + 右对齐：数值长短变化时条形不会跟着伸缩（见上面那段）
            modifier = Modifier
                .width(width = MudSizes.NumW)
                .padding(start = MudSizes.Gap3),
            textAlign = TextAlign.End,
            maxLines = 1,
        )
    }
}

/**
 * 断线条（只在 `phase == Closed` 时出现）。
 *
 * ★ 底色从 `Band`(#222) 改成 `Recessed`(#111)：`#222` 在 wushen 是**对话框的头脚带**，
 *   拿它当主屏里的一条横幅 ⇒ 主屏上平白多出第 6 种底（§92.1.2）。
 */
@Composable
private fun ReconnectBar(onReconnect: () -> Unit) {
    MudSection(hairline = true, modifier = Modifier.background(color = MudColors.Recessed)) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(space = MudSizes.Gap3),
        ) {
            Text(
                text = "连接已断开",
                color = MudColors.Error,
                style = MaterialTheme.typography.bodySmall,
                modifier = Modifier.weight(weight = 1f),
            )
            MudAction(label = "重连", onClick = onReconnect)
        }
    }
}

// ── 房间 ────────────────────────────────────────────────────────────────────

/**
 * 房间区：房名 →（地图，仅在 `mapOpen` 时）→ 描述 → 展开按钮 → 明显出口 → 此处有。
 *
 * ★★ 与网页端 `src/ui/room.ts` 的三块**一一对应**，只是形状从 DOM 换成 Compose：
 *   `renderExits` → 出口行、`renderItems` → 人与物、`renderMap` → [MapPanel]。
 *   这几块的**内容**（哪些方向、哪些实体、点了发什么）全部来自 `:core`
 *   （`exitRows` / `selectCommandFor` / `planMap`），这里只决定怎么摆。
 *
 * ★★ **不刷底色**（§92.5.1）：wushen 的 `.content-room` **一条 CSS 规则都没有**
 *   （`style.css:345-356`），房间描述就直接画在黑底上，与消息流之间只有一条发丝线。
 *   旧版给它刷了 `#1A1A1A` —— 那正是"中间地图和 npc 物品灰褐色还是灰棕色分不清"的来源。
 *
 * ★ 两处**刻意的形状差异**，都是为了触屏：
 *   ① 网页端的出口是行内可点的 `span`（鼠标点 12px 高的字很好点），
 *      这里必须给每个方向一块独立的、够大的点击区（`dense` 档 32dp，见 [MudSizes.ChipH]）；
 *      于是放弃「、」「和」这组分隔符 —— 分离的方块本身就是分隔。
 *   ② 小地图**就在这个区块里**，紧跟在房名行下面（§94，位置照 wushen
 *      `.map-panel` 紧挨 `.room-title`）。**但它只在地图开着时占高度**，
 *      并且是固定高度、内部不滚（见 [GameScreen] 的 §94 高度预算）。
 *      上一版曾把它做成底部弹出卡片：开关在这一行、卡片在屏幕最下面，
 *      中间隔着整屏消息流 —— "点"和"看"分居两头，用户判掉了那一版。
 *
 * @param expanded 描述是不是展开态；展开时调用方会给一个 `weight(1f)`（见 [GameScreen]）
 * @param mapOpen 地图是否展开。**开合不住在这里** —— 它住在 [GameScreen]，
 *   因为"开地图要顺手收起描述展开态"这件事牵涉到 `roomExpanded`，只有主屏同时够得着两个开关
 * @param onToggleExpand 点「展开 / 收起描述」
 * @param onToggleMap 点房名行那颗「地图 / 关地图」
 */
@Composable
private fun RoomSection(
    state: UiState,
    expanded: Boolean,
    mapOpen: Boolean,
    onToggleExpand: () -> Unit,
    onToggleMap: () -> Unit,
    onCommand: (String) -> Unit,
    onPick: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val exits = remember(state.exits) { exitRows(state.exits) }
    // ★ `remember(键)` 而不是每次重组都算：地图要遍历出口表、算 12 个格位，
    //   而消息流每来一行都会重组整屏。键是"出口表 + 房名"——它们变，图才该变。
    //   ★ 放在 `mapOpen` 判断**外面**：这样关着的时候也算过一次，"点开"那一刻不会卡一下。
    //     代价是收起态每次房名/出口变化要多算一次（12 个格位，可忽略）。
    val plan = remember(state.exits, state.room?.name) {
        planMap(state.exits, state.room?.name.orEmpty())
    }
    val room = state.room
    val desc = room?.desc.orEmpty()
    // ★ 只有**收起态**才知道"到底超没超 [MudSizes.RoomDescLines] 行"；展开态沿用上一次的结论，
    //   否则一展开按钮就自己消失，玩家没法收回去。
    var descOverflow by remember(desc) { mutableStateOf(false) }

    MudSection(modifier = modifier, hairline = true) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            // 房名可能带颜色标签（`room` 帧的 `name` 不保证是纯文本）
            MarkupText(
                raw = room?.name ?: "未入江湖",
                modifier = Modifier.weight(weight = 1f),
                color = MudColors.Name,
            )
            // ★ 地图开关不再走 `selected`：那是"这个面板开着"，
            //   与"当前频道"是两件事，共用 `selected` 会让两者长得一样（§92.6.1）。
            //   这里靠**文案**（地图 / 关地图）表达状态。
            // ★ `dense = true`（32dp）而不是 `Modifier.height(TabH)`：房名这一行里
            //   两颗键都是"改视图"，不该与出口/动作同高（44dp），也不该自己带一个高度 ——
            //   高度只有一个来源，`dense` 就是那个来源的另一档。
            MudAction(
                label = if (mapOpen) "关地图" else "地图",
                onClick = onToggleMap,
                dense = true,
            )
        }

        // ★★ 地图**就地展开、紧贴开关**（§94）：不开底色、不加边框 ——
        //   九宫格的格子自己已经把边界画清楚了，外面再套一层框就是"多一层底"
        //   （wushen `.map-panel` 也没有背景与边框）。
        //   ★ 但**高度这件事我们与 wushen 不一样，别记成"照抄"**：
        //     wushen 是 `.map-panel{width:100%;max-height:6em;overflow:auto}`
        //     （`main.css:454-458`）—— 网页端**是可滚的**，6em ≈ 84px 装不下就滚。
        //     我们**有意不照抄**：触屏优先级是"全屏只有一个竖向滚动器"（`style.css:345-356`
        //     把"两个滚动器"当过教训）。代价是最坏 112dp 全占，所以地图开着时
        //     描述降到 3 行（`MudSizes.RoomDescMapLines`）。要改成可滚，先推翻那条优先级。
        //   ★ `MapPanel` 自带 `fillMaxWidth()` + 居中/窄屏横滚，这里**不再套宽度** ——
        //     套了会得到一个内外两层都想要宽度的约束，窄屏那一支反而先失效。
        if (mapOpen) {
            Box(modifier = Modifier.padding(top = MudSizes.Gap2)) {
                MapPanel(plan = plan, onCommand = onCommand)
            }
        }

        if (desc.isNotEmpty()) {
            MarkupText(
                raw = desc,
                modifier = Modifier.padding(top = MudSizes.Gap1),
                color = MudColors.Text,
                // ★★ 房间区**限行不限高**：照 wushen 的"不限高、不滚"，
                //   长描述靠截断兜住，超出才给「展开」。这样全屏仍然只有一个竖向滚动器。
                // ★★ 三档（§94）：展开态无限、**地图开着 3 行**、平时 6 行。
                //   中间那一档不是审美：6 行 + 地图满格的固定块约 576dp，而 360×640
                //   可用高约 568dp ⇒ `Column` 会裁掉最后两块（消息流 + 输入行），
                //   表现就是"指令框没见"。算式写在 [MudSizes.RoomDescLines] 的 KDoc 里。
                maxLines = if (expanded) {
                    Int.MAX_VALUE
                } else if (mapOpen) {
                    MudSizes.RoomDescMapLines
                } else {
                    MudSizes.RoomDescLines
                },
                // 首行缩进 2em（wushen `.room_desc{text-indent:2em}`，`style.css:386`）
                indentFirstLine = true,
                // ★★ **不要用 `result.lineCount >= RoomDescLines` 判溢出**：
                //   正文**恰好 6 行且完整可见**时 `lineCount == 6`，`6 >= 6` 为真 ⇒
                //   会白给一颗点了界面毫无变化的「展开描述」。
                //   `hasVisualOverflow` 是"排版结果被 maxLines / 宽度裁掉了"的直接标记，
                //   与上面 `overflow = Ellipsis` 是同一件事的两面（省略号只在它为真时出现）。
                //   依据：`TextLayoutResult.hasVisualOverflow`（Material3 1.3 公开 API，
                //   `androidx.compose.ui.text`），本机无 JDK 无法编译验证 —— 改动时请一并复核。
                onTextLayout = { result ->
                    if (!expanded) descOverflow = result.hasVisualOverflow
                },
            )
            // ★★ **地图开着时不给「展开描述」**（§94）。不是省地方，是堵一条坏路径：
            //   地图开着 → 点「展开描述」→ `expanded = true` → 房间区拿 `weight(1f)`，
            //   而地图还在区块里 ⇒ 区块内容（房名 32 + 地图 112 + 无限行描述 + 出口 + 此处）
            //   超过分到的那一半，`Column` 会把**出口和此处直接裁掉**
            //   （房间区不滚，玩家只会觉得"东西没了"，而且没有任何提示）。
            //   ⇒ 想看全文就先关地图；关掉后按钮自己回来。
            //   ★ 另一半在 `toggleMap` 里：开地图会把 `expanded` 收起来（反方向同一条理由）。
            if (!mapOpen && (descOverflow || expanded)) {
                MudAction(
                    label = if (expanded) "收起描述" else "展开描述",
                    onClick = onToggleExpand,
                    // ★ 用 `dense`（32dp）而不是 `Modifier.height(TabH)`：
                    //   它是"改视图"不是"下命令"，得比出口那一排矮；但高度只从
                    //   [MudSizes] 取 —— 调用方再传一个高度就等于是第二个来源。
                    dense = true,
                )
            }
        }

        // ★ 地图现在在**上面**（房名行正下方）。这块位置留下的是一段判断史，别删：
        //   · 更早：地图内联在**描述之后** —— 一展开就把消息流顶薄；
        //   · §93：搬成屏幕底部的弹出卡片 —— 于是"点"（房名行）与"看"（屏幕底部）
        //     隔着整屏消息流，且卡片盖住输入行；
        //   · §94（现在）：回到这个区块、并且挪到**描述之前**，紧贴开关。
        //   ⇒ 两次改判的判据都是"距离"，不是"面积"：地图满格只有 112dp，
        //     它顶薄消息流的程度比"开关与它隔着整屏"这件事轻得多。

        // ★★ 分组标题「出口」**放在 LazyRow 外面**。
        //   原来是 `LazyRow` 的第一个 item，于是往右一滑它就跟着滑走了 ——
        //   剩下的是一排方向名字，看起来像按钮栏而不是"从哪儿出去"。
        //   代价是标题常驻一个 [MudSizes.LabelW] 宽，换来的是"这一排是什么"永远在场。
        if (exits.isEmpty()) {
            Text(
                text = "这里没有明显的出口。",
                color = MudColors.Dim,
                style = MaterialTheme.typography.bodySmall,
                modifier = Modifier.padding(top = MudSizes.Gap1),
            )
        } else {
            LabelledRow(label = "出口") {
                items(exits) { row ->
                    // ★ 发的是**方向键本身**（`row.dir`），不是中文 —— 中文只是显示
                    // ★ `dense`：出口一行最多 8 个方向，44dp 方块在 360dp 屏上只放得下 4 个，
                    //   剩下的要横滑 —— 而"从哪儿出去"应该是**一眼看全**的（[MudSizes.ChipH]）。
                    MudAction(label = row.label, onClick = { onCommand(row.dir) }, dense = true)
                }
            }
        }

        if (state.actors.isNotEmpty()) {
            LabelledRow(label = "此处") {
                items(state.actors) { actor ->
                    // ★ 点实体 ⇒ 发 `select <id>`（**不是** `look`，见 `:core` 的 `selectCommandFor`）
                    ActorChip(actor = actor, onClick = { onPick(actor.id) })
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
 *   标题定宽一处 28dp、一处 32dp —— 现在统一读 [MudSizes.LabelW]）。
 */
@Composable
private fun LabelledRow(
    label: String,
    content: LazyListScope.() -> Unit,
) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier.padding(top = MudSizes.Gap2),
    ) {
        Text(
            text = label,
            color = MudColors.Dim,
            style = MaterialTheme.typography.bodySmall,
            // ★ 定宽：出口和在场者两块要对齐成一条竖线，否则内容起点错开
            modifier = Modifier.width(width = MudSizes.LabelW),
        )
        LazyRow(
            modifier = Modifier.weight(weight = 1f),
            horizontalArrangement = Arrangement.spacedBy(space = MudSizes.Gap2),
            content = content,
        )
    }
}

/**
 * 一个人 / 物。
 *
 * ★ 气血内力细条照网页端 `renderItems`：`max_hp > 0` 才画（服务端可以不发血量，
 *   画一条满的会撒谎）。
 *
 * ★★ **"是不是玩家"用边色表达，不再用底色**（§92.6.1）：
 *   旧版 `ControlSelected`(#2A2A28) 同时是"选中态底"和"玩家卡底" ——
 *   一个临时状态色被拿去当常驻身份色，这才是"分不清"的真正来源（§92.1.1）。
 *   现在：底一律 `Background`，玩家边 `Accent`(橄榄) / NPC 边 `Line`(灰)，
 *   字一律 `Ui` —— 层级数不变，且不与"选中"抢语义。
 *
 * ★★ 高度读 [MudSizes.ControlH]，**不写自己的数**。更早一版这里写死 `minHeight = 44dp`
 *   而注释说"与 MudAction 同一套尺寸"—— 那时 MudAction 已经是 M3 `Button` 的 40dp 视觉高，
 *   于是出口那一排 40dp、人物这一排 44dp，两排下沿差 4dp，而且是**系统性的 4dp**（每次都差）。
 *   `minimumInteractiveComponentSize()` 再补上 Button 天生就有的 48dp 触点。
 */
@Composable
private fun ActorChip(actor: ActorBrief, onClick: () -> Unit) {
    Column(
        modifier = Modifier
            .minimumInteractiveComponentSize()
            .heightIn(min = MudSizes.ControlH)
            .background(color = MudColors.Background, shape = MudShapes.Control)
            .border(
                width = MudSizes.HairlineW,
                color = if (actor.isPlayer) MudColors.Accent else MudColors.Line,
                shape = MudShapes.Control,
            )
            .clickable(onClick = onClick)
            .padding(horizontal = MudSizes.Gap3, vertical = MudSizes.Gap1),
        verticalArrangement = Arrangement.Center,
    ) {
        MarkupText(
            raw = actor.name,
            color = MudColors.Ui,
            // ★ 名字按钮按内容宽度收，不能吃掉整行
            fillWidth = false,
        )
        val maxHp = actor.maxHp
        if (maxHp != null && maxHp > 0) {
            MiniBar(value = actor.hp ?: 0.0, max = maxHp, color = MudColors.Hp)
            val maxMp = actor.maxMp
            if (maxMp != null && maxMp > 0) {
                MiniBar(value = actor.mp ?: 0.0, max = maxMp, color = MudColors.Mp)
            }
        }
    }
}

/**
 * 名字下面那条 4dp 的细条。
 *
 * ★ 与 [ResourceBar] 是同一个组件（`LinearProgressIndicator`），只是矮一档、
 *   宽度写死 48dp。**没有做成一个函数两个模式**：这里的宽度是"跟着名字走"的固定值，
 *   而状态条那条是 `weight(1f)` 撑满 —— 参数不同，硬合并只会多两个布尔开关。
 */
@Composable
private fun MiniBar(value: Double, max: Double, color: Color) {
    val fraction = if (max > 0) {
        (value / max).coerceIn(minimumValue = 0.0, maximumValue = 1.0).toFloat()
    } else {
        0f
    }
    LinearProgressIndicator(
        progress = { fraction },
        modifier = Modifier
            .padding(top = MudSizes.GapTiny)
            .width(width = MudSizes.MiniBarW)
            .height(height = MudSizes.MiniBarH),
        color = color,
        trackColor = MudColors.Hairline,
        strokeCap = StrokeCap.Round,
    )
}

// ── 消息流 ──────────────────────────────────────────────────────────────────

/**
 * 消息流：**全屏唯一的竖向滚动器**（§92.5.1）。
 *
 * ★ 底是 `Background`(#000) + 绿字 —— 这一块**本来就是对的**，与 wushen 一致
 *   （§92.1 第 3 条）。它之前"显得割裂"是因为**周围每一块都不是 `#000`**：
 *   问题在邻居，不在它。所以本次的改法是把邻居都收成 `#000`，而不是动它。
 */
@Composable
private fun MessageStream(
    log: List<LogLine>,
    onCommand: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val listState = rememberLazyListState()
    // ★ 新行进来就贴底。网页端是"本来就在底部才跟随"（翻历史时不被拽回来）；
    //   这里先做简单的那一半 —— **翻历史时会被拽回底部**是已知缺口（26 册 §83.6）。
    // ★★ 键用 `log` 而**不是** `log.size`：消息流有 400 行上限（`MAX_LOG_LINES`），
    //   到顶之后 size 恒等于 400 —— 拿 size 当键，第 401 行进来**不会触发**这个 effect，
    //   界面从此再也不贴底（长会话必然踩到，看起来像"消息流卡住不动"）。
    //   `withLine` 每次追加都产出一个新 list 实例，结构相等性因此能区分"又来了新行"。
    LaunchedEffect(log) {
        if (log.isNotEmpty()) listState.animateScrollToItem(index = log.lastIndex)
    }
    LazyColumn(
        state = listState,
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = MudSizes.ScreenPadH, vertical = MudSizes.Gap1),
    ) {
        items(log) { line -> LogRow(line = line, onCommand = onCommand) }
    }
}

@Composable
private fun LogRow(line: LogLine, onCommand: (String) -> Unit) {
    Column(modifier = Modifier.padding(vertical = MudSizes.GapTiny)) {
        MarkupText(raw = line.text, color = colorOf(kind = line.kind))
        if (line.cmds.isNotEmpty()) {
            // ★ `FlowRow` 而不是 `Row`：一行消息后面可以挂任意多个按钮（面板类文本常见），
            //   `Row` 超出屏幕的部分**直接被裁掉**且没有任何提示 —— 玩家只会觉得"少了个选项"
            FlowRow(
                horizontalArrangement = Arrangement.spacedBy(space = MudSizes.Gap2),
                verticalArrangement = Arrangement.spacedBy(space = MudSizes.Gap2),
                modifier = Modifier.padding(top = MudSizes.Gap1),
            ) {
                for (cmd in line.cmds) {
                    MudAction(label = cmd.label, onClick = { onCommand(cmd.cmd) })
                }
            }
        }
    }
}

private fun colorOf(kind: LogKind): Color = when (kind) {
    LogKind.TEXT -> MudColors.Text
    LogKind.SYS -> MudColors.Dim
    LogKind.ERR -> MudColors.Error
    LogKind.GAIN -> MudColors.Gain
    LogKind.FIGHT -> MudColors.Fight
    LogKind.CHAT_TELL -> MudColors.Tell
    LogKind.CHAT -> MudColors.Strong
}

// ── 动作栏 / 输入 ───────────────────────────────────────────────────────────

/**
 * 动作栏：一排横滑的动作按钮，**无底色**（§92.4 第 2 句）。
 *
 * ★ 旧版给它刷了 `#111` —— 于是主屏上"状态条 / 房间区 / 动作栏 / 输入行"四种底，
 *   再加上浮层的 `#111` 和断线条的 `#222`，一屏六种灰。
 */
@Composable
private fun CommandBar(cmds: List<Cmd>, onCommand: (String) -> Unit) {
    MudSection(hairline = true) {
        LazyRow(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(space = MudSizes.Gap2),
        ) {
            // ★ `dense`：动作栏经常 5~6 个，同一条"一眼看全"的理由（[MudSizes.ChipH]）。
            items(cmds) { cmd ->
                MudAction(label = cmd.label, onClick = { onCommand(cmd.cmd) }, dense = true)
            }
        }
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
 *
 * ★ 主屏最下面一块 ⇒ **不带发丝线**（它下面没有别的区块了）。
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
    MudSection {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(space = MudSizes.Gap2),
        ) {
            ChatEntry(unread = unread, onClick = onChat)
            MudField(
                value = text,
                onValueChange = { text = it },
                placeholder = "输入指令…",
                modifier = Modifier.weight(weight = 1f),
                // ★ 不传 `fill`：输入行坐在 `Background`(#000) 上 ⇒ 用默认的
                //   `Recessed`(#111) 当槽底，看上去是嵌进黑底里的一条槽（凹槽规则见 [MudField]）。
                //   聊天浮层与登录卡片自己是 `#111`，那边才显式传 `Background`。
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send),
                keyboardActions = KeyboardActions(onSend = { send() }),
            )
            MudAction(label = "发送", onClick = send, primary = true)
        }
    }
}

/**
 * 「聊天」入口 + 未读角标。
 *
 * ★★ 角标现在是 Material3 的 [Badge]（`BadgedBox` 负责定位）——
 *   不再自己画一个圆角 `Box` 再手动 `padding(start = 4dp)`。
 *   换掉的理由：角标"贴在哪、多大、数字变长怎么办"是三件容易各错一次的事，
 *   而 `Badge` 已经把它们定好了（右上角、18dp 高、内容超长自动撑宽）。
 *
 * ★ 按钮本体是普通的 [MudAction]（皮肤与出口按钮同族）。
 *   "有未读"这件事**只由角标表达** —— 旧版额外切到 `selected` 态是重复表达，
 *   而且会让人以为"聊天"是个可以开关的开关（§92.6.1）。
 *
 * ★ 读屏靠 [contentDescription] 一次说清"聊天，N 条未读"—— 数字只有视觉呈现，
 *   不写这一句，TalkBack 用户永远不知道有人在说话（`mergeDescendants` 免得
 *   把"聊天"和数字分两次念）。
 */
@Composable
private fun ChatEntry(unread: Int, onClick: () -> Unit) {
    BadgedBox(
        modifier = Modifier.semantics(mergeDescendants = true) {
            contentDescription = if (unread > 0) "聊天，$unread 条未读" else "聊天"
        },
        badge = {
            if (unread > 0) {
                // wushen 的 `.tool-item>.tag { background:#d03030; color:#fff }`（`style.css:925-928`）
                Badge(containerColor = MudColors.Error, contentColor = MudColors.OnError) {
                    Text(
                        text = if (unread > 99) "99+" else unread.toString(),
                        style = MaterialTheme.typography.bodySmall,
                    )
                }
            }
        },
    ) {
        MudAction(label = "聊天", onClick = onClick)
    }
}

// ── 面板 / 提示框 ───────────────────────────────────────────────────────────

/**
 * 物件面板。
 *
 * ★ 形状照 wushen 的 `.dialog`：**头 / 内容 / 脚**三段，头脚是 `#222` 的条。
 *   第一版把标题和正文排在一起（同色同字号同内边距），读起来像"标题是第一行正文"；
 *   wushen 的做法是给标题一条自己的底色 —— 这不是装饰，是让"这块是什么"分得开。
 *
 * ★★ **底走 `Background`(#000)**（§92.5.3）：照 wushen `.dialog{background:var(--bg)}`
 *   （`style.css:1084`），面板正文与页面**同底**，靠 `#343434` 边和 `#222` 头脚带区分。
 *
 * ★★ **没有换成 `AlertDialog`**，理由是它表达不了这个结构：
 *   `AlertDialog(title, text, confirmButton)` 三个槽位，而这里要
 *   "标题栏（带关闭键）+ 可滚动正文 + 任意多个按钮"，且按钮必须**换行**。
 *   硬套的结果是把 `title` 槽塞一个 `Row`、把一排按钮塞进 `confirmButton` ——
 *   那就不是用组件，是拿组件当 `Box` 使，还多背一套它的内边距与宽度策略。
 *   ⇒ **能表达的结构才用组件；表达不了就自己搭，别掰。**
 *
 * ★ 三处"真机会坏"的约束仍然在：正文给死上限（[MudSizes.PanelBodyMaxH]）、
 *   按钮走 `FlowRow`（一排摆会溢出到屏幕外，网页端 §81 量过同一处）、
 *   正文可滚。
 */
@Composable
private fun PanelDialog(panel: PanelState, onCommand: (String) -> Unit, onClose: () -> Unit) {
    androidx.compose.ui.window.Dialog(onDismissRequest = onClose) {
        MudPanel(
            modifier = Modifier.fillMaxWidth(),
            container = MudColors.Background,
        ) {
            Column {
                MudPanelHeader(title = panel.title, onClose = onClose)
                // ★ 正文可滚：长描述不能把底部按钮挤出屏幕（网页端 §81 量过这一条）
                LazyColumn(
                    modifier = Modifier
                        .heightIn(max = MudSizes.PanelBodyMaxH)
                        .padding(
                            horizontal = MudSizes.ContentPad,
                            vertical = MudSizes.Gap3,
                        ),
                ) {
                    items(panel.rows) { row ->
                        MarkupText(
                            raw = row,
                            modifier = Modifier.padding(vertical = MudSizes.GapTiny),
                        )
                    }
                }
                if (panel.cmds.isNotEmpty()) {
                    // 脚：wushen `.dialog-footer { background-color: #222 }`（`style.css:1156`）
                    FlowRow(
                        horizontalArrangement = Arrangement.spacedBy(space = MudSizes.Gap3),
                        verticalArrangement = Arrangement.spacedBy(space = MudSizes.Gap3),
                        modifier = Modifier
                            .fillMaxWidth()
                            .background(color = MudColors.Band)
                            .padding(all = MudSizes.InsetPad),
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

/**
 * 提示框（服务端问一句、等一个答复）。
 *
 * ★ 与 [PanelDialog] 分开是因为**它不该被随手关掉**：面板是"看看有什么"，
 *   提示框是"你得选一个"。所以这里没有"关闭"按钮 —— 只有服务端给的选项，
 *   以及点框外（`onDismissRequest`）表示"我不选"。
 *
 * ★★ **底走 `Recessed`(#111)、顶边 4dp 绿**（§92.5.4），逐值照 wushen
 *   `.warn-dialog`（`style.css:1410-1413`）；**正文区不再刷 `#222`** ——
 *   `#222` 只归"浮层的带"（§92.1.2）。
 *
 * ★ 同样没套 `AlertDialog`：正文是**服务端给的富文本**（颜色标签要渲染），
 *   按钮数量不定。真要用 `AlertDialog` 的 `text` 槽放 `MarkupText` 也行，
 *   但它会把正文包进自己的可滚区域，和我们给的高度上限打架。
 */
@Composable
private fun PromptDialog(prompt: PromptState, onCommand: (String) -> Unit, onDismiss: () -> Unit) {
    androidx.compose.ui.window.Dialog(onDismissRequest = onDismiss) {
        MudPanel(
            modifier = Modifier.fillMaxWidth(),
            container = MudColors.Recessed,
        ) {
            Column {
                // ★ 顶边 4dp 绿（wushen 原文）：它是"这条消息要你表态"的记号
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(height = MudSizes.PromptEdgeW)
                        .background(color = MudColors.Text),
                )
                LazyColumn(
                    modifier = Modifier
                        .heightIn(max = MudSizes.PromptBodyMaxH)
                        .padding(all = MudSizes.ContentPad),
                ) {
                    item { MarkupText(raw = prompt.text) }
                }
                // 按钮与正文**同底**（都在 `#111` 的提示框里），靠 padding 分开，不再刷一层 `#222`
                FlowRow(
                    horizontalArrangement = Arrangement.spacedBy(space = MudSizes.Gap3),
                    verticalArrangement = Arrangement.spacedBy(space = MudSizes.Gap3),
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(all = MudSizes.InsetPad),
                ) {
                    for (cmd in prompt.cmds) {
                        MudAction(label = cmd.label, onClick = { onCommand(cmd.cmd) })
                    }
                }
            }
        }
    }
}

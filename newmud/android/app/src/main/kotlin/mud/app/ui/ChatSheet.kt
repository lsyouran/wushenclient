package mud.app.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
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
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import mud.core.ChatChannel
import mud.core.UiState

/**
 * 聊天浮层（网页端 `#chatPop` 的等价物）。
 *
 * ★ 形状照网页端：**底部弹出的卡片**，三个频道页签 + 输入框 + 发送。
 *   网页端用浮层而不是常驻区（"MUD 里绝大多数操作是点按钮，常驻输入框会永久吃掉一行"）——
 *   安卓端已经有常驻输入框（指令），所以聊天只做浮层。
 *
 * ★ 为什么不用 `Dialog`：Dialog 里放输入框要和输入法抢 inset，`imePadding` 常常不生效，
 *   键盘一弹就把输入框盖住。这里用 `Box` + `align(BottomCenter)`（挂在 `GameScreen` 的根 Box 上），
 *   与底部那个输入框走**同一条** inset 路径，行为一致。
 *
 * ★★ 频道行换成 [MudTabRow]（§92.5.2）：旧版用全尺寸 [MudAction] + `selected`，
 *   语义错（页签不是"按下去发命令"）且**窄屏会静默裁掉右端**（`Row` 没有 `horizontalScroll`）。
 *   现在三个页签 `weight(1f)` 均分、右端「收起」定宽 [MudSizes.ControlMinW] ⇒ 窄屏只变窄不丢东西。
 *
 * ★ 浮层底是 `Recessed`(#111)：它是**凹面**，与状态条同族 —— 页签"选中"时也是 `#111`，
 *   于是"选中的那一页"与"浮层本体"连成一片（"选中是面，未选中是槽"）。
 *
 * ★★ 这个文件里**没有判断**：能不能发、发什么、缺对象时说什么，全在 `:core`
 *   （`composeChat` / `chatHintOf`，有 JVM 单测）。这里只决定形状。
 *
 * ★★ 发不出去时那句提示**画在这张卡片里**，不进消息流：浮层贴底，正好盖住消息流的
 *   最新几行 —— 写进去玩家一个字也看不到，观感就是"点了没反应"。
 *   顺带的好处是发不出去时**不清输入框**，玩家改一下就能再发。
 */
@Composable
fun ChatSheet(
    state: UiState,
    onChannel: (ChatChannel) -> Unit,
    onSend: (String) -> String?,
    onClose: () -> Unit,
    modifier: Modifier = Modifier,
) {
    var text by rememberSaveable { mutableStateOf("") }
    var hint by remember { mutableStateOf<String?>(null) }
    val focus = remember { FocusRequester() }

    // ★★ 浮层一开就把焦点抢过来：底部那个**指令框**还在下面（被这张卡片盖住了），
    //   如果它原来有焦点，键盘弹出的字会被打进**看不见的那个框**里 ——
    //   这也是网页端 `openChat()` 里那句 `chatInput.focus()` 的作用。
    LaunchedEffect(Unit) { focus.requestFocus() }

    // 换频道或换对象之后，上一句吐槽已经不适用了（"先选对象"在选完对象之后就是噪音）
    LaunchedEffect(state.chatChannel, state.chatTarget) { hint = null }

    val send = {
        val problem = onSend(text)
        hint = problem
        // 发出去了才清空。发不出去还清空 = 玩家白打一行字
        if (problem == null) text = ""
    }

    Surface(
        color = MudColors.Recessed,
        shape = MudShapes.Sheet,
        // ★ 上沿一道细线：浮层与它盖住的内容只差一档灰，
        //   不描边的话"这块是新弹出来的"只能靠内容变化察觉
        //   （wushen 的聊天页签也是 `1px solid #c0c0c0` 边，`style.css:993`）
        border = BorderStroke(width = MudSizes.HairlineW, color = MudColors.Hairline),
        modifier = modifier.fillMaxWidth().imePadding(),
    ) {
        Column(
            modifier = Modifier.padding(
                horizontal = MudSizes.InsetPad,
                vertical = MudSizes.Gap3,
            ),
        ) {
            // 顶部那道小横杠：告诉玩家"这块可以收起"，也是底部浮层的通用语言
            Box(
                modifier = Modifier
                    .align(alignment = Alignment.CenterHorizontally)
                    .padding(bottom = MudSizes.Gap3)
                    .width(width = MudSizes.DragBarW)
                    .height(height = MudSizes.DragBarH)
                    .background(color = MudColors.Hairline, shape = MudShapes.Tag),
            )

            MudTabRow(
                labels = ChatChannel.entries.map { channel -> channel.label },
                selectedIndex = ChatChannel.entries.indexOf(element = state.chatChannel),
                onSelect = { index -> onChannel(ChatChannel.entries[index]) },
                trailing = {
                    // ★ 36dp 与三个页签同高（[MudSizes.TabH]）：旧版这里是 44dp 的
                    //   [MudAction]，于是一行里页签 36、按钮 44 —— 两种高度并排，
                    //   下沿错开 8dp，正是"大小不一"里最显眼的那种。
                    //   ⚠️ 调用方的 `height` 在链上更靠外，会胜出 [MudAction] 内部的 `ControlH`。
                    MudAction(
                        label = "收起",
                        onClick = onClose,
                        modifier = Modifier.height(height = MudSizes.TabH),
                    )
                },
            )

            // 私语对象只在这一档有意义；未指定时用错误色提醒，否则点发送只会得到一句提示
            if (state.chatChannel == ChatChannel.TELL) {
                val target = state.chatTarget
                val missing = target.isNullOrEmpty()
                Text(
                    text = if (missing) "私语对象：未指定 —— 点房间里的人" else "私语对象：$target",
                    color = if (missing) MudColors.Error else MudColors.Dim,
                    style = MaterialTheme.typography.bodySmall,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.padding(top = MudSizes.Gap1),
                )
            }

            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier.padding(top = MudSizes.Gap3),
                horizontalArrangement = Arrangement.spacedBy(space = MudSizes.Gap2),
            ) {
                MudField(
                    value = text,
                    onValueChange = { text = it; hint = null },
                    modifier = Modifier.weight(weight = 1f).focusRequester(focusRequester = focus),
                    // 占位符随频道变（「对本房说话…… / 对世界喊话…… / 对某人耳语……」），
                    // 文案住在 `ChatChannel.hint`，这里不另写一份
                    placeholder = state.chatChannel.hint,
                    // ★ 槽底显式传 `Background`(#000)：**槽永远比它所在的面暗一档** ——
                    //   这张卡片自己是 `Recessed`(#111)，槽就得是 `#000`。
                    //   用默认的 `Recessed` 会让输入框与卡片同色，整块只剩一条边（凹槽规则见 [MudField]）。
                    fill = MudColors.Background,
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send),
                    keyboardActions = KeyboardActions(onSend = { send() }),
                )
                MudAction(label = "发送", onClick = send, primary = true)
            }

            hint?.let { problem ->
                Text(
                    text = problem,
                    color = MudColors.Error,
                    style = MaterialTheme.typography.bodySmall,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.padding(top = MudSizes.Gap1),
                )
            }
        }
    }
}

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
import androidx.compose.ui.unit.dp
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
        color = MudColors.Surface,
        shape = MudShapes.Sheet,
        // ★ 上沿一道细线：浮层与消息流同色（都是黑/深灰一系），
        //   不描边的话"这块是新弹出来的"只能靠内容变化察觉（wushen 的聊天页签也是 1px #C0C0C0 边）
        border = BorderStroke(1.dp, MudColors.Border),
        modifier = modifier.fillMaxWidth().imePadding(),
    ) {
        Column(modifier = Modifier.padding(horizontal = 10.dp, vertical = 8.dp)) {
            // 顶部那道小横杠：告诉玩家"这块可以收起"，也是底部浮层的通用语言
            Box(
                modifier = Modifier
                    .align(Alignment.CenterHorizontally)
                    .padding(bottom = 8.dp)
                    .width(36.dp)
                    .height(3.dp)
                    .background(MudColors.Border, MudShapes.Tag),
            )
            Row(verticalAlignment = Alignment.CenterVertically) {
                for (channel in ChatChannel.entries) {
                    MudAction(
                        label = channel.label,
                        onClick = { onChannel(channel) },
                        selected = channel == state.chatChannel,
                    )
                    Box(modifier = Modifier.width(6.dp))
                }
                Box(modifier = Modifier.weight(1f))
                MudAction(label = "收起", onClick = onClose)
            }

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
                    modifier = Modifier.padding(top = 4.dp),
                )
            }

            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier.padding(top = 8.dp),
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                MudField(
                    value = text,
                    onValueChange = { text = it; hint = null },
                    modifier = Modifier.weight(1f).focusRequester(focus),
                    // 占位符随频道变（「对本房说话…… / 对世界喊话…… / 对某人耳语……」），
                    // 文案住在 `ChatChannel.hint`，这里不另写一份
                    placeholder = state.chatChannel.hint,
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send),
                    keyboardActions = KeyboardActions(onSend = { send() }),
                )
                MudAction(label = "发送", onClick = send)
            }

            hint?.let {
                Text(
                    text = it,
                    color = MudColors.Error,
                    style = MaterialTheme.typography.bodySmall,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.padding(top = 4.dp),
                )
            }
        }
    }
}

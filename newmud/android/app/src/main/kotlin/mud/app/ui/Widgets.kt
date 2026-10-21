package mud.app.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import mud.app.R

/**
 * 界面零件层：**只在这里定义"长什么样"**，各处调用。
 *
 * ★★ 这个文件的立场变过一次，值得记下来：
 *
 *   第一版是"什么都自己画" —— 按钮是 `Box + background + border + clickable`，
 *   理由是"Material3 的默认形状/配色和自定义深色主题打架"。那个理由在当时成立，
 *   但它带来两个后果：① 每个屏各自拼一套（后来果然拼出了三套不一样的按钮）；
 *   ② **丢掉了组件自带的东西** —— 涟漪、禁用态语义、`minimumInteractiveComponentSize`
 *   的 48dp 触点、`Badge` 的角标排版、`LinearProgressIndicator` 的进度动画，全要自己补。
 *
 *   现在改成：**能交给组件的交给组件，只把颜色/形状喂给它**（[MudAction] 内部是
 *   `Button`，血条是 `LinearProgressIndicator`，未读角标是 `Badge`）。
 *   于是这一层的职责变成"翻译 wushen 的 CSS 到 Material3 的参数"，而不是"重画一遍控件"。
 *
 * ★ 没有换成组件的地方，理由写在各函数上（[MudPanel] / [MudField]）。
 *
 * ★ 配色全部来自 [MudColors]（wushen 的原值），这里不出现第二个十六进制。
 */

/**
 * 统一的输入框。
 *
 * ★ 用 `OutlinedTextField` + 换配色，**不自己拼 `BasicTextField`**：
 *   自己拼要重做光标、选区、长按菜单、无障碍语义 —— 那是"为了好看把能用的东西弄坏"。
 *
 * ★ wushen 里没有"登录表单"这种东西（它是网页 MUD，先有页面才谈登录），
 *   所以这一个控件的配色是按 wushen 的**面板内容区**推的：
 *   `#000` 底（比面板更暗，看上去是凹进去的）+ `#343434` 边框 + 聚焦时橄榄色。
 *
 * @param label 有值时显示浮动标签（登录屏要它），无值时只显示占位符（输入行要它）
 */
@Composable
fun MudField(
    value: String,
    onValueChange: (String) -> Unit,
    placeholder: String,
    modifier: Modifier = Modifier,
    label: String? = null,
    enabled: Boolean = true,
    keyboardOptions: KeyboardOptions = KeyboardOptions.Default,
    keyboardActions: KeyboardActions = KeyboardActions.Default,
) {
    // ★ 显式判空再包，不用 `label?.let { { Text(it) } }`：那写法让内层 lambda 的
    //   `it` 借用外层那个，读的人得数两遍才知道它是什么（编译没问题，是给人看的债）。
    val labelSlot: (@Composable () -> Unit)? =
        if (label == null) null else { { Text(label) } }
    OutlinedTextField(
        value = value,
        onValueChange = onValueChange,
        modifier = modifier,
        enabled = enabled,
        singleLine = true,
        shape = MudShapes.Sharp,
        label = labelSlot,
        placeholder = { Text(placeholder, color = MudColors.Dim) },
        textStyle = MaterialTheme.typography.bodyMedium.copy(color = MudColors.Ui),
        keyboardOptions = keyboardOptions,
        keyboardActions = keyboardActions,
        colors = OutlinedTextFieldDefaults.colors(
            focusedContainerColor = MudColors.Background,
            unfocusedContainerColor = MudColors.Background,
            focusedBorderColor = MudColors.Accent,
            unfocusedBorderColor = MudColors.Border,
            focusedTextColor = MudColors.Ui,
            unfocusedTextColor = MudColors.Ui,
            cursorColor = MudColors.Strong,
            focusedLabelColor = MudColors.Accent,
            unfocusedLabelColor = MudColors.Dim,
        ),
    )
}

/**
 * 统一的按钮 —— 内部就是 Material3 的 [Button]，只喂颜色。
 *
 * ★★ 用组件而不是自己画 `Box`，**真正的收益不是省代码，是拿到两样东西**：
 *   ① `minimumInteractiveComponentSize` —— 视觉 40dp，**触点 48dp**。
 *      自己画的 44dp 方块是"视觉与触点一起缩小"，手指照样会点错；
 *   ② 涟漪 + 禁用态的语义（`Button` 会把 `enabled=false` 传给语义树，读屏会说"不可用"）。
 *
 * ★ 配色抄 wushen 的工具条按钮（`.tool-bar > .tool-item`：`#808080` 底、`#111` 字、粗体、
 *   1px `#222` 边框），主行动抄发送键（`.sender-btn`：`#ababab` 底、`#343434` 字）。
 *   这就是为什么界面上是"灰底深字"而不是"深底浅字" —— 网页端就是这样。
 *
 * @param primary 主行动（连接 / 发送）：浅灰实心
 * @param selected 页签选中态（wushen `.select` 的 `#555` 底）
 */
@Composable
fun MudAction(
    label: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    primary: Boolean = false,
    selected: Boolean = false,
) {
    val container = when {
        !enabled -> MudColors.Border
        primary -> Color(0xFFABABAB)
        selected -> Color(0xFF555555)
        else -> Color(0xFF808080)
    }
    val content = when {
        !enabled -> MudColors.Dim
        primary -> Color(0xFF343434)
        selected -> MudColors.Ui
        else -> Color(0xFF111111)
    }
    Button(
        onClick = onClick,
        enabled = enabled,
        modifier = modifier,
        shape = MudShapes.Sharp,
        // `#222` 是 wushen `.tool-item` 的边框色；深一档让灰块之间有缝
        border = BorderStroke(1.dp, Color(0xFF222222)),
        colors = ButtonDefaults.buttonColors(
            containerColor = container,
            contentColor = content,
            disabledContainerColor = MudColors.Border,
            disabledContentColor = MudColors.Dim,
        ),
        // ★ 传 `null` 而不是 `ButtonDefaults.buttonElevation()`：wushen 的按钮是平的，
        //   而 M3 默认那 1–2dp 的阴影在纯黑底上会晕出一圈脏边
        elevation = null,
        contentPadding = PaddingValues(horizontal = 12.dp, vertical = 0.dp),
    ) {
        Text(
            text = label,
            style = MaterialTheme.typography.bodySmall,
            // wushen 的 `.tool-item { font-weight: bold }`
            fontWeight = FontWeight.Bold,
            maxLines = 1,
        )
    }
}

/**
 * 一块面板底（登录卡片、对话框都套它）。
 *
 * ★ 没换成 `Card`/`Surface`：wushen 的 `.dialog` 是"1px 边框 + 纯色内容区"，
 *   而 `Card` 带 elevation（阴影）与 12dp 圆角，两个都得改回去，
 *   改完剩下的能力就只是一个 `Box`。**这种"换了还得拆"的组件不用**。
 */
@Composable
fun MudPanel(
    modifier: Modifier = Modifier,
    content: @Composable () -> Unit,
) {
    Box(
        modifier = modifier
            .background(MudColors.Surface, MudShapes.Sharp)
            .border(1.dp, MudColors.Border, MudShapes.Sharp),
    ) {
        content()
    }
}

/**
 * 面板的标题栏（wushen `.dialog-header`：`#222` 底 + 橄榄色标题 + 灰色关闭）。
 *
 * ★ 抽出来是因为 [PanelDialog] 与将来的 `skills`/`score` 面板都是这个头。
 *   wushen 里 `.dialog-header` 是**独立的一段**（有底色的条），不是"正文的第一行" ——
 *   第一版把标题和正文排在一起、同色同字号，读起来像"标题是第一行正文"（26 册 §89.4）。
 */
@Composable
fun MudPanelHeader(title: String, onClose: (() -> Unit)?) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier
            .fillMaxWidth()
            .background(MudColors.Header)
            .padding(start = 12.dp, end = 6.dp, top = 2.dp, bottom = 2.dp),
    ) {
        Text(
            text = title,
            color = MudColors.Accent,
            style = MaterialTheme.typography.bodyMedium,
            modifier = Modifier.weight(1f),
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
        )
        if (onClose != null) MudAction(label = "关闭", onClick = onClose)
    }
}

/**
 * App 内徽记。
 *
 * ★★ 它是**一张位图**（`drawable-xxxhdpi/ic_mark.png`），和启动图标出自同一张原图
 *   （`mipmap-xxxhdpi/ic_launcher_foreground.png`），只是裁掉了四周的留白。
 *   第一版是手画的 16×16 像素格（还为此维护了两份坐标），两版都被判"太丑"。
 *   教训写在 26 册 §90.2：16×16 的格子画不出武侠味，而"像不像"没有静态判据，
 *   只能靠人看 —— 所以这一处**用生成的图**，不再手拼。
 *
 * ★ 代价：位图**改不了色**。它自带黑底与玉绿/古铜金，界面底色（[MudColors.Background]）
 *   与它一致，才不会有色差。换主题色时这张图要一起换。
 */
@Composable
fun MudMark(side: Dp, modifier: Modifier = Modifier) {
    Image(
        painter = painterResource(R.drawable.ic_mark),
        // 纯装饰：旁边就有"新武林"三个字，读屏再念一遍图标是噪音
        contentDescription = null,
        modifier = modifier.size(side),
        contentScale = ContentScale.Fit,
    )
}

/** 一行说明文字（登录屏的提示、对话框的副标题）—— 单独抽出来是为了内边距一致 */
@Composable
fun MudHint(text: String, modifier: Modifier = Modifier, color: Color = MudColors.Dim) {
    Text(
        text = text,
        color = color,
        style = MaterialTheme.typography.bodySmall,
        modifier = modifier.fillMaxWidth(),
    )
}

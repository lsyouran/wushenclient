package mud.app.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
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
 * ★★ 但"翻译"不等于"逐像素照抄" —— 递交之后又返工了一轮（2026-10-22）：
 *   把 `.tool-item` 的 `#808080` 灰底 `#111` 深字照搬上来，得到的是黑底上一屏发光的
 *   灰块，而且灰与黑同属无彩色，跟"黑底绿字 + 橄榄金标题"的调性根本不搭。
 *   现在**只照抄调性，控件配色重新设计**（[MudColors.Control] 一族，理由在 `Theme.kt` 文件头）。
 *   ⇒ 一条可复用的判据：**CSS 里"布局/色相"可以抄，"控件质感"必须按目标设备重推。**
 *
 * ★ 没有换成组件的地方，理由写在各函数上（[MudPanel] / [MudField]）。
 *
 * ★ 配色全部来自 [MudColors]、尺寸全部来自 [MudSizes]、形状全部来自 [MudShapes]，
 *   这里不出现第二个十六进制、也不出现第二个 `dp` 写死的控件高度。
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
        shape = MudShapes.Control,
        label = labelSlot,
        placeholder = { Text(placeholder, color = MudColors.Dim) },
        textStyle = MaterialTheme.typography.bodyMedium.copy(color = MudColors.Ui),
        keyboardOptions = keyboardOptions,
        keyboardActions = keyboardActions,
        colors = OutlinedTextFieldDefaults.colors(
            // 底比面板更暗（看上去是凹进去的），与按钮的"凸起"形成对照
            focusedContainerColor = MudColors.Background,
            unfocusedContainerColor = MudColors.Background,
            // 聚焦时边框亮一档金色：这是"光标在这个框里"唯一不靠闪动的信号
            focusedBorderColor = MudColors.PrimaryBorder,
            unfocusedBorderColor = MudColors.ControlBorder,
            focusedTextColor = MudColors.Ui,
            unfocusedTextColor = MudColors.Ui,
            cursorColor = MudColors.Strong,
            focusedLabelColor = MudColors.OnPrimary,
            unfocusedLabelColor = MudColors.Dim,
        ),
    )
}

/**
 * 统一的按钮 —— 内部就是 Material3 的 [Button]，只喂颜色与尺寸。
 *
 * ★★ 用组件而不是自己画 `Box`，**真正的收益不是省代码，是拿到两样东西**：
 *   ① `minimumInteractiveComponentSize` —— 视觉 [MudSizes.ControlH]，**触点 48dp**。
 *      自己画的 44dp 方块是"视觉与触点一起缩小"，手指照样会点错；
 *   ② 涟漪 + 禁用态的语义（`Button` 会把 `enabled=false` 传给语义树，读屏会说"不可用"）。
 *
 * ★★ **文字居中靠 `fillMaxWidth()` + `textAlign`，缺一不可**（上一版两样都没有）：
 *   `Button` 的内容是一个 `Row(horizontalArrangement = Center)`，但那个 `Row` 的宽度是
 *   **wrap content** —— 它自己贴着 `Surface` 的左边缘（`Box` 默认 `TopStart`）。
 *   于是「按钮被拉满整行」时，居中只是"文字在它自己那一小条里居中"，
 *   整条还在左边。加上 `fillMaxWidth()` 让 `Row` 撑满，`Arrangement.Center` 才真的居中。
 *   ★ 在 `LazyRow` / `FlowRow` 里（宽度无界）`fillMaxWidth` 会退化成不填充，正好无害。
 *
 * ★★ **大小不一**由两个常量管住：高度 [MudSizes.ControlH]、最小宽度 [MudSizes.ControlMinW]。
 *   不设的话 `Button` 用 M3 默认 `minWidth = 58.dp`，「聊」和「小地图」同排宽度差一倍多。
 *
 * @param primary 主行动（连接 / 发送）：暗金底 + 浅金字
 * @param selected 选中态（频道页签、开着的地图）：橄榄边 + 亮字
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
    // 三种"皮肤"一次算完：容器色 / 边色 / 字色。分开写会各自漂移。
    val container: Color
    val border: Color
    val content: Color
    when {
        !enabled -> {
            container = MudColors.Disabled
            border = MudColors.DisabledBorder
            content = MudColors.OnDisabled
        }
        primary -> {
            container = MudColors.Primary
            border = MudColors.PrimaryBorder
            content = MudColors.OnPrimary
        }
        selected -> {
            container = MudColors.ControlSelected
            border = MudColors.ControlSelectedBorder
            content = MudColors.Ui
        }
        else -> {
            container = MudColors.Control
            border = MudColors.ControlBorder
            content = MudColors.Ui
        }
    }
    Button(
        onClick = onClick,
        enabled = enabled,
        // ★ 高度写死 + 最小宽度：这是"两排按钮下沿能对齐"的唯一来源
        modifier = modifier
            .defaultMinSize(minWidth = MudSizes.ControlMinW)
            .height(MudSizes.ControlH),
        shape = MudShapes.Control,
        border = BorderStroke(1.dp, border),
        colors = ButtonDefaults.buttonColors(
            containerColor = container,
            contentColor = content,
            disabledContainerColor = MudColors.Disabled,
            disabledContentColor = MudColors.OnDisabled,
        ),
        // ★ 传 `null` 而不是 `ButtonDefaults.buttonElevation()`：黑底上 1–2dp 的阴影
        //   会晕出一圈脏边，看起来像按钮"发霉"
        elevation = null,
        contentPadding = PaddingValues(horizontal = 10.dp, vertical = 0.dp),
    ) {
        Text(
            text = label,
            // ★ 与正文同档（wushen 的按钮就是 14px，没有小一号）
            style = MaterialTheme.typography.bodyMedium,
            // ★ Medium 而不是 Bold：12~14sp 的中文加粗在手机上会糊成一团，
            //   而"重要"已经由主行动的暗金底色表达了，不靠字重再加一层
            fontWeight = FontWeight.Medium,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            textAlign = TextAlign.Center,
            // ★★ 撑满 Row 才能真居中（见上面那段）。无界约束下自动退化，不会崩
            modifier = Modifier.fillMaxWidth(),
        )
    }
}

/**
 * 一块面板底（登录卡片、对话框都套它）。
 *
 * ★ 没换成 `Card`/`Surface`：`Card` 自带 elevation（阴影）与 12dp 圆角，
 *   两个都得改回去，改完剩下的能力就只是一个 `Box`。**这种"换了还得拆"的组件不用**。
 *
 * ★ 边框比控件边**暗**一档（`#343434` vs `#3A3A3A`）：面板是"容器"，控件是"可点的东西"，
 *   两者的轮廓在视觉上不该一样重 —— 一样重的时候，玩家分不清"这块是背景"还是"这块能按"。
 *
 * ★★ `clip` 不是为了圆角本身，是**为了裁子元素**：面板里几乎每一块（[MudPanelHeader]
 *   的 `#222` 条、`PanelDialog` 的 footer）都是 `fillMaxWidth()` 的**直角**矩形。
 *   面板一圆角，它们就会在四个角上戳出去，露出四个小尖 —— 比不圆角更难看。
 *   `clip` 在 `background`/`border` **之前**，才会同时裁掉子节点绘制。
 */
@Composable
fun MudPanel(
    modifier: Modifier = Modifier,
    content: @Composable () -> Unit,
) {
    Box(
        modifier = modifier
            .clip(MudShapes.Panel)
            .background(MudColors.Surface)
            .border(1.dp, MudColors.Border, MudShapes.Panel),
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
 *   第一版是手画的 16×16 像素格（还为此维护了两份坐标），第二版是"玉绿 × 纯黑"的
 *   生成图 —— **两版都被判"太丑"**。教训写在 26 册 §90.3 / §91.3：
 *   ① 16×16 的格子画不出武侠味；② 玉绿配纯黑是**冷色撞冷色**，两者都不暖，
 *   摆在一起像"显示器偏色"。现在换成暖棕袍 + 古铜金 + 朱砂红，才有金石气。
 *
 * ★ 代价：位图**改不了色**。它自带黑底与暖棕/古铜金/朱砂，界面底色
 *   （[MudColors.Background]）与它一致，才不会有色差。换主题色时这张图要一起换。
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

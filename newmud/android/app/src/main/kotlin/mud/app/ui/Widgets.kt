package mud.app.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.HorizontalDivider
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
 * ★★ 这个文件的立场变过两次，值得记下来：
 *
 *   第一版是"什么都自己画" —— 按钮是 `Box + background + border + clickable`，
 *   理由是"Material3 的默认形状/配色和自定义深色主题打架"。那个理由在当时成立，
 *   但它带来两个后果：① 每个屏各自拼一套（后来果然拼出了三套不一样的按钮）；
 *   ② **丢掉了组件自带的东西** —— 涟漪、禁用态语义、`minimumInteractiveComponentSize`
 *   的 48dp 触点、`Badge` 的角标排版、`LinearProgressIndicator` 的进度动画，全要自己补。
 *
 *   第二版改成：**能交给组件的交给组件，只把颜色/形状喂给它**（[MudAction] 内部是
 *   `Button`，血条是 `LinearProgressIndicator`，未读角标是 `Badge`）。
 *   于是这一层的职责变成"翻译 wushen 的 CSS 到 Material3 的参数"，而不是"重画一遍控件"。
 *
 *   第三版（2026-10-22，§92）把"翻译什么"框死：
 *   ⇒ **CSS 里"布局/色相"可以抄，"控件质感"必须按目标设备重推。**
 *   于是可点皮肤**只有一族**（黑底 + `#808080` 细边 + `#C0C0C0` 亮字，见 [MudAction]），
 *   主行动是唯一保留的自造色（暗金），"选中"这件事交给 [MudTab] 而不是按钮的 `selected`。
 *
 * ★★ **第四版（2026-10-22，§93）只动了一件事：输入框变成"凹槽"。**
 *   规则一句话：**槽与它所在的那一档永远差一档** ——
 *   主屏输入行坐在 `#000` 上 ⇒ 槽取 [MudColors.Recessed](#111)；
 *   聊天浮层与登录卡片本身就是 `#111` ⇒ 槽取 [MudColors.Background](#000)。
 *   两个方向都只差一档，读起来才是"凹进去的"而不是"又一块面板"
 *   （"多一层底"正是 §92.1 批过的那个病）。边**只留发丝线**：
 *   "能按"由 [MudAction] 的 `Line` 边承担（§92.4 第 2 句），输入框不是动作。
 *
 * ★ 没有换成组件的地方，理由写在各函数上（[MudPanel] / [MudField]）。
 *
 * ★ 配色全部来自 [MudColors]、尺寸全部来自 [MudSizes]、形状全部来自 [MudShapes]，
 *   这里不出现第二个十六进制、也不出现裸的 `数字.dp`。
 */

/**
 * 统一的输入框 —— **全端唯一的"凹槽"**（§93.1 第 2 / 4 条）。
 *
 * ★ 用 `OutlinedTextField` + 换配色，**不自己拼 `BasicTextField`**：
 *   自己拼要重做光标、选区、长按菜单、无障碍语义 —— 那是"为了好看把能用的东西弄坏"。
 *
 * ★★ **凹槽规则（为什么有 `fill` 参数）**：槽底与**它所在的那一档**永远差一档 ——
 *   · 主屏输入行坐在 `Background`(#000) 上 ⇒ 默认 [MudColors.Recessed](#111)，
 *     看上去是"嵌进黑底里的一条槽"（旧版底与整屏同色，整块只剩一条边，
 *     既不像槽、也不像能按，是主屏最模糊的一块）；
 *   · 聊天浮层（[ChatSheet]）与登录卡片自己就是 `#111` ⇒ 调用方显式传
 *     [MudColors.Background](#000)，槽比面**暗**一档。
 *   差两档会变成"又一块面板"，同档则整块看不见 —— 所以这个值不能有第二个默认，
 *   必须由"坐在什么底上"决定。
 *
 * ★★ **未聚焦边只留发丝线**（[MudColors.Hairline] #343434）：
 *   ① wushen 的 `.chat-input>.sender-box` 本来就是 `border: none; outline: none`
 *      （`style.css:1025-1026`）—— 网页端靠 `#bebebe` 亮底勾出槽，我们的槽
 *      只比面差一档，**不需要**一条 `#808080` 的边；
 *   ② 语义上更重要：`#808080` 的边是"这里能按"的信号（§92.4 第 2 句），
 *      输入框**不是动作**。给它一条和按钮一样重的边，等于在按钮旁边又摆了一排按钮。
 *   聚焦时转暗金边 —— 与未聚焦态差出两档，"光标在这儿"足够认。
 *
 * ★ 占位符用 [MudColors.Dim](#898989) 而不是 `Faint`(#505050)：指令行**没有浮动标签**
 *   （`label == null`），占位符是那一行唯一的"这里输什么"。`#505050` 压在 `#111` 上
 *   在户外基本看不见，而这行字是玩家唯一能看到的说明。
 *
 * ★ wushen 没有"登录表单"这种东西（它是网页 MUD，先有页面才谈登录），这一族的取值
 *   全部按触屏重推。wushen 原文（`.chat-input>.sender-box`，`style.css:1019-1034`）是
 *   `#bebebe` 底 + `#000` 字，与本项目「字亮 / 边中等 / 底黑」正好相反 ⇒
 *   **有意偏离 wushen**，完整理由见 [MudColors.Recessed] 的 KDoc
 *   （★ 那条理由是"字的方向相反"，**不是**"白底页面上的输入框" —— wushen 页面底色
 *   本来就是 `--bg:#000000`，`style.css:29`）。
 *
 * ★★ **为什么不把高度钉到 [MudSizes.ControlH]**(44dp)（§93.4）：M3 的
 *   `OutlinedTextFieldDefaults.MinHeight` 是 **56dp**（material3 1.3.1，BOM 2024.12.01；
 *   `OutlinedTextField.kt:224/399` 用它配 `.defaultMinSize(minHeight = …)` 强制），
 *   而经典 `(value, onValueChange)` 重载**不暴露 `contentPadding`** ⇒ 硬钉 44dp
 *   会把文字与浮动标签压进 12dp 的盒子里，字形被裁。
 *
 *   **1.3.1 里真实存在的逃生口只有一条**：`OutlinedTextFieldDefaults.DecorationBox(...)`
 *   （`@ExperimentalMaterial3Api`，签名里**有** `contentPadding: PaddingValues` 参数）
 *   + `BasicTextField(decorationBox = …)` 自绘。代价是自己拼装饰盒 ——
 *   光标 / 选区 / 长按菜单 / 无障碍语义要重新担一遍（见本函数开头那一条）。
 *
 *   ⚠️ `TextFieldState` 重载与 `OutlinedTextFieldDefaults.decorator(...)` **都是 1.4.0+
 *   的 API，1.3.1 里没有**（1.3.1 的 `OutlinedTextField.kt` 只有 String / TextFieldValue
 *   两个重载，全树 0 处 `TextFieldState`、0 处 `decorator`）—— 想走那条，
 *   **先把 BOM 升到 ≥1.4.0**。本机无 JDK 编不了 ⇒ **动手前先对着 sources jar 核
 *   API 是否存在**，别照着网上的新文档直接写。
 *
 *   ⇒ **本批不钉高度**，字段保持 56dp 自然高度；输入行因此比动作栏高一档，
 *     这是已知代价（§93.4）。
 *
 * @param fill 槽底：**取它所在那一档的相邻档**（见上面的凹槽规则）
 * @param label 有值时显示浮动标签（登录屏要它），无值时只显示占位符（输入行要它）
 */
@Composable
fun MudField(
    value: String,
    onValueChange: (String) -> Unit,
    placeholder: String,
    modifier: Modifier = Modifier,
    label: String? = null,
    fill: Color = MudColors.Recessed,
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
            // 槽底：与它所在的那一档差一档（凹槽规则，见 KDoc）—— 聚焦不换底，
            // 换底会让"光标进来了"看起来像"换了另一个框"
            focusedContainerColor = fill,
            unfocusedContainerColor = fill,
            // 聚焦时边框转成暗金：这是"光标在这个框里"唯一不靠闪动的信号；
            // 未聚焦只留发丝线（输入框不是动作，不与按钮抢"能按"的语义）
            focusedBorderColor = MudColors.PrimaryBorder,
            unfocusedBorderColor = MudColors.Hairline,
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
 * ★★ **文字居中靠 `fillMaxWidth()` + `textAlign`，缺一不可**（更早一版两样都没有）：
 *   `Button` 的内容是一个 `Row(horizontalArrangement = Center)`，但那个 `Row` 的宽度是
 *   **wrap content** —— 它自己贴着 `Surface` 的左边缘（`Box` 默认 `TopStart`）。
 *   于是「按钮被拉满整行」时，居中只是"文字在它自己那一小条里居中"，
 *   整条还在左边。加上 `fillMaxWidth()` 让 `Row` 撑满，`Arrangement.Center` 才真的居中。
 *   ★ 在 `LazyRow` / `FlowRow` 里（宽度无界）`fillMaxWidth` 会退化成不填充，正好无害。
 *
 * ★★ **大小不一**由两个常量管住：高度 [MudSizes.ControlH]、最小宽度 [MudSizes.ControlMinW]。
 *   不设的话 `Button` 用 M3 默认 `minWidth = 58dp`，「聊」和「小地图」同排宽度差一倍多。
 *
 * ★★ **没有 `selected` 参数**（§92.6.1）：旧版一个 `selected` 被四个语义完全不同的
 *   调用点共用 —— 玩家卡（"这是个玩家"）、频道页签（"选中"）、地图开关（"开着"）、
 *   聊天入口（"有未读"）。其中只有两个真的是"选中"。
 *   ⇒ 真正的"选中"用 [MudTab]；"这是玩家"用边色 [MudColors.Accent]；
 *     "有未读"用 `Badge`（本来就有，`selected` 是重复表达）。
 *
 * ★★ **皮肤只有三态，且全部是"透明底"**（§92.4 第 2 句）：
 *
 *   | 态 | 底 | 边 | 字 |
 *   |---|---|---|---|
 *   | 普通 | `Background` `#000` | `Line` `#808080` | `Ui` `#C0C0C0` |
 *   | `primary` | `Primary` `#43390F` | `PrimaryBorder` `#7A6820` | `OnPrimary` `#E9DEA1` |
 *   | `!enabled` | `Background` `#000` | `Hairline` `#343434` | `Faint` `#505050` |
 *
 * @param primary 主行动（连接 / 发送）：暗金底 + 浅金字
 */
@Composable
fun MudAction(
    label: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    primary: Boolean = false,
) {
    // 三种"皮肤"一次算完：容器色 / 边色 / 字色。分开写会各自漂移。
    val container: Color
    val border: Color
    val content: Color
    when {
        !enabled -> {
            container = MudColors.Background
            border = MudColors.Hairline
            content = MudColors.Faint
        }
        primary -> {
            container = MudColors.Primary
            border = MudColors.PrimaryBorder
            content = MudColors.OnPrimary
        }
        else -> {
            container = MudColors.Background
            border = MudColors.Line
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
        border = BorderStroke(MudSizes.HairlineW, border),
        colors = ButtonDefaults.buttonColors(
            containerColor = container,
            contentColor = content,
            disabledContainerColor = MudColors.Background,
            disabledContentColor = MudColors.Faint,
        ),
        // ★ 传 `null` 而不是 `ButtonDefaults.buttonElevation()`：黑底上 1–2dp 的阴影
        //   会晕出一圈脏边，看起来像按钮"发霉"
        elevation = null,
        contentPadding = PaddingValues(horizontal = MudSizes.ControlPadH),
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
 * 页签：**唯一带"选中"语义的零件**（§92.6.2）。
 *
 * ★ 为什么单独开一个组件而不是给 [MudAction] 加 `selected`：
 *   页签与动作是两件事 —— 动作是"点一下发一条命令"，页签是"我现在在看哪一页"。
 *   共用一个参数会让"有未读的聊天入口"看起来跟"当前频道"一样（旧版正是这样）。
 *
 * ★ 高度 [MudSizes.TabH](36dp)，比动作矮一档；形状 [MudShapes.Tab]（只圆上两角，
 *   照 wushen `.channel-box>span{border-bottom:none}`）。
 *
 * ★★ **36dp 会真的生效，不会被 M3 的 48dp 触点顶掉**：M3 `Button` 内部套了
 *   `minimumInteractiveComponentSize()`（`minHeight = 48dp`），但显式 `height(36dp)`
 *   是 `SizeModifier`，它把约束设成 **min = max = 36**；内层的
 *   `Constraints.copy(minHeight = 48)` 会把 `minHeight` **夹到 `maxHeight`**
 *   ⇒ min 仍为 36，不抛异常、也不被撑高。**显式 `height()` 胜出。**
 *   ⚠️ 代价：触点 36dp。这是**照网页端、不照触屏推荐值**的有意取舍
 *      （wushen 自己的频道页签约 27px），**不要自作主张改回去**。
 *
 * ★ 配色一句话记住：**未选中是槽，选中是面。**
 *   未选中 = `Background`(#000) 底 + `Line` 边 + `Dim` 字（在 `#111` 的浮层上像凹进去的槽）；
 *   选中   = `Recessed`(#111) 底 + `Accent`(橄榄) 边 + `Ui` 字（与浮层同色 = 这一页被打开了）。
 *
 * @param modifier 由 [MudTabRow] 传 `weight(1f)` 均分，外部一般不用传
 */
@Composable
fun MudTab(
    label: String,
    selected: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val container = if (selected) MudColors.Recessed else MudColors.Background
    val border = if (selected) MudColors.Accent else MudColors.Line
    val content = if (selected) MudColors.Ui else MudColors.Dim
    Button(
        onClick = onClick,
        // ★ 均分 ⇒ **不设最小宽**：页签的宽度由 `weight(1f)` 定，不靠内容撑
        modifier = modifier.height(MudSizes.TabH),
        shape = MudShapes.Tab,
        border = BorderStroke(MudSizes.HairlineW, border),
        colors = ButtonDefaults.buttonColors(
            containerColor = container,
            contentColor = content,
        ),
        elevation = null,
        contentPadding = PaddingValues(horizontal = MudSizes.Gap2),
    ) {
        Text(
            text = label,
            style = MaterialTheme.typography.bodyMedium,
            fontWeight = FontWeight.Medium,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            textAlign = TextAlign.Center,
            modifier = Modifier.fillMaxWidth(),
        )
    }
}

/**
 * 一排页签 + 右端一颗定宽按钮（§92.6.3）。
 *
 * ★★ 抽它的直接理由就是**窄屏溢出**：旧版 ChatSheet 用 `Row` 直接摆 3 颗全尺寸
 *   `MudAction` + 「收起」，3×76 + 3×6 + 76 = 322dp，只有 320dp 窄屏 / 放大系统字号
 *   时才会溢出，而 `Row` **没有 `horizontalScroll`，溢出即静默裁掉右端** ——
 *   玩家只会觉得"少了个选项"。
 *   ⇒ 这里改成 `weight(1f)` 均分 + `trailing` 定宽 [MudSizes.ControlMinW]，
 *     窄屏只会变窄，不会丢东西。
 *
 * ★ 将来地图 / 背包 / 技能的切换也用它，于是"均分"这件事只有一个实现。
 *
 * @param trailing 右端那颗（如「收起」），定宽 [MudSizes.ControlMinW]
 */
@Composable
fun MudTabRow(
    labels: List<String>,
    selectedIndex: Int,
    onSelect: (Int) -> Unit,
    modifier: Modifier = Modifier,
    trailing: (@Composable () -> Unit)? = null,
) {
    Row(modifier = modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        // ★ `for` 而不是 `forEachIndexed`：后者收的 lambda 不是 `@Composable`，
        //   在里面调 `@Composable` 函数**编译不过**（这是 Compose 的硬约束，不是风格）。
        for (index in labels.indices) {
            if (index > 0) {
                Spacer(modifier = Modifier.width(MudSizes.Gap2))
            }
            MudTab(
                label = labels[index],
                selected = index == selectedIndex,
                onClick = { onSelect(index) },
                modifier = Modifier.weight(1f),
            )
        }
        if (trailing != null) {
            Spacer(modifier = Modifier.width(MudSizes.Gap2))
            Box(modifier = Modifier.width(MudSizes.ControlMinW)) {
                trailing()
            }
        }
    }
}

/**
 * 一个区块容器（§92.6.4）：**统一的左右 / 上下内边距**，可选一条下沿发丝线。
 *
 * ★ 为什么需要它：旧代码里 5 个区块各自的 padding 是 `(12,6)` / `(12,8)` /
 *   `(8,6)` / `(14,8)` … 四份不同的值，于是"屏左右内边距"这件事没有唯一答案，
 *   任何一处改动都会让某一块比别的宽/窄一点。
 *   ⇒ 现在所有区块的横向内边距都来自 [MudSizes.ScreenPadH]。
 *
 * ★ **只有下沿一条线**：规范是"区块之间只用一条发丝线"，画在**上一个**区块的下沿，
 *   不画两条（两个区块之间出现两条线，比没有线更难看）。
 *
 * ★ 不新增 `MudDivider` —— M3 的 [HorizontalDivider] 够用（BOM `2024.12.01`
 *   ⇒ Material3 1.3，有这个 API）。
 */
@Composable
fun MudSection(
    modifier: Modifier = Modifier,
    hairline: Boolean = false,
    content: @Composable () -> Unit,
) {
    Column(modifier = modifier) {
        // 内容带内边距，发丝线**不带**（它要横跨整屏，才知道"这一整条是两个区块的界"）
        Column(
            modifier = Modifier.padding(
                horizontal = MudSizes.ScreenPadH,
                vertical = MudSizes.BlockPadV,
            ),
        ) {
            content()
        }
        if (hairline) {
            HorizontalDivider(
                color = MudColors.Hairline,
                thickness = MudSizes.HairlineW,
            )
        }
    }
}

/**
 * 一块面板底（登录卡片、对话框都套它）。
 *
 * ★ 没换成 `Card`/`Surface`：`Card` 自带 elevation（阴影）与 12dp 圆角，
 *   两个都得改回去，改完剩下的能力就只是一个 `Box`。**这种"换了还得拆"的组件不用**。
 *
 * ★★ 底默认是 `Background`(#000)，**照 wushen `.dialog{background:var(--bg)}`**
 *   （`style.css:1084`）：面板正文与页面**同底**，靠 `#343434` 边和 `#222` 头脚带区分。
 *   旧版给面板刷 `#111` ⇒ 面板变成"浮起来的一块灰"，是"多一层底"的典型。
 *
 * ★ 边框比控件边**暗**一档（`Hairline` #343434 vs `Line` #808080）：面板是"容器"，
 *   控件是"可点的东西"，两者轮廓不该一样重 —— 一样重时玩家分不清
 *   "这块是背景"还是"这块能按"。
 *
 * ★★ `clip` 不是为了圆角本身，是**为了裁子元素**：面板里几乎每一块（[MudPanelHeader]
 *   的 `#222` 条、面板脚）都是 `fillMaxWidth()` 的**直角**矩形。
 *   面板一圆角，它们就会在四个角上戳出去，露出四个小尖 —— 比不圆角更难看。
 *   `clip` 在 `background`/`border` **之前**，才会同时裁掉子节点绘制。
 *
 * @param container 面板底：**提示框与登录卡片传 `Recessed`**（前者照 wushen
 *   `.warn-dialog{background:var(--panel)}`，后者是"表单"、wushen 无对应物），
 *   其余一律 `Background`。
 */
@Composable
fun MudPanel(
    modifier: Modifier = Modifier,
    container: Color = MudColors.Background,
    content: @Composable () -> Unit,
) {
    Box(
        modifier = modifier
            .clip(MudShapes.Panel)
            .background(container)
            .border(MudSizes.HairlineW, MudColors.Hairline, MudShapes.Panel),
    ) {
        content()
    }
}

/**
 * 面板的标题栏（wushen `.dialog-header`：`#222` 底 + 橄榄色标题 + 灰色关闭）。
 *
 * ★ 抽出来是因为物件面板与将来的 `skills` / `score` 面板都是这个头。
 *   wushen 里 `.dialog-header` 是**独立的一段**（有底色的条），不是"正文的第一行" ——
 *   第一版把标题和正文排在一起、同色同字号，读起来像"标题是第一行正文"（26 册 §89.4）。
 *
 * ★ 关闭键仍是 [MudAction]（44dp），**与带同高** ⇒ 带里不放第二种控件高度
 *   （§91.3：高度只有一个来源）。曾经考虑给面板头一颗 32dp 的小关闭键，
 *   那会在 `MudSizes` 里加第二个控件高度 —— 不做。
 */
@Composable
fun MudPanelHeader(title: String, onClose: (() -> Unit)?) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier
            .fillMaxWidth()
            .background(MudColors.Band)
            .padding(
                start = MudSizes.ScreenPadH,
                end = MudSizes.Gap2,
                top = MudSizes.GapTiny,
                bottom = MudSizes.GapTiny,
            ),
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

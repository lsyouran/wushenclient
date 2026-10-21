package mud.app.ui

import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import mud.core.ColorToken

/**
 * 配色与字号。
 *
 * ★★ **这一套是 wushen 前端 `src/styles/global.css` 的原值，不是"重新设计的深色主题"。**
 *   第一版自定了一套 Catppuccin 味的深灰（#14161A 底、灰白字、青绿强调），
 *   看起来"现代"，但和网页端是两个 App —— 同一个角色名在网页上是绿字，
 *   在手机上是灰白字。用户的要求是"配色按 wushen 默认的前端那样调"，于是这里改成抄：
 *
 *   | wushen CSS | 值 | 在哪 |
 *   |---|---|---|
 *   | `body { background-color }` | `#000000` | [MudColors.Background] |
 *   | `body { color }` | `#008000` | [MudColors.Text]（游戏正文） |
 *   | `.dialog-content` / `.eq-group` | `#111111` | [MudColors.Surface] |
 *   | `.dialog-header` / `.dialog-footer` | `#222222` | [MudColors.Header] |
 *   | `.progress { border }` | `#343434` | [MudColors.Border] |
 *   | `.progress-num { color }` | `#898989` | [MudColors.Dim] |
 *   | `.dialog-title { color }` | `#808000` | [MudColors.Accent] |
 *   | `.dialog-footer > .ok { color }` | `#00FFFF` | [MudColors.Strong] |
 *   | `WHT` | `#C0C0C0` | [MudColors.Ui]（界面文字） |
 *
 * ★ 只有 [MudColors.SurfaceAlt] 是 wushen 里**没有对应物**的：#1A1A1A，
 *   卡在 `#111`（面板内容）与 `#222`（面板头脚）之间，给"房间区 / 状态条"这种
 *   "要跟正文分开、但又不该是面板"的区块用。wushen 是网页，房间描述直接画在黑底上；
 *   手机屏幕小，不分区就分不清哪块是房间、哪块是消息流。
 *
 * ★★ **但"控件"这一层不能照抄（2026-10-22 返工）。**
 *   上一版把 `.tool-bar > .tool-item`（`#808080` 底 / `#111` 字 / 无圆角）与
 *   `.sender-btn`（`#ababab` 底 / `#343434` 字）原样搬到手机上，结果是：
 *   ① **灰底深字在纯黑背景上是最刺眼的一组对比** —— 网页端四周是白底页面，
 *      灰块是"比页面稍深"的凹陷按钮；搬到黑底上它变成一块**发光的亮片**，
 *      视觉权重比正文高十倍，一屏十几个按钮就是一屏亮块；
 *      ② **浅灰 + 纯黑本身就不协调** —— 冷灰是与黑同族的"无彩色"，
 *      而 wushen 的调性是**黑底绿字 + 橄榄金标题**（暖的、有色的）。
 *      灰块既不暖也不冷，它不属于这套调性，只是"从网页上剪下来的一块"；
 *      ③ 无圆角是**桌面端的正确解**（鼠标点击区域精确，方正=整齐），
 *      在触屏上是**错误解**（手指没有精确落点，方正边缘看起来像表格单元格）。
 *
 *   ⇒ 这一版把两者分开：
 *      · **照抄的是"调性"**（黑底 / 正文绿 `#008000` / 面板 `#111` / 标题橄榄 `#808000`
 *        / 确认青 `#00FFFF`）—— 这是"看起来像同一个游戏"的部分；
 *      · **重新设计的是"控件"**（[MudColors.Control] 一族）—— 暗底 + 细边 + 亮字，
 *        主行动用**暗金**（与标题同属暖黄系）。手机上按钮的语义是"这里能按"，
 *        靠**边框与亮度差**表达，而不是靠"比背景亮一大块"。
 *
 * ★ 字号仍然只有**一档**（[BASE_SP] = 14sp），这条没变 —— wushen 的 `font-size: 14px`
 *   就是全站唯一的字号，标题靠**字重/颜色**拉层次（`.dialog-title` 只换色不换字号）。
 */
object MudColors {
    // ── 底 ──
    val Background = Color(0xFF000000)
    val Surface = Color(0xFF111111)
    val SurfaceAlt = Color(0xFF1A1A1A)
    val Header = Color(0xFF222222)
    val Border = Color(0xFF343434)

    // ── 字 ──
    /** 游戏正文（房间描述、消息流、服务端文本的默认色） */
    val Text = Color(0xFF008000)

    /** 界面文字：角色名、按钮上的字、对话框正文之外的标签 */
    val Ui = Color(0xFFC0C0C0)

    /** 次要信息（时间戳、数值、提示） */
    val Dim = Color(0xFF898989)

    /** 强调：房名、面板标题（wushen 用橄榄色 `.dialog-title`） */
    val Accent = Color(0xFF808000)

    /** 可点的东西 / "确认"（wushen `.ok` 用青色） */
    val Strong = Color(0xFF00FFFF)

    // ── 语义（都取自 wushen 的颜色标签表，见 `spanStyleOf`）──
    /** 错误（`HIR`） */
    val Error = Color(0xFFFF0000)

    /** 进账 / 得物（`HIG`） */
    val Gain = Color(0xFF00FF00)

    /** 战斗回显（`HIO`） */
    val Fight = Color(0xFFFFA500)

    /** 私聊（`HIM`） */
    val Tell = Color(0xFFFF00FF)

    /**
     * 气血条（wushen `.hp > .progress-bar { background-color: darkred }`）。
     *
     * ★ `darkred` 在纯黑底上非常暗 —— 网页端也一样，它靠 `.progress { border: 1px solid
     *   #343434 }` 那道边框把条形"框"出来。所以条形**没有边框就会看起来像没画**，
     *   这一条在 [GameScreen] 里靠 `trackColor` 承担。
     */
    val Hp = Color(0xFF8B0000)

    /** 内力条（wushen `.mp > .progress-bar { background-color: darkblue }`） */
    val Mp = Color(0xFF00008B)

    // ── 控件（这一族在 wushen 里**没有原值**，理由见文件头 ★★）────────────────
    //
    //   三个态的亮度差只有 10~15 级：黑底上的"可点"应该靠**边框**和**字色**读出来，
    //   不靠底色的明暗跳变。这样一屏十几个按钮散在正文里，视线仍然先落在文字上。

    /** 普通按钮底：比面板 `#111` 亮一档，看得出"是块凸起"，但不会跳 */
    val Control = Color(0xFF1A1A1A)

    /** 普通按钮边：比底亮 32 级 —— 这是"这里能按"的主要信号 */
    val ControlBorder = Color(0xFF3A3A3A)

    /** 选中/按下（频道页签、开着的地图） */
    val ControlSelected = Color(0xFF2A2A28)

    /** 选中态的边：偏橄榄，和面板标题 `#808000` 是同一个色系 */
    val ControlSelectedBorder = Color(0xFF6E6220)

    /** 主行动底（连接 / 发送）：暗金 —— 与 `.dialog-title` 的橄榄同族，压暗到不发光 */
    val Primary = Color(0xFF43390F)

    /** 主行动边：比底亮，勾出轮廓 */
    val PrimaryBorder = Color(0xFF7A6820)

    /** 主行动的字：浅金（不是纯白 —— 纯白在这套暖调里显得脏） */
    val OnPrimary = Color(0xFFE9DEA1)

    /** 禁用底/边：几乎与背景同色，只留一条能看到"这里有个东西但它不响应"的边 */
    val Disabled = Color(0xFF131313)
    val DisabledBorder = Color(0xFF262626)

    /** 禁用字：仍然要**读得清** —— 灰色的字如果糊掉，玩家会以为是自己眼睛有问题 */
    val OnDisabled = Color(0xFF5E5E5E)
}

/**
 * 全站形状。
 *
 * ★★ 上一版只有一个 `Sharp = 2.dp`，用在按钮、输入框、面板、角标**全部地方** ——
 *   理由是"wushen 的 `.tool-item` 没有 `border-radius`"。那个理由是**照抄而不是判断**：
 *   2dp 在 3x 屏上是 6 个物理像素，看上去就是直角。
 *   直角按钮在网页上是"整齐"，在手机上是"没做完" —— 触屏控件的圆角是**手指形状**的语言。
 *
 * ★ 三档，按"这块东西多大"分：
 *   - [Control] 6dp：手指要按的东西（按钮、输入框、可点的行）
 *   - [Panel] 10dp：一整块容器（对话框、登录卡片）
 *   - [Tag] 3dp：文本旁边的小块（「战斗中」、浮层的拖拽条、进度条）
 *   - [Sheet] 14dp：贴底浮层，只圆上面两角
 */
object MudShapes {
    val Control = RoundedCornerShape(6.dp)
    val Panel = RoundedCornerShape(10.dp)
    val Tag = RoundedCornerShape(3.dp)

    /** 贴底浮层的形状：只圆上面两角（下沿贴着屏幕，圆了反而露出底色） */
    val Sheet = RoundedCornerShape(topStart = 14.dp, topEnd = 14.dp)
}

/**
 * 尺寸常量：**只在这里有第二份就会错位**。
 *
 * ★★ `MudAction` 内部是 M3 的 `Button`（视觉 40dp、触点 48dp），而 `ActorChip` 是自绘的
 *   `Box`（上一版写死 `minHeight = 44.dp`，注释还写着"与 MudAction 同一套尺寸"）——
 *   两句都实现之后，**出口那一排 40dp、人物那一排 44dp**，两排下沿差 4dp。
 *   这就是"大小不一"里最难看的一种：不是随机的，是**系统性错位**。
 *
 * ⇒ 高度只有一个来源；自绘的控件读它，组件的按钮也显式设成它。
 */
object MudSizes {
    /**
     * 控件视觉高度。
     *
     * ★ 取 44dp 而不是 M3 默认的 40dp：一排按钮与一排人物卡片要**下沿对齐**，
     *   而人物卡片里有两行字（名字 + 气血条），压到 40dp 会挤。
     *   44dp 上仍有余量给 M3 的 `minimumInteractiveComponentSize` 撑出 48dp 触点。
     */
    val ControlH = 44.dp

    /**
     * 按钮最小宽度。
     *
     * ★ 存在的理由就是"大小不一的按钮"：`Button` 默认 `minWidth = 58.dp`，
     *   于是「聊」和「小地图」在同一排里宽度差一倍多，看起来像两种控件。
     *   76dp ≈ 4 个 14sp 汉字 + 左右内边距 —— 2 字、3 字、4 字的按钮基本等宽，
     *   5 字以上才拉长（那时它本来就该更长）。
     */
    val ControlMinW = 76.dp
}

/** 全站唯一一档字号（wushen 的 14px） */
const val BASE_SP = 14

private val MudTypography = Typography().let { base ->
    // ★ 只改正文与标签的两处：其余保留 Material3 默认（按钮 / 标题的字号差异是有意义的，
    //   我们不该为了"统一"把它们也压成 14sp —— 那会让标题和正文分不开）。
    base.copy(
        bodyMedium = base.bodyMedium.copy(fontSize = BASE_SP.sp, lineHeight = 20.sp),
        bodySmall = base.bodySmall.copy(fontSize = (BASE_SP - 2).sp, lineHeight = 16.sp),
    )
}

@Composable
fun MudTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = darkColorScheme(
            primary = MudColors.Accent,
            onPrimary = MudColors.Ui,
            background = MudColors.Background,
            onBackground = MudColors.Ui,
            surface = MudColors.Surface,
            onSurface = MudColors.Ui,
            surfaceVariant = MudColors.SurfaceAlt,
            onSurfaceVariant = MudColors.Dim,
            secondaryContainer = MudColors.Header,
            onSecondaryContainer = MudColors.Ui,
            outline = MudColors.Border,
            error = MudColors.Error,
            onError = MudColors.Background,
        ),
        typography = MudTypography,
        content = content,
    )
}

/**
 * 服务端文本里的颜色标签 → Compose 的 [SpanStyle]。
 *
 * ★★ 这些是 wushen `src/styles/global.css` 里 **30 个标签类的原值**，不是近似色。
 *   改这里的任何一个数，都会让"同一句话在网页端与手机端不是同一个颜色"。
 *   前两版用的是一套自己配的近似色（Catppuccin 风），看起来协调，但对不上网页端 ——
 *   于是玩家在两边看到的是两种界面。
 *
 * ★★ `when` **没有 `else`**：`ColorToken` 是在 `:core` 里定义的枚举，
 *   新增一个标签而不给它配色 ⇒ 这里**编译不过**。
 *   写 `else -> SpanStyle()` 的后果是"新标签静默变成默认色" ——
 *   服务端用了它，而两端看起来不一样，且没有任何东西会红。
 *
 * ★ 背景色那两族（`Bxxx` / `HBxxx`）只设 `background`，不改前景：
 *   wushen 的语义就是"换底色"，前景由外层的颜色标签决定（CSS 层叠）。
 *   ⚠️ 其中一个反直觉的值照着抄了：`BBLK` 的底色是**白色 `#FFFFFF`**
 *   （"黑底"标签在网页上是"反白"）。看起来像写错了，但它是原值。
 */
fun spanStyleOf(token: ColorToken): SpanStyle = when (token) {
    // ── 暗色前景（10 档）──
    ColorToken.NOR -> SpanStyle(color = Color(0xFF008000))
    ColorToken.GRE -> SpanStyle(color = Color(0xFF008000))
    ColorToken.BLK -> SpanStyle(color = Color(0xFF505050))
    ColorToken.BLU -> SpanStyle(color = Color(0xFF000080))
    ColorToken.CYN -> SpanStyle(color = Color(0xFF008080))
    ColorToken.RED -> SpanStyle(color = Color(0xFF800000))
    ColorToken.MAG -> SpanStyle(color = Color(0xFF800080))
    ColorToken.YEL -> SpanStyle(color = Color(0xFF808000))
    ColorToken.WHT -> SpanStyle(color = Color(0xFFC0C0C0))
    ColorToken.ORA -> SpanStyle(color = Color(0xFFD26900))

    // ── 亮色前景（12 档）──
    ColorToken.HIK -> SpanStyle(color = Color(0xFF808080))
    ColorToken.HIB -> SpanStyle(color = Color(0xFF0000FF))
    ColorToken.HIG -> SpanStyle(color = Color(0xFF00FF00))
    ColorToken.HIC -> SpanStyle(color = Color(0xFF00FFFF))
    ColorToken.HIR -> SpanStyle(color = Color(0xFFFF0000))
    ColorToken.HIM -> SpanStyle(color = Color(0xFFFF00FF))
    ColorToken.HIY -> SpanStyle(color = Color(0xFFFFFF00))
    ColorToken.HIW -> SpanStyle(color = Color(0xFFFFFFFF))
    ColorToken.HIO -> SpanStyle(color = Color(0xFFFFA500))
    ColorToken.HIJ -> SpanStyle(color = Color(0xFFFFD700))
    ColorToken.HIZ -> SpanStyle(color = Color(0xFF912CEE))
    ColorToken.ORD -> SpanStyle(color = Color(0xFFFF4500))

    // ── 暗色背景（8 档）──
    ColorToken.BBLK -> SpanStyle(background = Color(0xFFFFFFFF))
    ColorToken.BBLU -> SpanStyle(background = Color(0xFF000080))
    ColorToken.BCYN -> SpanStyle(background = Color(0xFF008080))
    ColorToken.BRED -> SpanStyle(background = Color(0xFF800000))
    ColorToken.BMAG -> SpanStyle(background = Color(0xFF800080))
    ColorToken.BYEL -> SpanStyle(background = Color(0xFF808000))
    ColorToken.BWHT -> SpanStyle(background = Color(0xFFC0C0C0))
    ColorToken.BHIK -> SpanStyle(background = Color(0xFF808080))

    // ── 亮色背景（7 档）──
    ColorToken.HBBLU -> SpanStyle(background = Color(0xFF0000FF))
    ColorToken.HBGRN -> SpanStyle(background = Color(0xFF00FF00))
    ColorToken.HBCYN -> SpanStyle(background = Color(0xFF00FFFF))
    ColorToken.HBRED -> SpanStyle(background = Color(0xFFFF0000))
    ColorToken.HBMAG -> SpanStyle(background = Color(0xFFFF00FF))
    ColorToken.HBYEL -> SpanStyle(background = Color(0xFFFFFF00))
    ColorToken.HBWHT -> SpanStyle(background = Color(0xFFFFFFFF))

    // ── 版式 ──
    // `DEL`：wushen 是 `text-decoration: line-through; color: gray`
    ColorToken.DEL -> SpanStyle(textDecoration = TextDecoration.LineThrough, color = Color(0xFF808080))
    // `MEM`：wushen 里没有这个类。只给斜体、**不指定颜色** —— 让前景保持外层的颜色，
    //   这样"服务端给一段斜体红字"，红不会被我们改成灰
    ColorToken.MEM -> SpanStyle(fontStyle = FontStyle.Italic)
    // `opt`：wushen 是 `opacity: 0.5`，即"继承色减半"。这里只能取正文色减半近似 ——
    //   SpanStyle 拿不到外层的颜色，而把整段变灰（第一版的做法）是另一个意思
    ColorToken.OPT -> SpanStyle(color = Color(0xFF008000).copy(alpha = 0.5f))
    // `FLA`：wushen 的 `FLA {}` 是**空规则**（真实存在，不是漏写）。这里只留字重，
    //   不加颜色 —— 空规则抄过来等于什么都不做，那这个 token 就白定义了
    ColorToken.FLA -> SpanStyle(fontWeight = FontWeight.Bold)
    // `line`：wushen 是 `color: #008080; display: inline-block; width: 100%; text-align: center`
    //   —— 一条青色分隔线。文本通常为空，真带内容时按"青色 + 等宽"画
    ColorToken.LINE -> SpanStyle(color = Color(0xFF008080), fontFamily = FontFamily.Monospace)
}

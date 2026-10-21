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
}

/**
 * 全站两种形状。
 *
 * ★ `Sharp` = 2dp。wushen 的按钮基本**没有圆角**（`.tool-bar > .tool-item` 只有 `border`
 *   没有 `border-radius`），频道页签是 `3px` 上圆角、未读角标是 `0.6em`。
 *   手机屏上 2dp 只有几个物理像素，看上去就是直角 —— 两头都照顾到了。
 * ★ `Soft` 只留给"贴边一整块"的东西与角标。
 */
object MudShapes {
    val Sharp = RoundedCornerShape(2.dp)
    val Soft = RoundedCornerShape(8.dp)

    /** 贴底浮层的形状：只圆上面两角（下沿贴着屏幕，圆了反而露出底色） */
    val Sheet = RoundedCornerShape(topStart = 8.dp, topEnd = 8.dp)
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

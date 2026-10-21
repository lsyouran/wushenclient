package mud.app.ui

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
import androidx.compose.ui.unit.sp
import mud.core.ColorToken

/**
 * 配色与字号。
 *
 * ★ 只有**一档字号**（[BASE_SP] = 14sp），其余全部由它派生 —— 这是照 wushen 来的：
 *   它全站只有 14px 一个字号，标题靠**字重/颜色**拉开层次，不靠放大。
 *   多一档字号就多一处"这两处谁该更大"的讨论，而移动端屏幕本来就窄。
 *
 * ★ 颜色**不搬网页端那套十六进制**：网页端是照 wushen 的 CSS 抄的，
 *   那套底色是给桌面浏览器定的。这里按"深色终端"重新定，
 *   但**语义位置**一一对应（正文 / 次要 / 强调 / 错误 / 进账 / 战斗），
 *   于是"哪一种文本该显眼"这件事两端一致。
 */
object MudColors {
    val Background = Color(0xFF14161A)
    val Surface = Color(0xFF1C1F26)
    val SurfaceAlt = Color(0xFF23262E)
    val Border = Color(0xFF333845)

    /** 正文 */
    val Text = Color(0xFFD8DCE4)

    /** 次要信息（时间戳、房间出口名、提示） */
    val Dim = Color(0xFF8A93A5)

    /** 强调（标题、可点的东西） */
    val Accent = Color(0xFF7FB3A3)

    /** 错误 / 拒绝 */
    val Error = Color(0xFFE06C75)

    /** 进账 / 得物 */
    val Gain = Color(0xFF98C379)

    /** 战斗回显 */
    val Fight = Color(0xFFE5C07B)

    /** 私聊 */
    val Tell = Color(0xFFC678DD)
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
            onPrimary = MudColors.Background,
            background = MudColors.Background,
            onBackground = MudColors.Text,
            surface = MudColors.Surface,
            onSurface = MudColors.Text,
            surfaceVariant = MudColors.SurfaceAlt,
            onSurfaceVariant = MudColors.Dim,
            outline = MudColors.Border,
            error = MudColors.Error,
        ),
        typography = MudTypography,
        content = content,
    )
}

/**
 * 服务端文本里的颜色标签 → Compose 的 [SpanStyle]。
 *
 * ★★ `when` **没有 `else`**：`ColorToken` 是在 `:core` 里定义的枚举，
 *   新增一个标签而不给它配色 ⇒ 这里**编译不过**。
 *   写 `else -> SpanStyle()` 的后果是"新标签静默变成默认色" ——
 *   服务端用了它，而两端看起来不一样，且没有任何东西会红。
 *
 * ★ 背景色那两族（`B*` / `HB*`）只设 `background`，不改前景：
 *   wushen 的 `B` 标签语义就是"换底色"，前景由外层的颜色标签决定。
 */
fun spanStyleOf(token: ColorToken): SpanStyle = when (token) {
    // ── 暗色前景 ──
    ColorToken.NOR -> SpanStyle(color = MudColors.Text)
    ColorToken.GRE -> SpanStyle(color = Color(0xFF98C379))
    ColorToken.BLK -> SpanStyle(color = Color(0xFF5B6373))
    ColorToken.BLU -> SpanStyle(color = Color(0xFF6199C8))
    ColorToken.CYN -> SpanStyle(color = Color(0xFF56B6C2))
    ColorToken.RED -> SpanStyle(color = Color(0xFFBE5046))
    ColorToken.MAG -> SpanStyle(color = Color(0xFFC678DD))
    ColorToken.YEL -> SpanStyle(color = Color(0xFFC9A227))
    ColorToken.WHT -> SpanStyle(color = Color(0xFFC8CCD4))
    ColorToken.ORA -> SpanStyle(color = Color(0xFFD19A66))

    // ── 亮色前景 ──
    ColorToken.HIK -> SpanStyle(color = Color(0xFF7C8698))
    ColorToken.HIB -> SpanStyle(color = Color(0xFF6FB3FF))
    ColorToken.HIG -> SpanStyle(color = Color(0xFFA5E075))
    ColorToken.HIC -> SpanStyle(color = Color(0xFF7FE3EA))
    ColorToken.HIR -> SpanStyle(color = Color(0xFFFF6B6B))
    ColorToken.HIM -> SpanStyle(color = Color(0xFFE08BF0))
    ColorToken.HIY -> SpanStyle(color = Color(0xFFFFD75F))
    ColorToken.HIW -> SpanStyle(color = Color(0xFFFFFFFF))
    ColorToken.HIO -> SpanStyle(color = Color(0xFFFFB86C))
    ColorToken.HIJ -> SpanStyle(color = Color(0xFFFF9ECE))
    ColorToken.HIZ -> SpanStyle(color = Color(0xFFA9B1D6))
    ColorToken.ORD -> SpanStyle(color = MudColors.Dim)

    // ── 暗色背景 ──
    ColorToken.BBLK -> SpanStyle(background = Color(0xFF2A2E36))
    ColorToken.BBLU -> SpanStyle(background = Color(0xFF1F3550))
    ColorToken.BCYN -> SpanStyle(background = Color(0xFF14424A))
    ColorToken.BRED -> SpanStyle(background = Color(0xFF4A2320))
    ColorToken.BMAG -> SpanStyle(background = Color(0xFF3E2748))
    ColorToken.BYEL -> SpanStyle(background = Color(0xFF4A3D14))
    ColorToken.BWHT -> SpanStyle(background = Color(0xFF3A3F49))
    ColorToken.BHIK -> SpanStyle(background = Color(0xFF2F343E))

    // ── 亮色背景 ──
    ColorToken.HBBLU -> SpanStyle(background = Color(0xFF2A4B70))
    ColorToken.HBGRN -> SpanStyle(background = Color(0xFF24472C))
    ColorToken.HBCYN -> SpanStyle(background = Color(0xFF1B5C68))
    ColorToken.HBRED -> SpanStyle(background = Color(0xFF6B2F2A))
    ColorToken.HBMAG -> SpanStyle(background = Color(0xFF573263))
    ColorToken.HBYEL -> SpanStyle(background = Color(0xFF6B5719))
    ColorToken.HBWHT -> SpanStyle(background = Color(0xFF4E545F))

    // ── 版式 ──
    ColorToken.DEL -> SpanStyle(textDecoration = TextDecoration.LineThrough, color = MudColors.Dim)
    ColorToken.MEM -> SpanStyle(fontStyle = FontStyle.Italic, color = MudColors.Dim)
    ColorToken.OPT -> SpanStyle(color = MudColors.Dim)
    ColorToken.FLA -> SpanStyle(fontWeight = FontWeight.Bold, color = MudColors.Gain)
    // `LINE` 是分隔线：文本通常为空，真带内容时按"次要+等宽"画
    ColorToken.LINE -> SpanStyle(color = MudColors.Dim, fontFamily = FontFamily.Monospace)
}

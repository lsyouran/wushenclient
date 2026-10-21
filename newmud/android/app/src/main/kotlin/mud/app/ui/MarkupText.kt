package mud.app.ui

import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.style.TextOverflow
import mud.core.parseMarkup

/**
 * 画一段**带颜色标签**的服务端文本。
 *
 * ★ 解析在 `:core`（[parseMarkup]，纯函数、有单测），这里只做 `ColorToken` → [spanStyleOf] 的查表。
 *   于是"颜色对不对"和"界面画得对不对"是两件事，前一件不需要真机就能验。
 *
 * ★ 区间做了越界保护：解析器给的区间与它给的文本是同一份，正常不会越界；
 *   但 `addStyle` 越界会**抛**，而它跑在渲染路径上 —— 一条畸形消息就能把列表打崩。
 *   （网页端在 `markup.ts` 里靠"根本不用字符串索引"天然免疫；这里显式守一道。）
 */
@Composable
fun MarkupText(
    raw: String,
    modifier: Modifier = Modifier,
    color: Color = MudColors.Text,
    /**
     * 要不要吃掉整行宽度。
     *
     * ★ 默认 `true`：消息流、房间描述、面板正文都是"一段文字占满一行"。
     *   而房间里的**人与物**是一排按内容宽度收的按钮，那里必须传 `false` ——
     *   否则第一个名字就把整条 `LazyRow` 撑满，后面的全被挤到屏幕外。
     *   （这一条踩过一次：网页端那边对应的是 `display: inline` 的 span。）
     */
    fillWidth: Boolean = true,
) {
    val styled = remember(raw) { parseMarkup(raw) }
    val text = remember(styled) {
        buildAnnotatedString {
            append(styled.text)
            for (span in styled.spans) {
                val ok = span.start in 0..styled.text.length && span.end in span.start..styled.text.length
                if (ok) addStyle(spanStyleOf(span.token), span.start, span.end)
            }
        }
    }
    Text(
        text = text,
        modifier = if (fillWidth) modifier.fillMaxWidth() else modifier,
        style = MaterialTheme.typography.bodyMedium.copy(color = color),
        maxLines = if (fillWidth) Int.MAX_VALUE else 1,
        // 按钮上折行会变成两行高的方块，挤歪整排 —— 名字太长就截，完整名字在物件面板里
        overflow = if (fillWidth) TextOverflow.Clip else TextOverflow.Ellipsis,
    )
}

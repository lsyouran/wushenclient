package mud.app.ui

import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.style.TextIndent
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.em
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
 *
 * @param maxLines 最多几行。**只在 [fillWidth] 为 `true` 时生效** —— 按钮上的名字
 *   恒为单行（折行会变成两行高的方块，挤歪整排）。
 *   房间描述传 [MudSizes.RoomDescLines]（收起）/`Int.MAX_VALUE`（展开），见 §92.5.1。
 * @param indentFirstLine 要不要首行缩进 2em（wushen `.room_desc{text-indent:2em}`，
 *   `style.css:386`；房间描述要，消息流不要）。
 * @param onTextLayout 排版回执，用来判断"有没有被截断"（房间描述用它决定要不要给「展开」）。
 *
 * ★★ **溢出统一走 `TextOverflow.Ellipsis`，不用 `Clip`**：`Clip` 是无声截断 ——
 *   文字在第 6 行末尾被齐根切掉，观感与"这一段本来就写到这里"没有区别。
 *   而"给不给展开按钮"这件事由 [onTextLayout] 的 `hasVisualOverflow` 决定，
 *   于是**省略号与按钮互为印证**：看得见「…」就一定有按钮，有按钮就一定看得到「…」。
 *   ⚠️ 反过来也一样：`Clip` 与 `hasVisualOverflow` 是**矛盾**的组合
 *      （`Clip` 下 `isLineEllipsized()` 恒为 false），两套标记必须一起换。
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
    maxLines: Int = Int.MAX_VALUE,
    indentFirstLine: Boolean = false,
    onTextLayout: (TextLayoutResult) -> Unit = {},
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
        style = MaterialTheme.typography.bodyMedium.copy(
            color = color,
            textIndent = if (indentFirstLine) TextIndent(firstLine = 2.em) else null,
        ),
        maxLines = if (fillWidth) maxLines else 1,
        // 折行会变成两行高的方块，挤歪整排 ⇒ 一律省略号，不静默裁掉（见文件头 ★★）
        overflow = TextOverflow.Ellipsis,
        onTextLayout = onTextLayout,
    )
}

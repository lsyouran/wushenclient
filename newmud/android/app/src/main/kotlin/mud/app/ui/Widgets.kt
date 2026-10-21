package mud.app.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/**
 * 界面零件：**每种形状只在这里出现一次**。
 *
 * ★★ 这个文件是"界面丑"的修法，不是美化。原来三个屏各自拿 `OutlinedTextField` +
 *   `TextButton` + `border(1.dp, …, 4.dp)` 拼自己的样子：
 *   · 登录屏的输入框是 Material3 默认色（在自定义深色底上发灰、边框偏亮）；
 *   · 主屏的按钮是 1dp 边框 + 4dp 圆角、字号 bodySmall、字号与内边距各处不同；
 *   · 聊天浮层又是第三套（频道页签自己画了一遍边框+背景）。
 *   三套对照之下，"同一类东西长得不一样"本身就是最刺眼的丑。
 *   ⇒ 收敛成 [MudField] / [MudAction] / [MudPanel] 三个入口，
 *   **改一次全局一致**，也才有资格谈"风格"。
 *
 * ★ 圆角取 2dp 而不是 Material 的 8–28dp：2dp 在手机分辨率下看上去就是直角，
 *   和像素风的图标同一条语言（`MudShapes.Sharp`）。
 *   Material 那套大圆角放在深色终端风里会显得"这不是同一个 App"。
 *
 * ★ 这里**没有任何判断**：按钮可不可点、哪个页签选中，都是调用方算好了传进来的。
 */

/**
 * 统一的输入框。
 *
 * ★ 用 `OutlinedTextField` + 换配色，**不自己拼 `BasicTextField`**：
 *   自己拼要重做光标、选区、长按菜单、无障碍语义 —— 那是"为了好看把能用的东西弄坏"。
 *   这里只换颜色与形状，行为仍然由 Material3 负责。
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
    //   标注类型 `(@Composable () -> Unit)?` 而不是依赖推断，是为了让"这里是插槽"一眼可见。
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
        textStyle = MaterialTheme.typography.bodyMedium.copy(color = MudColors.Text),
        keyboardOptions = keyboardOptions,
        keyboardActions = keyboardActions,
        colors = OutlinedTextFieldDefaults.colors(
            // ★ 底色用 Background（比 Surface 更暗）：输入框看上去是"凹进去的"，
            //   而不是一张浮在上面的浅色卡片
            focusedContainerColor = MudColors.Background,
            unfocusedContainerColor = MudColors.Background,
            focusedBorderColor = MudColors.Accent,
            unfocusedBorderColor = MudColors.Border,
            focusedTextColor = MudColors.Text,
            unfocusedTextColor = MudColors.Text,
            cursorColor = MudColors.Accent,
            focusedLabelColor = MudColors.Accent,
            unfocusedLabelColor = MudColors.Dim,
        ),
    )
}

/**
 * 统一的按钮。
 *
 * ★ 不用 M3 的 `Button`/`TextButton`：它们的默认形状、默认色、默认内边距
 *   都由主题决定，而本项目只有**一档字号**（`BASE_SP`），没有"按钮比正文大一号"这回事。
 *   自己画一个 Box 反而更少意外。
 *
 * @param primary 主行动（连接 / 发送）：实心强调色
 * @param selected 页签选中态：比未选中亮一档
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
    val bg = when {
        !enabled -> MudColors.SurfaceAlt
        primary -> MudColors.Accent
        selected -> MudColors.SurfaceAlt
        else -> Color.Transparent
    }
    val fg = when {
        !enabled -> MudColors.Dim
        primary -> MudColors.Background
        selected -> MudColors.Accent
        else -> MudColors.Accent
    }
    val line = when {
        !enabled -> MudColors.Border
        primary -> MudColors.Accent
        selected -> MudColors.Accent
        else -> MudColors.Border
    }
    Box(
        modifier = modifier
            // ★ 44dp 不是随手取的：Material 的最小可点尺寸是 48dp，
            //   而这里是**一排**方向键 —— 48dp 高会把消息流挤掉一行。
            //   44dp 加上 8dp 的行间距，实际指腹落点已经够；再小才会开始点错。
            .defaultMinSize(minHeight = 44.dp)
            .background(bg, MudShapes.Sharp)
            .border(1.dp, line, MudShapes.Sharp)
            .clickable(enabled = enabled, onClick = onClick)
            .padding(horizontal = 12.dp, vertical = 6.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = label,
            color = fg,
            style = MaterialTheme.typography.bodySmall,
            maxLines = 1,
        )
    }
}

/** 一块带像素边框的深色面板（登录卡片、对话框都套它） */
@Composable
fun MudPanel(
    modifier: Modifier = Modifier,
    content: @Composable () -> Unit,
) {
    Box(
        modifier = modifier
            .background(MudColors.Surface, MudShapes.Sharp)
            // ★ 双层边框：外 1dp 亮、内 1dp 暗，看起来像一块"有厚度的板"。
            //   单层边框在深色底上会显得像没画
            .border(1.dp, MudColors.AccentDeep, MudShapes.Sharp)
            .padding(1.dp)
            .border(1.dp, MudColors.Border, MudShapes.Sharp),
    ) {
        content()
    }
}

/**
 * 像素风徽记：一个戴斗笠、佩剑的侠客。
 *
 * ★★ 坐标表与 `res/drawable/ic_launcher_foreground.xml` **同一份设计**
 *   （16×16 网格；斗笠 y1–2、脸 y3–4、肩 y5、两袖 y6–7、腰带 y8、下摆 y9–10、
 *   腿 y11–12、足 y13，佩剑在右侧 x12–15）。两处都手写坐标是没办法的事
 *   （一处是 Compose 的 `drawRect`，一处是 VectorDrawable 的 `pathData`），
 *   但**改了这里就要改那里** —— 这是唯一一处刻意重复，因为它换来的是
 *   "图标与 App 内的标识是同一个东西"。图标没有运行时判据可依赖，这点重复躲不掉。
 *
 * ★★ 为什么是"一个人"而不是"一把剑"：剑在 16×16 里只能是一条竖线，缩到 44dp
 *   和一条分隔线长得一样（第一版就是这样，认不出）。人形有**斗笠的横檐 + 肩膀 +
 *   腰带**三道横线，缩到最小也还是个人。佩剑是配件，不是主体。
 *
 * ★ 用若干**方块**而不是 `drawPath`：像素画的语义就是"格子"，方块之间不留缝、
 *   抗锯齿也关不掉，但 2dp 圆角已经交待在 [MudShapes.Sharp] 里了 —— 这里画的是直角。
 * ★ 绘制顺序 = 图层顺序：剑先画（压在人形后面），手最后画（压在剑柄上）。
 */
@Composable
fun PixelMark(side: Dp, modifier: Modifier = Modifier) {
    Canvas(modifier = modifier.size(side)) {
        val u = size.width / 16f
        fun block(x: Int, y: Int, w: Int, h: Int, color: Color) {
            drawRect(
                color = color,
                topLeft = Offset(x * u, y * u),
                size = Size(w * u, h * u),
            )
        }
        // ── 佩剑（先画，压在人形后面）──
        block(13, 1, 2, 6, MudColors.Dim)      // 剑身
        block(12, 7, 4, 1, MudColors.Gold)     // 护手
        block(13, 8, 2, 2, MudColors.Gold)     // 剑柄
        // ── 斗笠 ──
        block(5, 1, 6, 1, MudColors.Gold)      // 笠顶
        block(3, 2, 10, 1, MudColors.Gold)     // 笠檐（宽出去，才认得出是斗笠）
        // ── 人形 ──
        block(6, 3, 4, 2, MudColors.Text)      // 脸
        block(5, 5, 6, 1, MudColors.Accent)    // 肩
        block(4, 6, 8, 2, MudColors.Accent)    // 两袖
        block(4, 8, 8, 1, MudColors.Gold)      // 腰带
        block(5, 9, 6, 2, MudColors.Accent)    // 下摆
        block(5, 11, 2, 2, MudColors.AccentDeep) // 左腿
        block(9, 11, 2, 2, MudColors.AccentDeep) // 右腿
        block(4, 13, 3, 1, MudColors.AccentDeep) // 左足
        block(9, 13, 3, 1, MudColors.AccentDeep) // 右足
        // 最后画手：压住剑柄一格，看起来才是"握着"而不是"站在旁边"
        block(12, 8, 1, 1, MudColors.Text)
    }
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

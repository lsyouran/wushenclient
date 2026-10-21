package mud.app.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import mud.core.MAP_BASE_FONT
import mud.core.MAP_CELL_H
import mud.core.MAP_CELL_W
import mud.core.MAP_CANVAS_W
import mud.core.MAP_CX
import mud.core.MAP_CY
import mud.core.MapPlan
import mud.core.MapFrame

/**
 * 小地图（wushen 的 `.map-panel`）：九宫格，格子写**目的地房名**，点一下就走。
 *
 * ★★ 这里**没有任何几何计算**：格子摆哪儿、名字截成几个字、连线怎么画，
 *   全部在 `:core` 的 [MapPlan] 里算好了（`MapLayout.kt`，有 JVM 单测）。
 *   这个文件只做"把坐标变成 `offset(dp)`、把颜色变成像素"。
 *   理由很实际：本机没有 JDK / Android SDK，这里的每一行都只在 CI 上编过 ——
 *   把判断留在这里，就等于把判断交给"谁也跑不了"的地方。
 *
 * ★ 为什么不用 `Canvas` 一次画完（连线 + 方框 + 文字）：
 *   画文字要 `TextMeasurer`，而"格子是**可点的**、每块各自接一个回调"这件事
 *   用组合出来的 `Box` 更直白（不需要自己写命中判定，也不会算错点击区域）。
 *   于是分工是：连线走 `Canvas`（纯视觉），格子是 `Box`（可点）。
 *
 * ★ 尺寸 1:1（viewBox 单位 = dp）：绘图坐标与模板尺寸同量纲，
 *   "格子里 4 个字正好装下"这个结论才在手机上仍然成立。
 */
@Composable
fun MapPanel(plan: MapPlan, onCommand: (String) -> Unit) {
    // ★★ 宽度是**算好的固定值**（276dp，几何靠它 1:1），而屏幕可能比它窄 ——
    //   分屏、横屏小窗、超大字体缩放都会让可用宽度掉到 276dp 以下。
    //   网页端用 `.map-panel{overflow:auto}` 兜住这件事，Compose 这边等价物是横向滚动。
    //   ★ 不能无条件套 `horizontalScroll`：那会把子项的宽度约束变成无限，
    //   于是"居中"失效（地图贴左），平时的观感就变了。所以按可用宽度分两支。
    BoxWithConstraints(modifier = Modifier.fillMaxWidth()) {
        if (maxWidth >= MAP_CANVAS_W.dp) {
            Box(modifier = Modifier.fillMaxWidth(), contentAlignment = Alignment.TopCenter) {
                MapCanvas(plan = plan, onCommand = onCommand)
            }
        } else {
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .horizontalScroll(state = rememberScrollState()),
            ) {
                MapCanvas(plan = plan, onCommand = onCommand)
            }
        }
    }
}

/** 固定尺寸的画布本体：连线走 `Canvas`，格子是可点的 `Box` */
@Composable
private fun MapCanvas(plan: MapPlan, onCommand: (String) -> Unit) {
    Box(
        modifier = Modifier
            .width(MAP_CANVAS_W.dp)
            .height(plan.frame.height.dp),
    ) {
        Canvas(modifier = Modifier.matchParentSize()) { drawConnectors(plan = plan) }

        // 先画邻居格，中心格最后画 —— 顺序即层级，中心永远压在上面（网页端同一条）。
        for (cell in plan.cells) {
            MapCellBox(
                label = cell.label,
                talkback = cell.hover,
                x = cell.x,
                y = cell.y,
                frame = plan.frame,
                onClick = { onCommand(cell.dir) },
            )
        }
        MapCellBox(
            label = plan.centerLabel,
            talkback = plan.centerHover,
            x = MAP_CX,
            y = MAP_CY,
            frame = plan.frame,
            center = true,
            onClick = { onCommand("look") },
        )
    }
}

/**
 * 连线：从邻居格靠中心的那条边，画到中心格的那条边。
 *
 * ★ 上下楼（`up` / `down` / `northup` …）照 wushen 画成 `5,5` 的**粗虚线**
 *   —— 一段粗虚线就是"楼梯"的记号。粗细与虚线间隔在网页端是 viewBox 单位
 *   （10 / 5,5），这里同样按 dp 取，于是两端的观感一致。
 */
private fun DrawScope.drawConnectors(plan: MapPlan) {
    for (cell in plan.cells) {
        val line = cell.line
        drawLine(
            // ★ 格边线照 wushen `CreateExitsMap` 的 `gray`（= `--line` #808080），
            //   不再是"发丝线" #343434 —— 后者是**分隔区块**用的，混用会让地图看着像没画完。
            color = MudColors.Line,
            start = Offset(
                line.x1.toFloat().dp.toPx(),
                (line.y1 - plan.frame.y0).toFloat().dp.toPx(),
            ),
            end = Offset(
                line.x2.toFloat().dp.toPx(),
                (line.y2 - plan.frame.y0).toFloat().dp.toPx(),
            ),
            strokeWidth = (if (line.stairs) 10.dp else 1.dp).toPx(),
            pathEffect = if (line.stairs) {
                PathEffect.dashPathEffect(floatArrayOf(5.dp.toPx(), 5.dp.toPx()), 0f)
            } else {
                null
            },
        )
    }
}

/**
 * 一个格子：**逐值照抄** wushen `CreateExitsMap` 的原文三件
 * （`style.css:544` 的注释）：`#232323` 底 · `gray` 边 · `dimgrey` 字；
 * 中心格 `dimgrey` 底 + 深字（反色），表示"你在这儿"。
 *
 * ★★ 这一族是**内容绘制**，不受 §92.4 的"四档授权"约束 —— 它是照抄的色，
 *   所以要住在 `MudColors` 的 F 族，而不是就地写十六进制。
 *   ⚠️ 旧值用 `Dim`(#898989) 当中心格底是**抄错档**：`Dim` 与 `dimgrey`(#696969)
 *     是两个不同的 wushen 值（§92.1.1）。
 *
 * ★ `clipToBounds` 不是为了裁装饰：格子宽度是按"4 个字 × 1 em"定的，
 *   而安卓允许用户把系统字号放大到 1.3–2 倍。放大后 4 个字装不进 78dp，
 *   不裁就会**画到隔壁格子上**（看着像两个格子糊在一起）。
 *   裁掉最后一两个字比糊一片好，而且这时出口行与长按提示里都还有完整名字。
 */
@Composable
private fun MapCellBox(
    label: String,
    talkback: String,
    x: Double,
    y: Double,
    frame: MapFrame,
    center: Boolean = false,
    onClick: () -> Unit,
) {
    Box(
        modifier = Modifier
            .offset(
                x = (x - MAP_CELL_W / 2).dp,
                y = (y - MAP_CELL_H / 2 - frame.y0).dp,
            )
            .width(MAP_CELL_W.dp)
            .height(MAP_CELL_H.dp)
            .clipToBounds()
            .background(color = if (center) MudColors.MapCellInk else MudColors.MapCell)
            .border(width = MudSizes.HairlineW, color = MudColors.Line)
            .clickable(onClick = onClick)
            // 触屏没有悬停：网页端靠 `title` 给的"方向 · 完整房名"，这里交给读屏
            .semantics { contentDescription = talkback },
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = label,
            color = if (center) MudColors.Background else MudColors.MapCellInk,
            fontSize = MAP_BASE_FONT.sp,
            maxLines = 1,
            softWrap = false,
        )
    }
}

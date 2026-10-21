package mud.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 小地图的几何与文案（判据照 `tests/web-ui.test.ts` 的「小地图（点着走）」那一组）。
 *
 * ★★ 这一批是**唯一**能证明小地图没画错的东西：本机没有 JDK / 没有 Android SDK，
 *   `:app` 里那些 `Canvas` / `offset` 一行都没编译过。所以凡是有判据的部分
 *   （格子在哪儿、名字截成几个字、上下楼是不是虚线）全部留在 `:core` 这边，
 *   而 `:app` 那边拿到的是已经算好的 [MapPlan] —— 它没有可以算错的东西。
 */
class MapLayoutTest {

    private fun boxOverlap(a: PlacedExit, b: PlacedExit): Boolean {
        val ox = minOf(a.slot.x + MAP_CELL_W, b.slot.x + MAP_CELL_W) - maxOf(a.slot.x, b.slot.x)
        val oy = minOf(a.slot.y + MAP_CELL_H, b.slot.y + MAP_CELL_H) - maxOf(a.slot.y, b.slot.y)
        return ox > 0 && oy > 0
    }

    // ── 格子里的字 ────────────────────────────────────────────────────────

    @Test
    fun `一个格子最多 4 个字（由格子宽度推出来，不是另写一个数）`() {
        assertEquals(4, cellMaxChars)
    }

    @Test
    fun `房名带城-前缀时只留末段（wushen 的 split 取末位）`() {
        assertEquals("北大街", shortRoomName("扬州城-北大街"))
        assertEquals("中央广场", shortRoomName("扬州城-中央广场"))
        assertEquals("客栈", shortRoomName("客栈"))
        assertEquals("南门", shortRoomName("中原-洛阳-南门"))
    }

    @Test
    fun `房名里的括号内容去掉（半角与全角都认）`() {
        assertEquals("中央广场", shortRoomName("扬州城-中央广场(集市)"))
        assertEquals("赌坊", shortRoomName("扬州城-赌坊（后巷）"))
        // 截完什么都不剩 ⇒ 退回原名，不能显示成空
        assertEquals("扬州城-", shortRoomName("扬州城-"))
    }

    @Test
    fun `长名字截成前几字加省略号，且总字数正好等于上限`() {
        val long = cellLabel("扬州城-中央广场东侧长廊")
        assertTrue("长名字没被截：$long", long.endsWith("…"))
        assertEquals("省略号也要占一格，否则又超出格子", cellMaxChars, long.length)
        assertEquals("中央广…", long)
    }

    @Test
    fun `内容层最长的真房名原样显示、不被截（上限按它定的）`() {
        assertEquals("中央广场", cellLabel("扬州城-中央广场"))
        assertEquals("北大街", cellLabel("扬州城-北大街"))
        assertTrue(cellLabel("扬州城-中央广场").length <= cellMaxChars)
    }

    @Test
    fun `房名外面包着颜色标签时不出尖括号`() {
        val label = cellLabel("<hik>扬州城-北大街</hik>")
        assertEquals("北大街", label)
        assertFalse("格子里出现了尖括号：$label", label.contains("<"))
    }

    // ── 格子在哪儿 ────────────────────────────────────────────────────────

    @Test
    fun `按传入顺序返回（服务端给的出口顺序即格子顺序）`() {
        val placed = placeExits(listOf("east", "north"))
        assertEquals(listOf("east", "north"), placed.map { it.dir })
        assertEquals(Slot.E, placed[0].slot)
        assertEquals(Slot.N, placed[1].slot)
    }

    @Test
    fun `画不上的三种情形都跳过（不认识的方向、重复、格子用光）`() {
        assertEquals(emptyList<String>(), placeExits(listOf("northwestish")).map { it.dir })
        assertEquals(listOf("north"), placeExits(listOf("north", "north")).map { it.dir })
        // 12 个合法方向 ⇒ 外围只有 8 格
        val many = listOf(
            "north", "south", "east", "west", "northeast", "northwest", "southeast", "southwest",
            "up", "down", "enter", "out",
        )
        val placed = placeExits(many)
        assertEquals(8, placed.size)
        assertTrue("画不下的方向仍然在出口行里（这条由 exitRows 保证），地图上只剩 8 个", placed.size <= 8)
    }

    @Test
    fun `north 与 up 同时存在两个格子不重叠（wushen 的真机缺陷）`() {
        val placed = placeExits(listOf("north", "up"))
        assertEquals(2, placed.size)
        assertNotEquals("north 与 up 落在同一格，后画的会把先画的盖掉", placed[0].slot, placed[1].slot)
    }

    @Test
    fun `south 与 down 同时存在两个格子不重叠`() {
        val placed = placeExits(listOf("south", "down"))
        assertEquals(2, placed.size)
        assertNotEquals(placed[0].slot, placed[1].slot)
    }

    @Test
    fun `带上下标的方向也能画进地图（不是只出现在出口行）`() {
        val all = listOf(
            "northup", "northdown", "southup", "southdown",
            "eastup", "eastdown", "westup", "westdown",
        )
        for (dir in all) {
            val placed = placeExits(listOf(dir))
            assertEquals("$dir 没被画进地图", 1, placed.size)
            assertEquals(dir, placed[0].dir)
        }
    }

    @Test
    fun `任意组合下画出的格子两两不重叠`() {
        val placed = placeExits(
            listOf(
                "north", "south", "east", "west", "northeast", "northwest", "southeast", "southwest",
                "up", "down", "enter", "out",
            ),
        )
        assertTrue(placed.size in 1..8)
        for (i in placed.indices) {
            for (j in i + 1 until placed.size) {
                assertFalse(
                    "${placed[i].dir} 与 ${placed[j].dir} 的格子重叠了",
                    boxOverlap(placed[i], placed[j]),
                )
            }
        }
    }

    // ── 框与连线 ──────────────────────────────────────────────────────────

    @Test
    fun `框的高度跟着格子收放，空房间只装下中心格`() {
        val empty = frameOf(emptyList())
        // 中心格 26 + 上下各 4
        assertEquals(34.0, empty.height, 0.001)
        assertEquals(MAP_CY - MAP_CELL_H / 2 - 4, empty.y0, 0.001)

        val tall = frameOf(placeExits(listOf("north", "south")))
        assertTrue("有南向时框该更高：${tall.height}", tall.height > empty.height)
        assertTrue("北向格子该把框往上顶开：${tall.y0}", tall.y0 < empty.y0)
    }

    @Test
    fun `正方向的连线是竖直或水平的一段短线（不穿格子）`() {
        val north = connectorOf("north", Slot.N)
        assertEquals(MAP_CX, north.x1, 0.001)
        assertEquals(MAP_CX, north.x2, 0.001)
        // ★★ 这里是 `+`，不是 `-`。北格在中心**上方**（y 更小），所以它"靠中心的那条边"
        //   是**下沿** = `Slot.N.y + H/2` = 38。原来写成 `-`（= 12 = 北格的**上**沿），
        //   等于要求连线从北格上沿一直画到中心格上沿 —— 那是**穿过整个北格**，
        //   与这条测试自己的名字（"不穿格子"）相反。这个错法是照着下面 east 那几行
        //   抄过来的：东侧的 `x - W/2` 确实就是靠中心的边，纵向要把符号翻过来。
        //   它在本地一次都没跑过（没有 JDK），是 CI 首跑抓出来的（26 册 §87.6）。
        assertEquals(Slot.N.y + MAP_CELL_H / 2, north.y1, 0.001)
        assertEquals(MAP_CY - MAP_CELL_H / 2, north.y2, 0.001)
        assertFalse("北不是上下楼，不该画成虚线", north.stairs)

        val east = connectorOf("east", Slot.E)
        assertEquals(MAP_CY, east.y1, 0.001)
        assertEquals(MAP_CY, east.y2, 0.001)
        assertEquals(Slot.E.x - MAP_CELL_W / 2, east.x1, 0.001)
        assertEquals(MAP_CX + MAP_CELL_W / 2, east.x2, 0.001)
    }

    /**
     * 四个**轴对齐**方向的连线，两端都必须落在"两格之间那段空隙"里。
     *
     * ★ 为什么还要有这条（上一条不是已经钉住了吗）：
     *   上一条是"把期望值写成某个算式"——**算式抄对了才成立**，而上一版恰恰是算式抄错。
     *   这一条的期望值是**手写的空隙矩形**（不从 `sign()` 推），判据是"端点必须落在这个矩形内"。
     *   同一个错误（纵向符号抄反）在这里会以"北的端点落在 y=12，空隙是 [38,51] ⇒ 不在里面"
     *   的形式红掉，而且报错说得出"它穿过了格子"这个**几何事实**，不是一个莫名的数字。
     */
    @Test
    fun `四个正方向的连线端点都落在两格之间的空隙里`() {
        val hw = MAP_CELL_W / 2
        val hh = MAP_CELL_H / 2
        fun assertInGap(dir: String, slot: Slot, x0: Double, x1: Double, y0: Double, y1: Double) {
            val line = connectorOf(dir, slot)
            for ((px, py) in listOf(line.x1 to line.y1, line.x2 to line.y2)) {
                assertTrue(
                    "$dir 的连线端点 ($px,$py) 不在空隙 x[$x0..$x1] y[$y0..$y1] 里 —— 说明它穿过了格子",
                    px >= x0 - 0.001 && px <= x1 + 0.001 && py >= y0 - 0.001 && py <= y1 + 0.001,
                )
            }
        }
        // 空隙矩形四个方向**各写一遍**（不从 sign() 推），这样"抄错符号"不会一起错
        assertInGap("north", Slot.N, MAP_CX - hw, MAP_CX + hw, Slot.N.y + hh, MAP_CY - hh)
        assertInGap("south", Slot.S, MAP_CX - hw, MAP_CX + hw, MAP_CY + hh, Slot.S.y - hh)
        assertInGap("east", Slot.E, MAP_CX + hw, Slot.E.x - hw, MAP_CY - hh, MAP_CY + hh)
        assertInGap("west", Slot.W, Slot.W.x + hw, MAP_CX - hw, MAP_CY - hh, MAP_CY + hh)
    }

    @Test
    fun `上下楼的连线是虚线（含 northup 这 8 个）`() {
        for (dir in listOf("northup", "northdown", "eastup", "westdown", "up", "down")) {
            val slot = placeExits(listOf(dir)).single().slot
            assertTrue("$dir 该画成虚线", connectorOf(dir, slot).stairs)
        }
        for (dir in listOf("north", "enter", "out", "southwest")) {
            val slot = placeExits(listOf(dir)).single().slot
            assertFalse("$dir 不该画成虚线", connectorOf(dir, slot).stairs)
        }
    }

    // ── 整张图 ───────────────────────────────────────────────────────────

    @Test
    fun `格子写目的地房名，服务端没给房名时才退回方向名`() {
        val plan = planMap(mapOf("north" to "客栈", "west" to ""), "扬州城-中央广场")
        assertEquals(listOf("客栈", "西"), plan.cells.map { it.label })
        assertEquals("中央广场", plan.centerLabel)
    }

    @Test
    fun `悬停提示给方向加完整房名（格子里的名字是被截过的）`() {
        val plan = planMap(mapOf("north" to "<hik>扬州城-中央广场东侧长廊</hik>"), "某地")
        val cell = plan.cells.single()
        assertEquals("中央广…", cell.label)
        assertEquals("北 · 扬州城-中央广场东侧长廊", cell.hover)
    }

    @Test
    fun `没进房间时中心格不空着`() {
        val plan = planMap(emptyMap(), "")
        assertEquals("?", plan.centerLabel)
        assertTrue(plan.cells.isEmpty())
        assertEquals("?（点这里环顾）", plan.centerHover)
    }

    @Test
    fun `点格子发的是方向键本身（不是中文）`() {
        val plan = planMap(mapOf("north" to "客栈"), "某地")
        // 界面层拿 `cell.dir` 直接发 —— 中文只是显示
        assertEquals("north", plan.cells.single().dir)
        assertNotEquals("北", plan.cells.single().dir)
    }
}

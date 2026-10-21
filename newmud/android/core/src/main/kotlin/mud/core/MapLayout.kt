package mud.core

/**
 * 小地图的**全部几何与文案**（`src/ui/map.ts` + `src/ui/dirs.ts` 的等价物）。
 *
 * ★★ 为什么整块搬进 `:core` 而不是画的时候顺手算：
 *   "格子摆哪儿 / 名字截成几个字 / 上下楼用虚线"这三件事**每一条都有判据**
 *   （不重叠、不超出格子、8 格用光后仍能在出口行点到），而判据只能在 JVM 上跑
 *   （`gradle :core:test`）。留在 `:app` 里就只剩"上机看一眼"这一种验证方式，
 *   而本项目的安卓端**连编译都要靠 CI**。
 *   ⇒ `:app` 那边拿到的是 [MapPlan]（一串**已经算好的**格子），只管画。
 *
 * ★ 尺寸与排布的出处全部是 wushen 的 `map.js#CreateExitsMap`，本仓库已按 1.3 倍
 *   放大过一轮（真机反馈"地图比较小"），这里**照抄 `map.ts` 的现值**，不重新定。
 */

/** 画布宽度（**恒定**，中心 = 它的一半） */
const val MAP_CANVAS_W: Double = 276.0

/** 格子尺寸（viewBox 单位 = dp 1:1） */
const val MAP_CELL_W: Double = 78.0
const val MAP_CELL_H: Double = 26.0

/** 格子文字的字号（**全图一个字号，永不按字数缩**；装不下靠 [cellLabel] 截断） */
const val MAP_BASE_FONT: Double = 16.0

/** 文字两侧留白（不贴着边框） */
private const val MAP_TEXT_PAD: Double = 4.0

/** 框在**上下**留的边（左右是"居中摆在整个宽度里"，见 [MAP_CANVAS_W]） */
private const val MAP_FRAME_PAD_Y: Double = 4.0

/**
 * 九宫格中心（画布水平正中、第 2 行）。
 *
 * ★ 写死 `138.0` 而不是 `MAP_CANVAS_W / 2`：`const val` 的初始化器要能在编译期
 *   求值，写成除法在**改宽度忘记同步**时不会报错，反而会把中心悄悄挪走一半 ——
 *   而两边不对称这件事在真机上很难看出来（格子看着都还在）。
 */
const val MAP_CX: Double = 138.0
const val MAP_CY: Double = 64.0

/**
 * 一个格子里最多写几个字（**含结尾「…」占掉的那一格**）= 4。
 *
 * ★ 由格子宽度**推**出来，不是另写一个数：改格子宽度它会自动跟着变。
 * ★ 取 4 的另一个理由：内容层最长的房名尾巴就是 4 个字（「中央广场」），
 *   真名一个都不会被截。
 */
val cellMaxChars: Int = ((MAP_CELL_W - MAP_TEXT_PAD) / MAP_BASE_FONT).toInt()

/**
 * 九宫格的 8 个外围格位（中心坐标）。
 *
 * ★ 间距 = wushen `unitX/Y = 70/30` × 1.3：列距 91、行距 39，格子 78×26 ——
 *   斜角格的内角到中心格的角正好空 13，连接线画的就是这段空隙。
 */
enum class Slot(val x: Double, val y: Double) {
    N(138.0, 25.0),
    S(138.0, 103.0),
    E(229.0, 64.0),
    W(47.0, 64.0),
    NE(229.0, 25.0),
    NW(47.0, 25.0),
    SE(229.0, 103.0),
    SW(47.0, 103.0),
}

/**
 * 方向 → 格位**偏好顺序**（取第一个空着的）。
 *
 * ★ 为什么是"偏好顺序"而不是"一个方向一个固定坐标"（wushen 的做法）：
 *   `up` 与 `north` 语义上是两个方向，一个房间可以**同时**有，而九宫格只有
 *   8 个外围格位 —— 固定坐标会让它们落在**同一点**，后画的把先画的整个盖掉
 *   （wushen 真机实测：注入 `{north, up, east, enter}` 后屏幕只剩"上"和"进入"）。
 *
 * ★ 带上下标的方向（`northup` 等 8 个）与对应正方向同列 —— 它们本来就是
 *   "北边那条路上的上/下层"，不该另开一格。
 */
private val DIR_SLOTS: Map<Direction, List<Slot>> = mapOf(
    Direction.NORTH to listOf(Slot.N, Slot.NE, Slot.NW),
    Direction.NORTHUP to listOf(Slot.N, Slot.NE, Slot.NW),
    Direction.NORTHDOWN to listOf(Slot.N, Slot.NE, Slot.NW),
    Direction.UP to listOf(Slot.N, Slot.NE, Slot.NW),

    Direction.SOUTH to listOf(Slot.S, Slot.SE, Slot.SW),
    Direction.SOUTHUP to listOf(Slot.S, Slot.SE, Slot.SW),
    Direction.SOUTHDOWN to listOf(Slot.S, Slot.SE, Slot.SW),
    Direction.DOWN to listOf(Slot.S, Slot.SE, Slot.SW),

    Direction.EAST to listOf(Slot.E, Slot.NE, Slot.SE),
    Direction.EASTUP to listOf(Slot.E, Slot.NE, Slot.SE),
    Direction.EASTDOWN to listOf(Slot.E, Slot.NE, Slot.SE),
    Direction.ENTER to listOf(Slot.E, Slot.NE, Slot.SE),

    Direction.WEST to listOf(Slot.W, Slot.NW, Slot.SW),
    Direction.WESTUP to listOf(Slot.W, Slot.NW, Slot.SW),
    Direction.WESTDOWN to listOf(Slot.W, Slot.NW, Slot.SW),
    Direction.OUT to listOf(Slot.W, Slot.NW, Slot.SW),

    Direction.NORTHEAST to listOf(Slot.NE, Slot.N, Slot.E),
    Direction.NORTHWEST to listOf(Slot.NW, Slot.N, Slot.W),
    Direction.SOUTHEAST to listOf(Slot.SE, Slot.S, Slot.E),
    Direction.SOUTHWEST to listOf(Slot.SW, Slot.S, Slot.W),
)

/**
 * 分配优先级：基本八方向先挑（每个只有一个"正位"可用），
 * 然后上/下/进/出（语义独立，但要与正方向抢格子），最后才是带上下标的。
 *
 * ★ **没有 `else`**：不给"下一条"留默认档 —— 将来若给 [Direction] 加第 21 个方向，
 *   这里会**编译不过**，必须回来决定它排第几。写 `else -> 2` 的话，
 *   新方向会静默地和"带上下标"挤同一档，格子优先级的差异没人会注意到。
 */
private fun priorityOf(dir: Direction): Int = when (dir) {
    Direction.NORTH, Direction.SOUTH, Direction.EAST, Direction.WEST,
    Direction.NORTHEAST, Direction.SOUTHEAST, Direction.NORTHWEST, Direction.SOUTHWEST,
    -> 0

    Direction.UP, Direction.DOWN, Direction.ENTER, Direction.OUT -> 1

    Direction.NORTHUP, Direction.SOUTHUP, Direction.EASTUP, Direction.WESTUP,
    Direction.NORTHDOWN, Direction.SOUTHDOWN, Direction.EASTDOWN, Direction.WESTDOWN,
    -> 2
}

/** 一个已经分配好格位的方向 */
data class PlacedExit(val dir: String, val slot: Slot)

/**
 * 把一组方向分配到九宫格格位上（**偏好顺序 + 先到先得，永不重叠**）。
 *
 * 返回**按传入顺序**排列（= 服务端给出口表的顺序）—— 顺序因此稳定，
 * "换房间后格子跟着换"这类断言才有确定的期望值。
 *
 * 三种"画不上"的情形都**静默跳过**（不是错误）：同一个方向重复、不认识的方向、
 * 8 格用光。它们仍然在出口行里能点 —— 信息不因为画不下就消失。
 */
fun placeExits(dirs: List<String>): List<PlacedExit> {
    val used = HashSet<Slot>()
    val slotOf = HashMap<String, Slot>()

    val ordered = dirs.withIndex()
        .sortedWith(compareBy<IndexedValue<String>>({ priorityOfOrLast(it.value) }, { it.index }))

    for ((_, dir) in ordered) {
        if (slotOf.containsKey(dir)) continue
        val slot = firstFree(used, dir) ?: continue
        used.add(slot)
        slotOf[dir] = slot
    }

    // ★★ 输出阶段必须**按方向再去一次重**。
    //   分配阶段的 `slotOf.containsKey(dir)` 只挡住"再给它分一格"，**挡不住这个循环
    //   把同一个方向按输入次数重发一遍** —— 于是 `placeExits(listOf("north","north"))`
    //   返回两个 `north`，界面上就是两个完全叠在一起的格子（后画的把先画的盖掉）。
    //   这条是 CI 首跑抓到的（26 册 §87.6）：本地没有 JDK，这段代码从写下到那时候
    //   一次都没被执行过。
    val out = ArrayList<PlacedExit>(slotOf.size)
    val emitted = HashSet<String>(slotOf.size)
    for (dir in dirs) {
        if (!emitted.add(dir)) continue
        val slot = slotOf[dir] ?: continue
        out.add(PlacedExit(dir, slot))
    }
    return out
}

/** 认不出的方向排最后（它们反正进不了九宫格），但不让 [priorityOf] 为它编一个档 */
private fun priorityOfOrLast(dir: String): Int {
    val d = normalizeDirection(dir) ?: return Int.MAX_VALUE
    return priorityOf(d)
}

/**
 * 给一个方向找第一个空着的格位。
 *
 * @return `null` = 认不出这个方向 / 8 格已用光（两种情况对调用方是同一件事：
 *         这个方向不上地图，去出口行点）
 */
private fun firstFree(used: Set<Slot>, dir: String): Slot? {
    val d = normalizeDirection(dir) ?: return null
    val prefs = DIR_SLOTS[d] ?: return null
    return prefs.firstOrNull { it !in used }
}

/**
 * 房间显示名 → 格子里那一小串字（**只去前缀与括号，不管长短**）。
 *
 * 规则逐条照抄 wushen `map.js#CreateExitsMap` 的开头三行：
 * 先按 `-` 切、取**最后一段**，再去掉括号里的内容。
 * 于是「扬州城-北大街」→「北大街」，「扬州城-中央广场(集市)」→「中央广场」。
 *
 * ★ 与 wushen 的三点不同，都是为了不出现"格子里是空的 / 是残句"：
 *   ① wushen 只对**中心格**做这两步，邻居格写原始全名（于是邻居格满是「扬州城-」前缀）；
 *   ② wushen 只处理半角括号，中文房名里全角同样常见，两种都去；
 *   ③ 截完什么都不剩（「扬州城-」）就退回原名 —— 宁可见原文，也不要空格子。
 */
fun shortRoomName(name: String): String {
    val raw = name.trim()
    if (raw.isEmpty()) return raw
    val segs = raw.split('-')
    val tail = if (segs.size > 1) segs.last() else raw
    // ★ `replaceFirst` 而不是 `replace`：网页端那个正则没有 `/g`，只替第一处。
    //   保持同一条口径，否则「赌坊（后巷）（后院）」两端显示不一样。
    val stripped = BRACKETS.replaceFirst(tail, "").trim()
    return if (stripped.isEmpty()) raw else stripped
}

/**
 * 括号（半角 + 全角）连同里面一段。
 *
 * ★ 用 [Regex] 而不是 `substringBefore("(")`：房名里括号可能在中间
 *   （「中央广场(集市)东」），只按第一个半角括号切会把后半截丢掉。
 */
private val BRACKETS: Regex = Regex("[(（][^)）]*[)）]")

/**
 * 房间显示名 → 格子里那一小串字（**唯一**的格子文案入口）。
 *
 * 三步，每一步都有出处：
 *   ① [plainText] —— 服务端房名可能带 `<hik>` 这类颜色标签（`select` 的详情就带）；
 *      格子里只能有字，不能有尖括号。
 *   ② [shortRoomName] —— 去「城-」前缀、去括号。
 *   ③ **截断** —— 超过 [cellMaxChars] 就留前几字 + 「…」。
 *      字号是固定的（全图一个字号，见 [MAP_BASE_FONT]），所以只能从"字数"这一头收；
 *      截断后**一定**装得下。
 */
fun cellLabel(name: String): String {
    val short = shortRoomName(plainText(name))
    if (codePointCount(short) <= cellMaxChars) return short
    return takeCodePoints(short, cellMaxChars - 1) + "…"
}

/** 字数按**码点**算（不是 UTF-16 单元）：网页端 `[...str].length` 也是码点 */
private fun codePointCount(s: String): Int = s.codePointCount(0, s.length)

/** 取前 n 个码点（`n >= 字数` 时原样返回） */
private fun takeCodePoints(s: String, n: Int): String {
    if (n <= 0) return ""
    if (n >= codePointCount(s)) return s
    return s.substring(0, s.offsetByCodePoints(0, n))
}

/**
 * 一条连接线（格子与中心格之间那段空隙）。
 *
 * @param stairs 上下楼（`up` / `down` / `northup` …）—— 画成一段**粗虚线**，其余是细实线
 */
data class ConnectorLine(
    val x1: Double,
    val y1: Double,
    val x2: Double,
    val y2: Double,
    val stairs: Boolean,
)

/**
 * 邻居格 → 中心格的连线（wushen 的 `pos1`/`pos2`）。
 *
 * 从邻居格靠中心的那条边，画到中心格的那条边：正方向是一段短线、斜角是一条
 * 对角短线，**都不穿格子**。
 */
fun connectorOf(dir: String, slot: Slot): ConnectorLine {
    val sx = signOf(slot.x - MAP_CX)
    val sy = signOf(slot.y - MAP_CY)
    val x1 = if (sx == 0) MAP_CX else slot.x - sx * (MAP_CELL_W / 2)
    val x2 = if (sx == 0) MAP_CX else MAP_CX + sx * (MAP_CELL_W / 2)
    val y1 = if (sy == 0) MAP_CY else slot.y - sy * (MAP_CELL_H / 2)
    val y2 = if (sy == 0) MAP_CY else MAP_CY + sy * (MAP_CELL_H / 2)
    return ConnectorLine(x1, y1, x2, y2, stairs = dir.contains("up") || dir.contains("down"))
}

private fun signOf(v: Double): Int = when {
    v > 0 -> 1
    v < 0 -> -1
    else -> 0
}

/** 框的纵向取值（宽度不跟着收，见 [MAP_CANVAS_W]） */
data class MapFrame(val y0: Double, val height: Double)

/**
 * 框**跟着画了的东西收放**（不是写死 216×96）。
 *
 * wushen 的 `height` 就是算出来的：方向少 → 框矮，不占空位。这里取
 * "所有格子 + 中心格的并集 + 上下留白"，比按"用了几行"更省：
 * 斜角格只占半行时，框也只跟着涨半行。
 * ★ 中心格**永远**在，所以框至少要装下它 —— 这也是空房间的框不是零高的原因。
 */
fun frameOf(placed: List<PlacedExit>): MapFrame {
    var top = MAP_CY - MAP_CELL_H / 2
    var bottom = MAP_CY + MAP_CELL_H / 2
    for (p in placed) {
        top = minOf(top, p.slot.y - MAP_CELL_H / 2)
        bottom = maxOf(bottom, p.slot.y + MAP_CELL_H / 2)
    }
    return MapFrame(
        y0 = Math.round(top - MAP_FRAME_PAD_Y).toDouble(),
        height = Math.round(bottom - top + MAP_FRAME_PAD_Y * 2).toDouble(),
    )
}

/** 一个已经算好文案与坐标的格子 */
data class MapCell(
    val dir: String,
    val label: String,
    /** 悬停/长按提示：「方向 · 完整房名」。格子只放得下短名（还会被截） */
    val hover: String,
    val x: Double,
    val y: Double,
    val line: ConnectorLine,
)

/**
 * 一张可以直接画的小地图。
 *
 * @param centerLabel 中心格（当前房间）文案
 * @param centerHover 中心格提示（点它 = 环顾）
 */
data class MapPlan(
    val cells: List<MapCell>,
    val centerLabel: String,
    val centerHover: String,
    val frame: MapFrame,
)

/**
 * 出口表 + 当前房名 → 一张小地图。
 *
 * ★ 点格子发的是**方向词本身**（`north`），不是中文；点中心格发 `look`。
 *   中文只是显示层的事（见 [dirLabel] 的说明）。
 * ★ 格子里写**目的地房名**（不是方向）：方向由"格子摆在九宫格的哪一格"表达，
 *   而玩家认的是房间名（说得出"南边是客栈"，说不出"南边是哪条街"）。
 *   服务端没给房名（空串）时才退回方向名，不留空格子。
 */
fun planMap(exits: Map<String, String>, roomName: String): MapPlan {
    val placed = placeExits(exits.keys.toList())
    val cells = placed.map { p ->
        val dest = (exits[p.dir] ?: "").trim()
        MapCell(
            dir = p.dir,
            label = if (dest.isEmpty()) dirLabel(p.dir) else cellLabel(dest),
            hover = if (dest.isEmpty()) dirLabel(p.dir) else "${dirLabel(p.dir)} · ${plainText(dest)}",
            x = p.slot.x,
            y = p.slot.y,
            line = connectorOf(p.dir, p.slot),
        )
    }
    val here = roomName.ifEmpty { "?" }
    return MapPlan(
        cells = cells,
        centerLabel = cellLabel(here),
        centerHover = "${plainText(here)}（点这里环顾）",
        frame = frameOf(placed),
    )
}

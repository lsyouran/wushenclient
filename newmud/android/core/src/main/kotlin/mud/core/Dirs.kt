package mud.core

/**
 * 方向：**线上键 + 中文显示名**。
 *
 * 这是 `shared/constants.ts` 里三张表的 Kotlin 侧等价物：
 *
 *   - `DIRECTIONS`        → 枚举本身（20 个，键在 [Direction.wire]）
 *   - `DIRECTION_LABELS`  → [Direction.label]
 *   - `DIRECTION_ALIASES` → 文件末尾的私有表（**输入归一化**：`n` → `north`）
 *
 * ★ 为什么这里敢把"键"和"显示名"塞进同一个枚举，而网页端的注释说
 *   「别名表与显示表**不能合并**」：
 *   那条警告针对的是 **别名 ↔ 显示名**（一个是"接受哪些写法"、一个是"显示成什么"，
 *   合并会让两者互相绑死）。而 `Direction` 与它的中文名在网页端本来就由
 *   `Readonly<Record<Direction, string>>` **类型绑死**（少一个方向就编译不过）——
 *   枚举参数只是把同一条约束写得更省：**新增方向必须同时给出显示名**，没有第二条路。
 *   别名仍然是另一张表，仍然可以单独增删。
 *
 * ★★ 20 个方向必须有中文名，**一个都不能漏**：漏了显示名字段就不存在（编译不过），
 *   而不是"运行时某个方向上地图后没有字"。
 */
enum class Direction(val wire: String, val label: String) {
    NORTH("north", "北"),
    SOUTH("south", "南"),
    EAST("east", "东"),
    WEST("west", "西"),
    NORTHUP("northup", "北上"),
    SOUTHUP("southup", "南上"),
    EASTUP("eastup", "东上"),
    WESTUP("westup", "西上"),
    NORTHDOWN("northdown", "北下"),
    SOUTHDOWN("southdown", "南下"),
    EASTDOWN("eastdown", "东下"),
    WESTDOWN("westdown", "西下"),
    NORTHEAST("northeast", "东北"),
    SOUTHEAST("southeast", "东南"),
    NORTHWEST("northwest", "西北"),
    SOUTHWEST("southwest", "西南"),
    UP("up", "上"),
    DOWN("down", "下"),
    ENTER("enter", "进入"),
    OUT("out", "出去"),
    ;

    companion object {
        private val BY_WIRE: Map<String, Direction> = Direction.entries.associateBy { it.wire }

        /** 线上键 → 方向（**只认全称**；短写走 [normalizeDirection]） */
        fun ofWire(wire: String): Direction? = BY_WIRE[wire]
    }
}

/**
 * 方向短写（照 `DIRECTION_ALIASES` 逐条对齐）。
 *
 * ⚠️ 这张表是**输入归一化**，与 [Direction.label] 是两件事：
 *   前者回答"玩家写了 `n` 算不算北"，后者回答"北显示成什么字"。
 *
 * ★ 网页端 `shared/constants.ts` 的注释记着 wushen 的一处未收录缺陷：
 *   `go.js` 里 `doors[]` 与 `doors_short[]` **两个数组顺序错位**，
 *   于是 `s → west`、`w → south`（按 `s` 往西走）。这里按标准对应关系重新定义。
 */
private val DIRECTION_ALIASES: Map<String, Direction> = mapOf(
    "n" to Direction.NORTH,
    "s" to Direction.SOUTH,
    "e" to Direction.EAST,
    "w" to Direction.WEST,
    "nu" to Direction.NORTHUP,
    "su" to Direction.SOUTHUP,
    "eu" to Direction.EASTUP,
    "wu" to Direction.WESTUP,
    "nd" to Direction.NORTHDOWN,
    "sd" to Direction.SOUTHDOWN,
    "ed" to Direction.EASTDOWN,
    "wd" to Direction.WESTDOWN,
    "ne" to Direction.NORTHEAST,
    "se" to Direction.SOUTHEAST,
    "nw" to Direction.NORTHWEST,
    "sw" to Direction.SOUTHWEST,
    "u" to Direction.UP,
    "d" to Direction.DOWN,
)

/**
 * 归一化：全称或短写 → 方向；都不认返回 `null`。
 *
 * ★ 与网页端同一个口径：**这个函数自己不做 `trim` / 小写**，
 *   那是调用方的事（[isDirection] / [dirLabel] 都做了）。分开是为了让
 *   "哪些写法算方向"只有一条判据，而不是两处各判一半。
 */
fun normalizeDirection(raw: String): Direction? = Direction.ofWire(raw) ?: DIRECTION_ALIASES[raw]

/**
 * 这个词是不是一个方向（全称或短写都算）。
 *
 * ★ 用它把"移动"从"可做之事"里分出来：服务端把方向动作和内容动作放在
 *   **同一张动作表**里（`room` 帧的 `commands`），而界面上方向已经在
 *   「明显出口」和小地图里各有一份 —— 动作栏再来一份就是同一个动作三个入口。
 *   判据走 [normalizeDirection]（与后端同一个函数），不在界面层再判一次。
 */
fun isDirection(word: String): Boolean = normalizeDirection(lowered(word)) != null

/**
 * 方向的显示名（**未知方向原样返回**）。
 *
 * ★ 宁可显示英文也不要显示空 —— 空字的格子在真机上看起来像"那里没路"。
 */
fun dirLabel(dir: String): String {
    val norm = normalizeDirection(lowered(dir)) ?: return dir
    return norm.label
}

/**
 * `trim` + 小写，**一次只做一遍**。
 *
 * ★ 用 `lowercase()` 而不是 `lowercase(Locale.getDefault())`：
 *   前者等价于 `Locale.ROOT`（土耳其语环境下 `I` 会变成 `ı`，那会让
 *   `NORTH` 认不出来）。方向键是协议层的英文常量，按区域改大小写是错的方向。
 */
private fun lowered(raw: String): String = raw.trim().lowercase()

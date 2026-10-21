package mud.core

/**
 * 房间区的**列表内容**（`src/ui/room.ts` 的 `renderExits` / `renderItems` /
 * `renderActionBar` 的等价物）。
 *
 * ★ 这里只算"有哪些项、每项显示什么、点了发什么"，**不含任何形状** ——
 *   排版是 `:app` 的事。分离的理由同 [MapLayout]：条目内容有判据（方向不进动作栏、
 *   空指令不出现、点实体发的是 `select <id>` 而不是 `look <id>`），
 *   而判据要能在 JVM 上跑。
 */

/** 「明显出口」里的一项：显示中文方向名，**点下去发英文方向键** */
data class ExitRow(val dir: String, val label: String)

/**
 * 出口项。
 *
 * ★ 顺序 = 服务端 `exits` 帧给的顺序（`Map` 按 JSON 顺序保留）——
 *   不排序、不按九宫格位置重排：出口行与地图是两块东西，
 *   地图负责"位置"，出口行负责"有哪些"，顺序跟着服务端走最稳。
 * ★ 只写**方向名**，不写房名：房名在地图格子里（同一个目的地一屏两种写法，
 *   玩家会以为不是一个地方；而且 8 个出口时这一行会折成三行，正好断在半截房名上）。
 */
fun exitRows(exits: Map<String, String>): List<ExitRow> =
    exits.keys.map { ExitRow(dir = it, label = dirLabel(it)) }

/**
 * 「可做之事」动作栏的内容。
 *
 * ★ **过滤方向动作**：服务端把方向和内容动作放在同一张表里（`room.commands`），
 *   但方向上已经在「明显出口」和小地图里各有一份 —— 动作栏再来一份就是
 *   同一个动作三个入口。
 * ★ **过滤空指令**：`cmd === ''` 的项点下去什么都不会发生，画出来只是让人多试一次。
 * ★ 顺序：房间动作在前、`actions` 帧的在后面 —— 与网页端 `[...room.commands, ...actions]` 一致。
 */
fun actionBarCommands(state: UiState): List<Cmd> {
    val all = state.room?.commands.orEmpty() + state.actions
    return all.filter { it.cmd.isNotEmpty() && !isDirection(it.cmd) }
}

/**
 * 点房间里的人或物 → 要发的指令。
 *
 * ★★ **是 `select`，不是 `look`**。这条踩过：
 *   网页端第一版发的是 `look <id>`，而服务端的 `look` **忽略参数** ——
 *   于是点谁都是把房间描述再打一遍，连内部 id 都漏到屏幕上（26 册 §20.3 的真机记录）。
 *   `select <id>` 才是"看**这个东西**的详情"那条命令（`world/command/action/select.ts`），
 *   它回的 `item` 帧驱动物件面板。
 *   两端共用同一条命令名，因为它们是同一个服务端的同一条内容层指令。
 *
 * @return `null` = id 是空的（服务端不该发空 id，但真发了也别发出 `select ` —— 那会
 *         被服务端当成"无参数 select"，回一屏房间动作，看起来像点错了东西）
 */
fun selectCommandFor(id: String): String? {
    val trimmed = id.trim()
    if (trimmed.isEmpty()) return null
    return "select $trimmed"
}

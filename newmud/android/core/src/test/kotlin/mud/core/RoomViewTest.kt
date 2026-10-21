package mud.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * 房间区三块列表的内容判据。
 *
 * ★ 三条都在网页端有对应物、且都**曾经错**：
 *   ① 方向动作混进"可做之事"（同一个动作三个入口）；
 *   ② 空指令画出按钮（点下去什么都不会发生）；
 *   ③ 点实体发 `look <id>` —— 而服务端的 `look` 忽略参数，于是点谁都是
 *      把房间描述再打一遍，连内部 id 都漏到屏幕上（26 册 §20.3）。
 */
class RoomViewTest {

    private fun room(commands: List<Cmd>) =
        RoomInfo(path = "yz/guangchang", name = "扬州城-中央广场", desc = "……", commands = commands)

    @Test
    fun `方向不进动作栏（出口行与小地图已经各有一份）`() {
        val state = UiState(
            room = room(listOf(Cmd("north", "北"), Cmd("ask xiaoer", "打听"), Cmd("n", "去北边"))),
        )
        assertEquals(listOf("ask xiaoer"), actionBarCommands(state).map { it.cmd })
    }

    @Test
    fun `方向短写也认（n 与 north 是同一个动作）`() {
        val state = UiState(room = room(listOf(Cmd("n", "北"), Cmd("look", "环顾"))))
        assertEquals(listOf("look"), actionBarCommands(state).map { it.cmd })
    }

    @Test
    fun `空指令不画按钮`() {
        val state = UiState(room = room(listOf(Cmd("", "空"), Cmd("look", "环顾"))))
        assertEquals(listOf("look"), actionBarCommands(state).map { it.cmd })
    }

    @Test
    fun `房间动作在前、actions 帧的在后面，顺序不变`() {
        val state = UiState(
            room = room(listOf(Cmd("ask xiaoer", "打听"))),
            actions = listOf(Cmd("dazuo", "打坐"), Cmd("sleep", "睡觉")),
        )
        assertEquals(
            listOf("ask xiaoer", "dazuo", "sleep"),
            actionBarCommands(state).map { it.cmd },
        )
    }

    @Test
    fun `还没进房间时是空表（不抛）`() {
        assertEquals(emptyList<Cmd>(), actionBarCommands(UiState()))
    }

    @Test
    fun `出口项只给方向名，点了发方向键`() {
        val rows = exitRows(mapOf("north" to "扬州城-北大街", "enter" to ""))
        assertEquals(listOf("north", "enter"), rows.map { it.dir })
        assertEquals(listOf("北", "进入"), rows.map { it.label })
    }

    @Test
    fun `点实体发 select 而不是 look`() {
        assertEquals("select pub/muren", selectCommandFor("pub/muren"))
        assertEquals("select xiaoer", selectCommandFor("  xiaoer  "))
        // 空 id 的两种写法都返回 null —— 绝不能发出一个光秃秃的 `select`
        // （服务端会当成"无参数 select"，回一屏房间动作，看起来像点错了东西）
        assertNull(selectCommandFor(""))
        assertNull(selectCommandFor("   "))
    }
}

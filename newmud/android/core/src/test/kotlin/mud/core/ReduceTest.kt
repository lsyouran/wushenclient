package mud.core

import kotlinx.serialization.json.JsonPrimitive
import mud.protocol.CmdsPacket
import mud.protocol.CmdsPacketItemsItem
import mud.protocol.CombatPacket
import mud.protocol.DialogPacket
import mud.protocol.ItemPacket
import mud.protocol.ItemsPacket
import mud.protocol.ItemsPacketItemsItem
import mud.protocol.LoginPacket
import mud.protocol.RoomPacket
import mud.protocol.RoomPacketCommandsItem
import mud.protocol.ScPacket
import mud.protocol.WarnPacket
import mud.protocol.WarnPacketCmdsItem
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 文本落点 / 面板轮次的判据（26 册 §80 的安卓侧对应物）。
 *
 * ★★ 这一批测试存在的唯一理由：**同一类 bug 在网页端发作了四次**
 *   （§57 操作层层叠进日志、§74 请教三次堆成三屏、§78 和木人切磋战报写进木人的操作框）。
 *   四次的形状不同、根因相同：文本该落到哪儿，是前端**猜**出来的。
 *   ⇒ 现在判据只有一条（帧上的 `context`），而这条判据的每一条分支都在下面钉住 ——
 *     一旦有人在 `Reduce` 里加回任何"看局面猜"的逻辑，这里会红。
 */
class ReduceTest {
    private fun inGame(): UiState = UiState(phase = Phase.InGame, me = MeState(id = "我", level = 1))

    private fun warn(
        content: String,
        cmds: List<WarnPacketCmdsItem> = emptyList(),
        context: String? = null,
    ): WarnPacket = WarnPacket(content = content, cmds = cmds, context = context)

    private fun openMuren(state: UiState): UiState = reduce(
        state,
        ItemPacket(id = "pub/muren", name = "木人桩", desc = "一个用来练拳的木桩。", commands = emptyList()),
    )

    private fun room(path: String, name: String): RoomPacket =
        RoomPacket(path = path, name = name, desc = "$name。", commands = emptyList())

    // ── ① 默认方向：没声明就进消息流 ────────────────────────────────────────

    @Test
    fun `物件面板开着时，没声明归属的播报进消息流，面板一字不改`() {
        val opened = openMuren(inGame())
        assertNotNull("前提：面板得真的开了", opened.panel)

        val after = reduce(opened, warn("你对准木人桩用力挥出一拳"))

        assertEquals("面板正文不该被战报污染", listOf("一个用来练拳的木桩。"), after.panel?.rows)
        assertTrue(
            "战报必须在消息流里（否则玩家的操作回执就消失了）",
            after.log.any { it.text.contains("挥出一拳") },
        )
    }

    @Test
    fun `面板开着时，房间播报与拒绝文案也进消息流`() {
        val opened = openMuren(inGame())
        val after = reduce(
            reduce(opened, warn("你来到了北大街。")),
            warn("店小二陪笑道：住店要1000文钱，客官。"),
        )

        assertEquals(listOf("一个用来练拳的木桩。"), after.panel?.rows)
        assertEquals(2, after.log.size)
    }

    // ── ② 声明了归属才进面板 ──────────────────────────────────────────────

    @Test
    fun `声明了与面板 id 相同的 context ⇒ 进面板，且不重复进消息流`() {
        val opened = openMuren(inGame())
        val after = reduce(opened, warn("你向店小二打听。", context = "pub/muren"))

        assertEquals(listOf("一个用来练拳的木桩。", "你向店小二打听。"), after.panel?.rows)
        assertTrue("进了面板就不该在消息流里再来一份", after.log.isEmpty())
    }

    @Test
    fun `声明的是别人的 context ⇒ 仍进消息流`() {
        val opened = openMuren(inGame())
        val after = reduce(opened, warn("别处的一句话", context = "pub/xiaoer"))

        assertEquals(listOf("一个用来练拳的木桩。"), after.panel?.rows)
        assertEquals(listOf("别处的一句话"), after.log.map { it.text })
    }

    @Test
    fun `面板没开时声明了 context 也不丢：落消息流`() {
        val after = reduce(inGame(), warn("这句话本该进面板", context = "pub/muren"))
        assertNull(after.panel)
        assertEquals(listOf("这句话本该进面板"), after.log.map { it.text })
    }

    @Test
    fun `面板 id 为空的物件（服务端没给 id）不接受任何回显`() {
        val opened = reduce(
            inGame(),
            ItemPacket(id = "", name = "某个东西", desc = "看不清。", commands = emptyList()),
        )
        assertNull("空 id = 谁都不认（安全的一侧）", opened.panel?.id)
        val after = reduce(opened, warn("一句话", context = ""))
        assertEquals(listOf("一句话"), after.log.map { it.text })
    }

    // ── ③ 带命令 ⇒ 提示框 ────────────────────────────────────────────────

    @Test
    fun `带命令的 warn 进提示框，既不进消息流也不进面板`() {
        val opened = openMuren(inGame())
        val after = reduce(
            opened,
            warn("真的要离开吗？", cmds = listOf(WarnPacketCmdsItem(cmd = "yes", name = "是"))),
        )

        assertNotNull(after.prompt)
        assertEquals("真的要离开吗？", after.prompt?.text)
        assertEquals(listOf(Cmd("yes", "是")), after.prompt?.cmds)
        assertTrue("提示框占用了这句话，不该再进消息流", after.log.isEmpty())
        assertEquals(listOf("一个用来练拳的木桩。"), after.panel?.rows)
    }

    // ── ④ 一轮交互：面板内发令 ⇒ 正文从基线重来 ─────────────────────────────

    @Test
    fun `面板内发令后，第一行回显先退回基线再追加`() {
        var s = openMuren(inGame())
        s = reduce(s, warn("第一轮：你上前抱拳。", context = "pub/muren"))
        assertEquals(2, s.panel?.rows?.size)

        // 玩家在面板里点了「比试」—— 服务端稍后回显
        s = panelCommandIssued(s)
        s = reduce(s, warn("第二轮：木人桩纹丝不动。", context = "pub/muren"))

        assertEquals(
            "新一轮不该把上一轮的回显留着（§74 真机：请教三次面板堆成三屏）",
            listOf("一个用来练拳的木桩。", "第二轮：木人桩纹丝不动。"),
            s.panel?.rows,
        )
    }

    @Test
    fun `同一句连点五次只追加一次`() {
        var s = openMuren(inGame())
        repeat(5) { s = reduce(s, warn("你身上没有那么多的钱。", context = "pub/muren")) }

        assertEquals(
            "回显是追加语义，但同一句贴着同一句不是新信息（否则连点五次就是五行）",
            listOf("一个用来练拳的木桩。", "你身上没有那么多的钱。"),
            s.panel?.rows,
        )
    }

    // ── ⑤ 面板的生命周期 ─────────────────────────────────────────────────

    @Test
    fun `换房间关面板；同一间房再 look 不关`() {
        // 首次进房间：`room` 原来是 null ⇒ 视为进新房间，面板本来也没有
        val arrived = reduce(inGame(), room("guangchang", "中央广场"))
        assertNull(arrived.panel)

        val withPanel = openMuren(arrived)
        val staying = reduce(withPanel, room("guangchang", "中央广场"))
        assertNotNull("同一间房再 `look` 一次不该把面板关掉", staying.panel)

        val moved = reduce(staying, room("beidajie1", "北大街"))
        assertNull("换房间必须关面板", moved.panel)
        assertTrue("换房间要在消息流里留一句交代", moved.log.any { it.text == "你来到了北大街。" })
    }

    @Test
    fun `首次进房间不播报“你来到了”，因为没有上一个房间`() {
        val s = reduce(inGame(), room("guangchang", "中央广场"))
        assertTrue("登录欢迎语已经交代过了，再来一句就是同一件事说两遍", s.log.isEmpty())
    }

    @Test
    fun `cmds 帧：面板开着换底部按钮，面板没开进消息流带按钮`() {
        val opened = openMuren(inGame())
        val withCmds = reduce(opened, CmdsPacket(items = listOf(CmdsPacketItemsItem(cmd = "ask", name = "打听"))))
        assertEquals(listOf(Cmd("ask", "打听")), withCmds.panel?.cmds)
        assertTrue(withCmds.log.isEmpty())

        val closed = reduce(inGame(), CmdsPacket(items = listOf(CmdsPacketItemsItem(cmd = "ask", name = "打听"))))
        assertEquals("面板没开时它属于消息流（登录后的房间级动作就是这条）", 1, closed.log.size)
        assertEquals(listOf(Cmd("ask", "打听")), closed.log.single().cmds)
    }

    @Test
    fun `dialog 的 close 关面板，clear 只清正文`() {
        val opened = openMuren(inGame())
        val cleared = reduce(opened, DialogPacket(dialog = "score", clear = JsonPrimitive(true)))
        assertNotNull("clear 是“内容没了”，不是“面板收起来”", cleared.panel)
        assertTrue(cleared.panel?.rows?.isEmpty() == true)

        val closed = reduce(opened, DialogPacket(dialog = "score", close = true))
        assertNull("close 才是收起来", closed.panel)
    }

    // ── ⑥ 消息流上限 ─────────────────────────────────────────────────────

    @Test
    fun `消息流最多留 400 行，超出丢最旧`() {
        var s = inGame()
        repeat(UiState.MAX_LOG_LINES + 50) { s = s.withLine(LogKind.TEXT, "第 $it 行") }

        assertEquals(UiState.MAX_LOG_LINES, s.log.size)
        assertEquals("第 50 行", s.log.first().text)
        assertEquals("第 449 行", s.log.last().text)
    }

    // ── ⑦ 战斗状态不影响文本落点（这是 §80 的核心） ────────────────────────

    @Test
    fun `战斗中的播报同样进消息流，不因为“在战斗”就去面板`() {
        val opened = openMuren(inGame())
        val fighting = reduce(opened, CombatPacket(start = 1.0))
        assertTrue(fighting.fighting)

        val after = reduce(fighting, warn("木人桩对准你用力挥出一拳"))
        assertEquals("§78 就是这一条：战报写进了木人的操作框", listOf("一个用来练拳的木桩。"), after.panel?.rows)
        assertTrue(after.log.any { it.text.contains("挥出一拳") })
    }

    @Test
    fun `战斗结束帧把状态放回去`() {
        val s = reduce(reduce(inGame(), CombatPacket(start = 1.0)), CombatPacket(end = 1.0))
        assertFalse(s.fighting)
    }

    // ── ⑧ 数值 / 房间数据 ────────────────────────────────────────────────

    @Test
    fun `sc 帧同时更新自己与房间里那个人`() {
        var s = inGame()
        s = reduce(
            s,
            ItemsPacket(
                items = listOf(
                    ItemsPacketItemsItem(id = "pub/muren", name = "木人桩", hp = 40.0, max_hp = 40.0),
                ),
            ),
        )
        s = reduce(s, ScPacket(id = "pub/muren", hp = 21.0))
        assertEquals(21.0, s.actors.single().hp ?: -1.0, 0.0)

        s = reduce(s, ScPacket(id = "我", hp = 600.0, max_hp = 610.0))
        assertEquals(600.0, s.me?.hp ?: -1.0, 0.0)
        assertEquals(610.0, s.me?.maxHp ?: -1.0, 0.0)
    }

    @Test
    fun `房间动作带的是显示名不是触发词`() {
        val s = reduce(
            inGame(),
            RoomPacket(
                path = "guangchang",
                name = "中央广场",
                desc = "广场。",
                commands = listOf(RoomPacketCommandsItem(cmd = "dazuo", name = "打坐")),
            ),
        )
        assertEquals(Cmd("dazuo", "打坐"), s.room?.commands?.single())
        assertEquals("dazuo", s.room?.commands?.single()?.cmd)
        assertEquals("按钮上该显示「打坐」", "打坐", s.room?.commands?.single()?.label)
    }

    @Test
    fun `自己说的话显示成「你」`() {
        val s = reduce(
            inGame(),
            mud.protocol.MsgPacket(ch = "chat", content = "有人吗", name = "我"),
        )
        assertEquals("你：有人吗", s.log.single().text)
        assertEquals(LogKind.CHAT, s.log.single().kind)
    }

    /**
     * ★★ 登录成功 = 新会话开始，上一轮的东西必须清干净。
     *
     * 这条是真机反馈出来的："每次登入日志区要重置，不是现在这样我**之前失败的信息还在里面**"。
     * 不清的后果不是"多一行" —— 是玩家分不清**哪些错误是这次发生的**，
     * 于是把上一次的"连接被拒绝"当成这次的病因去查。
     */
    @Test
    fun `重新登录会清掉上一轮的消息流与残留弹窗`() {
        val dirty = UiState(
            phase = Phase.Connected,
            log = listOf(LogLine(LogKind.ERR, "上一次：连接被拒绝")),
            panel = PanelState(
                title = "上一轮的面板",
                id = "x",
                rows = listOf("旧内容"),
                baseRows = listOf("旧内容"),
                cmds = emptyList(),
                roundStarted = false,
            ),
            prompt = PromptState(text = "上一轮的提示", cmds = emptyList()),
            unreadChat = 5,
        )
        val next = reduce(dirty, LoginPacket(id = "我", level = 3))

        assertEquals(Phase.InGame, next.phase)
        assertEquals("上一轮的日志还在：${next.log.map { it.text }}", emptyList<LogLine>(), next.log)
        assertNull("上一轮的面板还挂着", next.panel)
        assertNull("上一轮的提示框还挂着", next.prompt)
        assertEquals("未读数该归零", 0, next.unreadChat)
        assertEquals("新会话的等级要写进去", 3, next.me?.level)
    }
}

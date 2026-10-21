package mud.core

import mud.protocol.MsgPacket
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 聊天浮层的判断（`src/ui/input.ts` 的聊天那一半）。
 *
 * ★ 这一批最要紧的两条都不是"能不能发出去"，而是"**不该发的时候真的没发**"：
 *   ① 私语没对象 —— 半截指令 `tell  在吗` 出门，服务端回一句看不懂的报错，
 *      玩家会以为私语功能坏了；
 *   ② 点 NPC 不设私聊对象，点**玩家**才设，且名字要**剥掉颜色标签** ——
 *      `tell <hik>张三 在吗` 服务端解析不出对象，回的却是"没有这个人"。
 */
class ChatTest {

    private fun inGame() = UiState(phase = Phase.InGame, me = MeState(id = "我", level = 1))

    // ── 频道表 ────────────────────────────────────────────────────────────

    @Test
    fun `三个频道的线上词与网页端页签一致`() {
        assertEquals(listOf("say", "chat", "tell"), ChatChannel.entries.map { it.wire })
        assertEquals(listOf("房间", "世界", "私语"), ChatChannel.entries.map { it.label })
        assertEquals(ChatChannel.WORLD, ChatChannel.ofWire("chat"))
        // 认不出的频道不回落（回落成 say 会把世界喊话发成房间说话）
        assertNull(ChatChannel.ofWire("rumor"))
        assertNull(ChatChannel.ofWire(""))
    }

    // ── 合成指令 ──────────────────────────────────────────────────────────

    @Test
    fun `房间与世界频道直接拼线上词`() {
        assertEquals(
            ChatSubmit.Send("say 你好"),
            composeChat(ChatChannel.SAY, target = null, text = "你好"),
        )
        assertEquals(
            ChatSubmit.Send("chat 你好"),
            composeChat(ChatChannel.WORLD, target = null, text = "你好"),
        )
    }

    @Test
    fun `私语带上对象`() {
        assertEquals(
            ChatSubmit.Send("tell 张三 在吗"),
            composeChat(ChatChannel.TELL, target = "张三", text = "在吗"),
        )
    }

    @Test
    fun `正文两端空白被吃掉，中间的空与换行保留`() {
        assertEquals(
            ChatSubmit.Send("say 你 好"),
            composeChat(ChatChannel.SAY, null, "  你 好  "),
        )
        // 换行不在两端，不该被 trim 掉（服务端原文照收）
        assertEquals(
            ChatSubmit.Send("say 第一句\n第二句"),
            composeChat(ChatChannel.SAY, null, "第一句\n第二句"),
        )
    }

    @Test
    fun `空正文不发（含只有空白）`() {
        assertEquals(ChatSubmit.Blank, composeChat(ChatChannel.SAY, null, ""))
        assertEquals(ChatSubmit.Blank, composeChat(ChatChannel.SAY, null, "   \n\t "))
        // ★ 私语也是先判空：没写正文时提示"说点什么"，而不是"先选对象"
        assertEquals(ChatSubmit.Blank, composeChat(ChatChannel.TELL, null, "  "))
    }

    @Test
    fun `私语缺对象时不发半截指令`() {
        assertEquals(ChatSubmit.NeedTarget, composeChat(ChatChannel.TELL, null, "在吗"))
        assertEquals(ChatSubmit.NeedTarget, composeChat(ChatChannel.TELL, "   ", "在吗"))
    }

    @Test
    fun `提示文案只有失败时才有`() {
        assertNull(chatHintOf(ChatSubmit.Send("say x")))
        assertNotNull(chatHintOf(ChatSubmit.Blank))
        assertNotNull(chatHintOf(ChatSubmit.NeedTarget))
        // 两句提示必须不同 —— 压成一句就分不出"没写"还是"没选人"
        assertTrue(chatHintOf(ChatSubmit.Blank) != chatHintOf(ChatSubmit.NeedTarget))
    }

    // ── 私聊对象 ──────────────────────────────────────────────────────────

    @Test
    fun `点玩家才成为私聊对象，NPC 不设`() {
        val state = inGame().copy(
            actors = listOf(
                ActorBrief(id = "npc/xiaoer", name = "店小二", isPlayer = false),
                ActorBrief(id = "p/afei", name = "阿飞", isPlayer = true),
            ),
        )
        assertEquals("阿飞", chatTargetFor(state, "p/afei"))
        assertNull(chatTargetFor(state, "npc/xiaoer"))
        assertNull("找不到的 id 不设，也不清空原来的对象", chatTargetFor(state, "没有这个"))
    }

    @Test
    fun `对象名剥掉颜色标签`() {
        // 协议里的 name 是原文，房间列表按 markup 渲染；直接拿去拼 tell 会解析不出对象
        val state = inGame().copy(
            actors = listOf(ActorBrief(id = "p/1", name = "<hik>阿飞</hik>", isPlayer = true)),
        )
        assertEquals("阿飞", chatTargetFor(state, "p/1"))
    }

    // ── 未读 ──────────────────────────────────────────────────────────────

    @Test
    fun `浮层关着时来消息才加未读`() {
        val chat = MsgPacket(ch = "chat", content = "有人在吗", name = "路人甲")

        val closed = reduce(inGame(), chat)
        assertEquals(1, closed.unreadChat)
        val again = reduce(closed, chat)
        assertEquals(2, again.unreadChat)

        // ★ 浮层开着时玩家正看着，不该再显示"未读"
        val open = reduce(openChat(inGame()), chat)
        assertEquals(0, open.unreadChat)
        // 消息本身照样进流（未读只是角标，不是"读没读"的开关）
        assertTrue(open.log.any { it.text.contains("有人在吗") })
    }

    @Test
    fun `打开浮层清未读，收起不清`() {
        val dirty = inGame().copy(unreadChat = 5)
        assertEquals(0, openChat(dirty).unreadChat)
        assertTrue(openChat(dirty).chatOpen)
        assertEquals(5, closeChat(dirty).unreadChat)
        assertTrue(!closeChat(openChat(dirty)).chatOpen)
    }

    @Test
    fun `切频道只改频道`() {
        val next = setChatChannel(inGame(), ChatChannel.TELL)
        assertEquals(ChatChannel.TELL, next.chatChannel)
        assertEquals("默认是房间频道", ChatChannel.SAY, inGame().chatChannel)
    }

    @Test
    fun `私语与其它频道落进两个不同的颜色档`() {
        // 这两档就是 `:app` 里 CHAT_TELL / CHAT 两种颜色 —— 分错了玩家看不出"谁在私聊我"
        val tell = reduce(inGame(), MsgPacket(ch = "tell", content = "在吗", name = "阿飞"))
        assertEquals(LogKind.CHAT_TELL, tell.log.last().kind)

        val world = reduce(inGame(), MsgPacket(ch = "chat", content = "在吗", name = "阿飞"))
        assertEquals(LogKind.CHAT, world.log.last().kind)

        // 认不出的频道也归 CHAT（不许静默丢：服务端发了就得看得见）
        val rumor = reduce(inGame(), MsgPacket(ch = "rumor", content = "听说", name = "路人"))
        assertEquals(LogKind.CHAT, rumor.log.last().kind)
    }
}

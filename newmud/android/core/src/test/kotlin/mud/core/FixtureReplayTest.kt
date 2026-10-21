package mud.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 用**真机抓的帧**回放一遍完整流程（`fixtures/*.json`，由 `tools/gen-protocol-fixtures.mjs` 生成）。
 *
 * ★ 为什么用真帧而不是手写 JSON：
 *   手写帧 + 手写归约可以一起错，而错的时候测试是绿的。
 *   这批帧是"真起服务端、真登录、真打一架"抓下来的，
 *   于是"解码 + 归约 + 界面状态"这一整条链验的是同一份事实。
 *
 * ★ [FakeTransport] 让"网络"变成一个数组：
 *   不需要服务器、不需要模拟器、不需要等超时 —— 于是这一层可以在 CI 的 JVM 作业里跑。
 */
class FixtureReplayTest {
    /** 假传输：不建连接，只把帧从测试推进客户端 */
    private class FakeTransport : Transport {
        private var onFrame: ((String) -> Unit)? = null
        val sent = mutableListOf<String>()
        var closed = false

        override fun connect(
            url: String,
            onOpen: () -> Unit,
            onFrame: (String) -> Unit,
            onClosed: (String) -> Unit,
        ) {
            this.onFrame = onFrame
            onOpen()
        }

        override fun send(text: String) {
            sent.add(text)
        }

        override fun close() {
            closed = true
        }

        /** 喂一帧**原文**（构造非法帧 / 手工帧用） */
        fun feedRaw(text: String) {
            onFrame?.invoke(text)
        }

        /** 喂一帧真机样本 */
        fun feedFixture(type: String) {
            feedRaw(realFixture(type))
        }
    }

    @Test
    fun `登录 → 房间 → 房间列表 这一串真帧能把状态推到“在游戏里”`() {
        val transport = FakeTransport()
        val client = MudClient(transport)
        client.connect("ws://test/ws")
        assertEquals(Phase.Connected, client.state.value.phase)

        transport.feedFixture("login")
        transport.feedFixture("room")
        transport.feedFixture("items")

        val s = client.state.value
        assertEquals(Phase.InGame, s.phase)
        assertNotNull("login 帧该把角色建起来", s.me)
        assertNotNull("room 帧该把房间填上", s.room)
        assertTrue("房间里得有人或物", s.actors.isNotEmpty())
        assertTrue("房间描述不该是空的（真帧里就有）", s.room!!.desc.isNotEmpty())
        assertTrue("这条链上不该有解析失败的痕迹", s.log.none { it.kind == LogKind.SYS })
    }

    @Test
    fun `物件帧开面板，面板带得动身份`() {
        val transport = FakeTransport()
        val client = MudClient(transport)
        client.connect("ws://test/ws")
        transport.feedFixture("login")
        transport.feedFixture("room")
        transport.feedFixture("item")

        val panel = client.state.value.panel
        assertNotNull("item 帧必须开面板（网页端 §57 就是这么改的）", panel)
        assertTrue("面板得知道自己是哪一块（否则 context 判据无从比较）", panel!!.id.isNullOrEmpty().not())
        assertTrue("正文至少一行（物件描述）", panel.rows.isNotEmpty())
    }

    @Test
    fun `带命令的 warn 真帧进提示框`() {
        // ★ 这一条用的是**手工构造**的帧，不是样本：真机上目前没有"带命令的 warn"
        //   那一帧（`showWarn` 的消费者是 `die`，而抓不到自己死 —— 见脚本的 KNOWN_GAPS）。
        //   ⇒ 这是**已知的验证空白**，写在这里，而不是假装样本覆盖了。
        val transport = FakeTransport()
        val client = MudClient(transport)
        client.connect("ws://test/ws")
        transport.feedRaw("""{"v":1,"type":"warn","content":"确定要退出吗？","cmds":[{"cmd":"quit","name":"退出"}]}""")

        assertEquals("确定要退出吗？", client.state.value.prompt?.text)
        assertEquals(listOf(Cmd("quit", "退出")), client.state.value.prompt?.cmds)
    }

    @Test
    fun `无法解析的帧变成一行系统消息，而不是静默丢掉`() {
        val transport = FakeTransport()
        val client = MudClient(transport)
        client.connect("ws://test/ws")
        transport.feedRaw("""{"v":1,"type":"不存在的类型"}""")
        transport.feedRaw("这不是 JSON")

        val s = client.state.value
        assertEquals(2, s.log.size)
        assertTrue("必须有痕迹：不报错、只是界面不更新，是最难查的一类问题", s.log.all { it.kind == LogKind.SYS })
    }

    @Test
    fun `发指令走 command 包，且引号不会破坏 JSON`() {
        val transport = FakeTransport()
        val client = MudClient(transport)
        client.connect("ws://test/ws")
        client.sendCommand("""say 他说"你好\"""")

        assertEquals(1, transport.sent.size)
        val obj = Json.parseToJsonElement(transport.sent.single()).jsonObject
        assertEquals("command", (obj["type"] as JsonPrimitive).content)
        assertEquals("""say 他说"你好\"""", (obj["cmd"] as JsonPrimitive).content)
    }

    @Test
    fun `面板里点按钮：先标记新一轮，再发令`() {
        val transport = FakeTransport()
        val client = MudClient(transport)
        client.connect("ws://test/ws")
        transport.feedFixture("login")
        transport.feedFixture("item")

        client.sendPanelCommand("ask pub/xiaoer")
        assertEquals("先标记：下一行回显是第一行", false, client.state.value.panel?.roundStarted)
        assertEquals("再发令", 1, transport.sent.size)
    }
}

/** 读一份真机样本（顶层函数，两个测试类共用） */
internal fun realFixture(type: String): String {
    val stream = FixtureReplayTest::class.java.getResourceAsStream("/fixtures/$type.json")
    assertNotNull("缺少样本 $type.json —— 先跑 node tools/gen-protocol-fixtures.mjs", stream)
    return stream!!.readBytes().toString(Charsets.UTF_8)
}

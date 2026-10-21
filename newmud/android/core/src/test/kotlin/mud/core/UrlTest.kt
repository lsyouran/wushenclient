package mud.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * 地址规整的判据。
 *
 * ★ 这些用例不是"随便测测"：`http://192.168.1.5:8123/` 是服务端 `--lan` **真的会打印**
 *   的那一行，而它直接粘进 App 是连不上的（协议错 + 少 `/ws`）。
 *   这条路径是玩家第一次用就会踩的，所以要有单测钉住。
 */
class UrlTest {
    @Test
    fun `服务端打印的 http 地址能被认成 ws 并补上 ws 路径`() {
        assertEquals("ws://192.168.1.5:8123/ws", normalizeWsUrl("http://192.168.1.5:8123/"))
        assertEquals("ws://192.168.1.5:8123/ws", normalizeWsUrl("http://192.168.1.5:8123"))
    }

    @Test
    fun `https 映射成 wss（上线时用的就是这条）`() {
        assertEquals("wss://mud.example.com/ws", normalizeWsUrl("https://mud.example.com"))
        assertEquals("wss://mud.example.com/ws", normalizeWsUrl("https://mud.example.com/"))
    }

    @Test
    fun `没写协议时按明文 ws 处理（局域网自测最常见）`() {
        assertEquals("ws://192.168.1.5:8123/ws", normalizeWsUrl("192.168.1.5:8123"))
        assertEquals("ws://10.0.2.2:8123/ws", normalizeWsUrl("10.0.2.2:8123"))
    }

    @Test
    fun `已经完整的地址原样返回，且幂等`() {
        val once = normalizeWsUrl("ws://10.0.2.2:8123")
        assertEquals("ws://10.0.2.2:8123/ws", once)
        // ★ 幂等：再喂一次不能变成 `/ws/ws`（"点两次连接"就会踩）
        assertEquals(once, normalizeWsUrl(once!!))
        assertEquals(once, normalizeWsUrl(normalizeWsUrl(once)!!))
    }

    @Test
    fun `反代带路径前缀时不硬塞 ws`() {
        assertEquals("wss://mud.example.com/proxy/ws", normalizeWsUrl("https://mud.example.com/proxy/ws"))
    }

    @Test
    fun `空白与只有协议没有主机的输入返回 null`() {
        assertNull(normalizeWsUrl(""))
        assertNull(normalizeWsUrl("   "))
        assertNull(normalizeWsUrl("ws://"))
        assertNull(normalizeWsUrl("http:///path"))
    }

    @Test
    fun `首尾空白不影响结果`() {
        assertEquals("ws://192.168.1.5:8123/ws", normalizeWsUrl("  http://192.168.1.5:8123/  "))
    }
}

package mud.protocol

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject

/**
 * 协议契约测试 —— **拿真机报文**验 Kotlin 那套 data class 解不解得开。
 *
 * ★ 为什么样本必须是真的（26 册 §82.4）：
 *   手写样本 + 手写解析器可以一起错，而它们一起错的时候测试是绿的。
 *   这里的每一份 `fixtures/<type>.json` 都是 `tools/gen-protocol-fixtures.mjs`
 *   **真起服务端、真登录、真打了一架**抓下来的帧，并且在那一步已经过了一遍 zod schema。
 *
 * ★ 这个测试不需要安卓：`gradle :protocol:test` 在普通 JVM 上跑完，
 *   于是"字段名抄错 / 类型抄错"这类错误在 CI 的几秒内就能红，
 *   而不是等到装机、登录、打到某一帧才炸。
 */
class DecodeTest {
    /** `src/test/resources/fixtures/` 在 JVM 测试里是一个普通目录 */
    private val fixturesDir: File =
        File(javaClass.getResource("/fixtures")?.toURI() ?: error("找不到 /fixtures 资源目录"))

    private fun fixture(type: String): String =
        File(fixturesDir, "$type.json").readText(Charsets.UTF_8)

    /** 文件名 → 生成的类名（`login` → `LoginPacket`，`loginerror` → `LoginerrorPacket`） */
    private fun expectedClassOf(type: String): String =
        type.replaceFirstChar { it.uppercaseChar() } + "Packet"

    @Test
    fun `每一份真机样本都能解出来，且解出来的类与文件名对得上`() {
        val files = fixturesDir.listFiles { f -> f.name.endsWith(".json") && f.name != "_index.json" }
        assertNotNull("样本目录是空的：先跑 node tools/gen-protocol-fixtures.mjs", files)
        val samples = files!!.map { it.name.removeSuffix(".json") }.sorted()
        // ★ 下限断言：样本被误删/生成脚本没写成功时，这个测试不能"因为没东西可测"而变绿。
        //   13 是写这份测试时的实测值（见 `_index.json`）；少到 8 以下说明有东西真的丢了。
        assertTrue("样本太少（${samples.size} 个），样本可能被误删了", samples.size >= 8)

        for (type in samples) {
            val packet = decodePacket(fixture(type))
            assertNotNull("$type 解不出来", packet)
            assertEquals(
                "$type 解出来的类不对",
                expectedClassOf(type),
                packet!!.javaClass.simpleName,
            )
        }
    }

    @Test
    fun `_index_json 与磁盘上的样本文件一致`() {
        // ★ 这条守的是"有人加了样本文件却忘了写进 index"——
        //   否则 index 会慢慢变成一份假清单，而没有任何东西会红。
        // ★ 用 JSON 解析而不是正则：正则版本第一版把 `captured` 里的类型名也当成
        //   `types` 了（两个数组名字不同、内容相交），于是"一致"是碰巧对的。
        val index = PacketJson.parseToJsonElement(fixture("_index")).jsonObject
        val listed = index["types"]!!.jsonArray.map { (it as JsonPrimitive).content }.toSet()
        val onDisk = fixturesDir.listFiles { f -> f.name.endsWith(".json") && f.name != "_index.json" }!!
            .map { it.name.removeSuffix(".json") }
            .toSet()
        assertEquals("index.types 与磁盘文件不一致", onDisk, listed)
    }

    @Test
    fun `协议版本不匹配 ⇒ 返回 null（不要静默按老协议继续解）`() {
        val bad = """{"v":${PROTOCOL_VERSION + 1},"type":"warn","content":"x","cmds":[]}"""
        assertNull(decodePacket(bad))
    }

    @Test
    fun `不认识的 type ⇒ 返回 null`() {
        val unknown = """{"v":$PROTOCOL_VERSION,"type":"这不是协议里的类型"}"""
        assertNull(decodePacket(unknown))
    }

    @Test
    fun `非 JSON ⇒ 返回 null（不能把整条连接崩掉）`() {
        assertNull(decodePacket("not json at all"))
        assertNull(decodePacket("[]"))
    }

    @Test
    fun `缺必需字段 ⇒ 抛异常`() {
        // ★★ 这里**必须抛**，不能返回 null。
        //   "少一个必需字段"意味着协议与 Kotlin 不一致（忘了重新生成 / 服务端发了旧包）。
        //   返回 null 会把它伪装成"不认识这个包"，于是问题表现为"某个界面永远不更新"。
        //   抛出去由调用方（MudClient）记一条系统消息 —— 那才是能被看见的失败。
        val missing = """{"v":$PROTOCOL_VERSION,"type":"warn","cmds":[]}"""
        val threw = runCatching { decodePacket(missing) }.isFailure
        assertTrue("缺 content 应该抛异常", threw)
    }

    @Test
    fun `warn 的 context 省略时是 null（缺省 = 进消息流）`() {
        val p = decodePacket(fixture("warn")) as WarnPacket
        assertNull("真机样本里 warn 没有 context（内容层还没有 notifyInPanel 调用点）", p.context)
    }
}

package mud.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 颜色标签解析（`src/ui/markup.ts` 的安卓侧等价物）。
 *
 * ★ 这几条判据不是"样式细节"，是**安全语义**：
 *   ① 白名单之外一律当文字 ⇒ 服务端 / 玩家拼进来的 `<script>` 只是八个字符；
 *   ② 属性不落地 ⇒ 文本里塞不进可点按钮（可点按钮只有 [Cmd] 一条路）；
 *   ③ 深度上限 ⇒ 一个十万层的包不会打出栈溢出。
 *   网页端那边这三条靠 jsdom 测，这里靠纯函数测 —— 同一套语义，更便宜的验证方式。
 */
class MarkupTest {
    @Test
    fun `白名单内的高亮标签变成 span`() {
        val s = parseMarkup("<HIR>红字</HIR>普通")
        assertEquals("红字普通", s.text)
        assertEquals(1, s.spans.size)
        assertEquals(ColorToken.HIR, s.spans[0].token)
        assertEquals(0, s.spans[0].start)
        assertEquals(2, s.spans[0].end)
    }

    @Test
    fun `标签大小写不敏感`() {
        val s = parseMarkup("<hir>红</hir>")
        assertEquals("红", s.text)
        assertEquals(ColorToken.HIR, s.spans.single().token)
    }

    @Test
    fun `白名单之外的标签原样显示（开闭都算）`() {
        assertEquals("<script>alert(1)</script>", parseMarkup("<script>alert(1)</script>").text)
        assertTrue(parseMarkup("<script>x</script>").spans.isEmpty())
    }

    @Test
    fun `标签上的属性不落地`() {
        val s = parseMarkup("""<HIR cmd="look 1" onclick="x()">红</HIR>""")
        assertEquals("红", s.text)
        assertEquals(1, s.spans.size)
    }

    @Test
    fun `嵌套时内层区间在外层之内`() {
        val s = parseMarkup("<HIR>外<HIY>内</HIY>外</HIR>")
        assertEquals("外内外", s.text)
        assertEquals(2, s.spans.size)
        // 外层覆盖整段，内层覆盖中间那个字
        val outer = s.spans.first { it.token == ColorToken.HIR }
        val inner = s.spans.first { it.token == ColorToken.HIY }
        assertEquals(0, outer.start)
        assertEquals(3, outer.end)
        assertEquals(1, inner.start)
        assertEquals(2, inner.end)
    }

    @Test
    fun `多余的闭标签被忽略，不显示也不当文字`() {
        assertEquals("红", parseMarkup("</HIR>红").text)
    }

    @Test
    fun `不是合法标签的小于号当普通字符`() {
        assertEquals("1 < 2", parseMarkup("1 < 2").text)
        assertEquals("a<", parseMarkup("a<").text)
    }

    @Test
    fun `深度超过上限的部分当成文字，不递归`() {
        val deep = "<HIR>".repeat(MAX_DEPTH + 5) + "底" + "</HIR>".repeat(MAX_DEPTH + 5)
        val s = parseMarkup(deep)
        // 不崩、且有输出是最低要求；到顶之后的开标签应当以文字形式留在文本里
        assertTrue("解析不能崩（这是这条的上限存在的理由）", s.text.isNotEmpty())
        assertTrue("超限的标签要作为文字出现", s.text.contains("<HIR>"))
    }

    @Test
    fun `plainText 剥掉白名单标签但保留白名单外的尖括号`() {
        assertEquals("红字", plainText("<HIR>红字</HIR>"))
        assertEquals("<b>x</b>", plainText("<b>x</b>"))
    }

    @Test
    fun `多行文本与换行原样保留`() {
        val s = parseMarkup("第一行\n第二行")
        assertEquals("第一行\n第二行", s.text)
    }

    @Test
    fun `空标签不产出零长度区间`() {
        assertTrue(parseMarkup("<HIR></HIR>").spans.isEmpty())
    }
}

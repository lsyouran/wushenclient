package mud.core

/**
 * 服务端文本里的颜色标签 → **与平台无关的样式区间**。
 *
 * 这是 `src/ui/markup.ts` 的 Kotlin 侧等价物（同一个白名单、同一条嵌套上限、同一条
 * "白名单外一律当文字"）。移植的时候**不改语义**，因为这几条语义都有安全含义：
 *
 *   ① 只认白名单标签 ⇒ `<script>` 只是八个字符，不是节点；
 *   ② 属性一律不落地 ⇒ 文本里塞不进"可点按钮"（可点按钮只有 [Cmd] 一条结构化通道）；
 *   ③ 嵌套深度上限 [MAX_DEPTH] ⇒ 一个 10 万层的包打不出栈溢出
 *      （文本长度受出站包大小守卫约束，但"长度受限"不等于"嵌套受限"）。
 *
 * ★ 为什么解析成 span 而不是直接产出 Compose 的 `AnnotatedString`：
 *   `AnnotatedString` 属 Compose，一旦用它，这个函数就只能跑在安卓上 ——
 *   而"颜色标签解析对不对"恰恰是**必须能在 JVM 上断言**的东西（[parseMarkup] 有单测）。
 *   `:app` 只做 [ColorToken] → `Color` 的查表，那一步没有判断。
 */

/** 能进文本的颜色 / 样式标签（**大小写不敏感**，与网页端 `KNOWN` 逐条对齐） */
enum class ColorToken {
    NOR, GRE, BLK, BLU, CYN, RED, MAG, YEL, WHT, ORA,
    HIK, HIB, HIG, HIC, HIR, HIM, HIY, HIW, HIO, HIJ, HIZ, ORD,
    BBLK, BBLU, BCYN, BRED, BMAG, BYEL, BWHT, BHIK,
    HBBLU, HBGRN, HBCYN, HBRED, HBMAG, HBYEL, HBWHT,
    DEL, MEM, OPT, FLA, LINE;

    companion object {
        /** 名字 → token；白名单外返回 `null`（调用方把标签当文字，不隐藏） */
        fun of(upperName: String): ColorToken? = ColorToken.entries.firstOrNull { it.name == upperName }
    }
}

/**
 * 一段带样式的区间：`[start, end)` 覆盖 [StyledText.text] 的下标区间。
 *
 * ★ 区间是**半开**的，且允许嵌套（外层先出现、内层后出现 ⇒ 渲染时后者覆盖前者）。
 */
data class StyleSpan(val start: Int, val end: Int, val token: ColorToken)

/** 解析结果：纯文本 + 样式区间 */
data class StyledText(val text: String, val spans: List<StyleSpan>)

/**
 * 嵌套**深度上限**。
 *
 * ★ 32 远超真实文本的需要（`<HIR><HIY>…</HIY></HIR>` 通常 ≤3 层）。
 *   超出部分按**文字**显示 —— 不隐藏、也不建样式：与"白名单外的标签"同等待遇。
 */
const val MAX_DEPTH: Int = 32

/**
 * 开标签（含可选属性）· 逐段扫描。
 *
 * ★ 属性串仍被解析，只为**完整匹配一个标签**；它不会出现在任何输出里（见文件头的 ②）。
 */
private val TAG_RE = Regex("""<(/?)([A-Za-z][A-Za-z0-9]*)((?:\s+[A-Za-z-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*>""")

/**
 * 把一段服务端文本解析成 [StyledText]。
 *
 * ★ 白名单之外的标签**原样保留**（开闭都算）：只判开标签会把闭标签静默吞掉，
 *   于是玩家看到的文本会缺一块 —— 网页端第一版就是这么错的。
 */
fun parseMarkup(raw: String): StyledText {
    val out = StringBuilder(raw.length)
    val spans = ArrayList<StyleSpan>()
    parseInto(raw, 0, null, out, spans, 0)
    return StyledText(out.toString(), spans)
}

/** 取纯文字：白名单标签剥掉，白名单外的 `<…>` 照原样留着（`title` 这类只能放字符串的地方用） */
fun plainText(raw: String): String = parseMarkup(raw).text

/**
 * 递归解析。
 *
 * @param closeName 本层等待的闭标签名（`null` = 顶层，谁来都不关）
 * @param depth     当前嵌套层数（顶层 = 0），见 [MAX_DEPTH]
 * @return 结束位置（闭标签之后 / 文本末尾）
 */
private fun parseInto(
    raw: String,
    from: Int,
    closeName: String?,
    out: StringBuilder,
    spans: MutableList<StyleSpan>,
    depth: Int,
): Int {
    var i = from
    while (i < raw.length) {
        val at = raw.indexOf('<', i)
        if (at < 0) {
            out.append(raw, i, raw.length)
            break
        }
        out.append(raw, i, at)

        val m = TAG_RE.matchAt(raw, at)
        if (m == null) {
            // 不是合法标签（`<` 后面乱写）→ 当普通字符
            out.append('<')
            i = at + 1
            continue
        }

        val closing = m.groupValues[1] == "/"
        val name = m.groupValues[2].uppercase()
        i = at + m.value.length

        val token = ColorToken.of(name)
        if (token == null) {
            // 白名单之外（开闭都算）一律原样显示
            out.append(m.value)
            continue
        }
        if (closing) {
            if (closeName != null && name == closeName) return i
            // 多余的闭标签：忽略（不显示、也不当文字）
            continue
        }
        if (depth >= MAX_DEPTH) {
            // 深度到顶 ⇒ 这个开标签当文字（不建样式、不递归）
            out.append(m.value)
            continue
        }
        val start = out.length
        i = parseInto(raw, i, name, out, spans, depth + 1)
        // ★ 空内容不产出 span：`<HIR></HIR>` 不该在列表里留一条零长度区间，
        //   否则渲染层要额外判一次 `start < end`（网页端那边由 DOM 天然处理了）。
        if (out.length > start) spans.add(StyleSpan(start, out.length, token))
    }
    return raw.length
}

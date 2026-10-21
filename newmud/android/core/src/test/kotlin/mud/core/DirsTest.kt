package mud.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 方向表的判据。
 *
 * ★ 这一批最要紧的一条是 `s → south`：wushen 的 `go.js` 里
 *   `doors[]` / `doors_short[]` 两个数组**顺序错位**，于是按 `s` 会往西走。
 *   这条错在真实玩家手里表现为"我明明按的南"，而它是**纯数据错误**，
 *   只能靠一张对齐过的别名表 + 断言。
 */
class DirsTest {

    @Test
    fun `20 个方向都认，且线上键唯一、中文名非空`() {
        assertEquals(20, Direction.entries.size)
        assertEquals("线上键重复了", 20, Direction.entries.map { it.wire }.toSet().size)
        for (d in Direction.entries) {
            assertTrue("${d.wire} 没有中文名", d.label.isNotEmpty())
            assertEquals("${d.wire} 归一化不回自己", d, normalizeDirection(d.wire))
        }
    }

    @Test
    fun `短写按标准对应关系（wushen 的 s 指向 west 的错位不许复现）`() {
        assertEquals(Direction.NORTH, normalizeDirection("n"))
        assertEquals(Direction.SOUTH, normalizeDirection("s"))
        assertEquals(Direction.EAST, normalizeDirection("e"))
        assertEquals(Direction.WEST, normalizeDirection("w"))
        assertEquals(Direction.NORTHEAST, normalizeDirection("ne"))
        assertEquals(Direction.SOUTHEAST, normalizeDirection("se"))
        assertEquals(Direction.NORTHWEST, normalizeDirection("nw"))
        assertEquals(Direction.SOUTHWEST, normalizeDirection("sw"))
        assertEquals(Direction.NORTHUP, normalizeDirection("nu"))
        assertEquals(Direction.SOUTHDOWN, normalizeDirection("sd"))
        assertEquals(Direction.UP, normalizeDirection("u"))
        assertEquals(Direction.DOWN, normalizeDirection("d"))
    }

    @Test
    fun `认不出的写法一律 null（不猜、不模糊匹配）`() {
        assertNull(normalizeDirection(""))
        assertNull(normalizeDirection("north1"))
        assertNull(normalizeDirection("N"))
        assertNull(normalizeDirection("北"))
        // `enter` / `out` 没有短写 —— 猜一个就是自己加约定
        assertNull(normalizeDirection("en"))
    }

    @Test
    fun `isDirection 自己负责 trim 与小写`() {
        assertTrue(isDirection("north"))
        // 两端空白与小写都由它吃：玩家在输入框里敲 "  N " 也得能走
        assertTrue(isDirection("  North "))
        assertTrue(isDirection("N"))
        assertTrue(isDirection("\tnu\n"))
        // 只有**两端**空白被吃 —— 中间有空格就是另一个词，不许模糊成方向
        assertFalse(isDirection("nor th"))
        assertFalse(isDirection("n orth"))
        assertFalse(isDirection("走"))
    }

    @Test
    fun `dirLabel 给中文名，未知方向原样返回（不留空字）`() {
        assertEquals("北", dirLabel("north"))
        assertEquals("北", dirLabel("n"))
        assertEquals("进入", dirLabel("enter"))
        assertEquals("西下", dirLabel("westdown"))
        assertEquals("x", dirLabel("x"))
        assertEquals("", dirLabel(""))
    }
}

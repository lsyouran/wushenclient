/**
 * tests/ws-close.test.ts —— `close reason` 的字节上限（审查 N6 的落地判据）
 * ============================================================================
 * 来源：`_audit-代码文档体检-2026-10-13.md` 的 N6。
 *
 * `ws` 库对 WebSocket close reason 有**硬限制**：超过 123 字节时 `close()` 抛
 * `RangeError`。而 `HubConnection.close(reason)` 直接把它透传给 `socket.close(1011, reason)`
 * —— 一旦抛，"关连接"这件事就失败了，异常顺着调用栈冒进入站处理，落进 N1 的崩溃路径。
 *
 * ★ 当前所有 detail 都 ≤87 字节（暂不可触发），但这是**潜伏**缺陷：
 *   只要有一条 detail 变长（或多了一条），就会变成"关不掉的连接"。
 *
 * ★ 判据落在**字节**上而不是字符数：reason 是中文时按字符截会超出（1 字 = 3 字节）。
 */
import { describe, expect, it } from 'vitest';

import { WS_CLOSE_REASON_MAX_BYTES, truncateCloseReason } from '../server/net/ws-server.js';

describe('N6 · close reason 必须截断到 ws 的字节上限', () => {
  it('★ 超长的中文 reason 被截到上限之内（按**字节**，不是字符）', () => {
    const long = '错'.repeat(100); // 300 字节
    expect(Buffer.byteLength(long, 'utf8')).toBeGreaterThan(WS_CLOSE_REASON_MAX_BYTES);

    const out = truncateCloseReason(long);
    expect(Buffer.byteLength(out, 'utf8')).toBeLessThanOrEqual(WS_CLOSE_REASON_MAX_BYTES);
    expect(out.length, '按字符截会留下 100 个（=300 字节）').toBeLessThan(long.length);
  });

  it('★ 不切出半个字符（截断点落在多字节字符中间时丢掉整个字符）', () => {
    // 122 个 ASCII + 1 个中文 = 125 字节 ⇒ 只能保留前 122 字节的 ASCII
    const s = `${'a'.repeat(WS_CLOSE_REASON_MAX_BYTES - 1)}错`;
    const out = truncateCloseReason(s);

    expect(out).toBe('a'.repeat(WS_CLOSE_REASON_MAX_BYTES - 1));
    expect(out).not.toContain('\uFFFD'); // 不许出现"半个字符"的替换符
  });

  it('【反向锚点】在上限之内的 reason 原样返回（别把正常的理由也改掉）', () => {
    const ok = '服务器内部错误';
    expect(Buffer.byteLength(ok, 'utf8')).toBeLessThanOrEqual(WS_CLOSE_REASON_MAX_BYTES);
    expect(truncateCloseReason(ok)).toBe(ok);
    expect(truncateCloseReason('')).toBe('');
  });

  it('★ 上限值本身必须留出余量（ws 的硬限是 123）', () => {
    expect(WS_CLOSE_REASON_MAX_BYTES).toBeLessThanOrEqual(123);
    expect(WS_CLOSE_REASON_MAX_BYTES).toBeGreaterThan(0);
  });
});

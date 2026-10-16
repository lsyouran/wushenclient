/**
 * tests/reconnect.test.ts —— 掉线后的退避重连（审查 F3 的落地判据）
 * ============================================================================
 * 来源：`D:/ts-mud/_audit-代码缺陷与安全审查-2026-10-16.md` 的 F3。
 *
 * ★ 只测**纯策略**（`src/net/reconnect.ts`）：定时器在接线层（`main.ts`），
 *   所以这里不需要假装时钟；而"等多久""该不该重连""什么时候放弃"三件事
 *   都能被钉死。
 */
import { describe, expect, it } from 'vitest';

import { RECONNECT_DELAYS_MS, ReconnectPolicy, decideOnClose } from '../src/net/reconnect.js';

describe('F3 · 退避重连策略', () => {
  it('★ 第一次总是最短延迟（一断线就等 30 秒是不能接受的）', () => {
    const p = new ReconnectPolicy();
    expect(p.nextDelayMs()).toBe(RECONNECT_DELAYS_MS[0]);
  });

  it('★ 逐次递增取完整个序列，用尽后返回 null', () => {
    const p = new ReconnectPolicy();
    const seen = RECONNECT_DELAYS_MS.map(() => p.nextDelayMs());
    expect(seen).toEqual([...RECONNECT_DELAYS_MS]);
    expect(p.nextDelayMs()).toBeNull();
    expect(p.exhausted).toBe(true);
  });

  it('★ 每一档都是有限正数（0 会退化成忙等重连）', () => {
    for (const d of RECONNECT_DELAYS_MS) {
      expect(Number.isFinite(d)).toBe(true);
      expect(d).toBeGreaterThan(0);
    }
    // 单调不减：退避的意义就在"越试越久"
    const sorted = [...RECONNECT_DELAYS_MS].sort((a, b) => a - b);
    expect([...RECONNECT_DELAYS_MS]).toEqual(sorted);
  });

  it('reset 之后从头开始', () => {
    const p = new ReconnectPolicy();
    p.nextDelayMs();
    p.nextDelayMs();
    p.reset();
    expect(p.attempt).toBe(0);
    expect(p.nextDelayMs()).toBe(RECONNECT_DELAYS_MS[0]);
  });
});

describe('F3 · 断线决策（decideOnClose 是唯一判据）', () => {
  it('★ 认证期断线 → 只报错，不重连、也不消耗重试次数', () => {
    const p = new ReconnectPolicy();
    expect(decideOnClose(false, p)).toEqual({ kind: 'report-only' });
    // ★ 关键的区分性判据：这条决定**不能**动策略状态
    expect(p.attempt).toBe(0);
  });

  it('★ 游戏中断线 → 排一次重连，延迟按退避序列往后走', () => {
    const p = new ReconnectPolicy();
    expect(decideOnClose(true, p)).toEqual({ kind: 'reconnect', delayMs: RECONNECT_DELAYS_MS[0] });
    expect(decideOnClose(true, p)).toEqual({ kind: 'reconnect', delayMs: RECONNECT_DELAYS_MS[1] });
  });

  it('★ 试尽 → give-up（不能让客户端永远显示"正在重连"骗玩家）', () => {
    const p = new ReconnectPolicy();
    for (let i = 0; i < RECONNECT_DELAYS_MS.length; i += 1) decideOnClose(true, p);
    expect(decideOnClose(true, p)).toEqual({ kind: 'give-up' });
  });

  it('【反向锚点】重连成功后 reset ⇒ 下次断线从最短退避重新开始', () => {
    const p = new ReconnectPolicy();
    decideOnClose(true, p);
    decideOnClose(true, p);
    p.reset();
    expect(decideOnClose(true, p)).toEqual({ kind: 'reconnect', delayMs: RECONNECT_DELAYS_MS[0] });
  });
});

/**
 * 每连接指令限流（★ docs/26 S3 回归）
 * ============================================================================
 * `RATE_LIMIT_PER_5S = 20` 原先零消费者。这里证明它现在真的会被执行。
 *
 * ★ 两个"没有它会怎样"的对照：
 *   ① 固定窗口 vs 滑动窗口：固定窗口在边界处能过 2×limit；
 *   ② 不 prune 的表会随历史连接数单调增长（本身就是 DoS 路径），
 *      所以 prune 的断言必须是"表真的变小"，而不是"函数不抛错"。
 */
import { RATE_LIMIT_PER_5S, RATE_LIMIT_WINDOW_MS } from '@shared/constants.js';
import { RATE_LIMIT_ERROR_CODE, SlidingWindowRateLimiter } from '../server/net/rate-limit.js';
import { describe, expect, it } from 'vitest';

const T0 = 1_700_000_000_000;

describe('S3 限流器：默认值与构造约束', () => {
  it('默认使用 constants 里的限流常量（它不再是"零消费者"的孤儿）', () => {
    const rl = new SlidingWindowRateLimiter();
    expect(rl.limit).toBe(RATE_LIMIT_PER_5S);
    expect(rl.windowMs).toBe(RATE_LIMIT_WINDOW_MS);
  });

  it('非法参数直接抛错，不静默降级成"不限流"', () => {
    for (const bad of [0, -1, 1.5, Number.NaN]) {
      expect(() => new SlidingWindowRateLimiter(bad), String(bad)).toThrow(RangeError);
    }
    for (const bad of [0, -5, Number.POSITIVE_INFINITY]) {
      expect(() => new SlidingWindowRateLimiter(3, bad), String(bad)).toThrow(RangeError);
    }
  });

  it('限流错误码就是协议里那个（不存在第二份文案）', () => {
    expect(RATE_LIMIT_ERROR_CODE).toBe('RATE_LIMITED');
  });
});

describe('S3 限流器：窗口语义', () => {
  it('窗口内恰好放行 limit 次，第 limit+1 次被拒', () => {
    const rl = new SlidingWindowRateLimiter(3, 1000);
    for (let i = 0; i < 3; i += 1) {
      const d = rl.hit('conn-1', T0 + i);
      expect(d.allowed, `第 ${i + 1} 次`).toBe(true);
      expect(d.retryAfterMs).toBe(0);
    }
    const denied = rl.hit('conn-1', T0 + 3);
    expect(denied.allowed).toBe(false);
    expect(denied.remaining).toBe(0);
    // 被拒时必须给出**正数**的等待时间，否则调用方会立刻重试成死循环
    expect(denied.retryAfterMs).toBeGreaterThan(0);
    expect(denied.retryAfterMs).toBeLessThanOrEqual(1000);
  });

  it('★ 滑动窗口：早先的命中过期后额度回来（不是"每窗口清零"）', () => {
    const rl = new SlidingWindowRateLimiter(2, 1000);
    expect(rl.hit('c', T0).allowed).toBe(true); // 过期点为 T0+1000
    expect(rl.hit('c', T0 + 500).allowed).toBe(true); // 过期点为 T0+1500
    expect(rl.hit('c', T0 + 900).allowed).toBe(false); // 两条都还在窗口内

    // T0+1001：第一条已过期 → 有 1 个额度
    expect(rl.hit('c', T0 + 1001).allowed).toBe(true);
    // T0+1501：第二条也过期了（T0+1001 那次还在）
    expect(rl.remaining('c', T0 + 1502)).toBe(1);
    // T0+2001：全部过期
    expect(rl.remaining('c', T0 + 2001)).toBe(2);
  });

  it('★ 对照：固定窗口式实现会在边界处放过 2×limit（本实现不会）', () => {
    // 固定窗口：bucket = floor(t / window)，同一 bucket 内计数
    const fixedBucket = (t: number) => Math.floor(t / 1000);
    const fixedHits = new Map<number, number>();
    const fixedAllow = (t: number): boolean => {
      const b = fixedBucket(t);
      const n = fixedHits.get(b) ?? 0;
      if (n >= 2) return false;
      fixedHits.set(b, n + 1);
      return true;
    };
    // 旧窗口末尾 2 次 + 新窗口开头 2 次 = 990ms 内放过 4 次（= 2×limit）
    expect([fixedAllow(T0 + 900), fixedAllow(T0 + 950)].every(Boolean)).toBe(true);
    expect([fixedAllow(T0 + 1000), fixedAllow(T0 + 1050)].every(Boolean)).toBe(true);

    // 滑动窗口在同一串时间点上只放过 limit 次
    const rl = new SlidingWindowRateLimiter(2, 1000);
    const sliding = [900, 950, 1000, 1050].map((d) => rl.hit('c', T0 + d).allowed);
    expect(sliding).toEqual([true, true, false, false]);
  });

  it('不同 key 互不影响；forget 立即释放额度', () => {
    const rl = new SlidingWindowRateLimiter(1, 1000);
    expect(rl.hit('a', T0).allowed).toBe(true);
    expect(rl.hit('b', T0).allowed).toBe(true); // b 有独立额度
    expect(rl.hit('a', T0 + 1).allowed).toBe(false);
    rl.forget('a');
    expect(rl.hit('a', T0 + 2).allowed).toBe(true);
  });
});

describe('S3 限流器：不无限增长（本身是一条 DoS 路径）', () => {
  it('★ prune 必须让表真的变小（进来又走的连接不能永久占位）', () => {
    const rl = new SlidingWindowRateLimiter(5, 1000);
    for (let i = 0; i < 500; i += 1) rl.hit(`conn-${i}`, T0);
    expect(rl.trackedKeys).toBe(500);

    // 全部过期后 prune → 表必须清空
    const removed = rl.prune(T0 + 1000);
    expect(removed).toBe(500);
    expect(rl.trackedKeys).toBe(0);
  });

  it('prune 只清过期 key，窗口内的 key 一个都不能少', () => {
    const rl = new SlidingWindowRateLimiter(5, 1000);
    rl.hit('old', T0);
    rl.hit('fresh', T0 + 900);
    expect(rl.prune(T0 + 1000)).toBe(1);
    expect(rl.trackedKeys).toBe(1);
    // fresh 的额度必须还在（只剩 4 次）
    expect(rl.remaining('fresh', T0 + 1000)).toBe(4);
  });

  it('★ hit 自己也会顺手丢弃过期记录（不依赖调用方记得 prune）', () => {
    const rl = new SlidingWindowRateLimiter(2, 1000);
    rl.hit('c', T0);
    rl.hit('c', T0 + 1);
    expect(rl.hit('c', T0 + 2).allowed).toBe(false);
    // 很久之后再来一次：两条旧记录都该被丢掉
    expect(rl.hit('c', T0 + 5000).allowed).toBe(true);
    expect(rl.remaining('c', T0 + 5000)).toBe(1);
  });
});

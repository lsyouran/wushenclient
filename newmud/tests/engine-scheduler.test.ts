/**
 * tests/engine-scheduler.test.ts — 周期调度器（批 1 · 战斗前置）
 * ============================================================================
 * 判据全部落在**行为**上（谁在什么时候被跑、跑了几个、顺序如何），
 * 不依赖真实时间：注入一个可变时钟，`step(t)` 手动推进。
 */

import { describe, expect, it, vi } from 'vitest';
import { Scheduler, SchedulerError } from '../server/engine/scheduler.js';

/** 可推进的假时钟 */
function makeClock(start = 1_000): { now: () => number; at: (ms: number) => void } {
  let t = start;
  return { now: () => t, at: (ms) => { t = ms; } };
}

describe('调度器 · schedule', () => {
  it('未到期不触发；到期才触发', () => {
    const clock = makeClock();
    const s = new Scheduler({ now: clock.now });
    const cb = vi.fn();
    s.schedule(500, cb);

    expect(s.step(1_499)).toBe(0); // 1499 < 1500，未到
    expect(cb).not.toHaveBeenCalled();

    expect(s.step(1_500)).toBe(1); // 恰好到期
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('一次性任务跑过之后从表里消失（不会二次触发）', () => {
    const clock = makeClock();
    const s = new Scheduler({ now: clock.now });
    const cb = vi.fn();
    s.schedule(10, cb);
    s.step(2_000);
    expect(s.size).toBe(0);
    s.step(9_999);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('过期很久的一次性任务只跑一次（不补跑）', () => {
    const clock = makeClock();
    const s = new Scheduler({ now: clock.now });
    const cb = vi.fn();
    s.schedule(10, cb);
    s.step(100_000);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('返回本次执行的任务个数', () => {
    const clock = makeClock();
    const s = new Scheduler({ now: clock.now });
    s.schedule(1, () => undefined);
    s.schedule(2, () => undefined);
    s.schedule(5_000, () => undefined); // 未到期
    expect(s.step(2_000)).toBe(2);
    expect(s.step(2_000)).toBe(0);
  });

  it('非法延迟（负数 / NaN）当场抛 SchedulerError，且不入表', () => {
    const s = new Scheduler({ now: () => 0 });
    expect(() => s.schedule(-1, () => undefined)).toThrow(SchedulerError);
    expect(() => s.schedule(Number.NaN, () => undefined)).toThrow(SchedulerError);
    expect(s.size).toBe(0);
  });
});

describe('调度器 · cancel', () => {
  it('取消后不再触发；重复取消返回 false', () => {
    const clock = makeClock();
    const s = new Scheduler({ now: clock.now });
    const cb = vi.fn();
    const h = s.schedule(100, cb);
    expect(s.cancel(h)).toBe(true);
    expect(s.cancel(h)).toBe(false);
    s.step(10_000);
    expect(cb).not.toHaveBeenCalled();
  });
});

describe('调度器 · 同批语义', () => {
  it('★ 回调内新排的任务**不在本批**执行（快照语义）', () => {
    const clock = makeClock();
    const s = new Scheduler({ now: clock.now });
    const order: string[] = [];
    s.schedule(10, () => {
      order.push('A');
      s.schedule(0, () => order.push('B')); // 即便延迟 0，也留到下次 step
    });

    s.step(1_010); // A 到期（1000+10）
    expect(order).toEqual(['A']); // B 未跑
    s.step(1_010);
    expect(order).toEqual(['A', 'B']); // 下次 step 才跑，且不会无限循环
    expect(s.size).toBe(0);
  });

  it('同刻到期的任务按**注册序**执行（可复现）', () => {
    const clock = makeClock();
    const s = new Scheduler({ now: clock.now });
    const order: number[] = [];
    s.schedule(100, () => order.push(1));
    s.schedule(100, () => order.push(2));
    s.schedule(100, () => order.push(3));
    s.step(1_200);
    expect(order).toEqual([1, 2, 3]);
  });

  it('不同到期时刻按**时间**排序，即便注册序相反', () => {
    const clock = makeClock();
    const s = new Scheduler({ now: clock.now });
    const order: string[] = [];
    s.schedule(300, () => order.push('late'));
    s.schedule(100, () => order.push('early'));
    s.step(2_000);
    expect(order).toEqual(['early', 'late']);
  });

  it('某任务抛错不打断同批其它任务，且异常被上报', () => {
    const clock = makeClock();
    const onError = vi.fn();
    const s = new Scheduler({ now: clock.now, onError });
    const after = vi.fn();
    s.schedule(10, () => {
      throw new Error('boom');
    });
    s.schedule(20, after);

    expect(s.step(2_000)).toBe(2); // 两个都"执行"了（第二个没被第一个带崩）
    expect(after).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledTimes(1);
  });
});

describe('调度器 · every', () => {
  it('按周期重复触发', () => {
    const clock = makeClock();
    const s = new Scheduler({ now: clock.now });
    const cb = vi.fn();
    s.every(100, cb); // 首拍 = 1000+100 = 1100

    s.step(1_099);
    expect(cb).toHaveBeenCalledTimes(0); // 还没到
    s.step(1_100);
    expect(cb).toHaveBeenCalledTimes(1);
    s.step(1_199);
    expect(cb).toHaveBeenCalledTimes(1); // 还没到下一拍
    s.step(1_200);
    expect(cb).toHaveBeenCalledTimes(2);
    expect(s.size).toBe(1); // 周期任务一直在表里，直到 cancel
  });

  it('落后很多时只触发一次并从"现在"重新起算（不补跑）', () => {
    const clock = makeClock();
    const s = new Scheduler({ now: clock.now });
    const cb = vi.fn();
    s.every(100, cb);
    // 一次 step 跨越 10 个周期
    expect(s.step(2_000)).toBe(1);
    expect(cb).toHaveBeenCalledTimes(1);
    // 下一拍从 2000 起算 ⇒ 2100 才触发
    s.step(2_099);
    expect(cb).toHaveBeenCalledTimes(1);
    s.step(2_100);
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it('cancel 后周期任务停摆', () => {
    const clock = makeClock();
    const s = new Scheduler({ now: clock.now });
    const cb = vi.fn();
    const h = s.every(100, cb);
    s.step(1_100);
    s.cancel(h);
    s.step(5_000);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(s.size).toBe(0);
  });
});

describe('调度器 · 保险丝与清理', () => {
  it('单次 step 受 maxTasksPerStep 限制，其余留到下一 tick', () => {
    const clock = makeClock();
    const s = new Scheduler({ now: clock.now, maxTasksPerStep: 2 });
    let count = 0;
    for (let i = 0; i < 5; i += 1) s.schedule(1, () => { count += 1; });

    expect(s.step(2_000)).toBe(2);
    expect(count).toBe(2);
    expect(s.step(2_000)).toBe(2);
    expect(s.step(2_000)).toBe(1);
    expect(count).toBe(5);
  });

  it('clear 清空全部任务', () => {
    const s = new Scheduler({ now: () => 0 });
    s.schedule(10, () => undefined);
    s.every(10, () => undefined);
    expect(s.size).toBe(2);
    s.clear();
    expect(s.size).toBe(0);
    expect(s.step(1_000_000)).toBe(0);
  });
});

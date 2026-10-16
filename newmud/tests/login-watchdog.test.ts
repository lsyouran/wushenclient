/**
 * tests/login-watchdog.test.ts —— 登录超时看门狗（审查 F2 的落地判据）
 * ============================================================================
 * 来源：`D:/ts-mud/_audit-代码缺陷与安全审查-2026-10-16.md` 的 F2。
 *
 * 用假时钟而非 sleep：`arm()` 之后到点该做什么、`disarm()` 之后该不该做，
 * 都是**状态**问题，不需要真等 10 秒。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LOGIN_TIMEOUT_MS, LoginWatchdog } from '../src/net/login-watchdog.js';

describe('F2 · 登录看门狗', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('★ 到点还没结果 → 触发一次 onTimeout（界面不再永久卡在"正在进入江湖"）', () => {
    let fired = 0;
    const w = new LoginWatchdog(LOGIN_TIMEOUT_MS, () => {
      fired += 1;
    });

    w.arm();
    expect(w.armed).toBe(true);
    vi.advanceTimersByTime(LOGIN_TIMEOUT_MS - 1);
    expect(fired, '还没到点就炸了').toBe(0);

    vi.advanceTimersByTime(1);
    expect(fired).toBe(1);
    expect(w.armed, '触发之后不该继续盯表').toBe(false);
  });

  it('★ disarm 之后到点也不触发（登录有结果了就别再报超时）', () => {
    let fired = 0;
    const w = new LoginWatchdog(1_000, () => {
      fired += 1;
    });

    w.arm();
    w.disarm();
    vi.advanceTimersByTime(10_000);

    expect(fired).toBe(0);
    expect(w.armed).toBe(false);
  });

  it('★ 重复 arm 只保留最后一次（"重连后重新发 login"需要的语义）', () => {
    let fired = 0;
    const w = new LoginWatchdog(1_000, () => {
      fired += 1;
    });

    w.arm();
    vi.advanceTimersByTime(600);
    w.arm(); // 重置：旧计时器必须被清掉
    vi.advanceTimersByTime(600); // 距第一次 1200ms、距第二次 600ms
    expect(fired, '旧计时器没被清掉（会在新一轮中途炸出来）').toBe(0);

    vi.advanceTimersByTime(400);
    expect(fired).toBe(1);
  });

  it('【反向锚点】disarm 幂等（没 arm 过也能调）', () => {
    const w = new LoginWatchdog(1_000, () => undefined);
    expect(() => {
      w.disarm();
    }).not.toThrow();
    expect(w.armed).toBe(false);
  });
});

/**
 * server/net/rate-limit.ts — 每连接指令限流（★ docs/26 S3）
 * ============================================================================
 * 原状：`RATE_LIMIT_PER_5S = 20` 只是一个常量，**零消费者** ——
 * 声明了限制却没人执行，等于没写（docs/26 §4 实测确认）。
 *
 * 这里把它落成一个**可单测的纯逻辑**：写这段代码**时**网络层尚未编写，所以先把
 * 限流规则钉死，这样 WS 层落地时是"接线"而不是"再设计一遍"。
 *
 * ★ **现状（2026-10-14 复查订正）**：网络层早已落地（26 册 §13），本限流器**已有真实消费者**
 *   —— 挂在入站管线第 ② 步（量大小 → **限流** → 分诊 → 解析），由
 *   `hub.inbound()` → `handleInboundFrame()` 调用（见 `hub.ts` 与 `frame-pipeline.ts`），
 *   每连接 20 次 / 5 秒。★ **限流必须在解析之前** —— 否则解析本身就先被压垮了。
 *   ⇒ 上一段"网络层尚未编写"只是**写下本文件时的状态**，不是现状。
 *
 * 两条实现上的硬要求：
 *   ① **窗口滑动**：不是"每 5 秒清零计数器"（那会让攻击者卡在窗口边界爆发），
 *      而是记录每次命中的时间戳、每次判断时丢弃过期记录。
 *   ② **不无限增长**：Map 以连接为键。连接来了又走时，如果过期记录不清理，
 *      这张表会随"曾经连过的连接数"单调增长 —— 这本身就是一条 DoS 路径。
 *      `prune()` 必须存在，且 `hit()` 也要顺手清理自己的那一条。
 */

import type { ErrorCode } from '@shared/protocol.js';
import { RATE_LIMIT_PER_5S, RATE_LIMIT_WINDOW_MS } from '@shared/constants.js';

export interface RateLimitDecision {
  readonly allowed: boolean;
  /** 本次放行后窗口内还剩几次（被拒时为 0） */
  readonly remaining: number;
  /** 还要等多久才有额度；放行时为 0 */
  readonly retryAfterMs: number;
}

/** 限流被拒时对应的错误码（供网络层直接回包） */
export const RATE_LIMIT_ERROR_CODE: ErrorCode = 'RATE_LIMITED';

export class SlidingWindowRateLimiter {
  readonly #limit: number;
  readonly #windowMs: number;
  readonly #hits = new Map<string, number[]>();

  public constructor(
    limit: number = RATE_LIMIT_PER_5S,
    windowMs: number = RATE_LIMIT_WINDOW_MS,
  ) {
    if (!Number.isInteger(limit) || limit <= 0) {
      throw new RangeError(`限流上限必须是正整数，收到 ${String(limit)}`);
    }
    if (!Number.isFinite(windowMs) || windowMs <= 0) {
      throw new RangeError(`限流窗口必须是正数（毫秒），收到 ${String(windowMs)}`);
    }
    this.#limit = limit;
    this.#windowMs = windowMs;
  }

  public get limit(): number {
    return this.#limit;
  }

  public get windowMs(): number {
    return this.#windowMs;
  }

  /** 当前仍在跟踪的 key 数量（用于观测 prune 是否有效） */
  public get trackedKeys(): number {
    return this.#hits.size;
  }

  /**
   * 记一次命中并判断是否放行。
   * @param key 连接标识（连接 id / 玩家 id 均可）
   * @param nowMs 可注入，便于测试；生产不传
   */
  public hit(key: string, nowMs: number = Date.now()): RateLimitDecision {
    const fresh = this.#fresh(key, nowMs);
    if (fresh.length >= this.#limit) {
      this.#hits.set(key, fresh); // 顺手把过期记录丢掉，不让表长大
      const oldest = fresh[0] ?? nowMs;
      return {
        allowed: false,
        remaining: 0,
        // 恒 > 0：`fresh` 里的时间戳都满足 `now - t < windowMs`
        retryAfterMs: Math.max(1, oldest + this.#windowMs - nowMs),
      };
    }
    fresh.push(nowMs);
    this.#hits.set(key, fresh);
    return { allowed: true, remaining: this.#limit - fresh.length, retryAfterMs: 0 };
  }

  /** 只查不改：窗口内还剩几次 */
  public remaining(key: string, nowMs: number = Date.now()): number {
    return Math.max(0, this.#limit - this.#fresh(key, nowMs).length);
  }

  /** 连接断开时调用，立即释放该 key 的全部记录 */
  public forget(key: string): void {
    this.#hits.delete(key);
  }

  /**
   * 清掉所有"窗口内已无记录"的 key，返回清掉的个数。
   * 网络层应周期性调用（例如跟随心跳），否则表会随历史连接数增长。
   */
  public prune(nowMs: number = Date.now()): number {
    let removed = 0;
    for (const [key, stamps] of this.#hits) {
      const fresh = stamps.filter((t) => nowMs - t < this.#windowMs);
      if (fresh.length === 0) {
        this.#hits.delete(key);
        removed += 1;
      } else if (fresh.length !== stamps.length) {
        this.#hits.set(key, fresh);
      }
    }
    return removed;
  }

  #fresh(key: string, nowMs: number): number[] {
    const stamps = this.#hits.get(key);
    if (stamps === undefined) return [];
    return stamps.filter((t) => nowMs - t < this.#windowMs);
  }
}

/**
 * src/net/reconnect.ts — 掉线后的**退避重连策略**（含"该不该重连"的决策）
 * ============================================================================
 * 2026-10-16 审查 F3：前端原先**完全没有重连** —— 全仓 `grep -E "setTimeout|setInterval|
 * reconnect|retry" src/` 零命中。一次网络抖动就把玩家永久留在认证界面，只能手动再点一次。
 *
 * ★ 这里只放**纯策略**（第几次等多久 / 什么时候放弃 / 该不该重连），**不碰 `setTimeout`**：
 *   定时器留在接线层（`main.ts`）。于是"等多久"与"该不该重连"这两件事可以单测，
 *   不必假装时钟。
 *
 * ★ 为什么**不**无限重试：断线也可能是"服务端关了"（部署 / 崩了）—— 无限重试会让
 *   客户端永远占着一个定时器、还一直显示"正在重连"骗玩家。退避到上限仍失败 ⇒
 *   如实回认证屏报错（由调用方决定怎么显示）。
 *
 * ★ 为什么**认证期**不重连：那时玩家还没进过游戏，连不上多半是"服务没启动 / 地址不对"，
 *   重试只是把同一条错误信息重复六遍。让调用方直接报错更清楚。
 */

/** 退避序列（ms）。到最后一档仍失败 ⇒ 放弃，交回调用方 */
export const RECONNECT_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 15_000, 30_000] as const;

export class ReconnectPolicy {
  #attempt = 0;

  /** 已经排过几次（`reset()` 后归零） */
  public get attempt(): number {
    return this.#attempt;
  }

  /** 次数用尽了吗（下一次 `nextDelayMs()` 会返回 `null`） */
  public get exhausted(): boolean {
    return this.#attempt >= RECONNECT_DELAYS_MS.length;
  }

  /** 取**下一次**要等的毫秒数，并记一次；返回 `null` = 用尽，别再试 */
  public nextDelayMs(): number | null {
    if (this.exhausted) return null;
    const delay = RECONNECT_DELAYS_MS[this.#attempt]!;
    this.#attempt += 1;
    return delay;
  }

  /** 连上了 / 玩家主动重新进入 ⇒ 归零（下一次断线从最短退避重新开始） */
  public reset(): void {
    this.#attempt = 0;
  }
}

/** 断线后该做什么 */
export type CloseDecision =
  /** 排一次重连，等这么久 */
  | { readonly kind: 'reconnect'; readonly delayMs: number }
  /** 重试次数用尽 ⇒ 如实报错、回认证屏 */
  | { readonly kind: 'give-up' }
  /** 认证期断线（没进过游戏）⇒ 只报错，不重连、也不消耗重试次数 */
  | { readonly kind: 'report-only' };

/**
 * 断线后的决策 —— **唯一的判据**（接线层不许自己再判一遍）。
 *
 * @param wasPlaying 断线那一刻"是否已经进过游戏"（`state.loggedIn`）
 * @param policy     退避策略（`report-only` 分支**不会**消耗它的次数）
 */
export function decideOnClose(wasPlaying: boolean, policy: ReconnectPolicy): CloseDecision {
  if (!wasPlaying) return { kind: 'report-only' };
  const delayMs = policy.nextDelayMs();
  return delayMs === null ? { kind: 'give-up' } : { kind: 'reconnect', delayMs };
}

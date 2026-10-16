/**
 * src/net/login-watchdog.ts — 登录看门狗
 * ============================================================================
 * 2026-10-16 审查 F2：`onOpen` 发出 `login` 包之后**什么出口都没有** ——
 * 服务端若握手成功却不回 `login`（崩了 / 卡了 / 版本不匹配），界面就永久停在
 * "正在进入江湖……"，玩家只能刷新页面。
 *
 * ★ 与 `reconnect.ts` 同一取向：把**可测的部分**（arm / disarm / 超时回调）独立出来，
 *   定时器由本模块持有，`vi.useFakeTimers()` 能直接接管。
 */

/** 登录请求的超时（ms）。★ 超过它 ⇒ 判"服务端没响应"，而不是继续装作在等 */
export const LOGIN_TIMEOUT_MS = 10_000;

export class LoginWatchdog {
  readonly #ms: number;
  readonly #onTimeout: () => void;
  #timer: ReturnType<typeof setTimeout> | null = null;

  public constructor(ms: number, onTimeout: () => void) {
    this.#ms = ms;
    this.#onTimeout = onTimeout;
  }

  /**
   * 开始盯表。**重复调用会重置计时**（重连后重新发 login 时需要的语义）——
   * 旧计时器必须先清掉，否则上一轮的超时会在新一轮中途炸出来。
   */
  public arm(): void {
    this.disarm();
    this.#timer = setTimeout(() => {
      this.#timer = null;
      this.#onTimeout();
    }, this.#ms);
  }

  /** 有结果了（`login` / `loginerror` / 断线）⇒ 停表 */
  public disarm(): void {
    if (this.#timer === null) return;
    clearTimeout(this.#timer);
    this.#timer = null;
  }

  /** 是否正在盯表（测试用） */
  public get armed(): boolean {
    return this.#timer !== null;
  }
}

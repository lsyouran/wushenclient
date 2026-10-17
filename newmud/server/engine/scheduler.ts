/**
 * server/engine/scheduler.ts — 到期回调调度器（本项目的**第一处周期心跳**）
 * ============================================================================
 * 对照 wushen `os/world.js:122` 的 `setInterval(WORLD.heart_beat, HEARTBEAT)`
 * 与 `os/char/chara.js` 的 `call_out(cb, delay)`（战斗的 `auto_attack` 靠它自续期）。
 *
 * ★ 为什么必须有它（26 册 S11 那句"项目还没有周期性的心跳调度器"说的就是这里）：
 *   此前本项目**没有任何周期调度** —— 网络层只有 `ws-server.ts` 里两个清理定时器
 *   （`pruneIdle` / `pruneRateLimit`），引擎层一处"到点了跑一段"都没有。
 *   于是"战斗出招"这类**有时间轴**的玩法完全落不了地：
 *   `Character.busy` 的 TTL 到期、`auto_attack` 的下一拍，都只能靠"下一条指令顺带清"。
 *
 * ★ 两件东西**刻意分开**（与 `hub.now` 同一条纪律）：
 *   ① **纯逻辑**（本文件）：一张"到点回调"表 + `step(nowMs)`。
 *      `step` 不睡、不碰 socket、不持有真实时钟 —— 测试直接 `step(t)` 推进时间，
 *      不必真等 4 秒（战斗间隔是 `attackSpeed`，动辄数千毫秒）。
 *   ② **外壳**（`server/main.ts`）：一个 `setInterval(() => scheduler.step(), TICK_MS)`。
 *      真实时间只由它注入。于是"调度逻辑"与"真实时钟"的耦合面**只有一行**。
 *
 * ★ 与 wushen `call_out` 的差异（都为了可复现）：
 *   - wushen 每次 `call_out` 拿一个 handle、回调里再 `call_out` 续期；本文件的
 *     `schedule` 同形态，**另加** `every`（周期任务；NPC 心跳回血用它）。
 *     这个"回调里再排下一次"的写法是**刻意保留**的 —— 战斗的下一拍取决于
 *     `attackSpeed`（可能随状态变），做成固定 `every` 会读不到最新值。
 *   - wushen 真用 `setTimeout`，同刻到期的多个任务**顺序不可复现**（取决于定时器
 *     到期先后）。本文件 `step` 由调用方驱动 ⇒ 同刻任务按 **(atMs, 注册序)** 确定排序。
 *
 * ★ 回调抛错的边界（照 `hub.inbound` 的纪律）：一个战斗回调抛错**不该**中断
 *   本次 step 里其它任务，也不该静默。逐个 `try/catch` + `onError`（缺省写 stderr）。
 */

export class SchedulerError extends Error {
  public override readonly name = 'SchedulerError';
}

/** 任务句柄（`cancel` 用）。自增整数，同进程唯一 */
export type TaskHandle = number;

interface ScheduledTask {
  readonly id: TaskHandle;
  /** 到期时刻（绝对毫秒） */
  atMs: number;
  readonly cb: () => void;
  /** `null` = 一次性；否则每隔这么多毫秒重排一次 */
  readonly intervalMs: number | null;
}

export interface SchedulerOptions {
  /** 可注入时钟（测试用）。缺省 `Date.now` */
  readonly now?: () => number;
  /** 任务抛错时的观察口。缺省写 stderr（"异常可以不致命，但不许静默"） */
  readonly onError?: (error: unknown, handle: TaskHandle) => void;
  /**
   * 单次 `step` 最多执行多少任务（防死循环的**保险丝**）。
   *
   * ★ 什么情况下咬得住：一个回调在**同一次 step 内**被反复触发是做不到的
   *   （`step` 先对到期表取快照，回调内新排的任务不在本批），但一个"连环"
   *   场景仍可能让单批很大 —— 例如一万个 NPC 同时到期。这道上限让单 tick
   *   的开销有界，剩下的留到下一 tick，而不是卡死事件循环。
   */
  readonly maxTasksPerStep?: number;
}

export const DEFAULT_MAX_TASKS_PER_STEP = 10_000;

function defaultOnError(error: unknown, handle: TaskHandle): void {
  let detail: string;
  try {
    detail = error instanceof Error ? (error.stack ?? error.message) : String(error);
  } catch {
    detail = '<无法序列化的错误>';
  }
  process.stderr.write(`[scheduler] 任务 ${handle} 抛出异常（本次 step 其它任务不受影响）：${detail}\n`);
}

export class Scheduler {
  readonly #tasks = new Map<TaskHandle, ScheduledTask>();
  readonly #now: () => number;
  readonly #onError: (error: unknown, handle: TaskHandle) => void;
  readonly #maxTasksPerStep: number;
  #nextId = 1;

  public constructor(options: SchedulerOptions = {}) {
    this.#now = options.now ?? (() => Date.now());
    this.#onError = options.onError ?? defaultOnError;
    this.#maxTasksPerStep = options.maxTasksPerStep ?? DEFAULT_MAX_TASKS_PER_STEP;
  }

  /** 当前未取消的任务数（诊断用；`0` = 没有人在等任何事） */
  public get size(): number {
    return this.#tasks.size;
  }

  /**
   * 当前时刻（读注入的时钟）。
   * ★ 角色排战斗节拍时用它对齐"忙乱剩余"等时间量 —— 若角色各自 `Date.now()`，
   *   测试注入的假时钟就管不到那段逻辑（同一份代码在生产与测试下读两个时间源）。
   */
  public now(): number {
    return this.#now();
  }

  /** 从现在起 `delayMs` 毫秒后跑一次 `cb`。返回句柄（可用 `cancel` 取消） */
  public schedule(delayMs: number, cb: () => void): TaskHandle {
    return this.#add(delayMs, cb, null);
  }

  /**
   * 从现在起每隔 `intervalMs` 毫秒跑一次 `cb`（首次在 `intervalMs` 之后）。
   * 用于 NPC 心跳回血这类**固定周期**的事；战斗的补排请用 `schedule`。
   */
  public every(intervalMs: number, cb: () => void): TaskHandle {
    return this.#add(intervalMs, cb, intervalMs);
  }

  #add(delayMs: number, cb: () => void, intervalMs: number | null): TaskHandle {
    if (!Number.isFinite(delayMs) || delayMs < 0) {
      throw new SchedulerError(`调度延迟必须是 ≥0 的有限毫秒数，收到 ${String(delayMs)}`);
    }
    const id = this.#nextId;
    this.#nextId += 1;
    this.#tasks.set(id, { id, atMs: this.#now() + delayMs, cb, intervalMs });
    return id;
  }

  /** 取消一个任务。已到期跑过 / 已取消的返回 `false` */
  public cancel(handle: TaskHandle): boolean {
    return this.#tasks.delete(handle);
  }

  /**
   * 推进到 `nowMs`：跑掉所有 `atMs <= nowMs` 的任务，返回执行个数。
   *
   * ★ 先取**快照**再执行：回调里新排的任务（无论延迟多小）都落在**下一次** step。
   *   这是"一次 step 不会自己喂自己"的保证，也是 `maxTasksPerStep` 之外的第一道闸。
   * ★ 周期任务（`every`）按 `nowMs + intervalMs` 重排，**不补跑**历史欠账
   *   （一次 step 落后很多时，只触发一次、从"现在"重新起算）。
   */
  public step(nowMs: number = this.#now()): number {
    const due = [...this.#tasks.values()].filter((t) => t.atMs <= nowMs);
    if (due.length === 0) return 0;
    // 同刻按注册序（id 自增），保证"同一输入 → 同一顺序"
    due.sort((a, b) => a.atMs - b.atMs || a.id - b.id);
    let ran = 0;
    for (const task of due) {
      if (ran >= this.#maxTasksPerStep) break;
      // 可能已被本批前一个回调 cancel 掉
      if (!this.#tasks.has(task.id)) continue;
      if (task.intervalMs === null) this.#tasks.delete(task.id);
      else task.atMs = nowMs + task.intervalMs;
      ran += 1;
      try {
        task.cb();
      } catch (error) {
        this.#report(error, task.id);
      }
    }
    return ran;
  }

  /** 清空全部任务（关闭服务时用） */
  public clear(): void {
    this.#tasks.clear();
  }

  #report(error: unknown, handle: TaskHandle): void {
    try {
      this.#onError(error, handle);
    } catch {
      // 观察者的错不该再次打穿调度循环
    }
  }
}

/**
 * server/engine/temp.ts — 带 TTL 的临时数据容器
 * ============================================================================
 * 取代 wushen `os/char/chara_prop.js:30-62` 的 `set_temp / query_temp / add_temp`。
 * 08 册 §8.7 把它列为"值得抄"的第 2 条：BUFF、冷却、任务进度全用它，
 * 于是**没有任何一处需要自己写清理逻辑**。
 *
 * ★ 但要先把 wushen 的语义坑钉死（否则抄过来的是坑）：
 *
 *   1. **`temp[name] = time ? {v, e} : value`** —— 有 TTL 存包装对象、无 TTL 存裸值。
 *      于是 `query_temp` 必须先判"这是不是包装对象"，而用户存进去的东西
 *      **恰好长成 `{v, e}` 形状**时就会被误判成过期记录。
 *      本实现改为**统一包装**：永远存 `{v, e}`，`e === NEVER_EXPIRES` 表示永不过期。
 *      存储形状不再依赖"值是什么"，判据只剩 `e`。
 *
 *   2. **时间源不可注入** —— `Date.now()` 直接写死在函数体里，
 *      于是"5 秒后过期"这件事**没法在单测里验证**，只能靠 sleep。
 *      本实现把 `nowMs` 作为显式参数（默认 `Date.now()`）。
 *
 *   3. **不校验数值** —— `add_temp('busy', '5')` 会得到 `'05'`（字符串），
 *      与 `props.ts` 里那次实测是同一类病。这里抛 `TempValueError`。
 */

import { describeValue, isPlainRecord } from './load-report.js';
import type { LoadReport, RejectedEntry } from './load-report.js';

export const NEVER_EXPIRES = 0;

export class TempValueError extends Error {
  public override readonly name = 'TempValueError';
}

export interface TempRecord {
  readonly v: unknown;
  /** 过期时刻（ms 时间戳）；`NEVER_EXPIRES` = 永不过期 */
  readonly e: number;
}

function assertTtl(ttlMs: number, op: string, name: string): void {
  if (!Number.isFinite(ttlMs) || ttlMs < 0) {
    throw new TempValueError(
      `${op}("${name}") 的 ttl 必须是非负有限数值（ms），收到 ${describeValue(ttlMs)}`,
    );
  }
}

export class TempStore {
  readonly #records = new Map<string, TempRecord>();

  /** 仍在跟踪的键数（含未过期与永不过期）；用于观测 `pruneTemp` 是否有效 */
  public get size(): number {
    return this.#records.size;
  }

  public setTemp(
    name: string,
    value: unknown,
    ttlMs: number = NEVER_EXPIRES,
    nowMs: number = Date.now(),
  ): void {
    assertTtl(ttlMs, 'setTemp', name);
    this.#records.set(name, { v: value, e: ttlMs === NEVER_EXPIRES ? NEVER_EXPIRES : nowMs + ttlMs });
  }

  /** 读。过期即删除并返回 fallback（**顺带清理**，不依赖调用方 remember prune） */
  public queryTemp<T = unknown>(
    name: string,
    fallback?: T,
    nowMs: number = Date.now(),
  ): T | undefined {
    const rec = this.#records.get(name);
    if (rec === undefined) return fallback;
    if (rec.e !== NEVER_EXPIRES && rec.e <= nowMs) {
      this.#records.delete(name);
      return fallback;
    }
    return rec.v as T;
  }

  /**
   * 该键是否**正在被跟踪**（未过期）。
   *
   * ★ 不能实现成 `queryTemp(name) !== undefined`：那样"键存在、值是 undefined"
   *   会被误报成不存在 —— 与 wushen "`query_prop` 返回 0 时分不清『没写过』与
   *   『就是 0』"是同一类病（见 props.ts 的 `hasProp`）。
   *   判据只看**记录在不在、过没过期**，与值本身无关。
   */
  public hasTemp(name: string, nowMs: number = Date.now()): boolean {
    const rec = this.#records.get(name);
    if (rec === undefined) return false;
    if (rec.e !== NEVER_EXPIRES && rec.e <= nowMs) {
      this.#records.delete(name); // 顺带清理，与 queryTemp 一致
      return false;
    }
    return true;
  }

  /**
   * 距过期还剩多少 ms。
   * 不存在或已过期 → `0`；永不过期 → `Infinity`。
   * ★ 这是 TTL 真正被**消费**的地方（`Character.busyRemainingMs`）——
   *   否则 TTL 只是"存了不用"的装饰。
   */
  public ttlRemainingMs(name: string, nowMs: number = Date.now()): number {
    const rec = this.#records.get(name);
    if (rec === undefined) return 0;
    if (rec.e === NEVER_EXPIRES) return Number.POSITIVE_INFINITY;
    return rec.e <= nowMs ? 0 : rec.e - nowMs;
  }

  /**
   * 累加（对应 `add_temp`）。返回累加后的新值。
   * 原值不是有限数值时**抛错**而不是当作 0 —— wushen 那样做会把一个拼错的键
   * 悄悄变成一个计数器，事后无法区分"本来就是 0"与"读错了键"。
   */
  public addTemp(
    name: string,
    delta: number,
    ttlMs: number = NEVER_EXPIRES,
    nowMs: number = Date.now(),
  ): number {
    if (typeof delta !== 'number' || !Number.isFinite(delta)) {
      throw new TempValueError(`addTemp("${name}") 的增量必须是有限数值，收到 ${describeValue(delta)}`);
    }
    const current = this.queryTemp<number>(name, undefined, nowMs);
    if (current !== undefined && (typeof current !== 'number' || !Number.isFinite(current))) {
      throw new TempValueError(
        `addTemp("${name}") 的原值不是有限数值（${describeValue(current)}），拒绝累加`,
      );
    }
    const next = (current ?? 0) + delta;
    this.setTemp(name, next, ttlMs, nowMs);
    return next;
  }

  public removeTemp(name: string): boolean {
    return this.#records.delete(name);
  }

  public clearTemp(): void {
    this.#records.clear();
  }

  /** 清掉所有已过期的键，返回清掉的个数。长时间运行的进程应周期性调用 */
  public pruneTemp(nowMs: number = Date.now()): number {
    let removed = 0;
    for (const [name, rec] of this.#records) {
      if (rec.e !== NEVER_EXPIRES && rec.e <= nowMs) {
        this.#records.delete(name);
        removed += 1;
      }
    }
    return removed;
  }

  /**
   * 导出**未过期**的值（存档边界）。
   * 过期项不写进存档 —— 否则读档回来会带着一堆早已失效的 BUFF。
   */
  public snapshotTemp(nowMs: number = Date.now()): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [name, rec] of this.#records) {
      if (rec.e !== NEVER_EXPIRES && rec.e <= nowMs) continue;
      out[name] = rec.v;
    }
    return out;
  }

  /**
   * 从**不可信**数据装载（存档）。语义是**合并**，不先清空。
   * 与 `props.ts` 的 `loadProps` **同一契约**（`load-report.ts`）：分级 ——
   * 容器种类不对（数组 / `null` / 标量）⇒ **抛**；条目级异常 ⇒ **丢该条 + 记账**。
   *
   * ★ 本容器**刻意不做键白名单**：`temp` 就是自由键值袋（BUFF / 冷却 / 任务进度），
   *   不存在"合法的键"这一说。于是这里能判的只有两件事：
   *     ① 键名不能是**空串**——空串键读的时候谁也取不到，必是脏数据；
   *     ② 数值必须**有限**——`NaN` / `Infinity` 进表会污染之后的 `addTemp`
   *        与一切算术（与 `addTemp` 的抛错取向同源）。
   *   值的类型仍不限制：这正是统一 `{v,e}` 包装换来的 —— 判语义只看 `e`，不看值长什么样。
   */
  public loadTemp(raw: unknown, nowMs: number = Date.now()): LoadReport {
    if (!isPlainRecord(raw)) {
      throw new TempValueError(`loadTemp 需要对象，收到 ${describeValue(raw)}`);
    }
    const rejected: RejectedEntry[] = [];
    let loaded = 0;
    for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
      if (name === '') {
        rejected.push({ key: '(空键名)', reason: '键名不能为空串（读了也取不到）' });
        continue;
      }
      if (typeof value === 'number' && !Number.isFinite(value)) {
        rejected.push({ key: name, reason: `数值必须是有限数，收到 ${describeValue(value)}` });
        continue;
      }
      this.setTemp(name, value, NEVER_EXPIRES, nowMs);
      loaded += 1;
    }
    return { loaded, rejected };
  }
}

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

/**
 * TTL 的**上界**（S12，2026-10-16 审查）—— 不是业务限制，而是"过期时刻必须是
 * **可表示且可比较的有限数**"。`nowMs + ttlMs` 一旦越过可表示范围，"到期时刻"这个概念
 * 就失效了；而即便结果仍是有限数（如 `MAX_VALUE`），`ttlRemainingMs` 也恒为正
 * ⇒ busy 实际**永不结束**（除 `clearBusy()` 外无解），且不报任何错。
 *
 * 取 `MAX_SAFE_INTEGER`：任何"真实用得到的 TTL"（BUFF / 冷却 / busy）都远小于它，
 * 而它加上一个正常时间戳仍是有限数。真正的语义上界应由**业务**决定，这里只兜底。
 */
export const MAX_TTL_MS = Number.MAX_SAFE_INTEGER;

export class TempValueError extends Error {
  public override readonly name = 'TempValueError';
}

export interface TempRecord {
  readonly v: unknown;
  /** 过期时刻（ms 时间戳）；`NEVER_EXPIRES` = 永不过期 */
  readonly e: number;
}

/**
 * 存档里**一条** temp 的形状 —— 与 `TempRecord` 同构，且**带上过期时刻**。
 *
 * ★ 为什么必须带 `e`（2026-10-16 审查 S4）：
 *   这道边界原先只导**值**（`{ name: value }`），读回时一律判为 `NEVER_EXPIRES`。
 *   于是"存档 → 读档"一次，所有带 TTL 的记录全部变成**永不过期**，而同一个
 *   `Infinity` 在两条读路径上给出**相反结论**：
 *
 *     Character.isBusy()        = ttlRemainingMs(busy) > 0  → Infinity 通过 ⇒ **永久 busy**
 *     SkillBook.pfmCooldownMs() = isFinite(left) ? left : 0 → Infinity 钳成 0 ⇒ **冷却永久失效**
 *
 *   ⇒ 一个角色只要"在忙的时候被存档"，读档后所有指令被永久拒绝；
 *     绝招冷却则反过来永久失效、可无限连放。两边都不报错，最难查的那一种。
 *
 * ★ `e` 是**绝对时刻**而不是"剩余毫秒"：离线期间过期的 BUFF 在读档时就该失效，
 *   按剩余毫秒存会让"关服三天再上来"的角色带着一堆本该消失的加成。
 */

function assertTtl(ttlMs: number, op: string, name: string): void {
  if (!Number.isFinite(ttlMs) || ttlMs < 0) {
    throw new TempValueError(
      `${op}("${name}") 的 ttl 必须是非负有限数值（ms），收到 ${describeValue(ttlMs)}`,
    );
  }
  // ★ 上界（S12）：见 `MAX_TTL_MS` 的说明 —— 拒绝"过期时刻越出可表示范围 / 实际永不结束"。
  if (ttlMs > MAX_TTL_MS) {
    throw new TempValueError(
      `${op}("${name}") 的 ttl 超出上界（上限 ${String(MAX_TTL_MS)} ms），收到 ${describeValue(ttlMs)}`,
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
   *
   * ★ **到点即清**（S11，2026-10-16 审查）：本方法是 `Character.isBusy()` 与
   *   `SkillBook.pfmCooldownMs()` 的**唯一**读路径，而 `queryTemp` / `hasTemp`
   *   早就写明了"顺带清理"。原先这里只返回 0、不删 —— 叠加 `loadTemp` 的**合并**
   *   语义，长生命周期角色的 `#records` 会单调增长（读一次留一条）。
   */
  public ttlRemainingMs(name: string, nowMs: number = Date.now()): number {
    const rec = this.#records.get(name);
    if (rec === undefined) return 0;
    if (rec.e === NEVER_EXPIRES) return Number.POSITIVE_INFINITY;
    if (rec.e <= nowMs) {
      this.#records.delete(name);
      return 0;
    }
    return rec.e - nowMs;
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
   * 导出**未过期**的项（存档边界）。过期项不写进存档 —— 否则读档回来会带着一堆早已失效的 BUFF。
   *
   * ★ 导出的是 `{v, e}` 而不只是 `v`（S4）：过期时刻是这条记录的一部分，
   *   丢掉它就等于"读档后一切永不过期"。见 `TempSnapshotEntry` 的注释。
   */
  public snapshotTemp(nowMs: number = Date.now()): Record<string, TempRecord> {
    const out: Record<string, TempRecord> = {};
    for (const [name, rec] of this.#records) {
      if (rec.e !== NEVER_EXPIRES && rec.e <= nowMs) continue;
      out[name] = { v: rec.v, e: rec.e };
    }
    return out;
  }

  /**
   * 从**不可信**数据装载（存档）。语义是**合并**，不先清空。
   * 与 `props.ts` 的 `loadProps` **同一契约**（`load-report.ts`）：分级 ——
   * 容器种类不对（数组 / `null` / 标量）⇒ **抛**；条目级异常 ⇒ **丢该条 + 记账**。
   *
   * 期望形状 = `snapshotTemp()` 的输出：`{ [name]: { v, e } }`，
   *   `e` = 绝对过期时刻，`NEVER_EXPIRES`(0) = 永不过期。
   *
   * ★ 本容器**刻意不做键白名单**：`temp` 就是自由键值袋（BUFF / 冷却 / 任务进度），
   *   不存在"合法的键"这一说。于是这里能判的只有三件事：
   *     ① 键名不能是**空串**——空串键读的时候谁也取不到，必是脏数据；
   *     ② 每一项必须是 `{v, e}` **记录**——裸值（旧格式 / 手改的档）一律拒收；
   *     ③ 过期时刻 `e` 必须是**有限数值**——`NaN` / `Infinity` 进表会污染之后的
   *        一切算术（与 `addTemp` 的抛错取向同源）。
   *   值 `v` 的类型仍不限制：这正是统一 `{v,e}` 包装换来的 —— 判语义只看 `e`，不看值长什么样。
   *
   * ★★ **"读档时已经过期"不算坏数据**（S4）：那是正常业务（离线期间到点了），
   *   **丢弃且不记账** —— 若记进 `rejected`，调用方按契约③（"rejected 非空即读档失败"）
   *   会把"关服三天再上线"判成读档失败，那是把正常情形误报成事故。
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
      if (!isPlainRecord(value)) {
        rejected.push({
          key: name,
          reason: `必须是 {v, e} 记录，收到 ${describeValue(value)}`,
        });
        continue;
      }
      const fields = value as Record<string, unknown>;
      const e = fields['e'];
      if (typeof e !== 'number' || !Number.isFinite(e)) {
        rejected.push({
          key: name,
          reason: `过期时刻 e 必须是有限数值，收到 ${describeValue(e)}`,
        });
        continue;
      }
      // ★ 已过期 ⇒ 静默丢弃（不是脏数据，见上面的说明）
      if (e !== NEVER_EXPIRES && e <= nowMs) continue;

      const v = fields['v'];
      if (typeof v === 'number' && !Number.isFinite(v)) {
        rejected.push({ key: name, reason: `数值必须是有限数，收到 ${describeValue(v)}` });
        continue;
      }
      this.#records.set(name, { v, e });
      loaded += 1;
    }
    return { loaded, rejected };
  }
}

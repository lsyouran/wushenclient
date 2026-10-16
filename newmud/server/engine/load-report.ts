/**
 * server/engine/load-report.ts — 「从不可信数据装载」的统一契约
 * ============================================================================
 * 存档 / 协议 / 热更送进来的东西**一律不可信**。引擎里有三对「取快照 / 装回去」：
 *
 *   `props.ts`   `snapshotProps()` / `loadProps()`
 *   `temp.ts`    `snapshotTemp()`  / `loadTemp()`
 *   `skill.ts`   `snapshot()`      / `load()`
 *
 * 本文件是它们**共用的那一半**：报告的形状 + 两条判定原语。放这里而不是各自复制，
 * 是因为「读档要不要拒绝、拒到哪一档」只有一种答案 —— 复制三份必然分家
 * （24 册铁律 4：单源真相；E3 的成因正是三处口径各写各的）。
 *
 * ── 契约（E3 裁定：**分级**，26 册 §40）──────────────────────────────────
 *
 *   ① **结构性损坏 ⇒ 抛异常**：**容器种类**不对 —— 该给对象的给了 `null` /
 *      数组 / 标量，该给数组的给了非数组。这不是"某一条脏"，是"整包根本不是存档"。
 *      若按"成功地装了 0 条"静默处理，调用方**永远发现不了自己传错了形状**
 *      （`typeof [] === 'object'` 让空数组成为最坏的一种：装 0 条且不报错）。
 *
 *   ② **条目级异常 ⇒ 丢该条 + 记账**：不认识的键 / 非法值 / 非法装配槽。
 *      **为什么偏偏不在这里整包抛**：存档里多出一个"更新版本才认识的键"是
 *      **版本回滚的正常场景** —— 整包抛会让回滚后的**全体**角色打不开（不可逆、
 *      且玩家只会认为"服务器坏了"）；丢一条只是少一个值（可逆、可补）。
 *      ★ 但"条目级"里对**安全**有实质影响的那几条（如技能越权装槽）也走这一档，
 *        靠 ③ 兜住 —— 丢掉的条目必定进 `rejected`，调用方看得见。
 *
 *   ②′ **正常过期 ⇒ 丢该条 + 不记账**（S4，26 册 §44）：读档时记录已到点
 *      （`e <= now`）属于**正常业务**（离线期间 TTL 到了），**不是坏数据**。
 *      丢弃即可，**绝不进 `rejected`** —— 若记进去，调用方按 ③ 会把"离线到期"
 *      误判成"读档失败"，全体角色离线一次就登不上。★ 与 ② 的分界：
 *      **② 是"数据写坏了"，②′ 是"数据本来就会到点"**。当前唯一生产方
 *      `temp.ts#loadTemp` 落实此档（`server/engine/temp.ts` 注释同源）。
 *
 *   ③ **调用方义务**：`rejected` **非空即视为读档失败**（至少记审计日志 +
 *      拒绝登录）。否则 ② 就退化成"静默放行" —— 那正是 wushen 的形态
 *      （`os/char/user.js:188` 把存档字段**直接赋给实例**，类型与范围一概不问）。
 *      ★ 这条由 T12 的存档装载器落实，见 28 册 §28.5.4。
 */

/**
 * 被拒收的一条。`key` 用**点号定位到具体字段**（`prop.gj` / `wd/both.enabled`），
 * 不要只写一个顶层名字 —— 否则调用方无法告诉玩家/运维"到底哪一条坏了"。
 */
export interface RejectedEntry {
  readonly key: string;
  readonly reason: string;
}

/**
 * 装载报告（三处共用，形状刻意保持最小）：
 *   - `loaded`：真正装进去的条数
 *   - `rejected`：被拒收的条目及理由；**空数组 = 干净**（③ 的判据就是它）
 *
 * ★ 不设 `ok: boolean` —— 那会多一个可能与 `rejected.length === 0` 不一致的字段。
 */
export interface LoadReport {
  readonly loaded: number;
  readonly rejected: readonly RejectedEntry[];
}

/**
 * 「是不是一个普通对象」—— 三个模块共用的**唯一**谓词。
 *
 * ★ 数组必须显式排除：`typeof [] === 'object'`，不排除就会把数组当合法容器，
 *   而 `Object.entries([])` 是空的 ⇒ "成功地装了 0 条"，形状错误被静默吃掉（26 册 §25）。
 */
export function isPlainRecord(v: unknown): boolean {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * 把任意值写成"人能读的"短描述（错误信息用）。
 *
 * ★ 数组分支必须**先于** `typeof` 兜底：漏了它，报错会写成"收到 object"，
 *   读的人看不出自己给的是一个数组 —— 而数组恰恰是最常传错的那一种。
 */
export function describeValue(v: unknown): string {
  if (typeof v === 'string') return `字符串 ${JSON.stringify(v)}`;
  if (typeof v === 'number') return Number.isNaN(v) ? 'NaN' : String(v);
  if (v === null) return 'null';
  if (v === undefined) return 'undefined';
  if (Array.isArray(v)) return '数组';
  return typeof v;
}

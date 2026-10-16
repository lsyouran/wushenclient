/**
 * server/engine/temp.ts —— 带 TTL 的临时数据容器
 * ============================================================================
 * 取代 wushen `os/char/chara_prop.js:30-62` 的 set_temp / query_temp / add_temp。
 * 这里钉住的正是 wushen 那三个语义坑（见 temp.ts 顶部注释）：
 *   1. `temp[name] = time ? {v,e} : value` —— 存进去的值恰好长成 {v,e} 会被误判
 *   2. 时间源不可注入 —— "5 秒后过期"没法单测
 *   3. 不校验数值 —— add_temp('k', '5') 得到 '05'
 */
import { describe, expect, it } from 'vitest';

import { BUSY_MAX_MS, RecordingOutput } from '../server/engine/character.js';
import { Player } from '../server/engine/player.js';
import { NEVER_EXPIRES, MAX_TTL_MS, TempStore, TempValueError } from '../server/engine/temp.js';

// ---------------------------------------------------------------------------
// S4（2026-10-16 审查）：TTL 必须跟着存档走
// ---------------------------------------------------------------------------
//
// ★ 症状：`snapshotTemp()` 只导出**值**、丢掉过期时刻 `e`；`loadTemp()` 对被装载的
//   每一项一律 `NEVER_EXPIRES`。于是"存档 → 读档"一次，所有带 TTL 的记录全部变成
//   **永不过期**，而同一个 `Infinity` 在两条读路径上给出**相反结论**：
//
//     Character.isBusy()         = ttlRemainingMs(busy) > 0            → Infinity 通过 ⇒ 永久 busy
//     SkillBook.pfmCooldownMs()  = isFinite(left) ? left : 0            → Infinity 钳成 0 ⇒ 冷却永久失效
//
//   ⇒ 一个角色只要"在忙的时候被存档"，读档后所有指令被永久拒绝；
//     绝招冷却则反过来永久失效、可无限连放。
//
// ★ 判据为什么钉在 `ttlRemainingMs` 的**具体数值**上（而不是"是不是 Infinity"）：
//   只断言"不是 Infinity"会被另一种错误实现满足 —— 比如把 TTL 存成"剩余毫秒"
//   却按绝对时刻解释，数字仍有限，但到期时间完全错位。⇒ 必须对同一个 `nowMs`
//   断言**精确的剩余毫秒**，且覆盖"到期那一刻"。
//
describe('S4 · temp 的 TTL 必须跟着存档走', () => {
  it('往返保持 TTL：读档回来剩余时间与存档时一致（不是 Infinity）', () => {
    const before = new TempStore();
    before.setTemp('busy', true, 5_000, 1_000); // 到期时刻 = 6000

    const after = new TempStore();
    after.loadTemp(before.snapshotTemp(1_000), 1_000);

    expect(after.ttlRemainingMs('busy', 1_000)).toBe(5_000);
  });

  it('★ 读档回来的 busy 到点就过期（旧实现会永久 busy）', () => {
    const before = new TempStore();
    before.setTemp('busy', true, 5_000, 1_000);

    const after = new TempStore();
    after.loadTemp(before.snapshotTemp(1_000), 1_000);

    // 到期时刻 6000：中途还剩 3 秒，到点归零（旧实现两端都是 Infinity）
    expect(after.ttlRemainingMs('busy', 3_000)).toBe(3_000);
    expect(after.ttlRemainingMs('busy', 6_000)).toBe(0); // ← 旧实现这里是 Infinity
  });

  it('离线期间过期的项，读档时不装载 —— 且**不算** rejected（契约③不该误报）', () => {
    const before = new TempStore();
    before.setTemp('buff', 'v', 1_000, 0); // 到期时刻 = 1000

    const after = new TempStore();
    const report = after.loadTemp(before.snapshotTemp(0), 5_000);

    expect(report.loaded).toBe(0);
    // ★ 过期是正常业务，不是"数据坏了" ⇒ 进 rejected 会让调用方误判读档失败
    expect(report.rejected).toEqual([]);
    expect(after.hasTemp('buff', 5_000)).toBe(false);
  });

  it('裸值形状（旧存档格式 / 手改的档）被拒收并记账', () => {
    const t = new TempStore();
    const report = t.loadTemp({ busy: true }, 0);

    expect(report.loaded).toBe(0);
    expect(report.rejected.map((r) => r.key)).toEqual(['busy']);
    expect(t.hasTemp('busy', 0)).toBe(false);
  });

  it('过期时刻不是有限数值 ⇒ 拒收并记账（NaN 会污染之后所有算术）', () => {
    const t = new TempStore();
    const report = t.loadTemp({ x: { v: 1, e: Number.NaN } }, 0);

    expect(report.loaded).toBe(0);
    expect(report.rejected.map((r) => r.key)).toEqual(['x']);
  });

  it('【反向锚点】永不过期的项往返后**仍是**永不过期', () => {
    const before = new TempStore();
    before.setTemp('flag', 1, NEVER_EXPIRES, 0);

    const after = new TempStore();
    after.loadTemp(before.snapshotTemp(0), 0);

    expect(after.ttlRemainingMs('flag', 1e12)).toBe(Number.POSITIVE_INFINITY);
  });

  it('★ 永不过期的 busy 不得让 `isBusy` 与 `busyRemainingMs` 给出相反答案', () => {
    const p = new Player({
      oid: 'oid-s4',
      path: null,
      roleId: 's4',
      name: 's4',
      output: new RecordingOutput(),
    });
    // 直接造一条"永不过期"的 busy（内容层 `setTemp('busy', …)` 不传 ttl 时就是这个形态）
    p.temp.setTemp('busy', true, NEVER_EXPIRES, 0);

    // 旧实现：isBusy === true（Infinity > 0）而 busyRemainingMs === 0（Infinity 被钳成 0）
    // ⇒ 面板显示"还需 0 毫秒"，指令闸门却永远拦着
    expect(p.isBusy(0)).toBe(p.busyRemainingMs(0) > 0);
  });

  it('【反向锚点】正常的 busy 到点就解除（别把"不忙"修成永不 busy）', () => {
    const p = new Player({
      oid: 'oid-s4b',
      path: null,
      roleId: 's4b',
      name: 's4b',
      output: new RecordingOutput(),
    });
    p.setBusy(5_000, 1_000);

    expect(p.isBusy(1_000)).toBe(true);
    expect(p.isBusy(6_000)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// S12（2026-10-16 审查）：`ttl` 无上界 ⇒ 可造出"永不结束"的 busy / 过期时刻溢出
// ---------------------------------------------------------------------------
//
// ★ 实测澄清：`nowMs + Number.MAX_VALUE` 在真实时间戳下**是有限值**（= MAX_VALUE），
//   并不变成 `Infinity`（要 `MAX + MAX` 才溢出）。但危害照样成立：
//   `ttlRemainingMs = MAX_VALUE - now` 仍 > 0 ⇒ `isBusy()` **恒 true**，
//   这个"僵直"实际永不结束，除 `clearBusy()` 外无解。
//   ⇒ 在 TTL 入口设上界拒收：不是业务限制，是"保证过期时刻仍是可表示、可比较的有限数"。
describe('S12 · TTL 上界（不许静默变成"永不结束"）', () => {
  it('ttl 超出上界 ⇒ 抛（MAX_VALUE 会让 busy 实际永不结束）', () => {
    const t = new TempStore();
    expect(() => t.setTemp('k', 1, Number.MAX_VALUE, 0)).toThrow(TempValueError);
    expect(() => t.setTemp('k', 1, MAX_TTL_MS + 1, 0)).toThrow(TempValueError);
  });

  it('【反向锚点】正好在上界容许（别把合法的长 TTL 误伤）', () => {
    const t = new TempStore();
    expect(() => t.setTemp('k', 1, MAX_TTL_MS, 0)).not.toThrow();
    expect(t.ttlRemainingMs('k', 0)).toBe(MAX_TTL_MS);
  });

  it('★ setBusy 的超长时长不再能造出"永不结束"的 busy（E5 后钳到 15s 上界）', () => {
    const p = new Player({
      oid: 'oid-s12',
      path: null,
      roleId: 's12',
      name: 's12',
      output: new RecordingOutput(),
    });
    p.setBusy(Number.MAX_VALUE, 0);
    // 无论要多长，实际只会忙 `BUSY_MAX_MS`；到点即解除（旧实现是"永不结束"）
    expect(p.busyRemainingMs(0)).toBe(BUSY_MAX_MS);
    expect(p.isBusy(BUSY_MAX_MS)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// E5（2026-10-16 拍板）：`busy` 是**动作锁** —— `setBusy` 赋值 / `addBusy` 叠加，
//      两条路都受 `BUSY_MAX_MS`(15s) 硬上界约束
// ---------------------------------------------------------------------------
//
// ★ 为什么 `setBusy` 必须是**赋值**：wushen 原作就是赋值 ——
//   `os/char/chara_skill.js:367` `this.is_busy = buff.duration`、`:382` `this.is_busy = 0`，
//   `world/map/wudao/ta.js:98` `me.is_busy = 1000`。
//   旧实现是"在剩余时间上叠加"，症状是**重复触发无限延长** ——
//   一个每帧重新赋 `duration` 的定身 buff，在本项目会一次比一次久（直到撞上界），
//   而原作每次都回到 `duration`。要点是"重设"和"延长"必须是**两个**方法。
//
// ★ 15s 上界是**硬**的：任何来源（技能 buff / 地图事件 / 内容脚本）都不超过它。
//   需要"更久不能动"的内容请用 `state`（状态系统），别把 busy 当第二套状态用。
describe('E5 · busy = 动作锁：setBusy 赋值 / addBusy 叠加 / 都受 15s 上界', () => {
  const makeBusyPlayer = (id: string): Player =>
    new Player({ oid: `oid-${id}`, path: null, roleId: id, name: id, output: new RecordingOutput() });

  it('★ setBusy 是**赋值**：再次调用直接改写剩余时间（旧实现会叠加成 13s）', () => {
    const p = makeBusyPlayer('e5a');
    p.setBusy(10_000, 1_000);
    p.setBusy(3_000, 1_000);
    expect(p.busyRemainingMs(1_000)).toBe(3_000);
  });

  it('★ addBusy 是**叠加**：在当前剩余上累加', () => {
    const p = makeBusyPlayer('e5b');
    p.setBusy(10_000, 1_000);
    p.addBusy(3_000, 1_000);
    expect(p.busyRemainingMs(1_000)).toBe(13_000);
  });

  it('★ 赋值超过上界 ⇒ 钳到 BUSY_MAX_MS（不是无限延长）', () => {
    const p = makeBusyPlayer('e5c');
    p.setBusy(60_000, 0);
    expect(p.busyRemainingMs(0)).toBe(BUSY_MAX_MS);
  });

  it('★ 叠加累积超过上界 ⇒ 同样钳到 BUSY_MAX_MS', () => {
    const p = makeBusyPlayer('e5d');
    p.setBusy(BUSY_MAX_MS, 0);
    p.addBusy(5_000, 0);
    expect(p.busyRemainingMs(0)).toBe(BUSY_MAX_MS);
  });

  it('addBusy 在**没在忙**时 = 直接设置（"没在忙"不是错误）', () => {
    const p = makeBusyPlayer('e5e');
    p.addBusy(2_000, 0);
    expect(p.busyRemainingMs(0)).toBe(2_000);
  });

  it('★ 非法时长（≤0 / NaN / Infinity）⇒ 抛，且不污染既有 busy', () => {
    const p = makeBusyPlayer('e5f');
    p.setBusy(5_000, 0);
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => p.setBusy(bad, 0), `setBusy(${String(bad)}) 该抛`).toThrow();
      expect(() => p.addBusy(bad, 0), `addBusy(${String(bad)}) 该抛`).toThrow();
    }
    // 校验先于任何写入 ⇒ 原状态分毫未动
    expect(p.busyRemainingMs(0)).toBe(5_000);
  });

  it('【反向锚点】15s 上界不误伤正常短忙乱（赋值 / 叠加精确到毫秒）', () => {
    const p = makeBusyPlayer('e5g');
    p.setBusy(1_500, 0);
    expect(p.busyRemainingMs(0)).toBe(1_500);
    p.addBusy(500, 0);
    expect(p.busyRemainingMs(0)).toBe(2_000);
    expect(p.isBusy(0)).toBe(true);
    expect(p.isBusy(2_000)).toBe(false);
  });
});

describe('engine/temp · set / query', () => {
  it('无 TTL（默认）永不过期：任意晚的时间点都能读到', () => {
    const t = new TempStore();
    t.setTemp('k', 42, NEVER_EXPIRES, 1_000);
    expect(t.queryTemp('k', undefined, 1e12)).toBe(42);
    expect(t.ttlRemainingMs('k', 1e12)).toBe(Number.POSITIVE_INFINITY);
  });

  it('★ 时间可注入：到期前有值、到期后删除并返回 fallback（不用 sleep）', () => {
    const t = new TempStore();
    t.setTemp('buff', 'x', 5_000, 10_000); // 到期时刻 = 15000
    expect(t.queryTemp('buff', 'fallback', 14_999)).toBe('x');
    expect(t.queryTemp('buff', 'fallback', 15_000)).toBe('fallback'); // e <= now 即过期
    expect(t.size).toBe(0); // 读的时候顺带清理，不依赖调用方记得 prune
  });

  it('★ wushen 语义坑 1：值恰好长成 {v,e} 形状也不会被误判为过期记录', () => {
    const t = new TempStore();
    const payload = { v: '剑', e: 999 };
    t.setTemp('looks-like-record', payload, NEVER_EXPIRES, 0);
    expect(t.queryTemp('looks-like-record')).toBe(payload); // 原样取出，未被当成记录
    expect(t.size).toBe(1);
  });

  it('hasTemp 看的是"键是否在跟踪"，与值是否为 undefined 无关', () => {
    const t = new TempStore();
    t.setTemp('undef', undefined, NEVER_EXPIRES, 0);
    expect(t.hasTemp('undef', 0)).toBe(true); // 键存在（值为 undefined 也是合法值）
    t.setTemp('real', 1, NEVER_EXPIRES, 0);
    expect(t.hasTemp('real', 0)).toBe(true);
    expect(t.hasTemp('absent', 0)).toBe(false);
  });

  it('hasTemp 对已过期的键返回 false 并顺带清理', () => {
    const t = new TempStore();
    t.setTemp('gone', 1, 10, 0);
    expect(t.hasTemp('gone', 100)).toBe(false);
    expect(t.size).toBe(0);
  });

  it('ttlRemainingMs：不存在=0 / 永不过期=Infinity / 未到期=剩余毫秒', () => {
    const t = new TempStore();
    expect(t.ttlRemainingMs('nope', 0)).toBe(0);
    t.setTemp('forever', 1, NEVER_EXPIRES, 0);
    expect(t.ttlRemainingMs('forever', 0)).toBe(Number.POSITIVE_INFINITY);
    t.setTemp('timed', 1, 3_000, 1_000);
    expect(t.ttlRemainingMs('timed', 2_000)).toBe(2_000);
    expect(t.ttlRemainingMs('timed', 5_000)).toBe(0); // 已过期
  });
});

describe('engine/temp · addTemp', () => {
  it('首次从 0 起累加，可负向', () => {
    const t = new TempStore();
    expect(t.addTemp('n', 5, NEVER_EXPIRES, 0)).toBe(5);
    expect(t.addTemp('n', -2, NEVER_EXPIRES, 0)).toBe(3);
  });

  it('★ wushen 语义坑 3：原值不是有限数值时拒绝累加（不把错键悄悄当计数器）', () => {
    const t = new TempStore();
    t.setTemp('weird', 'abc', NEVER_EXPIRES, 0);
    expect(() => t.addTemp('weird', 1, NEVER_EXPIRES, 0)).toThrow(TempValueError);
  });

  it('过期的原值不参与累加（读时已删除，从 0 重新起算）', () => {
    const t = new TempStore();
    t.setTemp('c', 100, 10, 0); // 到期时刻 10
    expect(t.addTemp('c', 1, NEVER_EXPIRES, 100)).toBe(1);
  });
});

describe('engine/temp · 校验与批量操作', () => {
  it('非法 TTL / 非法增量一律抛 TempValueError', () => {
    const t = new TempStore();
    expect(() => t.setTemp('k', 1, -1, 0)).toThrow(TempValueError);
    expect(() => t.setTemp('k', 1, Number.NaN, 0)).toThrow(TempValueError);
    expect(() => t.setTemp('k', 1, Number.POSITIVE_INFINITY, 0)).toThrow(TempValueError);
    expect(() => t.addTemp('k', Number.NaN, NEVER_EXPIRES, 0)).toThrow(TempValueError);
  });

  it('pruneTemp 只清过期项并返回清掉的个数', () => {
    const t = new TempStore();
    t.setTemp('a', 1, 100, 0); // 到期 100
    t.setTemp('b', 2, NEVER_EXPIRES, 0);
    t.setTemp('c', 3, 50, 0); // 到期 50
    expect(t.pruneTemp(60)).toBe(1); // 只清 c
    expect(t.size).toBe(2);
    expect(t.pruneTemp(100)).toBe(1); // 清 a
    expect(t.size).toBe(1);
    expect(t.pruneTemp(100)).toBe(0); // 幂等
  });

  it('snapshotTemp 不导出已过期项，且**带着过期时刻**（读档回来不该带一堆失效 BUFF）', () => {
    const t = new TempStore();
    t.setTemp('alive', 'A', NEVER_EXPIRES, 0);
    t.setTemp('dead', 'D', 10, 0);
    t.setTemp('timed', 'T', 5_000, 1_000); // 到期 6000
    // ★ `e` 必须出现：S4 之前这里只导出 `alive: 'A'`，读档后一切永不过期
    expect(t.snapshotTemp(100)).toEqual({
      alive: { v: 'A', e: NEVER_EXPIRES },
      timed: { v: 'T', e: 6_000 },
    });
  });

  it('loadTemp 是**合并**装载（不清空已有键），空键名被拒收并记账', () => {
    const t = new TempStore();
    t.setTemp('keep', 1, NEVER_EXPIRES, 0);
    const report = t.loadTemp({ '': { v: 0, e: 0 }, x: { v: 9, e: 0 }, y: { v: 'v', e: 0 } }, 0);
    expect(report.loaded).toBe(2);
    expect(report.rejected.map((r) => r.key)).toEqual(['(空键名)']);
    expect(t.queryTemp('x')).toBe(9);
    expect(t.queryTemp('keep')).toBe(1); // 未被清掉
  });

  it('★ E3：loadTemp 拒收**非有限**的过期时刻（NaN / Infinity 会污染之后所有算术）', () => {
    const t = new TempStore();
    const report = t.loadTemp(
      {
        nan: { v: 1, e: Number.NaN },
        inf: { v: 1, e: Number.POSITIVE_INFINITY },
        ok: { v: 3, e: NEVER_EXPIRES },
      },
      0,
    );
    expect(report.loaded).toBe(1);
    expect(report.rejected.map((r) => r.key)).toEqual(['nan', 'inf']);
    expect(t.hasTemp('nan', 0)).toBe(false); // 脏键没进表
    expect(t.queryTemp('ok')).toBe(3);
  });

  it('★ E3：干净快照往返 `rejected` 恒为空（契约 ③ 的绿色基线）', () => {
    const t = new TempStore();
    t.setTemp('num', 1, NEVER_EXPIRES, 0);
    t.setTemp('str', 'x', 5_000, 0);
    expect(t.loadTemp(t.snapshotTemp(1_000), 1_000).rejected).toEqual([]);
  });

  it('loadTemp 拒绝非对象（数组 / null / 标量）', () => {
    const t = new TempStore();
    for (const bad of [[], ['x'], null, 'x', 42]) {
      expect(() => t.loadTemp(bad as unknown, 0), JSON.stringify(bad)).toThrow(TempValueError);
    }
  });

  it('removeTemp / clearTemp', () => {
    const t = new TempStore();
    t.setTemp('a', 1);
    t.setTemp('b', 2);
    expect(t.removeTemp('a')).toBe(true);
    expect(t.removeTemp('a')).toBe(false);
    t.clearTemp();
    expect(t.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// S11（2026-10-16 审查）：`ttlRemainingMs()` 读到过期只返回 0、**不清理**
// ---------------------------------------------------------------------------
//
// 它是 `Character.isBusy()` 与 `SkillBook.pfmCooldownMs()` 的**唯一**读路径，
// 而同文件的 `queryTemp()` / `hasTemp()` 都写了"顺带清理"并注释说明 —— 唯独这条没有。
// 叠加 `loadTemp` 的**合并**语义 ⇒ 长生命周期角色的 `#records` 单调增长。
describe('S11 · 到点的记录要被清掉（不只是读到 0）', () => {
  it('★ `ttlRemainingMs` 到点即清理（否则读一次留一条，越攒越多）', () => {
    const t = new TempStore();
    t.setTemp('gone', 1, 10, 0); // 到期时刻 10
    expect(t.size).toBe(1);

    expect(t.ttlRemainingMs('gone', 10)).toBe(0);
    expect(t.size, '到点读了却没清 ⇒ #records 单调增长').toBe(0);
  });

  it('【反向锚点】没到点就**不许**清（别把"清理"做成"读一下就没"）', () => {
    const t = new TempStore();
    t.setTemp('live', 1, 100, 0);
    expect(t.ttlRemainingMs('live', 50)).toBe(50);
    expect(t.size).toBe(1);
    expect(t.ttlRemainingMs('live', 99)).toBe(1);
    expect(t.size).toBe(1);
  });
});

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

import { NEVER_EXPIRES, TempStore, TempValueError } from '../server/engine/temp.js';

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

  it('snapshotTemp 不导出已过期项（读档回来不该带一堆失效 BUFF）', () => {
    const t = new TempStore();
    t.setTemp('alive', 'A', NEVER_EXPIRES, 0);
    t.setTemp('dead', 'D', 10, 0);
    expect(t.snapshotTemp(100)).toEqual({ alive: 'A' });
  });

  it('loadTemp 是**合并**装载（不清空已有键），空键名被拒收并记账', () => {
    const t = new TempStore();
    t.setTemp('keep', 1, NEVER_EXPIRES, 0);
    const report = t.loadTemp({ '': 0, x: 9, y: 'v' }, 0);
    expect(report.loaded).toBe(2);
    expect(report.rejected.map((r) => r.key)).toEqual(['(空键名)']);
    expect(t.queryTemp('x')).toBe(9);
    expect(t.queryTemp('keep')).toBe(1); // 未被清掉
  });

  it('★ E3：loadTemp 拒收**非有限**的数值（NaN / Infinity 会污染之后所有算术）', () => {
    const t = new TempStore();
    const report = t.loadTemp({ nan: Number.NaN, inf: Number.POSITIVE_INFINITY, ok: 3 }, 0);
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

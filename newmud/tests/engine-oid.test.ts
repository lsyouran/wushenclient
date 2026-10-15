/**
 * server/engine/oid.ts —— 运行时实例 id（取代 wushen `util/util.js:285 create_id()`）
 * ============================================================================
 * 这批断言针对的是「正确性不依赖长度」这条设计承诺：
 * wushen 只有 34⁴ 随机前缀 + 线性查找，撞 id 就变成"两个物体共用一份引用"。
 * 本实现即便随机源退化（一直吐同一个值），也**宁可不产 id 也不产重复 id**。
 */
import { describe, expect, it } from 'vitest';

import {
  OID_ALPHABET,
  OID_LENGTH,
  OID_MAX_TRIES,
  OID_RE,
  OidError,
  OidSpace,
  defaultOidRandom,
} from '../server/engine/oid.js';

/** 确定性随机源：按序吐出给定值，用尽后重复最后一个 */
function seqRandom(values: readonly string[]): (length: number) => string {
  let i = 0;
  return () => {
    const v = values[i] ?? values[values.length - 1] ?? '';
    i += 1;
    return v;
  };
}

describe('engine/oid · 默认随机源', () => {
  it('产出 OID_LENGTH 位、字符集内的小写字母数字串', () => {
    for (let i = 0; i < 200; i += 1) {
      const id = defaultOidRandom();
      expect(id).toHaveLength(OID_LENGTH);
      expect(OID_RE.test(id)).toBe(true);
      for (const ch of id) expect(OID_ALPHABET.includes(ch)).toBe(true);
    }
  });

  it('现实规模下几乎不碰撞（200 次不重复）', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i += 1) seen.add(defaultOidRandom());
    expect(seen.size).toBe(200);
  });

  it('长度可注入（测试/短 id 场景）', () => {
    expect(defaultOidRandom(4)).toHaveLength(4);
    expect(defaultOidRandom(1)).toHaveLength(1);
  });
});

describe('engine/oid · OidSpace 发号与查重', () => {
  it('next() 登记 id，size 随之增长，且互不相同', () => {
    const sp = new OidSpace();
    const ids = new Set<string>();
    for (let i = 0; i < 500; i += 1) {
      const id = sp.next();
      expect(ids.has(id)).toBe(false);
      ids.add(id);
    }
    expect(sp.size).toBe(500);
    expect(sp.has([...ids][0] ?? '')).toBe(true);
  });

  it('★ 撞 id 会重抽（正确性不依赖长度）', () => {
    const dup = 'aaaaaaaaaa';
    const uniq = 'bbbbbbbbbb';
    // 第 1 次 aaaa 占用 → 第 2 次 aaaa 撞了就重抽 → 第 3 次 bbbb
    const sp = new OidSpace(seqRandom([dup, dup, uniq]));
    expect(sp.next()).toBe(dup);
    expect(sp.next()).toBe(uniq);
    expect(sp.size).toBe(2);
  });

  it('★ 随机源一直吐同一个值 → 撞满上限抛 OidError（宁可不产 id，也不产重复 id）', () => {
    const sp = new OidSpace(seqRandom(['cccccccccc']));
    sp.next();
    expect(() => sp.next()).toThrow(OidError);
    expect(sp.size).toBe(1); // 失败的那次没有登记任何东西
  });

  it('★ 重试次数恰好等于 OID_MAX_TRIES（不是无限重试）', () => {
    let calls = 0;
    const sp = new OidSpace((len: number) => {
      calls += 1;
      return '!'.repeat(len); // 非法字符 → 每次都不被采纳
    });
    expect(() => sp.next()).toThrow(OidError);
    expect(calls).toBe(OID_MAX_TRIES);
  });

  it('非法字符 / 长度不够的随机值一律不被采纳', () => {
    // 大写、下划线、中文、长度不足 —— 全不合法
    const sp = new OidSpace(seqRandom(['ABCDEFGHIJ', 'a_b_c_d_e_', '十个中文字符啊啊', 'short']));
    expect(() => sp.next()).toThrow(OidError);
  });
});

describe('engine/oid · reserve / release（读档边界）', () => {
  it('reserve() 占住合法 id；重复占用直接抛错', () => {
    const sp = new OidSpace();
    sp.reserve('0123456789');
    expect(sp.has('0123456789')).toBe(true);
    expect(() => sp.reserve('0123456789')).toThrow(OidError);
  });

  it('reserve() 遇到非法 id 抛错（存档被污染也不能静默接受）', () => {
    const sp = new OidSpace();
    expect(() => sp.reserve('short')).toThrow(OidError);
    expect(() => sp.reserve('ABCDEFGHIJ')).toThrow(OidError); // 大写不在字母表
  });

  it('release() 返回是否确实占用过，并让 id 可被后续复用', () => {
    const sp = new OidSpace(seqRandom(['dddddddddd', 'dddddddddd']));
    const id = sp.next();
    expect(sp.release(id)).toBe(true);
    expect(sp.release(id)).toBe(false); // 已经释放过了
    expect(sp.size).toBe(0);
    expect(sp.next()).toBe(id); // 释放后又能抽到同一个
  });
});

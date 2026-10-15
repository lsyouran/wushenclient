/**
 * shared/ids.ts 的契约测试
 * ============================================================================
 * 存在的理由有两条，都很具体：
 *
 *   1. **把 id 语法钉成一处**（★ docs/26 M1）。旧文件里另有一个便利正则
 *      `WORLD_ID_RE`，注释还写着「G5 命名闸门直接复用此正则」。实测它与
 *      `parseWorldId` 已在 9/15 个用例上发散。它已被删除；本文件用
 *      「导出的 RegExp 恰好只有 SEGMENT_RE / VARIANT_RE」把这条钉住 ——
 *      再想加第二份全串语法正则，必须显式改这个断言。
 *
 *   2. **把「磁盘路径 ↔ id」的映射从死代码变成受测契约**（★ docs/26 L7）。
 *      这组函数原本零调用点，最容易腐烂；G5 闸门在 .mjs 侧校验同一条不变量，
 *      这里在 TS 侧再验一次往返一致性。
 */
import * as ids from '@shared/ids.js';
import {
  ID_MAX_LENGTH,
  ID_MAX_SEGMENTS,
  KINDS,
  MIN_SEGMENTS_BY_KIND,
  RESERVED_AREAS,
  SUBTYPES,
  SUBTYPES_BY_KIND,
  asWorldId,
  asWorldIdForKind,
  fileToKind,
  fileToWorldId,
  isWorldId,
  makeWorldId,
  parseWorldId,
  sameIdTemplate,
  worldIdBase,
  worldIdToFile,
} from '@shared/ids.js';
import { describe, expect, it } from 'vitest';

describe('M1 id 语法只有一处（★ docs/26 M1 回归）', () => {
  it('★ 回归锚点：模块导出的 RegExp 恰好只有 SEGMENT_RE 与 VARIANT_RE', () => {
    const regExps = Object.entries(ids)
      .filter(([, v]) => v instanceof RegExp)
      .map(([k]) => k)
      .sort();
    // 出现第三个正则 = 有人又在造"第二份全串语法定义"。
    // 若确实必要，请改这条断言并在 docs/24 §3 记录理由（然后补等价性测试）。
    expect(regExps).toEqual(['SEGMENT_RE', 'VARIANT_RE']);
  });

  it('★ 保留 area 必须被 parseWorldId 拒绝（旧 WORLD_ID_RE 在这里放行）', () => {
    for (const area of RESERVED_AREAS) {
      expect(parseWorldId(`${area}/x`), `保留 area ${area} 不应被接受`).toBeNull();
    }
  });

  it('★ 长度上限必须生效（旧 WORLD_ID_RE 没有这个检查）', () => {
    const long = `${'a'.repeat(ID_MAX_LENGTH)}/x`;
    expect(parseWorldId(long)).toBeNull();
    expect(parseWorldId('a'.repeat(ID_MAX_LENGTH))).not.toBeNull();
  });

  it('段数上限生效', () => {
    const ok = ['a', 'a/b', 'a/b/c', 'a/b/c/d', 'a/b/c/d/e'];
    for (const id of ok) expect(parseWorldId(id), id).not.toBeNull();
    expect(parseWorldId('a/b/c/d/e/f')).toBeNull();
    expect(ok.length).toBe(ID_MAX_SEGMENTS);
  });

  it('方案 B 的冒号 id 被拒绝（Windows 文件名非法）', () => {
    expect(parseWorldId('yz:room:guangchang')).toBeNull();
    expect(parseWorldId('yz/Guangchang')).toBeNull();
    expect(parseWorldId('yz/guang-chang')).toBeNull();
    expect(parseWorldId('')).toBeNull();
    expect(parseWorldId(undefined)).toBeNull();
    expect(parseWorldId(123)).toBeNull();
  });
});

describe('id 解析与构造', () => {
  it('parseWorldId 拆出 area / path / localname / variant', () => {
    expect(parseWorldId('yz/guangchang#0')).toEqual({
      area: 'yz',
      path: 'yz/guangchang',
      localname: 'guangchang',
      variant: '0',
      segments: ['yz', 'guangchang'],
    });
    expect(parseWorldId('yz')?.localname).toBe('');
    expect(parseWorldId('yz')?.variant).toBeNull();
  });

  it('asWorldId 非法即抛；isWorldId 不抛（闸门批量扫描用）', () => {
    expect(() => asWorldId('Bad/Id')).toThrow(ids.IdError);
    expect(isWorldId('yz/guangchang')).toBe(true);
    expect(isWorldId('Bad/Id')).toBe(false);
  });

  it('asWorldIdForKind 额外校验各 kind 的最小段数', () => {
    // area 允许单段
    expect(asWorldIdForKind('yz', 'area')).toBe('yz');
    // 其余 kind 至少两段
    for (const k of KINDS) {
      if (k === 'area') continue;
      expect(() => asWorldIdForKind('yz', k), k).toThrow(ids.IdError);
      expect(MIN_SEGMENTS_BY_KIND[k]).toBeGreaterThanOrEqual(2);
    }
  });

  it('makeWorldId 与 parseWorldId 往返一致（含变体）', () => {
    const id = makeWorldId('yz', 'guangchang');
    expect(id).toBe('yz/guangchang');
    expect(parseWorldId(id)?.path).toBe('yz/guangchang');
    const withVariant = makeWorldId('yz', 'guangchang', '0');
    expect(parseWorldId(withVariant)?.variant).toBe('0');
    expect(() => makeWorldId('Bad', 'x')).toThrow(ids.IdError);
  });

  it('worldIdBase / sameIdTemplate 按"忽略变体"归并', () => {
    expect(worldIdBase('yz/a#1')).toBe('yz/a');
    expect(worldIdBase('Bad/Id')).toBeNull();
    expect(sameIdTemplate('yz/a#0', 'yz/a#1')).toBe(true);
    expect(sameIdTemplate('yz/a', 'yz/b')).toBe(false);
    expect(sameIdTemplate('Bad/Id', 'yz/b')).toBe(false);
  });
});

describe('磁盘映射 world/<kind>/<id>.ts（与 G5 闸门守同一条不变量）', () => {
  it('worldIdToFile：变体不改变文件位置（同文件派生多对象）', () => {
    expect(worldIdToFile('yz/guangchang', 'room')).toBe('world/room/yz/guangchang.ts');
    expect(worldIdToFile('yz/guangchang#0', 'room')).toBe('world/room/yz/guangchang.ts');
    expect(() => worldIdToFile('Bad/Id', 'room')).toThrow(ids.IdError);
  });

  it('★ 往返：文件 → kind/id → 文件，逐字一致', () => {
    const files = [
      'world/room/yz/guangchang.ts',
      'world/npc/pub/xiaoer.ts',
      'world/skill/wd/taijijian.ts',
      'world/area/yz.ts',
    ];
    for (const f of files) {
      const kind = fileToKind(f);
      const id = fileToWorldId(f);
      expect(kind, f).not.toBeNull();
      expect(id, f).not.toBeNull();
      if (kind === null || id === null) continue;
      expect(worldIdToFile(id, kind), f).toBe(f);
    }
  });

  it('fileToKind 只认合法 kind 目录；fileToWorldId 拒绝非法 id', () => {
    expect(fileToKind('world/nonsense/x.ts')).toBeNull();
    expect(fileToKind('shared/ids.ts')).toBeNull();
    // `item` 是保留 area → 该路径推出的 id 非法
    expect(fileToWorldId('world/room/item/x.ts')).toBeNull();
    // 层级不足（world/room.ts 这种）
    expect(fileToWorldId('world/room.ts')).toBeNull();
  });

  it('Windows 反斜杠路径同样识别', () => {
    expect(fileToKind('world\\room\\yz\\a.ts')).toBe('room');
    expect(fileToWorldId('world\\room\\yz\\a.ts')).toBe('yz/a');
  });
});

describe('subtype 词表（键集与 KINDS 同步，防止加 kind 时漏配）', () => {
  it('SUBTYPES 无重复、全小写', () => {
    expect(new Set(SUBTYPES).size).toBe(SUBTYPES.length);
    for (const s of SUBTYPES) expect(s, s).toMatch(/^[a-z][a-z0-9_]*$/);
  });

  it('★ SUBTYPES_BY_KIND 的键集必须恰好等于 KINDS（加一个 kind 就必须补一行）', () => {
    expect(Object.keys(SUBTYPES_BY_KIND).sort()).toEqual([...KINDS].sort());
  });

  it('每个 kind 声明的 subtype 都必须在 SUBTYPES 词表内', () => {
    const vocab = new Set<string>(SUBTYPES);
    for (const [kind, subs] of Object.entries(SUBTYPES_BY_KIND)) {
      for (const s of subs) expect(vocab.has(s), `${kind} 声明了词表外的 subtype ${s}`).toBe(true);
    }
  });
});

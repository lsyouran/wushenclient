/**
 * define* 的注册约束 —— 含**畸形输入**与**变异**用例。
 * 依据 docs/24 §1：非法 id 必须在注册期就被拒绝，而不是运行时静默 undefined。
 */
import { IdError, VARIANT_RE } from '@shared/ids.js';
import type { WorldId } from '@shared/ids.js';
import { registerExtProp } from '@shared/constants.js';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearAll,
  countOf,
  DuplicateRegistrationError,
  getDef,
  idsOf,
  register,
} from '../server/engine/registry.js';
import type { ItemDef, NpcDef } from '../server/world/defs.js';
import { defineArea, defineItem, defineNpc, defineRoom } from '../server/world/define.js';

const room = { name: '测试房', desc: '测试用' };

describe('define* 注册约束', () => {
  beforeEach(() => {
    clearAll();
  });

  it('拒绝方案 B 的冒号 id（Windows 文件名非法）', () => {
    expect(() => defineRoom('yz:room:guangchang', room)).toThrow(IdError);
  });

  it('拒绝大写 id', () => {
    expect(() => defineRoom('YZ/Guangchang', room)).toThrow(IdError);
  });

  it('拒绝保留 area（与 kind 同名）', () => {
    expect(() => defineRoom('item/gj', room)).toThrow(IdError);
  });

  it('非 area 的 kind 至少 2 段', () => {
    expect(() => defineRoom('guangchang', room)).toThrow(IdError);
  });

  it('area 是唯一允许单段的 kind', () => {
    defineArea('yz', { name: '扬州城', first: 'yz/a' });
    expect(countOf('area')).toBe(1);
  });

  it('重复注册直接抛错，而不是静默覆盖（wushen 13 册 13.1 的根治）', () => {
    defineRoom('yz/a', room);
    expect(() => defineRoom('yz/a', room)).toThrow(DuplicateRegistrationError);
    expect(countOf('room')).toBe(1);
  });

  it('变体展开为独立 id', () => {
    defineItem('drug/x', {
      name: '药',
      variants: { '0': { name: '甲' }, '1': { name: '乙' } },
    });
    expect(countOf('item')).toBe(3);
    expect(getDef<ItemDef>('item', 'drug/x#1')?.name).toBe('乙');
  });

  it('非法变体名 → 抛错，且**不留下半个对象**', () => {
    expect(() =>
      defineItem('drug/y', { name: '药', variants: { '0-1': { name: '坏' } } }),
    ).toThrow(IdError);
    // 关键：基对象也不应该被注册（校验先于落库）
    expect(countOf('item')).toBe(0);
  });
  /**
   * ★★ T20（26 册 §11.4）：变体名正则**只有一份**（`shared/ids.ts#VARIANT_RE`）。
   *
   * 原先 `define.ts` 自留了一份 `VARIANT_NAME_RE = /^[A-Za-z0-9_]{1,32}$/`，
   * 与 `ids.ts` 的 `VARIANT_RE` **逐字节相同** —— 教科书式的"第二份真相"：
   * 今天相等不代表明天相等，改了一处另一处静默漂移，谁也不会发现。
   * 两组断言：① 行为等价（两处发散就红）；② 源码里不许再出现第二份。
   */
  it('★ T20：变体名校验与 `VARIANT_RE` 行为等价（两处各自维护必然发散）', () => {
    const cases = ['0', '1', 'taijijian', 'a'.repeat(32), 'A_b9', '0-1', 'a'.repeat(33), '', '中文', 'a b'];
    for (const name of cases) {
      let accepted = true;
      try {
        defineItem('drug/v', { name: '药', variants: { [name]: { name: '变' } } });
      } catch {
        accepted = false;
      }
      expect(accepted, `变体名 ${JSON.stringify(name)} 的接受与否应与 VARIANT_RE 一致`).toBe(
        VARIANT_RE.test(name),
      );
      clearAll();
    }
  });

  it('★ T20：`define.ts` 源码里**不再有**第二份变体名正则', async () => {
    const fs = await import('node:fs/promises');
    const src = await fs.readFile(new URL('../server/world/define.ts', import.meta.url), 'utf8');
    // 用了单源那一份（不是"凭记忆又写了一遍"）
    expect(src).toContain('VARIANT_RE');
    // ★ 判据落在**正则字面量的特征片段**上，不是名字上：注释里提一句名字无害，
    //   重新写一份 `[A-Za-z0-9_]{1,32}` 才有害（那正是这份断言要拦的事）
    expect(src).not.toContain('[A-Za-z0-9_]{1,32}');
  });

  it('★ L9：直接调用 register 时非法 id 会被拦住（不能绕过 define* 的校验）', () => {
    // 类型层：`id: WorldId`（品牌）→ 普通字符串写不进去。
    // 运行时层：`as` 强转能骗过编译器，但骗不过 parseWorldId。
    const forged = 'Bad/Id' as unknown as WorldId;
    expect(() => register('room', forged, { name: 'x' })).toThrow(IdError);
    expect(countOf('room')).toBe(0);

    // 对照：合法 id 放行
    register('room', 'yz/ok' as unknown as WorldId, { name: 'x' });
    expect(countOf('room')).toBe(1);
  });
});

describe('M5 变体合并语义（★ docs/26 M5 回归 —— 显式钉住，不靠看代码猜）', () => {
  beforeEach(() => {
    clearAll();
  });

  it('★ `prop` 是**并集**合并：变体只调一个属性，基对象其余属性必须留住', () => {
    defineItem('drug/m', {
      name: '药',
      prop: { attack: 10, defense: 5, hit: 3 },
      variants: { '1': { prop: { attack: 20 } } },
    });
    // 基对象不受影响
    expect(getDef<ItemDef>('item', 'drug/m')?.prop).toEqual({ attack: 10, defense: 5, hit: 3 });
    // 旧实现（整块覆盖）会得到 { attack: 20 } —— fy/mz 静默消失
    expect(getDef<ItemDef>('item', 'drug/m#1')?.prop).toEqual({ attack: 20, defense: 5, hit: 3 });
  });

  it('★ `extProp` 按 key 并集：变体赢、顺序稳定、基对象独有键保留', () => {
    const ka = registerExtProp('m5_probe_a', { display: 'A', owner: 'item:probe' });
    const kb = registerExtProp('m5_probe_b', { display: 'B', owner: 'item:probe' });
    const kc = registerExtProp('m5_probe_c', { display: 'C', owner: 'item:probe' });

    defineItem('drug/e', {
      name: '药',
      extProp: [
        [ka, 1],
        [kb, 2],
      ],
      variants: {
        '1': {
          extProp: [
            [kb, 20], // 覆盖已有键
            [kc, 3], // 新增键
          ],
        },
      },
    });

    expect(getDef<ItemDef>('item', 'drug/e#1')?.extProp).toEqual([
      [ka, 1],
      [kb, 20],
      [kc, 3],
    ]);
    // 基对象本身不被改动（合并必须产生新数组，不能就地改基对象）
    expect(getDef<ItemDef>('item', 'drug/e')?.extProp).toEqual([
      [ka, 1],
      [kb, 2],
    ]);
  });

  it('★ 数组字段仍是**覆盖**语义（不拼接）—— 与 `prop` 的并集形成对照', () => {
    defineNpc('yz/n', {
      name: 'N',
      desc: 'd',
      drops: [{ obj: 'drug/a' }, { obj: 'drug/b' }],
      variants: { '1': { drops: [{ obj: 'drug/c' }] } },
    });
    expect(getDef<NpcDef>('npc', 'yz/n')?.drops).toHaveLength(2);
    // 拼接会得到 3 条无法预测的掉落；这里明确是"变体给的就是全部"
    expect(getDef<NpcDef>('npc', 'yz/n#1')?.drops).toEqual([{ obj: 'drug/c' }]);
  });

  it('★ 标量仍是覆盖语义；变体里嵌套写 `variants` 会被剥掉', () => {
    defineItem('drug/s', {
      name: '基名',
      value: 100,
      variants: { '1': { name: '变体名' } },
    });
    expect(getDef<ItemDef>('item', 'drug/s')?.value).toBe(100);
    expect(getDef<ItemDef>('item', 'drug/s#1')?.name).toBe('变体名');
    // `value` 未在变体里给 → 继承基对象
    expect(getDef<ItemDef>('item', 'drug/s#1')?.value).toBe(100);

    defineItem('drug/n', {
      name: 'x',
      variants: {
        '1': { name: 'y', variants: { '9': { name: 'z' } } },
      },
    });
    // 不支持嵌套变体：`#1` 的 def 里不应残留 variants 字段
    expect(
      (getDef<ItemDef>('item', 'drug/n#1') as Record<string, unknown> | undefined)?.['variants'],
    ).toBeUndefined();
    // 也不应因此产生 `#1#9` 之类的 id：本用例注册过的 id 必须**恰好**是这两组
    expect(idsOf('item').sort()).toEqual(['drug/n', 'drug/n#1', 'drug/s', 'drug/s#1']);
  });
});

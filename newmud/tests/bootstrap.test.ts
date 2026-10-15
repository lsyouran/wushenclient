/**
 * 组合根（★ docs/26 M3 回归）
 * ============================================================================
 * `bootstrapWorld()` 曾经把 `assertWorldValid()` 里的
 * 「过滤 error → 拼详情 → 抛错」**重写了一份**，而 `assertWorldValid()` 本身
 * 无人调用（死代码）—— 正是 24 册 §4 禁止清单第 8 条
 * 「同一逻辑在两处各写一份」（wushen #20 的同类形态）。
 *
 * 处置后唯一收口在 `server/world/validate.ts`。本文件把这条钉住：
 * 两者对同一个坏世界抛出的**信息必须逐字相同** —— 任何一处单独改动都会立刻变红。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { bootstrapWorld } from '../server/bootstrap.js';
import { clearAll, countOf } from '../server/engine/registry.js';
import { assertWorldValid } from '../server/world/validate.js';
import { defineRoom } from '../server/world/define.js';

function messageOf(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
  return '';
}

describe('M3 组合根不重写校验逻辑（★ docs/26 M3 回归）', () => {
  beforeEach(() => {
    clearAll();
  });

  it('★ 坏世界：bootstrapWorld 与 assertWorldValid 的报错信息必须**逐字相同**', () => {
    // 注意：`import '@world/index.js'` 已在模块加载期执行过，内容不会被重复注册；
    // clearAll() 之后注册表里只剩下面这一个坏房间。
    defineRoom('yz/a', { name: 'A', desc: 'd', exits: { north: 'yz/nope' } });

    const fromValidate = messageOf(() => assertWorldValid());
    const fromBootstrap = messageOf(() => bootstrapWorld());

    expect(fromValidate).not.toBe('');
    expect(fromValidate).toContain('yz/nope');
    expect(fromBootstrap).toBe(fromValidate);
  });

  it('好世界：bootstrapWorld 正常返回计数与根自检信息', () => {
    defineRoom('yz/a', { name: 'A', desc: 'd' });
    const r = bootstrapWorld();
    expect(r.counts.room).toBe(countOf('room'));
    expect(r.problems).toEqual([]);
    // 根自检结果被真的用上了（不再是一个"调了但没用"的 void 调用）
    expect(r.root.name.trim()).not.toBe('');
    expect(r.root.missingRequired).toEqual([]);
  });

  it('assertWorldValid 无 error 时返回问题清单而非抛错', () => {
    defineRoom('yz/a', { name: 'A', desc: 'd' });
    expect(assertWorldValid()).toEqual([]);
  });
});

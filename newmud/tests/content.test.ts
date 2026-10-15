/**
 * 内容层加载 / 变体展开 / G4 校验 —— 针对**真实** `world/` 内容
 */
import { describe, expect, it } from 'vitest';

// 副作用导入：触发真实内容注册
import '@world/index.js';

import { countOf, getDef, getEntry } from '../server/engine/registry.js';
import type { ItemDef } from '../server/world/defs.js';
import { validateWorld } from '../server/world/validate.js';

describe('真实 world/ 内容加载', () => {
  it('各 kind 计数正确', () => {
    expect(countOf('area')).toBe(1);
    expect(countOf('skill')).toBe(3); // base/force + base/sword + wd/taijijian
    expect(countOf('item')).toBe(3); // drug/yao + #0 + #1
    expect(countOf('npc')).toBe(1);
    expect(countOf('room')).toBe(2);
    // action/look + action/select + move/go + chat/say + chat/shout + chat/tell + info/score
    // （移动方向不在这里 —— 它由房间的 `exits` **派生**，不是内容文件，见 server/engine/room.ts）
    expect(countOf('command')).toBe(7);
  });

  it('变体展开：继承基对象字段 + 被覆盖字段生效', () => {
    const v0 = getDef<ItemDef>('item', 'drug/yao#0');
    expect(v0?.name).toBe('再生丹');
    expect(v0?.unit).toBe('枚'); // 继承自基对象
    expect(v0?.value).toBe(300); // 被变体覆盖

    const v1 = getDef<ItemDef>('item', 'drug/yao#1');
    expect(v1?.name).toBe('暴虐丹');
  });

  it('变体记录指向基对象', () => {
    expect(getEntry('item', 'drug/yao#0')?.variantOf).toBe('drug/yao');
    expect(getEntry('item', 'drug/yao')?.variantOf).toBeNull();
  });

  it('注册来源被记录（best-effort，用于报错定位）', () => {
    const src = getEntry('room', 'yz/guangchang')?.source ?? '';
    expect(src).toContain('room/yz/guangchang.ts');
  });

  it('G4：真实内容的跨对象引用全部有效', () => {
    const errors = validateWorld().filter((p) => p.level === 'error');
    expect(errors).toEqual([]);
  });
});

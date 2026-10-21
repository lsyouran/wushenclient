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
    expect(countOf('skill')).toBe(7); // 6 门基本技能（内功/轻功/招架/拳脚/剑法/刀法）+ 太极剑法
    expect(countOf('item')).toBe(5); // drug/yao + #0 + #1 + book/taijijian + book/sword（§75 秘籍）
    expect(countOf('npc')).toBe(3); // pub/xiaoer + pub/muren（练功桩）+ pub/jiaotou（教头）
    expect(countOf('room')).toBe(3); // yz/guangchang + yz/beidajie1 + yz/wuguan（武馆）
    // action/look + action/select + move/go + chat/say + chat/shout + chat/tell + info/score
    // + obj/get + obj/drop + obj/give + obj/use（B 批四条物品指令）
    // + train/practice（成长批次：潜能换技能等级）
    // + train/learn + train/enable + train/forget + info/skills（§64 技能链）
    // + admin/addxp（2026-10-19 测试指令）
    // + combat/flee（逃跑闭环，2026-10-20）
    // （移动方向不在这里 —— 它由房间的 `exits` **派生**，不是内容文件，见 server/engine/room.ts）
    expect(countOf('command')).toBe(23); // + train/study（研读）+ train/stop（中断），§75
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

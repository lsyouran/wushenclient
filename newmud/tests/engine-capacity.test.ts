/**
 * tests/engine-capacity.test.ts —— 各"容器种类"的**默认容量**（E8）
 * ============================================================================
 * 背景（26 册 §32）：`Container` 的**基类**默认是"不限"，但**具体种类**各有缺省 ——
 *
 *   房间   50  照 wushen `os/room/room.js:9`
 *   玩家   50  ★ **有意偏离**：wushen `os/char/user.js:5` 是 **20**，本项目裁定取 **50**
 *   NPC    10  照 wushen `os/char/follower.js:12`
 *
 * 三档常量各自的**单源**就在它所属的模块里（`room.ts` / `character.ts` / `npc.ts`），
 * 本文件只钉"缺省值本身" —— 谁动了任一常量，这里会说话。
 *
 * ★ 与本文件**成对**的一条在 `engine-base.test.ts`：「默认容量不限」钉的是
 *   **泛型 `Container` 基类**的语义（子类不给缺省时不限），**不随本次改动而变**。
 *   两者一起才说明"缺省由子类给、不是基类给"。
 */
import { describe, expect, it } from 'vitest';

import { ContainerError, GameObject } from '../server/engine/base.js';
import type { ObjKind } from '../server/engine/base.js';
import { DEFAULT_CHARACTER_CAPACITY, RecordingOutput } from '../server/engine/character.js';
import { DEFAULT_NPC_CAPACITY, Npc } from '../server/engine/npc.js';
import { Player } from '../server/engine/player.js';
import { DEFAULT_ROOM_CAPACITY, Room } from '../server/engine/room.js';
import { SkillRegistry } from '../server/engine/skill.js';
import { asWorldId } from '../shared/ids.js';

/** 最小物件（只有位置语义），用来喂容器的"装/满"判定 */
class Thing extends GameObject {
  public constructor(oid: string, kind: ObjKind = 'item') {
    super({ oid, path: null, kind, name: oid });
  }
}

function makeRoom(oid: string, maxItems?: number): Room {
  return new Room({
    oid,
    path: asWorldId(`yz/${oid}`, 'engine-capacity.test:room'),
    name: `房间${oid}`,
    desc: '用于容量缺省回归的房间。',
    maxItems,
  });
}

function makePlayer(oid: string, roleId: string, maxItems?: number): Player {
  return new Player({ oid, path: null, roleId, name: roleId, maxItems, output: new RecordingOutput() });
}

function makeNpc(oid: string, maxItems?: number): Npc {
  return new Npc({
    oid,
    path: asWorldId(`pub/${oid}`, 'engine-capacity.test:npc'),
    name: `NPC${oid}`,
    def: { name: `NPC${oid}`, desc: '用于容量缺省回归的 NPC。' },
    maxItems,
    skillRegistry: new SkillRegistry([]),
  });
}

describe('engine · 容器默认容量（E8）', () => {
  it('房间默认 50', () => {
    expect(DEFAULT_ROOM_CAPACITY).toBe(50);
    expect(makeRoom('r1').maxItems).toBe(50);
  });

  it('★ 玩家背包默认 50（有意偏离 wushen 的 20 —— 改这个数会红）', () => {
    expect(DEFAULT_CHARACTER_CAPACITY).toBe(50);
    expect(makePlayer('p1', '容量甲').maxItems).toBe(50);
    expect(makePlayer('p1b', '容量甲b').maxItems).not.toBe(20); // 反向锚点：不是 wushen 的 20
  });

  it('NPC 默认 10', () => {
    expect(DEFAULT_NPC_CAPACITY).toBe(10);
    expect(makeNpc('n1').maxItems).toBe(10);
  });

  it('显式传入 maxItems 时三档缺省都被覆盖（缺省不是硬编码）', () => {
    expect(makeRoom('r2', 3).maxItems).toBe(3);
    expect(makePlayer('p2', '容量乙', 7).maxItems).toBe(7);
    expect(makeNpc('n2', 4).maxItems).toBe(4);
  });

  it('三档缺省都是**有限**值（E8 的原始症状正是"缺省无限"）', () => {
    const caps = [makeRoom('r3').maxItems, makePlayer('p3', '容量丙').maxItems, makeNpc('n3').maxItems];
    for (const c of caps) expect(Number.isFinite(c)).toBe(true);
    expect(caps).toEqual([50, 50, 10]);
  });

  it('缺省容量真的被 `addItem` 用上（不是"只写在字段里没人读"）', () => {
    const npc = makeNpc('n4'); // 缺省 10
    for (let i = 0; i < 10; i += 1) npc.addItem(new Thing(`npc-item-${String(i)}`));
    expect(npc.isFull()).toBe(true);
    expect(() => npc.addItem(new Thing('overflow'))).toThrow(ContainerError);

    const room = makeRoom('r4'); // 缺省 50
    for (let i = 0; i < 50; i += 1) room.addItem(new Thing(`room-item-${String(i)}`));
    expect(room.isFull()).toBe(true);
    expect(() => room.addItem(new Thing('overflow'))).toThrow(ContainerError);
  });
});

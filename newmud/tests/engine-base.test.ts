/**
 * server/engine/base.ts —— 对象模型最底层：位置 + 容器语义
 * ============================================================================
 * 这里钉住 base.ts 顶部声明"明确不抄 wushen"的三条里可断言的两条：
 *   - `environment` 与 `Container.items` **永远一致**（双向），且只由容器方法改
 *   - 不用 `Object.create` 原型克隆 → 每个实例的"当前位置"互不影响
 */
import { describe, expect, it } from 'vitest';

import { Container, ContainerError, GameObject } from '../server/engine/base.js';
import type { ObjKind } from '../server/engine/base.js';

/** 最小可实例化"物体"（只有位置语义，不是容器） */
class Thing extends GameObject {
  public constructor(oid: string, kind: ObjKind = 'item') {
    super({ oid, path: null, kind, name: oid });
  }
}

/** 最小可实例化容器（房间 / 角色都用它代替） */
class Box extends Container {
  public constructor(oid: string, kind: ObjKind = 'room', maxItems?: number) {
    super({ oid, path: null, kind, name: oid }, maxItems);
  }
}

describe('engine/base · 位置关系（environment）', () => {
  it('新建对象不在任何容器里；moveTo 后 environment 与容器 items 双向一致', () => {
    const room = new Box('room1');
    const sword = new Thing('i1');

    expect(sword.environment).toBeNull();
    expect(room.itemCount).toBe(0);

    expect(sword.moveTo(room)).toBe(true);
    expect(sword.environment).toBe(room);
    expect(room.hasItem(sword)).toBe(true);
    expect(room.items).toContain(sword);
  });

  it('已在目标容器里 → moveTo 返回 false（幂等，不重复入栈）', () => {
    const room = new Box('room1');
    const sword = new Thing('i1');
    sword.moveTo(room);
    expect(sword.moveTo(room)).toBe(false);
    expect(room.itemCount).toBe(1);
  });

  it('moveTo(null) 脱钩：两侧同时清空', () => {
    const room = new Box('room1');
    const sword = new Thing('i1');
    sword.moveTo(room);
    expect(sword.moveTo(null)).toBe(true);
    expect(sword.environment).toBeNull();
    expect(room.hasItem(sword)).toBe(false);
    expect(room.itemCount).toBe(0);
  });

  it('★ 移到另一个容器会自动从原容器摘掉（不会两边都在）', () => {
    const a = new Box('a');
    const b = new Box('b');
    const sword = new Thing('i1');

    sword.moveTo(a);
    sword.moveTo(b);

    expect(a.hasItem(sword)).toBe(false);
    expect(b.hasItem(sword)).toBe(true);
    expect(a.itemCount).toBe(0);
    expect(b.itemCount).toBe(1);
    expect(sword.environment).toBe(b);
  });

  it('room getter 沿容器链向上找，直到 kind=room（自己就是房间则返回自己）', () => {
    const room = new Box('r1', 'room');
    const npc = new Box('n1', 'npc'); // NPC 也是容器
    const sword = new Thing('i1', 'item');

    npc.moveTo(room);
    sword.moveTo(npc);

    expect(sword.environment).toBe(npc);
    expect(sword.room).toBe(room); // 剑在 NPC 身上，房间是外层
    expect(npc.room).toBe(room);
    expect(room.room).toBe(room);
  });

  it('不挂在房间链上时 room 为 null', () => {
    const orphan = new Thing('i1');
    expect(orphan.room).toBeNull();
  });
});

describe('engine/base · 容器约束', () => {
  it('不能把自己放进自己（自环）', () => {
    const b = new Box('b1');
    expect(() => b.addItem(b)).toThrow(ContainerError);
  });

  it('容量上限：超容抛 ContainerError（房间/背包各自的上限走同一个机制）', () => {
    const small = new Box('small', 'room', 2);
    small.addItem(new Thing('a'));
    small.addItem(new Thing('b'));
    expect(() => small.addItem(new Thing('c'))).toThrow(ContainerError);
    expect(small.itemCount).toBe(2);
  });

  it('默认容量不限', () => {
    const box = new Box('big');
    for (let i = 0; i < 200; i += 1) box.addItem(new Thing(`i${i}`));
    expect(box.itemCount).toBe(200);
  });

  it('removeItem 对不在手的对象返回 false', () => {
    const room = new Box('room1');
    expect(room.removeItem(new Thing('ghost'))).toBe(false);
  });

  it('findByOid 按实例 id 查内容物', () => {
    const room = new Box('room1');
    const sword = new Thing('sword-oid');
    room.addItem(new Thing('other'));
    room.addItem(sword);

    expect(room.findByOid('sword-oid')).toBe(sword);
    expect(room.findByOid('nope')).toBeUndefined();
  });

  it('addItem 对已在手的内容物是 no-op（不重复入栈）', () => {
    const room = new Box('room1');
    const sword = new Thing('i1');
    room.addItem(sword);
    room.addItem(sword);
    expect(room.itemCount).toBe(1);
  });
});

describe('engine/base · ★ 实例隔离（不做 Object.create 原型克隆）', () => {
  it('两个独立实例不共享"当前位置"', () => {
    const box = new Box('b');
    const a = new Thing('a');
    const c = new Thing('c');

    a.moveTo(box);

    expect(a.environment).toBe(box);
    expect(c.environment).toBeNull(); // 不受 a 影响
    expect(box.itemCount).toBe(1);
  });

  it('items 是只读视图，但长度随容器变化（调用方拿不到可写入的数组）', () => {
    const room = new Box('room1');
    const view = room.items;
    expect(view).toHaveLength(0);
    room.addItem(new Thing('i1'));
    expect(view).toHaveLength(1); // 同一引用的活视图
  });
});

describe('engine/base · toString', () => {
  it('无模板对象打印 (无模板) 与 oid', () => {
    expect(new Thing('abc').toString()).toBe('item:(无模板)(abc)');
  });
});

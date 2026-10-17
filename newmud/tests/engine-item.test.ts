/**
 * server/engine/item.ts —— 模板引用、交互面与四个搬运原语（B 批）
 * ============================================================================
 * 这批断言钉住 B 批新增的**引擎侧契约**（26 册 §53）：
 *   ① `Item` 持 `def` ⇒ 内容层钩子第一次可达（在此之前 `ItemDef.on_use` 等
 *      「内容写了、引擎够不着」）；
 *   ② `interact` 是 `def` 的**原样投影**（不做 `=== true` 归一 —— 归一就会多出
 *      第二份真相）；
 *   ③ `takeItem` / `dropItem` / `spendItem` / `spendMoney` 的真语义：
 *      容量判定、双向绑定、**失败时不产生任何副作用**（原子性）、归零即销毁。
 *
 * ★ 为什么这些用**真的 `Player` / `Room`** 而不是替身：被钉的正是"位置一致性"
 *   与"容量"这两件**引擎**负责的事。替身会把这批断言变成"我假装的实现如我所愿"。
 * ★ 四条**指令**的行为（文案 / 闸门 / 三级分发）在 `tests/item-command.test.ts`。
 */
import { describe, expect, it } from 'vitest';

import { CharacterError, RecordingOutput } from '../server/engine/character.js';
import { Item } from '../server/engine/item.js';
import { Npc } from '../server/engine/npc.js';
import { Player } from '../server/engine/player.js';
import { Room } from '../server/engine/room.js';
import { emptySkillRegistry } from '../server/engine/skill.js';
import type { ItemDef, NpcDef } from '../server/world/defs.js';
import { asWorldId } from '../shared/ids.js';

// ---------------------------------------------------------------------------
// 夹具
// ---------------------------------------------------------------------------

let seq = 0;
const nextOid = (): string => `t${String((seq += 1))}`;

/** 合法 id：`yz` 不是保留 area（`item` / `npc` 这些 kind 名是，见 `shared/ids.ts`） */
const WID = (raw: string) => asWorldId(raw, 'engine-item.test');

function makeItem(opts: { name?: string; def?: ItemDef; count?: number } = {}): Item {
  return new Item({
    oid: nextOid(),
    path: WID('drug/yao'),
    name: opts.name ?? '丹药',
    def: opts.def,
    count: opts.count,
  });
}

function makeRoom(maxItems?: number): Room {
  return new Room({
    oid: nextOid(),
    path: WID('yz/lab'),
    name: '试验室',
    desc: '一间只给测试用的房间。',
    maxItems,
  });
}

function makePlayer(maxItems?: number): { player: Player; out: RecordingOutput } {
  const out = new RecordingOutput();
  const player = new Player({
    oid: nextOid(),
    path: null,
    name: '阿飞',
    roleId: 'feige',
    maxItems,
    output: out,
  });
  return { player, out };
}

function makeNpc(def: NpcDef): Npc {
  return new Npc({
    oid: nextOid(),
    path: WID('pub/xiaoer'),
    name: def.name,
    def,
    skillRegistry: emptySkillRegistry(),
  });
}

// ---------------------------------------------------------------------------

describe('item · 模板引用（`def`）与交互面（`interact`）', () => {
  it('没有 def 的实例：`def` 与 `interact` 都是 undefined', () => {
    const bare = makeItem();
    expect(bare.def).toBeUndefined();
    expect(bare.interact).toBeUndefined();
  });

  it('有 def：`def` 就是那个模板对象本身（不是复制品）', () => {
    const def: ItemDef = { name: '丹药', no_get: true };
    const item = makeItem({ def });
    expect(item.def).toBe(def);
  });

  it('`interact` 逐字段反映 `def` 的开关与钩子', () => {
    const onUse = (): void => undefined;
    const onGet = (): boolean => true;
    const def: ItemDef = {
      name: '丹药',
      no_get: true,
      no_drop: true,
      no_consume: true,
      on_use: onUse,
      on_get: onGet,
    };
    const face = makeItem({ def }).interact;
    expect(face?.noGet).toBe(true);
    expect(face?.noDrop).toBe(true);
    expect(face?.noConsume).toBe(true);
    expect(face?.onUse).toBe(onUse);
    expect(face?.onGet).toBe(onGet);
  });

  it('★ 缺席的开关保持 `undefined`，**不归一成 false**（判据留给调用点写 `=== true`）', () => {
    const face = makeItem({ def: { name: '丹药' } }).interact;
    expect(face).toBeDefined();
    expect(face?.noGet).toBeUndefined();
    expect(face?.noDrop).toBeUndefined();
    expect(face?.noConsume).toBeUndefined();
    expect(face?.onUse).toBeUndefined();
  });

  it('★ 只有物品那几项：NPC 的交互面里没有 `noGet` / `onUse`（那是物品专属的命题）', () => {
    const onAccept = (): boolean => true;
    const npc = makeNpc({ name: '店小二', desc: '一个店小二。', on_accept: onAccept });
    expect(npc.interact.onAccept).toBe(onAccept);
    expect(npc.interact.noGet).toBeUndefined();
    expect(npc.interact.onUse).toBeUndefined();
  });

  it('NPC 没有 `on_accept` 时交互面在场但为空（不必再判 undefined）', () => {
    const npc = makeNpc({ name: '路人', desc: '一个路人。' });
    expect(npc.interact.onAccept).toBeUndefined();
  });
});

describe('item · takeItem（收进我身上）', () => {
  it('物品从房间进到玩家身上（双向绑定两侧一致）', () => {
    const room = makeRoom();
    const { player } = makePlayer();
    room.addItem(player);
    const pill = makeItem();
    room.addItem(pill);

    expect(player.takeItem(pill)).toBe(true);
    expect(player.items).toEqual([pill]);
    expect(room.items).not.toContain(pill);
    expect(pill.environment).toBe(player);
  });

  it('★ 我装不下时返回 false，且物品**仍在原处**（失败不留半个动作）', () => {
    const room = makeRoom();
    const { player } = makePlayer(0); // 容量 0
    room.addItem(player);
    const pill = makeItem();
    room.addItem(pill);

    expect(player.takeItem(pill)).toBe(false);
    expect(player.items).toEqual([]);
    expect(room.items).toContain(pill);
    expect(pill.environment).toBe(room);
  });

  it('★ 非物品一律 false（`instanceof Item` 守卫）——`ActorObject` 是结构视图，谁都能满足它', () => {
    const room = makeRoom();
    const { player } = makePlayer();
    room.addItem(player);
    const npc = makeNpc({ name: '店小二', desc: '一个店小二。' });
    room.addItem(npc);

    expect(player.takeItem(npc)).toBe(false);
    expect(room.items).toContain(npc);
  });
});

describe('item · dropItem（放到我所在的房间）', () => {
  it('物品从我身上落到房间（双向绑定两侧一致）', () => {
    const room = makeRoom();
    const { player } = makePlayer();
    room.addItem(player);
    const pill = makeItem();
    player.addItem(pill);

    expect(player.dropItem(pill)).toBe(true);
    expect(room.items).toContain(pill);
    expect(player.items).toEqual([]);
    expect(pill.environment).toBe(room);
  });

  it('★ 房间满了返回 false，且物品**仍在我身上**', () => {
    const room = makeRoom(1); // 容量 1：被玩家占掉
    const { player } = makePlayer();
    room.addItem(player);
    const pill = makeItem();
    player.addItem(pill);

    expect(player.dropItem(pill)).toBe(false);
    expect(player.items).toEqual([pill]);
    expect(room.items).toEqual([player]);
  });

  it('不在任何房间时返回 false（游戏内构造上不可达，仍要有确定行为）', () => {
    const { player } = makePlayer();
    const pill = makeItem();
    player.addItem(pill);
    expect(player.dropItem(pill)).toBe(false);
    expect(player.items).toEqual([pill]);
  });
});

describe('item · spendItem（从我身上失去 n 个）', () => {
  it('默认扣 1 个：数量 3 → 2，物品还在身上', () => {
    const { player } = makePlayer();
    const pill = makeItem({ count: 3 });
    player.addItem(pill);

    expect(player.spendItem(pill)).toBe(true);
    expect(pill.count).toBe(2);
    expect(player.items).toEqual([pill]);
  });

  it('★ 扣到 0 即销毁：从容器里摘掉，不留 count=0 的幽灵', () => {
    const { player } = makePlayer();
    const pill = makeItem({ count: 2 });
    player.addItem(pill);

    expect(player.spendItem(pill, 2)).toBe(true);
    expect(pill.isDepleted).toBe(true);
    expect(player.items).toEqual([]);
    expect(pill.environment).toBeNull();
  });

  it('数量不够返回 false，且**一个都不扣**（不部分扣减）', () => {
    const { player } = makePlayer();
    const pill = makeItem({ count: 2 });
    player.addItem(pill);

    expect(player.spendItem(pill, 3)).toBe(false);
    expect(pill.count).toBe(2);
    expect(player.items).toEqual([pill]);
  });

  it('数量不是"≥1 的整数"时**抛错**（这些是编程错误，不是玩家输入）', () => {
    const { player } = makePlayer();
    const pill = makeItem({ count: 2 });
    player.addItem(pill);

    expect(() => player.spendItem(pill, 0)).toThrow(CharacterError);
    expect(() => player.spendItem(pill, 1.5)).toThrow(CharacterError);
    expect(pill.count).toBe(2);
  });

  it('非物品返回 false', () => {
    const { player } = makePlayer();
    const npc = makeNpc({ name: '路人', desc: '一个路人。' });
    expect(player.spendItem(npc)).toBe(false);
  });
});

describe('item · spendMoney（掏钱）', () => {
  it('钱够就扣', () => {
    const { player } = makePlayer();
    player.money = 1000;
    expect(player.spendMoney(300)).toBe(true);
    expect(player.money).toBe(700);
  });

  it('钱不够返回 false，且**一分不动**', () => {
    const { player } = makePlayer();
    player.money = 100;
    expect(player.spendMoney(101)).toBe(false);
    expect(player.money).toBe(100);
  });

  it('金额非法时抛错（≤0 / 非整数）', () => {
    const { player } = makePlayer();
    player.money = 100;
    expect(() => player.spendMoney(0)).toThrow(CharacterError);
    expect(() => player.spendMoney(10.5)).toThrow(CharacterError);
    expect(player.money).toBe(100);
  });
});

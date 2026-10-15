/**
 * 走不动的**四种**去向要说清楚（T2）
 * ============================================================================
 * 权威实现：wushen `os/char/chara_move.js:22-29` + `world/cmd/action/go.js`
 *
 *     if (next_room.is_full()) {
 *         next_room = next_room.create_shadow();
 *         if (!next_room) return this.notify("那里人太多了，你过不去。");
 *     }
 *
 * ★ T2 原始描述（26 册 §11.4）是"满房间会把 `ContainerError` 抛到调用栈上
 *   （网络层没接住就是断连）"。**落下之前它已经被 `try/catch` 拦住了**
 *   （`Character.go` 的注释里写着"按走不过去处理"），所以本轮真正要修的是三件小事：
 *
 *   ① **满员与"没路"给的是同一句话**。`go` 只回了一个 boolean，调用点只能
 *      笼统地说"那边过不去。" —— 玩家分不清是路不通还是人满。
 *      wushen 是**分开的两句**（`go.js:15` 的"这个方向没有出路。"
 *      vs `chara_move.js:27` 的"那里人太多了，你过不去。"）。
 *   ② **`try { moveTo } catch { return false }` 是 catch-all** ——
 *      `on_enter` / `on_leave` 里内容层抛的任何错误都会被静默翻译成"那边过不去"，
 *      真 bug 从此查不到。改成**预检查**（`isFull()`），异常一律照常往上抛。
 *   ③ 文案**写了两份**（`room.ts:108` 与 `move/go.ts:35` 一字不差）—— 收进一处。
 *
 * ★ 为什么满员要"预检查"而不是"接住异常"：`Container.addItem` 的抛错是给
 *   **内容 / 实例化路径**的 fail-fast（"内容写错了"该当场炸）；而"玩家走进一个
 *   满房间"是**正常运行时事件**。两种语义不该挤在同一个出口上。
 */
import { describe, expect, it } from 'vitest';

import { Container } from '../server/engine/base.js';
import { RecordingOutput } from '../server/engine/character.js';
import { Item } from '../server/engine/item.js';
import { Npc } from '../server/engine/npc.js';
import { Player } from '../server/engine/player.js';
import { Room } from '../server/engine/room.js';
import { SkillRegistry } from '../server/engine/skill.js';
import { asWorldId } from '../shared/ids.js';
import { MOVE_MESSAGES } from '../shared/constants.js';
import type { NpcDef, RoomDef } from '../server/world/defs.js';

function makeRoom(id: string, maxItems?: number, def?: RoomDef): Room {
  return new Room({
    oid: `room-${id}`,
    path: asWorldId(`yz/${id}`, 'move-full.test:room'),
    name: `房间${id}`,
    desc: '用于 T2 回归的房间。',
    maxItems,
    def,
  });
}

function makePlayer(oid: string, name: string): { player: Player; out: RecordingOutput } {
  const out = new RecordingOutput();
  const player = new Player({ oid, path: null, roleId: name, name, output: out });
  return { player, out };
}

/**
 * 一个房间里的**活体**（NPC）—— FG-16 的夹具。
 * 只有活体才在 `def` 上挂进出钩子（`Item` / `Player` 都不持 `def`），
 * 这正是"谁该被 `ROOM.item_changed` 调到"的判据本身。
 */
function makeNpc(oid: string, name: string, hooks: Pick<NpcDef, 'on_enter' | 'on_leave'>): Npc {
  return new Npc({
    oid,
    path: asWorldId(`yz/${oid}`, 'move-full.test:npc'),
    name,
    def: { name, desc: `用于 FG-16 的活体：${name}` , ...hooks },
    skillRegistry: new SkillRegistry([]),
  });
}

/** 起一个"源房间 → 北 → 目标房间"的三件套 */
function pair(maxItems: number, fromDef?: RoomDef): { from: Room; to: Room } {
  const from = makeRoom('from', undefined, fromDef);
  const to = makeRoom('to', maxItems);
  from.linkExit('north', to);
  return { from, to };
}

describe('T2 · 容器容量判据只有一处（`isFull`）', () => {
  it('isFull() 与 addItem 的抛错阈值一致（不写第二遍 `>= maxItems`）', () => {
    const room = makeRoom('cap', 2);
    expect(room.isFull()).toBe(false);
    room.addItem(makePlayer('p-1', '甲').player);
    expect(room.isFull()).toBe(false);
    room.addItem(makePlayer('p-2', '乙').player);
    expect(room.isFull()).toBe(true);
    // 满了再塞就抛 —— 与 `isFull()` 说的是同一件事
    expect(() => room.addItem(makePlayer('p-3', '丙').player)).toThrow();
  });
});

describe('T2 · go() 的四种去向', () => {
  it('目标房间满员：返回 full，**不抛异常、也不移动**', () => {
    const { from, to } = pair(1);
    const blocker = makePlayer('p-blocker', '占位的');
    blocker.player.moveTo(to);
    expect(to.isFull()).toBe(true);

    const a = makePlayer('p-a', '阿飞');
    a.player.moveTo(from);

    const r = a.player.go('north');
    expect(r).toEqual({ ok: false, reason: 'full' });
    expect(a.player.environment).toBe(from); // 人还在原地
    expect(to.items).not.toContain(a.player);
  });

  it('那个方向没有出口：返回 no-exit（wushen go.js:15「这个方向没有出路。」）', () => {
    const { from } = pair(50);
    const a = makePlayer('p-a', '阿飞');
    a.player.moveTo(from);

    expect(a.player.go('south')).toEqual({ ok: false, reason: 'no-exit' });
  });

  it('内容在 on_leave 里拦住：返回 blocked', () => {
    const { from } = pair(50, { name: '源', desc: 'x', on_leave: () => false });
    const a = makePlayer('p-a', '阿飞');
    a.player.moveTo(from);

    expect(a.player.go('north')).toEqual({ ok: false, reason: 'blocked' });
  });

  it('走得动：返回 ok，并且真的到了', () => {
    const { from, to } = pair(50);
    const a = makePlayer('p-a', '阿飞');
    a.player.moveTo(from);

    expect(a.player.go('north')).toEqual({ ok: true });
    expect(a.player.environment).toBe(to);
  });

  it('★ 自环出口根本连不上 —— 这就是 `MoveBlock` 里没有 "self" 那一档的**理由**', () => {
    const r = makeRoom('loop');
    // §11.4 原建议给了 `reason: 'self'`，但它没有可命中的输入：
    // `linkExit` 先一步把自环拒了，所以 `go()` 里的 `target` 恒 !== `from`。
    // 少了这条，上面那句注释就只是"我说它是多余的"（FG-19）。
    expect(() => r.linkExit('north', r)).toThrow(/指向自己/);
  });
});

describe('T2 · 提示语按原因分开（wushen 是两句，不是一句）', () => {
  it('裸方向词（房间派生的动作）在满员时说"人太多"，不是笼统的"过不去"', () => {
    const { from, to } = pair(1);
    makePlayer('p-blocker', '占位的').player.moveTo(to);

    const a = makePlayer('p-a', '阿飞');
    a.player.moveTo(from);

    const north = from.actions.find((x) => x.cmd === 'north');
    expect(north).toBeDefined();
    north!.run(a.player);

    expect(a.out.messages).toEqual([MOVE_MESSAGES.full]);
  });

  it('裸方向词在"内容拦住"时说另一句（不是"人太多"）', () => {
    const { from } = pair(50, { name: '源', desc: 'x', on_leave: () => false });
    const a = makePlayer('p-a', '阿飞');
    a.player.moveTo(from);

    const north = from.actions.find((x) => x.cmd === 'north');
    north!.run(a.player);

    expect(a.out.messages).toEqual([MOVE_MESSAGES.blocked]);
    expect(MOVE_MESSAGES.blocked).not.toBe(MOVE_MESSAGES.full);
  });
});

describe('T2 · 三种失败判定的**顺序**与 wushen 一致（可观察：谁被调用、说什么）', () => {
  /**
   * wushen 的判定顺序是**两段**，不在同一处：
   *   ① `world/cmd/action/go.js:15`  —— 先查出口（`if (!rm) "这个方向没有出路。"`）
   *   ② `os/char/chara_move.js:22` → `:30` —— 再查满员（`is_full`），**最后**才 `do_leave`
   *
   * 顺序不是风格问题：`on_leave` 是**内容层的代码**，可能有副作用（扣道具、发提示）。
   * 顺序错了 = 一次**失败**的移动也会跑到内容层的钩子里，而 wushen 不会。
   */
  function trace(opts: { exit: boolean; full: boolean; leaveFalse: boolean }) {
    const calls: string[] = [];
    const from = makeRoom(
      'src',
      undefined,
      opts.leaveFalse
        ? {
            name: '源',
            desc: 'x',
            on_leave: () => {
              calls.push('on_leave');
              return false;
            },
          }
        : {
            name: '源',
            desc: 'x',
            on_leave: () => {
              calls.push('on_leave');
              return true;
            },
          },
    );
    const to = makeRoom('dst', opts.full ? 1 : 50);
    if (opts.exit) from.linkExit('north', to);
    if (opts.full) to.addItem(makePlayer('p-blocker', '占位的').player);

    const a = makePlayer('p-a', '阿飞');
    a.player.moveTo(from);
    return { a: a.player, calls, dir: (opts.exit ? 'north' : 'south') as 'north' };
  }

  it('没出口时：说 `no-exit`，且**不**碰 `on_leave`（哪怕它本来会拦住）', () => {
    const { a, calls, dir } = trace({ exit: false, full: false, leaveFalse: true });
    expect(a.go(dir)).toEqual({ ok: false, reason: 'no-exit' });
    expect(calls).toEqual([]); // ← 顺序错了这里会是 ['on_leave']
  });

  it('目标满员时：说 `full`，且**不**碰 `on_leave`', () => {
    const { a, calls } = trace({ exit: true, full: true, leaveFalse: true });
    expect(a.go('north')).toEqual({ ok: false, reason: 'full' });
    expect(calls).toEqual([]); // ← 顺序错了这里会是 ['on_leave']
  });

  it('前两关都过了才轮到内容层：`on_leave` 恰好被调一次，说 `blocked`', () => {
    const { a, calls } = trace({ exit: true, full: false, leaveFalse: true });
    expect(a.go('north')).toEqual({ ok: false, reason: 'blocked' });
    expect(calls).toEqual(['on_leave']);
  });
});

describe('T2 · 删掉 catch-all 真的买到了东西（异常不再被吞）', () => {
  /**
   * ★ 这两条是"删掉 `try { moveTo } catch { return false }`"的**唯一判据**。
   *   只写"满员时说人太多"的话，一个把 catch-all 加回去的实现照样绿 ——
   *   catch-all 恰恰把满员也翻译成 `blocked`，而 `blocked` 有自己一句话。
   *   所以这里注入的是**内容层自己抛的错**，它没有"合理的用户可见译文"：
   *   唯一的正确行为就是往上抛。
   *
   * ★ 两条各管一种 catch-all（都实测过会红，见 26 册 §23.4）：
   *   ① 只包 `moveTo` + `fireEnter` 的**窄**版本 → 第一条抓（`on_enter` 在包里）；
   *   ② 把 `allowLeave` 一起包进去的**宽**版本 → 第二条抓（`on_leave` 也在包里）。
   */
  function reach(enterThrows: boolean, leaveThrows: boolean): { a: Player; to: Room } {
    const from = makeRoom(
      'src',
      undefined,
      leaveThrows
        ? { name: '源', desc: 'x', on_leave: () => { throw new Error('内容写错了：on_leave'); } }
        : undefined,
    );
    const to = makeRoom(
      'dst',
      undefined,
      enterThrows
        ? { name: '目的地', desc: 'x', on_enter: () => { throw new Error('内容写错了：on_enter'); } }
        : undefined,
    );
    from.linkExit('north', to);
    const a = makePlayer('p-a', '阿飞');
    a.player.moveTo(from);
    return { a: a.player, to };
  }

  it('目标房间的 `on_enter` 抛错 → 往上抛，**不**被翻译成 `{ok:false,reason:"blocked"}`', () => {
    const { a } = reach(true, false);

    let returned: unknown;
    try {
      returned = a.go('north');
    } catch (e) {
      expect(String(e)).toContain('on_enter');
    }
    // ★ 分辨力就在这一行：旧 catch-all 会让 `returned` 变成 `{ok:false,reason:'blocked'}`
    expect(returned).toBeUndefined();
  });

  it('源房间的 `on_leave` 抛错 → 同样往上抛（不静默变成"那边过不去"）', () => {
    const { a } = reach(false, true);

    let returned: unknown;
    try {
      returned = a.go('north');
    } catch (e) {
      expect(String(e)).toContain('on_leave');
    }
    expect(returned).toBeUndefined();
  });
});

describe('T2 · 移动相关文案只有一份', () => {
  it('三个原因各有各的话，且互不相同', () => {
    const values = Object.values(MOVE_MESSAGES);
    expect(new Set(values).size).toBe(values.length);
  });

  it('`isFull()` 不吞异常：容量满了 addItem 仍然抛（fail-fast 那条路没被削弱）', () => {
    const room = makeRoom('strict', 1);
    room.addItem(makePlayer('p-1', '甲').player);
    expect(() => room.addItem(makePlayer('p-2', '乙').player)).toThrow(/已满/);
  });

  it('`Container` 的公共面确实暴露了 isFull（不是只在 Room 上有）', () => {
    const room = makeRoom('api', 1);
    expect(room instanceof Container).toBe(true);
    expect(typeof room.isFull).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// FG-16 · 房间里**活体**（NPC）的进出钩子
// ---------------------------------------------------------------------------
//
// 权威：wushen `ROOM.prototype.item_changed`（`os/room/room.js:29-56`）——
//
//     for (var i = 0; i < this.items.length; i++) {
//         var item = this.items[i];
//         if (item == obj) { obj_index = i; continue; }      // ← 跳过自己
//         if (item.is_player && isshow) { item.send(msg); … }
//         else {
//             if (obj.hp) {                                   // ← 进来的那个是活体
//                 if (isin && item.on_enter)  item.on_enter(obj);
//                 else if (!isin && item.on_leave) { if (item.on_leave(obj, dir) == false) return false; }
//             }
//         }
//     }
//
// 而 `do_enter` = `item_changed(obj,true)` **然后** `this.on_enter(obj)`；
// `do_leave` = `this.on_leave(obj,dir)` **然后** `item_changed(obj,false,…)`。
// 也就是说：**房间里活体的钩子与房间自己的钩子不是同一层**，各跑各的、顺序不同。
//
// ★ 本批之前 `room.ts#fireEnter` 只跑房间自己的 `on_enter` —— 于是内容里
//   `world/npc/pub/xiaoer.ts` 的「这位客官，要住店吗？」是一句**永远到不了玩家的台词**。
//   那是最典型的"内容写了、引擎没接"（与 FG-19 同族：文档/内容宣称了一个不存在的调用）。

describe('FG-16 · 房间里活体的 on_enter / on_leave（wushen `ROOM.item_changed`）', () => {
  it('玩家走进有 NPC 的房间 → 那个 NPC 的 `on_enter` 被调到（**恰好一次**）', () => {
    const calls: string[] = [];
    const { from, to } = pair(50);
    to.addItem(makeNpc('npc1', '店小二', { on_enter: () => calls.push('npc:on_enter') }));

    const a = makePlayer('p-a', '阿飞');
    a.player.moveTo(from);
    expect(a.player.go('north')).toEqual({ ok: true });

    // ★ 判据落在"**被调到的次数**"上：漏接是 []、重复接是两次，两种都会红
    expect(calls).toEqual(['npc:on_enter']);
  });

  it('★ 方向不搞混，且顺序照 wushen：房间钩子与活体钩子各在自己的时刻跑', () => {
    const calls: string[] = [];
    // `do_leave`: 房间 on_leave 先（`room.js:12`）→ 再 item_changed（活体 on_leave，`:51`）
    const from = makeRoom('src', undefined, {
      name: '源',
      desc: 'x',
      on_leave: () => {
        calls.push('src:room_leave');
        return true;
      },
    });
    // `do_enter`: item_changed（活体 on_enter，`:50`）先 → 再房间 on_enter（`room.js:27`）
    const to = makeRoom('dst', undefined, {
      name: '目标',
      desc: 'x',
      on_enter: () => calls.push('dst:room_enter'),
    });
    from.linkExit('north', to);
    from.addItem(
      makeNpc('npc_src', '源房人', {
        on_enter: () => calls.push('src:npc_enter'), // ← 离开时**不该**跑
        on_leave: () => {
          calls.push('src:npc_leave');
        },
      }),
    );
    to.addItem(
      makeNpc('npc_dst', '目标房人', {
        on_enter: () => calls.push('dst:npc_enter'),
        on_leave: () => {
          calls.push('dst:npc_leave'); // ← 进入时**不该**跑
        },
      }),
    );

    const a = makePlayer('p-a', '阿飞');
    a.player.moveTo(from);
    expect(a.player.go('north')).toEqual({ ok: true });

    expect(calls).toEqual(['src:room_leave', 'src:npc_leave', 'dst:npc_enter', 'dst:room_enter']);
  });

  it('NPC 的 `on_leave` 返回 false → 走不动（`blocked`），且人**真的**没动', () => {
    const from = makeRoom('src');
    const to = makeRoom('dst');
    from.linkExit('north', to);
    from.addItem(makeNpc('npc_block', '拦路的', { on_leave: () => false }));

    const a = makePlayer('p-a', '阿飞');
    a.player.moveTo(from);

    expect(a.player.go('north')).toEqual({ ok: false, reason: 'blocked' });
    // 光看返回值不够：一个"先移过去再回头说 blocked"的实现也能过上面那行
    expect(a.player.environment).toBe(from);
    expect(to.items).not.toContain(a.player);
  });

  it('★ 跳过自己：移动者本人是活体时，不跑自己的 `on_enter`、也不被自己的 `on_leave` 拦住', () => {
    const calls: string[] = [];
    const from = makeRoom('src');
    const to = makeRoom('dst');
    from.linkExit('north', to);
    const mover = makeNpc('npc_m', '会走路的活体', {
      on_enter: () => calls.push('self:on_enter'),
      // 没跳过自己的实现会在这里被拦住（离开时自己的 on_leave 跑到了自己头上）
      on_leave: () => {
        calls.push('self:on_leave');
        return false;
      },
    });
    from.addItem(mover);

    expect(mover.go('north')).toEqual({ ok: true });
    expect(calls).toEqual([]);
    expect(mover.environment).toBe(to);
  });

  it('★ 反向对照：房间里只有**非活体**（没有 def 的东西）时，一个钩子都不该跑', () => {
    const calls: string[] = [];
    const { from, to } = pair(50);
    // 地面物件不是活体 —— wushen 的判据 `item.on_enter` 在它身上根本不存在
    const item = new Item({ oid: 'it-1', path: asWorldId('drug/yao', 'move-full.test:item'), name: '丹药' });
    to.addItem(item);

    const a = makePlayer('p-a', '阿飞');
    a.player.moveTo(from);
    expect(a.player.go('north')).toEqual({ ok: true });
    // 这条用例的"反向"在于：实现若把 `items` 里**任何**对象都当活体，
    // 就会去读 `item.def.on_enter` 而炸出 TypeError（异常会一路抛到 go() 外面）
    expect(calls).toEqual([]);
    expect(to.items).toContain(item);
  });
});

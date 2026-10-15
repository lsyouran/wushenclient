/**
 * engine/character.ts · `sendRoom` —— 房间广播的**三视角分派**（T16）
 * ============================================================================
 * 权威实现：wushen `os/char/character.js:71-87` 的 `CHARACTER.prototype.send_room`。
 *
 * ★ 与改造前的一处**语义修复**（本文件第三条用例钉住）：
 *   改造前 `sendRoom` 只发给"同房间的**其他**玩家"，**说话者自己收不到** ——
 *   而 wushen 的 `excludeself` 缺省是 falsy，本人**应当**收到本人视角那一句
 *   （`send_room` 的第一个分支就是 `list[i] === this` → `type=1`）。
 *   旧行为等于把 `excludeself` 永久钉死为 `true`，且没有第二人称改写。
 *
 * ★ 另一处修复：NPC 的广播此前**发不出去**。旧实现把投递交给会话层
 *   （`session.ts#broadcast` 遍历**连接**），而 NPC 没有连接 ⇒ 内容层将来写
 *   `me.sendRoom('$N说道：…')` 会静默消失。现在遍历的是**房间里的角色对象**，
 *   玩家的 `notify` 自己会找到各自的连接，NPC 说话因此天然可达。
 */
import { describe, expect, it } from 'vitest';

import { asWorldId } from '../shared/ids.js';
import type { Gender } from '../shared/constants.js';
import { RecordingOutput } from '../server/engine/character.js';
import { Npc } from '../server/engine/npc.js';
import { Player } from '../server/engine/player.js';
import { Room } from '../server/engine/room.js';
import { SkillRegistry } from '../server/engine/skill.js';
import type { NpcDef, RoomDef } from '../server/world/defs.js';

const NO_SKILLS = new SkillRegistry([]);

function makeRoom(): Room {
  const def: RoomDef = { name: '测试房间', desc: '用于 sendRoom 回归的房间。' };
  return new Room({
    oid: 'room-sendroom',
    path: asWorldId('yz/sendroom', 'engine-sendroom.test:room'),
    name: def.name,
    desc: def.desc,
    def,
  });
}

interface MadePlayer {
  readonly player: Player;
  readonly out: RecordingOutput;
}

function makePlayer(oid: string, name: string, gender: Gender = 0): MadePlayer {
  const out = new RecordingOutput();
  const player = new Player({ oid, path: null, roleId: name, name, gender, output: out });
  return { player, out };
}

function makeNpc(oid: string, name: string): { npc: Npc; out: RecordingOutput } {
  const out = new RecordingOutput();
  const def: NpcDef = { name, desc: '用于 sendRoom 回归的 NPC。' };
  const npc = new Npc({
    oid,
    path: asWorldId('pub/sendroomnpc', 'engine-sendroom.test:npc'),
    name,
    def,
    skillRegistry: NO_SKILLS,
    output: out,
  });
  return { npc, out };
}

describe('sendRoom · 同一句话，三个人看到三句', () => {
  it('本人 / 目标 / 旁人 各拿到自己那一句（wushen type 1/2/3）', () => {
    const room = makeRoom();
    const a = makePlayer('p-a', '阿飞', 1);
    const b = makePlayer('p-b', '慕容', 0);
    const c = makePlayer('p-c', '路人');
    a.player.moveTo(room);
    b.player.moveTo(room);
    c.player.moveTo(room);

    a.player.sendRoom('$N朝$n拱了拱手。', b.player);

    expect(a.out.messages).toEqual(['你朝慕容拱了拱手。']);
    expect(b.out.messages).toEqual(['阿飞朝你拱了拱手。']);
    expect(c.out.messages).toEqual(['阿飞朝慕容拱了拱手。']);
  });

  it('$P 走第三人称称谓（gender=1 → 他，gender=0 → 她）', () => {
    const room = makeRoom();
    const a = makePlayer('p-a', '阿飞', 1);
    const c = makePlayer('p-c', '路人');
    a.player.moveTo(room);
    c.player.moveTo(room);

    a.player.sendRoom('$P拂袖而去。', null);
    expect(c.out.messages).toEqual(['他拂袖而去。']);
  });
});

describe('sendRoom · excludeself（wushen 的第三个实参）', () => {
  it('excludeself = true 时本人收不到，旁人照收第三人称', () => {
    const room = makeRoom();
    const a = makePlayer('p-a', '阿飞');
    const c = makePlayer('p-c', '路人');
    a.player.moveTo(room);
    c.player.moveTo(room);

    a.player.sendRoom('$N走了。', null, true);

    expect(a.out.messages).toEqual([]);
    expect(c.out.messages).toEqual(['阿飞走了。']);
  });
});

describe('sendRoom · 受众是「房间里的玩家角色」', () => {
  it('NPC 不在受众里（wushen 的 `is_player` 过滤）', () => {
    const room = makeRoom();
    const a = makePlayer('p-a', '阿飞');
    const n = makeNpc('npc-a', '店小二');
    a.player.moveTo(room);
    n.npc.moveTo(room);

    a.player.sendRoom('$N喊了一声。');

    expect(n.out.messages).toEqual([]);
  });

  it('NPC 说话能到达房间里的玩家（内容层台词的通道）', () => {
    const room = makeRoom();
    const a = makePlayer('p-a', '阿飞');
    const n = makeNpc('npc-a', '店小二');
    a.player.moveTo(room);
    n.npc.moveTo(room);

    n.npc.sendRoom('$N说道：客官请。');

    expect(a.out.messages).toEqual(['店小二说道：客官请。']);
  });

  it('target 不在本房间时，其余人只拿第三人称（不会有人拿到"你"）', () => {
    const room = makeRoom();
    const b = makePlayer('p-b', '慕容');
    const a = makePlayer('p-a', '阿飞');
    const outsider = makePlayer('p-x', '外人');
    b.player.moveTo(room);
    a.player.moveTo(room);

    b.player.sendRoom('$N拍了拍$n。', outsider.player);

    expect(b.out.messages).toEqual(['你拍了拍外人。']);
    expect(a.out.messages).toEqual(['慕容拍了拍外人。']);
  });
});

describe('sendRoom · 边界', () => {
  it('不在任何房间里：静默返回，不抛错', () => {
    const lonely = makePlayer('p-lonely', '孤独');
    lonely.player.sendRoom('$N叹了口气。');
    expect(lonely.out.messages).toEqual([]);
  });

  it('空文本：无输出（wushen `if (!this.environment || !text) return`）', () => {
    const room = makeRoom();
    const a = makePlayer('p-a', '阿飞');
    a.player.moveTo(room);
    a.player.sendRoom('');
    expect(a.out.messages).toEqual([]);
  });

  it('没有占位符的文案对所有人一致', () => {
    const room = makeRoom();
    const a = makePlayer('p-a', '阿飞');
    const c = makePlayer('p-c', '路人');
    a.player.moveTo(room);
    c.player.moveTo(room);

    a.player.sendRoom('房间里静了下来。', null);

    expect(a.out.messages).toEqual(['房间里静了下来。']);
    expect(c.out.messages).toEqual(['房间里静了下来。']);
  });
});

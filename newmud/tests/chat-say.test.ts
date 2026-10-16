/**
 * `say` 走**房间广播**，不走频道（26 册 §24，闭合 §22.7 的待定项）
 * ============================================================================
 * 权威实现：wushen `world/cmd/channel/say.js`
 *
 *     this.enter = function (me, msg) {
 *         if (!msg) return me.send_room("$N在自言自语的说些什么。");   // :11
 *         ...
 *         if (msg.length > 200) return me.notify("你说的太多了。");      // :20
 *         return me.send_room("$N说：" + UTIL.htmlEncode(msg));         // :22
 *     }
 *
 * ★ 判据不是"我觉得房间广播更好"，而是**wushen 的频道区里没有「房间」这一档**：
 *   ① `src/dialog/channel.js` 的页签闭集 = 全部/世界/队伍/门派/全区/帮派/系统；
 *   ② 同一文件 `createElement` 的 `switch (data.ch)` = tm/fam/rumor/sys/es/pty + default
 *      —— `say` 落进去只会显示成【闲聊】；
 *   ③ `src/settings` 的 `channel_*` 开关同样只有 chat/tm/fam/es/pty/sys。
 *   ⇒ 跨房间的才叫"频道"，房间内说话走 `send_room`（进**主消息流**）。
 *
 * ★ 顺带钉住两件同源的事（都属于"频道闭集被塞进了不该在里面的东西"）：
 *   - 闭集里**不该有 `say`**：它在本项目改走 `sendRoom` 之后就没有生产者了；
 *   - 闭集里**不该有 `emote`**：wushen 的 `emote` 是**包类型**
 *     （`world/cmd/channel/emote.js:79` → `{type:'emote',items:[…]}`，即表情清单），
 *     不是 `msg` 帧的 `ch`。本项目已另有 `emote` 包与对应 handler。
 *
 * 用真实内容（`bootstrapWorld()`）+ 真 `dispatch`：`say` 的效果是"谁收到了什么"，
 * 那只有在**真房间**里才谈得上（合成夹具会掩盖房间挂载问题，同 `look-remark.test.ts`）。
 */
import { beforeAll, describe, expect, it } from 'vitest';

import { bootstrapWorld } from '../server/bootstrap.js';
import { RecordingOutput } from '../server/engine/character.js';
import { dispatch } from '../server/engine/command.js';
import { Player } from '../server/engine/player.js';
import type { Room } from '../server/engine/room.js';
import type { World } from '../server/engine/world.js';
import { CHANNELS, CHAT_MAX_LENGTH, CHAT_TOO_LONG } from '../shared/constants.js';
import { ChannelSchema } from '../shared/protocol.js';

let world: World;

beforeAll(() => {
  world = bootstrapWorld().world;
});

interface MadePlayer {
  readonly player: Player;
  readonly out: RecordingOutput;
}

function playerIn(name: string, room?: Room): MadePlayer {
  const out = new RecordingOutput();
  const player = new Player({ oid: `oid-say-${name}`, path: null, roleId: name, name, output: out });
  const dest = room ?? world.startRoom;
  if (dest === null || dest === undefined) throw new Error('房间缺失：bootstrapWorld 没给出 startRoom');
  player.moveTo(dest);
  return { player, out };
}

function startRoom(): Room {
  const r = world.startRoom;
  if (r === null) throw new Error('起始房间缺失');
  return r;
}

/** 说一句，返回是否被分发（真内容里 `say` 必须存在） */
function say(me: Player, text: string): void {
  const r = dispatch(world.commands, me, text);
  expect(r.kind).toBe('executed');
}

describe('say · 房间广播 + 三视角（wushen `say.js:18`）', () => {
  it('★ `say 你好` → 本人读「你说」、同房的人读「<名字>说」（同一句话，各看各的）', () => {
    const a = playerIn('甲');
    const b = playerIn('乙');
    const c = playerIn('丙');

    say(a.player, 'say 你好');

    expect(a.out.messages).toEqual(['你说：你好']);
    expect(b.out.messages).toEqual(['甲说：你好']);
    expect(c.out.messages).toEqual(['甲说：你好']);
  });

  it('★★ `say` **不产生任何频道消息** —— 它就是这次修复的判据本身', () => {
    const a = playerIn('甲');
    const b = playerIn('乙');

    say(a.player, 'say 你好');

    // 走 `sendChannel` 的实现会在这里留下一档；走 `sendRoom` 的不会
    expect(a.out.channelMessages).toEqual([]);
    expect(b.out.channelMessages).toEqual([]);
    expect(a.out.messages).toHaveLength(1);
  });

  it('`say` 不越出房间：只把话留在房间里', () => {
    const a = playerIn('甲');
    const away = startRoom().exitTo('north');
    if (away === undefined) throw new Error('起始房间没有 north 出口：这条用例失去对照');
    const far = playerIn('远方', away);

    say(a.player, 'say 你好');

    expect(far.out.messages).toEqual([]);
    expect(far.out.channelMessages).toEqual([]);
  });
});

describe('say · 无参数是**房间广播的自言自语**，不是本地用法提示（wushen `say.js:8`）', () => {
  /**
   * ★ 这条是**语义反转**：改前是 `me.notify('你想说什么？用法：说 <内容>')`
   *   —— 只有自己看得到，房间里没人知道你开口了。
   *   wushen 把它做成一个**社交动作**（"自言自语也是一种表达"），所以是房间广播。
   *   对照另两条同族指令的分歧本身就是证据：`go.js:7` 无参是 `notify("你要往哪里走？")`（只自己看），
   *   `chat.js:8` 无参是 `return;`（静默）—— 三条各写各的，`say` 那条是**有语义**的。
   */
  it('`say`（无内容）→ 全房间都看到「……在自言自语的说些什么。」', () => {
    const a = playerIn('甲');
    const b = playerIn('乙');

    say(a.player, 'say');

    expect(a.out.messages).toEqual(['你在自言自语的说些什么。']);
    expect(b.out.messages).toEqual(['甲在自言自语的说些什么。']);
    expect(b.out.channelMessages).toEqual([]);
  });
});

describe('say · 长度上限（wushen `say.js:11`）', () => {
  it(`★ 正好 ${CHAT_MAX_LENGTH} 字放行（边界在上限**之内**：wushen 是 \`length > 200\`）`, () => {
    const a = playerIn('甲');
    const b = playerIn('乙');
    const body = '啊'.repeat(CHAT_MAX_LENGTH);

    say(a.player, `say ${body}`);

    expect(b.out.messages).toEqual([`甲说：${body}`]);
  });

  it(`超一个字被拒：只剩自己听到「${CHAT_TOO_LONG}」，房间里静悄悄`, () => {
    const a = playerIn('甲');
    const b = playerIn('乙');
    const body = '啊'.repeat(CHAT_MAX_LENGTH + 1);

    say(a.player, `say ${body}`);

    expect(a.out.messages).toEqual([CHAT_TOO_LONG]);
    expect(b.out.messages).toEqual([]);
    expect(b.out.channelMessages).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// S10（2026-10-16 审查）：`tell` 漏了 `CHAT_MAX_LENGTH`
// ---------------------------------------------------------------------------
//
// `say` / `shout` 都有 200 字上限，唯独 `tell` 没有 —— 于是长私聊一路走到入站明文
// 上限（`MAX_PLAINTEXT_CHARS = 256`）才被拒，而**那条拒绝走的是 `loginerror` 通道**：
// 玩家在游戏中被甩回登录页，还看不到"你说的话太长"这个真实原因。
// ⇒ 补上与 `say`/`shout` **同一条** `CHAT_MAX_LENGTH` 与**同一句**提示。
describe('tell · 长度上限（★ S10：与 say/shout 共用 CHAT_MAX_LENGTH）', () => {
  it('★ 超一个字被拒：只剩自己听到提示，**不产生任何频道消息**', () => {
    const a = playerIn('甲');
    const body = '啊'.repeat(CHAT_MAX_LENGTH + 1);

    const r = dispatch(world.commands, a.player, `tell 乙 ${body}`);

    expect(r.kind).toBe('executed');
    expect(a.out.messages).toEqual([CHAT_TOO_LONG]);
    expect(a.out.channelMessages).toEqual([]);
  });

  it('【反向锚点】正好 CHAT_MAX_LENGTH 放行（界线与 say/shout 同口径）', () => {
    const a = playerIn('甲');
    const body = '啊'.repeat(CHAT_MAX_LENGTH);

    dispatch(world.commands, a.player, `tell 乙 ${body}`);

    expect(a.out.messages).toEqual([]);
    expect(a.out.channelMessages).toEqual([{ ch: 'tell', content: body, to: '乙' }]);
  });
});

describe('频道闭集（`msg` 帧的 `ch`）里不该有的两档', () => {
  it('`say` 不在闭集里 —— 它走 `sendRoom`，走了频道才是这次的缺陷', () => {
    expect(CHANNELS as readonly string[]).not.toContain('say');
    expect(ChannelSchema.safeParse('say').success).toBe(false);
  });

  it('`emote` 不在闭集里 —— 它是**包类型**（表情清单），不是频道', () => {
    expect(CHANNELS as readonly string[]).not.toContain('emote');
    expect(ChannelSchema.safeParse('emote').success).toBe(false);
  });

  it('wushen 真有的那些跨房间频道还在（别把孩子跟脏水一起倒掉）', () => {
    for (const ch of ['chat', 'tm', 'fam', 'pty', 'es', 'rumor', 'sys', 'tell']) {
      expect(CHANNELS as readonly string[]).toContain(ch);
    }
  });
});

describe('世界频道：`chat` 是**玩家敲的那个词**（wushen `chat.js`，本项目原本只认 shout）', () => {
  /**
   * ★ 前端聊天输入带的「世界」页签 `composeChat` 产出的是 `<ch> <正文>`，
   *   即页签的 `data-ch` **直接当命令名**。页签写的是 `chat` ——
   *   于是本项目此前**「世界」页签是一个假按钮**：敲 `chat 你好` 回一句"什么？"。
   *   wushen 的 `world/cmd/channel/chat.js` 主名就是 `chat`，所以补上它既修了假按钮、
   *   又回到了原作的用词；`shout` / `yell` 保留为别名（不破坏已有玩家与测试）。
   */
  it('`chat 你好` 走世界频道（`msg` 帧 `ch=chat`）', () => {
    const a = playerIn('甲');

    say(a.player, 'chat 你好');

    expect(a.out.channelMessages).toEqual([{ ch: 'chat', content: '你好' }]);
    expect(a.out.messages).toEqual([]);
  });

  it('`shout` / `yell` 别名等价（同一个频道、同一份正文）', () => {
    const a = playerIn('甲');
    const b = playerIn('乙');

    say(a.player, 'shout 你好');
    say(b.player, 'yell 你好');

    expect(a.out.channelMessages).toEqual([{ ch: 'chat', content: '你好' }]);
    expect(b.out.channelMessages).toEqual([{ ch: 'chat', content: '你好' }]);
  });
});

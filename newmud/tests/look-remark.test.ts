/**
 * `look` 的**旁观播报**（T16 的第一个真实调用点）
 * ============================================================================
 * 权威实现：wushen `world/cmd/action/look.js:36-39`
 *
 *     if (obj.query_desc) {
 *         player.notify(obj.query_desc(player));
 *         if (obj != player)
 *             player.send_room(look_str.random(), obj, true);   // ← 就是这一行
 *     }
 *     var look_str = ["$N正盯着$n看，不知道在打什么主意。",
 *                     "$N笑眯眯的看着$n，不知道在想些什么。"];
 *
 * ★ 三个参数一个都不能少（这是它同时验证 T16 的原因）：
 *   ① `$N` / `$n` —— 三视角渲染（`engine/view-text.ts`）；
 *   ② `obj`        —— **被看的人**自己是第二人称（"阿飞正盯着**你**看"）；
 *   ③ `true`       —— `excludeself`：看东西的人**不**收到这句（他要的是详情，不是八卦）。
 *
 * ★ 为什么只有 `look` 播报、`select` 不播报：`grep send_room` 在 wushen
 *   `world/cmd/action/select.js` **零命中** —— "点一下"不该吵到整个房间，
 *   只有**主动**打 `look <目标>` 才说话。这是原作的区分，不是遗漏。
 *
 * 用真实内容（`bootstrapWorld()`）+ 真 `dispatch`：只有真世界才有可看的东西，
 * 合成夹具会掩盖"内容没登记 / 起始房间缺失"这类问题（与 `session.test.ts` 同一取向）。
 */
import { beforeAll, describe, expect, it } from 'vitest';

import { bootstrapWorld } from '../server/bootstrap.js';
import { RecordingOutput } from '../server/engine/character.js';
import { dispatch } from '../server/engine/command.js';
import { Player } from '../server/engine/player.js';
import { VIEW_OTHER, renderViewText } from '../server/engine/view-text.js';
import type { ViewSubject } from '../server/engine/view-text.js';
import type { World } from '../server/engine/world.js';
import { LOOK_REMARKS, pickRemark } from '@world/command/action/look.js';

let world: World;

beforeAll(() => {
  world = bootstrapWorld().world;
});

interface MadePlayer {
  readonly player: Player;
  readonly out: RecordingOutput;
}

function playerIn(name: string): MadePlayer {
  const out = new RecordingOutput();
  const player = new Player({ oid: `oid-look-${name}`, path: null, roleId: name, name, output: out });
  const room = world.startRoom;
  if (room === null) throw new Error('起始房间缺失：bootstrapWorld 没给出 startRoom');
  player.moveTo(room);
  return { player, out };
}

/** 两条文案 × 两个视角 —— 写成**字面量**，好让"文案被误改"也能被发现 */
const OTHER_SEES = [
  '阿飞正盯着慕容看，不知道在打什么主意。',
  '阿飞笑眯眯的看着慕容，不知道在想些什么。',
];
const TARGET_SEES = [
  '阿飞正盯着你看，不知道在打什么主意。',
  '阿飞笑眯眯的看着你，不知道在想些什么。',
];

describe('look · 旁观播报（wushen look.js:39）', () => {
  it('看别人：本人拿详情；被看的人读到"你"，旁人读到第三人称', () => {
    const a = playerIn('阿飞');
    const b = playerIn('慕容');
    const c = playerIn('路人');

    const r = dispatch(world.commands, a.player, 'look 慕容');
    expect(r.kind).toBe('executed');

    // 说话者拿到的是**详情**（走 `showItem` → `item` 帧），不是播报
    expect(a.out.items.map((d) => d.name)).toEqual(['慕容']);
    expect(a.out.messages).toEqual([]);

    expect(TARGET_SEES).toContain(b.out.messages[0]!);
    expect(OTHER_SEES).toContain(c.out.messages[0]!);
  });

  it('excludeself：看东西的人自己不收到那一句（他要的是详情）', () => {
    const a = playerIn('阿飞');
    const b = playerIn('慕容');

    dispatch(world.commands, a.player, 'look 慕容');

    expect(a.out.messages).toEqual([]);
    expect(b.out.messages.length).toBe(1);
  });

  it('看**自己**：不播报（wushen 的 `if (obj != player)`）', () => {
    const a = playerIn('阿飞');
    const b = playerIn('慕容');

    dispatch(world.commands, a.player, 'look 阿飞');

    expect(a.out.items.map((d) => d.name)).toEqual(['阿飞']);
    expect(a.out.messages).toEqual([]);
    expect(b.out.messages).toEqual([]);
  });

  it('目标不存在：不播报，只回一句"这里没有这个东西。"', () => {
    const a = playerIn('阿飞');
    const b = playerIn('慕容');

    const r = dispatch(world.commands, a.player, 'look 空气');
    expect(r.kind).toBe('executed');

    expect(b.out.messages).toEqual([]);
    expect(a.out.messages.join('')).toContain('这里没有这个东西');
  });

  it('看 NPC 同样播报（播报的是"盯着谁"，与对象类型无关）', () => {
    const a = playerIn('阿飞');
    const c = playerIn('路人');
    const npc = world.startRoom?.items.find((x) => x.kind === 'npc');
    if (npc === undefined) return; // 起始房间没有 NPC 时跳过（内容扩容后仍应成立）

    dispatch(world.commands, a.player, `look ${npc.name}`);

    expect(c.out.messages.length).toBe(1);
    expect(c.out.messages[0]).toMatch(new RegExp(`^阿飞(正盯着${npc.name}看|笑眯眯的看着${npc.name})`));
  });
});

describe('look · 文案的抽样有分辨力（防"永远只出第一条"的假绿）', () => {
  it('两条文案都会出现', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i += 1) seen.add(pickRemark());
    // 200 次全是同一条的概率是 2^-199 —— 若这条红了，说明抽样写错了
    expect(seen.size).toBe(LOOK_REMARKS.length);
  });

  it('抽出来的东西**确实**能渲染成两句不同的话（不是两条一样的文案）', () => {
    const me: ViewSubject = { name: '阿飞', call3: () => '他' };
    const target: ViewSubject = { name: '慕容', call3: () => '她' };
    const rendered = new Set(LOOK_REMARKS.map((t) => renderViewText(me, t, VIEW_OTHER, target)));
    expect(rendered.size).toBe(LOOK_REMARKS.length);
    expect(rendered.has('阿飞正盯着慕容看，不知道在打什么主意。')).toBe(true);
  });
});

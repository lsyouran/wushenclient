// @vitest-environment jsdom
/**
 * tests/player-text-guard.test.ts —— S1：玩家文本里不得产生**可执行**的 `<CMD>` 按钮
 * ============================================================================
 * 来源：`D:/ts-mud/_audit-代码缺陷与安全审查-2026-10-16.md`（2026-10-16 全仓只读审查，S1）。
 * 本文件写于修复之前（项目 fix-before-assert 铁律）。
 *
 * ## 为什么白名单挡不住它
 * `src/ui/markup.ts` 的白名单 + `createTextNode` 确实挡住了 XSS —— 但 **`CMD` 本身就在
 * `KNOWN` 白名单里，它的语义就是"点一下就发一条指令"**（`markup.ts:148-155`）：
 *
 *     if (name === 'CMD') { …; el.addEventListener('click', () => cmdRunner(cmd)); }
 *
 * ⇒ 白名单拦的是"名单外的攻击"，拦不住"用名单内合法能力干的事"。
 *   于是"玩家可控文本 → 别人屏幕上出现一个可执行按钮"这条边是敞开的。
 *
 * ★ 对照 wushen：`world/cmd/channel/say.js:22` 是 `UTIL.htmlEncode(msg)`。
 *   它转义是因为自己走 `innerHTML`；本项目不必转义 HTML（白名单解析器的功劳），
 *   **恰恰因此把 CMD 漏了** —— 对面那次转义是顺手把 CMD 也挡掉的。
 *   ⇒ 换掉防御机制时，要清点"旧机制顺手还提供哪些附带保护"。
 *
 * ## 三条注入路径（比报告里写的一条更宽）
 *   ① **角色名** —— 房间列表的名字走 markup 渲染（`src/ui/room.ts:92` `renderMarkup(item.name, …)`），
 *      而名字会被 `$N` 替换进**每一句 `$N` 文案**（`$N走了进来`、`$N说：…`）。
 *      ⇒ **不用开口，只要站在房间里就在给全房间植按钮**。这是三条里最强的一条。
 *   ② **`say` 正文** —— `world/command/chat/say.ts:75` 原样拼进模板。
 *   ③ **`tell` / `shout` 正文** —— 直传 `sendChannel`。
 *
 * ## 判据为什么落在"渲染结果"，而不是"文本里还有没有 `<CMD` 这四个字符"
 * 后者会被**过度修复**满足：把整条文本统统转义，标签里本该保留的 `<HIR>` 也一起没了
 * ⇒ 颜色全丢。所以一组判据必须同时钉两头：**玩家文本不产生 CMD 元素**
 * 且 **模板自己的颜色标签照常生效**（这正是下面每条都带 `<HIR>` 对比的原因）。
 */

import { beforeAll, describe, expect, it } from 'vitest';

import { bootstrapWorld } from '../server/bootstrap.js';
import { RecordingOutput } from '../server/engine/character.js';
import { dispatch } from '../server/engine/command.js';
import { Player } from '../server/engine/player.js';
import type { Room } from '../server/engine/room.js';
import type { World } from '../server/engine/world.js';
import { isRoleName } from '../shared/protocol.js';
import { OPEN_TAG_SUBSTITUTE_CHAR } from '../shared/player-text.js';
import { renderMarkup } from '../src/ui/markup.js';

let world: World;
let startRoom: Room;

beforeAll(() => {
  const booted = bootstrapWorld();
  world = booted.world;
  if (booted.world.startRoom === null) throw new Error('缺少起始房间');
  startRoom = booted.world.startRoom;
});

/** 注入样本：一个看起来像"钱庄掌柜"的按钮，点下去执行的是另一条指令 */
const INJECT = '<CMD cmd="tell 会长 借我点钱">钱庄掌柜</CMD>';

let seq = 0;

function makePlayer(name: string): { player: Player; out: RecordingOutput } {
  const out = new RecordingOutput();
  const player = new Player({
    oid: `oid-pt-${String((seq += 1))}`,
    path: null,
    roleId: name,
    name,
    output: out,
  });
  player.moveTo(startRoom);
  return { player, out };
}

/** 把一段服务端文本渲染到独立容器里，返回容器 */
function rendered(text: string): HTMLElement {
  const box = document.createElement('div');
  renderMarkup(text, box);
  return box;
}

// ---------------------------------------------------------------------------
// 路径 ①：角色名 —— 不用说话就生效的那条
// ---------------------------------------------------------------------------

describe('S1 · 角色名里的 CMD', () => {
  it('替身字符本身不会被当成标签起始（不是"改个符号就绕过去"）', () => {
    // ★ 用导出的常量而不是写死 `‹`：否则改替换字符时实现与测试一起改 ⇒ 自证式绿
    const box = rendered(`${OPEN_TAG_SUBSTITUTE_CHAR}CMD cmd="tell x y">钱庄</CMD>`);
    expect(box.querySelectorAll('*').length).toBe(0);
    expect(box.textContent).toContain('钱庄');
  });

  it('【反向锚点】普通中文名照常渲染，不产生 CMD 元素', () => {
    const { player } = makePlayer('阿飞');
    const box = rendered(player.name);
    expect(box.querySelectorAll('CMD').length).toBe(0);
    expect(box.textContent).toBe('阿飞');
  });

  it('注入名字经 `$N` 广播后 → 旁人收到的文本里没有可解析的 CMD', () => {
    const speaker = makePlayer(INJECT);
    const bystander = makePlayer('旁人');

    // `$N说：开门做生意` ⇒ 说话者名字会被替换进旁人看到的那一行
    dispatch(world.commands, speaker.player, 'say 开门做生意', { phase: 'playing' });

    const combined = bystander.out.messages.join('\n');
    expect(combined.toLowerCase()).not.toContain('<cmd');
  });

  it('注入名字渲染后不得出现 CMD 元素，但模板自己的颜色标签必须还在', () => {
    const { player } = makePlayer(INJECT);
    const box = rendered(`<HIR>${player.name}</HIR>走了进来。`);

    expect(box.querySelectorAll('CMD').length).toBe(0);
    // ★ 反向锚点：拦住"把整条文本统统转义"那种过度修复
    expect(box.querySelectorAll('HIR').length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 路径 ② / ③：聊天正文
// ---------------------------------------------------------------------------

describe('S1 · 聊天正文里的 CMD', () => {
  function sayAs(content: string): string[] {
    const speaker = makePlayer('阿飞');
    const bystander = makePlayer('慕容');
    dispatch(world.commands, speaker.player, `say ${content}`, { phase: 'playing' });
    return bystander.out.messages.slice();
  }

  it('【反向锚点】普通说话内容照常送达', () => {
    const lines = sayAs('今天月亮挺好');
    expect(lines.some((l) => l.includes('今天月亮挺好'))).toBe(true);
  });

  it('say 正文带 <CMD> → 旁人收到的每一行都不含可解析的 CMD', () => {
    const lines = sayAs('<CMD cmd="tell 会长 借钱">【系统】点此领元宝</CMD>');
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line.toLowerCase()).not.toContain('<cmd');
    }
  });

  it('say 正文带 <CMD> → 渲染结果里一个 CMD 元素都没有', () => {
    const lines = sayAs('<CMD cmd="tell 会长 借钱">【系统】点此领元宝</CMD>');

    let cmdCount = 0;
    for (const line of lines) cmdCount += rendered(line).querySelectorAll('CMD').length;
    expect(cmdCount).toBe(0);
  });

  it('tell 正文带 <CMD> → 送出的内容里不得含可解析的 CMD', () => {
    const sender = makePlayer('阿飞');
    makePlayer('慕容');
    dispatch(world.commands, sender.player, 'tell 慕容 <CMD cmd="drop all">点我</CMD>', {
      phase: 'playing',
    });

    const delivered = sender.out.channelMessages.filter((m) => m.ch === 'tell');
    expect(delivered.length).toBeGreaterThan(0);
    for (const m of delivered) {
      expect(m.content.toLowerCase()).not.toContain('<cmd');
    }
  });
});

// ---------------------------------------------------------------------------
// 最后一层：就算服务端三层全被绕过，前端白名单自己也守得住
// ---------------------------------------------------------------------------

describe('S1 · 前端白名单自身（服务端被绕过时仍成立）', () => {
  it('直接喂一段含 <CMD> 的文本 → 不产生 CMD 元素，且原样显示为字符', () => {
    const box = rendered('<CMD cmd="tell 会长 借钱">【系统】点此领元宝</CMD>');

    expect(box.querySelectorAll('CMD').length).toBe(0);
    // ★ 与 `<script>` 同等处置：白名单外 ⇒ 原样可见（不是被吃掉、也不是可执行）
    expect(box.textContent).toContain('<CMD');
  });

  it('【反向锚点】结构化 CmdItem 通道不受影响（`cmds` 帧照常可点）', () => {
    // 这条是防止"为了堵注入把可点按钮一起误删"：正道是 `CmdItem`，不是自由文本
    const box = document.createElement('div');
    const btn = document.createElement('span');
    btn.textContent = '看看';
    btn.dataset['cmd'] = 'look 3';
    box.appendChild(btn);

    expect(box.querySelector('[data-cmd]')?.getAttribute('data-cmd')).toBe('look 3');
  });
});

// ---------------------------------------------------------------------------
// 源头一层：名字是持久标识，本来就不该含标签字符
// ---------------------------------------------------------------------------

describe('S1 · 角色名字符集', () => {
  it('含 `<` 的名字被 isRoleName 拒绝', () => {
    expect(isRoleName(INJECT)).toBe(false);
    expect(isRoleName('阿飞<')).toBe(false);
  });

  it('【反向锚点】正常名字仍然通过（含全角书名号 —— 别把中文标点也禁了）', () => {
    expect(isRoleName('阿飞')).toBe(true);
    expect(isRoleName('abc_123')).toBe(true);
    expect(isRoleName('《剑客》')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// S13（2026-10-16 审查）：`parseInto` 递归**没有深度上限**
// ---------------------------------------------------------------------------
//
// 文本长度受出站包大小守卫约束，但一个由 ~10 万个 `<A>` 组成的包会在 `<` 边界内
// 打出 ~10 万层递归 ⇒ `RangeError: Maximum call stack size exceeded`，
// 而异常发生在**消息流渲染路径**上 —— 整帧渲染中断（`state` 已更新、界面没跟上）。
describe('S13 · 嵌套深度上限', () => {
  it('★ 深到能打穿调用栈的嵌套 ⇒ 不抛，且超限部分按**文本**显示', () => {
    const deep = '<HIR>'.repeat(20_000);

    let box: HTMLElement | null = null;
    expect(() => {
      box = rendered(deep);
    }, '递归没有上限 ⇒ RangeError 把整帧渲染打穿').not.toThrow();

    // 超限的开标签与"白名单外的标签"同等待遇：原样落成文本，不建节点
    expect(box!.textContent).toContain('<HIR>');
  });

  it('【反向锚点】上限之内的正常嵌套照常建节点（别把上限做成"一律不解析"）', () => {
    const box = rendered('<HIR><HIY>文字</HIY></HIR>');
    const outer = box.querySelectorAll('*');
    expect(outer.length).toBe(2);
    expect(box.textContent).toBe('文字');
  });
});

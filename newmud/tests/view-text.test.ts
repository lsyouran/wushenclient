/**
 * server/engine/view-text.ts —— 三视角文案（T16）
 * ============================================================================
 * **权威实现**：wushen `os/char/character.js:91-133` 的 `splitmessage(me, text, type, target)`，
 * 由 `CHARACTER.prototype.send_room`（同文件 `:71-87`）为房间里每个人各渲染一遍。
 *
 * 本文件的每条断言都对着那一个 `switch` 写，不是"我觉得应该这样"。
 * 有意偏离只有一处（target 缺席时降级而不是抛 TypeError），已在用例里显式标注。
 */
import { describe, expect, it } from 'vitest';

import { VIEW_OTHER, VIEW_SELF, VIEW_TARGET, renderViewText } from '../server/engine/view-text.js';
import type { ViewSubject } from '../server/engine/view-text.js';

const me: ViewSubject = { name: '阿飞', call3: () => '他' };
const you: ViewSubject = { name: '慕容', call3: () => '她' };

describe('view-text · 人称代词（wushen character.js:101-113 的 switch）', () => {
  it('本人视角（type=1）：$N/$P 是"你"，$n/$p 是对方', () => {
    expect(renderViewText(me, '$N朝$n拱了拱手。', VIEW_SELF, you)).toBe('你朝慕容拱了拱手。');
    expect(renderViewText(me, '$P拍了拍$p的肩膀。', VIEW_SELF, you)).toBe('你拍了拍她的肩膀。');
  });

  it('目标视角（type=2）：$N/$P 是对方，$n/$p 是"你"', () => {
    expect(renderViewText(me, '$N朝$n拱了拱手。', VIEW_TARGET, you)).toBe('阿飞朝你拱了拱手。');
    expect(renderViewText(me, '$P拍了拍$p的肩膀。', VIEW_TARGET, you)).toBe('他拍了拍你的肩膀。');
  });

  it('第三人称（type=3）：两边都是名字/称谓', () => {
    expect(renderViewText(me, '$N朝$n拱了拱手。', VIEW_OTHER, you)).toBe('阿飞朝慕容拱了拱手。');
    expect(renderViewText(me, '$P拍了拍$p的肩膀。', VIEW_OTHER, you)).toBe('他拍了拍她的肩膀。');
  });

  it('$N 与 $P 的分工：名字 vs 第三人称称谓（wushen call3 = gender==1?"他":"她"）', () => {
    expect(renderViewText(me, '$N/$P', VIEW_OTHER, null)).toBe('阿飞/他');
  });
});

describe('view-text · 武器与部位（wushen character.js:114-126）', () => {
  it('$w / $W：本人武器名，缺武器时是"手"（wushen `weapon_name() || "手"`）', () => {
    expect(renderViewText(me, '$N挥动$w。', VIEW_SELF, null)).toBe('你挥动手。');
    expect(renderViewText(me, '$N挥动$W。', VIEW_SELF, null)).toBe('你挥动手。');
  });

  it('$w 取到真实武器名', () => {
    const armed: ViewSubject = { name: '阿飞', call3: () => '他', weaponName: () => '青钢剑' };
    expect(renderViewText(armed, '$N挥动$w。', VIEW_SELF, null)).toBe('你挥动青钢剑。');
  });

  it('$i 是**目标**的武器名（不是本人的）', () => {
    const armed: ViewSubject = { name: '慕容', call3: () => '她', weaponName: () => '铁棍' };
    expect(renderViewText(me, '$N格开了$n的$i。', VIEW_SELF, armed)).toBe('你格开了慕容的铁棍。');
  });

  it('$l 是本人的攻击部位名，没有时为空串（wushen `attack_part ? .name : ""`）', () => {
    expect(renderViewText(me, '$N用$l撞了过去。', VIEW_SELF, null)).toBe('你用撞了过去。');
    const kicker: ViewSubject = { name: '阿飞', call3: () => '他', attackPartName: () => '右肩' };
    expect(renderViewText(kicker, '$N用$l撞了过去。', VIEW_SELF, null)).toBe('你用右肩撞了过去。');
  });

  it('$T 是本人的暗器名，没有时为空串', () => {
    expect(renderViewText(me, '$N打出$T。', VIEW_SELF, null)).toBe('你打出。');
    const thrower: ViewSubject = { name: '阿飞', call3: () => '他', throwingName: () => '柳叶刀' };
    expect(renderViewText(thrower, '$N打出$T。', VIEW_SELF, null)).toBe('你打出柳叶刀。');
  });
});

describe('view-text · 边界（照 wushen 逐条对齐）', () => {
  it('文本短于 3 个字符时原样返回（wushen `if (text.length < 3) return text`）', () => {
    expect(renderViewText(me, '$N', VIEW_SELF, you)).toBe('$N');
    expect(renderViewText(me, '好', VIEW_SELF, you)).toBe('好');
  });

  it('没有 $ 的文本逐字不变', () => {
    expect(renderViewText(me, '阿飞大笑三声。', VIEW_OTHER, you)).toBe('阿飞大笑三声。');
  });

  it('不认识的 $x 会被**吃掉**（wushen 的 switch 没有 default 分支）', () => {
    expect(renderViewText(me, '甲$x乙', VIEW_OTHER, you)).toBe('甲乙');
  });

  it('结尾孤立的 $ 也被吃掉（下标走到末尾、switch 无匹配）', () => {
    expect(renderViewText(me, '甲说话了$', VIEW_OTHER, you)).toBe('甲说话了');
  });

  it('$$N：第一个 $ 被当成未知转义吃掉，剩下的 "N" 是普通文本', () => {
    expect(renderViewText(me, '$$N笑', VIEW_OTHER, you)).toBe('N笑');
  });
});

describe('view-text · 唯一的**有意偏离**：target 缺席时降级而非抛错', () => {
  it('没有 target 时 $n / $p 退化为空串（wushen 此处会 TypeError 把连接打崩）', () => {
    expect(renderViewText(me, '$N朝$n拱了拱手。', VIEW_SELF, null)).toBe('你朝拱了拱手。');
    expect(renderViewText(me, '$N看着$p。', VIEW_SELF, null)).toBe('你看着。');
  });

  it('target 没有 call3 时 $p 退化为它的名字（不是空串）', () => {
    const plain: ViewSubject = { name: '路人' };
    expect(renderViewText(me, '$N向$p点头。', VIEW_OTHER, plain)).toBe('阿飞向路人点头。');
  });
});

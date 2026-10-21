import { defineRoom } from '@engine/world/define.js';

/**
 * 武馆 —— **学技能的地方**。
 *
 * ★ 为什么要有这个房间，而不是把教头塞进广场：
 *   `learn` 要求"目标在同一房间"（wushen `xue.js:9` 的 `me.find_obj(target, me.environment)`）。
 *   "在哪儿学"这件事必须有一个具体地址，否则 27 册 §14.3 裁定的
 *   「`from` 必需」就只剩一个语法摆设。
 *
 * ★ 与广场一样 `no_fight`：馆里不打人。练功用的木人桩留在北大街
 *   （`yz/beidajie1`，那里能开打）—— 一个房间只承担一件事。
 */
defineRoom('yz/wuguan', {
  name: '扬州城-武馆',
  desc: '一间宽敞的演武厅，地面是夯实的黄土，靠墙立着一排木架，架上刀枪剑戟擦得锃亮。',
  exits: { east: 'yz/beidajie1' },
  npcs: ['pub/jiaotou'],
  // ★ 书放在这儿（26 册 §75）：技能的两条路要在**同一个地方**都能被玩家发现 ——
  //   问教头是"学"（花潜能），拿起这本书是"读"（不花潜能、慢）。
  //   只摆一条，另一条在内容层就等于不存在。
  objects: ['book/sword', 'book/taijijian'],
  no_fight: true,
  on_enter: (me) => {
    me.notify('武馆教头正在厅中走拳，见你进来，收势而立。');
  },
});

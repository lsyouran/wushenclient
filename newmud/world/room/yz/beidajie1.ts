import { defineRoom } from '@engine/world/define.js';

defineRoom('yz/beidajie1', {
  name: '扬州城-北大街',
  desc: '街道两旁店铺林立，行人络绎不绝。',
  exits: { south: 'yz/guangchang', west: 'yz/wuguan' },
  objects: ['drug/yao#1'],
  // ★ 木人桩（见 `world/npc/pub/muren.ts`）：可打死的练功靶子。
  //   放在这里而不是广场，是因为广场 `no_fight: true`（`kill` 会在门口就被挡回来）。
  //   规范上这就是"练功房该有的东西"，只是本项目还没有门派练功房这个房间。
  // ★ 西边是武馆（`yz/wuguan`）：教头在那儿，**新玩家的第一个技能只能在那里学**
  //   （`learn` 要求老师同房间）。这条链的由来见 `world/npc/pub/jiaotou.ts` 的头注。
  npcs: ['pub/muren'],
  // 没有 on_leave：默认允许离开
});

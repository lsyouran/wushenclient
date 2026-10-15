import { defineRoom } from '@engine/world/define.js';

defineRoom('yz/guangchang', {
  name: '扬州城-中央广场',
  desc: '这里是扬州城的中心，南来北往的客商在此汇聚。广场正中立着一块石碑。',
  exits: { north: 'yz/beidajie1' },
  npcs: ['pub/xiaoer'],
  objects: ['drug/yao'],
  no_fight: true,
  actions: [
    {
      cmd: 'dazuo',
      name: '打坐',
      run: (me) => {
        me.notify('你盘膝坐下，缓缓吐纳，只觉心神渐渐宁静。');
      },
    },
  ],
  on_enter: (me) => {
    me.notify('你来到了中央广场。');
  },
});

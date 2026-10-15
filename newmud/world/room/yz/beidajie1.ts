import { defineRoom } from '@engine/world/define.js';

defineRoom('yz/beidajie1', {
  name: '扬州城-北大街',
  desc: '街道两旁店铺林立，行人络绎不绝。',
  exits: { south: 'yz/guangchang' },
  objects: ['drug/yao#1'],
  // 没有 on_leave：默认允许离开
});

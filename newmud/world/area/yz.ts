import { defineArea } from '@engine/world/define.js';

/**
 * 区域 id 是**单段**的（本文件是全项目唯一合法的单段 id 形态）。
 * 详见 docs/24 §1.6。
 */
defineArea('yz', {
  name: '扬州城',
  desc: '公共区域。你可以在这里买卖物品、使用仓库、购买房屋。',
  first: 'yz/guangchang',
  is_public: true,
  index: 0,
  actions: [
    {
      cmd: 'goto home',
      name: '回家',
      run: (me) => {
        me.notify('你还没有在扬州城购置房屋。');
      },
    },
  ],
});

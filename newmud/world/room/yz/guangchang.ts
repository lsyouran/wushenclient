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
      // ⚠️ **只播报，不恢复**（2026-10-20 三端对照复核，真机实证 `dazuo`）：
      //   打坐既不加气血也不加内力 —— `mp` 至今零消费者（`world/skill/base/force.ts:58-60`
      //   的 E9 挂账），内容层也没有任何"改自己数值"的通道。
      //   wushen 的打坐是 `world/cmd/action/dazuo.js` 一条**真正的全局指令**
      //   （带 `set_temp` 状态与按内功等级恢复），本项目目前只有这个**房间动作**条目，
      //   且扬州广场这一间才有 —— 换个房间 `dazuo` 就变成"什么？"。
      //   ⇒ 真打坐属 P0 专项批次（与药品回血同批）。挂账在此。
      run: (me) => {
        me.notify('你盘膝坐下，缓缓吐纳，只觉心神渐渐宁静。');
      },
    },
  ],
  // ★ 2026-10-20 §74：原来这里有一条 `on_enter` 播「你来到了中央广场。」，
  //   而前端 `world.ts` 的 `room` 处理器在**换房间时**已经统一播
  //   「你来到了<全名>。」—— 于是走进广场时日志里出现**两句**：
  //      你来到了中央广场。          ← 这里
  //      你来到了扬州城-中央广场。   ← 前端
  //   真机上看起来就是"日志被叠了一份"。
  //   进房间的统一播报归**前端**（wushen 的 `Process.room` 也是那一层做的，
  //   `src/process.js:297-306`），内容层的 `on_enter` 留给"这个房间自己的开场"
  //   （`yz/wuguan.ts` 的"武馆教头正在厅中走拳，见你进来，收势而立。"就是这个用法）。
  //   ⇒ 别在这里再说一遍"你来到了哪里"。
});

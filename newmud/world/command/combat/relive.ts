import { defineCommand } from '@engine/world/define.js';

/**
 * `relive` —— **复活**（死亡后从灵魂状态回到活人）。
 *
 * 对照 wushen `world/cmd/battle/relive.js`。
 *
 * ★★ **有意简化**（本批取最小闭环，见 `Character.revive()` 的说明）：
 *   原作有两档 —— `relive`（去武庙复活：`hp=1` + 换到 `recover_room` + 副本结算）与
 *   `relive locale`（原地复活：消耗 `cash/tianshifu` 天师符，`call_out` 5 秒后满血）。
 *   两者的前提（武庙 recover room、天师符道具、`died` 计数、跨服转发）都不存在，
 *   于是本批让玩家**原地满血复活**。⇒ **本批没有死亡惩罚**。
 *
 * ★ 有意没做的 wushen 分支：
 *   1. **`relive locale`**（原地复活档）—— 没有天师符可消耗；
 *   2. **天师符 / `find_obj_bypath('cash/tianshifu')`** —— 商城道具未落地；
 *   3. **`no_relive` 房间标记 / `on_relive` 房间钩子 / `force_skill.on_relive`** —— 无生产者；
 *   4. **清明活动（`isqmhd`）的死亡计数与冷却** —— 活动系统未落地。
 *
 * ★ `allow_die: true` **必须**有（wushen `relive.js:3`）：六道闸门里 `allow_die`
 *   缺省为 false，而死人的 `isAlive` 为 false —— 不显式放行的话，死人唯一的出路
 *   反而被闸门自己拦死（点复活按钮只会得到"你现在是灵魂状态，不能那么做。"）。
 */
export const RELIVE_MESSAGES = {
  /** wushen `relive.js:8` —— 活人点复活 */
  alive: '你还没死呢。',
  /** 房间播报（wushen 原地复活走 `moveto(..., "…尸体发出阵阵光芒")`；这里取通用句） */
  room: '$N缓缓睁开了双眼，又活了过来。',
} as const;

defineCommand('combat/relive', {
  command: 'relive',

  // ★ 见文件头：缺了它，死人反而用不了这条唯一的出路
  allow_die: true,

  run: (me) => {
    if (!me.revive()) {
      me.notify(RELIVE_MESSAGES.alive);
      return;
    }
    me.sendRoom(RELIVE_MESSAGES.room);
  },
});

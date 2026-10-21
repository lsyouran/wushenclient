import { defineCommand } from '@engine/world/define.js';
import { MOVE_MESSAGES } from '@shared/constants.js';

/**
 * `flee` —— **脱离战斗**（wushen `world/cmd/battle/escape.js` + `os/char/chara_move.js:105`）。
 *
 * ★ 判定在引擎（`CommandActor.escape()`）：躲闪 vs 对方命中是角色私有派生值，
 *   内容层看不到。本文件只负责把结果翻成话、并在成功时**退到随机出口**。
 *
 * ★ 与 wushen 的差异（有意的）：
 *   wushen 的 `escape` 指令只调用 `do_escape()`，**自己不移动** —— 真正跑掉靠
 *   紧接着 `go`（`go.js:24` 先判一次脱战，成功才允许走）。那条链在
 *   "敲 escape 然后什么也没发生"时对玩家是断的。这里把两步合成一步：
 *   逃成功 ⇒ 停战 + 自动退到一个相邻房间（本房间无出口时只停战）。
 *
 * ★ 失败会给一段**忙乱**（引擎里加，见 `Character.escape`），
 *   所以"连点逃跑"不会变成无限重试 —— wushen `chara_move.js:113-118` 同款。
 */

export const FLEE_MESSAGES = {
  /** wushen `escape.js:6` 原文 */
  notFighting: '你现在没有在战斗，逃跑干嘛？',
  /** wushen `chara_move.js:112`「想跑？没门！」的简化（不拼双方名号） */
  blocked: '你转身想跑，却被对手死死缠住！',
  /** 停战成功但房间没有出口 */
  nowhere: '你脱离了战斗，但这儿无路可退。',
  /** 停战 + 退到相邻房间（`go` 会自己播"你离开了…/你来到了…"） */
  free: '你趁机脱出战圈。',
};

defineCommand('combat/flee', {
  command: 'flee,escape,tao',
  help: '脱离战斗（成功与否取决于躲闪）',

  run: (me) => {
    const r = me.escape();
    if (!r.ok) {
      me.notify(r.reason === 'not-fighting' ? FLEE_MESSAGES.notFighting : FLEE_MESSAGES.blocked);
      return;
    }
    // ★ 没出口也要说清楚：玩家会以为"逃了但没动"是 bug。
    if (r.dir === null) {
      me.notify(FLEE_MESSAGES.nowhere);
      return;
    }
    me.notify(FLEE_MESSAGES.free);
    // `go` 的失败原因由引擎给（`MOVE_MESSAGES`）—— 与 `move/go.ts` 同一份文案
    const moved = me.go(r.dir);
    if (!moved.ok) me.notify(MOVE_MESSAGES[moved.reason]);
  },
});

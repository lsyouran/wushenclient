import { defineCommand } from '@engine/world/define.js';
import { MOVE_MESSAGES, normalizeDirection } from '@shared/constants.js';

/**
 * `go` —— 朝某个方向走（显式写法：`go north` / `go n`）。
 *
 * 路径与 id 的关系（G5 闸门校验）：文件在 `world/command/move/go.ts`，
 * 相对 `world/command/` 的路径是 `move/go`。
 *
 * ★ 它与"裸方向词"（`north`）**不是替代关系**，两条路都在：
 *   - 裸方向词由**房间从 `exits` 派生**出来的同名动作接手（`engine/room.ts`），
 *     好处是"这个方向走不走得动"与出口表必然一致；
 *   - 本指令是**全局**兜底：那个方向没有出口时，派生动作压根不存在，
 *     裸词会落到"什么？"，而 `go south` 能明确告诉你"那个方向没有出路"。
 *
 * ★ 短写归一化走 `normalizeDirection`（`n` → `north`）——
 *   这份对应表是共用的（`DIRECTION_ALIASES`），这里不重抄一份，
 *   也就不会重演 wushen `go.js` 里 `doors[]` / `doors_short[]` 顺序错位、
 *   导致 `s` 往西走的那类缺陷（见 `shared/constants.ts` 的注释）。
 */
defineCommand('move/go', {
  command: 'go',
  // 只吃一个词：`go north`。多给词（`go north quickly`）按不匹配处理，
  // 退回"整串作为一个参数"，于是下面的 `normalizeDirection` 判它无效并提示用法。
  regex: /^(\S+)$/,

  run: (me, raw) => {
    const dir = normalizeDirection((raw ?? '').trim().toLowerCase());
    if (dir === null) {
      me.notify('往哪个方向走？用法：走 <方向>，如 `走 north`、`走 n`。');
      return;
    }
    // 走不动的原因**引擎会告诉你**（26 册 T2）：没出路 / 内容在 `on_leave` 里拦住 /
    // 房间人满。三句话各不相同（`MOVE_MESSAGES`），不再笼统地说"过不去" ——
    // 以前这里和 `engine/room.ts` 的派生动作各写一遍同一句，改一处另一处不动。
    const r = me.go(dir);
    if (!r.ok) me.notify(MOVE_MESSAGES[r.reason]);
  },
});

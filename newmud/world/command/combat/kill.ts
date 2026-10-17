import { defineCommand, findTarget } from '@engine/world/define.js';
import { FIGHT_TYPE } from '@shared/constants.js';
import { neutralizePlayerText } from '@shared/player-text.js';
import type { FightStart } from '@engine/world/defs.js';

/**
 * `kill` —— **击杀**：打到对方 `die()` 为止。
 *
 * 对照 wushen `world/cmd/battle/kill.js`。
 *
 * ★★ **有意没做**的 wushen 分支（缺前提，不是漏移植）：
 *   1. **PK 保护 / 7 天惩罚**（`kill.js:18-27` 的 `query_setting("ban_pk")` +
 *      `set_temp("pk", …)`）—— 设置系统与 `TempStore` 写入都未落地；
 *   2. **队伍协同**（`kill.js:66-83` 的 `me.team` + `auto_kill`）—— 队伍系统未落地；
 *   3. **`target.on_kill(me) == false`**（`kill.js:64`）—— 钩子本身在 `NpcDef` 里
 *      **有声明**（`on_kill`），但接进"开战前问一句"需要引擎在 `beginFight` 里留口子；
 *      本批没接（属内容钩子批次）—— 见下方"未接"说明。
 *   4. **切磋中切目标 / 战斗中加敌人**（`kill.js:33-50`）—— 本批统一判为
 *      `self-busy`（先停战再打别人），比 wushen 严一档。
 *
 * ★ 与 `fight` 的关键差异（都照 wushen）：
 *   - **不要求满血**（`kill.js` 没有 `fight.js:21-26` 那两条门槛）；
 *   - **不挡"对方正在战斗"**（`kill.js` 允许趁人交手时下杀手）。
 */
export const KILL_MESSAGES = {
  /** wushen `kill.js:11` —— 没给参数 / 找不到 / 那不是能打的角色 */
  what: '你要攻击谁？',
  /** wushen `kill.js:8` —— 房间禁武 */
  noFight: '这里不允许战斗。',
  /** 开杀宣言（wushen `kill.js:60-61`） */
  declare: '\n$N对着$n喝道：「$n！今日不是你死就是我活！」\n',
  /**
   * 引擎判出的"打不了" → 一句话。
   * ★ 与 `fight` 的**关键差异**：`self-busy` 在 wushen 是"你先比试完再说。"
   *   （`kill.js:36`，只挡"自己在切磋"），本批把它当成通用的"在战斗"提示。
   */
  refuse(reason: KillRefusalReason, name: string): string {
    switch (reason) {
      case 'self-busy':
        return '你先比试完再说。';
      case 'self-fighting':
        return '加油，加油！！';
      case 'dead':
        return `${name}已经死了。`;
      case 'self-wounded':
      case 'target-wounded':
      case 'target-fighting':
      case 'self':
      case 'not-actor':
        return '你要攻击谁？';
    }
  },
} as const;

type KillRefusalReason = Extract<FightStart, { readonly ok: false }>['reason'];

defineCommand('combat/kill', {
  command: 'kill',

  run: (me, rawKey) => {
    const key = (rawKey ?? '').trim();
    const env = me.environment;
    if (env === null || key === '') {
      me.notify(KILL_MESSAGES.what);
      return;
    }
    if (env.noFight === true) {
      me.notify(KILL_MESSAGES.noFight);
      return;
    }
    const hit = findTarget(me, env, key);
    if (hit === undefined) {
      me.notify(KILL_MESSAGES.what);
      return;
    }
    const result = me.beginFight(hit, FIGHT_TYPE.KILL);
    if (!result.ok) {
      me.notify(KILL_MESSAGES.refuse(result.reason, neutralizePlayerText(hit.name)));
      return;
    }
    me.sendRoom(KILL_MESSAGES.declare, hit);
  },
});

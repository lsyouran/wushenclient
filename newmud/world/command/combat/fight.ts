import { defineCommand, findTarget } from '@engine/world/define.js';
import { FIGHT_TYPE } from '@shared/constants.js';
import { neutralizePlayerText } from '@shared/player-text.js';
import type { FightStart } from '@engine/world/defs.js';

/**
 * `fight` —— **切磋**（点到为止）：对方气血跌破 30% 就自动收手，不死人。
 *
 * 对照 wushen `world/cmd/battle/fight.js`。
 *
 * ★ 本批**做的**是这条指令的骨架：禁武房间 → 找目标 → 六条"打不了"的准入 →
 *   开战 + 播报。
 *
 * ★★ **有意没做**的 wushen 分支（缺前提，不是漏移植）：
 *   1. **比试请求 / 同意流程**（`fight.js:54-62` 的 `set_temp("fight")` + 给对方发
 *      `fight <id>` / `fight none` 两个按钮）—— 需要往对方的 `TempStore` 写键，
 *      而 `CommandActor` **不暴露 temp 写入**（那是并发 / 生命周期有讲究的能力，
 *      见 `defs.ts` 的 `InteractHooks` 注释）。⇒ 本批**直接开打**，不问对方。
 *   2. **`fight none`**（拒绝比试，`fight.js:4-13`）—— 同上，没有"待接受的请求"可拒。
 *   3. **`target.no_fight` / 玩家设置项 `off_fight`**（`fight.js:41`）—— 设置系统未落地。
 *   4. **`can_speek` / `on_before_fight` 钩子**（`fight.js:19,66`）—— 无生产者。
 *
 * ★ 六条准入的**判据在引擎**（`Character.beginFight`），因为其中两条要读角色内部
 *   血量（`fight.js:21-26` 要求双方"状态好"），而内容层看不到血量。
 *   本文件只负责把**原因**翻成一句话（`FIGHT_MESSAGES.refuse`）。
 */
export const FIGHT_MESSAGES = {
  /** wushen `fight.js:5` —— 没给参数 / 找不到那个东西 */
  what: '你要攻击谁？',
  /** wushen `fight.js:14` —— 房间禁武 */
  noFight: '这里不允许战斗。',
  /** 挑战宣言（wushen `fight.js:36-39`；`callme()` / `call()` 的敬语已简化） */
  challenge: '\n$N对着$n说道：「$n，领教了！」\n',
  /**
   * 引擎判出的"打不了" → 一句话。**每个 reason 一句**（wushen 各处 `notify`）。
   * `name` 是目标的名字（已中和，可以直接进消息流）。
   */
  refuse(reason: FightRefusalReason, name: string): string {
    switch (reason) {
      case 'self-wounded':
        return '你先调整好自己的状态再来找别人比试吧。';
      case 'target-wounded':
        return `${name}的状态不是很好，你想趁人之危吗？`;
      case 'self-fighting':
        return '加油，加油！！';
      case 'self-busy':
        return '等你打完再和别人比试吧！';
      case 'target-fighting':
        return '对方正在切磋，等对方打完再来吧。';
      case 'dead':
        return `${name}已经死了。`;
      case 'self':
      case 'not-actor':
        return '你要攻击谁？';
    }
  },
} as const;

type FightRefusalReason = Extract<FightStart, { readonly ok: false }>['reason'];

defineCommand('combat/fight', {
  command: 'fight',

  run: (me, rawKey) => {
    const key = (rawKey ?? '').trim();
    const env = me.environment;
    if (env === null || key === '') {
      me.notify(FIGHT_MESSAGES.what);
      return;
    }
    if (env.noFight === true) {
      me.notify(FIGHT_MESSAGES.noFight);
      return;
    }
    const hit = findTarget(me, env, key);
    if (hit === undefined) {
      me.notify(FIGHT_MESSAGES.what);
      return;
    }
    const result = me.beginFight(hit, FIGHT_TYPE.FIGHT);
    if (!result.ok) {
      me.notify(FIGHT_MESSAGES.refuse(result.reason, neutralizePlayerText(hit.name)));
      return;
    }
    me.sendRoom(FIGHT_MESSAGES.challenge, hit);
  },
});

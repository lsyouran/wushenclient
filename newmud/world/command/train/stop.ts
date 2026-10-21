import { defineCommand } from '@engine/world/define.js';
import { STUDY_MESSAGES } from './study.js';

/**
 * `stop`（别名 `ting`）—— **中断当前状态**（研读 / 练习 / 打坐…）。
 *
 * 对照 wushen `world/cmd/skill/stopstate.js`。
 *
 * ★★ 为什么这条指令必须与"读书/练习"同批出现（26 册 §75）：
 *   状态机一旦落地，玩家就**必须**有一条退出的路 —— 否则开着"研读"时
 *   连路都走不了（`go` 没声明 `allow_state`，状态中会被闸门拦下）。
 *   以前 `practice` 做成一次结算，所以"停不下来"这件事根本不存在；
 *   现在它是状态，就一定要有出口。
 *
 * ★ 闸门全开（`allow_fight` 缺省 true / `allow_state` / `allow_die` / `allow_faint`）：
 *   被打断、被打晕、甚至被打死之前，都该能喊停。wushen 的 `stopstate`
 *   同样是一类"任何时候都可用"的元指令。
 *
 * ★ 没有状态时不说"停下"（那是假话）：一句"你并没有在做什么"才是实话。
 */
export const STOP_MESSAGES = {
  /** 当前什么都没在做（wushen `stopstate.js` 的"你现在没有在做什么"口径） */
  idle: '你并没有在做什么。',
} as const;

defineCommand('train/stop', {
  command: 'stop,ting',
  // 不带参数（`stop` 就够）。带参数也不报错 —— 状态是"当前那个"，没有第二个可指定
  allow_state: true,
  allow_die: true,
  allow_faint: true,

  run: (me) => {
    const title = me.state?.title ?? '';
    if (!me.stopState()) {
      me.notify(STOP_MESSAGES.idle);
      return;
    }
    // ★ 文案按"刚才在做什么"分：读书说"合上书"，其余说"你停下来了"。
    //   只有读过书的人才会觉得"合上书"贴切 —— 泛化成通用句反而两边都不像。
    me.notify(title === '研读' ? STUDY_MESSAGES.stop : '你停下来了。');
  },
});

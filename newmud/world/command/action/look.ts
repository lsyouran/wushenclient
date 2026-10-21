import { defineCommand, findTarget } from '@engine/world/define.js';
import { detailOf, INSPECT_MESSAGES } from './select.js';

/**
 * 旁观播报的文案（wushen `world/cmd/action/look.js:58` 的 `look_str`）。
 *
 * ★ `$N` / `$n` 不是装饰：它们在 `engine/view-text.ts` 里按**视角**展开 ——
 *   被看的人读到「阿飞正盯着**你**看」，旁人读到「阿飞正盯着**慕容**看」。
 *   内容层只写这一份。
 */
export const LOOK_REMARKS = [
  '$N正盯着$n看，不知道在打什么主意。',
  '$N笑眯眯的看着$n，不知道在想些什么。',
] as const;

/**
 * 随机取一条（wushen `look_str.random()`）。
 *
 * 为什么保留随机：同一句话在每次 `look` 后原样重复，会立刻暴露"这是个模板"。
 * 代价是**不可复现** —— 所以断言写成"必属于这两条之一"，而不是钉死某一条。
 *
 * ★ 导出是为了让"**两条都真的会出现**"可断言：只写"∈ LOOK_REMARKS"的话，
 *   一个永远返回第一条的实现照样能过 —— 那正是本项目一直在防的假绿
 *   （24 册 §5.3）。分辨力来自 `tests/look-remark.test.ts` 的那条抽样断言。
 */
export function pickRemark(): string {
  return LOOK_REMARKS[Math.floor(Math.random() * LOOK_REMARKS.length)]!;
}

/**
 * `look` / `l` —— 看你现在所在，或看**指定**的人 / 物。
 *
 * 本项目的第一条真实指令，作用是把整条链路跑通并钉住：
 *   `defineCommand` → registry → `CommandTable` → `dispatch` → `run(me)`
 *
 * 路径与 id 的关系（G5 闸门校验）：文件在 `world/command/action/look.ts`，
 * 相对 `world/command/` 的路径是 `action/look`，所以 id 必须是 `action/look`
 * （`command` 这个 kind 要求至少 2 段，见 `shared/ids.ts` 的 `MIN_SEGMENTS_BY_KIND`）。
 *
 * ★ 它**没有**手写任何 `if (me.isBusy()) return` —— 忙碌 / 状态 / 死亡这些条件
 *   一律由 `CommandDef` 的六道闸门字段声明（下面三行），校验只有 `engine/command.ts`
 *   一处。这正是 docs/wushen/13 §13.10 建议 2 想达到的效果。
 *
 * ★ **带目标的分支是补上的**（26 册 §20.3）：原来 `run(me)` 根本不看参数，
 *   于是"点谁"都变成把房间描述再打一遍。wushen 的 `world/cmd/action/look.js`
 *   是 `var obj = me.environment.find_obj(objid); … obj.query_commands(me)` ——
 *   看的是**那个东西**。这里与 `select` 走同一个 `detailOf()`（两条入口、
 *   一份载荷；wushen 那边 `look` 用 `query_desc`、`select` 用 `query_commands`，
 *   返回的东西几乎一样，分开写只是多一处会漂移的地方）。
 *
 * ★ **旁观播报**（T16 的第一个真实调用点，26 册 §22）：带目标时会往房间广播
 *   一句 `$N正盯着$n看…`（wushen `look.js:39` 的 `look_str.random()`），
 *   三个实参是（文案、**被看的那个对象**、`excludeself = true`）。
 *   ★ **只有 `look` 播报，`select` 不播报** —— wushen 的 `select.js` 里
 *   `grep send_room` **零命中**："点一下"不该吵到整个房间，主动看才说话。
 *
 * ★ 与 wushen 的**一处刻意差异**：无参数时 wushen 是 `if (!objid) return;`
 *   （什么都不做 —— 它的房间信息由进房间时推的 `.content-room` 常驻显示）。
 *   这里保留"再打一遍房间"，因为底部工具条的「环顾」按钮发的是裸 `look`，
 *   点下去什么都不发生会被当成按钮坏了。房间描述本身照旧不进消息流的自动化
 *   那条规矩不受影响 —— 这不是"换房间"，是玩家**主动问一次**。
 */
defineCommand('action/look', {
  command: 'look,l', // 逗号别名：look / l 两个入口
  // 看东西不该被"忙 / 打坐 / 灵魂状态"挡住；战斗中也允许（allow_fight 缺省即 true）
  allow_busy: true,
  allow_state: true,
  allow_die: true,

  run: (me, target) => {
    const env = me.environment;
    if (env === null) {
      me.notify(INSPECT_MESSAGES.blind);
      return;
    }

    // ── 带了目标：看那个东西（wushen 的 `obj.query_commands(me)` 分支）──────
    if (target !== undefined && target.trim() !== '') {
      const obj = findTarget(me, env, target.trim());
      if (obj === undefined) {
        me.notify(INSPECT_MESSAGES.notFound);
        return;
      }
      me.showItem(detailOf(obj, env.noFight === true));
      // ★ 旁观播报（wushen `world/cmd/action/look.js:36-39`）：
      //     `if (obj.query_desc) { player.notify(obj.query_desc(player));
      //                           if (obj != player) player.send_room(look_str.random(), obj, true); }`
      //
      //   三个实参都要：文案（含 `$N`/`$n`）、**被看的那个对象**（它本人读第二人称）、
      //   `excludeself = true` —— 看东西的人自己要的是**详情**，不是八卦。
      //
      //   ★ 只有 `look` 播报，`select` 不播报：`grep send_room` 在 wushen 的
      //     `select.js` **零命中**。"点一下"不该吵到整个房间，主动 `look` 才说话。
      if (obj.id !== me.id) me.sendRoom(pickRemark(), obj, true);
      return;
    }

    // ── 不带目标：看房间 ────────────────────────────────────────────────────
    const lines = [`【${env.name}】`];
    if (env.desc !== undefined && env.desc !== '') lines.push(env.desc);

    // 列出同环境下的其它东西（不含自己）
    const others = env.items.filter((x) => x.id !== me.id);
    lines.push(others.length === 0 ? '这里空无一物。' : `这里有：${others.map((x) => x.name).join('、')}`);

    me.notify(lines.join('\n'));
  },
});

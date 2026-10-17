import { defineCommand, findTarget } from '@engine/world/define.js';
import type { Actor, ActorObject } from '@engine/world/defs.js';
import { GIVE_MONEY_KEY, moneyToStr } from '@shared/constants.js';
import { neutralizePlayerText } from '@shared/player-text.js';

/**
 * `give` —— 把身上的**钱**或**一件东西**给同房间的另一个人。
 *
 * 对照 wushen `world/cmd/obj/give.js`。路径与 id 的关系（G5）：文件在
 * `world/command/obj/give.ts` → id 必须是 `obj/give`（`item` 是保留 id 段，见 `get.ts` 头注）。
 *
 * 语法（与 wushen 的 `this.regex` 同形，只把 `\w` 放宽成 `\S`）：
 *
 *     give <谁> <东西>            → 给 1 个（wushen `give.js:39` 的 `if (!count) count = 1`）
 *     give <谁> <个数> <东西>      → 给这么多个
 *     give <谁> <数目> money       → 给这么多钱（wushen `give.js:10` 的 `objid == "money"`）
 *
 * ★★ **放宽 `\w` → `\S` 是一处必要的修正，不是风格问题**：
 *   wushen 的 `/^(\w+)(?:\s+(\w+))?\s+(\w+)$/` 里 `\w` 在 JS 中**不含中文**
 *   （没有 `u` 标志时只匹配 `[A-Za-z0-9_]`）。⇒ 用中文名写的物品
 *   （`丹药`、`再生丹`）**压根匹配不上**，整个正则失败 → 退回"整串当一个参数"，
 *   于是 `give xiaoer 丹药` 会变成"把一个叫作 `xiaoer 丹药` 的东西给出去"。
 *   本项目的内容层是中文的，所以这条必须修。
 *
 * ★★ **`on_accept` 先判、再扣减**（wushen 反着来：先判支付能力 / 数量，再 `on_accept`）——
 *   有意偏离，理由见文件末尾 `ask()` 的注释。**结论一样**（拒了就说"不要你的…"、
 *   不够就说"你身上没有那么多的…"），不同的只是**调用顺序**。
 *
 * ★ **没做的两条**（缺前提，不是漏移植）：
 *   1. **不能给玩家控制的人物东西**（wushen `give.js:7` 的 `player.master != target.id`）
 *      —— 师徒 / 随从系统未落地，"谁控制谁"本项目还不存在；
 *   2. **`give <谁> all <东西>`**（`give.js:40`）—— 要读物品数量，
 *      而"给全部"无非是"把我身上的都给出去"，等数量读口需要时再说。
 *
 * ★★ **被给出去的东西会离开给出方**（`spendItem`），这正是 wushen 的行为
 *   （`give.js:57-62` 的非师徒分支**只调 `remove_obj`**，不加给对方 ——
 *   对方 `on_accept` 自己决定拿它做什么）。本项目的 `on_accept` 是纯谓词，
 *   所以这里就是"扣掉 + 播报"；**接收方真正把它收进背包**需要一条
 *   "送到别人的容器里"的原语，属**商店 / 交易批次**（那时才有买回、回收等需求）。
 */
export const GIVE_MESSAGES = {
  /** wushen `give.js:6`（`!target || !target.hp`） */
  who: '你要给谁东西？',
  /** wushen `give.js:37`（`find_obj` 找不到那件东西） */
  what: '你要给谁什么东西？',
  /** wushen `give.js:11` / `:26`（没写数目 / 数目 ≤ 0） */
  amountWho: (who: string): string => `你要给${who}多少钱？`,
  /** wushen `give.js:14`「你身上没有那么多的钱给X。」 */
  noMoney: (who: string): string => `你身上没有那么多的钱给${who}。`,
  /** wushen `give.js:24`（`on_accept` 没点头）—— 钱的版本 */
  refuseMoney: (who: string): string => `${who}不要你的钱。`,
  /** 同上，东西的版本（`give.js:32` 用的是同一句，本项目按钱/物分开更清楚） */
  refuse: (who: string): string => `${who}不要你的东西。`,
  /** wushen `give.js:46`「你没有那么多的X。」 */
  notEnough: (what: string): string => `你没有那么多的${what}。`,
} as const;

defineCommand('obj/give', {
  command: 'give',
  regex: /^(\S+)\s+(?:(\d+)\s+)?(\S+)$/,

  run: (me, rawTarget, rawCount, rawObj) => {
    const targetKey = (rawTarget ?? '').trim();
    const objKey = (rawObj ?? '').trim();
    // 参数不足（`give xiaoer`）时 `buildParams` 退回"整串当一个参数"，
    // 于是 `rawObj` 是 `undefined` —— 与"名字写错"分开报（wushen 用的是同一句）。
    if (targetKey === '' || objKey === '') {
      me.notify(GIVE_MESSAGES.who);
      return;
    }

    const env = me.environment;
    const target = env === null ? undefined : findTarget(me, env, targetKey);
    // wushen `give.js:6` 的 `!target || !target.hp` —— 给的必须是**同房间的角色**。
    // 这里用 `kind` 判（物品 / 房间直接挡掉）；"是否活着"不必另判：
    // 死掉的 NPC 会被移出房间（`os/char/npc.js` 的 `die()` → 原地留 corpse），
    // 所以"能在 `env.items` 里找到的 NPC"就是活的 —— 由房间语义保证，不是漏了。
    if (target === undefined || (target.kind !== 'npc' && target.kind !== 'player')) {
      me.notify(GIVE_MESSAGES.who);
      return;
    }
    const who = neutralizePlayerText(target.name);

    // ── 分支一：给钱（wushen `give.js:10-24`）──────────────────────────────
    if (objKey === GIVE_MONEY_KEY) {
      const amount = rawCount === undefined ? 0 : Number(rawCount);
      if (!Number.isInteger(amount) || amount <= 0) {
        me.notify(GIVE_MESSAGES.amountWho(who));
        return;
      }
      if (!ask(target, me, GIVE_MONEY_KEY, amount)) {
        me.notify(GIVE_MESSAGES.refuseMoney(who));
        return;
      }
      if (!me.spendMoney(amount)) {
        me.notify(GIVE_MESSAGES.noMoney(who));
        return;
      }
      // wushen `give.js:21`：`player.send_room("$N给了$n" + UTIL.moneyToStr(count) + "。", target)`
      me.sendRoom(`$N给了$n${moneyToStr(amount)}。`, target);
      return;
    }

    // ── 分支二：给东西（wushen `give.js:35-62`）────────────────────────────
    // 只在自己身上找 —— 第二个实参传 `null`：`findTarget` 的查找池这时只剩
    // `me.items`（同 `drop.ts`），于是"只能给身上的东西"不必另写一遍匹配。
    const item = findTarget(me, null, objKey);
    if (item === undefined || item.kind !== 'item') {
      me.notify(GIVE_MESSAGES.what);
      return;
    }

    const count = rawCount === undefined ? 1 : Number(rawCount);
    // wushen `give.js:44` 是 `if (!(count > 0)) return;` —— **静默**返回，一个字都不说。
    // 本项目给一句提示：写 0 个几乎总是手滑，静默会让人以为指令没生效。
    if (!Number.isInteger(count) || count < 1) {
      me.notify(GIVE_MESSAGES.what);
      return;
    }

    // `objId` 用**模板 id**（`drug/yao#0`）而不是实例 oid —— 与 wushen 传给
    // `on_accept` 的一致（它传的是 `obj`，而它读 `obj.path` / `obj.id` 取决于分支；
    // 本项目的 `NpcDef.on_accept(me, objId, count)` 明确是"物品的模板 id 或 'money'"）。
    // 模板 id 缺席（理论上只有非注册表实例才会）时退回玩家输入的那个键。
    if (!ask(target, me, item.path ?? objKey, count)) {
      me.notify(GIVE_MESSAGES.refuse(who));
      return;
    }
    if (!me.spendItem(item, count)) {
      me.notify(GIVE_MESSAGES.notEnough(neutralizePlayerText(item.name)));
      return;
    }
    // ★ 用 `$n` 承载**东西**的名字 —— 于是它走 `renderViewText` 的三视角渲染、
    //   并且名字里的 `<` 会被中和；对方的名字走显式 `neutralizePlayerText`。
    //   两个动态名字都过同一道出口约定（`shared/player-text.ts`）。
    me.sendRoom(`$N把$n递给了${who}。`, item);
  },
});

/**
 * 问对方收不收（wushen 的 `target.on_accept && target.on_accept(...)`）。
 *
 * ★★ **为什么"先问、再扣"而不是 wushen 的"先判支付能力、再问"**：
 *   wushen 的顺序（`give.js:14` 查钱 → `:15` 问 `on_accept` → `:16` 扣钱）
 *   成立的前提是 `on_accept` **会自己完成交接** —— 它是挂在目标 NPC 上的方法，
 *   `this` 就是那个 NPC，所以钩子里能 `this.add_obj(...)`。
 *   本项目把 `on_accept` 定成**纯谓词**（`defs.ts#InteractHooks.onAccept`：
 *   引擎负责搬运与扣减，内容层只回答"收不收"），于是它**没有副作用**，
 *   两次调用的先后就不再有可观察差别 —— 除了"钱不够时会不会白问一句"。
 *
 *   要完全照抄那个顺序，就得让内容层能读"我有多少钱 / 这东西有几个"，
 *   等于给 `CommandActor` 再开两个读口，而收益只是**省掉一次无副作用的调用**。
 *   ⇒ 取舍：**保持原语面最小**（26 册 L8：不为"整齐"加接口），代价是顺序上的一处已知偏离。
 *
 * ★ 返回 `false` 的两条路径（目标压根没有 `on_accept` / 钩子没返回真）在 wushen
 *   是**同一句**文案（它写的是 `if (target.on_accept && …)`）—— 这里也合并成一句。
 */
function ask(
  target: ActorObject,
  me: Actor,
  objId: string,
  count: number,
): boolean {
  return target.interact?.onAccept?.(me, objId, count) === true;
}

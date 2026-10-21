import { defineNpc } from '@engine/world/define.js';
import { GIVE_MONEY_KEY } from '@shared/constants.js';

/**
 * 住店钱（铜板）—— `ask` 动作里那颗按钮写的就是 1000。
 * ★ 单源在这里：`actions.run` 与 `on_accept` 都读它，
 *   于是"按钮上说的价"与"钩子收的价"不可能对不上。
 */
const LODGING_FEE = 1000;

/**
 * 店小二。
 *
 * ★ 与 wushen `world/npc/pub/xiaoer.js` 的差异（有意为之，必须记下来）：
 *   wushen 那个店小二**身上没有任何技能**（只有 name/desc/gender/age/per/hp/mp）。
 *   本项目的这份**多带了技能**，用途是让"NPC 的技能面"在内容层就有一个真实样例
 *   （docs/27 决策 D9：NPC 改用与玩家同一套 `SkillBook`，**保留技能 id**）。
 *   这是内容层为演示而加的东西，不是从 wushen 抄来的 —— 不要以为 wushen 也这样写。
 *
 * ★ 修掉了 docs/27 §9 的 **P2**：
 *   原先 `{ skill: 'wd/taijijian', level: 50, enableAs: 'force' }` ——
 *   为了让 `forceRad` 生效，把一套**剑法**塞进了**内功**槽。
 *   现在拆成两条，各自归位：
 *     - `wd/taijijian` 装 `sword`（它 `can_enables` 的正好就是 sword）；
 *     - `base/force`（真正占 `force` 槽的基本技能）单独给出 `forceRad` 的来源。
 *
 * ★ 顺带修掉一个**静默失效的字段**：原 def 里的 `max_hp: 150` 从来没有消费者
 *   （引擎的 `maxHp` 一律由 `formula.ts` 派生）。它已被删除 —— 想调上限要写
 *   `prop: { max_hp: N }`（那是真的 PropKey），写在顶层是没用的。
 *   现在 `con: 27` 让派生上限成为 158：
 *       `27*5 + 150*0.1 + 3*(27/10) = 135 + 15 + 8.1 → int → 158`
 *   （`prop(con)=3` 来自基本内功 30 级的被动加成）。于是 `hp: 150` 是"未满血"，
 *   而不是被 `setHp()` 悄悄截断出来的数 —— 声明与派生值第一次对得上。
 */
defineNpc('pub/xiaoer', {
  name: '店小二',
  desc: '一个手脚麻利、见人就笑的店小二。',
  gender: 1,
  age: 22,
  per: 20,
  con: 27,
  hp: 150,
  mp: 150,
  max_mp: 150,
  skills: [
    { skill: 'base/force', level: 30 },
    { skill: 'wd/taijijian', level: 50, enableAs: 'sword' },
  ],
  drops: [{ obj: 'drug/yao#0', min: 1, max: 2 }],
  on_master: false,
  actions: [
    {
      cmd: 'ask',
      name: '打听',
      run: (me) => {
        me.sendCommands(`give pub/xiaoer ${String(LODGING_FEE)} money`, '人字号客房');
      },
    },
  ],
  /**
   * 收下客官的住店钱。
   *
   * ★★ **这条 `on_accept` 是 B 批补的，它接上了一个悬空按钮**：
   *   上面的 `ask` 动作会发一颗 `give pub/xiaoer 1000 money` 的按钮，
   *   而在这之前**店小二没有 `on_accept`** —— 于是那颗按钮点下去只会得到
   *   「店小二不要你的钱。」（`give` 的拒收分支）。内容写了、引擎也通了，
   *   但两者之间的**那一环从来没接**：这正是 26 册 L8 那类"内容写了没人消费"
   *   的镜像 —— **入口在，但没有东西在后面应答**。
   *
   * ★ 判据是 `objId === GIVE_MONEY_KEY`（不是 `objId === 'money'` 字面量）：
   *   保留字的单一来源在 `shared/constants.ts`，`give` 指令产出它、
   *   这里按它分派 —— 两边共用一份，改一处不会漏改另一处。
   *
   * ★ 为什么"钱不够"时**也返回 `false`**（而不是收下再说）：
   *   `on_accept` 是**准入判据**（`defs.ts#InteractHooks.onAccept`），
   *   引擎在它返回真之后才扣钱。这里返回假 ⇒ 玩家一分钱没少，
   *   并且先收到一句**为什么**（免得只看到笼统的"不要你的钱"）。
   *
   * ★★ **这里不许播报"收下了"**（26 册 §57，真机反馈抓到的矛盾消息）：
   *   原先这一支写的是 `me.notify('店小二收了钱，引你往人字号客房走去。')` 再 `return true`，
   *   而引擎拿到 `true` **之后**才去 `spendMoney(1000)`。玩家身上没钱时，屏幕上就是
   *   两句互相打脸的话：
   *       店小二收了钱，引你往人字号客房走去。
   *       你身上没有那么多的钱给店小二。
   *   根子在**职责错位**：`on_accept` 是纯谓词（`defs.ts` 写死的），
   *   它只回答"收不收"，无权宣布结果 —— 结果由引擎扣钱成功后才成立。
   *   现在"成没成"统一由 `give` 播报（`$N给了$n…` / `你身上没有那么多的钱给…`）。
   */
  on_accept: (me, objId, count) => {
    // 店小二不收东西 —— 要卖东西走商店的 `sell`（交易批次），不走 `give`。
    if (objId !== GIVE_MONEY_KEY) return false;
    if (count < LODGING_FEE) {
      // 这句是**拒收的理由**（不是"结果"），允许出现在谓词里：它解释为什么返回 false。
      me.notify(`店小二陪笑道：住店要${String(LODGING_FEE)}文钱，客官。`);
      return false;
    }
    return true;
  },
  on_enter: (me) => {
    me.notify('店小二笑咪咪地说道：这位客官，要住店吗？');
  },
});

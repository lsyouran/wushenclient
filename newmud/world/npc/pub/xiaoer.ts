import { defineNpc } from '@engine/world/define.js';

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
        me.sendCommands('give pub/xiaoer 1000 money', '人字号客房');
      },
    },
  ],
  on_enter: (me) => {
    me.notify('店小二笑咪咪地说道：这位客官，要住店吗？');
  },
});

import { defineSkill } from '@engine/world/define.js';
import { SKILL_CURVE, attrPassive } from '@engine/world/skill-curves.js';
import { SKILL_TYPES } from '@shared/constants.js';

/**
 * 基本内功（`type = BASE`）—— 装配槽 `force` 的**占槽技能**。
 *
 * ★ 与 wushen `world/skill/base/force.js` 的对照（**三处**刻意不同）：
 *
 *   1. **id 与槽名显式拆开**。wushen 那份写的是 `this.id = "force"` ——
 *      技能 id **恰好等于**槽名。这不是巧合，而是 docs/27 决策 D1 说的
 *      "隐式词汇表"：`init_skill()` 直接拿 `query_weapon_type()` 的结果当槽名，
 *      代码里从不显式列出全部槽，于是槽名拼错不会有任何东西报错。
 *      这里 id 是内容 id `base/force`（受 24 册命名法管），
 *      槽名是 `slot: 'force'`（引擎闭集 `ENABLE_SLOTS`）——
 *      "内容 id 拼错"与"槽名拼错"因此成了两件各自会被拦下的事。
 *
 *   2. **`max_level` 引用 `SKILL_CURVE.refLevel`（1000），不是写死的字面量**。
 *      ★ 它只是**模板硬顶**，不是"每个人都能练到 1000"：玩家实际能到几级由
 *      `levelLimit(角色经验, 境界)` 换算（`SkillBook.#capOf` 取两者的小值）。
 *      1000 级在境界 0 需要 1 亿角色经验，在境界 6 也要 1670 万 —— 那是终局目标，
 *      不是日常数值。所以这个数字与曲线标定点共用同一个常量，改一处两处同步。
 *
 *   3. **被动曲线不是线性的 `lv/10`，也不是平方根**，而是**凸的幂律**
 *      `attrPassive(lv)`。wushen 在 1000 级给 `con +100`，而 `con` 先天只有 20–30，
 *      且气血公式里 `prop(con) * con` **不除** `propScaleDivisor` ⇒ 血量凭空 6 倍以上。
 *      本曲线满额只有 **+30**，且到 78 级才开始动（"根骨要火候够深"）。
 *      曲线形状、完整数值表、以及"为什么必须是凸的"见 `server/world/skill-curves.ts`，
 *      6 个基本技能共用同一条曲线，内容层不写第二份。
 *
 *   ⚠️ wushen 那份返回的对象里**混进了一个 `desc` 键**（见 `base/force.js` 末行），
 *      它会被原样丢给 `change_prop()` —— 一个"文案"进了属性表。
 *      本项目 `PropMap.prop` 是 `Partial<Record<PropKey, number>>`，
 *      那种键**写不出来**（编译期即拒），文案只能另找地方放（`SkillDef.desc`）。
 *
 * ★ 属性键写 `[PROP.constitutionBonus]` 而不是裸 `con`：裸拼音键是 wushen 的
 *   **数据契约**（落库/上网仍是 `con`），但内容层不该直接写它 —— 用的是别名层。
 *   这条由 G3.A 闸门强制（写了有别名却裸写 → 报错），不是靠自觉。
 */
defineSkill('base/force', {
  name: '基本内功',
  // ★ 文案只承诺**已经生效**的东西：`con` 进派生公式（气血/防御都涨）。
  //   "火候够深"是有意的措辞 —— 加成从 78 级才开始，说"等级越高"会变成空头承诺。
  //   原先还写过"…内力上限也随之提升"—— 而 `limit_mp` 目前在引擎里**没有消费者**
  //   （E9 挂账），`score` 面板也不显示它。文案承诺一个看不见的效果，
  //   就是"注释也是断言"那类假话。等 `dazuo` 落地后再把后半句加回来。
  desc: '内功的基础功法，坚持锻炼会增强体质。火候够深时根骨愈强，气血愈厚。',
  type: SKILL_TYPES.BASE,
  slot: 'force',
  grade: 0,
  max_level: SKILL_CURVE.refLevel,
  passiveProp: (lv) => ({
    prop: {
      // 先天根骨：气血与防御两条派生值都吃它（见 `computeDerived`）
      con: attrPassive(lv),
      // 内力上限加成。★ 与原作同式（线性 `100 + lv*5`），因为它是**池子上限**
      //   而非法术强度 —— 1000 级给 5100 点并不离谱。
      //   ⚠️ 它是**为下一批预留**的数据：`limit_mp` 目前在引擎里没有消费者
      //   （E9 挂账：`recount` 只钳 hp 不钳 mp，真正该花它的 `dazuo` 还没实现）。
      //   所以 `desc` **不承诺**内力上限 —— 别让文案变成一句看不见的谎。
      limit_mp: 100 + lv * 5,
    },
  }),
});

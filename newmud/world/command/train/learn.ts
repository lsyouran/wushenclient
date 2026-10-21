import { defineCommand, findTarget } from '@engine/world/define.js';
import type { LearnRefused } from '@engine/world/defs.js';
import { GENDER_LABELS, propLabel } from '@shared/constants.js';
import { neutralizePlayerText } from '@shared/player-text.js';

/**
 * `learn`（别名 `xue`）—— **跟同房间的人学一门技能**。
 *
 * 对照 wushen `world/cmd/skill/xue.js`。这一条补的是 27 册 §13.6 记了很久的缺口：
 *
 *     `SkillBook.learn()` / `enable()` 零生产消费者
 *     ⇒ 新玩家一个技能都没有 ⇒ `practice` 永远 `not-learned` ⇒ 成长闭环第一环就断
 *
 * ★★ 与 wushen 的三处**形态**差异（都是"缺前提就不假装有"）：
 *
 *   1. **不做师父系统**。wushen 要求 `me.master` / `me.query_temp("master")` 且
 *      高阶武功还要门派贡献（`gongji` / `sm_level`）。本项目门派与从属系统未落地，
 *      于是"谁能教"只按一条判：**他自己会这门，且等级比你高**
 *      （wushen `xue.js:38` 的 `target.skills[sk]`、`:191` 的等级比较）。
 *      这不是偷工减料 —— wushen 的"教不教"判据本来就是这个，师父身份只额外管
 *      "能不能看技能表"和贡献门槛。
 *
 *   2. **一次结算**，不是持续状态。wushen 的 `xue` 是 `set_state({id:'learn'})`
 *      之后每 5 秒一拍、可排队可中断；本项目 `Actor.state` 状态机未落地，
 *      于是做成"学一拍"的原子操作（与 `practice` 同一条理由，见 27 册 §13.3 #1）。
 *      账目口径不变：`me.pot -= exp; skill.add_exp(me, exp)`。
 *
 *   3. **`from` 必需**。wushen 也是必需（`xue.js:9` 找不到目标就报错）；
 *      保留这条是为了让"在哪儿学"有意义 —— 否则任何角落都能学太极剑法。
 *
 * ★ 目录为什么是 `train/` 而不是 `skill/`：`skill` 是保留 area
 *   （`shared/ids.ts#RESERVED_AREAS` 含全部 `KINDS`），`defineCommand('skill/learn', …)`
 *   会在 `asWorldId` 那一关抛 `IdError`；G5 又要求路径推出的 id 与 define 的一致。
 *   `practice` 已经踩过这个坑并落在 `train/`（见那里的注释）。
 */
export const LEARN_MESSAGES = {
  /** 没写技能（wushen `xue.js:7`「你要学习什么技能？」） */
  usage: '你要学习什么技能？（例如：learn 太极剑法 from 教头）',
  /** 写了技能没写 `from` —— wushen 这里会去 `find_obj(undefined)` 然后报"跟谁学" */
  who: '你要跟谁学习？（例如：learn 太极剑法 from 教头）',
  /** 目标不在同房间 / 不是活物（wushen `xue.js:9`「你要跟谁学习技能？」） */
  noOne: '这里没有这个人。',

  /**
   * 拒绝文案。`who` 已过 `neutralizePlayerText`，`key` 是玩家敲的那串字
   * （可能是中文名也可能是 id —— 用它而不是 `tpl.name`，因为 `slot` / `attr`
   *  两类拒绝发生在"还没解析出模板名"之前，只有原串一定拿得到）。
   */
  refuse(r: LearnRefused, who: string, key: string): string {
    switch (r.reason) {
      case 'unknown':
        return '没有这个技能。';
      case 'already':
        return `你已经学会了${r.name}。`;
      case 'slot':
        // wushen `xue.js:208`「也许是基本功火候未到，你对师父的讲解总是无法领会。」
        return `你的${r.name}等级不够 ${String(r.need)} 级，还领会不了${key}。`;
      case 'attr':
        // wushen `os/skill/skill.js:235` 用**中文属性名**，不是拼音键
        return `你的${propLabel(r.key)}不够 ${String(r.need)}，还领会不了${key}。`;
      case 'max-mp':
        return `你的内力上限不够 ${String(r.need)}，还领会不了${key}。`;
      case 'gender':
        // ★ 三档取单源（`GENDER_LABELS`），与 `SkillActor.gender` 同一个口径
        return `${GENDER_LABELS[r.gender]}才能学习${key}。`;
      case 'no-teacher':
        // wushen `xue.js:38`「X不会这个技能。」
        return `${who}不会${key}。`;
      case 'master-lower':
        // wushen `xue.js:191`「这项技能你的程度已经不输你师父了。」
        return `你对${key}的造诣已经不输${who}了（${who}才 ${String(r.teacherLevel)} 级）。`;
      case 'capped':
        // wushen `xue.js:201`「也许是缺乏实战经验，你对X的讲解总是无法领会。」
        return `也许是缺乏实战经验，你的${r.name}已经到 ${String(r.limit)} 级上限了，${who}也教不了更多。`;
      case 'no-pot':
        return `你的潜能不够（这一次要 ${String(r.need)} 点），无法继续学习下去了。`;
      case 'hook':
        return `${key}现在学不了。`;
    }
    // ★★ 不写 `default`：十一支全部 `return` 之后 `r` 才收窄成 `never`。
    //   将来给 `LearnRefused` 加一支，`tsc` 会**在这一行失败**，
    //   而不是静默落进一句"你学不了"让玩家不知道该去打怪还是换个人。
    const uncovered: never = r;
    throw new Error(`learn 文案缺一支：${JSON.stringify(uncovered)}`);
  },
} as const;

defineCommand('train/learn', {
  command: 'learn,xue',
  // `learn <技能>` 或 `learn <技能> from <目标>`；技能与目标都允许中文
  regex: /^(\S+)(?:\s+from\s+(\S+))?$/,
  // ★ 照 wushen `xue.js:3-4`：`allow_state: true`（"正在学习"时还能排队学别的）、
  //   `allow_fight: false`（打架时没法听讲）。本项目没有学习状态机，前者是前向兼容。
  allow_state: true,
  allow_fight: false,

  run: (me, rawSkill, rawWho) => {
    const key = (rawSkill ?? '').trim();
    if (key === '') {
      me.notify(LEARN_MESSAGES.usage);
      return;
    }
    const whoKey = (rawWho ?? '').trim();
    if (whoKey === '') {
      me.notify(LEARN_MESSAGES.who);
      return;
    }

    const env = me.environment;
    const target = env === null ? undefined : findTarget(me, env, whoKey);
    // 与 `give.ts` 同一条判据：找得到的必须是**同房间的角色**。
    // "是否活着"不必另判 —— 死掉的 NPC 会被移出房间（`npc.ts#die` 会离开房间）。
    if (target === undefined || (target.kind !== 'npc' && target.kind !== 'player')) {
      me.notify(LEARN_MESSAGES.noOne);
      return;
    }
    const who = neutralizePlayerText(target.name);

    // ★ 老师的等级从**他自己的身体**上读（`ActorObject.skillLevel` 可选：
    //   房间 / 物品没有这个面 ⇒ 读不到就是 0 = "不会"，正是我们要的语义）。
    //   `key` 可以是 id、槽名或中文名 —— `Character.skillLevel` 三种都认。
    const teacherLevel = target.skillLevel?.(key) ?? 0;

    const r = me.learnSkill(key, teacherLevel);
    if (r.kind === 'refused') {
      me.notify(LEARN_MESSAGES.refuse(r, who, key));
      return;
    }
    // ★ 一拍的结算可能一级都没升（经验只累进去）—— 分开说，否则玩家会以为"点了没反应"。
    const head = `你向${who}请教${r.name}`;
    if (r.gained === 0) {
      me.notify(`${head}，颇有心得，但还不足以突破（消耗 ${String(r.spent)} 点潜能，现在 ${String(r.level)} 级）。`);
      return;
    }
    me.notify(`${head}，晋升 ${String(r.gained)} 级，现在是 ${String(r.level)} 级（消耗 ${String(r.spent)} 点潜能）。`);
    // ★ 房间里其他人看到一句（wushen 的 `set_state` 有 `desc` 播报；这里一句话足够）
    me.sendRoom(`$N向$n请教武学。`, target, true);
  },
});

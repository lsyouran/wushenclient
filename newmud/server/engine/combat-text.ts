/**
 * server/engine/combat-text.ts — 战斗播报文案（**引擎内置默认**）
 * ============================================================================
 * 对照 wushen 的三处文案源，全部**照抄语义**：
 *   - 攻击动作　　`world/skill/base/unarmed.js:7-10` 的 `attack_actions`
 *   - 躲闪动作　　`world/skill/base/dodge.js:8-12`   的 `dodge_actions`
 *   - 招架动作　　`world/skill/base/parry.js:13-16`  的 `parry_actions`
 *   - 气血状态　　`world/extends/char/combat.js:294` 的 `status_msg`（10 档）
 *   - 伤害描述　　`world/extends/char/combat.js:315` 的 `damage_msg`（拳脚那一支）
 *   - 胜负 / 死亡 `os/char/combat.js:242` 的 `WINNER_MSG`、`os/char/npc.js` 的 `DIE_MSG`
 *
 * ★★ 与 wushen 的**两处有意偏离**（都在这里，别在别处补）：
 *
 *   ① **去掉颜色标记**。wushen 文案里到处是 `<HIR>` / `<CYN>` / `<wht>` 这类
 *      客户端着色标记；本项目的三视角渲染（`view-text.ts#renderViewText`）
 *      只中和**替换进去的值**（名字 / 称谓），**不解析**模板里的标记 ——
 *      于是 `<HIR>` 会原样显示成 `‹HIR›`。⇒ 文案一律纯文本。
 *
 *   ② **不含攻击部位 `$l`**。wushen 的动作文案都带 `$l`（`$N挥拳攻击$n的$l`，
 *      `$l` 由随机的 `attack_part` 提供）；本项目**没有攻击部位系统**
 *      （`CHARACTER_PARTS` 属战斗体验批次），`$l` 会渲染成空串 ⇒ 句子残缺。
 *      ⇒ 内置的 5 句都改写成**不含 `$l`** 的等价句（见 `ATTACK_ACTIONS`）。
 *      将来接上部位系统时，把 `$l` 加回这几句即可（渲染端已支持该占位符）。
 *
 * ★ 文案是**内容**，但放在引擎层：最小战斗必须能自己播报，否则"打起来了"
 *   在客户端看不到任何东西。内容层将来可以按技能 / 武器覆写（wushen 就是这样，
 *   每个 `base/*` 技能各带一份 `attack_actions`）。
 */

/** 攻击动作（wushen `base/unarmed` 的 `attack_actions`，去 `$l`、去颜色） */
export const ATTACK_ACTIONS = [
  '$N挥拳攻击$n',
  '$N往$n一掌拍去',
  '$N往$n狠狠地踢了一脚',
  '$N提起拳头往$n捶去',
  '$N对准$n用力挥出一拳',
] as const;

/** 躲闪（wushen `base/dodge` 的 `dodge_actions` 中不含 `$l` 的 4 句） */
export const DODGE_ACTIONS = [
  '但是被$p机灵地躲开了。',
  '但是$n身子一侧，闪了开去。',
  '但是被$p及时避开。',
  '但是$n已有准备，不慌不忙的躲开。',
] as const;

/** 招架（wushen `base/parry` 的 `parry_actions`，不含 `$i` 的两句） */
export const PARRY_ACTIONS = ['但是被$p格开了。', '结果被$p挡开了。'] as const;

/** 胜负（wushen `os/char/combat.js:242` 的 `WINNER_MSG`，去颜色） */
export const WINNER_MESSAGES = [
  '$N哈哈大笑，愉快地说道：承让了！',
  '$N双手一拱，笑著说道：知道我的厉害了吧！',
  '$N哈哈大笑，双手一拱，笑著说道：承让！',
  '$N胜了这招，向后跃开三尺，笑道：承让！',
  '$n脸色微变，说道：佩服，佩服！',
  '$n向后退了几步，说道：这场比试算我输了，佩服，佩服！',
  '$n向后一纵，躬身做揖说道：阁下武艺不凡，果然高明！',
] as const;

/** 死亡（wushen `os/char/npc.js` 的 `DIE_MSG`，去颜色与首尾换行） */
export const DIE_MESSAGES = [
  '$N扑在地上挣扎了几下，腿一伸，口中喷出几口鲜血，死了！',
  '$N大叫一声倒在地上，挣扎了几下，死了！',
  '$N口中喷出几口鲜血，倒在地上，死了！',
] as const;

/**
 * 气血状态描述（wushen `status_msg` 的 10 档，`combat.js:294`）。
 *
 * ★ 索引方向照抄 wushen：`status_msg[9 - ratio]`，`ratio = hp*10/maxHp` 截断。
 *   于是 `ratio=9`（满血）→ `[0]`（"充满活力"）、`ratio=0`（濒死）→ `[9]`（"半昏迷"）。
 */
export const STATUS_MESSAGES = [
  '($N看起来充满活力，一点也不累。)',
  '($N似乎有些疲惫，但是仍然十分有活力。)',
  '($N看起来可能有些累了。)',
  '($N动作似乎开始有点不太灵光，但是仍然有条不紊。)',
  '($N气喘嘘嘘，看起来状况并不太好。)',
  '($N似乎十分疲惫，看来需要好好休息了。)',
  '($N已经一副头重脚轻的模样，正在勉力支撑著不倒下去。)',
  '($N看起来已经力不从心了。)',
  '($N摇头晃脑、歪歪斜斜地站都站不稳，眼看就要倒在地上。)',
  '($N已经陷入半昏迷状态，随时都可能摔倒晕去。)',
] as const;

/** 从一组文案里随机取一句（用注入的随机源，便于测试复现） */
export function pick<T>(list: readonly T[], rand: () => number): T {
  const idx = Math.min(list.length - 1, Math.max(0, Math.trunc(rand() * list.length)));
  // `noUncheckedIndexedAccess` 下索引访问是 `T | undefined`；`list` 非空由调用方保证
  return list[idx] as T;
}

/**
 * 气血状态句（wushen `query_status_msg`，`combat.js:306`）。
 * 传**扣血之后**的 `hp` 与派生的 `maxHp`。
 */
export function queryStatusMessage(hp: number, maxHp: number): string {
  let ratio = maxHp > 0 ? Math.trunc((hp * 10) / maxHp) : 0;
  if (ratio < 0) ratio = 0;
  if (ratio > 9) ratio = 9;
  return STATUS_MESSAGES[9 - ratio] as string;
}

/**
 * 伤害描述（wushen `damage_msg` 的**拳脚那一支**，`combat.js:342-352`）。
 *
 * ★ 分档口径照抄：`damage` 先被换算成"占对方**剩余**气血的百分比"
 *   （`damage*100/ob.hp`，且 `ob.hp<=0` 时取 120），再按 `<5 / <10 / <25 / <40 / <50 / <60 / <80 / else` 分档。
 *   传进来的 `targetHpAfter` 必须是**扣血后**的 hp（顺序与 wushen 一致）。
 */
export function damageMessage(dealt: number, targetHpAfter: number, isCrit: boolean): string {
  if (dealt === 0) return '结果没有造成任何伤害。';
  const sh = isCrit ? `${String(dealt)}点暴击伤害` : `${String(dealt)}点伤害`;
  const ratio = targetHpAfter > 0 ? (dealt * 100) / targetHpAfter : 120;
  if (ratio < 5) return `结果只是轻轻地碰到，比拍苍蝇稍微重了点，造成${sh}！`;
  if (ratio < 10) return `结果在$p身上造成一处瘀青，造成${sh}！`;
  if (ratio < 25) return `结果一击命中，$n登时肿了一块老高，造成${sh}！`;
  if (ratio < 40) return `结果一击命中，$n闷哼了一声显然吃了不小的亏，造成${sh}！`;
  if (ratio < 50) return `结果「砰」地一声，$n退了两步，造成${sh}！`;
  if (ratio < 60) return `结果这一下「砰」地一声打得$n连退了好几步，差一点摔倒，造成${sh}！`;
  if (ratio < 80) return `结果重重地击中，$n「哇」地一声吐出一口鲜血，造成${sh}！`;
  return `结果只听见「砰」地一声巨响，$n像一捆稻草般飞了出去，造成${sh}！！`;
}

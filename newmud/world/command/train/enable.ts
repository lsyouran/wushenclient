import { defineCommand } from '@engine/world/define.js';
import type { EnableResult } from '@engine/world/defs.js';
import { ENABLE_SLOTS, isEnableSlot } from '@shared/constants.js';

/**
 * `enable` —— 把一门**武功**装配到某个**基本技能的槽**上（wushen `world/cmd/skill/enable.js`）。
 *
 * 语法与 wushen 同形（`enable.js:2-4` 的 `/^(\w+?)\s+(.+?)$/`）：
 *
 *     enable <槽> <技能>      → 装上（槽里已有的会被顶下来）
 *     enable <槽> none        → 卸下
 *
 * ★ 为什么第一个参数是**槽名**而不是"基本技能的 id"：
 *   wushen 写 `enable sword taijijian`，第一个词恰好既是 `base/sword` 的技能 id
 *   又是槽名（那个"隐式同名前缀"是 docs/27 §3 判定要修的旧账之一）。
 *   本项目把槽名做成**闭集**（`ENABLE_SLOTS`），于是玩家敲的就是槽名本身，
 *   "技能 id 与槽名恰好同名"不再是隐含约定。
 *
 * ★ 拒绝的原因由引擎给（`EnableResult` / `Refused`），文案在这里 ——
 *   与 `practice` / `learn` 同一条纪律：**结构在引擎、措辞在内容层**。
 */
export const ENABLE_MESSAGES = {
  usage: '你要把什么功夫装到什么上面？（例如：enable sword 太极剑法）',
  badSlot: (slot: string): string =>
    `没有「${slot}」这个装配位。可以装的位置：${ENABLE_SLOTS.join(' / ')}。`,
  /** 卸下成功（wushen `enable.js:59`「你决定取消使用X做为Y的特殊技能。」） */
  disabled: (slot: string): string => `你不再在${slot}上使用任何特殊技能。`,
  /** 卸下时那个槽本来就是空的 */
  emptySlot: (slot: string): string => `你的${slot}上本来就没装特殊技能。`,

  refuse(r: EnableResult): string {
    if (r.kind === 'enabled') return '';
    switch (r.reason) {
      case 'unknown':
        return '没有这个技能。';
      case 'not-learned':
        return `你还没学会${r.name}。`;
      case 'not-enablable':
        // 基本技能靠 `slot` 自己占槽，不需要、也不能"被装配"
        return `${r.name}是基本技能，不需要装配。`;
      case 'slot-mismatch':
        return `${r.name}不能装在「${r.slot}」上（它可以装：${r.allows.length === 0 ? '无处' : r.allows.join(' / ')}）。`;
      case 'hook':
        return `${r.name}现在装不上去。`;
    }
    // ★ 不写 `default`：漏一支 `tsc` 当场失败（26 册 §56.8 的同一条纪律）
    const uncovered: never = r;
    throw new Error(`enable 文案缺一支：${JSON.stringify(uncovered)}`);
  },
} as const;

defineCommand('train/enable', {
  command: 'enable',
  regex: /^(\S+)\s+(\S+)$/,
  allow_fight: false,

  run: (me, rawSlot, rawSkill) => {
    const slotKey = (rawSlot ?? '').trim();
    const skillKey = (rawSkill ?? '').trim();
    if (slotKey === '' || skillKey === '') {
      me.notify(ENABLE_MESSAGES.usage);
      return;
    }
    // ★ 槽名先在这里校验：`isEnableSlot` 是**唯一**的闭集来源（`shared/constants.ts`），
    //   引擎那边对非法槽名是**抛错**（调用方写错），而玩家敲错只该得到一句提示。
    if (!isEnableSlot(slotKey)) {
      me.notify(ENABLE_MESSAGES.badSlot(slotKey));
      return;
    }

    if (skillKey === 'none') {
      // wushen `enable.js:29`：`if (skill == "none") return;` —— 卸下是**另一条路**
      if (!me.disableSkill(slotKey)) {
        me.notify(ENABLE_MESSAGES.emptySlot(slotKey));
        return;
      }
      me.notify(ENABLE_MESSAGES.disabled(slotKey));
      return;
    }

    const r = me.enableSkill(slotKey, skillKey);
    if (r.kind === 'refused') {
      me.notify(ENABLE_MESSAGES.refuse(r));
      return;
    }
    // wushen `enable.js:52`「你决定使用X做为Y的特殊技能。」
    const head = `你决定使用${r.name}作为${r.slot}的特殊技能。`;
    me.notify(r.replaced === null ? head : `${head}（原先的${r.replaced}已卸下）`);
  },
});

import { defineCommand } from '@engine/world/define.js';
import type { ForgetResult } from '@engine/world/defs.js';

/**
 * `forget`（别名 `fangqi`）—— **遗忘**一门技能。
 *
 * 对照 wushen `world/cmd/skill/fangqi.js`。
 *
 * ★★ 与 wushen 的差异（**本批不做的一件大事**）：原作的 `fangqi` 会把
 *   100 级以后的潜能**按公式退还**，还牵扯"进阶残页"与融合（`ref` / `addin`）的
 *   前置检查（`fangqi.js:14-40`）。本项目：
 *     - 没有"进阶残页"（`addin` 属门派批次）；
 *     - 没有融合（`lingwu2`）；
 *     - 退潜能会让"学了忘、忘了学"变成一条刷潜能的漏洞（wushen 敢退是因为
 *       它还有等级 ≥ 100 的门槛 + 残页回收一整套）。
 *   ⇒ **本批遗忘不退潜能**，并且这是**有意为之、写在文档里的取舍**（27 册 §14.6）。
 *     将来做进阶/融合时再一起定退还口径，否则现在算一遍、那时再改一遍。
 *
 * ★ "基础与知识类不可遗忘"这条规则在**引擎**里（`Character.forgetSkill`）：
 *   将来 GM 指令、面板、脚本都会遗忘，三条入口各抄一遍迟早漏一条。
 *
 * ★ 不可逆动作的二次确认由**前端**拦（`_confirm` 前缀），照 wushen
 *   （`skills.js:430` 的 `_confirm fangqi <id>`）。服务端不认这个前缀，
 *   于是直接敲 `forget X` 仍然生效 —— 绕过是"自己作的"，不构成事故（§63 决策 3）。
 */
export const FORGET_MESSAGES = {
  usage: '你要遗忘哪一门功夫？（例如：forget 太极剑法）',

  refuse(r: ForgetResult): string {
    if (r.kind === 'forgotten') return '';
    switch (r.reason) {
      case 'unknown':
        return '没有这个技能。';
      case 'not-learned':
        return `你还没学会${r.name}。`;
      case 'base':
        // wushen `fangqi.js:10-12`
        return `${r.name}是基本技能，不能遗忘。`;
      case 'knowledge':
        return `${r.name}是知识类技能，不能遗忘。`;
    }
    // ★ 不写 `default` —— 漏一支编译失败（26 册 §56.8）
    const uncovered: never = r;
    throw new Error(`forget 文案缺一支：${JSON.stringify(uncovered)}`);
  },

  done(r: ForgetResult): string {
    if (r.kind !== 'forgotten') return '';
    const head = `你忘记了${r.name}。`;
    // ★ 装配关系跟着一起卸下（`SkillBook.forget` 内部先 `#detachSlot`）——
    //   不说这一句的话，玩家会以为"忘了但还装着"。
    return r.wasEnabled === null ? head : `${head}（已从${r.wasEnabled}上卸下）`;
  },
} as const;

defineCommand('train/forget', {
  command: 'forget,fangqi',
  regex: /^(\S+)$/,
  allow_fight: false,

  run: (me, rawSkill) => {
    const key = (rawSkill ?? '').trim();
    if (key === '') {
      me.notify(FORGET_MESSAGES.usage);
      return;
    }
    const r = me.forgetSkill(key);
    if (r.kind === 'refused') {
      me.notify(FORGET_MESSAGES.refuse(r));
      return;
    }
    me.notify(FORGET_MESSAGES.done(r));
  },
});

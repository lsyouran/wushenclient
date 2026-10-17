import { defineCommand } from '@engine/world/define.js';
import type { PracticeDone, PracticeRefused } from '@engine/world/define.js';

/**
 * `practice`（别名 `lianxi`）—— **消耗潜能练技能**。
 *
 * 对照 wushen `world/cmd/skill/lianxi.js`。
 *
 * ★★ 它补齐的是成长闭环的最后一环：
 *
 *     打怪 → `NpcDef.exp/pot` → 击杀者 `addExp()`（经验 + 潜能）
 *          → 经验抬高 `Character.skillLimit()`（技能等级上限）
 *          → 潜能在这里换成技能经验 → 技能真正变强
 *
 *   三环缺一不可：没有本指令，潜能只是一个越攒越多的数字（wushen 原作的
 *   `pot` 就长期处于这个状态：**只有加、没有减**）。
 *
 * ★ 与 wushen 的**形态**差异（不是数值差异）：wushen 的 `lianxi` 是一个
 *   **持续状态** —— `set_state({ on_check, on_stop })` 之后由心跳每 5 秒调一次
 *   `do_learn`，可以排队、可以中断。本项目本批做**一次结算**，原因与代价写在
 *   `SkillBook.practice()` 的注释里（state 状态机尚未落地）。账目口径完全一致：
 *   `me.pot -= exp; skill.add_exp(me, exp)`（`lianxi.js:172-175`）。
 *
 * ★ 为什么 id 是 `train/practice` 而不是 `skill/practice`：
 *   `skill` 是 **world id 的保留 area**（`shared/ids.ts#RESERVED_AREAS` 含全部 `KINDS`），
 *   `defineCommand('skill/practice', …)` 会在 `asWorldId` 那一关抛 `IdError`。
 *   G5 又要求「文件路径推出的 id == define 的 id」，所以**目录也不能叫 `skill/`**。
 *   （26 册 §53 的 B 批在 `world/command/item/` 上踩过同一个坑，那次一次打崩 12 个测试文件。）
 */

/** 文案集中在表里（与 `kill.ts` / `fight.ts` 同款），便于对账与改口吻 */
const PRACTICE_MESSAGES = {
  refuse(r: PracticeRefused): string {
    switch (r.reason) {
      case 'unknown':
        return '没有这个技能。';
      case 'not-learned':
        return `你不会${r.name}。`;
      case 'knowledge':
        // wushen `lianxi.js:20-22`
        return `${r.name}只能通过学习增加熟练度。`;
      case 'capped':
        // wushen `lianxi.js:143-145`：「也许是缺乏实战经验，你觉得你的…已经到了瓶颈了。」
        return `也许是缺乏实战经验，你觉得你的${r.name}已经练到 ${String(r.level)} 级，到了瓶颈了（当前上限 ${String(r.limit)} 级）。`;
      case 'reached':
        // ★ 与 capped 分开：这里只是"到你说的那个等级了"，上限还远 —— 别让玩家以为练满了。
        return `你的${r.name}已经练到 ${String(r.level)} 级了。`;
      case 'basis':
        // wushen `lianxi.js:152`：「你的基本功火候未到…」
        return '你的基本功火候未到，必须先打好基础才能继续提高。';
      case 'no-pot':
        return '你的潜能不够，无法继续练习下去了。';
    }
    // ★★ 这里**刻意不写 `default`**。七个分支全部 `return` 之后，`r` 才被收窄成 `never`，
    //   这一行才编译得过。将来谁给 refusal 加第八支，`tsc` 会**在这一行失败** ——
    //   而不是静默落进一个"你现在练不了这门功夫"的兜底文案，让玩家不知道该去打怪
    //   还是去练基本功。（旧实现有 `default`，穷举全靠人肉，等于没有。）
    const uncovered: never = r;
    throw new Error(`practice 文案缺一支：${JSON.stringify(uncovered)}`);
  },

  done(r: PracticeDone): string {
    const head = `你练了一阵${r.name}，消耗 ${String(r.spent)} 点潜能`;
    // ★ 潜能可能不够升一级（经验只累到一半）—— 那**不算失败**，钱已经花在熟练度上了。
    //   把这两种结果分开说，玩家才不会以为"点了没反应"。
    if (r.gained === 0) {
      return `${head}，火候更深了一层，但还不足以突破（当前 ${String(r.level)} 级）。`;
    }
    return `${head}，晋升 ${String(r.gained)} 级，现在是 ${String(r.level)} 级（上限 ${String(r.limit)} 级）。`;
  },
} as const;

defineCommand('train/practice', {
  command: 'practice,lianxi',
  // 技能名（中文或 id）+ 可选目标等级
  regex: /^(\S+)(?:\s+(\d+))?$/,
  // ★ 照 wushen `lianxi.js:4`：练习本身就是一个"状态"，所以它不因"正在状态中"被挡。
  allow_state: true,

  run: (me, rawKey, rawTarget) => {
    const key = (rawKey ?? '').trim();
    if (key === '') {
      me.notify('你要练哪一门功夫？（例如：practice 太极剑法）');
      return;
    }
    const target = rawTarget === undefined ? undefined : Number(rawTarget);
    const r = me.practiceSkill(key, target);
    if (r.kind === 'refused') {
      me.notify(PRACTICE_MESSAGES.refuse(r));
      return;
    }
    me.notify(PRACTICE_MESSAGES.done(r));
  },
});

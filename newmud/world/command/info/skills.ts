import { defineCommand, findTarget } from '@engine/world/define.js';
import { neutralizePlayerText } from '@shared/player-text.js';

/**
 * `skills`（别名 `cha`）—— 打开**技能面板**；带目标时**看别人会什么**。
 *
 * 对照 wushen `world/cmd/dialog/cha.js`：
 *
 *     cha            → {type:"dialog",dialog:"skills",items:[…],title,limit,pot}
 *     cha none       → 只更上限（面板已经开着时用）
 *     cha <目标>     → 看**师父的技能表**（wushen `Dialog.master`，面板里点一门就 `xue`）
 *
 * ★★ 为什么不是"往日志区刷一张表"：技能是**会一直开着、随时能翻、还要能点**的东西
 *   （装配 / 遗忘 / 练习都在面板里做）。日志区是流水账，刷完就找不回 ——
 *   这与属性面板（26 册 §62）是同一条判断：`score` 从九行文本改成 `dialog:score` 帧。
 *
 * ★ 数据一次取全（`CommandActor.skillView()`）：等级 / 进度 / 装配 / 上限 / 潜能
 *   都在引擎里读，前端**不碰**经验公式（`progress` 由服务端算，见 27 册 §14.5.2）。
 *
 * ★ 别名 `cha` 照抄 wushen：它是老玩家的肌肉记忆，删掉等于让人重学一遍指令。
 *   （`ALIAS_RE` 只收 `[a-z][a-z0-9_]*`，所以中文别名进不来 —— 这不是遗漏。）
 *
 * ★★ `skills <目标>` **只开放给 NPC**（2026-10-19）：原先这里写的是"不支持看别人的技能"，
 *   理由是"没有师父系统，摆一个半开的入口不如不摆"。现在有了明确的用途 ——
 *   **测试时要能看到教头到底会哪几门、各几级**，否则 `learn 基本刀法 from 教头`
 *   能不能成只能靠试。取舍：
 *     · **NPC 可以看**：NPC 的技能表是**内容层写死的东西**，不是玩家隐私；
 *     · **玩家不可以看**：那需要"师父 / 好友 / GM"这类关系判定，本项目还没有。
 *       ⇒ 刻意只做一半，而不是先做一半的权限再补另一半。
 *
 * ★ 看 NPC 时**走文本而不是技能面板**：面板是"我的技能"的界面（带装配 / 练习 / 遗忘
 *   三个动作，对别人没有意义）。这里只回一段清单 + 一句可点的 `learn` 提示。
 *
 * ★ 三个闸门全开（`allow_busy` / `allow_state` / `allow_die`），照 wushen
 *   `cha.js:3-6` 的四行 —— 查看自己的技能不该被任何状态挡住。
 */
export const SKILLS_MESSAGES = {
  /** 目标不在同房间（与 `learn` 的 `noOne` 同款） */
  noOne: '这里没有这个人。',
  /** 目标是玩家：本批不做"看别人的技能"（见文件头） */
  player: '看不了别的玩家的技能。',
  /** NPC 一门都不会（内容层写漏了，或那只 NPC 本来就不教学） */
  empty: (who: string) => `${who}什么武功也不会。`,
  /** 一行：`内功（force）300 级` */
  line: (name: string, slot: string | undefined, level: number): string =>
    slot === undefined ? `${name} ${String(level)} 级` : `${name}（${slot}）${String(level)} 级`,
} as const;

defineCommand('info/skills', {
  command: 'skills,cha',
  // `skills` 或 `skills <目标>`；目标允许中文
  regex: /^(\S+)?$/,
  allow_busy: true,
  allow_state: true,
  allow_die: true,
  allow_faint: true,

  run: (me, rawWho) => {
    const who = (rawWho ?? '').trim();
    if (who === '') {
      // ★ 内容层只负责"摆"：一切读数与进度都在 `skillView()` 里算好。
      me.showSkills(me.skillView());
      return;
    }

    const env = me.environment;
    const target = env === null ? undefined : findTarget(me, env, who);
    if (target === undefined) {
      me.notify(SKILLS_MESSAGES.noOne);
      return;
    }
    if (target.kind !== 'npc') {
      me.notify(SKILLS_MESSAGES.player);
      return;
    }

    const name = neutralizePlayerText(target.name);
    const list = target.skillList?.() ?? [];
    if (list.length === 0) {
      me.notify(SKILLS_MESSAGES.empty(name));
      return;
    }
    me.notify(`${name}所会的武功：`);
    for (const s of list) {
      me.notify(`  ${SKILLS_MESSAGES.line(s.name, s.slot, s.level)}`);
    }
    // ★ 学了就点这一下：把"能学"变成可执行的一步，而不是让玩家自己拼一条命令。
    //
    // ★★ 2026-10-20 §74 真机反馈：这里原来**只发第一门**的按钮
    //   （`const first = list[0]`），于是`skills 教头` 列了七行，
    //   底下却只有一颗「学基本内功」—— 玩家要学第二门只能自己拼命令。
    //   一眼看去就是"教头只教一门/两门"。
    //   ⇒ 每列一门就配一个按钮。清单与按钮**同源**（都来自 `skillList()`），
    //   不存在"列出来了却点不到"。
    if (list.length > 0) {
      me.sendCommands(...list.flatMap((s) => [`learn ${s.id} from ${name}`, `学${s.name}`]));
    }
  },
});

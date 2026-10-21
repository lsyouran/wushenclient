import { defineCommand, findTarget } from '@engine/world/define.js';
import type { CommandActor, StateSpec } from '@engine/world/defs.js';
import { LEARN_MESSAGES } from './learn.js';

/**
 * `study`（别名 `du`）—— **研读秘籍**：技能族的第二条成长路。
 *
 * 对照 wushen `world/cmd/skill/study.js`。
 *
 * ★★ 为什么它不是"又一个 learn"（26 册 §75）：
 *
 *     | | 学 `learn` | 读 `study` |
 *     |---|---|---|
 *     | 前提 | 有师父、在同一房间 | 手上有**书** |
 *     | 代价 | 花**潜能**（师父的等级越高越贵） | **不花潜能**，按智力每拍涨 |
 *     | 形态 | 一次结算 | **持续状态**（`startState`，每 5 秒一拍） |
 *     | 上限 | 师父的等级 | **书的上限** |
 *
 *   最后两行是重点：它必须能被打断（`stop`）、必须有过程 —— 这也正是
 *   "技能系统只做了一半"里缺的那一半。
 *
 * ★ 判据链（每一道决定下一句说什么）：
 *   ① 手上有这本书（`findTarget(me, null, key)` —— 只看自己身上，与 `use` 同口径）
 *   ② 它**能读**（`interact.studySkill` 在不在，wushen `study.js:14`「你不能从…里学到任何东西」）
 *   ③ 同一门技能已经在读 ⇒ 不重复开（`startState` 返回 false）
 *   ④ 每一拍：`studySkill()` 返回 `refused` / `blocked` ⇒ **结束状态**并说明原因
 *
 * ★ 为什么每拍不播报"似乎有些心得"：5 秒一条会把消息流刷成噪声。
 *   wushen 把那句放在 `state.desc` 里（**常驻显示**，不是追加）。这里照办：
 *   `desc` 进 `state` 帧，只在**升级**时往消息流说一句。
 */

/** 读书的一拍多长（毫秒）—— 与 `Character.DEFAULT_STATE_INTERVAL_MS` 一致，这里写出来是为了可读 */
const STUDY_INTERVAL_MS = 5_000;

/**
 * 一拍加多少技能经验（wushen `study.js:128`）：
 *
 *     exp = (me.int + query_prop("int")) * (100 + study_per) / 100 * 2
 *
 * 本项目没有 `study_per` 这类效率属性，取**下式**：`(有效智力) × 2`。
 * ★ 用**有效**智力（先天 + 后天加成），不是先天那一档 —— 与 26 册 §37 的归一同一口径。
 */
export function studyExpPerTick(int: number): number {
  if (!Number.isFinite(int) || int <= 0) return 2;
  return Math.max(1, Math.trunc(int) * 2);
}

export const STUDY_MESSAGES = {
  what: '你要研读什么？（例如：study 太极剑法秘籍）',
  /** 身上没有这本书（wushen `study.js:10`「你身上没有这本书。」） */
  notCarried: '你身上没有这本书。',
  /** 这本书没有 `studySkill` —— 它教不了任何东西（wushen `study.js:14`） */
  notBook: (name: string): string => `你不能从${name}里学到任何东西。`,
  /** 开始（wushen `study.js:59`「你开始认真研读X。」） */
  start: (name: string): string => `你开始认真研读${name}。`,
  /** 已经有状态了（`startState` 返回 false） */
  busy: '你正忙着别的事，先停下来再说。',
  /** 书太浅（wushen `study.js:96-97`） */
  tooShallow: (name: string, level: number, bookMax: number): string =>
    `这本书上的内容对你来说太浅了（你的${name}已经 ${String(level)} 级，书只教到 ${String(bookMax)} 级）。`,
  /** 这一拍升级了 */
  gained: (name: string, gained: number, level: number): string =>
    `你对${name}有了新的领悟，晋升 ${String(gained)} 级，现在是 ${String(level)} 级。`,
  /** 被人打断 / 自己停 */
  stop: '你合上书，不再研读。',
} as const;

/** 从角色身上读**有效**智力（先天 + 后天），与 `attrBreakdowns` 同一口径 */
function effectiveInt(me: CommandActor): number {
  const row = me.attrBreakdowns().find((a) => a.key === 'int');
  return row?.total ?? 0;
}

defineCommand('train/study', {
  command: 'study,du',
  // 只收一个参数：书名（中文全名 / 模板路径末段 / 实例 id 都能命中，见 `findTarget`）
  regex: /^(\S+)$/,
  // ★ 照 wushen `study.js:3`：`allow_fight: false`（打架时读不了书）；
  //   不给 `allow_state` —— 正在读时不能再开一本（`startState` 也会拦，这里是双保险）。
  allow_fight: false,

  run: (me, rawKey) => {
    const key = (rawKey ?? '').trim();
    if (key === '') {
      me.notify(STUDY_MESSAGES.what);
      return;
    }
    // 只在自己身上找：`env` 传 `null`，与 `use` / `drop` / `give` 同口径
    const item = findTarget(me, null, key);
    if (item === undefined) {
      me.notify(STUDY_MESSAGES.notCarried);
      return;
    }
    const skillId = item.interact?.studySkill;
    if (skillId === undefined) {
      me.notify(STUDY_MESSAGES.notBook(item.name));
      return;
    }
    const bookMax = item.interact?.studyMaxLevel ?? 100;
    const bookName = item.name;

    // ★★ 起状态**之前**先预检一次（`exp = 0`，不加经验也不建档）。
    //   不预检的后果是真机抓到的：玩家对着《太极剑法秘籍》敲 study，屏幕先回
    //   "你开始认真研读…"、状态帧也发了，**五秒后**才说"基本功火候未到"——
    //   一个明明读不了的动作先被接受了。wushen 的 `check_skill` 也在
    //   `set_state` **之前**判（`study.js:56`），顺序上就是"先问能不能，再开始"。
    const pre = me.studySkill(skillId, 0, bookMax);
    if (pre.kind === 'refused') {
      me.notify(
        pre.reason === 'too-shallow'
          ? STUDY_MESSAGES.tooShallow(pre.name, pre.level, pre.bookMax)
          : STUDY_MESSAGES.notBook(bookName),
      );
      return;
    }
    if (pre.kind === 'blocked') {
      me.notify(LEARN_MESSAGES.refuse(pre.refusal, '', bookName));
      return;
    }

    const spec: StateSpec = {
      id: 'study',
      title: '研读',
      desc: `你正在研读${bookName}。`,
      intervalMs: STUDY_INTERVAL_MS,
      tick: (self) => {
        const r = self.studySkill(skillId, studyExpPerTick(effectiveInt(self)), bookMax);
        if (r.kind === 'refused') {
          if (r.reason === 'too-shallow') {
            self.notify(STUDY_MESSAGES.tooShallow(r.name, r.level, r.bookMax));
          } else {
            self.notify(STUDY_MESSAGES.notBook(bookName));
          }
          return false;
        }
        if (r.kind === 'blocked') {
          // ★ 复用 learn 的那套文案：读书**不能**绕过基本功门槛，
          //   所以玩家看到的拒绝理由必须与"跟师父学"时一模一样（26 册 §64 的文案单源）。
          self.notify(LEARN_MESSAGES.refuse(r.refusal, '', bookName));
          return false;
        }
        // 只有**升级**才是"发生的事"；没升级就安静地攒着（wushen 同）
        if (r.gained > 0) self.notify(STUDY_MESSAGES.gained(r.name, r.gained, r.level));
        return true;
      },
    };

    if (!me.startState(spec)) {
      me.notify(STUDY_MESSAGES.busy);
      return;
    }
    me.notify(STUDY_MESSAGES.start(bookName));
  },
});

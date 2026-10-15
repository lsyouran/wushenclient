/**
 * server/world/validate.ts — 世界引用校验（闸门 G4）
 * ============================================================================
 * wushen 的出口写错房间 path，只有运行时 `ROOM.Get` 返回 undefined 才暴露，
 * 且 `os/char/user.js:246` 的 `rm.is_fb()` 会直接崩（21 册 #18）。
 *
 * 本模块在**启动期**把两类"对不上"查一遍，全部变成启动即报：
 *   ① **跨对象引用**（`REF_CHECK_PATHS`）：出口指的房间、掉落的物品、NPC 的技能…；
 *   ② **闭集词汇**（`VOCAB_CHECK_PATHS`）：装配槽名、核心属性键这类"不在注册表里、
 *      而在一张硬编码词表里"的值（docs/27 D1 把 `enableAs` / `can_enables` 收敛到此类）。
 *
 * ★ 两张表都是**可执行的**：`tests/validate.test.ts` 会构造"每个检查点都坏掉"的世界，
 *   断言每个声明的检查点都真的产生了 error。这样"表"与"实现"不能各自演化
 *   （docs/26 M2：旧实现把表放在 `shared/ids.ts` 的 `REF_EXPECTS` 里，
 *    字段名早已不符且零使用，于是没人发现它已经变成谎言）。
 */

import { DIRECTIONS, ENABLE_SLOTS, isEnableSlot, isPropKey } from '@shared/constants.js';
import type { Kind } from '@shared/ids.js';
import { has, idsOf, entriesOf } from '../engine/registry.js';
import type { AreaDef, FamilyDef, ItemDef, NpcDef, RoomDef, SkillDef } from './defs.js';

export interface WorldProblem {
  readonly level: 'error' | 'warn';
  readonly where: string;
  readonly message: string;
}

/**
 * 被校验的**跨对象引用点**清单（与 `validateWorld()` 的实现一一对应）。
 *
 * ★ 它不只是文档：`tests/validate.test.ts` 会断言**每个条目都真的被校验**。
 *   新增一行而不实现校验 → 测试立刻变红（不是"加了表就通过"）。
 *
 * ⚠️ 这里**只放跨对象引用**（"某个 id 在不在注册表里"）。
 *    `npc.skills[].enableAs` 与 `skill.can_enables[]` 曾经在表里，但自从
 *    docs/27 决策 D1 把它们从"内容技能 id"改成"**闭集槽名**"之后，
 *    它们就不再指向注册表里的任何对象了 —— 于是搬到下面的 `VOCAB_CHECK_PATHS`。
 *    把两类检查混在一张表里，会让"表 = 引用点"这句断言在语义上失真。
 */
export const REF_CHECK_PATHS: ReadonlyArray<{
  readonly where: string;
  readonly kind: Kind;
}> = [
  { where: 'room.exits.<dir>', kind: 'room' },
  { where: 'room.npcs[]', kind: 'npc' },
  { where: 'room.objects[]', kind: 'item' },
  { where: 'area.first', kind: 'room' },
  { where: 'npc.drops[].obj', kind: 'item' },
  { where: 'npc.skills[].skill', kind: 'skill' },
  { where: 'item.combine_to', kind: 'item' },
  { where: 'family.family_area', kind: 'area' },
  { where: 'family.skills[]', kind: 'skill' },
];

/**
 * 被校验的**闭集词汇**检查点（与 `REF_CHECK_PATHS` 同一条纪律：**表必须可执行**）。
 *
 * 为什么单独立一张表而不是混进上面：这里的"坏值"**不是**"注册表里查不到"，
 * 而是"不在一个**硬编码的闭集**里"。两者的失败信息、可修方式都不同
 * （前者要去建那个对象，后者是拼错了词）。
 *
 * ★ 为什么必须校验运行时：`EnableSlot` / `PropKey` 已经能在**编译期**挡住绝大多数
 *   写错（写错即 tsc 报错）。但注册表可以被程序化地填充（GM 热更、测试夹具、
 *   `as unknown as` 强转），编译期护栏在那里是失效的 —— 所以 G4 要兜一道。
 *   对应 24 册 §3.4「类型管主流、闸门管残留」。
 */
export const VOCAB_CHECK_PATHS: ReadonlyArray<{
  readonly where: string;
  readonly vocab: 'ENABLE_SLOTS' | 'PROP_KEY';
}> = [
  { where: 'npc.skills[].enableAs', vocab: 'ENABLE_SLOTS' },
  { where: 'skill.can_enables[]', vocab: 'ENABLE_SLOTS' },
  { where: 'skill.learnCondition.minSlot', vocab: 'ENABLE_SLOTS' },
  { where: 'skill.learnCondition.minAttr', vocab: 'PROP_KEY' },
];

const DIRECTION_SET: ReadonlySet<string> = new Set<string>(DIRECTIONS);

function refError(where: string, kind: Kind, id: string): WorldProblem {
  return {
    level: 'error',
    where,
    message: `引用的 ${kind} "${id}" 不存在（已有 ${idsOf(kind).length} 个 ${kind}）`,
  };
}

/** 闭集词汇违规的统一文案（**同一个词表只有一句提示**，不各写一份） */
function vocabError(where: string, what: string, allowedText: string, got: unknown): WorldProblem {
  return {
    level: 'error',
    where,
    message: `${what} 非法：${JSON.stringify(got)}（允许：${allowedText}）`,
  };
}

/** 装配槽词表的可读提示（取自唯一事实源 `ENABLE_SLOTS`，不手抄） */
const SLOT_HINT = ENABLE_SLOTS.join('/');
/** 核心属性词表的可读提示。**不枚举**（CORE∪MOD 共 400+ 个键，列出来没人看） */
const PROP_HINT = '核心键 ∪ 派生 MOD 族（add_/diff_/_per；见 shared/constants.ts）';

class Collector {
  readonly problems: WorldProblem[] = [];
  readonly #seen = new Set<string>();

  ref(where: string, kind: Kind, id: string | undefined): void {
    if (id === undefined) return;
    if (has(kind, id)) return;
    // 去重（★ docs/26 L4）：变体与基对象共享引用时，一条坏引用曾经按变体数
    // 重复报 N 次。去重键 = 报错定位 + 期望 kind + 目标 id —— 同一处问题只报一次。
    const key = `${where}|${kind}|${id}`;
    if (this.#seen.has(key)) return;
    this.#seen.add(key);
    this.problems.push(refError(where, kind, id));
  }

  refs(where: string, kind: Kind, ids: readonly string[] | undefined): void {
    if (ids === undefined) return;
    for (const id of ids) this.ref(where, kind, id);
  }

  error(where: string, message: string): void {
    this.problems.push({ level: 'error', where, message });
  }
}

/** 校验全量已注册内容，返回问题清单（空数组 = 通过） */
export function validateWorld(): WorldProblem[] {
  const c = new Collector();

  for (const e of entriesOf('room')) {
    const def = e.def as RoomDef;
    // ★ 按**模板**报告：变体与基对象共享同一份字段，引用问题只报一次，定位到基 id
    //   （docs/26 L4）。变体若整体覆盖某字段，其独有的坏引用同样会被这个循环查到。
    const at = `room "${e.variantOf ?? e.id}"`;
    if (def.exits !== undefined) {
      for (const [dir, target] of Object.entries(def.exits)) {
        if (!DIRECTION_SET.has(dir)) {
          c.error(`${at}.exits`, `非法方向键 "${dir}"（允许：${DIRECTIONS.join('/')}）`);
        }
        c.ref(`${at}.exits.${dir}`, 'room', target);
      }
    }
    c.refs(`${at}.npcs`, 'npc', def.npcs);
    c.refs(`${at}.objects`, 'item', def.objects);
  }

  for (const e of entriesOf('area')) {
    const def = e.def as AreaDef;
    c.ref(`area "${e.variantOf ?? e.id}".first`, 'room', def.first);
  }

  for (const e of entriesOf('npc')) {
    const def = e.def as NpcDef;
    const at = `npc "${e.variantOf ?? e.id}"`;
    if (def.drops !== undefined) {
      for (const d of def.drops) c.ref(`${at}.drops`, 'item', d.obj);
    }
    if (def.skills !== undefined) {
      // ★ 槽占用**冲突**检查（2026-10-13 体检 E2）：同一个 NPC 的两条技能不能抢同一个
      //   装配槽。技能簿那边已经改成"后声明者挤掉先者"（不会再静默分家），
      //   但**挤下是有损的** —— 作者多半只是想写两个不同的槽。启动期就把这处内容错误
      //   点出来，比等到运行期发现"少了一个技能"要好。
      const slotOwner = new Map<string, string>();
      for (const s of def.skills) {
        c.ref(`${at}.skills`, 'skill', s.skill);
        // ★ docs/26 L3 + docs/27 D1：`enableAs` 曾经有**两套 id 空间** —— 既接受裸
        //   `force`（BASE_SKILLS）又接受注册 id `base/force`。同一字段两个命名空间
        //   正是 24 册禁止清单第 1 条的形态。现在只有一套：**装配槽名**（ENABLE_SLOTS）。
        if (s.enableAs !== undefined && !isEnableSlot(s.enableAs)) {
          c.problems.push(
            vocabError(`${at}.skills.enableAs`, '装配槽名 enableAs', SLOT_HINT, s.enableAs),
          );
          continue;
        }
        if (s.enableAs !== undefined) {
          const prev = slotOwner.get(s.enableAs);
          if (prev !== undefined) {
            c.error(
              `${at}.skills.enableAs`,
              `技能 ${prev} 与 ${s.skill} 都声明装配到槽「${s.enableAs}」` +
                `—— 一个槽同时只能挂一个武功（后声明者会把先者挤下）`,
            );
          } else {
            slotOwner.set(s.enableAs, s.skill);
          }
        }
      }
    }
  }

  for (const e of entriesOf('item')) {
    const def = e.def as ItemDef;
    c.ref(`item "${e.variantOf ?? e.id}".combine_to`, 'item', def.combine_to);
  }

  for (const e of entriesOf('skill')) {
    const def = e.def as SkillDef;
    const at = `skill "${e.variantOf ?? e.id}"`;
    // ★ 同上的收敛：`can_enables` 里写的是**槽名**（`'sword'`），不是内容技能 id（`'base/force'`）。
    for (const slot of def.can_enables ?? []) {
      if (!isEnableSlot(slot)) {
        c.problems.push(vocabError(`${at}.can_enables`, '装配槽名 can_enables', SLOT_HINT, slot));
      }
    }
    const lc = def.learnCondition;
    if (lc !== undefined) {
      for (const slot of Object.keys(lc.minSlot ?? {})) {
        if (!isEnableSlot(slot)) {
          c.problems.push(
            vocabError(`${at}.learnCondition.minSlot`, '装配槽名 minSlot', SLOT_HINT, slot),
          );
        }
      }
      for (const key of Object.keys(lc.minAttr ?? {})) {
        if (!isPropKey(key)) {
          c.problems.push(
            vocabError(`${at}.learnCondition.minAttr`, '属性键 minAttr', PROP_HINT, key),
          );
        }
      }
    }
  }

  for (const e of entriesOf('family')) {
    const def = e.def as FamilyDef;
    const at = `family "${e.variantOf ?? e.id}"`;
    c.ref(`${at}.family_area`, 'area', def.family_area);
    c.refs(`${at}.skills`, 'skill', def.skills);
  }

  return c.problems;
}

/**
 * 启动期调用：有 error 即抛错终止（fail-fast，不留半可用状态）。
 *
 * ★ 返回全部问题清单（不只是抛错）—— 这样**组合根不需要再实现一遍**
 *   「过滤 error → 拼详情 → 抛错」。docs/26 M3：旧实现里这段逻辑
 *   在 `bootstrap.ts` 被重写了一份，而本函数无人调用（死代码）。
 *   那正是 24 册 §4 禁止清单第 8 条「同一逻辑在两处各写一份」。
 */
export function assertWorldValid(): readonly WorldProblem[] {
  const problems = validateWorld();
  const errors = problems.filter((p) => p.level === 'error');
  if (errors.length === 0) return problems;
  const detail = errors.map((p) => `  - ${p.where}：${p.message}`).join('\n');
  throw new Error(`世界引用校验失败（${errors.length} 处）：\n${detail}`);
}

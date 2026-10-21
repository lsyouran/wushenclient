/**
 * server/engine/skill.ts — 技能簿（模板 / 状态 / 装配 / 三档属性 / 绝招冷却）
 * ============================================================================
 * 对照 wushen：`os/skill/skill.js`（模板 + 学到/升级/进阶）+ `os/char/chara_skill.js`
 * （角色侧技能表 + 装配 + 生效技能解析）。设计册：`docs/wushen/12`；本项目 `docs/27`。
 *
 * ★ 抄过来的三件好东西（12 册 §12.4 第 1/2/3 条）：
 *   1. **三档属性**：① 学会即生效 ② 启用后生效 ③ 进阶附加（本批只做 ①②）。
 *   2. **装配模型**：`can_enables` + 「一个槽同时只挂一个武功」。
 *   3. **绝招作为技能子对象**：独立 MP / 出招时间 / 冷却。
 *
 * ★ 用 TS 的**结构能力**规避 wushen 的缺陷（docs/27 §3）：
 *   1. `release_prop → 改 level → attach_prop` 的**增量三角会漂移**（漏一步就永久重复累加，
 *      而且不报错）→ 改成 **`SkillBook` 记账式重算**：先减旧账、再加新账。**幂等**。
 *   2. `SKILL[can_enable][grade] = [...]` **往类上挂索引** → 独立 `SkillRegistry`。
 *   3. `query_skill = level + query_prop(技能id)`（用 prop 键冒充"装备加技能等级"）
 *      → **不抄**：技能等级只来自技能记录本身。
 *   4. 槽名隐式（"基本技能 id 恰好等于槽名"）→ `SkillDef.slot` **显式** + `EnableSlot` 闭集。
 *   5. 单调"持续时间数值"表示 BUFF → 冷却走 `TempStore` 的 **TTL**（到期自动失效，无需清理）。
 *
 * 退出码无关；本文件是被引擎调用的纯逻辑，不碰 socket。
 */

import {
  BASE_SKILLS,
  ENABLE_SLOTS,
  SKILL_TYPES,
  isEnableSlot,
  isExtProp,
  isPropKey,
} from '@shared/constants.js';
import type { EnableSlot, ExtProp, PropKey, SkillType } from '@shared/constants.js';
import { COMBAT_FORMULA, isAttrKey } from './formula.js';
import { describeValue, isPlainRecord } from './load-report.js';
import type { LoadReport, RejectedEntry } from './load-report.js';
import {
  addExtProp,
  addProp,
  getExtProp,
  getProp,
  removeExtProp,
  removeProp,
} from './props.js';
import type { PropHolder } from './props.js';
import type { TempStore } from './temp.js';
import { SKILL_CURVE } from '../world/skill-curves.js';
import type {
  LearnRefused,
  LearnResult,
  PerformDef,
  PracticeResult,
  PropMap,
  SkillActor,
  SkillDef,
  SkillLearnCondition,
  StudyResult,
} from '../world/defs.js';

export class SkillError extends Error {
  public override readonly name = 'SkillError';
}

// ---------------------------------------------------------------------------
// 可调数值（★ docs/27 决策 D4：所有"要调平衡的数字"集中在这里，先照抄 wushen）
// ---------------------------------------------------------------------------
//
// 与 `formula.ts` 的 `COMBAT_FORMULA` 同一取向：**公式体只做算术，参数全在这张表**。
// 汇总入口见 `server/engine/tuning.ts`（改平衡数值只需看那一个文件）。
//
// ⚠️ 这些值**照抄自 wushen**（`os/skill/skill.js:46-99`、`:380`），尚未做平衡校准。
//    要调整时改这里；`tests/engine-skill.test.ts` 会钉住"改了会怎样"。

export const SKILL_FORMULA = {
  /** 每级所需经验系数：`(lv+1) * (grade+1) * expBase`（wushen `level_exp`） */
  expBase: 5,
  /** 从这一级起才计评分（wushen 只在 `level > 100` 时累加 score） */
  scoreFromLevel: 100,
  /** 进阶（突破）的最低等级（wushen `grade_up` 要求 1000） */
  gradeUpMinLevel: 1000,
  /** 进阶新等级公式的分子：`sqrt(pot * num / den / (targetGrade+1))` */
  gradeUpPotNum: 2,
  gradeUpPotDen: 5,
  /** 等级上限曲线：`exp < limitExpMin` 时固定 `limitExpMinLevel` */
  limitExpMin: 100,
  limitExpMinLevel: 10,
  /** 上限因子按**境界**（0-6）取；`round(pow(exp * factor, 1/3))`（wushen `skill_limit`） */
  limitRealmFactor: [10, 20, 30, 40, 50, 60, 60] as const,
  /**
   * **境界阈值**（技能等级）—— 境界 = 内功 / 轻功 / 招架**三槽等级的最小值**落在第几档。
   *
   * ★★ 为什么是**三槽取最小**（木桶）：境界是"这个人的整体层次"，不是"他最拿手的那门"。
   *   取最大值会让"只练剑、不练内功"的人一路升到顶，而内功是气血与内力上限的来源
   *   （`forceRad`）—— 那种角色会变成"高境界、纸糊的血条"。取最小值逼三样都练。
   *
   * ★★ **循环依赖与它为什么收敛**（这里最容易被后人误判成 bug）：
   *     境界 ← 三槽等级 ← 技能上限 ← `limitRealmFactor[境界]` ← 境界
   *   闭环存在，但**单调收敛**：上限只由 `exp` 与当前境界决定，而 `exp` 来自打怪、
   *   不受技能上限约束。只要"升下一档所需的等级"在本档上限内能练到（下面的阈值都
   *   远小于 1000 的硬顶），玩家攒够经验就一定能升上去，不会卡死。
   *   ⇒ 阈值必须是**常数**；若把它写成 `exp` 的函数，就会变成"境界完全由经验决定"，
   *     三槽等级这一维就白设了。
   *
   * ★ 1000 是最后一档的门槛：它同时是 `limitMaxLevel`（硬顶），于是"深不可测"
   *   必须三样都练到顶才够 —— 这是刻意的，最后一档应该是终点而不是路过。
   */
  realmThresholds: [50, 150, 300, 500, 800, 1000] as const,
  /** `max_level` 缺省值（内容层漏写时的**保守兜底**，不是本项目的设计上限） */
  defaultMaxLevel: 100,
  /**
   * 技能等级的**硬顶** —— 经验换算出来的上限不可能超过它。
   *
   * ★ 值来自 `SKILL_CURVE.refLevel`（**不是**另写一个 1000）：曲线的标定点就是
   *   "练满拿满额加成"的那一级，两者必须相等，否则会出现"练到顶也拿不满"。
   *   所以这里用引用而不是字面量，结构上不可能漂移。
   */
  limitMaxLevel: SKILL_CURVE.refLevel,
} as const;

// ★ 基本技能的 ① 档被动曲线**不在这张表里**，在 `server/world/skill-curves.ts`
//   （`SKILL_CURVE`）。原因是依赖方向（G13 D2）：内容层 `world/skill/base/*.ts`
//   只允许 import `@shared/**` 与 `server/world/**`，而曲线必须由内容层调用
//   （`passiveProp` 是内容写的），否则 6 份文件各写一条曲线 = 第二份真相。
//   引擎侧要读它也没问题（G13 D1 只禁 `server/engine` → `world/**`）。
//   汇总视图仍是一处：`tuning.ts` 把 `SKILL_CURVE` 与这张表并排列出。

/** 升到 `level+1` 所需的经验（wushen `level_exp`） */
export function levelExp(level: number, grade: number): number {
  return (level + 1) * (grade + 1) * SKILL_FORMULA.expBase;
}

/**
 * 从 0 级练到 `level` 的**累计**经验需求（wushen `query_needexp`）。
 * `level <= 100` 时为 0（wushen 只在 `>100` 时才算，用于进阶换算）。
 */
export function totalNeedExp(level: number, grade: number): number {
  if (level <= SKILL_FORMULA.scoreFromLevel) return 0;
  const base = ((SKILL_FORMULA.scoreFromLevel + level) * (level - SKILL_FORMULA.scoreFromLevel)) / 2;
  return base * (grade + 1) * SKILL_FORMULA.expBase;
}

/**
 * 技能等级上限（wushen `skill_limit`）；`realm` = 境界 level 0-6。
 *
 * ★★ 这是「**技能上限由经验换算**」的唯一落点：
 *
 *     `上限 = min( round( (exp × 境界因子)^(1/3) ), limitMaxLevel )`
 *
 *   · `exp` 是**角色经验**，境界因子 10→60 只是把同一份经验放大到 1.8 倍上限；
 *   · 经验是等级的**立方** ⇒ 上限从 100 涨到 200 要 8 倍经验，200→400 要 8 倍，
 *     400→1000 又要 15.6 倍。这就是"越到后期越难突破"在算术上的来源。
 *   · 末尾的 `min` 是**硬顶**：wushen 没有这一层，`cbrt` 会让高境界 + 巨量经验
 *     无限膨胀（realm 6 下 1 亿经验能算出 1817 级）。本项目把天花板标在
 *     `SKILL_CURVE.refLevel`（= 曲线标定点），于是"练满 1000 级"既能达到，
 *     又不会溢出到曲线函数里被截断而白练。
 *
 * ★ wushen 只把这条曲线用在**玩家**的练习路径上；本项目同理 ——
 *   `Npc.skillLimit()` 返回 `Infinity`，NPC 的上限就是模板 `max_level`。
 */

/**
 * **境界**：由内功 / 轻功 / 招架**三槽等级的最小值**落在第几档决定（0–6）。
 *
 * ★★ wushen 的 `level` 是**存下来的一个数**（`user.js` 里有赋值路径，靠任务/门派推），
 *   本项目改成**派生**：三样基本功练到哪，境界就是哪。理由有两条：
 *   ① 少一个可写字段 = 少一处"存档里的境界与技能对不上"的可能（33 册红牌：同一概念单源）；
 *   ② 玩家能**自己看见怎么涨**——"把内功/轻功/招架练上去"是一句可执行的话，
 *      而"等级到了就涨"在内容层没有对应动作。
 *
 * ★ 为什么取 `min` 不取 `max` 或平均：见 `SKILL_FORMULA.realmThresholds` 的注释
 *   （取 max ⇒ 只练剑不练内功的人会变成"高境界、纸糊血条"）。
 *
 * ★ 没练过（0）/ 传了脏值 ⇒ 境界 0。**不抛**：这是显示与上限因子都要读的量，
 *   抛错会把"面板打不开"变成"进不了游戏"。
 */
export function realmOf(forceLevel: number, dodgeLevel: number, parryLevel: number): number {
  const lowest = Math.min(forceLevel, dodgeLevel, parryLevel);
  if (!Number.isFinite(lowest) || lowest <= 0) return 0;
  let realm = 0;
  for (const threshold of SKILL_FORMULA.realmThresholds) {
    if (lowest < threshold) break;
    realm += 1;
  }
  return realm;
}

export function levelLimit(exp: number, realm: number): number {
  if (exp < SKILL_FORMULA.limitExpMin) return SKILL_FORMULA.limitExpMinLevel;
  const factor = SKILL_FORMULA.limitRealmFactor[realm] ?? SKILL_FORMULA.limitExpMinLevel;
  const byExp = Math.round(Math.pow(exp * factor, 1 / 3));
  return Math.min(byExp, SKILL_FORMULA.limitMaxLevel);
}

/** 进阶后的新等级（wushen `grade_up`） */
export function gradeUpLevel(pot: number, targetGrade: number): number {
  const lv = (pot * SKILL_FORMULA.gradeUpPotNum) / SKILL_FORMULA.gradeUpPotDen / (targetGrade + 1);
  return Math.trunc(Math.sqrt(Math.max(0, lv)));
}

/**
 * 从 `(fromLevel, poolExp)` 练到 `targetLevel` 还**缺多少**技能经验。
 *
 * ★ **已有的经验先抵扣**（`poolExp`）：玩家可能已经攒了一截（`addExp` 到上限时
 *   不再清零，见那里的说明），那部分不该再收一次钱。
 * ★ 纯函数：`practice` 靠它把"要花多少潜能"算准，避免到顶时把多出来的潜能白扔掉。
 */
export function expToReach(
  grade: number,
  fromLevel: number,
  poolExp: number,
  targetLevel: number,
): number {
  if (targetLevel <= fromLevel) return 0;
  let pool = Math.max(0, poolExp);
  let cost = 0;
  for (let lv = fromLevel; lv < targetLevel; lv += 1) {
    const need = levelExp(lv, grade);
    if (pool >= need) {
      pool -= need;
    } else {
      cost += need - pool;
      pool = 0;
    }
  }
  return cost;
}

/** 便于查看当前技能数值参数（启动日志 / tuning 汇总用） */
export function skillFormulaSummary(): string {
  return Object.entries(SKILL_FORMULA)
    .map(([k, v]) => `${k}=${Array.isArray(v) ? v.join('/') : String(v)}`)
    .join(' ');
}

// ---------------------------------------------------------------------------
// 绝招（PERFORM）
// ---------------------------------------------------------------------------

function paramOf(v: number | ((lv: number) => number) | undefined, lv: number, dflt: number): number {
  if (v === undefined) return dflt;
  const n = typeof v === 'function' ? v(lv) : v;
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) {
    throw new SkillError(`绝招数值必须是有限非负数，收到 ${String(n)}`);
  }
  return n;
}

/**
 * 绝招模板。取代 wushen 的 `PERFORM`（`skill.js:615`）——
 * wushen 靠 `pfm.__proto__ = PERFORM.prototype` 把普通对象"变成" PERFORM；
 * 这里是显式构造，不做原型魔改。
 *
 * ★ 本批**只做数据面 + 冷却 + 准入**（docs/27 D3）：`use()`（战斗执行体）不在此声明，
 *   等战斗批次接入时再加 —— 避免留下没人调用的空接口。
 */
export class Perform {
  public readonly skillId: string;
  public readonly pid: string;
  public readonly name: string;
  /** 要求的装配槽；null = 不限 */
  public readonly enable: EnableSlot | null;
  public readonly allowBusy: boolean;
  public readonly desc: string | undefined;
  readonly #def: PerformDef;

  public constructor(skillId: string, pid: string, def: PerformDef) {
    if (def.enable !== undefined && !isEnableSlot(def.enable)) {
      throw new SkillError(`绝招 ${skillId}/${pid} 的 enable 不是合法装配槽：${String(def.enable)}`);
    }
    this.skillId = skillId;
    this.pid = pid;
    this.name = def.name;
    this.enable = def.enable ?? null;
    this.allowBusy = def.allowBusy ?? false;
    this.desc = def.desc;
    this.#def = def;
  }

  /** 全局唯一 id（`<skillId>/<pid>`，与 wushen `pfm.id` 同形） */
  public get id(): string {
    return `${this.skillId}/${this.pid}`;
  }

  public mp(lv: number): number {
    return paramOf(this.#def.mp, lv, 0);
  }

  public releaseMs(lv: number): number {
    return paramOf(this.#def.releaseMs, lv, 0);
  }

  public cdMs(lv: number): number {
    return paramOf(this.#def.cdMs, lv, 0);
  }

  /** 自定义准入（等级 / 内力 / 冷却之外的）。缺省恒真 */
  public check(me: SkillActor, lv: number): boolean {
    return this.#def.check === undefined ? true : this.#def.check(me, lv) === true;
  }
}

// ---------------------------------------------------------------------------
// 技能模板（不可变；包装 SkillDef）
// ---------------------------------------------------------------------------

export class SkillTemplate {
  public readonly id: string;
  public readonly name: string;
  public readonly type: SkillType;
  public readonly grade: number;
  public readonly maxLevel: number;
  /** 仅基本技能：占据的装配槽 */
  public readonly slot: EnableSlot | null;
  public readonly canEnables: readonly EnableSlot[];
  /** 内功系数（仅"占据 force 槽"的技能有意义）；null = 未声明 */
  public readonly forceRad: number | null;
  public readonly learnCondition: SkillLearnCondition | null;
  public readonly pfm: ReadonlyMap<string, Perform>;
  readonly #def: SkillDef;

  public constructor(id: string, def: SkillDef) {
    const type = def.type ?? SKILL_TYPES.SKILL;
    if (type === SKILL_TYPES.BASE) {
      if (def.slot === undefined) {
        throw new SkillError(`基本技能 ${id} 必须声明 slot（占据哪个装配槽）`);
      }
    } else if (def.slot !== undefined) {
      throw new SkillError(`非基本技能 ${id}（type=${type}）不应声明 slot`);
    }
    if (def.slot !== undefined && !isEnableSlot(def.slot)) {
      throw new SkillError(`技能 ${id} 的 slot 不是合法装配槽：${String(def.slot)}`);
    }
    for (const s of def.can_enables ?? []) {
      if (!isEnableSlot(s)) {
        throw new SkillError(`技能 ${id} 的 can_enables 含非法槽名：${String(s)}`);
      }
    }
    if (def.force_rad !== undefined && (!Number.isFinite(def.force_rad) || def.force_rad < 0)) {
      throw new SkillError(`技能 ${id} 的 force_rad 必须是有限非负数`);
    }

    this.id = id;
    this.name = def.name;
    this.type = type;
    this.grade = def.grade ?? 1;
    this.maxLevel = def.max_level ?? SKILL_FORMULA.defaultMaxLevel;
    this.slot = def.slot ?? null;
    this.canEnables = def.can_enables ?? [];
    this.forceRad = def.force_rad ?? null;
    this.learnCondition = def.learnCondition ?? null;

    const pfm = new Map<string, Perform>();
    for (const [pid, pd] of Object.entries(def.pfm ?? {})) {
      pfm.set(pid, new Perform(id, pid, pd));
    }
    this.pfm = pfm;
    this.#def = def;
  }

  /** 是否是"可装配的武功"（基本技能与知识类都不能被装配） */
  public get isEnablable(): boolean {
    return this.type === SKILL_TYPES.SKILL;
  }

  /** ① 学会即生效的属性 */
  public queryProp(lv: number): PropMap | undefined {
    return this.#def.passiveProp?.(lv);
  }

  /** ② 启用后生效的属性（按槽） */
  public queryEnableProp(lv: number): Readonly<Partial<Record<EnableSlot, PropMap>>> | undefined {
    return this.#def.enableProp?.(lv);
  }

  public onLearn(me: SkillActor): boolean {
    return this.#def.on_learn === undefined || this.#def.on_learn(me) !== false;
  }

  public onRemove(me: SkillActor): void {
    this.#def.on_remove?.(me);
  }

  public onEnable(me: SkillActor, slot: EnableSlot): boolean {
    return this.#def.on_enable === undefined || this.#def.on_enable(me, slot) !== false;
  }

  public onDisable(me: SkillActor, slot: EnableSlot): void {
    this.#def.on_disable?.(me, slot);
  }
}

// ---------------------------------------------------------------------------
// 技能注册表（取代 `SKILL[slot][grade]` 往类上挂索引）
// ---------------------------------------------------------------------------

export interface SkillEntryLike {
  readonly id: string;
  readonly def: SkillDef;
}

export class SkillRegistry {
  readonly #byId = new Map<string, SkillTemplate>();

  public constructor(entries: readonly SkillEntryLike[]) {
    for (const e of entries) {
      if (this.#byId.has(e.id)) {
        throw new SkillError(`技能 id 重复：${e.id}（register 层面已挡，这里是第二道）`);
      }
      this.#byId.set(e.id, new SkillTemplate(e.id, e.def));
    }
  }

  public get size(): number {
    return this.#byId.size;
  }

  public get(id: string): SkillTemplate | undefined {
    return this.#byId.get(id);
  }

  public getOrThrow(id: string): SkillTemplate {
    const t = this.#byId.get(id);
    if (t === undefined) throw new SkillError(`技能不存在：${id}`);
    return t;
  }

  /**
   * 按**中文名**找技能（`practice 太极剑法` 这类玩家输入）。
   *
   * ★ 重名**抛错**而不是取第一个：技能的显示名是内容层写的，两套武功同名是内容配置
   *   错误，静默取一个会让"练了半天不是那个技能"。wushen 用 id 当键，没有这个问题，
   *   但也因此玩家必须敲英文 id。
   */
  public byName(name: string): SkillTemplate | undefined {
    const hits = this.all().filter((t) => t.name === name);
    if (hits.length > 1) {
      throw new SkillError(`技能名 "${name}" 不唯一：${hits.map((h) => h.id).join(', ')}`);
    }
    return hits[0];
  }

  public all(): readonly SkillTemplate[] {
    return [...this.#byId.values()];
  }

  /** 占该槽的**基本技能**模板们（wushen 没有这张索引，靠 id 约定） */
  public bySlot(slot: EnableSlot): readonly SkillTemplate[] {
    return this.all().filter((t) => t.slot === slot);
  }

  /** 可启用到此槽的武功 */
  public byCanEnable(slot: EnableSlot): readonly SkillTemplate[] {
    return this.all().filter((t) => t.canEnables.includes(slot));
  }

  /** ★ 取代 wushen `SKILL[slot][grade]`（"某槽某阶的全部武功"） */
  public byCanEnableGrade(slot: EnableSlot, grade: number): readonly SkillTemplate[] {
    return this.byCanEnable(slot).filter((t) => t.grade === grade);
  }
}

// ---------------------------------------------------------------------------
// 角色侧：技能记录 + 技能簿
// ---------------------------------------------------------------------------

/** 角色持有的一条技能记录（**纯数据**，可序列化） */
export interface SkillState {
  readonly id: string;
  level: number;
  exp: number;
  /** 被启用到的装配槽；null = 只学会、未装配 */
  enabled: EnableSlot | null;
}

/**
 * 技能簿的"宿主"最小契约。
 *
 * ★ 用**结构类型**而非 `import { Character }`：`character.ts` 会 import 本文件，
 *   反向 import 会成环。这里只声明"技能簿要用的几个能力"（与 `props.ts` 同一取向）。
 */
export interface SkillBookOwner extends SkillActor, PropHolder {
  readonly temp: TempStore;
  /** 潜能（练习技能的燃料）。与 `CommandActor.pot` 是同一个数（`Character.pot`） */
  readonly pot: number;
  /** 花掉潜能；返回 `false` = 不够。与 `Character.spendPot` 同一实现 */
  spendPot(amount: number): boolean;
  /** 重算派生属性（技能改完属性后必须调，等价 wushen 每次改技能尾部的 `me.recount()`） */
  recount(): void;
}

/** 无技能的世界（测试 / 玩家未加载）用的空注册表 */
const EMPTY_REGISTRY = new SkillRegistry([]);

export function emptySkillRegistry(): SkillRegistry {
  return EMPTY_REGISTRY;
}

/** 冷却键（`pfm/<skillId>/<pid>`，与 wushen `temp["pfm/"+id]` 同形） */
function pfmTempKey(skillId: string, pid: string): string {
  return `pfm/${skillId}/${pid}`;
}

/**
 * 技能簿：一个角色持有的全部技能状态 + 装配关系 + 贡献的属性。
 *
 * **唯一变更入口**：`learn/forget/setLevel/addExp/enable/disable/gradeUp`。
 * 它们都在末尾调 `recompute()`，于是"改了技能却忘了重算"在结构上无法发生
 * （对应 `Character.setInnate` 自动 `recount()` 的同一条纪律）。
 */
export class SkillBook {
  readonly #registry: SkillRegistry;
  readonly #owner: SkillBookOwner;
  readonly #states = new Map<string, SkillState>();
  /** 装配槽 → 挂在该槽的**武功** id（基本技能"占槽"由 `activeTemplate` 另行解析） */
  readonly #enabledBySlot = new Map<EnableSlot, string>();
  /** 记账：本簿**已计入** `props` 的核心属性键 → 值（重算时先按它减掉） */
  #coreLedger = new Map<PropKey, number>();
  #extLedger = new Map<ExtProp, number>();

  public constructor(registry: SkillRegistry, owner: SkillBookOwner) {
    this.#registry = registry;
    this.#owner = owner;
  }

  // ── 查询 ──────────────────────────────────────────────────────────────────

  public get size(): number {
    return this.#states.size;
  }

  public has(id: string): boolean {
    return this.#states.has(id);
  }

  public entryOf(id: string): SkillState | undefined {
    return this.#states.get(id);
  }

  public entries(): readonly SkillState[] {
    return [...this.#states.values()];
  }

  /** 某技能的等级（0 = 不会） */
  public levelOf(id: string): number {
    return this.#states.get(id)?.level ?? 0;
  }

  /**
   * 按**中文名**取等级（0 = 不会或没这个技能）。
   *
   * ★ 给 `learn <中文名> from <老师>` 用：指令层只拿到玩家敲的那串字，
   *   要问"老师这门练到几级"就必须先按名解析一次。
   * ★ 重名照 `byName` 的规矩**抛错**（内容配置错误，不能静默取一个）；
   *   未知名字返回 0 —— "老师不会"是一条正常路径，不是错误。
   */
  public levelOfName(name: string): number {
    const tpl = this.#registry.byName(name);
    return tpl === undefined ? 0 : this.levelOf(tpl.id);
  }

  /** 占该槽的**基本技能**的等级（对应 wushen `query_skill('force')`） */
  public levelOfSlot(slot: EnableSlot): number {
    for (const st of this.#states.values()) {
      if (this.#registry.get(st.id)?.slot === slot) return st.level;
    }
    return 0;
  }

  /**
   * 该槽**当前生效**的技能模板：被装配的武功 > 占槽的基本技能 > 无。
   * 对应 wushen `query_used_skill(skname)`。
   */
  public activeTemplate(slot: EnableSlot): SkillTemplate | undefined {
    const enabledId = this.#enabledBySlot.get(slot);
    if (enabledId !== undefined) {
      const t = this.#registry.get(enabledId);
      if (t !== undefined) return t;
    }
    for (const st of this.#states.values()) {
      const t = this.#registry.get(st.id);
      if (t?.slot === slot) return t;
    }
    return undefined;
  }

  /** 内功系数（wushen `query_force_rad`） */
  public activeForceRad(): number {
    const t = this.activeTemplate(BASE_SKILLS.FORCE);
    return t?.forceRad ?? COMBAT_FORMULA.forceRadDefault;
  }

  /** 当前装配情况（槽 → 技能 id） */
  public enabledOf(slot: EnableSlot): string | undefined {
    return this.#enabledBySlot.get(slot);
  }

  /**
   * 按 id **或中文名**查模板（玩家输入走这一条）。
   *
   * ★ 与 `practice()` / `learn()` 用同一个解析顺序（id 优先、再按名），
   *   于是"面板里点的是它、指令里练的也是它"不会出现两个解析路径。
   *   未知返回 `undefined`（不抛）—— 调用方要把它变成一句"没有这个技能"。
   */
  public templateOf(idOrName: string): SkillTemplate | undefined {
    return this.#registry.get(idOrName) ?? this.#registry.byName(idOrName);
  }

  /**
   * 本簿对某技能的等级上限：`min(模板 max_level, 角色 skillLimit())`。
   *
   * ★ 是 `#capOf` 的**只读**转发。为什么需要它：`practice`/`addExp` 用它封顶，
   *   指令层要提前说"你到 22 级上限了"，面板要显示上限 —— 三条路读同一个数。
   *   未知技能返回 0（调用方先把 `unknown` 判掉）。
   */
  public capOf(idOrName: string): number {
    const tpl = this.templateOf(idOrName);
    return tpl === undefined ? 0 : this.#capOf(tpl);
  }

  /**
   * 到**下一级**的进度百分比（0–100，已截断）。
   *
   * ★ 服务端算，前端不碰 `levelExp`：经验公式只有 `skill.ts` 一份（27 册 §14.5.2）。
   * ★ 满级（`level >= maxLevel`）时 `progress` 报 **100**：此时"下一级"不存在，
   *   报 0 会让面板显示"刚起步"，与"已经练满"完全相反。
   */
  public progressOf(tpl: SkillTemplate, st: SkillState): number {
    if (st.level >= tpl.maxLevel) return 100;
    const need = levelExp(st.level, tpl.grade);
    if (!(need > 0)) return 0;
    return Math.max(0, Math.min(100, Math.trunc((st.exp * 100) / need)));
  }

  // ── 变更（唯一入口；末尾一律 recompute）───────────────────────────────────

  /**
   * 学会一个技能（**建档**，不结算经验 —— 结算在 `CommandActor.learnSkill`）。
   *
   * ★★ 返回判别联合而不 `notify`（26 册 §64）：原实现把六句拒绝文案写在这里，
   *   于是"同样的拒绝"在指令层无法复用、也没法被 `switch` 穷举。
   *   现在结构在这里、文案在指令层（与 `practice` 同构）。
   *
   * @param level 建档时的等级；缺省 1（`setLevel`/NPC 用别的值）
   */
  public learn(idOrName: string, level = 1): LearnResult {
    const tpl = this.templateOf(idOrName);
    if (tpl === undefined) return { kind: 'refused', reason: 'unknown' };
    if (this.#states.has(tpl.id)) {
      return { kind: 'refused', reason: 'already', name: tpl.name };
    }
    const refusal = this.#conditionRefusal(tpl);
    if (refusal !== null) return refusal;
    if (!tpl.onLearn(this.#owner)) return { kind: 'refused', reason: 'hook', name: tpl.name };
    const lv = clampLevel(level, tpl);
    this.#states.set(tpl.id, { id: tpl.id, level: lv, exp: 0, enabled: null });
    this.recompute();
    // ★ `spent` / `gained` 在这里**真的是 0**：建档不花潜能、不涨级。
    //   真正的"学一次"结算在 `CommandActor.learnSkill`，它会在本方法之后再算一遍。
    return { kind: 'learned', id: tpl.id, name: tpl.name, level: lv, spent: 0, gained: 0 };
  }

  /**
   * 学习准入的**只读**检查（不建档、不跑 `onLearn` 钩子）；`null` = 通过。
   *
   * ★★ 为什么需要它（26 册 §64.11，真机抓到的泄漏）：`CommandActor.learnSkill`
   *   除了准入门槛，还要判"老师会不会 / 到头了没 / 潜能够不够"，而那三条都在
   *   建档**之后**才算得出来。原实现直接先 `learn()` 建档 ⇒ 被拒之后技能簿里
   *   多了一门 1 级的技能，玩家看到"面板说我学会了、可我潜能是 0"。
   *   有了这个只读口，`learnSkill` 就能**先把所有拒绝判完**，最后一步才动状态。
   *
   * ★ 与 `learn()` 里那次检查是**同一个函数**（`#conditionRefusal`）——
   *   不是第二套判据，所以不会漂移。
   */
  public conditionOf(idOrName: string): LearnRefused | null {
    const tpl = this.templateOf(idOrName);
    if (tpl === undefined) return { kind: 'refused', reason: 'unknown' };
    return this.#conditionRefusal(tpl);
  }

  /** 遗忘一个技能（若已装配则一并卸下） */
  public forget(id: string): boolean {    const st = this.#states.get(id);
    if (st === undefined) return false;
    const tpl = this.#registry.get(id);
    if (st.enabled !== null) this.#detachSlot(st.enabled);
    this.#states.delete(id);
    if (tpl !== undefined) tpl.onRemove(this.#owner);
    this.recompute();
    return true;
  }

  /** 直接设等级（NPC 初始化 / GM / 秘籍）。0 级 = 只是记录存在 */
  public setLevel(id: string, level: number): void {
    const tpl = this.#registry.getOrThrow(id);
    const st = this.#ensureState(id);
    st.level = clampLevel(level, tpl);
    if (st.level >= tpl.maxLevel) st.exp = 0;
    this.recompute();
  }

  /**
   * 本簿的**等级上限**：模板上限与**角色经验上限**取小（wushen `skill_limit`）。
   *
   * ★★ 这是"经验决定技能等级上限"的**唯一落点**：所有加经验的路径
   *   （`practice` / 未来的打怪涨技能 / 秘籍）都经过 `addExp`，于是没有哪条路能绕过它。
   * ★ NPC 的 `skillLimit()` 是 `Infinity`（见 `npc.ts`），于是它们的上限就是模板 `max_level`
   *   —— 与 wushen 一致（NPC 不走 `skill_limit` 那条曲线）。
   */
  #capOf(tpl: SkillTemplate): number {
    return Math.min(tpl.maxLevel, this.#owner.skillLimit());
  }

  /**
   * 加经验，返回**升了几级**（wushen `add_exp` 的 while 循环）。
   *
   * @param untilLevel **本次最多升到这一级**（缺省 = 不额外限制）。
   *   ★ 只给 `practice` 用：玩家说"练到 20 级"时，手上那笔余额也许够冲到 100 ——
   *   不钉住就会"我让它练到 20，它自己跳到 100"。普通加经验不要传它。
   */
  public addExp(id: string, exp: number, untilLevel?: number): number {
    if (!Number.isFinite(exp)) throw new SkillError(`addExp 需要有限数值，收到 ${String(exp)}`);
    if (untilLevel !== undefined && (!Number.isFinite(untilLevel) || untilLevel < 0)) {
      throw new SkillError(`addExp 的 untilLevel 必须是 ≥0 的有限数值，收到 ${String(untilLevel)}`);
    }
    const tpl = this.#registry.getOrThrow(id);
    const st = this.#ensureState(id);
    const cap = Math.min(this.#capOf(tpl), untilLevel ?? Number.POSITIVE_INFINITY);
    if (st.level >= cap) return 0;

    // ★ 26 册 §11.2 R6：`st.exp += exp` 允许负增量把 exp 打成**负数** ——
    //   于是角色背上"经验债"：先扣经验、再打怪时得先还清才升得了级，
    //   而这个负数是任何查询都看不出来的（面板上只会显示"还差 N 点"）。
    //   扣经验本身是合理的（掉级惩罚 / GM 调整），所以**不抛错**，钳到 0 即可。
    st.exp = Math.max(0, st.exp + exp);
    let gained = 0;
    let need = levelExp(st.level, tpl.grade);
    // ★ 与 wushen 的差异（docs/27 §4 决策 D4 注）：wushen 的循环在 `level++` **之前**
    //   重算 need，于是"升到 L+1 的代价"实际按 L-1 算，序列是 5,5,10,15…
    //   这里按自然语义修正：升到 L+1 的代价 = levelExp(L)。
    while (st.level < cap && st.exp >= need) {
      st.exp -= need;
      st.level += 1;
      gained += 1;
      need = levelExp(st.level, tpl.grade);
    }
    // ★★ 到上限**不再清零剩余经验**（旧实现有 `if (level>=maxLevel) exp=0`）：
    //   `cap` 现在是**动态**的（角色经验涨了上限就抬高），今天到顶不代表明天也到顶。
    //   清零会把已经付过代价的进度吞掉 —— 玩家只看到"练到 10 级，再打几只怪，
    //   技能经验却是 0"。`setLevel`（GM 直接设等级）仍然清零，那是另一回事。
    if (gained > 0) this.recompute();
    return gained;
  }

  /**
   * **练技能**：把潜能 1:1 换成技能经验（wushen `lianxi.js:169-176`
   * 的 `me.pot -= exp; this.skill_base.add_exp(me, exp)`）。
   *
   * ★ 与 wushen 的差异（形态，非数值）：wushen 是**持续状态** —— `set_state({on_check,
   *   on_stop})` 之后由心跳每 5 秒调一次 `do_learn`，可排队、可中断。本项目本批做
   *   **一次结算**：`state` 状态机尚未落地（`Actor.state` 目前是只读的诊断字段），
   *   而"扣潜能 → 涨等级"这条账与形态无关，先把它做成一个可验证的原子操作。
   *   状态机落地后，`do_learn` 只需要每拍调用本方法一次。
   *
   * ★ 兑换率 1:1 照抄 wushen。智力只影响 wushen 的**每拍量**（`count_speed`，见
   *   `lianxi.js:178`），不影响兑换率；本批没有"拍"，故智力不参与。
   *
   * @param idOrName    技能 id 或中文名
   * @param targetLevel 练到多少级；缺省 = 当前上限（超过按上限截断）
   */
  public practice(idOrName: string, targetLevel?: number): PracticeResult {
    const tpl = this.#registry.get(idOrName) ?? this.#registry.byName(idOrName);
    if (tpl === undefined) {
      // ★ 旧形状要求每个分支都填 `name` / `level` / `limit`，技能不存在时只能编造
      //   `''` 和 `0` —— 于是"0 级"作为**假数据**被传出去。判别联合里这一支不带字段，
      //   假数据无处可写。
      return { kind: 'refused', reason: 'unknown' };
    }
    const name = tpl.name;
    const limit = this.#capOf(tpl);
    const st = this.#states.get(tpl.id);
    if (st === undefined) {
      return { kind: 'refused', reason: 'not-learned', name };
    }
    if (tpl.type === SKILL_TYPES.KNOWLEDGE) {
      // wushen `lianxi.js:20-22`：知识类只能靠读书（`study`），不能"练"。
      return { kind: 'refused', reason: 'knowledge', name };
    }
    if (st.level >= limit) {
      return { kind: 'refused', reason: 'capped', name, level: st.level, limit };
    }
    if (!this.#basisReady(tpl, st.level)) {
      return { kind: 'refused', reason: 'basis', name };
    }

    let target = limit;
    if (targetLevel !== undefined) {
      if (!Number.isFinite(targetLevel)) {
        throw new SkillError(`practice 的目标等级必须是有限数值，收到 ${String(targetLevel)}`);
      }
      target = Math.min(Math.trunc(targetLevel), limit);
    }
    if (target <= st.level) {
      // ★ 与 capped 分开：这里还没到上限，只是**已经达到你给的 target**。
      //   合成一个 reason 会让文案说成"你到了瓶颈（上限 350 级）"—— 玩家明明才 5 级。
      return { kind: 'refused', reason: 'reached', name, level: st.level };
    }

    // ★ 只花"练到目标等级"所需的量：wushen 是每拍花一点、到 `max_level` 就停，
    //   一次结算必须**精确**算出这笔账，否则会把潜能花超（多出来的部分因为到顶而白扔）。
    const cost = expToReach(tpl.grade, st.level, st.exp, target);

    // ★★ 余额已经够到 target ⇒ **不花钱，直接把余额转成等级**。
    //   这不是理论情况：技能到上限时 `addExp` 会把剩余经验**留着**（见那里的说明），
    //   等角色经验把上限抬高，那笔余额就正好覆盖若干级。若这里按"要花 0 点潜能"判成
    //   `no-pot`，玩家会遇到"明明攒够了却练不动"的死局 —— 而且查不出来（余额不显示）。
    if (cost === 0) {
      const gained = this.addExp(tpl.id, 0, target);
      return { kind: 'done', name, spent: 0, gained, level: st.level, limit };
    }

    if (this.#owner.pot <= 0) {
      return { kind: 'refused', reason: 'no-pot', name, limit };
    }
    const spent = Math.min(cost, this.#owner.pot);
    if (spent <= 0) {
      return { kind: 'refused', reason: 'no-pot', name, limit };
    }
    if (!this.#owner.spendPot(spent)) {
      // 上面刚比过 `pot`，走到这里说明 `pot` 与 `spendPot` 不是同一份账 —— 大声报出来，
      // 不要静默把等级加上去（"不花钱也能练"是最难发现的那类漏洞）。
      throw new SkillError('practice 结账失败：pot 与 spendPot 读数不一致');
    }
    const gained = this.addExp(tpl.id, spent);
    return { kind: 'done', name, spent, gained, level: st.level, limit };
  }

  /**
   * 基本功火候（wushen `lianxi.js:146-156` 的 `check_skill`）：
   * 一套武功要装到某个槽，它的等级就必须**严格低于**该槽当前的基本技能等级。
   *
   * ★ 「当前」= `levelOfSlot()`（占该槽的**基本技能**），不是 `activeTemplate()`
   *   —— 后者会把"被装配的武功"算进去，于是武功跟自己比，永远不达标。
   */
  #basisReady(tpl: SkillTemplate, level: number): boolean {
    for (const slot of tpl.canEnables) {
      if (level >= this.levelOfSlot(slot)) return false;
    }
    return true;
  }

  /**
   * **读书**：给一门技能加 `exp` 点经验（wushen `study.js` 的 `do_learn` 主体）。
   *
   * 顺序（不能换，每一道决定下一句该说什么）：
   *   ① 技能存在 → `unknown`
   *   ② 已到「书能教的上限」与「角色能到的上限」两者的小值 → `too-shallow`
   *      （wushen `study.js:96`「这本书上的内容对你来说太浅了」）
   *   ③ 准入（`learnCondition`：基本功 / 属性 / 内力 / 性别）→ `blocked`
   *      ★★ 这一道**必须**在，否则一本书就能绕过"基本功 30 级才能学太极剑法"——
   *      wushen `study.js:105-113` 的 `check_skill` 判的正是同一件事。
   *   ④ 加经验（落到 `addExp`，上限钳制只在那一个地方）
   *
   * ★ 为什么"从零学会"也走这里：`addExp` 的 `#ensureState` 会建档 ——
   *   wushen 的书本来就能让人**第一次**学会一门武功（`me.query_skill(id)===0` 时
   *   先跑 `do_learn` 做准入）。这里语义相同，只是准入挪到了 ③。
   */
  public study(idOrName: string, exp: number, bookMax: number): StudyResult {
    if (!Number.isFinite(exp) || exp < 0) {
      throw new SkillError(`study 的经验必须是 ≥0 的有限数值，收到 ${String(exp)}`);
    }
    if (!Number.isFinite(bookMax) || bookMax < 0) {
      throw new SkillError(`study 的书本上限必须是 ≥0 的有限数值，收到 ${String(bookMax)}`);
    }
    const tpl = this.#registry.get(idOrName) ?? this.#registry.byName(idOrName);
    if (tpl === undefined) return { kind: 'refused', reason: 'unknown' };

    const level = this.#states.get(tpl.id)?.level ?? 0;
    const cap = Math.min(this.#capOf(tpl), Math.trunc(bookMax));
    if (level >= cap) {
      return { kind: 'refused', reason: 'too-shallow', name: tpl.name, level, bookMax: cap };
    }

    const refusal = this.#conditionRefusal(tpl);
    if (refusal !== null) return { kind: 'blocked', refusal };

    // ★★ `exp === 0` = **准入预检**（`train/study` 起状态前先问一句"这书我读得了吗"）。
    //   必须在 `addExp` **之前**返回：`addExp` 的 `#ensureState` 会给他**建档**，
    //   于是"读了一本没资格的书"会静默在技能表里留下一条 0 级记录。
    if (exp === 0) {
      return { kind: 'ok', name: tpl.name, gained: 0, level, limit: this.#capOf(tpl) };
    }

    // ★ `untilLevel: cap` —— 书的等级上限**也是**一次的硬顶，否则"读一次跳 40 级"
    const gained = this.addExp(tpl.id, exp, cap);
    return {
      kind: 'ok',
      name: tpl.name,
      gained,
      level: this.#states.get(tpl.id)?.level ?? 0,
      limit: this.#capOf(tpl),
    };
  }

  /**
   * 把武功装配到某个槽。
   *
   * ★ 与 wushen 的差异（**改进**）：wushen 先卸旧、再问新技能 `enable()`，
   *   新的若被拒则槽**空着**（旧技能已经没了）。这里把全部否决点（类型 / `can_enables` /
   *   是否学会 / `on_enable`）**放在卸旧之前**，于是"被拒"不会损害既有装配。
   */
  public enable(slot: EnableSlot, id: string): boolean {
    if (!isEnableSlot(slot)) throw new SkillError(`非法装配槽：${String(slot)}`);
    const tpl = this.#registry.getOrThrow(id);
    if (!tpl.isEnablable) {
      throw new SkillError(`${tpl.name}（type=${tpl.type}）不可装配（只有武功可以）`);
    }
    if (!tpl.canEnables.includes(slot)) {
      throw new SkillError(
        `${tpl.name} 不能启用为 ${slot}（can_enables = [${tpl.canEnables.join(', ')}]）`,
      );
    }
    const st = this.#states.get(id);
    if (st === undefined) throw new SkillError(`还没学会${tpl.name}，无法装配`);
    if (this.#enabledBySlot.get(slot) === id) return true;
    if (!tpl.onEnable(this.#owner, slot)) return false;

    // ★ 换槽 / 挤下占用者由 `#attachSlot()` 单点处理（2026-10-13 体检 E2）。
    //   它返回"本次被顶掉的 (技能, 槽)"，这里负责配对 `onDisable`
    //   —— `enable()` 是**用户动作**，先调过 `onEnable`，所以必须成对通知。
    for (const [victimId, victimSlot] of this.#attachSlot(slot, id)) {
      this.#registry.get(victimId)?.onDisable(this.#owner, victimSlot);
    }
    this.recompute();
    return true;
  }

  /** 卸下某槽的武功 */
  public disable(slot: EnableSlot): boolean {
    if (this.#detachSlot(slot) === undefined) return false;
    this.recompute();
    return true;
  }

  /** 进阶：把满级技能"转化"为目标技能（wushen `grade_up`） */
  public gradeUp(id: string, targetId: string): boolean {
    const st = this.#states.get(id);
    const src = this.#registry.get(id);
    const dst = this.#registry.get(targetId);
    if (st === undefined || src === undefined || dst === undefined) return false;
    if (st.level < SKILL_FORMULA.gradeUpMinLevel) return false;
    const pot = totalNeedExp(st.level, src.grade);
    const newLevel = gradeUpLevel(pot, dst.grade);
    this.forget(id);
    this.setLevel(targetId, Math.min(newLevel, dst.maxLevel));
    return true;
  }

  // ── 绝招冷却 / 准入（本批不接战斗）────────────────────────────────────────

  public pfmCooldownMs(skillId: string, pid: string, nowMs: number = Date.now()): number {
    const left = this.#owner.temp.ttlRemainingMs(pfmTempKey(skillId, pid), nowMs);
    return Number.isFinite(left) ? left : 0;
  }

  public setPfmCooldown(
    skillId: string,
    pid: string,
    ms: number,
    nowMs: number = Date.now(),
  ): void {
    if (!Number.isFinite(ms) || ms <= 0) {
      throw new SkillError(`绝招冷却需要正的毫秒数，收到 ${String(ms)}`);
    }
    this.#owner.temp.setTemp(pfmTempKey(skillId, pid), true, ms, nowMs);
  }

  public clearPfmCooldown(skillId: string, pid: string): void {
    this.#owner.temp.removeTemp(pfmTempKey(skillId, pid));
  }

  /**
   * 「现在能不能放这个绝招」：学会 + **该技能此刻确实在这个槽生效** + 冷却 + 自定义准入。
   *
   * ★ 槽判定走 `activeTemplate(slot)?.id === skillId`，而不是 `st.enabled === slot`：
   *   基本技能（`type = BASE`）靠 `slot` 占槽、记录上的 `enabled` 恒为 null
   *   （wushen 的 `base/sword` 也挂了绝招，若按 `enabled` 判就永远放不出来）。
   *   用"当前生效模板"这一把尺子，武功与基本技能走的是同一条路径。
   */
  public canUsePfm(skillId: string, pid: string, nowMs: number = Date.now()): boolean {
    const tpl = this.#registry.get(skillId);
    const st = this.#states.get(skillId);
    if (tpl === undefined || st === undefined) return false;
    const pfm = tpl.pfm.get(pid);
    if (pfm === undefined) return false;
    if (pfm.enable !== null && this.activeTemplate(pfm.enable)?.id !== skillId) return false;
    if (this.pfmCooldownMs(skillId, pid, nowMs) > 0) return false;
    return pfm.check(this.#owner, st.level);
  }

  // ── 属性（三档 → 记账式重算）──────────────────────────────────────────────

  /** 全量算出"本簿的技能一共给了哪些属性"（① 全算；② 只算已装配的那个槽） */
  public contributedProps(): PropMap {
    const prop: Partial<Record<PropKey, number>> = {};
    const ext = new Map<ExtProp, number>();
    for (const st of this.#states.values()) {
      const tpl = this.#registry.get(st.id);
      if (tpl === undefined) continue;
      // ★ docs 26 册 §12 的 R7（wushen 对照）：等级为 **0** 的技能**完全不参与**属性计算。
      //   wushen `os/skill/skill.js:65/87` 的 `release_prop` / `attach_prop` 开头都是
      //   `if (!lv) return;` —— 只看等级，不看"属性值是不是 0"。
      //   两者不等价：技能完全可以把属性写成**与等级无关的常数**
      //   （`passiveProp: () => ({ prop: { attack: 5 } })`），此时"跳过 0 值"这条规则救不了场，
      //   一个被 `setLevel(id, 0)` 清零（或存档里就是 0 级）的技能会继续白给属性。
      //   `tests/engine-audit.test.ts` 的 A7 组把这两条都钉住（含"升回 1 级必须重新生效"）。
      if (st.level === 0) continue;
      mergeInto(prop, ext, tpl.queryProp(st.level));
      if (st.enabled !== null) {
        mergeInto(prop, ext, tpl.queryEnableProp(st.level)?.[st.enabled]);
      }
    }
    return { prop, extProp: [...ext.entries()].map(([k, v]) => [k, v] as const) };
  }

  /**
   * 记账式重算：**先算 → 再减旧账 → 再加新账**，然后 `recount()`。
   * **幂等** —— 连调 N 次，`props` 完全一致（`tests/engine-skill.test.ts` 钉住）。
   *
   * ★ **为什么"先算"不能省**（S8，2026-10-16 审查）：`contributedProps()` 会因
   *   非法属性键抛错（见 `mergeInto`）。若顺序是"先减旧账、再算新账"，异常会留下
   *   **旧账已减、新账未加**的半账态 —— 而 `recount()` 永远到不了，派生属性永久停在旧值，
   *   且每次变更都重复这一遍（不可自愈）。先把新账算出来 ⇒ 非法键在**旧账被碰之前**就抛。
   */
  public recompute(): void {
    const contributed = this.contributedProps();
    this.#releaseLedger();
    this.#absorb(contributed);
    this.#owner.recount();
  }

  // ── 存档边界 ──────────────────────────────────────────────────────────────

  public snapshot(): readonly SkillState[] {
    return this.entries().map((s) => ({ ...s }));
  }

  /**
   * 从存档恢复（**不可信数据**，存档 / 协议 / 热更）。**会先把当前账减掉**，
   * 因此即便在"已算过属性"的角色上调用也安全。
   *
   * ★ **分级**（E3 裁定，26 册 §40；契约见 `load-report.ts`）：
   *   ① 入参**不是数组** ⇒ 抛（形状不对，不是"某一条脏"）；
   *   ② 逐条校验，不合法的那条**丢弃 + 记账**，不让一条坏记录污染整本簿。
   *
   * ★★ **为什么这里必须有校验**（原先一道都**没有** —— 这就是 E3 的真漏洞）：
   *   `enable()` 有三道准入（槽名合法 / `type === SKILL` 才可装配 / 槽在 `can_enables`
   *   里），而 `load()` 此前只做 `isEnableSlot` 兜底、把不合法一律降级成 `null`，
   *   **`isEnablable` 与 `can_enables` 两道完全不查** ⇒ 一个手改的存档能把
   *   **基本技能**启用到武功槽，或把内功启用为剑法，绕过所有用户侧校验。
   *   ★ 关键认识：`load` **就是绕过 `learn()` / `enable()` 的那条路**，
   *     所以"校验写在 enable 里"并不覆盖它 —— 校验必须与数据入口同处。
   *
   * ★ 通过校验的条目与 `enable()` 走**同一个** `#attachSlot()`（单点记账），
   *   于是"两条不同技能抢同一槽"在读档路径上同样成立（见 `tests/engine-audit` A3）。
   */
  public load(raw: unknown): LoadReport {
    if (!Array.isArray(raw)) {
      throw new SkillError(`load 需要数组（SkillState[]），收到 ${describeValue(raw)}`);
    }
    this.#releaseLedger();
    this.#states.clear();
    this.#enabledBySlot.clear();

    const rejected: RejectedEntry[] = [];
    for (const [index, entry] of raw.entries()) {
      if (!isPlainRecord(entry)) {
        rejected.push({ key: `#${index}`, reason: `记录必须是对象，收到 ${describeValue(entry)}` });
        continue;
      }
      const rec = entry as Record<string, unknown>;
      const id = rec['id'];
      if (typeof id !== 'string' || id === '') {
        rejected.push({
          key: `#${index}.id`,
          reason: `技能 id 必须是非空字符串，收到 ${describeValue(id)}`,
        });
        continue;
      }

      const tpl = this.#registry.get(id);
      if (tpl === undefined) {
        rejected.push({ key: id, reason: '技能未登记' });
        continue;
      }

      // ★ 重复 id（S7，2026-10-16 审查）：丢**后一条** + 记账。
      //   若照单全收，两条都进 `#states`（后者覆盖），而 `#enabledBySlot` 只按
      //   先被处理的那条挂 —— 于是"装配表说有、属性账说没有"，两边都不报错。
      //   与"未知 id / 非法等级"同属**条目级坏**（分级契约②：丢该条 + 记账）。
      if (this.#states.has(id)) {
        rejected.push({ key: id, reason: '同一技能 id 在存档里出现多次，已忽略后一条' });
        continue;
      }

      const level = readLoadedLevel(id, tpl, rec['level'], rejected);
      const exp = readLoadedExp(id, rec['exp'], rejected);
      const enabled = readLoadedEnabled(id, tpl, rec['enabled'], rejected);

      // ★ 往 `#setSkillState()` 收口（2026-10-13 体检 E2 + 2026-10-16 审查 S7）：
      //   `load` / `loadFromDef` 的"槽占用变更"只有一个实现，不可能再分家。
      //   触发条件见 `tests/engine-audit.test.ts` 的 A3 与 `tests/engine-skill.test.ts`
      //   的「两条**不同**技能抢同一槽」。
      this.#setSkillState(id, level, exp, enabled);
    }
    this.recompute();
    return { loaded: this.#states.size, rejected };
  }

  // ── 内部 ──────────────────────────────────────────────────────────────────

  /**
   * 把 `id` 挂上 `slot` —— **两张表一起改**的唯一入口（`enable` / `load` / `loadFromDef` 共用）。
   *
   * 语义（三处必须完全一致，2026-10-13 体检 E2 就是因为 `loadFromDef` 少了一条而分家）：
   *   ① **本技能**原先挂在**别的**槽 ⇒ 那个槽腾空（否则 `activeTemplate(旧槽)` 会一直返回它）；
   *   ② 目标槽原先挂的**别人** ⇒ 被挤下（`enabled = null`）—— 一个槽同时只挂一个武功。
   *
   * ★ 为什么"被挤下者的 `enabled` 必须置 null"是**要害**：
   *   `contributedProps()` 是按 `st.enabled !== null` 记账的，而 `activeTemplate(slot)`
   *   只认 `#enabledBySlot`。两者一旦不同步，**属性账与装配表各说各话，且没有任何报错**。
   *
   * ★ 只做**记账**，不通知 `onDisable` —— 是否通知由调用方决定：
   *   `enable()` 是用户动作、先调过 `onEnable`，必须成对通知；
   *   `load` / `loadFromDef` 是"从数据构造"，没有配对的 `onEnable`，通知会失衡。
   *
   * @returns 本次被顶掉的 `(技能 id, 槽)` 清单，供调用方决定要不要通知 `onDisable`
   */
  #attachSlot(slot: EnableSlot, id: string): Array<readonly [string, EnableSlot]> {
    const displaced: Array<readonly [string, EnableSlot]> = [];
    const st = this.#states.get(id);
    if (st !== undefined && st.enabled !== null && st.enabled !== slot) {
      this.#enabledBySlot.delete(st.enabled);
      displaced.push([id, st.enabled]);
    }
    const prevId = this.#enabledBySlot.get(slot);
    if (prevId !== undefined && prevId !== id) {
      const prev = this.#states.get(prevId);
      if (prev !== undefined) prev.enabled = null;
      displaced.push([prevId, slot]);
    }
    this.#enabledBySlot.set(slot, id);
    if (st !== undefined) st.enabled = slot;
    return displaced;
  }

  /**
   * 写入/覆盖一条技能状态 —— **`load` / `loadFromDef` 共用的唯一写入口**（S7，2026-10-16 审查）。
   *
   * ★ 要害：`enabled === null` 时**也要腾空本技能原先占的槽**。
   *   原先两处都写成 `if (enabled !== null) #attachSlot(...)` —— 于是"同一 id 后一条
   *   不装配"会留下"`#enabledBySlot` 还指着它、而 `st.enabled` 已经是 null"的分家状态：
   *   `contributedProps()`（按 `st.enabled !== null` 记账）不算它，而 `activeTemplate(slot)`
   *   仍返回它 ⇒ 属性账与装配表各说各话，且没有任何报错。
   */
  #setSkillState(id: string, level: number, exp: number, enabled: EnableSlot | null): void {
    if (enabled === null) {
      const prev = this.#states.get(id);
      if (prev !== undefined && prev.enabled !== null) this.#enabledBySlot.delete(prev.enabled);
    } else {
      this.#attachSlot(enabled, id);
    }
    this.#states.set(id, { id, level, exp, enabled });
  }

  /**
   * 把 `slot` 腾空（`#attachSlot` 的对偶）。返回原先挂在该槽的技能 id（本来就空则 `undefined`）。
   *
   * ★ 与 `#attachSlot` 的差别：这里**代发 `onDisable`**。它的两个调用点（`disable()` /
   *   `forget()`）都要通知，且都不存在"配对 `onEnable` 需要平衡"的问题，写在一处即可。
   */
  #detachSlot(slot: EnableSlot): string | undefined {
    const id = this.#enabledBySlot.get(slot);
    if (id === undefined) return undefined;
    const st = this.#states.get(id);
    if (st !== undefined) st.enabled = null;
    this.#enabledBySlot.delete(slot);
    this.#registry.get(id)?.onDisable(this.#owner, slot);
    return id;
  }

  #ensureState(id: string): SkillState {
    const existing = this.#states.get(id);
    if (existing !== undefined) return existing;
    const created: SkillState = { id, level: 0, exp: 0, enabled: null };
    this.#states.set(id, created);
    return created;
  }

  /**
   * 某属性键的**有效值** —— 门槛判定的**唯一口径**（26 册 §37）。
   *
   *   四维（`str/con/dex/int`）：`SkillActor` 的这四个 getter **本身就是有效属性**
   *       （先天 + 加成，见 `character.ts`）⇒ 直接读，不要再加一次 `prop`，否则算两遍；
   *   其余键：没有"先天"这一路 ⇒ 就是 `prop` 加成。
   *
   * ★ 两路收在一个函数里，于是"门槛读哪个数"全项目只有一个实现 ——
   *   `minAttr` 的消费点不可能与 `SkillActor.str` 分家。
   */
  #effectiveProp(key: PropKey): number {
    return isAttrKey(key) ? this.#owner[key] : getProp(this.#owner, key);
  }

  /**
   * 学习条件判定的**唯一实现**（返回结构化拒绝；null = 通过）。
   *
   * ★★ 只出**结构**、不出文案（26 册 §64）：文案归指令层。
   *   原先这里直接拼中文，于是同一句拒绝在别处想复用时只能重抄一遍 ——
   *   两份措辞会漂移，而"漂移的那一份"永远是玩家看到的那一份。
   */
  #conditionRefusal(tpl: SkillTemplate): LearnRefused | null {
    const c = tpl.learnCondition;
    if (c === null) return null;

    for (const [slot, need] of Object.entries(c.minSlot ?? {}) as [EnableSlot, number][]) {
      if (this.levelOfSlot(slot) < need) {
        // 名字取"该槽当前生效的技能"（`基本剑法`）；槽空着时退回槽名（`sword`）。
        // 与 wushen `os/skill/skill.js:234` 同口径 —— 那里也是 `query_used_skill`。
        const name = this.activeTemplate(slot)?.name ?? slot;
        return { kind: 'refused', reason: 'slot', slot, need, name };
      }
    }
    // ★ 属性门槛只有这一路，读**有效属性**（先天 + 后天加成）—— 26 册 §37 归一。
    //   四维与其它键的差别被 `#effectiveProp()` 吸收，这里不出现"先天/加成"的分支。
    for (const [key, need] of Object.entries(c.minAttr ?? {}) as [PropKey, number][]) {
      if (this.#effectiveProp(key) < need) {
        return { kind: 'refused', reason: 'attr', key, need, name: tpl.name };
      }
    }
    if (c.minMaxMp !== undefined && this.#owner.maxMp < c.minMaxMp) {
      return { kind: 'refused', reason: 'max-mp', need: c.minMaxMp, name: tpl.name };
    }
    if (c.gender !== undefined && this.#owner.gender !== c.gender) {
      return { kind: 'refused', reason: 'gender', gender: c.gender, name: tpl.name };
    }
    return null;
  }

  #releaseLedger(): void {
    for (const [key, value] of this.#coreLedger) {
      addProp(this.#owner, key, -value);
      if (getProp(this.#owner, key) === 0) removeProp(this.#owner, key);
    }
    for (const [key, value] of this.#extLedger) {
      addExtProp(this.#owner, key, -value);
      if (getExtProp(this.#owner, key) === 0) removeExtProp(this.#owner, key);
    }
    this.#coreLedger.clear();
    this.#extLedger.clear();
  }

  #absorb(map: PropMap): void {
    for (const key of Object.keys(map.prop ?? {})) {
      assertPropKey(key);
      const value = map.prop?.[key];
      if (value === undefined || value === 0) continue;
      addProp(this.#owner, key, value);
      this.#coreLedger.set(key, value);
    }
    for (const [key, value] of map.extProp ?? []) {
      assertExtProp(key);
      if (value === 0) continue;
      addExtProp(this.#owner, key, value);
      this.#extLedger.set(key, value);
    }
  }

  /**
   * 从 NPC 定义的技能表装载（wushen `skill_map`，**不做任何条件判断**）。
   *
   * ★ 与 wushen 的差异：wushen 建的是一个「槽 → 等级」的裸 map（**技能 id 被丢掉**，
   *   于是 NPC 说不出"它练的是太极剑法"）。这里整条记录都进 `SkillBook`，
   *   与玩家同一套口径（docs/27 决策 D9）。
   */
  public loadFromDef(entries: readonly { skill: string; level: number; enableAs?: EnableSlot }[]): void {
    for (const e of entries) {
      const tpl = this.#registry.getOrThrow(e.skill);
      const enabled = e.enableAs ?? null;
      if (enabled !== null) {
        if (!isEnableSlot(enabled)) {
          throw new SkillError(`NPC 技能 ${e.skill} 的 enableAs 不是合法装配槽：${String(enabled)}`);
        }
        if (!tpl.canEnables.includes(enabled)) {
          throw new SkillError(
            `NPC 技能 ${e.skill} 不能启用为 ${enabled}（can_enables = [${tpl.canEnables.join(', ')}]）`,
          );
        }
      }
      // ★ 单一写入口（S7，2026-10-16 审查）：`#setSkillState` 同时覆盖"同一技能写两次"
      //   的两种形态 —— ① 换到别的槽（先前那个槽腾空）；② 后一条**不装配**（也要腾空）。
      //   原先只在 `enabled !== null` 时调 `#attachSlot`，形态②会留下"槽映射还指着它、
      //   而它说自己没装"的分家状态。语义与 `enable()` / `load()` 完全一致。
      this.#setSkillState(e.skill, clampLevel(e.level, tpl), 0, enabled);
    }
    this.recompute();
  }
}

// ---------------------------------------------------------------------------
// 工具
// ---------------------------------------------------------------------------

function clampLevel(level: number, tpl: SkillTemplate): number {
  if (!Number.isFinite(level)) throw new SkillError(`技能等级需要有限数值，收到 ${String(level)}`);
  return Math.max(0, Math.min(Math.trunc(level), tpl.maxLevel));
}

// ---------------------------------------------------------------------------
// 读档时的逐字段校验（E3，26 册 §40）
// ---------------------------------------------------------------------------
// ★ 三个函数都是"**只在 load 路径上**的宽松版"：`learn()` 的对应逻辑（`clampLevel`
//   等）遇到非法值直接**抛** —— 那是用户动作，抛是对的。读档不一样：一条脏数据
//   不该让整份存档崩掉（见 `load-report.ts` 的分级契约），所以这里一律
//   "取最保守的值 + 记一条 rejected"，由调用方按 ③ 决定怎么处理。

/** 读 `level`：非有限数值 ⇒ 记 0；越界/小数 ⇒ 用 `clampLevel()` 归一（**同一个实现**） */
function readLoadedLevel(
  id: string,
  tpl: SkillTemplate,
  raw: unknown,
  rejected: RejectedEntry[],
): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    rejected.push({ key: `${id}.level`, reason: `等级必须是有限数值，收到 ${describeValue(raw)}` });
    return 0;
  }
  const clamped = clampLevel(raw, tpl);
  if (clamped !== raw) {
    rejected.push({ key: `${id}.level`, reason: `等级已归一（${raw} → ${clamped}）` });
  }
  return clamped;
}

/** 读 `exp`：非有限或负数 ⇒ 记 0 并记账（0 本身合法，不记账） */
function readLoadedExp(id: string, raw: unknown, rejected: RejectedEntry[]): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0) {
    rejected.push({
      key: `${id}.exp`,
      reason: `经验必须是非负有限数值，收到 ${describeValue(raw)}`,
    });
    return 0;
  }
  return raw;
}

/**
 * 读 `enabled` —— **E3 的要害**。与 `enable()` 同判据，三道：
 *   ① 是合法槽名；② `type === SKILL`（只有武功可装配）；③ 槽在 `can_enables` 里。
 * 任一道不过 ⇒ **丢弃这个槽**（技能仍保留、`enabled = null`）+ 记账。
 *
 * ★ 为什么"丢槽"而不是"丢掉整个技能"，也不是"整包抛"：
 *   非法的是**装配**这件事，技能本身可能是真学会的。丢槽 ⇒ 篡改者拿不到任何东西
 *   （槽没被占、属性账也没它），而角色不会因为一行脏数据就失忆（可逆、可补）。
 *   ★ 少装的一个槽必定进 `rejected`，所以**漏不掉** —— 这正是分级契约 ③ 的作用。
 *
 * ★ `null` / `undefined` 一律当"未装配"、**不记账**：与 `loadProps()` 对
 *   "字段缺失 = 该字段没有内容"的取向一致，而且缺 `enabled` 取的是**最保守**的
 *   那个值（没启用 ⇒ 无任何装配收益），不构成任何越权路径。
 */
function readLoadedEnabled(
  id: string,
  tpl: SkillTemplate,
  raw: unknown,
  rejected: RejectedEntry[],
): EnableSlot | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'string' || !isEnableSlot(raw)) {
    rejected.push({
      key: `${id}.enabled`,
      reason: `非法装配槽 ${describeValue(raw)}，已降级为未装配`,
    });
    return null;
  }
  if (!tpl.isEnablable) {
    rejected.push({
      key: `${id}.enabled`,
      reason: `${tpl.name}（type=${tpl.type}）不可装配（只有武功可以），已降级为未装配`,
    });
    return null;
  }
  if (!tpl.canEnables.includes(raw)) {
    rejected.push({
      key: `${id}.enabled`,
      reason: `${tpl.name} 不能启用为 ${raw}（can_enables = [${tpl.canEnables.join(', ')}]），已降级为未装配`,
    });
    return null;
  }
  return raw;
}

/**
 * 属性键的**唯一**校验入口（S8，2026-10-16 审查）。
 *
 * `mergeInto()`（算账）与 `#absorb()`（记账）**必须用同一份**校验 ——
 * 原先只有 `#absorb` 校验、`mergeInto` 只做 `as PropKey[]` 强转，
 * 于是非法键一路走到"记账"阶段才炸：那时 `recompute()` 已经减过旧账，留下不可自愈的半账。
 * 把校验提到"算账"阶段（即 `mergeInto`），异常就发生在旧账被碰之前。
 */
function assertPropKey(key: string): asserts key is PropKey {
  if (!isPropKey(key)) throw new SkillError(`技能属性出现非法核心键：${String(key)}`);
}

/** 扩展键的同一份校验（与 `assertPropKey` 对偶） */
function assertExtProp(key: string): asserts key is ExtProp {
  if (!isExtProp(key)) throw new SkillError(`技能属性出现未登记扩展键：${String(key)}`);
}

function mergeInto(
  prop: Partial<Record<PropKey, number>>,
  ext: Map<ExtProp, number>,
  map: PropMap | undefined,
): void {
  if (map === undefined) return;
  for (const key of Object.keys(map.prop ?? {})) {
    // ★ 与 `#absorb` **同一份**校验（S8）：非法键在"算账"阶段就抛，
    //   而不是等 `recompute()` 减完旧账、走到"记账"才炸。
    assertPropKey(key);
    const value = map.prop?.[key];
    if (value === undefined) continue;
    // ★ 0 不记账。技能写 0（如 `base/force` 在 lv<10 时 `con += 0`）是常见写法，
    //   记进去只会让 `props` 表里多出一堆恒为 0 的键、并让账本无谓地变大。
    //   跳过 0 不影响正确性：0 加到任何值上都不改变它，也不改变"键是否存在"的语义
    //   （`getProp` 对"没写过"与"就是 0"同样返回 0）。
    if (value === 0) continue;
    prop[key] = (prop[key] ?? 0) + value;
  }
  for (const [key, value] of map.extProp ?? []) {
    assertExtProp(key);
    if (value === 0) continue;
    ext.set(key, (ext.get(key) ?? 0) + value);
  }
}

/** 校验表导出（供 G3/测试对账：确保 `ENABLE_SLOTS` 真的被用到） */
export const SKILL_SLOT_VOCAB: readonly string[] = ENABLE_SLOTS;

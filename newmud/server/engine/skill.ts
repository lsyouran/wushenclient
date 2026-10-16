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
import { GENDER_LABELS, propLabel } from '@shared/constants.js';
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
import type { PerformDef, PropMap, SkillActor, SkillDef, SkillLearnCondition } from '../world/defs.js';

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
  /** `max_level` 缺省值 */
  defaultMaxLevel: 100,
} as const;

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

/** 等级上限（wushen `skill_limit`）；`realm` = 境界 level 0-6 */
export function levelLimit(exp: number, realm: number): number {
  if (exp < SKILL_FORMULA.limitExpMin) return SKILL_FORMULA.limitExpMinLevel;
  const factor = SKILL_FORMULA.limitRealmFactor[realm] ?? SKILL_FORMULA.limitExpMinLevel;
  return Math.round(Math.pow(exp * factor, 1 / 3));
}

/** 进阶后的新等级（wushen `grade_up`） */
export function gradeUpLevel(pot: number, targetGrade: number): number {
  const lv = (pot * SKILL_FORMULA.gradeUpPotNum) / SKILL_FORMULA.gradeUpPotDen / (targetGrade + 1);
  return Math.trunc(Math.sqrt(Math.max(0, lv)));
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

  // ── 变更（唯一入口；末尾一律 recompute）───────────────────────────────────

  /** 学会一个技能。返回是否成功（不满足条件会 `notify` 拒绝理由） */
  public learn(id: string, level = 1): boolean {
    const tpl = this.#registry.getOrThrow(id);
    if (this.#states.has(id)) {
      this.#owner.notify(`你已经学会了${tpl.name}。`);
      return false;
    }
    const reason = this.#learnBlockReason(tpl);
    if (reason !== null) {
      this.#owner.notify(reason);
      return false;
    }
    if (!tpl.onLearn(this.#owner)) return false;
    this.#states.set(id, { id, level: clampLevel(level, tpl), exp: 0, enabled: null });
    this.recompute();
    return true;
  }

  /** 遗忘一个技能（若已装配则一并卸下） */
  public forget(id: string): boolean {
    const st = this.#states.get(id);
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

  /** 加经验，返回**升了几级**（wushen `add_exp` 的 while 循环） */
  public addExp(id: string, exp: number): number {
    if (!Number.isFinite(exp)) throw new SkillError(`addExp 需要有限数值，收到 ${String(exp)}`);
    const tpl = this.#registry.getOrThrow(id);
    const st = this.#ensureState(id);
    if (st.level >= tpl.maxLevel) return 0;

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
    while (st.level < tpl.maxLevel && st.exp >= need) {
      st.exp -= need;
      st.level += 1;
      gained += 1;
      need = levelExp(st.level, tpl.grade);
    }
    if (st.level >= tpl.maxLevel) st.exp = 0;
    if (gained > 0) this.recompute();
    return gained;
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
      //   （`passiveProp: () => ({ prop: { gj: 5 } })`），此时"跳过 0 值"这条规则救不了场，
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

  /** 学习条件判定的**唯一实现**（返回拒绝理由；null = 通过） */
  #learnBlockReason(tpl: SkillTemplate): string | null {
    const c = tpl.learnCondition;
    if (c === null) return null;

    for (const [slot, need] of Object.entries(c.minSlot ?? {}) as [EnableSlot, number][]) {
      const have = this.levelOfSlot(slot);
      if (have < need) {
        const name = this.activeTemplate(slot)?.name ?? slot;
        return `你的${name}等级不够 ${need}，无法学习${tpl.name}。`;
      }
    }
    // ★ 属性门槛只有这一路，读**有效属性**（先天 + 后天加成）—— 26 册 §37 归一。
    //   四维与其它键的差别被 `#effectiveProp()` 吸收，这里不出现"先天/加成"的分支。
    for (const [key, need] of Object.entries(c.minAttr ?? {}) as [PropKey, number][]) {
      if (this.#effectiveProp(key) < need) {
        return `你的${propLabel(key)}不够 ${need}，无法学习${tpl.name}。`;
      }
    }
    if (c.minMaxMp !== undefined && this.#owner.maxMp < c.minMaxMp) {
      return `你的内力上限不够 ${c.minMaxMp}，无法学习${tpl.name}。`;
    }
    if (c.gender !== undefined && this.#owner.gender !== c.gender) {
      // ★ 三档文案取**单源**（`GENDER_LABELS`）—— 与 wushen `os/skill/skill.js:239`
      //   的"男性/女性/无性"同口径。原先这里内联了同一张三元表（T18 的残余）。
      return `${GENDER_LABELS[c.gender]}才能学习${tpl.name}。`;
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

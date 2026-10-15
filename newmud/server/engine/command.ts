/**
 * server/engine/command.ts — 指令表 + 六道闸门 + 三级分发
 * ============================================================================
 * 对照 wushen `os/command.js`（46 行）+ `os/char/character.js:136-222`。
 * 设计册：`docs/wushen/13-指令系统与分发链路.md`。
 *
 * ★ 抄过来的三件好东西（13 册 §13.10 建议 1/2/4）：
 *   1. **逗号别名** —— `command: 'look,l'` 一行搞定多个入口。
 *   2. **六道闸门集中校验** —— 每个指令只**声明**自己的可用条件，
 *      校验只有一处；不必在每个指令里重复 `if (me.isBusy()) return`。
 *   3. **三级查找**：房间动作 → 全局指令 → 目标物件动作。
 *      「在这个房间里打坐有事发生」因此天然可能（房间动作覆盖同名全局指令）。
 *
 * ★ 显式**不抄**的四条（13 册 §13.10 建议 5–7 点名的缺陷）：
 *   1. `WORLD.DEFAULT_COMMAND` 全项目从未赋值 —— 这里**不存在**这个概念，
 *      未知指令直接走"什么？"，而不是先查一个永远 undefined 的兜底。
 *   2. 指令重名只 `console.error` 然后**静默覆盖** —— 这里在建表时**抛错**。
 *      静默覆盖会让"内容文件里改了一行"变成一条无声消失的入口。
 *   3. `pars[0] = this` 的**黑魔法**（把正则的完整匹配串偷偷换成 me）——
 *      这里 `run(me, ...捕获组)` 直接按参数传，不篡改 `exec` 的结果。
 *   4. `this.admin` 死标记（5 个文件在用、全项目无消费点）—— 不存在。
 *
 * ★ 另外三处**修正/收紧**（都有对应断言）：
 *   - 前导空格：wushen 的字符扫描在 `"  look x"` 上会得到 `cmd=" "`。这里先 `trim`。
 *   - 指令名大小写：wushen 大小写敏感（`Look` → 什么？）。这里 `toLowerCase()`。
 *   - `regex` 带 `g` / `y` 标志会让 `exec` 依赖 `lastIndex`（同样的输入时对时错）：
 *     建表时**直接拒绝**这种声明。
 *
 * 退出码无关；本文件是被引擎调用的纯逻辑，不碰 socket。
 */

import type {
  ActionDef,
  ActorEnvironment,
  ActorObject,
  CommandActor,
  CommandDef,
  CommandGateDecl,
} from '../world/defs.js';

// ---------------------------------------------------------------------------
// 用户可见文案（集中一处；测试引用常量而不是重抄字面量）
// ---------------------------------------------------------------------------

export const COMMAND_MESSAGES = {
  /** 未知指令 / 权限不足 / 空输入 —— 都是同一句（wushen 的"什么？"） */
  unknown: '什么？',
  die: '你现在是灵魂状态，不能那么做。',
  faint: '你正在昏迷中！',
  fight: '你正在战斗，待会再说。',
  busy: '你现在正忙。',
} as const;

/** 状态中不可用时的提示（`你正在打坐，没时间这么做。`） */
export function stateBlockedMessage(title: string): string {
  return `你正在${title}，没时间这么做。`;
}

// ---------------------------------------------------------------------------
// 六道闸门
// ---------------------------------------------------------------------------

/** 闸门编号（与 wushen `check_command` 的判定顺序一致） */
export type GateName = 'level' | 'die' | 'faint' | 'state' | 'fight' | 'busy';

/** 判定所依据的**状态快照**（纯数据 → 闸门可以脱离角色单测） */
export interface GateState {
  readonly userLevel: number;
  readonly alive: boolean;
  readonly faint: boolean;
  readonly state: { readonly title: string } | null;
  readonly fightType: number;
  readonly busy: boolean;
}

export interface GateBlocked {
  readonly ok: false;
  readonly gate: GateName;
  readonly message: string;
}
export interface GatePassed {
  readonly ok: true;
}
export type GateResult = GatePassed | GateBlocked;

const PASSED: GatePassed = { ok: true };

/**
 * 从角色快照出闸门要用的状态。
 * 缺省值：`isFaint` → false、`state` → null、`fightType` → 0
 * （战斗 / 状态系统未落地前的**正确**取值：不在战斗、不在状态、未昏迷）。
 */
export function gateStateOf(me: CommandActor, nowMs: number = Date.now()): GateState {
  return {
    userLevel: me.userLevel,
    alive: me.isAlive,
    faint: me.isFaint ?? false,
    state: me.state ?? null,
    fightType: me.fightType ?? 0,
    busy: me.isBusy(nowMs),
  };
}

/**
 * 六道闸门。顺序照抄 wushen（决定"同时满足多个禁止条件时报哪一句"）。
 *
 * ★ 注意 `allow_fight` 的缺省是 **true**（wushen 的 `COMMAND` 构造器就写着
 *   `this.allow_fight = true`），所以这里判的是"**显式为 false** 才拦"，
 *   而不是"缺省就拦" —— 这一处不对称必须保住。
 */
export function checkCommandGates(decl: CommandGateDecl, state: GateState): GateResult {
  if ((decl.allow_level ?? 0) > state.userLevel) {
    return { ok: false, gate: 'level', message: COMMAND_MESSAGES.unknown };
  }
  if (!state.alive && decl.allow_die !== true) {
    return { ok: false, gate: 'die', message: COMMAND_MESSAGES.die };
  }
  if (state.faint && decl.allow_faint !== true) {
    return { ok: false, gate: 'faint', message: COMMAND_MESSAGES.faint };
  }
  if (state.state !== null && decl.allow_state !== true) {
    return { ok: false, gate: 'state', message: stateBlockedMessage(state.state.title) };
  }
  if (state.fightType > 0 && decl.allow_fight === false) {
    return { ok: false, gate: 'fight', message: COMMAND_MESSAGES.fight };
  }
  if (state.busy && decl.allow_busy !== true) {
    return { ok: false, gate: 'busy', message: COMMAND_MESSAGES.busy };
  }
  return PASSED;
}

// ---------------------------------------------------------------------------
// 指令表
// ---------------------------------------------------------------------------

export class CommandDeclError extends Error {
  public override readonly name = 'CommandDeclError';
}
export class DuplicateAliasError extends Error {
  public override readonly name = 'DuplicateAliasError';
}

/** 别名只允许「小写字母开头 + 小写字母/数字/下划线」 */
const ALIAS_RE = /^[a-z][a-z0-9_]*$/;

export interface CommandEntry {
  /** 指令模板 id（`world/command/<id>.ts` 的那个 id） */
  readonly id: string;
  readonly def: CommandDef;
}

/**
 * 别名 → 指令的索引。
 *
 * 取代 `WORLD.COMMANDS`（一个裸对象 + 拼错索引）：
 *   - Map，O(1)
 *   - **重名直接抛错**（wushen 只 console.error 后覆盖）
 *   - 建表时就拒绝坏声明（空别名、非法字符、带 `g`/`y` 的 regex）
 */
export class CommandTable {
  readonly #byAlias = new Map<string, CommandEntry>();
  readonly #entries: CommandEntry[] = [];

  public constructor(entries: readonly CommandEntry[]) {
    for (const entry of entries) {
      const aliases = parseAliases(entry);
      for (const alias of aliases) {
        const prev = this.#byAlias.get(alias);
        if (prev !== undefined) {
          throw new DuplicateAliasError(
            `别名 "${alias}" 重复：${prev.id} 与 ${entry.id}` +
              `（wushen 在这一点上只 console.error 然后静默覆盖，于是有一条入口会无声消失）`,
          );
        }
        this.#byAlias.set(alias, entry);
      }
      this.#entries.push(entry);
    }
  }

  /** 指令**条目**数（一个条目可有多个别名） */
  public get size(): number {
    return this.#entries.length;
  }

  /** 别名总数 */
  public get aliasCount(): number {
    return this.#byAlias.size;
  }

  public lookup(alias: string): CommandEntry | undefined {
    return this.#byAlias.get(alias);
  }

  public commands(): readonly CommandEntry[] {
    return this.#entries;
  }

  public aliases(): readonly string[] {
    return [...this.#byAlias.keys()];
  }
}

function parseAliases(entry: CommandEntry): readonly string[] {
  const raw = entry.def.command;
  if (typeof raw !== 'string' || raw.trim() === '') {
    throw new CommandDeclError(`指令 ${entry.id} 的 command 字段为空（必须形如 'look,l'）`);
  }
  if (entry.def.regex !== undefined && (entry.def.regex.global || entry.def.regex.sticky)) {
    throw new CommandDeclError(
      `指令 ${entry.id} 的 regex 带了 g/y 标志：exec() 会依赖 lastIndex，` +
        `同样的输入会时对时错。请去掉标志（或用非全局副本）`,
    );
  }
  const out: string[] = [];
  for (const piece of raw.split(',')) {
    const alias = piece.trim();
    if (alias === '') {
      throw new CommandDeclError(`指令 ${entry.id} 的 command 里有空别名：${JSON.stringify(raw)}`);
    }
    if (!ALIAS_RE.test(alias)) {
      throw new CommandDeclError(
        `指令 ${entry.id} 的别名 ${JSON.stringify(alias)} 不符合命名法（${String(ALIAS_RE)}）`,
      );
    }
    if (out.includes(alias)) {
      throw new CommandDeclError(`指令 ${entry.id} 的别名 ${JSON.stringify(alias)} 自己重复了`);
    }
    out.push(alias);
  }
  return out;
}

// ---------------------------------------------------------------------------
// 分发
// ---------------------------------------------------------------------------

export type DispatchVia = 'action' | 'command' | 'target';

export type DispatchOutcome =
  | { readonly kind: 'empty' }
  | { readonly kind: 'executed'; readonly via: DispatchVia; readonly id: string }
  | {
      readonly kind: 'blocked';
      readonly via: DispatchVia;
      readonly id: string;
      readonly gate: GateName;
      readonly message: string;
    }
  /** 入口返回了 `false`（"我没处理"），三级都问过仍无人接手 */
  | { readonly kind: 'passthrough' }
  | { readonly kind: 'unknown' };

export interface DispatchContext {
  /** 注入时钟（测试用；忙碌判定要它） */
  readonly nowMs?: number;
  /**
   * `'login'` = 登录未完成阶段，只放行 `allow_login` 的指令
   * （对应 wushen `extends/login.js` 的 `wait_login`）。
   * 缺省 `'playing'`。
   */
  readonly phase?: 'playing' | 'login';
}

/** 首词 + 剩余参数。前导/重复空白一并归一（wushen 的字符扫描在 `"  look x"` 上会出错） */
export function splitInput(input: string): { name: string; args: string } {
  const trimmed = input.trim();
  if (trimmed === '') return { name: '', args: '' };
  const m = /^(\S+)(?:\s+([\s\S]*))?$/.exec(trimmed);
  if (m === null) return { name: trimmed.toLowerCase(), args: '' };
  return { name: (m[1] ?? '').toLowerCase(), args: (m[2] ?? '').trim() };
}

/**
 * 正则捕获组 → 形参。
 * - 无参数 → 不传形参
 * - 有 `regex` 且匹配 → 捕获组按序（**可选组不匹配时是 `undefined`**，wushen 同款：
 *   `os/char/character.js:161` 的 `pars = cmd.regex.exec(str)`）
 * - 有 `regex` 但不匹配 → 退回"整串作为唯一参数"（wushen 的 `pars = [this, str]`，
 *   `os/char/character.js:162`/`:164`）
 * - 无 `regex` → 整串作为唯一参数
 */
export function buildParams(regex: RegExp | undefined, args: string): (string | undefined)[] {
  if (args === '') return [];
  if (regex !== undefined) {
    const m = regex.exec(args);
    if (m !== null) {
      const caps: (string | undefined)[] = [];
      for (let i = 1; i < m.length; i += 1) caps.push(m[i]);
      return caps;
    }
  }
  return [args];
}

/** 在宿主（房间 / 目标物件）身上找动作：先整行精确（支持 `goto home`），再按首词 */
export function findAction(
  host: { readonly actions?: readonly ActionDef[] | undefined } | null | undefined,
  name: string,
  fullLine: string,
): ActionDef | undefined {
  const list = host?.actions;
  if (list === undefined || list.length === 0) return undefined;
  const byLine = list.find((a) => a.cmd === fullLine);
  if (byLine !== undefined) return byLine;
  return list.find((a) => a.cmd === name);
}

/**
 * 模板 id 的**末段**（去变体后缀）：
 *   `pub/xiaoer`   → `xiaoer`
 *   `drug/yao#1`   → `yao`
 * 玩家天然会按这个名字输入（`ask xiaoer`），所以它也参与目标匹配。
 */
function localNameOf(path: string | null): string | null {
  if (path === null) return null;
  const base = path.split('#')[0] ?? path;
  const idx = base.lastIndexOf('/');
  return idx === -1 ? base : base.slice(idx + 1);
}

/**
 * 参数串的**首个词**（目标匹配的兜底键；见 `dispatch` 第 ③ 级）。
 * `splitInput` 保证 `args` 已 trim 且无前导空白，所以这里直接切第一个空白即可。
 */
function firstWordOf(args: string): string {
  const m = /^(\S+)/.exec(args);
  return m?.[1] ?? args;
}

/**
 * 找目标物件。
 *
 * 命中条件（任一）：实例 `id` / 显示 `name` / 模板 `path` / 模板 id 的**末段**（去变体）。
 *
 * ★ 与 wushen 的差异：wushen 的 `find_obj_byid` **只按实例 id 精确匹配**
 *   （`os/item.js:188`），而 id 是 4 位随机串 —— 于是玩家得先看到那串 id 才能操作它。
 *   这里放宽到"名字 / 模板路径末段也能命中"，理由是自然语言输入几乎总是写名字；
 *   wushen 只认 id 也正是"捡 A 结果 B 消失"那类事故的同源土壤。
 *   仍然是**精确匹配**（不做前缀/模糊），命中多个时取**第一个**。
 *
 * 查找顺序：所在环境的内容物 → 自己身上的内容物。
 */
export function findTarget(
  me: CommandActor,
  env: ActorEnvironment | null,
  key: string,
): ActorObject | undefined {
  const pools: readonly (readonly ActorObject[])[] = env === null ? [me.items] : [env.items, me.items];
  for (const pool of pools) {
    for (const obj of pool) {
      if (
        obj.id === key ||
        obj.name === key ||
        obj.path === key ||
        localNameOf(obj.path) === key
      ) {
        return obj;
      }
    }
  }
  return undefined;
}

/**
 * 三级分发（wushen `do_command` 的等价物）。
 *
 * 顺序与 wushen 一致，**每一步都在注释里标出它在 wushen 里的位置**：
 *
 *   ① 房间 / 环境动作优先 —— 房间可用 `dazuo` 覆盖同名全局指令
 *   ② 全局指令
 *   ③ 目标物件动作（仅当有参数）—— `ask xiaoer` 里 `xiaoer` 是目标
 *   ④ 都不接手 → "什么？"
 *
 * ★ 返回 `false` 的语义：只有 `ActionDef.run` / `CommandDef.run` 显式返回 `false`
 *   才继续往下一级找；其余返回值（含 `undefined`）都视为"已处理"。
 *
 * ★ 被闸门拦下 = **消费掉这条输入**（照抄 wushen：`do_item_action` 在闸门失败时
 *   返回 `true`）。所以"房间动作存在但当前不可用"不会把机会让给同名全局指令 ——
 *   这一条由测试显式钉住，免得日后有人以为是 bug 而改掉。
 */
export function dispatch(
  table: CommandTable,
  me: CommandActor,
  input: string,
  ctx: DispatchContext = {},
): DispatchOutcome {
  const nowMs = ctx.nowMs ?? Date.now();
  const phase = ctx.phase ?? 'playing';
  const { name, args } = splitInput(input);
  if (name === '') return { kind: 'empty' };

  const state = gateStateOf(me, nowMs);
  /** 归一后的整行（用于多词动作匹配，如 `goto home`） */
  const fullLine = args === '' ? name : `${name} ${args}`;

  // ── 登录未完成阶段：只放行 allow_login（wushen `wait_login`）──────────────
  //    注意 wushen 的 `check_command` **不**判 allow_login，它是在登录流程里单独生效的。
  if (phase === 'login') {
    const entry = table.lookup(name);
    if (entry === undefined || entry.def.allow_login !== true) {
      me.notify(COMMAND_MESSAGES.unknown);
      return { kind: 'unknown' };
    }
    entry.def.run(me, ...buildParams(entry.def.regex, args));
    return { kind: 'executed', via: 'command', id: entry.id };
  }

  const env = me.environment;

  // ── ① 环境动作优先（wushen: do_item_action(this.environment, cmdName, pars)）──
  const roomAction = findAction(env, name, fullLine);
  if (roomAction !== undefined) {
    const gate = checkCommandGates(roomAction, state);
    if (!gate.ok) {
      me.notify(gate.message);
      return { kind: 'blocked', via: 'action', id: roomAction.cmd, gate: gate.gate, message: gate.message };
    }
    const ret = roomAction.run(me, ...buildParams(undefined, args));
    if (ret !== false) return { kind: 'executed', via: 'action', id: roomAction.cmd };
    // 返回 false → 继续往 ② 找（wushen 的 `!== false` 语义）
  }

  // ── ② 全局指令（wushen: cmd = cmd || DEFAULT_COMMAND → 我们删掉了那个死变量）──
  const entry = table.lookup(name);
  let passthrough = false;
  if (entry !== undefined) {
    const gate = checkCommandGates(entry.def, state);
    if (!gate.ok) {
      me.notify(gate.message);
      return { kind: 'blocked', via: 'command', id: entry.id, gate: gate.gate, message: gate.message };
    }
    const ret = entry.def.run(me, ...buildParams(entry.def.regex, args));
    if (ret !== false) return { kind: 'executed', via: 'command', id: entry.id };
    passthrough = true;
  }

  // ── ③ 目标物件动作（wushen: str 存在 → find_obj(str) 上的同名动作）──────────
  if (args !== '') {
    // ★ 26 册 §11.2 R2：wushen 把**整串参数**当目标名（`do_command(str)`），于是
    //   `ask xiaoer about job` 永远找不到 xiaoer —— 第三级查找在带修饰语时静默失效，
    //   表现是"这条指令有时灵有时不灵"，而这恰恰是最难查的那类 bug。
    //   这里先按整串精确匹配（保留 `get 长名字` 这类用法），再退回**首词**
    //   （自然语言里目标几乎总是第一个词）。两次都是精确匹配，不做前缀/模糊。
    const target = findTarget(me, env, args) ?? findTarget(me, env, firstWordOf(args));
    const targetAction = findAction(target, name, fullLine);
    if (targetAction !== undefined) {
      const gate = checkCommandGates(targetAction, state);
      if (!gate.ok) {
        me.notify(gate.message);
        return {
          kind: 'blocked',
          via: 'target',
          id: targetAction.cmd,
          gate: gate.gate,
          message: gate.message,
        };
      }
      const ret = targetAction.run(me, ...buildParams(undefined, args));
      if (ret !== false) return { kind: 'executed', via: 'target', id: targetAction.cmd };
      passthrough = true;
    }
  }

  // ── ④ 无人接手 ──────────────────────────────────────────────────────────
  if (passthrough) return { kind: 'passthrough' };
  me.notify(COMMAND_MESSAGES.unknown);
  return { kind: 'unknown' };
}

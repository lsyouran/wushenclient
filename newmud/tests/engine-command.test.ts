/**
 * server/engine/command.ts —— 指令表 / 六道闸门 / 三级分发
 * ============================================================================
 * 这批断言把 docs/wushen/13 的三条"值得抄"与四条"别抄"逐条钉住：
 *   抄：逗号别名 / 六道闸门集中校验 / 三级查找（房间 → 全局 → 目标物件）
 *   不抄：DEFAULT_COMMAND 死变量 / 重名静默覆盖 / `pars[0] = this` 黑魔法 / 死标记 admin
 * 另外钉住三处收紧：前导空格、指令名大小写、带 g|y 的 regex 被拒。
 *
 * 全部用**合成指令 + 真实 Room/Item/Npc**，不依赖 @world 内容
 * （真实内容那条链路在 engine-world.test.ts 里跑）。
 */
import { describe, expect, it } from 'vitest';

import {
  COMMAND_MESSAGES,
  CommandDeclError,
  CommandTable,
  DuplicateAliasError,
  buildParams,
  checkCommandGates,
  dispatch,
  findAction,
  findTarget,
  gateStateOf,
  splitInput,
  stateBlockedMessage,
} from '../server/engine/command.js';
import type { CommandEntry, GateState } from '../server/engine/command.js';
import type { FightType, MoveResult } from '../shared/constants.js';
import { Item } from '../server/engine/item.js';
import { Npc } from '../server/engine/npc.js';
import { Room } from '../server/engine/room.js';
import { emptySkillRegistry } from '../server/engine/skill.js';
import type {
  ActionDef,
  ActorObject,
  CommandActor,
  CommandDef,
  CommandGateDecl,
  ItemDetailView,
  NpcDef,
  RoomDef,
  FightStart,
} from '../server/world/defs.js';
import type { Channel, Direction } from '../shared/constants.js';
import type { AttrBreakdown } from '../server/engine/formula.js';
import { asWorldId } from '../shared/ids.js';

/**
 * 无技能的 NPC 也要一个技能注册表（`NpcInit.skillRegistry` 是必填）。
 * 空注册表 = 这个 NPC 任何技能都学不了，正合分发测试的需要。
 */
const NO_SKILLS = emptySkillRegistry();

// ---------------------------------------------------------------------------
// 夹具
// ---------------------------------------------------------------------------

function makeRoom(path: string, actions?: readonly ActionDef[]): Room {
  const def: RoomDef = {
    name: '测试房间',
    desc: '一间用于测试的房间。',
    ...(actions === undefined ? {} : { actions }),
  };
  return new Room({
    oid: `room-${path}`,
    path: asWorldId(path, 'engine-command.test:room'),
    name: def.name,
    desc: def.desc,
    def,
  });
}

function makeActor(
  opts: {
    readonly environment?: Room | null;
    readonly items?: readonly Item[];
    readonly alive?: boolean;
    readonly busy?: boolean;
    readonly userLevel?: number;
    readonly fightType?: number;
    readonly state?: { readonly title: string } | null;
    readonly faint?: boolean;
  } = {},
): TestActor {
  return new TestActor(opts);
}

/** 最小 CommandActor 实现（可调各项状态；room 跟随 environment） */
class TestActor implements CommandActor {
  public readonly id = 'actor1';
  public readonly name = '测试者';
  public readonly messages: string[] = [];
  public readonly items: readonly Item[];
  public readonly environment: Room | null;
  public isAlive: boolean;
  public userLevel: number;
  public fightType: number;
  public state: { readonly title: string } | null;
  public isFaint: boolean;
  #busy: boolean;

  public constructor(
    opts: {
      readonly environment?: Room | null;
      readonly items?: readonly Item[];
      readonly alive?: boolean;
      readonly busy?: boolean;
      readonly userLevel?: number;
      readonly fightType?: number;
      readonly state?: { readonly title: string } | null;
      readonly faint?: boolean;
    } = {},
  ) {
    this.environment = opts.environment ?? null;
    this.items = opts.items ?? [];
    this.isAlive = opts.alive ?? true;
    this.#busy = opts.busy ?? false;
    this.userLevel = opts.userLevel ?? 0;
    this.fightType = opts.fightType ?? 0;
    this.state = opts.state ?? null;
    this.isFaint = opts.faint ?? false;
  }

  public get room(): Room | null {
    return this.environment;
  }

  public isBusy(): boolean {
    return this.#busy;
  }

  public setBusy(v: boolean): void {
    this.#busy = v;
  }

  public notify(text: string): void {
    this.messages.push(text);
  }

  public sendRoom(text: string): void {
    this.messages.push(`[room] ${text}`);
  }

  public sendCommands(...pairs: string[]): void {
    this.messages.push(`[cmd] ${pairs.join(' ')}`);
  }

  /**
   * `CommandActor.go` 的桩：**只记账，不真移动**。
   * 真实移动（出口解析 / on_leave / on_enter / 位置一致性）跑在
   * `login-e2e.test.ts` 的真服务器上 —— 那里才有真房间与真出口。
   *
   * ★ 返回 `MoveResult` 而不是布尔（26 册 T2）：`go` 现在要区分
   *   "没出路 / 内容拦住 / 房间满员"三种走不动。这里永远走得动 ——
   *   三种失败各自的文案与去向由 `tests/move-full.test.ts` 管。
   */
  public readonly went: string[] = [];

  public go(direction: Direction): MoveResult {
    this.went.push(direction);
    return { ok: true };
  }

  /**
   * `CommandActor.beginFight` 的桩（战斗批次新增）——**只记账，不真开战**。
   * 真实开战（双方入场 / 排第一拍 / 命中判定）跑在 `tests/combat.test.ts`
   * 的**真角色**上；本文件测的是分发与闸门，只需要满足接口的替身。
   */
  public readonly fightOps: string[] = [];

  public beginFight(target: ActorObject, type: FightType): FightStart {
    this.fightOps.push(`fight ${target.id} ${String(type)}`);
    return { ok: true };
  }

  /** `CommandActor.revive` 的桩（复活批次新增）—— 同上，只记账 */
  public readonly reviveOps: string[] = [];

  public revive(): boolean {
    this.reviveOps.push('revive');
    return true;
  }

  /**
   * `CommandActor` 的**物品搬运四原语**（B 批新增）——这里只记账。
   *
   * ★ 为什么是桩而不是真语义：真实语义（容量判定 / 双向绑定 / 归零销毁 / 扣钱）
   *   跑在三处地方，各有真 `Character` 子类：
   *     - `tests/engine-item.test.ts`（三原语本身）
   *     - `tests/item-command.test.ts`（get/drop/give/use 四条指令）
   *   本文件测的是**分发与闸门**，只需要一个满足接口的替身。
   *   ⇒ 加成员在这里是**良性破坏**：它把"接口变了"变成一次编译期点名。
   */
  public readonly itemOps: string[] = [];

  public takeItem(item: ActorObject): boolean {
    this.itemOps.push(`take ${item.id}`);
    return true;
  }

  public dropItem(item: ActorObject): boolean {
    this.itemOps.push(`drop ${item.id}`);
    return true;
  }

  public spendItem(item: ActorObject, count = 1): boolean {
    this.itemOps.push(`spend ${item.id} ${String(count)}`);
    return true;
  }

  public spendMoney(amount: number): boolean {
    this.itemOps.push(`pay ${String(amount)}`);
    return true;
  }

  /** `CommandActor.sendChannel` 的桩（受众裁决属会话层，这里只看"发了什么"） */
  public readonly channels: Array<{ ch: Channel; content: string; to?: string }> = [];

  public sendChannel(ch: Channel, content: string, to?: string): void {
    this.channels.push(to === undefined ? { ch, content } : { ch, content, to });
  }

  /**
   * `CommandActor.showItem` 的桩（对象详情落点）。
   *
   * ★ 不与上面的 `items` 混用：`items` 是 `CommandActor.items`（**这个角色身上有什么**），
   *   这里记的是**看别人的详情**。同名会把两件事搅在一起。
   */
  public readonly details: ItemDetailView[] = [];

  public showItem(detail: ItemDetailView): void {
    this.details.push(detail);
  }

  /**
   * `CommandActor.attrBreakdowns` 的桩：`TestActor` 不是真角色（没有先天 / `prop`），
   * 返回空表。真实的三档读数由 `Character` 给（走 `formula.ts#computeAttrBreakdowns`），
   * 其口径由 `tests/engine-formula.test.ts` 钉住。
   */
  public attrBreakdowns(): readonly AttrBreakdown[] {
    return [];
  }

  public lastMessage(): string {
    return this.messages[this.messages.length - 1] ?? '';
  }
}

function entry(id: string, def: CommandDef): CommandEntry {
  return { id, def };
}

const HEALTHY: GateState = {
  userLevel: 0,
  alive: true,
  faint: false,
  state: null,
  fightType: 0,
  busy: false,
};

/** 断言"被拦下"，并取回闸门名（比 `ok === false && r.gate` 的写法清楚） */
function gateOf(decl: CommandGateDecl, state: GateState): string {
  const r = checkCommandGates(decl, state);
  if (r.ok) throw new Error('预期被闸门拦下，实际放行了');
  return r.gate;
}

// ---------------------------------------------------------------------------
// splitInput
// ---------------------------------------------------------------------------

describe('engine/command · splitInput', () => {
  it('只有指令名时无参数', () => {
    expect(splitInput('look')).toEqual({ name: 'look', args: '' });
  });

  it('按**第一个空白串**切分，其余整串作为参数（含内部空格）', () => {
    expect(splitInput('task all 1 2')).toEqual({ name: 'task', args: 'all 1 2' });
  });

  it('★ 指令名归一为小写；**参数保持原样**（大小写敏感）', () => {
    expect(splitInput('  Look  Sword ')).toEqual({ name: 'look', args: 'Sword' });
  });

  it('★ 前导空白被吃掉（wushen 的字符扫描在 "  look x" 上会得到 cmd=" "）', () => {
    expect(splitInput('   look   x')).toEqual({ name: 'look', args: 'x' });
  });

  it('空输入 / 纯空白 → 空指令名', () => {
    expect(splitInput('')).toEqual({ name: '', args: '' });
    expect(splitInput('    ')).toEqual({ name: '', args: '' });
  });
});

// ---------------------------------------------------------------------------
// buildParams
// ---------------------------------------------------------------------------

describe('engine/command · buildParams（参数解析）', () => {
  it('无参数 → 不传形参', () => {
    expect(buildParams(undefined, '')).toEqual([]);
  });

  it('无 regex → 整串作为唯一参数（wushen 的 pars = [str]）', () => {
    expect(buildParams(undefined, 'a b c')).toEqual(['a b c']);
  });

  it('有 regex → 捕获组**按序**映射到形参', () => {
    expect(buildParams(/(\w+)\s+(\w+)/, 'a b')).toEqual(['a', 'b']);
  });

  it('★ 可选捕获组不匹配时是 undefined（wushen `do_command` 依赖这个语义：`os/char/character.js:161`）', () => {
    expect(buildParams(/(\w+)(?:\s+(\w+))?/, 'a')).toEqual(['a', undefined]);
    expect(buildParams(/(\w+)(?:\s+(\w+))?/, 'a b')).toEqual(['a', 'b']);
  });

  it('regex 不匹配 → 退回整串（不是空数组，也不是抛错）', () => {
    expect(buildParams(/(\d+)/, 'abc')).toEqual(['abc']);
  });
});

// ---------------------------------------------------------------------------
// CommandTable
// ---------------------------------------------------------------------------

const noopRun = (): void => undefined;

describe('engine/command · CommandTable（别名索引）', () => {
  it('逗号别名一行搞定多个入口', () => {
    const t = new CommandTable([entry('action/look', { command: 'look,l', run: noopRun })]);
    expect(t.lookup('look')?.id).toBe('action/look');
    expect(t.lookup('l')?.id).toBe('action/look');
    expect(t.lookup('nonexistent')).toBeUndefined();
    expect(t.size).toBe(1); // 1 个条目
    expect(t.aliasCount).toBe(2); // 2 个别名
  });

  it('★ 跨指令重名别名 → 抛错（wushen 只 console.error 然后**静默覆盖**）', () => {
    expect(
      () =>
        new CommandTable([
          entry('a/one', { command: 'look', run: noopRun }),
          entry('a/two', { command: 'look', run: noopRun }),
        ]),
    ).toThrow(DuplicateAliasError);
  });

  it('同一指令内别名自重复 → 抛错', () => {
    expect(() => new CommandTable([entry('a/one', { command: 'look,look', run: noopRun })])).toThrow(
      CommandDeclError,
    );
  });

  it('空 command 字段 → 抛错（wushen 只 console.error）', () => {
    expect(() => new CommandTable([entry('a/one', { command: '', run: noopRun })])).toThrow(
      CommandDeclError,
    );
    expect(() => new CommandTable([entry('a/one', { command: ' , ', run: noopRun })])).toThrow(
      CommandDeclError,
    );
  });

  it('别名命名法非法（大写 / 数字开头）→ 抛错', () => {
    expect(() => new CommandTable([entry('a/one', { command: 'Look', run: noopRun })])).toThrow(
      CommandDeclError,
    );
    expect(() => new CommandTable([entry('a/one', { command: '1look', run: noopRun })])).toThrow(
      CommandDeclError,
    );
  });

  it('★ regex 带 g / y 标志 → 抛错（exec 依赖 lastIndex，同样输入时对时错）', () => {
    expect(
      () => new CommandTable([entry('a/one', { command: 'look', regex: /a/g, run: noopRun })]),
    ).toThrow(CommandDeclError);
    expect(
      () => new CommandTable([entry('a/one', { command: 'look', regex: /a/y, run: noopRun })]),
    ).toThrow(CommandDeclError);
    // 不带标志的同类正则是合法的
    expect(
      () => new CommandTable([entry('a/one', { command: 'look', regex: /a/, run: noopRun })]),
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// 六道闸门
// ---------------------------------------------------------------------------

describe('engine/command · 六道闸门', () => {
  it('全默认 + 健康状态 → 放行', () => {
    expect(checkCommandGates({}, HEALTHY)).toEqual({ ok: true });
  });

  it('level：allow_level 是"最低 GM 等级"，等级不够即拦（提示同"什么？"）', () => {
    const blocked = checkCommandGates({ allow_level: 6 }, { ...HEALTHY, userLevel: 0 });
    expect(blocked).toEqual({ ok: false, gate: 'level', message: COMMAND_MESSAGES.unknown });
    expect(checkCommandGates({ allow_level: 6 }, { ...HEALTHY, userLevel: 6 })).toEqual({ ok: true });
    // 等级够高时任何 allow_level 都放行
    expect(checkCommandGates({ allow_level: 3 }, { ...HEALTHY, userLevel: 9 })).toEqual({ ok: true });
  });

  it('die：hp<=0 默认拦，allow_die 显式 true 才放行', () => {
    const dead = { ...HEALTHY, alive: false };
    expect(checkCommandGates({}, dead)).toEqual({
      ok: false,
      gate: 'die',
      message: COMMAND_MESSAGES.die,
    });
    expect(checkCommandGates({ allow_die: true }, dead)).toEqual({ ok: true });
  });

  it('faint：昏迷默认拦，allow_faint 显式 true 才放行', () => {
    const faint = { ...HEALTHY, faint: true };
    expect(checkCommandGates({}, faint)).toEqual({
      ok: false,
      gate: 'faint',
      message: COMMAND_MESSAGES.faint,
    });
    expect(checkCommandGates({ allow_faint: true }, faint)).toEqual({ ok: true });
  });

  it('state：状态中默认拦，提示里带状态名', () => {
    const inState = { ...HEALTHY, state: { title: '打坐' } };
    expect(checkCommandGates({}, inState)).toEqual({
      ok: false,
      gate: 'state',
      message: stateBlockedMessage('打坐'),
    });
    expect(stateBlockedMessage('打坐')).toBe('你正在打坐，没时间这么做。');
    expect(checkCommandGates({ allow_state: true }, inState)).toEqual({ ok: true });
  });

  it('★ fight：allow_fight 缺省是 **true** —— 战斗中默认**不拦**（wushen 的不对称）', () => {
    const fighting = { ...HEALTHY, fightType: 1 };
    expect(checkCommandGates({}, fighting)).toEqual({ ok: true });
    expect(checkCommandGates({ allow_fight: true }, fighting)).toEqual({ ok: true });
    expect(checkCommandGates({ allow_fight: false }, fighting)).toEqual({
      ok: false,
      gate: 'fight',
      message: COMMAND_MESSAGES.fight,
    });
  });

  it('busy：忙碌默认拦，allow_busy 显式 true 才放行', () => {
    const busy = { ...HEALTHY, busy: true };
    expect(checkCommandGates({}, busy)).toEqual({
      ok: false,
      gate: 'busy',
      message: COMMAND_MESSAGES.busy,
    });
    expect(checkCommandGates({ allow_busy: true }, busy)).toEqual({ ok: true });
  });

  it('判定顺序照抄 wushen：同时违规时按 level → die → faint → state → fight → busy 报第一个', () => {
    const worst: GateState = {
      userLevel: 0,
      alive: false,
      faint: true,
      state: { title: '打坐' },
      fightType: 1,
      busy: true,
    };
    expect(gateOf({}, worst)).toBe('die');
    expect(gateOf({ allow_die: true }, worst)).toBe('faint');
    expect(gateOf({ allow_die: true, allow_faint: true }, worst)).toBe('state');
    expect(gateOf({ allow_die: true, allow_faint: true, allow_state: true }, worst)).toBe('busy');
  });
});

describe('engine/command · gateStateOf', () => {
  it('可选字段缺席时按"无"取默认（不在战斗 / 不在状态 / 未昏迷）', () => {
    const minimal: CommandActor = {
      id: 'x',
      name: 'X',
      notify: () => undefined,
      sendRoom: () => undefined,
      sendCommands: () => undefined,
      showItem: () => undefined,
      sendChannel: () => undefined,
      go: () => ({ ok: false, reason: 'blocked' }),
      environment: null,
      room: null,
      items: [],
      isAlive: true,
      isBusy: () => false,
      userLevel: 0,
      attrBreakdowns: () => [],
      // B 批新增的四个物品搬运原语（`gateStateOf` 用不到，但接口要求在场）
      takeItem: () => true,
      dropItem: () => true,
      spendItem: () => true,
      spendMoney: () => true,
      // 战斗批次新增（`gateStateOf` 用不到，但接口要求在场）
      beginFight: () => ({ ok: true }),
      revive: () => true,
    };
    expect(gateStateOf(minimal, 1000)).toEqual({
      userLevel: 0,
      alive: true,
      faint: false,
      state: null,
      fightType: 0,
      busy: false,
    });
  });
});

// ---------------------------------------------------------------------------
// findAction / findTarget
// ---------------------------------------------------------------------------

describe('engine/command · findAction', () => {
  it('先整行精确（支持 "goto home" 这种多词动作），再按首词', () => {
    const actions: readonly ActionDef[] = [
      { cmd: 'dazuo', name: '打坐', run: noopRun },
      { cmd: 'goto home', name: '回家', run: noopRun },
    ];
    const room = makeRoom('yz/r1', actions);
    expect(findAction(room, 'dazuo', 'dazuo')?.name).toBe('打坐');
    expect(findAction(room, 'goto', 'goto home')?.name).toBe('回家');
    expect(findAction(room, 'goto', 'goto market')).toBeUndefined(); // 整行不匹配、首词也不匹配
    expect(findAction(null, 'dazuo', 'dazuo')).toBeUndefined();
  });
});

describe('engine/command · findTarget', () => {
  const sword = new Item({
    oid: 'i1',
    path: asWorldId('yz/sword', 'test:item'),
    name: '长剑',
  });
  const npc = new Npc({
    oid: 'n1',
    path: asWorldId('pub/xiaoer', 'test:npc'),
    name: '店小二',
    def: { name: '店小二', desc: 'd' } as NpcDef,
    skillRegistry: NO_SKILLS,
  });

  it('按 id / name / path / **path 末段** 任一命中（★ 修正 wushen 只认实例 id 的做法）', () => {
    const room = makeRoom('yz/r1');
    const potion = new Item({ oid: 'i9', path: asWorldId('drug/yao#1', 'test:item'), name: '暴虐丹' });
    room.addItem(sword);
    room.addItem(npc);
    room.addItem(potion);
    const me = makeActor({ environment: room });
    expect(findTarget(me, room, 'i1')).toBe(sword); // 实例 id
    expect(findTarget(me, room, '长剑')).toBe(sword); // 显示名
    expect(findTarget(me, room, 'yz/sword')).toBe(sword); // 模板 path
    expect(findTarget(me, room, 'sword')).toBe(sword); // path 末段
    expect(findTarget(me, room, '店小二')).toBe(npc);
    expect(findTarget(me, room, 'xiaoer')).toBe(npc); // pub/xiaoer 的末段
    expect(findTarget(me, room, 'yao')).toBe(potion); // drug/yao#1 → 去变体后取末段
    expect(findTarget(me, room, '不存在的东西')).toBeUndefined();
  });

  it('先查所在环境，再查自己身上', () => {
    const room = makeRoom('yz/r2');
    const inHand = new Item({ oid: 'i2', path: asWorldId('yz/ring', 'test'), name: '戒指' });
    const me = makeActor({ environment: room, items: [inHand] });
    expect(findTarget(me, room, '戒指')).toBe(inHand);
  });
});

// ---------------------------------------------------------------------------
// dispatch
// ---------------------------------------------------------------------------

describe('engine/command · dispatch 三级查找', () => {
  it('空输入 → empty，且**不**打扰玩家', () => {
    const me = makeActor();
    const t = new CommandTable([]);
    expect(dispatch(t, me, '   ')).toEqual({ kind: 'empty' });
    expect(me.messages).toEqual([]);
  });

  it('未知指令 → 提示"什么？"', () => {
    const me = makeActor();
    expect(dispatch(new CommandTable([]), me, 'xyz')).toEqual({ kind: 'unknown' });
    expect(me.messages).toEqual([COMMAND_MESSAGES.unknown]);
  });

  it('② 全局指令：命中别名并把参数交给 run', () => {
    const seen: (string | undefined)[][] = [];
    const t = new CommandTable([
      entry('action/say', {
        command: 'say',
        run: (_me, ...pars) => {
          seen.push(pars);
        },
      }),
    ]);
    const me = makeActor();
    expect(dispatch(t, me, 'say hello world')).toEqual({ kind: 'executed', via: 'command', id: 'action/say' });
    expect(seen).toEqual([['hello world']]);
  });

  it('★ ① 房间动作优先于同名全局指令（"在这个房间打坐有事发生"）', () => {
    const room = makeRoom('yz/r', [{ cmd: 'dazuo', name: '打坐', run: (me) => me.notify('房间里打坐') }]);
    const t = new CommandTable([entry('action/dazuo', { command: 'dazuo', run: (me) => me.notify('全局打坐') })]);
    const me = makeActor({ environment: room });
    expect(dispatch(t, me, 'dazuo')).toEqual({ kind: 'executed', via: 'action', id: 'dazuo' });
    expect(me.messages).toEqual(['房间里打坐']);
  });

  it('★ 动作返回 false → 继续往下一级（wushen 的 !== false 语义）', () => {
    const room = makeRoom('yz/r', [{ cmd: 'q', name: 'Q', run: () => false }]);
    const t = new CommandTable([entry('action/q', { command: 'q', run: (me) => me.notify('全局处理') })]);
    const me = makeActor({ environment: room });
    expect(dispatch(t, me, 'q')).toEqual({ kind: 'executed', via: 'command', id: 'action/q' });
    expect(me.messages).toEqual(['全局处理']);
  });

  it('三级都返回 false → passthrough，且**不**提示"什么？"', () => {
    const room = makeRoom('yz/r', [{ cmd: 'q', name: 'Q', run: () => false }]);
    const t = new CommandTable([entry('action/q', { command: 'q', run: () => false })]);
    const me = makeActor({ environment: room });
    expect(dispatch(t, me, 'q')).toEqual({ kind: 'passthrough' });
    expect(me.messages).toEqual([]);
  });

  it('③ 目标物件动作：全局没有该指令时，查目标身上的动作', () => {
    const room = makeRoom('yz/r');
    const npc = new Npc({
      oid: 'n1',
      path: asWorldId('pub/xiaoer', 'test:npc'),
      name: '店小二',
      def: {
        name: '店小二',
        desc: 'd',
        actions: [{ cmd: 'ask', name: '打听', run: (me) => me.notify('店小二：要住店吗？') }],
      } as NpcDef,
      skillRegistry: NO_SKILLS,
    });
    room.addItem(npc);
    const me = makeActor({ environment: room });
    expect(dispatch(new CommandTable([]), me, 'ask xiaoer')).toEqual({
      kind: 'executed',
      via: 'target',
      id: 'ask',
    });
    expect(me.messages).toEqual(['店小二：要住店吗？']);
  });

  it('带参数时目标不存在、全局也没有 → unknown', () => {
    const me = makeActor({ environment: makeRoom('yz/r') });
    expect(dispatch(new CommandTable([]), me, 'kill 空气')).toEqual({ kind: 'unknown' });
    expect(me.messages).toEqual([COMMAND_MESSAGES.unknown]);
  });
});

describe('engine/command · dispatch 与闸门', () => {
  it('被闸门拦下 → 提示原因、outcome 带 gate，且指令体**没被执行**', () => {
    let ran = false;
    const t = new CommandTable([
      entry('action/study', {
        command: 'study',
        run: () => {
          ran = true;
        },
      }),
    ]);
    const me = makeActor({ busy: true });
    const out = dispatch(t, me, 'study');
    expect(out).toEqual({
      kind: 'blocked',
      via: 'command',
      id: 'action/study',
      gate: 'busy',
      message: COMMAND_MESSAGES.busy,
    });
    expect(ran).toBe(false);
    expect(me.messages).toEqual([COMMAND_MESSAGES.busy]);
  });

  it('★ 房间动作被拦 = 消费掉这条输入（照抄 wushen：不再让给同名全局指令）', () => {
    const room = makeRoom('yz/r', [{ cmd: 'dazuo', name: '打坐', run: (me) => me.notify('房间打坐') }]);
    const t = new CommandTable([entry('action/dazuo', { command: 'dazuo', run: (me) => me.notify('全局打坐') })]);
    const me = makeActor({ environment: room, busy: true });
    const out = dispatch(t, me, 'dazuo');
    expect(out.kind).toBe('blocked');
    expect(out.kind === 'blocked' && out.via).toBe('action');
    expect(me.messages).toEqual([COMMAND_MESSAGES.busy]); // 全局那句"全局打坐"没出现
  });

  it('allow_busy 显式 true → 忙碌时照常执行', () => {
    const t = new CommandTable([
      entry('action/look', { command: 'look,l', allow_busy: true, run: (me) => me.notify('你看了一眼') }),
    ]);
    const me = makeActor({ busy: true });
    expect(dispatch(t, me, 'l')).toEqual({ kind: 'executed', via: 'command', id: 'action/look' });
    expect(me.messages).toEqual(['你看了一眼']);
  });

  it('★ 忙碌判定走注入时钟（TTL 到了就放行，不需要 sleep）', () => {
    const t = new CommandTable([
      entry('action/x', { command: 'x', run: (me) => me.notify('ok') }),
    ]);
    const busyActor = makeActor({ busy: true });
    expect(dispatch(t, busyActor, 'x', { nowMs: 1000 })).toEqual({
      kind: 'blocked',
      via: 'command',
      id: 'action/x',
      gate: 'busy',
      message: COMMAND_MESSAGES.busy,
    });
    // 换一个不忙的角色模拟"TTL 已过"
    expect(dispatch(t, makeActor(), 'x', { nowMs: 10_000 })).toEqual({
      kind: 'executed',
      via: 'command',
      id: 'action/x',
    });
  });

  it('allow_level：GM 指令对普通玩家不可见（提示同"什么？"）', () => {
    const t = new CommandTable([
      entry('admin/notice', { command: 'notice', allow_level: 6, run: (me) => me.notify('已广播') }),
    ]);
    const plain = makeActor({ userLevel: 0 });
    const out = dispatch(t, plain, 'notice');
    expect(out.kind === 'blocked' && out.gate).toBe('level');
    const gm = makeActor({ userLevel: 6 });
    expect(dispatch(t, gm, 'notice')).toEqual({ kind: 'executed', via: 'command', id: 'admin/notice' });
    expect(gm.messages).toEqual(['已广播']);
  });
});

describe('engine/command · dispatch 登录期（对应 wushen wait_login）', () => {
  const table = (): CommandTable =>
    new CommandTable([
      entry('comm/login', { command: 'login', allow_login: true, run: (me) => me.notify('登录中…') }),
      entry('action/look', { command: 'look,l', run: (me) => me.notify('你看了一眼') }),
    ]);

  it('登录期只放行 allow_login 的指令', () => {
    const me = makeActor();
    expect(dispatch(table(), me, 'login')).toEqual({ kind: 'executed', via: 'command', id: 'comm/login' });
    expect(me.messages).toEqual(['登录中…']);
  });

  it('登录期其它指令一律不放行（含房间动作也不参与 —— 此时还没有环境）', () => {
    const room = makeRoom('yz/r', [{ cmd: 'dazuo', name: '打坐', run: (me) => me.notify('房间打坐') }]);
    const me = makeActor({ environment: room });
    expect(dispatch(table(), me, 'dazuo', { phase: 'login' })).toEqual({ kind: 'unknown' });
    expect(dispatch(table(), me, 'look', { phase: 'login' })).toEqual({ kind: 'unknown' });
    expect(me.messages).toEqual([COMMAND_MESSAGES.unknown, COMMAND_MESSAGES.unknown]);
  });

  it('playing 期（缺省）不受 allow_login 影响', () => {
    const me = makeActor();
    expect(dispatch(table(), me, 'look')).toEqual({ kind: 'executed', via: 'command', id: 'action/look' });
  });
});

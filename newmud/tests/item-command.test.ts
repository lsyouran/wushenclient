/**
 * world/command/obj/{get,drop,give,use} —— 四条物品指令（B 批）
 * ============================================================================
 * 这批断言钉住的是**指令层**的行为（引擎侧的原语语义在 `tests/engine-item.test.ts`）：
 *   ① 三级分发真的能走到它们（`world.commands` 里有这四条）；
 *   ② 失败**逐条对应一句话**（没给参数 / 没有那东西 / 那是活人 / 空手 / 装不下…）；
 *   ③ **闸门声明**真的生效：`get` 没声明 `allow_busy` ⇒ 忙时被拦；
 *      `use` 声明了 ⇒ 忙时照用（这正是 wushen `use.js:3` 那条）；
 *   ④ `give` 的 `on_accept` 准入真的在说话（含内容层那条悬空路径被接上）。
 *
 * ★ 用**真内容**（`@world/index.js`）+ `instantiateWorld()`：
 *   被钉的包括「房间里的丹药能不能捡」「店小二收不收钱」这类**内容事实**，
 *   替身会把这批断言变成"我假装的实现如我所愿"。
 */
import { beforeEach, describe, expect, it } from 'vitest';

// 副作用导入：触发真实内容注册（与 content.test.ts 同一机制）
import '@world/index.js';

import { RecordingOutput } from '../server/engine/character.js';
import { dispatch } from '../server/engine/command.js';
import { DROP_MESSAGES } from '../world/command/obj/drop.js';
import { GET_MESSAGES } from '../world/command/obj/get.js';
import { GIVE_MESSAGES } from '../world/command/obj/give.js';
import { USE_MESSAGES } from '../world/command/obj/use.js';
import { Item } from '../server/engine/item.js';
import { Npc } from '../server/engine/npc.js';
import { Player } from '../server/engine/player.js';
import { Room } from '../server/engine/room.js';
import { emptySkillRegistry } from '../server/engine/skill.js';
import { instantiateWorld } from '../server/engine/world.js';
import type { World } from '../server/engine/world.js';
import type { ItemDef, NpcDef } from '../server/world/defs.js';
import { GIVE_MONEY_KEY, moneyToStr } from '../shared/constants.js';
import { asWorldId } from '../shared/ids.js';

/**
 * ★★ **每条测试各造一份世界**（`instantiateWorld()` 是纯函数式：不写全局、不改注册表，
 *   见 `server/engine/world.ts` 头注）。这不是洁癖 —— 一句 `get 丹药` 会把广场地上的
 *   丹药**真的搬走**，若共用同一份世界，后面再引用同一条内容的测试就会"凭空少一件东西"。
 *   共享单例正好会踩这个坑（第一版就是这么红了两条）。
 */
let world: World;
beforeEach(() => {
  world = instantiateWorld();
});

const WID = (raw: string) => asWorldId(raw, 'item-command.test');

let seq = 0;
const newOid = (): string => world.oidSpace.next();

interface Stage {
  readonly player: Player;
  readonly out: RecordingOutput;
  readonly room: Room;
}

/** 把玩家放进**真实内容**的某个房间（房间里的 NPC / 物品都是真的） */
function enterContentRoom(roomPath: string, maxItems?: number): Stage {
  const room = world.room(roomPath);
  if (room === undefined) throw new Error(`测试用的房间不存在：${roomPath}`);
  const out = new RecordingOutput();
  const player = new Player({
    oid: newOid(),
    path: null,
    name: '阿飞',
    roleId: `feige-${String((seq += 1))}`,
    maxItems,
    output: out,
  });
  room.addItem(player);
  return { player, out, room };
}

/** 一间自造的空房间（用来精确控制容量 / 放自造的物品与 NPC） */
function labRoom(maxItems?: number): Room {
  return new Room({
    oid: newOid(),
    path: WID('yz/lab'),
    name: '试验室',
    desc: '一间只给测试用的房间。',
    maxItems,
  });
}

function put(stage: { player: Player }, item: Item): Item {
  stage.player.addItem(item);
  return item;
}

function makeItem(name: string, def?: ItemDef, count?: number): Item {
  return new Item({ oid: newOid(), path: WID('drug/yao'), name, def, count });
}

/** 一个"来者不拒"的 NPC（用来把 `give` 的通过路径走通） */
function permissiveNpc(def: Partial<NpcDef> = {}): Npc {
  return new Npc({
    oid: newOid(),
    path: WID('pub/xiaoer'),
    name: '好心人',
    def: { name: '好心人', desc: '一个什么都肯收下的人。', on_accept: () => true, ...def },
    skillRegistry: emptySkillRegistry(),
  });
}

const lastMessage = (out: RecordingOutput): string => out.messages.at(-1) ?? '';

// ---------------------------------------------------------------------------
// obj/get
// ---------------------------------------------------------------------------

describe('obj/get —— 捡起房间里的东西', () => {
  it('`get 丹药`：东西从房间进背包，并向房间播报「你捡起丹药。」', () => {
    const { player, out, room } = enterContentRoom('yz/guangchang');
    const pill = room.items.find((x) => x.name === '丹药');
    expect(pill).toBeDefined();

    expect(dispatch(world.commands, player, 'get 丹药')).toEqual({
      kind: 'executed',
      via: 'command',
      id: 'obj/get',
    });
    expect(player.items).toContain(pill);
    expect(room.items).not.toContain(pill);
    expect(out.messages).toEqual(['你捡起丹药。']);
  });

  it('按**模板 id 末段**也能命中（`get yao`）—— 自然语言里玩家常写这个', () => {
    const { player, room } = enterContentRoom('yz/beidajie1');
    const before = room.items.length;
    dispatch(world.commands, player, 'get yao');
    expect(player.items).toHaveLength(1);
    expect(room.items).toHaveLength(before - 1);
  });

  it('没给参数 → 「你要捡什么东西？」', () => {
    const { player, out } = enterContentRoom('yz/guangchang');
    expect(dispatch(world.commands, player, 'get')).toEqual({
      kind: 'executed',
      via: 'command',
      id: 'obj/get',
    });
    expect(out.messages).toEqual([GET_MESSAGES.what]);
  });

  it('地上没有那东西 → 「你要捡起什么东西？」', () => {
    const { player, out } = enterContentRoom('yz/guangchang');
    dispatch(world.commands, player, 'get 不存在的玩意');
    expect(out.messages).toEqual([GET_MESSAGES.notFound]);
  });

  it('★ 活人不用你背（拿 NPC 当目标）', () => {
    const { player, out } = enterContentRoom('yz/guangchang');
    dispatch(world.commands, player, 'get 店小二');
    expect(out.messages).toEqual([GET_MESSAGES.living('店小二')]);
  });

  it('★ 已经在自己身上的东西「捡」不到（`get` 只在**房间**里找）', () => {
    const stage = enterContentRoom('yz/guangchang');
    put(stage, makeItem('随身物'));
    dispatch(world.commands, stage.player, 'get 随身物');
    expect(stage.out.messages).toEqual([GET_MESSAGES.notFound]);
  });

  it('背包满了 → 「你身上东西太多了。」且东西**留在房间**', () => {
    // ★ 用自造房间精确控制"地上有东西 + 我装不下"。
    //   （2026-10-17 审查 **L8**：原先这里还造了真实内容房的 `room` / `player`，
    //    却只在末尾 `void room; void player;` 吃掉 —— 死夹具既误导读者，
    //    又以"顺路进了趟内容房"的方式污染了真实世界的起始房间。）
    const lab = labRoom();
    const out = new RecordingOutput();
    const staged = new Player({ oid: newOid(), path: null, name: '阿飞', roleId: 'feige-lf', maxItems: 0, output: out });
    lab.addItem(staged);
    const rock = makeItem('石头');
    lab.addItem(rock);

    dispatch(world.commands, staged, 'get 石头');
    expect(out.messages).toEqual([GET_MESSAGES.full]);
    expect(lab.items).toContain(rock);
    expect(staged.items).toEqual([]);
  });

  it('`no_get` 的东西捡不起来', () => {
    const lab = labRoom();
    const out = new RecordingOutput();
    const player = new Player({ oid: newOid(), path: null, name: '阿飞', roleId: 'feige-noget', output: out });
    lab.addItem(player);
    const stele = makeItem('石碑', { name: '石碑', no_get: true });
    lab.addItem(stele);

    dispatch(world.commands, player, 'get 石碑');
    expect(out.messages).toEqual([GET_MESSAGES.noGet]);
    expect(lab.items).toContain(stele);
  });

  it('★ `on_get` 返回 false ⇒ **静默**拦住（一个字都不说，wushen 同款）', () => {
    const lab = labRoom();
    const out = new RecordingOutput();
    const player = new Player({ oid: newOid(), path: null, name: '阿飞', roleId: 'feige-onget', output: out });
    lab.addItem(player);
    const trap = makeItem('陷阱', { name: '陷阱', on_get: () => false });
    lab.addItem(trap);

    dispatch(world.commands, player, 'get 陷阱');
    expect(out.messages).toEqual([]);
    expect(lab.items).toContain(trap);
  });

  it('★ 闸门：`get` 没有声明 `allow_busy` ⇒ 忙碌时被拦（kind=blocked / gate=busy）', () => {
    const { player, room } = enterContentRoom('yz/guangchang');
    const T0 = 1_000_000;
    player.setBusy(5_000, T0);
    const outcome = dispatch(world.commands, player, 'get 丹药', { nowMs: T0 + 1 });
    expect(outcome.kind).toBe('blocked');
    if (outcome.kind === 'blocked') expect(outcome.gate).toBe('busy');
    expect(player.items).toEqual([]);
    void room;
  });
});

// ---------------------------------------------------------------------------
// obj/drop
// ---------------------------------------------------------------------------

describe('obj/drop —— 丢到房间里', () => {
  it('`drop 丹药`：东西从背包落回房间，并播报「你丢掉丹药。」', () => {
    const { player, out, room } = enterContentRoom('yz/guangchang');
    const pill = put({ player }, makeItem('信物'));

    expect(dispatch(world.commands, player, 'drop 信物')).toEqual({
      kind: 'executed',
      via: 'command',
      id: 'obj/drop',
    });
    expect(room.items).toContain(pill);
    expect(player.items).not.toContain(pill);
    expect(out.messages).toEqual(['你丢掉信物。']);
  });

  it('没给参数 → 「你要丢掉什么东西？」', () => {
    const { player, out } = enterContentRoom('yz/guangchang');
    dispatch(world.commands, player, 'drop');
    expect(out.messages).toEqual([DROP_MESSAGES.what]);
  });

  it('★ 只丢**身上**的东西：丢房间里的东西会说"你要丢掉什么"', () => {
    const { player, out } = enterContentRoom('yz/guangchang');
    dispatch(world.commands, player, 'drop 丹药'); // 丹药在地上，不在身上
    expect(out.messages).toEqual([DROP_MESSAGES.what]);
  });

  it('`no_drop` 的东西丢不掉', () => {
    const lab = labRoom();
    const out = new RecordingOutput();
    const player = new Player({ oid: newOid(), path: null, name: '阿飞', roleId: 'feige-nodrop', output: out });
    lab.addItem(player);
    const bond = makeItem('绑定物', { name: '绑定物', no_drop: true });
    player.addItem(bond);

    dispatch(world.commands, player, 'drop 绑定物');
    expect(out.messages).toEqual([DROP_MESSAGES.noDrop]);
    expect(player.items).toContain(bond);
  });

  it('房间满了 → 「这里东西太多了。」且东西**还在身上**', () => {
    const lab = labRoom(1); // 容量 1：被玩家占掉
    const out = new RecordingOutput();
    const player = new Player({ oid: newOid(), path: null, name: '阿飞', roleId: 'feige-roomfull', output: out });
    lab.addItem(player);
    const junk = makeItem('杂物');
    player.addItem(junk);

    dispatch(world.commands, player, 'drop 杂物');
    expect(out.messages).toEqual([DROP_MESSAGES.roomFull]);
    expect(player.items).toContain(junk);
  });

  it('★ 整叠丢（本批不做拆分）：一叠 3 个会一起落地', () => {
    const { player, room } = enterContentRoom('yz/guangchang');
    const stack = put({ player }, makeItem('铜钱串', undefined, 3));
    dispatch(world.commands, player, 'drop 铜钱串');
    expect(room.items).toContain(stack);
    expect(stack.count).toBe(3);
    expect(player.items).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// obj/give
// ---------------------------------------------------------------------------

describe('obj/give —— 给同房间的人', () => {
  it('★ 接上了内容里那条**悬空路径**：`give 店小二 1000 money` 真的成交', () => {
    const { player, out } = enterContentRoom('yz/guangchang');
    player.money = 1000;

    expect(dispatch(world.commands, player, 'give 店小二 1000 money')).toEqual({
      kind: 'executed',
      via: 'command',
      id: 'obj/give',
    });
    expect(player.money).toBe(0);
    // ★ 26 册 §57 订正：原先这里还有一句 `on_accept` 里的
    //   「店小二收了钱，引你往人字号客房走去。」—— 那是**谓词抢跑**：
    //   它说"收了"的时候引擎还没扣钱，扣不动就会出现两句自相矛盾的话。
    //   现在"成没成"只由 `give` 播报（给钱用 `$n` 指向收钱的人）。
    expect(out.messages).toEqual([`你给了店小二${moneyToStr(1000)}。`]);
  });

  it('★★ 钱不够但"给的数目"够 ⇒ **只有一句**没钱，不许先说"收了钱"（26 册 §57）', () => {
    const { player, out } = enterContentRoom('yz/guangchang');
    // 真机反馈的原样：点「人字号客房」发的是 `give 店小二 1000 money`，
    // 而玩家身上一文钱都没有 ⇒ `on_accept` 看到 count=1000 够，放行；
    // 引擎去扣时失败。旧实现在这里先说"店小二收了钱…"再说"你没有那么多的钱…"。
    player.money = 0;

    dispatch(world.commands, player, 'give 店小二 1000 money');
    expect(player.money).toBe(0);
    expect(out.messages).toEqual([GIVE_MESSAGES.noMoney('店小二')]);
    // 反向断言：那句"抢先宣布成功"的话一个字都不许出现
    expect(out.messages.join('\n')).not.toContain('收了钱');
  });

  it('★ 钱不够时店小二**当场拒收**，且一分钱都不动（`on_accept` 是准入判据）', () => {
    const { player, out } = enterContentRoom('yz/guangchang');
    player.money = 999;

    dispatch(world.commands, player, 'give 店小二 999 money');
    expect(player.money).toBe(999);
    // 两句：先由 `on_accept` 说明**为什么**（内容层自己 notify），
    // 再由 `give` 补一句笼统的拒收 —— 顺序与"收下时"的两句对称。
    expect(out.messages).toEqual([
      '店小二陪笑道：住店要1000文钱，客官。',
      GIVE_MESSAGES.refuseMoney('店小二'),
    ]);
  });

  it('店小二不收**东西**（只收钱；卖东西走商店的 sell）', () => {
    const { player, out } = enterContentRoom('yz/guangchang');
    put({ player }, makeItem('丹药'));
    dispatch(world.commands, player, 'give 店小二 丹药');
    expect(out.messages).toEqual([GIVE_MESSAGES.refuse('店小二')]);
    expect(player.items).toHaveLength(1);
  });

  it('给的对象不存在 → 「你要给谁东西？」', () => {
    const { player, out } = enterContentRoom('yz/guangchang');
    dispatch(world.commands, player, 'give 不存在的人 丹药');
    expect(out.messages).toEqual([GIVE_MESSAGES.who]);
  });

  it('★ 给**不在身上**的东西 → 「你要给谁什么东西？」', () => {
    const { player, out } = enterContentRoom('yz/guangchang');
    dispatch(world.commands, player, 'give 店小二 不存在的玩意');
    expect(out.messages).toEqual([GIVE_MESSAGES.what]);
  });

  it('写 `给 0 个` 会提示用法（wushen 在这里是**静默**的，本项目给一句话）', () => {
    const { player, out } = enterContentRoom('yz/guangchang');
    put({ player }, makeItem('丹药', undefined, 3));
    dispatch(world.commands, player, 'give 店小二 0 丹药');
    expect(out.messages).toEqual([GIVE_MESSAGES.what]);
  });

  it('★ 给东西：`on_accept` 点头 ⇒ 从给出方扣掉并播报', () => {
    const lab = labRoom();
    const out = new RecordingOutput();
    const player = new Player({ oid: newOid(), path: null, name: '阿飞', roleId: 'feige-give1', output: out });
    lab.addItem(player);
    lab.addItem(permissiveNpc());
    const gift = makeItem('礼物');
    player.addItem(gift);

    dispatch(world.commands, player, 'give 好心人 礼物');
    expect(player.items).toEqual([]);
    expect(out.messages).toEqual(['你把礼物递给了好心人。']);
  });

  it('★ 个数参数真的生效（扣 2 个，剩 1 个）—— 不需要拆分物品，见 `spendItem` 的注释', () => {
    const lab = labRoom();
    const out = new RecordingOutput();
    const player = new Player({ oid: newOid(), path: null, name: '阿飞', roleId: 'feige-give2', output: out });
    lab.addItem(player);
    lab.addItem(permissiveNpc());
    const stack = makeItem('丹药', undefined, 3);
    player.addItem(stack);

    dispatch(world.commands, player, 'give 好心人 2 丹药');
    expect(stack.count).toBe(1);
    expect(player.items).toEqual([stack]);
  });

  it('数量不够 → 「你没有那么多的X。」（`on_accept` 已点头，扣减失败）', () => {
    const lab = labRoom();
    const out = new RecordingOutput();
    const player = new Player({ oid: newOid(), path: null, name: '阿飞', roleId: 'feige-give3', output: out });
    lab.addItem(player);
    lab.addItem(permissiveNpc());
    const stack = makeItem('丹药', undefined, 2);
    player.addItem(stack);

    dispatch(world.commands, player, 'give 好心人 5 丹药');
    expect(stack.count).toBe(2);
    expect(out.messages).toEqual([GIVE_MESSAGES.notEnough('丹药')]);
  });

  it('给钱时钱不够 → 「你身上没有那么多的钱给X。」', () => {
    const lab = labRoom();
    const out = new RecordingOutput();
    const player = new Player({ oid: newOid(), path: null, name: '阿飞', roleId: 'feige-give4', output: out });
    player.money = 5;
    lab.addItem(player);
    lab.addItem(permissiveNpc());

    dispatch(world.commands, player, `give 好心人 100 ${GIVE_MONEY_KEY}`);
    expect(player.money).toBe(5);
    expect(out.messages).toEqual([GIVE_MESSAGES.noMoney('好心人')]);
  });

  it('没写数目 → 「你要给X多少钱？」', () => {
    const { player, out } = enterContentRoom('yz/guangchang');
    dispatch(world.commands, player, `give 店小二 ${GIVE_MONEY_KEY}`);
    expect(out.messages).toEqual([GIVE_MESSAGES.amountWho('店小二')]);
  });
});

// ---------------------------------------------------------------------------
// obj/use
// ---------------------------------------------------------------------------

describe('obj/use —— 使用身上的东西', () => {
  it('★ `use 丹药`：跑到内容写的 `on_use`，并且**消耗掉**一个', () => {
    const { player, out } = enterContentRoom('yz/guangchang');
    put({ player }, makeItem('丹药', { name: '丹药', on_use: (me) => me.notify('你服下丹药，气息一畅。') }));

    expect(dispatch(world.commands, player, 'use 丹药')).toEqual({
      kind: 'executed',
      via: 'command',
      id: 'obj/use',
    });
    expect(out.messages).toEqual(['你服下丹药，气息一畅。']);
    expect(player.items).toEqual([]); // 消耗掉了（count 1 → 0 → 销毁）
  });

  it('★ 真内容的 `drug/yao` 那条 `on_use` 第一次真的跑起来了', () => {
    const { player, out, room } = enterContentRoom('yz/guangchang');
    // 先从地上捡起来（走 get），再用（走 use）——闭环
    dispatch(world.commands, player, 'get 丹药');
    expect(player.items).toHaveLength(1);
    dispatch(world.commands, player, 'use 丹药');
    expect(player.items).toEqual([]);
    expect(lastMessage(out)).toContain('暖流');
    expect(room.items.some((x) => x.name === '丹药')).toBe(false);
  });

  it('身上没有那东西 → 「你身上没有这个东西。」', () => {
    const { player, out } = enterContentRoom('yz/guangchang');
    dispatch(world.commands, player, 'use 不存在的玩意');
    expect(out.messages).toEqual([USE_MESSAGES.notFound]);
  });

  it('★ 没有 `on_use` 的东西不能用（"能不能用"的判据就是钩子在不在）', () => {
    const lab = labRoom();
    const out = new RecordingOutput();
    const player = new Player({ oid: newOid(), path: null, name: '阿飞', roleId: 'feige-use1', output: out });
    lab.addItem(player);
    const rock = makeItem('石头');
    player.addItem(rock);

    dispatch(world.commands, player, 'use 石头');
    expect(out.messages).toEqual([USE_MESSAGES.noHook]);
    expect(player.items).toContain(rock);
  });

  it('`no_consume` 的东西用后**还在**', () => {
    const lab = labRoom();
    const out = new RecordingOutput();
    const player = new Player({ oid: newOid(), path: null, name: '阿飞', roleId: 'feige-use2', output: out });
    lab.addItem(player);
    const tool = makeItem('令牌', { name: '令牌', no_consume: true, on_use: () => undefined });
    player.addItem(tool);

    dispatch(world.commands, player, 'use 令牌');
    expect(player.items).toContain(tool);
  });

  it('★ `on_use` 返回 false ⇒ 静默不消耗（要拒绝并说明理由，钩子自己 notify）', () => {
    const lab = labRoom();
    const out = new RecordingOutput();
    const player = new Player({ oid: newOid(), path: null, name: '阿飞', roleId: 'feige-use3', output: out });
    lab.addItem(player);
    const sealed = makeItem('封印丹', { name: '封印丹', on_use: () => false });
    player.addItem(sealed);

    dispatch(world.commands, player, 'use 封印丹');
    expect(out.messages).toEqual([]);
    expect(player.items).toContain(sealed);
  });

  it('★ 闸门：`use` 声明了 `allow_busy` / `allow_die` / `allow_faint` ⇒ 忙碌时照用', () => {
    const lab = labRoom();
    const out = new RecordingOutput();
    const player = new Player({ oid: newOid(), path: null, name: '阿飞', roleId: 'feige-use4', output: out });
    lab.addItem(player);
    player.addItem(makeItem('丹药', { name: '丹药', on_use: (me) => me.notify('生效了。') }));

    const T0 = 2_000_000;
    player.setBusy(5_000, T0);
    const outcome = dispatch(world.commands, player, 'use 丹药', { nowMs: T0 + 1 });
    expect(outcome.kind).toBe('executed');
    expect(out.messages).toEqual(['生效了。']);
  });
});

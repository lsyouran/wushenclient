/**
 * server/engine/world.ts —— 从注册表实例化世界
 * ============================================================================
 * 这里同时钉住 world.ts 顶部声明的三点与 wushen 工厂的差异：
 *   1. 不执行内容脚本体（只读数据）
 *   2. 模板→实例是"复制字段"，**不是**原型委托
 *      → 「同一 def 生成的两个实例互不影响」这一条（wushen 两只怪共用 prop 的根治）
 *   3. 出口在实例化时解析成对象引用（运行时不再字符串查找）
 */
import { describe, expect, it } from 'vitest';

// 副作用导入：触发真实内容注册（与 content.test.ts 同一机制）
import '@world/index.js';

import { Item } from '../server/engine/item.js';
import { Npc } from '../server/engine/npc.js';
import { OidSpace } from '../server/engine/oid.js';
import { Player } from '../server/engine/player.js';
import { getProp, setProp } from '../server/engine/props.js';
import { getDef } from '../server/engine/registry.js';
import { RecordingOutput } from '../server/engine/character.js';
import { dispatch } from '../server/engine/command.js';
import { instantiateWorld } from '../server/engine/world.js';
import { describeWorld } from '../server/bootstrap.js';
import type { ItemDef, NpcDef } from '../server/world/defs.js';
import { PROP } from '../shared/constants.js';
import { asWorldId } from '../shared/ids.js';

const world = instantiateWorld();

describe('engine/world · 真实内容的实例化统计', () => {
  it('各计数与注册表一致', () => {
    // 内容：2 房间 / 1 NPC 实例 / 2 物品实例 / 1 区域 / 2 出口
    expect(world.stats.rooms).toBe(2);
    expect(world.stats.npcs).toBe(1);
    expect(world.stats.items).toBe(2); // drug/yao + drug/yao#1 各 1 个
    expect(world.stats.areas).toBe(1);
    expect(world.stats.exits).toBe(2); // 广场↔北大街 两条有向出口
    expect(world.stats.oidsIssued).toBe(5); // 2 房间 + 1 NPC + 2 物品
    expect(world.stats.skills).toBe(3); // base/force + base/sword + wd/taijijian
  });

  it('公式摘要被带进统计（启动日志能一眼看见生效参数）', () => {
    expect(world.stats.formula).toContain('hpPerCon=5');
  });

  it('启动日志一行统计含指令数', () => {
    expect(describeWorld(world.stats)).toContain('指令 14（别名 20）');
  });

  it('起始房间取区域 first', () => {
    expect(world.startRoom?.path).toBe('yz/guangchang');
  });
});

describe('engine/world · 出口解析成实例引用', () => {
  it('定义层写字符串，运行时拿到的是对象', () => {
    const gc = world.room('yz/guangchang');
    const bd = world.room('yz/beidajie1');
    expect(gc?.exitTo('north')).toBe(bd);
    expect(bd?.exitTo('south')).toBe(gc);
    expect(gc?.exitCount()).toBe(1);
  });

  it('没有的方向返回 undefined', () => {
    expect(world.room('yz/guangchang')?.exitTo('south')).toBeUndefined();
  });
});

describe('engine/world · 内容物落位', () => {
  it('NPC 被放进房间，且能反查到房间', () => {
    const gc = world.room('yz/guangchang');
    const npc = world.npcsOf('pub/xiaoer')[0];
    if (npc === undefined) throw new Error('测试前置失败：pub/xiaoer 未实例化');
    expect(npc.environment).toBe(gc);
    expect(npc.room).toBe(gc);
    expect(gc?.hasItem(npc)).toBe(true);
  });

  it('物品被放进房间', () => {
    const gc = world.room('yz/guangchang');
    expect(gc?.items.some((x) => x.kind === 'item')).toBe(true);
  });

  it('模板单例（房间按 path 索引）与实例（NPC/物品按 oid 索引）分得清', () => {
    expect(world.npcsOf('pub/xiaoer')).toHaveLength(1);
    expect(world.itemsOf('drug/yao')).toHaveLength(1);
    expect(world.itemsOf('drug/yao#1')).toHaveLength(1);
  });

  it('查不到时返回 undefined / 空数组（而不是抛错）', () => {
    expect(world.room('no/such')).toBeUndefined();
    expect(world.npc('zzzzzzzzzz')).toBeUndefined();
    expect(world.item('zzzzzzzzzz')).toBeUndefined();
    expect(world.npcsOf('no/such')).toEqual([]);
    expect(world.itemsOf('no/such')).toEqual([]);
  });
});

describe('engine/world · NPC 从 def 取属性 / 技能（★ docs/27 D9：技能 id 被保留）', () => {
  it('技能表完整保留「技能 id + 等级 + 装配槽」，不再折算成"某槽多少级"的裸 map', () => {
    const npc = world.npcsOf('pub/xiaoer')[0];
    if (npc === undefined) throw new Error('测试前置失败：pub/xiaoer 未实例化');

    expect(npc.name).toBe('店小二');
    expect(npc.hp).toBe(150);
    expect(npc.maxMp).toBe(150);

    // ★ D9：能说出"它练的是太极剑法、50 级"——旧实现把技能 id 丢了，只说得出"某个槽 50 级"
    expect(npc.skills.levelOf('wd/taijijian')).toBe(50);
    // ★ 装配槽：太极剑法是**剑法**，只能装 `sword`（docs/27 §9 P2 修掉的正是"装到 force"）
    expect(npc.skills.enabledOf('sword')).toBe('wd/taijijian');
    expect(npc.skills.enabledOf('force')).toBeUndefined();
    // 基本内功靠 `slot` 占 force 槽（不是靠 enabled —— 基本技能不装配）
    expect(npc.skills.levelOf('base/force')).toBe(30);
    expect(npc.skillLevel('force')).toBe(30);
    expect(npc.onMaster).toBe(false);
  });

  it('内功系数从**占 force 槽的技能模板**上取（不再是"force 槽等级 × 系数"的近似）', () => {
    const npc = world.npcsOf('pub/xiaoer')[0];
    if (npc === undefined) throw new Error('测试前置失败：pub/xiaoer 未实例化');
    // base/force 没声明 force_rad（wushen 的 base/force 也没有）→ 取兜底 0.1
    expect(npc.forceRad).toBe(0.1);
    // 而 maxHp 是**公式 + 技能属性**共同算出来的（这条断言把整条链钉住）：
    //   con*5                        = 27*5                     = 135
    //   + maxMp * forceRad           = 150 * 0.1               =  15
    //   + prop(con) * con            = 3 * 27（基本内功 30 级：con += 30/10）
    //                                                          = 81
    //   → int(135 + 15 + 81) = 231
    // ★ 注意 `prop(con) * con` **不除 10** —— 照抄 wushen `user.js:3`（29 册 §29.4 偏离① 已闭合）。
    //   （同一个 `prop(con)` 在 `defense` 式里是 `/10` —— 原作如此，别顺手统一，见 29 册 §29.2。）
    // ★ 这条同时证明 `prop(con)` **有真实生产者**：基本内功 30 级就给了 con +3，
    //   早期"内容层没有 con 生产者 ⇒ 影响为零"的说法已不成立（2026-10-14 复查订正）。
    // 于是 def 里的 `hp: 150`（初始血量）小于上限，不会被 setHp() 截断。
    expect(npc.maxHp).toBe(231);
  });
});

describe('engine/world · ★ 同一模板的两个实例互不影响（原型克隆坑的根治）', () => {
  it('props / temp / skills 存储不共享，改动彼此隔离', () => {
    const def = getDef<NpcDef>('npc', 'pub/xiaoer');
    if (def === undefined) throw new Error('测试前置失败：pub/xiaoer 未注册');

    const make = (oid: string) =>
      new Npc({
        oid,
        path: asWorldId('pub/xiaoer', 'engine-world.test'),
        name: def.name,
        def,
        skillRegistry: world.skillRegistry,
      });

    const a = make('aaaaaaaaaa');
    const b = make('bbbbbbbbbb');

    // 存储层各自一份（而不是 Object.create 出来的同一份）
    expect(a.props).not.toBe(b.props);
    expect(a.temp).not.toBe(b.temp);
    expect(a.skills).not.toBe(b.skills);

    // 改 a 的核心属性 → b 不受影响
    setProp(a, PROP.attack, 999); // wushen 'gj'
    expect(getProp(a, PROP.attack)).toBe(999);
    // ★ b 的攻击 = 25 不是 0：这是 `wd/taijijian` 装上 sword 槽之后的 ② 档属性
    //   （`enableProp` → `gj: trunc(50/2) = 25`）。**两个实例各持一份技能簿**，
    //   所以 a 被改写都不会串到 b —— 这正是本用例要证明的东西。
    expect(getProp(b, PROP.attack)).toBe(25);

    a.recount();
    expect(a.derived.attack).toBeGreaterThan(b.derived.attack); // 1019 vs 45

    // temp 也隔离
    a.temp.setTemp('x', 1);
    expect(b.temp.queryTemp('x')).toBeUndefined();

    // 位置独立（都没进任何容器）
    expect(a.environment).toBeNull();
    expect(b.environment).toBeNull();
  });
});

describe('engine/world · 物品实例字段', () => {
  it('带上 def 的字段（基对象 + 变体覆盖）', () => {
    const item = world.itemsOf('drug/yao#1')[0];
    expect(item).toBeInstanceOf(Item);
    expect(item?.name).toBe('暴虐丹');
    expect(item?.grade).toBe(1); // 继承基对象 drug/yao
    expect(item?.value).toBe(800); // 变体覆盖
    expect(item?.combined).toBe(true);
    expect(item?.count).toBe(1);
  });

  it('★ 内容层第一个 prop 声明确实在 def 上（G3 由 SKIP 转实检的前提）', () => {
    const def = getDef<ItemDef>('item', 'drug/yao#1');
    expect(def?.prop).toEqual({ gj: 20, gjsd_per: -20 });
  });

  it('Item 不是 PropHolder —— def 的 prop 尚未挂载到实例（消费者属装备/服用批次）', () => {
    const item = world.itemsOf('drug/yao#1')[0];
    expect(item).toBeInstanceOf(Item);
    // 显式记录当前设计：物品的属性加成由"穿戴/服用"加到持有者身上，而非物品自身
    expect('props' in (item as object)).toBe(false);
  });
});

describe('engine/world · id 空间可复用（读档恢复场景）', () => {
  it('复用同一 OidSpace → 第二次实例化的 id 不与第一次重复', () => {
    const shared = new OidSpace();
    const first = instantiateWorld({ oidSpace: shared });
    const second = instantiateWorld({ oidSpace: shared });

    expect(first.stats.oidsIssued).toBe(5);
    expect(second.stats.oidsIssued).toBe(10); // 同一个空间已累计 10

    const firstOids = new Set([...first.rooms.values()].map((r) => r.oid));
    for (const r of second.rooms.values()) expect(firstOids.has(r.oid)).toBe(false);
  });
});

describe('engine/world · 指令表 + 真实内容的三级分发（全链路）', () => {
  it('指令表被建进世界（别名 → 条目）', () => {
    // 11 条：action/{look,select} + move/go + chat/{say,shout,tell} + info/score
    //         + obj/{get,drop,give,use}（B 批四条物品指令）
    // 17 个别名：look,l / select,command / go / say / **chat**,shout,yell / tell,whisper / score,attr
    //         + get / drop / give / use（各一个，与 wushen 的 `this.command` 同名，未起短写）
    //   ↑ `chat` 是 wushen 的原词（`world/cmd/channel/chat.js`），
    //     也是前端「世界」页签产出的命令名（26 册 §24.3）
    expect(world.stats.commands).toBe(14);
    expect(world.stats.commandAliases).toBe(20);
    expect(world.commands.lookup('look')?.id).toBe('action/look');
    expect(world.commands.lookup('l')?.id).toBe('action/look');
    expect(world.commands.lookup('select')?.id).toBe('action/select');
    // ★ 主名与别名必须落到**同一条**条目：它们只是敲法不同，不是两套东西
    const world_ = world.commands.lookup('chat');
    expect(world_?.id).toBe('chat/shout');
    expect(world.commands.lookup('shout')?.id).toBe(world_?.id);
    expect(world.commands.lookup('yell')?.id).toBe(world_?.id);
    expect(world.commands.lookup('nope')).toBeUndefined();
  });

  /** 造一个"玩家"（真实 def + 内存输出通道），放进真实房间 */
  const spawn = (roomPath: string, oid: string): { actor: Npc; out: RecordingOutput } => {
    const room = world.room(roomPath);
    if (room === undefined) throw new Error(`测试前置失败：房间 ${roomPath} 不存在`);
    const def = getDef<NpcDef>('npc', 'pub/xiaoer');
    if (def === undefined) throw new Error('测试前置失败：pub/xiaoer 未注册');
    const out = new RecordingOutput();
    const actor = new Npc({
      oid,
      path: asWorldId('pub/xiaoer', 'engine-world.test:actor'),
      name: def.name,
      def,
      output: out,
      skillRegistry: world.skillRegistry,
    });
    actor.moveTo(room);
    return { actor, out };
  };

  it('★ defineCommand → 注册表 → CommandTable → dispatch → run 全链路（look）', () => {
    const { actor, out } = spawn('yz/guangchang', 'aaaaaaaaaa');
    expect(dispatch(world.commands, actor, 'look')).toEqual({
      kind: 'executed',
      via: 'command',
      id: 'action/look',
    });
    const printed = out.messages.join('\n');
    expect(printed).toContain('【扬州城-中央广场】'); // 房间名来自真实 Room
    expect(printed).toContain('这里'); // 内容物清单
  });

  it('别名 l 同样可用', () => {
    const { actor } = spawn('yz/guangchang', 'bbbbbbbbbb');
    expect(dispatch(world.commands, actor, 'l').kind).toBe('executed');
  });

  it('★ 房间动作（真实内容 dazuo）走三级的第一级', () => {
    const { actor, out } = spawn('yz/guangchang', 'cccccccccc');
    expect(dispatch(world.commands, actor, 'dazuo')).toEqual({
      kind: 'executed',
      via: 'action',
      id: 'dazuo',
    });
    expect(out.messages.join('\n')).toContain('盘膝坐下');
  });

  it('没有环境动作的房间里，未知指令仍然是"什么？"', () => {
    const { actor, out } = spawn('yz/beidajie1', 'dddddddddd');
    expect(dispatch(world.commands, actor, 'dazuo')).toEqual({ kind: 'unknown' });
    expect(out.messages).toEqual(['什么？']);
  });

  it('★ info/score 打出属性三档（合计 / 先天 / 后天）', () => {
    const { actor, out } = spawn('yz/guangchang', 'ffffffffff');
    expect(dispatch(world.commands, actor, 'score')).toEqual({
      kind: 'executed',
      via: 'command',
      id: 'info/score',
    });
    const printed = out.messages.join('\n');
    expect(printed).toContain('【属性】');
    // 无加成三维：只报合计
    expect(printed).toContain('臂力：20');
    expect(printed).toContain('身法：20');
    expect(printed).toContain('悟性：20');
    // 店小二根骨 27 + 基本内功的 3 点根骨加成 ⇒ 展开三档
    expect(printed).toContain('根骨：30（先天 27 + 后天 3）');

    // 再加 5 点臂力加成；别名 attr 与主名 score 落到同一条
    setProp(actor, PROP.strengthBonus, 5);
    out.messages.length = 0;
    expect(dispatch(world.commands, actor, 'attr').kind).toBe('executed');
    expect(out.messages.join('\n')).toContain('臂力：25（先天 20 + 后天 5）');
  });

  it('真实 NPC 的 ask 动作（三级里的第三级：目标物件动作）', () => {
    const { actor, out } = spawn('yz/guangchang', 'eeeeeeeeee');
    // 广场里有一个真实店小二实例；全局没有 ask 指令 → 查目标身上的动作
    expect(dispatch(world.commands, actor, 'ask 店小二')).toEqual({
      kind: 'executed',
      via: 'target',
      id: 'ask',
    });
    // 店小二的 ask 动作是 `me.sendCommands('give pub/xiaoer 1000 money', '人字号客房')`
    expect(out.commands).toEqual([['give pub/xiaoer 1000 money', '人字号客房']]);
  });
});

// ---------------------------------------------------------------------------
// ★ T4 · 对象销毁要**离开世界**（不只是离开容器）—— 2026-10-17 审查 **M5**
// ---------------------------------------------------------------------------
//
// ★ 26 册 §54.1 声明 T4 已清偿，实测 `world.npcs` / `world.items` 只增不减：
//   NPC 死了只 `moveTo(null)`（还留在索引里，`world.npc(oid)` 能取回一个"已经
//   消散"的人），物品用光只 `removeItem`（同理）。⇒ 这两条就是那个"已清偿"的实证。

describe('★ T4 · 对象销毁要离开世界（不只是离开容器）', () => {
  it('NPC 死亡消散：`world.npc(oid)` 取不回来', () => {
    // ★ 用**独立**的世界实例：本文件模块级那个 `world` 被上面十几条用例共用，
    //   在这里弄死一个 NPC / 用光一件物品，会让别的用例的结果跟着漂移。
    const w = instantiateWorld();
    const npc = [...w.npcs.values()][0];
    if (npc === undefined) throw new Error('世界里没有 NPC');
    const path = npc.path;
    if (path === null) throw new Error('NPC 没有模板路径（不该发生）');
    const oid = npc.id;
    const before = w.npcs.size;
    expect(w.npc(oid)).toBe(npc);

    npc.die();

    // ★ 判据：不摘索引的话这里还能取回"已经消散"的 NPC
    expect(w.npc(oid)).toBeUndefined();
    expect(w.npcs.has(oid)).toBe(false);
    expect(w.npcsOf(path)).not.toContain(npc);
    expect(w.npcs.size).toBe(before - 1);
    // ★★ R4（2026-10-17 审查）：光钉"摘索引"**不够** —— T4 = "摘索引 **+ 释放 oid**"。删掉
    //   `world.ts#forget` 里的 `oidSpace.release(obj.id)`，光靠上面的索引断言**照样绿**。
    //   ★ 用 `has(oid)` 而**不是** `size - 1`：NPC 死亡会**掉落铸新物品**（各占一个 oid），
    //     `size` 净变化不固定 —— 判据必须落在"**这一个** oid 还在不在"上。
    expect(w.oidSpace.has(oid)).toBe(false);
  });

  it('物品被用光：`world.item(oid)` 取不回来', () => {
    const w = instantiateWorld();
    const item = [...w.items.values()][0];
    if (item === undefined) throw new Error('世界里没有物品');
    const path = item.path;
    if (path === null) throw new Error('物品没有模板路径（不该发生）');
    const oid = item.id;
    const before = w.items.size;
    expect(w.item(oid)).toBe(item);

    const p = new Player({ oid: 'p-t4', path: null, name: '消耗甲', roleId: 'r-t4' });
    item.moveTo(p);
    expect(p.spendItem(item, item.count)).toBe(true); // 正好用完 ⇒ 归零销毁

    // ★ 判据：只 `removeItem` 的话这里还能取回"已经不存在"的物品
    expect(item.isDepleted).toBe(true);
    expect(w.item(oid)).toBeUndefined();
    expect(w.itemsOf(path)).not.toContain(item);
    expect(w.items.size).toBe(before - 1);
    // ★ R4：把"释放 oid"这半也钉住（`has` 口径与 NPC 用例一致）
    expect(w.oidSpace.has(oid)).toBe(false);
  });
});

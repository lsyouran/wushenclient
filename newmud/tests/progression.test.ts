/**
 * tests/progression.test.ts —— 成长闭环：**打怪 → 经验/潜能 → 技能上限 → 练技能**
 * ============================================================================
 * 这批断言钉住的是 26 册 §56 引入的四条链，每一条都要求"从真实入口进、看真实结果"：
 *
 *   ① `Character.addExp`（唯一增加入口）：累加 + 播报 + 拒收负数。
 *   ② `NpcDef.exp/pot` → `Npc.afterDeath` → **击杀者**拿到奖励（不是 NPC 自己涨）。
 *   ③ 经验抬高 `skillLimit()`，而 `skillLimit()` 是 `SkillBook.addExp` 的**封顶** ——
 *      于是"经验决定技能等级上限"是引擎保证的，不是某个调用方的自觉。
 *   ④ `practice`：潜能 1:1 换技能经验，受上限与"基本功火候"约束。
 *
 * ★★ 防假绿的两处设计（26 册铁律 8）：
 *   - 上限那条用**哨兵**：先让角色经验 = 0（上限 10）确认加不动，再把经验拨到 100000
 *     确认同一份技能经验突然能动 —— 不是"从没变过的初值出发"。
 *   - 击杀奖励用**两个 NPC 对照**：给经验的那只（木人桩）与不给的那只（店小二），
 *     免得"不管怎样 exp 都涨"这种错法蒙混过关。
 */
import { describe, expect, it, beforeEach } from 'vitest';

// 副作用导入：触发真实内容注册（与 content.test.ts 同一机制）
import '@world/index.js';

import { RecordingOutput } from '../server/engine/character.js';
import { Npc } from '../server/engine/npc.js';
import { Player } from '../server/engine/player.js';
import { getDef } from '../server/engine/registry.js';
import { Scheduler } from '../server/engine/scheduler.js';
import { instantiateWorld } from '../server/engine/world.js';
import type { World } from '../server/engine/world.js';
import type { NpcDef } from '../server/world/defs.js';
import { asWorldId } from '../shared/ids.js';
import { dispatch } from '../server/engine/command.js';

let world: World;
let oidSeq = 0;
/** 世界时钟（假时钟）：重生要验证差一毫秒不刷，真时钟做不到可复现 */
let clock = 0;

beforeEach(() => {
  // ★ 每个用例一个**全新的世界**：木人桩会被打死并重生，共享单例会让用例互相污染。
  clock = 1_000_000;
  world = instantiateWorld({ scheduler: new Scheduler({ now: () => clock }) });
  oidSeq = 0;
});

/** 造一个玩家并放进指定房间 */
function makePlayer(roomPath: string): { player: Player; out: RecordingOutput } {
  const room = world.room(roomPath);
  if (room === undefined) throw new Error(`测试前置失败：房间 ${roomPath} 不存在`);
  oidSeq += 1;
  const out = new RecordingOutput();
  const player = new Player({
    roleId: `tester-${String(oidSeq)}`,
    oid: `p${String(oidSeq).padStart(9, '0')}`,
    path: null,
    name: '测试者',
    skillRegistry: world.skillRegistry,
    output: out,
    scheduler: world.scheduler,
    rand: () => 0,
  });
  player.moveTo(room);
  return { player, out };
}

/** 取世界里的木人桩（可打死的练功靶子） */
function woodDummy(): Npc {
  const npc = world.npcsOf('pub/muren')[0];
  if (npc === undefined) throw new Error('测试前置失败：pub/muren 未实例化');
  return npc;
}

// ---------------------------------------------------------------------------
// ① addExp：唯一的增加入口
// ---------------------------------------------------------------------------

describe('progression · addExp 是唯一的增加入口', () => {
  it('经验 / 潜能 / 钱一起入账，并播报一句话', () => {
    const { player, out } = makePlayer('yz/guangchang');
    player.addExp(500, 300, 20);
    expect(player.exp).toBe(500);
    expect(player.pot).toBe(300);
    expect(player.money).toBe(20);
    expect(out.messages.join('\n')).toContain('你获得了500 点经验，300 点潜能，20 文钱。');
  });

  it('只有经验时只播报经验（不出现"0 点潜能"这种噪声）', () => {
    const { player, out } = makePlayer('yz/guangchang');
    player.addExp(7);
    expect(out.messages.join('\n')).toContain('你获得了7 点经验。');
    expect(out.messages.join('\n')).not.toContain('潜能');
  });

  it('全零不播报（避免"你获得了。"这种句子）', () => {
    const { player, out } = makePlayer('yz/guangchang');
    player.addExp(0, 0, 0);
    expect(out.messages).toEqual([]);
  });

  it('★ 负数抛错而不是静默吞（扣减走各自的惩罚路径）', () => {
    const { player } = makePlayer('yz/guangchang');
    expect(() => player.addExp(-1)).toThrow();
    expect(() => player.addExp(0, -1)).toThrow();
    expect(player.exp).toBe(0);
    expect(player.pot).toBe(0);
  });

  it('NaN 抛错（不许静默变 0）', () => {
    const { player } = makePlayer('yz/guangchang');
    expect(() => player.addExp(Number.NaN)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// ② 击杀奖励
// ---------------------------------------------------------------------------

describe('progression · 打怪给经验与潜能', () => {
  it('★ 木人桩被打死 ⇒ 击杀者拿到 def 上写的经验/潜能，NPC 自己不涨', () => {
    const { player } = makePlayer('yz/beidajie1');
    const dummy = woodDummy();
    expect(dummy.def.exp).toBe(1000);

    dummy.takeDamage(100_000);
    expect(dummy.hp).toBe(0);
    expect(dummy.die(player)).toBe(true);

    expect(player.exp).toBe(1000);
    expect(player.pot).toBe(500);
    // ★ 反向断言：奖励是发给**击杀者**的，不是 NPC 的"自身经验"
    expect(dummy.exp).toBe(0);
  });

  it('没有击杀者（自然消失 / GM 清理）不发奖励', () => {
    const { player } = makePlayer('yz/beidajie1');
    const dummy = woodDummy();
    dummy.takeDamage(100_000);
    dummy.die();
    expect(player.exp).toBe(0);
    expect(player.pot).toBe(0);
  });

  it('★ 对照：没配 exp/pot 的 NPC 打死也不给（不是"打死什么都涨"）', () => {
    const { player } = makePlayer('yz/guangchang');
    const waiter = world.npcsOf('pub/xiaoer')[0];
    if (waiter === undefined) throw new Error('测试前置失败：pub/xiaoer 未实例化');
    expect(waiter.def.exp).toBeUndefined();

    waiter.takeDamage(100_000);
    expect(waiter.die(player)).toBe(true);
    expect(player.exp).toBe(0);
    expect(player.pot).toBe(0);
  });

  it('★ 重生：死的木人从世界索引摘掉，到点后**原地**刷回一只新的', () => {
    const { player } = makePlayer('yz/beidajie1');
    const dummy = woodDummy();
    dummy.takeDamage(100_000);
    dummy.die(player);

    // 死亡的瞬间就摘了索引（T4 的 `forget`）
    expect(world.npcsOf('pub/muren')).toHaveLength(0);
    expect(world.npc(dummy.oid)).toBeUndefined();

    // ★ 差一毫秒不刷 —— 否则"重生间隔"形同虚设。
    //   死的那一刻时钟是 clock，排期 = clock + 30000（木人桩的 respawn_ms 是 30 秒）。
    expect(world.scheduler.step(clock + 29_999)).toBe(0);
    expect(world.npcsOf('pub/muren')).toHaveLength(0);

    expect(world.scheduler.step(clock + 30_000)).toBe(1);
    const reborn = world.npcsOf('pub/muren');
    expect(reborn).toHaveLength(1);
    expect(reborn[0]?.environment?.path).toBe('yz/beidajie1');
    // 新实例（新 oid），不是把死的那只塞回去
    expect(reborn[0]?.oid).not.toBe(dummy.oid);
    expect(reborn[0]?.hp).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// ③ 经验 → 技能等级上限
// ---------------------------------------------------------------------------

describe('progression · 经验决定技能等级上限', () => {
  it('玩家经验为 0 时上限是 10（wushen limitExpMinLevel）', () => {
    const { player } = makePlayer('yz/guangchang');
    expect(player.exp).toBe(0);
    expect(player.skillLimit()).toBe(10);
  });

  it('上限随经验增长（exp=1000 ⇒ 22 级；exp=100000 ⇒ 100 级）', () => {
    const { player } = makePlayer('yz/guangchang');
    player.exp = 1_000;
    expect(player.skillLimit()).toBe(22);
    player.exp = 100_000;
    expect(player.skillLimit()).toBe(100);
  });

  it('★ 哨兵：同一份技能经验在"经验不足"时加不动、经验够了就能升', () => {
    const { player } = makePlayer('yz/guangchang');
    player.skills.learn('base/sword', 10);

    // cap = 10 ⇒ 再给 55 点（正好够升到 11）也升不了
    player.exp = 0;
    expect(player.skills.addExp('base/sword', 55)).toBe(0);
    expect(player.skills.levelOf('base/sword')).toBe(10);

    // ★ 把"起点人为拨到相反"：经验拨到 100000（cap=100），**同一份**技能经验立刻生效
    player.exp = 100_000;
    expect(player.skills.addExp('base/sword', 55)).toBe(1);
    expect(player.skills.levelOf('base/sword')).toBe(11);
  });

  it('★ NPC 不受这条曲线约束（上限 = 模板 max_level）', () => {
    const def = getDef<NpcDef>('npc', 'pub/xiaoer');
    if (def === undefined) throw new Error('测试前置失败：pub/xiaoer 未注册');
    const npc = new Npc({
      oid: 'n000000001',
      path: asWorldId('pub/xiaoer', 'progression.test:npc'),
      name: def.name,
      def,
      skillRegistry: world.skillRegistry,
    });
    expect(npc.exp).toBe(0);
    expect(npc.skillLimit()).toBe(Number.POSITIVE_INFINITY);
    // 于是它能把技能练到模板上限，而不是被 10 级卡住
    npc.skills.learn('base/sword', 10);
    expect(npc.skills.addExp('base/sword', 1_000_000)).toBeGreaterThan(0);
    expect(npc.skills.levelOf('base/sword')).toBeGreaterThan(10);
  });
});

// ---------------------------------------------------------------------------
// ④ 潜能 → 技能等级
// ---------------------------------------------------------------------------

describe('progression · 消耗潜能练技能', () => {
  it('潜能 1:1 换技能经验：pot 精确减少、等级精确上升', () => {
    const { player } = makePlayer('yz/guangchang');
    player.skills.learn('base/sword', 1); // grade 0 ⇒ 每级 5*(lv+1)
    player.pot = 100;

    // 1 → 5 级：10 + 15 + 20 + 25 = 70
    const r = player.practiceSkill('基本剑法', 5);
    expect(r.ok).toBe(true);
    expect(r.spent).toBe(70);
    expect(r.gained).toBe(4);
    expect(r.level).toBe(5);
    expect(r.limit).toBe(10);
    expect(player.pot).toBe(30);
    expect(player.skills.levelOf('base/sword')).toBe(5);
  });

  it('不给目标等级 ⇒ 一直练到上限就停（潜能不会被花超）', () => {
    const { player } = makePlayer('yz/guangchang');
    player.skills.learn('base/sword', 1);
    player.pot = 1_000_000;

    const r = player.practiceSkill('基本剑法');
    expect(r.ok).toBe(true);
    expect(r.level).toBe(10); // = skillLimit()
    expect(r.limit).toBe(10);
    // 1 → 10 级合计 5*(2+…+10) = 270；多出来的潜能必须还在
    expect(r.spent).toBe(270);
    expect(player.pot).toBe(1_000_000 - 270);
  });

  it('到上限后再练 ⇒ capped（不是静默不动）', () => {
    const { player } = makePlayer('yz/guangchang');
    player.skills.learn('base/sword', 10);
    player.pot = 500;
    const r = player.practiceSkill('基本剑法');
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('capped');
    expect(r.level).toBe(10);
    expect(player.pot).toBe(500); // 一分没花
  });

  it('潜能不足 ⇒ no-pot，且等级与潜能都不动', () => {
    const { player } = makePlayer('yz/guangchang');
    player.skills.learn('base/sword', 1);
    player.pot = 0;
    const r = player.practiceSkill('基本剑法');
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('no-pot');
    expect(player.skills.levelOf('base/sword')).toBe(1);
    expect(player.pot).toBe(0);
  });

  it('没学过的技能 ⇒ not-learned；完全不存在的 ⇒ unknown', () => {
    const { player } = makePlayer('yz/guangchang');
    player.pot = 1000;
    expect(player.practiceSkill('基本剑法').reason).toBe('not-learned');
    expect(player.practiceSkill('不存在的功夫').reason).toBe('unknown');
    expect(player.pot).toBe(1000);
  });

  it('★ 基本功火候：武功等级必须**严格低于**它要装的槽的基本技能等级', () => {
    const { player } = makePlayer('yz/guangchang');
    // 先满足学习条件（太极剑法需要基本剑法 30 级）
    player.skills.setLevel('base/sword', 30);
    player.skills.learn('wd/taijijian', 1);
    // 上限要够高，否则会先撞 capped（那是另一条判据）
    player.exp = 10_000_000;
    player.pot = 100_000;

    // 1 级 < 基本剑法 30 级 ⇒ 可以练
    expect(player.practiceSkill('太极剑法', 2).ok).toBe(true);

    // 把武功拨到与基本功**同级** ⇒ 火候未到
    player.skills.setLevel('wd/taijijian', 30);
    const r = player.practiceSkill('太极剑法');
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('basis');
    expect(player.skills.levelOf('wd/taijijian')).toBe(30);
  });

  it('目标等级高于上限 ⇒ 按上限截断，不越界', () => {
    const { player } = makePlayer('yz/guangchang');
    player.skills.learn('base/sword', 1);
    player.pot = 1_000_000;
    const r = player.practiceSkill('基本剑法', 9999);
    expect(r.ok).toBe(true);
    expect(r.level).toBe(10);
    expect(player.skills.levelOf('base/sword')).toBe(10);
  });

  it('★ 已达指定目标 ⇒ reached（不是 capped：上限还远着呢）', () => {
    const { player } = makePlayer('yz/guangchang');
    player.skills.learn('base/sword', 5);
    player.pot = 100;
    const r = player.practiceSkill('基本剑法', 5);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('reached');
    expect(r.level).toBe(5);
    expect(r.limit).toBe(10); // 上限仍是 10 ⇒ 与 capped 语义可区分
    expect(player.pot).toBe(100);
  });

  it('★★ 余额已够到目标 ⇒ 免费升级（不报 no-pot，也不扣潜能）', () => {
    const { player } = makePlayer('yz/guangchang');
    player.skills.learn('base/sword', 1);

    // 上限 10 时把经验打到溢出：等级停在 10，**剩下的经验留着**（`addExp` 不清零）
    player.exp = 0;
    player.skills.addExp('base/sword', 1_000_000);
    expect(player.skills.levelOf('base/sword')).toBe(10);
    expect(player.skills.entryOf('base/sword')?.exp ?? 0).toBeGreaterThan(0);

    // 上限抬到 100，且**一分潜能都没有** —— 那笔余额应该能直接换等级
    player.exp = 100_000;
    player.pot = 0;
    const r = player.practiceSkill('基本剑法', 20);
    expect(r.ok).toBe(true);
    expect(r.spent).toBe(0);
    expect(r.gained).toBe(10);
    expect(r.level).toBe(20);
    expect(player.skills.levelOf('base/sword')).toBe(20);
    expect(player.pot).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// ⑤ 指令入口（三级分发的第 ② 级）
// ---------------------------------------------------------------------------

describe('progression · practice / lianxi 指令', () => {
  it('练技能走指令：practice 基本剑法', () => {
    const { player, out } = makePlayer('yz/guangchang');
    player.skills.learn('base/sword', 1);
    player.pot = 100;

    expect(dispatch(world.commands, player, 'practice 基本剑法 5')).toEqual({
      kind: 'executed',
      via: 'command',
      id: 'train/practice',
    });
    const printed = out.messages.join('\n');
    expect(printed).toContain('你练了一阵基本剑法');
    expect(printed).toContain('消耗 70 点潜能');
    expect(printed).toContain('现在是 5 级');
    expect(player.pot).toBe(30);
  });

  it('别名 lianxi 落到同一条指令', () => {
    const { player } = makePlayer('yz/guangchang');
    player.skills.learn('base/sword', 1);
    player.pot = 100;
    expect(dispatch(world.commands, player, 'lianxi 基本剑法 2').kind === 'executed').toBe(true);
    expect(player.skills.levelOf('base/sword')).toBe(2);
  });

  it('不给参数时说清怎么用', () => {
    const { player, out } = makePlayer('yz/guangchang');
    dispatch(world.commands, player, 'practice');
    expect(out.messages.join('\n')).toContain('你要练哪一门功夫');
  });

  it('潜能不足时给的是"潜能不够"而不是笼统的失败', () => {
    const { player, out } = makePlayer('yz/guangchang');
    player.skills.learn('base/sword', 1);
    player.pot = 0;
    dispatch(world.commands, player, 'practice 基本剑法');
    expect(out.messages.join('\n')).toContain('潜能不够');
  });
});

// ---------------------------------------------------------------------------
// ⑥ 面板：经验 / 潜能 / 上限
// ---------------------------------------------------------------------------

describe('progression · score 面板带成长三行', () => {
  it('打出经验、潜能与技能等级上限', () => {
    const { player, out } = makePlayer('yz/guangchang');
    player.exp = 1000;
    player.pot = 500;
    dispatch(world.commands, player, 'score');
    const printed = out.messages.join('\n');
    expect(printed).toContain('经验：1000　潜能：500');
    expect(printed).toContain('技能等级上限：22 级');
  });
});

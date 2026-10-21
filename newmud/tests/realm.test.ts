/**
 * tests/realm.test.ts —— **境界（realm）**：由内功 / 轻功 / 招架三槽派生的一个数
 * ============================================================================
 * 设计口径在 **27 册 §16**，批次记录在 **26 册 §72**。本文件只钉四件事：
 *
 *   ① `realmOf()` 取**最小**（不是最大、不是平均）—— 木桶语义；
 *   ② 境界是**派生量**：`Character.level` 只是 `realm` 的别名，不是独立字段；
 *   ③ 境界**真的影响** `skillLimit()`（否则它就是一个纯显示的花瓶）；
 *   ④ `realmName()` 越界**钳位不抛**（面板要读它）。
 *
 * 另外两条指令的测试也放这里，因为它们是"为了让这条链可测"而造的脚手架（同批产物）：
 *   · `skills <NPC>` —— 看教头会哪几门、各几级；
 *   · `addxp` —— 测试期加经验 / 潜能，否则打木人攒潜能要按小时算。
 *
 * ★★ 防假绿（24 册铁律 8）：
 *   - "取最小"用**反例**钉：只把内功轻功练到顶、招架 0，若实现退化成 `max` 这条必红；
 *   - "境界抬高上限"用**同一个玩家、同一份经验**前后对照，排除"经验也涨了"的干扰；
 *   - "看 NPC 技能"配一只**什么都不会的**木人桩做对照（否则"总是打印一串字"也能过）。
 */
import { describe, expect, it, beforeEach } from 'vitest';

// 副作用导入：触发真实内容注册（与 content.test.ts 同一机制）
import '@world/index.js';

import { RecordingOutput } from '../server/engine/character.js';
import { Player } from '../server/engine/player.js';
import { Scheduler } from '../server/engine/scheduler.js';
import { realmOf, SKILL_FORMULA } from '../server/engine/skill.js';
import { instantiateWorld } from '../server/engine/world.js';
import type { World } from '../server/engine/world.js';
import { dispatch } from '../server/engine/command.js';
import { REALM_NAMES, realmName } from '../shared/constants.js';

let world: World;
let oidSeq = 0;

beforeEach(() => {
  world = instantiateWorld({ scheduler: new Scheduler({ now: () => 0 }) });
  oidSeq = 0;
});

function makePlayer(roomPath: string): { player: Player; out: RecordingOutput } {
  const room = world.room(roomPath);
  if (room === undefined) throw new Error(`测试前置失败：房间 ${roomPath} 不存在`);
  oidSeq += 1;
  const out = new RecordingOutput();
  const player = new Player({
    roleId: `realm-${String(oidSeq)}`,
    oid: `r${String(oidSeq).padStart(9, '0')}`,
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

/** 三样基本功一起练到 `level` 级 —— `SkillBook.learn` 是直接置级，不走练习流程 */
function trainThree(player: Player, level: number): void {
  player.skills.learn('base/force', level);
  player.skills.learn('base/dodge', level);
  player.skills.learn('base/parry', level);
}

/** 最高一档的阈值（末档 = 技能硬顶，见 `realmThresholds` 的注释） */
const TOP = SKILL_FORMULA.realmThresholds[SKILL_FORMULA.realmThresholds.length - 1] ?? 0;

// ---------------------------------------------------------------------------
// ① realmOf：三槽取最小
// ---------------------------------------------------------------------------

describe('境界 · realmOf 的口径', () => {
  it('三样都没练 ⇒ 0 档', () => {
    expect(realmOf(0, 0, 0)).toBe(0);
  });

  it('★★ 取**最小**（木桶），不是最大：内功轻功练到顶、招架 0 ⇒ 仍是 0 档', () => {
    // 若实现退化成 Math.max，这条会得到 6 —— 这正是本用例存在的理由
    expect(realmOf(TOP, TOP, 0)).toBe(0);
    expect(realmOf(0, TOP, TOP)).toBe(0);
    expect(realmOf(TOP, 0, TOP)).toBe(0);
  });

  it('★ 平均也会被这条挡住：两样到顶、一样 0，平均值很高但境界不动', () => {
    expect(realmOf(TOP, TOP, 1)).toBe(0);
  });

  it('逐档边界：差 1 级不升、正好到就升（阈值从常量读，不抄数字）', () => {
    const thresholds = SKILL_FORMULA.realmThresholds;
    thresholds.forEach((threshold, i) => {
      // 三槽同时站在第 i 档的门槛下方 1 级 ⇒ 还是 i 档
      expect(realmOf(threshold - 1, threshold - 1, threshold - 1)).toBe(i);
      // 正好踩到门槛 ⇒ 进到 i+1 档
      expect(realmOf(threshold, threshold, threshold)).toBe(i + 1);
    });
  });

  it('三样都到顶 ⇒ 最高档（末档阈值 = 技能硬顶）', () => {
    expect(realmOf(TOP, TOP, TOP)).toBe(SKILL_FORMULA.realmThresholds.length);
  });

  it('脏值**不抛**：NaN / 负数 ⇒ 0 档（面板要读它，抛错会让面板打不开）', () => {
    expect(realmOf(Number.NaN, 100, 100)).toBe(0);
    expect(realmOf(-5, -5, -5)).toBe(0);
    expect(realmOf(Number.NEGATIVE_INFINITY, 0, 0)).toBe(0);
  });

  it('非有限值一律落 0 档（∞ 也**不**当成"练到顶"——垃圾输入不放大任何东西）', () => {
    // ★ `realmOf` 的第一道闸是 `!Number.isFinite(lowest)`。
    //   把 `+∞` 当成 max 会让一个脏值直接顶到最高境界（并顺势抬高技能上限），
    //   所以这里**故意**统一落 0：宁可少给，不许白送。
    expect(realmOf(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY)).toBe(0);
    expect(realmOf(Number.POSITIVE_INFINITY, 0, 0)).toBe(0);
  });

  it('境界档数与名字表对得上（7 个名字 = 0 档 + 6 个阈值）', () => {
    expect(REALM_NAMES.length).toBe(SKILL_FORMULA.realmThresholds.length + 1);
    expect(SKILL_FORMULA.limitRealmFactor.length).toBe(REALM_NAMES.length);
  });
});

// ---------------------------------------------------------------------------
// ② 派生量：`level` 只是 `realm` 的别名
// ---------------------------------------------------------------------------

describe('境界 · 是派生量，不是存下来的字段', () => {
  it('level 与 realm 恒等（谁又写回一个独立字段，这条会红）', () => {
    const { player } = makePlayer('yz/guangchang');
    expect(player.level).toBe(player.realm);

    trainThree(player, 1);
    expect(player.level).toBe(player.realm);
  });

  it('三槽一起练过线 ⇒ 境界当场就涨（不需要"升级动作"）', () => {
    const { player } = makePlayer('yz/guangchang');
    expect(player.realm).toBe(0);

    const first = SKILL_FORMULA.realmThresholds[0] ?? 0;
    trainThree(player, first);
    expect(player.realm).toBe(1);
    expect(player.level).toBe(1);
  });

  it('★ 只练一样 ⇒ 境界不动（派生量真的在算，不是"学会就 +1"）', () => {
    const { player } = makePlayer('yz/guangchang');
    const first = SKILL_FORMULA.realmThresholds[0] ?? 0;

    player.skills.learn('base/force', first);
    expect(player.realm).toBe(0);

    player.skills.learn('base/dodge', first);
    expect(player.realm).toBe(0);

    // 第三样补上才跳档 —— 前两次"没动"不是没反应，是还没齐
    player.skills.learn('base/parry', first);
    expect(player.realm).toBe(1);
  });

  it('面板读数与 getter 同源（level / realmName 都由服务端算好）', () => {
    const { player } = makePlayer('yz/guangchang');
    const first = SKILL_FORMULA.realmThresholds[0] ?? 0;
    trainThree(player, first);

    const view = player.attrView();
    expect(view.level).toBe(player.realm);
    expect(view.realmName).toBe(REALM_NAMES[player.realm]);
    expect(view.realmName).toBe(realmName(player.realm));
  });
});

// ---------------------------------------------------------------------------
// ③ 境界真的影响技能上限
// ---------------------------------------------------------------------------

describe('境界 · 抬高技能等级上限', () => {
  it('★★ 同一份经验：境界高的上限更大（排除"经验也涨了"的干扰）', () => {
    const { player } = makePlayer('yz/guangchang');
    // 足够大、且不是 `limitExpMin` 以下的兜底档
    player.exp = 200_000;

    const atRealm0 = player.skillLimit();
    trainThree(player, SKILL_FORMULA.realmThresholds[0] ?? 0);
    const atRealm1 = player.skillLimit();

    expect(player.realm).toBe(1);
    // exp 一字未改
    expect(player.exp).toBe(200_000);
    expect(atRealm1).toBeGreaterThan(atRealm0);
  });

  it('★★ 上限仍受硬顶约束：境界到顶也只是逼近 1000，不会溢出', () => {
    const { player } = makePlayer('yz/guangchang');
    trainThree(player, TOP);
    player.exp = Number.MAX_SAFE_INTEGER;
    expect(player.skillLimit()).toBe(SKILL_FORMULA.limitMaxLevel);
  });

  it('★ 经验极少时上限走兜底档，与境界无关（防止"高境界 ⇒ 白送等级"）', () => {
    const { player } = makePlayer('yz/guangchang');
    trainThree(player, TOP);
    player.exp = 0;
    expect(player.skillLimit()).toBe(SKILL_FORMULA.limitExpMinLevel);
  });
});

// ---------------------------------------------------------------------------
// ④ realmName：钳位不抛
// ---------------------------------------------------------------------------

describe('境界名 · realmName', () => {
  it('正常档位取对应的词', () => {
    REALM_NAMES.forEach((name, i) => {
      expect(realmName(i)).toBe(name);
    });
  });

  it('越界钳位：负数取首档、超界取末档，**都不抛**', () => {
    expect(realmName(-1)).toBe(REALM_NAMES[0]);
    expect(realmName(999)).toBe(REALM_NAMES[REALM_NAMES.length - 1]);
  });

  it('小数截断、NaN 落 0 档', () => {
    expect(realmName(2.9)).toBe(REALM_NAMES[2]);
    expect(realmName(Number.NaN)).toBe(REALM_NAMES[0]);
  });
});

// ---------------------------------------------------------------------------
// ⑤ `skills <NPC>`：看教头会什么
// ---------------------------------------------------------------------------

describe('skills <NPC> · 看别人会什么', () => {
  it('★★ 列出教头的技能表（含装配槽），并给一句可点的 learn', () => {
    const { player, out } = makePlayer('yz/wuguan');
    const r = dispatch(world.commands, player, 'skills 教头');
    expect(r.kind).toBe('executed');

    const text = out.messages.join('\n');
    expect(text).toContain('教头所会的武功：');
    // 教头六门基本功各 300 级（内容层数值，见 `world/npc/pub/jiaotou.ts`）
    expect(text).toContain('基本内功（force）300 级');
    // ★ 末尾那句可点的 `learn`：把"能学"变成一步操作。
    //   这里不断言具体哪一门（那会把"技能排序"和"教头等级表"两份内容绑进测试），
    //   只断言它是**教头会的一门基本功**——排序取等级最高那门这件事由 `skillList` 自己保证。
    const hint = out.commands[out.commands.length - 1];
    expect(hint?.[0]).toMatch(/^learn base\/(force|dodge|parry|unarmed|sword|blade) from 教头$/);
  });

  it('★ 对照：什么都不会的 NPC ⇒ 明说"什么武功也不会"（不是打印一张空表）', () => {
    const { player, out } = makePlayer('yz/beidajie1');
    dispatch(world.commands, player, 'skills 木人桩');
    expect(out.messages.join('\n')).toContain('什么武功也不会');
  });

  it('目标不在房间 ⇒ 这里没有这个人', () => {
    const { player, out } = makePlayer('yz/guangchang');
    dispatch(world.commands, player, 'skills 教头');
    expect(out.messages.join('\n')).toContain('这里没有这个人');
  });

  it('不带目标 ⇒ 仍然打开自己的技能面板（原有行为没被改坏）', () => {
    const { player, out } = makePlayer('yz/wuguan');
    dispatch(world.commands, player, 'skills');
    expect(out.skillViews.length).toBeGreaterThan(0);
    // 带目标时**不**走面板（面板是"我的技能"的界面）
    out.skillViews.length = 0;
    dispatch(world.commands, player, 'skills 教头');
    expect(out.skillViews).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// ⑥ `addxp`：测试期的成长写入
// ---------------------------------------------------------------------------

describe('addxp · 测试指令', () => {
  it('加经验与潜能，并报一次当前的技能上限', () => {
    const { player, out } = makePlayer('yz/guangchang');
    dispatch(world.commands, player, 'addxp 10000 5000');

    expect(player.exp).toBe(10_000);
    expect(player.pot).toBe(5_000);
    // 非 GM ⇒ 带【测试指令】前缀，免得被当成正常玩法
    expect(out.messages.join('\n')).toContain('【测试指令】');
    expect(out.messages.join('\n')).toContain('技能等级上限');
  });

  it('★ 只给经验时潜能不变（不是"没写就顺手加一份"）', () => {
    const { player } = makePlayer('yz/guangchang');
    dispatch(world.commands, player, 'addxp 500');
    expect(player.exp).toBe(500);
    expect(player.pot).toBe(0);
  });

  it('GM 等级够 ⇒ 不打【测试指令】前缀（同一条指令两种身份）', () => {
    const { player, out } = makePlayer('yz/guangchang');
    player.userLevel = 9;
    dispatch(world.commands, player, 'addxp 100');
    expect(player.exp).toBe(100);
    expect(out.messages.join('\n')).not.toContain('【测试指令】');
  });

  it('全零 ⇒ 只回用法，不入账（避免"加 0 也播报一次获得"）', () => {
    const { player, out } = makePlayer('yz/guangchang');
    dispatch(world.commands, player, 'addxp 0 0');
    expect(player.exp).toBe(0);
    expect(out.messages.join('\n')).toContain('用法');
  });

  it('★ 超出安全整数 ⇒ 拒收（`+=` 会静默丢精度，玩家看到的数就是错的）', () => {
    const { player, out } = makePlayer('yz/guangchang');
    dispatch(world.commands, player, 'addxp 99999999999999999999');
    expect(player.exp).toBe(0);
    expect(out.messages.join('\n')).toContain('必须是');
  });

  it('★ 加完经验后，练习真的不再被"潜能不足"挡住（闭环真接通了）', () => {
    const { player } = makePlayer('yz/guangchang');
    // 从 5 级起步：经验 0 时上限就是 10，写在 10 级会直接撞 `capped`，测不到"潜能"这条
    player.skills.learn('base/sword', 5);

    // 对照组：没有潜能时练不动（目标 8 级：5 < 8 不是 'reached'，8 < 上限 10 不是 'capped'）
    const before = player.practiceSkill('base/sword', 8);
    expect(before.kind === 'refused' ? before.reason : 'done-but-expected-refused').toBe('no-pot');

    dispatch(world.commands, player, 'addxp 1000 1000');
    const after = player.practiceSkill('base/sword', 8);
    expect(after.kind).toBe('done');
    expect(player.skills.levelOf('base/sword')).toBe(8);
  });
});

/**
 * tests/skill-study.test.ts —— **读书**（`SkillBook.study` · 26 册 §75）
 * ============================================================================
 * 钉住技能第二条成长路的三条判据：
 *   ① 读书**真的加经验、真的升级**（而且受**书的上限**压着，不是技能自己的上限）；
 *   ② 书太浅 ⇒ `too-shallow`（不是"静默加了 0 经验"）；
 *   ③ **准入不能被书绕过** ⇒ `wd/taijijian` 的 `minSlot: sword 30` 在读书这条路上
 *      照样拦人（wushen `study.js:105-113` 的 `check_skill` 判的就是这个）。
 *
 * ★ 为什么 ③ 必须单独一条：`learn` 那条路早就判了准入，读书是**新开的一条**。
 *   只测 ① 的话，一个"从书里能直接学太极剑法"的实现照样全绿 ——
 *   而那条捷径会让"基本功练到 30 级"这段设计直接作废。
 */
import { beforeEach, describe, expect, it } from 'vitest';

import '@world/index.js';

import { RecordingOutput } from '../server/engine/character.js';
import { Player } from '../server/engine/player.js';
import { Scheduler } from '../server/engine/scheduler.js';
import { instantiateWorld } from '../server/engine/world.js';
import type { World } from '../server/engine/world.js';
import type { StudyResult } from '../server/world/defs.js';

let world: World;
let oidSeq = 0;

beforeEach(() => {
  world = instantiateWorld({ scheduler: new Scheduler({ now: () => 1_000_000 }) });
  oidSeq = 0;
});

function makePlayer(opts: { int?: number } = {}): { player: Player; out: RecordingOutput } {
  oidSeq += 1;
  const out = new RecordingOutput();
  const player = new Player({
    roleId: `reader-${String(oidSeq)}`,
    oid: `r${String(oidSeq).padStart(9, '0')}`,
    path: null,
    name: '读书人',
    skillRegistry: world.skillRegistry,
    output: out,
    scheduler: world.scheduler,
    ...(opts.int === undefined ? {} : { int: opts.int }),
  });
  const room = world.room('yz/wuguan');
  if (room !== undefined) player.moveTo(room);
  return { player, out };
}

function ok(r: StudyResult): Extract<StudyResult, { readonly kind: 'ok' }> {
  if (r.kind !== 'ok') throw new Error(`期望读成，实际：${r.kind}${'reason' in r ? `/${r.reason}` : ''}`);
  return r;
}

describe('引擎 · 读书（study）', () => {
  it('★ 加经验并升级；上限是**书的上限**，不是技能自己的上限', () => {
    const { player } = makePlayer();
    // 基本剑法：技能上限（模板 1000 / 角色曲线）远大于书给的 2
    const first = ok(player.studySkill('base/sword', 50, 2));
    expect(first.name).toBe('基本剑法');
    expect(first.level).toBeLessThanOrEqual(2);

    // 继续读：等级被书的上限 2 钉住
    for (let i = 0; i < 20; i += 1) {
      const r = player.studySkill('base/sword', 50, 2);
      if (r.kind === 'refused') break;
    }
    expect(player.skillLevel('base/sword')).toBe(2);
  });

  it('★ 到书的上限 ⇒ `too-shallow`（而不是静默加 0 经验）', () => {
    const { player } = makePlayer();
    // ★ 书的上限取 5：新角色 `skillLimit()` 只有 10（经验 0），
    //   所以必须让**书**先成为瓶颈，这条测的才是 `too-shallow` 而不是 `capped`
    ok(player.studySkill('base/sword', 5_000, 5));
    expect(player.skillLevel('base/sword')).toBe(5);

    const r = player.studySkill('base/sword', 100, 5);
    // ★ 先窄化到具体那一支再取字段：`refused` 是两支的联合，
    //   直接读 `r.bookMax` 编译就不过（这正是判别联合想拦的东西）
    if (r.kind !== 'refused' || r.reason !== 'too-shallow') {
      throw new Error(`期望 too-shallow，实际：${r.kind}${'reason' in r ? `/${r.reason}` : ''}`);
    }
    expect(r.bookMax).toBe(5);
    expect(r.level).toBe(5);
  });

  it('★★ 准入**不能**被书绕过：太极剑法要基本剑法 30 级', () => {
    const { player } = makePlayer();
    const r = player.studySkill('wd/taijijian', 100, 80);
    expect(r.kind).toBe('blocked');
    if (r.kind === 'blocked') {
      expect(r.refusal.reason).toBe('slot');
    }
    // 没学会 —— 拒绝不该留下半个状态
    expect(player.skillLevel('wd/taijijian')).toBe(0);
  });

  it('★ 准入预检（`exp = 0`）**不留档案**：读不了的书不会在技能表里留下 0 级记录', () => {
    const { player } = makePlayer();
    const r = player.studySkill('wd/taijijian', 0, 80);
    expect(r.kind).toBe('blocked');
    // `skillView().items` 里没有太极剑法 —— 没建档
    expect(player.skillView().items.some((s) => s.id === 'wd/taijijian')).toBe(false);
    expect(player.skillLevel('wd/taijijian')).toBe(0);
  });

  it('技能 id 不存在 ⇒ `unknown`', () => {
    const { player } = makePlayer();
    expect(player.studySkill('no/such-skill', 10, 80)).toEqual({ kind: 'refused', reason: 'unknown' });
  });

  it('非法参数抛错（不是静默读了个寂寞）', () => {
    const { player } = makePlayer();
    expect(() => player.studySkill('base/sword', -1, 80)).toThrow(/经验/);
    expect(() => player.studySkill('base/sword', 10, -5)).toThrow(/上限/);
  });
});

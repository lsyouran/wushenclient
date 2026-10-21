/**
 * tests/engine-state.test.ts —— 持续状态机（26 册 §75）
 * ============================================================================
 * 钉住 `Character.startState` / `stopState` 的四条契约：
 *   ① 起状态 ⇒ 立刻发一帧 `state`（前端据此显示"你在做什么"）；
 *   ② 心跳由**世界时钟**驱动（`Scheduler`），一拍调一次 `tick`；
 *   ③ `tick` 返回 `false` / 抛错 ⇒ 状态**结束**并发 `null` 帧；
 *   ④ `stopState` 真的取消排期（之后再 `step` 也不会再调 `tick`）。
 *
 * ★ 为什么必须用**真 Scheduler + 假时钟**：状态的核心就是"每 5 秒一拍"。
 *   真等 5 秒会让测试既慢又 flake；注入假时钟之后，`step(t)` 就等价于"过了 t 毫秒"，
 *   而跑的是**生产那条排期路径**（`scheduler.every`）。
 *
 * ★ 为什么不拿 `TestActor` 替身测：替身里的 `startState` 是桩（永远 `false`）——
 *   用它测等于测替身。状态机是**引擎私有状态**（`#state` + 排期句柄），
 *   只有真 `Character` 才碰得到。
 */
import { describe, expect, it } from 'vitest';

import { RecordingOutput } from '../server/engine/character.js';
import { Player } from '../server/engine/player.js';
import { Scheduler } from '../server/engine/scheduler.js';

interface Clock {
  now(): number;
  advance(ms: number): void;
}

function makeClock(start = 1_000_000): Clock {
  let t = start;
  return {
    now: () => t,
    advance: (ms) => {
      t += ms;
    },
  };
}

let seq = 0;

function makeActor(scheduler: Scheduler): { player: Player; out: RecordingOutput } {
  const out = new RecordingOutput();
  const player = new Player({
    oid: `s${String((seq += 1))}`,
    path: null,
    name: '读书人',
    roleId: `r-${String(seq)}`,
    scheduler,
    output: out,
  });
  return { player, out };
}

describe('引擎 · 持续状态机', () => {
  it('起状态立刻发一帧 `state`，`state` getter 也能读到', () => {
    const clock = makeClock();
    const scheduler = new Scheduler({ now: clock.now });
    const { player, out } = makeActor(scheduler);

    const ok = player.startState({ id: 'study', title: '研读', desc: '你正在研读秘籍。', tick: () => true });

    expect(ok).toBe(true);
    expect(player.state).toEqual({ id: 'study', title: '研读', desc: '你正在研读秘籍。' });
    expect(out.stateViews).toEqual([{ id: 'study', title: '研读', desc: '你正在研读秘籍。' }]);
  });

  it('★ 一拍调一次 tick（由世界时钟驱动，不是自己 setTimeout）', () => {
    const clock = makeClock();
    const scheduler = new Scheduler({ now: clock.now });
    const { player } = makeActor(scheduler);

    let ticks = 0;
    player.startState({ id: 'x', title: '做某事', intervalMs: 1000, tick: () => { ticks += 1; return true; } });

    // 没到点：一拍都不该跑
    clock.advance(999);
    scheduler.step();
    expect(ticks).toBe(0);

    clock.advance(1);
    scheduler.step();
    expect(ticks).toBe(1);

    clock.advance(2000);
    scheduler.step();
    expect(ticks).toBe(2); // 只补跑一拍，不会因为过了两拍就补两次
  });

  it('★ tick 返回 false ⇒ 状态结束 + 发 null 帧 + 之后不再调 tick', () => {
    const clock = makeClock();
    const scheduler = new Scheduler({ now: clock.now });
    const { player, out } = makeActor(scheduler);

    let ticks = 0;
    player.startState({
      id: 'x',
      title: '做某事',
      intervalMs: 1000,
      tick: () => {
        ticks += 1;
        return ticks < 2; // 第二拍说"不做了"
      },
    });

    clock.advance(1000);
    scheduler.step();
    expect(player.state).not.toBeNull();

    clock.advance(1000);
    scheduler.step();
    expect(player.state).toBeNull();
    // 三帧：start、end（null）
    expect(out.stateViews).toHaveLength(2);
    expect(out.stateViews[1]).toBeNull();

    clock.advance(5000);
    scheduler.step();
    expect(ticks).toBe(2); // 停了就是停了
  });

  it('★ tick 抛错 ⇒ 按"结束"处理，不把状态挂在那儿', () => {
    const clock = makeClock();
    const scheduler = new Scheduler({ now: clock.now });
    const { player, out } = makeActor(scheduler);

    player.startState({
      id: 'boom',
      title: '炸',
      intervalMs: 1000,
      tick: () => {
        throw new Error('内容层炸了');
      },
    });

    clock.advance(1000);
    scheduler.step();

    expect(player.state).toBeNull();
    expect(out.stateViews.at(-1)).toBeNull();
  });

  it('★ stopState 取消排期：再 step 也不会跑 tick', () => {
    const clock = makeClock();
    const scheduler = new Scheduler({ now: clock.now });
    const { player } = makeActor(scheduler);

    let ticks = 0;
    player.startState({ id: 'x', title: '做某事', intervalMs: 1000, tick: () => { ticks += 1; return true; } });
    expect(player.stopState()).toBe(true);

    clock.advance(10_000);
    scheduler.step();
    expect(ticks).toBe(0);
    expect(player.state).toBeNull();
  });

  it('已经在状态里 ⇒ 第二次 startState 返回 false（不覆盖、不叠加排期）', () => {
    const clock = makeClock();
    const scheduler = new Scheduler({ now: clock.now });
    const { player, out } = makeActor(scheduler);

    expect(player.startState({ id: 'a', title: '甲', tick: () => true })).toBe(true);
    expect(player.startState({ id: 'b', title: '乙', tick: () => true })).toBe(false);
    expect(player.state?.id).toBe('a');
    expect(out.stateViews).toHaveLength(1);
  });

  it('没状态时 stopState 返回 false（不是"停了两次"）', () => {
    const clock = makeClock();
    const scheduler = new Scheduler({ now: clock.now });
    const { player, out } = makeActor(scheduler);

    expect(player.stopState()).toBe(false);
    expect(out.stateViews).toEqual([]);
  });

  it('没注入 scheduler ⇒ startState 抛错（不是静默不跑）', () => {
    const { player } = makeActor(undefined as unknown as Scheduler);
    expect(() => player.startState({ id: 'x', title: '做某事', tick: () => true })).toThrow(/世界时钟/);
  });
});

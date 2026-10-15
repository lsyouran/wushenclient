/**
 * server/bootstrap.ts — 组合根（Composition Root）
 * ============================================================================
 * ⚠️ 本文件是**全项目唯一**允许 `import` 具体内容（`@world/`）的地方。
 *
 * 依赖方向硬约束（G13 闸门会扫描）：
 *   world/ (内容)  ──import──>  server/world/define.ts   ✅
 *   world/ (内容)  ──import──>  server/engine/**         ❌
 *   server/engine/**  ──import──> @world/**              ❌
 *   server/bootstrap.ts ──import──> @world/index.js      ✅（唯一的例外，就是这里）
 *
 * 原因：引擎必须对"具体有哪些房间/NPC"一无所知，否则无法单测、且内容一改引擎就得重编。
 */

import type { Kind } from '@shared/ids.js';
import { snapshot } from './engine/registry.js';
import { instantiateWorld } from './engine/world.js';
import type { World, WorldStats } from './engine/world.js';
import { assertProjectRoot } from './paths.js';
import type { ProjectRootReport } from './paths.js';
import { assertWorldValid } from './world/validate.js';
import type { WorldProblem } from './world/validate.js';

// ★ 组合根职责：触发内容注册（副作用导入）
import '@world/index.js';

export interface BootstrapResult {
  /** 项目根自检结果（启动日志/诊断用；不再是一个"调了但没用"的 void 调用） */
  readonly root: ProjectRootReport;
  readonly counts: Record<Kind, number>;
  readonly problems: readonly WorldProblem[];
  /** 实例化出来的世界（房间实例、NPC、物品、出口已连好） */
  readonly world: World;
}

/**
 * 启动世界：定位项目根 → 校验全部跨对象引用 → 实例化世界 → 返回结果。
 * 任一引用错误即抛错终止（fail-fast，不进入"半可用"状态）。
 *
 * ★ docs/26 M3：这里曾经把「过滤 error → 拼详情 → 抛错」**重写了一份**，
 *   而 `assertWorldValid()` 反倒成了无人调用的死代码——同一逻辑两处各一份。
 *   现在唯一收口在 `server/world/validate.ts`。
 *   `tests/validate.test.ts` 用「两者报错信息必须逐字相同」把这条钉住。
 */
export function bootstrapWorld(): BootstrapResult {
  const root = assertProjectRoot();
  const problems = assertWorldValid();
  const world = instantiateWorld();

  return {
    counts: snapshot(),
    problems,
    root,
    world,
  };
}

/** 启动日志用的一行统计（22 册 §22.8：「加载阶段打印各阶段耗时与对象计数」） */
export function describeWorld(stats: WorldStats): string {
  return (
    `房间 ${stats.rooms} / NPC ${stats.npcs} / 物品 ${stats.items} / ` +
    `区域 ${stats.areas} / 出口 ${stats.exits} / ` +
    `指令 ${stats.commands}（别名 ${stats.commandAliases}）/ 技能 ${stats.skills} / ` +
    `已发 id ${stats.oidsIssued}`
  );
}

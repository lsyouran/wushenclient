/**
 * server/engine/player.ts — 玩家角色
 * ============================================================================
 * `Character` 是 abstract（它没有"属于哪个账号"这回事），本文件补上玩家特有的那一点：
 * **角色标识**与**会话阶段**。
 *
 * ★ 为什么要有 `Player` 而不是拿 `Npc` 顶：
 *   `Npc` 一定带模板（`path: WorldId`），而玩家角色**没有模板来源** —— 它由存档构造。
 *   用 Npc 顶会让"这个角色来自哪个模板"这个问题在玩家身上得到错误答案。
 *
 * ★ `phase`（登录期 / 游戏中）：
 *   wushen 把登录流程挂在 `extends/login.js` 的 `wait_login` 上，
 *   靠"当前有没有接到登录处理器"这种**外部状态**决定放行哪些指令 ——
 *   于是"玩家在登录期敲了 help"这类问题得靠流程自己保证。
 *   这里把阶段做成角色**自己的字段**：`dispatch({ phase })` 由它派生，
 *   于是"登录期只放行 allow_login 指令"是角色状态的函数，不是流程的自觉。
 *
 * ⚠️ 本批次**不含**账号系统与存档（见 `server/session.ts` 的说明）：
 *   这里的 `roleId` 只是一个标识串，真实取角色名 / 属性 / 背包要等存档批次。
 */

import { Character } from './character.js';
import type { CharacterInit } from './character.js';

/** 会话阶段。`'login'` 时只放行 `allow_login` 指令（见 `engine/command.ts`） */
export type PlayerPhase = 'login' | 'playing';

export interface PlayerInit extends CharacterInit {
  /** 角色标识（存档批次之前：它就是登录包里的 `role_id`） */
  readonly roleId: string;
  /** 初始阶段；缺省 `'playing'`（已登录） */
  readonly phase?: PlayerPhase;
}

export class PlayerError extends Error {
  public override readonly name = 'PlayerError';
}

export class Player extends Character {
  public readonly roleId: string;
  /**
   * 会话阶段。
   *
   * ★ 可写，但只有**登录流程**该写它（`server/session.ts`）。
   *   这里不做成私有 + setter，是因为它要能进存档（读档后玩家可能停在登录期）。
   */
  public phase: PlayerPhase;

  public constructor(init: PlayerInit) {
    if (typeof init.roleId !== 'string' || init.roleId.trim() === '') {
      throw new PlayerError(`Player 需要非空 roleId，收到 ${JSON.stringify(init.roleId)}`);
    }
    // ★ 玩家**没有模板来源**：`path` 一律 null（`GameObjectInit.path` 就是这个语义）
    super({ ...init, path: init.path ?? null }, 'player');
    this.roleId = init.roleId;
    this.phase = init.phase ?? 'playing';
  }

  /** 是否已进入游戏（登录期 = 还没选完角色 / 还没进房间） */
  public get isPlaying(): boolean {
    return this.phase === 'playing';
  }

  /**
   * 死亡收尾：**留在房间**（灵魂状态）+ 发 `die` 包（带复活入口）。
   *
   * ★ wushen 的玩家死法是"生成 corpse + `item_changed(this, false)` 移出房间 +
   *   前端弹『去武庙复活 / 原地复活』"（`os/char/user.js:379-405`）。
   *   本项目**不建尸体**，而"把玩家摘出房间"会让客户端失去一切上下文
   *   （房间不推了、也看不到自己），于是这里选**留房间**：
   *   `hp=0` ⇒ `isAlive=false` ⇒ 六道闸门（`allow_die` 缺省拒绝）自然挡住绝大多数指令，
   *   加上 `die` 包里的复活按钮，闭环就完整了。
   */
  protected override afterDeath(): void {
    this.sendDieFrame([{ cmd: 'relive', name: '复活' }]);
  }

  public override toString(): string {
    return `player:${this.roleId}(${this.oid})`;
  }
}

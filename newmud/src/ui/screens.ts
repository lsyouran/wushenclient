/**
 * src/ui/screens.ts — 顶层屏幕切换（认证 ↔ 游戏）
 * ============================================================================
 * 全站只有两块顶层屏幕：`#auth`（登入 / 新建角色）与 `#app`（游戏界面）。
 * 同一时刻只显示一块 —— 这个"谁显示"的判断只写在这里一处，别处一律调这两个函数。
 *
 * ★ 为什么值得单开一个文件（而不是塞进 `main.ts`）：
 *   接线层 `main.ts` 认识**所有**模块（连接 / 房间 / 地图 / 工具条 / 面板 / 认证）；
 *   而 `auth.ts` 只认识认证面板，不该知道工具栏，反之亦然。两边都要切屏，
 *   于是把"切屏"这件小事提到两者共同的**下层**，依赖仍是单向的：
 *   `auth.ts / room.ts / bars.ts … → screens.ts → dom.ts`，
 *   谁都不需要 import `main.ts`（否则就是循环依赖）。
 *
 * ★ 用 `hidden` 属性而不是 class：`hidden` 是浏览器原生的语义，`display:none`
 *   由 CSS 的 `[hidden]` 兜底 —— 于是"看不见"和"读屏器不播"是同一件事，
 *   不需要额外维护一个 `aria-hidden`（旧版只有一个可见页面，还没有这个问题）。
 */

import { need } from './dom.js';

export type Screen = 'auth' | 'game';

/** 切到某块屏幕（另一块自动隐藏） */
export function showScreen(which: Screen): void {
  need('auth').hidden = which !== 'auth';
  need('app').hidden = which !== 'game';
}

/** 当前显示的是哪块屏（测试与自检用） */
export function currentScreen(): Screen {
  return need('app').hidden ? 'auth' : 'game';
}

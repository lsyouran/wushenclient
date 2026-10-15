/**
 * src/ui/status.ts — 底部状态条（wushen 的 `.state-bar`）
 * ============================================================================
 * 名号 · 等级 · 气血 · 内力，横排一行，**常驻在最底下**。
 *
 * ★ wushen 的 `.state-bar` 默认 `visibility:hidden`（只有 `state` 帧来了才显形），
 *   气血/内力则靠房间列表里那一小条。这里把它**常驻**：`sc` 帧本来就会推这些值，
 *   藏起来等于白收（26 册 §18.6 记过这条）。
 *
 * ★ `max` 为 0 时显示 `—` 而不是 `0/0`：`0/0` 会被读成"血空了"，
 *   而真实含义是"服务端还没告诉我上限"。
 *
 * ★ 这里只画**服务端说过的事**：名号来自 `login` 帧、数值来自 `sc` 帧。
 *   没有"当前正在打坐"这类字段 —— 服务端不发 `state` 帧（内容层还没有长动作），
 *   凭空占一格只会是永远空着的占位。
 */

import { need } from './dom.js';
import { showScreen } from './screens.js';
import { state } from '../state.js';

function pct(value: number, max: number): number {
  if (max <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((value / max) * 100)));
}

function gauge(fillId: string, textId: string, value: number, max: number): void {
  const fill = need(fillId);
  const text = need(textId);
  if (max <= 0) {
    fill.style.width = '0%';
    text.textContent = '—';
    return;
  }
  fill.style.width = `${String(pct(value, max))}%`;
  text.textContent = `${String(value)}/${String(max)}`;
}

export function renderStatus(): void {
  const v = state.vitals;
  need('pName').textContent = state.roleId === '' ? '—' : state.roleId;
  need('pLevel').textContent = v.level > 0 ? `Lv.${String(v.level)}` : '';
  gauge('hpFill', 'hpTx', v.hp, v.maxHp);
  gauge('mpFill', 'mpTx', v.mp, v.maxMp);
}

/**
 * 进入游戏屏：切屏 + 画状态条。
 *
 * ★ 顺序是**先切屏再画**：屏还藏着时元素高度为 0，先画会拿到一堆 0
 *   （小地图的 SVG 尤其明显，所以那条顺序在 `map.ts` 里也成立）。
 *   房间区/地图不在这里重画 —— 它们各自由 `room` / `exits` 帧驱动。
 */
export function showGame(): void {
  showScreen('game');
  renderStatus();
}

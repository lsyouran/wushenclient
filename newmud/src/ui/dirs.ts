/**
 * src/ui/dirs.ts — 方向的**视觉**映射
 * ============================================================================
 * ★ 中文方向名**不在这里**：它在 `shared/constants.ts` 的 `DIRECTION_LABELS`。
 *   这里只放"只对界面有意义"的东西：小地图的**槽位表**与**槽位分配器**。
 *
 *   - `SLOT_POS`   —— 九宫格 8 个外围格位的坐标（viewBox 单位）
 *   - `DIR_SLOTS`  —— 方向 → 格位**偏好顺序**（取第一个空着的）
 *   - `placeExits` —— 分配器：保证**一个格位最多一个格子**
 *
 * ★ 为什么是"偏好顺序"而不是"一个方向一个固定坐标"（wushen 的做法）：
 *   `up` 与 `north` 语义上是两个方向（上楼 / 往北），一个房间可以**同时**有，
 *   而九宫格只有 8 个外围格位 —— 固定坐标会让它们落在**同一点**，
 *   后画的把先画的整个盖掉，玩家直接看不见其中一个（真机实测：注入
 *   `{north, up, east, enter}` 后屏幕上只剩"上"和"进入"）。
 *
 *   wushen 用 `north_2` 这类"改名"把冲突的那个挪到斜角，但只处理了
 *   north/south 两组 —— `east` + `enter`、`west` + `out` 照样重叠。
 *   这里统一成"偏好顺序 + 先到先得"：冲突时自动退到次选格位，**永不重叠**；
 *   格位真的用光（>8 个方向）时该方向不上地图，但**出口行里照样能点**
 *   （信息不因为画不下就消失）。
 */

import { DIRECTION_LABELS, normalizeDirection } from '../../shared/constants.js';

export { DIRECTION_LABELS };

/**
 * 九宫格的 8 个外围格位（**坐标系** 216×96：中心 108,48 · 格子 36×18 刚好不碰）。
 *
 * ★ 216×96 只是坐标系的取值，**不是画出来的框**：`map.ts` 每次按"实际画了哪些格子"
 *   算 `viewBox`（方向少的房间框就矮，照 wushen 的 `height`/`t`）。所以这里改坐标
 *   只影响格子间距，不会把地图撑大或缩小。
 */
export type Slot = 'N' | 'S' | 'E' | 'W' | 'NE' | 'NW' | 'SE' | 'SW';

export const SLOT_POS: Readonly<Record<Slot, readonly [number, number]>> = {
  N: [108, 18],
  S: [108, 78],
  E: [172, 48],
  W: [44, 48],
  NE: [156, 25.5],
  NW: [60, 25.5],
  SE: [156, 70.5],
  SW: [60, 70.5],
};

/**
 * 方向 → 格位偏好顺序。
 *
 * 前缀表示"这个方向想往哪边靠"：上楼想要北边、进入想要东边…… 冲突时才退到次选。
 * 带上下标的方向（`northup` 等 8 个）与对应正方向同列 —— 它们本来就是
 * "北边那条路上的上/下层"，不该另开一格。
 */
export const DIR_SLOTS: Readonly<Record<string, readonly Slot[]>> = {
  north: ['N', 'NE', 'NW'],
  northup: ['N', 'NE', 'NW'],
  northdown: ['N', 'NE', 'NW'],
  up: ['N', 'NE', 'NW'],

  south: ['S', 'SE', 'SW'],
  southup: ['S', 'SE', 'SW'],
  southdown: ['S', 'SE', 'SW'],
  down: ['S', 'SE', 'SW'],

  east: ['E', 'NE', 'SE'],
  eastup: ['E', 'NE', 'SE'],
  eastdown: ['E', 'NE', 'SE'],
  enter: ['E', 'NE', 'SE'],

  west: ['W', 'NW', 'SW'],
  westup: ['W', 'NW', 'SW'],
  westdown: ['W', 'NW', 'SW'],
  out: ['W', 'NW', 'SW'],

  northeast: ['NE', 'N', 'E'],
  northwest: ['NW', 'N', 'W'],
  southeast: ['SE', 'S', 'E'],
  southwest: ['SW', 'S', 'W'],
};

/** 基本八方向（它们先挑，因为每个只有一个"正位"可用） */
const PLAIN = new Set([
  'north',
  'south',
  'east',
  'west',
  'northeast',
  'northwest',
  'southeast',
  'southwest',
]);

/** 上/下/进/出（语义独立，但要与正方向抢格子） */
const VERTICAL = new Set(['up', 'down', 'enter', 'out']);

function priorityOf(dir: string): number {
  if (PLAIN.has(dir)) return 0;
  if (VERTICAL.has(dir)) return 1;
  return 2;
}

export interface PlacedExit {
  readonly dir: string;
  /** 格子的中心坐标（viewBox 单位） */
  readonly pos: readonly [number, number];
}

/**
 * 把一组方向分配到九宫格格位上。
 *
 * 返回**按传入顺序**排列（= 服务端给出口表的顺序）—— DOM 顺序因此稳定，
 * 「换房间后格子跟着换」这类断言才有确定的期望值。
 *
 * @param dirs 出口表的方向键（`state.exits` 的 key）
 */
export function placeExits(dirs: readonly string[]): PlacedExit[] {
  const used = new Set<Slot>();
  const slotOf = new Map<string, Slot>();

  // 先分"基本方向"，再分上/下/进/出，最后才是带上下标的；同级按传入顺序
  const ordered = dirs
    .map((dir, index) => ({ dir, index }))
    .sort((a, b) => priorityOf(a.dir) - priorityOf(b.dir) || a.index - b.index);

  for (const { dir } of ordered) {
    if (slotOf.has(dir)) continue; // 同一个方向只占一格
    const prefs = DIR_SLOTS[dir];
    if (prefs === undefined) continue; // 不认识的方向不上地图（出口行里还有）
    const free = prefs.find((s) => !used.has(s));
    if (free === undefined) continue; // 8 格用光了
    used.add(free);
    slotOf.set(dir, free);
  }

  const placed: PlacedExit[] = [];
  for (const dir of dirs) {
    const slot = slotOf.get(dir);
    if (slot !== undefined) placed.push({ dir, pos: SLOT_POS[slot] });
  }
  return placed;
}

/**
 * 这个词是不是一个方向（全称或短写都算）。
 *
 * ★ 用它把"移动"从"可做之事"里分出来：服务端把方向动作和内容动作
 *   一起放在 `room.commands` 里（它们是同一张动作表），
 *   而界面要分开放 —— 出口在"明显出口"、小地图格子上，别的才进"可做之事"。
 *   判据走 `normalizeDirection`（与后端同一个函数），不在前端再判一次。
 */
export function isDirection(word: string): boolean {
  return normalizeDirection(word.trim().toLowerCase()) !== null;
}

/** 方向的显示名（未知方向原样返回，宁可显示英文也不要空着） */
export function dirLabel(dir: string): string {
  const norm = normalizeDirection(dir.trim().toLowerCase());
  return norm === null ? dir : DIRECTION_LABELS[norm];
}

/**
 * src/ui/map.ts — 小地图（wushen 的 `.map-panel`）
 * ============================================================================
 * wushen 的小地图要**单击**房名旁的图标才出（`game/main.js` 的
 * `.room-title>.map-icon` → `MAP.LoadMap`，绑的是 `click`）。
 * 这里保留那个入口（房名右侧「地图」），但只画**当前房间的出口九宫格** ——
 * 与 `state.exits` 同源，不需要服务端额外下发一张大图。
 *
 * ★ wushen 的 `map` / `updatemap` 帧（整片区域大地图）在这里**不消费**：
 *   那两个包描述的是"更大范围的位置图"，newmud 的服务端**还没有生产者**
 *   （`world.ts` 收到时如实说出来，不假装处理了）。
 *
 * ★ 点格子即走：发出去的是**方向词本身**（`north`），不是中文 ——
 *   服务端把方向词当房间动作接住（见 `server/engine/room.ts`）。
 *   中文只是显示层的事（wushen 也是这么分工的）。
 *
 * ★ 格子坐标由 `dirs.ts` 的 `placeExits()` 分配（**偏好顺序 + 先到先得**），
 *   不是"一个方向写死一个坐标" —— 后者会让 `up` 与 `north` 落在同一点、
 *   后画的把先画的盖掉（wushen 只处理了 north/south 两组，enter/out 仍会撞）。
 *
 * ★ 格子里写**目的地房名**，不写方向（wushen 的 `map.js` 也是这么做的：
 *   `CreateExitsMap` 把 `exits[dir]` —— 也就是目的房间的显示名 —— 直接画进格子）。
 *   方向**不用写字**：格子摆在九宫格的哪一格就是哪个方向，那正是九宫格的意义。
 *   曾经写的是方向字（理由是"房名太长会被截成扬州城-"）—— 那个理由不成立：
 *   wushen 的 `CreateExitsMap` 一开头就把「城-」前缀和括号去掉了（见 `shortRoomName`），
 *   再加一层「按格子宽度截断」（见 `cellLabel`），格子里不会有半截长串。
 *   房名比方向有用得多：玩家说得出「南边是客栈」，说不出「南边是哪条街」。
 *   方向本身没丢 —— 出口行里是方向词，格子 `<title>` 里是「方向 · 完整房名」。
 *
 * ★ **字号只有一个、全图统一**，长名字靠**截断**而不是靠**缩字号**来装下：
 *   wushen 就是写死的 `style="font-size:12px;"`（60 宽的格子放 5 个字），
 *   从来没有"按字数算字号"这回事。我一度自己加了这个按字数缩的算法，
 *   结果是同屏出现 4 号字和 7 号字两档大小、一眼就看出不齐 —— 已经删掉。
 *   装不下的名字由 `cellLabel()` 截成「前几字 + …」，字号恒定。
 *
 * ★ 渲染函数是**纯的**（只产节点，不绑事件）：点击由 `bindMap()` 在 `<svg>`
 *   上委托一次完成。这里刻意**不用** `dom.ts` 的 `delegate()` —— 它收
 *   `HTMLElement`，而 SVG 元素是 `SVGElement`。
 */

import { clear, need, on } from './dom.js';
import { dirLabel, placeExits } from './dirs.js';
import { plainText } from './markup.js';
import { state } from '../state.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * 画布宽度（**恒定**，中心 = 它的一半）。
 *
 * ★ 宽度写死 216 有两个理由：
 *   ① 比例恒定 ⇒ 换房间时格子大小与字号**不会忽大忽小**（框的高度会变，见 `renderMap`）；
 *   ② wushen 也是把 60 宽的格子居中摆在**整个容器宽度**里（`l = (w - unitW)/2`），
 *      横向留白是原样照抄的。
 */
const CANVAS_W = 216;
/** 九宫格中心（在画布水平正中、第 2 行） */
const CX = CANVAS_W / 2;
const CY = 48;
/** 格子尺寸（与 `SLOT_POS` 的间距配套：36×18 在 8 个格位上两两不碰） */
const CELL_W = 36;
const CELL_H = 18;

/**
 * 框在**上下**留的边（viewBox 单位）：贴着格子显得挤。
 * 只留上下 —— 左右是"居中摆在整个宽度里"，见 `CANVAS_W`。
 */
const FRAME_PAD_Y = 4;

/**
 * 格子文字的字号（**viewBox 单位**，不是屏幕像素 —— SVG 会整体缩放）。
 *
 * ★ **全图一个字号，永不按字数缩。** wushen 的 `CreateExitsMap` 就是写死的
 *   `style="font-size:12px;"`，它从没算过字号；装不下是**截断**（见 `cellLabel`）。
 *
 * ★ `font-size` 由这里**唯一**决定，`style.css` 不再给 `.ceg text` / `.ccg text`
 *   配字号 —— 两边各写一份就会出现"按 8 算、按 X 画"的静默越界。
 *   （`tests/web-ui.test.ts` 有一条断言钉着"CSS 里不许再写一份"。）
 *
 * ★ 为什么是 8：`tests` 与 `probe9.mjs` 在**本站字体栈**（`Microsoft YaHei UI` …）
 *   下实测 CJK 推进宽度**恰好 1.00 em**（6/7/8/9/10 号逐一量过，与字号成正比），
 *   所以「字号 = 一个字占多少 viewBox 单位」。32 单位的可用宽 ÷ 8 = 刚好 4 个字，
 *   而内容层最长的房名尾巴就是 4 个字（「中央广场」）—— 真名一个都不会被截。
 *   比例 8/36 ≈ 0.22，与 wushen 的 12/60 = 0.2 同档（屏幕上 ≈11px vs 它的 12px）。
 */
const BASE_FONT = 8;
/** 文字两侧的留白（viewBox 单位）：不贴着边框 */
const TEXT_PAD = 4;

/**
 * 一个格子里最多写几个字（**含结尾的「…」占掉的那一格**）。
 *
 * ★ 由格子宽度**推**出来，不是另写一个数：它和 `BASE_FONT` 共用同一个 1 em/字
 *   的实测量，改格子宽度就会自动跟着变。`= 4`。
 * ★ 长名字截成「前 3 字 + …」而不是把字号压小 —— 同屏字号不一致比少一个字更难看。
 */
export const cellMaxChars = Math.floor((CELL_W - TEXT_PAD) / BASE_FONT);

/**
 * 造一个 SVG 元素（`document.createElement` 只会造 HTML 元素）
 */
function svg<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Readonly<Record<string, string | number>>,
  text?: string,
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * 房间显示名 → 格子里那一小串字。
 *
 * ★ 规则**逐条照抄** wushen `map.js` 的 `CreateExitsMap` 开头三行：
 *   先按 `-` 切、取**最后一段**，再去掉括号里的内容。
 *   于是「扬州城-北大街」→「北大街」，「扬州城-中央广场(集市)」→「中央广场」。
 *   （新内容的房名就是这个格式：`world/room/yz/*` 都叫「扬州城-XXX」。）
 *
 * ★ 与 wushen 的三点不同，都是为了不出现"格子里是空的/格子里是残句"：
 *   ① wushen 只对**中心格**做这两步，邻居格写的是原始全名（`CreateExitsMap` 里
 *      `name` 只被处理过中心那一次）—— 于是邻居格会显示「扬州城-北大街」这种满是
 *      前缀的长串。这里**两边都过**。
 *   ② wushen 只处理半角括号；中文房名里全角同样常见，两种都去掉。
 *   ③ 截完什么都不剩（「扬州城-」）就退回原名 —— 宁可见到原文，也不要空格子。
 *
 * ★ 这一步**只管前缀与括号**，不管"太长怎么办"：装不下的问题归 `cellLabel()`
 *   的截断（字号是固定的，不能再靠缩字号）。
 */
export function shortRoomName(name: string): string {
  const raw = name.trim();
  if (raw === '') return raw;
  const segs = raw.split('-');
  const tail = segs.length > 1 ? (segs[segs.length - 1] ?? raw) : raw;
  const stripped = tail.replace(/[(（][^)）]*[)）]/, '').trim();
  return stripped === '' ? raw : stripped;
}

/**
 * 房间显示名 → 格子里那一小串字（**唯一**的格子文案入口）。
 *
 * 三步，每一步都有出处：
 *   ① `plainText` —— wushen 的 `pushName` 先用 `REG= /<(\w+)>(.+)<\/\w+>/` 把标签摘掉。
 *      这里只摘不配色：服务端发的 `exits.items` 是 `target.name`，内容层并没有
 *      给房名上色的生产者，凭空按 wushen 的调色板染色就是自己加戏。
 *   ② `shortRoomName` —— 去「城-」前缀、去括号（wushen 原样照抄的两行）。
 *   ③ **截断** —— 超过 `cellMaxChars` 就留前几字 + 「…」。
 *      wushen 没有这一步，因为它那张图的房名天然 ≤5 字；newmud 的房名可以更长，
 *      而字号是固定的，所以只能从"字数"这一头收 —— 截断后**一定**装得下。
 */
export function cellLabel(name: string): string {
  const short = shortRoomName(plainText(name));
  const chars = [...short];
  if (chars.length <= cellMaxChars) return short;
  return chars.slice(0, cellMaxChars - 1).join('') + '…';
}

/** 由 `main.ts` 注入：点格子要执行什么 */
let runner: (cmd: string) => void = () => undefined;

export function setMapRunner(fn: (cmd: string) => void): void {
  runner = fn;
}

export function renderMap(): void {
  const node = need<SVGSVGElement>('mapSvg');
  clear(node);

  // 中心格**永远**画，所以框至少要装下它
  let top = CY - CELL_H / 2;
  let bottom = CY + CELL_H / 2;

  for (const { dir, pos } of placeExits(Object.keys(state.exits))) {
    const [x, y] = pos;
    top = Math.min(top, y - CELL_H / 2);
    bottom = Math.max(bottom, y + CELL_H / 2);

    const dest = (state.exits[dir] ?? '').trim();
    const label = dest === '' ? dirLabel(dir) : cellLabel(dest);

    node.appendChild(svg('line', { x1: CX, y1: CY, x2: x, y2: y, stroke: '#2c2c2c' }));

    const g = svg('g', { class: 'ceg' });
    g.setAttribute('data-dir', dir);
    // 悬停提示把**方向 + 完整房名**还回来：格子只放得下短名（还会被截），
    // 而"往哪走"这件事在格子上是靠位置表达的，鼠标用户多给一条明确的路。
    // —— 这里用**没截断**的名字，否则提示里也是省略号，等于没得看。
    g.appendChild(svg('title', {}, dest === '' ? dirLabel(dir) : `${dirLabel(dir)} · ${plainText(dest)}`));
    g.appendChild(svg('rect', { x: x - CELL_W / 2, y: y - CELL_H / 2, width: CELL_W, height: CELL_H, rx: 4 }));
    g.appendChild(
      svg('text', { x, y: y + BASE_FONT / 2, class: 'et', 'font-size': BASE_FONT, 'text-anchor': 'middle' }, label),
    );
    node.appendChild(g);
  }

  // 中心 = 当前所在（点它 = 环顾）
  const here = cellLabel(state.room?.name ?? '?');
  const cg = svg('g', { class: 'ccg' });
  cg.appendChild(svg('title', {}, `${plainText(state.room?.name ?? '?')}（点这里环顾）`));
  cg.appendChild(svg('rect', { x: CX - CELL_W / 2, y: CY - CELL_H / 2, width: CELL_W, height: CELL_H, rx: 4 }));
  cg.appendChild(
    svg('text', { x: CX, y: CY + BASE_FONT / 2, class: 'cm', 'font-size': BASE_FONT, 'text-anchor': 'middle' }, here),
  );
  node.appendChild(cg);

  // ★ 框**跟着画了的东西收放**，不是写死 216×96。
  //   wushen 的 `height`/`t` 就是算出来的（`map.js:11-37`）：
  //   `height = unitY + 10`，有南向 `+30`、有北向再 `+30` 并把中心行下移 ——
  //   **方向少 → 框就矮，不占空位**。这里取"所有格子的并集 + 上下留白"，
  //   比按"用了几行"更省：斜角格只占半行时，框也只跟着涨半行。
  //   （内容层真实房间往往只有一两个出口，写死 96 时那一大片空白就是这个原因。）
  //   ★ 宽度不跟着收 —— 见 `CANVAS_W` 的两条理由。
  const y0 = Math.round(top - FRAME_PAD_Y);
  const h = Math.round(bottom - top + FRAME_PAD_Y * 2);
  node.setAttribute('viewBox', `0 ${String(y0)} ${String(CANVAS_W)} ${String(h)}`);
}

/**
 * **真的画在地图上**的方向（测试用）。
 *
 * ★ 不等于"所有出口"：九宫格只有 8 个格位，方向多于 8 个时后分的画不下 ——
 *   那种方向仍然在出口行里能点（见 `dirs.ts` 的 `placeExits`）。
 */
export function mappedDirs(): readonly string[] {
  return placeExits(Object.keys(state.exits)).map((p) => p.dir);
}

/** 地图当前是不是展开的 */
export function mapOpen(): boolean {
  return !need('mapPanel').hidden;
}

export function toggleMap(force?: boolean): void {
  const panel = need('mapPanel');
  panel.hidden = force === undefined ? !panel.hidden : !force;
}

export function bindMap(): void {
  const map = need<SVGSVGElement>('mapSvg');
  map.addEventListener('click', (ev) => {
    const target = ev.target;
    if (!(target instanceof Element)) return;
    const cell = target.closest('.ceg');
    if (cell !== null) {
      const dir = cell.getAttribute('data-dir') ?? '';
      if (dir !== '') runner(dir);
      return;
    }
    if (target.closest('.ccg') !== null) runner('look');
  });

  on(need('mapBtn'), 'click', () => toggleMap());
}

/**
 * src/ui/markup.ts — 颜色标签 → **真 DOM 节点**
 * ============================================================================
 * wushen 的做法是拼字符串再 `.html(...)`（`Process.create_roomitem` 里
 * `str.push("<span class='item-name'>")`，房间描述直接进 DOM 的 HTML 口子）。
 * 于是服务端回显什么，页面就**执行**什么 —— 玩家改名成 `<img onerror=…>`
 * 就能让所有同房间的人执行它。
 *
 * 这里改成**解析成节点**：
 *   - 只认白名单标签（`HIR` / `HIY` / `line` …），不在白名单的一律
 *     当**文本**原样显示 —— 于是 `<script>` 只是四个字符，不是一个脚本节点；
 *   - 文本走 `createTextNode`，从不经过 HTML 解析器。
 *
 * ★★ 白名单里**没有** `CMD`。可点按钮只有 `CmdItem` 一条结构化通道，
 *   自由文本里的按钮已删除 —— 理由见下面 `§CMD` 一节的完整论证（审查 S1）。
 *
 * ★ 与 `dom.ts` 的分工：`dom.ts` 是"怎么建节点"，这里是"服务端文本里那些
 *   尖括号是什么意思"。两条路都不碰 `innerHTML`。
 *
 * ★ 为什么不用 `DOMParser`：`parseFromString(text, 'text/html')` 一样会创建
 *   script/img 节点（只是不执行），且产物不可控。白名单解析器的代价是几十行，
 *   换来的是"能进 DOM 的标签"这个集合被显式写出来。
 */

/**
 * 能进 DOM 的标签（**大小写不敏感**，与 wushen 的 CSS 选择器一致）。
 *
 * ★ 这份清单必须与 wushen `global.css` 的**同名规则**对齐：白名单里少一个，
 *   服务端一旦用了那个标签就会**把尖括号当普通文字吐出来**（`<mem>旁注</mem>`
 *   变成可见的十个字符），而 wushen 那边同样一段文本渲染得好好的 ——
 *   表现成"同一个房间在两边长得不一样"，且非常难查。
 */
const KNOWN = new Set([
  // 暗色（wushen global.css 的 NOR/BLK/… ）
  'NOR', 'GRE', 'BLK', 'BLU', 'CYN', 'RED', 'MAG', 'YEL', 'WHT', 'ORA',
  // 亮色（HIK/HIB/…）
  'HIK', 'HIB', 'HIG', 'HIC', 'HIR', 'HIM', 'HIY', 'HIW', 'HIO', 'HIJ', 'HIZ', 'ORD',
  // 背景色（`B*` 与 `HB*` 两族）
  'BBLK', 'BBLU', 'BCYN', 'BRED', 'BMAG', 'BYEL', 'BWHT', 'BHIK',
  'HBBLU', 'HBGRN', 'HBCYN', 'HBRED', 'HBMAG', 'HBYEL', 'HBWHT',
  // 版式（★ 不含 `CMD`：可点按钮只有 `CmdItem` 一条路，见下面 §CMD）
  'DEL', 'MEM', 'OPT', 'FLA', 'LINE',
]);

/**
 * §CMD —— 白名单里**为什么不放**交互标签（2026-10-16 审查 S1）
 * ---------------------------------------------------------------------------
 * 这里原先有一档 `'CMD'`：服务端文本里写 `<CMD cmd="look 3">看看</CMD>` 就得到一颗
 * 点击后执行该指令的按钮（`addEventListener('click', () => cmdRunner(cmd))`）。
 *
 * ★ **它躲过了这条白名单的全部防线，因为它自己就在白名单里。**
 *   白名单拦的是"名单外的攻击"（`<script>` 之类），拦不住"用名单内合法能力干的事"。
 *   于是任何能被拼进下行文本的玩家可控内容都成了"在别人屏幕上植一颗按钮"的机会：
 *     - `say` / `tell` / `shout` 的正文；
 *     - **尤其是角色名** —— 名字经 `$N` 进**每一句**播报，且房间列表也用它渲染
 *       （`src/ui/room.ts:92`）⇒ **不用开口**，站在房间里就在给全房间植按钮。
 *
 * ★ 而删除它的代价是 **零**：全仓（内容层 + 服务端）本来就没有 `<CMD>` 生产者，
 *   grep 下来唯一的"消费者"是 `main.ts` 里给 runner 接线那一行。
 *   可点按钮在本项目里早有一条**结构化正道**：`CmdItem`
 *   （`cmds` / `actions` 帧、`showWarn`、`openPanel`、`room.commands`、消息流的命令行）。
 *   那边是**数据与显示分离** —— 文案走 `textContent`，指令走 `dataset.cmd`，
 *   玩家文本再怎么掺也伪造不出一颗按钮。
 *   ⇒ 自由文本里的按钮是这套机制的**重复且更弱的那一份**（24 册铁律 4：第二份就删）。
 *
 * ⇒ 现在的形态：`<CMD …>` 落在白名单之外，与 `<script>` 同等 ——
 *   **原样显示为一串字符**。将来若真需要"正文中间嵌按钮"，应当扩展 `CmdItem`。
 */

/** 开标签（含可选属性）· sticky，逐段扫描 */
const TAG_RE = /<(\/?)([A-Za-z][A-Za-z0-9]*)((?:\s+[A-Za-z-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*>/y;

/** 属性串目前一律不落 DOM（见上面 `§CMD`；`TAG_RE` 仍解析它，是为了匹配完整标签） */

/**
 * 嵌套**深度上限**（S13，2026-10-16 审查）。
 *
 * ★ 文本长度受出站包大小守卫约束 —— 但"长度受限"**不等于**"嵌套受限"：
 *   一个由 ~10 万个 `<HIR>` 组成的包可以在边界之内打出 ~10 万层递归 ⇒
 *   `RangeError: Maximum call stack size exceeded`，而异常发生在**消息流渲染路径**上
 *   （`state` 已更新、界面没跟上，只留一行"包处理出错"）。
 *
 * ★ 32 层远超真实文本的需要（`<HIR><HIY>…</HIY></HIR>` 这种嵌套通常 ≤3 层）。
 *   超出部分按**文本**显示 —— 与"白名单外的标签"同等待遇：不隐藏、也不建节点。
 */
const MAX_NESTING_DEPTH = 32;

/** 把一段服务端文本解析成节点，追加进 `parent` */
export function renderMarkup(text: string, parent: Node): void {
  parseInto(text, 0, null, parent);
}

/** 解析成独立片段（调用方自己决定挂哪儿） */
export function markupFragment(text: string): DocumentFragment {
  const frag = document.createDocumentFragment();
  parseInto(text, 0, null, frag);
  return frag;
}

/** 用一段服务端文本**整体替换**容器内容（纯函数式渲染用） */
export function fillMarkup(node: Element, text: string): void {
  node.replaceChildren(markupFragment(text));
}

/**
 * 取一段服务端文本的**纯文字**：白名单标签剥掉，白名单外的 `<…>` 照原样留着。
 *
 * ★ 为什么要有它：`title` / `aria-label` / 小地图的 `<text>` 这些地方**只能放字符串**，
 *   放不下 DOM 节点，于是需要"带标签的文本 → 纯文本"这一步。
 * ★ 为什么在这里实现、而不是各自写个 `replace(/<[^>]*>/g,'')`：标签语法只认
 *   白名单这一份（`KNOWN` + `TAG_RE`）。自己写正则的那份会把 `<未知>` **悄悄吃掉**，
 *   于是同一段文本在消息流里是可见的尖括号、在标题里凭空消失 —— 两处不一致最难查。
 *   这里直接复用解析器，行为必然与 `renderMarkup` 一致。
 */
export function plainText(text: string): string {
  const box = document.createElement('span');
  parseInto(text, 0, null, box);
  return box.textContent;
}

/**
 * 递归解析。
 *
 * @param depth 当前嵌套层数（顶层 = 0）。**必须有上限**：见 `MAX_NESTING_DEPTH`
 * @returns 结束位置（`closeTag` 的闭标签之后 / 文本末尾）
 */
function parseInto(
  text: string,
  from: number,
  closeTag: string | null,
  out: Node,
  depth = 0,
): number {
  let i = from;
  let buf = '';

  const flush = (): void => {
    if (buf !== '') {
      out.appendChild(document.createTextNode(buf));
      buf = '';
    }
  };

  while (i < text.length) {
    const at = text.indexOf('<', i);
    if (at < 0) {
      buf += text.slice(i);
      break;
    }
    buf += text.slice(i, at);

    TAG_RE.lastIndex = at;
    const m = TAG_RE.exec(text);
    if (m === null) {
      // 不是合法标签（`<` 后面乱写）→ 当普通字符
      buf += '<';
      i = at + 1;
      continue;
    }

    const closing = m[1] === '/';
    const name = (m[2] ?? '').toUpperCase();
    const attrs = m[3] ?? '';
    i = TAG_RE.lastIndex;

    // ★ 白名单之外（**开闭都算**）一律原样显示：`<script>…</script>` 是两串字符，
    //   不是一个节点。只判开标签会把闭标签静默吞掉，玩家看到的文本就缺一块。
    if (!KNOWN.has(name)) {
      buf += m[0];
      continue;
    }

    if (closing) {
      if (closeTag !== null && name === closeTag) {
        flush();
        return i; // 本层结束
      }
      // 多余的闭标签：忽略（不显示、也不当成文本）
      continue;
    }

    flush();
    // ★ 深度到顶 ⇒ 这个开标签当**文本**（不建节点、不递归）。见 `MAX_NESTING_DEPTH`。
    if (depth >= MAX_NESTING_DEPTH) {
      buf += m[0];
      continue;
    }
    const el = document.createElement(name);
    // ★ 属性不落 DOM：可点按钮只由 `CmdItem` 产生（见文件头 `§CMD`）。
    //   这里保留 `attrs` 的解析只为"完整匹配一个标签"，不把它变成能力。
    void attrs;
    out.appendChild(el);
    i = parseInto(text, i, name, el, depth + 1);
  }

  flush();
  return text.length;
}

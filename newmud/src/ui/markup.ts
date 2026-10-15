/**
 * src/ui/markup.ts — 颜色标签 → **真 DOM 节点**
 * ============================================================================
 * wushen 的做法是拼字符串再 `.html(...)`（`Process.create_roomitem` 里
 * `str.push("<span class='item-name'>")`，房间描述直接进 DOM 的 HTML 口子）。
 * 于是服务端回显什么，页面就**执行**什么 —— 玩家改名成 `<img onerror=…>`
 * 就能让所有同房间的人执行它。
 *
 * 这里改成**解析成节点**：
 *   - 只认白名单标签（`HIR` / `HIY` / `line` / `CMD` …），不在白名单的一律
 *     当**文本**原样显示 —— 于是 `<script>` 只是四个字符，不是一个脚本节点；
 *   - 文本走 `createTextNode`，从不经过 HTML 解析器。
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
  // 版式与交互
  'DEL', 'MEM', 'OPT', 'FLA', 'LINE', 'CMD',
]);

/** 开标签（含可选属性）· sticky，逐段扫描 */
const TAG_RE = /<(\/?)([A-Za-z][A-Za-z0-9]*)((?:\s+[A-Za-z-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*>/y;

/** 从属性串里取 `cmd="…"`（wushen 的 `<xxx cmd='look id'>看</xxx>` 形态） */
const CMD_ATTR_RE = /^\s*cmd\s*=\s*(?:"([^"]*)"|'([^']*)')\s*$/i;

/**
 * 运行器：**点击 `<CMD>` 标签**时把指令发出去。
 * 由 `main.ts` 注入（与别处同一个 `run()`，避免"点标签"和"点按钮"两条路）。
 */
let cmdRunner: (cmd: string) => void = () => {
  /* 未接线时静默：标签最多是点不动，不该抛错 */
};

export function setCmdRunner(fn: (cmd: string) => void): void {
  cmdRunner = fn;
}

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
 * @returns 结束位置（`closeTag` 的闭标签之后 / 文本末尾）
 */
function parseInto(text: string, from: number, closeTag: string | null, out: Node): number {
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
    const el = document.createElement(name);
    if (name === 'CMD') {
      const cmd = CMD_ATTR_RE.exec(attrs)?.[1] ?? CMD_ATTR_RE.exec(attrs)?.[2] ?? '';
      if (cmd !== '') {
        el.setAttribute('data-cmd', cmd);
        el.addEventListener('click', () => cmdRunner(cmd));
      }
    }
    out.appendChild(el);
    i = parseInto(text, i, name, el);
  }

  flush();
  return text.length;
}

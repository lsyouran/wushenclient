/**
 * src/ui/dom.ts — 最小 DOM 工具
 * ============================================================================
 * ★ 这里的**唯一硬性规矩**：外部文本一律走 `textContent`，**不提供 innerHTML 助手**。
 *
 *   理由（docs/26 §11.4 的 T6）：服务端会回显玩家可控内容（说话、命名、物品描述），
 *   一旦有 `innerHTML` 助手，用的人就会顺手把整段 HTML 塞进去 —— 于是 XSS 面
 *   不是"某处写错了"，而是"整个前端都可能有"。
 *   不提供这个助手，是从**结构上**消除它，而不是靠每次 review 记得。
 *
 *   需要富文本时，用 `frag()` 拼节点，而不是拼字符串。
 */

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
  dataset?: Readonly<Record<string, string>>,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className !== undefined && className !== '') node.className = className;
  if (text !== undefined) node.textContent = text;
  // `data-*` 走 dataset（而不是拼字符串），事件委托靠它认人 —— 见 `delegate()`
  if (dataset !== undefined) for (const [k, v] of Object.entries(dataset)) node.dataset[k] = v;
  return node;
}

/**
 * 取容器节点。**结果会缓存**。
 *
 * 为什么能缓存：这些是 `index.html` 里 id 唯一的**容器**，生命周期内不会被替换
 * （我们只改它们的内容，不重建它们本身）。缓存的收益是渲染路径上不再反复
 * `getElementById`。
 *
 * ⚠️ 若将来出现"把某个 id 的节点整个换掉"的写法，必须同时清掉这里的缓存 ——
 * 所以本函数只用于**容器**，动态生成的元素一律用 `el()` 现造。
 */
const nodeCache = new Map<string, Element>();

/**
 * 取容器节点。**结果会缓存**。
 *
 * 类型参数放宽到 `Element`（而不是 `HTMLElement`）：小地图是 `<svg>`，
 * 它是 `SVGElement`；为了取它而绕开 `need()` 会让"节点缓存"这条规矩
 * 出现第一个例外，例外一多就没了。默认仍是 `HTMLElement`，所以
 * 既有调用点（`need('output')` 之类）不受影响。
 */
export function need<T extends Element = HTMLElement>(id: string): T {
  const cached = nodeCache.get(id);
  if (cached !== undefined) return cached as T;
  const node = document.getElementById(id);
  if (node === null) throw new Error(`缺少 DOM 节点 #${id}（index.html 与 ui 不同步？）`);
  nodeCache.set(id, node);
  // 走 `unknown`：调用点可能声明成 `SVGElement`（小地图），而 `getElementById`
  // 的静态返回类型只有 `HTMLElement` —— 两者没有足够重叠，直接 `as T` 会被拒。
  return node as unknown as T;
}

/** 仅供测试：清掉节点缓存（jsdom 里重新挂载 DOM 后必须调） */
export function resetNodeCache(): void {
  nodeCache.clear();
}

/** 多行文本 → 多个 <p>（保留换行，不引入 HTML） */
export function paragraphs(text: string, className = 'line'): HTMLParagraphElement[] {
  return text.split('\n').map((line) => el('p', className, line));
}

/**
 * 用一组节点**整体替换**容器的内容。
 *
 * 用 `replaceChildren`（原生，Chrome 86+ / Safari 14+ / Firefox 78+）而不是
 * 「先逐个 removeChild 再逐个 appendChild」：后者每插一个节点都可能触发一次样式重算，
 * 节点一多就是 O(n) 次布局失效。`replaceChildren` 一步替换，等价于内部用
 * DocumentFragment 的批量插入。
 *
 * 收 `Element` 而不是 `HTMLElement`：小地图容器是 `<svg>`（见 `need` 的说明）。
 */
export function fill(node: Element, children: readonly Node[]): void {
  node.replaceChildren(...children);
}

export function clear(node: Element): void {
  node.replaceChildren();
}

/**
 * 给"声明成按钮"的元素（`role="button" tabindex="0"`）绑**完整激活**：`click` + 键盘（Enter/Space）。
 *
 * ★ 为什么要有这个助手：项目自己立过规矩（`ui/input.ts` 的 `#channel`）——
 *   声明了能点却**只绑 `click`**，键盘用户 Tab 过去按 Enter/Space 毫无反应，
 *   而读屏器会照着 `role="button"` 播报"按钮"。比不声明更糟。
 *   （2026-10-16 审查 L2：`#mapBtn` / `#dlgClose` 正是这个形态。）
 *
 * ★ 把 `click` 也收在这里（而不是让调用方再写一行）：两处漏一处就退回原样，
 *   收在一处才谈得上"这个元素是可激活的"只有一个定义。
 *
 * ★ `Space` 必须 `preventDefault()`：否则页面会跟着滚动。
 */
export function onActivate(node: HTMLElement, fn: () => void): void {
  node.addEventListener('click', () => fn());
  node.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Enter' && ev.key !== ' ') return;
    ev.preventDefault();
    fn();
  });
}

export function on<K extends keyof HTMLElementEventMap>(
  node: HTMLElement,
  type: K,
  handler: (ev: HTMLElementEventMap[K]) => void,
): void {
  node.addEventListener(type, handler);
}

/**
 * 事件**委托**：在容器上挂一个监听器，处理所有匹配 `selector` 的后代。
 *
 * 这是 jQuery 当年真正好用的那部分（`$(box).on('click', '.item', fn)`）的原生等价物，
 * 现代浏览器用 `EventTarget.closest()` 就够了。
 *
 * 为什么值得用：列表内容每次渲染都会重建，若逐个节点 `addEventListener`，
 * 就得在每次渲染时重复绑定 N 次；委托只需绑一次（见 `main.ts` 的 `bind()`），
 * 而且**渲染函数因此变成纯的**（只产节点，不碰事件）。
 */
export function delegate<K extends keyof HTMLElementEventMap>(
  container: HTMLElement,
  selector: string,
  type: K,
  handler: (target: HTMLElement, ev: HTMLElementEventMap[K]) => void,
): void {
  container.addEventListener(type, (ev) => {
    const target = ev.target;
    if (!(target instanceof Element)) return;
    const hit = target.closest(selector);
    // `contains` 兜住 `closest` 越过容器边界的极端情况（嵌套容器时才会出现）
    if (hit === null || !container.contains(hit)) return;
    handler(hit as HTMLElement, ev);
  });
}

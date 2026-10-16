/**
 * shared/player-text.ts — **玩家可控文本**的下行安全约定（审查 S1 的核心 single source）
 * ============================================================================
 * 为什么它住在 `shared/`：**这条约定是协议的一部分**，不是某一侧的实现细节。
 * 内容层（`world/command/**`）要用它（G13 的 D2 规则只允许内容层 import
 * `@engine/world/` 或 `@shared/`），引擎层（`server/engine/view-text.ts`）也要用它，
 * 而 `server/engine` 依赖 `server/world` 会在两个方向上都别扭 ⇒ 放在最底层最干净。
 *
 * ## 它防的是什么
 * 前端 `src/ui/markup.ts` 用**标签白名单 + createTextNode** 解析服务端文本 ——
 * 那条防线确实是结构性的：`<script>` 只是几个字符，永远成不了脚本节点。
 *
 * ★ **但 `CMD` 本身就在白名单 `KNOWN` 里，它的语义是"点一下发一条指令"**
 *   （`markup.ts:148-155` 的 `addEventListener('click', () => cmdRunner(cmd))`）。
 *   ⇒ 白名单拦的是"名单外的攻击"，拦不住**用名单内合法能力干的事**：
 *   玩家写一段带 `<CMD cmd="…">` 的文本，别人屏幕上就多一颗点了会执行指令的按钮。
 *
 * ★ 对照 wushen：`world/cmd/channel/say.js:22` 是 `UTIL.htmlEncode(msg)`。
 *   它转义是因为自己走 `innerHTML`；本项目不必转义 HTML（白名单解析器的功劳），
 *   **恰恰因此把 CMD 漏了** —— 对面那次转义是顺手把 CMD 也挡掉的。
 *   ⇒ **换掉防御机制时，要清点"旧机制顺手还提供哪些附带保护"。**
 *
 * ## 三条注入路径（按强度排序）
 *   ① **角色名** —— 名字会被 `$N` 替换进**每一句**涉及该角色的播报，
 *      且房间列表的名字也走 markup 渲染（`src/ui/room.ts:92`）。
 *      ⇒ **不用开口**，只要站在房间里就在给全房间植按钮。最强的一条。
 *   ② **`say` 正文** —— `chat/say.ts` 原样拼进模板。
 *   ③ **`tell` / `shout` 正文** —— 直传 `sendChannel`（后者受众是**全服**）。
 *
 * ## 三道防线（各自独立成立，任一道被绕过时另外两道仍生效）
 *   ① 入口：`shared/protocol.ts#isRoleName` 拒绝含 `<` 的名字 —— 名字是持久标识，
 *      本来就不该含标签字符；
 *   ② 渲染：`server/engine/view-text.ts#renderViewText` 里**每一个替换进去的动态值**
 *      都过本函数 —— 这是"名字另有来源"时（存档名 / 改名 / 称号）的兜底；
 *   ③ 出口：`say` / `tell` / `shout` 在把正文拼进模板前调用本函数。
 */

/**
 * `<` 的替身：单左书名号 `‹`（U+2039）。
 *
 * ★ 为什么不是 `&lt;`：没有 HTML 解析器参与，没有人会把 `&lt;` 解码回 `<` ——
 *   写 `&lt;` 只会让屏幕上原样出现这**四个字符**。要的是"看着还是那个符号、
 *   但白名单解析器认不出它是标签起始"。
 * ★ 为什么**只换 `<`** 不换 `>`：标签必须由 `<` 起始，没有 `<` 就不成标签；
 *   单方面换 `>` 还会让 `‹a>` 这种半吊子形态更难读。
 */
const OPEN_TAG_SUBSTITUTE = '‹';

/**
 * 把一段玩家可控的文本变得**不会产出标签**。
 *
 * 幂等：已经是替身的字符串再过一遍仍是原样（`‹` 不是 `<`）。
 *
 * ⚠️ **将来任何把玩家可控文本拼进下行文本的新出口都必须调用本函数。**
 *   这是目前唯一没有闸门守住的约定 —— 静态判据在这里太脆（判不清"变量里装的是不是玩家输入"），
 *   宁可不写一个会假绿的闸门，也不要假装这一条被机器看着。
 *   ⇒ 缺迁移到 `tests/player-text-guard.test.ts` 的文件头注释。
 */
export function neutralizePlayerText(raw: string): string {
  return raw.replace(/</gu, OPEN_TAG_SUBSTITUTE);
}

/**
 * `neutralizePlayerText` 实际使用的替身字符。
 * 导出给测试：判据不能写死 `‹` 字面量 —— 那样改替换字符时测试会跟着改，
 * 变成"我改了实现、我改了测试、两边都绿"的自证式循环。
 */
export const OPEN_TAG_SUBSTITUTE_CHAR = OPEN_TAG_SUBSTITUTE;

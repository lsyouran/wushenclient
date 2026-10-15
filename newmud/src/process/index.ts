/**
 * src/process/index.ts — 前端包处理的**聚合入口**
 * ============================================================================
 * ★ 本目录是 **G2 闸门的对账对象**：`tools/gate/g2-protocol.mjs` 扫描
 *   `src/process` 下各 .ts 里的 `registerHandler('类型')`（**已剥离注释**），
 *   并与 `SERVER_PACKET_TYPES` 做**双向**差集 —— 两边必须完全相等。
 *
 *   于是「服务端新增了一种包但前端忘了处理」是**闸门红**，不是"上线后才发现白屏"；
 *   反过来「前端注册了一个服务端不会发的包」同样红（那是死代码）。
 *
 * ★ 与 wushen 前端的对照：wushen 的 `Process` 靠**方法名恰好等于包类型**来分派
 *   （`Process.items(x)` / `Process.room(x)` …），写错一个字母就静默不执行。
 *   这里改成显式注册表 + 闸门对账，把"名字要对上"这件事交给机器。
 *
 * 每条 handler 都必须**做一件看得见的事** —— 没有"注册了但什么都不做"的条目
 * （24 册禁止的"声明未实现"）。尚未落地的能力也要在界面上明确说出来。
 *
 * ⚠️ 注册表本体在 `registry.ts`（拆开是为了避免 ESM 提升导致的循环依赖，
 *    那里的注释说明了原因）。本文件只做两件事：转发导出 + 触发注册。
 */

export { dispatchPacket, registerHandler, registeredTypes, setErrorSink } from './registry.js';
export type { Handler, PacketPayload } from './registry.js';

// 下面这些 import 只是为了**触发注册**（副作用导入）。
// 集中在这里，是为了让"新增一类 handler"只需要加一行，而不是去改别处。
import './handlers/world.js';
import './handlers/role.js';
import './handlers/combat.js';
import './handlers/social.js';
import './handlers/system.js';

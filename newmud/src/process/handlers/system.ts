/**
 * src/process/handlers/system.ts — 系统类包
 *
 * ★ `warn` 是**服务端文本输出的主通道**（`session.ts` 的 `notify` / `sendRoom` 走它），
 *   所以它是整个前端里被调用最频繁的一个 handler —— 玩家看到的绝大多数行都来自这里。
 *
 *   ⚠️ 别在这里注册 `SERVER_PACKET_TYPES` 之外的类型（比如给指令回显单开一个）：
 *      G2 对账是**双向**的，多注册一个同样红。指令的文本回显本来就走 `warn`。
 */

import { registerHandler } from '../registry.js';
import type { CmdItem } from '../../../shared/protocol.js';
import { pushLine } from '../../ui/stream.js';
import { notePanel, showWarn } from '../../ui/panel.js';

const asString = (v: unknown): string => (typeof v === 'string' ? v : '');
const asCmds = (v: unknown): CmdItem[] =>
  Array.isArray(v)
    ? v
        .filter((x): x is Record<string, unknown> => typeof x === 'object' && x !== null)
        .map((x) => ({ cmd: asString(x['cmd']), name: asString(x['name']) }))
        .filter((c) => c.cmd !== '')
    : [];

registerHandler('warn', (p) => {
  const content = asString(p['content']);
  if (content === '') return;

  // ★ 带命令的 warn 是"要玩家拿主意"（确认 / 选择），那种才弹提示框；
  //   纯播报进消息流 —— 弹窗会把正在读的那一片盖住。
  const cmds = asCmds(p['cmds']);
  if (cmds.length > 0) {
    showWarn(content, cmds);
    return;
  }

  pushLine(content);
  // ★ 面板开着时（比如刚点了「属性」），同一份回显还要进面板 ——
  //   面板内容就是这么来的（wushen 的 dialog 模型：开面板 → 服务端回显 → 填充）
  notePanel(content);
});

registerHandler('pay', (p) => {
  // 商业化前不实施（docs/25 暂缓）；收到了要明确说，不能静默
  pushLine(`【支付】订单 ${asString(p['order_id'])} —— 支付功能尚未启用`, 'sys');
});

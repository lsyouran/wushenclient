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

  // ★★ **两路，不是四路**（2026-10-21 §80）。
  //
  //   服务端在帧里声明了归属（`context`）⇒ 试着投进那块面板；
  //   没声明、或声明的面板不是眼前这块 ⇒ 进消息流。
  //
  //   在这之前这里是四路判断：有 cmds / 战斗中 / 面板吸收中 / 其余，
  //   后三路全是**猜** —— 猜"这条是不是战斗回显"、"面板这会儿该不该吸"。
  //   每一次加新状态（战斗、将来的托管 / 交易 / 任务）都要回来补一条分支，
  //   漏一次就是真机上的"数据写在木人的操作框里"（§78）。
  //   ⇒ 现在没有任何判断依赖"当前局面"，只依赖帧上的一个字段。
  //
  //   ★ `notePanel` 返回 `false` 时必须往下走 `pushLine`：投递失败
  //     （面板没开 / 开的是别块 / 是张数据快照）不能让这句话消失。
  const context = asString(p['context']);
  if (context !== '' && notePanel(context, content)) return;
  pushLine(content);
});

registerHandler('pay', (p) => {
  // 商业化前不实施（docs/25 暂缓）；收到了要明确说，不能静默
  pushLine(`【支付】订单 ${asString(p['order_id'])} —— 支付功能尚未启用`, 'sys');
});

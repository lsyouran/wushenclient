/**
 * src/process/handlers/social.ts — 聊天 / 表情 / 通用面板
 */

import { registerHandler } from '../registry.js';
import { pushChat } from '../../ui/stream.js';
import { noteChat } from '../../ui/input.js';
import { clearPanelRows, closePanel, openPanel, removePanelRow } from '../../ui/panel.js';
import { state } from '../../state.js';
import { DIALOG_CONTROL_FIELDS } from '../../../shared/constants.js';

const asString = (v: unknown): string => (typeof v === 'string' ? v : '');

const formatField = (v: unknown): string =>
  typeof v === 'object' ? JSON.stringify(v) : String(v);

/** 是不是 `dialog` 帧的**控制字段**（名单单源 = `DIALOG_CONTROL_FIELDS`） */
const isControlField = (k: string): boolean => (DIALOG_CONTROL_FIELDS as readonly string[]).includes(k);

/**
 * `msg` 包 —— 聊天消息。
 *
 * ★ 这一档以前**没有生产者**（服务端从不发 `msg`），于是"闲聊分页"永远是空的。
 *   本批次补上了生产者（`server/session.ts#deliverChannel`），这里也相应
 *   从"一律当 say 塞进叙事流"改成**按频道分档**：
 *
 *     频道 → CSS 档位：chat/rumor/tm/fam/pty/es/sys → `.wor`（世）· tell → `.pri`（私）
 *
 *   ★ **没有「房间」这一档**（26 册 §24）：房间里说话（`say`）走服务端的房间广播
 *     （`sendRoom` → `warn` 帧 → 主消息流），不是频道消息 —— wushen 的频道区
 *     （`dialog/channel.js` 的页签）同样没有「房间」。所以这里也不该有 `.say` 档。
 *
 *   档位只是一个类名（`.say` / `.wor` / `.pri`），由 `src/ui/stream.ts` 的 `pushChat`
 *   挂在行上、`style.css` 负责上色。**目前没有"按频道过滤"的开关**：档位是留给
 *   将来当筛选钩子用的（旧版有个 `#logtabs` 过滤条，这里还没做，所以别在注释里
 *   假装它存在 —— 否则读代码的人会去找一个不存在的元素）。
 *
 * ★ 前缀不再由前端拼"【说话】"这类字样：说话人名字走 `.who` 那一小段
 *   （颜色比正文淡一档），频道名由分档的**颜色**承担 —— 一行里出现
 *   "【闲聊】阿飞：【闲聊】你好"那种双份前缀是最容易出来的丑。
 */
registerHandler('msg', (p) => {
  const ch = asString(p['ch']);
  const content = asString(p['content']);
  const who = asString(p['name']);
  // 自己说的话显示成「你」：`msg` 里只有说话人的名字，没有"这条是我发的"标记，
  // 而"我"是谁前端本来就知道（登录时的名号）—— 于是没必要为每个收件人各拼一份文本。
  //
  // ⚠️ 这是**本项目的取舍，不是 wushen 的行为**：wushen 的 `createElement` 只拼
  //    `data.name`，自己看自己的世界频道消息显示的是**自己的名字**
  //    （`world/cmd/channel/chat.js` 把同一个包发给所有人，`name` 恒为发送者）。
  // ⚠️ 判据 `who === state.roleId` 依赖**「名号 == 登录身份」**这条前提
  //    （`session.ts` 造角色时 `name: roleId`）。**存档批次落地后角色名会独立于
  //    roleId**，届时这条比较会**静默失效**（只会退化成显示名字，不会报错）——
  //    已记入 26 册 §24.5 待办。
  const shown = who !== '' && who === state.roleId ? '你' : who;
  pushChat(ch, shown, content);
  noteChat();
});

/**
 * `emote` 帧 —— 表情清单。
 *
 * ⚠️ **当前面板里的每一项都是纯文本、不可点**（2026-10-16 审查 F5 订正）。
 *   旧注释写"点开即用"是**假的**：`openPanel` 的第二参是纯文本行，压根没有点击行为
 *   （可点的只有第三参 `cmds`，那是服务端下发的 `CmdItem`）。
 *
 * ★ 为什么这一批**不做**可点：全仓**没有 `emote` 指令**（`world/` 零命中）、
 *   也**没有 `emote` 包的生产者**（`server/` 零命中）—— 点了也无处可去，
 *   做成按钮只会多一个"点了什么都不发生"的假控件（26 册 §16.8 明确反对的那一类）。
 *
 * ★ wushen 的做法是把表情名**填进输入框**（前缀 `*`，见 `src/game/main.js#ShowEmotePanel`），
 *   而不是直接发指令。等本项目有了 `emote` 指令与生产者，照它实现"点击填入聊天框"，
 *   落点就是这里。
 */
registerHandler('emote', (p) => {
  const items = Array.isArray(p['items']) ? p['items'].map(asString) : [];
  if (items.length === 0) return;
  openPanel('表情', items);
});

/**
 * `dialog` 是通用面板容器（协议里刻意保留未知字段）。
 * ★ 未知的（`p.dialog` 不在本文件已识别的面板名里）**照样开面板**并列出原始字段 ——
 *   宁可看到"还没做"，也不要假装处理了（那会让玩家以为功能坏了）。
 *
 * ⚠️ 旧注释称"知名面板走 `PANEL_TABS`（有取数指令）" —— **`PANEL_TABS` 这个常量不存在**
 *   （2026-10-14 复查：全仓仅此一处命中，且在注释里）。已删除该引用，别再拿它当既有事实。
 *
 * ★★ **控制字段已分流**（F4，2026-10-16 审查）：`close` / `refresh` / `clear` / `remove`
 *   改的是**面板本身**，不再是"面板里的一行"。原先四个字段全被当普通字段列成文本行 ——
 *   服务端发 `{dialog:'pack', close:true}` 会看到一行 `close: true`，而面板**不关**。
 *
 * ★ 两种语义按"**本帧有没有内容字段**"区分：
 *     - **控制帧**（只带控制字段）⇒ 作用于**当前**面板：`close` 收起 / `remove` 删一行 /
 *       `clear` 清空 / `refresh` 消费掉（面板是纯文本快照，无需重绘）；
 *     - **内容帧**（带别的字段）⇒ 重建面板，内容字段逐条落行。
 *   混在一帧里时 `close` 优先（面板都关了，再列行没有意义）。
 */
registerHandler('dialog', (p) => {
  if (p['close'] === true) {
    closePanel();
    return;
  }

  const contentKeys = Object.keys(p).filter(
    (k) => k !== 'v' && k !== 'type' && k !== 'dialog' && !isControlField(k),
  );

  if (contentKeys.length === 0) {
    if (typeof p['remove'] === 'string') removePanelRow(p['remove']);
    if (p['clear'] === true || typeof p['clear'] === 'string') clearPanelRows();
    // `refresh` 只表示"数据已更新到该时刻" —— 面板是纯文本快照，没有要重算的视图
    return;
  }

  const name = asString(p['dialog']);
  const rows = contentKeys.map((k) => `${k}: ${formatField(p[k])}`);
  openPanel(name === '' ? '面板' : name, rows.length === 0 ? ['（空面板）'] : rows);
});

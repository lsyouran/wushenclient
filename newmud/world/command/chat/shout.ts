import { CHAT_MAX_LENGTH, CHAT_TOO_LONG } from '@shared/constants.js';
import { defineCommand } from '@engine/world/define.js';

/**
 * `chat` / `shout` / `yell` —— 向**全服**喊话（频道 `chat`）。
 *
 * ★ 与 `say` 的区别是**范围**，不是"有没有频道"：
 *   `say` → 本房间（`sendRoom`，三视角，进主消息流）；
 *   这里 → 全世界（`sendChannel('chat')`，会话层按 `CHANNEL_SCOPE` 投给所有连接）。
 *   两条指令的正文一字不差 —— 这正是把受众收进 `CHANNEL_SCOPE` 的收益：
 *   如果受众写在这里，两条指令就会各有一份"谁能听见"的答案。
 *
 * ★★ **主名是 `chat`，照 wushen**（`world/cmd/channel/chat.js` 的
 *   `this.command = "chat"`）。本项目原先只有 `shout,yell`，而 wushen **没有**
 *   `shout` 这条指令 —— 后果不只是"用词不同"：前端的聊天输入带把**页签的
 *   `data-ch` 直接当命令名**拼（`ui/input.ts#composeChat` → `${ch} ${正文}`），
 *   而「世界」页签写的是 `data-ch="chat"`。于是那个页签是个**假按钮**：
 *   点上去敲 `chat 你好`，服务端回一句"什么？"（26 册 §24.3）。
 *
 *   `shout` / `yell` 保留为**别名**（不破坏已有玩家习惯与既有测试）。
 *   注意别名只影响"敲哪个词"，**不影响**协议里的 `ch`：那永远是 `chat`
 *   （`CHANNELS` 是协议闭集，描述的是**这条消息属于哪个频道**）。
 *
 * ★ 长度上限 200（wushen `chat.js:10`），与 `say` 共用 `CHAT_MAX_LENGTH`。
 *
 * ★ 一处**与 wushen 的有意偏离**：无内容时 wushen 是 `return;`（**静默**），
 *   本项目给一句用法提示。理由是静默会让"点了按钮没反应"看起来像坏了 ——
 *   而这条指令正是前端页签与 chip 的落点。提示只在**发出者自己**那边出现
 *   （`notify` 不是 `sendChannel`），不会污染频道。
 *
 * ⚠️ 闸门同样与 wushen 有差：wushen `chat.js` 声明 busy/state/die 三条，
 *   `allow_faint` 缺省即拦；本项目额外放行昏迷（理由同 `say.ts`）。
 */
defineCommand('chat/shout', {
  command: 'chat,shout,yell',
  allow_busy: true,
  allow_state: true,
  allow_die: true,
  allow_faint: true,

  run: (me, text) => {
    const content = (text ?? '').trim();
    if (content === '') {
      me.notify('你想喊什么？用法：喊 <内容>');
      return;
    }
    if (content.length > CHAT_MAX_LENGTH) {
      me.notify(CHAT_TOO_LONG);
      return;
    }
    me.sendChannel('chat', content);
  },
});

import { defineCommand } from '@engine/world/define.js';
import { CHAT_MAX_LENGTH, CHAT_TOO_LONG } from '@shared/constants.js';
import { neutralizePlayerText } from '@shared/player-text.js';

/**
 * `tell` / `whisper` —— 定向私聊（频道 `tell`）。
 *
 * ★ 这是**唯一**受众不是"一群人的集合"而是"某一个人"的频道，
 *   所以它需要一个参数 `to`（目标角色名）—— 见 `Actor.sendChannel` 的第三个形参。
 *   解析目标（按名字找在线角色、找不到就回一句）同样在会话层，
 *   因为"谁在线、叫什么"只有那里知道。
 *
 * ★ `regex` 在这里是必要的（而 `say`/`shout` 不需要）：需要把
 *   `私 阿飞 你好` 切成两个形参。`buildParams` 的契约是
 *   「有 regex 且匹配 → 按捕获组传参」/「不匹配 → 整串作为一个参数」，
 *   所以下面必须显式处理"只写了一个词"的错用。
 */
defineCommand('chat/tell', {
  command: 'tell,whisper',
  // 目标名不含空白，正文可以含空白（`\s+` 分开两段）
  regex: /^(\S+)\s+([\s\S]+)$/,
  allow_busy: true,
  allow_state: true,
  allow_die: true,
  allow_faint: true,

  run: (me, who, text) => {
    const target = (who ?? '').trim();
    const content = (text ?? '').trim();
    if (target === '' || content === '') {
      me.notify('用法：私 <人名> <内容>');
      return;
    }
    if (target === me.name) {
      me.notify('自言自语就不用私聊了。');
      return;
    }
    // ★ 长度上限（S10，2026-10-16 审查）：`say` / `shout` 都有，唯独 `tell` 漏了 ——
    //   后果不是崩溃，而是"报错说不到点上"：长私聊一路走到入站明文上限（256）才被拒，
    //   而那条拒绝走 `loginerror` 通道把玩家甩回登录页，界面上也看不出"太长"。
    //   这里补上与 `say`/`shout` **同一条** `CHAT_MAX_LENGTH` 与**同一句**提示。
    if (content.length > CHAT_MAX_LENGTH) {
      me.notify(CHAT_TOO_LONG);
      return;
    }
    // ★ 同上（S1）：正文是玩家写的，产出 `<CMD>` 就是在对方屏幕上植一个可执行按钮
    me.sendChannel('tell', neutralizePlayerText(content), target);
  },
});

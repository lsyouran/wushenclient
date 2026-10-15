import { CHAT_MAX_LENGTH, CHAT_TOO_LONG } from '@shared/constants.js';
import { defineCommand } from '@engine/world/define.js';

/**
 * `say` —— 对**本房间**说话。
 *
 * 路径与 id 的关系（G5 闸门校验）：文件在 `world/command/chat/say.ts`，
 * 相对 `world/command/` 的路径是 `chat/say`，所以 id 必须是 `chat/say`。
 *
 * ★★ 走的是 **`sendRoom`（房间广播）**，不是 `sendChannel`（26 册 §24）。
 *   这一条以前走的是 `sendChannel('say', …)`，理由是"受众交给会话层裁决"——
 *   方向错了：**"房间"不是频道**。判据是原作的频道区里根本没有「房间」这一档：
 *
 *     - `wushen/src/dialog/channel.js` 的页签 = 全部/世界/队伍/门派/全区/帮派/系统；
 *     - 同一文件 `createElement` 的 `switch (data.ch)` = tm/fam/rumor/sys/es/pty + default
 *       —— 一个 `ch:'say'` 的消息落进去只会被显示成【闲聊】。
 *
 *   所以 wushen `world/cmd/channel/say.js:18` 收尾是
 *   `return me.send_room("$N说：" + UTIL.htmlEncode(msg));`。
 *   `sendRoom` 的收益是**三视角在服务端渲染**（"你说：你好" / "阿飞说：你好"），
 *   而这正是 T16 刚补的能力 —— 这条指令是它的第二个真实调用点。
 *
 * ★ 三处行为**照抄 wushen**（`world/cmd/channel/say.js`）：
 *   ① 无参数（`:8`）不是本地用法提示，而是**房间广播**一句
 *      `$N在自言自语的说些什么。` —— 它是一个**社交动作**（自言自语也是一种表达），
 *      不是错误提示。对照 `go.js:7` 无参是 `notify("你要往哪里走？")`（只自己看）、
 *      `chat.js:8` 无参是 `return;`（静默）：三条各写各的，`say` 那条是有语义的。
 *   ② 长度上限 200（`:11`）—— 两个指令共用 `CHAT_MAX_LENGTH` 这一份。
 *   ③ ⚠️ **玩家输入里的 `$X` 会被当成占位符** —— 这是**与 wushen 一致**的行为，
 *      不是本项目的遗漏：`renderViewText` 扫描的是**整条**待播文本，而 wushen 的
 *      `send_room` → `splitmessage` 同样扫全串（它只 `htmlEncode`，**不转义 `$`**）。
 *      于是 `say 花$了` 两边一样会渲染成「花了」（未知 `$x` 被吃掉）。
 *      要禁掉得给 `sendRoom` 加一条转义约定（换掉 `$`，或给模板引入转义符），
 *      那就是**偏离原作**的一次设计决策 —— 已记入 26 册 §24.5 待办，本轮照抄不改。
 *
 * ★ **未移植的两条**（wushen 有、本项目缺前提，别当成"已经有了"）：
 *   - `no_chat` 禁言（`:10`）：要一个能写 `temp.no_chat` 的禁言指令，本项目还没有；
 *   - `msg[0] == "/"` 的 admin 后门（`:12-15`）：本项目没有 admin 体系（G11 暂缓）。
 *
 * ★ 闸门：说话不是体力活，所以**忙碌 / 打坐状态下放行**。
 *   ⚠️ 与 wushen 的**有意偏离**：wushen 的 `say.js` 只声明了 `allow_busy` /
 *   `allow_state` 两条，`allow_die` / `allow_faint` 缺省即**拦住**（`character.js:203-207`
 *   是 `if (hp <= 0 && !cmd.allow_die)`），也就是它那边**死了、昏迷了就不能说话**。
 *   本项目额外给了这两档，理由是"看与说都不该被角色状态挡住"（同 `select.ts`
 *   给 `allow_die` 的理由：死了连自己掉的东西都看不了）。**这是本项目的取舍，
 *   不是 wushen 的行为** —— 别再把它写成"wushen 也是这样"。
 */
defineCommand('chat/say', {
  command: 'say',
  allow_busy: true,
  allow_state: true,
  allow_die: true,
  allow_faint: true,

  run: (me, text) => {
    // `args` 为空时 `buildParams` 返回 `[]` → 形参是 `undefined`（不是空串）
    const content = (text ?? '').trim();

    // 无参数 = 房间广播的自言自语（wushen `say.js:8`）
    if (content === '') {
      me.sendRoom('$N在自言自语的说些什么。');
      return;
    }

    if (content.length > CHAT_MAX_LENGTH) {
      me.notify(CHAT_TOO_LONG);
      return;
    }

    // ★ `$N` 由引擎按视角渲染：本人读到「你」，同房的人读到名字。
    //   正文原样拼在后面 —— 但**正文里的 `$X` 照样会被当占位符扫描**
    //   （`renderViewText` 扫的是拼好的**整条**文本，不区分模板段与输入段 ⇒
    //   `say 花$了` 会渲染成「花了」）。这是**与 wushen 一致**的行为，见本文件头部注释 ③。
    //   ⚠️ 旧注释曾写成"玩家输入不参与占位符扫描"，与实现**不符**，2026-10-14 订正。
    me.sendRoom(`$N说：${content}`);
  },
});

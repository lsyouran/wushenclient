package mud.core

/**
 * 聊天浮层背后的**全部判断**（`src/ui/input.ts` 的聊天那一半）。
 *
 * ★ 为什么这一层能脱离界面：网页端 `input.ts` 里混了三件事 ——
 *   ① 频道/对象的**状态**；② 合成指令串（`composeChat`）的**规则**；
 *   ③ 缺对象时给哪句**提示**。三件都是纯判断，只是它当初写在 DOM 模块里。
 *   挪到 `:core` 之后，`gradle :core:test` 就能证明"私语没对象时不发半截指令"，
 *   不必上机点一遍。
 *
 * ★★ 与网页端的 `composeChat` 逐条对齐，但**多返回一个原因**：
 *   网页端用 `null` 表示失败，再在外层用 `channel === 'tell' && target 为空` 反推
 *   是哪一种失败（`input.ts:199-204`）—— 那是"从结果猜原因"。
 *   这里直接返回 [ChatSubmit] 的一支，提示文案由 [chatHintOf] 查表。
 */

/**
 * 聊天频道。
 *
 * ★ 只登记网页端 `#channelBox` 上真有的三个页签（`index.html:170-173`）。
 *   服务端 `msg` 帧还能发 `es`/`rumor`/`tm`/`fam`/`pty` 等频道，但那些**没有输入口**
 *   （网页端也是：它们只能收、不能发），所以不进这个枚举。
 *   显示名照抄页签：「房间 / 世界 / 私语」。
 *
 * ★ `CHAT` 的线上词是 `chat` 而不是 `world`：wushen 的原词是 `chat`
 *   （`world/cmd/channel/chat.js`），也是服务端 `CHANNEL` 认的那个词。
 *   枚举名用 WORLD 只是为了让"世界频道"读起来不像"聊天"。
 */
enum class ChatChannel(val wire: String, val label: String, val hint: String) {
    SAY("say", "房间", "对本房说话……"),
    WORLD("chat", "世界", "对世界喊话……"),
    TELL("tell", "私语", "对某人耳语……"),
    ;

    companion object {
        /** 线上词 → 频道；认不出返回 `null`（不回落到"房间"，那会发错广播范围） */
        fun ofWire(wire: String): ChatChannel? = entries.firstOrNull { it.wire == wire }
    }
}

/**
 * 提交聊天的结果。
 *
 * ★ 用判别类型而不是 `String?`：三种情况要**三种不同反应**（发出去 / 提示"写点什么" /
 *   提示"先选对象"），`null` 会把后两种压成一种。
 * ★ `when` 处理它时**不写 `else`** ⇒ 将来多一种结果（比如"被禁言"）会编译失败，
 *   必须回来决定界面怎么说。
 */
sealed interface ChatSubmit {
    /** 合成好的指令串，直接发 */
    data class Send(val command: String) : ChatSubmit

    /** 正文是空的（或只有空白） */
    data object Blank : ChatSubmit

    /** 私语但没选对象 */
    data object NeedTarget : ChatSubmit
}

/**
 * 把「频道 + 对象 + 正文」合成一条服务端认的指令。
 *
 * 三条规则，与网页端 `composeChat` 同源：
 *   ① 正文 `trim()` 后为空 ⇒ [ChatSubmit.Blank]（不发半截指令）；
 *   ② `tell` 缺对象 ⇒ [ChatSubmit.NeedTarget] —— **绝不发** `tell  在吗`：
 *      半截指令出门只会换来一句看不懂的报错；
 *   ③ 其余 ⇒ `"<频道> <正文>"`，私语是 `"tell <对象> <正文>"`。
 */
fun composeChat(channel: ChatChannel, target: String?, text: String): ChatSubmit {
    val body = text.trim()
    if (body.isEmpty()) return ChatSubmit.Blank
    if (channel == ChatChannel.TELL) {
        val to = target?.trim().orEmpty()
        if (to.isEmpty()) return ChatSubmit.NeedTarget
        return ChatSubmit.Send("tell $to $body")
    }
    return ChatSubmit.Send("${channel.wire} $body")
}

/**
 * 失败时给玩家的一句话；能发出去就返回 `null`。
 *
 * ★ 必须**落到消息流**（`MudClient.note`）而不是弹窗：这是在输入过程中反复出现的小摩擦，
 *   弹窗会打断连聊。网页端也是 `hooks.hint()` → 消息流。
 */
fun chatHintOf(result: ChatSubmit): String? = when (result) {
    is ChatSubmit.Send -> null
    ChatSubmit.Blank -> "说点什么再发送。"
    ChatSubmit.NeedTarget -> "私语要先选对象：在「这里有」点一个人。"
}

/** 打开聊天浮层，顺手清未读（与网页端 `openChat()` 里 `clearUnread()` 同一件事） */
fun openChat(state: UiState): UiState = state.copy(chatOpen = true, unreadChat = 0)

/** 收起聊天浮层（未读不清：收起来之后来的消息才算未读） */
fun closeChat(state: UiState): UiState = state.copy(chatOpen = false)

/** 切频道 */
fun setChatChannel(state: UiState, channel: ChatChannel): UiState =
    state.copy(chatChannel = channel)

/**
 * 点实体时要不要顺手把它设为**私聊对象**。
 *
 * ★ 只对**玩家**设（网页端 `main.ts:325` 的 `if (isPlayer) setChatTarget(name)`）：
 *   NPC 不回话，把它设成对象只会让玩家对着木人桩私语。
 *
 * ★★ 必须返回**去掉颜色标签**的名字：`ActorBrief.name` 是协议原文，可能带
 *   `<hik>` 这类标签（房间列表里就是按 markup 渲染的）。直接拿它拼
 *   `tell <hik>张三 在吗` 会让服务端解析不出对象 —— 而这件事**不会报错**，
 *   只会回一句"没有这个人"，看起来像玩家打错了名字。
 *
 * @return `null` = 不设（不是玩家 / 找不到这个 id）。**不是**"清空对象" ——
 *         点地上的丹药不该把你原来的私聊对象清掉。
 */
fun chatTargetFor(state: UiState, id: String): String? {
    val actor = state.actors.firstOrNull { it.id == id } ?: return null
    if (!actor.isPlayer) return null
    val name = plainText(actor.name).trim()
    return if (name.isEmpty()) null else name
}

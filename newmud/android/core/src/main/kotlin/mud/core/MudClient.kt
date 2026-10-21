package mud.core

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import mud.protocol.decodePacket

/**
 * 把 [Transport] 上流动的帧变成一份 [UiState]。
 *
 * ★ 这个类里**没有任何判断**：解包失败怎么办、文本往哪落、面板要不要重置 ——
 *   全在 [Reduce] 那边（纯函数，JVM 单测覆盖）。
 *   这里只做三件机械的事：转发字节、把结果塞进 [StateFlow]、把异常变成一行系统消息。
 *
 * ★ 为什么"解包失败"要变成**一行可见的系统消息**而不是静默：
 *   `decodePacket` 对"少必需字段"是**抛**的（那是协议与 Kotlin 不一致的信号）。
 *   如果吞掉，玩家看到的是"某个界面永远不更新"，而日志里什么都没有 ——
 *   网页端 §80 那一类问题就是这么来的（不报错、只是不对）。
 */
class MudClient(private val transport: Transport) {
    private val mutable = MutableStateFlow(UiState())
    val state: StateFlow<UiState> = mutable.asStateFlow()

    private var url: String = ""

    /** 连接（不登录）。成功后 [UiState.phase] 变 [Phase.Connected] */
    fun connect(serverUrl: String) {
        url = serverUrl
        mutable.update { it.copy(phase = Phase.Connecting, authMessage = "") }
        transport.connect(
            url = serverUrl,
            onOpen = { mutable.update { it.copy(phase = Phase.Connected) } },
            onFrame = ::onFrame,
            onClosed = { reason ->
                mutable.update { s ->
                    s.copy(phase = Phase.Closed).withLine(LogKind.SYS, "连接已断开：$reason")
                }
            },
        )
    }

    /**
     * 断线后重连。
     *
     * ★ 保留消息流（玩家翻得到断开前发生了什么），只把房间/面板清掉 ——
     *   重连后服务端会重发 `room` / `items`，旧的那份留着只会和新的打架。
     */
    fun reconnect() {
        if (url.isEmpty()) return
        mutable.update { it.copy(room = null, panel = null, actors = emptyList(), fighting = false) }
        connect(url)
    }

    fun login(token: String, roleId: String) {
        send(ClientPackets.login(token, roleId))
    }

    /** 发一条指令（输入框 / 房间动作 / 物件动作都走这一条） */
    fun sendCommand(cmd: String) {
        val trimmed = cmd.trim()
        if (trimmed.isEmpty()) return
        send(ClientPackets.command(trimmed))
    }

    /**
     * 点**面板里**的按钮：先标记"下一行回显是新的一轮"，再发令。
     *
     * ★ 顺序不能反：服务端的回显可能在 `sendCommand` 返回之前就到（同进程的假传输就是）。
     *   先发令后标记的话，第一行回显会被当成"上一轮的延续"，面板就不会重置（§74）。
     */
    fun sendPanelCommand(cmd: String) {
        mutable.update { panelCommandIssued(it) }
        sendCommand(cmd)
    }

    fun ping(nowMs: Long = System.currentTimeMillis()) {
        send(ClientPackets.ping(nowMs))
    }

    /**
     * 点房间里的人或物：发 `select <id>`，**玩家**顺手成为私聊对象。
     *
     * ★★ 顺序与网页端 `main.ts:324-327` 一致：先设对象、再发指令。
     *   反过来的话，服务端回得极快时玩家会看到"面板已经开了、私语框还指着上一个人"。
     * ★ 命令名（`select` 而不是 `look`）与"空 id 不发"的判断都在 [selectCommandFor]；
     *   这里只是把它接上状态。
     */
    fun select(id: String) {
        val command = selectCommandFor(id) ?: return
        mutable.update { st -> chatTargetFor(st, id)?.let { st.copy(chatTarget = it) } ?: st }
        sendCommand(command)
    }

    /** 打开聊天浮层（顺手清未读） */
    fun openChatNow() {
        mutable.update { openChat(it) }
    }

    /** 收起聊天浮层 */
    fun closeChatNow() {
        mutable.update { closeChat(it) }
    }

    /** 切聊天频道 */
    fun selectChannel(channel: ChatChannel) {
        mutable.update { setChatChannel(it, channel) }
    }

    /** 关掉提示框（玩家点了其中一颗按钮，或点了外面） */
    fun dismissPromptNow() {
        mutable.update { dismissPrompt(it) }
    }

    /** 关掉物件面板 */
    fun closePanelNow() {
        mutable.update { closePanel(it) }
    }

    fun disconnect() {
        transport.close()
        mutable.update { it.copy(phase = Phase.Closed) }
    }

    /**
     * 本端提示（连接参数不合法、重连失败之类）。一定进消息流，与服务端文本同一套上限。
     *
     * ★ 为什么要这个口子：界面层（`:app`）也会遇到"需要告诉玩家一句话"的情况
     *   （比如地址填错）。让它自己往消息流里塞一行，就会绕过上限与不可变状态；
     *   收进这里只有一个写入点。
     */
    fun note(text: String) {
        mutable.update { systemLine(it, text) }
    }

    private fun send(text: String) {
        transport.send(text)
    }

    private fun onFrame(text: String) {
        val packet = try {
            decodePacket(text)
        } catch (e: Exception) {
            // ★ 这里**必须**留痕：能走到这里说明"服务端发的字段"与"Kotlin 模型"对不上
            //   （最可能是忘了跑 `node tools/gen-kotlin-protocol.mjs`）。
            mutable.update { systemLine(it, "协议不符（Kotlin 模型落后于服务端？）：${e.message}") }
            return
        }
        if (packet == null) {
            // 不认识的 type 或协议版本不一致。截断显示：一帧可能有几 KB。
            mutable.update { systemLine(it, "收到无法识别的帧：${text.take(120)}") }
            return
        }
        mutable.update { reduce(it, packet) }
    }
}

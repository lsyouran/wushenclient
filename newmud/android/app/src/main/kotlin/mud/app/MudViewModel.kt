package mud.app

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import mud.core.ChatChannel
import mud.core.ChatSubmit
import mud.core.MudClient
import mud.core.Phase
import mud.core.UiState
import mud.core.chatHintOf
import mud.core.composeChat
import mud.core.normalizeWsUrl

/**
 * 界面与 [MudClient] 之间的接线。
 *
 * ★ 这里**没有业务判断**：断线要不要清状态、文本往哪落，全在 `:core`。
 *   这一层只做三件事：把输入转成调用、把状态转成 `StateFlow`、定时发心跳。
 *
 * ★ 为什么 `ViewModel` 而不是把 `MudClient` 塞进 Activity：转屏 / 后台回来时
 *   Activity 会重建，而**连接不该跟着重建**（否则每次转屏都掉线重登）。
 */
class MudViewModel : ViewModel() {
    private val client = MudClient(OkHttpTransport())

    val state: StateFlow<UiState> = client.state

    private val serverUrlState = MutableStateFlow(DEFAULT_URL)
    val serverUrl: StateFlow<String> = serverUrlState.asStateFlow()

    /** 连上之后要发的登录包（`onOpen` 与 `login` 之间隔着一次异步，这里存着） */
    private var pendingLogin: Pair<String, String>? = null

    init {
        // 等"连上了"再发登录：`login` 发在 `onOpen` 之前会被服务端按"未连接"丢掉。
        viewModelScope.launch {
            client.state.collect { s ->
                val pending = pendingLogin
                if (s.phase == Phase.Connected && pending != null) {
                    pendingLogin = null
                    client.login(pending.first, pending.second)
                }
            }
        }
        // 应用层心跳：协议里有 `ping` 包，服务端按 `t` 算延迟、也用它判"还活着"。
        viewModelScope.launch {
            while (isActive) {
                delay(PING_INTERVAL_MS)
                if (client.state.value.phase == Phase.InGame) client.ping()
            }
        }
    }

    fun connect(url: String, token: String, roleId: String) {
        // ★ 地址在这里**规整**而不是校验：服务端 `--lan` 打印的是 `http://…/`，
        //   安卓端要的是 `ws://…/ws`。照抄那一行是第一次用就会踩的坑
        //   ⇒ 让 App 认 http/https/裸主机 三种写法（`normalizeWsUrl` 有单测）。
        val target = normalizeWsUrl(url)
        if (target == null) {
            client.note("地址格式不对：要像 ws://192.168.1.5:8123/ws（填 http://… 也会自动换成 ws）")
            return
        }
        if (token.length < TOKEN_MIN || token.length > TOKEN_MAX) {
            client.note("令牌要 $TOKEN_MIN–$TOKEN_MAX 个字符（协议要求；这是开发包，不验签）")
            return
        }
        if (roleId.isBlank()) {
            client.note("角色名不能为空")
            return
        }
        serverUrlState.value = target
        pendingLogin = token to roleId
        runCatching { client.connect(target) }
            .onFailure { client.note("连接失败：${it.message ?: it::class.simpleName}") }
    }

    /** 输入框 / 房间动作 / 物件动作都走这一条 */
    fun send(command: String) {
        client.sendCommand(command)
    }

    /**
     * 点房间里的人或物：发 `select <id>`；点**玩家**顺手把它设为私语对象。
     *
     * ★★ 是 `select`，**不是** `look`：服务端的 `look` 忽略参数，发它只会把房间
     *   描述再打一遍（26 册 §20.3 的真机记录）。两个指令都合法、选错**不报错**，
     *   所以静态闸门抓不到 —— 这类只能靠"移植时指到源文件行号"守住。
     *
     * 判断全在 `:core`，这一层只转发：
     *   · 该不该发、发什么字 = [mud.core.selectCommandFor]（空 id 返回 `null`）；
     *   · 哪个点算私语对象 = [mud.core.chatTargetFor]（只有玩家，且名字要剥掉颜色标签）。
     */
    fun select(id: String) {
        client.select(id)
    }

    // ── 聊天 ────────────────────────────────────────────────────────────────

    /** 打开聊天浮层（顺手清未读 —— 与网页端 `openChat()` 里的 `clearUnread()` 同一件事） */
    fun openChat() {
        client.openChatNow()
    }

    /** 收起聊天浮层。**不清未读**：收起来之后才到的消息才算未读 */
    fun closeChat() {
        client.closeChatNow()
    }

    /** 切聊天频道（房间 / 世界 / 私语） */
    fun selectChannel(channel: ChatChannel) {
        client.selectChannel(channel)
    }

    /**
     * 提交聊天正文。
     *
     * @return 发不出去时的**那一句话**；发出去了就是 `null`。
     *
     * ★ 一个方法管三种结果（发出去 / 正文空 / 私语缺对象）：合成规则是纯函数
     *   （`:core` 的 `composeChat`），文案是查表（`chatHintOf`），这一层只做转发。
     *
     * ★★ 提示**由调用方（浮层）显示，不进消息流**。这不是风格问题：
     *   浮层贴底盖住了消息流的最新几行，`client.note()` 写进去玩家**一个字也看不到** ——
     *   而"点了没反应"正是这个项目里最难查的一类缺陷（§80 的同一条判据：
     *   文本的落点由**它当时看得见哪块**决定，不由"它是什么类型"决定）。
     *
     * ★ 状态从 `client.state.value` 现取，不用参数传进来：频道与对象随时可能
     *   在浮层开着的时候被别处改掉（点房间里的人会改对象），传值会用到旧的那份。
     */
    fun submitChat(text: String): String? {
        val state = client.state.value
        val result = composeChat(state.chatChannel, state.chatTarget, text)
        if (result is ChatSubmit.Send) client.sendCommand(result.command)
        return chatHintOf(result)
    }

    /** 面板里的按钮 */
    fun sendPanel(command: String) {
        client.sendPanelCommand(command)
    }

    fun dismissPrompt() {
        client.dismissPromptNow()
    }

    fun closePanel() {
        client.closePanelNow()
    }

    fun reconnect() {
        pendingLogin = null
        runCatching { client.reconnect() }
            .onFailure { client.note("重连失败：${it.message ?: it::class.simpleName}") }
    }

    override fun onCleared() {
        client.disconnect()
        super.onCleared()
    }

    companion object {
        /**
         * 默认地址。
         *
         * ★ `10.0.2.2` 是**安卓模拟器**里代表宿主机的地址（模拟器自己的 `127.0.0.1`
         *   指的是模拟器本身）。真机要填电脑的局域网 IP，例如 `ws://192.168.1.5:8123/ws`。
         */
        const val DEFAULT_URL: String = "ws://10.0.2.2:8123/ws"

        private const val PING_INTERVAL_MS = 20_000L

        /** 协议 `login.token` 的长度区间（`shared/protocol.ts`） */
        private const val TOKEN_MIN = 16
        private const val TOKEN_MAX = 256
    }
}

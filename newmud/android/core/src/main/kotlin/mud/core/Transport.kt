package mud.core

import kotlinx.serialization.json.JsonObjectBuilder
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import mud.protocol.PROTOCOL_VERSION

/**
 * WebSocket 的最小契约 —— 就这三件事：连、发、断。
 *
 * ★ 为什么在 core 里定义接口、在 app 里实现（26 册 §83.3）：
 *   真机实现是 OkHttp；测试实现是一个**纯内存的假传输**（[android] 侧没有它）。
 *   于是"收到一帧之后界面该长什么样"可以完全脱离网络与安卓来验 ——
 *   拿 `fixtures/` 下那些**真机抓的帧**回放一遍就够了。
 *   ⚠️ 这里**不能**写成 `fixtures` + 斜杠 + 星号：Kotlin 的块注释可以嵌套，
 *     注释正文里出现"斜杠星号"会多开一层，后面的星号斜杠只关掉内层，
 *     整个文件余下都被当成注释，报 `Unclosed comment`（26 册 §87 那次 CI 首跑就是这个）。
 *
 * ★ 刻意**没有**"连接状态回调得告诉我重连策略"之类的扩展点：重连是界面层的事，
 *   而这层只负责搬运文本。多一个扩展点就多一处需要真机才验得了的行为。
 */
interface Transport {
    /**
     * 建立连接。
     *
     * @param onOpen  握手成功（可以发 `login` 了）
     * @param onFrame 收到一帧**文本**（二进制帧在实现里丢掉：协议全是 JSON）
     * @param onClosed 断开；参数是给人看的原因（不要拿它做分支判断）
     */
    fun connect(
        url: String,
        onOpen: () -> Unit,
        onFrame: (String) -> Unit,
        onClosed: (String) -> Unit,
    )

    /** 发一帧文本。未连接时由实现决定（建议忽略并回调 `onClosed`，不要抛） */
    fun send(text: String)

    /** 主动断开 */
    fun close()
}

/**
 * 客户端 → 服务端 的三种包（`CLIENT_PACKET_TYPES = command / login / ping`）。
 *
 * ★ 用 `buildJsonObject` 而不是字符串模板：指令是玩家输入的，
 *   里面可能有引号 / 反斜杠 / 换行。模板拼出来的 JSON 在这三种字符上会**静默变成非法帧**
 *   （服务端 schema 拒绝 ⇒ 玩家看到"没反应"，且没有任何错误可查）。
 */
object ClientPackets {
    /** 发一条指令（`cmd` 是触发词，不是显示名） */
    fun command(cmd: String): String = envelope("command") { put("cmd", cmd) }

    /** 登录。`token` 协议要求 16–256 字符；`roleId` 是角色名 */
    fun login(token: String, roleId: String): String = envelope("login") {
        put("token", token)
        put("role_id", roleId)
    }

    /** 心跳（服务端按 `t` 判延迟） */
    fun ping(nowMs: Long): String = envelope("ping") { put("t", nowMs) }

    private fun envelope(type: String, body: JsonObjectBuilder.() -> Unit): String =
        buildJsonObject {
            put("v", PROTOCOL_VERSION)
            put("type", type)
            body()
        }.toString()
}

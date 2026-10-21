package mud.app

import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString
import mud.core.Transport
import java.util.concurrent.TimeUnit

/**
 * 真机上的 [Transport]：OkHttp 的 WebSocket。
 *
 * ★ 这里**没有逻辑**：把四个回调原样转出去、把文本帧转出去。
 *   "收到帧之后界面该长什么样"在 `:core`（[mud.core.reduce]），
 *   于是这一层不需要真机也能被绕过（测试里用假传输回放同一批帧）。
 */
class OkHttpTransport : Transport {
    private val http: OkHttpClient = OkHttpClient.Builder()
        // ★ 应用层心跳（协议里的 `ping` 包）在 ViewModel 里发；
        //   这里再开一条 WebSocket 协议级 ping 是**另一条腿**：
        //   它由 OkHttp 自己发、自己收 pong，能在"应用层还在 but 链路已死"时更早发现。
        //   ★ 间隔必须**显著小于**服务端的 `hub.idleTimeoutMs`（26 册 §16.4 F1 的同一个道理）。
        .pingInterval(20, TimeUnit.SECONDS)
        .connectTimeout(10, TimeUnit.SECONDS)
        .build()

    private var socket: WebSocket? = null

    override fun connect(
        url: String,
        onOpen: () -> Unit,
        onFrame: (String) -> Unit,
        onClosed: (String) -> Unit,
    ) {
        // ★★ 先把上一条连接**掐掉**。`reconnect()` 会再调一次 `connect`，而旧 socket
        //   不会自己消失（只是引用被覆盖）：
        //   ① 泄漏一条真连接 —— 服务端按会话记，同名会话会叠着；
        //   ② 更糟：**旧连接的回调仍指向同一个 handler**，它稍后 `onClosed` 会把刚连上的
        //      新会话打成 `Phase.Closed`（真机表现是"重连成功，一秒后又断开"）。
        //   用 `cancel()` 而不是 `close()`：cancel 不发关闭帧、也**不回调** `onClosed`，
        //   正是"我主动换掉它"该有的语义（`close()` 走正常关闭，会回调，见 [close]）。
        socket?.cancel()
        socket = null

        val request = Request.Builder().url(url).build()
        socket = http.newWebSocket(
            request,
            object : WebSocketListener() {
                override fun onOpen(webSocket: WebSocket, response: Response) {
                    onOpen()
                }

                override fun onMessage(webSocket: WebSocket, text: String) {
                    onFrame(text)
                }

                override fun onMessage(webSocket: WebSocket, bytes: ByteString) {
                    // ★ 协议的每一帧都是 JSON **文本**帧。二进制帧不该出现；
                    //   真出现了也**不当成文本硬解**（硬解出来是乱码，会被当成协议不符报警，
                    //   把真正的原因盖掉）。丢掉即可 —— 服务端那边有对应的问题要查。
                }

                override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                    onClosed("连接关闭（$code ${reason.ifEmpty { "无原因" }}）")
                }

                override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                    onClosed(t.message ?: "连接失败")
                }
            },
        )
    }

    override fun send(text: String) {
        // ★ 未连接时 `send` 返回 false（OkHttp 的语义：缓冲满了或已关闭）。
        //   这里**不抛**：一条没发出去的指令不该把界面崩掉，玩家再点一次就是了。
        socket?.send(text)
    }

    override fun close() {
        socket?.close(NORMAL_CLOSURE, null)
        socket = null
    }

    private companion object {
        /** WebSocket 正常关闭码（RFC 6455） */
        const val NORMAL_CLOSURE = 1000
    }
}

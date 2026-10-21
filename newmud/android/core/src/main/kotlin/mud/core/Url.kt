package mud.core

/**
 * 把玩家**可能粘进来**的地址规整成 WebSocket 地址。
 *
 * ★ 为什么需要这一步（这不是"防御性编程"，是真实的第一次失败）：
 *   服务端 `npm start -- --lan` 打印的是
 *   `局域网    http://192.168.1.5:8123/   （手机/其他机器连这个）`
 *   —— 那是给**浏览器**看的（浏览器从页面同源推 `ws://…/ws`）。
 *   而安卓端要填的是 `ws://192.168.1.5:8123/ws`，**协议不同、还要多一个 `/ws` 路径**。
 *   照抄那一行进 App，结果是"连不上"，且看不出为什么。
 *   ⇒ 与其在说明里写三行注意事项，不如让 App 自己认这四种写法。
 *
 * 接受：
 * | 输入 | 输出 |
 * |---|---|
 * | `http://192.168.1.5:8123` | `ws://192.168.1.5:8123/ws` |
 * | `https://mud.example.com` | `wss://mud.example.com/ws` |
 * | `ws://10.0.2.2:8123` | `ws://10.0.2.2:8123/ws` |
 * | `192.168.1.5:8123`（没写协议） | `ws://192.168.1.5:8123/ws` |
 * | `ws://host:8123/ws`（已完整） | 原样（幂等） |
 * | `ws://host:8123/proxy/ws`（反代带前缀） | 原样（不硬塞 `/ws`） |
 * | `""` / 只有协议没有主机 | `null` |
 *
 * ★ **幂等**：把输出再喂进来必须不变。否则"点两次连接"会变成 `/ws/ws`。
 * ★ 不在这里校验主机名合法性（那是 DNS 的事）；这里只保证"形状对"。
 */
fun normalizeWsUrl(input: String): String? {
    val raw = input.trim()
    if (raw.isEmpty()) return null

    val lower = raw.lowercase()
    // 协议映射：浏览器地址 → WebSocket 地址（同主机同端口，只换协议）
    val (scheme, rest) = when {
        lower.startsWith("wss://") -> "wss://" to raw.substring(6)
        lower.startsWith("ws://") -> "ws://" to raw.substring(5)
        lower.startsWith("https://") -> "wss://" to raw.substring(8)
        lower.startsWith("http://") -> "ws://" to raw.substring(7)
        // 没写协议：按明文 ws 处理（局域网自测就是这种情况）
        else -> "ws://" to raw
    }

    // 主机的结束位置：第一个 `/` `?` `#` 之前
    val cut = rest.indexOfFirst { it == '/' || it == '?' || it == '#' }
    val authority = if (cut < 0) rest else rest.substring(0, cut)
    val tail = if (cut < 0) "" else rest.substring(cut)
    if (authority.isEmpty()) return null

    // 只给了主机（或根路径）⇒ 补上服务端的 WS 路径（`server/net/ws-server.ts` 的 `WS_PATH`）
    val path = if (tail.isEmpty() || tail == "/") "/ws" else tail
    return scheme + authority + path
}

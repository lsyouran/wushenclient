# 04 · WebSocket 传输层与连接生命周期

> 范围：`os/net-ws.js`（339 行）+ `os/ws.js`（49 行）+ `os/world.js:44-100` + `world/extends/login.js`

本项目**不使用 `ws` 库**，而是用 Node 原生 `net` 模块**手写了一套支持三种协议的 WebSocket/TCP 服务器**。这是全系统最底层的部分。

---

## 4.1 服务器结构

```js
// os/ws.js:3
const server = new ws({ SSL: false, KEY:"", CERT:"", PASSWORD:"" });
```

| 事件回调 | 定义于 | 转发目标 |
|---|---|---|
| `onConnect` | `os/ws.js:15` | `WORLD.connect(socket)` |
| `onSocketIn` | `os/ws.js:18` | `WORLD.SocketIn(socket)` |
| `onReceive` | `os/ws.js:23` | `WORLD.request(msg, socket)` |
| `onClientClose` | `os/ws.js:29` | `WORLD.disconnect(socket)` + `socket.destroy()` |
| `onClientTimeout` | `os/ws.js:36` | 若 socket 无已登录 user 则 `socket.end()` |
| `onClientError` | `os/ws.js:41` | `socket.destroy()` |

`listen` 时按 `SSL` 选择 `net` 或 `tls`（`os/net-ws.js:23`）。

---

## 4.2 协议协商（三选一）

首个数据包到达时解析 HTTP 头，按特征字段判定协议（`os/net-ws.js:52-70`）：

```js
socket.on('data', function (data) {
    if (socket.protocol) {
        socket.protocol.readData(data, socket, $this);      // 已协商 → 直接读帧
    } else {
        var header = readHeader(data);
        if (header["Sec-WebSocket-Key"])  socket.protocol = protocols.var1;   // RFC6455
        else if (header["Sec-WebSocket-Key1"]) socket.protocol = protocols.var2;  // 旧 draft
        else {
            socket.protocol = protocols.tcp;                 // 裸 TCP
            socket.protocol.readData(data, socket, $this);
            return;
        }
        socket.protocol.handShake(header, socket, data);
        $this.onConnect(socket);
    }
});
```

### 4.2.1 协议 A：`var1` — RFC6455（浏览器实际使用）

**握手**（`os/net-ws.js:74-94`）：

```js
hasher.update(header["Sec-WebSocket-Key"] + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11");
// 响应：
// HTTP/1.1 101 Switching Protocols
// Connection: Upgrade
// Upgrade: WebSocket
// Sec-WebSocket-Accept: <base64(sha1)>
// Sec-WebSocket-Origin: <origin>
```

> ⚠️ 未回 `Sec-WebSocket-Extensions`（源码中相关代码被注释，`os/net-ws.js:88-91`），所以**不支持 permessage-deflate 压缩**。大房间包（如 50 个物件的 `items`）会以明文完整传输。

**收帧**（`os/net-ws.js:95-136`）：

| 步骤 | 代码 | 说明 |
|---|---|---|
| FIN | `data[start] >> 7` | 读取但**未处理分片** |
| opcode | `data[start++] & 0xF` | Text=1 / Binary=2 / Close=8 / Ping=9 / Pong=10 |
| MASK 位 | `data[start] >> 7` | 必须为 1（浏览器客户端） |
| 长度 | `& 0x7F`；126 → UInt16BE；127 → UInt32BE | ⚠️ 127 分支 `readUInt32BE` 后直接 `return`（不支持 >4GB，可接受），但**用 UInt32 而非 UInt64** 是错的 |
| 解掩码 | `data[start] ^= data[markIndex + (i % 4)]` | 原地异或 |
| Text | `server.onReceive(msg, socket)` | 仅 Text 帧触发业务 |
| **Ping** | `case FrameTypes.Ping: break;` | ⚠️ **不回 Pong**！ |

> ⚠️ **Ping 不回 Pong 是本项目最严重的传输层缺陷之一**：浏览器发 Ping 后收不到 Pong，长时间挂机可能认为连接已死。前端也没有实现心跳（见第 18 册），因此**双方都没有保活机制**。

**发帧**（`os/net-ws.js:137-162`）：

```
length < 126      : [0x81][len][payload]
126 ≤ len < 65536 : [0x81][126][UInt16BE len][payload]
len ≥ 65536       : [0x81][127][UInt32BE 0][UInt32BE len][payload]
```

> ⚠️ ≥64KB 分支写入了 4 字节 0 + 4 字节长度，实际是标准的 64 位长度布局，未用掩码（服务端→客户端不需要），正确。

### 4.2.2 协议 B：`var2` — 旧 draft（hixie-76）

握手用 `Sec-WebSocket-Key1/Key2` 做 MD5 挑战（`os/net-ws.js:165-202`）；帧格式为 `0x00 ... 0xFF`（`:205-229`）。**仅保留兼容，现代浏览器不会走到。**

### 4.2.3 协议 C：`tcp` — 裸 TCP 长度前缀（给自定义/原生客户端用）

```
帧格式： [1字节长度] payload
         length == 254 → 后跟 UInt16BE 真实长度
         length == 255 → 后跟 UInt32BE 真实长度
```

支持**粘包/半包**：未读满时存入 `socket.unread_data`，下次拼接（`os/net-ws.js:236-239, 252-255`）。

> 💡 这个协议很适合做**非浏览器客户端**（如 Android/桌面端）。复刻时建议保留，它比 RFC6455 简单得多，且已内置粘包处理。

---

## 4.3 连接生命周期

```
① TCP 连接建立
   os/net-ws.js:40 onClientConnect
     → socket.send = 包装 protocol.sendData
     → socket.setTimeout(3000)          ← ⚠️ 3 秒超时，但 onClientTimeout 只在"无 user"时才 end
     → onSocketIn → WORLD.SocketIn(socket)

② WS 握手完成
   os/ws.js:15 onConnect → WORLD.connect(socket)     os/world.js:44
     → status < 0 或 check_connect 失败 → socket.end()
     → socket.user = new USER()
     → socket.user.socket = socket
     → socket.user.wait_input = USERLOGIN.check_session.bind(USERLOGIN)   ← ★ 首个输入处理器
     → socket.setTimeout(60000)

③ 客户端发首包（★ 鉴权）
   格式："<cookie.u> <cookie.p> [roleId] [serverId]"
   例：  "abc123  XyZ...base64..."          未选角色
        "abc123  XyZ...base64... 5f3a2b"   直接进角色
        "abc123  XyZ...base64... 5f3a2b 100"  跨服登录

④ 服务端处理（world/extends/login.js:6 check_session）
   ├─ 已登录过 → login_error('参数错误')
   ├─ 参数 < 2 → login_error('参数错误')
   ├─ encryptUser(u, p) → {id, name, pwd, loginTime, level}
   │    失败 → login_error("登录参数错误，请重新登录")，并 socket.end()
   ├─ 填 user.userid / password / loginTime / ip_address / user_level
   ├─ 人数校验：CONNECT_COUNT > 1100 或 USERS > 5100 → "服务器人数过多"
   ├─ WORLD.before_login(user) 失败 → "服务器正在关闭或开启"
   ├─ 4 参数 → 跨服分支：WORLD.can_cross(roleId) → on_user_cross_login
   ├─ 3 参数 → wait_login(user, 'login ' + roleId)
   └─ 2 参数 → load_roles(user) 拉角色列表 → user.wait_input = wait_login

⑤ 角色列表下发（world/extends/login.js:74-101）
   user.send("{type:'roles',roles:[{name:'..',title:'..',id:'..'}]}")
   无角色 → "{type:'roles',roles:[]}"

⑥ 客户端选角 → SendCommand("login <id>")
   → USERLOGIN.wait_login（extends/login.js:59）
   → WORLD.COMMANDS['login'].enter(user, id)（world/cmd/comm/login.js）
   → 查库 → loadData → do_login → 进入房间
   → 下发 {type:"login", id, level, setting} → 前端切换到游戏界面

⑦ 断开
   os/ws.js:29 onClientClose → WORLD.disconnect(socket)
   （玩家断线不立即销毁角色，由心跳超时判定：有 state 24h / 无 state 1h 后 quit）
```

---

## 4.4 顶号（重复登录）处理

`world/cmd/comm/login.js` 中：若 `userid` 已在 `WORLD.USERS` 中：

```js
// 校验 password 与 loginTime 一致
oldUser.disconnect(true);        // 断开旧连接但不销毁角色对象
oldUser.relogin(user);           // os/char/user.js:91
```

`relogin` 做的事（`os/char/user.js:91-117`）：

1. 接管新 socket（`this.socket = newUser.socket`）
2. **重发** `login_message`（缓存过的 `{type:"login"}`）
3. 回到 `quit_room`（`ROOM.Get(this.quit_room)`）
4. 重发三组房间包：`to_json()` + `send_exits()` + `items_to_json()`
5. 广播 `send_room(name + "重新连线。")`
6. `check_state()`（死亡状态下发 die 包）

> ✅ 这个"对象保留、socket 热替换"的设计很好，**断线重连体验无缝**，值得复刻。

---

## 4.5 前端连接实现（src/client.js）

```js
// src/client.js:152-161
Connect(callback) {
    var pol = location.protocol == "http:" ? "ws" : "wss";   // ⚠️ 算了但没用
    this.ws = new WebSocket('ws://' + this.IP + ':' + this.Port);   // 硬编码 ws://
    this.ws.onopen    = this.OnConnect;
    this.ws.onclose   = this.OnClose.bind(this);
    this.ws.onerror   = this.OnError;
    this.ws.onmessage = this.OnReceived.bind(this);
}
```

**OnConnect 发送的首包**（`src/client.js:27-39`）三种形态：

| 场景 | 发送内容 |
|---|---|
| 未选过角色 | `<cookie.u> <cookie.p>` |
| 指定 pid（跨服/重进） | `<cookie.u> <cookie.p> <pid> <server.ID>` |
| 已有角色 | `<cookie.u> <cookie.p> <Process.player>` |

**接收分发**（`src/client.js:165-174`）：

```js
OnReceived(evt) {
    var data = evt.data;
    if (data[0] == '{' || data[0] == '[') {          // ★ 首字符判定 JSON
        var func = new Function("return " + data + ";");   // ⚠️ eval 而非 JSON.parse
        this.OnData(func());
    } else {
        this.OnMessage(data);                        // 纯文本消息
    }
}
```

> ⚠️ 两个必须改进的点：
> 1. `new Function` 解析服务端数据 —— 服务端任何含可执行表达式的字符串都会被执行，**远程代码执行风险**。
> 2. `ws://` 硬编码 —— HTTPS 部署必被 Mixed Content 拦截。

**重连机制**（`src/client.js:68-84`）—— 唯一的"重连"是**懒触发**：

```js
export function SendCommand(cmd) {
    if (!GameClient || !GameClient.Connected()) {
        LastCommand = cmd;                                  // 缓存
        ReceiveMessage("<red>连接中断，正在重新连线...</red>");
        return connectServer(SelectedServer);               // 用户发指令时才重连
    }
    GameClient.Send(cmd);
}
function onLogin() { if (LastCommand) { SendCommand(LastCommand); LastCommand = null; } }
```

> ❌ **无心跳、无定时重连、无指数退避**。全项目 `grep -i "heartbeat|ping|keepalive"` 在 `src/` 下零命中。

---

## 4.6 防刷与限流

服务端（`os/world.js:75-91`）：

```js
request: function (request, socket) {
    var user = socket.user;
    if (user.request_count > 20) {                 // 单心跳周期（5s）内 > 20 条
        user.send("不要急，慢慢来。");
        return;
    }
    user.request_count++;
    try { user.command(request); }
    catch (e) { console.error(e); WORLD.log(...); }
    // 记录 WORLD.RECEIVED，> 1000 条落盘
}
```

`request_count` 在 `USER.heart_beat`（`os/char/user.js:504`）清零。

---

## 4.7 复刻建议

| 项 | wushen 做法 | 建议 |
|---|---|---|
| 协议实现 | 手写 RFC6455 | ❌ 新项目直接用 `ws` 库；**但可保留裸 TCP 协议**给原生客户端 |
| Ping/Pong | 不回 Pong | ❌ 必须实现，否则连接静默死亡 |
| 心跳 | 前端无、后端仅业务心跳 | ❌ 加应用层心跳（前端每 30s 发 `ping`，后端回 `pong`）+ 指数退避重连 |
| 首包鉴权 | `<key> <token> [role] [sid]` 明文空格分隔 | ✅ 思路保留；建议改成 JSON 首包 |
| 顶号 | 保留角色对象、替换 socket | ✅ 强烈建议保留 |
| 帧解析 | `new Function` | ❌ 改 `JSON.parse`，加 try-catch |
| 压缩 | 不支持 | 建议开启 `permessage-deflate`（房间包动辄数 KB） |

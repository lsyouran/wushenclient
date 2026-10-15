# 03 · HTTP 接口协议与鉴权体系

> 范围：`web.js` + `api/base.js` + `api/user.js` + `api/game.js`
> 本册回答：前端如何通过 HTTP 拿到"能连 WebSocket 的凭证"，以及完整的账号体系接口。

---

## 3.1 动态路由机制（★ 本项目的路由特色）

**没有手写任何一条业务路由**。Web 侧只有一个通配路由（`web.js:254`）：

```js
app.all('/api/:className/:methodName', async (req, res) => {
    const { className, methodName } = req.params;
    const ClassModule = APIS[className];                 // APIS = {user, game}
    if (!ClassModule) return res.status(404).json({ error: 'Method not found' });
    const instance = new ClassModule(req, res);          // ★ 每次请求 new 一个实例
    if (typeof instance[methodName] !== 'function')
        return res.status(404).json({ error: 'Method not found' });
    const params = { ...req.query, ...req.body };        // ★ query 与 body 合并
    const result = await instance[methodName](params);
    res.json(result);
});
```

**推论**：

| 特性 | 说明 |
|---|---|
| URL 格式 | `/api/{类名}/{方法名}`，例：`/api/user/login`、`/api/game/servers` |
| 方法 | `app.all` → **GET/POST 皆可**，参数统一从 `{...query, ...body}` 取 |
| 类名白名单 | 只有 `user` 和 `game`（`web.js:75`），`gm` 走独立代理 |
| 新增接口 | 只需在 `api/*.js` 类上加一个方法，**无需改路由** |
| 返回格式 | 一律 `res.json(业务对象)`；错误统一 `{error: "..."}` |
| 无鉴权中间件 | **每个方法自己调 `this.getUser()` 判断是否登录** |

同时还有一个 SSE 版本：`/sse/:className/:methodName`（`web.js:273`），用于服务端推送（当前无实际调用者）。

---

## 3.2 双 Cookie 会话凭证（★ 核心鉴权设计）

Web 服务器签发**两个 Cookie**，浏览器随后把它们作为 WebSocket 首包发给游戏服务器：

| Cookie | 名称 | 内容 | 作用 |
|---|---|---|---|
| SessionKey | `u` | `req.session.id`（express-session 的会话 ID） | 作为 **AES 密钥** |
| SessionToken | `p` | AES-128-CBC 加密的票据（base64） | 作为 **身份凭证** |

### 3.2.1 签发（api/base.js:19-34）

```js
signIn(id, uname, pwd, level) {
    if (!(id > 0)) return null;
    let key = this.req.cookies[SessionKey];              // 'u'
    if (!key) {
        key = this.sessionKey();                          // = req.session.id
        this.res.cookie(SessionKey, key, { maxAge: 3600000 * 24 * 180 });   // 180 天
    }
    let cert = this.encryptUser(id, uname, pwd, key, level);
    if (!cert) return null;
    this.res.cookie(SessionToken, cert, { maxAge: 3600000 * 24 * 180 });
    return cert;
}

encryptUser(id, uname, pwd, key, level) {
    return this.encrypt([id, uname, pwd, Date.now(), level].join('%'), key);
    //                  ↑ 明文格式： "12%zhangsan%5F4DCC3B5AA765D61D8327DEB882CF99%1712345678901%0"
}
```

### 3.2.2 加密（api/base.js:88-100）

```js
encrypt(str, key) {
    if (key.length > 16) key = key.substr(0, 16);        // ★ 截断到 16 字节
    key = Buffer.from(key, 'utf8');
    let cipher = crypto.createCipheriv('aes-128-cbc', key, __CONFIG.DESIV);
    let txt = cipher.update(str, 'utf8', 'base64');
    txt += cipher.final('base64');
    return txt;
}
```

### 3.2.3 校验（api/base.js:39-79）

```js
getUser() {
    let key = this.req.cookies[SessionKey];              // 'u' 作密钥
    let str = this.req.cookies[SessionToken];            // 'p' 作密文
    if (!str) return;
    this.loginUser = this.deEncryptUser(key, str);
    return this.loginUser;
}
deEncryptUser(key, cert) {
    let txt = this.deEncrypt(key, cert);                 // AES-128-CBC 解密
    let str = txt.split("%");
    if (str.length !== 5) return null;
    let id = parseInt(str[0]);
    if (id > 0) return { id, name: str[1], pwd: str[2], time: parseInt(str[3]), level: str[4] };
    return null;
}
```

### 3.2.4 游戏服务器侧校验（os/login.js:12-37）

**注意：游戏服务器不连 Redis、不查 session，它只做纯粹的对称解密**：

```js
encryptUser: function (key, session) {
    if (!key || !session) return null;
    if (key.length >= 16) key = key.substr(0, 16);
    key = Buffer.from(key, 'utf8');
    var decipher = crypto.createDecipheriv('aes-128-cbc', key, __CONFIG.DESIV);
    var txt = decipher.update(session, 'base64', 'utf8') + decipher.final('utf8');
    var str = txt.split("%");
    if (str.length !== 5) return null;
    var id = parseInt(str[0]);
    if (id > 0) return { id, name: str[1], pwd: str[2], loginTime: parseInt(str[3]), level: parseInt(str[4]) };
}
```

> ✅ **设计优点**：两台服务器零通信即可完成 SSO，靠共享 `DESIV` 密钥 + Cookie。
> ⚠️ **风险**：票据里含**明文 MD5 密码**（`pwd` 字段），且永不失效（180 天 Cookie、票据内无过期校验，`loginTime` 没有被任何逻辑比对）。Cookie 泄露 = 账号永久泄露。

### 3.2.5 密码存储

```js
MD5(str) {                                    // api/base.js:83-87
    let md5 = crypto.createHash('md5');
    return md5.update(str + __CONFIG.MD5).digest('hex').toUpperCase();
}
```

即 `pwd_db = MD5(明文 + MD5_PREFIX).toUpperCase()`，加盐但盐是全局固定值（`.env: MD5_PREFIX=12345`）。

---

## 3.3 接口清单 · `user`

| URL | 方法 | 入参 | 返回 | 说明 |
|---|---|---|---|---|
| `/api/user/login` | POST | `{code, pwd}` | 成功 `{code:1, p:"<票据>", u:"<sessionId>"}`<br>失败 `{code:0, result:"..."}` | `api/user.js:10`。`code` 转小写；正则 `/^[A-Za-z0-9_]{3,20}$/`；pwd 经 MD5 后比对 |
| `/api/user/regist` | POST | `{name, pwd, valno, phone?, guider?}` | `{code:1}` / `{code:0, result}` | `api/user.js:37`。name 3-15 位、pwd ≥5 位、校验验证码、查重、注册后**自动 signIn** |
| `/api/user/validimage` | GET | — | base64 字符串（SVG 验证码） | `api/user.js:64`。`svg-captcha` 生成 4 位；答案存 `req.session.valno` |
| `/api/user/getphone` | GET | — | `{code:1, result:"138********"}` | `api/user.js:75`。需登录；手机号脱敏显示前 3 位 |
| `/api/user/bindphone` | POST | `{code?, no?, pwd}` | `{code:1}` / `{code:0}` | `api/user.js:83`。已绑定时 `code`(尾号4位) 用于**解绑**（置 null）；未绑定时 `no`(11位手机号) 用于绑定；都需密码 |
| `/api/user/resetpwd` | POST | `{name, phone, vcode, pwd}` | `{code:1}` / `{code:0}` | `api/user.js:109`。**无需登录**，靠 `name + 完整手机号` 验证（⚠️ 手机号明文比对，且 `vcode` 参数声明但从未校验） |
| `/api/user/changepassword` | POST | `{oldpwd, pwd, no?}` | `{code:1, p, u}` / `{code:0}` | `api/user.js:128`。需登录；已绑手机需填尾号 4 位；成功后**重新签发票据** |
| `/api/user/GetPhone2` | GET/POST | `{uid, cert}` | 手机号明文 / 空 | `api/user.js:163`。⚠️ `cert` 硬编码比对 `'transrole_service'`，且含 `debugger` 语句，属于后门性质接口 |

**返回约定**：`{code:1}` 成功 / `{code:0, result:"原因"}` 失败。前端 `src/api.js` 只是参数字典，实际传输在 `src/utils/util.js:276 Request()`（fetch，`credentials:'include'`，JSON body，**callback 风格而非 Promise**）。

---

## 3.4 接口清单 · `game`

| URL | 方法 | 入参 | 返回 | 说明 |
|---|---|---|---|---|
| `/api/game/servers` | GET | — | `[{id,name,ip,port,istest,isdef,...}]` | `api/game.js:9`。首次查询后**缓存在模块级变量 `SERVERS`**，需 `/api/game/reload` 清缓存 |
| `/api/game/reload` | GET | — | — | `api/game.js:15`。清空 `SERVERS` 缓存 |
| `/api/game/search_role` | GET/POST | `{type, value}`<br>type ∈ `uname`/`name`/`phone` | `{code:1, result:[...]}` | `api/game.js:18`。按账号名/角色名/手机号查角色 |

> 前端实际只调用了 `servers`（`src/login/server.js`）。角色列表不走 HTTP，而是**登录 WebSocket 后由服务端下发 `{type:"roles"}` 包**。

---

## 3.5 GM 接口（`api/gm.js`，766 行）

两套访问路径：

1. **代理路径**：`/gm/*` 和 `/api/gm/*` → `http://localhost:8090`（游戏服务器内置 GM HTTP 服务）
2. **降级路径**：`/api/gm/*-local`（`web.js:192-213`），当 8090 不可用时使用同一份 `api/gm.js` 逻辑

主要接口（详见第 20 册）：

```
GET  /api/gm/status              服务器状态
GET  /api/gm/stats               统计
GET  /api/gm/online              在线玩家
GET  /api/gm/users               用户列表
GET  /api/gm/user/:id            用户详情
POST /api/gm/user/create         创建用户
DEL  /api/gm/user/:id            删除用户
GET  /api/gm/player/:id/full     角色全属性
POST /api/gm/player/fullattr     设置角色属性
POST /api/gm/command             执行 GM 命令（SendCommand("call ...")）
POST /api/gm/command/batch       批量执行
POST /api/gm/kick                踢人
POST /api/gm/ban  /unban         封禁（⚠️ 空壳 TODO）
POST /api/gm/teleport            传送
POST /api/gm/give                发物品
GET  /api/gm/items               物品模板列表
GET  /api/gm/rooms               房间列表
GET  /api/gm/logs                GM 日志
POST /api/gm/broadcast           全服广播
POST /api/gm/save                全量存档
POST /api/gm/hotload             热加载（⚠️ 有严重缺陷，见第 15/21 册）
```

---

## 3.6 前端对 HTTP 的封装

```js
// src/utils/util.js:276-301
async function Request(url, data, callBack, method) {
    // ProxyHost = "/"
    const resp = await fetch(url, {
        method: method || 'POST',
        credentials: 'include',                        // 带 Cookie
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
    });
    const result = await resp.json();
    callBack && callBack(result);                      // callback 风格
}
```

```js
// src/api.js:3-64 —— 纯参数字典，不含传输
export default {
    ValidationImage: () => Request('api/user/validimage', ...),
    Regist: (name, pwd, valno, phone) => ...,
    GetPhone, BindPhone, ChangePassword, ResetPasswordByPhone, ...
}
```

> ⚠️ `Request` 是 `async` 但所有调用方都**不 await**（callback 风格），导致错误无法向上传递。`api.js` 里 `GetRoles/AddRole/GetServer` 等定义了但**从未被调用**。

---

## 3.7 复刻建议

| 项 | 建议 |
|---|---|
| 动态路由 `/api/:class/:method` | ✅ 值得抄，小项目省事。但要加**方法白名单**（当前任意 public 方法都可被 URL 调用，含继承来的 `error/sessionKey` 等） |
| 双 Cookie + AES 票据 SSO | ⚠️ 思路可抄，但必须改：**票据内不放密码**、加有效期时间戳并校验、改 `aes-256-gcm` |
| 密码 MD5 + 固定盐 | ❌ 改为 bcrypt/argon2 |
| 每个方法自己鉴权 | ❌ 改为中间件统一处理 + 方法级元数据声明 |
| 前端 callback 风格 | ❌ 改为 Promise/async-await |

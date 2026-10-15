# ts-mud / newmud · 前端细则（`src/`，26 册 §15–§21）

> 从 `MEMORY.md` 拆出：只在动前端时读。主记忆文件只留指针。
> 原生 ESM + 纯 DOM，**不引框架不引打包器**；外观主体照 wushen。

- ★ 两块顶层屏互斥（`#auth`/`#app`），切屏唯一落点 `ui/screens.ts`，由服务端 `login` 帧驱动（"连上了"≠"进游戏了"）。
- ★ protocol **只 `import type`**（G14 机械守卫）；`ui/dom.ts` **不提供 innerHTML 助手**（XSS 结构防线）。
  `need()` 缓存容器、`fill()` 用 `replaceChildren`、动态列表事件委托、渲染函数纯。G2 对账双向。
- ★★ **"改前端"的默认动作是去 `D:/ts-mud/wushen/src/` 找对应组件再现代化移植，不是自己发明**。
  **判据**：我在 newmud 里加的机制若在 wushen 里找不到对应物，它就是"私自加戏"
  （实例：自造 `fontSizeFor()` 按字数缩字号被用户否掉，wushen 是写死 `font-size:12px`）。

## 各组件契约

- ★ **小地图**：字号唯一来源 `ui/map.ts#BASE_FONT`(=8)，`style.css` 里**不许**出现 `.ceg/.ccg text{font-size}`；
  装不下靠 `cellLabel()` 截断，**不靠缩字号**。出口行**只写方向**，房名归九宫格、完整房名挂 `title`；
  地图框 `viewBox` 跟着画了哪些格子收放、**宽度恒 216**。
- ★ **血条**：由 `session.ts#briefOf()` 发（`instanceof Character` ⇒ 玩家与 NPC 带、地面 OBJ 不带）。
  ★★ **地面物品没有血条，两侧一致**（§20.10）：wushen 权威是 `appdend_status` 只挂 `CHARACTER.prototype`
  ⇒ 服务端才发 `max_hp`。**这是"物品无血条"的唯一判据链，不要再找别的原因。**
  血条逐值照抄 `.progress`，三个易漏点：全局 `border-box`（漏 `box-sizing:content-box` 条子细一档）/
  `float:right`（掉血长的是**左边**空档）/ 名字缩进挂 `.item-name{margin-left:2em}`（不在行的 padding 上）。
- ★ **房间区只有一个滚动器**（§20.9.4）：`.content-room` **无规则**，`.room_items` 是 `max-height:8rem`
  + `overflow-y:auto`（**`rem` 不是 `em`**）；**不许**把外层滚动器加回来。
- ★ **命令不回显**：`LineKind 'cmd'` / `.ln.cmd` 已删。点实体发 **`select <id>`**。
- ★★ **聊天页签的 `data-ch` 就是命令名** ⇒ 页签里写一个服务端不认的词就是一个**假按钮**。
  现有页签：房间`say` / 世界`chat` / 私语`tell`（**「组队」已删** —— 队伍系统没做）。
  ★ 「世界」走 `chat`（**wushen 的原词**）；`shout,yell` 是别名。**别名只改敲法，不改协议里的 `ch`**。
- ★ **动作栏单点合成**：`ui/room.ts#renderActionBar()`（无参）合成 `state.room.commands + state.actions`，
  `#verbs` **只有这一个写入点**。`item`/`cmds` 帧落**消息流**的命令条，**不写动作栏、不开面板**。
- ★ **换行整段交给 `renderMarkup`**（`.ln` 是 `white-space:pre-wrap`），**不许** `split('\n')` 逐段渲染（FG-21）。
  ★ **"去掉标签"只有一份实现** `ui/markup.ts#plainText()`。
- ★ **CSS 数值级契约测试** `tests/web-ui.test.ts#declValue()`：判据是"**这个属性**只许声明一次"
  （不是"选择器只许出现一次"）—— 与 FG-7 同族：**扫描范围 ≠ 判定范围**就出假绿。
- ★ CJK 推进宽度实测 **= 1.00 em**（`getComputedTextLength` 量的）；别用 `getBBox()` 的**墨迹宽**推（会虚高）。
- ⚠️ `tests/web-ui.test.ts` 的用例共享模块级 `state` ⇒ **新用例要自带前置**，否则隐式依赖残留。
- ★★ **截图文件名是断言**：用了注入数据的必须带「注入/假/非真实数据」字样（踩过：`12-物品带血条.png`
  全是注入的假物件、**里面一个物品都没有**，把用户引来报了个假 bug）。
  ★ 探针里每个注入都要断言真的生效（`window.mud` **不暴露 `dispatchPacket`** ⇒ 要
  `state.xxx = …; window.mud.renderAll()`）。★ **"没量到 X"的结论必须配自检**（零注入 → 注入一个应有的 → 反向）。
  探针存档 `D:/ts-mud/_shots-前端对账-2026-10-12/_probes/`。
- ★ **XSS 面已确证封死**（2026-10-13 体检）：代码里 `innerHTML`/`outerHTML`/`insertAdjacentHTML`/
  `document.write`/`eval`/`new Function` **零命中**（仅注释命中）；`setAttribute` 无 `on*`/`href`/`src`；
  `markup.ts#parseInto` 白名单 + `createTextNode`。**不用再加防护，也别引入任何 innerHTML。**

## 已知缺陷（2026-10-13 体检，未修）

- F1 重复提交产生孤儿 socket，`hub.pruneIdle`(90s) 后把正在游戏的玩家踢回认证屏 —— 回收判据错用了
  `client.connected`（CONNECTING 时为 false）。应改为 `#socket !== null` + 入口 `if (busy) return`。
- F2 `login` 帧无超时/无重试/无取消 ⇒ 服务端不回 login 时永久卡在"正在进入江湖"。
- F3 前端**完全没有重连**（别加重连风暴：必须带退避，且复用 F2 的超时判据）。
- F4 `dialog` 的 `close/refresh/clear/remove` 四字段未消费 ⇒ 服务端发 close 反而弹出空面板。
- F5 表情面板是**死面板**（items 是纯字符串、`panel.ts:80` 只在 `cmds.length>0` 挂 cmdRow ⇒ 无点击行为）。
- F6 `markup.ts` 嵌套无深度上限 ⇒ `RangeError` ⇒ 该帧整体丢失、state 与 UI 不一致。
- F11 **注释里的"与 wushen 差别"依据是假的**：wushen `message.js:46-48` 在 `count>666` 时**确实**
  `queue.splice(0,1)[0].remove()` 回收旧页；`message.js:72-84` 的 `scroll2end()` 也是**条件**滚动。
  ⇒ 「为什么要 MAX_LINES」这条设计理由站不住，注释要改。
- 私自加戏清单（待用户裁定保留与否）：指令浮层 `#cmdPop` + 快捷 chip + 历史 ↑↓、Esc 一键收场、
  A11y 全套、`msg` 里把自己显示成「你」。

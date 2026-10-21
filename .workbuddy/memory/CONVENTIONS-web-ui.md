# ts-mud / newmud · 前端细则（`src/`，26 册 §15–§21）

> 从 `MEMORY.md` 拆出：只在动前端时读。主记忆文件只留指针。
> 原生 ESM + 纯 DOM，**不引框架不引打包器**；外观主体照 wushen。

- ★ 两块顶层屏互斥（`#auth`/`#app`），切屏唯一落点 `ui/screens.ts`，由服务端 `login` 帧驱动（"连上了"≠"进游戏了"）。
- ★ protocol **只 `import type`**（G14 机械守卫）；`ui/dom.ts` **不提供 innerHTML 助手**（XSS 结构防线）。
  `need()` 缓存容器、`fill()` 用 `replaceChildren`、动态列表事件委托、渲染函数纯。G2 对账双向。
- ★★ **"改前端"的默认动作是去 `D:/ts-mud/wushen/src/` 找对应组件再现代化移植，不是自己发明**。
  **判据**：我在 newmud 里加的机制若在 wushen 里找不到对应物，它就是"私自加戏"
  （实例：自造 `fontSizeFor()` 按字数缩字号被用户否掉，wushen 是写死 `font-size:12px`）。
- ★★ **配色/字号/按钮尺寸的第一步 = 真起 wushen 对量**（`node wushen/main.js` + `web.js`，8088/31300；
  本机 Node 24 载得动 `better-sqlite3`）。wushen **全站只有一个字号 14px**，工具键 35px / 行高 1.75em
  **全是派生的**；改 `--fs` 要**重算 em 注释里的像素数**。
- ★ **两族按钮皮肤不可混**：功能键 = 灰块黑字、内容动作 = 黑底灰字细边。

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
- ★★ **换房间要有反馈**（§61）：`world.ts` 的 `room` handler 在 **path 变了** 时
  `pushRule()` + `你来到了X。`（wushen `Process.room` 的 `keep_msg` 档；它默认档是**清屏**，
  本项目不清屏）。★ 房间**描述**仍然**不进**消息流 —— 进的是"换房间"这个**事件**的一句话。
  ★ 首次进房间（`state.room === null`）**不播报**：登录欢迎语 + 房间 `on_enter` 已经说过。
- ★★ **地面物品必须带「捡起」**（§61）：`select.ts#commandsOf()` 对 `kind === 'item'`
  先给 `{cmd:'get '+id, name:'捡起'}`（wushen `obj.js#query_desc` 无条件 push）。
  ★ 只列 `obj.actions` 会让"地上的东西在 UI 上永远捡不起来"。
- ★★ **聊天页签的 `data-ch` 就是命令名** ⇒ 页签里写一个服务端不认的词就是一个**假按钮**。
  现有页签：房间`say` / 世界`chat` / 私语`tell`（**「组队」已删** —— 队伍系统没做）。
  ★ 「世界」走 `chat`（**wushen 的原词**）；`shout,yell` 是别名。**别名只改敲法，不改协议里的 `ch`**。
- ★★ **面板分两类，形态也不同**（§62）：
  - **物件面板**（`item` 帧，点 NPC/物品）→ 贴被点那一行下面（`panelTop()`）+ **有遮罩** + 吸收回显；
  - **数据面板**（`dialog:score` 这类快照）→ **对齐房间区的矩形**（wushen 两者占同一布局位）·
    **无遮罩** · 不吸收回显 · 高度从房间区顶长到"留给底部两行"。
  ★★ **wushen 的 `.dialog` 不是浮窗**：`dialog/base.js#init()` 是把 `.content-room` 加 `hide`，
  自己顶上，**没有遮罩** —— 消息流/工具条照常可见可点。照"浮窗"做就是加遮罩 = 看属性等于暂停游戏。
  ★★ **面板会盖住消息流** ⇒ 必须给 `#output` 加 `padding-top`（= 面板底 − 消息流顶）并**强制贴底**，
  否则"开了属性面板，消息流像是空的"（真机量出来的）。用 padding 不用 margin（padding 参与滚动内容）。
  ★ 数据面板的 `left/width/max-height` 是**开启那一刻**按房间区矩形写的 inline style ⇒
  `resize` 必须重算（否则 390→320 时面板比房间区还宽）。★ 同键第二次按 = 收起；点「环顾」先收起。
  ★★ **`build` 收 `redraw`**（§63）：`openDataPanel(name, title, (redraw) => HTMLElement)`。
  **操作型面板**（背包/技能）的"选中 / 页签"是**面板内部状态**，服务端不该知道 ⇒ 改完状态调
  `redraw()` 就地重画，**不编帧往返**。属性面板用不到它（纯快照）。★ **不许在 `build` 里同步调
  `redraw`** —— clear→再 build→再 redraw 是同步递归，实测 `RangeError: Maximum call stack size
  exceeded`；`render()` 有 `rendering` 标志静默挡住。合法时机是事件回调。
  ★★ **L3 `Dialog.footer` 那一层还没有**（§63）：wushen 用它放批量动作（背包"整理/存仓/清理"）
  和页签（技能"基础/特殊/书架"）。做的时候**页签 ⊥ 动作** —— wushen 把两者塞进同一个
  `<span>` 靠 `for`/`cmd` 属性隐式区分，不要照抄：页签改内部状态，动作发命令，两个区域。
- ★ **动作栏单点合成**：`ui/room.ts#renderActionBar()`（无参）合成 `state.room.commands + state.actions`，
  `#verbs` **只有这一个写入点**。`item`/`cmds` 帧落**消息流**的命令条，**不写动作栏、不开面板**。
- ★ **工具条 4 格**（§61）：环顾 `look` / 属性 `score` / 指令浮层 / 聊天浮层。
  ★★ **窄屏（≤480px）收起「属性」格**（第 4 格会把气血/内力数值挤出可视区，
  320/360px 实测 `mp.right 216 > track right`）；小屏入口是 `ui/input.ts#CHIPS` 里的「属性」chip。
  ★ 判据是"**数值的 right 是否落在状态条 right 之内**"，不是 `scrollWidth > clientWidth`（差 1px 也报红）。
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

## 操作型面板（§64.10 落地后固化）

- **数据面板的两种形态**：`score` = 纯快照；`skills` = **有内部状态**（页签 / 选中）。
  后者靠 `openDataPanel(name, title, build)` 的 `redraw` 就地重画，**不编帧往返**。
- **三段必须分开**：页签（前端状态，不发命令）· 列表（快照）· 动作栏（发命令）。
  合并成一块就得靠属性名分流 —— 那是 wushen 的坑（26 册 §63.5）。
- **自定义内容怎么发命令**：`panel.ts#runPanelCommand(cmd)`（面板持有唯一的 `runner`）。
  别给 `build` 加第二个参数 —— 签名是 §62 定的，改它会连带动两处调用点与测试。
- **动作之后要重取**：`act = (cmd) => { run(cmd); run('skills'); }` —— 面板是快照，
  不重取就显示旧数据（练完还是 11 级）。
- **动作栏查数据要用整本册子**，不是当前页签那几项：装配按钮要查**另一页**的基本功。
  这个 bug 单测抓不到（断言都写在"点基本功"上），真机第一步就露。
- **模块级面板状态必须清**：`main.ts#backToAuth()` 调 `resetSkillsPanel()`，
  否则换角色后动作栏对着上一个角色的选择。测试里也要清（`afterEach`）。
- **按钮判据 = "玩家真能按吗"**：不会那门基本功就不摆「装配」；基础/知识类不摆「遗忘」。
- **破坏性动作用两步内联确认**（本项目没有 `_confirm`）：第一次点只换文案。
- 真机判据必须**量几何**（对齐房间区 / 不横向溢出 / `float:right`），jsdom 里全是 0×0。

## 真机抓到的自造坑（§60–§64 汇总，可复用）

- **面板高度别钳到房间区**：属性面板 302px 内容，钳到 121px 会直接切掉。
- **面板会盖住消息流**：`#output` 加 `padding-top` 并强制贴底。
- **`learnSkill` 先建档再判** ⇒ 被拒后技能簿也多 1 级 —— "全有或全无"**包括状态**。
- **探针自身会假绿**：chrome 子进程没杀干净、木人桩 30s 重生导致第二次找不到目标。
  ⇒ 探针收尾要杀进程 + 每步重取目标，别复用上一步的引用。
- ★ **`SVGElement` 没有 `.click()`**（那是 `HTMLElement` 的）⇒ 无头脚本点 SVG 格子（小地图）要用
  `dispatchEvent(new MouseEvent('click',{bubbles:true}))`。

## §79（2026-10-21）· 与 wushen 对账的**找法**

先读 `CONVENTIONS-web-ui.md` 与 `src/index.html` 文件头的四处差别，再按下面这张表找对应物
（不按名字找 —— 两边大量同名不同物，如 `main.js` 有 4 份、`message.js` 有 4 份）：

| wushen | newmud |
|---|---|
| `game/main.js` 的 `.container` 模板 | `src/index.html` |
| `styles/main.css` + `global.css` + `dialog.css` | `src/style.css` |
| `process.js`（`Process` 对象的方法名 = 帧 `type`） | `src/process/handlers/*` + `registry.ts` |
| `message.js`（`MessageQueue`） | `src/ui/stream.ts` |
| `combat.js` | `src/ui/room.ts`（动作栏）+ `process/handlers/combat.ts` |
| `map.js` | `src/ui/map.ts` |
| `dialog/base.js` | `src/ui/panel.ts` |

★ wushen 的 `Process` 是 `Process[data.type]` 直查方法名，**查不到就静默丢弃**
（`client.js:93-98`）⇒ 它是"最容易漏帧"的源头，对账帧清单时以它的**方法表**为准。

★★ 三条硬判据（本次踩出来，别再犯）：
1. **注释里的"与 wushen 一样/不同"是断言、会过期**。§79 撞到两处注释描述了
   **并不存在**的实现（`scroll-behavior`、冷却渐变）。**先信 grep，不信注释。**
2. **"CSS 写了机制" ≠ "有代码在推它"**。渐变 / 动画 / 进度这类**时间驱动**的东西，
   静态扫不出来 —— 必须查有没有定时器或逐帧写入，否则就是死代码。
3. **模块级状态在测试之间会残留**（§79.1：定时器句柄跨用例挂着 ⇒ 新用例的表没被 arm，
   表现为"改了没生效"）。⇒ 测试组自带 `afterEach` 清理；诊断时先验状态干不干净。

⚠️ **已裁定不动**（有理由，别再当缺口）：
- `.room-title` 的 `height`（wushen `main.css:463`）：补了会让换行房名与描述**重叠**
  （`overflow` 默认 visible，height 不裁剪、只压布局）。
- `.item-status-bar` 彩色胶囊（wushen `main.css:648-687`）：本项目用 `#pFlags` 一行文字，
  信息完整；改渲染要连带动测试，收益不抵风险。
- `.obj-money` / `setting` 帧 / `look3` / 表情面板：服务端**无生产者**，
  补 UI = 假按钮（26 册 §16.8）。

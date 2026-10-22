# ts-mud / newmud · 长期约定

> 根 `D:/ts-mud/newmud`；docs `D:/ts-mud/docs/`；git `D:/ts-mud/.git`。路径由 `import.meta.url` 上溯派生；禁硬编码 `newmud`、禁 `process.cwd()`（G12）。
> 分册（细则在里，动哪块读哪本）：引擎 `memory/CONVENTIONS-engine.md`｜前端 `CONVENTIONS-web-ui.md`｜**安卓 `CONVENTIONS-android.md`**。
> **26 册 = 审查唯一权威源**｜32 册 = 标识字典（先查）｜33 册 = 开发规范（动手前读）｜`_roadmap-还差多少-2026-10-16.md` = 缺口。本册只留"会踩的"。

## 验证内环（改完必跑；node 用托管 `22.22.2-6`）
```
tsc --noEmit · tsc -p tsconfig.web.json --noEmit   # 双 tsc 0 错
vitest run                                          # 52 文件 / 1178
tools/gate/run-all.mjs                              # 12 闸门（无 SKIP）
tools/e2e/smoke.mjs（≈20s）· tools/e2e/layout.mjs（30 条，≈15s）
tools/gate/mutation-test.mjs                        # 15–20min，119/119
tools/gen-kotlin-protocol.mjs --check               # Kotlin 模型 ⊥ protocol.ts
tools/gen-protocol-fixtures.mjs --list              # 样本缺口必须**有解释**
```
★★ 样本按**源文本**匹配 ⇒ 动 `server/engine/*`、改闸门、改样本合法性都要跑 mutation。★ 长跑重定向再读（管道退出码是 `tail` 的）。★ vitest 与 run-all 别同跑；`static-web.test.ts` 偶发 2 红，单跑必绿。
★★ mutation 跑着时**什么都别改，包括 docs/**（G16 扫文档，改一格就判基线不干净 ⇒ 整轮白跑）。判据按"这道闸门扫什么"划，不按"哪层"划。★★ 跑前关 `npm run dev`（--watch 把变异源码编进 `dist/web/`），跑完先 `npm run build:web`。

## 开服 / 构建（§77）
- `npm run dev` = 构建→起服务→开浏览器→**--watch 自动重建**（src/+shared/），日常用这条。`npm start` 构建一次（默认 8123，`-- --port 9000`）；`node tools/start.mjs` **不构建**。链 `tools/start.mjs`→`server/cli.ts`→`main()`；`server/main.ts` 纯工厂不能直跑。构建只有一处 `tools/build-web.mjs`。端口不猜：读 `READY {"port":N}`。静态与 WS 同端口；`GET /` 302→`/src/index.html`。默认 127.0.0.1，对外 `--host 0.0.0.0`。
- ★★ 手机联调一律 `npm run start:phone`（§88）：印**可拨的** ws 地址 + 真拨一次握手自检；`--lan` 的两行不能照抄给安卓端（`ws://0.0.0.0:8123/ws` 里的 0.0.0.0 是通配地址）。★ 自检绿证不到手机能连（防火墙不拦本机到本机）⇒ 真判据是手机浏览器打得开 `http://IP:8123/`。
- ★★ WS 路径 **`/ws`**，少了握手 400。★ `new WebSocketServer({port})` 构造时即 listen ⇒ 必须**构造后立刻**挂 `wss.on('error')`，否则进程挂死。★ e2e 里"可见"≠"可用"：`#auth` 是静态 HTML，点击必须等 `#serverLabel` 被填掉。

## 铁律
1. **fix-before-assert**：先写会红的断言并**实证**再改；新判据答：①运行时够得着吗？②谁在照它做？★★ 机检报 N 改 N = 抽样非收工。
2. 改闸门**或对应测试** ⇒ 跑 mutation；SKIP 不算通过；缺省分支也要测。
3. **单源真相**（`shared/ids|constants|protocol.ts`）；第二份清单就删。性别三档，`call3()` 两档。
4. 闸门规则自带 `dirs`；证样本可红，也要证**守卫自己**可红。
5. **注释/文档也是断言**；旧 T/FG 是快照非现状；连「✅ 已清偿」也是快照——声明前 grep 一次**生产调用点**。
6. **编号跨文件**：用号前全仓 grep；宁可顺延，不挪已引用的号。
7. ★ "靠某值不存在"的判据脆；先问"我这一动，谁的前提被取消"。
8. ★★ "不该改 X"的断言先问：**我什么都不做，这条也绿吗？** 修法：哨兵值 + 起点拨到相反。
9. ★★ "修复"自身也要复验（§55 修 17 条后揪出 4 条回归）；★ 错误路径必须**真起第二个进程**才证得了。
10. ★★ **类型也是闸门**：漏一支就报错 ⇒ 判别联合 + `switch` 无 `default` + `const x: never`；TS 与 Kotlin（`when` 无 `else`）同一条。
11. ★★ 改名批次要重看样本里那个名字还算不算违规（§67 三条假绿）；★ "加一层间接，代价不会真的是零"。
12. ★★ 能算的数不抄进文档，只写"怎么取"；**全称否定必须带扫描面**；一次性报告不贴"现值"标签（33 册红牌 13/14/15）。★★ **"绿/红/零命中"本身先自检**（2026-10-22 连踩三次）：空文件 vs 空文件 diff = identical（spanStyleOf 抽错文件）；`head -5` 截断把真命中看漏（MinHeight）；fixture 缺目录崩溃 exit 1 冒充"自证会红"（kt-symbols）。⇒ 每条"证据"先问：**这条绿是检出出来的，还是什么都没发生？**

## 命名（四层：代码名 / 数据键 / 中文 / 技能 id）
- ★★ 数据键 = **英文全名**（§67）；`PROP` 别名层**已删** ⇒ 写裸字面量键（`getProp(props,'attack')`），`[PROP.x]` 是旧写法；旧拼音查 `constants.ts#LEGACY_PINYIN_KEYS`（冻结）。
- ★★ 技能 id 是独立命名空间 ⇒ 数值名不得撞：`evasion`/`deflect`（`dodge`/`parry` 是技能 id，G3.G 守）；`force` 是潜伏下一例。
- ★★ 有效属性唯一口径 `formula.ts#effectiveAttr()`；三档口 `attrBreakdowns()`；**不用 enum**。
- ★★ world id 保留字：`RESERVED_AREAS` 含**全部 `KINDS`** ⇒ `item/`、`npc/`、`skill/` 作目录或指令 id 会 parse 失败；`world/command/obj/` 安全。

## grep 自检（★★ 最高频）
默认 BRE：`\s`/`\d` **不是**转义类 ⇒ 静默零命中；要 `-E`/`-P`。**"零命中"先用确知命中不了的串自检**。

## 环境坑
- `spawnSync` stdin 必须 `'ignore'`，不得 `status ?? 1` 兜底；Bash heredoc 被拦（用编辑工具写文件）；Windows `kill('SIGTERM')` 不投真信号。
- `fetch` 归一化 `%2e%2e` ⇒ 测路径穿越发**原始 HTTP**；`http.Server.close()` 不等连接 ⇒ 先 `closeAllConnections()`。
- ★ 有代理 ⇒ 本机服务 `--noproxy '*'`、无头浏览器 `--no-proxy-server`；无头 Chrome 最小宽≈522、别传 `--timeout`、`/tmp`→`D:/tmp`；两进程可绑同端口 ⇒ 先 `netstat -ano -p tcp`；jsdom 无布局 ⇒ 改 DOM 后跑无头探针。
- ★ `better-sqlite3` ABI 不匹配 ⇒ 用内置 `node:sqlite`；起 wushen 用**系统 Node 24**（托管 22 会 ERR_DLOPEN）。
- ★★ `.bat` 三坑（§88.5）：①必须纯 ASCII（中文 + chcp 65001 ⇒ 解码错位、注释被当命令执行）；②CRLF（LF 时 goto 失效）；③`endlocal & exit /b %CODE%` **写同一行**（分两行 ⇒ 退出码退化成 0 ⇒ 失败看起来成功）。闸门扫不到 `.bat`，判据只有"真跑一遍"。
- ★ 外网取包：maven.google.com 被代理 502；阿里云 `maven.aliyun.com/repository/google/…` 可取（2026-10-22 用它拿 material3 sources jar）。`gh` CLI 没有；GitHub 匿名 API 60 次/时。

## 闸门（细则 26 册 §27/§70/§71/§76）
- 退出码四态 0/1/2/3，`-1`=没起；元闸门判据 `before∉{FAIL,CRASH} && after===expectAfter && restored===before && note===''`；**取证不许带 `--only`**。
- ★★ `tools/` 内禁裸 `process.exit(1)`（G6.R6.7）⇒ `EXIT_FAIL`/`EXIT_PASS`；★ 加载期崩溃也是 1 ⇒ 套件用 `node --import preload.mjs`；块注释里不能写「星号+斜杠」glob。
- 窄口：G2 发送点↔声明↔台账｜G15 只判**代码注释**册号｜G16 判 docs 册号 + 绑定式 `NN 册 §X`（裸 `§X` 刻意不判）｜G16.5 00 册 §2 表⊥磁盘｜G17 tools 的 export 有外部消费者｜G18 32 册块⊥代码枚举｜G19 前端 `p['x']`⊥schema。
- ★★ **闸门全绿 ≠ 引用都对、≠ 契约都是真的**（§85.6 又抓到 5 处节号指错）。
- ★★ **不是越多越好**（§71.8.2）：没对象的规则仍绿｜判太宽就假红，假红=训练人忽略报警｜判"意图"必假红。加之前过五条：有单源/会漂/有人依赖/判据可落"位置"/造得出必然违规的样本。
- ★★ 手写清单 vs 磁盘事实是三处同病（`GATES`↔`g*-*.mjs`｜export↔谁 import｜00 册 §2↔磁盘）——只在有人新增时才红 ⇒ 必须配变异样本；新闸门忘登记会被 run-all 抓住。
- ★★ **词匹配判据必须"只剩代码"**：去注释（`readCode`）+ 去字符串（`blankStrings`）——G17 两次被自己的说明书救活：判据的观察对象包含自己的说明书是最阴的假绿。
- ★★ 标识清单别手抄：`npm run ids` / `--check` / `--write`（只重写块内、不会建块）。G3.A 守内容层 `prop:{…}` 只许字面量核心键；G3.F 已撤销，G3.C 是引擎层唯一守卫；变异夹具 safe-delete 配额 50/轮，还原只写不删。

## 文档册（入口 docs/00）
纪律：发现问题→**更新原册不另起**；索引只放链接；结论带"怎么证明"；标已办**保留原文**再 ✅。`24` 命名｜`25` 安全支付（暂缓）｜`26` 审查｜`27` 技能｜`28` 存档（T12 未做）｜`29` 属性数值｜`30` 测试策略｜`31` 运维｜`32` 标识字典；wushen 册 `docs/wushen/00`–`23`。
★★ 00 册有 §2 行×11 · §6 行×11 · §3 表 ⇒ 一次改动**逐处过**。★ 引用**必须带册号**；引用 wushen **一律带目录**。★ 三方对账是常态：文档 ↔ 代码 ↔ wushen 原作。

## 子系统速引（细则在分册）
- 引擎（动引擎/数值/网络前必读 CONVENTIONS-engine.md）：读档分级 §40——**`rejected` 非空即读档失败**；`SkillBook.load()` 绕过 `learn()/enable()` ⇒ 准入写**数据入口**；活体=`Actor.isAlive`；战斗时钟=`World.scheduler`；躲闪/招架线性对抗，无加成时 `ds===mz` ⇒ 永远躲不开；`die()` 幂等判据 `#dead`；`addExp()` 是经验唯一入口，上限单点 `skillLimit()`，1000 硬顶；基本武学曲线=**幂律凸** `(lv/ref)^e, e∈(1,3)`，别写 sqrt，住 `server/world/skill-curves.ts`。
- 前端（动前端必读 CONVENTIONS-web-ui.md）：原生 ESM + 纯 DOM；两块屏 `#auth`/`#app` 互斥，切屏唯一落点 `ui/screens.ts`；protocol 只 `import type`（G14）；★★ 先去 `D:/ts-mud/wushen/src/` 找组件移植（找不到对应物就是私自加戏）；配色/字号第一步=真起 wushen 对量（全站只有一个字号 14px）；面板文本落点只认帧上 `warn.context`（`absorb` 已整块删除，别加回来）；点房间里的人/物发 `select <id>` 不是 `look`。
- 安卓（动安卓必读 CONVENTIONS-android.md）：本机无 JDK/SDK/Gradle ⇒ **交付链只有 GitHub Actions**；`:core` 全部判断、`:app` 只渲染；CI annotation 并列多条 `e:` 必须逐条补丁再收口；视觉层级唯一口径 #000/#343434/#111/#222/#808080；`spanStyleOf` 改动前必做字节级 diff。

## 进度
**安卓 UI 已办到 §94**（26 册）：§91 控件质感重推｜§92 视觉重构（6 种灰→四档层级，自造色 11→3）｜§93 布局优化（小地图改底部弹出卡片[用户亲选]、输入框凹槽化、两张底部卡片互斥）｜**§94 布局塌陷订正**：根因 `MudAction` 内部 `Text.fillMaxWidth()` 在 `Row` 里反向撑大按钮、把 `weight(1f)` 兄弟压成 0（房名/指令框消失、只剩一条聚焦边，真机截图在 `newmud/old/`）；修法 `fillWidth`/`dense` 两个参数；地图改回**房名行下方就地展开**（§93.2.3 用户改判）、出口/动作栏 `dense` 40×32、删不可拖的假拖拽条。★★ 教训：§93 判据全绿 + CI 编译过，真机仍塌 —— 测量语义 grep 看不见，动"谁多宽"必须落真机截图核对表。2026-10-22 §93 已独立复核（CI 三作业 success，注解 8 条全是 workflow 弃用警告、无代码级 `e:`）；§93.4 API 事实已用 1.3.1 sources jar 订正（`MinHeight=56.dp` 与「经典重载无 contentPadding」成立；「两条正路」都是 1.4.0+，1.3.1 真实逃生口是 `DecorationBox`）。★ 真机自造坑见 CONVENTIONS-web-ui.md 末节。★ 批量改名翻过车：29 处指令 id `dazuo` 被误改成 `meditation` ⇒ 改完立刻 `grep -rn "<新名>" tests/`；旧拼音表不能当全仓禁用名单。
**仍未做**（`_roadmap` §九）：钱挣不到（只有 spendMoney）｜T12 账号/存档/验签｜绝招执行体 + BUFF（pfm 只有数据面）｜dazuo/药真恢复｜境界 level_up｜交易/任务/装备｜on_kill｜知识·隐藏技能｜G9 闸门｜真浏览器 e2e｜G2.3 变异样本（T13）｜物品进出钩子｜**装机看观感**（无静态判据，只能人看真机）｜MudField 56dp 阻塞（§93.4）｜反向 import 闸门进仓库接 CI（kt-symbols.mjs 已自证会红但还在 D:/tmp）。★ 回血/打坐/暴虐丹 prop 三条在代码注释挂账；★ E9 待专项（recount 只钳 hp 不钳 mp）；★ E 号多来源，引用带册号。~~NPC 还手~~已成立别再当缺口（2026-10-20 真机证伪）。

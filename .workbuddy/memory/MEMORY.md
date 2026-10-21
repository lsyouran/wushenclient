# ts-mud / newmud · 长期约定

> 根 `D:/ts-mud/newmud`；docs `D:/ts-mud/docs/`；git `D:/ts-mud/.git`。路径由 `import.meta.url` 上溯派生；禁硬编码 `newmud`、禁 `process.cwd()`（G12）。
> **本册只留"会踩的"**：细则 `memory/CONVENTIONS-engine.md` / `CONVENTIONS-web-ui.md`｜**26 册 = 审查唯一权威源**｜**32 册 = 标识字典（先查）**｜**33 册 = 开发规范（动手前读）**｜`_roadmap-还差多少-2026-10-16.md` = 缺口。

## 验证内环（改完必跑，node 用托管 `${...}/22.22.2-6/node.exe`）
```
tsc --noEmit · tsc -p tsconfig.web.json --noEmit   # 双 tsc 0 错
vitest run                                          # 52 文件 / 1178
tools/gate/run-all.mjs                              # 12 闸门（无 SKIP）
tools/e2e/smoke.mjs（≈20s）· tools/e2e/layout.mjs（30 条，≈15s）
tools/gate/mutation-test.mjs                        # 15–20min，119/119
tools/gen-kotlin-protocol.mjs --check               # Kotlin 模型 ⊥ protocol.ts
tools/gen-protocol-fixtures.mjs --list              # 样本缺口必须**有解释**
```
★★ 样本按**源文本**匹配 ⇒ 动 `server/engine/*`、改闸门、改样本里那个名字的合法性都要跑 mutation。★ 长跑重定向再读（管道退出码是 `tail` 的，不能当 `EXIT` 取证）。★ vitest 与 run-all 别同跑；`static-web.test.ts` 偶发 2 红，单跑必绿。
★★ **mutation 跑着时"什么都别改"，包括 `docs/`**（§77.6）：G16 扫文档，改一格就判"基线不干净"⇒ 整轮白跑。判据按**"这道闸门扫什么"**划，不是按"哪层"划。
★★ **跑 mutation 前关掉 `npm run dev`**：`--watch` 会把变异源码编进 `dist/web/`；跑完先 `npm run build:web`。

## 开服 / 构建（§77）
- `npm run dev` = 构建 → 起服务 → 开浏览器 → **`--watch` 自动重建**（src/ + shared/）。日常用这条。
- `npm start` 构建一次（默认 8123，`-- --port 9000`）；`node tools/start.mjs` **不构建**。链 `tools/start.mjs`→`server/cli.ts`→`main()`；`server/main.ts` 纯工厂不能直跑。
- 构建只有一处 `tools/build-web.mjs` —— **别再往别处拼 tsc 参数**。端口不猜：读 `READY {"port":N}`。
- 静态与 WS **同端口**；`GET /` 302→`/src/index.html`。默认 `127.0.0.1`，对外 `--host 0.0.0.0`。`--lan` 打印 `http://IP:8123/`（给浏览器），App 要 `ws://IP:8123/ws`。
- ★★ WS 路径 **`/ws`** —— 少了它握手 **400**。★ `new WebSocketServer({port})` **构造时即 listen** ⇒ 必须**构造后立刻**挂 `wss.on('error')`，否则进程挂死（§55 M2）。
- ★★ e2e 里**"可见"≠"可用"**：`#auth` 是静态 HTML，点击必须等 `#serverLabel` 被填掉。

## 铁律
1. **fix-before-assert**：先写会红的断言并**实证**再改。新判据答：①运行时够得着吗？②**谁在照它做？** ★★ 机检报 N 改 N = 抽样非收工。
2. 改闸门**或对应测试** ⇒ 跑 mutation；SKIP 不算通过；缺省分支也要测。
3. **单源真相**（`shared/ids|constants|protocol.ts`）；第二份清单就删。性别三档，`call3()` 两档。
4. 闸门规则自带 `dirs`；证样本可红，也要证**守卫自己**可红。
5. **注释/文档也是断言**；旧 T/FG 是**快照非现状**。★★ 连「✅ 已清偿」也是快照：声明前 grep 一次**生产调用点**。
6. **编号跨文件**：用号前全仓 grep；宁可顺延，不挪已引用的号。
7. ★ "靠某值不存在"的判据脆；先问"我这一动，谁的前提被取消"。
8. ★★ "不该改 X"的断言先问：**我什么都不做，这条也绿吗？** 修法：**哨兵值 + 起点拨到相反**。
9. ★★ **"修复"自身也要复验**：收工前对**改动本身**再独立复查一轮（§55 修 17 条后揪出 4 条回归）。★ 错误路径必须**真起第二个进程**才证得了。
10. ★★ **类型也是闸门**：要"漏一支就报错" ⇒ **判别联合 + `switch` 无 `default` + `const x: never`**；TS 与 Kotlin（`when` 无 `else`）同一条。
11. ★★ **改名批次要重看样本里那个名字还算不算违规**（§67 三条假绿）。★ "加一层间接，代价不会真的是零"。
12. ★★ **能算的数不抄进文档**，只写"怎么取"；**全称否定必须带扫描面**（"看不见"≠"不存在"）；**一次性报告不贴"现值"标签** ⇒ 33 册红牌 13/14/15。★★ 这三条全是**新写的注释 20 分钟内被自己证伪** —— 闸门只守"结构事实"，数字与自然语言断言仍在人工区。

## 命名（四层：代码名 / 数据键 / 中文 / 技能 id）
- ★★ 数据键 = **英文全名**（§67）；`PROP` 别名层**已删** ⇒ 写**裸字面量键**（`getProp(props,'attack')`），`[PROP.x]` 是旧写法。旧拼音查 `constants.ts#LEGACY_PINYIN_KEYS`（冻结）。
- ★★ 技能 id 是独立命名空间 ⇒ 数值名不得撞：`evasion`/`deflect`（`dodge`/`parry` 是技能 id，G3.G 守）。`force` 是潜伏下一例。
- ★★ **有效属性**（§37）唯一口径 `formula.ts#effectiveAttr()`；三档口（§39）`attrBreakdowns()`。**不用 `enum`**。
- ★★ **world id 保留字**：`RESERVED_AREAS` 含**全部 `KINDS`** ⇒ `item/`、`npc/`、`skill/` 作目录或指令 id 会 parse 失败；`world/command/obj/` 安全。

## grep 自检（★★ 最高频）
默认 BRE：`\s`/`\d` **不是**转义类 ⇒ 静默零命中；要 `-E`/`-P`。**"零命中"先用确知命中不了的串自检**。

## 环境坑
- `spawnSync` stdin 必须 `'ignore'`，不得 `status ?? 1` 兜底；Bash heredoc 被拦（用编辑工具写文件）；Windows `kill('SIGTERM')` 不投真信号。
- `fetch` 归一化 `%2e%2e` ⇒ 测路径穿越发**原始 HTTP**；`http.Server.close()` 不等连接 ⇒ 先 `closeAllConnections()`。
- ★ 有代理 ⇒ 复核本机服务 `--noproxy '*'`、无头浏览器 `--no-proxy-server`；无头 Chrome 最小宽≈522、别传 `--timeout`、`/tmp`→`D:/tmp`。★ 两进程可绑同端口 ⇒ 先 `netstat -ano -p tcp`。★ jsdom 无布局 ⇒ 改 DOM 后跑无头探针。
- ★ `better-sqlite3` ABI 不匹配 ⇒ 本项目用内置 `node:sqlite`；起 wushen 用**系统 Node 24**（托管 22 会 ERR_DLOPEN）。

## 闸门（细则在 26 册 §27/§70/§71/§76）
- 退出码四态 0/1/2/3，`-1`=没起。元闸门判据 `before∉{FAIL,CRASH} && after===expectAfter && restored===before && note===''`。**取证不许带 `--only`**。
- ★★ `tools/` 内**禁裸 `process.exit(1)`**（G6.R6.7）⇒ `EXIT_FAIL`/`EXIT_PASS`。★ **加载期崩溃也是 1** ⇒ 套件用 `node --import preload.mjs`；★ 块注释里不能写「星号+斜杠」的 glob。
- 窄口：**G2** 发送点↔声明↔台账（发送点锚在 `packet(` 体内）｜**G15** 只判**代码注释**册号｜**G16** 判 `docs/` 册号 + **绑定式** `NN 册 §X`（**裸 `§X` 刻意不判**，实测 80/107 假红）｜**G16.5** 00 册 §2 表 ⊥ 磁盘册｜**G17** `tools/` 的 `export` 有外部消费者｜**G18** 32 册块 ⊥ 代码枚举｜**G19** 前端 `p['x']` ⊥ schema（唯一真加载 TS）。
- ★★ **闸门全绿 ≠ 引用都对、≠ 契约都是真的**（§85.6 又抓到 5 处节号指错）。
- ★★ **不是越多越好**（§71.8.2）：没对象的规则仍绿｜判太宽就假红、假红=训练人忽略报警｜判"意图"必假红｜成本 O(规则×样本)。**加之前过五条**：有单源/会漂/有人依赖/判据可落"位置"/造得出必然违规的样本。
- ★★ **手写清单 vs 磁盘事实是三处同病**（`GATES`↔`g*-*.mjs`｜`export`↔谁 import｜00 册 §2↔磁盘）：**只在有人新增时才红，平时永远绿** ⇒ 必须配变异样本。新闸门忘登记会被 run-all 抓住。
- ★★ **词匹配判据必须"只剩代码"**：去注释（`readCode`）+ 去字符串（`blankStrings`）。G17 **两次**被自己的说明书救活 —— **判据的观察对象包含了自己的说明书**是最阴的假绿。
- ★★ **标识清单别手抄**：`npm run ids` / `--check` / `--write`（只重写块内、不会建块）。★ **G3.A** 守内容层 `prop:{…}` 只许字面量核心键；**G3.F 已撤销**，G3.C 是引擎层唯一守卫。★ 变异夹具 safe-delete 配额 50/轮，还原**只写不删**。

## 文档册（入口 `docs/00`）
纪律：发现问题→**更新原册不另起**；索引只放链接；结论带"怎么证明"；标已办**保留原文**再 ✅。
`24` 命名｜`25` 安全支付（暂缓）｜`26` 审查｜`27` 技能｜`28` 存档（T12 未做）｜`29` 属性数值｜`30` 测试策略｜`31` 运维｜`32` 标识字典；wushen 册 `docs/wushen/00`–`23`。
- ★★ 00 册有 §2 行×11 · §6 行×11 · §3 表 ⇒ 一次改动**逐处过**。★ 引用**必须带册号**；引用 wushen **一律带目录**。★ 三方对账是常态：文档 ↔ 代码 ↔ **wushen 原作**。

## 子系统 → **动引擎/数值/网络前必读** `CONVENTIONS-engine.md`
- ★★ 读档分级（§40）：**`rejected` 非空即读档失败**；`SkillBook.load()` 绕过 `learn()/enable()` ⇒ 准入写**数据入口**。
- ★★ 活体 = `Actor.isAlive`（`Item` 不是）；战斗时钟 = `World.scheduler`；躲闪/招架**线性对抗**，无加成时 `ds===mz` ⇒ **永远躲不开**；`die()` 幂等判据是 `#dead`。
- ★★ `addExp()` 是经验**唯一入口**；上限单点 `skillLimit()`，1000 是硬顶。★ 基本武学曲线 = **幂律凸** `(lv/ref)^e, e∈(1,3)`；**别写 sqrt**（凹，方向反了）；曲线住 `server/world/skill-curves.ts`。

## 前端（`src/`，26 册 §15–§21）→ **动前端必读** `CONVENTIONS-web-ui.md`
原生 ESM + 纯 DOM，**不引框架/打包器**；两块屏 `#auth`/`#app` 互斥，切屏唯一落点 `ui/screens.ts`；protocol 只 `import type`（G14）。
★★ **先去 `D:/ts-mud/wushen/src/` 找组件移植**（找不到对应物就是私自加戏）；★★ 配色/字号第一步 = 真起 wushen 对量（全站只有一个字号 14px）。
★★ **面板文本落点只认帧上的 `warn.context`**（§80）：**`absorb` 已整块删除，别加回来**（§57/§74/§78 各错一次）；默认方向是"没声明就进消息流"。
★★ **点房间里的人/物发 `select <id>`，不是 `look <id>`**：`look` 忽略参数 ⇒ 点谁都是把房间描述再打一遍（§20.3）。两个指令都合法、选错不报错 ⇒ 静态闸门抓不到，只能靠"移植时指到源文件行号"。

## 安卓端（`android/`，26 册 §82–§85）→ **交付链只有 GitHub Actions**
`:protocol` 生成物 + 解码测｜`:core` **全部判断**（纯 JVM）｜`:app` 只有 Compose 渲染 + OkHttp。
★★ **本机无 JDK / Android SDK / Gradle（也没提交 wrapper jar）** ⇒ Kotlin 一项都靠 CI。要本机跑纯 JVM 两模块，需 JDK **17**（toolchain 写死 17，且 `auto-download=false`；装 21 会报 `No matching toolchain`）+ Gradle 8.11.1（或 `gradle wrapper` 生成后不提交）⇒ `./gradlew :protocol:test :core:test -PskipApp`；`:app` 仍要 SDK（AGP 配置期就要 `ANDROID_HOME`）。★ **用户机器内存紧** ⇒ 本机跑加 `--no-daemon -Dorg.gradle.jvmargs=-Xmx900m -Pkotlin.compiler.execution.strategy=in-process`（省掉 Kotlin 独立守护进程那 ~500MB），并先关 `npm run dev`。workflow 在**仓库根** `D:/ts-mud/.github/workflows/android.yml`（git 根是 `ts-mud/`）⇒ 路径带 `newmud/` 前缀。
★★ **协议不许手抄**（`gen-kotlin-protocol.mjs`，`--check` 防漂移）；样本是真机抓帧（13/35，缺的在未接线台账）。
★★ 文本落点同网页端一条判据（`Reduce.kt#placeText`）；`when (packet)` **无 `else`** ⇒ 协议新增包**编译失败**（故意）。
★★ **凡有判据的都推进 `:core`**（§85.3）：地图几何/短名/截断 = `MapLayout.kt`、方向表 = `Dirs.kt`、出口行/动作栏过滤 = `RoomView.kt`；`:app` 只把算好的坐标换成 `dp`。`Double.dp`/`Double.sp` 直接可用。★ 构造一律**具名实参**（插字段时同类型位置实参编译器挡不住）。
★★ 本机 Kotlin 自查三个一次性脚本在 `D:/tmp`（括号+包名 / import⊥声明 / 具名实参⊥声明），**不进仓库**，且都要**自证会红**；★ 真相源文件须排除在扫描面外（否则 `val x: Boolean = false` 被当成具名实参）。
★★ **聊天浮层**（26 册 §86）：判断全在 `:core Chat.kt`（`ChatSubmit` 三支、`chatTargetFor` 只对玩家且**剥标签**）；`:app ChatSheet` 贴底卡片**不用 `Dialog`**（输入框与 inset 抢）。★★ **失败提示画在浮层里不进消息流** —— 浮层盖住消息流，写进去看不见（§80 同一条：落点按"当时看得见哪块"划）。
★★ **地图宽度 276dp 是算出来的**（1 单位 = 1dp），窄屏只能 `horizontalScroll` 不能缩放；`horizontalScroll` **不许无条件套**（子项约束变 infinite ⇒ 居中失效）。
★ 未做：保活（API 35 dataSync 6h/24h 额度）、翻历史不被拽回、选角/注册、`score`/`skills` 面板、招式栏、说话人名单独上色、`SelectionContainer`、格子 48dp、指令历史、界面层断言（`createComposeRule`，别上模拟器）。
★★ **传输层不做应用层 HTTP 中转**（§84）：那是**浏览器没有 WS 时代**的妥协；要 TLS/端口/穿透就上**反代**（不懂业务协议）。`Transport` 是唯一替换点 ⇒ 选错代价有界。

## 进度
**已办到 §85**；批次明细与判据**全在 26 册**（§32–§56 收口｜§57–§62 真机/皮肤｜§64–§66 技能链与幂律凸曲线｜§67–§69 键英文化 + 32/33 册｜§70–§71.8 闸门层｜§72–§76 真机缺陷/境界/G19｜§77 dev/e2e 入口｜§79 前端↔wushen 对账｜§80 `warn.context`｜§81 版式 30 条｜§82–§85 安卓端）。
★ 真机自造坑见 `CONVENTIONS-web-ui.md` 末节。★ **批量改名翻过车**：29 处指令 id `dazuo` 被误改成 `meditation` ⇒ 改完立刻 `grep -rn "<新名>" tests/`；旧拼音表**不能**当全仓禁用名单。

**仍未做**（详见 `_roadmap-还差多少-2026-10-16.md` §九）：钱挣不到（只有 `spendMoney`）｜T12 账号/存档/验签｜**绝招执行体 + BUFF**（`pfm` 只有数据面）｜~~NPC 还手~~**已成立别再当缺口**（2026-10-20 真机证伪）｜`dazuo`/药真恢复｜境界 `level_up`｜交易/任务/装备｜`on_kill`｜知识·隐藏技能｜G9 闸门｜真浏览器 e2e｜G2.3 变异样本（T13）｜物品进出钩子。★ 回血/打坐/暴虐丹 prop 三条在**代码注释**挂账。★ **E9 待专项**（`recount` 只钳 hp 不钳 mp）。★ **E 号多来源，引用带册号**。

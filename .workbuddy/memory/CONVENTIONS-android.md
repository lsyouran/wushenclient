# 安卓端约定（`newmud/android/`，26 册 §82–§94）

> 动安卓端前读本册。`:protocol` 生成物 + 解码测｜`:core` **全部判断**（纯 JVM）｜`:app` 只有 Compose 渲染 + OkHttp。

## 交付链只有 GitHub Actions
★★ **本机无 JDK / Android SDK / Gradle（也没提交 wrapper jar）** ⇒ Kotlin 一项都靠 CI。
要本机跑纯 JVM 两模块：JDK **17**（toolchain 写死 17、`auto-download=false`；装 21 报 `No matching toolchain`）+ Gradle 8.11.1 ⇒ `./gradlew :protocol:test :core:test -PskipApp`；`:app` 仍要 SDK（AGP 配置期就要 `ANDROID_HOME`）。
★ 用户机器内存紧 ⇒ 本机跑加 `--no-daemon -Dorg.gradle.jvmargs=-Xmx900m -Pkotlin.compiler.execution.strategy=in-process`（省 Kotlin 独立守护进程 ~500MB），并先关 `npm run dev`。
workflow 在**仓库根** `D:/ts-mud/.github/workflows/android.yml`（git 根是 `ts-mud/`）⇒ 路径带 `newmud/` 前缀。远端 `git@github.com:lsyouran/wushenclient.git`。
协议不许手抄：`tools/gen-kotlin-protocol.mjs --check` 防漂移；样本是真机抓帧（13/35，缺的在未接线台账）。

## CI 取证（26 册 §87｜31 册 §9.7）
- 只走注解：匿名 `/logs` **403**、summary 页 JS 渲染抓不到正文、只有 `check-runs/<id>/annotations` 匿名可读；匿名 API **60 次/时**（WebFetch 是另一个出口，配额不同）。`gh` CLI 本机没有 ⇒ WebFetch 打 `https://api.github.com/repos/lsyouran/wushenclient/commits/<sha>/check-runs` 拿 conclusion，再逐 id 打 annotations。
- ★★ **annotation 里并列的多条 `e:` 必须逐条对应补丁再收口**（2026-10-22 三轮才绿：Kotlin 一次报全同批未解析引用，只修第一条 = 白跑一轮 CI）。
- GitHub 默认 shell 是 `bash -eo pipefail` ⇒ 诊断步骤**自己必须永远 exit 0**，别在 YAML 拼 grep（没匹配就打断整步 = 最需要看原因时啥都没有）。`jvm-tests` 的两个测试是**两个 step**（一条 gradle 串两个 task ⇒ 前一个红、后一个根本不跑）。
- 2026-10-22 实测（run `39785473098` / `0ed3a0c`）：三作业 success，注解 8 条**全是 workflow 层弃用警告**（Node 20 被强制迁 24、`setup-java@v4` 弃用、`ubuntu-latest`→Ubuntu 26 的 notice），无代码级错误。⇒ 判据措辞必须是"**无代码级 `e:`**"，说"注解数 0"不成立。
- 2026-10-21 `eae11da` 起三跑全绿 + APK 出包；**装机仍未做**。

## 代码纪律
- 文本落点同网页端一条判据（`Reduce.kt#placeText`）；`when (packet)` **无 `else`** ⇒ 协议新增包**编译失败**（故意）。
- ★★ 凡有判据的都推进 `:core`（§85.3）：地图几何/短名/截断 = `MapLayout.kt`、方向表 = `Dirs.kt`、出口行/动作栏过滤 = `RoomView.kt`；`:app` 只把算好的坐标换成 `dp`。`Double.dp`/`Double.sp` 直接可用。
- 构造一律**具名实参**（插字段时同类型位置实参编译器挡不住）。
- 本机 Kotlin 自查三个一次性脚本在 `D:/tmp`（括号+包名 / import⊥声明 / 具名实参⊥声明），**不进仓库**，且都要**自证会红**；真相源文件须排除在扫描面外（否则 `val x: Boolean = false` 被当成具名实参）。
- 点房间里的人/物发 `select <id>` **不是** `look`（`look` 忽略参数 ⇒ 点谁都是把房间描述再打一遍）；两个指令都合法，选错不报错 ⇒ 静态闸门抓不到。
- ★ 传输层不做应用层 HTTP 中转（§84）：那是**浏览器没有 WS 时代**的妥协；要 TLS/端口/穿透就上**反代**（不懂业务协议）。`Transport` 是唯一替换点 ⇒ 选错代价有界。

## 聊天浮层 / 小地图（§86 / §93 / §94）
- ★★ **`MudAction` 的通栏只能走 `fillWidth = true`，且 `Text` 里绝不许无条件 `fillMaxWidth()`**（§94，真机塌过一次）：`RowColumnMeasurePolicy.measure` 测非 weight 子项时 `mainAxisMax = remaining`（整行剩余宽）、`min = 0` ⇒ `Text.fillMaxWidth()` 把宽度吃满 ⇒ **按钮反向撑到整行**，同排 `weight(1f)` 兄弟分到 **0**。表现：房名消失（只剩通栏「地图」）、聊天发送通栏而输入框 0 宽（只剩一条聚焦暗金边，看着像屏幕左边一根黄竖条）、主屏「聊天」通栏把指令框挤出屏幕。`LazyRow`/`FlowRow` 里没事是**因为宽度无界**（巧合，不是保证）。`dense` = 32dp / 最小宽 40dp，给出口·动作栏·改视图键。
- ★★ **静态判据全绿 + CI 编译过 ≠ 布局对**（§94.6）：根因在测量语义（运行时几何），grep 看不见。动"谁多宽/谁被挤没"必须落到**真机截图核对表**。
- 聊天浮层判断全在 `:core Chat.kt`（`ChatSubmit` 三支、`chatTargetFor` 只对玩家且**剥标签**）；`:app ChatSheet` 贴底卡片**不用 `Dialog`**（输入框与 inset 抢）。★★ 失败提示画在浮层里不进消息流——浮层盖住消息流，写进去看不见。§94 删掉了那道**不可拖的拖拽条**（假控件），`DragBarW/H` 同批删除。
- ★★ 小地图**就地展开**（§94，答复 §93.2.3 的用户改判）：开关在房名行右端，地图就在**房名行下方**紧贴展开，`MapPanel` 直接调、外层不套宽度、不加底色（wushen `.map-panel` 是空规则）。**不给地图加滚动**（第二个滚动器）；高度是算出来的（`Slot.N.y=25`/`S.y=103` ⇒ 满格 112dp），不是写死。地图开着时**不给「展开描述」**（`expanded` 与地图共存会让房间区内容超出、`Column` 直接裁掉出口与此处）。
- 高度预算见 26 册 §94.4 表（状态条 76 · 房名 32 · 地图 118 · 描述 120/60 · 出口 38 · 此处 50 · 动作栏 48 · 输入 72）；360×640 可用 ≈ 592 ⇒ 地图开着时描述必须降到 3 行（`RoomDescMapLines`）。改任何一档先重算表。
- ★ 底部只剩 `ChatSheet` **一张**浮层 ⇒ §93.3 的"两卡互斥"（`toggleMap` 里 `vm.closeChat()`）已删除。别为了"对称"加回来：互斥的理由是"两张都贴底会互相盖住"，地图搬走后这条前提不存在。
- 地图宽度 276dp 是算出来的（1 单位 = 1dp），窄屏只能 `horizontalScroll` 不能缩放；`horizontalScroll` **不许无条件套**（子项约束变 infinite ⇒ 居中失效）。

## 视觉层级唯一口径（26 册 §92，2026-10-22）
全屏只有一个底色 `#000`；区块之间只用一条 `#343434` 发丝线；`#111` 只允许「状态条/输入框/提示框」三处凹面；`#222` 只允许浮层头脚带；**可点的东西一律「透明底 + 一条 `#808080` 边」，不许给整块底色**。配套两句：「这块看不清楚 ⇒ 加一条线，不是加一层底」「这个控件不像能按 ⇒ 加一条边，不是加一块底」。
- ★★ wushen 有**两族**可点皮肤，别一起否（§92.4.1）：`.tool-item`（`#808080` 实心底 + `#111` 深字）= 常驻功能入口，手机端❌不用；`.act-item`/`.pfm-item`/`.chip`（黑底 + 1px `#808080` 边 + dim 字 + 4px 圆角）= **当前能做的事**，手机端所有按钮都属这族 ✅照抄。§91 曾把两族一起退掉，§92 才分清。
- `spanStyleOf` 的 30 档颜色标签是"两端同色"的唯一保障，**任何改动前先做字节级 diff**（`git show <ref>:<path>` 抽函数体比对）；`when` 必须无 `else`。
- **输入凹槽规则**（§93）：`MudField(fill=…)`——**槽要比所在的面暗一档**。输入行坐在 `#000` 上用默认 `Recessed`(#111)；聊天浮层与登录卡自己是 `#111`，显式传 `Background`(#000)。
- ★ 未解决阻塞（§93.4）：`MudField` 运行时 56dp 与按钮 44dp 并排不齐。**已用 1.3.1 一手源码核实**（BOM 2024.12.01 ⇒ material3 1.3.1；sources jar 解包，maven.google.com 被代理 502、阿里云 `repository/google` 镜像可取）：
  · `OutlinedTextFieldDefaults.MinHeight = 56.dp` **存在**（住 `TextFieldDefaults.kt`；`OutlinedTextField.kt:224/399` 的 `defaultMinSize` 强制）——doc 这条成立；
  · 经典重载**无** `contentPadding`（参数表到 `colors` 为止）——doc 这条成立；
  · 但 doc 原写「两条正路」**两条都不在 1.3.1**：`TextFieldState` 重载（1.3.1 只有 String/TextFieldValue 两个重载）与 `OutlinedTextFieldDefaults.decorator`（全树 0 处）都是 **1.4.0+** API；
  · 1.3.1 内真实逃生口：`OutlinedTextFieldDefaults.DecorationBox`（`@ExperimentalMaterial3Api`，**带** `contentPadding` 参数）+ `BasicTextField(decorationBox=…)`；或升 BOM ≥1.4.0。
  · ★ `Modifier.heightIn` 官方注释说能覆盖 MinHeight，但 2022 Kotlin Slack 实测只缩 3dp（内部 padding 吃掉）——别信这条近路。
- 外层调用方 `Modifier.height(TabH)` 会胜出 `MudAction` 内部 `ControlH`(44dp)（SizeModifier 的 min=max 把内层 `enforceIncoming` 夹回去）——`MudTab`/房名行开关/「收起」三处靠它，注释已写死防人被"看起来会被覆盖"改回去。

## 未做清单
保活（API 35 dataSync 6h/24h 额度）、翻历史不被拽回、选角/注册、`score`/`skills` 面板、招式栏、说话人名单独上色、`SelectionContainer`、格子 48dp、指令历史、**渲染级**界面断言（`createComposeRule`，别上模拟器）。
★ 文本级判据已有：`node newmud/tools/check-android-layout.mjs`（J1–J7，退出码走 `EXIT_PASS/EXIT_FAIL`，2026-10-22 五个变异全部自证会红）。它只守"能塌过一次的那几处文本事实"，**证不到布局**——别拿它当"界面没问题"。
**反向 import 闸门**：两个方向分开看。①「import 了 `mud.core`/`mud.protocol` 里不存在的符号」——`D:/tmp/kt-symbols.mjs` 就是这检查（2026-10-22 已自证会红 + 真树 12 文件全绿，core+protocol 顶层声明 128 个），**但没进仓库、没接 CI**，还是次性脚本；②「用了却没导入」（`clip` 那类，androidx 方向）——仍无覆盖，朴素判据会被**命名参数**（`color =`）、**同包顶层声明**（`planMap`/`MapSheet` 不需 import）、**星号导入**三类打成假红，而假红=训练人忽略报警（§71.8.2）⇒ 先解决三类误报才配得上变异样本。
观感（丑不丑、齐不齐）**没有静态判据**，只能人看真机；装机仍未做。

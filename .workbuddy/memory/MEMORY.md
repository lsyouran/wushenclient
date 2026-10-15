# ts-mud / newmud · 长期约定

> 根 `D:/ts-mud/newmud`（docs 在 `D:/ts-mud/docs/`；一次性证据 `_bench-*`/`_shots-*`）。
> 路径由 `import.meta.url` 上溯 `package.json`+`tsconfig.json` 派生；禁硬编码 `newmud`、禁 `process.cwd()`（G12）。
> **细节回文档册，本文件只留"会踩的"。** 前端细则 `CONVENTIONS-web-ui.md`、引擎细则 `CONVENTIONS-engine.md`（同目录）。
> ★ 2026-10-13 三方体检：`D:/ts-mud/_audit-代码文档体检-2026-10-13.md`（P0 清单 + 待拍板项）。

## 验证内环（改完必跑）

```
cd D:/ts-mud/newmud
node node_modules/typescript/bin/tsc --noEmit
node node_modules/typescript/bin/tsc -p tsconfig.web.json --noEmit
node node_modules/vitest/vitest.mjs run
node tools/gate/run-all.mjs          # G2/G3/G5/G6/G12/G13/G14/G15
node tools/gate/mutation-test.mjs    # 9–13 min（80 条）；动闸门/测试必跑，跑时不许改文件
```
node 用托管版 `C:/Users/Administrator/.workbuddy/binaries/node/versions/22.22.2-6/node.exe`。
基线 2026-10-14（§34）：**tsc 双工程 0 错 · vitest 38 文件 709 测试全绿 · run-all PASS 无 SKIP · mutation 80/80**（10-13 时 35/670、76 条，逐批递增）。
★ 动过源码/测试/样本/闸门 ⇒ 基线作废重跑。★ 长跑别 `| head/grep`（SIGPIPE 中断）⇒ 重定向到文件再读。
★ 全量 vitest 与 `run-all` 别同时跑（`launcher.test.ts --help` 并发超时）。⚠️ 该测试有 5s 超时 flake ⇒ "全绿"不可稳定复现，见红先单独复跑。

## 铁律

1. **fix-before-assert**：先加断言并**实证**会红再改；判据锚在**不可能被别的原因满足**的位置（FG-14、T18 `toContain('无性')` 都先假绿）。新判据答两问：① 运行时够得着吗？② **谁在照它做？**
   ★★ **机检报 N 条改 N 条是抽样不是收工**：只认"写出文件名"的引用，回指式裸 `:NN` 看不见（25 报 12）；还要问"这形状有没有看不见的写法"。
2. 改闸门**或对应测试** ⇒ 跑 `gate:mutation`；动源码/测试 ⇒ 基线作废。
3. **SKIP 不算通过**。
4. **单源真相**：`shared/ids.ts`/`constants.ts`/`protocol.ts`；第二份语法/映射/清单就删。性别三档（0 无性/1 男/2 女，wushen 同序）；**`call3()`（他/她）保持两档**。
5. 闸门规则必须自带 `dirs`（扫描≠判定范围 ⇒ 死规则，FG-7）。
6. 证明闸门可红的样本也要证明**守卫自己**可红；判据落在**区分性字段**（FG-11）。
7. **注释/文档也是断言**（FG-19/20/21）：不符则补实现或改注释+测试钉住。
8. **旧 T/FG 条目是快照不是现状**，动手前逐条在当下代码过一遍；**默认值/缺省分支也要有测试**。
9. **编号跨文件**：用号前全仓 grep（T19 想用 G2.4 被占 ⇒ 顺延 G2.8）。宁可顺延，不挪别人已引用的号。
10. ★ **"靠某号/某值不存在"的判据是脆的**，纯增益动作也会打穿（新建 docs/28 让"28 是幽灵册号"失效 ⇒ 样本改 99）。动手前先问"**我这一动，有没有谁的前提被我取消掉**"。

## 命名（★ 2026-10-14 起：**四层，别混**）

**① 代码名（英文可读） ② 数据键（= wushen 拼音缩写；改英文见 29 册 §29.11 草案·未批） ③ 中文名 ④ 技能 id / 装配槽。**

- **派生字段**（`character.derived.X`）：`attack`/`defense`/`hit`/**`evasion`**/**`deflect`**/`crit`/`attackSpeed`/`maxHp`/`damageReductionPer`/`ignoreDefensePer`（wushen `gj/fy/mz/ds/zj/bj/gjsd/max_hp/diff_sh_per/diff_fy_per`）。
- ★★ **第 4 个命名空间 = 技能 id**（`force`/`dodge`/`parry`/`bite`/`sword`/…，见 `BASE_SKILLS`/`WEAPON_TYPE`/`ENABLE_SLOTS`）。**数值侧名不得撞技能 id / 槽名**。躲闪/招架**不许叫 `dodge`/`parry`**（那是基础轻功/基础招架的技能 id，内容在 `wushen/world/skill/dodge|parry/`）⇒ 取 **`evasion`/`deflect`**。wushen 靠"**属性=拼音、技能=英文**"岔开（`os/const.js`），我们改英文可读名时踩了回去。
  ⇒ 闸门 **G3.G** 守：`PROP` 别名键 ∪ `DerivedCombat` 字段 ⊥ `ENABLE_SLOTS`（+2 样本）。★ `force` 是潜伏下一例。
- **PROP 别名表**（`shared/constants.ts`，`PROP.attack === 'gj'`）：代码别写裸 `'gj'`。单测 `tests/prop-alias.test.ts` 钉映射 + **反向锚点**（断言值**没**被改成英文名）。对照表在 **29 册 §29.10**。
  ★★ **数据键英文化（29 册 §29.11 v2「词干表」· 待批）**：核心键 = **英文 snake_case 裸名词**（**不加** `*Bonus`）；派生键由 `ModProp` **机械生成**（`<c>_per`/`diff_<c>`/`diff_<c>_per`/`add_<c>`/`add_<c>_per`）⇒ 核心键若带后缀会生成 `diff_attackBonus` 这种怪键。**定位已从"逐字照抄翻译表"降级为"读懂 wushen 来源的索引"**（用户只学架构、数值后续替换）。
- ★★ **有效属性（2026-10-15 §37 裁定）**：**实际有效属性 = 先天值 + 后天加成**，唯一口径 = `formula.ts#effectiveAttr()`。**一切门槛/限制读它**（学条件 `SkillLearnCondition.minAttr`、将来的装备要求）。★ **但派生公式读分开值**：`computeDerived()` 里先天/加成位置不同（`attack` 先天在百分比**外**、`defense`/`maxHp` 在**内**；同一 `prop_con*con` 在 `maxHp` 不除10、在 `defense` 除10）⇒ 逐式照抄 wushen，**先合并必偏离原作**。⇒「门槛=合成值、公式=分开值」。
  ⇒ `Character.str/con/dex/int` getter **返回有效值**（内容层/门槛口径统一）；裸先天值只在 `innateSnapshot()`（引擎内部，喂公式）。**`minProp`+`minInnate` 已合并为 `minAttr`**，`str`/`str1` 二义性在 API 上不存在（数据键仍照抄 wushen）。详见 **29 册 §29.13** / **26 册 §37**。
  ★ **三档读取口（2026-10-15 §39）**：`Character.attrBreakdowns()`（= `CommandActor` 成员 → `formula.ts#computeAttrBreakdowns`）一次给出 `{key,innate,bonus,total}`，`total` **仍走 `effectiveAttr`**（口径不新增）；消费者 = `world/command/info/score.ts`（别名 `score,attr`，打 `臂力 25（先天 20 + 后天 5）`）。**`AttrKey` 由 `ATTR_KEYS` 值表派生**（不再手写四键）。★ 加 `CommandActor` 成员会**打穿所有 implements 替身**（`tsc` 逐处点名 → 良性）。详见 **26 册 §39**。
- **不用 `enum`**：`as const` 对象 + 派生联合类型（`OBJ_KINDS`/`INNATE_KEYS`/`COMBAT_FORMULA`/`PROP`）。
- ★★ 教训：引入别名后 **G3.C 键字面量计数从 22 掉到 0** —— 不是"没违规"是**规则失去输入**（FG-7）⇒ 新建 **G3.F** 对账 `PROP` 表 + 2 样本。⇒ **通则：引入一层间接 ⇒ 先问"哪个闸门原本靠直接形态在守、现在还看得见吗？"**

## grep 自检（★★ 最高频踩坑）

`grep` 默认 BRE：`\s`/`\d` **不是**转义类（`ch:\s*"` 是字面量 ⇒ 静默零命中）。要 `-E`/`-P`。**"零命中"结论先拿一个确知命中不了的串自检**。

## 环境坑

- `spawnSync` stdin 必须 `'ignore'`；不得 `status ?? 1` 兜底（FG-3）。
- Bash heredoc 被拦（用编辑工具写文件）；`wmic` 黑名单（用 `Get-Process`）。
- Windows `child.kill('SIGTERM')` 不投递真信号 ⇒ 退出码 null；测"能停"只断言没超时。
- `fetch` 归一化 `%2e%2e` ⇒ 测路径穿越要发**原始 HTTP**（`node:net`）。`http.Server.close()` 不等已建连接 ⇒ 先 `closeAllConnections()`。
- ★ **本机有代理**：复核本机服务加 `--noproxy '*'`；无头浏览器加 `--no-proxy-server`。
- 无头 Chrome：Windows `--window-size` 最小宽 ≈522；别传 `--timeout`（和 `--virtual-time-budget` 打架）；`/tmp`→`D:/tmp`。
- ★ **Windows 允许两进程绑同端口**（无 `SO_EXCLUSIVEADDRUSE`）⇒ 起服务前 `netstat -ano -p tcp` 查占用、起完先验首页；常驻服务用**托管后台任务**（`(npm start &)` 会被收走）。
- ★ **jsdom 没有布局** ⇒ 改 DOM 排布后默认跑无头 Chrome 探针。
- ★ `better-sqlite3` 与当前 Node ABI 不匹配 ⇒ 用内置 `node:sqlite`。★ SQLite 默认 `cache_size` 仅 2 MB 且与数据量无关 ⇒ 热数据越过就断崖（66 ms→2830 ms）。

## 启动（26 册 §17）

`npm start`（prestart 自动 build:web，默认 8123）/ `npm start -- --port 9000`。
入口链 `tools/start.mjs`（注册 TS 钩子）→ `server/cli.ts` → `main()`；`server/main.ts` 是纯工厂**不能直跑**。
★ 静态资源与 WS **同端口**；服务根 `dist/web/`，`GET /` 302 到 `/src/index.html`。★ node ≥ 22.15.0（`module.registerHooks`），由 `engines`+`tests/ts-loader.test.ts` 钉住。
加载器 `tools/dev/ts-loader.ts`：**必须 transform**（ws-server 有参数属性）、候选表永不含 `.d.ts`、tsconfig 必须纯 JSON、别名表读 tsconfig。

## 闸门

- 退出码四态（26 册 §27）：**0 通过/1 违规/2 跳过/3 崩溃**；`-1`=子进程没起。每个 `tools/gate/*.mjs` 入口显式 `installCrashGuard('<id>')`（**不许在 lib.mjs 自动装**）；"忘装"由 G6 R6.11 兜（三种互斥模式 `re`/`empty`/`must`）。元闸门判据：`before∉{FAIL,CRASH} && after===expectAfter(缺省 EXIT_FAIL) && restored===before && note===''`；崩溃要正面声明 `expectAfter: EXIT_CRASH`。迭代用 `--only=<子串>`，**取证不许带 `--only`**。窄口（已记档）：R6.7 只认 `process.exit(` 紧跟数字字面量；崩溃守卫不覆盖**模块求值期**异常。
- **G2 协议对账**（26 册 §26）：G2.1 去重/G2.2 schema 覆盖/G2.3 前端 handler↔声明/**G2.8 发送点↔声明↔台账 三方双向**。台账 `shared/protocol.ts#SERVER_PACKET_UNWIRED`（25 条，**只许缩短**）。★★ 发送点必须锚在 `packet(` 调用体内。★★ 汇总行先求和再比较。
- **变异测试夹具**：safe-delete 配额 50/轮，超了 ⇒ 还原失败 ⇒ 夹具残留 ⇒ **连锁假绿**（FG-8）。还原**只写不删**。`walk()` 跳过零字节文件，空文件盲区由 G6 R6.8 接。`__mut*`/`*.mutbak` 保留命名空间。
- ★★ **已知守卫缺口**：① 计数型断言漂移 —— **✅ 已修（26 册 §31.2）**：只改活规格，其余快照保留+加指针；★ 通则：**计数的权威来源是闸门输出**；② G15 判据只认 `NN 册`，**`docs/NN` 形态 127 处零守卫**；③ **G5/G12/G13 无 DEAD-RULE GUARD**（扫 0 文件照样绿）。（②③ 未修，P2。）

## 文档册（入口 `docs/00`）

纪律：发现问题→**更新原册不另起**；索引只放链接；状态写标题行首句；每条结论带"怎么证明"；标记已办**保留原文**再标 ✅。
项目册 `00/24`–`29`（`25` 暂缓）；wushen 册 `docs/wushen/00`–`23`。册号并集 `00`–`29`。
`24` 命名与标识符规范·§5 闸门表·§5.3 FG-1…FG-23 全修 ｜ `25` 安全与支付（**暂缓**，G10/G11 同此）｜ `26` **审查与实现批次唯一权威源** ｜ `27` 技能系统设计 ｜ `28` 存档与持久化（T12 未实现）｜ `29` **属性与派生数值设计**（改公式/数值/容量前必读）。

- ★ 「NN 册」两套并存 ⇒ **引用必须带册号**。G15 守：注释里 `NN 册` 必须 ∈ 磁盘真实册号；只认"只出现在注释里"的引用；不扫 `docs/`、不扫自己。⇒ 通则：**能在结构上让开就别发明行内豁免标记**（G12 的 `// g12-allow` 是反例）。★★ 窄口：G15 只判册号不判 `§节号` ⇒ 8 处 `24 册 §5.3` 写成 `26 册 §5.3` 全绿放行。**闸门全绿 ≠ 引用都对**。
- ★★ **引用 wushen 一律带目录**（105 个 basename 多副本，`os/` 与 `world/extends/` 双层）。
- ⚠️ `P` 系列三套同号（25§7/26§17.7/27§9），**不改名**（已被引用）⇒ 引用写"册号+节号"；另 `P0/P1` 兼作阶段名。
- ★ **三方对账是常态方法**：文档 ↔ 代码 ↔ **wushen 原作**（不看 wushen 漏"文档与实现**一致地一起偏离**原作"）。

## 子系统要点（细则见 `CONVENTIONS-engine.md`）

- ★ **记账式重算**：`skill.ts` `recompute()` 先 `#releaseLedger()` 再 `#absorb()`（幂等）；~~三入口口径不一致~~ **✅ 已修（P0-4 / 26 册 §30.4）**：抽 `#attachSlot`/`#detachSlot` 三入口共用 + `validate.ts` 启动期报"同槽"error。（教训：**重构搬走代码会打穿靠源文本匹配的变异样本 ⇒ 假绿**。）
- ★ **数值偏离（唯一权威：`docs/29`）**：① `max_hp` 的 `con` 项 wushen 不除 10、本项目除 10（**未裁定**，220/400 双锚点）；② 玩家背包 **50**（有意偏离 wushen `os/char/user.js:5` 的 20；NPC 10；房间 50）；③ **`gj` 已裁定照抄 wushen** —— 先天 `str` 在 `gj_per` 百分比**外**（`world/extends/char/user.js:16`）。★★ wushen `recount` 四个归属两套算法 ⇒ 本项目**统一走玩家那套**（NPC 数值与 wushen NPC 分家）。改数值前先读 **29 册 §29.4**。
- ★ **播报**：房间内 `sendRoom`（三视角、`warn` 帧）；跨房间 `sendChannel`（`CHANNEL_SCOPE`、`msg` 帧）。★★ wushen 的 `msg.ch` **只有 7 种** `chat/tm/fam/pty/es/rumor/sys` ⇒ `CHANNELS` 不该有 `say`/`emote`。★ 输入里 `$X` 会被占位符吃掉。
- ★ **背压两档各管一段**：① `MAX_OUTBOUND_QUEUE`(256)=hub 队列条数，恒≤1，**非运行时判据**；② `MAX_BUFFERED_BYTES`(1MiB)=`socket.bufferedAmount` ⇒ **运行时够得着的**；超限 ⇒ `close()+forget()+false`，**且不调 `onReject`**（无限递归）。★ `session.#send` 必须看返回值。
- ★ **网络管线顺序**：量大小→限流→分诊→解析+**zod**（限流必须在解析前）；只有 `ws-server.ts` 碰 `ws`。
- ★★ **P0 批次已修（26 册 §30）**：① 入站业务链路 try/catch + `onInternalError` + `installProcessErrorGuards`；② `--host` + `WS_PATH='/ws'` + `isSameOriginRequest`；③ `isRoleName` 单源 + `session.#byRoleId` 在线唯一。★ 仍未做：**按 IP 限连接数**（N2 后半）；**T12 未做** ⇒ 存档/验签仍缺。

## 前端（`src/`，26 册 §15–§21；细则 `CONVENTIONS-web-ui.md`）

原生 ESM + 纯 DOM，**不引框架不引打包器**；外观照 wushen。
★ 两块顶层屏互斥（`#auth`/`#app`），切屏唯一落点 `ui/screens.ts`，由服务端 `login` 帧驱动（"连上了"≠"进游戏了"）。
★ protocol **只 `import type`**（G14）；`ui/dom.ts` **不提供 innerHTML 助手**（XSS 结构防线）。★★ **"改前端"默认动作是去 `D:/ts-mud/wushen/src/` 找对应组件移植，不是自己发明**。

## 未做

**已办**：T1/T2/T15–T24（T23④ 未做）；**2026-10-14 P0 批次**（N1/N2/N3/E2，§30）；**文档订正批次**（D1/D4/D6/D7/D9+F11，§31）；**数值裁定批次**（E1 `gj` 照抄 · E8 容量 50/10 · 新建 29 册，§32）；**命名空间隔离批次**（`evasion`/`deflect` + G3.G，§34）。
**仍未做**：账号+token 验签+角色存档（**T12**，设计定稿 28 册：登出写+每小时全量+脏标记单事务+显式 `cache_size`+备份轮转）；**B 批** `get/drop/give/use`+`Item` 存 `def`（「打听」`give pub/xiaoer 1000 money` 现哑火）；战斗（`on_use`/`on_kill` 无消费者）；装备/服用；技能第三档 addin；知识·隐藏技能；门派薄壳；**D 批**：面板子系统 100% 不可达（唯一生产性 `openPanel` 是 `social.ts` emote/dialog，只有声明无生产者）；G9 变更-覆盖对账闸门；真浏览器 e2e 入库；T22 第 4 条；`m/l/f/o` 惰性字段；图形化地图/选角 UI/聊天与武学弹窗；G2.3 变异样本（T13）；README（**00 册从未链接 `newmud/README.md`**）。
★ **E9 待专项分析**（`recount` 只钳 hp 不钳 mp；wushen `world/extends/char/user.js:6` **也只钳 hp** ⇒ 属原作空档；清单见 29 册 §29.6）。★ 同族 P1：E5（`setBusy` 累加 vs 赋值）/E6（busy 永不过期）/E10·E11（`loadProps` 无范围闸门）。

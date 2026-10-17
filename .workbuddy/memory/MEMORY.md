# ts-mud / newmud · 长期约定

> 根 `D:/ts-mud/newmud`；docs 在 `D:/ts-mud/docs/`；git 在 `D:/ts-mud/.git`。路径由 `import.meta.url` 上溯派生；禁硬编码 `newmud`、禁 `process.cwd()`（G12）。**只留"会踩的"，细节回册**（前端 `CONVENTIONS-web-ui.md`、引擎 `CONVENTIONS-engine.md`）。
> ★ **三份报告的「代码缺陷项」已清空**（S/F/E/L/N/D §42–§50）⇒ 剩**功能缺口**与**部署项**（TLS / 31 册）。审查源：根 `_audit-*-2026-10-16.md`、`_roadmap-还差多少-2026-10-16.md`。

## 验证内环（改完必跑）
```
cd D:/ts-mud/newmud
node node_modules/typescript/bin/tsc --noEmit                        # 主
node node_modules/typescript/bin/tsc -p tsconfig.web.json --noEmit  # 前端
node node_modules/vitest/vitest.mjs run
node tools/gate/run-all.mjs          # G2/G3/G5/G6/G12/G13/G14/G15
node tools/gate/mutation-test.mjs    # 9–13min；动闸门/测试必跑
```
node 用托管版 `.../22.22.2-6/node.exe`。基线（2026-10-17，§55 后）：**47 文件 990 测试 · run-all PASS 无 SKIP · mutation 89/89**；双 tsc 0 错。（§54 时 978；§53 时 45/899。）
★ 动源码/测试/样本/闸门 ⇒ 重跑。★★ **"未动 `tools/gate/*` ⇒ 不跑 mutation" 只在样本不匹配源码时成立** —— 变异样本**按源文本 `t.replace` 匹配**，**重构搬走被盯的代码就把样本变成假绿，样本自己不会报错**（§55 抓到 SKL.1：`skill.ts` 重构后样本失配）⇒ **动 `server/engine/*`（尤其 skill/formula/npc 等被样本盯着的）也要跑 mutation**。★ 长跑重定向再读（`| head/grep` 会 SIGPIPE）。★ vitest 与 run-all 别同跑。★ `static-web.test.ts` 偶发 2 红，单独复跑必绿（端口 flake）。

## 铁律
1. **fix-before-assert**：先写会红的断言并**实证**再改。新判据答：①运行时够得着吗？②**谁在照它做？** ★★ 机检报 N 改 N =**抽样非收工**（还要问"有没有看不见的写法"）。
2. 改闸门**或对应测试** ⇒ 跑 `gate:mutation`；SKIP 不算通过；缺省分支也要测。
3. **单源真相**（`shared/ids|constants|protocol.ts`）；第二份清单就删。性别三档（0无/1男/2女），`call3()` 两档。
4. 闸门规则自带 `dirs`（否则 FG-7 死规则）；证可红的样本也要证**守卫自己**可红；判据落在**区分性字段**。
5. **注释/文档也是断言**（FG-19/20/21）；旧 T/FG 条目是**快照非现状**，动手前逐条复查。
   ★★ 不只旧条目是快照，**连「✅ 已清 / 已清偿」的标注本身也是快照**。凡声明"某挂账已清偿"，
   收工前必须 **grep 一次生产调用点**（不看定义/注释/测试）。实例：26 册 §54.1 与路线图三处声明
   「已清偿 T4/T5」，实测 `OidSpace.release()` / `pruneTemp()` **仍双双零生产调用点**（§55）。
6. **编号跨文件**：用号前全仓 grep；宁可顺延，不挪已引用的号。
7. ★ "靠某值不存在"的判据脆；先问"我这一动，谁的前提被取消"。
8. ★★ "不该改 X"的断言先问：**我什么都不做，这条也绿吗？** 假绿两型：① `before=读X(); expect(X).toBe(before)`；② 从未变的初值出发。修法：**哨兵值 + 起点人为拨到相反**。
9. ★★ **"修复"自身也要按同一套纪律复验**：改动量大（多文件）的批次收工前，对**改动本身**再做一轮独立复查 —— 实例：§55 修了 17 条后，第二轮在**它自己的改动**里揪出 4 条回归（R1 直接违反写死的"限流在解析前"、R4 是"新写的测试本身假绿"）。**"我改了、我跑了、绿了" ≠ 收工**。★ 错误路径（端口占用/启动失败）必须**真起第二个进程**才证得了，第一版"看起来对了"常靠这条拆穿。

## 命名（四层）
**① 代码名 ② 数据键（wushen 拼音） ③ 中文 ④ 技能 id/装配槽。** 派生 `character.derived.X`：`attack`/`defense`/`hit`/`evasion`/`deflect`/`crit`/`attackSpeed`/`maxHp`/`damageReductionPer`/`ignoreDefensePer`。
- ★★ **第 4 命名空间 = 技能 id**；**数值名不得撞技能 id/槽名** ⇒ 躲闪/招架 = `evasion`/`deflect`。闸门 **G3.G**。★ `force` 是潜伏下一例。
- **PROP 别名表**（`constants.ts`，`PROP.attack==='gj'`）：别写裸 `'gj'`。
- ★★ **有效属性（§37）**：= 先天+后天，唯一口径 `formula.ts#effectiveAttr()`，**门槛读它**；**派生公式读分开值** ⇒「门槛=合成、公式=分开」。`Character.str/…` 返回**有效值**；裸先天只在 `innateSnapshot()`。`minProp`+`minInnate`→`minAttr`（29 册 §29.13）。
- **三档读取口（§39）**：`attrBreakdowns()`→`{key,innate,bonus,total}`；消费者 `info/score.ts`；`AttrKey` 由 `ATTR_KEYS` 派生。★ 加 `CommandActor` 成员打穿所有 implements 替身（良性）。**不用 `enum`**。
- ★★ 教训：引别名后 **G3.C 计数 22→0**（规则失去输入）⇒ **引间接层先问"哪个闸门原本靠直接形态在守？"**
- ★★ **world id 保留字**：`shared/ids.ts#RESERVED_AREAS` 含**全部 `KINDS`** ⇒ 用 `item/`、`npc/` 等作**内容子目录**会 `parseWorldId` 返 null、`define*` 抛 `IdError`（B 批踩到：`world/command/item/` ⇒ **12 测试文件连锁崩**）。**给内容层造目录先查保留字**；`world/command/obj/` 是安全名。

## grep 自检（★★ 最高频）
默认 BRE：`\s`/`\d` **不是**转义类 ⇒ 静默零命中；要 `-E`/`-P`。**"零命中"先用一个确知命中不了的串自检**。

## 环境坑
- `spawnSync` stdin 必须 `'ignore'`；不得 `status ?? 1` 兜底（FG-3）。
- Bash heredoc 被拦（用编辑工具写文件）；`wmic` 黑名单（用 `Get-Process`）。
- Windows `child.kill('SIGTERM')` 不投真信号 ⇒ 退出码 null；测"能停"只断言没超时。
- `fetch` 归一化 `%2e%2e` ⇒ 测路径穿越发**原始 HTTP**（`node:net`）；`http.Server.close()` 不等连接 ⇒ 先 `closeAllConnections()`。
- ★ 本机有代理：复核本机服务 `--noproxy '*'`；无头浏览器 `--no-proxy-server`。
- 无头 Chrome：`--window-size` 最小宽≈522；别传 `--timeout`；`/tmp`→`D:/tmp`。
- ★ Windows 可两进程绑同端口 ⇒ 起服务前 `netstat -ano -p tcp` 查占用、起完先验首页；常驻用**托管后台任务**。
- ★ jsdom 无布局 ⇒ 改 DOM 排布后跑无头 Chrome 探针。
- ★ `better-sqlite3` 与本机 Node ABI 不匹配 ⇒ 用内置 `node:sqlite`；SQLite `cache_size` 默认 2MB ⇒ 越过断崖。

## 启动（§17）
`npm start`（prestart 自动 build:web，默认 8123）/ `-- --port 9000`。入口链 `tools/start.mjs`→`server/cli.ts`→`main()`；`server/main.ts` 纯工厂**不能直跑**。
★ 静态与 WS **同端口**；根 `dist/web/`，`GET /` 302→`/src/index.html`；node ≥ 22.15.0。加载器 `tools/dev/ts-loader.ts`：**必须 transform**（ws-server 有参数属性）、候选表不含 `.d.ts`、别名表读 tsconfig。
- ★★ `new WebSocketServer({ port })` **构造时就 listen**；其自建 http server 的 `'error'`（如 EADDRINUSE）**转发**到 `wss.emit('error')` ⇒ 必须**构造后立刻**挂 `wss.on('error')`。挂晚 = 无人接 = `uncaughtException` + Promise 永不 settle ⇒ **进程挂死**（§55 M2，第一版修法只加 Promise reject 无效）。
- ★★ **错误路径（端口占用/启动失败类）不能只静态推理 —— 必须真起第二个进程才证得了**（fix-before-assert 对错误分支同样适用）。

## 闸门
- 退出码四态（§27）：0 通过/1 违规/2 跳过/3 崩溃；`-1`=没起。`tools/gate/*.mjs` 入口显式 `installCrashGuard('<id>')`（"忘装"由 G6 R6.11 兜）。元闸门判据 `before∉{FAIL,CRASH} && after===expectAfter && restored===before && note===''`；崩溃正面声明 `expectAfter: EXIT_CRASH`。迭代 `--only=`，**取证不许带 `--only`**。窄口：R6.7 只认 `process.exit(` 紧跟数字；崩溃守卫不覆盖模块求值期。
- **G2 协议对账**（§26）：**G2.8 发送点↔声明↔台账 三方双向**；台账 `protocol.ts#SERVER_PACKET_UNWIRED`（只许缩短）。★★ 发送点必须锚在 `packet(` 调用体内。★★ 汇总行先求和再比较。
- **变异夹具**：safe-delete 配额 50/轮，超了⇒还原失败⇒**连锁假绿**（FG-8）；还原**只写不删**。
- ★ 窄口（2026-10-16 订正）：G15 **只判册号、不判 `§节号`**；G15.2 已覆盖 `docs/NN`；G3/G5/G12/G13 已补 DEAD-RULE GUARD（扫 0 文件即判失败）。⇒ **闸门全绿 ≠ 引用都对**。★ G15 **不扫 `docs/*.md`**（只扫源码/测试注释，实测改文档不触发任何闸门）。

## 文档册（入口 `docs/00`）
纪律：发现问题→**更新原册不另起**；索引只放链接；结论带"怎么证明"；标已办**保留原文**再 ✅。项目册 `00/24`–`31`（`25` 暂缓）；wushen 册 `docs/wushen/00`–`23`；并集 `00`–`31`。
- ★★ **改索引时"改了册清单" ≠ "索引同步了"**：00 册有 §2 行 ×9 · §6 行 ×11 · §3 表 —— 一次改动要**逐处过**。（§51 踩到：只更新了册清单与验证内环行，§2 的 26 册行 / §6 的已落地·未决·参数行全漏。）
`24` 命名规范·§5 闸门表 ｜ `25` 安全支付（暂缓）｜ `26` **审查与批次唯一权威源** ｜ `27` 技能系统 ｜ `28` 存档（T12 未做；§28.5.5 读档契约）｜ `29` **属性与派生数值**（改公式/数值/容量前必读）｜ `30` **测试策略与验证内环** ｜ `31` **运维与发布**。
- ★ **00 册 §6 只留「现值」**；§28–§50 逐批历史快照在 **26 册 §52**（2026-10-16 从 §6 迁入，原文未改）。§6 表格里曾有一行**不以 `|` 开头**把表截成两半 —— 改索引表要**每行都以 `|` 收尾**。
- ★ 「NN 册」两套并存 ⇒ 引用**必须带册号**（G15 不判节号）。★★ 引用 wushen **一律带目录**。⚠️ `P` 系列三套同号（25§7/26§17.7/27§9）不改名。
- ★ **三方对账是常态**：文档 ↔ 代码 ↔ **wushen 原作**。

## 子系统（细则 `CONVENTIONS-engine.md`）
- ★ **记账式重算**：`skill.ts` `recompute()` 先 `#releaseLedger()` 再 `#absorb()`（幂等）；三入口共用 `#attachSlot`/`#detachSlot`。（重构搬走代码会打穿靠源文本匹配的变异样本⇒假绿。）
- ★ **数值偏离（权威 `docs/29` §29.4）**：① `max_hp` con 项 ⇒ ✅ **已闭合**：照抄 wushen（**不除** 10）（§35）；而 `defense` 里同一个 `prop(con)` **要除 10** ——「同一个 prop 两处算法不同，原作如此」。② 玩家背包 **50**（≠wushen 20；NPC 10/房间 50）；③ **`gj` 照抄 wushen**。★★ wushen `recount` 两套算法 ⇒ 统一走玩家那套。
- ★ **播报**：房内 `sendRoom`（三视角/`warn`）；跨房 `sendChannel`（`CHANNEL_SCOPE`/`msg`）。★★ wushen `msg.ch` 只 7 种 ⇒ `CHANNELS` 无 `say`/`emote`。★ 输入 `$X` 被占位符吃掉。
- ★ **背压两档**：① `MAX_OUTBOUND_QUEUE`(256)=hub 队列条数，恒≤1，**非运行时判据**；② `MAX_BUFFERED_BYTES`(1MiB)=`socket.bufferedAmount` ⇒ **运行时够得着**；超限 ⇒ `close()+forget()+false`，**不调 `onReject`**（递归）。★ `session.#send` 看返回值。
- ★ **网络管线顺序**：量大小→限流→分诊→解析+**zod**（限流在解析前）；只有 `ws-server.ts` 碰 `ws`。
- ★★ **读档 = 分级**（§40/§28.5.5，单源 `load-report.ts`）：**① 结构性坏⇒抛**；**② 条目级坏⇒丢+记账**（整包抛⇒回滚后全体砖档）；**②′ 正常过期⇒丢+不记账**；**③ 调用方义务：`rejected` 非空即读档失败**（T12）。★★ `SkillBook.load()` 绕过 `learn()/enable()` ⇒ 准入写**数据入口**。★ `load*` 是"合并"语义。
- ★★ **活体 = `Actor.isAlive`**（§41）：从 `CommandActor` **上提到 `Actor`**（**属性**）；`allow_die` + 房间钩子共用。★★ 短路只放 `room.ts#hooked()` 开头。★ `Item` 非 `Actor` ⇒ 类型层挡。
- ★★ **P0（§30）**：① 入站 try/catch+`onInternalError`；② `--host`+`WS_PATH='/ws'`+`isSameOriginRequest`；③ `isRoleName` 单源+`#byRoleId` 唯一。★ **N4/§50**：`MAX_CONNECTIONS_PER_IP`+`hub.admissionRefusal()`+`--max-connections-per-ip`，满员**关连接**。★★ **反代压平 `remoteAddress` ⇒ per-IP 退化"全体合计"**（31 册 §3.1）。★ 未做 **T12**。
- ★★ **`admissionRefusal()` 把"判据"与"形态"分离**（返 `'full'|'per-ip'|null`，`accept()` 仍 `boolean`）——拒绝**原因**给客户端分档文案。
- ★★ **`Item` 持 `def` + 派生 `interact`**（§53，B 批）：与 `Npc`/`Room` 同款 —— 实例持模板引用，构造时把钩子投影成 `InteractHooks`（字段**原样搬运、不归一**；判据留调用点写 `... === true`）。**搬运是 `CommandActor` 四原语** `takeItem`/`dropItem`/`spendItem`/`spendMoney`（**刻意避开 `Container.addItem`/`removeItem` 同名**）。`on_accept` 是**纯谓词**（无副作用）⇒ `give` 先问后扣（与 wushen 顺序相反、结果同）。★ `get`/`drop` 只做**整叠**（拆分要铸 oid，`CommandActor` 够不着 `OidSpace`）。
- ★★ **战斗（§54，最小范围）**：① **时钟 = `World.scheduler`**（一个世界一个时钟；`bootstrapWorld` 造、`main.ts` `setInterval` 推进 `step()` + `sessions.afterTick()`）；角色 `beginFight` 缺它**抛错**。② **命中/躲闪/招架/暴击/伤害全在 `formula.ts`**（G6 R6.9 守）；★★ **躲闪/招架是线性对抗** `rand*(ds/2)+ds/2 > mz`（**不是**概率式），无加成时 `ds===mz` ⇒ **永远躲不开**（测试要命中该支只能真给 `prop.ds`/`prop.zj`）。③ **掉落**：`rollDrops()` 照抄 `create_by_odds` ⇒ `odds` 万分比、**`odds:0`=必掉**、`min`+`max` **覆盖** `count`；铸造器 `ItemSpawner` 由 `world.ts` 注入（`makeItem(path,count)`），**有 `drops` 无铸造器 ⇒ 抛 `NpcError`**。④ ★★ **`die()` 幂等判据是 `#dead` 标志，不是 `!isAlive`**（调用方先打到 0 血再调 `die()` ⇒ hp 判据会让收尾永不执行）。⑤ **叉 3：不搞尸体** —— NPC `moveTo(null)` 消散、掉落落房间地上；玩家**留房间**（灵魂 `hp=0`）+ `die` 帧；`relive` **原地满血**（无惩罚）。★ `relive` 指令**必带 `allow_die:true`**（否则死人唯一出路被闸门拦死）。

## 成长闭环（§56 / 27 册 §13）
- ★★ **`Character.addExp()` 是经验的唯一增加入口**（wushen 同名）；负数/NaN **抛错**（扣减走各自惩罚路径）。`NpcDef.exp/pot` 是**击杀奖励**，不是 NPC 自身经验（同名字段两个概念）。
- ★★ **技能上限单点**：`skillLimit()=levelLimit(exp,level)` → `SkillBook.#capOf=min(maxLevel,skillLimit)` → `addExp` 封顶。`Npc.skillLimit()` 覆写 **`Infinity`**（NPC 不走这条曲线）。
- ★ 上限是**动态的** ⇒ `addExp` 到顶**不清零**剩余经验（清零会吞进度）；`practice` 遇 `cost===0` 要**免费升级**且用 `addExp(id,0,untilLevel)` 钉住目标等级。
- ★ `practice` 是**一次结算**（wushen `lianxi` 是持续状态，`Actor.state` 未落地）；1:1 兑换。`capped`（到上限）与 `reached`（到你指定目标）**分开**。
- ★ 重生走 `world.ts#spawnNpc`（首次摆放与重生**同一条路**），`no_refresh` 不重生；排期走 `World.scheduler`，房间满**重试**。
- ★★ **`skill` 是保留 area** ⇒ 内容子目录/指令 id 不能用它（`skill/practice` 会抛 `IdError`）⇒ 用了 `train/practice`。同一坑第二次（§53 是 `world/command/item/`）。

## 前端（`src/`，26 册 §15–§21；细则 `CONVENTIONS-web-ui.md`）原生 ESM + 纯 DOM，**不引框架/打包器**；外观照 wushen。两块顶层屏互斥（`#auth`/`#app`），切屏唯一落点 `ui/screens.ts`，由 `login` 帧驱动。
★ protocol 只 `import type`（G14）；`ui/dom.ts` **不提供 innerHTML 助手**；`ui/markup.ts` 用**标签白名单+createTextNode**（已摘掉 `CMD`）。★★ **"改前端"默认去 `D:/ts-mud/wushen/src/` 找组件移植，不是自己发明**。

## 未做
**已办**：T1/T2/T15–T24（T23④ 未做）；P0；数值裁定（§32）；命名隔离（§34）；有效属性（§37）；版本控制（§38）；属性三档口+`score`（§39）；读档准入（E3/§40）；活体（E4/§41）；**S/F/E/L/N/D §42–§50 全收口**；**E12 非缺陷**；**B 批（§53）物品可交互 `get`/`drop`/`give`/`use` + `Item` 持 `def`**；**战斗最小范围（§54：调度器 + 命中/躲闪/招架 + `fight`/`kill`/`relive` + 不搞尸体 + 死亡掉落）**；**独立审查批（§55，17 条已全修：H1 假绿 / H2 静默跳过 / M1 JSON 控制字符 / M2+M6 错误路径 / M3 战斗节拍 / M4 `diff_sh` / M5 **真**清偿 T4/T5 / L1–L9）**。
**仍未做（详见 `_roadmap-还差多少-2026-10-16.md` §九）**：**T12** 账号/存档/验签（28 册定稿）；**BUFF/状态/连招/门派/`perform`（绝招）—— 战斗的下一档**；交易（`buy/sell`+`sell_list`）/任务/装备；`on_kill` 钩子接线；技能第三档 addin；知识·隐藏技能；门派薄壳；面板不可达；G9 对账闸门；真浏览器 e2e；T22④；图形化地图/选角 UI；G2.3 变异样本（T13）；物品进出房间钩子（wushen `npc.js:160/208`）。
★ **E9 待专项**（`recount` 只钳 hp 不钳 mp ⇒ 原作空档）。★ **E 号多来源，引用带册号**：`loadTemp`=`NEVER_EXPIRES`（§44）、busy 上限（§49）、`loadProps` 无范围闸门（§48）、安全头（L1/§50）、per-IP（N4/§50）。

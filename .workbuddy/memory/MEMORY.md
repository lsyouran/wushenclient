# ts-mud / newmud · 长期约定

> 根 `D:/ts-mud/newmud`（docs 在 `D:/ts-mud/docs/`；git 在 `D:/ts-mud/.git`；一次性证据 `_bench-*`/`_shots-*`）。
> 路径由 `import.meta.url` 上溯 `package.json`+`tsconfig.json` 派生；禁硬编码 `newmud`、禁 `process.cwd()`（G12）。
> **细节回文档册，本文件只留"会踩的"。** 前端细则 `CONVENTIONS-web-ui.md`、引擎细则 `CONVENTIONS-engine.md`（同目录）。
> ★ 2026-10-13 三方体检：`D:/ts-mud/_audit-代码文档体检-2026-10-13.md`。
> ★ **2026-10-16 缺陷与安全审查**：`D:/ts-mud/_audit-代码缺陷与安全审查-2026-10-16.md`（13 条，含 `<CMD>` 命令注入、临时数据 TTL 存档丢失）。
> ★ **S 系列进度**：S1–S4（§42–§44）；**数据损坏族 S6/S7/S8/S12（§45）**；**输入边界族 S10/S9（§46）**；**前端可用性族 F2/F3/F4/F5/L2（§47）**；**收尾批 S11/S13/E10·E11/N6（§48）**；**E5 `busy` 拍板落地（§49）**；**收口批 L1/N4/N5·E13/D10/D11（§50）** 全部已修（**E12 核对后判为非缺陷**：`splitInput` 与 wushen 一致 + 注释已注明有意偏离）。**⇒ 三份报告的「代码缺陷项」已清空**；剩**功能缺口**（B 批 / 战斗 / T12）与**部署项**（TLS，见 **31 册**）。
> ★★ **`busy` 语义（E5 / §49）**：`busy` = **短时动作锁**。`setBusy` **赋值**、`addBusy` **叠加**、`clearBusy` 解除；硬上界 `BUSY_MAX_MS = 15s`（`character.ts` 导出）。**非法**（非有限/≤0）⇒ 抛；**有限但超限** ⇒ 钳。唯一写入口 `#armBusy`。★ 别与**属性** `busy`（`props.ts`，忙乱时间加成）混淆。★ 需"更久不能动"用 `state`，别把 busy 当第二套状态。

## 验证内环（改完必跑）

```
cd D:/ts-mud/newmud
node node_modules/typescript/bin/tsc --noEmit
node node_modules/typescript/bin/tsc -p tsconfig.web.json --noEmit
node node_modules/vitest/vitest.mjs run
node tools/gate/run-all.mjs          # G2/G3/G5/G6/G12/G13/G14/G15
node tools/gate/mutation-test.mjs    # 9–13 min；动闸门/测试必跑，跑时不许改文件
```
node 用托管版 `C:/Users/Administrator/.workbuddy/binaries/node/versions/22.22.2-6/node.exe`（实测 2026-10-16 双工程 tsc 仍 0 错）。
基线（2026-10-16 §50 后实测）：**vitest 43 文件 845 测试全绿 · run-all PASS 无 SKIP · mutation 89/89（末次 §41；§42–§50 未动 `tools/gate/*`）**；双工程 tsc 0 错；G15 现存册号含 `30 / 31`。
⚠️ 全量跑时 `static-web.test.ts` 偶发 2 条红（首页重定向），**单独复跑必绿** ⇒ 端口竞争 flake，别当回归。
★ 动过源码/测试/样本/闸门 ⇒ 基线作废重跑。★ **未动 `tools/gate/*` ⇒ 不用跑 mutation**。★ 长跑别 `| head/grep`（SIGPIPE 中断）⇒ 重定向到文件再读。
★ 全量 vitest 与 `run-all` 别同时跑（`launcher.test.ts --help` 并发超时，有 5s 超时 flake ⇒ 见红先单独复跑）。

## 铁律

1. **fix-before-assert**：先加断言并**实证**会红再改；判据锚在**不可能被别的原因满足**的位置。新判据答两问：① 运行时够得着吗？② **谁在照它做？**
   ★★ **机检报 N 条改 N 条是抽样不是收工**：只认"写出文件名"的引用；还要问"这形状有没有看不见的写法"。
2. 改闸门**或对应测试** ⇒ 跑 `gate:mutation`。SKIP 不算通过。默认值/缺省分支也要有测试。
3. **单源真相**：`shared/ids.ts`/`constants.ts`/`protocol.ts`；第二份语法/映射/清单就删。性别三档（0 无性/1 男/2 女）；**`call3()`（他/她）保持两档**。
4. 闸门规则必须自带 `dirs`（扫描≠判定范围 ⇒ 死规则，FG-7）；证明闸门可红的样本也要证明**守卫自己**可红；判据落在**区分性字段**。
5. **注释/文档也是断言**（FG-19/20/21）：不符则补实现或改注释+测试钉住。旧 T/FG 条目是**快照不是现状**，动手前逐条复查。
6. **编号跨文件**：用号前全仓 grep。宁可顺延，不挪别人已引用的号。
7. ★ **"靠某号/某值不存在"的判据是脆的**；动手前先问"我这一动，有没有谁的前提被我取消掉"。
8. ★★ **写"不该改 X"的断言时先问：如果我什么都不做，这条是不是也绿**（2026-10-16 第三次踩到）。
   两种典型假绿：① `before = 读X(); …; expect(X).toBe(before)` —— 上一个用例可能已把它写成同样内容；
   ② 从未改变的初值出发（`#app` 初始 `hidden` ⇒ "拨回 auth" 与 "什么都没做" 观察值相同）。
   修法：**哨兵值** + **起点人为拨到相反状态**，让两个方向都有区分性。

## 命名（四层，别混）

**① 代码名（英文可读） ② 数据键（wushen 拼音缩写） ③ 中文名 ④ 技能 id / 装配槽。**

- **派生字段** `character.derived.X`：`attack`/`defense`/`hit`/**`evasion`**/**`deflect`**/`crit`/`attackSpeed`/`maxHp`/`damageReductionPer`/`ignoreDefensePer`。
- ★★ **第 4 个命名空间 = 技能 id**（`force`/`dodge`/`parry`/`bite`/`sword`/…）。**数值侧名不得撞技能 id / 槽名** ⇒ 躲闪/招架取 **`evasion`/`deflect`**。闸门 **G3.G** 守（`PROP` 别名键 ∪ `DerivedCombat` ⊥ `ENABLE_SLOTS`）。★ `force` 是潜伏下一例。
- **PROP 别名表**（`shared/constants.ts`，`PROP.attack === 'gj'`）：代码别写裸 `'gj'`。数据键英文化草案见 29 册 §29.11（**未批**）。
- ★★ **有效属性（§37 裁定）**：有效属性 = 先天 + 后天加成，唯一口径 `formula.ts#effectiveAttr()`，**一切门槛读它**；**但派生公式读分开值**（先天/加成在式子里位置不同）⇒「门槛=合成值、公式=分开值」。`Character.str/con/dex/int` 返回**有效值**，裸先天值只在 `innateSnapshot()`。`minProp`+`minInnate` 已合并为 `minAttr`。详见 29 册 §29.13。
  ★ **三档读取口（§39）**：`attrBreakdowns()` → `{key,innate,bonus,total}`，`total` 仍走 `effectiveAttr`；消费者 `world/command/info/score.ts`。**`AttrKey` 由 `ATTR_KEYS` 派生**。★ 加 `CommandActor` 成员会**打穿所有 implements 替身**（`tsc` 逐处点名 → 良性）。
- **不用 `enum`**：`as const` 对象 + 派生联合类型。
- ★★ 教训：引入别名后 **G3.C 键字面量计数从 22 掉到 0** —— 是**规则失去输入**（FG-7）。⇒ **通则：引入一层间接 ⇒ 先问"哪个闸门原本靠直接形态在守、现在还看得见吗？"**

## grep 自检（★★ 最高频踩坑）

`grep` 默认 BRE：`\s`/`\d` **不是**转义类（`ch:\s*"` 是字面量 ⇒ 静默零命中）。要 `-E`/`-P`。**"零命中"结论先拿一个确知命中不了的串自检**。

## 环境坑

- `spawnSync` stdin 必须 `'ignore'`；不得 `status ?? 1` 兜底（FG-3）。
- Bash heredoc 被拦（用编辑工具写文件）；`wmic` 黑名单（用 `Get-Process`）。
- Windows `child.kill('SIGTERM')` 不投递真信号 ⇒ 退出码 null；测"能停"只断言没超时。
- `fetch` 归一化 `%2e%2e` ⇒ 测路径穿越要发**原始 HTTP**（`node:net`）。`http.Server.close()` 不等已建连接 ⇒ 先 `closeAllConnections()`。
- ★ **本机有代理**：复核本机服务加 `--noproxy '*'`；无头浏览器加 `--no-proxy-server`。
- 无头 Chrome：Windows `--window-size` 最小宽 ≈522；别传 `--timeout`；`/tmp`→`D:/tmp`。
- ★ **Windows 允许两进程绑同端口** ⇒ 起服务前 `netstat -ano -p tcp` 查占用、起完先验首页；常驻服务用**托管后台任务**。
- ★ **jsdom 没有布局** ⇒ 改 DOM 排布后默认跑无头 Chrome 探针。
- ★ `better-sqlite3` 与当前 Node ABI 不匹配 ⇒ 用内置 `node:sqlite`。★ SQLite 默认 `cache_size` 仅 2 MB ⇒ 热数据越过就断崖（66 ms→2830 ms）。

## 启动（26 册 §17）

`npm start`（prestart 自动 build:web，默认 8123）/ `npm start -- --port 9000`。
入口链 `tools/start.mjs`（注册 TS 钩子）→ `server/cli.ts` → `main()`；`server/main.ts` 是纯工厂**不能直跑**。
★ 静态资源与 WS **同端口**；服务根 `dist/web/`，`GET /` 302 到 `/src/index.html`。★ node ≥ 22.15.0（`module.registerHooks`）。
加载器 `tools/dev/ts-loader.ts`：**必须 transform**（ws-server 有参数属性）、候选表永不含 `.d.ts`、别名表读 tsconfig。

## 闸门

- 退出码四态（26 册 §27）：**0 通过/1 违规/2 跳过/3 崩溃**；`-1`=子进程没起。每个 `tools/gate/*.mjs` 入口显式 `installCrashGuard('<id>')`；"忘装"由 G6 R6.11 兜（`re`/`empty`/`must` 三种互斥模式）。元闸门判据：`before∉{FAIL,CRASH} && after===expectAfter(缺省 EXIT_FAIL) && restored===before && note===''`；崩溃要正面声明 `expectAfter: EXIT_CRASH`。迭代用 `--only=<子串>`，**取证不许带 `--only`**。窄口：R6.7 只认 `process.exit(` 紧跟数字字面量；崩溃守卫不覆盖**模块求值期**异常。
- **G2 协议对账**（26 册 §26）：G2.1 去重/G2.2 schema 覆盖/G2.3 前端 handler↔声明/**G2.8 发送点↔声明↔台账 三方双向**。台账 `shared/protocol.ts#SERVER_PACKET_UNWIRED`（**只许缩短**）。★★ 发送点必须锚在 `packet(` 调用体内。★★ 汇总行先求和再比较。
- **变异测试夹具**：safe-delete 配额 50/轮，超了 ⇒ 还原失败 ⇒ **连锁假绿**（FG-8）。还原**只写不删**。
- ★ 窄口与已补守卫（**2026-10-16 订正：本条原写"未修"，实为 §36 已修**）：① G15 **只判册号、不判 `§节号`**（这是剩下的真窄口）；G15.2 **已覆盖 `docs/NN`**（§36，今实测 121 条）；② **G3/G5/G12/G13 已补 DEAD-RULE GUARD**（§36，扫 0 文件即判失败）。⇒ **闸门全绿 ≠ 引用都对**（节号仍靠人工；判据落在非区分性字段仍会漏）。

## 文档册（入口 `docs/00`）

纪律：发现问题→**更新原册不另起**；索引只放链接；状态写标题行首句；每条结论带"怎么证明"；标记已办**保留原文**再标 ✅。
项目册 `00/24`–`31`（`25` 暂缓）；wushen 册 `docs/wushen/00`–`23`。册号并集 `00`–`31`（2026-10-16 起）。
`24` 命名与标识符规范·§5 闸门表·FG 全修 ｜ `25` 安全与支付（**暂缓**）｜ `26` **审查与实现批次唯一权威源** ｜ `27` 技能系统设计 ｜ `28` 存档与持久化（T12 未实现；**§28.5.5 读档契约·分级**）｜ `29` **属性与派生数值设计**（改公式/数值/容量前必读）｜ `30` **测试策略与验证内环**（分层/触发条件/flake 判读）｜ `31` **运维与发布**（参数表/反代 TLS/安全清单）。★ 工程门面 = `newmud/README.md`（指向 `docs/00`，分歧以 `docs/` 为准）。
- ★ 「NN 册」两套并存 ⇒ **引用必须带册号**（G15 守，只判册号**不判节号**）。★★ **引用 wushen 一律带目录**（105 个 basename 多副本）。
- ⚠️ `P` 系列三套同号（25§7/26§17.7/27§9），**不改名** ⇒ 引用写"册号+节号"。
- ★ **三方对账是常态方法**：文档 ↔ 代码 ↔ **wushen 原作**（不看 wushen 漏"文档与实现**一致地一起偏离**原作"）。

## 子系统要点（细则见 `CONVENTIONS-engine.md`）

- ★ **记账式重算**：`skill.ts` `recompute()` 先 `#releaseLedger()` 再 `#absorb()`（幂等）；三入口共用 `#attachSlot`/`#detachSlot`（P0-4 / 26 册 §30.4）。（教训：**重构搬走代码会打穿靠源文本匹配的变异样本 ⇒ 假绿**。）
- ★ **数值偏离（唯一权威：`docs/29`）**：① `max_hp` 的 `con` 项 wushen 不除 10、本项目除 10（**未裁定**，220/400 双锚点）；② 玩家背包 **50**（有意偏离 wushen 的 20；NPC 10；房间 50）；③ **`gj` 已裁定照抄 wushen** —— 先天 `str` 在 `gj_per` 百分比**外**。★★ wushen `recount` 四个归属两套算法 ⇒ 本项目**统一走玩家那套**。改数值前先读 29 册 §29.4。
- ★ **播报**：房间内 `sendRoom`（三视角、`warn` 帧）；跨房间 `sendChannel`（`CHANNEL_SCOPE`、`msg` 帧）。★★ wushen 的 `msg.ch` **只有 7 种** ⇒ `CHANNELS` 不该有 `say`/`emote`。★ 输入里 `$X` 会被占位符吃掉。
- ★ **背压两档各管一段**：① `MAX_OUTBOUND_QUEUE`(256)=hub 队列条数，恒≤1，**非运行时判据**；② `MAX_BUFFERED_BYTES`(1MiB)=`socket.bufferedAmount` ⇒ **运行时够得着的**；超限 ⇒ `close()+forget()+false`，**且不调 `onReject`**（无限递归）。★ `session.#send` 必须看返回值。
- ★ **网络管线顺序**：量大小→限流→分诊→解析+**zod**（限流必须在解析前）；只有 `ws-server.ts` 碰 `ws`。
- ★★ **读档契约 = 分级（26 册 §40 / 28 册 §28.5.5）**：单源 `server/engine/load-report.ts`（props/temp/skill 共用）。**① 结构性坏 ⇒ 抛**；**② 条目级坏 ⇒ 丢该条 + 记账**（整包抛会让**版本回滚后全体角色砖档**）；**③ 调用方义务：`rejected` 非空即读档失败**（T12 落实）。★★ **`SkillBook.load()` 是绕过 `learn()`/`enable()` 的那条路** ⇒ 准入必须写在**数据入口**上。★★ 教训：**新判据要问"会不会被另一条判据满足"**。
- ★ **`load*` 仍是"合并"语义**（不先清空）。
- ★★ **活体判据 = `Actor.isAlive`（26 册 §41）**：从 `CommandActor` **上提到 `Actor`**（**属性**，不可能忘写括号）；命令闸门 `allow_die` + 房间进出钩子共用。★★ **短路位置是要害**：短路只能放 `room.ts#hooked()` 开头（**只压房内活体那一层**）；wushen 靠 `NPC.die()` 移出达到，靠"移出"不靠"再判一条"。★ `Item` 不是 `Actor` ⇒ 物品误触发在**类型层**挡住。
- ★★ **P0 批次已修（26 册 §30）**：① 入站 try/catch + `onInternalError` + `installProcessErrorGuards`；② `--host` + `WS_PATH='/ws'` + `isSameOriginRequest`；③ `isRoleName` 单源 + `#byRoleId` 在线唯一。★ **按 IP 限连接数已补（N4 / §50）**：`MAX_CONNECTIONS_PER_IP` + `hub.admissionRefusal()` + `--max-connections-per-ip`；满员**关连接**。★★ **反代下 `remoteAddress` 被压平 ⇒ per-IP 退化为"全体合计"**（见 31 册 §3.1）。★ 仍未做：**T12**（账号/存档/验签）。

## 前端（`src/`，26 册 §15–§21；细则 `CONVENTIONS-web-ui.md`）

原生 ESM + 纯 DOM，**不引框架不引打包器**；外观照 wushen。
★ 两块顶层屏互斥（`#auth`/`#app`），切屏唯一落点 `ui/screens.ts`，由服务端 `login` 帧驱动。
★ protocol **只 `import type`**（G14）；`ui/dom.ts` **不提供 innerHTML 助手**（XSS 结构防线）；`ui/markup.ts` 用**标签白名单 + createTextNode** 解析服务端文本。
★★ **"改前端"默认动作是去 `D:/ts-mud/wushen/src/` 找对应组件移植，不是自己发明**。

## 未做

**已办**：T1/T2/T15–T24（T23④ 未做）；**P0 批次**（N1/N2/N3/E2，§30）；**文档订正批次**（§31）；**数值裁定批次**（§32）；**命名空间隔离批次**（`evasion`/`deflect` + G3.G，§34）；**有效属性归一**（§37）；**版本控制引入**（§38）；**属性三档读取口 + `score`**（§39）；**读档准入校验**（E3，§40）；**活体判据**（E4，§41）⇒ **35-D 三项全部收口**。
**会话边界两道守卫**（S2 `loginerror` 按 `state.loggedIn` 分叉 · S3 socket 身份取代 `ignoreNextClose`，§42）⇒ **S1–S3 已收口**。
**玩家文本不得产出可执行按钮**（S1，§43，2026-10-16）：从 `markup.ts` 白名单**摘掉 `CMD`**（自由文本里的按钮 = `CmdItem` 的重复且更弱的一份）+ 三层服务端纵深，单源 `shared/player-text.ts#neutralizePlayerText`。
**存档 TTL 契约**（S4，§44，2026-10-16）：`snapshotTemp` 导出 `{v,e}`（`e`=**绝对**过期时刻）、`loadTemp` 按它恢复。
★★ **读档分级其实是三档**：结构性坏 ⇒ 抛；**脏条目 ⇒ 丢 + 记账**；**正常过期 ⇒ 丢 + 不记账**（记进 `rejected` 会按契约③误报"读档失败"）。
★★ **白名单拦的是"名单外的攻击"，拦不住"用名单内合法能力干的事"** ⇒ 白名单每一条都要问"被允许用这个能力的是谁"。
★★ **换掉防御机制时，清点旧机制顺手还提供哪些附带保护**（wushen 的 `htmlEncode` 顺手把 `<CMD>` 也挡了；本项目不必转义 HTML ⇒ 恰恰漏了它）。
**仍未做**：账号+token 验签+角色存档（**T12**，设计定稿 28 册）；**B 批** `get/drop/give/use`+`Item` 存 `def`；战斗（`on_use`/`on_kill` 无消费者）；装备/服用；技能第三档 addin；知识·隐藏技能；门派薄壳；**D 批**：面板子系统基本不可达；G9 变更-覆盖对账闸门；真浏览器 e2e 入库；T22 第 4 条；`m/l/f/o` 惰性字段；图形化地图/选角 UI；G2.3 变异样本（T13）。（**README 链接已补**：00 册 §2 已挂 `newmud/README.md` 入口，§50.6。）
★ **E9 待专项分析**（`recount` 只钳 hp 不钳 mp；wushen `world/extends/char/user.js:6` **也只钳 hp** ⇒ 属原作空档）。
★ 同族已收口 —— ★★ **注意 E 号有多个来源，引用务必带册号**：`loadTemp` 一律 `NEVER_EXPIRES`（§44）、**busy 上限（§49）**、`loadProps` 无范围闸门（§48）、**安全响应头（L1/§50）**、**per-IP 限连接（N4/§50）**、**房间级签名（N5·E13/§50）**。
★ ★★ **`admissionRefusal()` 把"判据"与"返回形态"分离**（返回 `'full'|'per-ip'|null`，但 `accept()` 仍是 `boolean`）—— 拒绝 **原因**要给客户端分档文案，收不收只是布尔；别把两者揉回一个函数返回值。

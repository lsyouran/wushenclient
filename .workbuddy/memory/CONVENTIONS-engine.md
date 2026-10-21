# ts-mud / newmud · 服务端引擎与网络细则

> 从 `MEMORY.md` 拆出：只在动引擎/数值/网络时读。主记忆文件只留指针与最高风险的钩子。

## 对象模型

`GameObject → Container → {Room, Character → Npc}`；**不做原型克隆**；`environment` 是**私有 WeakMap**，
只有 `Container.addItem/removeItem` 能改；公式唯一来源 `formula.ts`（R6.9 禁别处重定义、R6.10 禁 `skill.ts`
外定义 release/attach prop）；**派生值只由 `Character.recount()` 写**（`setInnate`/`loadProps` 后自动重算）。
★ **派生值与输入量的分界见 28 册 §28.2** ——「属性一直正确」靠的是**唯一副本 + 单一重算入口**，不是写库。

## 命令分发 `server/engine/command.ts`

三级查找（房间动作→全局指令→目标动作，任一步 `run` 显式返 `false` 才降级）；六道闸门集中一处
（level→die→faint→state→fight→busy），★ `allow_fight` **缺省 true**、其余**显式 true 才放行**（不对称必须保住）；
被拦 = 消费掉输入；建表即拒坏声明；登录期只放行 `allow_login`。元闸门 **CMD.1–CMD.6**。
★ 内容层要用引擎函数必须从 `server/world/define.ts` 转出 —— G13 的 **D2** 禁 `world/**` 直连 `server/engine/**`。
⚠️ `splitInput`（`:267-273`）只小写化首词、`args` 保持原样 ⇒ `ask Xiaoer` 命中不了（`findTarget` 大小写敏感）。

## 技能 `server/engine/skill.ts`

★ 记账式重算 `recompute()` 先 `#releaseLedger()` 再 `#absorb()`（幂等、跳 0 值）；装配槽闭集 `ENABLE_SLOTS`(11)；
★ `canUsePfm()` 判槽用 `activeTemplate(pfm.enable)?.id !== skillId`（BASE 技能 `enabled` 恒 null，否则其 PFM 打不出）；
★ **0 级技能不贡献属性**（判据是等级）；数值全在 `SKILL_FORMULA`。元闸门 **SKL.1–SKL.10**。

★★ **三个装载入口必须同一口径**（2026-10-13 体检）：`enable()`（`:551-556`）与 `load()`（`:694-700`）都做了
"**同一槽互斥挤兑**"，`loadFromDef()`（`:801-807`）**只处理"同一技能换槽"，不处理"两条不同技能抢同一槽"**
⇒ 属性账（按 `st.enabled` 记账）与装配表（`#enabledBySlot`）**分家且静默**。
`validate.ts:159-172` 只校验 `enableAs` 是否合法槽名、**不查重复** ⇒ NPC def 写错即可命中（**活路径**）。
⇒ 建议：把"槽占用变更"抽成单一私有方法，三个入口共用 + validate 补重复槽校验。
（另：`load()` 里 `enabled:null` 的记录**不清** `#enabledBySlot`；且不校验 `enabled ∈ can_enables`/`type===SKILL`。）

## 属性与临时状态

- **`engine/props.ts`**：`loadProps` 收的是**不可信**数据，**顶层与嵌套层都拒数组**
  （`typeof [] === 'object'` ⇒ 空数组会静默"装 0 个属性"）。`describeValue` 专有一档输出"数组"。
  ★ `snapshotTemp` **过期项不写进存档**（否则读档回来带一堆失效 BUFF）。
  剩下口子：值只过 `Number.isFinite`，**无范围/符号闸门**（`gj:1e300`、`max_hp:-5` 可进）。
- **`engine/temp.ts`**：`loadTemp`（`:178-189`）与 `loadProps` **不对称** —— `value: unknown` 通吃、一律按
  `NEVER_EXPIRES` 装载 ⇒ 「还剩 3 秒」读回来变永久。存档批次接上后会把 `busy` 固化成永久忙碌。

## 数值 `engine/formula.ts`

参数全在 `COMBAT_FORMULA`，**不许写死在表达式里**。
★ `innateDexPer`（=0.5）**同时喂 `mz`（命中）与 `ds`（躲闪）**；命名刻意中性，**别改回 `dodgePerDex`**（会诱使
"调躲闪顺手改了命中"）。★ wushen `world/extends/char/user.js:18/19` 都写死 `dex/2`（★ **必须带目录**：wushen 的
`user.js` 有 4 个副本，本项目不同地方用同一简称指两个文件 —— `world/extends/char/user.js` 与 `os/char/user.js`）。
★ 已知偏离两处：
1. `max_hp` 的 `con` 加成项 wushen **不除 10**、本项目除了 10（`gj`/`fy`/`ds`/`zj` 四式两边都除）；
   今天影响为零，测试留 **220 vs 400 双锚点**。
2. **`gj`（待裁定）**：本项目 `scaled(str + gj + str_prop*(str/10), gj_per)` 把先天 `str` **算进了百分比缩放**；
   wushen `world/extends/char/user.js:17` 是 `this.str + (...) * (100+gj_per)/100` ⇒ **`str` 在百分比之外**。
   ★ 现有 `tests/engine-formula.test.ts` 锚点**全在 `gj_per=0`**，两边恰好相同 ⇒ **完全看不出来**。

## 进出钩子（两层）

`Room.fireEnter` / `allowLeave` 先遍历 **`#hooked(me)`**（房间里**持 `def` 的活体**）再走 **`this.def`**（房间自己）。
顺序照 wushen：**进入 = 活体先 / 房间后**，**离开 = 房间先 / 活体后**。
★★ **必须跳过移动者自己** —— `fireEnter` 在 `moveTo` **之后**跑，不跳就会自己通知自己。
★ **判"谁算活体"用结构判据 `hooksOf(obj)`（持不持 `def`）**，**不许写 `instanceof Npc`** ——
那会造 `room → npc → character → room` 的 **ESM 循环**（TDZ 地雷）。
⚠️ 与 wushen `os/room/room.js:48` 的 `if (obj.hp)` **活体判据**不符，而 `server/world/defs.ts:290` 的注释已写了
这条规则 ⇒ **注释与实现不符**，NPC 移动批次接上后可达。

## 移动（26 册 §23）

`Character.go(dir)` 返回判别式联合 `MoveResult`（`no-exit`/`blocked`/`full`），**不是 boolean**；
文案唯一来源 `shared/constants.ts#MOVE_MESSAGES`（放 shared 因引擎与内容层共用，内容层不能 import 引擎 —— G13 D2）。
★ 判定顺序 = **出口 → 满员 → `on_leave`**（照 wushen 两段拼）—— 顺序错了会让**失败**的移动也跑进内容层 `on_leave`。
★ 容量判据单源 `Container.isFull()`；`base.ts:166` 缺省 **`Number.POSITIVE_INFINITY`**（wushen `os/item.js:67`
角色是 **10**；房间 50 是对的）⇒ 背包/NPC 携带无上限，B 批接上即成真问题。
★ **不许有 catch-all**（会把内容层抛的错静默翻译成"过不去"）。★ `Room.linkExit` 拒自环。

## 播报通道（26 册 §24）

**判据是"要不要跨出房间"，不是"能不能说话"**。
★ 房间内 → `Actor.sendRoom(text, target?, excludeself?)`：引擎逐人**三视角**渲染，进**主消息流**（`warn` 帧）。
★ 跨房间 → `Actor.sendChannel(ch, content, to?)`：会话层 `CHANNEL_SCOPE` 裁决受众，发 `msg` 帧。
★★ **wushen 的 `msg.ch` 实测只有 7 种**：`chat/tm/fam/pty/es/rumor/sys`（**没有 say、没有 emote**）
⇒ `CHANNELS` 里不该有 `'say'`（走 sendRoom）与 `'emote'`；`CHANNEL_SCOPE` 里**没有 `'room'`**。
★ `say` 长度上限 200（判据是 `>` 不是 `>=`）；★ `say` 无参 = **房间广播**「$N在自言自语的说些什么。」
（是**社交动作**不是错误提示）。★ wushen `say.js` **全文件只有 18 行**，权威行号：
`:8` 无参 / `:10` 禁言 / `:11` 长度 / `:12-15` admin 后门 / `:18` `send_room`；`go.js:7` 是无参那句。
★ 玩家输入里的 `$X` **会被当占位符吃掉**（`say 花$了`→「花了」）—— **wushen 同样如此**，不是本项目的 bug。

## 网络层 `server/net/`

三层，**只有 `ws-server.ts` 碰 `ws`**。★ **管线顺序：量大小 → 限流 → 分诊(JSON/明文) → 解析+zod**
（限流必须在解析前）；★ ws 连 text frame 也交 Buffer ⇒ 靠 `message(data, isBinary)` 区分；
★ `hub.forget()` ≠ 关连接（先回调 → `conn.close()` → forget）。未做：ws-server **没有 `'drain'` 出队路径**。

## 读档准入（26 册 §40）

★★ **读档 = 分级**：① 结构性坏 ⇒ **抛**；② 条目级坏 ⇒ 丢 + 记账；②′ 正常过期 ⇒ 丢 + **不**记账；
③ **`rejected` 非空即读档失败**。★★ `SkillBook.load()` **绕过** `learn()/enable()` ⇒ 准入必须写在**数据入口**。

## 活体与钩子短路（26 册 §41）

★★ **活体 = `Actor.isAlive`**（属性，从 `CommandActor` 上提到 `Actor`）；短路只放 `room.ts#hooked()` **开头**。
★ `Item` 非 `Actor` ⇒ 类型层就能挡（§53 起 `Item` 也持 `def`，别顺手当活体）。

## 背压两档

★ `MAX_OUTBOUND_QUEUE`(256) **非**运行时判据；`MAX_BUFFERED_BYTES`(1MiB) 运行时够得着；
超限 ⇒ `close()` + `forget()` + 返 `false`，**不调 `onReject`**。

## 安全 P0 / N4

★★ **P0**：入站 try/catch + `onInternalError`；`--host` + `WS_PATH='/ws'` + `isSameOriginRequest`；`isRoleName` 单源。
★ **N4**：`MAX_CONNECTIONS_PER_IP` + `hub.admissionRefusal()`。★★ 反代压平 `remoteAddress` ⇒ per-IP 退化成"全体合计"。

## 物品可交互（26 册 §53）

★★ **`Item` 持 `def` + 派生 `interact`**（与 `Npc`/`Room` 同款）：钩子投影成 `InteractHooks`（字段原样搬运）。
搬运是 `CommandActor` 四原语 `takeItem`/`dropItem`/`spendItem`/`spendMoney`。`on_accept` 是**纯谓词**。
★ `get`/`drop` 只做**整叠**。

## 战斗（26 册 §54）

① 时钟 = `World.scheduler`；`beginFight` 缺它**抛错**。
② 命中/躲闪/招架/暴击/伤害全在 `formula.ts`；★★ 躲闪/招架是**线性对抗** `rand*(ds/2)+ds/2 > mz`
（无加成时 `ds===mz` ⇒ **永远躲不开**）。
③ 掉落照抄 `create_by_odds`：`odds:0`=必掉、`min`+`max` **覆盖** `count`；有 `drops` 无 `ItemSpawner` ⇒ 抛 `NpcError`。
④ ★★ **`die()` 幂等判据是 `#dead` 标志**。⑤ 不搞尸体；`relive` **原地满血**，★ 必带 `allow_die:true`。

## 成长闭环（26 册 §56 / 27 册 §13 / 29 册 §29.14）

★★ **`Character.addExp()` 是经验的唯一增加入口**；负数/NaN **抛错**；到顶**不清零**剩余经验。
★★ **境界（realm）是派生量，不是字段**（26 册 §72 / 27 册 §16）：`min(内功,轻功,招架)` 落在
`SKILL_FORMULA.realmThresholds` 第几档；`Character.level` 只是 `realm` 的 getter 别名（**别再写回字段**）。
取 `min` 不取 `max`/平均：取 max ⇒「高境界 + 纸糊血条」。
★ 循环（境界→因子→上限→三槽→境界）**单调收敛**：环上只有三槽能涨，涨的条件（潜能/老师/打怪）都在环外。
★ `levelLimit(exp, realm)` 函数体没变，但 `realm` 会涨了 ⇒ 因子不再是常量 10。
★ 名字表 `REALM_NAMES` / `realmName()` 在 `shared/constants.ts`（越界钳位不抛）；服务端算好放进
`AttrView.realmName`，**前端不查表**。
★★ **技能上限单点**：`skillLimit()=levelLimit(exp,realm)` → `SkillBook.#capOf=min(maxLevel,skillLimit)`；
`Npc.skillLimit()` 覆写 `Infinity`。★ 1000 是**硬顶**（`limitMaxLevel = SKILL_CURVE.refLevel`），
玩家实际能到几级**只由经验换算**（`levelLimit = min(round(cbrt(exp×境界因子)), 硬顶)`）。
★★ **基本武学被动曲线 = 幂律凸** `trunc(maxGain*(lv/ref)^e)`，`e∈(1,3)`：`e>1` 才「后期加成更大」，
`e<3` 才「单位成本递减」。**别写 sqrt**（凹，方向反了 —— §66 已推翻第一版）。属性 `60@1.1` / 派生 `120@1.3`。
**曲线住 `server/world/skill-curves.ts`**（内容层要 import，G13 D2 只许 `@shared/**` 与 `server/world/**`）。
★ `practice` 是**一次结算**（wushen `lianxi` 是持续状态，`Actor.state` 未落地）；`capped` 与 `reached` 分开，
**`capped` 必须先判**；★★ `PracticeResult` 是判别联合（`kind:'done'|'refused'`，`PracticeRefusal` 由它派生）。
★ 重生走 `world.ts#spawnNpc`（首次摆放与重生**同一条路**），`no_refresh` 不重生。
★ 真值：**wushen `die()` 一处 `add_exp` 都没有**（"打怪给经验"原作根本没接）。

## 玩家与登录

`server/player.ts` / `session.ts`：`Player extends Character`，`path` 恒 null。
★ `OBJ_KINDS`（运行时 4）与 `shared/ids.ts` 的 `KINDS`（内容层 9）是**两套**。
★ **先造角色 → 再进房间 → 最后发包**；★ **掉线即注销**；登录后推 `login`+`sc`+`room`+`exits`+`items`。
★ **角色没有存档**（`session.ts:17` 明写），`max_hp`/`max_mp` 取**派生值**而非存档里的数。
⚠️ `recount()`（`character.ts:492-495`）**只钳 hp 不钳 mp**。
⚠️ `session.ts:482-489` `#reconcileRooms` 每条指令全量扫在线玩家并重建签名 ⇒ O(N²)。

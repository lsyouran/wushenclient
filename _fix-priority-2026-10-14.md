# 体检报告复核 + 修复优先级

> 对象：`_audit-代码文档体检-2026-10-13.md`
> 复核日期 2026-10-14 · 方法：对 P0 与关键 P1 **逐条回源码实证**（不是读报告自述）
> 结论：**报告可信，可直接作为工作清单**。以下是复核结果 + 我排的优先级。

---

## 一、复核结论：逐条实测对照

### 已独立实证（与报告一致，无一处推翻）

| 条目 | 报告claim | 实测位置与结果 |
|---|---|---|
| **N1** | 入站业务链路零异常兜底 | ✅ `hub.ts:191-213` 的 switch 无 try/catch；`ws-server.ts:147` 裸调 `hub.inbound`；`grep -rnE "uncaughtException\|unhandledRejection" server/ shared/ src/` = **0 命中** |
| **N2** | 监听不绑 host + WS 无 path/Origin | ✅ `ws-server.ts:224` `owner.listen(options.port, listening)` 无 host；`static.ts` 确认 createWebServer 不 listen（由本层 listen ⇒ 绑 `::`）；而 `cli.ts:177` 把显示写成 `127.0.0.1`；`WebSocketServer({server,maxPayload})` 无 path/verifyClient |
| **N3** | 无鉴权 + roleId 即角色名 | ✅ `session.ts:273` `login(conn, _token, roleId)` 丢弃 token；`:285` `name: roleId`；`:462-469` `#playerNamed` 取第一个匹配；`:274` 只拦同连接重登 |
| **N5** | 广播/对账 O(N²) | ✅ `session.ts:440` world 频道逐连接发；`:482-489` 每条指令遍历全部在线玩家 |
| **N6** | `close(reason)` 未截断 | ✅ `ws-server.ts:70` `socket.close(1011, reason)` |
| **E1** | gj 把 str 纳入百分比缩放 | ✅ `formula.ts:196-198` `scaled(str + gj + str_prop*(str/10), gj_per)` vs wushen `user.js:16` `this.str + (…)*(100+gj_per)/100`（str 在百分比外）。★ **实测测试锚点确实全在 `gj_per=0`**（`tests/engine-formula.test.ts:65` 期望 gj=40 的两边恰好相等）⇒ 差异测不出 |
| **E2** | loadFromDef 缺"同槽挤兑" | ✅ `skill.ts:795-809` 只处理"同技能换槽"（`existing.enabled !== enabled`），第 807 行直接 `#enabledBySlot.set` 覆盖，被挤者 `st.enabled` 不置 null；而 `enable():551-556`、`load():694-701` 都处理了 ⇒ 三入口不对称 |
| **E3** | `load()` 校验不对称 | ✅ `skill.ts:694` 的 `if (enabled !== null)` ⇒ null 记录不清 `#enabledBySlot`；且通篇无 `canEnables`/`type===SKILL` 校验（`enable():527-536` 有） |
| **E4** | `#hooked` 缺活体判据 | ✅ `room.ts:205-211` 只 `hooksOf(obj)`（无 def 返 undefined）+ 跳过 me；无 wushen 的 `obj.hp` 判据 |
| **E5** | setBusy 累加非覆盖 | ✅ `character.ts:519` `remaining + ms`；wushen `chara_skill.js:367` 是 `this.is_busy = buff.duration`（赋值） |
| **E8** | 角色/NPC 容量缺省无限 | ✅ `base.ts:166` `maxItems = Number.POSITIVE_INFINITY`；wushen `item.js:67` = **10**、`char/user.js:5` = **20**；房间 `room.ts:62` = 50（对） |
| **E9** | recount 只钳 hp 不钳 mp | ✅ `character.ts:492-495` 只有 `if (this.#hp > this.maxHp)` |
| **F3** | 前端完全无重连 | ✅ `grep -rnE "setTimeout\|setInterval\|reconnect\|retry" src/` = **0 命中** |
| **F4** | dialog 四字段未消费 | ✅ `social.ts:66-72` 一律"开面板 + 列原始字段"，`close/refresh/clear/remove` 被当普通字段打印 |
| **F5** | 表情面板是死面板 | ✅ `social.ts:54-59` items 是纯字符串数组，无点击行为（`panel.ts` 只在 cmds.length>0 挂 cmdRow） |
| **D1** | 计数 9→10 已漂 | ✅ 24 册 `:405`「9 文件」、`:523`「9 个入口脚本」、26 册 `:3931`「9 个入口脚本」；实测**真正装守卫的入口 = 10**（8 闸门 + run-all + mutation-test，G15 是第 10 个） |
| **D2** | G15 不认 `docs/NN` | ✅ `g15-docrefs.mjs:106` `REF_RE = /(?<!\d)(\d{2}) 册(?!\d)/g` —— 只匹配 `NN 册`，`docs/NN` 形态零覆盖 |
| **D3** | DEAD-RULE GUARD 只装一半 | ✅ `check-paths.mjs:130`、`g13-deps.mjs:112`、`g5-naming.mjs:195` 均为裸 `if (violations.length === 0)`，无守卫；对比 G15 `:185` 有 |
| **D4** | §21.7 声明 26 条 vs 表 18 行 | ✅ `26册:2833` 写"26 条 CSS 数值级差异"，表 `:2959-2976` 实为 **18 行** |
| **D6** | A 系列编号越界 | ✅ `tests/engine-audit.test.ts:7` 声明"本文件内 A1…A6"，实际 `:266/:269` 存在 **A7** |
| **D7** | §29.1 四 vs 五 | ✅ `26册:4242`「四支一次性脚本」，表 `:4246-4250` 列 **A/B/C/D/E 五支** |
| **D9** | 00 册「未决 T3–T22」过期 | ✅ `00册:144` 标题仍写"未决待办 **T3–T22**"，而正文/邻行已记 T15/T17/T18/T19/T20/T21/T23/T24 完成 |
| **反向结论** | 无 XSS / 静态穿越护栏 / 限流表有清理 | ✅ `grep -nE "innerHTML\|outerHTML\|insertAdjacentHTML\|document.write\|new Function\|eval\("` 全仓仅 3 处**注释**命中；`try {` 在 `server/net/` 下**一处都没有**（印证 N1） |

### 未独立复核（报告标 `[未复核]` 或我只读了摘要，未逐一实证）

`N4` `N7` · `E6` `E7` `E10` `E11` `E12` `E13` · `F1` `F2` `F6` `F7` `F8` `F9` `F10` `F11` · `D5` `D8` `D10` `D11`。
—— 这些**不影响优先级排序**（都在 P1/P2），但动手前请按项目铁律"逐条在当下代码里过一遍"。

### 一条报告没写、我顺手看到的

工作树里现存 **~40 个 0 字节的 `__mut_*` / `*.mutbak` 夹具残留**（`server/`、`shared/`、`src/`、`tools/gate/`、`world/` 下），与 26 册 §28 记的"夹具残留 44 个全部 0 字节"吻合。0 字节无害（`walk()` 跳过），但注意别让它们进提交；若某次变异跑中断，需要确认残留是否**真的**是 0 字节。

---

## 二、修复优先级

> 判据：**P0 = 能打死进程 / 当下可利用 / 且是所有未知输入的最后一道网**；P1 = 口径与一致性；P2 = 结构性。
> 与报告 §4 的差别：我把 **E1（gj 公式）从"第一批"降到 P1** —— 它要你先**拍板**，且是数值口径不是崩溃，不该和 N1/N2 抢同一条跑道。

### 🔴 P0 — 立刻（便宜 + 挡大事）

| 序 | 动作 | 位置 | 备注 |
|---|---|---|---|
| 1 | `hub.inbound` 的 switch 包 try/catch（异常 ⇒ `conn.close('内部错误')` + `forget`）；`cli.ts` 装**进程级** `uncaughtException`/`unhandledRejection`（写 stderr **不退出**） | `hub.ts:191-213`、`cli.ts` | 唯一能打死全服的缺口，且是"未来任何未知输入"的兜底。**fix-before-assert**：先写"内容回调抛错 ⇒ 该连接被关、其他连接不受影响、进程存活"，实证会红再修 |
| 2 | `listen(port, '127.0.0.1', cb)` **或加 `--host` 开关**；`WebSocketServer` 加 `path:'/ws'` + Origin 白名单 | `ws-server.ts:118-128,224` | ⚠️ 硬绑 127.0.0.1 会**打断你现有的无头浏览器 e2e / 局域网自测** ⇒ 建议走 `--host` 缺省 127.0.0.1 |
| 3 | 角色名全局唯一 + 字符集校验（复用 `SEGMENT_RE` 思路），重名回 `ALREADY_LOGGED_IN` | `session.ts:273-288` | 这是 **T12 的最小前置**；不做它就等于"冒名一直可用" |
| 4 | `loadFromDef` 补"两条不同技能抢同一槽"的挤兑；把"槽占用变更"抽成**单一私有方法**供 `enable`/`load`/`loadFromDef` 共用；`validate.ts` 补"同 NPC 重复 enableAs"校验 | `skill.ts:795-809`、`validate.ts:159-172` | ★ **报告里唯一"现在已经活"的缺陷**（NPC 技能装载是活路径）。先造两技能同槽的 NPC def 实证静默出错 |

### 🟠 P1 — 一致性与正确性（无争议，或仅需一次拍板）

- **E1（需拍板）**：裁定 gj 公式（建议照 wushen：str 在百分比外，有 duel 锚点）⇒ **先补一个 `gj_per≠0` 会红的用例**再改。`formula.ts:196-198`
- **E8**：角色/NPC 容量缺省改成有限值（先定 10 还是 20）；**E9** `recount` 补 mp 钳制；**E5** busy 改赋值语义；**E6** 永不过期 busy 的自相矛盾；**E4/E7** 补实现或改注释二选一（**改注释必须用测试钉住**）
- **前端**：**F1/F2** 登录态竞争 + `login` 超时；**F3** 带退避的重连；**F4** `dialog` 四个控制字段；**F5** 表情面板要么能点、要么改注释
- **文档一次性订正**：**D1**（9→10）、**D6**（A1…A7 + 补 A7↔R7）、**D7**（四/五）、**D9**（未决范围）、**D4**（26↔18）；**F11** 伪依据注释改写

### 🟡 P2 — 结构性 / 闸门

- **G15 覆盖 `docs/NN` 形态**（把那 127 处纳入同判）—— 先确认 `docs/` 内部引用是否也想被扫
- **G5 / G12 / G13 补 DEAD-RULE GUARD**（照 `g15-docrefs.mjs:185` 写）
- **计数型断言上闸门**（或至少做一份"必须由脚本算"的清单），把 D1/D4 从人手维护里解放
- **T-B 三类幽灵路径补台账**（面板 emote/dialog、dialog 四字段、token/roleId）
- **D11 缺失层**：00 册链接 `newmud/README.md`、测试策略册、运维/发布册

### ⚪ 报告 §5 的 5 个拍板项（做 P0/P1 之前先定）

1. `gj` 公式照抄 wushen 还是立新口径？
2. T12 之前先做哪级防护（名唯一 ~30 行 / 直接开工 T12）？
3. 私自加戏清单（指令历史、Esc、A11y、`msg` 显示「你」）哪些保留并记进 26 册？
4. 缺失的层补不补？
5. `launcher.test.ts` 的 flake 放宽超时还是改掉 5s 依赖？

---

## 三、一句话

报告的**事实**几乎全对（我实测的每一条都成立），可以直接当工作清单用；**唯一要调整的是次序**：把它第一批里的 `gj` 公式往后放（需拍板），把 `N1`+`N2`+`N3`+`E2` 这四条真正"便宜又挡事"的提到最前。

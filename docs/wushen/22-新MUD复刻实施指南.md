# 22 · 新 MUD 复刻实施指南

> 目标：基于 wushen 的设计思路，从零写一个**结构更干净、但保留其精髓**的新 MUD。
> 本册给出：哪些照抄、哪些必须重写、分阶段路线、最小可玩集。

---

## 22.1 总体策略：三层分治

| 层 | wushen 的做法 | 建议 | 理由 |
|---|---|---|---|
| **通信与协议** | 手写 WS + 字符串拼包 + `dialog` 通用容器 | **思路照抄，实现重写** | `dialog`/`cmds` 抽象极好；字符串拼接必须换掉 |
| **引擎内核 `os/`** | 全局裸变量 + 半成品内核 + extends 补丁 | **重写** | 债务最重，无法单测，加载顺序敏感 |
| **内容层 `world/`** | 926 个脚本体文件 | **范式照抄，加薄封装** | 内容生产效率极高，是本项目最大价值 |
| **前端 `src/`** | jQuery + 模板字符串 + Dialog 注册表 | **思路照抄，组件层重写** | 23 个面板 6,673 行证明这套很省代码；但生命周期要统一 |

---

## 22.2 关键设计决策对照表

| 决策点 | wushen | 建议新项目 | 说明 |
|---|---|---|---|
| 模块系统 | 全局裸变量 | **ESM + 依赖注入容器** | 可单测、可 tree-shaking |
| 脚本加载 | `vm.compileFunction` + `func.apply` | **保留，但包一层 `defineRoom()` 等** | 兼容工具链与静态校验 |
| 继承 | 双机制（`util.inherits` + `__proto__` 篡改） | **只用标准 class / util.inherits** | 删除 `__proto__` 篡改 |
| 协议序列化 | 手工拼字符串 | **JSON + TypeScript 类型定义** | 可 schema 校验 |
| 协议版本 | 无 | **加 `v` 字段 + 客户端版本协商** | 便于灰度 |
| 传输 | 手写 RFC6455（不回 Pong） | **`ws` 库；裸 TCP 协议可保留给原生客户端** | 少写 300 行且正确 |
| 心跳 | 无 | **前端 30s ping + 指数退避重连** | 必做 |
| 鉴权 | Cookie 双凭证（含密码） | **随机 token + 服务端 session + 有效期** | 安全 |
| 索引 | `{}` 与数组 + 线性扫描 | **Map** | O(1) |
| 战斗驱动 | 每角色一条 setTimeout | **全局 tick（如 200ms）+ 战斗注册表** | 可调度/暂停/回放 |
| 任务 | 三层骨架，无进度容器 | **引擎提供 TaskInstance + 声明式条件/奖励** | 避免每个任务自己发明 |
| 存档 | 整块字符串 | **结构化（JSON 列 + 子表）** | 可查询、可修复 |
| 前端框架 | jQuery + 模板字符串 | **保留 jQuery 或换轻量框架（Petite Vue / Preact）** | MUD UI 简单，不必上重框架 |
| 前端组件 | 鸭子类型 Dialog | **DialogBase 接口 + 强制实现** | 统一生命周期 |
| 样式 | 3 份 CSS + 运行时注入 | **CSS 变量 + 构建期提取** | 可换主题 |
| 热更新 | `BASE.UPDATE` | **保留三段式（替换缓存 → 执行 → update 钩子）** | 好用，但补语法校验 |

---

## 22.3 分阶段路线

### 阶段 0：骨架（1-2 天）

```
newmud/
├── package.json          vite + express + ws + better-sqlite3
├── server/
│   ├── index.js          HTTP + WS 启动
│   ├── config.js         校验式配置
│   ├── net/              WS 封装（ws 库）
│   ├── protocol/
│   │   ├── types.ts      ★ 所有消息包的 TS 类型
│   │   └── send.ts       统一 send(user, pkg)
│   └── db/
├── src/                  前端（Vite）
│   ├── index.html
│   ├── main.ts
│   ├── net/client.ts     WS + 心跳 + 重连
│   └── process/          ★ 消息分发表（按 type 分文件）
└── world/                内容（define* 范式）
```

**验收**：`npm start` 能起服务，浏览器连上 WS 收到 `{type:"loginerror"}`。

### 阶段 1：通信闭环（2-3 天）

1. 实现 HTTP 登录/注册（Cookie token）
2. WS 首包鉴权
3. `Process[type]` 分发表 + 3 个包（`login` / `room` / `msg`）
4. 前端显示纯文本消息流

**验收**：登录 → 进入一个房间 → 看到房间描述 → 输入文字能看到回显。

### 阶段 2：世界与移动（3-5 天）

1. `ROOM`/`AREA`/出口表
2. `moveto` + `item_changed` 广播
3. `room`/`exits`/`items`/`itemadd`/`itemremove` 五个包
4. SVG 出口图

**验收**：能在 3-5 个房间之间走动，看到房间里的 NPC 和物品。

### 阶段 3：角色与物品（5-7 天）

1. `Character` 属性 + `recount()`（**公式集中到一处**）
2. `Item`/`Equipment`
3. 背包/装备面板（`dialog:pack`）
4. 存档与读档（结构化）

**验收**：能捡起物品、装备、下线再上线物品还在。

### 阶段 4：战斗（5-7 天）

1. 全局 tick 战斗调度器
2. 命中/招架/躲闪 + 递减减伤公式
3. `sc`/`combat`/`status`/`die` 包
4. 前端血条 + BUFF 图标 + CD 动画

**验收**：能 kill 一只怪，看到伤害数字和战斗播报，怪死后掉尸体。

### 阶段 5：技能与门派（5-7 天）

1. `Skill` + 三档属性 + `pfm` 绝招
2. `Family` + 门派 NPC 自动布置
3. `enable_skill` 装配
4. 学习/练习/升级

**验收**：能拜师、学技能、放绝招。

### 阶段 6：内容填充（持续）

按 `world/` 范式批量生产：房间 → NPC → 物品 → 技能 → 任务。

---

## 22.4 最小可玩集（MVP）

如果要尽快出一个"能玩"的版本，最小集合是：

| 模块 | 最小内容 |
|---|---|
| 房间 | 1 个区域 × 8 个房间（新手村） |
| NPC | 3 个（新手指导、杂货商、1 种怪） |
| 物品 | 5 个（1 武器、1 衣服、1 药、金币、掉落材料） |
| 技能 | 3 个（基本剑法、基本内功、基本轻功）+ 1 个绝招 |
| 指令 | 15 条（`go`/`look`/`get`/`drop`/`equip`/`unequip`/`use`/`kill`/`chat`/`who`/`i`/`cha`/`study`/`lianxi`/`dazuo`） |
| 前端面板 | 5 个（背包、属性、技能、地图、聊天） |

约 **2,000-3,000 行服务端 + 1,500 行前端** 即可跑通。

---

## 22.5 建议的新目录结构

```
newmud/
├── server/
│   ├── index.js               入口
│   ├── config.js              校验式配置
│   ├── net/ws-server.js       ws 库封装 + 心跳 + 限流
│   ├── auth/
│   │   ├── session.js         票据签发/校验
│   │   └── login.js           WS 首包鉴权流程
│   ├── protocol/
│   │   ├── messages.ts        ★ 全部包类型定义
│   │   ├── encode.ts          JSON 序列化
│   │   └── handlers/          按 type 分包（room.ts / combat.ts / ...）
│   ├── engine/                ★ 引擎（ESM，显式依赖）
│   │   ├── base.ts            BaseObject + id 生成 + temp
│   │   ├── item.ts
│   │   ├── character.ts
│   │   ├── room.ts
│   │   ├── combat/
│   │   │   ├── scheduler.ts   ★ 全局 tick 调度
│   │   │   └── damage.ts      伤害公式（集中一处）
│   │   ├── skill.ts
│   │   ├── task.ts            ★ TaskInstance + 声明式条件
│   │   └── registry.ts        ★ 所有全局索引（Map）
│   ├── world/                 内容加载器
│   │   ├── loader.ts          显式加载顺序清单
│   │   ├── define.ts          defineRoom/defineNpc/defineItem/...
│   │   └── validate.ts        ★ 静态校验（出口/NPC/物品引用）
│   ├── db/
│   │   ├── schema.sql
│   │   └── dao.ts
│   └── gm/                    ★ 独立进程 + 白名单命令
├── world/                     内容（define* 范式）
│   ├── extends/               ★ 补丁层（保留，加冲突检测）
│   ├── cmd/
│   ├── map/  npc/  obj/  skill/  family/  area/  task/
└── src/                       前端
    ├── index.html
    ├── main.ts
    ├── net/client.ts          WS + 心跳 + 重连 + 重放
    ├── process/               ★ 分发表（handlers/ + renderers/）
    ├── ui/
    │   ├── page.ts            Page 基类
    │   └── dialog/
    │       ├── base.ts        ★ DialogBase 接口（强制）
    │       └── pack.ts score.ts skills.ts ...
    ├── styles/
    │   ├── theme.css          ★ CSS 变量主题
    │   └── ...
    └── types/protocol.ts      ★ 与服务端共享的类型
```

---

## 22.6 必须一开始就做对的三件事

> 这三件事后期改造成本极高，务必在阶段 0-1 就定下来。

### 1. 协议类型化

用 TypeScript 定义所有消息包，**服务端与前端共享同一份类型文件**：

```ts
// shared/protocol.ts
export type ServerPacket =
  | { type: 'room'; path: string; name: string; desc: string; commands: CmdItem[] }
  | { type: 'exits'; items: Record<string, string> }
  | { type: 'sc'; id: string; hp?: number; max_hp?: number; mp?: number; max_mp?: number; damage?: number }
  | { type: 'dialog'; dialog: string; [k: string]: unknown }
  | { type: 'cmds'; items: { cmd: string; name: string }[] }
  | ...
```

收益：字段错配在**编译期**就暴露，而不是像 wushen 那样静默失效。

### 2. `dialog` 容器保留，但加类型守卫

`{type:"dialog", dialog:"<面板名>", ...}` 是本项目最好的设计。保留它，但用泛型约束：

```ts
type DialogPacket<T extends DialogName, D> = {
  type: 'dialog'; dialog: T;
} & D;
```

### 3. 内容层的 `define*` 封装 + 静态校验

```ts
defineRoom('yz/guangchang', {
  name: '中央广场',
  desc: '...',
  exits: { north: 'yz/beidajie1' },     // ← 可校验目标是否存在
  npcs: ['pub/xiaoer'],                  // ← 可校验 NPC path
  onEnter(me) { ... }
});
```

配套 `validate_world.js` 在 CI 跑：出口指向的房间存在、NPC/物品 path 有效、技能 `can_enables` 指向的基本技能存在。

---

## 22.7 可直接复用的"设计模式清单"

从 wushen 提炼，改个名字就能用：

| # | 模式 | 出处 | 一句话 |
|---:|---|---|---|
| 1 | **dialog 通用容器** | 第 06 册 6.5 | 一个包类型打通所有面板，新增面板协议层零改动 |
| 2 | **cmds 命令条** | 第 05 册 5.2.8 | 服务端下发 `{cmd,name}` 按钮组，前端不做表单逻辑 |
| 3 | **三视角文案** | 第 05 册 5.0 | `$N/$n/$P/$w/$l` 一次编写自动适配三种视角 |
| 4 | **房间即容器** | 第 10 册 10.1 | CHARACTER/ROOM 都继承 ITEM，共享 `item_changed` 广播 |
| 5 | **出口用 path 字符串** | 第 10 册 10.2 | 避免循环引用，便于热更新 |
| 6 | **投影房分流** | 第 10 册 10.4 | 房间满员自动克隆分流 |
| 7 | **递减减伤** | 第 11 册 11.3 | `sh = sh/(sh+fy)*sh` 一行解决防御堆到无敌 |
| 8 | **技能三档属性** | 第 12 册 12.1.2 | query_prop / query_enable_prop / query_addin_prop |
| 9 | **绝招（pfm）子对象** | 第 12 册 12.1.3 | 独立 distime/release_time/mp，战斗有节奏 |
| 10 | **`#` 变体参数** | 第 14 册 14.4 | 1 个文件派生 N 个对象（4 种丹药 / 11 个门派共用 NPC） |
| 11 | **extends 补丁层** | 第 15 册 15.1 | 内核稳定，游戏逻辑全部下放（需加冲突检测） |
| 12 | **热更新三段式** | 第 15 册 15.3 | 替换编译缓存 → 执行副作用 → 各类 update 钩子 |
| 13 | **ContainerCommand 全局委托** | 第 16 册 16.8 | 所有交互统一为 `cmd` 属性 |
| 14 | **自定义标签着色** | 第 18 册 18.3 | `<hig>` → CSS 元素选择器（需加白名单） |
| 15 | **顶号保留对象、替换 socket** | 第 04 册 4.4 | 断线重连无缝 |

---

## 22.8 验收清单（每个阶段结束时自检）

```
□ 所有消息包有类型定义，且服务端/前端共用
□ 协议解析用 JSON.parse，有 try-catch
□ 有心跳（ping/pong），前端有自动重连与退避
□ 会话票据不含密码、有有效期校验
□ 全局索引用 Map，无 O(n) 线性扫描
□ recount / 伤害公式只有一处定义
□ 内容层有静态校验脚本，并在 CI 跑
□ dialog 生命周期接口统一
□ 战斗由全局 tick 驱动，可暂停
□ 任务进度由引擎容器管理，非各任务自行实现
□ 存档结构化，可按字段查询
□ GM 命令是白名单，无 eval
□ 无死资源（未引用的字体/图片）
□ 加载阶段打印各阶段耗时与对象计数
```

---

## 22.9 工作量估算（供参考）

| 阶段 | 服务端 | 前端 | 内容 | 小计 |
|---|---:|---:|---:|---:|
| 0 骨架 | 400 | 200 | — | 600 |
| 1 通信闭环 | 600 | 500 | — | 1,100 |
| 2 世界与移动 | 900 | 600 | 300 | 1,800 |
| 3 角色与物品 | 1,200 | 900 | 400 | 2,500 |
| 4 战斗 | 1,400 | 700 | 300 | 2,400 |
| 5 技能门派 | 1,200 | 600 | 800 | 2,600 |
| **MVP 合计** | **5,700** | **3,500** | **1,800** | **11,000** |
| 6 内容填充 | — | — | 持续 | — |

对比 wushen：`os/` 9.7k + `src/` 11.3k + `world/` 39k ≈ 60k 行（含大量重复与债务）。
新项目用 **~11k 行**即可达到同样的可玩度，债务显著更少。

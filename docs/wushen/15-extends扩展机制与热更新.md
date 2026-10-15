# 15 · extends 扩展机制与热更新

> 范围：`world/extends/`（15 文件 / 1,999 行）+ `os/base.js:165-179` + `world/cmd/admin/update.js` + `os/util/hotload.js`（废弃）

---

## 15.1 extends 与 os 的关系（★ 本册核心）

**一句话**：`os/` 提供"类"，`world/extends/` 在加载期直接改写这些类的 `prototype` 或替换全局单例上的方法。**因为 `EXTENDS` 是 `loadResource()` 的第一个目录，它的修改会被后面所有内容文件继承。**

```
loadResource() 顺序：
  ① world/extends/   ← ★ 补丁层，最先加载
  ② world/cmd/
  ③ world/family/
  ④ world/obj/
  ⑤ world/area/
  ⑥ world/skill/
  ⑦ world/map/
  ⑧ world/task/
```

### 目录镜像关系

| `world/extends/` | 改写的目标 |
|---|---|
| `extends/char/user.js` | `USER.prototype.*` |
| `extends/char/combat.js` | `CHARACTER.prototype.*`（recount / do_attack / damage） |
| `extends/char/auto_combat.js` | `CHARACTER.prototype.*`（auto_attack / check_pfms） |
| `extends/item/obj.js` | `OBJ.prototype.*`（含 `format_to_pack` 序列化） |
| `extends/item/eq.js` | `EQUIPMENT.prototype.*` |
| `extends/map/area.js` | `AREA.prototype.*` |
| `extends/map/fam_area.js` | `FAMILY_AREA.prototype.*` |
| `extends/skill/skill.js` | `PERFORM.prototype.*` |
| `extends/skill/family.js` | `FAMILY.prototype.*`（`init()` 布置门派 NPC） |
| `extends/login.js` | `WORLD.USERLOGIN.*`（单例替换） |
| `extends/message.js` | `WORLD.MESSAGE.*`（站内信存储） |
| `extends/stats.js` | `WORLD.STATS.*` |
| `extends/data.js` | `WORLD.DATA.*`（常量表 + on_save/on_load） |
| `extends/world.js` | `WORLD.*`（生命周期钩子 `on_startup`/`close`） |
| `extends/update.js` | ❌ **0 字节空文件**，历史遗留占位 |

---

## 15.2 三种覆盖方式

### 方式 A：原型方法覆盖（最常见）

```js
// world/extends/char/user.js:2-32 —— 覆盖 recount（属性计算核心）
USER.prototype.recount = function () {
    this.max_hp = parseInt(this.con * 5 + ...);
    this.gjsd = 4000 - this.query_prop("gjsd");
    ...
}
```

> ⚠️ 同文件末尾还把玩家方法**借给随从**，一行扩展一个子系统：

```js
// world/extends/char/user.js:192-195
FOLLOWER.prototype.remove_obj      = USER.prototype.remove_obj;
FOLLOWER.prototype.recount         = USER.prototype.recount;
FOLLOWER.prototype.items_changed   = USER.prototype.items_changed;
FOLLOWER.prototype.send_commands   = USER.prototype.send_commands;
```

### 方式 B：给引擎补齐"抽象方法"

引擎基类只留空壳，实现全部下放：

```js
// world/extends/skill/family.js:1-12 —— 门派 NPC 自动布置
FAMILY.prototype.init = function () {
    for (let item of this.def_npcs) {
        let rm = ROOM.Get(item[1]);
        if (!rm) throw new Error('房间' + item[1] + "不存在");
        let npc = NPC.CLONE(item[0]);
        rm.items.push(npc); rm.max_item_count = 100; npc.environment = rm;
        if (npc.is(this.boss_path) && !this.boss) this.boss = npc;
    }
}

// world/extends/message.js:1-12 —— 站内信存储
MESSAGE.pushUserMessage = function (toid, from, msg) {
    let user = this.stores.get(toid);
    if (!user) { user = new Map(); this.stores.set(toid, user); }
    ...
}

// world/extends/world.js:1-11 —— 服务器生命周期钩子
WORLD.on_startup = function () {
    init_fams();                     // 遍历 FAMILIES 调 init()
    WORLD.COMMANDS.jh.init();
}
```

### 方式 C：数据常量表下放

```js
// world/extends/data.js:2-11
DATA.exps         = [15,20,30,40,50,100,200,80,90,100,110,120,130];
DATA.stone_values = [1000,5000,30000,150000,1000000,10000000];
DATA.book_values  = [1,1000,5000,10000,100000,500000,2000000];
DATA.get_exp = function (me) { return me.random(5) + this.exps[me.level]; }
```

同文件还接管全局存档：`DATA.on_save` / `DATA.on_load` / `DATA.create_def_tops`。

### 方式 D：协议序列化下放

```js
// world/extends/item/obj.js
OBJ.prototype.format_to_sell = function () {
    return `["${this.color_name}","${this.id}",${this.count},${this.grade},"${this.unit}",${this.value}]`;
}
OBJ.prototype.format_to_pack = function () { /* 13 元素数组 */ }
```

---

## 15.3 热更新：`BASE.UPDATE`（★ 生产在用的机制）

```js
// os/base.js:165-179
BASE.UPDATE = function (path, fname) {
    var ary = BASE.PATH_REG.exec(fname);
    fname = ary[1];
    var fkey = path + fname;
    var data = fs.readFileSync(fkey + ".js");
    var func = new Function(data);           // ① 重新编译
    BASE.ITEMS[fkey] = func;                 // ② 替换编译缓存 → 下次 CREATE 用新代码
    var obj = new BASE();
    func.apply(obj);                         // ③ 执行一次，触发副作用（重新打补丁）
    obj.path = fname;
    obj.update && obj.update(fname, ary[2]); // ④ 调用各类自己的 update 钩子
}
```

> ⚠️ `BASE.CREATE` 用 `vm.compileFunction`，`BASE.UPDATE` 用 `new Function` —— **两种编译方式不一致**（影响错误堆栈可读性）。

### 各基类的 `update()` 钩子（决定"热更新到什么程度"）

| 基类 | `update()` 行为 | 位置 |
|---|---|---|
| `COMMAND` | 重新 `WORLD.COMMANDS[别名] = this`（**新指令立刻生效**） | `os/command.js:32-41` |
| `ROOM` | `initBaseRoom` 重注册 `WORLD.ROOMS`；**迁移旧副本房/投影房里的玩家** | `os/room/room.js:432-467` |
| `AREA` | 按 path 替换 `WORLD.AREAS[i]`，**保留 `rooms`** 并重指向 `room.parent`；重挂 `FAMILIES[family].area` | `os/room/area.js:101-121` |
| `CHARACTER`/`NPC` | 直接 `create()` → 覆盖 `WORLD.NPC_STROE` | `os/char/character.js:230` |
| `OBJ`/`EQUIPMENT` | 覆盖 `WORLD.OBJ_STROE` | `os/item/obj.js:180` |
| `SKILL` | 覆盖 `WORLD.SKILLS` + 重排 FAMILY 的 skills 数组 + 重设 pfm 原型 | `os/skill/skill.js:433` |
| `TASK` | `stop()` 旧任务 → 替换 → `startup(old)` | `os/task/task.js:18-30` |
| `USERTASK` | 在 `WORLD.TASKS` 中按 path 就地替换 | `os/task/playertask.js:12-21` |
| `FAMILY` | 覆盖 `FAMILIES[id]` | `os/skill/family.js:22` |

---

## 15.4 `update` 指令完整链路

```
① 客户端：SendCommand("update cmd/admin/test")
   src/client.js:68 → GameClient.Send("update cmd/admin/test")

② 服务端收包 → os/world.js:75 WORLD.request → user.command

③ 切分：os/char/character.js:136
   cmd = "update", pars = "cmd/admin/test"

④ 查表 + 门禁：character.js:156-179
   cmd = WORLD.COMMANDS["update"]
   check_command(cmd)          // allow_level = 6，低于则 "什么？"
   cmd.enter(cmd, [me, "cmd/admin/test"])

⑤ 指令体：world/cmd/admin/update.js:16-23
   var path  = __PATH.WORLD + "cmd/";
   var fname = "admin/test";
   BASE.UPDATE(path, fname);

⑥ 引擎：os/base.js:165
   readFileSync → new Function → BASE.ITEMS[fkey] 覆盖 → func.apply(obj) → obj.update()

⑦ 生效：os/command.js:32
   COMMAND.prototype.update → WORLD.COMMANDS["test"] = 新对象
```

### 三种特殊路径

| 命令 | 处理 | 代码 |
|---|---|---|
| `update npc/yz/zhangsanfeng` | `update_npc()`：先 `BASE.UPDATE`，再**销毁场上旧 NPC 并 `NPC.CREATE` 重建**，最后清掉 `WORLD.NPC_STROE` 里所有 `path#` 派生缓存 | `cmd/admin/update.js:33-51` |
| `update obj/drug/yao` | `update_obj()`：清掉 `WORLD.OBJ_STROE` 里该 path 的所有 `#` 变体缓存 | 同上 |
| `update room` / `update map/yz/guangchang` | `update_room()`：重建副本房并搬运玩家 | 同上 |

> ⚠️ 因为 **NPC 是懒加载且实例用 `Object.create(原型)` 克隆**，热更新替换的是"模板原型"。已存在的实例仍持有旧原型的方法引用（`Object.create` 时已固化）。所以 `update_npc` 必须显式销毁 + 重建场上实例。

---

## 15.5 `os/util/hotload.js` —— ❌ 废弃的并行实现

492 行，基于 `module.exports` 的独立热加载引擎，仅被 `api/gm.js:484` 调用。

```js
// os/util/hotload.js:37-66
const sandbox = { require, console, module:{exports:{}}, exports:{}, ..., WORLD, CHARACTER, ... };
const script = new vm.Script(code, { filename: fullPath });
script.runInContext(vm.createContext(sandbox));
const exports = sandbox.module.exports || sandbox.exports;   // ★ 恒为 {}
const result = this.processHotload(type, exports, fullPath);
```

### 三个致命问题

| # | 问题 | 后果 |
|---|---|---|
| 1 | **`world/` 下 926 文件无一个用 `module.exports`**，所以 `exports` 恒为 `{}`；而 `{}` 是 truthy，不会走 `if (!exports) return` 分支 | `WORLD.COMMANDS[name] = {}` —— **把正常指令覆盖成空对象**，数据破坏级 |
| 2 | `WORLD.OBJ_STORE` / `NPC_STORE` 拼写错误（`:184/185/306/307`），实际字段是 `OBJ_STROE`/`NPC_STROE` | 抛 TypeError，被 catch 吞掉 |
| 3 | `let updatedCount` 声明在 `if` 块内（`:151`），块外 `:171` 使用 | ReferenceError |

其他小问题：`startWatching` 的 `isWatching` 是全局单例互斥（只能起一个 watcher）；`fs.watch` 递归 + `path.join` 在子目录变更时路径会错。

**结论：正式热更新请走游戏内 `update <路径>` 指令。`/gm/hotload` 接口属于风险点。**

---

## 15.6 完整热更新指令清单

```
update <类型>/<路径>        通用热更新
  例：update cmd/admin/test
      update npc/yz/zhangsanfeng
      update obj/drug/yao
      update map/yz/guangchang
      update skill/wudang/taijijian
      update family/wudang
      update task/sm_task
update room                 更新所有房间
update npc                  更新所有 NPC
```

---

## 15.7 复刻建议

1. ✅ **"extends 补丁层"这个思路本身值得抄**：内核保持稳定、可升级，游戏特定逻辑全部下放到补丁层，是"引擎 vs 游戏"分离的一种轻量实现。但要注意：
   - 补丁之间会冲突（当前 `recount` 在两处被覆盖且公式不同）→ 建议**一个方法只能有一个补丁来源**，用注册时检测
2. ✅ **`BASE.UPDATE` 的"替换编译缓存 + 执行副作用 + 各类 update 钩子"三段式**值得抄。特别是"各类自己实现 `update()` 决定迁移什么"，比统一强制迁移灵活。
3. ❌ **不要抄 `new Function`**：改回 `vm.compileFunction` 与 `CREATE` 保持一致，否则错误堆栈指向 `<anonymous>`。
4. ❌ **不要抄 `hotload.js`**：若要做文件监听自动热更新，应该复用 `BASE.UPDATE` 而不是另起炉灶。
5. ⚠️ **热更新的最大陷阱是"已存在实例"**：`Object.create(原型)` 的克隆实例不会自动获得新原型方法。建议：
   - 方案 A（当前做法）：显式销毁重建
   - 方案 B（更好）：实例只存数据，方法全部走原型链查找 + 版本号检查
6. ⚠️ 建议增加**更新前语法校验**：当前 `new Function(data)` 若文件有语法错误会直接抛异常到指令里（有 try-catch，但会留下半更新状态）。

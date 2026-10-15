# 07 · 引擎对象模型与基类 BASE

> 范围：`os/base.js`（179 行）+ `os/util/util.js`（406 行）+ `os/util/hotload.js`（492 行，废弃）
> 本册回答：926 个内容文件是如何变成 926 个游戏对象的。

---

## 7.1 三个必须先知道的全局约定

| 约定 | 说明 | 证据 |
|---|---|---|
| **全部是全局裸变量** | `BASE`/`ITEM`/`CHARACTER`/`USER`/`NPC`/`ROOM`/`OBJ`/`SKILL`/`WORLD`/`UTIL`/`FAMILIES` 都挂在 `globalThis` 上，**无 `module.exports`、无 `import`** | `os/base.js:9 BASE = function(){}` |
| **加载分两段** | ① `os/` 用 `require()`（`main.js:42`）；② `world/` 用 `vm.compileFunction` 编译后 `func.apply(obj)` | `os/base.js:129-153` |
| **`os/` 是半成品内核** | 大量方法只声明不实现，真实逻辑在 `world/extends/` | readme 原文："尽量不要管 os/ 目录下的文件" |

---

## 7.2 类层次

```
BASE (os/base.js:9)                        ← 唯一根类，兼静态工厂容器
 │
 ├─ COMMAND (os/command.js:7)              ← 指令（不继承 ITEM）
 │
 └─ ITEM (os/item.js:2)                    ← ★ 容器语义：items[] / environment / actions{}
     ├─ OBJ (os/item/obj.js:2)                 基础物件（可堆叠）
     │   ├─ EQUIPMENT (os/item/equipment.js:3)   is_equipment
     │   ├─ CONTAINER (os/item/container.js:2)   is_container
     │   │   └─ CORPSE (os/item/corpse.js:2)     尸体
     │   └─ MONEY (os/item/money.js:2)           is_money
     ├─ CHARACTER (os/char/character.js:3) ← ★ 角色继承自"物品"
     │   ├─ USER      (os/char/user.js:2)       is_player = true
     │   ├─ NPC       (os/char/npc.js:2)
     │   ├─ MONSTER   (os/char/monster.js:4)    can_speek=false
     │   └─ FOLLOWER  (os/char/follower.js:3)   随从
     ├─ ROOM (os/room/room.js:2)           ← 房间也是容器
     └─ AREA (os/room/area.js) → FAMILY_AREA (os/room/fam_area.js)

SKILL  (os/skill/skill.js)  ← 直接继承 BASE
FAMILY (os/skill/family.js) ← 直接继承 BASE
TASK   (os/task/task.js) / USERTASK (os/task/playertask.js) ← BASE
```

> ★ **架构要点**：`CHARACTER.inherits(ITEM)`（`character.js:10`）。"角色"本质是"能放进房间的物品"，于是 `environment` + `items` + `add_action/exec` 全部复用同一套 `item_changed` 逻辑。这让"玩家在房间里"和"剑在地上"走完全相同的代码路径。
> 同理 `ROOM.inherits(ITEM)`（`room.js:8`），房间就是一个容量 50 的容器。

---

## 7.3 继承：两套机制并存（★ 最大的设计债）

### 机制 A：`Function.prototype.inherits`（类与类之间，标准原型继承）

```js
// os/util/util.js:6-9
Function.prototype.inherits = function (superCtor) {
    util.inherits(this, superCtor);       // Node 内置 util.inherits
}
```

用于：`CHARACTER.inherits(ITEM)`、`NPC.inherits(CHARACTER)`、`EQUIPMENT.inherits(OBJ)`、`ROOM.inherits(ITEM)`。

只继承 prototype，**不调用父构造器**，所以每个类都有自己的 `function X(){...}` 初始化实例字段。

### 机制 B：`BASE.prototype.inherits`（实例级 `__proto__` 篡改）

```js
// os/base.js:27-30
BASE.prototype.inherits = function (ctor) {
    this.__proto__ = ctor.prototype;      // ★ 整体替换原型
    ctor.apply(this);                     // 补跑一次父构造器拿实例属性
}
```

用于**内容脚本文件体内部**：`this.inherits(ROOM)`、`this.inherits(COMMAND)`、`this.inherits(SKILL)`。

源码注释自己承认的坑（`base.js:19-26`）：

> "该方法使用直接赋值方式继承父对象的所有原型方法，如果子对象对原型修改，将会改变父对象的原型。所以该方法只能获取父对象的原型不能修改它"

且 `ctor.apply(this)` **只跑一次父构造器，不跑祖父构造器**，所以链式必须手写完整。

### 机制 C：`Object.create` 原型委托（模板 → 实例）

大量使用"模板克隆"而非深拷贝：

| 场景 | 代码 | 行为 |
|---|---|---|
| NPC 生成 | `os/char/npc.js:213-218 NPC.CLONE` | `let item = Object.create(base); item.clone();` |
| 物品生成 | `os/item/obj.js:153-169 OBJ.CREATE` | `Object.create(base)` → `create_id()` → `on_clone()` |

**收益**：1000 只同名怪共享一份原型，改原型即全改。
**代价**：`CHARACTER.prototype.clone`（`character.js:235-264`）必须显式重建 `temp`/`prop`/`equipment`/`items` 这些**可变引用字段**，否则两只怪共用同一份 `prop`（`add_prop` 会互相污染）。

---

## 7.4 工厂函数（从文件造对象）

### 7.4.1 唯一入口 `BASE.CREATE`

```js
// os/base.js:129-153
BASE.CREATE = function (path, fname) {
    var ary = BASE.PATH_REG.exec(fname);   // /^(\w+(?:\/\w+)*)(#\w+)?$/
    fname = ary[1];                        // "obj/drug/yao"
    var paras = ary[2];                    // "#2" 变体参数
    var fkey = path + fname;
    var func = BASE.ITEMS[fkey];           // ★ 编译结果缓存
    if (func) return BASE.NEW(fname, func, paras);
    const script = fs.readFileSync(fkey + ".js");
    func = vm.compileFunction(script.toString(), [], { filename: fkey + ".js" });
    BASE.ITEMS[fkey] = func;
    return BASE.NEW(fname, func, paras);
}

BASE.NEW = function (fname, func, par) {
    var obj = new BASE();
    func.apply(obj);                       // ★ 文件体在这里执行，this === obj
    obj.path = fname;
    obj.create(fname, par);                // ★ 各子类的注册钩子
    return obj;
}
```

**关键点**：
- 文件体相当于**构造器体**，`this` 指向新 `BASE` 实例
- `obj.create(fname, par)` 是各基类的"注册钩子"：`COMMAND.create` 写 `WORLD.COMMANDS`，`ROOM.initBaseRoom` 写 `WORLD.ROOMS`，`CHARACTER.create` 写 `WORLD.NPC_STROE`
- `BASE.ITEMS[fkey]` 缓存编译结果 —— **这就是热更新要替换的东西**

### 7.4.2 二级工厂与全局索引

| 工厂 | 位置 | 索引容器 | 注册点 |
|---|---|---|---|
| `OBJ.CREATE(otype, count)` | `os/item/obj.js:153` | `WORLD.OBJ_STROE: Map` | `obj.js:178` |
| `NPC.CLONE(path)` / `NPC.GET(path)` | `os/char/npc.js:213/219` | `WORLD.NPC_STROE: Map` | `character.js:228` |
| `ROOM.Get(path)` | `os/room/room.js:610` | `WORLD.ROOMS: {}` | `room.js:408` |
| `SKILL.get(id)` | `os/skill/skill.js:480` | `WORLD.SKILLS: {}` | `skill.js:434` |
| `NPC.CREATE(path, env, oncreate, count)` | `os/char/npc.js:199` | 直接塞进房间 | — |

> ⚠️ `WORLD.OBJ_STROE` / `NPC_STROE` 是 **STROE**（拼写错误，应为 STORE），已被大量代码依赖（`os/world.js:15/16`）。`os/util/hotload.js` 里却写成 `OBJ_STORE`/`NPC_STORE`，导致热更新必崩（见第 21 册第 1 条）。

### 7.4.3 `#` 变体参数

`BASE.PATH_REG = /^(\w+(?:\/\w+)*)(#\w+)?$/`，`#` 后的部分作为 `par` 传给 `on_create`：

```js
// world/obj/drug/yao.js
this.on_create = function (path, par) {
    var lv = par ? parseInt(par.substr(1)) : 0;
    this.drug_type = lv;
    this.name = ["再生","暴虐","龟灵","培元"][lv] + this.name;
}
// → drug/yao#0 ~ #3 四种丹药，共用一个文件
```

其他用法：`pub/mpguanli#WUDANG`（门派专属 NPC）、`book/bc#taijijian`（指定技能的秘籍残页）、`sp/box#lv`（按等级生成的宝箱）。

---

## 7.5 id 体系（两套并存）

| 体系 | 生成 | 格式 | 用途 |
|---|---|---|---|
| `uid`（模板期） | `base.js:91-99 create_uid` | `Date.now().toString(36)` + 4 位随机 | 由 `ITEM.create`（`item.js:204`）赋值，**业务中几乎没用** |
| `id`（实例期） | `item.js:170 create_id` → `util/util.js:285` | 4 位随机 base34 + `(Date.now()-1490276099978)/1000` 转 16 进制 | **运行时唯一 id**，客户端 `get <id>` 用它 |

反解创建时间：`ITEM.query_create_time`（`item.js:180-186`）。

> ⚠️ 只有 4 位随机前缀（34⁴ ≈ 133 万种），同秒碰撞概率不低；`find_obj_byid` 是线性扫描（`item.js:188`）。

---

## 7.6 BASE 通用能力

| 方法 | 位置 | 说明 |
|---|---|---|
| `set(pars)` | `base.js:13` | 浅拷贝赋值 |
| `random(num)` | `base.js:100` | `Math.floor(Math.random()*num)` |
| `call_out(func, time, a1, a2)` | `base.js:103` | `setTimeout(func.bind(this,a1,a2), time)` —— **战斗/BUFF/状态机的定时器底座** |
| `call_interval(func, time, count, end)` | `base.js:106` | setInterval 封装，func 返回 false 即停 |
| `add_event/remove_event/fire_event` | `base.js:37/52/68` | AOP 钩子机制。⚠️ `fire_event` 里 `if (evts[i].time > dt)` 语义与注释相反（`base.js:74`），调用点极少 |
| `BASE.UPDATE(path, fname)` | `base.js:165` | 热更新入口（第 15 册） |
| `BASE.CLONE` | `base.js:154` | ❌ 空函数，死代码 |

---

## 7.7 全局工具 `UTIL`（os/util/util.js，406 行）

| 类别 | 成员 | 行 |
|---|---|---|
| 原型扩展 | `Function.prototype.inherits` | `:6` |
| | `Array.prototype.remove/contain/random` | `:10/18/26` |
| | `JSON.toObject`（= `JSON5.parse`） | `:30` |
| 数值 | `moneyToStr(value)`（10000 金 / 100 银 / 铜板） | `:49` |
| | `to_c(num)` 数字转中文 | `:85` |
| | `create_id()` | `:285` |
| | `wrandom(me,max,rate)` 按 id 稳定的伪随机 | `:43` |
| 时间 | `timeSpan` / `diff_time`(明天5点) / `diff_week_time` / `diff_month_time` | `:65/225/235/248` |
| 属性渲染 | `prop_toString(prop, sp, count)` ★ `PROPERTIES` 的主要消费者 | `:119` |
| 命名 | `random_name(s,t)` + `name0~3` 字库 | `:293/318` |
| 农历 | `getLunar(date)`（1900-2050） | `:325` |
| 其他 | `htmlEncode` / `log` / `saveLog` | `:114/264` |

---

## 7.8 `os/util/hotload.js`（492 行）—— ❌ 废弃实现

后加的、基于 `module.exports` 的并行热加载引擎，仅被 `api/gm.js:484` 调用。三个致命问题：

1. **`world/` 下 926 个文件无一个使用 `module.exports`**，所以 `sandbox.module.exports` 恒为 `{}`；`processHotload` 收到空对象后会把 `WORLD.COMMANDS[name]` / `WORLD.SKILLS[name]` **覆盖成空对象** —— 数据破坏级
2. **`WORLD.OBJ_STORE` / `NPC_STORE` 拼写错误**（`:184/185/306/307`），实际字段是 `OBJ_STROE`/`NPC_STROE` → 必抛 TypeError
3. **`reloadSkill` 作用域 bug**：`let updatedCount` 声明在块内（`:151`），块外使用（`:171`）→ ReferenceError

**结论：生产上真正使用的是 `BASE.UPDATE`（游戏内 `update <路径>` 指令）**，见第 15 册。

---

## 7.9 复刻建议

| 项 | 建议 |
|---|---|
| 全局裸变量 | ❌ 改为 ESM + 显式依赖注入，否则无法单测 |
| `vm.compileFunction` 脚本体 | ✅ 内容层保留（写内容的人爽），但建议封装成 `define({ inherits: ROOM, ... })` 便于静态分析 |
| 双继承机制 | ❌ 只保留标准的 `util.inherits`，删掉 `__proto__` 篡改 |
| `Object.create` 模板克隆 | ✅ 保留，但要**显式声明哪些字段需要深拷贝**（写一个 `CLONE_FIELDS` 清单） |
| `#` 变体参数 | ✅ 保留，很实用 |
| id 生成 | ❌ 4 位随机太短，改用 `crypto.randomUUID()` 或雪花算法 |
| 索引容器 | ❌ `OBJ_STROE` 改名 `OBJ_STORE`；`WORLD.USERS` 由数组改 Map（当前 `getUser` 是 O(n) 线性扫描） |

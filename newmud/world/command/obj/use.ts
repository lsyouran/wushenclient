import { defineCommand, findTarget } from '@engine/world/define.js';

/**
 * `use` —— 使用身上的一件东西。
 *
 * 对照 wushen `world/cmd/obj/use.js`。路径与 id 的关系（G5）：文件在
 * `world/command/obj/use.ts` → id 必须是 `obj/use`（`item` 是保留 id 段，见 `get.ts` 头注）。
 *
 * ★★ **"能不能用"的判据是"有没有 `on_use`"，不是另立一个布尔开关**
 *   （wushen `use.js:34` 的 `if (!obj.on_use) return player.notify("这个东西不能用。")`）。
 *   于是内容层只要写 `on_use`，`use` 就自动认得它 —— 不需要在任何地方登记
 *   "哪些东西可以用"。`world/item/drug/yao.ts` 写了 `on_use`，本指令就是它
 *   一直缺的那个调用点。
 *
 * ★ **闸门照抄 wushen `use.js:3-5`**：忙碌 / 灵魂状态 / 昏迷下**都可以用**
 *   （`allow_busy` / `allow_die` / `allow_faint` 三条）。
 *   `allow_state`（打坐等）wushen **没给**，所以打坐时用不了 —— 一并照抄。
 *
 * ★ **没做的部分**（都缺前提，不是漏移植，写下来免得被当成"已经有了"）：
 *   1. **装备快捷操作**（`use.js:12-31` 的 `obj.is_shortcut` / 装备槽分支）——
 *      装备系统未落地，`equipType` 在 `Item` 上只是一个只读标记（`isEquipment`），
 *      没有任何东西会把它装到人身上。
 *   2. **使用冷却**（`use.js:43-46` / `:64` 的 `distime` + `set_temp(key,…)`）——
 *      要往角色的 `TempStore` 写键，而 `CommandActor` **不暴露 temp 写入**
 *      （那是并发与生命周期有讲究的能力，不该顺手开给内容层）。
 *      属"道具冷却"专项批次。
 *   3. **擂台自动出招**（`use.js:32`）与**按 grade / path 的特判**（`:47-55`）——
 *      前者要擂台，后者是 wushen 给具体几个物品开的后门，本项目的内容层
 *      有能力自己写进 `on_use`，不需要在引擎里为个别 id 开分支。
 *   4. **"装备着的东西要 `equip` 过才能用"**（`use.js:22`）—— 同 ①。
 */
export const USE_MESSAGES = {
  /** wushen `use.js:18`（`player.find_obj` 找不到） */
  notFound: '你身上没有这个东西。',
  /** wushen `use.js:34`（`!obj.on_use`） */
  noHook: '这个东西不能用。',
} as const;

defineCommand('obj/use', {
  command: 'use',
  // wushen `use.js:3-5`：用东西不该被"忙 / 灵魂状态 / 昏迷"挡住
  allow_busy: true,
  allow_die: true,
  allow_faint: true,
  // wushen 的 `this.regex = /^(\w+)(?:\s(\w+))?$/` —— 第二个捕获组是 `par`
  // （给 `on_use(player, par)` 用的额外参数，如 `use jian 太极`）。`\w` 不含中文，
  // 同 `give.ts` 的理由放宽成 `\S`。
  regex: /^(\S+)(?:\s+(\S+))?$/,

  run: (me, rawKey, par) => {
    const key = (rawKey ?? '').trim();
    // 只在自己身上找 —— 第二个实参传 `null`：`findTarget` 的查找池这时只剩
    // `me.items`（同 `drop.ts` / `give.ts`）。wushen `use.js:8` 也是 `player.find_obj`。
    const item = key === '' ? undefined : findTarget(me, null, key);
    if (item === undefined || item.kind !== 'item') {
      me.notify(USE_MESSAGES.notFound);
      return;
    }

    const onUse = item.interact?.onUse;
    if (onUse === undefined) {
      me.notify(USE_MESSAGES.noHook);
      return;
    }

    // `on_use` 返回 false = "这次不用了"，且**不给提示**（wushen `use.js:57`
    // 的 `if (obj.on_use(player, par) === false) return;` —— 静默）。
    // 要拒绝并说明理由，内容层自己在钩子里 `notify`。
    if (onUse(me, par) === false) return;

    // 消耗 1 个（`no_consume` 的东西不消耗，wushen `use.js:59`）。
    // ★ 这一步在这里**结构上必成功**：物品刚由 `findTarget` 从 `me.items` 命中，
    //   而 `Item.count` 恒 ≥ 1（归零即销毁）。所以不判返回值 —— 判了也没有
    //   第二条可走的路（真失败了是容器与数量不一致，属数据损坏，不该被吞成一句提示）。
    if (item.interact?.noConsume !== true) me.spendItem(item, 1);
  },
});

import { defineCommand, findTarget } from '@engine/world/define.js';

/**
 * `drop` —— 把**自己身上**的一件东西丢到所在的房间。
 *
 * 对照 wushen `world/cmd/obj/drop.js`。路径与 id 的关系（G5）：文件在
 * `world/command/obj/drop.ts` → id 必须是 `obj/drop`（`item` 是保留 id 段，见 `get.ts` 头注）。
 *
 * ★★ **本批「丢」= 整叠丢**（与 wushen 的 `drop <个数> <东西>` 是**有意偏离**）。
 *   理由是**结构性的**，不是省事：把 N 个中的 M 个放到房间，需要一个**真实存在**的
 *   新对象来承载那 M 个 —— 也就是要铸一个新 oid，而 oid 空间只在会话层/实例化期可达
 *   （`CommandActor` 上没有）。同款的约束也决定了 `get` 只能整叠搬（见 `get.ts` 头注）。
 *
 *   ★ 注意这与 `give` / `use` 不同：那两条**只从给出方扣减**（物品并没有真的换容器），
 *     "扣 N 个"不产生新对象、不需要新 oid —— 所以它们的个数参数是**支持的**。
 *     见 `defs.ts#CommandActor.spendItem` 的注释。
 *
 * ★ 与 wushen 的另一处差异：**没有"数量为 0 的幽灵物品"这条分支**。
 *   wushen `drop.js:21-32` 里 `else` 那半段处理的是 `count === 0` 的物品
 *   （`player.items` 里留着一个 count 归零的壳），本项目**构造上不可能**有这种东西：
 *   `Item` 的注释写着"恒 ≥ 1 —— 归零即应当被销毁"，而 `spendItem` 在归零时确实销毁它。
 *   ⇒ 那个分支在这里没有可命中的输入（26 册 FG-19）。
 */
export const DROP_MESSAGES = {
  /** wushen `drop.js:7`（`player.find_obj` 找不到） */
  what: '你要丢掉什么东西？',
  /** wushen `drop.js:13`（`obj.no_drop`） */
  noDrop: '这个东西丢不掉。',
  /** wushen 靠 `add_recover_obj` 内部静默失败；本项目给一句可读的（房间容量 50） */
  roomFull: '这里东西太多了。',
} as const;

/** 丢下的房间播报（wushen `drop.js:35`），`$n` = 被丢掉的东西 */
export const DROP_BROADCAST = '$N丢掉$n。';

defineCommand('obj/drop', {
  command: 'drop',

  run: (me, rawKey) => {
    const key = (rawKey ?? '').trim();
    if (key === '') {
      me.notify(DROP_MESSAGES.what);
      return;
    }

    // ★ 只在自己身上找（wushen `drop.js:5` 是 `player.find_obj(objid)` ——
    //   它翻的就是 `player.items`）。第二个实参传 `null` 是有意的：
    //   `findTarget` 在 `env === null` 时的查找池**只剩 `me.items`**，
    //   于是"只能丢身上的东西"这条不需要另写一遍匹配逻辑。
    const hit = findTarget(me, null, key);
    if (hit === undefined || hit.kind !== 'item') {
      me.notify(DROP_MESSAGES.what);
      return;
    }

    if (hit.interact?.noDrop === true) {
      me.notify(DROP_MESSAGES.noDrop);
      return;
    }

    if (!me.dropItem(hit)) {
      me.notify(DROP_MESSAGES.roomFull);
      return;
    }
    me.sendRoom(DROP_BROADCAST, hit);
  },
});

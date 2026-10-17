import { defineCommand, findTarget } from '@engine/world/define.js';
import { neutralizePlayerText } from '@shared/player-text.js';

/**
 * `get` —— 捡起**房间里**的一件东西，收进自己身上。
 *
 * 对照 wushen `world/cmd/obj/get.js`（B 批第一条物品指令）。路径与 id 的关系
 * （G5 闸门校验）：文件在 `world/command/obj/get.ts`，相对 `world/command/`
 * 的路径是 `obj/get`，所以 id 必须是 `obj/get`。
 * ★ `obj/` 而非 `item/`：`item` 是保留的 world id 段（见 `shared/ids.ts`
 *   `RESERVED_AREAS`），拿它当内容目录会让 `parseWorldId` 返 null。
 *
 * ★★ **本批只做 `get <东西>`**，wushen 的另外三种形态**有意没做**（都是缺前提，
 *   不是漏移植 —— 写下来免得被当成"已经有了"）：
 *   1. **`get <个数> <东西>`（拆分）** —— 从一叠里只拿 N 个要**铸一个新 oid**，
 *      而 oid 空间（`OidSpace`）只在**会话层**（`session.ts`）与实例化期可达，
 *      指令拿到的 `CommandActor` 上没有它。⇒ 本批**整叠搬运**：地上有几枚就拿几枚。
 *      （wushen 的 `get.js:27-31` 那两行其实也是"整叠"—— `var get_count = obj.count;`
 *      之后才 `if (obj.count < get_count)`，那个判据**恒为假**，见下。）
 *   2. **`get <东西> from <容器>`** —— 尸体 / 箱子（`CORPSE` / `CONTAINER`）未落地，
 *      没有任何东西能当那个"<容器>"。房间本身不是这条语法要的容器。
 *   3. **`get all from <容器>`** —— 同 ②。（wushen 的裸 `get all` 也走不通：
 *      它落进第一条分支去找一个名叫 `all` 的东西，然后报"你要捡起什么东西？"。）
 *
 * ★ wushen 的 `if (obj.count < get_count)` **恒为假**（`get_count` 就是 `obj.count`）
 *   —— 于是「这里没有那么多的X。」那句**永远不会出现**。本项目不抄这个死判据
 *   （26 册 FG-19：注释 / 代码宣称一个不可能发生的情况）。
 *
 * ★ 失败原因**逐条对应一句话**（wushen 各处 `notify`），不是笼统一句"捡不了"：
 *   没给参数 / 地上没有 / 那是活人 / 钉在地上（`no_get`）/ 背包满了。
 */
export const GET_MESSAGES = {
  /** wushen `get.js:5` —— 没给参数 */
  what: '你要捡什么东西？',
  /** wushen `get.js:25` —— 给了名字，地上没这号东西 */
  notFound: '你要捡起什么东西？',
  /** wushen `get.js:36`（`obj.no_get`） */
  noGet: '这个东西你捡不起来。',
  /** wushen `get.js:41`（`player.is_full()`） */
  full: '你身上东西太多了。',
  /**
   * wushen `get.js:33`（`obj.is_living()`）——「X不用你背。」
   *
   * ★ 本项目用 `kind` 判"是不是活人"（只有 `npc` / `player` 是角色），
   *   而 wushen 用的是 `obj.is_living()` = `hp > 0`。差别的实际后果是：
   *   wushen 里一具 `hp <= 0` 的"尸体"是可以捡的（它已经不是活体），
   *   而本项目还没有尸体这种东西。等尸体落地，这条判据要跟着改。
   */
  living: (name: string): string => `${name}不用你背。`,
} as const;

/** 拾到的房间播报（wushen `get.js:50`），`$n` = 被捡起的东西 */
export const GET_PICKUP_BROADCAST = '$N捡起$n。';

defineCommand('obj/get', {
  command: 'get',

  run: (me, rawKey) => {
    const key = (rawKey ?? '').trim();
    if (key === '') {
      me.notify(GET_MESSAGES.what);
      return;
    }
    const env = me.environment;
    if (env === null) {
      // 防御分支：不在任何容器里（wushen `get.js:6` 直接 `player.environment.find_obj`
      // 会当场 TypeError）。游戏内构造上不可达，这里给一句可读的。
      me.notify(GET_MESSAGES.what);
      return;
    }

    // ★ 只认**房间里**的东西（wushen `get.js:23` 是 `parent.find_obj(objid)`，
    //   `parent` 就是 `player.environment`）。
    //   而 `findTarget` 的查找池是「环境 → 我身上」，所以它**顺带会翻我的背包** ——
    //   于是这里必须再确认命中的那个确实在环境里，否则「捡」会退化成一次空操作
    //   （在自己身上的东西自然`takeItem` 成功）。
    const hit = findTarget(me, env, key);
    if (hit === undefined || !env.items.includes(hit)) {
      me.notify(GET_MESSAGES.notFound);
      return;
    }

    // 活人不用你背（wushen `get.js:32`）。见 `GET_MESSAGES.living` 上方的差异说明。
    if (hit.kind !== 'item') {
      me.notify(GET_MESSAGES.living(neutralizePlayerText(hit.name)));
      return;
    }

    const face = hit.interact;
    if (face?.noGet === true) {
      me.notify(GET_MESSAGES.noGet);
      return;
    }
    // `on_get` 返回 false = "这次别捡"，且**不给任何提示**（wushen 同款：
    // `if (obj.on_get && obj.on_get(player) === false) return;` —— 是静默的）。
    // 内容层要提示就自己在钩子里 notify。
    if (face?.onGet?.(me) === false) return;

    if (!me.takeItem(hit)) {
      me.notify(GET_MESSAGES.full);
      return;
    }
    // 播报（wushen `get.js:50`）。★ 用 `$n` 把东西的名字交给 `renderViewText`：
    //   它**按收件人视角渲染**（本人读到「你捡起…」），并且**会把名字里的 `<` 中和**
    //   （`shared/player-text.ts` 那条出口约定），不必在这里手工拼一遍。
    me.sendRoom(GET_PICKUP_BROADCAST, hit);
  },
});

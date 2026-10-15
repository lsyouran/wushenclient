import { defineCommand, findTarget } from '@engine/world/define.js';
import type { ActorObject, ItemDetailView } from '@engine/world/defs.js';

/**
 * `select` —— 看一个对象（人 / 物）的**详情**。
 *
 * 对照 wushen `world/cmd/action/select.js`。它是"点实体"这条链路在服务端的那一半：
 * 前端点一下 → `SendCommand("select " + id)`（`src/process.js:187`）→ 这里把
 * 「描述 + 可做之事」发回去 → 前端的 `item` 处理器把它打进消息流。
 *
 * ★ 本项目的这条链路此前**整条缺失**（26 册 §20.3 的真机记录）：
 *   协议有 `ItemDetailPacket`、前端有 `item` handler，但**没有一个生产者**，
 *   于是点谁都是把房间描述再打一遍 —— 连内部 id 都漏到了屏幕上
 *   （因为前端当时发的是 `look <id>`，而 `look` 忽略参数）。
 *
 * ★ 与 wushen 的两处差异（都是"去掉隐式约定"，不是另起炉灶）：
 *
 *   ① **不发 JSON 文本**。wushen 的 `enter` 是
 *      `me.notify(target.query_commands(me))` —— `query_commands` 返回的**是一个
 *      JSON 字符串**（`npc.js:113` 的 `return JSON.stringify(json)`），
 *      客户端靠"首字符是不是 `{`"把它认回成包。
 *      这里走显式的 `me.showItem(detail)`，由会话层包成 `item` 帧。
 *
 *   ② **动作清单只列真的打得出来的**。wushen 的 `query_commands_json` 还会拼
 *      「比试 / 击杀 / 拜师 / 学习 / 购买 / 询问」—— 那些依赖
 *      `fight` / `kill` / `bai` / `cha` / `list` 等指令，本项目一条都还没有。
 *      照抄它们等于摆一排点下去只会回"什么？"的按钮（`src/index.html` 的工具条
 *      注释里已经立过这条规矩）。等那些指令落地，在这里按 wushen 的顺序追加即可。
 *
 * ★ 闸门照抄：wushen `select.js` 声明了 `allow_busy` / `allow_state`。
 *   "看东西"不该被忙碌或打坐挡住 —— 也不该被灵魂状态挡住（否则死了连自己
 *   掉的东西都看不了）。
 */
defineCommand('action/select', {
  command: 'select,command', // 逗号别名：与 wushen 的 `this.command = "select,command"` 一致
  allow_busy: true,
  allow_state: true,
  allow_die: true,

  run: (me, key) => {
    const env = me.environment;
    if (env === null) {
      me.notify(INSPECT_MESSAGES.blind);
      return;
    }

    if (key === undefined || key.trim() === '') {
      // wushen 无参数时把**环境**的可做之事再发一遍
      // （`me.environment.query_commands(me, true)`）。本项目的房间动作已经
      // 常驻在动作栏里（`room` 帧的 `commands`），再发一遍就是同一份东西的
      // 第二个入口 —— 与 `renderVerbs` 不列方向动作是同一条理由。
      return;
    }

    const target = findTarget(me, env, key.trim());
    if (target === undefined) {
      me.notify(INSPECT_MESSAGES.notFound);
      return;
    }
    me.showItem(detailOf(target));
  },
});

// ---------------------------------------------------------------------------
// "看东西"共用的两个小函数（`look <目标>` 用的是同一份）
// ---------------------------------------------------------------------------

/** 用户可见文案（集中一处；测试引用常量而不是重抄字面量） */
export const INSPECT_MESSAGES = {
  /** wushen `select.js` 的原句 */
  notFound: '这里没有这个东西。',
  blind: '你什么也看不见。',
} as const;

/**
 * 一个对象 → 详情载荷。
 *
 * `desc` 取 **名字行 + 描述行**，对应 wushen `OBJ.get_desc()`：
 *
 *     OBJ.prototype.get_desc = function () { return this.color_name + "\n" + this.desc; }
 *
 * ★ wushen 的 NPC 那一支只给 `this.desc`（`npc.js:59`），不拼名字。两边不统一，
 *   这里统一成 `get_desc()` 的形态 —— 理由是本项目的命令回显已经按 wushen
 *   去掉了（`SendCommand` 不 record 到消息流），只给一句描述的话，
 *   玩家看到"一个手脚麻利的店小二。"却不知道点的是谁。
 *
 * `commands` 是**目标自己的**动作（`ActorObject.actions`），触发词拼成
 * `"<cmd> <id>"` —— wushen `query_commands_json` 的最后一段就是
 * `cmd + " " + this.id`。带 id 而不是名字，是因为目标动作是
 * **三级分发的第三级**（`ask <目标>` 里 `<目标>` 要先能解析成对象）；
 * 用运行时实例 id 才不会有"两个同名 NPC 打错人"的问题。
 */
export function detailOf(obj: ActorObject): ItemDetailView {
  const desc = (obj.desc ?? '').trim();
  return {
    id: obj.id,
    name: obj.name,
    desc: desc === '' ? obj.name : `${obj.name}\n${desc}`,
    commands: commandsOf(obj),
  };
}

/** 目标声明的动作 → 按钮列表（wushen `query_commands_json` 的自定义 `actions` 那一支） */
function commandsOf(obj: ActorObject): Array<{ cmd: string; name: string }> {
  const out: Array<{ cmd: string; name: string }> = [];
  for (const action of obj.actions ?? []) {
    // wushen 也是 `if (!this.actions[cmd].name) continue;` —— 没有显示名的动作
    // 不该变成一个只有触发词的按钮。
    if (action.name === '') continue;
    out.push({ cmd: `${action.cmd} ${obj.id}`, name: action.name });
  }
  return out;
}

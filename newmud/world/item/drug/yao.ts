import { defineItem } from '@engine/world/define.js';

/**
 * `#` 变体：一个文件派生多个对象（等价 wushen 的 `drug/yao#0` ~ `#3`）。
 * 注册后会产生 `drug/yao`、`drug/yao#0`、`drug/yao#1` 三条记录，
 * 且**都指向同一个文件** —— 与 G5「文件路径 ↔ id 基路径一致」的规则兼容。
 * 详见 docs/24 §1.7 / 决策 D2。
 */
defineItem('drug/yao', {
  name: '丹药',
  desc: '一枚普通的丹药，看不出特别之处。',
  unit: '枚',
  value: 100,
  grade: 1,
  combined: true,
  transable: true,
  // ⚠️ **这里只播报，不恢复任何数值**（2026-10-20 三端对照复核，真机实证）。
  //   wushen 的同名物件默认分支是 `me.add_hp(parseInt(me.max_hp * 0.3))` + 播报
  //   「你恢复了 N 气血」（`world/obj/drug/yao.js:46-49`）—— 那份**真的回血**。
  //   本项目至今没有任何一条"内容层改气血"的通道（`CommandActor` 不暴露写 hp，
  //   见 26 册 §54 / `_72` §一②）：`setHp()` 的调用点全在 `character.ts` 内部。
  //   ⇒ 本钩子目前是**半个移植**，回血属 P0 专项批次（与 `dazuo` 同批，
  //     因为两条都要先决定"恢复走哪条路"）。挂账在此，免得被当成"已经有了"。
  //
  // ★ 为什么不先把文案改成"不承诺恢复"的措辞：那是把**缺口藏进文案**，
  //   而不是把缺口暴露出来。世界的描述（`#0 再生丹` 的 desc）本来就写的是
  //   "这药据说能回血"，玩家读到的是世界观；真正该修的是"没实现"，不是"改文案"。
  //   与 `world/skill/base/force.ts:42-46` 那条纪律**不冲突**：那一条管的是
  //   "**属性/公式**上的空头承诺"，这里管的是"**行为**缺口"，各有各的挂账位置。
  on_use: (me) => {
    me.notify('你服下一枚丹药，只觉一股暖流涌遍全身。');
  },
  variants: {
    '0': { name: '再生丹', desc: '可恢复少量气血的丹药。', value: 300 },
    '1': {
      name: '暴虐丹',
      desc: '短时间内令人气血翻涌、攻击大增，但出手变慢。',
      value: 800,
      // ⚠️ **这份 `prop` 目前零消费者**（2026-10-20 复核）：`Item` 不是 `PropHolder`
      //   （`server/engine/item.ts:10` 有意如此 —— 装备的加成是**穿的人**的属性，
      //   不是物品自己的），而 wushen 的"暴虐"走的是 `add_status()` 临时 BUFF
      //   （`world/obj/drug/yao.js:16-26`，10 秒）。本项目的 BUFF/状态系统
      //   尚未落地 ⇒ 吃完既没有临时加成，也没有常驻加成。
      //   ⇒ 别把它当成"暴虐丹已生效"的证据；G3.A 闸门守的是**键的合法性**
      //   （有没有写错键），守不了"有没有人读它"。
      // ★ 本项目**内容层第一个 `prop`**：G3 闸门由此从 SKIP 转为实检
      //   （见 tools/gate/g3-propkeys.mjs 的 counts 与 docs/24 §5.1）。
      //   键必须是 CORE∪MOD —— `PROP.attack` 落在核心键 `gj` 上、
      //   `PROP.attackSpeedPer` 落在 `gjsd` 的派生百分比键 `gjsd_per` 上。
      //   内容层自造的键**不能**写在这里，必须走 extProp + registerExtProp()。
      //   ★ 2026-10-18 起不再写裸拼音键：凡有 `PROP` 别名的核心键，裸写即违规（G3.A）。
      prop: { attack: 20, attack_speed_per: -20 },
    },
  },
});

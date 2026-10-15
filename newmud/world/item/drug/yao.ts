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
  on_use: (me) => {
    me.notify('你服下一枚丹药，只觉一股暖流涌遍全身。');
  },
  variants: {
    '0': { name: '再生丹', desc: '可恢复少量气血的丹药。', value: 300 },
    '1': {
      name: '暴虐丹',
      desc: '短时间内令人气血翻涌、攻击大增，但出手变慢。',
      value: 800,
      // ★ 本项目**内容层第一个 `prop`**：G3 闸门由此从 SKIP 转为实检
      //   （见 tools/gate/g3-propkeys.mjs 的 counts 与 docs/24 §5.1）。
      //   键必须是 CORE∪MOD —— `gj` 是核心键，`gjsd_per` 是 `gjsd` 的派生百分比键。
      //   内容层自造的键**不能**写在这里，必须走 extProp + registerExtProp()。
      prop: { gj: 20, gjsd_per: -20 },
    },
  },
});

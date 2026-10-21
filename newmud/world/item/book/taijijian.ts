import { defineItem } from '@engine/world/define.js';

/**
 * 《太极剑法》秘籍 —— **研读（`study`）这条路的实物凭据**。
 *
 * ★★ 为什么需要书（26 册 §75）：技能有**两条**成长路，wushen 两条都有 ——
 *
 *     学（`xue` / `learn`）：有师父、花**潜能**、一次结算、上限受**师父等级**压着
 *     读（`study`）      ：有**书**、不花潜能、按智力每拍涨、上限受**书**压着
 *
 *   本项目只做了前者，于是"书"这一类内容（wushen `world/obj/book/` 一整目录）
 *   在内容层**无处表达**。这个文件是那条路的第一件实物。
 *
 * ★ 数据字段（不是钩子）：`studySkill` 说"读它涨哪门"，`studyMaxLevel` 说"能教到几级"。
 *   判据与 `on_use` 同一条 —— **能力由数据的在不在决定**，不另立开关。
 *
 * ★ 为什么上限是 80 而不是 1000：与教头（`pub/jiaotou.ts`）同档 ——
 *   书的等级是**内容层的教学上限**，不是引擎硬顶。想学更高要另找秘籍。
 *   （`wd/taijijian` 的 `max_level` 是 1000，这里刻意只给 80。）
 */
defineItem('book/taijijian', {
  name: '太极剑法秘籍',
  desc: '一本薄薄的绢册，封皮上是"太极剑法"四个瘦金小字，纸页边缘已经磨得发毛。',
  unit: '本',
  value: 800,
  grade: 2,
  // ★ 能不能读由**这两个字段**决定（`train/study.ts` 的判定就是"在不在"）
  studySkill: 'wd/taijijian',
  studyMaxLevel: 80,
});

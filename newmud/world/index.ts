/**
 * world/index.ts — 显式加载清单
 * ============================================================================
 * 取代 wushen 的 `readdir` 目录序遍历（21 册 架构债 B：跨平台风险 + 无法静态分析）。
 *
 * 新增内容文件**必须**在此登记，否则不会被加载。这是刻意的：
 * 让"漏登记"变成一次**可见的遗漏**，而不是靠目录遍历碰运气。
 *
 * 顺序原则：被引用者在前（引用校验虽在加载之后统一进行，但保持顺序可读）。
 *   area → skill → item → npc → room → command
 * 指令不被任何东西引用（它是输入侧入口），故排在最后。
 */

import './area/yz.js';
import './skill/base/force.js';
import './skill/base/dodge.js';
import './skill/base/parry.js';
import './skill/base/unarmed.js';
import './skill/base/sword.js';
import './skill/base/blade.js';
import './skill/wd/taijijian.js';
import './item/drug/yao.js';
import './item/book/taijijian.js';
import './item/book/sword.js';
import './npc/pub/xiaoer.js';
import './npc/pub/muren.js';
import './npc/pub/jiaotou.js';
import './room/yz/guangchang.js';
import './room/yz/beidajie1.js';
import './room/yz/wuguan.js';
import './command/action/look.js';
import './command/action/select.js';
import './command/move/go.js';
import './command/chat/say.js';
import './command/chat/shout.js';
import './command/chat/tell.js';
import './command/info/score.js';
import './command/obj/get.js';
import './command/obj/drop.js';
import './command/obj/give.js';
import './command/obj/use.js';
import './command/combat/fight.js';
import './command/combat/kill.js';
import './command/combat/flee.js';
import './command/combat/relive.js';
import './command/train/practice.js';
import './command/train/learn.js';
import './command/train/enable.js';
import './command/train/forget.js';
import './command/train/study.js';
import './command/train/stop.js';
import './command/info/skills.js';
import './command/admin/addxp.js';

/**
 * 清单（相对 `world/` 的路径，顺序 = 加载顺序）。
 * G5 闸门用它比对「登记项 ↔ 实际文件」，避免"文件建了但没登记"。
 */
export const CONTENT_MODULES: readonly string[] = [
  'area/yz.ts',
  'skill/base/force.ts',
  'skill/base/dodge.ts',
  'skill/base/parry.ts',
  'skill/base/unarmed.ts',
  'skill/base/sword.ts',
  'skill/base/blade.ts',
  'skill/wd/taijijian.ts',
  'item/drug/yao.ts',
  'item/book/taijijian.ts',
  'item/book/sword.ts',
  'npc/pub/xiaoer.ts',
  'npc/pub/muren.ts',
  'npc/pub/jiaotou.ts',
  'room/yz/guangchang.ts',
  'room/yz/beidajie1.ts',
  'room/yz/wuguan.ts',
  'command/action/look.ts',
  'command/action/select.ts',
  'command/move/go.ts',
  'command/chat/say.ts',
  'command/chat/shout.ts',
  'command/chat/tell.ts',
  'command/info/score.ts',
  'command/obj/get.ts',
  'command/obj/drop.ts',
  'command/obj/give.ts',
  'command/obj/use.ts',
  'command/combat/fight.ts',
  'command/combat/kill.ts',
  'command/combat/flee.ts',
  'command/combat/relive.ts',
  'command/train/practice.ts',
  'command/train/learn.ts',
  'command/train/enable.ts',
  'command/train/forget.ts',
  'command/train/study.ts',
  'command/train/stop.ts',
  'command/info/skills.ts',
  'command/admin/addxp.ts',
];

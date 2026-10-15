/**
 * server/engine/view-text.ts — 三视角文案（同一句话，各看各的）
 * ============================================================================
 * **权威实现**：wushen `os/char/character.js:91-133` 的
 * `splitmessage(me, text, type, target)`，调用方是同一文件 `:71-87` 的
 * `CHARACTER.prototype.send_room`。
 *
 * ## 为什么需要它（不是为了好看）
 * MUD 的播报天然是**视角相关**的：
 *   `"$N朝$n拱了拱手。"` 在三个人眼里是三句话 ——
 *   自己看是「**你**朝慕容拱了拱手」，对方看是「阿飞朝**你**拱了拱手」，
 *   旁人看是「阿飞朝慕容拱了拱手」。
 *
 * ★ 这件事**必须在内容层落地之前做好**（26 册 §16.6 的表 #8）：
 *   wushen 的 `world/` 里几乎每句文案都带 `$N`，内容脚本一旦按"没有占位符"
 *   写完再回头改，改的是**成百上千条文案**。所以 26 册把 T16 排在
 *   "与移动批次同批做"。
 *
 * ## 视角编号照抄 wushen（不要重排）
 * `1` = 本人视角、`2` = 目标视角、`3` = 第三人称。数字本身就是 wushen
 * `send_room` 传给 `splitmessage` 的第二个实参，改了数字就改了语义。
 *
 * ## 与 wushen 的唯一有意偏离
 * wushen 假定 `target` 一定存在：文案里写了 `$n` 而调用方没给 target 时，
 * `target.name` 会抛 `TypeError` —— 在 `send_room` 的循环里，这会把
 * **整条连接**打崩。这里改为**降级**（`$n` → `""`、`$p` → 目标名字），
 * 与 `Character.go()` 把"目标房间满"降级成"走不过去"同一取向：
 * 内容写错是内容层的问题，不该炸运行时。
 *
 * ## 装备相关占位符的现状
 * `$w` / `$W` / `$i` / `$T` / `$l` 读的是 wushen `chara_equip.js:142,148` 的
 * `weapon_name()` / `throwing_name()` 与 `attack_part`。本项目**装备系统尚未落地**，
 * 于是这里用**可选方法**取（`ViewSubject.weaponName?` 等），并在缺席时套 wushen
 * 自己的兜底值（武器 → `"手"`、暗器/部位 → `""`）。装备系统落地时由 `Character`
 * 实现这几个方法即可自动接上 —— 不需要回来改本文件，也**不是**"声明未实现"：
 * 缺武器时 `"手"` 本来就是这个公式在 wushen 下的正确输出。
 */

/** 本人视角：`$N` / `$P` 是"你" */
export const VIEW_SELF = 1;
/** 目标视角：`$n` / `$p` 是"你" */
export const VIEW_TARGET = 2;
/** 第三人称：两边都是名字 / 称谓 */
export const VIEW_OTHER = 3;

/** 视角编号。取值与 wushen `send_room` 的实参一致，**不要重排** */
export type ViewType = typeof VIEW_SELF | typeof VIEW_TARGET | typeof VIEW_OTHER;

/**
 * 渲染一个 `$` 占位符需要从对象身上读到的**最小面**。
 *
 * ★ 只列 `name` 为必填：`$N` / `$n` 是文案里最常见的两个，而 `name` 是
 *   `ActorObject`（内容层从 `room.items` 拿到的东西）本来就有的字段 ——
 *   于是"只用到名字"的文案不需要调用方做任何转换。
 *   其余方法缺席时按上面的兜底规则降级。
 */
export interface ViewSubject {
  readonly name: string;
  /** wushen `CHARACTER.prototype.call3()`（`chara_comm.js:41`）：`gender == 1 ? "他" : "她"` */
  call3?(): string;
  /** wushen `weapon_name()`（`chara_equip.js:142`）：无武器返回 `""`，由调用点补 `"手"` */
  weaponName?(): string;
  /** wushen `throwing_name()`（`chara_equip.js:148`）：无暗器返回 `""` */
  throwingName?(): string;
  /** wushen 的 `attack_part.name`：没有时为 `""` */
  attackPartName?(): string;
}

/** 第三人称称谓：缺席时**退回名字**（而不是空串 —— 名字总比什么都没有强） */
function call3Of(who: ViewSubject | null): string {
  if (who === null) return '';
  return who.call3?.() ?? who.name;
}

/**
 * 把一条带 `$` 占位符的文案渲染成**某个视角**看到的那一句。
 *
 * 扫描逻辑逐条对齐 wushen `splitmessage`：
 * - 文本短于 3 个字符时**不扫描**（连一个 `$X` 都放不下）；
 * - 未知转义（`switch` 没有 default）**被吃掉**，`$` 本身也不输出；
 * - 结尾孤立的 `$` 同样被吃掉。
 *
 * @param me     说话者（`$N` / `$P` / `$w` / `$l` / `$T` 的来源）
 * @param text   内容层写的原文，含 `$` 占位符
 * @param type   收件人的视角（`VIEW_SELF` / `VIEW_TARGET` / `VIEW_OTHER`）
 * @param target 该动作的目标（`$n` / `$p` / `$i` 的来源）；没有就传 `null`
 */
export function renderViewText(
  me: ViewSubject,
  text: string,
  type: ViewType,
  target: ViewSubject | null,
): string {
  if (text.length < 3) return text;

  const out: string[] = [];
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] !== '$') continue;
    if (start < i) out.push(text.slice(start, i));
    const ch = text[(i += 1)];
    start = i + 1;
    switch (ch) {
      case 'N':
        out.push(type === VIEW_SELF ? '你' : me.name);
        break;
      case 'n':
        out.push(type === VIEW_TARGET ? '你' : (target?.name ?? ''));
        break;
      case 'P':
        out.push(type === VIEW_SELF ? '你' : call3Of(me));
        break;
      case 'p':
        out.push(type === VIEW_TARGET ? '你' : call3Of(target));
        break;
      case 'l':
        out.push(me.attackPartName?.() ?? '');
        break;
      case 'W':
      case 'w':
        out.push(me.weaponName?.() || '手');
        break;
      case 'i':
        out.push(target?.weaponName?.() || '手');
        break;
      case 'T':
        out.push(me.throwingName?.() ?? '');
        break;
      default:
        break;
    }
  }
  if (start < text.length) out.push(text.slice(start));
  return out.join('');
}

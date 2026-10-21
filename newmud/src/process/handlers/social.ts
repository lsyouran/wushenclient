/**
 * src/process/handlers/social.ts — 聊天 / 表情 / 通用面板
 */

import { registerHandler } from '../registry.js';
import { pushChat } from '../../ui/stream.js';
import { noteChat } from '../../ui/input.js';
import { clearPanelRows, closePanel, openDataPanel, openPanel, removePanelRow } from '../../ui/panel.js';
import { buildAttrPanel } from '../../ui/attr.js';
import { buildSkillsPanel } from '../../ui/skills.js';
import { state } from '../../state.js';
import { DIALOG_CONTROL_FIELDS } from '../../../shared/constants.js';
import type { AttrView, AttrValueView, SkillEntryView, SkillsView } from '../../../shared/protocol.js';

const asString = (v: unknown): string => (typeof v === 'string' ? v : '');

/** 有限数才认，其余（缺失 / 字符串 / NaN / Infinity）一律 0 —— 面板不显示 `NaN` */
const asNum = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

const asObj = (v: unknown): Record<string, unknown> =>
  typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};

/**
 * `dialog:score` 的载荷 → `AttrView`（**每个字段都过一道类型检查**）。
 *
 * ★ 为什么不像别处那样直接 `p['hp'] as number`：`dialog` 的 zod schema 是
 *   passthrough 的（`protocol.ts` 留了未知字段的口子），所以**编译期没人保证**
 *   载荷里那几个键真在。漏一个就变成 `undefined` 摆进面板 —— 玩家看到的是
 *   「气血：undefined / 100」。这里缺什么就退成 0，至少是能读的。
 * ★ 四维那一段逐项过滤：`attrs` 里混进非对象（老版本 / 手搓的包）时跳过那一项，
 *   而不是整块面板崩掉。
 */
function readAttrView(p: Record<string, unknown>): AttrView {
  const rawAttrs = Array.isArray(p['attrs']) ? p['attrs'] : [];
  const attrs: AttrValueView[] = [];
  for (const item of rawAttrs) {
    const o = asObj(item);
    const key = asString(o['key']);
    if (key === '') continue; // 没有键名的项没法查中文名，跳过
    attrs.push({
      key,
      innate: asNum(o['innate']),
      bonus: asNum(o['bonus']),
      total: asNum(o['total']),
    });
  }

  const c = asObj(p['combat']);
  const level = asNum(p['level']);
  return {
    name: asString(p['name']),
    gender: asNum(p['gender']),
    level,
    // ★ 老版本的包没有 `realmName`（本次新增）⇒ 退回数字，面板不空一格。
    //   不在这里查 `REALM_NAMES`：前端只有一张表会漂，名字一律服务端给。
    realmName: asString(p['realmName']) || String(level),
    exp: asNum(p['exp']),
    pot: asNum(p['pot']),
    hp: asNum(p['hp']),
    maxHp: asNum(p['maxHp']),
    mp: asNum(p['mp']),
    maxMp: asNum(p['maxMp']),
    attrs,
    combat: {
      attack: asNum(c['attack']),
      defense: asNum(c['defense']),
      hit: asNum(c['hit']),
      evasion: asNum(c['evasion']),
      deflect: asNum(c['deflect']),
      crit: asNum(c['crit']),
    },
    // ★ `skillLimit` 允许 `Infinity`（NPC 的面板）—— 上面那个 `asNum` 会把它归零，
    //   所以这里单独判：不是有限数时**保留**它（前端渲染成 ∞）。
    skillLimit:
      typeof p['skillLimit'] === 'number' && !Number.isNaN(p['skillLimit'])
        ? p['skillLimit']
        : 0,
  };
}

/**
 * `dialog:skills` 的载荷 → `SkillsView`（与 `readAttrView` 同一条纪律：逐字段过一遍）。
 *
 * ★ 为什么条目要**逐项筛**而不是整块信：`dialog` 的 schema 是 passthrough 的，
 *   缺字段时面板上会出现 `undefined 级 / NaN%`。这里缺什么就退成能读的值；
 *   连 `id` 都没有的项直接跳过 —— 没有 id 就拼不出命令，留着只能是死行。
 */
function readSkillsView(p: Record<string, unknown>): SkillsView {
  const raw = Array.isArray(p['items']) ? p['items'] : [];
  const items: SkillEntryView[] = [];
  for (const item of raw) {
    const o = asObj(item);
    const id = asString(o['id']);
    if (id === '') continue;
    const canEnables = Array.isArray(o['canEnables'])
      ? o['canEnables'].filter((s): s is string => typeof s === 'string')
      : [];
    const enabled = asString(o['enabled']);
    const note = asString(o['note']);
    const slot = asString(o['slot']);
    items.push({
      id,
      // 没有名字就退回 id 的末段：`wd/taijijian` → `taijijian`。
      // 玩家看到拼音很怪，但比看到空白行更能定位问题。
      name: asString(o['name']) || (id.split('/')[1] ?? id),
      kind: asString(o['kind']) || 'skill',
      grade: asNum(o['grade']),
      level: asNum(o['level']),
      // ★ 进度是 0–100 的百分数，先钳再截断：服务端就算给了 130 / -3，面板也不显示
      progress: Math.max(0, Math.min(100, Math.trunc(asNum(o['progress'])))),
      enabled: enabled === '' ? null : enabled,
      canEnables,
      slot: slot === '' ? null : slot,
      ...(note === '' ? {} : { note }),
    });
  }
  return {
    title: asString(p['title']),
    limit: asNum(p['limit']),
    pot: asNum(p['pot']),
    items,
  };
}

const formatField = (v: unknown): string =>
  typeof v === 'object' ? JSON.stringify(v) : String(v);
/** 是不是 `dialog` 帧的**控制字段**（名单单源 = `DIALOG_CONTROL_FIELDS`） */
const isControlField = (k: string): boolean => (DIALOG_CONTROL_FIELDS as readonly string[]).includes(k);

/**
 * `msg` 包 —— 聊天消息。
 *
 * ★ 这一档以前**没有生产者**（服务端从不发 `msg`），于是"闲聊分页"永远是空的。
 *   本批次补上了生产者（`server/session.ts#deliverChannel`），这里也相应
 *   从"一律当 say 塞进叙事流"改成**按频道分档**：
 *
 *     频道 → CSS 档位：chat/rumor/tm/fam/pty/es/sys → `.wor`（世）· tell → `.pri`（私）
 *
 *   ★ **没有「房间」这一档**（26 册 §24）：房间里说话（`say`）走服务端的房间广播
 *     （`sendRoom` → `warn` 帧 → 主消息流），不是频道消息 —— wushen 的频道区
 *     （`dialog/channel.js` 的页签）同样没有「房间」。所以这里也不该有 `.say` 档。
 *
 *   档位只是一个类名（`.say` / `.wor` / `.pri`），由 `src/ui/stream.ts` 的 `pushChat`
 *   挂在行上、`style.css` 负责上色。**目前没有"按频道过滤"的开关**：档位是留给
 *   将来当筛选钩子用的（旧版有个 `#logtabs` 过滤条，这里还没做，所以别在注释里
 *   假装它存在 —— 否则读代码的人会去找一个不存在的元素）。
 *
 * ★ 前缀不再由前端拼"【说话】"这类字样：说话人名字走 `.who` 那一小段
 *   （颜色比正文淡一档），频道名由分档的**颜色**承担 —— 一行里出现
 *   "【闲聊】阿飞：【闲聊】你好"那种双份前缀是最容易出来的丑。
 */
registerHandler('msg', (p) => {
  const ch = asString(p['ch']);
  const content = asString(p['content']);
  const who = asString(p['name']);
  // 自己说的话显示成「你」：`msg` 里只有说话人的名字，没有"这条是我发的"标记，
  // 而"我"是谁前端本来就知道（登录时的名号）—— 于是没必要为每个收件人各拼一份文本。
  //
  // ⚠️ 这是**本项目的取舍，不是 wushen 的行为**：wushen 的 `createElement` 只拼
  //    `data.name`，自己看自己的世界频道消息显示的是**自己的名字**
  //    （`world/cmd/channel/chat.js` 把同一个包发给所有人，`name` 恒为发送者）。
  // ⚠️ 判据 `who === state.roleId` 依赖**「名号 == 登录身份」**这条前提
  //    （`session.ts` 造角色时 `name: roleId`）。**存档批次落地后角色名会独立于
  //    roleId**，届时这条比较会**静默失效**（只会退化成显示名字，不会报错）——
  //    已记入 26 册 §24.5 待办。
  const shown = who !== '' && who === state.roleId ? '你' : who;
  pushChat(ch, shown, content);
  noteChat();
});

/**
 * `emote` 帧 —— 表情清单。
 *
 * ⚠️ **当前面板里的每一项都是纯文本、不可点**（2026-10-16 审查 F5 订正）。
 *   旧注释写"点开即用"是**假的**：`openPanel` 的第二参是纯文本行，压根没有点击行为
 *   （可点的只有第三参 `cmds`，那是服务端下发的 `CmdItem`）。
 *
 * ★ 为什么这一批**不做**可点：全仓**没有 `emote` 指令**（`world/` 零命中）、
 *   也**没有 `emote` 包的生产者**（`server/` 零命中）—— 点了也无处可去，
 *   做成按钮只会多一个"点了什么都不发生"的假控件（26 册 §16.8 明确反对的那一类）。
 *
 * ★ wushen 的做法是把表情名**填进输入框**（前缀 `*`，见 `src/game/main.js#ShowEmotePanel`），
 *   而不是直接发指令。等本项目有了 `emote` 指令与生产者，照它实现"点击填入聊天框"，
 *   落点就是这里。
 */
registerHandler('emote', (p) => {
  const items = Array.isArray(p['items']) ? p['items'].map(asString) : [];
  if (items.length === 0) return;
  openPanel('表情', items);
});

/**
 * `dialog` 是通用面板容器（协议里刻意保留未知字段）。
 * ★ 未知的（`p.dialog` 不在本文件已识别的面板名里）**照样开面板**并列出原始字段 ——
 *   宁可看到"还没做"，也不要假装处理了（那会让玩家以为功能坏了）。
 *
 * ⚠️ 旧注释称"知名面板走 `PANEL_TABS`（有取数指令）" —— **`PANEL_TABS` 这个常量不存在**
 *   （2026-10-14 复查：全仓仅此一处命中，且在注释里）。已删除该引用，别再拿它当既有事实。
 *
 * ★★ **控制字段已分流**（F4，2026-10-16 审查）：`close` / `refresh` / `clear` / `remove`
 *   改的是**面板本身**，不再是"面板里的一行"。原先四个字段全被当普通字段列成文本行 ——
 *   服务端发 `{dialog:'pack', close:true}` 会看到一行 `close: true`，而面板**不关**。
 *
 * ★ 两种语义按"**本帧有没有内容字段**"区分：
 *     - **控制帧**（只带控制字段）⇒ 作用于**当前**面板：`close` 收起 / `remove` 删一行 /
 *       `clear` 清空 / `refresh` 消费掉（面板是纯文本快照，无需重绘）；
 *     - **内容帧**（带别的字段）⇒ 重建面板，内容字段逐条落行。
 *   混在一帧里时 `close` 优先（面板都关了，再列行没有意义）。
 */
registerHandler('dialog', (p) => {
  if (p['close'] === true) {
    closePanel();
    return;
  }

  const contentKeys = Object.keys(p).filter(
    (k) => k !== 'v' && k !== 'type' && k !== 'dialog' && !isControlField(k),
  );

  if (contentKeys.length === 0) {
    if (typeof p['remove'] === 'string') removePanelRow(p['remove']);
    if (p['clear'] === true || typeof p['clear'] === 'string') clearPanelRows();
    // `refresh` 只表示"数据已更新到该时刻" —— 面板是纯文本快照，没有要重算的视图
    return;
  }

  const name = asString(p['dialog']);

  // ★★ `score` 走**专用渲染器**（§62）：属性卡是分段的（`.score-section`），
  //   一行一个 `<p>` 盛不下 —— 那正是它跟物件面板的区别。wushen 也是每个面板
  //   自带模板（`dialog/score.js` 的 `template_score`），不是通用键值列表。
  //   ★ 只认**自己渲染得了**的那几个面板名；其余照旧落到通用分支（如实列出
  //     `k: v`，不假装处理了 —— 见本函数开头的说明）。
  if (name === 'score') {
    openDataPanel('score', '属性', () => buildAttrPanel(readAttrView(p)));
    return;
  }

  // ★★ `skills` 走**第三段结构**的面板（§64.10）：页签 + 列表 + 动作栏。
  //   与 `score` 的差别是它**有内部状态**（哪一页、选了哪一项），所以构建器
  //   拿得到 `redraw` —— 那是 §63.3 给操作型面板留的地基。
  //   标题带上限：上限由经验决定（26 册 §56），它是"这门技能还能练到几级"的答案，
  //   放在标题里与 wushen 的 `Dialog.title(data.title)` 同一个位置。
  if (name === 'skills') {
    const view = readSkillsView(p);
    openDataPanel('skills', `技能 · 上限 ${String(view.limit)} 级`, (redraw) =>
      buildSkillsPanel(view, redraw),
    );
    return;
  }

  const rows = contentKeys.map((k) => `${k}: ${formatField(p[k])}`);
  openPanel(name === '' ? '面板' : name, rows.length === 0 ? ['（空面板）'] : rows);
});

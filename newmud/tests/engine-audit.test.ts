/**
 * tests/engine-audit.test.ts —— 第二轮审查发现的缺陷回归
 * ============================================================================
 * 这里的每一条都对应 **26 册 §11.2** 里的一条**已确认缺陷**（R1–R7）：先写断言、
 * 确认变红，再改实现。反过来（先改后补断言）等于没有证据 —— 见 24 册铁律 1。
 *
 * ★ **本文件内的 `A1…A7` 是本地编号**（一条缺陷一组），与 26 册的 `R` 编号
 *   **并不同序**，对照如下（改注释/查档时别按序号硬对）：
 *
 *     A1 容器环                  ↔ R1        A4 明文通道漏 C1         ↔ R4
 *     A2 三级分发多词参数         ↔ R2        A5 `addExp` 负增量        ↔ R6
 *     A3 `SkillBook` 同槽冲突     ↔ R3        A6 `RecordingOutput` 上界 ↔ R5
 *     A7 0 级技能不贡献属性       ↔ R7
 *
 *   ★ **A7 ↔ R7 与其余六条不同源**：它不是第二轮复审（26 册 §11.2）抓到的，
 *     而是**拿 wushen 源码对代码**才发现的（26 册 §12.4），回归就在**本文件**
 *     （`describe('A7 零级技能的属性贡献')`，2 条）—— 原文曾写"回归在
 *     `tests/engine-skill.test.ts`"，那是**过时陈述**（D6，2026-10-14 订正）。
 *   ★ `A7` 在源码里排在 `A6` **之前**（`:266` vs `:339`）—— 本文件**按发现批次**
 *     排列，不按序号；这是有意的，别顺手"排序"。`A7` 亦被 `server/engine/skill.ts:625`
 *     与 26 册 §12.4 引用，改号要全仓 `grep`（24 册铁律 9）。
 *
 * ⚠️ 本头部原先引用的是 **`docs/28`，而那一册根本不存在**（第二轮审查的记录
 *    早已并入 `docs/26 §11`）。这是 **T21 / FG-13 的"幽灵引用"**，
 *    于 2026-10-13 修正。改文档编号时请全仓 `grep` 旧编号。
 *    ★ T21 当时的结论是「**没有任何闸门**在扫文档引用，这条纪律是人工的」——
 *      该缺口已于同日补建：**G15 · 文档引用**（`tools/gate/g15-docrefs.mjs`，规则 **G15.1**：
 *      注释里出现的 `NN 册` 必须指向真实存在的册号；见 24 册 §5.1 与 26 册 §28.10）。
 *      ⚠️ 但 G15 **只判册号、不判 `§节号`** ⇒ 册号写错它会红，**节号写错它不管**
 *      （第一次实测受害例：8 处把 `24 册 §5.3` 写成 `26 册 §5.3`，见 26 册 §29.3①）。
 *
 * 覆盖：
 *   A1 容器环 → `GameObject.room` 上溯无上界（**挂死**，不是报错）
 *   A2 三级分发第 ③ 级在「多词参数」下失效（目标匹配只认整串 args）
 *   A3 `SkillBook.load()` 同槽冲突不清理（与 `enable()` / `loadFromDef()` 行为不一致）
 *   A4 明文通道漏掉 C1 控制字符（U+0080–U+009F）→ 终端/日志注入面
 *   A5 `addExp` 负增量可让 `exp` 变负（"经验债"）
 *   A6 `RecordingOutput` 无上限 → 长跑进程的内存单调增长
 *   A7 0 级技能仍贡献属性（含"与等级无关的常数型"）→ 记账式重算只看"属性值=0"、不看"等级=0"
 *
 * ⚠️ A1 的"变红"形态是**测试超时**（同步死循环），不是断言失败。
 *    所以修之前跑这条用例会挂到 timeout —— 这正是该缺陷的真实表现。
 */
import { describe, expect, it } from 'vitest';

import { SKILL_TYPES } from '../shared/constants.js';
import type { EnableSlot } from '../shared/constants.js';
import { checkPlaintext } from '../shared/protocol.js';
import { asWorldId } from '../shared/ids.js';
import { RECORDING_OUTPUT_LIMIT, RecordingOutput } from '../server/engine/character.js';
import { CommandTable, dispatch } from '../server/engine/command.js';
import { Npc } from '../server/engine/npc.js';
import { Room } from '../server/engine/room.js';
import { getProp } from '../server/engine/props.js';
import { SkillRegistry } from '../server/engine/skill.js';
import type { NpcDef, RoomDef, SkillDef } from '../server/world/defs.js';

const NO_SKILLS = new SkillRegistry([]);

const NPC_DEF: NpcDef = { name: '测试NPC', desc: '用于审查回归的 NPC。' };

function makeNpc(oid: string, path: string, def: NpcDef = NPC_DEF): Npc {
  return new Npc({
    oid,
    path: asWorldId(path, 'engine-audit.test:npc'),
    name: def.name,
    def,
    skillRegistry: NO_SKILLS,
  });
}

function makeRoom(path: string): Room {
  const def: RoomDef = { name: '测试房间', desc: '用于审查回归的房间。' };
  return new Room({
    oid: `room-${path}`,
    path: asWorldId(path, 'engine-audit.test:room'),
    name: def.name,
    desc: def.desc,
    def,
  });
}

// ---------------------------------------------------------------------------
// A1 · 容器环：A 装 B、B 装 A
// ---------------------------------------------------------------------------

describe('A1 容器环', () => {
  it('互相嵌套时 room 不得挂死（返回 null / 抛出，而不是死循环）', () => {
    const a = makeNpc('oid-a', 'pub/a');
    const b = makeNpc('oid-b', 'pub/b');
    a.addItem(b);
    b.addItem(a); // 自环已被 addItem 挡住，但**互环**没有

    // 修复前：这里是一个无上界的 while → 同步死循环 → 用例超时。
    expect(a.room).toBeNull();
  });

  it('三元环（A→B→C→A）同样不挂死', () => {
    const a = makeNpc('oid-a2', 'pub/a2');
    const b = makeNpc('oid-b2', 'pub/b2');
    const c = makeNpc('oid-c2', 'pub/c2');
    a.addItem(b);
    b.addItem(c);
    c.addItem(a);
    expect(a.room).toBeNull();
  });

  it('正常嵌套链仍然能找到房间（不能被上界误伤）', () => {
    const room = makeRoom('yz/audit1');
    const a = makeNpc('oid-a3', 'pub/a3');
    const b = makeNpc('oid-b3', 'pub/b3');
    room.addItem(a);
    a.addItem(b);
    expect(b.room).toBe(room);
  });
});

// ---------------------------------------------------------------------------
// A2 · 三级分发第 ③ 级：多词参数
// ---------------------------------------------------------------------------

describe('A2 目标物件动作（多词参数）', () => {
  it('`ask xiaoer about job` 里的 xiaoer 必须能作为目标命中', () => {
    const room = makeRoom('yz/audit2');
    let asked = 0;
    // ★ 关键：`ask` **不是**全局指令，只挂在 NPC 身上 —— 否则第 ② 级就接手了，
    //   用例会假绿（这正是"断言写松了"的典型：判据要钉在 via 上，不能只看 executed）。
    const xiaoer = makeNpc('oid-xiaoer', 'pub/xiaoer', {
      name: '小二',
      desc: '一个跑堂的。',
      actions: [
        {
          cmd: 'ask',
          name: '询问',
          run: () => {
            asked += 1;
            return true;
          },
        },
      ],
    });
    room.addItem(xiaoer);
    const me = makeNpc('oid-me2', 'pub/me2');
    room.addItem(me);

    const out = dispatch(new CommandTable([]), me, 'ask xiaoer about job');
    // 修复前：findTarget 用整串 args（"xiaoer about job"）→ 命中不了 → unknown
    expect(out).toMatchObject({ kind: 'executed', via: 'target' });
    expect(asked).toBe(1);
  });

  it('整串仍能精确命中（`ask <oid>` 不被首词兜底抢走）', () => {
    const room = makeRoom('yz/audit3');
    let asked = 0;
    const xiaoer = makeNpc('oid-xiaoer3', 'pub/xiaoer3', {
      name: '小二',
      desc: '一个跑堂的。',
      actions: [
        {
          cmd: 'ask',
          name: '询问',
          run: () => {
            asked += 1;
            return true;
          },
        },
      ],
    });
    room.addItem(xiaoer);
    const me = makeNpc('oid-me3', 'pub/me3');
    room.addItem(me);

    const out = dispatch(new CommandTable([]), me, 'ask oid-xiaoer3');
    expect(out).toMatchObject({ kind: 'executed', via: 'target' });
    expect(asked).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// A3 · SkillBook.load() 的装配槽冲突
// ---------------------------------------------------------------------------

describe('A3 读档时的装配槽冲突', () => {
  const DEFS: ReadonlyArray<{ id: string; def: SkillDef }> = [
    {
      id: 'audit/sworda',
      def: {
        name: '审查剑法甲',
        type: SKILL_TYPES.SKILL,
        can_enables: ['sword'],
        enableProp: () => ({ sword: { prop: { gj: 10 } } }),
      },
    },
    {
      id: 'audit/swordb',
      def: {
        name: '审查剑法乙',
        type: SKILL_TYPES.SKILL,
        can_enables: ['sword'],
        enableProp: () => ({ sword: { prop: { gj: 100 } } }),
      },
    },
  ];

  it('两条记录都声明占 sword 槽时，先者不得继续声称自己已装配', () => {
    const registry = new SkillRegistry(DEFS.map((d) => ({ id: d.id, def: d.def })));
    const npc = new Npc({
      oid: 'oid-audit3',
      path: asWorldId('pub/audit3', 'engine-audit.test:a3'),
      name: NPC_DEF.name,
      def: NPC_DEF,
      skillRegistry: registry,
    });

    npc.skills.load([
      { id: 'audit/sworda', level: 10, exp: 0, enabled: 'sword' as EnableSlot },
      { id: 'audit/swordb', level: 10, exp: 0, enabled: 'sword' as EnableSlot },
    ]);

    // 修复前：两条记录 enabled 都是 'sword'，而 enabledBySlot 只有后者 ——
    // 于是 contributedProps() 会把**两个**技能的 ② 档都算进 props，
    // 而 activeTemplate('sword') 只认其中一个：账与装配表各说各话。
    expect(npc.skills.entryOf('audit/sworda')?.enabled).toBeNull();
    expect(npc.skills.entryOf('audit/swordb')?.enabled).toBe('sword');
    expect(npc.skills.activeTemplate('sword')?.id).toBe('audit/swordb');
  });
});

// ---------------------------------------------------------------------------
// A4 · 明文通道的 C1 控制字符
// ---------------------------------------------------------------------------

describe('A4 明文通道控制字符', () => {
  it('C1 区（U+0080–U+009F，含 8 位 CSI U+009B）也必须被拒', () => {
    // U+009B 是 8 位 CSI：不经过 ESC(0x1B) 也能触发终端转义序列
    expect(checkPlaintext('look\u009b2J').ok).toBe(false);
    expect(checkPlaintext('look\u0085x').ok).toBe(false);
    expect(checkPlaintext('look\u009fx').ok).toBe(false);
  });

  it('正常中文指令不受影响', () => {
    expect(checkPlaintext('向北走')).toEqual({ ok: true, command: '向北走' });
  });
});

// ---------------------------------------------------------------------------
// A5 · addExp 的负增量
// ---------------------------------------------------------------------------

describe('A5 技能经验下界', () => {
  it('负增量不得把 exp 打成负数（不产生"经验债"）', () => {
    const registry = new SkillRegistry([
      {
        id: 'audit/exp',
        def: { name: '审查技能', type: SKILL_TYPES.SKILL, can_enables: ['sword'] },
      },
    ].map((d) => ({ id: d.id, def: d.def as SkillDef })));
    const npc = new Npc({
      oid: 'oid-audit5',
      path: asWorldId('pub/audit5', 'engine-audit.test:a5'),
      name: NPC_DEF.name,
      def: NPC_DEF,
      skillRegistry: registry,
    });
    npc.skills.learn('audit/exp', 1);
    npc.skills.addExp('audit/exp', 30);
    npc.skills.addExp('audit/exp', -1_000);
    expect(npc.skills.entryOf('audit/exp')?.exp).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// A7 · 0 级技能不得贡献属性（wushen 对照：`release_prop/attach_prop` 的 `if (!lv) return`）
// ---------------------------------------------------------------------------

describe('A7 零级技能的属性贡献', () => {
  it('level = 0 的技能不得贡献属性（含"与等级无关的常数型"属性）', () => {
    // wushen `os/skill/skill.js:65/87`：
    //   SKILL.prototype.release_prop = function (me, lv) { if (!lv) return; ... }
    //   SKILL.prototype.attach_prop  = function (me, lv) { if (!lv) return; ... }
    // 也就是 **lv 为 0 时该技能完全不参与属性计算**。
    // 本项目的记账式重算只看"属性值是不是 0"，不看"等级是不是 0" ——
    // 于是"属性是常数（与 lv 无关）"的技能在 level=0 时仍会被计入。
    const registry = new SkillRegistry([
      {
        id: 'audit/const',
        def: {
          name: '审查常数技能',
          type: SKILL_TYPES.SKILL,
          can_enables: ['sword'],
          // ★ 关键：属性值**与 lv 无关**，所以"跳过 0 值"这条规则救不了场
          passiveProp: () => ({ prop: { gj: 5 } }),
        },
      },
    ].map((d) => ({ id: d.id, def: d.def as SkillDef })));

    const npc = new Npc({
      oid: 'oid-audit7',
      path: asWorldId('pub/audit7', 'engine-audit.test:a7'),
      name: NPC_DEF.name,
      def: NPC_DEF,
      skillRegistry: registry,
    });

    npc.skills.setLevel('audit/const', 0);
    expect(getProp(npc, 'gj')).toBe(0);

    // 升到 1 级后应当生效（别把"0 级不加"误修成"永远不加"）
    npc.skills.setLevel('audit/const', 1);
    expect(getProp(npc, 'gj')).toBe(5);
  });

  it('0 级的**已装配**技能同样不贡献 ② 档属性', () => {
    const registry = new SkillRegistry([
      {
        id: 'audit/const2',
        def: {
          name: '审查常数技能乙',
          type: SKILL_TYPES.SKILL,
          can_enables: ['sword'],
          passiveProp: () => ({ prop: { gj: 1 } }),
          enableProp: () => ({ sword: { prop: { fy: 7 } } }),
        },
      },
    ].map((d) => ({ id: d.id, def: d.def as SkillDef })));

    const npc = new Npc({
      oid: 'oid-audit7b',
      path: asWorldId('pub/audit7b', 'engine-audit.test:a7b'),
      name: NPC_DEF.name,
      def: NPC_DEF,
      skillRegistry: registry,
    });

    npc.skills.learn('audit/const2', 1);
    npc.skills.enable('sword', 'audit/const2');
    expect(getProp(npc, 'fy')).toBe(7);
    npc.skills.setLevel('audit/const2', 0);
    // 装配关系还在，但等级归零 → ① ② 两档都不该继续生效
    expect(npc.skills.entryOf('audit/const2')?.enabled).toBe('sword');
    expect(getProp(npc, 'fy')).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// A6 · RecordingOutput 的内存上界
// ---------------------------------------------------------------------------

describe('A6 输出缓冲上界', () => {
  it('反复 notify 不会让缓冲无限增长（长跑进程的内存面）', () => {
    const out = new RecordingOutput();
    for (let i = 0; i < RECORDING_OUTPUT_LIMIT + 500; i += 1) out.notify(`第 ${i} 条`);
    expect(out.messages.length).toBeLessThanOrEqual(RECORDING_OUTPUT_LIMIT);
    // 保留的是**最近**的（丢最旧的），诊断信息才有用
    expect(out.messages.at(-1)).toBe(`第 ${RECORDING_OUTPUT_LIMIT + 499} 条`);
  });

  it('sendCommands / sendChannel / showItem 同样有上界', () => {
    const out = new RecordingOutput();
    for (let i = 0; i < RECORDING_OUTPUT_LIMIT + 10; i += 1) {
      out.sendCommands('a', 'A');
      out.sendChannel('chat', `第 ${i} 句`);
      out.showItem({ id: `oid-${i}`, name: '测试物件', desc: '用于上界回归。', commands: [] });
    }
    expect(out.commands.length).toBeLessThanOrEqual(RECORDING_OUTPUT_LIMIT);
    expect(out.channelMessages.length).toBeLessThanOrEqual(RECORDING_OUTPUT_LIMIT);
    expect(out.items.length).toBeLessThanOrEqual(RECORDING_OUTPUT_LIMIT);
  });
});

/**
 * G4 世界引用校验 —— **变异用例**：每个用例都构造一处必然违规的引用，
 * 证明校验器真的会红（fix-before-assert 纪律：不允许"加了断言就通过"）。
 *
 * 本文件守**两张表**（都是"可执行的"）：
 *   - `REF_CHECK_PATHS`   跨对象引用点（出口 / 掉落 / 技能 id …）
 *   - `VOCAB_CHECK_PATHS` 闭集词汇检查点（装配槽名 / 核心属性键）
 * 任何一张加了行却没实现校验 → 数量对不上 → 立刻变红。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { clearAll } from '../server/engine/registry.js';
import type { RoomDef, SkillDef } from '../server/world/defs.js';
import { SKILL_TYPES } from '../shared/constants.js';
import type { EnableSlot, PropKey } from '../shared/constants.js';
import {
  defineArea,
  defineFamily,
  defineItem,
  defineNpc,
  defineRoom,
  defineSkill,
} from '../server/world/define.js';
import { REF_CHECK_PATHS, VOCAB_CHECK_PATHS, validateWorld } from '../server/world/validate.js';

type Exits = NonNullable<RoomDef['exits']>;

const errorsOf = () => validateWorld().filter((p) => p.level === 'error');

describe('G4 世界引用校验', () => {
  beforeEach(() => {
    clearAll();
  });

  it('引用都存在 → 无 error（对照组）', () => {
    defineRoom('yz/a', { name: 'A', desc: 'd', exits: { north: 'yz/b' } });
    defineRoom('yz/b', { name: 'B', desc: 'd', exits: { south: 'yz/a' } });
    expect(errorsOf()).toEqual([]);
  });

  it('【变异】出口指向不存在的房间 → 必须报错', () => {
    defineRoom('yz/a', {
      name: 'A',
      desc: 'd',
      exits: { north: 'yz/does_not_exist' },
    });
    const errs = errorsOf();
    expect(errs).toHaveLength(1);
    expect(errs[0]?.message).toContain('does_not_exist');
  });

  it('【变异】房间放不存在的 NPC → 必须报错', () => {
    defineRoom('yz/a', { name: 'A', desc: 'd', npcs: ['pub/nobody'] });
    expect(errorsOf().some((e) => e.message.includes('pub/nobody'))).toBe(true);
  });

  it('【变异】掉落表指向不存在的物品 → 必须报错', () => {
    defineNpc('pub/mob', { name: '怪', desc: 'd', drops: [{ obj: 'drug/none' }] });
    expect(errorsOf().some((e) => e.message.includes('drug/none'))).toBe(true);
  });

  it('【变异】非法方向键 → 必须报错（类型系统挡不住时由运行时兜底）', () => {
    const badExits = { nrth: 'yz/a' } as unknown as Exits;
    defineRoom('yz/a', { name: 'A', desc: 'd', exits: badExits });
    expect(errorsOf().some((e) => e.message.includes('非法方向键'))).toBe(true);
  });

  it('【变异】区域入口指向不存在的房间 → 必须报错', () => {
    defineRoom('yz/a', { name: 'A', desc: 'd' });
    defineArea('zz', { name: '空区', first: 'zz/none' });
    expect(errorsOf().some((e) => e.message.includes('zz/none'))).toBe(true);
  });
});

describe('M2 引用表必须与实现耦合（★ docs/26 M2 回归）', () => {
  beforeEach(() => {
    clearAll();
  });

  /**
   * 构造一个"**每个引用点都坏掉**"的世界。
   * 这样"哪些引用点被校验了"就能从 error 清单里**反推**出来 ——
   * 于是 REF_CHECK_PATHS 这张表不可能悄悄变成谎言：
   * 加了表却不实现校验 → 数量对不上 → 立刻变红。
   *
   * 旧实现（`shared/ids.ts` 的 `REF_EXPECTS`）之所以腐烂，正是因为没人拿它做断言。
   */
  function brokenWorld(): void {
    defineRoom('yz/a', {
      name: 'A',
      desc: 'd',
      exits: { north: 'yz/miss_room' },
      npcs: ['yz/miss_npc'],
      objects: ['yz/miss_item'],
    });
    defineArea('yz', { name: 'Y', first: 'yz/miss_first' });
    defineNpc('yz/mob', {
      name: 'M',
      desc: 'd',
      drops: [{ obj: 'yz/miss_drop' }],
      skills: [{ skill: 'yz/miss_skill', level: 1 }],
    });
    defineItem('yz/i', { name: 'I', combine_to: 'yz/miss_combine' });
    // 注意：`yz/s` **不写** can_enables —— 那个字段已经不属于"引用点"（见 VOCAB 那一节）
    defineSkill('yz/s', { name: 'S' });
    defineFamily('yz/f', {
      name: 'F',
      family_area: 'yz/miss_fam_area',
      skills: ['yz/miss_fam_skill'],
    });
  }

  it('★ 每个声明的引用点都**真的**被校验（数量与去重双重对账）', () => {
    brokenWorld();
    const errors = errorsOf();
    expect(errors.length).toBe(REF_CHECK_PATHS.length);
    // 一个引用点只报一次（去重后数量不变 ⇒ 没有重复报，也没有漏报）
    expect(new Set(errors.map((e) => e.where)).size).toBe(errors.length);
  });

  it('★ 声明的字段名必须真实出现在报错定位里', () => {
    brokenWorld();
    const wheres = errorsOf().map((e) => e.where).join('\n');
    const fields = ['exits', 'npcs', 'objects', 'first', 'drops', 'skills', 'combine_to', 'family_area'];
    for (const f of fields) {
      expect(wheres, `字段 ${f} 没有任何报错定位命中它`).toContain(f);
    }
  });

  it('对照：同样的世界把引用全修好 → 一个 error 都没有（排除"恒定报错"）', () => {
    defineRoom('yz/a', { name: 'A', desc: 'd' });
    defineArea('yz', { name: 'Y', first: 'yz/a' });
    expect(errorsOf()).toEqual([]);
  });
});

describe('★ 闭集词汇表也必须与实现耦合（docs/27 D1）', () => {
  beforeEach(() => {
    clearAll();
  });

  /**
   * 与上面 `brokenWorld` 同一手法，只不过坏掉的是**闭集词汇**而不是引用：
   * 每个检查点各塞一个"肯定不在词表里"的值。
   */
  function brokenVocabWorld(): void {
    defineNpc('yz/mob', {
      name: 'M',
      desc: 'd',
      // 槽名写成了一个内容技能 id（"双 id 空间"那个老毛病）
      skills: [{ skill: 'yz/s', level: 1, enableAs: 'base/force' as unknown as EnableSlot }],
    });
    defineSkill('yz/s', {
      name: 'S',
      can_enables: ['base/force' as unknown as EnableSlot],
      learnCondition: {
        minSlot: { base: 1 },
        // ★ §66 起数据键是英文，`attack` 已经是**合法**键 ⇒ 这里改用旧拼音 `gj`
        //   当"肯定不在词表里"的样本（它也是最容易被从 wushen 抄回来的那一个）。
        minAttr: { gj: 1 },
      } as unknown as NonNullable<SkillDef['learnCondition']>,
    });
  }

  it('★ 每个声明的词汇检查点都**真的**被校验（数量与去重双重对账）', () => {
    brokenVocabWorld();
    const errors = errorsOf();
    expect(errors.length).toBe(VOCAB_CHECK_PATHS.length);
    expect(new Set(errors.map((e) => e.where)).size).toBe(errors.length);
  });

  it('★ 报错定位必须命中字段名，且信息里点名了哪个词表', () => {
    brokenVocabWorld();
    const text = errorsOf()
      .map((e) => `${e.where} :: ${e.message}`)
      .join('\n');
    for (const f of ['enableAs', 'can_enables', 'minSlot', 'minAttr']) {
      expect(text, `字段 ${f} 没有被校验`).toContain(f);
    }
    // 词表名要让作者一眼知道去哪儿查：
    //   ENABLE_SLOTS 会把 11 个槽名列全；PROP_KEY 只给"MOD 族"这类可读提示（400+ 个键列不完）
    expect(text).toContain('sword');
    expect(text).toContain('MOD');
  });

  it('对照：词表内的值一律放行（排除"恒定报错"）', () => {
    defineNpc('yz/mob', {
      name: 'M',
      desc: 'd',
      skills: [{ skill: 'base/sword', level: 1, enableAs: 'sword' }],
    });
    defineSkill('base/sword', {
      name: '基本剑法',
      type: SKILL_TYPES.BASE,
      slot: 'sword',
      can_enables: ['sword'],
      learnCondition: { minSlot: { sword: 1 }, minAttr: { attack: 1 } },
    });
    expect(errorsOf()).toEqual([]);
  });
});

describe('L3 / L4 引用校验的两处收敛（★ docs/26 L3、L4 回归）', () => {
  beforeEach(() => {
    clearAll();
  });

  it('★ L3：`enableAs` 只认**装配槽名** —— 注册 id（base/force）必须被拒', () => {
    // 前提：`base/force` 确实是一个**已注册**的 skill id。
    // 这正是旧实现的漏洞：双 id 空间下 'base/force' 走注册表查询、能查到，
    // 于是同一个字段既能写裸名又能写注册 id。
    // 现在它连"是不是槽名"这一关都过不了 —— 与有没有注册无关。
    defineSkill('base/force', { name: '基本内功', type: SKILL_TYPES.BASE, slot: 'force' });
    defineNpc('yz/mob', {
      name: '怪',
      desc: 'd',
      skills: [{ skill: 'base/force', level: 1, enableAs: 'base/force' as unknown as EnableSlot }],
    });
    const errs = errorsOf();
    expect(errs).toHaveLength(1);
    expect(errs[0]?.where).toContain('enableAs');
    expect(errs[0]?.message).toContain('装配槽名');
  });

  it('★ L3：裸槽名照旧合法（收敛的是"多一套写法"，不是"把功能删了"）', () => {
    defineSkill('base/force', { name: '基本内功', type: SKILL_TYPES.BASE, slot: 'force' });
    defineNpc('yz/mob', {
      name: '怪',
      desc: 'd',
      skills: [{ skill: 'base/force', level: 1, enableAs: 'force' }],
    });
    expect(errorsOf()).toEqual([]);
  });

  it('★ L3：`can_enables` 同理 —— 写内容技能 id 必须被拒，写槽名才放行', () => {
    defineSkill('wd/bad', { name: '坏剑法', can_enables: ['base/sword' as unknown as EnableSlot] });
    defineSkill('wd/good', { name: '好剑法', can_enables: ['sword'] });
    const errs = errorsOf();
    expect(errs).toHaveLength(1);
    expect(errs[0]?.where).toContain('can_enables');
    expect(errs[0]?.message).toContain('base/sword');
  });

  it('★ L3 补：`learnCondition.minAttr` 只认合法 PropKey（旧拼音键 `gj` 必须被拒）', () => {
    // ★ 2026-10-18 §66 反转了这条：改英文之前 `attack` 是"看着对的错键"，
    //   现在是 `gj` —— 从 wushen 抄内容时**最容易**写回来的那一个。
    //   ⇒ 断言方向换了，但守的东西没变：minAttr 的键必须 ∈ CORE∪MOD。
    defineSkill('wd/x', {
      name: 'X',
      learnCondition: { minAttr: { gj: 10 } as unknown as Partial<Record<PropKey, number>> },
    });
    const errs = errorsOf();
    expect(errs).toHaveLength(1);
    expect(errs[0]?.where).toContain('minAttr');
    expect(errs[0]?.message).toContain('gj');
  });

  it('★ L4：变体与基对象共享的同一条坏引用，只报**一次**（不按变体数翻倍）', () => {
    defineRoom('yz/a', {
      name: 'A',
      desc: 'd',
      exits: { north: 'yz/nope' },
      // 3 个变体 → 旧实现会把同一条坏引用报 4 次（基 + 3 变体）
      variants: { '0': {}, '1': {}, '2': {} },
    });
    const errs = errorsOf();
    expect(errs).toHaveLength(1);
    // 定位到**基 id**，便于作者直接去看那个文件
    expect(errs[0]?.where).toContain('room "yz/a"');
  });

  it('★ L4：变体**独有**的坏引用仍然会被查到（去重不能变成漏检）', () => {
    defineRoom('yz/a', { name: 'A', desc: 'd', objects: [] });
    defineRoom('yz/b', {
      name: 'B',
      desc: 'd',
      objects: ['drug/ok'],
      variants: { '0': { objects: ['drug/ok', 'drug/missing'] } },
    });
    defineItem('drug/ok', { name: '物品' });
    const errs = errorsOf();
    expect(errs).toHaveLength(1);
    expect(errs[0]?.message).toContain('drug/missing');
  });
});

// ---------------------------------------------------------------------------
// ★ 同一 NPC 两条技能抢同一槽（2026-10-13 体检 E2）
// ---------------------------------------------------------------------------
//
// 技能簿已经保证"先者被挤下"（不会静默分家），但**挤下是有损的**：
// 作者多半想写两个不同的槽，写重了却没有任何提示，只会在运行期丢一个技能。
// 内容层的这类错误应当在**启动期**就报出来 —— 这是 `validate.ts` 的职责。

describe('★ 同一 NPC 两条技能抢同一装配槽 → 启动期报错', () => {
  beforeEach(() => {
    clearAll();
  });

  it('【变异】两条技能 enableAs 同槽 → 报 error，并点名是哪两条', () => {
    defineSkill('yz/a', { name: '甲法', type: SKILL_TYPES.SKILL, can_enables: ['sword'] });
    defineSkill('yz/b', { name: '乙法', type: SKILL_TYPES.SKILL, can_enables: ['sword'] });
    defineNpc('yz/mob', {
      name: 'M',
      desc: 'd',
      skills: [
        { skill: 'yz/a', level: 10, enableAs: 'sword' },
        { skill: 'yz/b', level: 10, enableAs: 'sword' },
      ],
    });

    const errs = errorsOf();
    expect(errs).toHaveLength(1);
    expect(errs[0]?.where).toContain('enableAs');
    // ★ 报错必须能直接定位到**哪两个技能**（否则作者还得自己回去比对）
    expect(errs[0]?.message).toContain('yz/a');
    expect(errs[0]?.message).toContain('yz/b');
    expect(errs[0]?.message).toContain('sword');
  });

  it('对照：两条技能用**不同**槽 → 一个 error 都没有（排除"恒定报错"）', () => {
    defineSkill('yz/a', { name: '甲法', type: SKILL_TYPES.SKILL, can_enables: ['sword', 'blade'] });
    defineSkill('yz/b', { name: '乙法', type: SKILL_TYPES.SKILL, can_enables: ['sword', 'blade'] });
    defineNpc('yz/mob', {
      name: 'M',
      desc: 'd',
      skills: [
        { skill: 'yz/a', level: 10, enableAs: 'sword' },
        { skill: 'yz/b', level: 10, enableAs: 'blade' },
      ],
    });
    expect(errorsOf()).toEqual([]);
  });
});

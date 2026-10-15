/**
 * G3 · 常量对账（可执行部分）
 * ============================================================================
 * 依据 docs/24 §3。核心断言：**运行时守卫必须与编译期类型逐字符串等价**。
 *
 * 为什么这条最重要：wushen 的 121 vs 70 之所以能长期存在，不是因为"没人写表"，
 * 而是因为**读写属性的 API 接受任意 string**——类型与运行时两套规则，各自演化，
 * 最后谁也不知道哪个键算合法。本文件就是把两套规则焊死在一起。
 *
 * 本文件同时充当方向短写错位（wushen 缺陷 #25）的回归防护。
 */
import {
  BASE_SKILLS,
  COMMAND_GATES,
  COMMAND_GATE_DEFAULTS,
  DIRECTIONS,
  DIRECTION_ALIASES,
  DIRECTION_LABELS,
  ENABLE_SLOTS,
  EQUIP_TYPE,
  GRADE_COMBINE_COUNT,
  MAX_GRADE,
  PROPERTIES,
  SKILL_TYPES,
  WEAPON_TYPE,
  isCoreProp,
  isEnableSlot,
  isPropKey,
  normalizeDirection,
  registerExtProp,
  type CoreProp,
} from '@shared/constants.js';
import { describe, expect, it } from 'vitest';

// ---------------------------------------------------------------------------
// 从源码表**推导**出 `PropKey` 类型的精确展开。
// PropKey = CoreProp | `${C}_per` | `diff_${C}` | `diff_${C}_per`
//                  | `add_${C}` | `add_${C}_per`     （C ∈ CoreProp，共 6 族）
// 因此这里枚举 6 族 == 类型展开，不是"抄一份期望值"。
// ---------------------------------------------------------------------------
const CORE_KEYS = Object.keys(PROPERTIES) as CoreProp[];

function expandPropKey(): Set<string> {
  const out = new Set<string>();
  for (const c of CORE_KEYS) {
    out.add(c);
    out.add(`${c}_per`);
    out.add(`diff_${c}`);
    out.add(`diff_${c}_per`);
    out.add(`add_${c}`);
    out.add(`add_${c}_per`);
  }
  return out;
}

const PROP_KEY_SET = expandPropKey();

describe('G3.1 isPropKey() ≡ PropKey（类型 ↔ 运行时守卫等价）', () => {
  it('对全部类型合法键都必须返回 true（接受性）', () => {
    const rejected = [...PROP_KEY_SET].filter((k) => !isPropKey(k)).sort();
    expect(rejected, `以下键类型合法但运行时守卫拒绝：${rejected.join(', ')}`).toEqual([]);
  });

  it('对全部非类型键都必须返回 false（拒绝性）', () => {
    // 近邻噪声：拼错、大小写、分隔符、空段、看似合法实则越界
    const noise = [
      '',
      '_per',
      'per_',
      'diff_',
      'add_',
      'diff__per',
      'add__per',
      'attack',
      'defence',
      'defense',
      'gjsd_peer',
      'gj_pere',
      'GJ',
      'PER',
      'diff_Per',
      'diff_GJ',
      'gj-per',
      'diff_gj_per2',
      'add_gj_per2',
      'diff_foo',
      'foo_per',
      'diff_diff_gj_per_per_per',
      '0gj',
      ' gj',
      'gj ',
    ];
    const wronglyAccepted = noise.filter((k) => isPropKey(k));
    expect(wronglyAccepted, `以下键类型非法但运行时守卫接受：${wronglyAccepted.join(', ')}`).toEqual([]);
  });

  it('短键 `per`（容貌）是合法核心键，绝不能被当成噪声拒掉', () => {
    // 反向锚点：`per` 同时是 ModProp 的后缀词，容易在守卫里被误伤
    expect(isCoreProp('per')).toBe(true);
    expect(isPropKey('per')).toBe(true);
  });

  it('★ 回归锚点：以 `_per` 结尾的核心键，其 `_per` 派生键不得被漏判', () => {
    // 这是首轮实测发现的真实漏判：`diff_sh_per` 本身是核心键，
    // 于是 `diff_sh_per_per` 在类型上合法，但旧守卫"剥一层 diff_ + 剥一层 _per"
    // 得到 `sh_per`（非核心）→ 误判为非法。
    const tailPerCore = CORE_KEYS.filter((c) => c.endsWith('_per'));
    expect(tailPerCore.length).toBeGreaterThan(0); // 前提：表里确实有这类键

    const anchors = tailPerCore
      .map((c) => `${c}_per`)
      .filter((k) => !isPropKey(k))
      .sort();
    expect(anchors, `漏判的 _per 派生键：${anchors.join(', ')}`).toEqual([]);
  });
});

describe('G3.2 PROPERTIES 表自身', () => {
  it('键符合命名法（小写 + 数字 + 下划线，首字符为字母）', () => {
    const bad = CORE_KEYS.filter((k) => !/^[a-z][a-z0-9_]*$/.test(k));
    expect(bad).toEqual([]);
  });

  it('每个键都有非空中文显示名', () => {
    const bad = CORE_KEYS.filter((k) => PROPERTIES[k].trim() === '');
    expect(bad, `显示名为空：${bad.join(', ')}`).toEqual([]);
  });

  it('键数与本项目复核所得的 76 一致（表被偷偷增删必须显式改此断言）', () => {
    expect(CORE_KEYS.length).toBe(76);
  });

  it('isCoreProp 与 PROPERTIES 一致（不因原型链误判）', () => {
    expect(CORE_KEYS.every((k) => isCoreProp(k))).toBe(true);
    // toString / constructor 等原型成员绝不能被当成属性键
    for (const evil of ['toString', 'constructor', '__proto__', 'hasOwnProperty']) {
      expect(isCoreProp(evil), `${evil} 被误判为核心属性`).toBe(false);
      expect(isPropKey(evil), `${evil} 被误判为属性键`).toBe(false);
    }
  });
});

describe('G3.3 方向短写（wushen 缺陷 #25 回归防护）', () => {
  /** 标准短写 = 方向名中每个方位词的**首字母按序拼接**（northup→nu, southwest→sw） */
  function expectedShort(d: string): string | null {
    const words = d.match(/north|south|east|west|up|down/g);
    return words === null ? null : words.map((w) => w[0]).join('');
  }

  it('每个可短写的方向，其标准短写都必须映射回它自己', () => {
    const wrong: string[] = [];
    for (const d of DIRECTIONS) {
      const short = expectedShort(d);
      if (short === null) continue; // enter / out 无短写
      if (DIRECTION_ALIASES[short] !== d) {
        wrong.push(`${short} → ${String(DIRECTION_ALIASES[short])}（应为 ${d}）`);
      }
    }
    expect(wrong, `方向短写错位：\n  ${wrong.join('\n  ')}`).toEqual([]);
  });

  it('★ 回归锚点：s→south、w→west（wushen 里是 s→west、w→south）', () => {
    expect(DIRECTION_ALIASES['s']).toBe('south');
    expect(DIRECTION_ALIASES['w']).toBe('west');
    expect(DIRECTION_ALIASES['se']).toBe('southeast');
    expect(DIRECTION_ALIASES['nw']).toBe('northwest');
    expect(DIRECTION_ALIASES['ne']).toBe('northeast');
    expect(DIRECTION_ALIASES['sw']).toBe('southwest');
  });

  it('所有短写值都必须是合法方向', () => {
    const all = new Set<string>(DIRECTIONS);
    const bad = Object.entries(DIRECTION_ALIASES).filter(([, v]) => !all.has(v));
    expect(bad).toEqual([]);
  });

  it('每个方向都有且仅有一个短写（除 enter/out）', () => {
    const covered = new Set(Object.values(DIRECTION_ALIASES));
    const missing = DIRECTIONS.filter((d) => d !== 'enter' && d !== 'out' && !covered.has(d));
    expect(missing, `无短写的方向：${missing.join(', ')}`).toEqual([]);
    expect(Object.keys(DIRECTION_ALIASES).length).toBe(DIRECTIONS.length - 2);
  });

  it('normalizeDirection 全称与短写等价，未知输入返回 null', () => {
    for (const d of DIRECTIONS) expect(normalizeDirection(d)).toBe(d);
    for (const [short, d] of Object.entries(DIRECTION_ALIASES)) {
      expect(normalizeDirection(short)).toBe(d);
    }
    for (const junk of ['', 'x', 'SOUTH', 'North', 'northeastup']) {
      expect(normalizeDirection(junk), `${junk} 不应被解析为方向`).toBeNull();
    }
  });
});

describe('G3.3b 方向显示名（DIRECTION_LABELS）—— 共享层单源', () => {
  it('覆盖恰好 = DIRECTIONS（一个不多、一个不少）', () => {
    expect(Object.keys(DIRECTION_LABELS).sort()).toEqual([...DIRECTIONS].sort());
    expect(Object.keys(DIRECTION_LABELS).length).toBe(DIRECTIONS.length);
  });

  it('每个显示名都非空，且**互不相同**（否则两个方向在界面上分不开）', () => {
    const values = Object.values(DIRECTION_LABELS);
    expect(values.every((v) => typeof v === 'string' && v.trim() !== '')).toBe(true);
    expect(new Set(values).size).toBe(values.length);
  });

  it('★ 四个基本方位就是 北/南/东/西（回归锚点：这些字会直接印在出口卡片与小地图格子上）', () => {
    expect(DIRECTION_LABELS['north']).toBe('北');
    expect(DIRECTION_LABELS['south']).toBe('南');
    expect(DIRECTION_LABELS['east']).toBe('东');
    expect(DIRECTION_LABELS['west']).toBe('西');
  });

  it('★ 显示名与短写**不是**同一张表（一个是输出显示、一个是输入归一化）', () => {
    // 若有人"顺手合并"，这里会变红：短写表里根本没有 'north' 这个键
    expect(Object.keys(DIRECTION_ALIASES)).not.toEqual(Object.keys(DIRECTION_LABELS));
    expect(DIRECTION_LABELS).not.toHaveProperty('n');
  });
});

describe('G3.4 其余常量表的一致性', () => {
  it('COMMAND_GATE_DEFAULTS 的键集与 COMMAND_GATES 完全一致', () => {
    expect(Object.keys(COMMAND_GATE_DEFAULTS).sort()).toEqual([...COMMAND_GATES].sort());
  });

  it('allow_fight 是唯一默认为 true 的闸门（战斗中默认可执行）', () => {
    const truthy = COMMAND_GATES.filter((g) => COMMAND_GATE_DEFAULTS[g]);
    expect(truthy).toEqual(['allow_fight']);
  });

  it('EQUIP_TYPE 的槽位值不重复', () => {
    const vals = Object.values(EQUIP_TYPE);
    expect(new Set(vals).size).toBe(vals.length);
  });

  it('WEAPON_TYPE / SKILL_TYPES / BASE_SKILLS 的值不重复', () => {
    const tables: ReadonlyArray<Readonly<Record<string, unknown>>> = [
      WEAPON_TYPE,
      SKILL_TYPES,
      BASE_SKILLS,
    ];
    for (const table of tables) {
      const vals = Object.values(table);
      expect(new Set(vals).size).toBe(vals.length);
    }
  });

  it('合成数量表长度 == MAX_GRADE + 1（0..MAX_GRADE 每阶一个）', () => {
    expect(GRADE_COMBINE_COUNT.length).toBe(MAX_GRADE + 1);
    expect([...GRADE_COMBINE_COUNT]).toEqual([...GRADE_COMBINE_COUNT].sort((a, b) => a - b));
  });

  it('★ ENABLE_SLOTS ≡ BASE_SKILLS ∪ WEAPON_TYPE（集合等价，机检而非人眼）', () => {
    // docs/27 决策 D1：wushen 把"装配槽"拆在 BASE_SKILLS（4 个）与 WEAPON_TYPE（7 个）
    // 两处、且**代码里从不列出全集**，于是槽名拼错不会有任何东西报错 ——
    // 它会静默变成一个取不到技能的空槽（`init_skill()` 直接拿 weapon_type 当槽名）。
    // 本项目合并成一个闭集；这条断言保证"合并"是**真的**合并，不是又抄了一份。
    const union = new Set<string>([...Object.values(BASE_SKILLS), ...Object.values(WEAPON_TYPE)]);
    const slots = new Set<string>(ENABLE_SLOTS);
    expect([...slots].sort()).toEqual([...union].sort());
    // 去重：重复项会让"槽有几个"这个数直接撒谎
    expect(ENABLE_SLOTS.length).toBe(slots.size);
  });

  it('★ isEnableSlot() ≡ EnableSlot（类型 ↔ 运行时守卫等价，双向）', () => {
    for (const slot of ENABLE_SLOTS) {
      expect(isEnableSlot(slot), `${slot} 是合法槽却守卫拒绝`).toBe(true);
    }
    // 近邻噪声：注册 id 形态（曾经的"双 id 空间"）、大小写、分隔符、空串
    const noise = [
      'base/force',
      'base/sword',
      'Sword',
      'SWORD',
      'sword ',
      ' sword',
      '',
      'base',
      'force1',
      'unarmed_fist',
      'toString',
      '__proto__',
    ];
    const wronglyAccepted = noise.filter((x) => isEnableSlot(x));
    expect(wronglyAccepted, `以下不是槽名但守卫接受：${wronglyAccepted.join(', ')}`).toEqual([]);
  });
});

describe('G3.5 registerExtProp 契约（EXT 层开放集，但必须登记）', () => {
  it('拒绝不符合命名法的键（大写 / 连字符 / 空）', () => {
    for (const bad of ['Tjj_Gj', 'tjj-gj', '', '1abc', 'tjj gj']) {
      expect(() => registerExtProp(bad, { display: 'x', owner: 'skill:t' }), bad).toThrow();
    }
  });

  it('拒绝与核心属性重名的扩展键（否则双层结构失去意义）', () => {
    expect(() => registerExtProp('gj', { display: 'x', owner: 'skill:t' })).toThrow();
  });

  it('★ 回归锚点：与**派生键（MOD 族）**冲突的扩展键必须被拒绝', () => {
    // 首轮审查实测缺陷（docs/26 H1）：守卫原来是 `isCoreProp(key)`，
    // 只挡住 PROPERTIES 表里**列出来**的键。但 `add_gj` / `diff_mz` / `con_per`
    // 这类键不在表里、却完全符合 `add_${CoreProp}` 形状 —— 于是同一个字符串
    // 既是合法 `PropKey`（参与核心公式）又是 `ExtProp`（不参与核心公式），
    // 24 册 §3.3 的"扩展键永不参与核心公式"当场失效。
    const modOnlySamples = [
      'add_gj', // = add_ + gj
      'diff_mz', // = diff_ + mz
      'con_per', // = con + _per
      'add_con', // = add_ + con
      'diff_con_per', // = diff_ + con + _per
    ];
    for (const k of modOnlySamples) {
      // 前提断言：这些键在**类型层面**确实是合法 PropKey（否则样本无意义）
      expect(isPropKey(k), `${k} 应为合法 PropKey`).toBe(true);
      expect(isCoreProp(k), `${k} 不应是核心键（否则本样本守的是另一条规则）`).toBe(false);
      expect(() => registerExtProp(k, { display: 'x', owner: 'skill:t' }), k).toThrow();
    }
  });

  it('同一 owner 重复登记幂等；不同 owner 抢同一键 → 抛错', () => {
    const key = 'g3_probe_key';
    registerExtProp(key, { display: '探针', owner: 'skill:probe' });
    expect(() => registerExtProp(key, { display: '探针2', owner: 'skill:probe' })).not.toThrow();
    expect(() => registerExtProp(key, { display: '探针3', owner: 'item:other' })).toThrow();
  });

  it('返回值可直接用作属性键（登记过 = 可用）', () => {
    const k = registerExtProp('g3_probe_usable', { display: '探针', owner: 'skill:probe' });
    // 编译期用途见 server/world/defs.ts 的 PropKeyOrExt
    expect(typeof k).toBe('string');
    expect(k).toBe('g3_probe_usable');
  });
});

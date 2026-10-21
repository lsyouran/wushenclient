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
  LEGACY_PINYIN_KEYS,
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
      // ★ 2026-10-18 §66：数据键改英文后，噪声样本同步换成**英文本名的近邻错误**
      //   —— 用旧拼音当噪声已经没有意义了（`gj` 不在表里，谁都会拒）
      'per', // 纯后缀词，不是核心键（容貌已改名 appearance）
      'defence', // 英式拼写
      'defens', // 少一个 e
      'attacke',
      'attack_speeds',
      'eveision', // 换位
      'APPEARANCE', // 大小写
      'diff_Per',
      'diff_ATTACK',
      'attack-per', // 连字符
      'diff_attack_per2', // 尾数 2 只对 damage/defense 两族登记过
      'add_attack_per2',
      'diff_foo',
      'foo_per',
      'diff_diff_attack_per_per_per',
      '0attack',
      ' attack',
      'attack ',
      // 旧拼音键：现在是**非法**的，必须被拒（wushen 移植时最容易写回来的一批）
      'gj',
      'fy',
      'ds',
      'zj',
      'mz',
      'bj_per',
      'gjsd',
      'gj_per',
      'diff_sh_per',
      'add_bjsh_per',
    ];
    const wronglyAccepted = noise.filter((k) => isPropKey(k));
    expect(wronglyAccepted, `以下键类型非法但运行时守卫接受：${wronglyAccepted.join(', ')}`).toEqual([]);
  });

  it('`appearance`（容貌）是合法核心键，而纯后缀词 `per` 不是', () => {
    // ★ 2026-10-18 §66：旧键 `per` 本身是核心键、又恰好是 ModProp 的后缀词，
    //   守卫里极易被误伤（旧注释把它列为反面样本）。改名 `appearance` 之后
    //   这颗雷拆掉了 —— 于是这里能反过来断言：`per` 就是**不合法**。
    //   ★ 注意这**不是**风格问题：`isCoreProp('per')` 若为 true，说明有人把
    //     旧键写回了核心表，而 `baseline` 里的旧拼音样本会同时变绿。
    expect(isCoreProp('appearance')).toBe(true);
    expect(isPropKey('appearance')).toBe(true);
    expect(isCoreProp('per')).toBe(false);
    expect(isPropKey('per')).toBe(false);
  });

  it('★ 回归锚点：以 `_per` 结尾的核心键，其 `_per` 派生键不得被漏判', () => {
    // 这是首轮实测发现的真实漏判：`diff_damage_per`（旧 `diff_sh_per`）本身是核心键，
    // 于是 `diff_damage_per_per` 在类型上合法；同理 `add_crit`（旧 `add_bj_per`）
    // 也合法。而旧守卫会**一次剥掉前缀 + 后缀**，多剥一层之后拿到 `damage_per`
    // / `crit` 之类非核心词 ⇒ 误判为非法。修法是按 6 个族各自独立判定。
    const tailPerCore = CORE_KEYS.filter((c) => c.endsWith('_per'));
    expect(tailPerCore.length).toBeGreaterThan(0); // 前提：表里确实有这类键

    const anchors = tailPerCore
      .map((c) => `${c}_per`)
      .filter((k) => !isPropKey(k))
      .sort();
    expect(anchors, `漏判的 _per 派生键：${anchors.join(', ')}`).toEqual([]);
  });
});

describe('G3.1b 旧拼音对照表（LEGACY_PINYIN_KEYS，§66 改名时冻结）', () => {
  const entries = Object.entries(LEGACY_PINYIN_KEYS);

  it('表非空（G3.A 的"请改用 X"文案靠它，空了就只剩一句泛泛的报错）', () => {
    expect(entries.length).toBeGreaterThan(0);
  });

  it('每个值都是**当下合法**的核心键 —— 再改一次名会编译失败/这里变红，逼着同步', () => {
    const bad = entries.filter(([, v]) => !isCoreProp(v)).map(([k, v]) => `${k}→${v}`);
    expect(bad, `指向了不存在的核心键：${bad.join(', ')}`).toEqual([]);
  });

  it('★★ 每个旧键都**不再是**合法 PropKey —— 否则"改名"没改干净', () => {
    // 这条是反向锚：若谁把旧拼音键又加回 PROPERTIES（"为了兼容"），
    // 这里立刻变红，而 G3.A 的黑名单也会同时失去意义（旧键不再违规）。
    const stillValid = entries.filter(([k]) => isPropKey(k)).map(([k]) => k);
    expect(stillValid, `以下旧键仍是合法 PropKey：${stillValid.join(', ')}`).toEqual([]);
  });

  it('映射互不重复（两个旧键指到同一个新键 = 抄错了）', () => {
    const seen = new Map<string, string>();
    const dup: string[] = [];
    for (const [k, v] of entries) {
      const prev = seen.get(v);
      if (prev === undefined) seen.set(v, k);
      else dup.push(`${prev} 与 ${k} 都指向 ${v}`);
    }
    expect(dup, `重复映射：${dup.join('; ')}`).toEqual([]);
  });

  it('★ 抽样钉住几个最容易抄错的（不是全表对账，是防"整表被换掉"）', () => {
    expect(LEGACY_PINYIN_KEYS.gj).toBe('attack');
    expect(LEGACY_PINYIN_KEYS.bj_per).toBe('crit');
    expect(LEGACY_PINYIN_KEYS.per).toBe('appearance');
    expect(LEGACY_PINYIN_KEYS.con1).toBe('innate_con');
    expect(LEGACY_PINYIN_KEYS.dazuo).toBe('meditation');
    expect(LEGACY_PINYIN_KEYS.score).toBe('instance_score');
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
    for (const bad of ['Tjj_Attack', 'tjj-attack', '', '1abc', 'tjj attack']) {
      expect(() => registerExtProp(bad, { display: 'x', owner: 'skill:t' }), bad).toThrow();
    }
  });

  it('拒绝与核心属性重名的扩展键（否则双层结构失去意义）', () => {
    expect(() => registerExtProp('attack', { display: 'x', owner: 'skill:t' })).toThrow();
  });

  it('★ 回归锚点：与**派生键（MOD 族）**冲突的扩展键必须被拒绝', () => {
    // 首轮审查实测缺陷（docs/26 H1）：守卫原来是 `isCoreProp(key)`，
    // 只挡住 PROPERTIES 表里**列出来**的键。但 `add_gj` / `diff_mz` / `con_per`
    // 这类键不在表里、却完全符合 `add_${CoreProp}` 形状 —— 于是同一个字符串
    // 既是合法 `PropKey`（参与核心公式）又是 `ExtProp`（不参与核心公式），
    // 24 册 §3.3 的"扩展键永不参与核心公式"当场失效。
    const modOnlySamples = [
      'add_attack', // = add_ + attack
      'diff_hit', // = diff_ + hit
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

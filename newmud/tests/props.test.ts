/**
 * 属性访问器 —— 含**变异**用例。
 * 依据 docs/24 §3.3：核心属性与扩展属性能且仅能通过各自入口读写。
 *
 * 变异思路：每条防护都先给出"没有它会怎样"的对照（多为复刻 wushen 旧实现），
 * 再断言现在会拦下来 —— 否则就是"加了断言但断言没在守任何东西"。
 */
import { registerExtProp } from '@shared/constants.js';
import type { ExtProp } from '@shared/constants.js';
import { describe, expect, it } from 'vitest';
import {
  addExtProp,
  addProp,
  clearAllProps,
  clearProps,
  createPropHolder,
  getExtProp,
  getProp,
  hasExtProp,
  hasProp,
  loadProps,
  PropValueError,
  removeExtProp,
  removeProp,
  setExtProp,
  setProp,
  snapshotProps,
} from '../server/engine/props.js';

const EXT = registerExtProp('props_test_key', { display: '访问器测试', owner: 'skill:probe' });
const EXT2 = registerExtProp('props_test_key2', { display: '访问器测试二', owner: 'skill:probe' });

/** 把任意值伪装成 number，用于模拟 JS 调用方 / 协议传入的脏数据 */
const dirty = (v: unknown): number => v as number;

describe('核心属性：读写语义对齐 wushen', () => {
  it('未设置读作 0（不是 undefined）——与 query_prop 一致', () => {
    const h = createPropHolder();
    expect(getProp(h, 'attack')).toBe(0);
    expect(hasProp(h, 'attack')).toBe(false);
  });

  it('hasProp 能区分"没写过"与"就是 0"', () => {
    const h = createPropHolder();
    setProp(h, 'attack', 0);
    expect(getProp(h, 'attack')).toBe(0);
    expect(hasProp(h, 'attack')).toBe(true);
  });

  it('setProp 覆盖写；addProp 累加并返回新值', () => {
    const h = createPropHolder();
    setProp(h, 'attack', 10);
    expect(getProp(h, 'attack')).toBe(10);

    expect(addProp(h, 'attack', 5)).toBe(15);
    expect(addProp(h, 'attack', -20)).toBe(-5);
    expect(getProp(h, 'attack')).toBe(-5);
  });

  it('addProp 在未设置的键上等同于从 0 起算（wushen add_prop 语义）', () => {
    const h = createPropHolder();
    expect(addProp(h, 'defense', 7)).toBe(7);
    expect(getProp(h, 'defense')).toBe(7);
  });

  it('MOD 派生键同样是合法核心键（类型与运行时一致）', () => {
    const h = createPropHolder();
    setProp(h, 'attack_per', 20);
    setProp(h, 'diff_damage_per', 15);
    setProp(h, 'add_crit_damage_per', 30);
    expect(getProp(h, 'attack_per')).toBe(20);
    expect(getProp(h, 'diff_damage_per')).toBe(15);
    expect(getProp(h, 'add_crit_damage_per')).toBe(30);
  });

  it('removeProp 返回是否确实存在过；clearProps 清空', () => {
    const h = createPropHolder();
    setProp(h, 'attack', 1);
    expect(removeProp(h, 'attack')).toBe(true);
    expect(removeProp(h, 'attack')).toBe(false);
    expect(hasProp(h, 'attack')).toBe(false);

    setProp(h, 'defense', 2);
    clearProps(h);
    expect(hasProp(h, 'defense')).toBe(false);
  });
});

describe('★ 数值守卫（wushen 的静默 NaN / 字符串缺陷）', () => {
  it('对照：复刻 wushen add_prop 会静默写出 NaN 与字符串', () => {
    // os/char/chara_prop.js:3-11 的原始实现
    const wushenAddProp = (bag: Record<string, unknown>, p: string, v: unknown): void => {
      if (p === '') return;
      const v1 = bag[p] === undefined ? 0 : (bag[p] as number);
      bag[p] = v1 + (v as number);
    };

    const a: Record<string, unknown> = {};
    wushenAddProp(a, 'attack', undefined);
    expect(Number.isNaN(a['attack'])).toBe(true); // 攻击变成 NaN，后续公式全废

    const b: Record<string, unknown> = {};
    wushenAddProp(b, 'attack', '5');
    expect(b['attack']).toBe('05'); // 0 + '5' = 字符串拼接
  });

  it('变异：NaN / Infinity / 字符串 / null 一律抛 PropValueError，且不写脏表', () => {
    const h = createPropHolder();
    for (const bad of [NaN, Infinity, -Infinity, dirty('5'), dirty(null), dirty(undefined)]) {
      expect(() => setProp(h, 'attack', bad), String(bad)).toThrow(PropValueError);
      expect(() => addProp(h, 'attack', bad), String(bad)).toThrow(PropValueError);
    }
    // 关键：抛错之后表里依然干净，没有被写入半成品
    expect(h.props.size).toBe(0);
    expect(getProp(h, 'attack')).toBe(0);
  });

  it('有限浮点数合法（wushen 里 force_rad 就是 0.1 这种）', () => {
    const h = createPropHolder();
    setProp(h, 'damage', 0.1);
    expect(getProp(h, 'damage')).toBeCloseTo(0.1);
  });
});

describe('★ 核心 / 扩展物理隔离', () => {
  it('两个 Map 完全独立：写扩展不影响核心，反之亦然', () => {
    const h = createPropHolder();
    setProp(h, 'attack', 100);
    setExtProp(h, EXT, 999);

    expect(getProp(h, 'attack')).toBe(100);
    expect(getExtProp(h, EXT)).toBe(999);
    // 存储层就是两个桶，不是"一个大桶 + 类型约定"
    expect(h.props.has(EXT)).toBe(false);
    expect(h.extProps.has('attack')).toBe(false);
  });

  it('扩展属性累加 / 删除 / has 全套', () => {
    const h = createPropHolder();
    expect(getExtProp(h, EXT2)).toBe(0);
    expect(hasExtProp(h, EXT2)).toBe(false);

    expect(addExtProp(h, EXT2, 3)).toBe(3);
    expect(addExtProp(h, EXT2, 4)).toBe(7);
    expect(hasExtProp(h, EXT2)).toBe(true);

    expect(removeExtProp(h, EXT2)).toBe(true);
    expect(removeExtProp(h, EXT2)).toBe(false);
  });

  it('变异：未登记的扩展键即使强转也过不去（品牌类型的运行时兜底）', () => {
    const h = createPropHolder();
    const forged = 'not_registered_key' as ExtProp; // `as` 绕过编译期，但绕不过这里
    expect(() => getExtProp(h, forged)).toThrow(PropValueError);
    expect(() => setExtProp(h, forged, 1)).toThrow(PropValueError);
    expect(() => addExtProp(h, forged, 1)).toThrow(PropValueError);
    expect(() => hasExtProp(h, forged)).toThrow(PropValueError);
    expect(h.extProps.size).toBe(0);
  });

  it('clearAllProps 同时清两套', () => {
    const h = createPropHolder();
    setProp(h, 'attack', 1);
    setExtProp(h, EXT, 1);
    clearAllProps(h);
    expect(h.props.size).toBe(0);
    expect(h.extProps.size).toBe(0);
  });
});

describe('存档 / 读档边界', () => {
  it('snapshot → loadProps 往返一致', () => {
    const a = createPropHolder();
    setProp(a, 'attack', 12);
    setProp(a, 'max_hp', 300);
    setExtProp(a, EXT, 8);

    const snap = snapshotProps(a);
    expect(snap.prop).toEqual({ attack: 12, max_hp: 300 });
    expect(snap.ext).toEqual({ props_test_key: 8 });

    const b = createPropHolder();
    const report = loadProps(b, snap);
    expect(report.rejected).toEqual([]);
    expect(report.loaded).toBe(3);
    expect(getProp(b, 'attack')).toBe(12);
    expect(getExtProp(b, EXT)).toBe(8);
  });

  it('loadProps 是合并语义，不碰没提到的键', () => {
    const h = createPropHolder();
    setProp(h, 'defense', 42);
    loadProps(h, { prop: { attack: 1 } });
    expect(getProp(h, 'defense')).toBe(42);
    expect(getProp(h, 'attack')).toBe(1);
  });

  it('★ 变异：未登记的键被拒收且**不写进表**（121 vs 70 的那道闸口）', () => {
    const h = createPropHolder();
    // ⚠️ 这里必须用 JSON.parse 构造 `__proto__`：
    //   对象字面量里的 `{ __proto__: 1 }` 是**设置原型**，压根不是自有属性，
    //   `Object.entries` 根本看不到它（本人第一版测试就踩了这个坑）。
    //   而真实不可信数据（存档 / 协议帧）走的正是 JSON.parse —— 它才会
    //   生成名为 `__proto__` 的自有属性，这才是要防的那条路。
    const payload = JSON.parse(
      '{"prop":{"attack":10,"defence":99,"gjsd_peer":1,"__proto__":1},' +
        '"ext":{"props_test_key":3,"someone_elses_buff":5}}',
    ) as unknown;

    const report = loadProps(h, payload);
    expect(report.loaded).toBe(2); // 只有 attack 与 props_test_key
    expect(report.rejected.map((r) => r.key).sort()).toEqual([
      'ext.someone_elses_buff',
      'prop.__proto__',
      'prop.defence',
      'prop.gjsd_peer',
    ]);
    expect(h.props.size).toBe(1);
    expect(h.extProps.size).toBe(1);
    expect(getProp(h, 'attack')).toBe(10);
    // 原型没有被污染
    expect(Object.getPrototypeOf(h.props)).toBe(Map.prototype);
  });

  it('补充锚点：`__proto__` 只有在 JSON.parse 路径下才是自有属性', () => {
    // 这条断言把上面那个坑钉死：谁要是把测试改回对象字面量，这里会提醒他
    expect(Object.entries(JSON.parse('{"__proto__":1}') as Record<string, unknown>)).toEqual([
      ['__proto__', 1],
    ]);
  });

  it('★ 变异：非数值被拒收，不会把 NaN 装进档案', () => {
    const h = createPropHolder();
    const report = loadProps(h, {
      prop: { attack: '5', defense: null, evasion: NaN, deflect: 7 },
    });
    expect(report.loaded).toBe(1);
    expect(report.rejected.map((r) => r.key).sort()).toEqual([
      'prop.attack',
      'prop.defense',
      'prop.evasion',
    ]);
    expect(h.props.size).toBe(1);
    expect(getProp(h, 'deflect')).toBe(7);
  });

  it('loadProps 拒绝不认识的字段，非对象入参直接抛', () => {
    const h = createPropHolder();
    const report = loadProps(h, { prop: {}, totally_wrong: 1 });
    expect(report.rejected).toEqual([{ key: 'totally_wrong', reason: '快照里不认识的字段' }]);

    for (const bad of [null, 42, 'x', undefined]) {
      expect(() => loadProps(h, bad)).toThrow(PropValueError);
    }
  });

  it('★ 变异：数组不是快照 —— 顶层数组直接抛，嵌套数组**被拒收**（`typeof [] === "object"` 的坑）', () => {
    const h = createPropHolder();

    // 对照：`typeof [] === 'object'`，所以只用 typeof 判会**静默放行**数组。
    // 最坏的一种是空数组：`Object.entries([])` 是空的 → loaded 0 / rejected 0，
    // 调用方看到的是"成功装了 0 个属性"，而不是"你给错了形状"。
    for (const bad of [[], ['attack'], [1, 2]] as unknown[]) {
      expect(() => loadProps(h, bad), JSON.stringify(bad)).toThrow(PropValueError);
    }
    // 抛错之后表依然是空的 —— 抛错路径不许留半成品
    expect(h.props.size).toBe(0);

    // 嵌套层同理：`{ prop: [] }` 不是"没有属性"，是一个**坏形状**
    for (const nested of [[], ['attack', 'defense']] as unknown[]) {
      const report = loadProps(h, { prop: nested });
      expect(report.loaded, JSON.stringify(nested)).toBe(0);
      expect(report.rejected, JSON.stringify(nested)).toEqual([
        { key: 'prop', reason: '必须是对象，收到 数组' },
      ]);
    }
    expect(h.props.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// E11（2026-10-16 审查）：`loadProps` 只过 `Number.isFinite` —— **没有范围闸门**
// ---------------------------------------------------------------------------
//
// 于是 `attack:1e300`、`max_hp:-5`、`attack_speed:-1e9` 都能进表：前两个会让一切下游算术失真，
// 后者让攻击速度变成负数（`MIN_ATTACK_INTERVAL_MS` 那条钳制也救不了负数语义）。
// 与 `temp.ts` 的取向对齐：**读档是数据入口，脏值要在入口拒掉**。
describe('E11 · 范围闸门（数值大小与符号）', () => {
  it('★ 超过数值上界的属性被拒收并记账（1e300 不许进表）', () => {
    const h = createPropHolder();
    const report = loadProps(h, { prop: { attack: 1e300 } });

    expect(report.loaded).toBe(0);
    expect(report.rejected.map((r) => r.key)).toEqual(['prop.attack']);
    expect(getProp(h, 'attack'), '脏值不许进表').toBe(0);
  });

  it('★ 语义上非负的键（上限 / 时长类）收到负值 ⇒ 拒收', () => {
    const h = createPropHolder();
    const report = loadProps(h, { prop: { max_hp: -5, attack_speed: -1e9 } });

    expect(report.loaded).toBe(0);
    expect([...report.rejected.map((r) => r.key)].sort()).toEqual(['prop.attack_speed', 'prop.max_hp']);
    expect(getProp(h, 'max_hp')).toBe(0);
  });

  it('【反向锚点】合法值照常装载（含"允许为负"的键的负值）', () => {
    const h = createPropHolder();
    const report = loadProps(h, { prop: { attack: 40, max_hp: 100, defense: -3 } });

    // `fy` 允许为负（减益是合法内容），只有上界与"非负子集"受限
    expect(report.rejected).toEqual([]);
    expect(report.loaded).toBe(3);
    expect(getProp(h, 'max_hp')).toBe(100);
    expect(getProp(h, 'defense')).toBe(-3);
  });
});

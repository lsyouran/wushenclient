/**
 * tests/prop-alias.test.ts —— `PROP` 别名表的**一致性**
 * ============================================================================
 * 背景（29 册 §29.10）：
 *   `PROPERTIES` 的键**故意保留 wushen 原样**（`gj`/`fy`/…）—— 它们是**数据契约**
 *   （内容层 `prop: { gj: 20 }`、协议帧 `max_hp`、存档都在用），改了就把
 *   "照抄 wushen 内容"这条路堵死。
 *   但代码里满屏 `getProp(props, 'gj')` 没人读得懂 ⇒ 中间加一层别名
 *   （`PROP.attack === 'gj'`）：**代码用英文常见名，数据仍是原键**。
 *
 * 本文件钉住这一层**不是第二事实源**：
 *   ① 每个值都是合法的 `PropKey`（且是 CORE）；
 *   ② 值**互不重复**（一个键不该有两个别名，否则读代码的人会以为它们不同）；
 *   ③ 每个值在 `PROPERTIES` 里都有**非空中文名**（人读得懂）；
 *   ④ 关键映射**逐条**断言 —— 别名表的价值就在于"名字↔键"稳定，谁改值谁红。
 *
 * ★ 静态那一半在闸门 **G3.F**（`tools/gate/g3-propkeys.mjs`）：
 *   它从源码文本解析 `PROP` 块逐值对账 —— 因为 `formula.ts` 改用别名之后，
 *   G3.C「引擎层属性调用键」的字面量计数会归零，覆盖会**静默消失**
 *   （FG-7 的"死规则"形态）。两层一起才算守住。
 */
import { describe, expect, it } from 'vitest';

import { PROP, PROPERTIES, isCoreProp, isPropKey } from '@shared/constants.js';
import type { CoreProp } from '@shared/constants.js';

/** 别名表的 (别名, 键) 对 —— 用 string 放宽，避免测试去追字面量联合 */
const ENTRIES: ReadonlyArray<readonly [string, string]> = Object.entries(PROP);
const VALUES = ENTRIES.map(([, key]) => key);

describe('shared/constants · PROP 别名表一致性', () => {
  it('非空（空表会让下面几条全部空转 —— 典型的"扫 0 条也绿"）', () => {
    expect(ENTRIES.length).toBeGreaterThan(0);
  });

  it('每个值都是合法的 PropKey，且是 CORE（别名只给核心键起名）', () => {
    for (const [alias, key] of ENTRIES) {
      expect(isPropKey(key), `${alias} → ${key} 不是合法 PropKey`).toBe(true);
      expect(isCoreProp(key), `${alias} → ${key} 不是 CORE 键`).toBe(true);
    }
  });

  it('★ 值互不重复（一个键只该有一个可读名）', () => {
    expect(new Set(VALUES).size).toBe(VALUES.length);
  });

  it('每个值在 PROPERTIES 里都有非空中文名（人读得懂）', () => {
    for (const key of VALUES) {
      const label = PROPERTIES[key as CoreProp];
      expect(typeof label, `${key} 没有中文名`).toBe('string');
      expect(label.trim().length, `${key} 的中文名是空的`).toBeGreaterThan(0);
    }
  });

  it('★ 关键映射逐条钉住（别名表的价值 = 名字↔键稳定；改值必须改这里）', () => {
    // 战斗核心：wushen 用拼音缩写，本项目代码用英文常见名
    expect(PROP.attack).toBe('gj');
    expect(PROP.defense).toBe('fy');
    expect(PROP.hit).toBe('mz');
    expect(PROP.evasion).toBe('ds');
    expect(PROP.deflect).toBe('zj');
    expect(PROP.crit).toBe('bj_per');
    expect(PROP.attackSpeed).toBe('gjsd');
    // 百分比族
    expect(PROP.attackPer).toBe('gj_per');
    expect(PROP.defensePer).toBe('fy_per');
    expect(PROP.hitPer).toBe('mz_per');
    expect(PROP.evasionPer).toBe('ds_per');
    expect(PROP.deflectPer).toBe('zj_per');
    expect(PROP.attackSpeedPer).toBe('gjsd_per');
    // 气血（★ 注意 `maxHpBonus` 是**加成**，与派生值 `derived.maxHp` 不是一回事）
    expect(PROP.maxHpBonus).toBe('max_hp');
    expect(PROP.hpPer).toBe('hp_per');
    // 先天四维的「加成」键（与裸的先天值 str/con/dex/int 是两回事）
    expect(PROP.strengthBonus).toBe('str');
    expect(PROP.constitutionBonus).toBe('con');
    expect(PROP.dexterityBonus).toBe('dex');
    // 透传修正
    expect(PROP.damageReductionPer).toBe('diff_sh_per');
    expect(PROP.ignoreDefensePer).toBe('diff_fy_per');
  });

  it('★ 别名**没有**把 wushen 的键改掉（数据契约不变）—— 反向锚点', () => {
    // 若哪天有人"顺手把 'gj' 改成 'attack'"，内容层 prop / 协议帧 / 存档全部塌方。
    // 这条断言就是那个陷阱的绊线。
    expect(VALUES).toContain('gj');
    expect(VALUES).toContain('max_hp');
    expect(VALUES).not.toContain('attack');
  });
});

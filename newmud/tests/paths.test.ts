/**
 * 项目根自检（★ docs/26 M4 回归）
 * ============================================================================
 * 旧实现的 `assertProjectRoot()` 是**同义反复**：它检查 `isRoot(PROJECT_ROOT)`，
 * 而 `PROJECT_ROOT` 正是由 `findProjectRoot()`（只在 `isRoot(dir)` 为真时返回）
 * 产出的 —— 于是这个函数**不可能抛错**，却让 `bootstrapWorld()` 看起来
 * "启动第一件事就校验了根目录"。
 *
 * 本文件把"有没有信息量"变成可判定的：**换一个不成立的目录进去，它必须抛错**。
 * 这就是"自检不是装饰"的机械证明。
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { KINDS } from '@shared/ids.js';
import type { Kind } from '@shared/ids.js';
import {
  DATA_DIR,
  INVENTORY_PROJECT_DIRS,
  LOG_DIR,
  PROJECT_ROOT,
  REQUIRED_PROJECT_DIRS,
  SERVER_DIR,
  SHARED_DIR,
  SRC_DIR,
  TOOLS_DIR,
  WORLD_DIR,
  assertProjectRoot,
  backupDir,
  findProjectRoot,
  inspectProjectRoot,
  worldKindDir,
} from '../server/paths.js';
import { describe, expect, it } from 'vitest';

describe('M4 项目根自检（★ docs/26 M4 回归）', () => {
  it('真实项目根：自检通过，并给出可核对的信息', () => {
    const report = assertProjectRoot();
    expect(report.root).toBe(PROJECT_ROOT);
    expect(report.missingRequired).toEqual([]);
    for (const d of REQUIRED_PROJECT_DIRS) {
      expect(report.present, `结构性目录 ${d} 应存在`).toContain(d);
    }
  });

  it('★ 回归锚点：自检**不是**同义反复 —— 指向不成立的目录时必须抛错', () => {
    // 只给 shared/（缺 server/）→ 必须失败
    expect(() => assertProjectRoot(join(PROJECT_ROOT, 'shared'))).toThrow();
    // 完全不存在的位置 → 必须失败
    expect(() => assertProjectRoot(join(PROJECT_ROOT, '__definitely_missing__'))).toThrow();
  });

  it('★ 缺失清单是**算出来的**，不是常量：缺什么就列什么', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'newmud-paths-'));
    try {
      mkdirSync(join(tmp, 'shared'));
      const report = inspectProjectRoot(tmp);
      // 只放了 shared/ → 恰好只缺 server/
      expect(report.missingRequired).toEqual(['server']);
      expect(report.present).toContain('shared');
      expect(report.name).toBe(''); // 没有 package.json → name 为空
      expect(() => assertProjectRoot(tmp)).toThrow();
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('★ 齐备的**临时根**也能通过自检 —— 证明它真的在评估传入的目录', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'newmud-paths-'));
    try {
      mkdirSync(join(tmp, 'shared'));
      mkdirSync(join(tmp, 'server'));
      writeFileSync(join(tmp, 'package.json'), JSON.stringify({ name: 'probe-project' }));
      const report = assertProjectRoot(tmp);
      expect(report.name).toBe('probe-project');
      expect(report.missingRequired).toEqual([]);
      expect(report.root).toBe(tmp);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('★ 自检真的读了配置文件（而非只判目录存在性）', () => {
    const report = assertProjectRoot();
    // package.json 的 name 必须被解析出来 —— 用它证明"找对了项目"
    expect(typeof report.name).toBe('string');
    expect(report.name.trim()).not.toBe('');
  });

  it('清单覆盖存在性与缺失项，且两者互补（不重不漏）', () => {
    const report = inspectProjectRoot();
    const all = [...report.present, ...report.missing].sort();
    // 并集必须恰好等于「结构性目录 ∪ 登记目录」—— 漏一个目录就等于漏一个检查项
    const expected = [...REQUIRED_PROJECT_DIRS, ...INVENTORY_PROJECT_DIRS].sort();
    expect(all).toEqual(expected);
    expect(new Set(all).size).toBe(all.length); // 不重复
    // 结构性目录不允许出现在"登记项"里（两套清单职责必须分开）
    for (const d of REQUIRED_PROJECT_DIRS) {
      expect(INVENTORY_PROJECT_DIRS as readonly string[]).not.toContain(d);
    }
  });
});

describe('M8 worldKindDir 收紧为 Kind（★ docs/26 M8 回归）', () => {
  it('★ 回归锚点：越界 kind 必须抛错，而不是拼出一个能跑出 world/ 的路径', () => {
    for (const evil of ['../../etc', '..', 'room/../..', '', 'nonsense']) {
      expect(() => worldKindDir(evil as Kind), evil).toThrow();
    }
  });

  it('合法 kind → world/<kind>，与 WORLD_DIR 同源', () => {
    for (const k of KINDS) {
      expect(worldKindDir(k)).toBe(join(WORLD_DIR, k));
      // 目录名恒等于 kind 名本身（方案 C 的核心约定，G5 闸门守同一条）
      expect(worldKindDir(k).endsWith(k)).toBe(true);
    }
  });
});

describe('标准一级目录全部由 PROJECT_ROOT 派生（不写死、不依赖 CWD）', () => {
  it('每个目录常量都等于 join(PROJECT_ROOT, 目录名)', () => {
    const cases: ReadonlyArray<readonly [string, string]> = [
      [SHARED_DIR, 'shared'],
      [SERVER_DIR, 'server'],
      [SRC_DIR, 'src'],
      [WORLD_DIR, 'world'],
      [TOOLS_DIR, 'tools'],
      [DATA_DIR, 'data'],
      [LOG_DIR, 'logs'],
    ];
    for (const [actual, name] of cases) {
      expect(actual).toBe(join(PROJECT_ROOT, name));
    }
    expect(backupDir()).toBe(join(DATA_DIR, 'backup'));
  });

  it('★ 目录常量全部是绝对路径（R3 的反面：绝不由启动目录拼出）', () => {
    for (const p of [PROJECT_ROOT, SHARED_DIR, SERVER_DIR, WORLD_DIR, DATA_DIR]) {
      expect(isAbsolute(p), p).toBe(true);
      expect(p.startsWith(PROJECT_ROOT)).toBe(true);
    }
  });

  it('★ 向上查找对任意起始深度都成立（不依赖目录名 / 层级）', () => {
    // 这正是 "改名安全" 的机制本身：判据是特征文件存在性，不是目录叫什么、有多深
    for (const start of [
      PROJECT_ROOT,
      join(PROJECT_ROOT, 'server'),
      join(PROJECT_ROOT, 'server', 'engine'),
      join(PROJECT_ROOT, 'world', 'item', 'drug'),
    ]) {
      expect(findProjectRoot(start), start).toBe(PROJECT_ROOT);
    }
  });
});

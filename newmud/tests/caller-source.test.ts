/**
 * 报错定位：从调用栈里取出「内容文件」路径（★ docs/26 M6 回归）
 * ============================================================================
 * 旧实现的正则要求栈帧里出现 `.ts:`：
 *
 *     /[(\s]([^()\s]+\.ts):\d+:\d+/
 *
 * 开发期（tsx / vitest 直接跑 .ts）没问题，但 `tsc` 产出 `.js` 之后，
 * 栈帧里**根本没有 `.ts`** → 恒返回 `''` → `RegistryEntry.source` 全空 →
 * 重复注册等报错**丢失定位信息**。而"报错定位"正是这个函数存在的**唯一理由**。
 *
 * ★ 回归锚点：下面显式喂 `.js` / `.mjs` / `.cjs` 帧，证明产物布局同样可取到定位。
 *
 * ★ 说明：栈帧里的路径前缀刻意用占位符 `P` 而不是真实盘符 ——
 *   本文件只关心**解析规则**，不关心项目真实位置。真实的绝对路径字面量
 *   会被 G12·R1 拦下（而且它本来就该被拦下）。
 */
import { extractCallerSource } from '../server/world/caller-source.js';
import { describe, expect, it } from 'vitest';

/** 栈帧里的"文件路径"前缀占位符 */
const P = '<proj>';

/** 构造一条栈帧行（Node 的格式：`    at fn (path:line:col)`） */
function frame(file: string, line = 10, col = 5): string {
  return `    at defineItem (${file}:${line}:${col})`;
}

function stack(...frames: string[]): string {
  return ['Error', ...frames].join('\n');
}

describe('M6 报错定位在产物布局（.js）下依然有效', () => {
  it('开发期：`.ts` 栈帧能取到内容文件', () => {
    const s = stack(frame(`${P}/world/item/drug/yao.ts`));
    expect(extractCallerSource(s)).toBe('world/item/drug/yao.ts');
  });

  it('★ 回归锚点：`tsc` 产物 `.js` 栈帧同样能取到（旧实现这里返回空串）', () => {
    const s = stack(frame(`${P}/dist/world/item/drug/yao.js`));
    expect(extractCallerSource(s)).toBe('world/item/drug/yao.js');
  });

  it('★ 回归锚点：`.mjs` / `.cjs` 也被识别', () => {
    expect(extractCallerSource(stack(frame(`${P}/srv/world/npc/pub/xiaoer.mjs`)))).toBe(
      'world/npc/pub/xiaoer.mjs',
    );
    expect(extractCallerSource(stack(frame(`${P}\\app\\world\\area\\yz.cjs`)))).toBe(
      'world/area/yz.cjs',
    );
  });

  it('跳过内容框架自身（server/world/**）的帧，取第一个真正的内容帧', () => {
    const s = stack(
      frame(`${P}/server/world/define.ts`, 1, 2),
      frame(`${P}/server/world/registry.ts`, 3, 4),
      frame(`${P}/world/room/yz/guangchang.ts`, 7, 8),
    );
    expect(extractCallerSource(s)).toBe('world/room/yz/guangchang.ts');
  });

  it('不在 world/ 下的帧（如测试文件、引擎）→ 返回空串，不猜', () => {
    expect(extractCallerSource(stack(frame(`${P}/tests/define.test.ts`)))).toBe('');
    expect(extractCallerSource(stack(frame(`${P}/server/engine/registry.ts`)))).toBe('');
  });

  it('栈不可用 / 为空 / 无匹配帧 → 空串，绝不抛错（best-effort 语义）', () => {
    expect(extractCallerSource(undefined)).toBe('');
    expect(extractCallerSource('')).toBe('');
    expect(extractCallerSource('Error\n    at <anonymous>')).toBe('');
  });

  it('反斜杠路径归一为 posix 风格（Windows 栈帧）', () => {
    const s = stack(frame(`${P}\\world\\skill\\wd\\taijijian.ts`));
    expect(extractCallerSource(s)).toBe('world/skill/wd/taijijian.ts');
  });
});

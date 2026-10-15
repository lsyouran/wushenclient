/**
 * server/world/caller-source.ts — 从调用栈里取出「内容文件」路径
 * ============================================================================
 * 唯一用途：让**重复注册**之类的报错能指出「是哪两个内容文件各注册了一份」。
 * 识别失败一律返回空串，绝不抛错（best-effort：诊断信息不值得让启动失败）。
 *
 * ★ 为什么单独成文件：这段逻辑的**唯一价值**就是"在生产布局下也有效"，
 *   因此它必须能被单测直接喂栈文本（见 tests/caller-source.test.ts）。
 *   埋在 define.ts 里就只能"跑起来看看"，而跑不起来时恰恰是最需要它的时候。
 *
 * ★ docs/26 M6：旧实现的正则要求栈帧里出现 `.ts:`，`tsc` 产出 `.js` 后恒返回 `''`，
 *   `RegistryEntry.source` 全空 → 报错丢失定位。现在识别
 *   ts/mts/cts/tsx/js/mjs/cjs 全族。
 */

/** Node 栈帧里的「文件:行:列」，路径前必须有 `(` 或空白（避免误吞函数名） */
const FRAME_RE = /[(\s]([^()\s]+\.(?:ts|mts|cts|tsx|js|mjs|cjs)):(\d+):(\d+)/;

/** 内容框架自身：这些帧不可能是"内容文件"，必须跳过（否则永远返回 define.ts） */
const FRAMEWORK_MARKER = '/server/world/';

/** 内容层在磁盘上的定位锚点 */
const CONTENT_MARKER = '/world/';

/**
 * 从栈文本中提取第一个**内容文件**路径（`world/...` 相对形式）。
 *
 * @param stack `new Error().stack` 或等价格式文本；`undefined` / 空串 → `''`
 */
export function extractCallerSource(stack: string | undefined): string {
  if (stack === undefined || stack === '') return '';
  for (const line of stack.split('\n')) {
    const m = FRAME_RE.exec(line);
    const file = m?.[1];
    if (file === undefined) continue;
    const norm = file.replace(/\\/g, '/');
    if (norm.includes(FRAMEWORK_MARKER)) continue;
    const i = norm.lastIndexOf(CONTENT_MARKER);
    if (i !== -1) return norm.slice(i + 1);
  }
  return '';
}

/** 取当前调用点的内容文件路径（识别失败返回空串） */
export function bestEffortCallerSource(): string {
  return extractCallerSource(new Error().stack);
}

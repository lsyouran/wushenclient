#!/usr/bin/env node
/**
 * tools/start.mjs — 启动器（`npm start` 的入口）
 * ============================================================================
 * 全部工作只有两件，顺序不能反：
 *   ① 注册"TS 直跑"钩子（`tools/dev/ts-loader.ts`）—— 让裸 node 认别名与 `.js` 说明符
 *   ② 这才可以 import 真正的入口 `server/cli.ts`，把命令行参数交给它
 *
 * ★ 为什么本文件是 `.mjs` 而不是 `.ts`：它必须在**钩子生效之前**运行，
 *   所以它自己不能依赖那套钩子。为了让这段"前钩子代码"尽可能短，
 *   真正复杂的部分（解析、转换）全在 `tools/dev/ts-loader.ts` 里 ——
 *   那个文件只用 node 内建，所以 node 能**原生加载**它（不需要任何钩子），
 *   于是这里没有第二份解析逻辑、也没有复制粘贴。
 *
 * ★ 退出码语义（与闸门同一套，来自 tools/gate/lib.mjs）：
 *   `0` 正常退出 / `1` 启动失败。**不写裸数字**（G6 R6.7 会拦）。
 */

import { EXIT_FAIL, EXIT_PASS } from './gate/lib.mjs';

let cli;
try {
  const { registerTsHooks } = await import('./dev/ts-loader.ts');
  registerTsHooks();
  cli = await import('../server/cli.ts');
} catch (e) {
  process.stderr.write(`启动失败：${e instanceof Error ? e.message : String(e)}\n`);
  if (e instanceof Error && e.stack !== undefined) process.stderr.write(`${e.stack}\n`);
  process.exit(EXIT_FAIL);
}

try {
  await cli.main(process.argv.slice(2));
} catch (e) {
  // 用法错误打 usage；运行期故障只打原因（usage 会淹没真正的原因）
  const isUsage = e instanceof cli.UsageError;
  process.stderr.write(`${isUsage ? '' : '启动失败：'}${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(EXIT_FAIL);
}

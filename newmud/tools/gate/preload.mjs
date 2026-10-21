#!/usr/bin/env node
/**
 * tools/gate/preload.mjs — 崩溃守卫的**预载**（`node --import …preload.mjs <gate>`）
 * ============================================================================
 * 解决的问题（2026-10-19 实测踩出来的）：
 *   `lib.mjs#installCrashGuard()` 只能接住**它安装之后**发生的异常。而 ESM 的求值顺序是
 *   **先把整张 import 图加载完，再执行本模块的第一行** —— 于是"被 import 的模块里有语法错误"
 *   这件事发生在守卫安装**之前**，退出码是 node 默认的 **1**，与 `EXIT_FAIL`（发现违规）**同码**。
 *
 *   现场：本批给共享模块 `docs-index.mjs` 加注释时写了 `tests/**\/*.test.ts`，
 *   那个 `*\/` **提前闭合了块注释** ⇒ 语法错误 ⇒ **G15 与 G16 各以 exit 1 结束，且一行输出都没有**。
 *   套件汇总里它们显示为 `❌ FAIL`，与"真的发现了违规"长得**完全一样** ——
 *   这正是 FG-23 要消灭的形态，只是从另一扇门进来（那扇门当时记为"已知局限"）。
 *
 * 为什么 `--import` 能治：预载模块在**主模块图加载之前**求值，守卫先挂上；
 * 之后无论是运行期抛错还是**加载期语法错误**，都会走 `uncaughtException` ⇒ `EXIT_CRASH = 3`。
 * 实测：同一个坏文件，不带预载 `EXIT=1`，带预载 `EXIT=3` 且打出 `SyntaxError`。
 *
 * ★ 名称来源：`installCrashGuard()` 缺省取 `basename(process.argv[1])`，而在
 *   `node --import preload.mjs g16-docsrefs.mjs` 里 `argv[1]` **就是那个闸门**，
 *   所以报错信息仍然指名道姓，不会退化成"某个闸门崩了"。
 * ★ 各闸门自己那次 `installCrashGuard('G16')` 随即变成空操作（lib 内有 `crashGuardInstalled` 标志）——
 *   **保留它**：直接 `node tools/gate/g16-docsrefs.mjs` 调试时没有预载，靠的就是那一行。
 *
 * 谁用：`run-all.mjs` 与 `mutation-test.mjs` 两处 spawn 都带 `--import`（同一份语义，别各写一份）。
 */

import { installCrashGuard } from './lib.mjs';

installCrashGuard();

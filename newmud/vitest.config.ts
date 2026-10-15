import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const ROOT = dirname(fileURLToPath(import.meta.url));

/**
 * vitest 配置。
 *
 * ★ 别名**只有一个真相**：`tsconfig.json` 的 `compilerOptions.paths`。
 *   **有三处镜像**：G13 / G14 两个闸门脚本各存一份表，本文件存一份表。
 *   （启动器 `tools/dev/ts-loader.ts` **不存镜像** —— 它启动时直接读 tsconfig。）
 *   真相 + 三处镜像必须逐字一致。
 *
 * ⚠️ 这件事**由 `tests/alias-single-source.test.ts` 机检**（提取四份表逐条比对）。
 *   这里原先写的是「G12/G13 闸门会做交叉核对」—— **那是假的**：G13/G14 只是
 *   各存一份镜像、G12 根本不看别名，没有任何闸门或测试做过核对。
 *   按 24 册 §5.3 的纪律（宣称的保护必须真存在），处置是**补出真的核对**，
 *   而不是把这句话改软。该条记为 **FG-20**，见 24 册 §5.3 与 26 册 §17。
 */
export default defineConfig({
  resolve: {
    alias: [
      { find: /^@shared\/(.*)$/, replacement: resolve(ROOT, 'shared') + '/$1' },
      { find: /^@engine\/(.*)$/, replacement: resolve(ROOT, 'server') + '/$1' },
      { find: /^@world\/(.*)$/, replacement: resolve(ROOT, 'world') + '/$1' },
    ],
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    /**
     * ★ docs/26 L10：**显式**声明按文件隔离，而不是依赖默认值。
     *
     * 为什么必须隔离：注册表是模块级单例，而 `clearAll()` 是公开导出。
     * 一旦用 `--no-isolate` / `isolate: false` 跑，`define.test.ts` 里的
     * `beforeEach(clearAll)` 会把 `content.test.ts` 已加载的**真实内容**清空，
     * 于是测试结果取决于文件执行顺序 —— 典型的"偶尔红、单独跑又绿"。
     * 显式写出来，是为了让"改成 false"这件事必须经过一次有意识的改动。
     */
    isolate: true,
  },
});

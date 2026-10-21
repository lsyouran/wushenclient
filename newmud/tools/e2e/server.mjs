/**
 * tools/e2e/server.mjs — e2e 用的临时服务器（`--port 0`，系统分配端口）
 * ============================================================================
 * ★ 为什么抽出来（26 册 §81）：`smoke.mjs` 与 `layout.mjs` 都要起一台干净的服务器，
 *   各自抄一份 `spawn` + READY 解析就有两份"怎么等端口"的真相 ——
 *   而**等端口的方式**恰好是最容易写错的一段（固定 `sleep` 在冷启动波动下必挂）。
 *
 * ★ 端口不猜：`cli.ts` 故意打一行机器可读的 `READY {"port":N}`
 *   （`--port 0` 时**只有它**知道真实端口）。这里只解析那一行。
 */

import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const TOOLS = join(HERE, '..');
const ROOT = join(TOOLS, '..');

const READY_TIMEOUT_MS = 20000;

/**
 * 起一台临时服务器。
 *
 * @returns `{ child, ready }`：`ready` 解析成**真实端口号**；失败时 reject
 *          （服务器提前退出会把 stderr 拼进错误里 —— 否则只看到"超时"）
 */
export function startE2eServer() {
  const child = spawn(process.execPath, [join(TOOLS, 'start.mjs'), '--port', '0'], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const errText = [];
  child.stderr.on('data', (b) => errText.push(String(b)));

  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('等 READY 超时：服务器没起来'));
    }, READY_TIMEOUT_MS);
    child.stdout.on('data', (b) => {
      const m = /READY (\{.*\})/.exec(String(b));
      if (m === null) return;
      clearTimeout(timer);
      resolve(Number(JSON.parse(m[1]).port));
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`服务器提前退出（code=${String(code)}）：${errText.join('').trim()}`));
    });
  });

  return { child, ready };
}

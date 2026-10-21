/**
 * tools/e2e/cdp.mjs — 极小的 CDP 客户端（不引 playwright / puppeteer）
 * ============================================================================
 * 为什么自己写（26 册 §76.8 记的立项理由）：
 *   版式 / 几何 / 交互时序**判不了静态**。§74 那四个前端缺陷里，有三个是
 *   "`getBoundingClientRect()` 量出来的数值不对"，任何正则与 AST 都只能猜。
 *   而 playwright / puppeteer 会带进来一棵 node_modules —— 本项目零运行期依赖
 *   （只有 ws + zod），为了一条 e2e 加几十兆不划算。
 *
 *   浏览器自己就带一个调试协议：`--remote-debugging-port` + WebSocket，
 *   node 原生 `fetch` + 项目已有的 `ws` 就够了。
 *
 * ★ 三个必须照做的细节（都踩过，见 26 册 §74.2 / §76）：
 *   ① `--no-proxy-server`：本机有代理时，浏览器会把 127.0.0.1 也送去代理；
 *   ② **不要**传 `--timeout`：它和 `--virtual-time-budget` 打架，chrome 会在 0.4 秒内
 *      以 rc=0 退出且**不产图**；
 *   ③ `--window-size` 在 Windows 上有最小宽度（≈522），写更小会被抬到 504，
 *      而截图仍按你写的尺寸输出 ⇒ 右边被裁，看着像"布局溢出"。
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import WebSocket from 'ws';

/**
 * 无头 chrome 的可能位置（按顺序找第一个存在的）。
 *
 * ★★ Windows 那两条**必须从环境变量拼**，不能写字面量（26 册 §77）：
 *   ① G12 R1 禁止盘符字面量 —— 第一版写死 `C:/Program Files/…` ⇒ 闸门红；
 *   ② 更要紧的是它**只在写死的那台机器上成立**：Chrome 装在别的盘、或只装在
 *      `%LOCALAPPDATA%`（用户级安装）时，`existsSync` 静默返回 false，于是
 *      "没装浏览器"与"装了我没找到"变成同一句话 —— 这正是 FG 家族的形态。
 *   `%ProgramFiles%` / `%ProgramFiles(x86)%` / `%LOCALAPPDATA%` 三个位置覆盖了
 *   系统级安装、32 位安装、用户级安装三种情况；`MUD_CHROME` 供非常规路径覆盖。
 */
const CHROME_CANDIDATES = [
  process.env['MUD_CHROME'] ?? '',
  ...[process.env['ProgramFiles'], process.env['ProgramFiles(x86)'], process.env['LOCALAPPDATA']]
    .filter((base) => base !== undefined && base !== '')
    .map((base) => join(base, 'Google', 'Chrome', 'Application', 'chrome.exe')),
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter((p) => p !== '');

export function findChrome() {
  for (const p of CHROME_CANDIDATES) if (existsSync(p)) return p;
  return null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 起一个无头浏览器，返回一个**只连一个页面**的会话。
 *
 * @param {object} o  `{ chrome, profileDir, width, height, outDir, headless? }`
 *   `headless: false` ⇒ 有头模式（排查版式时用；缺省无头，`--headless=new`）。
 */
export async function launch(o) {
  const port = o.debugPort ?? 9336;
  const args = [
    ...(o.headless === false ? [] : ['--headless=new']),
    '--disable-gpu',
    '--no-sandbox',
    '--no-proxy-server',
    '--hide-scrollbars',
    '--disable-dev-shm-usage',
    `--user-data-dir=${o.profileDir}`,
    `--window-size=${String(o.width ?? 600)},${String(o.height ?? 940)}`,
    `--remote-debugging-port=${String(port)}`,
    'about:blank',
  ];
  const proc = spawn(o.chrome, args, { stdio: 'ignore' });

  // 轮询 `/json/version` 直到浏览器肯说话（不要 sleep 固定值 —— 冷启动波动很大）
  let version = null;
  for (let i = 0; i < 80; i += 1) {
    try {
      const r = await fetch(`http://127.0.0.1:${String(port)}/json/version`, {
        signal: AbortSignal.timeout(1000),
      });
      version = await r.json();
      break;
    } catch {
      await sleep(250);
    }
  }
  if (version === null) {
    proc.kill();
    throw new Error('无头浏览器没起来（/json/version 无响应）');
  }

  const ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.once('open', res);
    ws.once('error', rej);
  });

  let seq = 0;
  const pending = new Map();
  /** 页面控制台与未捕获异常（诊断用；断言不读它，但失败时要能看见） */
  const logs = [];
  ws.on('message', (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.id !== undefined && pending.has(m.id)) {
      pending.get(m.id)(m);
      pending.delete(m.id);
      return;
    }
    if (m.method === 'Runtime.consoleAPICalled') {
      const parts = (m.params.args ?? []).map((a) => String(a.value ?? a.description ?? ''));
      logs.push(`[console:${m.params.type}] ${parts.join(' ')}`);
    } else if (m.method === 'Runtime.exceptionThrown') {
      logs.push(`[exception] ${m.params.exceptionDetails?.exception?.description ?? '?'}`);
    }
  });

  const send = (method, params = {}, sessionId) => {
    const id = (seq += 1);
    const msg = { id, method, params };
    if (sessionId !== undefined) msg.sessionId = sessionId;
    ws.send(JSON.stringify(msg));
    return new Promise((res) => pending.set(id, res));
  };

  const { result: created } = await send('Target.createTarget', { url: 'about:blank' });
  const { result: attached } = await send('Target.attachToTarget', {
    targetId: created.targetId,
    flatten: true,
  });
  const S = attached.sessionId;

  await send('Runtime.enable', {}, S);
  await send('Page.enable', {}, S);

  const outDir = o.outDir;
  mkdirSync(outDir, { recursive: true });

  const page = {
    /** 在页面里求值（同步表达式或返回 Promise 的表达式），返回可序列化的值 */
    async eval(expression) {
      const r = await send(
        'Runtime.evaluate',
        { expression, awaitPromise: true, returnByValue: true },
        S,
      );
      const ex = r.result?.exceptionDetails;
      if (ex !== undefined) {
        throw new Error(`页面求值抛错：${ex.exception?.description ?? ex.text ?? '?'}`);
      }
      return r.result?.result?.value;
    },
    async goto(url) {
      await send('Page.navigate', { url }, S);
    },
    /**
     * 改**视口**（不是窗口）。
     *
     * ★ 为什么不能用 `--window-size` 测小屏（26 册 §81）：Windows 上有最小宽度
     *   （实测 ≈522，写更小会被抬到 504），而截图仍按你写的尺寸输出 ⇒ 右边被裁，
     *   看着像"布局溢出"—— 于是"布局真的溢出"与"浏览器不肯变小"变成同一个现象，
     *   正是 FG 家族的形态。`Emulation.setDeviceMetricsOverride` 直接改视口，
     *   与窗口尺寸无关。
     *
     * ★ `deviceScaleFactor: 1` 是刻意的：不模拟高 DPI。版式断言比的是 CSS 像素，
     *   开 2x 只会让量出来的数变成两倍，断言里的阈值就得跟着乘，没有收益。
     */
    async setViewport(width, height) {
      await send(
        'Emulation.setDeviceMetricsOverride',
        { width, height, deviceScaleFactor: 1, mobile: false },
        S,
      );
      // ★ 等一帧：resize 监听是同步的，但**重排**要等浏览器把样式算完。
      //   不等的话第一次量到的还是旧布局的数值（实测会读到旧 top）。
      await page.eval('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))');
    },
    async clearViewport() {
      await send('Emulation.clearDeviceMetricsOverride', {}, S);
    },
    /** 等到 `expr` 返回真值（轮询；超时抛错并带上当时的表达式） */
    async waitFor(expression, { timeoutMs = 8000, label = expression } = {}) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        try {
          if (await page.eval(expression)) return true;
        } catch {
          /* 页面还没就绪 —— 继续等 */
        }
        await sleep(120);
      }
      throw new Error(`等待超时（${String(timeoutMs)}ms）：${label}`);
    },
    async screenshot(name) {
      const r = await send('Page.captureScreenshot', { format: 'png' }, S);
      const file = join(outDir, `${name}.png`);
      writeFileSync(file, Buffer.from(r.result.data, 'base64'));
      return file;
    },
    /** 页面控制台/异常（失败时打出来，省一次重跑） */
    get logs() {
      return logs.slice();
    },
    async close() {
      try {
        await send('Target.closeTarget', { targetId: created.targetId });
      } catch {
        /* 已经关了 */
      }
      ws.close();
      proc.kill();
    },
  };

  return page;
}

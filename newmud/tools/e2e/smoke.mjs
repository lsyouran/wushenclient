#!/usr/bin/env node
/**
 * tools/e2e/smoke.mjs — 真浏览器冒烟：打开页面 → 登录 → 看到房间（26 册 §77）
 * ============================================================================
 * 为什么需要它：静态闸门判不了"界面上到底有没有东西"。G19 能守"帧字段名对不上"，
 * 但守不了"整块面板没渲染""登录按钮点了没反应""控制台抛异常而页面只是空白"——
 * 这三类只有真加载一次浏览器才知道（§74 那四个前端缺陷全是这么抓出来的）。
 *
 * 它做的每一步都是**会红**的断言，不是截图留念：
 *   ① 起一台临时服务器（`--port 0`，系统分配，不抢开发用的 8123）
 *   ② 无头 chrome 打开页面：`#auth` 必须**真的占着面积**（不是 `hidden`，也不是 0×0）
 *   ③ 填名号 → 点「进入江湖」：`#app` 必须出现，`#roomName` 有内容，
 *      `#hpTx` 有数值 —— 后者证明服务端 `sc` 帧真的到了 ⇒ WebSocket 那段也验过了
 *   ④ 全程控制台**零 error / 零未捕获异常**
 *
 * 用法：
 *   npm run e2e                                    # 自带服务器
 *   npm run e2e -- --url http://127.0.0.1:8123/    # 复用 `npm run dev` 那台
 *   npm run e2e -- --headed                        # 有头模式（排查版式时看得见）
 *   npm run e2e -- --out <目录>                    # 截图落点（缺省在系统临时目录）
 *
 * 退出码沿用闸门四态（26 册 §27）：0 通过 / 1 违规 / 2 跳过（本机没装 Chrome）/ 3 崩溃。
 * ★ 它**不在** `tools/gate/` 里，所以不进 `npm run gate`；但仍被 G12 / G17 扫描。
 */

import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { EXIT_CRASH, EXIT_FAIL, EXIT_PASS, EXIT_SKIP, installCrashGuard } from '../gate/lib.mjs';
import { findChrome, launch } from './cdp.mjs';
import { startE2eServer } from './server.mjs';

installCrashGuard('e2e-smoke');

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const valueOf = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : fallback;
};

const outDir = valueOf('--out', join(tmpdir(), 'newmud-e2e'));
const externalUrl = valueOf('--url', '');
/** 每次跑换一个临时 profile —— 复用会带上上一次的 localStorage 与缓存 */
const profileDir = join(tmpdir(), `newmud-e2e-profile-${String(Date.now())}`);
const ROLE = '验收一号';

/** 页面内断言：元素存在、可见、且真的有面积 */
const visible = (id) =>
  `(() => { const e = document.getElementById(${JSON.stringify(id)});` +
  ` if (e === null) return 'missing';` +
  ` const r = e.getBoundingClientRect();` +
  ` return (!e.hidden && r.width > 0 && r.height > 0) ? 'ok' : 'hidden'; })()`;

const textOf = (id) =>
  `(() => { const e = document.getElementById(${JSON.stringify(id)});` +
  ` return e === null ? '' : e.textContent.trim(); })()`;

async function run() {
  const chrome = findChrome();
  if (chrome === null) {
    process.stdout.write('SKIP · 本机没找到 Chrome / Chromium（可用 MUD_CHROME=<路径> 指定）\n');
    return EXIT_SKIP;
  }

  mkdirSync(outDir, { recursive: true });
  let server = null;
  let page = null;
  const problems = [];

  try {
    let url = externalUrl;
    if (url === '') {
      server = startE2eServer();
      const port = await server.ready;
      url = `http://127.0.0.1:${String(port)}/`;
    }
    process.stdout.write(`  · 页面 ${url}\n  · 浏览器 ${chrome}\n`);

    page = await launch({
      chrome,
      profileDir,
      width: 600,
      height: 940,
      outDir,
      ...(flag('--headed') ? { headless: false } : {}),
    });
    await page.goto(url);

    // ① 认证屏真的画出来了
    await page.waitFor(`(${visible('auth')}) === 'ok'`, { label: '#auth 可见' });

    // ①.5 ★ 还要等**脚本绑好事件**：`#auth` 是静态 HTML，页面一解析完就"可见"，
    //      但按钮的 click 监听在 `main.ts` 模块求值时才挂上。第一版漏了这一步，
    //      于是点击发生在绑定之前 —— 快照里 `authStatus` 仍是「尚未连接」，
    //      看起来像"登录没反应"，其实是**测试下手太早**（§77 记了这条）。
    //      `#serverLabel` 的 `…` 占位由 `renderServerLabel()` 在绑定之后填掉，
    //      它是最靠近"JS 活着"的一个可观测点。
    await page.waitFor(`(${textOf('serverLabel')}) !== '…' && (${textOf('serverLabel')}).length > 0`, {
      label: '前端脚本已就绪（#serverLabel 已填充）',
    });

    // ② 填名号 → 进江湖
    const filled = await page.eval(
      `(() => { const n = document.getElementById('loginName');` +
        ` if (n === null) return false;` +
        ` n.value = ${JSON.stringify(ROLE)};` +
        ` n.dispatchEvent(new Event('input', { bubbles: true }));` +
        ` document.getElementById('loginBtn').click();` +
        ` return true; })()`,
    );
    if (filled !== true) problems.push('找不到登录输入框 #loginName');

    // ③ 主屏 + 房间名 + 气血数值（最后一项证明 WS 数据真的到了）
    await page.waitFor(`(${visible('app')}) === 'ok'`, { label: '#app 可见（登录成功）' });
    await page.waitFor(`(${textOf('roomName')}).length > 0`, { label: '#roomName 有内容' });
    await page.waitFor(
      `(() => { const t = ${textOf('hpTx')}; return t !== '' && t !== '—'; })()`,
      { label: '#hpTx 收到数值（sc 帧）' },
    );

    const room = await page.eval(textOf('roomName'));
    const hp = await page.eval(textOf('hpTx'));
    const shot = await page.screenshot('after-login');
    process.stdout.write(`  · 房间「${String(room)}」气血 ${String(hp)}\n  · 截图 ${shot}\n`);

    // ④ 控制台必须干净
    for (const line of page.logs) {
      if (line.startsWith('[exception]') || line.startsWith('[console:error]')) problems.push(line);
    }
  } catch (e) {
    problems.push(e instanceof Error ? e.message : String(e));
    if (page !== null) {
      // 失败时把"当时屏幕上写着什么"打出来 —— 省一次重跑（这是 §74 那几轮最缺的信息）
      for (const line of page.logs) problems.push(`  ${line}`);
      const snap = await page
        .eval(
          `(() => ({ status: ${textOf('authStatus')}, name: (document.getElementById('loginName') || {}).value ?? '',` +
            ` appHidden: (document.getElementById('app') || {}).hidden ?? null,` +
            ` room: ${textOf('roomName')} }))()`,
        )
        .catch(() => null);
      if (snap !== null) problems.push(`  页面快照：${JSON.stringify(snap)}`);
    }
  } finally {
    if (page !== null) await page.close().catch(() => {});
    server?.child.kill();
  }

  if (problems.length > 0) {
    process.stdout.write(`\n❌ 真机冒烟失败（${String(problems.length)} 条）：\n`);
    for (const p of problems) process.stdout.write(`  ${p}\n`);
    return EXIT_FAIL;
  }
  process.stdout.write('\n✅ 真机冒烟通过：认证屏 → 登录 → 房间 → 数值，控制台零 error\n');
  return EXIT_PASS;
}

try {
  process.exitCode = await run();
} catch (e) {
  process.stderr.write(
    `冒烟脚本自身崩溃：${e instanceof Error ? (e.stack ?? e.message) : String(e)}\n`,
  );
  process.exitCode = EXIT_CRASH;
}

#!/usr/bin/env node
/**
 * tools/e2e/layout.mjs — **版式（几何）断言**：面板在视口内 / 按钮真能点 / 换视口会重算
 * ============================================================================
 * 为什么需要它（26 册 §81）：静态闸门判不了"版式"。`getBoundingClientRect()` 量出来的
 * 数值不对时，任何正则与 AST 都只能猜 —— 而本项目历史上真实发生过的版式缺陷恰好是：
 *
 *   §60  先开属性卡、再点 NPC ⇒ 面板带着上一次的 inline `left:7px` 再叠
 *        `translateX(-50%)` ⇒ 左移半个身位，实测 l=−231 / 窗口 582，右半张脸看不见
 *   §62  开属性面板后消息流"像是空的" —— 面板盖住消息流，没给它让位
 *   换视口（390→320）后数据面板比房间区还宽（376 vs 306），右边被裁
 *
 * 这三条**没有一条能被单测抓住**（jsdom 没有布局，`scrollLeft`/矩形恒为 0）。
 * 它们只能靠真浏览器量。本脚本就是那把尺子。
 *
 * 断言（每一条都会红，不是截图留念）：
 *   ① 物件面板：整体在视口内；不与底部工具条重叠
 *   ② 物件面板底部按钮：在面板框内、有面积、**中心点命中自身**（不被遮挡）
 *   ③ 面板正文：在面板框内（不溢出上/下带之间）
 *   ④ 视口缩到 380×700 后 ①②③ 仍成立（§60 那一类"变窄就裁"）
 *   ⑤ 数据面板：在视口内；且**消息流最后一行露在面板下方**（§62 的让位）
 *   ⑥ 数据面板 → 物件面板：inline `left` / `width` 必须被清掉（§60 的根因）
 *
 * 用法：
 *   npm run e2e:layout                 # 自带服务器
 *   npm run e2e:layout -- --headed     # 有头（排查时看得见）
 *
 * 退出码沿用闸门四态（26 册 §27）：0 通过 / 1 违规 / 2 跳过（无 Chrome）/ 3 崩溃。
 */

import { installCrashGuard, EXIT_CRASH, EXIT_FAIL, EXIT_PASS, EXIT_SKIP } from '../gate/lib.mjs';
import { findChrome, launch } from './cdp.mjs';
import { startE2eServer } from './server.mjs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

installCrashGuard('e2e-layout');

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const valueOf = (n, f) => {
  const i = argv.indexOf(n);
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : f;
};

const outDir = valueOf('--out', join(tmpdir(), 'newmud-e2e'));
const profileDir = join(tmpdir(), `newmud-layout-${String(Date.now())}`);
const ROLE = '版式探针';

/** 亚像素容差：`getBoundingClientRect` 给的是小数，1px 内的差不算错 */
const SLACK = 1;

// ── 断言收集 ───────────────────────────────────────────────────────────────

const results = [];
const pass = (label, note = '') => results.push({ ok: true, label, note });
const fail = (label, note) => results.push({ ok: false, label, note });
const fmt = (r) =>
  r === null
    ? 'null'
    : `l=${r.left.toFixed(1)} t=${r.top.toFixed(1)} r=${r.right.toFixed(1)} b=${r.bottom.toFixed(1)} (${r.width.toFixed(1)}×${r.height.toFixed(1)})`;

/** 页内取矩形 —— 用 `getBoundingClientRect`，与用户实际看到的坐标同一套 */
const rectOf = (sel) =>
  `(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (e === null) return null;` +
  ` const r = e.getBoundingClientRect();` +
  ` return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; })()`;

const viewportOf = `(() => ({ w: innerWidth, h: innerHeight }))()`;

/**
 * 按钮中心点是否**命中按钮自己**。
 *
 * ★ 这是"按钮跑偏"最直接的一条判据：矩形算得再好，只要有别的元素盖在上面，
 *   玩家点下去仍然是别人的事。`elementFromPoint` 问的正是"这一点的最上层是谁"。
 */
const hitTestOf = (sel) =>
  `(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (e === null) return { v: 'missing' };` +
  ` const r = e.getBoundingClientRect();` +
  ` if (r.width <= 0 || r.height <= 0) return { v: 'zero-size' };` +
  ` const cx = r.left + r.width / 2; const cy = r.top + r.height / 2;` +
  ` if (cx < 0 || cy < 0 || cx > innerWidth || cy > innerHeight) return { v: 'off-screen', cx, cy };` +
  ` const hit = document.elementFromPoint(cx, cy);` +
  ` if (hit === null) return { v: 'nothing-at-point', cx, cy };` +
  ` if (hit === e || e.contains(hit)) return { v: 'ok' };` +
  ` const tag = hit.tagName.toLowerCase();` +
  ` const cls = typeof hit.className === 'string' ? hit.className : '';` +
  ` return { v: 'covered', by: tag + (cls === '' ? '' : '.' + cls.split(/\\s+/).join('.')) }; })()`;

// ── 断言实现（node 侧） ────────────────────────────────────────────────────

function assertInViewport(rect, vp, label) {
  if (rect === null) return fail(label, '元素不存在');
  if (rect.left < -SLACK) return fail(label, `左边越界 ${fmt(rect)} / 视口 ${String(vp.w)}×${String(vp.h)}`);
  if (rect.top < -SLACK) return fail(label, `上边越界 ${fmt(rect)} / 视口 ${String(vp.w)}×${String(vp.h)}`);
  if (rect.right > vp.w + SLACK) return fail(label, `右边越界 ${fmt(rect)} / 视口宽 ${String(vp.w)}`);
  if (rect.bottom > vp.h + SLACK) return fail(label, `下边越界 ${fmt(rect)} / 视口高 ${String(vp.h)}`);
  if (rect.width <= 0 || rect.height <= 0) return fail(label, `面积为 0 ${fmt(rect)}`);
  return pass(label, fmt(rect));
}

/** `inner` 必须完整落在 `outer` 里（同一边界容差） */
function assertInside(inner, outer, label) {
  if (inner === null || outer === null) return fail(label, '元素不存在');
  if (
    inner.left < outer.left - SLACK ||
    inner.top < outer.top - SLACK ||
    inner.right > outer.right + SLACK ||
    inner.bottom > outer.bottom + SLACK
  ) {
    return fail(label, `溢出：inner ${fmt(inner)} 不在 outer ${fmt(outer)} 内`);
  }
  return pass(label, fmt(inner));
}

/** 两条矩形不许纵向重叠（前者必须在后者上方） */
function assertAbove(upper, lower, label) {
  if (upper === null || lower === null) return fail(label, '元素不存在');
  if (upper.bottom > lower.top + SLACK) {
    return fail(label, `重叠：上者底 ${upper.bottom.toFixed(1)} > 下者顶 ${lower.top.toFixed(1)}`);
  }
  return pass(label, `底 ${upper.bottom.toFixed(1)} ≤ 顶 ${lower.top.toFixed(1)}`);
}

async function assertHit(page, sel, label) {
  const r = await page.eval(hitTestOf(sel));
  if (r?.v === 'ok') return pass(label);
  if (r?.v === 'missing') return fail(label, '元素不存在');
  if (r?.v === 'zero-size') return fail(label, '面积为 0，点不到');
  if (r?.v === 'off-screen') return fail(label, `中心点 (${String(r.cx)},${String(r.cy)}) 在视口外`);
  if (r?.v === 'nothing-at-point') return fail(label, '中心点没有元素');
  return fail(label, `被 ${String(r?.by)} 盖住`);
}

/** 面板底部每一颗按钮都过一遍 ①② */
async function assertFootButtons(page, vp, phase) {
  const n = await page.eval(`document.querySelectorAll('#dlgFoot span').length`);
  if (typeof n !== 'number' || n === 0) {
    return pass(`${phase} 底部按钮（本次没按钮，跳过）`);
  }
  const dialog = await page.eval(rectOf('#dialog'));
  const foot = await page.eval(rectOf('#dlgFoot'));
  assertInside(foot, dialog, `${phase} 下带在面板框内`);
  for (let i = 0; i < n; i += 1) {
    const sel = `#dlgFoot span:nth-child(${String(i + 1)})`;
    const r = await page.eval(rectOf(sel));
    assertInViewport(r, vp, `${phase} 按钮[${String(i + 1)}] 在视口内`);
    assertInside(r, dialog, `${phase} 按钮[${String(i + 1)}] 在面板框内`);
    await assertHit(page, sel, `${phase} 按钮[${String(i + 1)}] 中心点命中自身`);
  }
}

// ── 主流程 ─────────────────────────────────────────────────────────────────

const textOf = (id) =>
  `(() => { const e = document.getElementById(${JSON.stringify(id)});` +
  ` return e === null ? '' : (e.textContent || '').trim(); })()`;

const visible = (id, extra = '') =>
  `(() => { const e = document.getElementById(${JSON.stringify(id)});` +
  ` if (e === null) return false;` +
  ` const r = e.getBoundingClientRect();` +
  ` return !e.hidden && r.width > 0 && r.height > 0${extra}; })()`;

async function run() {
  const chrome = findChrome();
  if (chrome === null) {
    process.stdout.write('SKIP · 本机没找到 Chrome / Chromium（可用 MUD_CHROME=<路径> 指定）\n');
    return EXIT_SKIP;
  }

  let server = null;
  let page = null;
  const problems = [];

  try {
    server = startE2eServer();
    const port = await server.ready;
    const url = `http://127.0.0.1:${String(port)}/`;
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

    // 登录（`#serverLabel` 被填掉 = 脚本已绑事件，见 26 册 §77）
    await page.waitFor(`(${textOf('serverLabel')}) !== '…' && (${textOf('serverLabel')}).length > 0`, {
      label: '前端脚本已就绪',
    });
    await page.eval(
      `(() => { const n = document.getElementById('loginName');` +
        ` n.value = ${JSON.stringify(ROLE)};` +
        ` n.dispatchEvent(new Event('input', { bubbles: true }));` +
        ` document.getElementById('loginBtn').click(); return true; })()`,
    );
    await page.waitFor(`(${visible('app')}) === true`, { label: '主屏出现' });
    await page.waitFor(`(${textOf('hpTx')}) !== '—' && (${textOf('hpTx')}) !== ''`, {
      label: 'sc 帧到达',
    });

    // ── ① 物件面板（600×940） ──────────────────────────────────────────────
    const hasItem = await page.eval(
      `(() => { const e = document.querySelector('#roomItems > *'); if (e === null) return false; e.click(); return true; })()`,
    );
    if (hasItem !== true) throw new Error('房间里没有可点物件 —— 本脚本的前置不成立');
    await page.waitFor(`(${visible('dialog')}) === true`, { label: '物件面板打开' });

    let vp = await page.eval(viewportOf);
    let dialog = await page.eval(rectOf('#dialog'));
    let bottomBar = await page.eval(rectOf('#bottomBar'));

    assertInViewport(dialog, vp, '①[600×940] 物件面板在视口内');
    assertAbove(dialog, bottomBar, '①[600×940] 面板不压住底部工具条');
    assertInside(await page.eval(rectOf('#dlgBody')), dialog, '③[600×940] 正文在面板框内');
    await assertFootButtons(page, vp, '②[600×940]');

    // ── ④ 缩到小屏：resize 必须**重算**几何 ────────────────────────────────
    //    §60 那一类的现场：inline top/left/max-height 是开面板那一刻量死的，
    //    视口一变就全部失效。这里缩到 380×700（比 wushen 支持的最窄还窄一档）。
    await page.setViewport(380, 700);
    vp = await page.eval(viewportOf);
    dialog = await page.eval(rectOf('#dialog'));
    bottomBar = await page.eval(rectOf('#bottomBar'));
    assertInViewport(dialog, vp, `④[${String(vp.w)}×${String(vp.h)}] 缩窄后物件面板仍在视口内`);
    assertAbove(dialog, bottomBar, `④[${String(vp.w)}×${String(vp.h)}] 缩窄后仍不压工具条`);
    assertInside(await page.eval(rectOf('#dlgBody')), dialog, '④ 缩窄后正文仍在面板框内');
    await assertFootButtons(page, vp, `④[${String(vp.w)}×${String(vp.h)}]`);

    // ── ⑤⑥ 数据面板（回到大屏） ──────────────────────────────────────────
    await page.setViewport(600, 940);
    await page.eval(`(() => { document.getElementById('dlgClose').click(); return true; })()`);
    await page.waitFor(`(${visible('dialog')}) === false`, { label: '物件面板已关闭' });

    await page.eval(
      `(() => { const e = document.querySelector('#bottomBar [data-act="score"]');` +
        ` if (e === null) return false; e.click(); return true; })()`,
    );
    await page.waitFor(
      `(() => { const d = document.getElementById('dialog');` +
        ` return d !== null && !d.hidden && d.classList.contains('is-data'); })()`,
      { label: '数据面板打开' },
    );

    vp = await page.eval(viewportOf);
    const dataDialog = await page.eval(rectOf('#dialog'));
    assertInViewport(dataDialog, vp, '⑤ 数据面板在视口内');

    // §62：面板是 `position:fixed` 盖在房间区上的，消息流位置不动 ⇒
    // 必须给 `#output` 加 padding-top 让位，否则"开了属性面板，消息流像是空的"。
    const lastLine = await page.eval(
      `(() => { const lines = document.querySelectorAll('#output .ln');` +
        ` if (lines.length === 0) return null;` +
        ` const r = lines[lines.length - 1].getBoundingClientRect();` +
        ` return { top: r.top, bottom: r.bottom }; })()`,
    );
    if (lastLine === null) {
      fail('⑤ 消息流最后一行露在面板下方', '消息流是空的，本判据不成立（服务端没推文本？）');
    } else if (lastLine.top < dataDialog.bottom - SLACK) {
      fail(
        '⑤ 消息流最后一行露在面板下方',
        `被面板盖住：行顶 ${lastLine.top.toFixed(1)} < 面板底 ${dataDialog.bottom.toFixed(1)}`,
      );
    } else {
      pass('⑤ 消息流最后一行露在面板下方', `行顶 ${lastLine.top.toFixed(1)} ≥ 面板底 ${dataDialog.bottom.toFixed(1)}`);
    }

    // ⑥ §60 的根因：数据面板写下的 inline left/width 留在物件面板上，
    //    再叠 `translateX(-50%)` ⇒ 左移半个身位。必须被清掉。
    await page.eval(
      `(() => { const e = document.querySelector('#roomItems > *'); if (e !== null) e.click(); return true; })()`,
    );
    await page.waitFor(
      `(() => { const d = document.getElementById('dialog');` +
        ` return d !== null && !d.hidden && !d.classList.contains('is-data'); })()`,
      { label: '切回物件面板' },
    );
    const leftovers = await page.eval(
      `(() => { const d = document.getElementById('dialog');` +
        ` return { left: d.style.left, width: d.style.width, top: d.style.top }; })()`,
    );
    if (leftovers.left !== '' || leftovers.width !== '') {
      fail(
        '⑥ 切回物件面板后 inline left/width 已清',
        `残留 left=${JSON.stringify(leftovers.left)} width=${JSON.stringify(leftovers.width)}`,
      );
    } else {
      pass('⑥ 切回物件面板后 inline left/width 已清', `top=${JSON.stringify(leftovers.top)}`);
    }
    const afterSwitch = await page.eval(rectOf('#dialog'));
    assertInViewport(afterSwitch, vp, '⑥ 切换后面板仍在视口内');

    const shot = await page.screenshot('layout-final');
    process.stdout.write(`  · 截图 ${shot}\n`);

    for (const line of page.logs) {
      if (line.startsWith('[exception]') || line.startsWith('[console:error]')) problems.push(line);
    }
  } catch (e) {
    problems.push(e instanceof Error ? e.message : String(e));
    if (page !== null) {
      for (const l of page.logs.slice(-12)) problems.push(`  ${l}`);
    }
  } finally {
    if (page !== null) await page.close().catch(() => {});
    server?.child.kill();
  }

  const failed = results.filter((r) => !r.ok);
  process.stdout.write('\n');
  for (const r of results) {
    process.stdout.write(`  ${r.ok ? '✅' : '❌'} ${r.label}${r.note === '' ? '' : `  · ${r.note}`}\n`);
  }
  process.stdout.write(`\n  共 ${String(results.length)} 条，失败 ${String(failed.length)} 条\n`);

  if (problems.length > 0) {
    process.stdout.write(`\n❌ 运行期问题（${String(problems.length)} 条）：\n`);
    for (const p of problems) process.stdout.write(`  ${p}\n`);
  }
  if (failed.length > 0 || problems.length > 0) return EXIT_FAIL;
  process.stdout.write('\n✅ 版式断言全部通过\n');
  return EXIT_PASS;
}

try {
  process.exitCode = await run();
} catch (e) {
  process.stderr.write(
    `版式脚本自身崩溃：${e instanceof Error ? (e.stack ?? e.message) : String(e)}\n`,
  );
  process.exitCode = EXIT_CRASH;
}

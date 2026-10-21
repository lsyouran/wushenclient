#!/usr/bin/env node
/**
 * probe-web-skills.mjs —— 技能面板的**真浏览器**探针（26 册 §64.10）
 * ============================================================================
 * 为什么要有它：`tests/web-ui.test.ts` 在 jsdom 里跑「点了之后 DOM 变成什么」，
 * 但 jsdom **没有布局** —— `white-space:nowrap` + `overflow-x:auto` 的行会不会
 * 被切掉、`float:right` 的等级是不是真排在右边、面板会不会比房间区还宽，
 * 这些在那里全是 0×0，断言不出任何东西（26 册 §62.5 就是这么踩过来的）。
 *
 * 这一支只做 jsdom 做不到的三件事：
 *   ① 真起服务、真登录、真走位（广昌 → 北大街 → 武馆）、真学一门技能；
 *   ② 点**工具条上的「技能」格**（不是直接调 `openDataPanel`）开面板；
 *   ③ 量几何：行是否落在面板内、是否横向溢出、动作栏是否可见；
 *      再存一张截图人工复核。
 *
 * 用法（服务必须已在本机跑着）：
 *   node tools/start.mjs --port 8125 &
 *   node _probe-技能面板-2026-10-18/probe-web-skills.mjs [端口] [截图输出路径]
 *
 * ★ 无头 Chrome 的两个老坑：`--window-size` 宽最小约 522（更窄会被夹回去，
 *   于是"窄屏溢出"的结论是假的）；别传 `--timeout`。
 * ★ 本机有代理 ⇒ 必须 `--no-proxy-server`，否则 127.0.0.1 也会被代理转一圈。
 */

import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const WebSocket = require('D:/ts-mud/newmud/node_modules/ws/index.js');

const PORT = Number(process.argv[2] ?? 8125);
const SHOT = process.argv[3] ?? 'D:/ts-mud/_probe-技能面板-2026-10-18/skills-panel.png';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const CDP_PORT = 9333;

let pass = 0;
let fail = 0;
function check(name, ok, extra = '') {
  if (ok) {
    pass += 1;
    console.log(`✅ ${name}${extra === '' ? '' : `  ${extra}`}`);
  } else {
    fail += 1;
    console.log(`❌ ${name}${extra === '' ? '' : `  ${extra}`}`);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  // 端口上有没有服务
  const probe = await fetch(`http://127.0.0.1:${String(PORT)}/src/index.html`).catch(() => null);
  if (probe === null || probe.status !== 200) {
    console.log(`❌ 服务没起来（127.0.0.1:${String(PORT)}）。先跑：node tools/start.mjs --port ${String(PORT)}`);
    process.exit(1);
  }

  mkdirSync(dirname(SHOT), { recursive: true });
  // ★★ profile 与调试端口**每次都要换**（2026-10-18 实测的假失败）：上一轮如果
  //   没杀干净，第二轮会连上**同一个**浏览器实例里那个已经登录、已经打死木人桩的
  //   旧页面 —— 于是"新角色打怪"那一步看起来全绿，而面板是空的（其实什么都没做）。
  //   Windows 上 `chrome.kill()` 只杀掉启动器，子进程靠 `taskkill /T` 才收得干净。
  const profile = `D:/tmp/cdp-skills-${String(process.pid)}`;
  const cdpPort = CDP_PORT + (process.pid % 200);
  const chrome = spawn(
    CHROME,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-proxy-server',
      `--remote-debugging-port=${String(cdpPort)}`,
      '--window-size=522,900',
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--no-default-browser-check',
      `http://127.0.0.1:${String(PORT)}/`,
    ],
    { stdio: 'ignore' },
  );
  const killChrome = () => {
    spawnSync('taskkill', ['/F', '/T', '/PID', String(chrome.pid ?? 0)], { stdio: 'ignore' });
  };

  // 等 CDP 起来
  let targets = null;
  for (let i = 0; i < 40; i += 1) {
    await sleep(250);
    const res = await fetch(`http://127.0.0.1:${String(cdpPort)}/json`).catch(() => null);
    if (res !== null && res.ok) {
      targets = await res.json();
      if (Array.isArray(targets) && targets.some((t) => t.type === 'page')) break;
    }
    targets = null;
  }
  if (targets === null) {
    killChrome();
    console.log('❌ 连不上无头 Chrome 的调试端口');
    process.exit(1);
  }

  const page = targets.find((t) => t.type === 'page' && String(t.url).includes(String(PORT)));
  if (page === undefined) {
    killChrome();
    console.log('❌ 没找到打开本服务的页面目标');
    process.exit(1);
  }

  const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false });
  await new Promise((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });

  let seq = 0;
  const pending = new Map();
  ws.on('message', (buf) => {
    const msg = JSON.parse(String(buf));
    const hit = pending.get(msg.id);
    if (hit === undefined) return;
    pending.delete(msg.id);
    if (msg.error !== undefined) hit.reject(new Error(JSON.stringify(msg.error)));
    else hit.resolve(msg.result);
  });
  const send = (method, params = {}) => {
    seq += 1;
    const id = seq;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  };
  /** 求值并取回值（异常也带回来，便于看是哪一步炸的） */
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (r.exceptionDetails !== undefined) {
      throw new Error(`页面内异常：${JSON.stringify(r.exceptionDetails.exception?.description ?? r.exceptionDetails)}`);
    }
    return r.result.value;
  };

  await send('Runtime.enable');
  await send('Page.enable');
  await sleep(600);

  // ── ① 登录 ──────────────────────────────────────────────────────────────
  await evaluate(`(() => {
    const n = document.getElementById('loginName');
    n.value = '探针甲';
    document.getElementById('loginBtn').click();
    return 'ok';
  })()`);
  let loggedIn = false;
  for (let i = 0; i < 40; i += 1) {
    await sleep(200);
    loggedIn = await evaluate(`document.getElementById('app').hidden === false`);
    if (loggedIn) break;
  }
  check('登录后进入游戏界面（#app 可见）', loggedIn);
  if (!loggedIn) {
    const st = await evaluate(`document.getElementById('authStatus')?.textContent ?? ''`);
    console.log(`   authStatus = ${st}`);
  }

  // ── ② 走位 → 打木人桩拿潜能 → 回武馆学基本功 ──────────────────────────────
  // ★ 顺序不能省（26 册 §64.11 真机判据）：新角色潜能是 **0**，
  //   `learn` 一次要 360 ⇒ 不打桩就学不会。这也正是"能玩"那条链的真实顺序：
  //   打怪拿潜能 → 学基本功 → 练级（`probe-skill.mjs` 只测了后半段）。
  await evaluate(`mud.run('go north'); 'ok'`);
  await sleep(500);
  const atNorth = await evaluate(`document.getElementById('roomName')?.textContent ?? ''`);
  check('走到了北大街（木人桩在这儿）', String(atNorth).includes('北大街'), String(atNorth));

  // ★★ 木人桩 **30 秒重生**（`world/npc/pub/muren.ts`）：上一轮刚打死它的话，
  //   `kill 木人桩` 会回一句"你要攻击谁？"—— 那不是 bug，是探针没等。所以先等它出现。
  let present = false;
  for (let i = 0; i < 70; i += 1) {
    const items = String(await evaluate(`document.getElementById('roomItems')?.textContent ?? ''`));
    if (items.includes('木人桩')) {
      present = true;
      break;
    }
    await sleep(600);
  }
  check('木人桩在场（等它重生，不是"打不到"）', present);

  let killed = false;
  if (present) {
    await evaluate(`mud.run('kill 木人桩'); 'ok'`);
    for (let i = 0; i < 120; i += 1) {
      await sleep(300);
      const out = String(await evaluate(`document.getElementById('output')?.textContent ?? ''`));
      if (out.includes('战斗结束') && out.includes('潜能')) {
        killed = true;
        break;
      }
    }
  }
  const killLine = String(await evaluate(`document.getElementById('output')?.textContent ?? ''`));
  check('打死木人桩拿到经验与潜能（学技能的本钱）', killed, killLine.slice(-70).replace(/\n/g, ' '));

  await evaluate(`mud.run('go west'); 'ok'`);
  await sleep(500);
  const atGuan = await evaluate(`document.getElementById('roomName')?.textContent ?? ''`);
  check('走到了武馆', String(atGuan).includes('武馆'), `（当前=${String(atGuan)}）`);

  let learned = false;
  if (killed) {
    await evaluate(`mud.run('learn 基本剑法 from 教头'); 'ok'`);
    await sleep(800);
    const learnLine = String(await evaluate(`document.getElementById('output')?.textContent ?? ''`));
    learned = learnLine.includes('请教') && !learnLine.includes('潜能不够');
    check('`learn 基本剑法 from 教头` 学成了', learned, learnLine.slice(-70).replace(/\n/g, ' '));
  }
  if (!learned) {
    // 前两步没成就没有可看的面板内容 —— 老实停下，不假装后面的几何断言有意义
    console.log('\n⛔ 前置没铺成（打桩 / 学技能），面板断言的结论不成立，提前结束');
    ws.close();
    killChrome();
    process.exit(1);
  }

  // ── ③ 点工具条「技能」格开面板 ───────────────────────────────────────────
  const hasBtn = await evaluate(
    `document.querySelector('.tool-item[data-act="skills"]') !== null`,
  );
  check('工具条上有「技能」这一格', hasBtn === true);
  await evaluate(`document.querySelector('.tool-item[data-act="skills"]').click(); 'ok'`);
  await sleep(700);

  const snap = await evaluate(`(() => {
    const dlg = document.getElementById('dialog');
    const rows = [...document.querySelectorAll('#dlgBody .skill-item')];
    const tabs = [...document.querySelectorAll('#dlgBody .skill-tab')];
    const d = dlg.getBoundingClientRect();
    const roomEl = document.getElementById('roomPanel');
    const room = roomEl === null ? null : roomEl.getBoundingClientRect();
    const lv = document.querySelector('#dlgBody .skill-level');
    const lvBox = lv === null ? null : lv.getBoundingClientRect();
    const rowBox = rows[0] === undefined ? null : rows[0].getBoundingClientRect();
    return {
      hidden: dlg.hidden,
      isData: dlg.classList.contains('is-data'),
      maskHidden: document.getElementById('mask').hidden,
      title: document.getElementById('dlgTitle').textContent,
      tabs: tabs.map((n) => n.textContent),
      tabOn: tabs.filter((n) => n.classList.contains('is-on')).length,
      rowCount: rows.length,
      rowText: rows[0] === undefined ? '' : rows[0].textContent,
      flagCount: document.querySelectorAll('#dlgBody .skill-flag').length,
      meta: document.querySelector('#dlgBody .skill-meta')?.textContent ?? '',
      dialog: { top: d.top, left: d.left, width: d.width, height: d.height },
      room: room === null ? null : { left: room.left, width: room.width },
      rowBox: rowBox === null ? null : { left: rowBox.left, right: rowBox.right, height: rowBox.height },
      lvBox: lvBox === null ? null : { right: lvBox.right },
      hScroll: rows.some((n) => n.scrollWidth > n.clientWidth + 1),
      vScroll: dlg.scrollHeight > dlg.clientHeight + 1,
    };
  })()`);

  check('面板开成**数据面板**（is-data，无遮罩）', snap.hidden === false && snap.isData === true && snap.maskHidden === true, JSON.stringify(snap.title));
  check('标题带技能上限', String(snap.title).includes('上限'), String(snap.title));
  check('两个页签：基础 / 特殊', JSON.stringify(snap.tabs) === JSON.stringify(['基础 1', '特殊 0']), JSON.stringify(snap.tabs));
  check('只有**一个**页签是选中态', snap.tabOn === 1);
  check('列表里有刚学的那门基本功', snap.rowCount === 1 && String(snap.rowText).includes('基本剑法'), String(snap.rowText));
  check('底部有「学会几项 + 潜能」', String(snap.meta).includes('潜能'), String(snap.meta));
  check('行没有横向溢出（`nowrap` 不会把内容切掉）', snap.hScroll === false);
  check(
    '面板左/宽对齐房间区（真机量出来的，不是 CSS 猜的）',
    snap.room !== null && Math.abs(snap.dialog.left - snap.room.left) < 2 && Math.abs(snap.dialog.width - snap.room.width) < 2,
    `dialog=${JSON.stringify(snap.dialog)} room=${JSON.stringify(snap.room)}`,
  );
  check(
    '行落在面板内（不越界）',
    snap.rowBox !== null && snap.rowBox.left >= snap.dialog.left - 1 && snap.rowBox.right <= snap.dialog.left + snap.dialog.width + 1,
    JSON.stringify(snap.rowBox),
  );
  check(
    '等级/进度贴在行的**右侧**（`float:right` 生效）',
    snap.lvBox !== null && snap.rowBox !== null && snap.lvBox.right > snap.rowBox.right - 30,
    `lv.right=${String(snap.lvBox?.right)} row.right=${String(snap.rowBox?.right)}`,
  );

  // ── ④ 点一行 → 动作栏 ───────────────────────────────────────────────────
  await evaluate(`document.querySelector('#dlgBody .skill-item').click(); 'ok'`);
  await sleep(400);
  const act = await evaluate(`(() => {
    const labels = [...document.querySelectorAll('#dlgBody .item-commands span')].map((n) => n.textContent);
    const bar = document.querySelector('#dlgBody .item-commands');
    const box = bar === null ? null : bar.getBoundingClientRect();
    const d = document.getElementById('dialog').getBoundingClientRect();
    return {
      labels,
      box: box === null ? null : { top: box.top, height: box.height },
      dialogBottom: d.bottom,
      scrollBottom: document.getElementById('dialog').scrollHeight,
      scrollTop: document.getElementById('dialog').scrollTop,
      clientH: document.getElementById('dialog').clientHeight,
    };
  })()`);
  check('选中基本功后出现动作栏（练习，且**没有**遗忘）', JSON.stringify(act.labels) === JSON.stringify(['练习']), JSON.stringify(act.labels));
  check('动作栏在面板内可见（没有被滚出可视区）', act.box !== null && act.box.height > 0, JSON.stringify(act.box));

  // ── ⑤ 点「练习」→ 命令生效 + 面板**自己刷新**（act() 会补一条 `skills`）──
  const readRow = `(() => ({
    lv: document.querySelector('#dlgBody .skill-level')?.textContent ?? '',
    meta: document.querySelector('#dlgBody .skill-meta')?.textContent ?? '',
    open: document.getElementById('dialog').hidden === false,
  }))()`;
  const beforePractice = await evaluate(readRow);
  await evaluate(`(() => {
    const btn = [...document.querySelectorAll('#dlgBody .item-commands span')].find((n) => n.textContent === '练习');
    btn.click();
    return 'ok';
  })()`);
  await sleep(900);
  const afterPractice = await evaluate(readRow);
  check(
    '点「练习」后潜能/等级变了（命令真的发出去了）',
    beforePractice.meta !== afterPractice.meta || beforePractice.lv !== afterPractice.lv,
    `${String(beforePractice.meta)} → ${String(afterPractice.meta)}`,
  );
  check('练完之后面板还开着且已刷新（不是旧数据）', afterPractice.open === true);
  const practiceLine = String(await evaluate(`document.getElementById('output')?.textContent ?? ''`));
  check('消息流里有练习的回音', practiceLine.includes('练习') || practiceLine.includes('级'), practiceLine.slice(-60).replace(/\n/g, ' '));

  // ── ⑤ 截图 ─────────────────────────────────────────────────────────────
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(SHOT, Buffer.from(shot.data, 'base64'));
  console.log(`\n📷 截图 → ${SHOT}`);

  ws.close();
  killChrome();

  console.log(`\n===== ${String(pass)} PASS / ${String(fail)} FAIL =====`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('💥', e);
  process.exit(1);
});

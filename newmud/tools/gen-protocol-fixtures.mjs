#!/usr/bin/env node
/**
 * tools/gen-protocol-fixtures.mjs — 抓**真机报文字**给 Kotlin 契约测试当样本
 * ============================================================================
 * 为什么要有这一步（26 册 §82.4）：
 *   `DecodeTest.kt` 要在**没有安卓设备、没有 Node 服务器**的 JVM 里证明
 *   "Kotlin 那套 data class 能解开本项目真实发出来的帧"。
 *   手写的样本没有这个证明力 —— 手写的样本与手写的解析器可以一起错。
 *   ⇒ 起一个**真的**服务端，走一段**真的**登录 + 指令，把收到的帧原样存成 JSON。
 *
 * 三层自证（缺一层这个夹具就只是"一些看起来像协议的文字"）：
 *   ① 每一帧都过一遍 zod schema（`SERVER_PACKET_SCHEMAS`）——
 *      样本自己得是**合法包**，否则 Kotlin 解开一个非法包也不能说明什么；
 *   ② `EXPECTED` 里那几类必须**真的出现**——服务器哪天不在登录时发 `items` 了，
 *      这里要红，而不是安静地少写几个文件；
 *   ③ 覆盖表打印出来：35 个包类型里这次抓到几个、缺哪些。
 *      **缺的不补写空样本**（空样本 = 假绿：Kotlin 侧会以为测过）。
 *
 * 用法：
 *   node tools/gen-protocol-fixtures.mjs           # 抓帧并写文件
 *   node tools/gen-protocol-fixtures.mjs --list    # 只打印现有样本与覆盖面（不连服务器）
 *
 * ★ 需要先能起服务器（`tools/start.mjs`）。它**不构建前端** —— WS 不依赖 `dist/web`，
 *   静态资源 404 与本脚本无关。
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import WebSocket from 'ws';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const OUT_DIR = join(ROOT, 'android', 'protocol', 'src', 'test', 'resources', 'fixtures');

const LIST_ONLY = process.argv.includes('--list');

// ★ `tools/` 内的退出码必须走常量（G6 的 R6.7）：裸数字退出码是一条红线规则 ——
//   它守的是"退出码四态"（0 通过 / 1 违规 / 2 跳过 / 3 崩溃，见 26 册 §27）。
import { EXIT_FAIL, EXIT_PASS } from './gate/lib.mjs';
/** 把抓到的每一帧打出来（排查"为什么这一类没抓到"时用） */
const VERBOSE = process.argv.includes('--verbose');

const { registerTsHooks } = await import('./dev/ts-loader.ts');
registerTsHooks();
const protocol = await import('../shared/protocol.js');
const {
  SERVER_PACKET_SCHEMAS: SCHEMAS,
  SERVER_PACKET_TYPES: TYPES,
  SERVER_PACKET_UNWIRED: UNWIRED,
  PROTOCOL_VERSION,
} = protocol;

/**
 * 抓不到、但也**确实无处可抓**的类型 —— 显式的缺口台账。
 *
 * ★ 这张表存在的意义是让"缺口"必须被写下来，而不是被 `missing` 这个变量默默吸收。
 *   当前**为空**：所有抓不到的类型都能用 `SERVER_PACKET_UNWIRED` 解释
 *   （服务端压根没有生产者 ⇒ 真机上不会有那一帧 ⇒ 谁写样本谁就是在编）。
 * ★ 将来某个包接上线了却没被本脚本覆盖，脚本会红并指名道姓；
 *   要么给脚本加一步真实操作，要么在这里写清"为什么这一步做不到"。
 */
const KNOWN_GAPS = Object.freeze({
  /**
   * `die` 只在**玩家自己死**的时候发（`server/session.ts:562`）。
   * 起始角色 610 血、能去的房间里最强的是 40 血的木人桩 —— 抓不到自己死。
   * ⇒ 这一帧在安卓端**没有任何真报文验过**，属已知空白（已记进 26 册）。
   */
  die: '需要玩家死亡；起始区域打不过也打不死自己',
});

/**
 * 这一次脚本化会话**必须**产出的包类型。
 *
 * ★ 这是本脚本的自检：漏一个说明服务端行为变了（或登录流程变了），
 *   而"少几个样本"不会让 Kotlin 测试红 —— 它只会少测一点。
 *   这类"只在有人改动时才红"的判据必须显式列出来（24 册铁律 5）。
 */
const EXPECTED = Object.freeze(['login', 'room', 'items', 'warn', 'dialog']);

/** 把一条指令发出去（明文通道；服务端也接受 `command` 包，见 protocol） */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function capture() {
  const child = spawn(process.execPath, ['tools/start.mjs', '--port', '0'], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stderr.on('data', (b) => process.stderr.write(String(b)));

  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('等服务端 READY 超时（20s）'));
    }, 20_000);
    child.stdout.on('data', (b) => {
      const m = /READY (\{.*\})/.exec(String(b));
      if (m !== null) {
        clearTimeout(timer);
        resolve(Number(JSON.parse(m[1]).port));
      }
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`服务端提前退出，code=${String(code)}`));
    });
  });

  const frames = [];
  const push = (f) => {
    frames.push(f);
    if (VERBOSE) {
      const brief = typeof f['content'] === 'string' ? f['content'].slice(0, 60) : '';
      console.log(`  ${String(f['type']).padEnd(12)} ${brief}`);
    }
  };
  // ★ 路径是 `/ws`（不是 `/`）：少了它就是 400 —— 这行注释是踩过的坑。
  const ws = new WebSocket(`ws://127.0.0.1:${String(port)}/ws`);
  ws.on('message', (raw) => {
    const text = typeof raw === 'string' ? raw : String(raw);
    try {
      push(JSON.parse(text));
    } catch {
      /* 非 JSON 帧不参与（服务端也可能发明文文本帧） */
    }
  });
  await new Promise((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });

  /**
   * 第二个客户端。
   *
   * ★ 为什么需要它：`msg`（聊天）是**收方**才拿到的包 —— 自说自话抓不到。
   *   它登进来的那一刻顺带产出 `roles`/`login`，也让"同房间另一个玩家"这个
   *   真机场景变成样本来源。
   */
  const peerFrames = [];
  const peer = new WebSocket(`ws://127.0.0.1:${String(port)}/ws`);
  peer.on('message', (raw) => {
    try {
      peerFrames.push(JSON.parse(String(raw)));
    } catch {
      /* 同上 */
    }
  });
  await new Promise((resolve, reject) => {
    peer.once('open', resolve);
    peer.once('error', reject);
  });

  const send = (body) => {
    ws.send(JSON.stringify({ v: PROTOCOL_VERSION, ...body }));
  };

  try {
    send({ type: 'login', token: 't'.repeat(20), role_id: '抓帧者' });
    peer.send(JSON.stringify({ v: PROTOCOL_VERSION, type: 'login', token: 't'.repeat(20), role_id: '旁边人' }));
    await sleep(700);

    // 房间里的第一个物件（店小二）—— 用服务端给的 id，不猜
    const items = frames.find((f) => f['type'] === 'items');
    const firstItemId = items?.['items']?.[0]?.['id'];

    if (typeof firstItemId === 'string' && firstItemId !== '') {
      // 点 NPC：服务端回 `item` 帧（前端据此开物件面板），底部带它的动作
      ws.send(`look ${firstItemId}`);
      await sleep(300);
      // 面板里的动作 → `cmds` 帧（下一层可做的事）
      ws.send(`ask ${firstItemId}`);
      await sleep(300);
    }

    for (const cmd of ['look', 'score', 'skills', 'dazuo', 'say 你好', 'tell 旁边人 你好', 'hp']) {
      ws.send(cmd);
      await sleep(250);
    }

    // 北大街：西边是武馆，东边回中央广场。木人桩在**北大街**（不在武馆）。
    ws.send('north');
    await sleep(400);

    // ★ `state`：`study`（研读）是**持续状态**，`startState` 会发 `state` 帧。
    //   武馆（`yz/wuguan`）里有 `book/sword`（基本剑法入门谱）——
    //   它 `studyMaxLevel: 60` 且**没有**等级闸门，新手真读得动。
    //   ★ 不能用 `book/taijijian`：那本要求 `sword ≥ 30`，起始角色只有个位数，
    //     只会得到「你的sword等级不够 30 级…」（踩过）。
    //   ★ 目标匹配是 `id | name | path | path 末段`（`findTarget`）⇒ `sword` 命中。
    //   ★★ 顺序不能颠倒：`study` 的闸门里有 `fight`，读着书去打木人桩没问题，
    //     但**先打再读**是死路 —— `flee` 会把玩家甩回上一个房间，
    //     后面的 `west`/`get`/`study` 全都打空（实测：先打后读只收获三句「什么？」）。
    ws.send('west');
    await sleep(400);
    ws.send('get sword');
    await sleep(300);
    ws.send('study sword');
    await sleep(1_200);
    ws.send('stop');
    await sleep(400);

    // 回北大街打木人桩：combat / sc / status 这一族
    ws.send('east');
    await sleep(400);
    ws.send('kill muren');
    await sleep(3_000);

    // ★ `loginerror`：没登录就敲指令。这条只有"第三条连接"才拿得到，
    //   因为前两条已经登录了 —— 于是顺便证明"一个进程里多连接互不干扰"。
    const lurker = new WebSocket(`ws://127.0.0.1:${String(port)}/ws`);
    lurker.on('message', (raw) => {
      try {
        frames.push(JSON.parse(String(raw)));
      } catch {
        /* 同上 */
      }
    });
    await new Promise((resolve, reject) => {
      lurker.once('open', resolve);
      lurker.once('error', reject);
    });
    lurker.send('look');
    await sleep(400);
    lurker.close();
  } finally {
    ws.close();
    peer.close();
    child.kill();
  }
  return [...frames, ...peerFrames];
}

// ── 主流程 ──────────────────────────────────────────────────────────────────

if (LIST_ONLY) {
  const have = existsSync(OUT_DIR)
    ? readdirSync(OUT_DIR)
        .filter((f) => f.endsWith('.json') && f !== '_index.json')
        .map((f) => f.slice(0, -5))
    : [];
  report(have);
} else {
  const frames = await capture();
  mkdirSync(OUT_DIR, { recursive: true });

  /** 每种类型只留**第一帧**：夹具的用途是"能解开"，不是"覆盖所有取值" */
  const first = new Map();
  const counts = new Map();
  for (const f of frames) {
    const t = f['type'];
    if (typeof t !== 'string') continue;
    counts.set(t, (counts.get(t) ?? 0) + 1);
    if (!first.has(t)) first.set(t, f);
  }

  // ① 每帧必须是合法包 —— 样本自己得站得住
  const bad = [];
  for (const [t, f] of first) {
    const schema = SCHEMAS[t];
    if (schema === undefined) {
      bad.push(`${t}：协议里没有这个类型`);
      continue;
    }
    const parsed = schema.safeParse(f);
    if (!parsed.success) {
      bad.push(`${t}：${JSON.stringify(parsed.error.issues.slice(0, 2))}`);
    }
  }
  if (bad.length > 0) {
    console.error('❌ 抓到的帧有不合法包，样本不可信：');
    for (const line of bad) console.error(`   ${line}`);
    process.exit(EXIT_FAIL);
  }

  // ② 必出类型自检
  const missing = EXPECTED.filter((t) => !first.has(t));
  if (missing.length > 0) {
    console.error(`❌ 这一段会话没抓到应有的包：${missing.join(', ')}`);
    console.error('   服务端行为变了？先查清再更新 EXPECTED —— 别把样本缺口当正常。');
    process.exit(EXIT_FAIL);
  }

  // ③ 缺口必须**有解释**（见 `KNOWN_GAPS`）：抓不到又不在未接线台账里的类型 ⇒ 红。
  //   这条是"覆盖数会漂"的唯一防线：包接上线的那天，样本必须跟上，
  //   否则安卓端那个 data class 永远没被真实报文验过。
  const capturedTypes = new Set(first.keys());
  const unexplained = TYPES.filter(
    (t) => !capturedTypes.has(t) && !UNWIRED.includes(t) && !(t in KNOWN_GAPS),
  );
  if (unexplained.length > 0) {
    console.error(`❌ 这些包**服务端已经在发**，但本脚本没抓到样本：${unexplained.join(', ')}`);
    console.error('   → 给 capture() 加一段真实操作；做不到就在 KNOWN_GAPS 里写清原因。');
    process.exit(EXIT_FAIL);
  }

  for (const [t, f] of first) {
    writeFileSync(join(OUT_DIR, `${t}.json`), `${JSON.stringify(f, null, 2)}\n`, 'utf8');
  }
  writeFileSync(
    join(OUT_DIR, '_index.json'),
    `${JSON.stringify(
      {
        // ★ 不写时间戳：写进去就每次生成都变，diff 里全是噪声
        source: 'tools/gen-protocol-fixtures.mjs（真起服务端抓的帧）',
        protocolVersion: PROTOCOL_VERSION,
        captured: [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0])),
        types: [...first.keys()].sort((a, b) => a.localeCompare(b)),
      },
      null,
      2,
    )}\n`,
    'utf8',
  );

  report([...first.keys()]);
}

function report(have) {
  const missingTypes = TYPES.filter((t) => !have.includes(t));
  const pct = ((have.length / TYPES.length) * 100).toFixed(0);
  console.log(`样本 ${String(have.length)}/${String(TYPES.length)} 个包类型（${pct}%）`);
  if (missingTypes.length > 0) {
    // ★ 缺口分两类，别混成一个数字：
    //   `SERVER_PACKET_UNWIRED` 里的服务端**根本没有生产者** ⇒ 真机上也不会有那一帧；
    //   `KNOWN_GAPS` 里的有生产者但本脚本走不到 ⇒ **安卓端那一帧没被验过**。
    //   后一类才是真空白，必须一眼看见。
    const noProducer = missingTypes.filter((t) => UNWIRED.includes(t));
    const realGaps = missingTypes.filter((t) => !UNWIRED.includes(t));
    if (noProducer.length > 0) {
      console.log(`  未接线（服务端没有生产者，${String(noProducer.length)}）：${noProducer.join(', ')}`);
    }
    if (realGaps.length > 0) {
      console.log(`  ⚠ 真空白（有生产者但没样本，${String(realGaps.length)}）：`);
      for (const t of realGaps) console.log(`     ${t} —— ${KNOWN_GAPS[t] ?? '（未写原因）'}`);
    }
  }
  console.log(`目录：${OUT_DIR}`);
  // ★ 不打印"已覆盖 = 全部正常"：覆盖不到的包 Kotlin 侧根本没测过，
  //   这条输出只是让人看见缺口，不是通过证书。
  if (have.length === 0) {
    console.log('（还没有样本：先跑 node tools/gen-protocol-fixtures.mjs）');
  }
}

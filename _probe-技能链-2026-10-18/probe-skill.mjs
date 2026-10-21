// probe-skill — §65 后端技能链真机走查（纯 WS，不开浏览器）
//
// 验证 27 册 §14.7 的验收判据里**只能在真服务器上看到**的那几条：
//   登录 → 北大街打桩拿潜能 → 进武馆学基本剑法 → 反向判据 → 面板帧形状
//
//   node probe-skill.mjs            （默认连 127.0.0.1:8155）
//
// ★ 为什么不用浏览器：这一批改的全是**服务端**行为（学 / 装 / 忘 / 面板帧）。
//   浏览器探针只在"看版式"时才必要；WS 能精确读到每一帧。
// ★ "练到 30 级再学太极剑法"那条**不在这里**：打五只木人桩要两分半（30 秒重生），
//   那条链由 `tests/skill-learn.test.ts` 的端到端用例覆盖（同一套真内容、真 NPC）。
import { spawn } from 'node:child_process';

const PORT = Number(process.env.MUD_PORT ?? 8155);
const BASE = `ws://127.0.0.1:${PORT}/ws`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const srv = spawn(process.execPath, ['tools/start.mjs', '--port', String(PORT)], {
  cwd: 'D:/ts-mud/newmud',
  stdio: ['ignore', 'pipe', 'pipe'],
});
let srvOut = '';
srv.stdout.on('data', (d) => { srvOut += String(d); });
srv.stderr.on('data', (d) => { srvOut += String(d); });

async function waitUp() {
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/src/index.html`, { redirect: 'manual' });
      if (r.status < 500) return;
    } catch { /* 还没起 */ }
    await sleep(300);
  }
  throw new Error(`服务没起来：\n${srvOut.slice(-2000)}`);
}

class Client {
  #ws; #queue = []; #waiters = [];
  constructor(ws) {
    this.#ws = ws;
    ws.onmessage = (e) => {
      this.#queue.push(JSON.parse(String(e.data)));
      const w = this.#waiters.shift();
      if (w) w();
    };
  }
  send(obj) { this.#ws.send(JSON.stringify({ v: 1, ...obj })); }
  async until(pred, ms = 5000) {
    const deadline = Date.now() + ms;
    for (;;) {
      while (this.#queue.length > 0) {
        const p = this.#queue.shift();
        if (pred(p)) return p;
      }
      const left = deadline - Date.now();
      if (left <= 0) return null;
      await Promise.race([new Promise((r) => this.#waiters.push(r)), sleep(left)]);
    }
  }
  /** 发一条命令，收集窗口内的所有回包 */
  async run(cmd, ms = 450) {
    this.send({ type: 'command', cmd });
    const got = [];
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      while (this.#queue.length > 0) got.push(this.#queue.shift());
      await sleep(30);
    }
    return got;
  }
}

// ★ 服务端的 `me.notify()` 走 `{type:'warn', content}`（`session.ts#textPacket`），
//   不是 `{type:'text'}` —— 第一版按 `text` 取，13 条断言全"失败"，实际是探针读错了字段。
const textsOf = (packets) => packets
  .flatMap((p) => (p.type === 'warn' ? [String(p.content ?? '')] : []))
  .join(' / ');
const frameOf = (packets, dialog) => packets.find((p) => p.type === 'dialog' && p.dialog === dialog);

let pass = 0; let fail = 0;
const check = (ok, label, detail = '') => {
  if (ok) { pass += 1; console.log(`  ✅ ${label}`); } else { fail += 1; console.log(`  ❌ ${label}${detail ? '\n     → ' + detail : ''}`); }
};

try {
  await waitUp();
  console.log(`服务已就绪：${BASE}\n`);

  const ws = new WebSocket(BASE);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  const c = new Client(ws);

  c.send({ type: 'login', token: 'probe-skill-token-0123456789abcdef', role_id: '技能验' });
  const login = await c.until((p) => p.type === 'login' || p.type === 'loginerror');
  console.log('① 登录', login?.type === 'login' ? 'OK' : JSON.stringify(login));
  await sleep(600);

  console.log('\n【判据 0】新玩家技能簿为空');
  let ps = await c.run('skills');
  let frame = frameOf(ps, 'skills');
  check(frame !== undefined, '收到 dialog:skills 帧', JSON.stringify(ps).slice(0, 300));
  check(frame?.items?.length === 0, 'items 为空', JSON.stringify(frame?.items));
  check(frame?.title === '没有学会任何技能', `title = "${String(frame?.title)}"`);

  console.log('\n【判据 7】跟不会这门的人学 → no-teacher');
  ps = await c.run('north'); // 广场 → 北大街（木人桩在这里）
  ps = await c.run('learn 基本剑法 from 木人桩');
  check(/木人桩不会基本剑法/.test(textsOf(ps)), '木人桩不会基本剑法', textsOf(ps));

  console.log('\n【前置】打木人桩拿潜能（打怪 → exp/pot 是这条链的燃料）');
  ps = await c.run('kill 木人桩', 14_000);
  const t1 = textsOf(ps);
  check(/你获得了1000 点经验，500 点潜能/.test(t1), '击杀给 1000 经验 / 500 潜能', t1.slice(-200));
  ps = await c.run('score');
  const attr = frameOf(ps, 'score');
  check(attr?.pot === 500, `潜能 = 500（实际 ${String(attr?.pot)}）`);
  check(attr?.skillLimit === 22, `技能上限抬到 22（实际 ${String(attr?.skillLimit)}）`);

  console.log('\n【判据 1】learn 基本剑法 from 教头');
  ps = await c.run('west'); // 北大街 → 武馆
  check(/武馆/.test(textsOf(ps)), '已进入武馆', textsOf(ps));
  ps = await c.run('learn 基本剑法 from 教头', 700);
  check(/请教基本剑法/.test(textsOf(ps)), '学到基本剑法', textsOf(ps));
  ps = await c.run('skills');
  frame = frameOf(ps, 'skills');
  const sword = frame?.items?.find((i) => i.id === 'base/sword');
  check(sword !== undefined, '面板里出现 base/sword', JSON.stringify(frame?.items));
  check(sword?.kind === 'base', `kind = "${String(sword?.kind)}"`);
  check((sword?.level ?? 0) >= 1, `等级 ${String(sword?.level)} ≥ 1`);
  check(typeof sword?.progress === 'number', `progress = ${String(sword?.progress)}（服务端算）`);

  console.log('\n【判据 3】基本功不够就学太极剑法');
  ps = await c.run('learn 太极剑法 from 教头');
  check(/等级不够 30/.test(textsOf(ps)), '报「基本剑法等级不够 30」', textsOf(ps));

  console.log('\n【判据 5】forget 基本剑法 → 被拒（基础不可遗忘）');
  ps = await c.run('forget 基本剑法');
  check(/基本技能，不能遗忘/.test(textsOf(ps)), '基础不可遗忘', textsOf(ps));
  ps = await c.run('forget 不存在的功');
  check(/没有这个技能/.test(textsOf(ps)), '未知技能 → 没有这个技能', textsOf(ps));

  console.log('\n【反向】enable 的三种玩家错误');
  ps = await c.run('enable blade 太极剑法');
  check(/还没学会/.test(textsOf(ps)), '没学过 → 还没学会', textsOf(ps));
  ps = await c.run('enable sword 基本剑法');
  check(/基本技能/.test(textsOf(ps)), '基本技能不可装配', textsOf(ps));
  ps = await c.run('enable nosuch 基本剑法');
  check(/没有「nosuch」这个装配位/.test(textsOf(ps)), '非法槽名有提示', textsOf(ps));

  console.log('\n【判据 6】dialog:skills 帧字段');
  ps = await c.run('cha');
  frame = frameOf(ps, 'skills');
  check(/共学会 1 项技能/.test(String(frame?.title)), `title = "${String(frame?.title)}"`);
  check(typeof frame?.limit === 'number', `limit = ${String(frame?.limit)}`);
  check(typeof frame?.pot === 'number', `pot = ${String(frame?.pot)}`);
  const item = frame?.items?.[0];
  const KEYS = ['id', 'name', 'kind', 'grade', 'level', 'progress', 'enabled', 'canEnables'];
  check(item !== undefined && KEYS.every((k) => k in item), '每项八个字段齐全', JSON.stringify(item));

  // 正向装配需要基本功 30 级（要再打 5 只木人桩、约两分半），由单元测试覆盖；
  // 这里只测"未学会不许装"这一支。
  console.log('\n【判据 4 · 反向】未学会不许装');
  ps = await c.run('enable sword 太极剑法');
  check(/还没学会太极剑法/.test(textsOf(ps)), '未学会 → 拒绝且不静默', textsOf(ps));

  console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
  ws.close();
} catch (e) {
  console.error('探针异常：', e?.stack ?? e);
  fail += 1;
} finally {
  srv.kill();
  await sleep(300);
  process.exitCode = fail === 0 ? 0 : 1;
}

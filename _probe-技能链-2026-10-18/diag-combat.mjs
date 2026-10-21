// 临时诊断：登录 → 北大街 → 打木人桩，打印全部回包，看战斗与奖励是否真的发生
import { spawn } from 'node:child_process';
const PORT = 8156;
const srv = spawn(process.execPath, ['tools/start.mjs', '--port', String(PORT)], {
  cwd: 'D:/ts-mud/newmud', stdio: ['ignore', 'pipe', 'pipe'],
});
let out = '';
srv.stdout.on('data', (d) => { out += String(d); });
srv.stderr.on('data', (d) => { out += String(d); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (let i = 0; i < 100; i++) {
  try { const r = await fetch(`http://127.0.0.1:${PORT}/src/index.html`, { redirect: 'manual' }); if (r.status < 500) break; } catch { }
  await sleep(300);
}
const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
const all = [];
ws.onmessage = (e) => { const p = JSON.parse(String(e.data)); all.push(p); };
const send = (o) => ws.send(JSON.stringify({ v: 1, ...o }));
send({ type: 'login', token: 'diag-token-0123456789abcdefgh', role_id: '诊断者' });
await sleep(800);
console.log('--- 初始 score ---');
send({ type: 'command', cmd: 'score' });
await sleep(500);
for (const p of all.splice(0)) if (p.dialog === 'score') console.log(JSON.stringify({ exp: p.exp, pot: p.pot, hp: p.hp, maxHp: p.maxHp, skillLimit: p.skillLimit }));
console.log('--- north / kill ---');
send({ type: 'command', cmd: 'north' });
await sleep(600);
send({ type: 'command', cmd: 'kill 木人桩' });
await sleep(12000);
for (const p of all.splice(0)) {
  if (p.type === 'warn') console.log('TEXT ', p.content);
  else if (p.type === 'combat') console.log('COMBAT', JSON.stringify(p));
  else if (p.type === 'die') console.log('DIE  ', JSON.stringify(p));
}
console.log('--- 战后 score ---');
send({ type: 'command', cmd: 'score' });
await sleep(500);
for (const p of all.splice(0)) if (p.dialog === 'score') console.log(JSON.stringify({ exp: p.exp, pot: p.pot, hp: p.hp, maxHp: p.maxHp, skillLimit: p.skillLimit }));
ws.close(); srv.kill();
process.exit(0);

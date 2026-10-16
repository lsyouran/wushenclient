/**
 * tests/net-e2e.test.ts —— 真起一个 WebSocket 服务器跑通整条链路
 * ============================================================================
 * 上面几层都是"可脱离网络单测的纯逻辑"，这一层才真正把 socket 接上。
 * 覆盖的是**整条链路**，不是某一环：
 *
 *   客户端帧 → ws 库（maxPayload）→ hub.inbound → frame-pipeline（尺寸/限流/分诊/zod）
 *             → 业务钩子 → hub.enqueue → drain → socket.send → 客户端收到
 *
 * ★ 端口一律用 **0**（系统分配），避免固定端口在 CI 上撞车；
 *   实际端口从 `server.port` 取（`ws-server.ts` 的 `wss.address()`）。
 */
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';

import { MAX_MESSAGE_BYTES, RATE_LIMIT_PER_5S } from '../shared/constants.js';
import { PROTOCOL_VERSION } from '../shared/constants.js';
import { ConnectionHub } from '../server/net/hub.js';
import { startWsServer } from '../server/net/ws-server.js';
import { normalizePeerAddress } from '../server/net/ws-server.js';
import type { MudServer } from '../server/net/ws-server.js';
import type { ErrorCode } from '@shared/protocol.js';

let running: MudServer | null = null;

afterEach(async () => {
  await running?.close();
  running = null;
});

interface Echo {
  commands: string[];
  rejects: Array<[ErrorCode, boolean]>;
}

async function start(
  opts: { maxConnections?: number; maxConnectionsPerIp?: number } = {},
): Promise<{ port: number; echo: Echo }> {
  const echo: Echo = { commands: [], rejects: [] };
  const hub = new ConnectionHub({
    ...(opts.maxConnections === undefined ? {} : { maxConnections: opts.maxConnections }),
    ...(opts.maxConnectionsPerIp === undefined
      ? {}
      : { maxConnectionsPerIp: opts.maxConnectionsPerIp }),
    hooks: {
      onCommand: (conn, command) => {
        echo.commands.push(command);
        // 回一个包，证明"入站 → 业务 → 出站"整条链路通
        hub.enqueue(conn, JSON.stringify({ v: PROTOCOL_VERSION, type: 'warn', content: `你输入了：${command}`, cmds: [] }));
        for (const text of hub.drain(conn)) conn.send(text);
      },
      onLogin: () => undefined,
      onPing: () => undefined,
      // 注意：**不要**在这里 forget —— hub 会先让适配层把错误包发出去，再主动 close + forget
      onReject: (conn, code, _detail, close) => {
        echo.rejects.push([code, close]);
        hub.enqueue(conn, JSON.stringify({ v: PROTOCOL_VERSION, type: 'loginerror', code, msg: code }));
        for (const text of hub.drain(conn)) conn.send(text);
      },
    },
  });
  const server = await startWsServer({ port: 0, hub, timers: false });
  running = server;
  return { port: server.port, echo };
}

/** 连上一个客户端，收集它收到的消息、关闭码与关闭原因 */
function connect(port: number): Promise<{
  ws: WebSocket;
  received: string[];
  closed: Promise<number>;
  /** 服务端给的关闭原因（N4 用它区分"服务器满"与"同址过多"） */
  closeReason: () => string;
}> {
  const received: string[] = [];
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  let reason = '';
  let resolveClosed: (code: number) => void;
  const closed = new Promise<number>((r) => {
    resolveClosed = r;
  });
  ws.on('message', (data) => received.push(String(data)));
  ws.on('close', (code, buf) => {
    reason = buf.toString();
    resolveClosed(code);
  });
  return new Promise((resolve, reject) => {
    ws.on('open', () => resolve({ ws, received, closed, closeReason: () => reason }));
    ws.on('error', reject);
  });
}

function until<T>(check: () => T | undefined, timeoutMs = 2_000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t0 = Date.now();
    const tick = (): void => {
      const v = check();
      if (v !== undefined) return resolve(v);
      if (Date.now() - t0 > timeoutMs) return reject(new Error('等待超时'));
      setTimeout(tick, 10);
    };
    tick();
  });
}

describe('端到端（真 WebSocket）', () => {
  it('明文指令：进去的业务钩子能收到，且能回包', async () => {
    const { port, echo } = await start();
    const { ws, received } = await connect(port);
    ws.send('look');
    await until(() => (echo.commands.length > 0 ? true : undefined));
    expect(echo.commands).toEqual(['look']);
    await until(() => (received.length > 0 ? true : undefined));
    expect(received[0]).toContain('你输入了：look');
    ws.close();
  });

  it('JSON 指令同样走通（两条通道归一到同一个钩子）', async () => {
    const { port, echo } = await start();
    const { ws } = await connect(port);
    ws.send(JSON.stringify({ v: PROTOCOL_VERSION, type: 'command', cmd: 'north' }));
    await until(() => (echo.commands.length > 0 ? true : undefined));
    expect(echo.commands).toEqual(['north']);
    ws.close();
  });

  it('超大帧：服务端回绝并**关闭**连接', async () => {
    const { port, echo } = await start();
    const { ws, closed } = await connect(port);
    ws.send('x'.repeat(MAX_MESSAGE_BYTES + 1));
    await until(() => (echo.rejects.length > 0 ? true : undefined));
    expect(echo.rejects[0]?.[0]).toBe('PAYLOAD_TOO_LARGE');
    expect(echo.rejects[0]?.[1]).toBe(true);
    expect(await closed).toBe(1011);
  });

  it(`超过 ${RATE_LIMIT_PER_5S} 条/窗口：被拒但**不**断连`, async () => {
    const { port, echo } = await start();
    const { ws, received } = await connect(port);
    for (let i = 0; i < RATE_LIMIT_PER_5S + 3; i += 1) ws.send(`look ${i}`);
    await until(() => (echo.rejects.length > 0 ? true : undefined));
    expect(echo.rejects[0]?.[0]).toBe('RATE_LIMITED');
    expect(echo.rejects[0]?.[1]).toBe(false);
    await until(() => (received.some((r) => r.includes('RATE_LIMITED')) ? true : undefined));
    expect(ws.readyState).toBe(WebSocket.OPEN);
    ws.close();
  });

  it('连接数达上限：新连接被拒（1013）', async () => {
    const { port } = await start({ maxConnections: 1 });
    const first = await connect(port);
    const second = await connect(port).catch(() => null);
    // 第二条要么直接被拒（1013），要么连上后立刻被关
    if (second !== null) {
      expect(await second.closed).toBe(1013);
    }
    first.ws.close();
  });

  /**
   * ★ N4：**同一个来源地址**开太多连接 ⇒ 后来者被拒（1013 + "同一地址连接过多"）。
   *
   * ★ 这条用例天然成立：本机测试里所有连接都来自 `127.0.0.1`，
   *   于是"同址过多"这条判据**真的够得着**（不需要伪造来源地址）。
   * ★ 它同时是"归一化"的回归：`normalizePeerAddress` 若不把 `::ffff:127.0.0.1`
   *   与 `127.0.0.1` 合成一个地址，下面的计数就会分散到两个键上、上限永不触发。
   */
  it('★ 同一地址超过 per-IP 上限：后一条被拒，且**原因与"服务器满"可区分**', async () => {
    const { port } = await start({ maxConnectionsPerIp: 2 });
    const a = await connect(port);
    const b = await connect(port);
    const c = await connect(port).catch(() => null);
    expect(c, '第三条同址连接不该被静默接受').not.toBeNull();
    expect(await c?.closed).toBe(1013);
    expect(c?.closeReason()).toBe('同一地址连接过多');

    // ★ 对照组：前两条**没被误伤**（否则"一律拒绝"也能让上面绿）
    expect(a.ws.readyState).toBe(WebSocket.OPEN);
    expect(b.ws.readyState).toBe(WebSocket.OPEN);
    a.ws.close();
    b.ws.close();
  });
});

// ---------------------------------------------------------------------------
// N4 · 来源地址归一（per-IP 上限的前提）
// ---------------------------------------------------------------------------
describe('normalizePeerAddress', () => {
  it('IPv4-mapped IPv6 归一成 IPv4（否则同一台机器算两个地址，上限被绕过）', () => {
    expect(normalizePeerAddress('::ffff:127.0.0.1')).toBe('127.0.0.1');
    expect(normalizePeerAddress('::FFFF:10.0.0.7')).toBe('10.0.0.7');
  });

  it('普通 IPv4 / IPv6 原样保留（别把真 IPv6 也改写掉）', () => {
    expect(normalizePeerAddress('192.168.1.9')).toBe('192.168.1.9');
    expect(normalizePeerAddress('::1')).toBe('::1');
    expect(normalizePeerAddress('2001:db8::1')).toBe('2001:db8::1');
  });

  it('缺地址 ⇒ undefined（"量不到就不判"，交给 hub 跳过 per-IP）', () => {
    expect(normalizePeerAddress(undefined)).toBeUndefined();
    expect(normalizePeerAddress('')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// ★ 收口：路径与 Origin（2026-10-13 体检 N2）
// ---------------------------------------------------------------------------
//
// 体检结论：`WebSocketServer({server,maxPayload})` 既无 `path` 也无 Origin 校验
// ⇒ **任意路径**都能升级、**任意外部网页**都能跨站建 WS（CSWSH）。
// 这一组把"只认 /ws"与"只认同源"两条钉住。
//
// ★ 每条"拒绝"都配一条"该放行的放行"的对照 —— 否则一个"一律拒绝"的实现也能全绿。

describe('★ 收口：只认 /ws，且只认同源 Origin', () => {
  it('★ 非 /ws 路径 → 握手被拒（400），连不上', async () => {
    const { port } = await start();
    const outcome = await new Promise<string>((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/`);
      ws.on('open', () => {
        ws.close();
        resolve('OPENED');
      });
      ws.on('error', (e: Error) => resolve(e.message));
    });
    expect(outcome).not.toBe('OPENED');
    expect(outcome).toContain('400');
    expect(running?.hub.size).toBe(0);
  });

  it('★ 跨站 Origin（CSWSH）→ 被拒（关闭码 1008），且**不进连接表**', async () => {
    const { port } = await start();
    const code = await new Promise<number>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { origin: 'http://evil.example' });
      ws.on('close', (c) => resolve(c));
      ws.on('error', reject);
    });
    expect(code).toBe(1008);
    expect(running?.hub.size).toBe(0);
  });

  it('★ 缺 Origin（非浏览器客户端）→ 放行（Node 的 ws 客户端不具备 CSWSH 条件）', async () => {
    const { port, echo } = await start();
    const { ws } = await connect(port); // connect() 不带 Origin
    ws.send('look');
    await until(() => (echo.commands.length > 0 ? true : undefined));
    expect(echo.commands).toEqual(['look']);
    expect(running?.hub.size).toBe(1);
    ws.close();
  });

  it('★ 同源 Origin → 放行（否则上面的"跨站被拒"是"一律拒绝"的假绿）', async () => {
    const { port, echo } = await start();
    const ws = await new Promise<WebSocket>((resolve, reject) => {
      const s = new WebSocket(`ws://127.0.0.1:${port}/ws`, {
        origin: `http://127.0.0.1:${port}`,
      });
      s.on('open', () => resolve(s));
      s.on('error', reject);
    });
    ws.send('look');
    await until(() => (echo.commands.length > 0 ? true : undefined));
    expect(echo.commands).toEqual(['look']);
    ws.close();
  });
});

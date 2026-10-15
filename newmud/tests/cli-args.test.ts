/**
 * tests/cli-args.test.ts —— 启动入口的参数解析
 * ============================================================================
 * `npm start` 的可用性取决于这里的三个默认值：端口、要不要发前端、前端产物在哪。
 * 参数解析写成**纯函数**（`parseArgs`）就是为了能把这几条钉住，
 * 而不必真的去 listen 一个端口。
 *
 * ★ 每条覆盖断言都配一个"缺省值不同"的对照组：否则一个"永远返回常量"的
 *   实现也能让覆盖断言通过。
 */
import { describe, expect, it } from 'vitest';
import { join } from 'node:path';

import { PROJECT_ROOT } from '../server/paths.js';
import { DEFAULT_PORT, UsageError, parseArgs } from '../server/cli.js';
import { DEFAULT_WS_HOST } from '../server/net/ws-server.js';

describe('parseArgs · 缺省值', () => {
  it('不给参数时：默认端口、发前端、前端根 = 项目根下的 dist/web', () => {
    const o = parseArgs([]);
    expect(o.port).toBe(DEFAULT_PORT);
    expect(o.serveWeb).toBe(true);
    expect(o.webRoot).toBe(join(PROJECT_ROOT, 'dist', 'web'));
    expect(o.help).toBe(false);
    expect(o.maxConnections).toBeUndefined();
  });

  it('★ 缺省**只绑本机**（2026-10-13 体检 N2：原先不传 host ⇒ 绑全部网卡）', () => {
    expect(parseArgs([]).host).toBe(DEFAULT_WS_HOST);
  });
});

describe('parseArgs · 覆盖', () => {
  it('--port 的两种写法都认，且真的改掉了缺省值', () => {
    expect(parseArgs(['--port', '9001']).port).toBe(9001);
    expect(parseArgs(['--port=9002']).port).toBe(9002);
    expect(parseArgs(['--port', '9001']).port).not.toBe(DEFAULT_PORT);
  });

  it('--no-web 关掉前端（只跑 WebSocket）', () => {
    expect(parseArgs(['--no-web']).serveWeb).toBe(false);
    expect(parseArgs([]).serveWeb).not.toBe(false);
  });

  it('--web-root 相对路径按**项目根**解析，不受启动目录影响', () => {
    const o = parseArgs(['--web-root', 'dist/web']);
    expect(o.webRoot).toBe(join(PROJECT_ROOT, 'dist', 'web'));
  });

  it('--max-connections 有值才带上（无值必须是 undefined，不是 0）', () => {
    expect(parseArgs(['--max-connections', '50']).maxConnections).toBe(50);
    expect(parseArgs([]).maxConnections).not.toBe(50);
  });

  it('★ --host 覆盖缺省（要对外必须显式声明）', () => {
    expect(parseArgs(['--host', '0.0.0.0']).host).toBe('0.0.0.0');
    expect(parseArgs(['--host', '0.0.0.0']).host).not.toBe(DEFAULT_WS_HOST);
    expect(parseArgs(['--host=192.168.1.9']).host).toBe('192.168.1.9');
  });

  it('--help / -h 都认', () => {
    expect(parseArgs(['--help']).help).toBe(true);
    expect(parseArgs(['-h']).help).toBe(true);
    expect(parseArgs([]).help).toBe(false);
  });
});

describe('parseArgs · 坏输入必须炸，不许静默吞掉', () => {
  it('未知参数 → UsageError（并带上那个参数名，便于定位）', () => {
    expect(() => parseArgs(['--nope'])).toThrow(UsageError);
    expect(() => parseArgs(['--nope'])).toThrow(/--nope/);
  });

  it('端口不是数字 / 越界 / 缺值 → UsageError', () => {
    expect(() => parseArgs(['--port', 'abc'])).toThrow(UsageError);
    expect(() => parseArgs(['--port', '70000'])).toThrow(UsageError);
    expect(() => parseArgs(['--port', '-1'])).toThrow(UsageError);
    expect(() => parseArgs(['--port'])).toThrow(UsageError);
  });

  it('端口 0 是合法的（由系统分配，测试要用）', () => {
    expect(parseArgs(['--port', '0']).port).toBe(0);
  });

  it('--host 空值 / 带空白 → UsageError（不许静默接受一个非法地址）', () => {
    expect(() => parseArgs(['--host', ''])).toThrow(UsageError);
    expect(() => parseArgs(['--host', ' '])).toThrow(UsageError);
    expect(() => parseArgs(['--host', 'a b'])).toThrow(UsageError);
    expect(() => parseArgs(['--host'])).toThrow(UsageError);
  });

  it('位置参数（多余的词）→ UsageError', () => {
    expect(() => parseArgs(['whatever'])).toThrow(UsageError);
  });
});

/**
 * G2 · 协议边界（可执行部分）
 * ============================================================================
 * 守住 23 册 §4.1「所有**入站**数据必须过 schema，失败即断连」这条规则里
 * 最容易退化成**装饰**的两处：
 *
 *   1. 版本号 `v` —— 声明了却从不比对时，`ERROR_CODES.PROTOCOL_MISMATCH`
 *      就是**不可达代码**（docs/26 M7 实测：`v=9999` 照样通过）。
 *   2. `.passthrough()` —— 保留未知字段使"字段注入面"扩大，却没有任何收益
 *      （docs/26 §4 实测：当前 zod 版本恰好不构成原型注入，
 *       但那是**实现细节不是我们的契约**）。
 *
 * ★ 回归锚点：本文件里凡标 `★` 的断言，都是首轮审查实测缺陷的守护。
 */
import {
  MAX_MESSAGE_BYTES,
  MAX_PLAINTEXT_CHARS,
  REG_ATTR_RANGE_MAX,
  REG_ATTR_RANGE_MIN,
  REG_ATTR_SUM_TOTAL,
} from '@shared/constants.js';
import {
  ClientPacketSchema,
  EnvelopeSchema,
  ERROR_CODES,
  PLAINTEXT_CHANNEL,
  PROTOCOL_VERSION,
  SERVER_PACKET_SCHEMAS,
  SERVER_PACKET_TYPES,
  byteLengthOf,
  checkEnvelope,
  checkPayloadSize,
  checkPlaintext,
  missingPacketSchemas,
  routeFrame,
} from '@shared/protocol.js';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

/** 用真实不可信数据路径构造信封（JSON.parse 才生成自有属性，见 tests/props.test.ts 的同款坑） */
function envelopeFromJson(raw: string): unknown {
  return JSON.parse(raw);
}

describe('G2.4 信封版本协商（★ docs/26 M7 回归）', () => {
  it('版本必须精确等于 PROTOCOL_VERSION 才通过', () => {
    const ok = EnvelopeSchema.safeParse({ v: PROTOCOL_VERSION, type: 'ping', t: 1 });
    expect(ok.success).toBe(true);
  });

  it('★ 回归锚点：v 为其它值必须被拒（旧实现只校验 int 1..9999，9999 照样通过）', () => {
    for (const v of [0, PROTOCOL_VERSION + 1, 9999, -1, 1.5]) {
      const r = EnvelopeSchema.safeParse({ v, type: 'ping', t: 1 });
      expect(r.success, `v=${String(v)} 不应通过信封校验`).toBe(false);
    }
  });

  it('★ PROTOCOL_MISMATCH 必须是**可达**的：版本不符走这个错误码，而不是笼统的 BAD_PACKET', () => {
    const cases: ReadonlyArray<readonly [string, string]> = [
      ['版本过高', `{"v":${PROTOCOL_VERSION + 1},"type":"ping","t":1}`],
      ['版本过低', `{"v":${PROTOCOL_VERSION - 1},"type":"ping","t":1}`],
      ['远古版本', '{"v":9999,"type":"ping","t":1}'],
    ];
    for (const [label, json] of cases) {
      const r = checkEnvelope(envelopeFromJson(json));
      expect(r.ok, label).toBe(false);
      if (r.ok) continue;
      expect(r.code, label).toBe('PROTOCOL_MISMATCH');
      expect(ERROR_CODES[r.code], label).toBe(ERROR_CODES.PROTOCOL_MISMATCH);
    }
  });

  it('结构本身不成包（缺 v / 缺 type / 非对象）→ BAD_PACKET，不得误报版本不符', () => {
    const juns = ['{}', '{"type":"ping"}', '{"v":1}', '[]', 'null', '3', '"ping"'];
    for (const json of juns) {
      const r = checkEnvelope(envelopeFromJson(json));
      expect(r.ok, json).toBe(false);
      if (r.ok) continue;
      expect(r.code, json).toBe('BAD_PACKET');
    }
  });

  it('合法信封返回 type 与 v（供分发表使用）', () => {
    const r = checkEnvelope({ v: PROTOCOL_VERSION, type: 'command', cmd: 'look' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.type).toBe('command');
    expect(r.v).toBe(PROTOCOL_VERSION);
  });
});

describe('G2.5 信封不再保留未知字段（★ docs/26 §4 实测澄清）', () => {
  it('★ 回归锚点：未知字段必须被丢弃，而不是原样保留', () => {
    const r = EnvelopeSchema.safeParse({ v: PROTOCOL_VERSION, type: 'ping', t: 1, injected: 'x' });
    expect(r.success).toBe(true);
    if (!r.success) return;
    // 信封只认 v / type：`t` 属于具体包体，在**扩展后**的 schema 里才存在。
    expect(Object.keys(r.data).sort()).toEqual(['type', 'v']);
    expect((r.data as Record<string, unknown>)['injected']).toBeUndefined();
  });

  it('扩展后的入站 schema 保留自己的字段，但仍丢弃未知字段', () => {
    const r = ClientPacketSchema.safeParse({
      v: PROTOCOL_VERSION,
      type: 'ping',
      t: 42,
      injected: 'x',
    });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(Object.keys(r.data).sort()).toEqual(['t', 'type', 'v']);
    expect((r.data as Record<string, unknown>)['injected']).toBeUndefined();
  });

  it('入站包的未知字段不得穿透到业务层（ClientPacketSchema 同样丢弃）', () => {
    const r = ClientPacketSchema.safeParse({
      v: PROTOCOL_VERSION,
      type: 'command',
      cmd: 'look',
      __proto__evil: 1,
      injected: 'x',
    });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect((r.data as Record<string, unknown>)['injected']).toBeUndefined();
    expect((r.data as Record<string, unknown>)['__proto__evil']).toBeUndefined();
  });
});

describe('G2.6 出站 schema 覆盖率（★ docs/26 M9 回归）', () => {
  it('★ 回归锚点：每个服务端包类型都必须有 schema（旧实现只有 6/35）', () => {
    expect(missingPacketSchemas()).toEqual([]);
    expect(Object.keys(SERVER_PACKET_SCHEMAS).sort()).toEqual([...SERVER_PACKET_TYPES].sort());
  });

  it('★ 每个 schema 的 `type` 字面量必须与它的注册键逐字一致（防复制粘贴错位）', () => {
    const mismatched: string[] = [];
    for (const t of SERVER_PACKET_TYPES) {
      const schema = SERVER_PACKET_SCHEMAS[t] as z.AnyZodObject;
      const typeField = (schema.shape as Record<string, z.ZodTypeAny>)['type'];
      if (!(typeField instanceof z.ZodLiteral) || typeField.value !== t) {
        mismatched.push(`${t} → ${String((typeField as z.ZodLiteral<unknown>)?.value)}`);
      }
    }
    expect(mismatched, `键与 type 字面量不一致：${mismatched.join(', ')}`).toEqual([]);
  });
});

describe('G2.7 出站 schema 与声明类型一致（★ docs/26 M9：schema 不许比类型更宽松）', () => {
  const roomOk = {
    v: PROTOCOL_VERSION,
    type: 'room',
    path: 'yz/guangchang',
    name: '广场',
    desc: 'd',
    commands: [],
  };

  it('★ `room.path` 必须是合法 world id（原来是裸 z.string()）', () => {
    const schema = SERVER_PACKET_SCHEMAS['room'];
    expect(schema.safeParse(roomOk).success).toBe(true);
    // 保留 area / 大写 / 冒号式 id 全部必须被拒 —— 与 parseWorldId 同一套语法
    for (const bad of ['room/x', 'server/x', 'yz/Guangchang', 'yz:room:gc', '', 'a'.repeat(300)]) {
      expect(
        schema.safeParse({ ...roomOk, path: bad }).success,
        `path=${JSON.stringify(bad)} 不应通过`,
      ).toBe(false);
    }
  });

  it('★ `msg.ch` 必须是频道枚举（原来是裸 z.string()）', () => {
    const schema = SERVER_PACKET_SCHEMAS['msg'];
    const base = { v: PROTOCOL_VERSION, type: 'msg', content: '你好' };
    expect(schema.safeParse({ ...base, ch: 'chat' }).success).toBe(true);
    expect(schema.safeParse({ ...base, ch: 'not_a_channel' }).success).toBe(false);
    // 大小写敏感（避免 'CHAT' 这类"看着对"的值混进来）
    expect(schema.safeParse({ ...base, ch: 'Chat' }).success).toBe(false);
  });

  it('`status.action` 必须是动作枚举；`updatemap.id` 必须是合法 id', () => {
    const status = SERVER_PACKET_SCHEMAS['status'];
    const sBase = { v: PROTOCOL_VERSION, type: 'status', id: 'x' };
    expect(status.safeParse({ ...sBase, action: 'refresh' }).success).toBe(true);
    expect(status.safeParse({ ...sBase, action: 'nope' }).success).toBe(false);

    const upd = SERVER_PACKET_SCHEMAS['updatemap'];
    const uBase = { v: PROTOCOL_VERSION, type: 'updatemap', map: 'yz', n: '甲', pos: [0, 0] };
    expect(upd.safeParse({ ...uBase, id: 'yz/a' }).success).toBe(true);
    expect(upd.safeParse({ ...uBase, id: 'Bad/Id' }).success).toBe(false);
  });

  it('★ `itemadd` 复用 ItemBrief 字段（L1：旧接口注释说"有字段"、类型里却没有）', () => {
    const schema = SERVER_PACKET_SCHEMAS['itemadd'];
    const base = { v: PROTOCOL_VERSION, type: 'itemadd', id: 'drug/yao', name: '丹药' };
    expect(schema.safeParse(base).success).toBe(true);
    expect(schema.safeParse({ ...base, p: 1, hp: 10 }).success).toBe(true);
    // 标记位是字面量 1，不是任意数字
    expect(schema.safeParse({ ...base, p: 2 }).success).toBe(false);
  });

  it('`dialog` 的面板名必须是 DialogName；未知载荷字段**刻意**保留（通用容器）', () => {
    const schema = SERVER_PACKET_SCHEMAS['dialog'];
    const base = { v: PROTOCOL_VERSION, type: 'dialog', dialog: 'pack' };
    expect(schema.safeParse(base).success).toBe(true);
    expect(schema.safeParse({ ...base, dialog: 'no_such_panel' }).success).toBe(false);
    const withPayload = schema.safeParse({ ...base, items: [{ a: 1 }], custom: 'x' });
    expect(withPayload.success).toBe(true);
    if (!withPayload.success) return;
    // 这是**有意的例外**：dialog 是通用容器，载荷逐面板建模后再收紧（见 TODO）
    expect((withPayload.data as Record<string, unknown>)['custom']).toBe('x');
  });

  it('所有出站 schema 都丢弃未知字段（dialog 是唯一例外）', () => {
    const unknownKeysOf = (s: z.AnyZodObject): string => s._def.unknownKeys;
    for (const t of SERVER_PACKET_TYPES) {
      if (t === 'dialog') continue;
      const schema = SERVER_PACKET_SCHEMAS[t] as z.AnyZodObject;
      expect(unknownKeysOf(schema), `${t} 应为 strip`).toBe('strip');
    }
    expect(unknownKeysOf(SERVER_PACKET_SCHEMAS['dialog'] as z.AnyZodObject)).toBe('passthrough');
  });
});

describe('S1 消息体大小上限（★ docs/26 S1 回归）', () => {
  it('★ 回归锚点：超过上限的消息必须被拒，且错误码是 PAYLOAD_TOO_LARGE', () => {
    const r = checkPayloadSize('a'.repeat(MAX_MESSAGE_BYTES + 1));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('PAYLOAD_TOO_LARGE');
    expect(ERROR_CODES[r.code]).toBe(ERROR_CODES.PAYLOAD_TOO_LARGE);
  });

  it('边界：恰好等于上限放行，多 1 字节拒绝（上限是闭区间）', () => {
    expect(checkPayloadSize('a'.repeat(MAX_MESSAGE_BYTES)).ok).toBe(true);
    expect(checkPayloadSize('a'.repeat(MAX_MESSAGE_BYTES - 1)).ok).toBe(true);
    expect(checkPayloadSize('a'.repeat(MAX_MESSAGE_BYTES + 1)).ok).toBe(false);
  });

  it('★ 按**字节**而不是字符计：中文会放大 3 倍（按字符判会漏）', () => {
    const chars = Math.floor(MAX_MESSAGE_BYTES / 3) + 10; // 字符数小于上限，字节数超上限
    expect(chars).toBeLessThan(MAX_MESSAGE_BYTES);
    expect(byteLengthOf('啊'.repeat(chars))).toBeGreaterThan(MAX_MESSAGE_BYTES);
    expect(checkPayloadSize('啊'.repeat(chars)).ok).toBe(false);
  });

  it('二进制帧与字符串走同一条口径', () => {
    expect(checkPayloadSize(new Uint8Array(MAX_MESSAGE_BYTES)).ok).toBe(true);
    expect(checkPayloadSize(new Uint8Array(MAX_MESSAGE_BYTES + 1)).ok).toBe(false);
    expect(byteLengthOf('abc')).toBe(3);
    expect(byteLengthOf(new Uint8Array([1, 2, 3]))).toBe(3);
  });
});

describe('S2 明文通道只承载指令（★ docs/26 S2 回归）', () => {
  it('★ 回归锚点：看起来是 JSON 的输入必须被打回 JSON 分支', () => {
    for (const json of ['{"v":1}', '[1,2]', '  {"type":"ping"}']) {
      const r = checkPlaintext(json);
      expect(r.ok, json).toBe(false);
      if (r.ok) continue;
      expect(r.code, json).toBe('BAD_PACKET');
    }
  });

  it('合法指令：放行并返回 trim 后的指令', () => {
    for (const [raw, expected] of [
      ['look', 'look'],
      ['  look  ', 'look'],
      ['go north', 'go north'],
      ['/who', '/who'],
    ] as const) {
      const r = checkPlaintext(raw);
      expect(r.ok, raw).toBe(true);
      if (!r.ok) continue;
      expect(r.command).toBe(expected);
    }
  });

  it('★ 回归锚点：长度上限与控制字符必须被拦（防日志注入 / 终端逃逸）', () => {
    expect(checkPlaintext('a'.repeat(MAX_PLAINTEXT_CHARS)).ok).toBe(true);
    expect(checkPlaintext('a'.repeat(MAX_PLAINTEXT_CHARS + 1)).ok).toBe(false);

    for (const evil of [
      'look\nquit',
      'look\r\ngo east',
      'a\u0000b',
      '\u001b[31mred',
      'look\u007f',
    ]) {
      const r = checkPlaintext(evil);
      expect(r.ok, JSON.stringify(evil)).toBe(false);
      if (r.ok) continue;
      expect(r.code, JSON.stringify(evil)).toBe('PLAINTEXT_NOT_COMMAND');
    }
  });

  it('空明文 / 非字符串一概拒绝，不"猜"成空指令', () => {
    for (const bad of ['', '   ', '\t\n', null, undefined, 42, {}, new Uint8Array([1])]) {
      const r = checkPlaintext(bad);
      expect(r.ok, String(bad)).toBe(false);
    }
  });
});

describe('L8 帧分流：`PLAINTEXT_CHANNEL` 必须有真消费者（★ docs/26 L8 回归）', () => {
  it('★ 回归锚点：常量不再是"声明未实现"—— 分流结果直接用它', () => {
    // 旧状态：PLAINTEXT_CHANNEL 声明后零引用，明文路径也没有任何"先量大小"的门槛。
    const plain = routeFrame('look');
    expect(plain.ok).toBe(true);
    if (!plain.ok) return;
    expect(plain.channel).toBe(PLAINTEXT_CHANNEL);
    expect(PLAINTEXT_CHANNEL).toBe('text');
  });

  it('JSON 帧（含前导空白）走 json 通道；二进制帧一律按 json 处理', () => {
    for (const raw of ['{"v":1}', '[1,2]', '  {"t":1}', '\n[1]']) {
      const r = routeFrame(raw);
      expect(r.ok, JSON.stringify(raw)).toBe(true);
      if (!r.ok) continue;
      expect(r.channel, JSON.stringify(raw)).toBe('json');
    }
    // 空 / 纯空白**不是** JSON 形状 → 落到明文通道，再由 checkPlaintext 拒掉。
    // 这条边界很关键：分流函数不做内容合法性判断，只做通道判定。
    for (const raw of ['', '   ']) {
      const r = routeFrame(raw);
      expect(r.ok, JSON.stringify(raw)).toBe(true);
      if (!r.ok) continue;
      expect(r.channel, JSON.stringify(raw)).toBe(PLAINTEXT_CHANNEL);
      expect(checkPlaintext(raw).ok, JSON.stringify(raw)).toBe(false);
    }
    const binary = routeFrame(new Uint8Array([1, 2, 3]));
    expect(binary.ok && binary.channel).toBe('json');
  });

  it('★ 尺寸不过关时**先出局**：连"是不是 JSON"都不看（顺序即契约）', () => {
    const huge = routeFrame('a'.repeat(MAX_MESSAGE_BYTES + 1));
    expect(huge.ok).toBe(false);
    if (huge.ok) return;
    expect(huge.code).toBe('PAYLOAD_TOO_LARGE');
    // 即使超限内容是 JSON 形状，也仍是尺寸错误优先 —— 不得因形状而对它解析
    const hugeJson = routeFrame(`{"x":"${'a'.repeat(MAX_MESSAGE_BYTES)}"}`);
    expect(hugeJson.ok).toBe(false);
    if (hugeJson.ok) return;
    expect(hugeJson.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('分流与两个校验函数口径一致（同一帧不会既判 json 又被明文拒）', () => {
    const frames = ['look', '  go north ', '{"v":1}', '[1]'];
    for (const f of frames) {
      const r = routeFrame(f);
      expect(r.ok, f).toBe(true);
      if (!r.ok) continue;
      if (r.channel === PLAINTEXT_CHANNEL) expect(checkPlaintext(f).ok, f).toBe(true);
      else expect(checkPlaintext(f).ok, f).toBe(false);
    }
  });
});

describe('L5 报错文案里的设计数值必须来自常量（★ docs/26 L5 回归）', () => {
  it('★ 创角四维的 15 / 30 / 80 不能写死在文案里', () => {
    // 旧实现：'四维需在 15-30 之间' / '属性之和必须等于 80' —— 数值只存在于字符串中，
    // 改设计（比如放宽到 10-40）时文案与校验逻辑会各自漂移，且没人会发现。
    expect(ERROR_CODES.REG_ATTR_RANGE).toBe(
      `四维需在 ${REG_ATTR_RANGE_MIN}-${REG_ATTR_RANGE_MAX} 之间`,
    );
    expect(ERROR_CODES.REG_ATTR_SUM).toBe(`属性之和必须等于 ${REG_ATTR_SUM_TOTAL}`);
  });
});

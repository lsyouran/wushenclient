/**
 * server/net/frame-pipeline.ts — 入站帧的处理管线（★ T1 的落点）
 * ============================================================================
 * 存在的理由（docs 26 册 §11.4 的 T1）：
 *   `routeFrame()` / `checkPayloadSize()` / `checkPlaintext()` / `SlidingWindowRateLimiter`
 *   四件套此前**全都只有测试消费者** —— 写了防护但没人接线，等于没防护，
 *   而且因为实现得完整，反而更容易被误认为"限流已经有了"。
 *
 * 本文件把它们的**调用顺序**固化成一处，并且做到**不依赖任何网络库**：
 * 输入一帧字节、输出一个"意图"。于是这条链路可以脱离 socket 单测，
 * WS 适配层（`ws` / 其它）只负责"收帧 → 调我 → 按结果发回/断连"。
 *
 * ★ 顺序为什么是这样（每一步都比下一步便宜，且必须挡在它前面）：
 *
 *   ① 量大小      —— 最便宜。超大帧连"是不是 JSON"都不该看
 *   ② 限流        —— 次便宜。**必须排在解析之前**：JSON.parse + zod 是有开销的，
 *                    把解析放在限流前面等于让攻击者用"合法但高频"的包白烧 CPU。
 *                    代价是"坏包也消耗配额"，这对正常用户无害（他们不发坏包），
 *                    对攻击者正是我们想要的。
 *   ③ 分诊        —— JSON 通道 / 明文通道
 *   ④ 解析 + 校验 —— 最贵。zod 校验通过后才产生意图
 *
 * ★ "断连 vs 不断连"的判据（写死在这里，别让调用方各自决定）：
 *   - 尺寸超限 / 结构不成包 / 版本不符 / 非 JSON → **断连**（客户端已不可信）
 *   - 明文不合规 / 限流 → **不断连**（可能是玩家手滑，或者只是手速快）
 */

import { MAX_MESSAGE_BYTES } from '@shared/constants.js';
import { ClientPacketSchema, checkEnvelope, checkPlaintext, routeFrame } from '@shared/protocol.js';
import type { ErrorCode } from '@shared/protocol.js';
import { PLAINTEXT_CHANNEL } from '@shared/protocol.js';
import { SlidingWindowRateLimiter } from './rate-limit.js';

export class FramePipelineError extends Error {
  public override readonly name = 'FramePipelineError';
}

/**
 * 管线产出：**已经过了全部校验的意图**。
 * 调用方不需要再做任何判断，按 `kind` 分派即可。
 */
export type InboundIntent =
  | { readonly kind: 'command'; readonly command: string; readonly bytes: number }
  | { readonly kind: 'login'; readonly token: string; readonly roleId: string; readonly bytes: number }
  | { readonly kind: 'ping'; readonly t: number; readonly bytes: number }
  | {
      readonly kind: 'reject';
      readonly code: ErrorCode;
      readonly detail: string;
      /** true = 应当断开这条连接（客户端已不可信） */
      readonly close: boolean;
    };

export interface PipelineContext {
  /** 连接标识（限流的键；通常是连接 id） */
  readonly connId: string;
  readonly nowMs: number;
  readonly limiter: SlidingWindowRateLimiter;
}

function reject(code: ErrorCode, detail: string, close: boolean): InboundIntent {
  return { kind: 'reject', code, detail, close };
}

/** zod 的报错往往很长，只取第一句（诊断够用，别把整棵错误树发给客户端） */
function firstIssueOf(error: { issues: readonly { message: string }[] }): string {
  return error.issues[0]?.message ?? '未知校验错误';
}

/**
 * 处理一帧入站数据。
 *
 * @param raw 原始帧（字符串或二进制）。二进制一律按 JSON 通道处理
 *            （明文通道只承载可读文本，见 `routeFrame`）。
 */
export function handleInboundFrame(
  raw: string | Uint8Array,
  ctx: PipelineContext,
): InboundIntent {
  // ── ① 尺寸 ──────────────────────────────────────────────────────────────
  const route = routeFrame(raw);
  if (!route.ok) {
    return reject(route.code, route.detail, route.code === 'PAYLOAD_TOO_LARGE');
  }

  // ── ② 限流（★ 排在解析之前）──────────────────────────────────────────────
  const decision = ctx.limiter.hit(ctx.connId, ctx.nowMs);
  if (!decision.allowed) {
    return reject(
      'RATE_LIMITED',
      `窗口内已达 ${ctx.limiter.limit} 次上限，${decision.retryAfterMs}ms 后重试`,
      false,
    );
  }

  // ── ③ 分诊 ──────────────────────────────────────────────────────────────

  // 明文通道（wushen 式的"直接敲命令"）
  if (route.channel === PLAINTEXT_CHANNEL) {
    if (typeof raw !== 'string') {
      // `routeFrame` 已保证：只有字符串才可能落到明文通道
      return reject('BAD_PACKET', '明文帧必须是字符串', true);
    }
    const plain = checkPlaintext(raw);
    if (!plain.ok) return reject(plain.code, plain.detail, false);
    return { kind: 'command', command: plain.command, bytes: route.bytes };
  }

  // JSON 通道
  let parsed: unknown;
  try {
    parsed = JSON.parse(typeof raw === 'string' ? raw : new TextDecoder().decode(raw));
  } catch (e) {
    return reject('BAD_PACKET', `不是合法 JSON（${e instanceof Error ? e.message : String(e)}）`, true);
  }

  // ④ 信封（先分"结构不成包"与"版本不符"，让 PROTOCOL_MISMATCH 可达）
  const env = checkEnvelope(parsed);
  if (!env.ok) return reject(env.code, env.detail, true);

  const packet = ClientPacketSchema.safeParse(parsed);
  if (!packet.success) {
    return reject('BAD_PACKET', `包体校验失败：${firstIssueOf(packet.error)}`, true);
  }

  switch (packet.data.type) {
    case 'command':
      return { kind: 'command', command: packet.data.cmd, bytes: route.bytes };
    case 'login':
      return {
        kind: 'login',
        token: packet.data.token,
        roleId: packet.data.role_id,
        bytes: route.bytes,
      };
    case 'ping':
      return { kind: 'ping', t: packet.data.t, bytes: route.bytes };
    default: {
      // `ClientPacketSchema` 是 discriminatedUnion —— 这里不可达；
      // 留着是为了让"将来加了一种包却忘了在管线里处理"变成**编译错误**。
      const never: never = packet.data;
      throw new FramePipelineError(`未处理的入站包类型：${JSON.stringify(never)}`);
    }
  }
}

/**
 * 出站帧的大小守卫（对**自己发出去**的包也量一次）。
 *
 * 为什么连出站都要查：服务端拼包出错时（比如把整个世界的 items 塞进一帧），
 * 会静默地把带宽与客户端内存吃光，而日志上只看到"客户端掉线"。
 * 宁可在服务端就发现，也不要让它变成"客户端莫名其妙崩"。
 */
export function checkOutboundSize(text: string): { ok: boolean; bytes: number } {
  const bytes = new TextEncoder().encode(text).byteLength;
  // 上限直接取协议层的常量，避免这里再抄一份数字（24 册铁律 4：单源真相）
  return { ok: bytes <= MAX_MESSAGE_BYTES, bytes };
}

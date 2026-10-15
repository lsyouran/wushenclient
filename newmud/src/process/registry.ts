/**
 * src/process/registry.ts — 包类型 → handler 的注册表**本体**
 * ============================================================================
 * ★ 为什么单独成文件（而不是和 handlers 的导入放在一起）：
 *   ESM 的 `import` 会被**提升**到模块体之前执行。若注册表本体与
 *   `import './handlers/...'` 同处一个模块，handler 文件里的
 *   `import { registerHandler } from '../index.js'` 就会在
 *   `const handlers = new Map()` **之前**跑到 —— 直接
 *   `ReferenceError: Cannot access 'handlers' before initialization`。
 *
 *   拆开之后依赖是单向的：`handlers/* → registry`，而 `index.ts → registry + handlers`。
 *   于是没有环，也就没有"谁先执行"的悬念。
 *
 * G2 闸门扫的是 handlers 目录下的源码文本，本文件不受影响。
 */

export type PacketPayload = Record<string, unknown>;
export type Handler = (p: PacketPayload) => void;

const handlers = new Map<string, Handler>();

export function registerHandler(type: string, fn: Handler): void {
  if (handlers.has(type)) throw new Error(`重复注册包类型：${type}`);
  handlers.set(type, fn);
}

/** 已注册的类型（G2 从源码文本解析；这个函数给运行期自检用） */
export function registeredTypes(): readonly string[] {
  return [...handlers.keys()];
}

/**
 * 分派一帧服务端包。
 * @returns 是否有人接手；false = 服务端发了一种前端没注册的包（协议漂移）
 */
export function dispatchPacket(type: string, payload: PacketPayload): boolean {
  const h = handlers.get(type);
  if (h === undefined) return false;
  try {
    h(payload);
  } catch (e) {
    // ★ 一个 handler 崩了不能带走整条消息流（否则玩家看到的是"卡住"而不是一句话）
    errorSink(type, e);
  }
  return true;
}

/** handler 抛错时的落点（由 `main.ts` 注入，默认打到控制台） */
let errorSink: (type: string, e: unknown) => void = (type, e) => {
  console.error(`[packet:${type}]`, e);
};

export function setErrorSink(fn: (type: string, e: unknown) => void): void {
  errorSink = fn;
}

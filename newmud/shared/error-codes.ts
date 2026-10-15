/**
 * shared/error-codes.ts — 错误码与文案（**零依赖**）
 * ============================================================================
 * ★ 为什么从 `protocol.ts` 里拆出来：
 *   `protocol.ts` 顶部 `import { z } from 'zod'`，而**浏览器无法解析裸模块说明符**
 *   （没有打包器时 `import 'zod'` 直接失败）。前端只需要"错误码 → 文案"这张表，
 *   不需要 zod。把它放进零依赖文件，前端就能直接 import 而**不会**被 zod 拖下水。
 *
 *   继续留在 protocol.ts 也能编译通过，但会在浏览器里炸 ——
 *   那是"类型检查全绿、一跑就白屏"的典型。
 *
 * `protocol.ts` 原样 re-export，现有导入点无需改动。
 */

import { REG_ATTR_RANGE_MAX, REG_ATTR_RANGE_MIN, REG_ATTR_SUM_TOTAL } from './constants.js';

export const ERROR_CODES = {
  // -- 登录 / 创角（wushen: cmd/comm/createrole.js 的 11 种文案）--
  LOGIN_TOO_MANY: '服务器人数过多',
  /** 该连接已经登录过了（重复登录包；真实账号系统落地后由它接手） */
  ALREADY_LOGGED_IN: '已经登录过了',
  REG_BAD_INFO: '注册信息错误',
  REG_BAD_NAME: '姓名需要是 2-5 个汉字',
  /** 名字含非法字符（空白 / 控制字符 / 超长）—— 只做"结构合法"，不做"像不像人名" */
  ROLE_NAME_INVALID: '角色名不合法',
  REG_NAME_FORBIDDEN: '你不能用这个名字',
  REG_NAME_TAKEN: '名字已有人用',
  // ★ 数值不写在文案里（docs/26 L5）：改设计只改 constants，文案自动跟着变
  REG_ATTR_RANGE: `四维需在 ${REG_ATTR_RANGE_MIN}-${REG_ATTR_RANGE_MAX} 之间`,
  REG_ATTR_SUM: `属性之和必须等于 ${REG_ATTR_SUM_TOTAL}`,
  REG_FAILED: '创建角色失败',
  ROLE_NOT_FOUND: '角色不存在',
  // -- 协议 / 连接 --
  BAD_PACKET: '无法识别的数据包',
  PAYLOAD_TOO_LARGE: '数据包过大',
  PROTOCOL_MISMATCH: '客户端版本不匹配',
  NOT_LOGGED_IN: '尚未登录',
  RATE_LIMITED: '不要急，慢慢来。',
  // ★ 明文通道只承载指令（docs/26 S2）；不是指令时明确报错，而不是"当成指令解析"
  PLAINTEXT_NOT_COMMAND: '只能输入指令',
  // -- 通用业务 --
  NOT_FOUND: '找不到目标',
  NO_PERMISSION: '什么？',
  BUSY: '你现在正忙。',
  FAINT: '你正在昏迷中！',
  DEAD: '你现在是灵魂状态，不能那么做。',
  IN_STATE: '你正在忙，没时间这么做。',
  IN_FIGHT: '你正在战斗，待会再说。',
  // -- GM / 支付 --
  GM_FORBIDDEN: 'GM 权限不足',
  GM_CONFIRM_REQUIRED: '该操作需要二次确认',
  PAY_SIGN_INVALID: '支付回调验签失败',
  PAY_DUPLICATE: '订单已处理',
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;

/** 服务端不认识的错误码兜底文案（版本不一致 / 未来新增码） */
export const UNKNOWN_ERROR_TEXT = '发生了一个错误';

export function errorTextOf(code: string): string {
  return (ERROR_CODES as Record<string, string>)[code] ?? UNKNOWN_ERROR_TEXT;
}

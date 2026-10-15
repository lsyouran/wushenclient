/**
 * server/engine/oid.ts — 运行时实例 id
 * ============================================================================
 * 取代 wushen `util/util.js:285 create_id()`。
 *
 * ★ wushen 的实际缺陷（07 册 §7.5）：
 *   `4 位随机 base34 + 时间戳`，只有 34⁴ ≈ 133 万种随机前缀 —— 同一秒内
 *   批量生成（刷怪、掉尸）时碰撞概率不可忽略，而查找用的
 *   `find_obj_byid` 是**线性扫描**，一旦撞 id 就是"两个物体共用一份引用"，
 *   表现为"捡起 A 结果 B 消失了"。
 *
 * ★ 本实现的三点差异：
 *   1. **长度足够**：base36 10 位 = 3.65e15 种。碰撞期望值在现实规模下可忽略。
 *   2. **仍然查重**：正确性**不依赖**长度。`next()` 在 OidSpace 里登记，
 *      撞了就重抽，连续失败直接抛错（宁可不产 id，也不产重复 id）。
 *   3. **随机源可注入**：测试可以喂确定性序列，不必 mock 全局 `Math.random`。
 *
 * id 面向客户端（`get <id>` / `drop <id>`），所以保持短、纯小写字母数字。
 */

import { randomInt } from 'node:crypto';

export const OID_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';
export const OID_LENGTH = 10;
/** 连续撞 id 的上限：撞满即认为随机源出了问题，而不是无限重试 */
export const OID_MAX_TRIES = 8;

export const OID_RE = new RegExp(`^[${OID_ALPHABET}]{${OID_LENGTH}}$`);

export class OidError extends Error {
  public override readonly name = 'OidError';
}

export type OidRandom = (length: number) => string;

/** CSPRNG 随机源（Node `randomInt` 是密码学安全的） */
export function defaultOidRandom(length: number = OID_LENGTH): string {
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += OID_ALPHABET[randomInt(0, OID_ALPHABET.length)] ?? '0';
  }
  return out;
}

/**
 * 一个 id 空间：负责发号 + 查重 + 释放。
 *
 * 生命周期：进程内一个实例（`world.ts` 持有），读档时用 `reserve()` 占位，
 * 对象销毁时 `release()`（否则 id 集合会随"曾经存在过的对象数"单调增长）。
 */
export class OidSpace {
  readonly #used = new Set<string>();
  readonly #random: OidRandom;

  public constructor(random: OidRandom = defaultOidRandom) {
    this.#random = random;
  }

  /** 当前占用的 id 数（用于观测是否泄漏） */
  public get size(): number {
    return this.#used.size;
  }

  public has(oid: string): boolean {
    return this.#used.has(oid);
  }

  /** 发一个新 id 并占用它 */
  public next(): string {
    for (let i = 0; i < OID_MAX_TRIES; i += 1) {
      const oid = this.#random(OID_LENGTH);
      if (OID_RE.test(oid) && !this.#used.has(oid)) {
        this.#used.add(oid);
        return oid;
      }
    }
    throw new OidError(
      `连续 ${OID_MAX_TRIES} 次生成的 id 都不合法或已被占用 —— 随机源有问题？` +
        `（当前已占用 ${this.#used.size} 个）`,
    );
  }

  /** 读档：把存档里的 id 占回来。已占用说明存档被复制过，必须抛错而不是静默接受 */
  public reserve(oid: string): void {
    if (!OID_RE.test(oid)) {
      throw new OidError(`非法的 oid ${JSON.stringify(oid)}（应为 ${OID_LENGTH} 位小写字母数字）`);
    }
    if (this.#used.has(oid)) {
      throw new OidError(`oid 已被占用：${oid}（读档时出现重复 id，存档可能被复制过）`);
    }
    this.#used.add(oid);
  }

  /** 对象销毁时释放。返回是否确实占用过 */
  public release(oid: string): boolean {
    return this.#used.delete(oid);
  }
}

/**
 * src/ui/bars.ts — 底部工具条（wushen 的 `.tool-bar`）
 * ============================================================================
 * wushen 的工具条有十几格（设置 / 江湖 / 排行 / 社交 / 商城 / 任务 / 技能 / 背包 / 属性…），
 * 那些格子的显隐由**服务端**控制（默认 `display:none`），点了各有各的面板。
 *
 * 这里只留**当前真能用**的三格：
 *   环顾（`look`）· 指令浮层 · 聊天浮层
 *
 * ★ 为什么不照着摆一排：服务端内容层现在只认 `look / go / say / shout / tell`
 *   （`world/command/`），其余面板**根本没有数据通路**（26 册 §16.8 记过）。
 *   摆上去点一下回"什么？"，玩家会以为功能坏了 —— 那比少几个按钮更伤。
 *   等某天有了属性 / 行囊指令，往这里加一格即可（`handle` 里加一行）。
 *
 * ★ 事件委托绑在 `#app` 上一次性完成：按钮是静态的，"点了干什么"由 `main.ts` 注入。
 */

import { need } from './dom.js';

export interface BarHooks {
  /** 执行一条指令 */
  run(cmd: string): void;
  /** 打开指令浮层 */
  openCmd(): void;
  /** 打开聊天浮层 */
  openChat(): void;
  /** 需要提示时落一行到消息流 */
  hint(text: string): void;
}

let hooks: BarHooks = {
  run: () => undefined,
  openCmd: () => undefined,
  openChat: () => undefined,
  hint: () => undefined,
};

export function bindBars(h: BarHooks): void {
  hooks = h;

  need('app').addEventListener('click', (ev) => {
    const target = ev.target;
    if (!(target instanceof Element)) return;
    const hit = target.closest('.tool-item');
    if (hit === null) return;
    handle(hit.getAttribute('data-act') ?? '');
  });
}

function handle(act: string): void {
  switch (act) {
    case 'look':
      hooks.run('look');
      return;
    case 'cmd':
      hooks.openCmd();
      return;
    case 'chat':
      hooks.openChat();
      return;
    default:
      hooks.hint(`「${act}」还没有对应的操作。`);
  }
}

/** 工具条上有哪些格子（测试用：每一格都要有归属） */
export function barActions(): readonly string[] {
  return Array.from(need('app').querySelectorAll('.tool-item')).map((n) => n.getAttribute('data-act') ?? '');
}

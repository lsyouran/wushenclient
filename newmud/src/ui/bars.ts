/**
 * src/ui/bars.ts — 底部工具条（wushen 的 `.tool-bar`）
 * ============================================================================
 * wushen 的工具条有十几格（设置 / 江湖 / 排行 / 社交 / 商城 / 任务 / 技能 / 背包 / 属性…），
 * 那些格子的显隐由**服务端**控制（默认 `display:none`），点了各有各的面板。
 *
 * 这里只留**当前真能用**的五格：
 *   环顾（`look`）· 属性（`score`）· 技能（`skills`）· 指令浮层 · 聊天浮层
 *
 * ★ 为什么不照着摆一排：服务端内容层现在只认
 *   `look / go / say / chat / tell / select / get / drop / give / use /
 *    score / skills / practice / fight / kill / relive / learn / enable / forget`
 *   （`world/command/`），
 *   其余面板**根本没有数据通路**（26 册 §16.8 记过）。
 *   摆上去点一下回"什么？"，玩家会以为功能坏了 —— 那比少几个按钮更伤。
 *   等某天有了任务 / 背包指令，往这里加一格即可（`handle` 里加一行）。
 *
 * ★ 「属性」这一格是 2026-10-18 补的：`score` 早在 `info/score.ts` 里实现，
 *   前端却一直没入口（"指令写了、没人按得到"）。wushen 的工具条上它本来就有位置。
 * ★ 「技能」同一天补（26 册 §64.10）：`skills` 指令 + `dialog:skills` 帧都通了，
 *   工具条却是最后一块 —— 玩家要点得到，才算"这条路真的开了"。
 *
 * ★ 事件委托绑在 `#app` 上一次性完成：按钮是静态的，"点了干什么"由 `main.ts` 注入。
 */

import { need } from './dom.js';
import { closePanel, openDataPanelName } from './panel.js';

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
      // ★ 数据面板当着时先收起（§62）：属性卡**盖住了房间区**，而「环顾」
      //   的结果正是房间名/描述 —— 不收起的话玩家点完看不见任何变化，
      //   会以为「环顾」坏了。（物件面板有遮罩，玩家本来就点不到工具条。）
      if (openDataPanelName() !== null) closePanel();
      hooks.run('look');
      return;
    case 'score':
      // ★★ 同一个键第二次按 = **收起**（wushen `Dialog.show` 的
      //   `if (this.isShow && name == this.curItem) return this.hide();`）。
      //   手机上一只手开、一只手关才是顺手的；否则玩家只能去够右上角那个 ×。
      //   ★ 判据是"开着的**就是属性面板**"，不是"开着一个面板" ——
      //     开着店小二详情时按属性，应该换成属性（而不是把它关掉什么都不开）。
      if (openDataPanelName() === 'score') {
        closePanel();
        return;
      }
      hooks.run('score');
      return;
    case 'skills':
      // 与「属性」完全同一条判据（同一个键开、同一个键关）。
      // ★ 两个 `case` 不合并成一句 `if` + 变量：面板名与指令字面是**两个**约定
      //   （`skills` 是协议名 `dialog:skills`，`skills` 又恰好是指令名），
      //   合并后改其中一个会静默改掉另一个。
      if (openDataPanelName() === 'skills') {
        closePanel();
        return;
      }
      hooks.run('skills');
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

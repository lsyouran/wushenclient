import { defineCommand } from '@engine/world/define.js';

/**
 * `addxp` —— **加经验 / 潜能的测试指令**（`admin/` 目录 = 运营面，不是玩法面）。
 *
 * 用法：
 *
 *     addxp 10000            → 加 10000 经验
 *     addxp 10000 5000       → 加 10000 经验 + 5000 潜能
 *
 * ★★ **为什么它现在对所有人可用**（这一段是给上线前的人看的）：
 *   本项目的 GM 授权流程还没做 —— `userLevel` 只有构造器那句
 *   `this.userLevel = init.userLevel ?? 0`（`engine/character.ts`），
 *   **生产代码里没有任何一处给 `init` 传过非 0 值**（传非 0 的只有测试）。
 *   ⇒ 写成 `allow_level: 9` 会让这条指令**永远不可用**，等于"声明存在、消费为零"
 *   （26 册 L8 的病型）。
 *   要的是"测试期间我能用"，所以这里**默认开着**，并让每次执行都带一行
 *   【测试指令】前缀 —— 至少没人会把它当成正常玩法。
 *
 *   ★ 上线门槛（写在这里而不是留在脑子里）：接入账号/GM 授权后，
 *     把下面 `allow_level: 0` 改成 `9`，并删掉"默认可用"的分支。
 *     判定点只有 `run()` 开头那三行。
 *
 * ★ 为什么不用 `allow_level` 在**闸门层**拦：那道闸门在 `run()` **之前**判，
 *   而我们要的判据是"GM 等级 或 测试模式"——`GateDecl` 表达不了"或"。
 *   把它拆成两道又会变成"两个字段一个含义"。⇒ 判据放 `run()` 里，一处。
 *
 * ★ 增长**只走** `me.grantExp()` → `Character.addExp()`：经验与潜能的增加入口
 *   全项目仍然只有一个（33 册铁律 3 单源），播报也还是那一句，不另写一份。
 *
 * ★ 三闸全开 + `allow_faint`：测试时被打晕/在打坐都不该拦住加经验。
 */
defineCommand('admin/addxp', {
  command: 'addxp',
  // 两个非负整数：`addxp <exp> [pot]`
  regex: /^(\d+)(?:\s+(\d+))?$/,
  allow_busy: true,
  allow_state: true,
  allow_die: true,
  allow_faint: true,
  // ★ 0 = 闸门不拦（原因见文件头）；不是"忘了写 9"
  allow_level: 0,

  run: (me, rawExp, rawPot) => {
    // ★ 唯一的权限判定点：GM 优先（静默），否则按测试指令处理（打前缀）
    const asGm = me.userLevel >= 9;

    const exp = Number(rawExp ?? '');
    const pot = rawPot === undefined ? 0 : Number(rawPot);
    // 正则只放行数字，这里再判一次"是不是安全整数"—— 超出 `MAX_SAFE_INTEGER`
    // 的数会让 `addExp` 的 `+=` 静默丢精度，玩家看到的数就是错的
    for (const [label, value] of [
      ['经验', exp],
      ['潜能', pot],
    ] as const) {
      if (!Number.isSafeInteger(value) || value < 0) {
        me.notify(`${label}必须是 0 到 ${String(Number.MAX_SAFE_INTEGER)} 之间的整数。`);
        return;
      }
    }
    if (exp === 0 && pot === 0) {
      me.notify('用法：addxp <经验> [潜能]（例如 addxp 10000 5000）');
      return;
    }

    if (!asGm) me.notify('【测试指令】');
    me.grantExp(exp, pot);
    // ★ 加完顺手报一次上限：经验涨了但"能练到几级"没变是最容易被忽略的事
    //   （上限是 `(经验×境界因子)^(1/3)`，要涨到下一个立方才会动）。
    me.notify(`（当前技能等级上限 ${String(me.skillLimit())} 级）`);
  },
});

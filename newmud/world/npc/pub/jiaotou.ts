import { defineNpc, findTarget } from '@engine/world/define.js';

/**
 * 武馆教头 —— **新玩家的第一个老师**。
 *
 * ★★ 他存在的理由只有一个：把 27 册 §13.6 记的那条断链接上。
 *
 *     玩家进游戏时**一个技能都没有**（`Player` 没有初始技能，存档批次之前也没有读档）
 *     ⇒ `practice 太极剑法` 报 `not-learned` ⇒ 成长闭环在**第一环**就断了。
 *
 *   而 `wd/taijijian` 的 `learnCondition` 是 `minSlot: { sword: 30 }`
 *   —— 想学剑法，先得把**基本剑法**练到 30 级；想练基本剑法，先得**学会**它。
 *   全仓库没有任何 NPC 会 `base/sword`（店小二只有内功与太极剑法），
 *   于是这条链**在内容层就是死的**——不是代码的问题，是没人教。
 *
 * ★ 数值口径（照 wushen 的"教头/师父"档，不是凭空定的）：
 *   - **六门基本武学各 300 级**（2026-10-18 从 120 上调）：玩家练到 300 级之前
 *     都不需要另找师父。这不是"教头很强"，而是**内容层的教学上限** ——
 *     `learn` 有一条 `master-lower` 闸（老师等级必须高于学生），
 *     教头 300 就意味着学生最多练到 300。300 级以上留给以后的"高人/门派"。
 *     ★ 为什么不是 1000：1000 是**引擎给的硬顶**（`SKILL_CURVE.refLevel`
 *       = `SKILL_FORMULA.limitMaxLevel`，且玩家实际上限还要被
 *       `levelLimit(角色经验, 境界)` 再压一道 —— 见 27 册 §15.2），
 *       而"能练到多高"应该由**内容层的师徒层级**决定（MUD 的常规做法）。
 *       全服一个教头就能教到顶，门派/高人那条线就永远没有存在理由。
 *   - `base/force` 同档 —— 内功有了等级，`forceRad` 才有来源。
 *   - `wd/taijijian: 80` —— 太极剑法他自己练到 80，于是玩家最多跟他学到 80
 *     （`master-lower` 那道闸）。再往上要另找高人 —— 这就是 MUD 的师徒层级。
 *
 * ★ 他自己**装备**着剑法（`enableAs: 'sword'`）与内功：
 *   这不是为了战斗（他不打架，武馆房间是 `no_fight`），而是让"NPC 的技能面"
 *   在内容层有一个**完整样例**（27 册决策 D9：NPC 与玩家同一套 `SkillBook`，保留技能 id）。
 *
 * ★ `on_master: false` —— 他不是任何人的师父。本项目的"谁能教"判据是
 *   **他会这门、且等级比你高**（`train/learn.ts`），与师父关系无关。
 */
defineNpc('pub/jiaotou', {
  // ★ 名字必须是**玩家能敲出来的那个词**：`findTarget` 是**精确匹配**
  //   （id / name / path / path 末段，见 `engine/command.ts:353-357`），
  //   写「武馆教头」的话 `learn 基本剑法 from 教头` 会得到"这里没有这个人"。
  //   "武馆"放进描述里 —— 房间名已经说了这是武馆。
  name: '教头',
  desc: '一位身材精悍的中年汉子，太阳穴高高鼓起，一身短打收拾得利利落落。',
  gender: 1,
  age: 38,
  // ★ 比店小二高一档：他是"打手"型 NPC，气血厚、臂力高（派生公式见 29 册）
  per: 15,
  con: 30,
  dex: 25,
  int: 20,
  str: 32,
  hp: 200,
  mp: 100,
  max_mp: 100,
  skills: [
    // ★ 基本技能**不写 `enableAs`**：它靠模板上的 `slot` 自己占槽
    //   （`SkillBook.activeTemplate` 的解析顺序：被装配的武功 > 占槽的基本技能）。
    //   写了反而会被 G-校验拦下 —— "一个槽同时只能挂一个武功"（`validate.ts`），
    //   而 `base/sword` 已经占着 sword 了，再让 `wd/taijijian` 声明同一槽就是自相矛盾。
    //   ★ 这一条是被闸门现场抓到的（第一次写就写成 `enableAs: 'sword'`），
    //     留在注释里免得下次又顺手加上。
    //
    // ★ 2026-10-18：六门基本武学全部由他教。少一门，那门内容就是"写了没人教"
    //   （26 册 L8 的病型：声明存在、消费为零）。以后加基本暗器之类，
    //   **要么给他补一行，要么给新 NPC** —— 不能只加技能文件就收工。
    { skill: 'base/force', level: 300 },
    { skill: 'base/dodge', level: 300 },
    { skill: 'base/parry', level: 300 },
    { skill: 'base/unarmed', level: 300 },
    { skill: 'base/sword', level: 300 },
    { skill: 'base/blade', level: 300 },
    { skill: 'wd/taijijian', level: 80, enableAs: 'sword' },
  ],
  // ★ 不掉落、不刷经验：他是**老师**，不是怪。玩家不该靠杀他升级（也杀不动）。
  respawn_ms: 300_000,
  // ★ 面板闸门（2026-10-20）：武馆房间本来就 `no_fight`，这两条是**第二道保险** ——
  //   房间禁武只挡"这里不能动手"，挡不住"把他挪到别处再杀"。
  //   老师被杀掉 ⇒ `learn` 的唯一来源消失 ⇒ 新手成长链在第一环断掉。
  no_fight: true,
  no_kill: true,
  actions: [
    {
      cmd: 'ask',
      name: '请教',
      // ★ 这句话是"新手第一次该做什么"的唯一提示。
      //   不写在这里的话，玩家进游戏只会看到一间房、一个 NPC 和一句描述。
      // ★ 2026-10-18：教学面从 1 门扩到 6 门，提示必须跟着说清楚 ——
      //   否则玩家只知道有"剑法"，永远发现不了轻功/招架/拳脚/刀法。
      //
      // ★★ 2026-10-20 §74 真机反馈：**按钮只给了「基本剑法」「基本轻功」两个**，
      //   而上面这段话说的是"六门我都教" —— 文案与按钮自相矛盾，玩家看到的就是
      //   "教头只教俩武功"。根因是这里**手写了一对命令**，与 `skills:` 数组成了
      //   第二份清单（24 册铁律 4）。
      //   ⇒ 改成**从他的技能表生成**：`skillList()` 是唯一事实（`skills:` 数组），
      //   按钮是它的投影。以后给教头加一门，两处不会漂。
      run: (me, rawTarget) => {
        me.notify('武馆教头抱拳道：「想学武？六门基本功我都教 —— 内功、轻功、招架、拳脚、剑法、刀法。」');
        me.notify('他又道：「用 learn 学会，再用 practice 练。基本功练到三十级，我才好教你太极剑法。」');

        // ★ 目标是**点下来的这一位**（`ask <id>` 的参数就是它的实例 id）；
        //   拿不到就不摆按钮 —— 摆一排点下去不知道发给谁的按钮更糟。
        const env = me.environment;
        const self = rawTarget === undefined ? undefined : findTarget(me, env, rawTarget);
        const list = self?.skillList?.() ?? [];
        if (list.length === 0) return;
        const who = self?.name ?? '';
        // `learn <id> from <name>`：id 是内容 id（`base/blade`），比中文名稳
        const pairs = list.flatMap((s) => [`learn ${s.id} from ${who}`, `学${s.name}`]);
        me.sendCommands(...pairs);
      },
    },
  ],
});

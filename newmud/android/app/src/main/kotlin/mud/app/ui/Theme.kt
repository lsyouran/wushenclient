package mud.app.ui

import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import mud.core.ColorToken

/**
 * 配色 / 形状 / 尺寸 —— **全端唯一的三个来源**（规格见 26 册 §92.3）。
 *
 * ★★ **动任何颜色之前，先读这两句**（§92.4）：
 *
 *   1. **"这块看不清楚" ⇒ 加一条发丝线，不是加一层底色。**
 *      底色说的是"这是一块独立的东西"，发丝线说的是"这两块不是一件事"。
 *      手机上两者的区别被放大了十倍（屏幕小、离眼近），
 *      所以宁可多一条线、不要多一层底。
 *   2. **"这个控件不像能按" ⇒ 加一条边，不是加一块底。**
 *      wushen 的 `.act-item` 就是 `background-color: var(--bg)`（= `#000`，与页面同底）
 *      + `border: 1px solid var(--line)`（`#808080`）。
 *      **它本来就是为"黑底上的一排动作"设计的**，手机端与它同源，直接抄。
 *
 * ★★ **全屏只有四档底色**（§92.4 的层级规范）：
 *
 *   | 档 | 值 | 授权范围 | wushen 出处 |
 *   |---|---|---|---|
 *   | 面 | `#000000` | 全屏底 / 房间区 / 消息流 / 动作栏 / 输入行 / **面板正文** | `--bg`（`body{background}`）；`.dialog{background:var(--bg)}`（`style.css:1084`） |
 *   | 凹 | `#111111` | **状态条 / 输入框 / 提示框（仅此三处）** | `--panel`，注释原文「凹面底：状态条 / 提示框」（`style.css:45`） |
 *   | 带 | `#222222` | **浮层的头带与脚带（仅此）** | `.dialog-header`（`:1099`）/ `.dialog-footer`（`:1156`） |
 *   | 线 | `#343434` | 区块分隔 / 进度轨道 / 禁用边 / 面板边 | `--hair`（`style.css:44`） |
 *
 *   ⇒ **可点的东西一律「透明底（= `Background`）+ 一条 `Line`(#808080) 边」**，
 *     不许给整块底色。
 *
 * ★★ **为什么之前是"割裂"的**（§92.2）：
 *   旧表 26 个颜色里有 **11 个自造色**（无 wushen 出处）：`#1A1A1A` / `#2A2A28` /
 *   `#131313` / `#3A3A3A` / `#6E6220` / `#262626` / `#5E5E5E` …，六级灰彼此只差
 *   1~2 个亮度级 —— 肉眼**分不出层次**（所以"割裂"），却又明显不属于同一套
 *   （所以"丑"）。它们全是"为了让这块看起来像个块"而加的，本批**全部删除**
 *   （删 8 个、改名 3 个，见 [MudColors] 的 G 段）。
 *
 * ★★ **与 §91 那次返工的关系 —— 别又退回去**（§92.4.1）：
 *   §91 退掉的是 wushen 的 **`.tool-item`**（`#808080` **实心底** + `#111` 深字 +
 *   700 粗体 + 35×35 方块，`style.css:885`）—— 那是网页端的**常驻功能键**，
 *   搬到纯黑上就是一屏发光的亮片。
 *   本批搬的是另一族 **`.act-item` / `.pfm-item` / `.chip`**（`style.css:711-734`）：
 *   `background-color: var(--bg)`（**`#000`，黑底**）+ `1px solid #808080` 细边 +
 *   `color: var(--dim)` + `border-radius: 4px` + `min-width: 2.5em` + `min-height: 2em`。
 *
 *   | wushen 的两族 | 语义 | 手机端该不该用 |
 *   |---|---|---|
 *   | `.tool-item`（灰实心块） | **随时能按的固定功能入口**（网页端是图标方块的工具条） | ❌ **不用**。手机端**没有**那条工具条 —— 入口已经长成动作栏与输入行里的**文字按钮** |
 *   | `.act-item`（黑底细边） | **当前能做的事**（出口 / 动作 / 面板里的命令 / 消息里挂的按钮） | ✅ **照抄**。手机端所有按钮都是这一族 |
 *
 *   ⇒ **手机端只有一族可点皮肤**（[Widgets_kt] 的 `MudAction`）。
 *
 * ★ **唯一按目标设备重推的一处**：wushen 的 `.act-item` 边与字**同色**（都是 `#808080`），
 *   因为它还有 `:hover`（边字一起变绿）和 `:active`（底变灰）两个额外状态来表达"能按"。
 *   **触屏上这两个状态都不存在**（没有悬停；按下态一闪而过）⇒ 静态态必须自己说清楚：
 *   **字用 `Ui`(#C0C0C0)，比边 `Line`(#808080) 亮一档**，形成"字亮 / 边中等 / 底黑"三级。
 *   层级数与 wushen 相同，但全部在静态态呈现。
 *
 * ★ **唯一保留的自造色族是暗金**（`Primary` / `PrimaryBorder` / `OnPrimary`）：
 *   它给"登录「连接」+ 两条「发送」"当"默认那一下"的视觉重量（一屏最多两颗）。
 *   橄榄 `#808000` 整块用在纯黑上太亮 ⇒ 压暗到不发光。要动它**先回来改本节**。
 *
 * ★ 字号仍然只有**一档**（[BASE_SP] = 14sp）—— wushen 的 `font-size: 14px`
 *   就是全站唯一的字号，标题靠**字重/颜色**拉层次（`.room-title` 只换色不换字号）。
 */
object MudColors {
    // ── A 族 · 面与线（四档授权，见文件头）──────────────────────────────────
    /** 面：全屏底 / 房间区 / 消息流 / 动作栏 / 输入行 / 面板正文（wushen `--bg`） */
    val Background = Color(0xFF000000)

    /**
     * 凹：状态条 / 提示框 —— **仅此两处**（wushen `--panel`，注释原文「凹面底：状态条 / 提示框」）。
     *
     * ★★ **输入框是这一条的有意例外**，理由要写准（§92.3.1 把"输入框"列进了凹面，
     *   但 §92.6.5 对 `MudField` 的处置是"容器底保持 `Background`"，两边冲突时按
     *   **更具体的那一条**执行）：
     *
     *   · wushen 那条输入带是 `.chat-input>.sender-box`：`background-color: #bebebe`（`:1024`）
     *     + `color: #000`（`:1027`）⇒ **浅灰实心底 + 黑字**；
     *   · 它是 wushen 的**原文**、逐值照抄过来的（`style.css:14` 写明），
     *     而 wushen 的页面底色本来就是 `--bg: #000000`（`:29`、文件头 `:6` "黑底 · 绿字"）
     *     ⇒ 这条带子**在 wushen 上就是浮在纯黑屏上的亮片**，不是"白底页面上的输入框"；
     *   · 但它的可读性靠的是**黑字压在亮底上**，与本项目 §92.4.1 定的
     *     「字亮 / 边中等 / 底黑」**正好相反**。照搬会同时带来两个后果：
     *     ① 一屏上唯一一块亮色实心（比任何正文都抢眼）；
     *     ② 输入框里的字是**深色**，而界面其余所有可点控件都是亮字。
     *
     * ⇒ 所以输入框走 `Background` 底 + `Line` 边（与动作同族）是**有意偏离 wushen**，
     *   不是"抄错了也不是漏抄"。要改回 wushen 那一套，得连"暗底亮字"这条一起推翻。
     */
    val Recessed = Color(0xFF111111)

    /** 带：浮层的头带与脚带 —— **仅此**（wushen `.dialog-header` / `.dialog-footer`） */
    val Band = Color(0xFF222222)

    /** 线：区块分隔 / 进度轨道 / 禁用边 / 面板边（wushen `--hair`） */
    val Hairline = Color(0xFF343434)

    // ── B 族 · 可点的轮廓 ──────────────────────────────────────────────────
    /**
     * 控件边（未选中）。
     *
     * ★ wushen `--line`（`style.css:52`）= `.act-item{border: solid 1px gray}`。
     *   它同时是**"这里能按"的主要信号** —— 底与页面同色，轮廓只能靠这条边。
     */
    val Line = Color(0xFF808080)

    // ── C 族 · 字 ──────────────────────────────────────────────────────────
    /**
     * 服务端内容正文（房间描述 / 消息流 / 实体名）；兼状态条左竖线与提示框顶边。
     *
     * ★ wushen `--fg`（`body{color}`）。两处描边走同一个绿，是为了让"这一条线
     *   和正文是同一件事" —— 不是随便挑了个强调色。
     */
    val Text = Color(0xFF008000)

    /**
     * 房名 / 名号（黄）。
     *
     * ★ wushen `--yellow`（`style.css:51`）→ `.room-title{color:var(--yellow)}`（`:370`）、
     *   `.state-bar>.who`（`:806`）。
     * ★ 待定项 #1 的裁决：**照抄 wushen 的黄 `#FFFF00`**，不用橄榄 `#808000`。
     *   代价是亮黄在纯黑上偏跳；收益是"房名"与网页端是同一个颜色，
     *   且不会跟 `.dialog-title` 的橄榄撞色。
     */
    val Name = Color(0xFFFFFF00)

    /** 界面壳文字：按钮上的字 / 标签 / 数值（wushen `WHT`） */
    val Ui = Color(0xFFC0C0C0)

    /** 次要：数值默认色 / 次级说明（wushen `--dim` / `.progress-num`） */
    val Dim = Color(0xFF898989)

    /** 最弱：占位符 / 禁用字 /「气血」「内力」标签（wushen `--faint`，它的 `blk`） */
    val Faint = Color(0xFF505050)

    /** 面板标题（橄榄）；兼"选中态的边"（wushen `.dialog-title` `:1104`） */
    val Accent = Color(0xFF808000)

    /** 确认 / 频道消息（`.dialog-footer>.ok` 与 `<hic>` / `.ln.chat.wor`（`:644`）同值） */
    val Strong = Color(0xFF00FFFF)

    // ── D 族 · 语义（**不动**，与 `spanStyleOf` 同源）────────────────────────
    /** 错误（`HIR`） */
    val Error = Color(0xFFFF0000)

    /**
     * 红底上的字（wushen `.tool-item>.tag{ background:#d03030; color:#fff }`，
     *   `style.css:925-928`；`#fff` 与 `<hiw>` 同值）。
     *
     * ★ 为什么单开一个 token 而不是就地写 `Color.White`：§92.8「十六进制只有一个来源」
     *   只拦得住 `Color(0xFF…)` 这种字面量，**拦不住具名常量** —— 具名常量是同一条
     *   通道上没被覆盖的那一半。让 `ui/` 下**任何**颜色都只从 [MudColors] 取，
     *   这条判据才是真的闭合。
     * ★ 与 `darkColorScheme.onError`（= `Background`）**不是一回事**：后者是 M3 给
     *   "错误容器"留的槽位，这里是角标这个具体零件上的字色。
     */
    val OnError = Color(0xFFFFFFFF)

    /** 进账 / 得物（`HIG`） */
    val Gain = Color(0xFF00FF00)

    /** 战斗回显（`HIO`） */
    val Fight = Color(0xFFFFA500)

    /** 私聊（`HIM`） */
    val Tell = Color(0xFFFF00FF)

    /**
     * 气血条（wushen `.hp > .progress-bar { background-color: darkred }`）。
     *
     * ★ `darkred` 在纯黑底上非常暗 —— 网页端也一样，它靠 `.progress { border: 1px solid
     *   #343434 }` 那道边框把条形"框"出来。所以条形**没有边框就会看起来像没画**，
     *   这一条在 `GameScreen` 里靠 `trackColor = MudColors.Hairline` 承担。
     */
    val Hp = Color(0xFF8B0000)

    /** 内力条（wushen `.mp > .progress-bar { background-color: darkblue }`） */
    val Mp = Color(0xFF00008B)

    // ── E 族 · 控件（wushen 无对应物 ⇒ 按触屏重推，全族只有 3 个）──────────────
    /**
     * 主行动底：**登录「连接」+ 两条「发送」**。
     *
     * ★ 为什么必须自造：wushen 没有"默认那一下"这个控件概念（网页端全靠按钮位置），
     *   而手机屏需要一个暖色焦点。橄榄 `#808000` 整块用在纯黑上太亮 ⇒ 压暗到不发光。
     *   **一屏最多两颗**。
     */
    val Primary = Color(0xFF43390F)

    /** 主行动边：同族的亮一档，勾轮廓（与 [Primary] 同批自造） */
    val PrimaryBorder = Color(0xFF7A6820)

    /** 主行动的字：浅金 —— 不用纯白，纯白在这套暖调里显得脏（`AuthScreen` 已有同样结论） */
    val OnPrimary = Color(0xFFE9DEA1)

    // ── F 族 · 地图（内容绘制，属"照抄"那一族，不受四档授权约束）───────────────
    /**
     * 地图格底 / 格字（wushen `CreateExitsMap` 的原文三件：`#232323` 底 · `gray` 边 ·
     * `dimgrey` 字，见 `style.css:544` 的注释）。
     *
     * ★ 旧值 `#898989`（= [Dim]）是**抄错档**：`Dim` 与 `dimgrey` 是两个不同的 wushen 值。
     */
    val MapCell = Color(0xFF232323)

    /** 地图格字（`dimgrey`）；**中心格**用它做底、字用 [Background] 反色（同上出处） */
    val MapCellInk = Color(0xFF696969)

    // ── G 段 · 删除清单（8 个自造色，2026-10-22，§92.3.1）────────────────────
    //
    //   `Surface`(#111)          → 改名 `Recessed`，用途从"面板底"收窄到"三处凹面"
    //   `Header`(#222)           → 改名 `Band`，只归浮层的头脚带
    //   `Border`(#343434)        → 改名 `Hairline`
    //   `SurfaceAlt`(#1A1A1A)    → 删：房间区改为**不刷底**，地图格改用 `MapCell`
    //   `Control`(#1A1A1A)       → 删：控件一律走 `Background`
    //   `ControlBorder`(#3A3A3A) → 删：控件边一律走 `Line`
    //   `ControlSelected`(#2A2A28)        → 删：选中态走 `Recessed`
    //   `ControlSelectedBorder`(#6E6220)  → 删：选中态边走 `Accent`
    //   `Disabled`(#131313)      → 删：禁用底走 `Background`
    //   `DisabledBorder`(#262626)→ 删：禁用边走 `Hairline`
    //   `OnDisabled`(#5E5E5E)    → 删：禁用字走 `Faint`
    //
    //   ⇒ 改造后**自造色只剩 3 个**（[Primary] / [PrimaryBorder] / [OnPrimary]），
    //     新增的 5 个（[Line] / [Faint] / [Name] / [MapCell] / [MapCellInk]）全部有 wushen 出处。
}

/**
 * 全站形状。
 *
 * ★★ 上一版只有一个 `Sharp = 2dp`，用在按钮、输入框、面板、角标**全部地方** ——
 *   理由是"wushen 的 `.tool-item` 没有 `border-radius`"。那个理由是**照抄而不是判断**：
 *   2dp 在 3x 屏上是 6 个物理像素，看上去就是直角。
 *   直角按钮在网页上是"整齐"，在手机上是"没做完" —— 触屏控件的圆角是**手指形状**的语言。
 *
 * ★ 档位按"这块东西多大"分：
 *   - [Control] 6dp：手指要按的东西（按钮、输入框、可点的行、状态条）
 *   - [Panel] 10dp：一整块容器（对话框、登录卡片）
 *   - [Tag] 3dp：文本旁边的小块（「战斗中」、浮层的拖拽条）
 *   - [Sheet] 14dp：贴底浮层，只圆上面两角
 *   - [Tab] 6dp：页签，只圆**上面两角**
 *
 * ★ 圆角半径只有 **3 / 6 / 10 / 14** 四档：[Tab] 与 [Control] 同值（6dp），
 *   不为页签新增第五档半径。
 */
object MudShapes {
    /**
     * 控件圆角。
     *
     * ★ wushen 的 `--radius: 4px`（`.act-item`）；4dp 在 3x 屏上只有 12 物理像素
     *   ⇒ 手机上取 6dp（§91 已定，本批保留）。
     */
    val Control = RoundedCornerShape(6.dp)

    /** 浮层卡片：比控件大，因为它是"一大张" —— wushen `.dialog` 也是 `--radius`，这里按触屏重推 */
    val Panel = RoundedCornerShape(10.dp)

    /** 文本旁的小块（角标 / 迷你条）—— 浮层那道「拖拽条」已于 §94 删除，不再是它的用户 */
    val Tag = RoundedCornerShape(3.dp)

    /** 贴底浮层的形状：只圆上面两角（下沿贴着屏幕，圆了反而露出底色） */
    val Sheet = RoundedCornerShape(topStart = 14.dp, topEnd = 14.dp)

    /**
     * 页签：**只圆上面两角**（wushen `.channel-box>span{border-top-left-radius:3px;
     *   border-top-right-radius:3px; border-bottom:none}`，`style.css:996-998`）。
     *
     * ★ 出处里是"方向照抄"（只圆上两角 + 无下边），半径取 [Control] 的 6dp —— 不新增第 5 档。
     */
    val Tab = RoundedCornerShape(topStart = 6.dp, topEnd = 6.dp)
}

/**
 * 尺寸常量（**含间距**）：**只在这里有第二份就会错位**。
 *
 * ★★ `MudAction` 内部是 M3 的 `Button`（视觉 40dp、触点 48dp），而 `ActorChip` 是自绘的
 *   `Box`（更早一版写死 `minHeight = 44dp`，注释还写着"与 MudAction 同一套尺寸"）——
 *   两句都实现之后，**出口那一排 40dp、人物那一排 44dp**，两排下沿差 4dp。
 *   这就是"大小不一"里最难看的一种：不是随机的，是**系统性错位**。
 *
 * ⇒ 高度只有一个来源；自绘的控件读它，组件的按钮也显式设成它。
 *
 * ★★ **纪律（§92.3.4，可机检）**：`ui/` 下除 `Theme.kt`（本文件的定义处）与
 *   `MapView.kt`（`MAP_*` 是 `:core` 给的**量纲换算**，不是布局值）之外，
 *   **不出现裸的「数字.dp」**。间距与控件尺寸**同住这一个 object** ——
 *   曾经想再开一个 `MudSpace` 放间距，但两个 object 就是两个来源，违反铁律 2。
 *
 * ★ **一个数值只写一次**：两个角色恰好同值时，第二个名字直接 `= 第一个名字`
 *   （见 [BlockPadV]），避免出现"两个 token 值相同却各写各的"。
 */
object MudSizes {
    // ── 控件 ────────────────────────────────────────────────────────────────
    /**
     * 控件视觉高度。
     *
     * ★ 取 44dp 而不是 M3 默认的 40dp：一排按钮与一排人物卡片要**下沿对齐**，
     *   而人物卡片里有两行字（名字 + 气血条），压到 40dp 会挤。
     * ★★ 显式 `height()` 会**胜出** M3 内部的 `minimumInteractiveComponentSize`(48dp)：
     *   `height()` 把约束设成 min = max，`Constraints.copy(minHeight = 48)` 会把 min
     *   **夹到 max**，于是既不被撑高、也不抛异常（§92.6.2）。
     */
    val ControlH = 44.dp

    /**
     * 页签高度：比动作矮一档 —— "切换视图"的视觉重量 < "执行动作"。
     *
     * ⚠️ 代价要认：触点 36dp，低于触屏推荐的 48dp。这里是**照网页端、不照触屏推荐值**：
     *   wushen 自己的频道页签是 `line-height:1.5em + padding 0.2em` ≈ **27px**，
     *   36dp 已经是它的 1.3 倍。真要补触点，唯一不破坏高度的办法是给 `MudTabRow`
     *   上下各加 6dp padding，代价是浮层高 12dp —— **本批不做**，先验证真机够不够点。
     */
    val TabH = 36.dp

    /**
     * 按钮最小宽度。
     *
     * ★ 存在的理由就是"大小不一的按钮"：`Button` 默认 `minWidth = 58dp`，
     *   于是「聊」和「小地图」在同一排里宽度差一倍多，看起来像两种控件。
     * ★ 56dp：实际标签以 2~3 个汉字为主（旧值 76dp ≈ 4 字，2 字与 4 字差一倍），
     *   降到 56dp 后 2 字、3 字基本等宽，4 字以上才拉长（那时它本来就该更长）。
     */
    val ControlMinW = 56.dp

    /** 按钮左右内边距（配合 [ControlMinW] 让 2/3 字按钮等宽） */
    val ControlPadH = 10.dp

    /**
     * 密集控件高度：出口 / 动作栏这类"一排里并列很多个"的小选项。
     *
     * ★ 比 [ControlH] 矮一档的理由是**数量**不是重要性：出口一行最多 8 个、
     *   动作栏经常 5~6 个，44dp 的方块在 360dp 屏上只能放下 4 个，
     *   剩下的要靠横滑 —— 而"去哪里"这件事应该是**一眼看全**的。
     *   代价是触点 32dp：与 [TabH] 同一条取舍（照网页端密度，不照触屏推荐值）。
     */
    val ChipH = 32.dp

    /**
     * 密集控件最小宽度。
     *
     * ★ 40dp 的**出处要写准**（早一版写成"出口的 min-width"，是错的）：
     *   · `min-width: 2.5em` 在 wushen 的 **`.room-commands>.act-item`**（动作命令，
     *     `wushen/src/styles/main.css:345-354`），2.5 × 14px = 35px；
     *   · **出口**那一族 `.room_exits>.exits-item` 在网页端**只有 `color: #FFFF00`**
     *     （`main.css:416-419`），**没有最小宽** —— 它是行内文字，不是按钮。
     *   ⇒ 所以 40dp 是我们**按触屏自定的下限**（照 `.act-item` 的 35px 补一点触点），
     *     **不是照抄出口**。下一版若有人拿"wushen 出口是这么宽的"来论证，先看这两行。
     *
     * ★ 单字方向（北/东/南/西）按这个宽度收，双字（东北/西南）自然更宽 ——
     *   不再用 [ControlMinW](56dp)：那是给"两个字的动作按钮"定的，套在单个方向字上
     *   会做出一个右半边空着的方块（用户原话："出口那么大一个框"）。
     */
    val ChipMinW = 40.dp

    // ── 线 ──────────────────────────────────────────────────────────────────
    /** 发丝线宽度：区块分隔 / 控件边 / 面板边（wushen 的 `1px solid var(--hair)`） */
    val HairlineW = 1.dp

    /** 状态条左竖线宽度（wushen `.state-bar{border-left:2px solid var(--fg)}`，`style.css:788`） */
    val MarkerW = 2.dp

    /** 提示框顶边厚度（wushen `.warn-dialog{border-top:4px solid var(--fg)}`，`style.css:1413`） */
    val PromptEdgeW = 4.dp

    // ── 条 ──────────────────────────────────────────────────────────────────
    /** 状态条的血 / 内力条高度（原 7dp，收到 [BarH] 这一个来源里） */
    val BarH = 8.dp

    /** 实体卡里的迷你条：高 / 宽 */
    val MiniBarH = 4.dp
    val MiniBarW = 48.dp

    // ── 浮层 ────────────────────────────────────────────────────────────────
    // ★ `DragBarW` / `DragBarH`（浮层顶部那道"可以拖"的横杠）已于 §94 删除：
    //   `ChatSheet` 是最后一处画它的地方，而那个浮层**从来没有拖拽手势**。
    //   删掉而不是留着的理由：死常量的成本不是几个字节，是每个读这张表的人都要
    //   自己判断一次"它还被用吗"；将来真做可拖浮层时再加两个 `val` 是两行的事。

    // ── 间距 ────────────────────────────────────────────────────────────────
    /** 最紧：消息行之间 / 迷你条与其上文字 / 面板头带上下 */
    val GapTiny = 2.dp

    /** 紧：文本与文本（描述与其上房名、提示语与其上输入框） */
    val Gap1 = 4.dp

    /** 中：同排控件之间、状态条三行之间 */
    val Gap2 = 6.dp

    /** 宽：同组控件的上下间距、按钮区四周 */
    val Gap3 = 8.dp

    /** 容器内缩：面板脚带四周 / 提示框按钮区四周 / 浮层左右 */
    val InsetPad = 10.dp

    /** 屏左右内边距：所有区块统一（★ 旧代码有 8/10/12/14 四份，收成这一个） */
    val ScreenPadH = 12.dp

    /** 正文内边距：面板正文左右 / 提示框正文四周 / 登录卡片内缩 */
    val ContentPad = 14.dp

    /** 区块上下内边距（与 [Gap3] 同值 —— 同值不开第二个数字来源） */
    val BlockPadV = Gap3

    // ── 版式 ────────────────────────────────────────────────────────────────
    /**
     * 「出口 / 此处 / 气血 / 内力」标签定宽。
     *
     * ★ 旧代码里有 **28dp**（`ResourceBar`）与 **32dp**（`LabelledRow`）两份 ——
     *   两处内容起点因此错开，这才是"定宽不一致"的真相（§92.1.1）。收成一个。
     */
    val LabelW = 32.dp

    /** 数值定宽（右对齐）：数值长短变化时条形不会跟着伸缩（每次掉血条都在抖） */
    val NumW = 64.dp

    /**
     * 房间描述**收起态**的行数。
     *
     * ★ 不是 dp 是行数：房间区改回 wushen 的"不限高、不滚"（`style.css:345-356` 把
     *   "两个滚动器"当成教训记着），长描述靠**截断 + 展开**兜住，而不是靠限高滚动。
     *
     * ★★ 为什么还需要下面那个 [RoomDescMapLines]（§94 定案，**算过账才留的**）：
     *   地图满格 112dp 本身吃得下；真正的问题是**固定块总和**：
     *   6 行描述时 ≈ 576dp —— **逐项算式只写在 `GameScreen.kt` §94③ 那一张表里**，
     *   这里不重复第二份。★ 曾经在这里抄过一遍加式（"8 项相加 ≈ 576"），
     *   但那 8 项实际只有 554，差 22 = 区块上下内边距 16 + 发丝线 2 + 状态条 4 ——
     *   **同一笔账写两遍就会漂一次**，所以只留一处。
     *   360×640 可用高 ≈ 568dp ⇒ **已经超了**。
     *   `Column` 不滚、只按顺序摆，超出的部分被裁 ⇒ 被裁掉的是**最后两块**，
     *   也就是消息流与输入行：表现就是用户抱怨过的那句"指令框没见"。
     *   ⇒ 这不是"用户没要求让位"的审美问题，是"输入框还在不在屏幕上"的问题。
     *   一旦真机上出现"开地图后打不了字"，回来读这一段，不要把这一档删掉。
     */
    val RoomDescLines = 6

    /**
     * 房间描述在**地图展开时**的行数（再矮一档）。
     *
     * ★★ 这是**高度预算**，不是审美。算式见 [RoomDescLines] 的 KDoc：6 行描述时固定块
     *   约 576dp > 568dp 可用 ⇒ 输入行被挤出屏幕；降到 3 行后约 516dp，消息流还剩 ≈ 52dp。
     *
     * ★ 配套守卫：地图开着时**不给「展开描述」**（`GameScreen` 里那个 `!mapOpen`）。
     *   否则 `expanded` 与地图共存 ⇒ 房间区拿 `weight(1f)` 后内容超出 ⇒
     *   `Column` 把出口与此处直接裁掉（没有滚动条，玩家只会觉得"东西没了"）。
     *   有这条守卫，"行数跳变导致按钮闪现"也就不存在了：地图开着时那颗按钮根本不画。
     *
     * ★ 地图**不许**改成内部可滚来省高度 —— 那会出现第二个竖向滚动器
     *   （`style.css:345-356` 把"两个滚动器"当过教训）。
     */
    val RoomDescMapLines = 3

    /** 面板正文的最大高度：留出标题 + 按钮区，剩下都归它滚 */
    val PanelBodyMaxH = 320.dp

    /** 提示框正文的最大高度 */
    val PromptBodyMaxH = 260.dp

    // ── 登录屏（wushen 没有登录屏 ⇒ 无对应物，保留 §89.3 定下的原值）────────────
    /** 登录屏整屏内边距：横向 / 纵向 */
    val AuthPadH = 20.dp
    val AuthPadV = 24.dp

    /** 登录屏里「标识行 / 卡片 / 提示」三块之间的间距（与 [ContentPad] 同值） */
    val AuthGap = ContentPad

    /** 登录屏徽记边长 */
    val AuthMarkSide = 48.dp
}

/** 全站唯一一档字号（wushen 的 14px） */
const val BASE_SP = 14

private val MudTypography = Typography().let { base ->
    // ★ 只改正文与标签的两处：其余保留 Material3 默认（按钮 / 标题的字号差异是有意义的，
    //   我们不该为了"统一"把它们也压成 14sp —— 那会让标题和正文分不开）。
    base.copy(
        bodyMedium = base.bodyMedium.copy(fontSize = BASE_SP.sp, lineHeight = 20.sp),
        bodySmall = base.bodySmall.copy(fontSize = (BASE_SP - 2).sp, lineHeight = 16.sp),
    )
}

@Composable
fun MudTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = darkColorScheme(
            primary = MudColors.Accent,
            onPrimary = MudColors.Ui,
            background = MudColors.Background,
            onBackground = MudColors.Ui,
            // ★ 三层"容器"级 token 全部落回四档授权：面 → `Background`、
            //   凹 → `Recessed`、带 → `Band`，不再有第 5 种灰
            surface = MudColors.Background,
            onSurface = MudColors.Ui,
            surfaceVariant = MudColors.Recessed,
            onSurfaceVariant = MudColors.Dim,
            secondaryContainer = MudColors.Band,
            onSecondaryContainer = MudColors.Ui,
            outline = MudColors.Hairline,
            error = MudColors.Error,
            onError = MudColors.Background,
        ),
        typography = MudTypography,
        content = content,
    )
}

/**
 * 服务端文本里的颜色标签 → Compose 的 [SpanStyle]。
 *
 * ★★ 这些是 wushen `src/styles/global.css` 里 **30 个标签类的原值**，不是近似色。
 *   改这里的任何一个数，都会让"同一句话在网页端与手机端不是同一个颜色"。
 *   前两版用的是一套自己配的近似色（Catppuccin 风），看起来协调，但对不上网页端 ——
 *   于是玩家在两边看到的是两种界面。
 *
 * ★★ `when` **没有 `else`**：`ColorToken` 是在 `:core` 里定义的枚举，
 *   新增一个标签而不给它配色 ⇒ 这里**编译不过**。
 *   写 `else -> SpanStyle()` 的后果是"新标签静默变成默认色" ——
 *   服务端用了它，而两端看起来不一样，且没有任何东西会红。
 *
 * ★ 背景色那两族（`Bxxx` / `HBxxx`）只设 `background`，不改前景：
 *   wushen 的语义就是"换底色"，前景由外层的颜色标签决定（CSS 层叠）。
 *   ⚠️ 其中一个反直觉的值照着抄了：`BBLK` 的底色是**白色 `#FFFFFF`**
 *   （"黑底"标签在网页上是"反白"）。看起来像写错了，但它是原值。
 */
fun spanStyleOf(token: ColorToken): SpanStyle = when (token) {
    // ── 暗色前景（10 档）──
    ColorToken.NOR -> SpanStyle(color = Color(0xFF008000))
    ColorToken.GRE -> SpanStyle(color = Color(0xFF008000))
    ColorToken.BLK -> SpanStyle(color = Color(0xFF505050))
    ColorToken.BLU -> SpanStyle(color = Color(0xFF000080))
    ColorToken.CYN -> SpanStyle(color = Color(0xFF008080))
    ColorToken.RED -> SpanStyle(color = Color(0xFF800000))
    ColorToken.MAG -> SpanStyle(color = Color(0xFF800080))
    ColorToken.YEL -> SpanStyle(color = Color(0xFF808000))
    ColorToken.WHT -> SpanStyle(color = Color(0xFFC0C0C0))
    ColorToken.ORA -> SpanStyle(color = Color(0xFFD26900))

    // ── 亮色前景（12 档）──
    ColorToken.HIK -> SpanStyle(color = Color(0xFF808080))
    ColorToken.HIB -> SpanStyle(color = Color(0xFF0000FF))
    ColorToken.HIG -> SpanStyle(color = Color(0xFF00FF00))
    ColorToken.HIC -> SpanStyle(color = Color(0xFF00FFFF))
    ColorToken.HIR -> SpanStyle(color = Color(0xFFFF0000))
    ColorToken.HIM -> SpanStyle(color = Color(0xFFFF00FF))
    ColorToken.HIY -> SpanStyle(color = Color(0xFFFFFF00))
    ColorToken.HIW -> SpanStyle(color = Color(0xFFFFFFFF))
    ColorToken.HIO -> SpanStyle(color = Color(0xFFFFA500))
    ColorToken.HIJ -> SpanStyle(color = Color(0xFFFFD700))
    ColorToken.HIZ -> SpanStyle(color = Color(0xFF912CEE))
    ColorToken.ORD -> SpanStyle(color = Color(0xFFFF4500))

    // ── 暗色背景（8 档）──
    ColorToken.BBLK -> SpanStyle(background = Color(0xFFFFFFFF))
    ColorToken.BBLU -> SpanStyle(background = Color(0xFF000080))
    ColorToken.BCYN -> SpanStyle(background = Color(0xFF008080))
    ColorToken.BRED -> SpanStyle(background = Color(0xFF800000))
    ColorToken.BMAG -> SpanStyle(background = Color(0xFF800080))
    ColorToken.BYEL -> SpanStyle(background = Color(0xFF808000))
    ColorToken.BWHT -> SpanStyle(background = Color(0xFFC0C0C0))
    ColorToken.BHIK -> SpanStyle(background = Color(0xFF808080))

    // ── 亮色背景（7 档）──
    ColorToken.HBBLU -> SpanStyle(background = Color(0xFF0000FF))
    ColorToken.HBGRN -> SpanStyle(background = Color(0xFF00FF00))
    ColorToken.HBCYN -> SpanStyle(background = Color(0xFF00FFFF))
    ColorToken.HBRED -> SpanStyle(background = Color(0xFFFF0000))
    ColorToken.HBMAG -> SpanStyle(background = Color(0xFFFF00FF))
    ColorToken.HBYEL -> SpanStyle(background = Color(0xFFFFFF00))
    ColorToken.HBWHT -> SpanStyle(background = Color(0xFFFFFFFF))

    // ── 版式 ──
    // `DEL`：wushen 是 `text-decoration: line-through; color: gray`
    ColorToken.DEL -> SpanStyle(textDecoration = TextDecoration.LineThrough, color = Color(0xFF808080))
    // `MEM`：wushen 里没有这个类。只给斜体、**不指定颜色** —— 让前景保持外层的颜色，
    //   这样"服务端给一段斜体红字"，红不会被我们改成灰
    ColorToken.MEM -> SpanStyle(fontStyle = FontStyle.Italic)
    // `opt`：wushen 是 `opacity: 0.5`，即"继承色减半"。这里只能取正文色减半近似 ——
    //   SpanStyle 拿不到外层的颜色，而把整段变灰（第一版的做法）是另一个意思
    ColorToken.OPT -> SpanStyle(color = Color(0xFF008000).copy(alpha = 0.5f))
    // `FLA`：wushen 的 `FLA {}` 是**空规则**（真实存在，不是漏写）。这里只留字重，
    //   不加颜色 —— 空规则抄过来等于什么都不做，那这个 token 就白定义了
    ColorToken.FLA -> SpanStyle(fontWeight = FontWeight.Bold)
    // `line`：wushen 是 `color: #008080; display: inline-block; width: 100%; text-align: center`
    //   —— 一条青色分隔线。文本通常为空，真带内容时按"青色 + 等宽"画
    ColorToken.LINE -> SpanStyle(color = Color(0xFF008080), fontFamily = FontFamily.Monospace)
}

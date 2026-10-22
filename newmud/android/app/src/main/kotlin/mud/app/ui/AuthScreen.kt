package mud.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.systemBars
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.sp
import mud.app.MudViewModel
import mud.core.Phase
import mud.core.UiState

/**
 * 连接 / 登录屏。
 *
 * ★ 三个输入框都带**默认值**（地址 + 令牌），只留角色名空着：
 *   这是开发包，服务端 `token` 只做格式校验、**不验签**（`server/session.ts:16`），
 *   于是"要连上得先编一个令牌"这件事纯粹是摩擦。默认值填好，按连接就能进。
 *   ⚠️ T12（账号 + 存档 + 验签）落地后，这里必须改成真正的登录表单。
 *
 * ★★ 地址与角色名**记住上次连成功的那个**（[mud.app.ConnectionPrefs]）：
 *   这一屏原本每次进都要手打 `192.168.1.2:8123` —— 全 App 唯一必须打字的输入，
 *   而被重复输入的东西迟早会被输错。默认值见 `MudViewModel.DEFAULT_URL`。
 *
 * ★★ 布局为什么是"居中的一张卡片"而不是原来那串贴顶的控件：
 *   原来 5 个控件从上到下均匀铺满、每行之间 10dp，视觉上是一张清单，
 *   看不出"这几个是一组、那个是动作"。现在：标识 + 标题在上，**一组输入**装进
 *   [MudPanel] 的框里，动作按钮是实心强调色 —— 层次只有两层（标题 / 表单），
 *   在 5 英寸屏上也能一眼看完。
 */
@Composable
fun AuthScreen(vm: MudViewModel, state: UiState) {
    // ★ 初值来自"上次连成功的地址"，而不是常量：`rememberSaveable` 只活过转屏，
    //   进程被系统回收后它就没了 —— 而"打开 App 要不要重新打地址"是每次都会遇到的。
    var url by rememberSaveable { mutableStateOf(vm.initialUrl) }
    var token by rememberSaveable { mutableStateOf(DEFAULT_TOKEN) }
    var role by rememberSaveable { mutableStateOf(vm.initialRole) }

    // ★★ 只显示**这一轮**产生的话。`state.log` 是跨会话累积的（`note()` 写进去的行
    //   在登录成功前不会被清），于是"上次连接失败"会一直挂在这一屏上，
    //   看起来像"这次也失败了"。记下点连接时的行数，之后只显示它后面的。
    //   ⚠️ 这么做之所以安全：消息流有 400 行上限（`MAX_LOG_LINES`），到顶后下标会整体
    //   前移，那时 `drop(attemptAt)` 会多显示几行旧的 —— 而这一屏只在**没登录成功**时
    //   出现，攒到 400 行系统的可能性可以忽略；真到了那一步该动的是"这一屏为什么要看日志"。
    var attemptAt by rememberSaveable { mutableStateOf(0) }
    val fresh = state.log.drop(attemptAt)

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(MudColors.Background)
            .windowInsetsPadding(WindowInsets.systemBars)
            .imePadding()
            // 小屏 + 软键盘弹出时放不下 ⇒ 必须能滚，否则"连接"按钮会顶到键盘底下
            .verticalScroll(state = rememberScrollState())
            .padding(horizontal = MudSizes.AuthPadH, vertical = MudSizes.AuthPadV),
        verticalArrangement = Arrangement.spacedBy(space = MudSizes.AuthGap),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            MudMark(side = MudSizes.AuthMarkSide)
            Column(modifier = Modifier.padding(start = MudSizes.ScreenPadH)) {
                Text(
                    text = "新武林",
                    // 字距拉开是这一屏唯一的"装饰"：同一档字号靠字重/字距拉层次，
                    // 与全站只有一档字号（`BASE_SP`）这条约定一致
                    // ★ 颜色从 `Accent`（#808000 橄榄）换成 `OnPrimary`（浅金）：
                    //   橄榄是 wushen **面板标题条**（#222 底）上的色，压在纯黑上会闷掉
                    style = MaterialTheme.typography.headlineSmall.copy(
                        color = MudColors.OnPrimary,
                        letterSpacing = 6.sp,
                    ),
                )
                Text(
                    text = "文字江湖 · 开发预览",
                    color = MudColors.Dim,
                    style = MaterialTheme.typography.bodySmall,
                )
            }
        }

        // ★ 登录卡片**显式**传 `container = Recessed`：它是"表单"，wushen 没有登录屏，
        //   于是按"凹面"处理（与状态条同族，§92.5.5）。其余面板一律 `Background`。
        MudPanel(
            modifier = Modifier.fillMaxWidth(),
            container = MudColors.Recessed,
        ) {
            Column(
                modifier = Modifier.padding(all = MudSizes.ContentPad),
                verticalArrangement = Arrangement.spacedBy(space = MudSizes.InsetPad),
            ) {
                MudField(
                    value = url,
                    onValueChange = { url = it },
                    label = "服务端地址",
                    placeholder = MudViewModel.DEFAULT_URL,
                    // ★ 三个输入框都显式传 `Background`(#000)：**槽永远比它所在的面暗一档** ——
                    //   登录卡片自己是 `Recessed`(#111)（见下面 `MudPanel`），槽就得是 `#000`。
                    //   用默认的 `Recessed` 会与卡片同色，整块只剩一条边（凹槽规则见 [MudField]）。
                    fill = MudColors.Background,
                    keyboardOptions = KeyboardOptions(
                        keyboardType = KeyboardType.Uri,
                        imeAction = ImeAction.Next,
                    ),
                    modifier = Modifier.fillMaxWidth(),
                )
                MudField(
                    value = token,
                    onValueChange = { token = it },
                    label = "令牌（≥16 字符）",
                    placeholder = "开发包不验签，默认值可用",
                    fill = MudColors.Background,
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next),
                    modifier = Modifier.fillMaxWidth(),
                )
                MudField(
                    value = role,
                    onValueChange = { role = it },
                    label = "角色名",
                    placeholder = "进江湖用的名字",
                    fill = MudColors.Background,
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                    modifier = Modifier.fillMaxWidth(),
                )
                MudAction(
                    label = if (state.phase == Phase.Connecting) "连接中…" else "连接",
                    onClick = {
                        // ★ 先取行数再连：`connect()` 会把失败原因追加进 log，
                        //   取晚了那一行就落在 `attemptAt` 之前，屏幕上一句都不显
                        attemptAt = state.log.size
                        vm.connect(url, token, role)
                    },
                    enabled = state.phase != Phase.Connecting,
                    primary = true,
                    // ★ `fillWidth = true` 而不是 `modifier = Modifier.fillMaxWidth()`：
                    //   后者只会把按钮撑满，而 `Button` 内部的内容 `Row` 是 wrap content、
                    //   贴着左边缘 —— 结果是"通栏的按钮 + 靠左的字"。
                    //   通栏 + 居中是一件事，只能由一个参数一次表达（见 [MudAction] 的 KDoc）。
                    fillWidth = true,
                )
            }
        }

        // 参数说明放在卡片**下面**：它是解释，不该夹在"填什么"和"按哪个"之间
        MudHint(text = "模拟器填 10.0.2.2:8123；真机填电脑的局域网地址（端口默认 8123）。")
        if (vm.initialRole.isNotEmpty()) {
            // 判据是"**上次**成功过"（角色名框的初值有值），不是"现在框里有字" ——
            // 后者在玩家刚敲第一个字时就会把这句话亮出来，而那时还没连上任何东西
            // ★ 用浅金而不是 `Strong`（#00FFFF）：那是个"确认键"级别的青，拿来说一句
            //   常驻提示会盖过它该强调的东西（连接按钮）
            MudHint(
                text = "上次连成功的是这台：地址与角色名已记住，下次不用再填。",
                color = MudColors.OnPrimary,
            )
        }

        for (line in fresh) {
            Text(
                text = line.text,
                color = MudColors.Error,
                style = MaterialTheme.typography.bodySmall,
            )
        }
        if (state.authMessage.isNotEmpty()) {
            Text(
                text = state.authMessage,
                color = MudColors.Error,
                style = MaterialTheme.typography.bodySmall,
            )
        }

        Spacer(modifier = Modifier.height(height = MudSizes.Gap3))
    }
}

/** 开发包的默认令牌（服务端只校验长度，见文件头） */
private const val DEFAULT_TOKEN = "tttttttttttttttttttt"

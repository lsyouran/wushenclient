package mud.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.runtime.Composable
import androidx.core.view.WindowCompat
import androidx.lifecycle.viewmodel.compose.viewModel
import mud.app.ui.MudApp
import mud.app.ui.MudTheme

/**
 * 唯一的 Activity。
 *
 * ★ 为什么只有一个 Activity、界面全靠 Compose 切：
 *   多 Activity / Fragment 会让"状态放哪"变成一个问题，而本项目**连接是有状态的**
 *   （转屏、后台、回来都不该掉线）。单 Activity + `ViewModel` 让"连接的生命周期"
 *   与"界面的生命周期"彻底分开 —— 界面重建不碰连接。
 *
 * ★ `setDecorFitsSystemWindows(false)` + 各屏自己的 `windowInsetsPadding`：
 *   这是 edge-to-edge 的标准做法。**不这么做**的后果是输入框被软键盘盖住
 *   （`adjustResize` 在 Android 15 的强制 edge-to-edge 下不再可靠）。
 */
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        setContent { Root() }
    }
}

@Composable
private fun Root() {
    MudTheme {
        val vm: MudViewModel = viewModel()
        MudApp(vm)
    }
}

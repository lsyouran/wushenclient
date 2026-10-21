package mud.app.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import mud.app.MudViewModel

/**
 * 两块屏的切换：**只看"有没有角色"**。
 *
 * ★ 判据不是 `phase == InGame`：断线时 `phase` 变成 [Phase.Closed]，
 *   按 phase 切的话，一掉线就会被弹回登录屏 —— 而消息流里正好写着"为什么断了"，
 *   玩家却看不到了。只要还登录过（`me != null`），就留在游戏屏，
 *   顶部给一条"连接已断开 / 重连"的横条（`GameScreen` 里的 `ReconnectBar`）。
 *
 * ★ 这条判据和网页端**刻意不同**：网页端断线就退回认证屏（`screens.ts`），
 *   因为浏览器上重连是"刷新页面"的代价；手机上重连是一次点击，
 *   而丢掉一屏还能读的日志才是更贵的损失。
 */
@Composable
fun MudApp(vm: MudViewModel) {
    val state by vm.state.collectAsStateWithLifecycle()
    if (state.me != null) {
        GameScreen(vm, state)
    } else {
        AuthScreen(vm, state)
    }
}

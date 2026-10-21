package mud.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.systemBars
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.Button
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
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
 */
@Composable
fun AuthScreen(vm: MudViewModel, state: UiState) {
    var url by rememberSaveable { mutableStateOf(MudViewModel.DEFAULT_URL) }
    var token by rememberSaveable { mutableStateOf(DEFAULT_TOKEN) }
    var role by rememberSaveable { mutableStateOf("") }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(MudColors.Background)
            .windowInsetsPadding(WindowInsets.systemBars)
            .imePadding()
            .padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Text("新武林", style = MaterialTheme.typography.headlineSmall, color = MudColors.Accent)
        Text(
            "连到本机的 MUD 服务端。模拟器用 10.0.2.2；真机填电脑的局域网 IP。",
            style = MaterialTheme.typography.bodySmall,
            color = MudColors.Dim,
        )

        OutlinedTextField(
            value = url,
            onValueChange = { url = it },
            label = { Text("服务端") },
            singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, imeAction = ImeAction.Next),
            modifier = Modifier.fillMaxWidth(),
        )
        OutlinedTextField(
            value = token,
            onValueChange = { token = it },
            label = { Text("令牌（≥16 字符）") },
            singleLine = true,
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next),
            modifier = Modifier.fillMaxWidth(),
        )
        OutlinedTextField(
            value = role,
            onValueChange = { role = it },
            label = { Text("角色名") },
            singleLine = true,
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
            modifier = Modifier.fillMaxWidth(),
        )

        Button(
            onClick = { vm.connect(url, token, role) },
            enabled = state.phase != Phase.Connecting,
            modifier = Modifier.fillMaxWidth(),
        ) {
            Text(if (state.phase == Phase.Connecting) "连接中…" else "连接")
        }

        // ★ 连接参数的问题由 `MudClient.note` 写进消息流，而这一屏没有消息流 ——
        //   于是把最近几行系统提示摆在这里。否则"点了连接什么都没发生"（其实是被拦下了）。
        for (line in state.log.takeLast(3)) {
            Text(line.text, color = MudColors.Error, style = MaterialTheme.typography.bodySmall)
        }
        if (state.authMessage.isNotEmpty()) {
            Text(state.authMessage, color = MudColors.Error, style = MaterialTheme.typography.bodySmall)
        }
    }
}

/** 开发包的默认令牌（服务端只校验长度，见文件头） */
private const val DEFAULT_TOKEN = "tttttttttttttttttttt"

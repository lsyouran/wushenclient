package mud.app

import android.content.Context

/**
 * 「上次**连成功**的地址」的落脚处。
 *
 * ★ 为什么要落盘，而不是继续用 `rememberSaveable`：
 *   `rememberSaveable` 只活过**进程没死**的重建（转屏、深色模式切换）。
 *   而从"装完 APK 打开"到"真正进游戏"之间，玩家会切后台、会被系统回收，
 *   一回来地址框就退成编译期常量 —— 于是每次都要重新敲一遍 `192.168.1.2:8123`。
 *   那是这个 App 里**唯一一处必须手打的东西**，而被重复输入的东西迟早会被输错。
 *
 * ★★ 存的是**成功过**的那一个，不是"最后输入的那个"：
 *   输错一个地址 → 连不上 → 下次打开还把你带回那个错地址，等于把错误也记住了。
 *   回写点因此放在 `phase == InGame` 之后（见 [MudViewModel]），不是点"连接"时。
 *
 * ★ 用 `SharedPreferences` 而不是 DataStore：这一版只存两个字符串，
 *   DataStore 要引入 `datastore-preferences` 依赖 + 一个 `Flow` + 一个 `CoroutineScope`，
 *   换取的东西（跨进程一致性、类型安全）这里一个都用不上。
 *   ⚠️ T12（账号 + 存档 + 验签）落地时，**令牌不该走这条路** —— 那时要换
 *   `EncryptedSharedPreferences` 或干脆只留内存；这里的两个键都不敏感，所以可以偷懒。
 */
class ConnectionPrefs(context: Context, private val defaultUrl: String) {
    // ★ 用 `applicationContext` 会被 GC 无关地持有到进程结束 —— 这里存的是
    //   一个 Activity 的 context 时才会泄漏，而调用点给的就是 Application（见 MudViewModel）。
    private val prefs = context.getSharedPreferences(FILE, Context.MODE_PRIVATE)

    /** 上次连成功的地址；没连成功过就是 [defaultUrl] */
    var url: String
        get() = prefs.getString(KEY_URL, null)?.takeIf { it.isNotBlank() } ?: defaultUrl
        set(value) {
            prefs.edit().putString(KEY_URL, value).apply()
        }

    /** 上次进游戏用的角色名。空串 = 没成功过（此时界面该留空，不替玩家编一个名字） */
    var role: String
        get() = prefs.getString(KEY_ROLE, null).orEmpty()
        set(value) {
            prefs.edit().putString(KEY_ROLE, value).apply()
        }

    private companion object {
        const val FILE = "mud.connection"
        const val KEY_URL = "lastOkUrl"
        const val KEY_ROLE = "lastOkRole"
    }
}

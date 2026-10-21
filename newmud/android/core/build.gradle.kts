// :core —— 全部**判断**都在这里，而且**不依赖安卓**。
//
// ★ 为什么把逻辑单独放一个纯 JVM 模块（26 册 §83.2）：
//   网页端的教训是"改一版界面又在真机上发现文本进错框"（§57 / §74 / §78 / §80 四次）。
//   根因不在于界面代码写得差，而在于**判断逻辑长在渲染代码里**：
//   它只在浏览器里跑、只有 DOM 断言能碰、只有人手点才暴露。
//   ⇒ 安卓端把判断挪到这里：`UiState` 是不可变数据，`Reduce` 是纯函数，
//     测试在 JVM 上跑（毫秒级），需要模拟器才能测的 `:app` 里**没有判断可写错**。
//
// ★ 连"颜色"也在这一层：`Markup.kt` 把服务端文本里的 `<HIR>…</HIR>` 解析成
//   与平台无关的 span（`ColorToken` + 区间），`:app` 只做 ColorToken → Compose Color 的查表。
//   这样"白名单 / 嵌套上限 / 未知标签当文字"这三条安全语义可以和网页端保持一致，
//   并且**能在 JVM 上断言**（网页端那份在 `src/ui/markup.ts`，靠 jsdom 测）。
plugins {
    alias(libs.plugins.kotlin.jvm)
    // ★ `api(...)` 只在 `java-library` 里存在（`kotlin("jvm")` 带的是 `java`）：
    //   `:core` 把 `Packet` 与 `StateFlow` 都暴露给 `:app`，所以必须用 `api` 而不是 `implementation`。
    `java-library`
}

kotlin {
    jvmToolchain(17)
}

dependencies {
    api(project(":protocol"))
    api(libs.kotlinx.coroutines.core)

    testImplementation(libs.junit)
}

// ★ :core 的测试把 `:protocol` 的 `src/test/resources` 挂进 classpath。
//
//   为什么：那批 `fixtures/*.json` 是**真机抓的帧**，是"协议长什么样"的唯一事实。
//   复制一份到 :core 就是第二份真相（改了协议只更新一处，另一处照样绿）。
//   Gradle 的 `testImplementation(project(":protocol"))` 只带**主**产物，不带对端的测试资源 ——
//   所以这里直接把那个目录挂成 classpath 根（于是 `/fixtures/x.json` 照样能读到）。
//   只挂读，不挂写；也不复制。
tasks.named<Test>("test") {
    classpath += files("../protocol/src/test/resources")
}

tasks.withType<Test>().configureEach {
    systemProperty("file.encoding", "UTF-8")
}

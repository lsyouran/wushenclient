// 安卓客户端（26 册 §83）。
//
// ★★ 三个模块的分工就是"能不能在 CI 上验"的分工：
//   :protocol  = 协议生成物（`tools/gen-kotlin-protocol.mjs` 写的，**不要手改**）+ 解码测试
//   :core      = 全部**判断**：文本落点、颜色标记、面板轮次、状态归约。**纯 JVM，不依赖安卓**
//   :app       = 只有渲染：Compose 界面 + WebSocket 实现
//
//   ⇒ 凡是"会出错的东西"都在 :core，而 :core 的测试跑在普通 JVM 上（`gradle :core:test`），
//     不需要模拟器、不需要安卓 SDK、几十秒出结果。:app 里没有业务判断可断言 ——
//     这是刻意的：能在 JVM 里断言的判断，别放进需要模拟器才能测的那一层。

pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "newmud-android"

include(":protocol", ":core")

// ★ `-PskipApp` ⇒ 不配置 `:app`。
//
//   为什么需要这个开关（不是洁癖）：Android Gradle Plugin 在**配置阶段**就要求
//   `ANDROID_HOME` / `local.properties` 里有个真 SDK。而 `:protocol` / `:core` 的测试
//   与安卓毫无关系 —— 没有这个开关，一台没有安卓 SDK 的机器（CI 的 JVM 作业、
//   开发者的笔记本）连 `gradle :core:test` 都跑不起来，会被 "SDK location not found" 挡住。
//   ⇒ JVM 作业用 `-PskipApp`，出 APK 的作业不带它。
if (gradle.startParameter.projectProperties["skipApp"] != "true") {
    include(":app")
}

// 协议模块：**只有生成物**（`src/main/kotlin/mud/protocol/Protocol.kt`）。
//
// ★ 本模块的 `src` 里没有一行是手写的：
//   `node tools/gen-kotlin-protocol.mjs` 从 `shared/protocol.ts` 生成。
//   手改这里 = 造出协议的第三份真相，下次生成就被覆盖，且 `--check` 会红。
//
// ★ 它不依赖安卓：`kotlinx.serialization` 是纯 JVM 库。
//   于是"Kotlin 到底能不能解开服务端的帧"可以在普通 JVM 上验（`gradle :protocol:test`）。
plugins {
    alias(libs.plugins.kotlin.jvm)
    alias(libs.plugins.kotlin.serialization)
    // ★ 必须显式加 `java-library`：`api(...)` 这个配置只由它提供（`kotlin("jvm")` 只带 `java`）。
    //   少了它的报错是 "Could not find method api()"，看着像版本问题，其实是少了插件。
    `java-library`
}

kotlin {
    jvmToolchain(17)
}

dependencies {
    // `api`：:core 与 :app 都要用 `Packet` / `decodePacket`，不该各自再声明一次
    api(libs.kotlinx.serialization.json)

    testImplementation(libs.junit)
}

tasks.withType<Test>().configureEach {
    // 测试要读 `src/test/resources/fixtures/*.json`（真机抓的报文），用 UTF-8 才不会把中文读成乱码
    systemProperty("file.encoding", "UTF-8")
    testLogging {
        events("passed", "failed", "skipped")
        showStandardStreams = false
    }
}

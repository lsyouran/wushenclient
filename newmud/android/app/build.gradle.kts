// :app —— **只有渲染**。业务判断一行都不在这里（判断在 :core，那里能在 JVM 上断言）。
//
// ★ 这条分工是刻意的（26 册 §83.2）：网页端四次"文本进错框"的根因是判断长在渲染代码里，
//   于是只有人手点、只有 DOM 断言能碰。安卓端把判断抽走之后，
//   这个模块里剩下的东西**没有可写错的判断**：布局、配色、把字符串画出来。
plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.compose.compiler)
}

android {
    namespace = "mud.app"
    compileSdk = 35

    defaultConfig {
        applicationId = "mud.app"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "0.1.0"
    }

    buildFeatures {
        compose = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildTypes {
        getByName("release") {
            isMinifyEnabled = false
            // ★ 不混淆：协议类是 kotlinx.serialization 生成的，混淆规则要额外维护一套，
            //   而这一版还没有发布渠道。真要开 minify 时记得先补 serialization 的 keep 规则。
        }
    }
}

kotlin {
    compilerOptions {
        // ★ 必须与 `compileOptions` 的 17 对齐：不一致时 AGP 会直接报
        //   "Inconsistent JVM-target compatibility detected"（不是警告，是失败）
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
    }
}

dependencies {
    implementation(project(":core"))
    implementation(project(":protocol"))

    implementation(platform(libs.compose.bom))
    implementation(libs.compose.ui)
    implementation(libs.compose.ui.graphics)
    implementation(libs.compose.ui.tooling.preview)
    implementation(libs.compose.material3)

    implementation(libs.activity.compose)
    implementation(libs.lifecycle.viewmodel.compose)
    implementation(libs.lifecycle.runtime.compose)
    implementation(libs.kotlinx.coroutines.android)

    implementation(libs.okhttp)
}

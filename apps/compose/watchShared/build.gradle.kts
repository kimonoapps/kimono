plugins {
    alias(libs.plugins.kotlin.multiplatform)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.android.kmp.library)
}

/*
 * Kimono Watch's shared half: the Watch API client, its shapes, signing in,
 * and the view models. No UI and no player, so the iPhone app can reuse it as
 * it is when it comes.
 */
kotlin {
    android {
        namespace = "app.kimono.watch.shared"
        compileSdk = 37
        minSdk = 26
    }
    listOf(iosArm64(), iosSimulatorArm64()).forEach { target ->
        target.binaries.framework {
            baseName = "WatchShared"
            isStatic = true
        }
    }

    sourceSets {
        commonMain.dependencies {
            implementation(libs.ktor.core)
            api(libs.serialization.json)
            api("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.11.0")
            api("org.jetbrains.androidx.lifecycle:lifecycle-viewmodel:${libs.versions.lifecycle.get()}")
        }
        androidMain.dependencies {
            implementation(libs.ktor.okhttp)
        }
        iosMain.dependencies {
            implementation(libs.ktor.darwin)
        }
    }
}

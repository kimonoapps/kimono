plugins {
    alias(libs.plugins.kotlin.multiplatform)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.compose.compiler)
    alias(libs.plugins.compose)
    alias(libs.plugins.android.kmp.library)
}

/*
 * Kimono Watch's shared half, in Compose Multiplatform: the Watch API client,
 * signing in, the view models, the theme and ink, and the phone screens with
 * the player's controls. The Android app adds TV screens, ExoPlayer and the
 * device's capabilities; the iPhone app will add its own player the same way.
 */
kotlin {
    android {
        namespace = "app.kimono.watch.shared"
        compileSdk = 37
        minSdk = 26
        androidResources { enable = true }
    }
    listOf(iosArm64(), iosSimulatorArm64()).forEach { target ->
        target.binaries.framework {
            baseName = "WatchShared"
            isStatic = true
        }
    }

    sourceSets {
        commonMain.dependencies {
            api(libs.compose.runtime)
            api(libs.compose.foundation)
            api(libs.compose.ui)
            api(libs.compose.resources)
            api(libs.compose.backhandler)
            api(libs.material3)
            api(libs.lifecycle.viewmodel)
            api(libs.lifecycle.runtime)
            api(libs.coil.compose)
            implementation(libs.coil.ktor)
            implementation(libs.ktor.core)
            api(libs.serialization.json)
            api("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.11.0")
        }
        androidMain.dependencies {
            implementation(libs.ktor.okhttp)
        }
        iosMain.dependencies {
            implementation(libs.ktor.darwin)
        }
    }
}

compose.resources {
    publicResClass = true
    packageOfResClass = "app.kimono.watch.resources"
}

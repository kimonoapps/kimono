plugins {
    alias(libs.plugins.kotlin.multiplatform)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.compose.compiler)
    alias(libs.plugins.compose)
    alias(libs.plugins.android.kmp.library)
}

kotlin {
    android {
        namespace = "app.kimono.shared"
        compileSdk = 37
        minSdk = 26
        androidResources { enable = true }
    }
    // iosArm64() and iosSimulatorArm64() join once Xcode is installed; all
    // shared code already lives in commonMain.

    sourceSets {
        commonMain.dependencies {
            implementation(libs.compose.runtime)
            implementation(libs.compose.foundation)
            implementation(libs.compose.ui)
            implementation(libs.compose.resources)
            implementation(libs.material3)
            implementation(libs.lifecycle.viewmodel)
            implementation(libs.lifecycle.runtime)
            implementation(libs.navigation)
            implementation(libs.ktor.core)
            implementation(libs.serialization.json)
            implementation(libs.coil.compose)
            implementation(libs.coil.ktor)
        }
        androidMain.dependencies {
            implementation(libs.ktor.okhttp)
        }
    }
}

compose.resources {
    publicResClass = false
    packageOfResClass = "app.kimono.resources"
}

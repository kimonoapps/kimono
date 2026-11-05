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
    /* The iPhone app links this as a framework; iosApp/ builds it from Xcode. */
    listOf(iosArm64(), iosSimulatorArm64()).forEach { target ->
        target.binaries.framework {
            baseName = "Shared"
            isStatic = true
        }
    }

    sourceSets {
        commonMain.dependencies {
            implementation(libs.compose.runtime)
            implementation(libs.compose.foundation)
            implementation(libs.compose.ui)
            implementation(libs.compose.resources)
            implementation(libs.compose.backhandler)
            implementation(libs.material3)
            implementation(libs.lifecycle.viewmodel)
            implementation(libs.lifecycle.runtime)
            implementation(libs.navigation)
            implementation(libs.ktor.core)
            implementation(libs.serialization.json)
            implementation(libs.coil.compose)
            implementation(libs.coil.ktor)
            implementation(libs.coil.svg)
            implementation(libs.kotlinx.io)
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
    publicResClass = false
    packageOfResClass = "app.kimono.resources"
}

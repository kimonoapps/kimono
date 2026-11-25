import org.jetbrains.kotlin.gradle.plugin.mpp.apple.XCFramework

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
        /* Plain JVM tests of the shared code (Prayer's schedule): ./gradlew :shared:testAndroidHostTest */
        withHostTestBuilder {}
    }
    /*
     * The iPhone and iPad app links this as a framework; iosApp/ builds it from Xcode. The same
     * framework is also packed as Shared.xcframework (`:shared:assembleSharedReleaseXCFramework`,
     * macOS only) for builds without Xcode, such as a local xtool build on Linux.
     * Compose resources travel inside it (Shared.framework/composeResources).
     */
    val xcframework = XCFramework("Shared")
    listOf(iosArm64(), iosSimulatorArm64()).forEach { target ->
        target.binaries.framework {
            baseName = "Shared"
            isStatic = true
            binaryOption("smallBinary", "true")
            xcframework.add(this)
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
            implementation(libs.latex.renderer)
            implementation(libs.latex.fonts.katex)
            implementation(libs.kotlinx.io)
            implementation(libs.kotlinx.datetime)
        }
        commonTest.dependencies {
            implementation(libs.kotlin.test)
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

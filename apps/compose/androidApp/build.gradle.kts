import java.io.File

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.compose.compiler)
}

/* The Kimono signing key, kept outside the repo (see apps/mobile/README.md). */
val kimonoKey = File(System.getProperty("user.home"), ".config/kimono/android-release.jks")
val kimonoKeyPassword = File(kimonoKey.parentFile, "android-release.password").takeIf { it.exists() }?.readText()?.trim()
/* -PkimonoLocalTest lets a test build reach a Portal on this machine over http. */
val localTest = providers.gradleProperty("kimonoLocalTest").isPresent

android {
    namespace = "app.kimono.android"
    compileSdk = 37
    defaultConfig {
        applicationId = "app.kimono.compose"
        minSdk = 26
        targetSdk = 36
        versionCode = 1
        versionName = "0.1.0"
        manifestPlaceholders["cleartext"] = localTest.toString()
    }
    signingConfigs {
        create("kimono") {
            if (kimonoKeyPassword != null) {
                storeFile = kimonoKey
                storePassword = kimonoKeyPassword
                keyAlias = "kimono"
                keyPassword = kimonoKeyPassword
            }
        }
    }
    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = if (kimonoKeyPassword != null) signingConfigs.getByName("kimono") else signingConfigs.getByName("debug")
        }
    }
    buildFeatures { compose = true }
}

dependencies {
    implementation(project(":shared"))
    implementation(libs.activity.compose)
    implementation(libs.browser)
    implementation(libs.ktor.okhttp)
    implementation(libs.compose.ui)
    implementation(libs.material3)
}

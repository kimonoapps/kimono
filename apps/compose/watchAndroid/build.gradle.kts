import java.io.File

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.compose.compiler)
    alias(libs.plugins.kotlin.serialization)
}

/* Signed with the Kimono key, like the main app (see apps/compose/README.md). */
val kimonoKey = File(System.getProperty("user.home"), ".config/kimono/android-release.jks")
val kimonoKeyPassword = File(kimonoKey.parentFile, "android-release.password").takeIf { it.exists() }?.readText()?.trim()
/* -PkimonoLocalTest lets a test build reach a Portal on this machine over http. */
val localTest = providers.gradleProperty("kimonoLocalTest").isPresent

val media3 = "1.9.0"

android {
    namespace = "app.kimono.watch"
    compileSdk = 37
    defaultConfig {
        applicationId = "app.kimono.watch"
        minSdk = 26
        targetSdk = 36
        versionCode = (findProperty("kimonoBuild") as String?)?.toInt() ?: 1
        versionName = (findProperty("kimonoVersion") as String?) ?: "0.1.0"
        manifestPlaceholders["cleartext"] = localTest.toString()
        ndk { abiFilters += listOf("arm64-v8a", "armeabi-v7a") }
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
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfig = if (kimonoKeyPassword != null) signingConfigs.getByName("kimono") else signingConfigs.getByName("debug")
        }
    }
    buildFeatures { compose = true }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_21
        targetCompatibility = JavaVersion.VERSION_21
    }
    packaging { jniLibs { useLegacyPackaging = false } }
}

dependencies {
    implementation(project(":watchShared"))
    implementation(libs.activity.compose)
    implementation(libs.ktor.okhttp)
    implementation(libs.compose.ui)
    implementation(libs.compose.foundation)
    implementation(libs.material3)
    implementation(libs.lifecycle.viewmodel)
    implementation(libs.lifecycle.runtime)
    implementation(libs.coil.compose)
    implementation("io.coil-kt.coil3:coil-network-okhttp:${libs.versions.coil.get()}")
    implementation("androidx.tv:tv-material:1.1.0")
    implementation("androidx.media3:media3-exoplayer:$media3")
    implementation("androidx.media3:media3-exoplayer-hls:$media3")
    implementation("androidx.media3:media3-datasource-okhttp:$media3")
    implementation("androidx.media3:media3-ui:$media3")
    implementation("androidx.media3:media3-session:$media3")
    /* Chromecast: the TV plays the Portal's HLS rendition with Google's built-in receiver, the phone is the remote. */
    implementation("androidx.media3:media3-cast:$media3")
    implementation("androidx.mediarouter:mediarouter:1.8.1")
    /* AC-3, E-AC-3, DTS and TrueHD decoded in software where the device can't. */
    implementation("org.jellyfin.media3:media3-ffmpeg-decoder:$media3+1")
    /* libass: anime subtitles drawn with their styles, signs and karaoke. */
    implementation("io.github.peerless2012:ass-media:0.5.1")
    /* The TV's sign-in QR code. */
    implementation("com.google.zxing:core:3.5.3")
}

rootProject.name = "kimono-compose"

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

include(":shared", ":androidApp")
/* Kimono Watch: its own app, so the main one gains nothing from the player. */
include(":watchShared", ":watchAndroid")

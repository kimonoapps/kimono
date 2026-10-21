package app.kimono.android

import android.app.Application
import app.kimono.data.Session
import io.ktor.client.HttpClient
import io.ktor.client.engine.okhttp.OkHttp

/** One session for the whole process, so a share arriving later finds you signed in. */
class KimonoApplication : Application() {
    val platform by lazy { AndroidPlatform(this) }
    val session by lazy { Session(platform, HttpClient(OkHttp) { followRedirects = true }) }
}

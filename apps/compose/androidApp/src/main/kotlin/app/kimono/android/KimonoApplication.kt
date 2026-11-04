package app.kimono.android

import android.app.Application
import app.kimono.data.Session
import app.kimono.data.SessionState
import io.ktor.client.HttpClient
import io.ktor.client.engine.okhttp.OkHttp
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.distinctUntilChangedBy
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/** One session for the whole process, so a share arriving later finds you signed in. */
class KimonoApplication : Application() {
    val platform by lazy { AndroidPlatform(this) }
    val session by lazy { Session(platform, HttpClient(OkHttp) { followRedirects = true }) }
    private val starting = Mutex()

    override fun onCreate() {
        super.onCreate()
        /* Kimono shows in the Files app only while signed in. */
        CoroutineScope(SupervisorJob() + Dispatchers.Main).launch {
            session.state.distinctUntilChangedBy { it is SessionState.SignedIn }.collect { KimonoDocuments.rootsChanged(this@KimonoApplication) }
        }
    }

    /**
     * Loads the saved sign-in when the process started for something other
     * than the app (the Files app, a background upload). True when signed in.
     */
    suspend fun ensureSession(): Boolean = starting.withLock {
        if (session.state.value is SessionState.Loading) session.start()
        session.state.value is SessionState.SignedIn
    }
}

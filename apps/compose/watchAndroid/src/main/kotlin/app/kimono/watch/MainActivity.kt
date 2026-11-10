package app.kimono.watch

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import app.kimono.watch.player.PlayerActivity
import app.kimono.watch.theme.WatchTheme
import app.kimono.watch.tv.AndroidTvShell

/** Browsing: Who's watching, Home, title pages, search. Playing opens [PlayerActivity]. */
class MainActivity : ComponentActivity() {
    private val resumed = mutableIntStateOf(0)
    /** A Kimono named by a kimono-watch://connect?server=… link (the Portal's "Get the app"). */
    private val connect = mutableStateOf<String?>(null)

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge(SystemBarStyle.dark(0), SystemBarStyle.dark(0))
        super.onCreate(savedInstanceState)
        connect.value = connectServer(intent)
        setContent {
            WatchTheme {
                WatchRoot(watch.services, resumed.intValue, connect.value, if (watch.tv) AndroidTvShell else null, launcher)
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        connectServer(intent)?.let { connect.value = it }
    }

    private fun connectServer(intent: Intent?): String? {
        val data = intent?.data ?: return null
        if (data.scheme != "kimono-watch" || data.host != "connect") return null
        val server = data.getQueryParameter("server")?.trim()?.trimEnd('/') ?: return null
        return server.takeIf { it.startsWith("https://") || it.startsWith("http://") } ?: "https://$server"
    }

    private val launcher = object : PlayerLauncher {
        override fun play(titleId: String, season: Int?, episode: Int?) = open(titleId, season, episode)
        override fun together(titleId: String, season: Int?, episode: Int?, at: Double) = open(titleId, season, episode) { putExtra("together", true).putExtra("at", at) }
        override fun join(partyId: String) = startActivity(Intent(this@MainActivity, PlayerActivity::class.java).putExtra("party", partyId))
    }

    private fun open(titleId: String, season: Int?, episode: Int?, extra: Intent.() -> Unit = {}) =
        startActivity(Intent(this, PlayerActivity::class.java).putExtra("titleId", titleId).putExtra("season", season ?: -1).putExtra("episode", episode ?: -1).apply(extra))

    private var paused = false
    override fun onPause() { super.onPause(); paused = true }
    override fun onResume() {
        super.onResume()
        if (paused) resumed.intValue++
        paused = false
    }
}

package app.kimono.watch

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.mutableIntStateOf
import app.kimono.watch.player.PlayerActivity
import app.kimono.watch.theme.WatchTheme

/** Browsing: Who's watching, Home, title pages, search. Playing opens [PlayerActivity]. */
class MainActivity : ComponentActivity() {
    private val resumed = mutableIntStateOf(0)

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge(SystemBarStyle.dark(0), SystemBarStyle.dark(0))
        super.onCreate(savedInstanceState)
        setContent {
            WatchTheme {
                WatchRoot(watch, resumed.intValue) { id, season, episode ->
                    startActivity(Intent(this, PlayerActivity::class.java).putExtra("titleId", id).putExtra("season", season ?: -1).putExtra("episode", episode ?: -1))
                }
            }
        }
    }

    private var paused = false
    override fun onPause() { super.onPause(); paused = true }
    override fun onResume() {
        super.onResume()
        if (paused) resumed.intValue++
        paused = false
    }
}

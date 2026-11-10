package app.kimono.watch.ios

import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.viewinterop.UIKitInteropProperties
import androidx.compose.ui.viewinterop.UIKitView
import app.kimono.watch.PreviewPlayer
import app.kimono.watch.data.WatchApi
import app.kimono.watch.model.PlayAnswer
import kotlinx.coroutines.delay

private val answers = mutableMapOf<String, PlayAnswer>()

/**
 * The hero's muted preview, as on Android: the title itself a little way in,
 * over its still once frames arrive, a minute of it on a loop.
 */
class IosPreview(private val host: IosWatchHost, private val api: WatchApi) : PreviewPlayer {
    @Composable
    override fun Show(titleId: String, season: Int, episode: Int, muted: Boolean, shown: Boolean, onPlaying: (Boolean) -> Unit, modifier: Modifier) {
        val active = shown && !WatchIos.playerUp.value
        var playing by remember(titleId) { mutableStateOf(false) }
        /* Past the seek into the episode: the cold open's first frames aren't shown. */
        var placed by remember(titleId) { mutableStateOf(false) }
        val player = remember(titleId) { host.makePlayer(preview = true) }
        DisposableEffect(player) {
            player.setEvents(object : IosPlayerEvents {
                override fun firstFrame() { playing = true; if (placed) onPlaying(true) }
                override fun error(decoder: Boolean, network: Boolean) { playing = false; onPlaying(false) }
                override fun tracks() {}
                override fun shape(ratio: Double) {}
                override fun playing(on: Boolean) {}
                override fun userPaused(paused: Boolean) {}
            })
            onDispose { player.setEvents(null); player.dispose(); onPlaying(false) }
        }
        LaunchedEffect(player, muted) { player.setMuted(muted) }
        LaunchedEffect(player, active) { if (active) player.play() else player.pause() }
        LaunchedEffect(player) {
            delay(2600)
            val answer = answers[titleId] ?: runCatching { api.play(titleId, season, episode) }.getOrNull()?.also { answers[titleId] = it } ?: return@LaunchedEffect
            player.load(answer.url, 0.0, false)
            var waited = 0
            while (player.state().duration <= 0 && waited < 300) { delay(100); waited++ }
            val duration = player.state().duration
            /* A clip this short is a source's error card, not the title: leave the still. */
            if (duration < 300) { player.pause(); return@LaunchedEffect }
            val from = duration * 0.17
            player.seek(from)
            if (active) player.play()
            delay(400)
            placed = true
            if (playing) onPlaying(true)
            while (true) {
                delay(1000)
                if (player.state().position > from + 64) player.seek(from)
            }
        }
        /* The native view sits behind Compose's canvas, through a hole: it goes in only once frames come, so the still shows until then. */
        if (playing && placed && active) UIKitView(factory = { player.view() }, modifier = modifier, properties = UIKitInteropProperties(isInteractive = false, isNativeAccessibilityEnabled = false))
    }
}

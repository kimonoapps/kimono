@file:OptIn(UnstableApi::class)

package app.kimono.watch.ui

import android.view.TextureView
import androidx.annotation.OptIn
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.viewinterop.AndroidView
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.trackselection.DefaultTrackSelector
import app.kimono.watch.model.PlayAnswer
import app.kimono.watch.watch
import kotlinx.coroutines.delay

private val answers = mutableMapOf<String, PlayAnswer>()

/**
 * The hero's muted preview: the title itself, a little way in, fading in over
 * its still once frames arrive and looping a minute of it. (The API has no
 * trailers; this plays the first episode, or the film, quietly.)
 */
object AndroidPreview : app.kimono.watch.PreviewPlayer {
    @Composable
    override fun Show(titleId: String, season: Int, episode: Int, muted: Boolean, active: Boolean, onPlaying: (Boolean) -> Unit, modifier: Modifier) = PreviewVideo(titleId, season, episode, muted, active, onPlaying, modifier)
}

@Composable
fun PreviewVideo(titleId: String, season: Int, episode: Int, muted: Boolean, active: Boolean, onPlaying: (Boolean) -> Unit, modifier: Modifier = Modifier) {
    val context = LocalContext.current
    var playing by remember(titleId) { mutableStateOf(false) }
    val alpha by animateFloatAsState(if (playing && active) 1f else 0f, tween(1200), label = "preview")
    val player = remember(titleId) {
        ExoPlayer.Builder(context).setTrackSelector(DefaultTrackSelector(context).apply {
            setParameters(buildUponParameters().setTrackTypeDisabled(C.TRACK_TYPE_TEXT, true).setMaxVideoSize(1280, 720))
        }).build().apply { volume = 0f; repeatMode = Player.REPEAT_MODE_OFF }
    }
    DisposableEffect(player) {
        val listener = object : Player.Listener {
            override fun onRenderedFirstFrame() { playing = true; onPlaying(true) }
            override fun onPlayerError(error: androidx.media3.common.PlaybackException) { playing = false; onPlaying(false) }
        }
        player.addListener(listener)
        onDispose { player.removeListener(listener); player.release(); onPlaying(false) }
    }
    LaunchedEffect(muted) { player.volume = if (muted) 0f else 1f }
    LaunchedEffect(active) { if (active) player.play() else player.pause() }
    LaunchedEffect(titleId) {
        delay(2600)
        val answer = answers[titleId] ?: runCatching { context.watch.api.play(titleId, season, episode) }.getOrNull()?.also { answers[titleId] = it } ?: return@LaunchedEffect
        player.setMediaItem(MediaItem.fromUri(answer.url))
        player.prepare()
        /* Past the cold open: about a sixth of the way in, then a minute of it, round again. */
        while (player.duration == C.TIME_UNSET) delay(100)
        /* A clip this short is a source's error card, not the title: leave the still. */
        if (player.duration < 300_000) { player.stop(); return@LaunchedEffect }
        val from = (player.duration * 0.17).toLong()
        player.seekTo(from)
        player.playWhenReady = active
        while (true) {
            delay(1000)
            if (player.currentPosition > from + 64_000) player.seekTo(from)
        }
    }
    AndroidView({ TextureView(it).also { v -> player.setVideoTextureView(v) } }, modifier.graphicsLayer { this.alpha = alpha })
}

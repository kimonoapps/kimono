@file:OptIn(UnstableApi::class)

package app.kimono.watch.player

import android.app.PictureInPictureParams
import android.content.res.Configuration
import android.os.Build
import android.os.Bundle
import android.util.Rational
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.annotation.OptIn
import androidx.compose.runtime.mutableStateOf
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.media3.common.Format
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.analytics.AnalyticsListener
import androidx.media3.session.MediaSession
import androidx.media3.ui.SubtitleView
import app.kimono.watch.theme.WatchTheme
import app.kimono.watch.ui.PlayerViewModel
import app.kimono.watch.watch
import kotlin.math.abs
import kotlin.math.roundToInt

/**
 * The player, on its own screen: landscape on a phone, picture-in-picture
 * when the person leaves mid-episode, and on TV the display switched to the
 * video's frame rate (24p films at 24 Hz) while it plays.
 */
class PlayerActivity : ComponentActivity() {
    private lateinit var engine: Engine
    private var session: MediaSession? = null
    private lateinit var vm: PlayerViewModel
    val pip = mutableStateOf(false)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        WindowInsetsControllerCompat(window, window.decorView).apply {
            hide(WindowInsetsCompat.Type.systemBars())
            systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        }
        val app = watch
        val titleId = intent.getStringExtra("titleId") ?: return finish()
        val season = intent.getIntExtra("season", -1).takeIf { it >= 0 }
        val episode = intent.getIntExtra("episode", -1).takeIf { it >= 0 }
        engine = Engine(this, app.tv, SubtitleView(this))
        session = runCatching { MediaSession.Builder(this, engine.player).build() }.getOrNull()
        vm = ViewModelProvider(this, object : ViewModelProvider.Factory {
            @Suppress("UNCHECKED_CAST")
            override fun <T : ViewModel> create(modelClass: Class<T>): T = PlayerViewModel(app.api, app.toasts, titleId) { t, s, e -> app.downloads.offline(t, s, e) } as T
        })[PlayerViewModel::class.java]
        if (savedInstanceState == null) vm.start(season, episode)
        if (app.tv) engine.player.addAnalyticsListener(object : AnalyticsListener {
            override fun onVideoInputFormatChanged(eventTime: AnalyticsListener.EventTime, format: Format, decoderReuseEvaluation: androidx.media3.exoplayer.DecoderReuseEvaluation?) { matchFrameRate(format) }
        })
        onRec = { id -> startActivity(android.content.Intent(this, PlayerActivity::class.java).putExtra("titleId", id)); finish() }
        setContent { WatchTheme { PlayerScreen(vm, engine, app.tv, pip.value, onExit = ::finish) } }
    }

    /** Switches the TV to a refresh rate the film's frame rate divides into, at the same resolution. */
    private fun matchFrameRate(format: Format) {
        val fps = format.frameRate.takeIf { it > 0 } ?: return
        val display = if (Build.VERSION.SDK_INT >= 30) display else @Suppress("DEPRECATION") windowManager.defaultDisplay
        display ?: return
        val now = display.mode
        val fits = display.supportedModes.filter { it.physicalWidth == now.physicalWidth && it.physicalHeight == now.physicalHeight }
        fun ratio(m: android.view.Display.Mode) = m.refreshRate / fps
        val best = fits.filter { abs(ratio(it) - ratio(it).roundToInt()) < 0.01f && ratio(it).roundToInt() >= 1 }
            .minByOrNull { ratio(it).roundToInt() } ?: return
        if (best.modeId != now.modeId) window.attributes = window.attributes.also { it.preferredDisplayModeId = best.modeId }
    }

    override fun onUserLeaveHint() {
        super.onUserLeaveHint()
        if (!watch.tv && engine.player.isPlaying && Build.VERSION.SDK_INT >= 26) {
            val size = engine.player.videoSize
            val ratio = if (size.width > 0 && size.height > 0) Rational(size.width, size.height) else Rational(16, 9)
            runCatching { enterPictureInPictureMode(PictureInPictureParams.Builder().setAspectRatio(clamp(ratio)).build()) }
        }
    }

    private fun clamp(r: Rational): Rational = when {
        r.toFloat() > 2.39f -> Rational(239, 100)
        r.toFloat() < 0.42f -> Rational(42, 100)
        else -> r
    }

    override fun onPictureInPictureModeChanged(isInPictureInPictureMode: Boolean, newConfig: Configuration) {
        super.onPictureInPictureModeChanged(isInPictureInPictureMode, newConfig)
        pip.value = isInPictureInPictureMode
    }

    override fun onStop() {
        super.onStop()
        val p = engine.player
        if (p.duration > 0) vm.save(p.currentPosition / 1000.0, p.duration / 1000.0)
        if (!pip.value) p.pause()
    }

    override fun onDestroy() {
        val p = engine.player
        if (p.duration > 0) vm.leave(p.currentPosition / 1000.0, p.duration / 1000.0)
        session?.release()
        engine.release()
        super.onDestroy()
    }
}

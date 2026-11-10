@file:OptIn(UnstableApi::class)

package app.kimono.watch.player

import android.app.PictureInPictureParams
import android.content.pm.ActivityInfo
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
import app.kimono.watch.LocalWatch
import app.kimono.watch.theme.WatchTheme
import app.kimono.watch.ui.PlayerViewModel
import app.kimono.watch.ui.TogetherViewModel
import app.kimono.watch.ink.InkLoader
import app.kimono.watch.model.WatchProblem
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.unit.dp
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.launch
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
        engine = Engine(this, app.tv, SubtitleView(this))
        session = runCatching { MediaSession.Builder(this, engine.player).build() }.getOrNull()
        /* Android 12 on: picture in picture as the person leaves, with the system's own animation, whenever it's playing. */
        if (!app.tv && Build.VERSION.SDK_INT >= 31) {
            pipParams(false)
            engine.player.addListener(object : androidx.media3.common.Player.Listener {
                override fun onIsPlayingChanged(isPlaying: Boolean) = pipParams(isPlaying)
                override fun onVideoSizeChanged(videoSize: androidx.media3.common.VideoSize) = pipParams(engine.player.isPlaying)
            })
        }
        if (app.tv) engine.player.addAnalyticsListener(object : AnalyticsListener {
            override fun onVideoInputFormatChanged(eventTime: AnalyticsListener.EventTime, format: Format, decoderReuseEvaluation: androidx.media3.exoplayer.DecoderReuseEvaluation?) { matchFrameRate(format) }
        })
        /* Kimono's loader while a party is started or joined. */
        setContent { WatchTheme { androidx.compose.foundation.layout.Box(androidx.compose.ui.Modifier.fillMaxSize().background(androidx.compose.ui.graphics.Color.Black), contentAlignment = androidx.compose.ui.Alignment.Center) { InkLoader(size = 56.dp) } } }
        lifecycleScope.launch {
            val partyId = intent.getStringExtra("party")
            var titleId = intent.getStringExtra("titleId")
            var season = intent.getIntExtra("season", -1).takeIf { it >= 0 }
            var episode = intent.getIntExtra("episode", -1).takeIf { it >= 0 }
            var party: String? = partyId
            try {
                if (partyId != null) {
                    val now = app.api.party(partyId)
                    titleId = now.state.timeline.titleId; season = now.state.timeline.season; episode = now.state.timeline.episode
                } else if (intent.getBooleanExtra("together", false) && titleId != null) {
                    val state = app.api.startParty(titleId, season ?: 0, episode ?: 0, intent.getDoubleExtra("at", 0.0), app.deviceId)
                    party = state.id; season = state.timeline.season; episode = state.timeline.episode
                }
            } catch (e: Exception) {
                app.toasts.show((e as? WatchProblem)?.message ?: "The party didn't start. Try again.")
                if (titleId == null || partyId != null) { finish(); return@launch }
                party = null
            }
            begin(titleId ?: return@launch finish(), season?.takeIf { it > 0 }, episode?.takeIf { it > 0 }, party, savedInstanceState == null)
        }
    }

    private var together: TogetherViewModel? = null

    private fun begin(titleId: String, season: Int?, episode: Int?, partyId: String?, fresh: Boolean) {
        val app = watch
        val provider = ViewModelProvider(this, object : ViewModelProvider.Factory {
            @Suppress("UNCHECKED_CAST")
            override fun <T : ViewModel> create(modelClass: Class<T>): T = when (modelClass) {
                TogetherViewModel::class.java -> TogetherViewModel(app.api, app.deviceId, partyId!!, app.accounts.active.value?.username.orEmpty())
                else -> PlayerViewModel(app.api, app.toasts, titleId) { t, s, e -> app.downloads.offline(t, s, e) }
            } as T
        })
        vm = provider[PlayerViewModel::class.java]
        together = partyId?.let { provider[TogetherViewModel::class.java] }
        if (fresh) vm.start(season, episode)
        val rec = { id: String -> startActivity(android.content.Intent(this, PlayerActivity::class.java).putExtra("titleId", id)); finish() }
        setContent { WatchTheme { androidx.compose.runtime.CompositionLocalProvider(LocalWatch provides app.services) {
            val ended by (together?.ended ?: kotlinx.coroutines.flow.MutableStateFlow(false)).collectAsState()
            androidx.compose.runtime.LaunchedEffect(ended) { if (ended) { app.toasts.show("The party has ended."); finish() } }
            PlayerScreen(vm, engine, app.tv, pip.value, onExit = ::finish, onRec = rec, party = together, rotate = if (app.tv) null else ::rotate,
                onTogether = { s, e, at -> startActivity(android.content.Intent(this, PlayerActivity::class.java).putExtra("titleId", titleId).putExtra("season", s ?: 0).putExtra("episode", e ?: 0).putExtra("together", true).putExtra("at", at)); finish() })
        } } }
    }

    /** Upright, or back on its side; each way follows the sensor within it. */
    private fun rotate() {
        requestedOrientation = if (requestedOrientation == ActivityInfo.SCREEN_ORIENTATION_SENSOR_PORTRAIT) ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
            else ActivityInfo.SCREEN_ORIENTATION_SENSOR_PORTRAIT
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

    private fun ratio(): Rational {
        val size = engine.player.videoSize
        return clamp(if (size.width > 0 && size.height > 0) Rational(size.width, size.height) else Rational(16, 9))
    }

    @androidx.annotation.RequiresApi(31)
    private fun pipParams(auto: Boolean) {
        runCatching { setPictureInPictureParams(PictureInPictureParams.Builder().setAspectRatio(ratio()).setAutoEnterEnabled(auto).setSeamlessResizeEnabled(true).build()) }
    }

    override fun onUserLeaveHint() {
        super.onUserLeaveHint()
        /* Before Android 12 there's no auto-enter: ask as the person leaves. */
        if (!watch.tv && engine.player.isPlaying && Build.VERSION.SDK_INT in 26..30) {
            runCatching { enterPictureInPictureMode(PictureInPictureParams.Builder().setAspectRatio(ratio()).build()) }
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
        if (::vm.isInitialized && p.duration > 0) vm.save(p.currentPosition / 1000.0, p.duration / 1000.0)
        if (!pip.value) p.pause()
    }

    override fun onDestroy() {
        val p = engine.player
        if (::vm.isInitialized && p.duration > 0) vm.leave(p.currentPosition / 1000.0, p.duration / 1000.0)
        if (isFinishing) together?.leave()
        session?.release()
        engine.release()
        super.onDestroy()
    }
}

package app.kimono.watch.ios

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.UIKitInteropProperties
import androidx.compose.ui.viewinterop.UIKitView
import androidx.compose.ui.window.ComposeUIViewController
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.ViewModelStore
import app.kimono.watch.LocalWatch
import app.kimono.watch.WatchServices
import app.kimono.watch.ink.InkLoader
import app.kimono.watch.model.WatchProblem
import app.kimono.watch.player.PlayerScreen
import app.kimono.watch.theme.WatchTheme
import app.kimono.watch.ui.I
import app.kimono.watch.ui.PlayerViewModel
import app.kimono.watch.ui.TogetherViewModel
import app.kimono.watch.ui.clickableScale
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import platform.UIKit.UIViewController

/** What to play: a title (from where Resume points, or an episode), a new party on it, or a party to join. */
internal data class PlayerStart(
    val titleId: String?,
    val season: Int?,
    val episode: Int?,
    val together: Boolean = false,
    val at: Double = 0.0,
    val party: String? = null,
)

private val pipIcon = ImageVector.Builder(defaultWidth = 24.dp, defaultHeight = 24.dp, viewportWidth = 24f, viewportHeight = 24f)
    .addPath(PathParser().parsePathString("M19 11h-8v6h8v-6zm4 8V4.98C23 3.88 22.1 3 21 3H3c-1.1 0-2 .88-2 1.98V19c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2zm-2 .02H3V4.97h18v14.05z").toNodes(), fill = SolidColor(Color.White)).build()

/**
 * One time in the player, as Android's PlayerActivity: starts or joins the
 * party, holds the view models, tells the Portal where playback is when the
 * app goes away or the player closes, and fills the lock screen.
 */
internal class PlayerSession(private val host: IosWatchHost, private val services: WatchServices, private val start: PlayerStart) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private val store = ViewModelStore()
    private val player = host.makePlayer(preview = false)
    private val engine = IosEngine(player)
    private var vm: PlayerViewModel? = null
    private var together: TogetherViewModel? = null
    private var closed = false
    private val ready = MutableStateFlow(false)

    private inline fun <reified T : ViewModel> provide(crossinline create: () -> T): T = ViewModelProvider.create(store, object : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST") override fun <V : ViewModel> create(modelClass: kotlin.reflect.KClass<V>, extras: androidx.lifecycle.viewmodel.CreationExtras): V = create() as V
    })[T::class]

    init {
        /* AirPlay and picture in picture play the Portal's HLS rendition of this same episode. */
        player.setHlsSource(object : IosHlsSource {
            override fun ask(done: (String?) -> Unit) {
                val v = vm ?: return done(null)
                val s = v.state.value
                scope.launch {
                    val hls = runCatching { services.api.play(v.titleId, s.season, s.episode, cast = "airplay").hls }.getOrNull()
                    val server = services.accounts.active.value?.server.orEmpty()
                    done(hls?.let { if (it.startsWith("http")) it else server + it })
                }
            }
        })
        scope.launch { begin() }
    }

    private suspend fun begin() {
        val api = services.api
        var titleId = start.titleId
        var season = start.season?.takeIf { it >= 0 }
        var episode = start.episode?.takeIf { it >= 0 }
        var party: String? = start.party
        try {
            if (start.party != null) {
                val now = api.party(start.party)
                titleId = now.state.timeline.titleId; season = now.state.timeline.season; episode = now.state.timeline.episode
            } else if (start.together && titleId != null) {
                val state = api.startParty(titleId, season ?: 0, episode ?: 0, start.at, services.deviceId)
                party = state.id; season = state.timeline.season; episode = state.timeline.episode
            }
        } catch (e: Exception) {
            services.toasts.show((e as? WatchProblem)?.message ?: "The party didn't start. Try again.")
            if (titleId == null || start.party != null) { close(); return }
            party = null
        }
        val id = titleId ?: return close()
        val me = services.accounts.active.value?.username.orEmpty()
        vm = provide { PlayerViewModel(api, services.toasts, id) { t, s, e -> services.downloads.offline(t, s, e) } }
        together = party?.let { p -> provide { TogetherViewModel(api, services.deviceId, p, me) } }
        vm?.start(season?.takeIf { it > 0 }, episode?.takeIf { it > 0 })
        ready.value = true
    }

    fun controller(): UIViewController = ComposeUIViewController {
        WatchTheme {
            CompositionLocalProvider(LocalWatch provides services) {
                val on by ready.collectAsState()
                val v = vm
                if (!on || v == null) {
                    /* Kimono's loader while a party is started or joined. */
                    Box(Modifier.fillMaxSize().background(Color.Black), contentAlignment = Alignment.Center) { InkLoader(size = 56.dp) }
                } else {
                    Playing(v)
                }
            }
        }
    }

    @Composable
    private fun Playing(v: PlayerViewModel) {
        val party = together
        val ended by (party?.ended ?: MutableStateFlow(false)).collectAsState()
        LaunchedEffect(ended) { if (ended) { services.toasts.show("The party has ended."); close() } }
        val state by v.state.collectAsState()
        /* The lock screen and Control Center: the title, the episode, its still. */
        LaunchedEffect(state.page, state.season, state.episode) {
            val page = state.page ?: return@LaunchedEffect
            val ep = state.current
            val line = if (page.title.isFilm || ep == null) page.title.year?.toString().orEmpty() else "${state.label} · ${ep.name}"
            player.nowPlaying(page.title.name, line, ep?.still ?: page.title.backdrop ?: page.title.poster)
        }
        var pip by androidx.compose.runtime.remember { mutableStateOf(false) }
        LaunchedEffect(Unit) { while (isActive) { pip = engine.pip; delay(300) } }
        PlayerScreen(v, engine, tv = false, pip = pip, onExit = { close() }, onRec = { id -> close(); WatchIos.openPlayer(PlayerStart(id, null, null)) }, party = party, corner = { Corner() }, rotate = { host.rotatePlayer() },
            onTogether = { s, e, at -> close(); WatchIos.openPlayer(PlayerStart(v.titleId, s, e, together = true, at = at)) },
            onJoinParty = { id -> close(); WatchIos.openPlayer(PlayerStart(null, null, null, party = id)) })
    }

    /** AirPlay (AVRoutePickerView) and picture in picture. */
    @Composable
    private fun Corner() {
        Row {
            if (player.canPip()) Box(Modifier.size(48.dp).clip(CircleShape).clickableScale({ player.startPip() }, focusScale = 1.08f), contentAlignment = Alignment.Center) { I(pipIcon, 24.dp, Color.White) }
            UIKitView(factory = { player.routeButton() }, modifier = Modifier.size(48.dp), properties = UIKitInteropProperties(isInteractive = true, isNativeAccessibilityEnabled = true))
        }
    }

    /** Tells the Portal where playback is (the app going away). */
    fun save() {
        val s = player.state()
        if (s.duration > 0) vm?.save(s.position, s.duration)
    }

    fun close(dismiss: Boolean = true) {
        if (closed) return
        closed = true
        val s = player.state()
        if (s.duration > 0) vm?.leave(s.position, s.duration)
        together?.leave()
        player.setHlsSource(null)
        player.dispose()
        store.clear()
        scope.cancel()
        if (WatchIos.playing === this) WatchIos.playing = null
        if (dismiss) host.dismissPlayer()
    }
}

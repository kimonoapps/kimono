@file:OptIn(UnstableApi::class)

package app.kimono.watch.player

import android.view.KeyEvent
import android.view.SurfaceView
import androidx.annotation.OptIn
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.focusable
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.wrapContentSize
import androidx.compose.foundation.layout.requiredSize
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableDoubleStateOf
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.nativeKeyCode
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.media3.common.C
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.Tracks
import androidx.media3.common.util.UnstableApi
import app.kimono.watch.theme.Night
import app.kimono.watch.theme.display
import app.kimono.watch.theme.ui
import app.kimono.watch.ui.I
import app.kimono.watch.ui.Ic
import app.kimono.watch.ui.Img
import app.kimono.watch.ui.Logo
import app.kimono.watch.ui.PaperButton
import app.kimono.watch.ui.PlayerViewModel
import app.kimono.watch.ui.Post
import app.kimono.watch.ui.WavyRing
import app.kimono.watch.ui.clickableScale
import app.kimono.watch.ui.clock
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlin.math.abs

private enum class Sheet { Tracks, Speed, Episodes }

/**
 * The player's chrome over the picture, from the demo: auto-hiding
 * controls, the scrubber with thumbnails and the intro and credits marked,
 * skip intro and recap, double-tap ±10 s, the sheets, "You're watching" on a
 * long pause, the next-up corner, the filler question and the end card. On
 * TV the D-pad drives it: left/right seek, hold to scrub, OK pauses.
 */
@Composable
fun PlayerScreen(vm: PlayerViewModel, engine: Engine, tv: Boolean, pip: Boolean, onExit: () -> Unit) {
    val state by vm.state.collectAsState()
    val player = engine.player
    val scope = rememberCoroutineScope()

    var position by remember { mutableDoubleStateOf(0.0) }
    var duration by remember { mutableDoubleStateOf(0.0) }
    var buffered by remember { mutableDoubleStateOf(0.0) }
    var playing by remember { mutableStateOf(false) }
    var buffering by remember { mutableStateOf(false) }
    var aspect by remember { mutableFloatStateOf(16f / 9f) }
    var ctl by remember { mutableStateOf(true) }
    var poke by remember { mutableIntStateOf(0) }
    var sheet by remember { mutableStateOf<Sheet?>(null) }
    var scrub by remember { mutableStateOf<Double?>(null) }
    var speed by remember { mutableFloatStateOf(1f) }
    var ripple by remember { mutableStateOf<Pair<Boolean, Int>?>(null) }
    var pausedAt by remember { mutableLongStateOf(0L) }
    var pauseCard by remember { mutableStateOf(false) }
    var tracksVersion by remember { mutableIntStateOf(0) }
    var hinted by remember { mutableIntStateOf(-1) }
    var focusScrub by remember { mutableIntStateOf(0) }

    fun show(hold: Boolean = false) { ctl = true; poke++; if (hold) poke = -kotlin.math.abs(poke) - 1 }
    fun seekBy(d: Double) { player.seekTo(((position + d).coerceIn(0.0, duration.coerceAtLeast(0.0)) * 1000).toLong()); position = (position + d).coerceIn(0.0, duration) }
    fun seekTo(s: Double) { player.seekTo((s * 1000).toLong()); position = s }
    fun toggle() { if (player.isPlaying) player.pause() else player.play() }
    fun rip(right: Boolean) { ripple = right to ((ripple?.second ?: 0) + 1) }

    /* A new stream to load. */
    LaunchedEffect(state.loads) {
        val answer = state.answer ?: return@LaunchedEffect
        if (state.loads == 0) return@LaunchedEffect
        engine.load(answer.url, Downloads.key(vm.titleId, state.season, state.episode), state.startAt)
        player.setPlaybackSpeed(speed)
        sheet = null
    }
    DisposableEffect(player) {
        val l = object : Player.Listener {
            override fun onRenderedFirstFrame() { vm.started() }
            override fun onPlayerError(error: PlaybackException) {
                /* A version this device can't decode: quietly try the next one. */
                if (error.errorCode in 4000..4999 && vm.fallback(player.currentPosition / 1000.0)) return
                vm.failed(if (error.errorCode in 2000..2999) "The stream stopped answering. Try again." else "This version won't play here. Try another.")
            }
            override fun onTracksChanged(tracks: Tracks) {
                tracksVersion++
                val answer = vm.state.value.answer ?: return
                if (hinted != vm.state.value.loads && tracks.groups.isNotEmpty()) {
                    hinted = vm.state.value.loads
                    if (engine.videoBeyondDecoders() && vm.fallback(player.currentPosition / 1000.0)) return
                    engine.applyHints(answer.tracks)
                }
            }
            override fun onVideoSizeChanged(videoSize: androidx.media3.common.VideoSize) {
                if (videoSize.width > 0 && videoSize.height > 0) aspect = videoSize.width * videoSize.pixelWidthHeightRatio / videoSize.height
            }
            override fun onIsPlayingChanged(isPlaying: Boolean) { playing = isPlaying }
            /* Paused by the person (not a buffering stall): the controls come up, and "You're watching" later. */
            override fun onPlayWhenReadyChanged(playWhenReady: Boolean, reason: Int) {
                if (!playWhenReady) { pausedAt = System.currentTimeMillis(); show() } else { pausedAt = 0; pauseCard = false }
            }
        }
        player.addListener(l)
        onDispose { player.removeListener(l) }
    }
    /* Where playback is, four times a second. */
    LaunchedEffect(Unit) {
        while (isActive) {
            position = player.currentPosition / 1000.0
            duration = player.duration.takeIf { it != C.TIME_UNSET }?.div(1000.0) ?: 0.0
            buffered = player.bufferedPosition / 1000.0
            buffering = player.playbackState == Player.STATE_BUFFERING
            vm.tick(position, duration, player.isPlaying)?.let { seekTo(it) }
            if (player.playbackState == Player.STATE_ENDED) {
                when (vm.state.value.post) {
                    is Post.Next -> if (vm.state.value.answer?.autoplayNext != false) vm.playNext()
                    else -> {}
                }
            }
            /* "You're watching" after five seconds paused. */
            if (pausedAt > 0 && !player.playWhenReady && System.currentTimeMillis() - pausedAt > 5000 && sheet == null && vm.state.value.post == Post.None && !state.loading) { pauseCard = true; ctl = false }
            delay(250)
        }
    }
    /* The controls hide after a few seconds of nothing, unless paused or a sheet is open. */
    LaunchedEffect(poke, playing, sheet, scrub) {
        if (poke < 0 || !playing || sheet != null || scrub != null) return@LaunchedEffect
        delay(3200)
        ctl = false
    }

    val focusRoot = remember { FocusRequester() }
    val playFocus = remember { FocusRequester() }
    val scrubFocus = remember { FocusRequester() }
    var holdStart by remember { mutableLongStateOf(0L) }
    val post = state.post
    val end = post == Post.End

    Box(Modifier.fillMaxSize().background(Color.Black).focusRequester(focusRoot).focusable()
        .onPreviewKeyEvent { e ->
            val code = e.key.nativeKeyCode
            val down = e.type == KeyEventType.KeyDown
            if (!down && e.type != KeyEventType.KeyUp) return@onPreviewKeyEvent false
            when (code) {
                KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE, KeyEvent.KEYCODE_SPACE -> { if (down) { toggle(); show() }; true }
                KeyEvent.KEYCODE_MEDIA_PLAY -> { if (down) { player.play(); show() }; true }
                KeyEvent.KEYCODE_MEDIA_PAUSE -> { if (down) { player.pause(); show() }; true }
                KeyEvent.KEYCODE_MEDIA_FAST_FORWARD -> { if (down) { seekBy(10.0); rip(true) }; true }
                KeyEvent.KEYCODE_MEDIA_REWIND -> { if (down) { seekBy(-10.0); rip(false) }; true }
                KeyEvent.KEYCODE_MEDIA_NEXT -> { if (down) vm.playNext(); true }
                KeyEvent.KEYCODE_MEDIA_STOP -> { if (down) onExit(); true }
                KeyEvent.KEYCODE_BACK, KeyEvent.KEYCODE_ESCAPE -> {
                    if (!down) return@onPreviewKeyEvent true
                    when {
                        sheet != null -> { sheet = null; show() }
                        scrub != null -> scrub = null
                        ctl && tv && post == Post.None -> ctl = false
                        else -> onExit()
                    }
                    true
                }
                KeyEvent.KEYCODE_DPAD_LEFT, KeyEvent.KEYCODE_DPAD_RIGHT -> {
                    /* Hidden controls: tap to seek ten seconds, hold to scrub. */
                    if (!tv || ctl || post != Post.None || state.loading) return@onPreviewKeyEvent false
                    val right = code == KeyEvent.KEYCODE_DPAD_RIGHT
                    if (down) {
                        if (e.nativeKeyEvent.repeatCount == 0) { holdStart = System.currentTimeMillis(); seekBy(if (right) 10.0 else -10.0); rip(right) }
                        else {
                            val held = (System.currentTimeMillis() - holdStart) / 1000.0
                            val step = if (held > 4) 60.0 else if (held > 2) 30.0 else 10.0
                            scrub = ((scrub ?: position) + if (right) step else -step).coerceIn(0.0, duration)
                        }
                    } else scrub?.let { seekTo(it); scrub = null }
                    true
                }
                KeyEvent.KEYCODE_DPAD_CENTER, KeyEvent.KEYCODE_ENTER, KeyEvent.KEYCODE_NUMPAD_ENTER -> {
                    if (!tv || ctl || post != Post.None) { if (down) show(); return@onPreviewKeyEvent false }
                    val offer = state.skip
                    if (offer != null) { if (down) seekTo(offer.to); return@onPreviewKeyEvent true }
                    if (down) { toggle(); show(); scope.launch { delay(50); runCatching { playFocus.requestFocus() } } }
                    true
                }
                KeyEvent.KEYCODE_DPAD_UP, KeyEvent.KEYCODE_DPAD_DOWN -> {
                    if (!tv) return@onPreviewKeyEvent false
                    if (!ctl && post == Post.None) { if (down) { show(); focusScrub++ }; true }
                    else { if (down) show(); false }
                }
                else -> { if (down) show(); false }
            }
        }
        .pointerInput(tv) {
            if (tv) return@pointerInput
            detectTapGestures(
                onDoubleTap = { o ->
                    val third = size.width / 3f
                    when {
                        o.x < third * 1.14f -> { seekBy(-10.0); rip(false) }
                        o.x > third * 1.86f -> { seekBy(10.0); rip(true) }
                        else -> toggle()
                    }
                },
                onTap = { if (pauseCard) pauseCard = false else if (ctl && sheet == null) ctl = false else { sheet = null; show() } },
            )
        }) {

        /* The picture, fitted; at the end card it moves to the top corner. */
        BoxWithConstraints(Modifier.fillMaxSize()) {
            val small = end && !pip
            val w by animateDpAsState(if (small) maxWidth * (if (maxWidth < maxHeight) 0.55f else 0.3f) else maxWidth, tween(700), label = "w")
            val h by animateDpAsState(if (small) w / aspect else maxHeight, tween(700), label = "h")
            val x by animateDpAsState(if (small) 24.dp else 0.dp, tween(700), label = "x")
            val y by animateDpAsState(if (small) (if (maxWidth < maxHeight) 70.dp else 24.dp) else 0.dp, tween(700), label = "y")
            Box(Modifier.offset(x, y).size(w, h).clip(RoundedCornerShape(if (small) 10.dp else 0.dp)).then(if (small) Modifier.border(2.dp, Color(0x4DFFFFFF), RoundedCornerShape(10.dp)) else Modifier), contentAlignment = Alignment.Center) {
                Box(Modifier.aspectRatio(aspect, matchHeightConstraintsFirst = w / h > aspect).fillMaxSize()) {
                    AndroidView({ SurfaceView(it).also { v -> player.setVideoSurfaceView(v) } }, Modifier.fillMaxSize())
                    if (!small) {
                        val lift by animateDpAsState(if (ctl && !pip) 70.dp else 0.dp, tween(300), label = "lift")
                        AndroidView({ engine.subtitles }, Modifier.fillMaxSize().padding(bottom = lift).alpha(if (post is Post.Next || post is Post.Ask) 0f else 1f))
                    }
                }
            }
        }
        if (pip) return@Box

        /* Shade behind the chrome. */
        val chrome by animateFloatAsState(if (ctl && post == Post.None) 1f else 0f, tween(300), label = "chrome")
        Box(Modifier.fillMaxSize().alpha(chrome).background(Brush.verticalGradient(0f to Color(0xA6000000), 0.22f to Color.Transparent, 0.62f to Color.Transparent, 1f to Color(0xCC000000))))

        Ripple(ripple, Modifier.fillMaxSize())

        if (buffering && !state.loading && post == Post.None) WavyRing(72.dp, Night.suo, amp = 2.6f, modifier = Modifier.align(Alignment.Center))

        PauseCard(pauseCard && post == Post.None, state, Modifier.fillMaxSize())

        /* Top: back and what's on. */
        val name = state.page?.title?.name ?: ""
        val ep = state.current
        Row(Modifier.fillMaxWidth().alpha(if (state.loading) 1f else chrome).padding(top = 14.dp, start = 20.dp, end = 20.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            PBtn(Ic.back, onExit, enabled = chrome > 0.5f || state.loading)
            Text(androidx.compose.ui.text.buildAnnotatedString {
                pushStyle(androidx.compose.ui.text.SpanStyle(color = Night.fg, fontWeight = FontWeight.Bold)); append(name); pop()
                if (!state.isFilm && ep != null) append("  E${state.episode} · ${ep.name}")
            }, style = ui(15, color = Night.fg2), modifier = Modifier.weight(1f), textAlign = TextAlign.Center, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Spacer(Modifier.size(48.dp))
        }

        if (!state.loading && chrome > 0.01f) {
            /* Middle (phone): back ten, play, forward ten. */
            if (!tv) Row(Modifier.align(Alignment.Center).alpha(chrome), horizontalArrangement = Arrangement.spacedBy(64.dp), verticalAlignment = Alignment.CenterVertically) {
                SeekBtn(false) { seekBy(-10.0); rip(false); show() }
                PBtn(if (playing) Ic.pause else Ic.play, { toggle(); show() }, size = 76.dp, iconSize = 52.dp)
                SeekBtn(true) { seekBy(10.0); rip(true); show() }
            }
            /* Bottom: the scrubber, then the buttons. */
            Column(Modifier.align(Alignment.BottomCenter).fillMaxWidth().alpha(chrome).padding(start = 20.dp, end = 20.dp, bottom = 14.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                LaunchedEffect(focusScrub) { if (focusScrub > 0) { delay(30); runCatching { scrubFocus.requestFocus() } } }
                Scrubber(position, duration, buffered, scrub, state, engine, tv, scrubFocus,
                    onScrub = { scrub = it; show(hold = true) }, onCommit = { scrub?.let { seekTo(it) }; scrub = null; show() })
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = if (tv) Arrangement.spacedBy(6.dp) else Arrangement.SpaceAround, modifier = Modifier.fillMaxWidth()) {
                    if (tv) {
                        PBtn(if (playing) Ic.pause else Ic.play, { toggle(); show() }, focus = playFocus)
                        SeekBtn(false, small = true) { seekBy(-10.0); show() }
                        SeekBtn(true, small = true) { seekBy(10.0); show() }
                        Text(androidx.compose.ui.text.buildAnnotatedString {
                            pushStyle(androidx.compose.ui.text.SpanStyle(color = Night.fg, fontWeight = FontWeight.Bold)); append(name); pop()
                            if (!state.isFilm && ep != null) append("   S${state.season}:E${state.episode} “${ep.name}”")
                        }, style = ui(15, color = Night.fg2), modifier = Modifier.weight(1f), textAlign = TextAlign.Center, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                    LabBtn(Ic.speed, "Speed", tv) { sheet = if (sheet == Sheet.Speed) null else Sheet.Speed; show() }
                    if (!state.isFilm) LabBtn(Ic.eps, "Episodes", tv) { sheet = if (sheet == Sheet.Episodes) null else Sheet.Episodes; show() }
                    LabBtn(Ic.cc, "Audio & subtitles", tv) { sheet = if (sheet == Sheet.Tracks) null else Sheet.Tracks; show() }
                    if (state.answer?.next != null) LabBtn(Ic.next, "Next episode", tv) { vm.playNext() }
                }
            }
        }

        /* Skip intro / Skip recap, filling as the part runs. */
        val skip = state.skip
        AnimatedVisibility(skip != null && !state.loading && post == Post.None, Modifier.align(Alignment.BottomEnd).padding(end = 28.dp, bottom = 120.dp),
            enter = fadeIn(tween(300)) + slideInVertically(spring(dampingRatio = 0.6f)) { it / 4 }, exit = fadeOut(tween(300))) {
            val s = skip ?: return@AnimatedVisibility
            val focus = remember { FocusRequester() }
            PaperButton(s.label, Ic.next, { seekTo(s.to); show() }, Modifier.focusRequester(focus).widthIn(min = 150.dp), height = 48.dp, fill = s.progress)
            LaunchedEffect(Unit) { if (tv && !ctl) runCatching { focus.requestFocus() } }
        }

        AnimatedVisibility(sheet != null, Modifier.align(Alignment.BottomEnd).padding(end = 20.dp, bottom = 90.dp),
            enter = fadeIn(tween(200)) + slideInVertically(spring(dampingRatio = 0.7f)) { it / 10 }, exit = fadeOut(tween(200))) {
            PlayerSheet(sheet, vm, engine, tracksVersion, speed, { speed = it; player.setPlaybackSpeed(it) }, position, { sheet = null; show() })
        }

        when (post) {
            is Post.Next -> NextUp(vm, post, buffering || !playing, ctl, tv)
            is Post.Ask -> FillerAsk(vm, post, tv)
            Post.End -> EndCard(vm, state, onExit, tv)
            Post.None -> {}
        }

        Loading(state, vm, onExit)
    }
    LaunchedEffect(Unit) { runCatching { focusRoot.requestFocus() } }
    LaunchedEffect(ctl, tv) { if (tv && !ctl) runCatching { focusRoot.requestFocus() } }
}

@Composable
private fun PBtn(icon: ImageVector, onClick: () -> Unit, size: Dp = 48.dp, iconSize: Dp = 28.dp, enabled: Boolean = true, focus: FocusRequester? = null) {
    Box(Modifier.size(size).then(if (focus != null) Modifier.focusRequester(focus) else Modifier).clip(CircleShape).clickableScale({ if (enabled) onClick() }, focusScale = 1.08f), contentAlignment = Alignment.Center) { I(icon, iconSize, Color.White) }
}

@Composable
private fun SeekBtn(forward: Boolean, small: Boolean = false, onClick: () -> Unit) {
    Box(Modifier.size(48.dp).clip(CircleShape).clickableScale(onClick, focusScale = 1.08f), contentAlignment = Alignment.Center) {
        I(if (forward) Ic.ff else Ic.rw, 28.dp, Color.White)
        Text("10", style = ui(9, FontWeight.Bold, Color.White), modifier = Modifier.padding(top = 2.dp))
    }
}

/** A labelled control (phone), or an icon (TV, as on wide screens in the demo). */
@Composable
private fun LabBtn(icon: ImageVector, label: String, tv: Boolean, onClick: () -> Unit) {
    val source = remember { MutableInteractionSource() }
    val focused by source.collectIsFocusedAsState()
    Box {
        Row(Modifier.height(48.dp).clip(RoundedCornerShape(10.dp)).clickableScale(onClick, focusScale = 1.08f).padding(horizontal = 10.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            I(icon, if (tv) 28.dp else 22.dp, Color.White)
            if (!tv) Text(label, style = ui(13, color = Color.White))
        }
    }
}

@Composable
private fun Ripple(ripple: Pair<Boolean, Int>?, modifier: Modifier) {
    val a = remember { Animatable(0f) }
    LaunchedEffect(ripple) { if (ripple != null) { a.snapTo(1f); a.animateTo(0f, tween(600)) } }
    val right = ripple?.first ?: false
    BoxWithConstraints(modifier) {
        if (a.value > 0f) Box(Modifier.align(if (right) Alignment.CenterEnd else Alignment.CenterStart).width(maxWidth * 0.38f).fillMaxHeight()
            .alpha(a.value).clip(if (right) RoundedCornerShape(topStartPercent = 50, bottomStartPercent = 50) else RoundedCornerShape(topEndPercent = 50, bottomEndPercent = 50))
            .background(Color.White.copy(alpha = 0.12f * a.value)), contentAlignment = Alignment.Center) {
            Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(4.dp)) {
                I(if (right) Ic.ff else Ic.rw, 28.dp, Color.White)
                Text("10 seconds", style = ui(13, FontWeight.Bold, Color.White))
            }
        }
    }
}

/** The track with buffered, played, the intro and credits marked, the knob, and a thumbnail while scrubbing. */
@Composable
private fun Scrubber(position: Double, duration: Double, buffered: Double, scrub: Double?, state: app.kimono.watch.ui.PlayerState, engine: Engine, tv: Boolean, focus: FocusRequester, onScrub: (Double) -> Unit, onCommit: () -> Unit) {
    val d = duration.coerceAtLeast(1.0)
    var width by remember { mutableIntStateOf(1) }
    val source = remember { MutableInteractionSource() }
    val focused by source.collectIsFocusedAsState()
    val shown = scrub ?: position
    val active = scrub != null || focused
    val thick by animateDpAsState(if (active) 7.dp else 4.dp, tween(150), label = "t")
    val knob by animateFloatAsState(if (active) 1.25f else 0.85f, tween(150), label = "k")
    val markers = state.answer?.markers
    val thumbs = remember(state.answer?.url) { state.answer?.url?.let { Thumbs(it) } }
    DisposableEffect(thumbs) { onDispose { thumbs?.close() } }
    val frame by (thumbs?.frame ?: kotlinx.coroutines.flow.MutableStateFlow(null)).collectAsState()
    LaunchedEffect(scrub) { scrub?.let { thumbs?.want(it) } }
    var holdAt by remember { mutableLongStateOf(0L) }
    /* Read live in the key handler: several presses can land before the next frame. */
    val live = remember { mutableStateOf<Double?>(null) }
    LaunchedEffect(scrub) { live.value = scrub }
    Row(Modifier.fillMaxWidth().height(28.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
        Box(Modifier.weight(1f).height(28.dp).onSizeChanged { width = it.width }
            .focusRequester(focus).focusable(interactionSource = source)
            .onPreviewKeyEvent { e ->
                val code = e.key.nativeKeyCode
                if (code != KeyEvent.KEYCODE_DPAD_LEFT && code != KeyEvent.KEYCODE_DPAD_RIGHT && code != KeyEvent.KEYCODE_DPAD_CENTER && code != KeyEvent.KEYCODE_ENTER) return@onPreviewKeyEvent false
                if (code == KeyEvent.KEYCODE_DPAD_CENTER || code == KeyEvent.KEYCODE_ENTER) { if (e.type == KeyEventType.KeyUp && live.value != null) { live.value = null; onCommit() }; return@onPreviewKeyEvent true }
                if (e.type == KeyEventType.KeyDown) {
                    if (e.nativeKeyEvent.repeatCount == 0) holdAt = System.currentTimeMillis()
                    val held = (System.currentTimeMillis() - holdAt) / 1000.0
                    val step = if (held > 4) 60.0 else if (held > 2) 30.0 else 10.0
                    val next = ((live.value ?: position) + if (code == KeyEvent.KEYCODE_DPAD_RIGHT) step else -step).coerceIn(0.0, duration)
                    live.value = next
                    onScrub(next)
                } else if (e.type == KeyEventType.KeyUp && e.nativeKeyEvent.repeatCount == 0) {
                    /* Let go: a short wait so a few taps add up before it seeks. */
                }
                true
            }
            .pointerInput(duration) {
                /* Press anywhere on the track, drag, let go: it seeks where the finger left it. */
                awaitEachGesture {
                    val down = awaitFirstDown()
                    down.consume()
                    onScrub((down.position.x / width).coerceIn(0f, 1f) * duration)
                    while (true) {
                        val event = awaitPointerEvent()
                        val change = event.changes.firstOrNull { it.id == down.id } ?: break
                        if (!change.pressed) { change.consume(); break }
                        change.consume()
                        onScrub((change.position.x / width).coerceIn(0f, 1f) * duration)
                    }
                    onCommit()
                }
            }, contentAlignment = Alignment.CenterStart) {
            Box(Modifier.fillMaxWidth().height(thick).clip(RoundedCornerShape(2.dp)).background(Color(0x40FFFFFF)).drawBehind {
                drawRect(Color(0x59FFFFFF), size = size.copy(width = size.width * (buffered / d).toFloat().coerceIn(0f, 1f)))
                drawRect(Night.suo, size = size.copy(width = size.width * (shown / d).toFloat().coerceIn(0f, 1f)))
                /* The intro and credits, cut into the track. */
                fun seg(a: Double, b: Double) {
                    val x0 = (a / d * size.width).toFloat(); val x1 = (b / d * size.width).toFloat()
                    drawRect(Color.Black, Offset(x0, 0f), androidx.compose.ui.geometry.Size(2.dp.toPx(), size.height))
                    drawRect(Color.Black, Offset(x1 - 2.dp.toPx(), 0f), androidx.compose.ui.geometry.Size(2.dp.toPx(), size.height))
                }
                markers?.intro?.takeIf { it.size == 2 }?.let { seg(it[0], it[1]) }
                markers?.recap?.takeIf { it.size == 2 }?.let { seg(it[0], it[1]) }
                markers?.credits?.let { seg(it, d) }
            })
            val px = with(LocalDensity.current) { (width * (shown / d)).toFloat().toDp() }
            Box(Modifier.offset(x = px - 8.dp).size(16.dp).graphicsLayerScale(knob).clip(CircleShape).background(Night.suo))
            if (scrub != null) {
                val half = 96.dp
                val maxX = with(LocalDensity.current) { width.toDp() }
                Column(Modifier.offset(x = (px - half).coerceIn(-8.dp, maxX - half * 2 + 8.dp), y = (-150).dp).wrapContentSize(Alignment.TopStart, unbounded = true), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    val chapter = when {
                        markers?.intro?.let { it.size == 2 && scrub >= it[0] && scrub < it[1] } == true -> "Intro"
                        markers?.recap?.let { it.size == 2 && scrub >= it[0] && scrub < it[1] } == true -> "Recap"
                        markers?.credits?.let { scrub >= it } == true -> "Credits"
                        else -> ""
                    }
                    if (chapter.isNotEmpty()) Text(chapter, style = ui(12, FontWeight.Bold, Night.blush))
                    Box(Modifier.requiredSize(192.dp, 108.dp).border(2.dp, Color.White, RoundedCornerShape(6.dp)).clip(RoundedCornerShape(6.dp)).background(Night.surface2)) {
                        Img(state.current?.still ?: state.page?.title?.backdrop, Modifier.fillMaxSize())
                        frame?.takeIf { it.first == (scrub / 10).toInt() }?.second?.let { Image(it.asImageBitmap(), null, Modifier.fillMaxSize(), contentScale = ContentScale.Crop) }
                    }
                    Text(clock(scrub), style = ui(14, FontWeight.Bold, Color.White))
                }
            }
        }
        Text("-" + clock(duration - shown), style = ui(14, color = Night.fg), modifier = Modifier.widthIn(min = 52.dp), textAlign = TextAlign.End)
    }
}

private fun Modifier.graphicsLayerScale(s: Float) = this.graphicsLayer { scaleX = s; scaleY = s }

/** "You're watching", after a long pause: the show, the episode and what it's about. */
@Composable
private fun PauseCard(on: Boolean, state: app.kimono.watch.ui.PlayerState, modifier: Modifier) {
    val a by animateFloatAsState(if (on) 1f else 0f, tween(800), label = "pause")
    if (a <= 0f) return
    val page = state.page ?: return
    Box(modifier.alpha(a).background(Color(0x99000000)).padding(horizontal = 64.dp), contentAlignment = Alignment.CenterStart) {
        Column(Modifier.widthIn(max = 560.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text("You're watching", style = ui(15, color = Night.fg3))
            Logo(page.title.name, page.title.logo, 48, maxHeight = 90.dp)
            val ep = state.current
            if (!state.isFilm && ep != null) Text("Season ${state.season}: Episode ${state.episode} “${ep.name}”", style = ui(15, FontWeight.Bold))
            Text(ep?.overview?.takeIf { it.isNotBlank() } ?: page.title.overview, style = ui(15, color = Night.fg2).copy(lineHeight = 24.sp), maxLines = 4, overflow = TextOverflow.Ellipsis)
        }
    }
}

/** The ring with its percentage while the stream starts, the title and episode under it. */
@Composable
private fun Loading(state: app.kimono.watch.ui.PlayerState, vm: PlayerViewModel, onExit: () -> Unit) {
    if (!state.loading && state.problem == null) return
    var pct by remember(state.loads, state.problem) { mutableIntStateOf(0) }
    LaunchedEffect(state.loads, state.loading) {
        val t0 = System.currentTimeMillis()
        while (state.loading) {
            val f = ((System.currentTimeMillis() - t0) / 6000f).coerceAtMost(1f)
            pct = ((1 - Math.pow((1 - f).toDouble(), 2.4)) * 99).toInt()
            delay(50)
        }
    }
    Box(Modifier.fillMaxSize().background(Color.Black)) {
        if (state.problem == null) {
            Box(Modifier.align(Alignment.Center).size(96.dp), contentAlignment = Alignment.Center) {
                WavyRing(96.dp, Night.suo, stroke = 4f)
                Text("$pct%", style = ui(18, FontWeight.Bold))
            }
        } else {
            Column(Modifier.align(Alignment.Center).padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(16.dp)) {
                Text(state.problem ?: "", style = ui(16, color = Night.fg2), textAlign = TextAlign.Center)
                val f = remember { FocusRequester() }
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    PaperButton("Back", null, onExit, tonal = true)
                    PaperButton("Try again", null, { vm.retry() }, Modifier.focusRequester(f))
                }
                LaunchedEffect(Unit) { runCatching { f.requestFocus() } }
            }
        }
        val page = state.page
        if (page != null) Column(Modifier.align(Alignment.BottomCenter).padding(bottom = 64.dp, start = 20.dp, end = 20.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(page.title.name, style = display(30), textAlign = TextAlign.Center)
            val ep = state.current
            if (!state.isFilm) Text("S${state.season}:E${state.episode}" + (ep?.let { " · ${it.name}" } ?: ""), style = ui(14, color = Night.fg3))
        }
        Box(Modifier.padding(top = 14.dp, start = 20.dp)) { PBtn(Ic.back, onExit) }
    }
}

@Composable
private fun PlayerSheet(sheet: Sheet?, vm: PlayerViewModel, engine: Engine, tracksVersion: Int, speed: Float, setSpeed: (Float) -> Unit, position: Double, close: () -> Unit) {
    val state by vm.state.collectAsState()
    val first = remember { FocusRequester() }
    Column(Modifier.widthIn(max = 460.dp).clip(RoundedCornerShape(14.dp)).background(Color(0xF51B1412)).padding(18.dp)) {
        when (sheet) {
            Sheet.Tracks -> {
                val audio = remember(tracksVersion) { engine.audioOptions() }
                val subs = remember(tracksVersion) { engine.subtitleOptions() }
                var tick by remember { mutableIntStateOf(0) }
                Row(horizontalArrangement = Arrangement.spacedBy(18.dp)) {
                    Column(Modifier.weight(1f)) {
                        Text("Audio", style = ui(18, FontWeight.Bold), modifier = Modifier.padding(bottom = 10.dp))
                        LazyColumn(Modifier.height(240.dp)) {
                            items(audio) { o ->
                                Opt(o.label, o.selected, if (o == audio.firstOrNull()) first else null) {
                                    engine.select(o, C.TRACK_TYPE_AUDIO); tick++
                                    val sub = engine.subtitleOptions().firstOrNull { it.selected }
                                    vm.tracks(o.language ?: "en", sub?.let { if (it.group == null) "off" else if (it.signs) "signs" else it.language ?: "off" } ?: "off")
                                }
                            }
                        }
                    }
                    Column(Modifier.weight(1f)) {
                        Text("Subtitles", style = ui(18, FontWeight.Bold), modifier = Modifier.padding(bottom = 10.dp))
                        LazyColumn(Modifier.height(240.dp)) {
                            items(subs) { o ->
                                Opt(o.label, o.selected) {
                                    engine.select(o, C.TRACK_TYPE_TEXT); tick++
                                    val a = engine.audioOptions().firstOrNull { it.selected }
                                    vm.tracks(a?.language ?: "en", if (o.group == null) "off" else if (o.signs) "signs" else o.language ?: "off")
                                }
                            }
                        }
                    }
                }
                val versions = state.answer?.versions.orEmpty()
                if (versions.size > 1) {
                    Text("Version", style = ui(18, FontWeight.Bold), modifier = Modifier.padding(top = 14.dp, bottom = 6.dp))
                    LazyColumn(Modifier.height(120.dp)) {
                        items(versions) { v -> Opt(v.label + if (v.source.isNotBlank()) " · ${v.source.replaceFirstChar { it.uppercase() }}" else "", v.index == state.answer?.version?.index) { vm.version(v.index, position); close() } }
                    }
                }
            }
            Sheet.Speed -> {
                Text("Playback speed", style = ui(18, FontWeight.Bold), modifier = Modifier.padding(bottom = 10.dp))
                Box(Modifier.widthIn(min = 380.dp).padding(top = 18.dp, start = 6.dp, end = 6.dp, bottom = 6.dp)) {
                    Box(Modifier.fillMaxWidth().padding(horizontal = 14.dp).offset(y = 5.dp).height(2.dp).background(Color(0x40FFFFFF)))
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                        listOf(0.5f, 0.75f, 1f, 1.25f, 1.5f).forEach { x ->
                            val sel = speed == x
                            val dot by animateFloatAsState(if (sel) 2f else 1f, spring(dampingRatio = 0.5f), label = "dot")
                            Column(Modifier.clickableScale({ setSpeed(x) }).then(if (x == 1f) Modifier.focusRequester(first) else Modifier), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(10.dp)) {
                                Box(Modifier.size(12.dp).graphicsLayerScale(dot).clip(CircleShape).background(if (sel) Night.suo else Night.fg3))
                                Text("${if (x % 1f == 0f) x.toInt() else x}x" + if (x == 1f) " (Normal)" else "", style = ui(13, if (sel) FontWeight.Bold else FontWeight.Normal, if (sel) Night.fg else Night.fg3))
                            }
                        }
                    }
                }
            }
            Sheet.Episodes -> {
                Text("Season ${state.season}", style = ui(18, FontWeight.Bold), modifier = Modifier.padding(bottom = 10.dp))
                val eps = state.page?.episodes.orEmpty()
                val list = rememberLazyListState()
                LaunchedEffect(Unit) { list.scrollToItem((eps.indexOfFirst { it.number == state.episode } - 1).coerceAtLeast(0)) }
                LazyColumn(Modifier.height(320.dp).widthIn(min = 380.dp), state = list) {
                    items(eps) { e ->
                        val now = e.number == state.episode
                        Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).background(if (now) Color(0x24D06A82) else Color.Transparent)
                            .clickableScale({ close(); vm.play(state.season, e.number) }).then(if (now) Modifier.focusRequester(first) else Modifier).padding(8.dp),
                            horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
                            Box(Modifier.width(120.dp).aspectRatio(16f / 9f).clip(RoundedCornerShape(6.dp))) {
                                Img(e.still, Modifier.fillMaxSize())
                                if (e.fraction > 0 || now) app.kimono.watch.ui.ProgressLine(if (now) (position / ((e.runtime ?: 24) * 60.0)).toFloat() else e.fraction.toFloat(), Modifier.align(Alignment.BottomCenter).fillMaxWidth())
                            }
                            Column {
                                Text("${e.number}. ${e.name}", style = ui(14, FontWeight.Bold), maxLines = 2, overflow = TextOverflow.Ellipsis)
                                Text(listOfNotNull(e.runtime?.let { "${it}m" }, "Filler".takeIf { e.filler }, "Recap".takeIf { e.recap }).joinToString(" · "), style = ui(12, color = Night.fg3))
                            }
                        }
                    }
                }
            }
            null -> {}
        }
    }
    LaunchedEffect(sheet) { delay(80); runCatching { first.requestFocus() } }
}

@Composable
private fun Opt(label: String, selected: Boolean, focus: FocusRequester? = null, onClick: () -> Unit) {
    Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp)).then(if (focus != null) Modifier.focusRequester(focus) else Modifier).clickableScale(onClick).padding(horizontal = 6.dp, vertical = 9.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        I(Ic.check, 20.dp, if (selected) Night.blush else Color.Transparent)
        Text(label, style = ui(15, if (selected) FontWeight.Bold else FontWeight.Normal, if (selected) Night.fg else Night.fg2), maxLines = 2)
    }
}

/** The corner vignette over the rolling credits: Watch credits, and Next episode filling itself. */
@Composable
private fun NextUp(vm: PlayerViewModel, post: Post.Next, buffering: Boolean, ctl: Boolean, tv: Boolean) {
    val fill = remember { Animatable(0f) }
    val auto = vm.state.collectAsState().value.answer?.autoplayNext != false
    LaunchedEffect(buffering) {
        if (buffering) return@LaunchedEffect
        fill.animateTo(1f, tween(((1f - fill.value) * 8000).toInt(), easing = androidx.compose.animation.core.LinearEasing))
        if (auto) vm.playNext()
    }
    val vig = remember { Animatable(0f) }
    LaunchedEffect(Unit) { vig.animateTo(1f, tween(1100)) }
    Box(Modifier.fillMaxSize().alpha(vig.value).drawBehind { drawRect(Brush.radialGradient(0f to Color(0xEB000000), 0.28f to Color(0xB3000000), 0.55f to Color(0x40000000), 0.75f to Color.Transparent, center = Offset(size.width, size.height), radius = size.width * 1.1f)) })
    val bottom by animateDpAsState(if (ctl) 104.dp else 28.dp, tween(300), label = "b")
    val focus = remember { FocusRequester() }
    Box(Modifier.fillMaxSize()) {
        Row(Modifier.align(Alignment.BottomEnd).padding(end = 32.dp, bottom = bottom), horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
            if (post.skipped > 0) Text("Skipping ${post.skipped} filler episode${if (post.skipped > 1) "s" else ""}", style = ui(13, FontWeight.Bold, Night.fg2))
            PaperButton("Watch credits", null, { vm.watchCredits() }, tonal = true, height = 52.dp)
            PaperButton("Next episode", Ic.next, { vm.playNext() }, Modifier.focusRequester(focus), height = 52.dp, fill = fill.value)
        }
    }
    LaunchedEffect(Unit) { delay(400); runCatching { focus.requestFocus() } }
}

/** The one-time filler question. */
@Composable
private fun FillerAsk(vm: PlayerViewModel, post: Post.Ask, tv: Boolean) {
    val vig = remember { Animatable(0f) }
    LaunchedEffect(Unit) { vig.animateTo(1f, tween(1100)) }
    Box(Modifier.fillMaxSize().alpha(vig.value).drawBehind { drawRect(Brush.radialGradient(0f to Color(0xEB000000), 0.28f to Color(0xB3000000), 0.55f to Color(0x40000000), 0.75f to Color.Transparent, center = Offset(size.width, size.height), radius = size.width * 1.1f)) })
    val f = post.filler
    val a = f.first.episode; val b = a + f.count - 1
    val focus = remember { FocusRequester() }
    Column(Modifier.fillMaxSize().padding(end = 32.dp, bottom = 52.dp), horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(14.dp, Alignment.Bottom)) {
        Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(if (f.count > 1) "Episodes $a–$b are filler" else "Episode $a is filler", style = ui(26, FontWeight.Bold))
            Text("Skip fillers automatically?", style = ui(16, color = Night.fg2))
        }
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            PaperButton(if (f.count > 1) "Watch them" else "Watch it", null, { vm.fillers(false) }, tonal = true, height = 52.dp)
            PaperButton("Skip fillers", Ic.next, { vm.fillers(true) }, Modifier.focusRequester(focus), height = 52.dp)
        }
    }
    LaunchedEffect(Unit) { delay(400); runCatching { focus.requestFocus() } }
}

/** No next episode: the picture moves to the corner, and the season's (or film's) end card takes the screen. */
@Composable
private fun EndCard(vm: PlayerViewModel, state: app.kimono.watch.ui.PlayerState, onExit: () -> Unit, tv: Boolean) {
    val page = state.page ?: return
    val bg = remember { Animatable(0f) }
    LaunchedEffect(Unit) { bg.animateTo(1f, tween(1000)) }
    val focus = remember { FocusRequester() }
    BoxWithConstraints(Modifier.fillMaxSize()) {
        val portrait = maxWidth < maxHeight
        Box(Modifier.fillMaxSize().alpha(bg.value * 0.55f)) { Img(page.title.backdropLarge ?: page.title.backdrop, Modifier.fillMaxSize()) }
        Box(Modifier.fillMaxSize().background(Brush.horizontalGradient(0f to Color(0xEB000000), 0.55f to Color(0x8C000000), 1f to Color(0x33000000))))
        Box(Modifier.fillMaxSize().background(Brush.verticalGradient(0.5f to Color.Transparent, 1f to Color(0xCC000000))))
        /* Over the small picture: back to the credits. */
        val w = maxWidth * (if (portrait) 0.55f else 0.3f)
        Box(Modifier.offset(24.dp, if (portrait) 70.dp else 24.dp).size(w, w * 9f / 16f).clip(RoundedCornerShape(10.dp)).clickableScale({ vm.watchCredits() }))
        Text("Watch credits", style = ui(13, FontWeight.Bold, Night.fg2), modifier = Modifier.offset(24.dp, (if (portrait) 70.dp else 24.dp) + w * 9f / 16f + 12.dp).width(w), textAlign = TextAlign.Center)
        Box(Modifier.align(Alignment.TopEnd).padding(top = 14.dp, end = 20.dp)) { PBtn(Ic.close, onExit) }
        val nextLine = when {
            page.title.isFilm -> "More like this"
            page.tracker?.nextAirDate != null -> "The next episode is coming ${app.kimono.watch.phone.prettyDate(page.tracker!!.nextAirDate!!)}"
            page.title.nextAirDate != null -> "More is coming ${app.kimono.watch.phone.prettyDate(page.title.nextAirDate!!)}"
            else -> "You're all caught up"
        }
        val coming = !page.title.isFilm && (page.tracker?.nextAirDate ?: page.title.nextAirDate) != null
        Column(Modifier.align(Alignment.BottomStart).padding(start = if (portrait) 16.dp else 64.dp, end = 16.dp, bottom = 48.dp).widthIn(max = 560.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            Text(if (page.title.isFilm) "UP NEXT FOR YOU" else "YOU FINISHED SEASON ${state.season}", style = ui(14, FontWeight.Bold, Night.fg3).copy(letterSpacing = 0.9.sp))
            Text(nextLine, style = ui(32, FontWeight.Bold).copy(lineHeight = 38.sp))
            if (coming) {
                Text("We'll tell you the moment it lands. Until then, these have the same pull.", style = ui(15, color = Night.fg2).copy(lineHeight = 24.sp))
                PaperButton(if (page.reminding) "Reminding you" else "Remind me", if (page.reminding) Ic.check else Ic.bell, { if (!page.reminding) vm.remind() }, Modifier.focusRequester(focus))
            }
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                state.recs.forEachIndexed { i, c ->
                    Box(Modifier.weight(1f).aspectRatio(16f / 9f).clip(RoundedCornerShape(8.dp)).then(if (!coming && i == 0) Modifier.focusRequester(focus) else Modifier).clickableScale({ onRec(c.id) })) {
                        Img(c.backdrop ?: c.poster, Modifier.fillMaxSize())
                        Text(c.name, style = display(15).copy(shadow = androidx.compose.ui.graphics.Shadow(Color.Black, blurRadius = 8f)), modifier = Modifier.align(Alignment.BottomStart).padding(8.dp), maxLines = 2)
                    }
                }
                repeat(3 - state.recs.size) { Spacer(Modifier.weight(1f)) }
            }
        }
    }
    LaunchedEffect(Unit) { delay(600); runCatching { focus.requestFocus() } }
}

/** Set by the activity: plays another title from the end card. */
var onRec: (String) -> Unit = {}

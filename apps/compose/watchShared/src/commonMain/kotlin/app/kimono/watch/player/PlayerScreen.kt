package app.kimono.watch.player

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
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.verticalScroll
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
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import app.kimono.watch.EngineListener
import app.kimono.watch.PlaybackEngine
import app.kimono.watch.TrackOption
import app.kimono.watch.dlKey
import app.kimono.watch.nowMs
import app.kimono.watch.ink.InkLoader
import app.kimono.watch.ink.InkRing
import app.kimono.watch.phone.Choice
import androidx.compose.ui.draw.blur
import kotlin.math.pow
import androidx.compose.ui.input.key.key
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
import app.kimono.watch.theme.Night
import app.kimono.watch.theme.display
import app.kimono.watch.theme.ui
import app.kimono.watch.ui.I
import app.kimono.watch.ui.Ic
import app.kimono.watch.ui.Img
import app.kimono.watch.ui.Logo
import app.kimono.watch.ui.PaperButton
import app.kimono.watch.ui.PlayerViewModel
import app.kimono.watch.ui.TogetherViewModel
import app.kimono.watch.ui.Post
import app.kimono.watch.ui.clickableScale
import app.kimono.watch.ui.clickableScaleClipped
import app.kimono.watch.ui.clock
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlin.math.abs

private enum class Sheet { Tracks, Speed, Episodes, Party }

/**
 * The player's chrome over the picture, from the demo: auto-hiding
 * controls, the scrubber with thumbnails and the intro and credits marked,
 * skip intro and recap, double-tap ±10 s, the sheets, "You're watching" on a
 * long pause, the next-up corner, the filler question and the end card. On
 * TV the D-pad drives it: left/right seek, hold to scrub, OK pauses.
 */
@Composable
fun PlayerScreen(
    vm: PlayerViewModel, engine: PlaybackEngine, tv: Boolean, pip: Boolean, onExit: () -> Unit, onRec: (String) -> Unit, party: TogetherViewModel? = null,
    /** The top corner's own buttons (iPhone: AirPlay and picture in picture). */
    corner: (@Composable () -> Unit)? = null,
) {
    val state by vm.state.collectAsState()
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
    var volume by remember { mutableFloatStateOf(1f) }
    var ripple by remember { mutableStateOf<Pair<Boolean, Int>?>(null) }
    var pausedAt by remember { mutableLongStateOf(0L) }
    var pauseCard by remember { mutableStateOf(false) }
    var tracksVersion by remember { mutableIntStateOf(0) }
    var hinted by remember { mutableIntStateOf(-1) }
    var focusScrub by remember { mutableIntStateOf(0) }
    var startFill by remember { mutableFloatStateOf(0f) }
    /* Keys held down, for telling a tap from a hold (D-pad scrubbing). */
    val held = remember { mutableMapOf<Key, Long>() }

    fun show(hold: Boolean = false) { ctl = true; poke++; if (hold) poke = -kotlin.math.abs(poke) - 1 }
    /* In a party every move is the party's: applied here at once, and sent so every screen follows. */
    fun seekTo(s: Double) { engine.seekTo(s); position = s; party?.seek(s) }
    fun seekBy(d: Double) = seekTo((position + d).coerceIn(0.0, duration.coerceAtLeast(0.0)))
    fun toggle() {
        if (engine.playing || engine.playWhenReady) { engine.pause(); party?.pause(engine.position) }
        else { engine.play(); party?.play(engine.position) }
    }
    fun rip(right: Boolean) { ripple = right to ((ripple?.second ?: 0) + 1) }

    /* A new stream to load. */
    LaunchedEffect(state.loads) {
        val answer = state.answer ?: return@LaunchedEffect
        if (state.loads == 0) return@LaunchedEffect
        engine.load(answer.url, dlKey(vm.titleId, state.season, state.episode), state.startAt, play = party == null)
        engine.setSpeed(speed)
        engine.setVolume(volume)
        sheet = null
    }
    DisposableEffect(engine) {
        /* In a party a dropped stream is asked again, quietly, a few times: the party waits meanwhile. */
        var retries = 0
        val stop = engine.listen(object : EngineListener {
            override fun firstFrame() { retries = 0; vm.started() }
            override fun error(decoder: Boolean, network: Boolean) {
                /* A version this device can't decode: quietly try the next one. */
                if (decoder && vm.fallback(engine.position)) return
                /* A dead copy answers 502 and is passed over for hours: asking play again gets another one.
                   Once at the start (a few times in a party, which waits meanwhile). */
                if (network && retries < (if (party != null) 3 else 1) && (party != null || vm.state.value.loading)) { retries++; vm.retry(); return }
                vm.failed(if (network) "The stream stopped answering. Try again." else "This version won’t play here. Try another.")
            }
            override fun tracks() {
                tracksVersion++
                val answer = vm.state.value.answer ?: return
                if (hinted != vm.state.value.loads) {
                    hinted = vm.state.value.loads
                    if (engine.videoBeyondDecoders() && vm.fallback(engine.position)) return
                    engine.applyHints(answer.tracks)
                }
            }
            override fun aspect(ratio: Float) { aspect = ratio }
            override fun playing(on: Boolean) { playing = on }
            /* Paused by the person (not a buffering stall): the controls come up, and "You're watching" later. */
            override fun userPaused(paused: Boolean) {
                if (paused) { pausedAt = nowMs(); show() } else { pausedAt = 0; pauseCard = false }
            }
        })
        onDispose { stop() }
    }
    /* Where playback is, four times a second. */
    LaunchedEffect(Unit) {
        while (isActive) {
            position = engine.position
            duration = engine.duration
            buffered = engine.buffered
            buffering = engine.buffering
            startFill = engine.startFill
            /* Skipping intros by themselves is the host's to do in a party. */
            vm.tick(position, duration, engine.playing)?.let { if (party == null || party.isHost) seekTo(it) }
            if (party != null) {
                val ps = party.state.value
                val s = vm.state.value
                if (ps != null && ps.timeline.titleId == vm.titleId) {
                    val t = ps.timeline
                    val sameEpisode = s.isFilm || (t.season == s.season && t.episode == s.episode)
                    /* The party moved to another episode: load it here too. */
                    if (!sameEpisode && !s.finding) vm.play(t.season, t.episode)
                    else if (!s.loading && s.problem == null) party.sync(engine)
                    party.report(when { s.loading || !sameEpisode -> "loading"; engine.buffering -> "buffering"; else -> "ready" })
                    /* At the credits: the shared countdown. */
                    if (s.post is Post.Next && ps.countdown == null && ps.hold == null) party.next()
                }
            } else if (engine.ended) {
                when (vm.state.value.post) {
                    is Post.Next -> if (vm.state.value.answer?.autoplayNext != false) vm.playNext()
                    else -> {}
                }
            }
            /* "You're watching" after five seconds paused; in a party only when someone paused it, not while it waits for a screen. */
            val partyPaused = party?.state?.value?.let { !it.timeline.playing && it.hold == null } ?: true
            if (pausedAt > 0 && partyPaused && !engine.playWhenReady && nowMs() - pausedAt > 5000 && sheet == null && vm.state.value.post == Post.None && !state.loading) { pauseCard = true; ctl = false }
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
            val code = e.key
            val down = e.type == KeyEventType.KeyDown
            if (!down && e.type != KeyEventType.KeyUp) return@onPreviewKeyEvent false
            val repeat = down && held.containsKey(code)
            if (down && !repeat) held[code] = nowMs() else if (!down) held.remove(code)
            when (code) {
                Key.MediaPlayPause, Key.Spacebar -> { if (down) { toggle(); show() }; true }
                Key.MediaPlay -> { if (down) { engine.play(); show() }; true }
                Key.MediaPause -> { if (down) { engine.pause(); show() }; true }
                Key.MediaFastForward -> { if (down) { seekBy(10.0); rip(true) }; true }
                Key.MediaRewind -> { if (down) { seekBy(-10.0); rip(false) }; true }
                Key.MediaNext -> { if (down) vm.playNext(); true }
                Key.MediaStop -> { if (down) onExit(); true }
                Key.Back, Key.Escape -> {
                    if (!down) return@onPreviewKeyEvent true
                    when {
                        sheet != null -> { sheet = null; show() }
                        scrub != null -> scrub = null
                        ctl && tv && post == Post.None -> ctl = false
                        else -> onExit()
                    }
                    true
                }
                Key.DirectionLeft, Key.DirectionRight -> {
                    /* Hidden controls: tap to seek ten seconds, hold to scrub. */
                    if (!tv || ctl || post != Post.None || state.loading) return@onPreviewKeyEvent false
                    val right = code == Key.DirectionRight
                    if (down) {
                        if (!repeat) { holdStart = nowMs(); seekBy(if (right) 10.0 else -10.0); rip(right) }
                        else {
                            val heldFor = (nowMs() - holdStart) / 1000.0
                            val step = if (heldFor > 4) 60.0 else if (heldFor > 2) 30.0 else 10.0
                            scrub = ((scrub ?: position) + if (right) step else -step).coerceIn(0.0, duration)
                        }
                    } else scrub?.let { seekTo(it); scrub = null }
                    true
                }
                Key.DirectionCenter, Key.Enter, Key.NumPadEnter -> {
                    if (!tv || ctl || post != Post.None) { if (down) show(); return@onPreviewKeyEvent false }
                    val offer = state.skip
                    if (offer != null) { if (down) seekTo(offer.to); return@onPreviewKeyEvent true }
                    if (down) { toggle(); show(); scope.launch { delay(50); runCatching { playFocus.requestFocus() } } }
                    true
                }
                Key.DirectionUp, Key.DirectionDown -> {
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
                    engine.Picture(Modifier.fillMaxSize())
                    if (!small) {
                        val lift by animateDpAsState(if (ctl && !pip) 70.dp else 0.dp, tween(300), label = "lift")
                        engine.Captions(Modifier.fillMaxSize().padding(bottom = lift).alpha(if (post is Post.Next || post is Post.Ask) 0f else 1f))
                    }
                }
            }
        }
        if (pip) return@Box

        /* Shade behind the chrome. */
        val chrome by animateFloatAsState(if (ctl && post == Post.None) 1f else 0f, tween(300), label = "chrome")
        Box(Modifier.fillMaxSize().alpha(chrome).background(Brush.verticalGradient(0f to Color(0xA6000000), 0.22f to Color.Transparent, 0.62f to Color.Transparent, 1f to Color(0xCC000000))))

        Ripple(ripple, Modifier.fillMaxSize())

        var stalled by remember { mutableStateOf(false) }
        LaunchedEffect(buffering) { stalled = false; if (buffering) { delay(600); stalled = true } }
        if (stalled && buffering && !state.loading && post == Post.None) InkLoader(Modifier.align(Alignment.Center), size = 48.dp)

        PauseCard(pauseCard && post == Post.None, state, Modifier.fillMaxSize())

        /* The party's faces, notes and reactions sit under the controls and sheets. */
        if (party != null) PartyLayer(party, chrome > 0.5f, tv)

        /* Top: back and what's on. */
        val name = state.page?.title?.name ?: ""
        val ep = state.current
        Row(Modifier.fillMaxWidth().alpha(if (state.loading) 1f else chrome).padding(top = 14.dp, start = 20.dp, end = 20.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            PBtn(Ic.back, onExit, enabled = chrome > 0.5f || state.loading)
            Text(androidx.compose.ui.text.buildAnnotatedString {
                pushStyle(androidx.compose.ui.text.SpanStyle(color = Night.fg, fontWeight = FontWeight.Bold)); append(name); pop()
                if (!state.isFilm && ep != null) append("  E${state.episode} · ${ep.name}")
            }, style = ui(15, color = Night.fg2), modifier = Modifier.weight(1f), textAlign = TextAlign.Center, maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (corner != null && !state.loading && chrome > 0.5f) corner() else Spacer(Modifier.size(48.dp))
        }

        if (!state.loading && chrome > 0.01f) {
            /* Middle (phone): back ten, play, forward ten. */
            if (!tv) Row(Modifier.align(Alignment.Center).alpha(chrome), horizontalArrangement = Arrangement.spacedBy(64.dp), verticalAlignment = Alignment.CenterVertically) {
                SeekBtn(false) { seekBy(-10.0); rip(false); show() }
                PBtn(if (playing) Ic.pause else Ic.play, { toggle(); show() }, size = 76.dp, iconSize = 52.dp, shadow = true)
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
                    if (!tv) VolumeSlider(volume, { volume = it; engine.setVolume(it); show(hold = true) }, onDone = { show() })
                    LabBtn(Ic.speed, "Speed", tv) { sheet = if (sheet == Sheet.Speed) null else Sheet.Speed; show() }
                    if (!state.isFilm) LabBtn(Ic.eps, "Episodes", tv) { sheet = if (sheet == Sheet.Episodes) null else Sheet.Episodes; show() }
                    LabBtn(Ic.cc, "Audio & subtitles", tv) { sheet = if (sheet == Sheet.Tracks) null else Sheet.Tracks; show() }
                    if (party != null) LabBtn(Ic.people, "Together", tv) { sheet = if (sheet == Sheet.Party) null else Sheet.Party; show() }
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
            PlayerSheet(sheet, vm, engine, tracksVersion, speed, { speed = it; engine.setSpeed(it); party?.rate(it) }, position, { sheet = null; show() }, party)
        }

        when (post) {
            is Post.Next -> NextUp(vm, post, buffering || !playing, ctl, tv, party)
            is Post.Ask -> FillerAsk(vm, post, tv)
            Post.End -> EndCard(vm, state, onExit, onRec, tv)
            Post.None -> {}
        }

        Loading(state, vm, startFill, onExit)
    }
    LaunchedEffect(Unit) { runCatching { focusRoot.requestFocus() } }
    LaunchedEffect(ctl, tv) { if (tv && !ctl) runCatching { focusRoot.requestFocus() } }
}

/** [shadow]: a soft drop shadow in the glyph's own shape, so it reads on bright frames. */
@Composable
private fun PBtn(icon: ImageVector, onClick: () -> Unit, size: Dp = 48.dp, iconSize: Dp = 28.dp, enabled: Boolean = true, focus: FocusRequester? = null, shadow: Boolean = false) {
    Box(Modifier.size(size).then(if (focus != null) Modifier.focusRequester(focus) else Modifier).clip(CircleShape).clickableScale({ if (enabled) onClick() }, focusScale = 1.08f), contentAlignment = Alignment.Center) {
        if (shadow) I(icon, iconSize, Color.Black.copy(alpha = 0.6f), Modifier.offset(y = 2.dp).blur(8.dp, androidx.compose.ui.draw.BlurredEdgeTreatment.Unbounded))
        I(icon, iconSize, Color.White)
    }
}

/** The player's volume: the speaker mutes and unmutes, the track sets how loud. */
@Composable
private fun VolumeSlider(volume: Float, onChange: (Float) -> Unit, onDone: () -> Unit) {
    var before by remember { mutableFloatStateOf(1f) }
    var width by remember { mutableIntStateOf(1) }
    Row(Modifier.height(48.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        Box(Modifier.size(40.dp).clip(CircleShape).clickableScale({
            if (volume > 0f) { before = volume; onChange(0f) } else onChange(before.takeIf { it > 0.05f } ?: 1f)
            onDone()
        }, focusScale = 1.08f), contentAlignment = Alignment.Center) { I(if (volume <= 0f) Ic.mute else Ic.vol, 22.dp, Color.White) }
        Box(Modifier.width(96.dp).height(28.dp).onSizeChanged { width = it.width }.pointerInput(Unit) {
            awaitEachGesture {
                val down = awaitFirstDown()
                down.consume()
                onChange((down.position.x / width).coerceIn(0f, 1f))
                while (true) {
                    val change = awaitPointerEvent().changes.firstOrNull { it.id == down.id } ?: break
                    if (!change.pressed) { change.consume(); break }
                    change.consume()
                    onChange((change.position.x / width).coerceIn(0f, 1f))
                }
                onDone()
            }
        }, contentAlignment = Alignment.CenterStart) {
            Box(Modifier.fillMaxWidth().height(4.dp).clip(RoundedCornerShape(2.dp)).background(Color(0x40FFFFFF)).drawBehind {
                drawRect(Night.suo, size = size.copy(width = size.width * volume))
            })
            val px = with(LocalDensity.current) { (width * volume).toDp() }
            Box(Modifier.offset(x = px - 6.dp).size(12.dp).clip(CircleShape).background(Night.suo))
        }
    }
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
        Row(Modifier.height(48.dp).clickableScaleClipped(RoundedCornerShape(10.dp), onClick, focusScale = 1.08f).padding(horizontal = 10.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
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
private fun Scrubber(position: Double, duration: Double, buffered: Double, scrub: Double?, state: app.kimono.watch.ui.PlayerState, engine: PlaybackEngine, tv: Boolean, focus: FocusRequester, onScrub: (Double) -> Unit, onCommit: () -> Unit) {
    val d = duration.coerceAtLeast(1.0)
    var width by remember { mutableIntStateOf(1) }
    val source = remember { MutableInteractionSource() }
    val focused by source.collectIsFocusedAsState()
    val shown = scrub ?: position
    val active = scrub != null || focused
    val thick by animateDpAsState(if (active) 7.dp else 4.dp, tween(150), label = "t")
    val knob by animateFloatAsState(if (active) 1.25f else 0.85f, tween(150), label = "k")
    val markers = state.answer?.markers
    val thumbs = remember(state.answer?.url) { state.answer?.url?.let { engine.thumbnails(it) } }
    DisposableEffect(thumbs) { onDispose { thumbs?.close() } }
    val frame by (thumbs?.frame ?: kotlinx.coroutines.flow.MutableStateFlow(null)).collectAsState()
    LaunchedEffect(scrub) { scrub?.let { thumbs?.want(it) } }
    var holdAt by remember { mutableLongStateOf(0L) }
    var holding by remember { mutableStateOf(false) }
    /* Read live in the key handler: several presses can land before the next frame. */
    val live = remember { mutableStateOf<Double?>(null) }
    LaunchedEffect(scrub) { live.value = scrub }
    Row(Modifier.fillMaxWidth().height(28.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
        Box(Modifier.weight(1f).height(28.dp).onSizeChanged { width = it.width }
            .focusRequester(focus).focusable(interactionSource = source)
            .onPreviewKeyEvent { e ->
                val code = e.key
                if (code != Key.DirectionLeft && code != Key.DirectionRight && code != Key.DirectionCenter && code != Key.Enter) return@onPreviewKeyEvent false
                if (code == Key.DirectionCenter || code == Key.Enter) { if (e.type == KeyEventType.KeyUp && live.value != null) { live.value = null; onCommit() }; return@onPreviewKeyEvent true }
                if (e.type == KeyEventType.KeyDown) {
                    if (!holding) { holding = true; holdAt = nowMs() }
                    val heldFor = (nowMs() - holdAt) / 1000.0
                    val step = if (heldFor > 4) 60.0 else if (heldFor > 2) 30.0 else 10.0
                    val next = ((live.value ?: position) + if (code == Key.DirectionRight) step else -step).coerceIn(0.0, duration)
                    live.value = next
                    onScrub(next)
                } else if (e.type == KeyEventType.KeyUp) {
                    holding = false
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
                        frame?.takeIf { it.first == (scrub / 10).toInt() }?.second?.let { Image(it, null, Modifier.fillMaxSize(), contentScale = ContentScale.Crop) }
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

/**
 * The start of playback (review spec §4.2): the episode's still, blurred and
 * dark, the title, then Kimono's InkRing with a real percentage. Each stage
 * owns a span of the ring and fills only by its real signal: Find (the
 * server's search, no measure: the ring holds) 0–25%, Choose 25–35%, Buffer
 * 35–100% by ExoPlayer's buffer against its start threshold. Stage words
 * under it, and after a while a way to try another copy.
 */
@Composable
private fun Loading(state: app.kimono.watch.ui.PlayerState, vm: PlayerViewModel, fill: Float, onExit: () -> Unit) {
    if (!state.loading && state.problem == null) return
    val page = state.page
    val ep = state.current
    val stage = when { state.finding -> 0; fill <= 0f -> 1; else -> 2 }
    val value = when (stage) { 0 -> 0f; 1 -> .35f; else -> .35f + .65f * fill.coerceIn(0f, 1f) }
    var waited by remember(state.loads, state.finding) { mutableIntStateOf(0) }
    LaunchedEffect(state.loads, state.finding) { while (true) { delay(1000); waited++ } }
    Box(Modifier.fillMaxSize().background(Color.Black)) {
        Img(ep?.still ?: page?.title?.backdropLarge ?: page?.title?.backdrop, Modifier.fillMaxSize().blur(24.dp).alpha(.35f))
        if (state.problem == null) {
            Column(Modifier.align(Alignment.Center).padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
                if (page != null) {
                    Logo(page.title.name, page.title.logo, 34, Modifier.widthIn(max = 420.dp), center = true, maxHeight = 84.dp)
                    if (!state.isFilm) Text("S${state.season}:E${state.episode}" + (ep?.let { " · ${it.name}" } ?: ""), style = ui(15, color = Night.fg2))
                }
                Spacer(Modifier.size(8.dp))
                InkRing({ value }, size = 96.dp, percent = true, percentStyle = ui(18, FontWeight.Bold))
                Row(horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                    listOf("Find", "Choose", "Buffer").forEachIndexed { i, word ->
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                            if (i < stage) I(Ic.check, 14.dp, Night.moss)
                            Text(word, style = ui(14, color = when { i < stage -> Night.fg2; i == stage -> Night.fg; else -> Night.fg3 }))
                        }
                    }
                }
                val picked = state.answer?.version?.let { v -> (listOf(v.label.substringBefore(" · ")) + v.badges.filter { it != "HD" && it != "4K" }).joinToString(" · ") }
                Text(when (stage) { 0 -> "Finding the best copy…"; 1 -> "Picked ${picked ?: "a copy"}"; else -> "Buffering · ${(fill * 100).toInt()}%" }, style = ui(16, color = Night.fg))
                if (waited >= 12) Text("This one’s taking a while.", style = ui(14, color = Night.fg3))
                if (waited >= 25 && !state.finding) PaperButton("Try another copy", null, { vm.fallback(state.startAt) }, tonal = true)
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
        Box(Modifier.padding(top = 14.dp, start = 20.dp)) { PBtn(Ic.back, onExit) }
    }
}

@Composable
private fun PlayerSheet(sheet: Sheet?, vm: PlayerViewModel, engine: PlaybackEngine, tracksVersion: Int, speed: Float, setSpeed: (Float) -> Unit, position: Double, close: () -> Unit, party: TogetherViewModel?) {
    val state by vm.state.collectAsState()
    val first = remember { FocusRequester() }
    Column(Modifier.widthIn(max = 460.dp).heightIn(max = 620.dp).clip(RoundedCornerShape(14.dp)).background(Color(0xF51B1412)).verticalScroll(androidx.compose.foundation.rememberScrollState()).padding(18.dp)) {
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
                                    engine.selectAudio(o); tick++
                                    val sub = engine.subtitleOptions().firstOrNull { it.selected }
                                    vm.tracks(o.language ?: "en", sub?.let { if (it.handle == null) "off" else if (it.signs) "signs" else it.language ?: "off" } ?: "off")
                                }
                            }
                        }
                    }
                    Column(Modifier.weight(1f)) {
                        Text("Subtitles", style = ui(18, FontWeight.Bold), modifier = Modifier.padding(bottom = 10.dp))
                        LazyColumn(Modifier.height(240.dp)) {
                            items(subs) { o ->
                                Opt(o.label, o.selected) {
                                    engine.selectSubtitles(o); tick++
                                    val a = engine.audioOptions().firstOrNull { it.selected }
                                    vm.tracks(a?.language ?: "en", if (o.handle == null) "off" else if (o.signs) "signs" else o.language ?: "off")
                                }
                            }
                        }
                    }
                }
                /* Quality: only the sizes play says this device can have; switching keeps the place. */
                val quality = state.answer?.quality
                if (quality != null && quality.options.size > 1) {
                    Text("Quality", style = ui(18, FontWeight.Bold), modifier = Modifier.padding(top = 14.dp, bottom = 6.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                        quality.options.forEach { q -> Box(Modifier.weight(1f)) { Choice(q.label, q.value == quality.current) { if (q.value != quality.current) { vm.quality(q.value, position); close() } } } }
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
            Sheet.Party -> if (party != null) PartySheet(party, app.kimono.watch.LocalWatch.current.tv, first)
            Sheet.Episodes -> {
                Text("Season ${state.season}", style = ui(18, FontWeight.Bold), modifier = Modifier.padding(bottom = 10.dp))
                val eps = state.page?.episodes.orEmpty()
                val list = rememberLazyListState()
                LaunchedEffect(Unit) { list.scrollToItem((eps.indexOfFirst { it.number == state.episode } - 1).coerceAtLeast(0)) }
                LazyColumn(Modifier.height(320.dp).widthIn(min = 380.dp), state = list) {
                    items(eps) { e ->
                        val now = e.number == state.episode
                        Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).background(if (now) Color(0x24D06A82) else Color.Transparent)
                            .clickableScale({ close(); if (party != null) party.episode(state.season, e.number) else vm.play(state.season, e.number) }).then(if (now) Modifier.focusRequester(first) else Modifier).padding(8.dp),
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
    /* The sheet takes the D-pad as soon as it's laid out. */
    LaunchedEffect(sheet) { repeat(10) { delay(60); if (runCatching { first.requestFocus() }.isSuccess) return@LaunchedEffect } }
}

@Composable
private fun Opt(label: String, selected: Boolean, focus: FocusRequester? = null, onClick: () -> Unit) {
    Row(Modifier.fillMaxWidth().then(if (focus != null) Modifier.focusRequester(focus) else Modifier).clickableScale(onClick).clip(RoundedCornerShape(8.dp)).padding(horizontal = 6.dp, vertical = 9.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        I(Ic.check, 20.dp, if (selected) Night.blush else Color.Transparent)
        Text(label, style = ui(15, if (selected) FontWeight.Bold else FontWeight.Normal, if (selected) Night.fg else Night.fg2), maxLines = 2)
    }
}

/** The corner vignette over the rolling credits: Watch credits, and Next episode filling itself. */
@Composable
private fun NextUp(vm: PlayerViewModel, post: Post.Next, buffering: Boolean, ctl: Boolean, tv: Boolean, party: TogetherViewModel?) {
    val fill = remember { Animatable(0f) }
    val auto = vm.state.collectAsState().value.answer?.autoplayNext != false
    /* In a party the countdown is the server's, ten seconds shared by every screen. */
    val countdown = party?.state?.collectAsState()?.value?.countdown
    LaunchedEffect(countdown?.endsAt) {
        if (party == null || countdown == null) return@LaunchedEffect
        while (true) { fill.snapTo((1f - (countdown.endsAt - party.serverNow()) / 10_000f).coerceIn(0f, 1f)); delay(50) }
    }
    LaunchedEffect(buffering) {
        if (party != null || buffering) return@LaunchedEffect
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
            PaperButton("Watch credits", null, { party?.watchCredits(); vm.watchCredits() }, tonal = true, height = 52.dp)
            PaperButton("Next episode", Ic.next, { val to = countdown?.to; if (party != null && to != null) party.episode(to.season, to.episode) else if (party != null) party.next() else vm.playNext() }, Modifier.focusRequester(focus), height = 52.dp, fill = fill.value)
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
private fun EndCard(vm: PlayerViewModel, state: app.kimono.watch.ui.PlayerState, onExit: () -> Unit, onRec: (String) -> Unit, tv: Boolean) {
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
        Box(Modifier.offset(24.dp, if (portrait) 70.dp else 24.dp).size(w, w * 9f / 16f).clickableScaleClipped(RoundedCornerShape(10.dp), { vm.watchCredits() }))
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


package app.kimono.screens

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.animation.expandHorizontally
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.kimono.data.Code
import app.kimono.data.KimonoProblem
import app.kimono.data.Platform
import app.kimono.ui.InkLoader
import app.kimono.ui.kimonoIcon
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlin.time.TimeSource

/*
 * Speaking a message instead of typing it, as on the web. The mic records until
 * you're done (or cancel); only then is the recording sent, once, to be written
 * down. The words go after whatever is already in the box, to be read over and
 * sent like typed ones. While it listens the box's line becomes one strip:
 * cancel, your voice drawn as ink, the time, and a seal to say you're done.
 */

/** Puts [said] after [typed], with a space between unless one is already there. */
internal fun joinSaid(typed: String, said: String) = when {
    typed.isBlank() -> said
    typed.last().isWhitespace() -> typed + said
    else -> "$typed $said"
}

internal enum class Hearing { Idle, Asking, Listening, Writing }

@Stable
internal class Dictation(private val code: Code, private val platform: Platform, private val scope: CoroutineScope) {
    var phase by mutableStateOf(Hearing.Idle)
    var elapsed by mutableLongStateOf(0L)
    /* how loud, a few times a second; [ticks] tells the ink to draw again */
    val levels = ArrayDeque<Float>()
    var ticks by mutableIntStateOf(0)
    var onText: (String) -> Unit = {}
    var onProblem: (String?) -> Unit = {}

    fun start() {
        if (phase != Hearing.Idle) return
        onProblem(null)
        phase = Hearing.Asking
        scope.launch {
            val problem = platform.startRecording()
            if (problem != null) { phase = Hearing.Idle; onProblem(problem); return@launch }
            levels.clear(); elapsed = 0
            phase = Hearing.Listening
            val began = TimeSource.Monotonic.markNow()
            while (phase == Hearing.Listening) {
                levels.addLast(platform.recordingLevel())
                while (levels.size > 240) levels.removeFirst()
                ticks++
                elapsed = began.elapsedNow().inWholeMilliseconds
                /* ten minutes is plenty for one message */
                if (elapsed >= 10 * 60_000) { finish(); break }
                delay(55)
            }
        }
    }

    fun finish() {
        if (phase != Hearing.Listening) return
        phase = Hearing.Writing
        scope.launch {
            try {
                val audio = platform.stopRecording(keep = true)
                if (audio == null || audio.size < 1200) { onProblem("Nothing was heard."); return@launch }
                val said = code.transcribe(audio)
                if (said.isNotEmpty()) onText(said) else onProblem("Nothing was heard.")
            } catch (p: KimonoProblem) {
                onProblem(p.message ?: "Couldn't turn that into words. Try again.")
            } finally { phase = Hearing.Idle }
        }
    }

    fun cancel() {
        if (phase != Hearing.Listening) return
        phase = Hearing.Idle
        scope.launch { platform.stopRecording(keep = false) }
    }
}

/** The dictation for one composer; null where this phone can't record or the server isn't set up for it. */
@Composable
internal fun rememberDictation(code: Code, platform: Platform, onText: (String) -> Unit, onProblem: (String?) -> Unit): Dictation? {
    val on by produceState(false, code) { value = platform.canRecord && code.dictationOn() }
    val scope = rememberCoroutineScope()
    val dictation = remember(code, platform) { Dictation(code, platform, scope) }
    dictation.onText = onText
    dictation.onProblem = onProblem
    /* leaving the chat while it listens lets the recording go */
    androidx.compose.runtime.DisposableEffect(dictation) { onDispose { dictation.cancel() } }
    return if (on) dictation else null
}

/** The mic on the writing line, beside Send. */
@Composable
internal fun MicButton(dictation: Dictation) {
    val focus = LocalFocusManager.current
    val keyboard = LocalSoftwareKeyboardController.current
    IconButton(onClick = { focus.clearFocus(); keyboard?.hide(); dictation.start() }, enabled = dictation.phase == Hearing.Idle) {
        Icon(kimonoIcon("mic"), "Speak a message", tint = if (dictation.phase == Hearing.Asking) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

/** Over the writing line while it listens or writes down: put inside a Box around that line. */
@Composable
internal fun BoxScope.DictationStrip(dictation: Dictation?) {
    val live = dictation != null && (dictation.phase == Hearing.Listening || dictation.phase == Hearing.Writing)
    AnimatedVisibility(
        live, Modifier.matchParentSize(),
        enter = expandHorizontally(spring(dampingRatio = 0.8f, stiffness = 420f), expandFrom = Alignment.End) + fadeIn(tween(160)),
        exit = fadeOut(tween(140)),
    ) {
        val d = dictation ?: return@AnimatedVisibility
        val writing = d.phase == Hearing.Writing
        val scheme = MaterialTheme.colorScheme
        Row(
            Modifier.fillMaxSize().background(scheme.surfaceContainer, RoundedCornerShape(22.dp)),
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            IconButton(onClick = { d.cancel() }, enabled = !writing) { Icon(kimonoIcon("close"), "Cancel", tint = scheme.onSurfaceVariant) }
            val fade by animateFloatAsState(if (writing) .35f else 1f, tween(300), label = "ink-fade")
            VoiceInk(d, Modifier.weight(1f).height(30.dp).graphicsLayer { alpha = fade })
            Box(Modifier.widthIn(min = 52.dp), contentAlignment = Alignment.CenterEnd) {
                if (writing) InkLoader(size = 20.dp)
                else Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(7.dp)) {
                    /* the red of a seal's ink: recording */
                    val beat by rememberInfiniteTransition(label = "rec").animateFloat(1f, .35f, infiniteRepeatable(tween(700), RepeatMode.Reverse), label = "rec-beat")
                    Box(Modifier.size(8.dp).graphicsLayer { rotationZ = 45f; alpha = beat }.background(scheme.error, RoundedCornerShape(2.5.dp)))
                    val s = d.elapsed / 1000
                    Text("${s / 60}:${(s % 60).toString().padStart(2, '0')}", fontFamily = FontFamily.Monospace, fontWeight = FontWeight.Medium, fontSize = 13.5.sp, color = scheme.onSurfaceVariant)
                }
            }
            Surface(onClick = { d.finish() }, enabled = !writing, shape = RoundedCornerShape(14.dp), color = scheme.primary,
                modifier = Modifier.padding(start = 2.dp).size(44.dp).semantics { contentDescription = "Done" }) {
                Box(contentAlignment = Alignment.Center) {
                    if (writing) InkLoader(size = 22.dp, color = scheme.onPrimary)
                    else Icon(kimonoIcon("check"), null, tint = scheme.onPrimary, modifier = Modifier.size(22.dp))
                }
            }
        }
    }
}

/** The voice as it's heard: a stroke for each moment, newest at the right, older ones paling as they drift left. */
@Composable
private fun VoiceInk(d: Dictation, modifier: Modifier) {
    val ink = MaterialTheme.colorScheme.primary
    Canvas(modifier.fillMaxHeight()) {
        if (d.ticks < 0) return@Canvas // read, so each new level draws again
        val step = 5.dp.toPx(); val stroke = 3.dp.toPx()
        val fit = (size.width / step).toInt()
        val shown = d.levels.takeLast(fit)
        val quiet = size.height * .08f
        for (i in 0 until fit) {
            val fromRight = fit - 1 - i
            val level = shown.getOrNull(shown.size - 1 - fromRight)
            val x = size.width - (fromRight + 1) * step + (step - stroke) / 2
            /* before anything was said: a faint dotted line, the paper waiting */
            val h = if (level == null) 2.dp.toPx() else maxOf(stroke, quiet + level * (size.height - quiet) * .92f)
            val alpha = if (level == null) .18f else maxOf(.28f, 1f - fromRight.toFloat() / fit * .75f)
            drawRoundRect(ink.copy(alpha = alpha), Offset(x, (size.height - h) / 2), Size(stroke, h), CornerRadius(stroke / 2))
        }
    }
}

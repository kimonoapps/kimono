package app.kimono.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.height
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameMillis
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.semantics.ProgressBarRangeInfo
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.progressBarRangeInfo
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import app.kimono.theme.Kata
import kotlin.math.PI
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.sin

/*
 * Kimono's wait: Material 3 Expressive's wavy progress bar (the one an update
 * shows), brushed in ink. The filled part is a wave laid by a brush that presses
 * and eases, with a faint bleed around it; past a small gap the rest of the way
 * is a flat, faint brush line ending in a dot. With no measure of how far along,
 * two brushed waves run along it as Material's indeterminate bar does.
 * In suō; inside an app, the app's colour.
 */

/* Material's indeterminate timing: two lines, each a head and a tail. */
private const val CYCLE = 1750.0
private val runs = listOf(0.0 to 1000.0, 250.0 to 1250.0, 650.0 to 1500.0, 900.0 to 1750.0)
private fun easeInOut(x: Double) = if (x < .5) 4 * x * x * x else 1 - (-2 * x + 2).pow(3) / 2
private fun along(t: Double, run: Pair<Double, Double>) = easeInOut(((t - run.first) / (run.second - run.first)).coerceIn(0.0, 1.0)).toFloat()

/** The brushed wave between two x's, its crests moving with [phase]. */
private fun waveBetween(from: Float, to: Float, mid: Float, amp: Float, length: Float, phase: Float): Path = Path().apply {
    var x = from
    moveTo(x, mid + amp * sin((x + phase) / length * 2 * PI).toFloat())
    while (x < to) { x = min(to, x + 1.5f); lineTo(x, mid + amp * sin((x + phase) / length * 2 * PI).toFloat()) }
}

private fun DrawScope.brushed(path: Path, seed: Int, weight: Float, tint: Color, alpha: Float, bleed: Boolean) {
    if (bleed) drawPath(inkBrush(path, InkRandom(seed + 1), weight * 1.9f, closed = false, lift = null, swell = .45f, wander = .3f, step = 1.5f), tint, alpha = alpha * .2f)
    drawPath(inkBrush(path, InkRandom(seed), weight, closed = false, lift = null, swell = .32f, wander = .12f, step = 1.5f), tint, alpha = alpha)
}

/** The flat, faint track between two x's. */
private fun DrawScope.track(from: Float, to: Float, mid: Float, weight: Float, tint: Color) {
    if (to - from < weight) return
    val line = Path().apply { moveTo(from, mid); lineTo(to, mid) }
    drawPath(inkBrush(line, InkRandom(7), weight * .8f, closed = false, lift = 60f..140f, gap = 4f..7f, swell = .25f, wander = .1f, step = 1.5f), tint, alpha = .24f)
}

/** The bar itself. [progress] null: how far along is unknown. */
@Composable
internal fun InkWaveBar(progress: (() -> Float)?, modifier: Modifier, color: Color?) {
    val tint = color ?: LocalInkTint.current ?: Kata.suo
    var now by remember { mutableLongStateOf(0L) }
    LaunchedEffect(Unit) {
        val start = withFrameMillis { it }
        while (true) withFrameMillis { now = it - start }
    }
    val known = progress?.invoke()?.coerceIn(0f, 1f)
    val described = if (known == null) Modifier.semantics { contentDescription = "Loading"; progressBarRangeInfo = ProgressBarRangeInfo.Indeterminate }
    else Modifier.semantics { progressBarRangeInfo = ProgressBarRangeInfo(known, 0f..1f) }
    Canvas(modifier.then(described)) {
        val t = now.toDouble()
        val h = size.height
        val weight = max(1.5f, h * .3f)
        val pad = weight / 2 + 1f
        val mid = h / 2
        val amp = ((h - weight) / 2 * .85f).coerceAtLeast(0f)
        /* Material: 40dp crests on a known bar, 20dp while unknown; tighter when the bar is short. */
        val length = min(if (known != null) h * 4f else h * 2.4f, max(size.width / 2.5f, h * 1.6f))
        val gap = weight * 1.3f
        val start = pad; val end = size.width - pad; val span = end - start
        /* The crests drift along, as Material's do. */
        val phase = -(t / 1000.0 * length).toFloat() % length
        if (known != null) {
            val reach = start + span * known
            /* Flat where it starts and where it lands, wavy between. */
            val swing = amp * min(1f, known / .1f) * min(1f, (1f - known) / .05f).coerceAtLeast(0f)
            if (known > 0f) brushed(waveBetween(start, reach, mid, swing, length, phase), 11, weight, tint, .9f, bleed = true)
            track(if (known > 0f) reach + gap else start, end - weight * 1.2f, mid, weight, tint)
            drawCircle(tint, radius = weight * .45f, center = Offset(end - weight * .3f, mid), alpha = .7f)
        } else {
            val c = t % CYCLE
            val lines = listOf(along(c, runs[1]) to along(c, runs[0]), along(c, runs[3]) to along(c, runs[2]))
                .map { (tail, head) -> start + span * tail to start + span * head }
                .filter { (a, b) -> b - a > weight * .6f }
            var at = start
            lines.forEachIndexed { i, (a, b) ->
                track(at, a - gap, mid, weight, tint)
                brushed(waveBetween(a, b, mid, amp, length, phase), 11 + i * 4, weight, tint, .9f, bleed = true)
                at = b + gap
            }
            track(at, end, mid, weight, tint)
        }
    }
}

/** How far along something is, 0 to 1, as a brushed wave. */
@Composable
fun InkProgress(progress: () -> Float, modifier: Modifier = Modifier, color: Color? = null) =
    InkWaveBar(progress, modifier.height(10.dp), color)

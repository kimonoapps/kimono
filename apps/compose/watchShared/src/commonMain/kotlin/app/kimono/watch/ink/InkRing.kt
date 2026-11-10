package app.kimono.watch.ink

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.runtime.withFrameMillis
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.semantics.ProgressBarRangeInfo
import androidx.compose.ui.semantics.progressBarRangeInfo
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import app.kimono.watch.theme.Night
import kotlin.math.PI
import kotlin.math.ceil
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin

/** The colour ink marks are washed in here: Watch's own (set in WatchTheme), or null for Kimono's suō. */
val LocalInkTint = staticCompositionLocalOf<Color?> { null }

/** One frame of the ring in the 100 box, as the website's ringFrame (packages/ui/src/loading.tsx). */
private fun ringPaths(t: Double, value: Float): Pair<Path?, Path?> {
    val centre = 50.0; val radius = 38.0; val amp = 2.6; val waves = 12
    val turn = PI * 2; val top = -PI / 2
    val phase = t / 1000 * 1.6
    val swing = amp * min(1.0, value / .1) * max(0.0, min(1.0, (1 - value) / .05))
    fun at(p: Path, a: Double, r: Double, first: Boolean) { val x = (centre + r * cos(a)).toFloat(); val y = (centre + r * sin(a)).toFloat(); if (first) p.moveTo(x, y) else p.lineTo(x, y) }
    val reach = top + turn * value
    val wave = if (value > 0) Path().also { p ->
        val steps = max(2, ceil(240 * value.toDouble()).toInt())
        for (k in 0..steps) { val a = top + (reach - top) * (k.toDouble() / steps); at(p, a, radius + swing * sin((a - top) * waves - phase), k == 0) }
    } else null
    val gap = if (value > 0 && value < 1) .2 else 0.0
    val from = if (value > 0) reach + gap else top
    val to = top + turn - (if (value > 0) gap else 0.0)
    val track = if (to - from > .05) Path().also { p ->
        val steps = ceil(120 * (to - from) / turn).toInt() + 1
        for (k in 0..steps) at(p, from + (to - from) * (k.toDouble() / steps), radius, k == 0)
    } else null
    return wave to track
}

/**
 * The wavy ring for a real progress: InkProgress's brushed wave and wash
 * drawn round a circle, filling clockwise from the top as [progress] (0–1)
 * grows, as the website's InkRing. [percent] writes the value in its middle.
 * Never for a wait with no measure: that is InkLoader.
 */
@Composable
fun InkRing(progress: () -> Float, modifier: Modifier = Modifier, size: Dp = 96.dp, percent: Boolean = false, color: Color? = null, percentStyle: TextStyle = TextStyle.Default) {
    val tint = color ?: LocalInkTint.current ?: Night.suo
    var now by remember { mutableLongStateOf(0L) }
    LaunchedEffect(Unit) {
        val start = withFrameMillis { it }
        while (true) withFrameMillis { now = it - start }
    }
    val known = progress().coerceIn(0f, 1f)
    Box(modifier.size(size).semantics { progressBarRangeInfo = ProgressBarRangeInfo(known, 0f..1f) }, contentAlignment = Alignment.Center) {
        Canvas(Modifier.size(size)) {
            val (wave, track) = ringPaths(now.toDouble(), known)
            val weight = 7f
            inBox {
                track?.let { drawPath(inkBrush(it, InkRandom(7), weight * .8f, closed = false, lift = 60f..140f, gap = 4f..7f, swell = .25f, wander = .1f, step = 1.5f), tint, alpha = .24f) }
                wave?.let {
                    drawPath(inkBrush(it, InkRandom(12), weight * 1.9f, closed = false, lift = null, swell = .45f, wander = .3f, step = 1.5f), tint, alpha = .18f)
                    drawPath(inkBrush(it, InkRandom(11), weight, closed = false, lift = null, swell = .32f, wander = .12f, step = 1.5f), tint, alpha = .9f)
                }
            }
        }
        if (percent) Text("${(known * 100).toInt()}%", style = percentStyle)
    }
}

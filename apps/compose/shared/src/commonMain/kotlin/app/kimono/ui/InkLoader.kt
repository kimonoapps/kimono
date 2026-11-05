package app.kimono.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameMillis
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.semantics.ProgressBarRangeInfo
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.progressBarRangeInfo
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.floor
import kotlin.math.hypot
import kotlin.math.pow
import kotlin.math.sign
import kotlin.math.sin

/*
 * Material 3 Expressive's loading indicator, painted, as the website's
 * ink-loader.tsx: one shape morphs through Material's shapes (soft burst,
 * cookie, pentagon, pill, sunny, clover, oval) while it turns, washed in suō
 * with a broken plum brush edge. No disc behind it. Each shape is a radius
 * r(θ); the morph blends two of them.
 */

private val shapes: List<(Double) -> Double> = listOf(
    { t -> .86 + .14 * abs(cos(5 * t)).pow(.6) },
    { t -> .9 + .1 * cos(9 * t) },
    { t -> val k = PI / 5; val a = ((t % (2 * k)) + 2 * k) % (2 * k) - k; .7 * (cos(k) / cos(a)) + .27 },
    { t -> .62 / hypot(.62 * cos(t), sin(t)) },
    { t -> .9 + .1 * sign(cos(8 * t)) * abs(cos(8 * t)).pow(.45) },
    { t -> .76 + .24 * abs(cos(2 * t)).pow(1.6) },
    { t -> .8 / hypot(.8 * cos(t), sin(t)) },
)

private fun ease(x: Double) = if (x < .5) 4 * x * x * x else 1 - (-2 * x + 2).pow(3) / 2

/* In the 100 box: the website's 38 box, radius 17.5, scaled. */
private fun shapePath(i: Int, j: Int, mix: Double): Path = Path().apply {
    for (k in 0..120) {
        val t = k / 120.0 * PI * 2
        val r = (shapes[i](t) * (1 - mix) + shapes[j](t) * mix) * 46.0
        val x = (50 + r * cos(t)).toFloat(); val y = (50 + r * sin(t)).toFloat()
        if (k == 0) moveTo(x, y) else lineTo(x, y)
    }
    close()
}

private const val HOLD = 120.0
private const val MORPH = 520.0
private val loaderWash = inkWash(Color(0xFFEAB0BE), Color(0xFFCF7088), Color(0xFF8F3C52), Offset(50f, 60f), 70f)
private val loaderRim = Color(0xFF8F3C52)

/** The painted loader, for a screen that is slow to arrive. */
@Composable
fun InkLoader(modifier: Modifier = Modifier, size: Dp = 48.dp) {
    /* Suō in Kimono; inside an app, the app's own colour. */
    val tint = LocalInkTint.current
    val wash = remember(tint) { if (tint == null) loaderWash else inkWash(mix(tint, Color.White, .5f), tint, mix(tint, Color.Black, .3f), Offset(50f, 60f), 70f) }
    val rim = tint?.let { mix(it, Color.Black, .3f) } ?: loaderRim
    var now by remember { mutableLongStateOf(0L) }
    var angle by remember { mutableFloatStateOf(0f) }
    LaunchedEffect(Unit) {
        val start = withFrameMillis { it }
        var last = 0L
        while (true) withFrameMillis { frame ->
            val elapsed = frame - start
            val phase = elapsed % (HOLD + MORPH)
            val mix = if (phase < HOLD) 0.0 else ease((phase - HOLD) / MORPH)
            /* It turns steadily, and quicker while it changes shape. */
            angle = ((angle + (elapsed - last) * (.18 + .5 * (if (phase < HOLD) 0.0 else sin(mix * PI)))) % 360).toFloat()
            last = elapsed
            now = elapsed
        }
    }
    Canvas(modifier.size(size).semantics { contentDescription = "Loading"; progressBarRangeInfo = ProgressBarRangeInfo.Indeterminate }) {
        val elapsed = now.toDouble()
        val phase = elapsed % (HOLD + MORPH)
        val mix = if (phase < HOLD) 0.0 else ease((phase - HOLD) / MORPH)
        val current = floor(elapsed / (HOLD + MORPH)).toInt() % shapes.size
        val path = shapePath(current, (current + 1) % shapes.size, mix)
        val edge = inkBrush(path, InkRandom(21), 3.2f, closed = true, lift = 160f..220f, gap = 8f..12f, swell = .3f, wander = .15f, step = 1.4f)
        inBox(.79f) {
            rotate(angle, Offset(50f, 50f)) {
                drawWash(path, wash, rim, alpha = .95f, pool = .7f)
                drawPath(edge, InkPlum, alpha = .8f)
            }
        }
    }
}

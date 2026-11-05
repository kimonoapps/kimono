package app.kimono.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.height
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.clipRect
import androidx.compose.ui.semantics.ProgressBarRangeInfo
import androidx.compose.ui.semantics.progressBarRangeInfo
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import app.kimono.theme.Kata
import kotlin.math.PI
import kotlin.math.sin

/*
 * Kimono's progress bar: Material's wavy line, brushed. The whole stroke is laid
 * faintly as the track; as it fills, the brush goes over it in suō (inside an
 * app, the app's colour), pressing and easing along the wave.
 */

private class Strokes(val track: Path, val fill: Path)

private fun wave(size: Size, pad: Float): Path = Path().apply {
    val mid = size.height / 2; val amp = size.height * .22f; val length = 26f
    var x = pad
    moveTo(x, mid)
    while (x < size.width - pad) { x += 1.5f; lineTo(x, mid + amp * sin(x / length * 2 * PI).toFloat()) }
}

/** How far along something is, 0 to 1, as a brushed wave. */
@Composable
fun InkProgress(progress: () -> Float, modifier: Modifier = Modifier, color: Color? = null) {
    val tint = color ?: LocalInkTint.current ?: Kata.suo
    val cache = remember { mutableMapOf<Size, Strokes>() }
    val shown = progress().coerceIn(0f, 1f)
    Canvas(modifier.height(10.dp).semantics { progressBarRangeInfo = ProgressBarRangeInfo(shown, 0f..1f) }) {
        val pad = 3.dp.toPx()
        val strokes = cache.getOrPut(size) {
            val line = wave(size, pad)
            Strokes(
                track = inkBrush(line, InkRandom(7), 2.dp.toPx(), closed = false, lift = 60f..140f, gap = 5f..9f, swell = .25f, wander = .1f, step = 1.5f),
                fill = inkBrush(line, InkRandom(11), 3.2.dp.toPx(), closed = false, lift = null, swell = .32f, wander = .12f, step = 1.5f),
            )
        }
        drawPath(strokes.track, tint, alpha = .22f)
        val reach = pad + (size.width - 2 * pad) * shown
        if (shown > 0f) clipRect(right = reach) { drawPath(strokes.fill, tint, alpha = .9f) }
    }
}

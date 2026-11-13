package app.kimono.screens

import androidx.compose.animation.core.animate
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.FilterQuality
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.kimono.resources.Res
import app.kimono.theme.LocalNight
import app.kimono.ui.Seal
import app.kimono.ui.SealTone
import kotlinx.coroutines.launch
import org.jetbrains.compose.resources.ExperimentalResourceApi
import org.jetbrains.compose.resources.decodeToImageBitmap
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.floor
import kotlin.math.roundToInt

/*
 * 本 Silkscreen Kimono on the phone: someone reads on a Silkscreen e-reader in
 * Kimono's case. The case turns in the badge, drawn from a turntable of the
 * same model the web turns in three.js (files/silkscreen/, rendered from
 * apps/portal/public/models/silkscreen-kimono/): FRAMES views a full turn
 * round, scrubbed by a drag, drifting slowly unless motion is reduced. The
 * case is iandchasse's Silkscreen enclosure, CERN-OHL-S-2.0 (NOTICE beside it).
 */

private const val FRAMES = 36
private const val COLUMNS = 6
private val Moss = Color(0xFF5B6B3F)
private val months = listOf("January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December")

@OptIn(ExperimentalResourceApi::class)
@Composable
fun SilkscreenBadge(since: String, you: Boolean, still: Boolean) {
    val month = Regex("^(\\d{4})-(\\d{2})").find(since)?.destructured?.let { (y, m) -> "${months.getOrNull(m.toInt() - 1) ?: ""} $y".trim() }
    val night = LocalNight.current
    val ink = lerp(Moss, MaterialTheme.colorScheme.onSurface, if (night) .55f else .15f)
    val says = if (you) "You read on a Silkscreen Kimono" else "Reads on a Silkscreen Kimono"
    val sheet by produceState<ImageBitmap?>(null) { value = runCatching { Res.readBytes("files/silkscreen/turntable.webp").decodeToImageBitmap() }.getOrNull() }

    /* Where it is in the turn, in frames: 0 is the front, FRAMES / 2 the back. */
    var turn by remember { mutableFloatStateOf(-2.4f) }
    var held by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    LaunchedEffect(still, held, sheet) {
        if (still || held || sheet == null) return@LaunchedEffect
        var last = withFrameNanos { it }
        while (true) withFrameNanos { now -> turn += (now - last) / 1e9f * FRAMES * .055f; last = now }
    }
    val back = cos(turn / FRAMES * 2 * PI) < 0

    Row(
        Modifier.padding(top = 4.dp).clip(RoundedCornerShape(28.dp)).background(lerp(MaterialTheme.colorScheme.surface, Moss, if (night) .4f else .14f))
            .padding(start = 6.dp, end = 18.dp, top = 6.dp, bottom = 6.dp)
            .semantics(mergeDescendants = true) { contentDescription = says + (month?.let { " since $it" } ?: "") },
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Canvas(
            Modifier.size(104.dp, 140.dp).pointerInput(Unit) {
                detectHorizontalDragGestures(
                    onDragStart = { held = true }, onDragEnd = { held = false }, onDragCancel = { held = false },
                ) { change, dx -> change.consume(); turn += dx / 6.dp.toPx() }
            },
        ) {
            val bitmap = sheet ?: return@Canvas
            val w = bitmap.width / COLUMNS
            val h = bitmap.height / ((FRAMES + COLUMNS - 1) / COLUMNS)
            val f = (floor(turn).toInt() % FRAMES + FRAMES) % FRAMES
            val fit = minOf(size.width / w, size.height / h)
            val dw = (w * fit).roundToInt()
            val dh = (h * fit).roundToInt()
            drawImage(
                bitmap, srcOffset = IntOffset(f % COLUMNS * w, f / COLUMNS * h), srcSize = IntSize(w, h),
                dstOffset = IntOffset(((size.width - dw) / 2).roundToInt(), ((size.height - dh) / 2).roundToInt()), dstSize = IntSize(dw, dh),
                filterQuality = FilterQuality.Medium,
            )
        }
        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(if (you) says else "Silkscreen Kimono", style = MaterialTheme.typography.titleSmall, color = ink)
            month?.let { Text("since $it", style = MaterialTheme.typography.bodySmall, color = ink.copy(alpha = .75f)) }
            Seal(if (back) "Front" else "Turn over", compact = true, tone = SealTone.Quiet, enabled = sheet != null, modifier = Modifier.padding(top = 6.dp), onClick = {
                scope.launch {
                    held = true
                    val face = (turn / (FRAMES / 2f)).roundToInt() * (FRAMES / 2f)
                    animate(turn, face + FRAMES / 2f, animationSpec = tween(if (still) 0 else 700)) { v, _ -> turn = v }
                    held = false
                }
            })
            Text("Case by iandchasse · CERN-OHL-S-2.0", fontSize = 10.sp, color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = .75f), modifier = Modifier.padding(top = 2.dp))
        }
    }
}

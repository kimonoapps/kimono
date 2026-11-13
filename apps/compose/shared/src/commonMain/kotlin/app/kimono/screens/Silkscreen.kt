package app.kimono.screens

import androidx.compose.animation.core.animate
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
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
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import app.kimono.resources.Res
import app.kimono.ui.InkDialog
import app.kimono.ui.Seal
import app.kimono.ui.SealTone
import app.kimono.ui.kimonoIcon
import kotlinx.coroutines.launch
import org.jetbrains.compose.resources.ExperimentalResourceApi
import org.jetbrains.compose.resources.decodeToImageBitmap
import kotlin.math.floor
import kotlin.math.roundToInt

/*
 * 本 Silkscreen Kimono on the phone: someone reads on a Silkscreen e-reader in
 * Kimono's crimson case. Under their @name, the case turning beside a verified
 * line (no card); the line opens a sheet saying what it is, with the case
 * larger and its credit. The case is drawn from a turntable of the same model
 * the web turns in three.js (files/silkscreen/, rendered from
 * apps/portal/public/models/silkscreen-kimono/): FRAMES views a full turn
 * round, scrubbed by a drag, turned over by a tap, drifting slowly unless
 * motion is reduced. The case is iandchasse's Silkscreen enclosure,
 * CERN-OHL-S-2.0 (NOTICE beside it).
 */

private const val FRAMES = 36
private const val COLUMNS = 6
private val Crimson = Color(0xFFB0263C)
private val months = listOf("January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December")

@Composable
fun SilkscreenBadge(since: String, you: Boolean, name: String, still: Boolean, origin: String? = null) {
    val month = Regex("^(\\d{4})-(\\d{2})").find(since)?.destructured?.let { (y, m) -> "${months.getOrNull(m.toInt() - 1) ?: ""} $y".trim() }
    var open by remember { mutableStateOf(false) }

    Row(Modifier.padding(top = 4.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        Turntable(still, 66.dp, 88.dp)
        Column(
            Modifier.clip(RoundedCornerShape(12.dp)).clickable(role = Role.Button) { open = true }.padding(horizontal = 8.dp, vertical = 4.dp)
                .semantics(mergeDescendants = true) { contentDescription = "Silkscreen Kimono, verified" + (month?.let { ", since $it" } ?: "") },
            verticalArrangement = Arrangement.spacedBy(2.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Text("Silkscreen Kimono", style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.onSurface)
                Box(Modifier.size(20.dp).clip(CircleShape).background(Crimson), contentAlignment = Alignment.Center) {
                    Icon(kimonoIcon("check"), null, tint = Color(0xFFFFF4F1), modifier = Modifier.size(14.dp))
                }
            }
            Text("Verified" + (month?.let { " · since $it" } ?: ""), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
        }
    }

    if (open) {
        val uri = LocalUriHandler.current
        val who = if (you) "You read" else "${name.substringBefore(' ').ifBlank { name }} reads"
        InkDialog(title = "Silkscreen Kimono", icon = "reader", tint = Crimson, onDismiss = { open = false }, actions = {
            Seal("Close", compact = true, tone = SealTone.Quiet, onClick = { open = false })
        }) {
            Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) { Turntable(still, 150.dp, 200.dp) }
            Text("$who on a Silkscreen Kimono.", style = MaterialTheme.typography.bodyLarge.copy(fontWeight = FontWeight.Bold))
            Text(
                "Verified: paired with Kimono" + (month?.let { " since $it" } ?: "") + ", keeping ${if (you) "your" else "their"} place in Books.",
                style = MaterialTheme.typography.bodyLarge,
            )
            Text("The Silkscreen is an open-hardware e-reader. This one wears Kimono's case: crimson, with the branch and the wordmark on its back. Drag it to turn it.", style = MaterialTheme.typography.bodyLarge)
            Text(
                "Case: Silkscreen enclosure by iandchasse · CERN-OHL-S-2.0", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = if (origin != null) Modifier.clickable(role = Role.Button) { uri.openUri("$origin/models/silkscreen-kimono/NOTICE.txt") } else Modifier,
            )
        }
    }
}

/** The case turning: drag to spin it, tap to turn it over. */
@OptIn(ExperimentalResourceApi::class)
@Composable
private fun Turntable(still: Boolean, width: Dp, height: Dp) {
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
    /* Half a turn, to whichever face isn't showing, square on. */
    fun turnOver() = scope.launch {
        held = true
        val face = (turn / (FRAMES / 2f)).roundToInt() * (FRAMES / 2f)
        animate(turn, face + FRAMES / 2f, animationSpec = tween(if (still) 0 else 700)) { v, _ -> turn = v }
        held = false
    }
    Canvas(
        Modifier.size(width, height)
            .semantics { contentDescription = "Silkscreen Kimono" }
            .pointerInput(Unit) { detectTapGestures(onTap = { turnOver() }) }
            .pointerInput(Unit) {
                detectHorizontalDragGestures(
                    onDragStart = { held = true }, onDragEnd = { held = false }, onDragCancel = { held = false },
                ) { change, dx -> change.consume(); turn += dx / (width / 22).toPx() }
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
}

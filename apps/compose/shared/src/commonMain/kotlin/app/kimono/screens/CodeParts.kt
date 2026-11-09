@file:OptIn(ExperimentalMaterial3Api::class, ExperimentalMaterial3ExpressiveApi::class)

package app.kimono.screens

import app.kimono.ui.InkDialog
import app.kimono.ui.InkConfirm
import app.kimono.ui.InkTitle
import app.kimono.ui.InkSheet
import app.kimono.ui.InkMenuItem
import app.kimono.ui.InkMenu
import androidx.compose.ui.graphics.vector.rememberVectorPainter
import androidx.compose.ui.graphics.vector.addPathNodes
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.Image
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExperimentalMaterial3ExpressiveApi
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.layout.ContentScale
import coil3.compose.LocalPlatformContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import app.kimono.data.Code
import app.kimono.data.DriveSpace
import app.kimono.data.KimonoAppLink
import app.kimono.ui.InkBloom
import app.kimono.ui.InkCrest
import app.kimono.ui.kimonoIcon
import coil3.compose.AsyncImage
import coil3.request.ImageRequest
import coil3.svg.SvgDecoder
import kotlinx.coroutines.delay
import kotlin.time.Clock

/* What Kimono AI's phone screens share: clocks, marks for apps and spaces, rings, compact choices. */

internal fun now() = Clock.System.now().toEpochMilliseconds()

/** A clock that ticks every second while [running]. */
@Composable
internal fun ticking(running: Boolean): Long {
    val time by produceState(now(), running) { while (running) { value = now(); delay(1000) } }
    return time
}

/** Runs [block] again and again while the screen is in front. */
@Composable
internal fun WhileShown(key: Any?, block: suspend () -> Unit) {
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    LaunchedEffect(key, lifecycle) { lifecycle.repeatOnLifecycle(Lifecycle.State.RESUMED) { block() } }
}

internal fun whenText(at: Long, now: Long): String {
    val minutes = (now - at) / 60_000
    return when {
        minutes < 1 -> "now"
        minutes < 60 -> "${minutes}m"
        minutes < 60 * 24 -> "${minutes / 60}h"
        else -> "${minutes / (60 * 24)}d"
    }
}

/** When a limit starts again, from now: "in 3h 20m", "in 2 days". */
internal fun resetWords(at: Long?): String? {
    if (at == null) return null
    val minutes = ((at - now()) / 60_000).coerceAtLeast(1)
    return when {
        minutes < 60 -> "in ${minutes}m"
        minutes < 24 * 60 -> "in ${minutes / 60}h${if (minutes % 60 > 0) " ${minutes % 60}m" else ""}"
        else -> (minutes / (24 * 60)).let { "in $it ${if (it == 1L) "day" else "days"}" }
    }
}

/** Everything these screens open their marks from: Drive's own mark and each space's crest. */
class AiMarks(val driveApp: KimonoAppLink?, val spaces: List<DriveSpace>) {
    fun space(name: String) = spaces.firstOrNull { it.name.equals(name, ignoreCase = true) }
}

/** Kimono AI's own bloom. */
@Composable
internal fun AiMark(code: Code, size: Dp = 30.dp) {
    val app = code.appLink ?: return
    InkBloom(app.id, app.accent, app.glyph, size)
}

/** A line icon in a small watercolour blot, the way Kimono draws a list row's tile. */
@Composable
internal fun BlotIcon(icon: String, seed: String = icon, size: Dp = 36.dp, tint: androidx.compose.ui.graphics.Color? = null) {
    app.kimono.ui.InkBlot(seed, size = size, tint = tint ?: app.kimono.ui.LocalInkTint.current ?: app.kimono.theme.Kata.suo) {
        Icon(kimonoIcon(icon), null, modifier = Modifier.size(size / 2), tint = app.kimono.theme.Kata.ink)
    }
}

/** Kimono Drive's mark, small. */
@Composable
internal fun DriveMark(marks: AiMarks, size: Dp = 18.dp) {
    val drive = marks.driveApp
    if (drive != null) InkBloom(drive.id, drive.accent, drive.glyph, size + 4.dp)
    else Icon(kimonoIcon("folder"), null, modifier = Modifier.size(size))
}

/** A space, as a chip: its crest and its name. It opens the space in Drive. */
@Composable
internal fun SpaceChip(marks: AiMarks, name: String, open: (String) -> Unit) {
    val space = marks.space(name)
    Surface(
        onClick = { if (space != null) open("space/${space.id}") }, enabled = space != null,
        shape = CircleShape, color = MaterialTheme.colorScheme.secondaryContainer,
    ) {
        Row(Modifier.padding(start = 6.dp, end = 10.dp, top = 3.dp, bottom = 3.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(5.dp)) {
            if (space != null) InkCrest(space.crest, space.color, 16.dp)
            Text(name, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSecondaryContainer, maxLines = 1)
        }
    }
}

/** An app's own logo, as Composio draws it. */
@Composable
internal fun AppLogo(code: Code, slug: String, size: Dp = 20.dp, pro: Boolean = false) {
    val look by produceState(code.knownLook(slug), slug) { value = code.appLook(slug) }
    val logo = look?.logo
    if (!pro) {
        if (logo.isNullOrBlank()) Icon(kimonoIcon("gear"), null, modifier = Modifier.size(size)) else LogoImage(logo, size)
        return
    }
    /* A Pro Tool: the logo with a filled bolt on its top right. */
    Box(Modifier.size(size)) {
        if (logo.isNullOrBlank()) Icon(kimonoIcon("gear"), null, modifier = Modifier.size(size)) else LogoImage(logo, size)
        ProBolt(Modifier.align(Alignment.TopEnd).offset(x = size * 0.32f, y = -size * 0.32f).size(size * 0.7f))
    }
}

private const val boltPath = "M13.5 3 5.5 13.5h6L10.5 21l8-10.5h-6z"

/** The Pro Tools bolt, always filled, in the text's colour. */
internal val FilledBolt: ImageVector by lazy {
    ImageVector.Builder("bolt-filled", 24.dp, 24.dp, 24f, 24f).addPath(addPathNodes(boltPath), fill = SolidColor(Color.Black)).build()
}

/** A lightning bolt filled with the app's accent, cut out from the page by a ring of the surface: what marks a Pro Tool. */
@Composable
internal fun ProBolt(modifier: Modifier = Modifier) {
    val accent = MaterialTheme.colorScheme.primary
    val ring = MaterialTheme.colorScheme.surface
    val bolt = remember(accent, ring) {
        ImageVector.Builder("pro-bolt", 24.dp, 24.dp, 24f, 24f)
            .addPath(addPathNodes(boltPath), stroke = SolidColor(ring), strokeLineWidth = 5f, strokeLineJoin = StrokeJoin.Round)
            .addPath(addPathNodes(boltPath), fill = SolidColor(accent))
            .build()
    }
    Image(rememberVectorPainter(bolt), contentDescription = "Pro Tool", modifier = modifier)
}

@Composable
internal fun LogoImage(url: String, size: Dp) {
    val context = LocalPlatformContext.current
    var failed by remember(url) { mutableStateOf(false) }
    if (failed) { Icon(kimonoIcon("gear"), null, modifier = Modifier.size(size)); return }
    val request = remember(url, context) { ImageRequest.Builder(context).data(url).decoderFactory(SvgDecoder.Factory()).build() }
    AsyncImage(model = request, contentDescription = null, contentScale = ContentScale.Fit, modifier = Modifier.size(size).clip(RoundedCornerShape(size / 5)), onError = { failed = true })
}

/** An app's logo in a pale watercolour blot, for lists. */
@Composable
internal fun LogoTile(url: String?, size: Dp = 44.dp) {
    app.kimono.ui.InkBlot("logo-${url ?: ""}", size = size) {
        if (url.isNullOrBlank()) Icon(kimonoIcon("gear"), null, modifier = Modifier.size(size / 2)) else LogoImage(url, size * .52f)
    }
}

@Composable
internal fun AppName(code: Code, slug: String): String {
    val look by produceState(code.knownLook(slug), slug) { value = code.appLook(slug) }
    return look?.name ?: app.kimono.data.plainName(slug)
}

/** A ring that fills as something is used. Null is not known yet. */
@Composable
internal fun Ring(value: Double?, size: Dp = 20.dp) {
    val track = MaterialTheme.colorScheme.outlineVariant
    val v = (value ?: 0.0).coerceIn(0.0, 1.0)
    val arc = if (v >= .9) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.primary
    Canvas(Modifier.size(size)) {
        val stroke = this.size.minDimension * .16f
        val inset = stroke / 2
        val box = Size(this.size.width - stroke, this.size.height - stroke)
        drawArc(track, 0f, 360f, false, Offset(inset, inset), box, style = Stroke(stroke))
        if (v > 0) drawArc(arc, -90f, (v * 360).toFloat(), false, Offset(inset, inset), box, style = Stroke(stroke, cap = StrokeCap.Round))
    }
}

/** One choice of several, as a compact chip that opens a menu: a value, its label, and a line about it. */
class Option(val value: String, val label: String, val detail: String? = null)

@Composable
internal fun ChoiceChip(label: String?, value: String, options: List<Option>, enabled: Boolean = true, onChange: (String) -> Unit) {
    var open by remember { mutableStateOf(false) }
    val chosen = options.firstOrNull { it.value == value } ?: options.firstOrNull()
    Box {
        Surface(onClick = { open = true }, enabled = enabled, shape = CircleShape, color = MaterialTheme.colorScheme.surfaceContainerHigh) {
            Row(Modifier.padding(start = 12.dp, end = 8.dp, top = 6.dp, bottom = 6.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                if (label != null) Text(label, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Text(chosen?.label ?: "", style = MaterialTheme.typography.labelLarge, maxLines = 1)
                Icon(kimonoIcon("chevron"), null, modifier = Modifier.size(14.dp).padding(start = 2.dp))
            }
        }
        InkMenu(expanded = open, onDismissRequest = { open = false }) {
            options.forEach { option ->
                DropdownMenuItem(
                    text = {
                        Column {
                            Text(option.label, fontWeight = if (option.value == value) FontWeight.SemiBold else null)
                            option.detail?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                        }
                    },
                    trailingIcon = { if (option.value == value) Icon(kimonoIcon("check"), null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(18.dp)) },
                    onClick = { open = false; onChange(option.value) },
                )
            }
        }
    }
}

/** A quiet line in the timeline: an icon or mark, and what happened. */
@Composable
internal fun Note(icon: String?, text: String, modifier: Modifier = Modifier, failed: Boolean = false, lead: (@Composable () -> Unit)? = null, trailing: (@Composable () -> Unit)? = null) {
    Row(modifier.padding(vertical = 2.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        when {
            lead != null -> lead()
            icon != null -> Icon(kimonoIcon(icon), null, modifier = Modifier.size(16.dp), tint = if (failed) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Text(text, style = MaterialTheme.typography.bodyMedium, color = if (failed) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.weight(1f, fill = false))
        trailing?.invoke()
    }
}

/** A small text button inside a line. */
@Composable
internal fun TextLink(label: String, onClick: () -> Unit) {
    Text(label, style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.primary, fontWeight = FontWeight.SemiBold,
        modifier = Modifier.clip(RoundedCornerShape(6.dp)).clickable(onClick = onClick).padding(horizontal = 4.dp, vertical = 2.dp), maxLines = 1, overflow = TextOverflow.Ellipsis)
}

internal val quietGrey = Color(0xFFB9A8A2)

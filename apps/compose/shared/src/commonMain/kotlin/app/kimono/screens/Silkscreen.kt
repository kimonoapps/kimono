package app.kimono.screens

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
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.RoundRect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Matrix
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.graphics.drawscope.withTransform
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.kimono.resources.Res
import app.kimono.resources.shippori_mincho_semibold
import app.kimono.ui.InkDialog
import app.kimono.ui.Seal
import app.kimono.ui.SealTone
import app.kimono.ui.kimonoIcon
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.roundToInt
import kotlin.math.sin
import kotlin.math.sqrt
import kotlin.math.tan
import org.jetbrains.compose.resources.Font

/*
 * 本 Silkscreen Kimono on the phone: someone reads on a Silkscreen e-reader in
 * Kimono's crimson case. Under their @name, the case turning beside a verified
 * line (no card); the line opens a sheet saying what it is, with the case
 * larger and its credit. The case is drawn live from the measurements of the
 * model the web turns in three.js (apps/portal/public/models/silkscreen-kimono/):
 * spun by a drag, turned over by a tap, drifting slowly unless motion is
 * reduced. The case is iandchasse's Silkscreen enclosure, CERN-OHL-S-2.0
 * (files/silkscreen/NOTICE.txt).
 */

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
            Text("The Silkscreen is an open-hardware e-reader. Drag it to turn it.", style = MaterialTheme.typography.bodyLarge)
            Text(
                "Case: Silkscreen enclosure by iandchasse · CERN-OHL-S-2.0", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = if (origin != null) Modifier.clickable(role = Role.Button) { uri.openUri("$origin/models/silkscreen-kimono/NOTICE.txt") } else Modifier,
            )
        }
    }
}

/*
 * The case, drawn: the phone has no 3D renderer, so the model is told as flat
 * parts set in space, each face put in perspective by a matrix, the way Books
 * tilts a cover. The front (bezel, page, bottom keys) and the back (the branch
 * and the wordmark) are drawn square on and projected; between them, the case's
 * edge is the outline repeated slice by slice through its thickness, with the
 * side keys standing out of it. Everything is in the model's millimetres (X
 * right, Y up, Z toward the screen), as make_model.py builds it, seen and lit as
 * silkscreen-scene.ts sees and lights it: the same camera, tilt, lights, start
 * and drift, so the phone's case is the web's.
 */
private const val LEFT = -4.1f
private const val TOP = 115.6f
private const val WIDE = 68.2f
private const val TALL = 125f
private const val BACK = -6.7f
private const val FRONT = 6f
private const val CORNER = 6f
private const val SLICES = 24
private val Centre = V(30f, 53.1f, .35f)
private val Camera = V(0f, 7.5f, 303.2f)
private const val TILT = -8f * PI.toFloat() / 180f
private const val HALF_FOV = 13f * PI.toFloat() / 180f
private const val DRIFT = .35f

private val TubAlbedo = Color(0xFFB0263C)
private val LidAlbedo = Color(0xFFA12236)
private val MarkAlbedo = Color(0xFFFFF4F1)
private val DisplayAlbedo = Color(0xFF2F2E2C)
private val PageAlbedo = Color(0xFFE9E7E1)
private val InkAlbedo = Color(0xFF86837C)

private class V(val x: Float, val y: Float, val z: Float) {
    operator fun plus(o: V) = V(x + o.x, y + o.y, z + o.z)
    operator fun minus(o: V) = V(x - o.x, y - o.y, z - o.z)
    operator fun times(s: Float) = V(x * s, y * s, z * s)
    infix fun dot(o: V) = x * o.x + y * o.y + z * o.z
    fun unit() = this * (1f / sqrt(this dot this))
}

/* The camera looks at the middle from a little above: its right is X, its up and forward lean with it. */
private val Forward = (V(0f, 0f, 0f) - Camera).unit()
private val Up = V(0f, -Forward.z, Forward.y)

/* The web's lights (three.js, linear light, divided by π as its Lambert does). */
private fun lin(c: Float) = if (c <= .04045f) c / 12.92f else ((c + .055f) / 1.055f).pow(2.4f)
private fun srgb(c: Float) = (if (c <= .0031308f) c * 12.92f else 1.055f * c.pow(1 / 2.4f) - .055f).coerceIn(0f, 1f)
private val Sky = V(1f, lin(0xFA / 255f), lin(0xF2 / 255f))
private val Ground = V(lin(0x8A / 255f), lin(0x84 / 255f), lin(0x78 / 255f))
private val Key = V(2.5f, 3f, 4f).unit()
private val Rim = V(-3f, 1.5f, -4f).unit()
private val RimColour = V(1f, lin(0xF1 / 255f), lin(0xE6 / 255f))

private fun ggx(n: V, l: V, v: V, rough: Float): Float {
    val nl = n dot l
    val nv = n dot v
    if (nl <= 0f || nv <= 0f) return 0f
    val h = (l + v).unit()
    val a = rough * rough
    val nh = (n dot h).coerceAtLeast(0f)
    val d = a * a / (PI.toFloat() * (nh * nh * (a * a - 1) + 1).pow(2))
    val k = a / 2
    val vis = 1f / (4f * (nl * (1 - k) + k) * (nv * (1 - k) + k))
    val f = .04f + .96f * (1 - (v dot h).coerceIn(0f, 1f)).pow(5)
    return d * vis * f * nl
}

/**
 * A surface of [albedo] facing [n], seen along [v] (toward the eye), lit as on the web. three.js reads a glTF colour
 * factor as linear, so the case's colours are taken as they are; only the page, a texture, is sRGB ([texture]).
 */
private fun shade(albedo: Color, n: V, v: V, rough: Float = .58f, texture: Boolean = false): Color {
    fun a(c: Float) = if (texture) lin(c) else c
    val t = .5f * n.y + .5f
    val hemi = (Ground * (1 - t) + Sky * t) * 1.5f
    val key = 2.2f * (n dot Key).coerceAtLeast(0f)
    val rim = 1.1f * (n dot Rim).coerceAtLeast(0f)
    val e = (hemi + V(.35f, .35f, .35f) + V(key, key, key) + RimColour * rim) * (1f / PI.toFloat())
    val spec = 2.2f * ggx(n, Key, v, rough) + 1.1f * ggx(n, Rim, v, rough)
    return Color(srgb(a(albedo.red) * e.x + spec), srgb(a(albedo.green) * e.y + spec), srgb(a(albedo.blue) * e.z + spec))
}

/** The case turning: drag to spin it, tap to turn it over. */
@Composable
private fun Turntable(still: Boolean, width: Dp, height: Dp) {
    /* Radians about the upright, as the web's turn.rotation.y: 0 is the front square on. */
    var angle by remember { mutableFloatStateOf(-24f * PI.toFloat() / 180f) }
    val motion = remember { object { var speed = 0f; var target: Float? = null; var dragging = false } }
    /* Whether it has somewhere to go while motion is reduced: a fling running out. */
    var busy by remember { mutableStateOf(false) }
    LaunchedEffect(still, busy) {
        if (still && !busy) return@LaunchedEffect
        var last = withFrameNanos { it }
        while (true) {
            val settled = withFrameNanos { now ->
                val dt = min(.05f, (now - last) / 1e9f)
                last = now
                val t = motion.target
                if (t != null) {
                    val left = t - angle
                    angle += left * min(1f, dt * 6)
                    if (abs(left) < .002f) { angle = t; motion.target = null }
                } else if (!motion.dragging) {
                    motion.speed *= .04f.pow(dt)
                    angle += (motion.speed + if (still) 0f else DRIFT) * dt
                }
                motion.target == null && !motion.dragging && abs(motion.speed) < .01f
            }
            if (still && settled) { busy = false; return@LaunchedEffect }
        }
    }
    /* Half a turn, to whichever face isn't showing, square on. */
    fun turnOver() {
        val to = (angle / PI.toFloat()).roundToInt() * PI.toFloat() + PI.toFloat()
        motion.speed = 0f
        if (still) angle = to else motion.target = to
    }

    val measurer = rememberTextMeasurer()
    val mincho = FontFamily(Font(Res.font.shippori_mincho_semibold, FontWeight.SemiBold))
    val word = remember(measurer, mincho) { measurer.measure("kimono", TextStyle(fontFamily = mincho, fontWeight = FontWeight.SemiBold, fontSize = 40.sp)) }
    val look = remember { CaseLook() }

    Canvas(
        Modifier.size(width, height)
            .semantics { contentDescription = "Silkscreen Kimono" }
            .pointerInput(still) { detectTapGestures(onTap = { turnOver() }) }
            .pointerInput(still) {
                detectHorizontalDragGestures(
                    onDragStart = { motion.dragging = true; motion.target = null; motion.speed = 0f },
                    onDragEnd = { motion.dragging = false; busy = true },
                    onDragCancel = { motion.dragging = false },
                ) { change, dx ->
                    change.consume()
                    val step = dx / density * .03f
                    angle += step
                    motion.speed = step / ((change.uptimeMillis - change.previousUptimeMillis).coerceAtLeast(1) / 1000f)
                }
            },
    ) { drawCase(angle, look, word) }
}

/** The parts' outlines, made once, in face millimetres (from the face's top-left, down the page). */
private class CaseLook {
    val outline = Path().apply { addRoundRect(RoundRect(0f, 0f, WIDE, TALL, CornerRadius(CORNER))) }
    /* Side keys: through the right wall (three) and the left (two), from the back up to just short of the front. */
    val sideKeys = listOf(65.2f to 48.9f, 65.2f to 28.3f, 65.2f to 9.6f, -1.2f to 48.9f, -1.2f to 24.6f)
        .zip(listOf(17.2f, 17f, 16.2f, 20.7f, 20.7f)) { (u, w), tall -> Rect(u, w, u + 4.2f, w + tall) }
    val bottomKeys = listOf(10.6f, 22.6f, 35.6f, 47.6f).map { Rect(it, 119.8f, it + 10f, 124f) }
    val page = Rect(6.3f, 7.7f, 61.9f, 100.5f)
    /* A page of text as the e-paper shows it: a heading, justified lines, a paragraph's short last line, the folio. */
    val lines = buildList {
        add(Rect(28.1f, 8.1f, 40.1f, 9.2f))
        var w = 14.6f
        var n = 0
        while (w < 92f) {
            val short = n % 7 == 6
            add(Rect(11.3f, w, if (short) 33f else 56.9f, w + .75f))
            w += 3.34f
            n++
        }
        add(Rect(33.5f, 96.2f, 34.7f, 97f))
    }
}

private fun DrawScope.drawCase(angle: Float, look: CaseLook, word: TextLayoutResult) {
    val cy = cos(angle); val sy = sin(angle); val cx = cos(TILT); val sx = sin(TILT)
    /* Turned about the upright, then tipped back, as the web's group turns. */
    fun turned(p: V): V {
        val x = p.x * cy + p.z * sy
        val z = -p.x * sy + p.z * cy
        return V(x, p.y * cx - z * sx, p.y * sx + z * cx)
    }
    val k = size.height / 2 / tan(HALF_FOV)
    val m = Matrix()
    /* The plane through model point [o], u along [e1] and w along [e2], into the canvas: a projective map. */
    fun face(o: V, e1: V, e2: V): Matrix {
        fun h(p: V, point: Boolean): FloatArray {
            val q = if (point) p - Camera else p
            val x = q.x; val y = q dot Up; val d = q dot Forward
            return floatArrayOf(size.width / 2 * d + k * x, size.height / 2 * d - k * y, d)
        }
        val a = h(turned(e1), false); val b = h(turned(e2), false); val c = h(turned(o - Centre), true)
        m.reset()
        m.values[0] = a[0]; m.values[1] = a[1]; m.values[3] = a[2]
        m.values[4] = b[0]; m.values[5] = b[1]; m.values[7] = b[2]
        m.values[12] = c[0]; m.values[13] = c[1]; m.values[15] = c[2]
        return m
    }
    val toEye = (Camera - turned(V(30f, 53.1f, 0f) - Centre)).unit()
    val frontNormal = turned(V(0f, 0f, 1f))
    val frontShowing = (frontNormal dot toEye) > 0f
    /* The edge facing you more, for the slices' light. */
    val right = turned(V(1f, 0f, 0f))
    val side = if ((right dot toEye) > 0f) right else right * -1f
    val right1 = V(1f, 0f, 0f); val down = V(0f, -1f, 0f)

    /* The edge: the outline at each depth, farthest first, the side keys standing out of the walls. */
    for (i in 0..SLICES) {
        val f = i / SLICES.toFloat()
        val z = if (frontShowing) BACK + (FRONT - BACK) * f else FRONT - (FRONT - BACK) * f
        withTransform({ transform(face(V(LEFT, TOP, z), right1, down)) }) {
            if (z < .6f) look.sideKeys.forEach { drawRoundRect(shade(MarkAlbedo, side, toEye, .5f), it.topLeft, it.size, CornerRadius(.8f)) }
            drawPath(look.outline, shade(if (z < -1.4f) LidAlbedo else TubAlbedo, side, toEye))
        }
    }
    if (frontShowing) withTransform({ transform(face(V(LEFT, TOP, FRONT), right1, down)) }) {
        drawPath(look.outline, shade(TubAlbedo, frontNormal, toEye))
        val window = Rect(look.page.left - 1.2f, look.page.top - 1.2f, look.page.right + 1.2f, look.page.bottom + 1.2f)
        drawRoundRect(shade(DisplayAlbedo, frontNormal, toEye, .4f), window.topLeft, window.size, CornerRadius(1.2f))
        val paper = shade(PageAlbedo, frontNormal, toEye, .9f, texture = true)
        drawRect(paper, look.page.topLeft, look.page.size)
        val ink = lerp(paper, shade(InkAlbedo, frontNormal, toEye, .9f, texture = true), .35f)
        look.lines.forEach { drawRect(ink, it.topLeft, it.size) }
        val key = shade(MarkAlbedo, frontNormal, toEye, .5f)
        look.bottomKeys.forEach { drawRoundRect(key, it.topLeft, it.size, CornerRadius(1f)) }
    } else withTransform({ transform(face(V(LEFT + WIDE, TOP, BACK), V(-1f, 0f, 0f), down)) }) {
        val backNormal = frontNormal * -1f
        drawPath(look.outline, shade(LidAlbedo, backNormal, toEye, .62f))
        val mark = shade(MarkAlbedo, backNormal, toEye, .55f)
        /* The branch, 18 mm across, its blossom up and right, as inlaid. */
        translate(25f, 53.9f) {
            scale(18.1f / 111f, pivot = Offset.Zero) {
                translate(-1f, -12f) { BranchParts.forEach { drawPath(it, mark) } }
            }
        }
        /* The wordmark under it, 22 mm across. */
        val s = 22.4f / word.size.width
        translate(22.9f, 110.65f - word.size.height * s / 2) { scale(s, pivot = Offset.Zero) { drawText(word, color = mark) } }
    }
}

/* Kimono's branch, as KimonoBranchVector draws it, as paths in the website's coordinates. */
private val BranchParts: List<Path> by lazy {
    val petal = "M50 48 C36 39 31 21 41 9 C45 4 50 2 50 2 C55 4 59 7 62 11 C69 22 63 39 50 48Z"
    val stems = listOf(
        "M2 108 C26 98 43 84 55 66 C62 55 71 47 79 43 L81 47 C73 51 66 60 59 72 C47 90 30 106 6 116Z",
        "M56 69 C55 61 52 54 47 47 L50 44 C56 51 59 59 59.5 66Z",
        "M27 97 C40 96 51 100 58 108 L55 111 C49 104 39 100 27 100Z",
    ).map { PathParser().parsePathString(it).toPath() }
    val blossom = (listOf(0f, 72f, 144f, 216f, 288f).map { deg ->
        PathParser().parsePathString(petal).toPath().apply { transform(Matrix().apply { translate(50f, 50f); rotateZ(deg); translate(-50f, -50f) }) }
    } + Path().apply { addOval(Rect(Offset(50f, 50f), 13f)) }).onEach {
        it.transform(Matrix().apply { translate(83f, 41f); scale(.55f, .55f); translate(-50f, -50f) })
    }
    stems + blossom
}

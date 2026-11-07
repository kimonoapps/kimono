package app.kimono.ui

import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathMeasure
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.clipPath
import androidx.compose.ui.graphics.drawscope.withTransform
import androidx.compose.ui.graphics.lerp
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.sin

/*
 * 墨 Ink and wash — how Kimono draws its marks, as on the website
 * (packages/ui/src/ink.ts, design/specimens/13-ink-and-wash.html).
 *
 * A plum brush line that swells, thins and lifts off, over a watercolour wash
 * that pools at the rim. Ink is for marks only: blooms, crests, portraits,
 * petals, rings, dots and blots. Controls, cards and text stay clean.
 *
 * The website wobbles its lines with SVG turbulence filters. Those don't exist
 * on a phone, so here the hand is in the geometry: every mark is seeded, its
 * points nudged, and a brush line is drawn as a filled shape whose width
 * breathes along its length. Plain Compose paths and gradients, so Android
 * and iPhone draw the very same marks.
 *
 * Every mark is drawn in a 100-unit box and scaled to its size.
 */

val InkPlum = Color(0xFF4E2B37)
/** The paper at the heart of a wash. */
val InkPaper = Color(0xFFFFF8F4)

/** A small, seedable random source (mulberry32, as the website's inkRandom), so a mark is hand-drawn but the same every time. */
class InkRandom(seed: Int) {
    private var state = seed
    fun next(): Float {
        state += 0x6d2b79f5
        var r = state
        r = (r xor (r ushr 15)) * (r or 1)
        r = r xor (r + (r xor (r ushr 7)) * (r or 61))
        return ((r xor (r ushr 14)).toUInt().toDouble() / 4294967296.0).toFloat()
    }
    fun between(low: Float, high: Float) = low + next() * (high - low)
}

/** Seeds from a string (FNV-1a, as the website), so the same thing is drawn the same way everywhere. */
fun inkSeed(text: String): Int {
    var hash = 2166136261.toInt()
    for (c in text) { hash = hash xor c.code; hash *= 16777619 }
    return hash
}

fun inkHex(hex: String): Color {
    val v = hex.removePrefix("#").let { if (it.length == 3) it.map { c -> "$c$c" }.joinToString("") else it }
    return Color(0xFF000000 or v.take(6).toLong(16))
}

fun mix(a: Color, b: Color, t: Float): Color = lerp(a, b, t)

/* ── shapes ── */

private fun mid(p: Offset, q: Offset) = Offset((p.x + q.x) / 2, (p.y + q.y) / 2)

/** A smooth closed path through [points], curving through the midpoints. */
fun smoothClosed(points: List<Offset>): Path = Path().apply {
    val n = points.size
    val start = mid(points[n - 1], points[0])
    moveTo(start.x, start.y)
    for (i in 0 until n) {
        val p = points[i]; val m = mid(p, points[(i + 1) % n])
        quadraticTo(p.x, p.y, m.x, m.y)
    }
    close()
}

/** A smooth open path through [points]. */
fun smoothOpen(points: List<Offset>): Path = Path().apply {
    moveTo(points[0].x, points[0].y)
    for (i in 1 until points.size - 1) {
        val p = points[i]; val m = mid(p, points[i + 1])
        quadraticTo(p.x, p.y, m.x, m.y)
    }
    lineTo(points.last().x, points.last().y)
}

/** An open brush ring round ([cx], [cy]): an ensō with a gap where the brush lifted. */
fun inkRing(random: InkRandom, radius: Float, gap: Float, cx: Float = 50f, cy: Float = 50f, wobble: Float = .015f): Path {
    val a0 = random.between(0f, (PI * 2).toFloat())
    val a1 = a0 + (PI * 2).toFloat() - gap
    val points = (0..40).map { k ->
        val t = a0 + (a1 - a0) * k / 40f
        val r = radius * random.between(1 - wobble, 1 + wobble)
        Offset(cx + r * cos(t), cy + r * sin(t))
    }
    return smoothOpen(points)
}

/** A watercolour puddle round ([cx], [cy]): soft lobes, never a circle. */
fun inkBlot(random: InkRandom, cx: Float, cy: Float, radius: Float, lobes: Int = 9, low: Float = .8f, high: Float = 1.08f): Path {
    val phase = random.between(0f, (PI * 2).toFloat())
    val points = List(lobes) { i ->
        val t = i.toFloat() / lobes * (PI * 2).toFloat() + phase
        val r = radius * random.between(low, high)
        Offset(cx + r * cos(t), cy + r * sin(t))
    }
    return smoothClosed(points)
}

/** A sakura petal, never the same twice: notched tip, narrow base, every point nudged. In the 100 box, tip up. */
fun inkPetal(random: InkRandom): Path {
    val w = random.between(.86f, 1.08f); val notch = random.between(7f, 15f); val lean = random.between(-6f, 6f); val curl = random.between(-5f, 5f)
    fun p(x: Float, y: Float) = Offset(x + random.between(-1.8f, 1.8f), y + random.between(-1.8f, 1.8f))
    val path = Path()
    val s = p(50f, 94f); path.moveTo(s.x, s.y)
    fun c(a: Offset, b: Offset, e: Offset) = path.cubicTo(a.x, a.y, b.x, b.y, e.x, e.y)
    c(p(50 - 20 * w, 86f), p(50 - 38 * w + curl, 62f), p(50 - 34 * w + lean, 34f))
    c(p(50 - 30 * w + lean, 16f), p(50 - 16 * w + lean, 7f), p(43 + lean, 9f))
    c(p(46 + lean, 10f), p(48 + lean, 8 + notch * .6f), p(50 + lean * .6f, 8 + notch))
    c(p(52 + lean, 8 + notch * .6f), p(54 + lean, 10f), p(57 + lean, 9f))
    c(p(50 + 16 * w + lean, 7f), p(50 + 30 * w + lean, 16f), p(50 + 34 * w + lean, 34f))
    c(p(50 + 38 * w - curl, 62f), p(50 + 20 * w, 86f), p(50f, 94f))
    path.close()
    return path
}

/** A circle as one closed contour, for the brush to follow. */
fun circlePath(cx: Float, cy: Float, r: Float, random: InkRandom? = null, wobble: Float = 0f): Path {
    val points = List(24) { k ->
        val t = k / 24f * (PI * 2).toFloat()
        val rr = r * (if (random != null) random.between(1 - wobble, 1 + wobble) else 1f)
        Offset(cx + rr * cos(t), cy + rr * sin(t))
    }
    return smoothClosed(points)
}

/* ── the brush ── */

/**
 * A brush line along [path], as a filled shape: it swells and thins as the
 * brush presses and eases, tapers where it lands and lifts, wanders a little
 * off the line, and breaks where the brush left the paper.
 *
 * [width] is the line's mean weight in the path's units; [lift] is the run
 * of line between breaks (null: never breaks); [gap] how long a break is.
 * Only the path's first contour is followed.
 */
fun inkBrush(
    path: Path,
    random: InkRandom,
    width: Float,
    closed: Boolean,
    lift: ClosedFloatingPointRange<Float>? = 70f..120f,
    gap: ClosedFloatingPointRange<Float> = 4f..9f,
    swell: Float = .38f,
    wander: Float = .22f,
    step: Float = .9f,
    tip: Float = .3f,
    wave: Float = 1f,
    shake: Float = 0f,
): Path {
    val measure = PathMeasure().apply { setPath(path, false) }
    val length = measure.length
    val out = Path()
    if (length <= 0f) return out
    /* Slow, seeded waves for the pressure and the drift off the line. */
    val f1 = random.between(.05f, .09f) * wave; val f2 = random.between(.13f, .21f) * wave; val f3 = random.between(.03f, .06f) * wave
    val p1 = random.between(0f, 6.28f); val p2 = random.between(0f, 6.28f); val p3 = random.between(0f, 6.28f)
    /* A quick tremor off the line, as the website's turbulence filter gives its icons. */
    val f4 = if (shake > 0f) random.between(1.1f, 1.6f) else 0f; val p4 = if (shake > 0f) random.between(0f, 6.28f) else 0f
    fun pressure(d: Float) = 1f + swell * (.65f * sin(d * f1 + p1) + .35f * sin(d * f2 + p2))
    fun drift(d: Float) = width * wander * sin(d * f3 + p3) + (if (shake > 0f) shake * (.6f * sin(d * f4 + p4) + .4f * sin(d * f4 * 2.3f + p4 * 1.7f)) else 0f)

    /* Runs of line: where the brush is on the paper. */
    val runs = mutableListOf<Pair<Float, Float>>()
    if (lift == null) {
        runs += 0f to length
    } else {
        var at = if (closed) random.between(0f, length) else 0f
        val end = if (closed) at + length else length
        while (at < end) {
            val run = random.between(lift.start, lift.endInclusive)
            val stop = min(at + run, end)
            if (stop - at > width * 1.5f) runs += at to stop
            at = stop + random.between(gap.start, gap.endInclusive)
        }
        /* An open line keeps its ends: the last run reaches the end. */
        if (!closed && runs.isNotEmpty() && runs.last().second < length - gap.endInclusive) runs += runs.last().second + gap.start to length
    }
    for ((a, b) in runs) {
        val span = b - a
        val count = max(3, (span / step).roundToInt())
        val taper = min(width * 2.2f, span * .3f)
        val left = ArrayList<Offset>(count + 1); val right = ArrayList<Offset>(count + 1)
        for (k in 0..count) {
            val d = a + span * k / count
            val dd = if (closed) ((d % length) + length) % length else d.coerceIn(0f, length)
            val pos = measure.getPosition(dd)
            val tan = measure.getTangent(dd).let { val l = hypot(it.x, it.y); if (l == 0f) Offset(1f, 0f) else Offset(it.x / l, it.y / l) }
            val normal = Offset(-tan.y, tan.x)
            val fromEnd = min(d - a, b - d)
            val ease = if (taper <= 0f) 1f else (tip + (1 - tip) * smooth((fromEnd / taper).coerceIn(0f, 1f)))
            val half = width * pressure(d) * ease / 2
            val centre = pos + normal * drift(d)
            left += centre + normal * half
            right += centre - normal * half
        }
        out.moveTo(left[0].x, left[0].y)
        for (i in 1 until left.size) out.lineTo(left[i].x, left[i].y)
        for (i in right.indices.reversed()) out.lineTo(right[i].x, right[i].y)
        out.close()
    }
    return out
}

private fun smooth(x: Float) = x * x * (3 - 2 * x)

/** A brush line with the website's weights: a little heavier or lighter each time, lifting off now and then. */
fun inkBrushLine(path: Path, random: InkRandom, weight: Float = 1f, closed: Boolean = true): Path =
    inkBrush(path, random, random.between(2.2f, 3.2f) * weight, closed)

/* ── the wash ── */

/** A wash: paper at the heart, the colour gathering towards the rim. */
fun inkWash(light: Color, mid: Color, deep: Color, center: Offset, radius: Float, paper: Color = InkPaper, heart: Float = .5f): Brush =
    Brush.radialGradient(0f to paper, heart to light, .9f to mid, 1f to deep, center = center, radius = radius)

/** A tint washed on paper: light, mid and rim tones of one colour. */
fun inkTintWash(tint: Color, center: Offset, radius: Float, strength: Float = 1f): Brush =
    inkWash(mix(tint, Color.White, 1 - .3f * strength), mix(tint, Color.White, 1 - .58f * strength), mix(tint, Color.White, 1 - .92f * strength), center, radius)

/**
 * Lays a wash over [path]: the colour, then the rim where watercolour pools
 * as it dries, darker just inside the edge, with a faint bleed beyond it.
 */
fun DrawScope.drawWash(path: Path, brush: Brush, rim: Color, alpha: Float = .92f, pool: Float = 1f) {
    drawPath(path, brush, alpha = alpha)
    clipPath(path) {
        drawPath(path, rim, alpha = .16f * pool * alpha, style = Stroke(width = 5f))
        drawPath(path, rim, alpha = .22f * pool * alpha, style = Stroke(width = 1.8f))
    }
    drawPath(path, rim, alpha = .07f * pool * alpha, style = Stroke(width = 1.4f))
}

/** Draws [block] in a 100-unit box fitted to this draw scope, grown by [grow] round its centre. */
inline fun DrawScope.inBox(grow: Float = 1f, block: DrawScope.() -> Unit) {
    val s = min(size.width, size.height) / 100f * grow
    val dx = (size.width - 100f * s) / 2; val dy = (size.height - 100f * s) / 2
    withTransform({ translate(dx, dy); scale(s, s, pivot = Offset.Zero) }) { block() }
}

/* ── colour ── */

/** An app's colours from its one accent, as the website's accentRamp. */
class AccentRamp(val tint: Color, val soft: Color, val deep: Color)

fun accentRamp(accent: String): AccentRamp {
    val c = inkHex(accent)
    val r = c.red; val g = c.green; val b = c.blue
    val mx = maxOf(r, g, b); val mn = minOf(r, g, b)
    val l = (mx + mn) / 2
    var h = 0f; var s = 0f
    if (mx != mn) {
        val d = mx - mn
        s = if (l > .5f) d / (2 - mx - mn) else d / (mx + mn)
        h = 60f * when (mx) { r -> (g - b) / d + (if (g < b) 6 else 0); g -> (b - r) / d + 2; else -> (r - g) / d + 4 }
    }
    val sat = s.coerceIn(.18f, .82f)
    return AccentRamp(
        tint = hsl(h, (sat * .7f).coerceIn(.16f, .55f), .9f),
        soft = hsl(h, (sat * .95f).coerceIn(.3f, .7f), .62f),
        deep = hsl((h + 6) % 360, (sat * 1.2f).coerceIn(.42f, .8f), .32f),
    )
}

private fun hsl(h: Float, s: Float, l: Float): Color {
    val chroma = (1 - abs(2 * l - 1)) * s
    val x = chroma * (1 - abs((h / 60) % 2 - 1))
    val m = l - chroma / 2
    val (r, g, b) = when {
        h < 60 -> Triple(chroma, x, 0f); h < 120 -> Triple(x, chroma, 0f); h < 180 -> Triple(0f, chroma, x)
        h < 240 -> Triple(0f, x, chroma); h < 300 -> Triple(x, 0f, chroma); else -> Triple(chroma, 0f, x)
    }
    return Color(r + m, g + m, b + m)
}

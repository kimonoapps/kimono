package app.kimono.ui

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import app.kimono.theme.Kata

/*
 * The ink marks themselves, as the website's ink-marks.tsx and ink.css:
 * blots behind row icons, portrait frames, petals, and every small circle
 * (status dots, rule rings, the ring round a chosen thing).
 */

/**
 * A watercolour blot behind a line icon: the icon tile of a list row. Each
 * blot is its own puddle, seeded by what it belongs to and tinted by role.
 * [strong] is full colour, for a swatch rather than a tile.
 */
@Composable
fun InkBlot(seed: String, modifier: Modifier = Modifier, tint: Color = LocalInkTint.current ?: Kata.suo, size: Dp = 40.dp, strong: Boolean = false, content: @Composable BoxScope.() -> Unit = {}) {
    val marks = remember(seed) {
        val random = InkRandom(inkSeed(seed))
        val blot = inkBlot(random, 50f, 50f, 45f)
        /* Where the pigment settled as it dried: a paler heart off to one side, and a second, smaller pool. */
        val heart = Offset(50f + random.between(-9f, 9f), 50f + random.between(-9f, 9f))
        val pool = inkBlot(random, 50f + random.between(-12f, 12f), 50f + random.between(-12f, 12f), random.between(14f, 22f), lobes = 7)
        Triple(blot, heart, pool)
    }
    val wash = remember(seed, tint, strong) {
        if (strong) inkWash(mix(tint, Color.White, .15f), tint, mix(tint, Color.Black, .15f), marks.second, 64f, paper = mix(tint, Color.White, .12f), heart = .6f)
        else inkWash(mix(tint, Color.White, .74f), mix(tint, Color.White, .5f), mix(tint, Color.White, .2f), marks.second, 64f, paper = mix(tint, Color.White, .88f))
    }
    Box(
        modifier.size(size).drawBehind {
            inBox(1.16f) {
                drawWash(marks.first, wash, tint, pool = if (strong) .5f else .8f)
                drawPath(marks.third, if (strong) mix(tint, Color.Black, .25f) else tint, alpha = if (strong) .08f else .1f)
            }
        },
        contentAlignment = Alignment.Center, content = content,
    )
}

/** A portrait's frame: a washed disc and an open brush ring, round a picture or an initial. */
@Composable
fun InkPortraitFrame(seed: String, size: Dp, modifier: Modifier = Modifier, tint: Color = Kata.suo, weight: Float = 2.4f, content: @Composable BoxScope.() -> Unit) {
    val marks = remember(seed, weight) {
        val random = InkRandom(inkSeed(seed))
        val disc = circlePath(50f, 50f, 46f, random, .012f)
        val ring = inkRing(random, 47.5f, .25f + random.next() * .35f)
        disc to inkBrush(ring, random, weight, closed = false, lift = 90f..150f, swell = .3f, wander = .12f)
    }
    val wash = remember(tint) { inkWash(mix(tint, Color.White, .82f), mix(tint, Color.White, .58f), mix(tint, Color.White, .3f), Offset(50f, 65f), 72f) }
    Box(modifier.size(size), contentAlignment = Alignment.Center) {
        Canvas(Modifier.matchParentSize()) { inBox { drawWash(marks.first, wash, tint) } }
        content()
        Canvas(Modifier.matchParentSize()) { inBox { drawPath(marks.second, InkPlum, alpha = .85f) } }
    }
}

/** A small circle, brushed rather than drawn with a compass: a status dot. */
@Composable
fun InkDot(colour: Color, modifier: Modifier = Modifier, size: Dp = 10.dp, seed: String = "dot") {
    val marks = remember(seed) {
        val random = InkRandom(inkSeed(seed))
        val blot = inkBlot(random, 50f, 50f, 40f, lobes = 7, low = .92f, high = 1.05f)
        blot to inkBrush(inkRing(random, 44f, .5f, wobble = .03f), random, 5f, closed = false, lift = null)
    }
    Canvas(modifier.size(size)) {
        inBox {
            drawPath(marks.first, colour, alpha = .95f)
            drawPath(marks.second, colour, alpha = .55f)
        }
    }
}

private val tickPath: Path by lazy { PathParser().parsePathString("M31.7 51.7 L44.2 63.3 L69.2 36.7").toPath() }

/**
 * A rule's ring: an open brushed circle while it waits, a moss blot with a
 * brushed tick once it is met.
 */
@Composable
fun InkRing(met: Boolean, modifier: Modifier = Modifier, size: Dp = 22.dp, seed: String = "ring") {
    val marks = remember(seed) {
        val random = InkRandom(inkSeed(seed))
        val open = inkBrush(inkRing(random, 37.5f, .42f), random, 6.5f, closed = false, lift = null)
        val blot = inkBlot(random, 50f, 50f, 36f, lobes = 8, low = .94f, high = 1.04f)
        val rim = inkBrush(inkRing(random, 38f, .2f), random, 5.5f, closed = false, lift = null)
        val tick = inkBrush(tickPath, random, 8f, closed = false, lift = null, swell = .2f, wander = .1f)
        listOf(open, blot, rim, tick)
    }
    val on by animateFloatAsState(if (met) 1f else 0f)
    val waiting = Kata.faint
    Canvas(modifier.size(size)) {
        inBox {
            if (on < 1f) drawPath(marks[0], waiting, alpha = .6f * (1 - on))
            if (on > 0f) {
                drawPath(marks[1], Kata.moss, alpha = .9f * on)
                drawPath(marks[2], Kata.mossDeep, alpha = .8f * on)
                drawPath(marks[3], Kata.paperLift, alpha = on)
            }
        }
    }
}

/** The brushed ring round a chosen thing (a colour, a crest), drawn behind it. */
@Composable
fun Modifier.inkChosen(on: Boolean, colour: Color = InkPlum, seed: String = "chosen"): Modifier {
    val ring = remember(seed) { val random = InkRandom(inkSeed(seed)); inkBrush(inkRing(random, 46f, .3f), random, 3.4f, closed = false, lift = null, wander = .1f) }
    val shown by animateFloatAsState(if (on) 1f else 0f)
    return drawBehind { if (shown > 0f) inBox { drawPath(ring, colour, alpha = .85f * shown) } }
}

/** One inked petal: a sakura wash with a broken plum brush edge. */
class InkPetalMark(seed: Int, colour: Color = Kata.sakura) {
    private val random = InkRandom(seed)
    val path = inkPetal(random)
    val edge = inkBrushLine(path, random, .8f)
    val wash = inkWash(mix(colour, Color.White, .78f), mix(colour, Color.White, .5f), mix(colour, Color.White, .15f), Offset(50f, 80f), 75f)
    val rim = colour
}

/** Draws [petal] in its 100 box, centred on the current origin, [size] across. */
fun DrawScope.drawInkPetal(petal: InkPetalMark, size: Float, alpha: Float) {
    val s = size / 100f
    scale(s, s, pivot = Offset.Zero) {
        translate(-50f, -50f) {
            drawWash(petal.path, petal.wash, petal.rim, alpha = .95f * alpha)
            drawPath(petal.edge, InkPlum, alpha = .85f * alpha)
        }
    }
}

package app.kimono.watch.ink

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.clipPath
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.unit.Dp

/*
 * 花 An app's bloom, inked on the device itself (copied from the main app's shared/ui/InkBloom.kt, crests left out).
 *
 * The bloom is the website's (packages/ui/src/bloom-identity.ts, ink-bloom.ts):
 * five petals, seeded by the app's id and colour, each washed in the app's
 * colour and edged with a broken plum brush, round a pool of ink holding the
 * app's glyph. The crest is the website's kamon (crest.ts), painted: a washed
 * disc in an ensō, the flower laid on in the colour's ink.
 */

private fun parse(d: String): Path = PathParser().parsePathString(d).toPath()
private fun circle(cx: Float, cy: Float, r: Float) = "M${cx - r} ${cy}a$r $r 0 1 0 ${2 * r} 0a$r $r 0 1 0 ${-2 * r} 0Z"

private const val PETAL = "M50 46 C37 38 32 21 41 10 C45 5 50 3 50 3 C55 5 58 8 61 12 C68 23 62 38 50 46Z"
private const val VEIN = "M50 41 C49 29 49 18 50 8"

/** The glyph at a bloom's heart, as packages/ui/src/glyphs.tsx: strokes on the 100 box, one entry per stroke so each can be brushed. */
private val glyphs: Map<String, List<String>> = mapOf(
    "git" to listOf("M40 40v20", "M60 40v3c0 10-20 5-20 14", circle(40f, 36f, 4f), circle(60f, 36f, 4f), circle(40f, 64f, 4f)),
    "server" to listOf(
        "M37 35h26a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-26a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2z",
        "M37 53h26a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-26a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2z",
        "M41 41h1", "M49 41h10", "M41 59h1", "M49 59h10",
    ),
    "tools" to listOf("M38 62l15-15", "M52 35a10 10 0 0 0-9 14l8 8a10 10 0 0 0 14-9l-7 4-9-9Z", "M38 54l-5 5 8 8 5-5"),
    "mesh" to listOf("M50 38 L38 60", "M50 38 L62 60", "M38 60 L62 60", circle(50f, 37f, 6f), circle(37f, 61f, 6f), circle(63f, 61f, 6f)),
    "notes" to listOf("M38 36 H62 V64 H38 Z", "M45 45 H55", "M45 53 H55"),
    "play" to listOf("M43 36 L66 50 L43 64 Z"),
    "image" to listOf("M36 38 H64 V62 H36 Z", "M36 56 L46 46 L58 58", circle(57f, 45f, 3.5f)),
    "shield" to listOf("M50 34 L64 40 V52 C64 60 57 65 50 67 C43 65 36 60 36 52 V40 Z"),
    "bloom" to listOf(circle(50f, 50f, 6f)),
    "file" to listOf("M41 36 H54 L60 42 V64 H41 Z", "M54 36 V42 H60"),
    "code" to listOf("M43 40 L34 50 L43 60", "M57 40 L66 50 L57 60", "M53 37 L47 63"),
)

/**
 * A glyph, brushed like the rest of the bloom: a slim, round-jointed line
 * underneath keeps corners whole, and the brush over it swells and thins.
 * A stroke too short to brush (a dot) stays a dot.
 */
private class InkGlyph(val base: Path, val brush: Path)

private fun inkGlyph(strokes: List<String>, random: InkRandom): InkGlyph {
    val base = Path(); val brush = Path()
    strokes.forEach { d ->
        val path = parse(d)
        base.addPath(path)
        val closed = d.trimEnd().endsWith("Z", ignoreCase = true)
        brush.addPath(inkBrush(path, random, 4.2f, closed = closed, lift = null, swell = .26f, wander = .1f, step = .6f))
    }
    return InkGlyph(base, brush)
}

private class InkPetalPiece(val rotation: Float, val scale: Float, val alpha: Float, val wash: Brush, val edge: Path, val vein: Path, val veinColour: Color)

private class InkBloomDrawing(val rotation: Float, val petal: Path, val petals: List<InkPetalPiece>, val heart: Path, val heartRing: Path, val glyph: InkGlyph?, val clip: Path)

/** FNV-1a then mulberry32, exactly as createBloomIdentity, so the petals turn as on the website. */
private fun bloomDrawing(id: String, accent: String, glyph: String?, centre: Float): InkBloomDrawing {
    val ramp = accentRamp(accent)
    val seed = inkSeed("$id:$accent")
    val identity = InkRandom(seed)
    val rotation = -5 + identity.next() * 10
    val random = InkRandom(seed xor 0x51ed)
    val petal = parse(PETAL); val vein = parse(VEIN)
    val petals = List(5) { index ->
        val reversed = index % 2 == 1
        val start = if (reversed) ramp.soft else ramp.tint
        val middle = if (reversed) ramp.tint else ramp.soft
        val turn = index * 72 + (identity.next() - .5f) * 2.8f
        val scale = (.965f + identity.next() * .055f) * (.97f + random.next() * .06f)
        val alpha = .94f + identity.next() * .06f
        /* The petal's wash, gathering from the heart outward as on the website (cy 75% of the petal's box). */
        val wash = inkWash(mix(start, Color.White, .22f), mix(middle, Color.White, .12f), ramp.deep, Offset(50f, 36f), 33f, heart = .32f)
        InkPetalPiece(turn, scale, alpha, wash, inkBrushLine(petal, random, .75f), inkBrush(vein, random, 1f, closed = false, lift = null, swell = .3f), ramp.deep)
    }
    val heart = circlePath(50f, 50f, centre * (.96f + random.next() * .08f), random, .02f)
    val heartRing = inkBrushLine(circlePath(50f, 50f, centre, random, .015f), random, .7f)
    return InkBloomDrawing(rotation, petal, petals, heart, heartRing, glyph?.let { inkGlyph(glyphs[it] ?: glyphs.getValue("bloom"), random) }, parse(circle(50f, 50f, centre - 1)))
}

private val glyphStroke = Stroke(width = 3f, cap = StrokeCap.Round, join = StrokeJoin.Round)
private val glyphColour = Color(0xFFFFFAF2)
private val heartInk = Color(0xFF3A2128)

/**
 * An app's bloom, inked. [glyph] names the mark at its heart (null leaves
 * the heart bare, for an app that wears its own icon there).
 */
@Composable
fun InkBloom(id: String, accent: String, glyph: String?, size: Dp, modifier: Modifier = Modifier, centre: Float = 20f, glyphScale: Float = .72f) {
    val drawing = remember(id, accent, glyph, centre) { bloomDrawing(id, accent, glyph, centre) }
    Canvas(modifier.size(size)) {
        inBox {
            rotate(drawing.rotation, Offset(50f, 50f)) {
                drawing.petals.forEach { piece ->
                    rotate(piece.rotation, Offset(50f, 50f)) {
                        scale(piece.scale, Offset(50f, 50f)) {
                            drawWash(drawing.petal, piece.wash, piece.veinColour, alpha = piece.alpha, pool = .8f)
                            drawPath(piece.edge, InkPlum, alpha = .85f)
                            drawPath(piece.vein, piece.veinColour, alpha = .4f)
                        }
                    }
                }
            }
            drawWash(drawing.heart, Brush.radialGradient(listOf(mix(heartInk, InkPlum, .6f), heartInk), Offset(50f, 46f), 22f), Color.Black, alpha = 1f, pool = .8f)
            drawPath(drawing.heartRing, InkPlum, alpha = .85f)
            drawing.glyph?.let { glyph ->
                clipPath(drawing.clip) {
                    translate(50f, 50f) { scale(glyphScale, Offset.Zero) { translate(-50f, -50f) { drawPath(glyph.base, glyphColour, style = glyphStroke); drawPath(glyph.brush, glyphColour) } } }
                }
            }
        }
    }
}


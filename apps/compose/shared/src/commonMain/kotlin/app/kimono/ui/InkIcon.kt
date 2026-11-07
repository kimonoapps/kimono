package app.kimono.ui

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathMeasure
import androidx.compose.ui.graphics.PathSegment
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathNode
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.unit.dp

/*
 * 墨 The line icons, brushed, as the website brushes them (line-icon.tsx):
 * there each stroke is 1.9 wide, breaks now and then (a 22 by 1.1 dash),
 * and wobbles under a turbulence filter. A phone has no such filter, so the
 * hand is in the geometry: every stroke of the icon becomes a brush line
 * that swells, trembles off its path and lifts, seeded by the icon's name so
 * an icon is drawn the same way every time. The result is a filled vector,
 * so Icon() tints it as before.
 */

private val inkedCache = mutableMapOf<String, ImageVector>()

/** One of Kimono's line icons in ink: the drop-in for kimonoIcon. */
fun inkIcon(name: String): ImageVector = inkedCache.getOrPut(name) {
    val random = InkRandom(inkSeed("icon:$name"))
    val nodes = ArrayList<PathNode>()
    for ((contour, closed) in contours(PathParser().parsePathString(iconPaths.getValue(name)).toPath())) {
        val length = PathMeasure().apply { setPath(contour, false) }.length
        val mark = if (length < 2.6f) {
            /* A dot (the "more" icon's): a small round puddle where the brush touched. */
            val at = PathMeasure().apply { setPath(contour, false) }.getPosition(0f)
            inkBlot(random, at.x, at.y, 1.25f, lobes = 6, low = .9f, high = 1.08f)
        } else inkBrush(
            contour, random, width = random.between(1.8f, 2.05f), closed = closed,
            lift = 15f..26f, gap = .7f..1.2f, swell = .26f, wander = .14f,
            step = .22f, tip = .5f, wave = 4f, shake = .26f,
        )
        nodes += pathNodes(mark)
    }
    ImageVector.Builder("ink-$name", 24.dp, 24.dp, 24f, 24f)
        .addPath(nodes, fill = SolidColor(Color.Black))
        .build()
}

/** Splits [path] into its contours, each with whether it was closed. */
private fun contours(path: Path): List<Pair<Path, Boolean>> {
    val out = mutableListOf<Pair<Path, Boolean>>()
    var current: Path? = null
    var drawn = false
    fun finish(closed: Boolean) { current?.let { if (drawn) out += it to closed }; current = null; drawn = false }
    for (segment in path) {
        val p = segment.points
        when (segment.type) {
            PathSegment.Type.Move -> { finish(false); current = Path().apply { moveTo(p[0], p[1]) } }
            PathSegment.Type.Line -> { current?.lineTo(p[2], p[3]); drawn = true }
            PathSegment.Type.Quadratic -> { current?.quadraticTo(p[2], p[3], p[4], p[5]); drawn = true }
            PathSegment.Type.Conic -> { current?.quadraticTo(p[2], p[3], p[4], p[5]); drawn = true }
            PathSegment.Type.Cubic -> { current?.cubicTo(p[2], p[3], p[4], p[5], p[6], p[7]); drawn = true }
            PathSegment.Type.Close -> { current?.close(); finish(true) }
            PathSegment.Type.Done -> {}
        }
    }
    finish(false)
    return out
}

/** A brushed shape (moves, lines, curves) as vector path nodes. */
private fun pathNodes(path: Path): List<PathNode> = buildList {
    for (segment in path) {
        val p = segment.points
        when (segment.type) {
            PathSegment.Type.Move -> add(PathNode.MoveTo(p[0], p[1]))
            PathSegment.Type.Line -> add(PathNode.LineTo(p[2], p[3]))
            PathSegment.Type.Quadratic, PathSegment.Type.Conic -> add(PathNode.QuadTo(p[2], p[3], p[4], p[5]))
            PathSegment.Type.Cubic -> add(PathNode.CurveTo(p[2], p[3], p[4], p[5], p[6], p[7]))
            PathSegment.Type.Close -> add(PathNode.Close)
            PathSegment.Type.Done -> {}
        }
    }
}

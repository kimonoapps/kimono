package app.kimono.ui

import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.addPathNodes
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import app.kimono.theme.Kata

private const val PETAL = "M50 48 C36 39 31 21 41 9 C45 4 50 2 50 2 C55 4 59 7 62 11 C69 22 63 39 50 48Z"

/** Kimono's ink branch: the same drawing as the website's KimonoBranch. */
val KimonoBranchVector: ImageVector by lazy {
    ImageVector.Builder("kimono-branch", 111.dp, 106.dp, 111f, 106f).apply {
        /* the website's viewBox starts at (1, 12); shift the group to match */
        addGroup(translationX = -1f, translationY = -12f)
        listOf(
            "M2 108 C26 98 43 84 55 66 C62 55 71 47 79 43 L81 47 C73 51 66 60 59 72 C47 90 30 106 6 116Z",
            "M57 73 C56 63 53 54 47 47 L50 44 C57 52 60 62 61 72Z",
            "M27 97 C40 96 51 100 58 108 L55 111 C49 104 39 100 27 100Z",
        ).forEach { addPath(addPathNodes(it), fill = SolidColor(Color.Black)) }
        addGroup(translationX = 83f - 50f * .55f, translationY = 41f - 50f * .55f, scaleX = .55f, scaleY = .55f)
        listOf(0f, 72f, 144f, 216f, 288f).forEach { angle ->
            addGroup(rotate = angle, pivotX = 50f, pivotY = 50f)
            addPath(addPathNodes(PETAL), fill = SolidColor(Color.Black))
            clearGroup()
        }
        addPath(addPathNodes("M37 50 a13 13 0 1 0 26 0 a13 13 0 1 0 -26 0Z"), fill = SolidColor(Color.Black))
        clearGroup()
        clearGroup()
    }.build()
}

@Composable
fun KimonoBranch(size: Dp = 30.dp, tint: Color = Kata.plum, modifier: Modifier = Modifier) {
    Image(KimonoBranchVector, contentDescription = null, colorFilter = ColorFilter.tint(tint), modifier = modifier.size(size, size * 106f / 111f))
}

/* 24px line icons with round joins, as drawn in the mockups. */
private val iconPaths = mapOf(
    "home" to "M4 11 12 4l8 7M6 9.5V20h12V9.5 M10 20v-5h4v5",
    "back" to "M19 12H5M11 6l-6 6 6 6",
    "close" to "M6 6l12 12M18 6 6 18",
    "camera" to "M4 8h3.5L9 5.5h6L16.5 8H20v11H4z M15.5 13.5a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0z",
    "check" to "m5 12.5 4.5 4.5L19 7.5",
    "go" to "m9 6 6 6-6 6",
    "folder" to "M3 7.5V18a1.5 1.5 0 0 0 1.5 1.5h15A1.5 1.5 0 0 0 21 18V9a1.5 1.5 0 0 0-1.5-1.5H11L9 5H4.5A1.5 1.5 0 0 0 3 6.5z",
    "share" to "M12 15V4M7 8.5 12 4l5 4.5M5 13v6a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-6",
    "image" to "M4 5h16v14H4z M4 15.5l4.5-4.5 4 4 2.5-2.5 5 5",
)

private val iconCache = mutableMapOf<String, ImageVector>()

fun kimonoIcon(name: String): ImageVector = iconCache.getOrPut(name) {
    ImageVector.Builder(name, 24.dp, 24.dp, 24f, 24f).addPath(
        addPathNodes(iconPaths.getValue(name)),
        stroke = SolidColor(Color.Black),
        strokeLineWidth = 1.7f,
        strokeLineCap = StrokeCap.Round,
        strokeLineJoin = StrokeJoin.Round,
    ).build()
}

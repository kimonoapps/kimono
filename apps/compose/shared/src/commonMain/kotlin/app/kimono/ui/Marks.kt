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
            "M56 69 C55 61 52 54 47 47 L50 44 C56 51 59 59 59.5 66Z",
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
    "phone" to "M8 2.5h8a1.5 1.5 0 0 1 1.5 1.5v16a1.5 1.5 0 0 1-1.5 1.5H8A1.5 1.5 0 0 1 6.5 20V4A1.5 1.5 0 0 1 8 2.5z M10.5 18.5h3",
    "laptop" to "M5 5.5h14v10H5z M3 18.5h18",
    "person" to "M12 11.5a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M4.5 20.5c.8-3.6 3.8-5.5 7.5-5.5s6.7 1.9 7.5 5.5",
    "lock" to "M5 10.5h14v9.5H5z M8 10.5V8a4 4 0 0 1 8 0v2.5",
    "door" to "M14 4H6v16h8 M11 12h10M17 8l4 4-4 4",
    "file" to "M7 3h7l5 5v13H7z M14 3v5h5",
    "video" to "M4 6h11v12H4z M15 10l5-3v10l-5-3",
    "trash" to "M5 7h14 M9.5 7V4.5h5V7 M7 7l1 13h8l1-13",
    "archive" to "M3.5 4.5h17v4h-17z M5 8.5V19.5h14V8.5 M10 12.5h4",
    "unarchive" to "M3.5 4.5h17v4h-17z M5 8.5V19.5h14V8.5 M12 17.5V12M9.5 14.5 12 12l2.5 2.5",
    "plus" to "M12 5v14M5 12h14",
    "upload" to "M12 16V4M7 9l5-5 5 5M5 20h14",
    "more" to "M12 5.5v.01M12 12v.01M12 18.5v.01",
    "move" to "M3 7.5V18a1.5 1.5 0 0 0 1.5 1.5h15A1.5 1.5 0 0 0 21 18V9a1.5 1.5 0 0 0-1.5-1.5H11L9 5H4.5A1.5 1.5 0 0 0 3 6.5z M9 13.5h6.5M13 11l2.5 2.5L13 16",
    "link" to "M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1 M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1",
    "edit" to "M4 20h4L19 9l-4-4L4 16z M13.5 6.5l4 4",
    "select" to "M4 6.5h9M4 12h9M4 17.5h6 M15 16l2.5 2.5L21 14",
    "out" to "M14 5h5v5 M19 5l-8 8 M17 14v5H5V7h5",
    "clip" to "M20 11.5L12.2 19.3a5 5 0 0 1-7-7l8-8a3.3 3.3 0 0 1 4.7 4.7l-8 8a1.7 1.7 0 0 1-2.4-2.4l7.4-7.4",
    "play" to "M8 5.5v13l10.5-6.5z",
    "restart" to "M4.5 12a7.5 7.5 0 1 0 2.2-5.3 M4.5 4.5v4h4",
    "stop" to "M6.5 6.5h11v11h-11z",
    "branch" to "M7 3.5a2 2 0 1 0 0 4 2 2 0 1 0 0-4z M7 16.5a2 2 0 1 0 0 4 2 2 0 1 0 0-4z M17 5.5a2 2 0 1 0 0 4 2 2 0 1 0 0-4z M7 7.5v9 M17 9.5c0 4-10 2.5-10 7",
    "chevron" to "M9 6l6 6-6 6",
    "send" to "M12 19V5M6 11l6-6 6 6",
    "pr" to "M6 3.5a2 2 0 1 0 0 4 2 2 0 1 0 0-4z M6 16.5a2 2 0 1 0 0 4 2 2 0 1 0 0-4z M18 16.5a2 2 0 1 0 0 4 2 2 0 1 0 0-4z M6 7.5v9 M18 16.5V9a2.5 2.5 0 0 0-2.5-2.5H11 M13.5 4L11 6.5 13.5 9",
    "code" to "M9 7L4 12l5 5 M15 7l5 5-5 5 M13 5l-2 14",
    "search" to "M4.5 11a6.5 6.5 0 1 0 13 0a6.5 6.5 0 1 0 -13 0z M16 16l4 4",
    "gear" to "M9 12a3 3 0 1 0 6 0a3 3 0 1 0 -6 0z M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1",
    "copy" to "M9 8h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3",
    "download" to "M12 4v12M7 11l5 5 5-5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3",
    "chat" to "M4 5.5h16v10H10l-4.5 3.5v-3.5H4z",
    "diff" to "M12 4v8M8 8h8M8 19h8",
    "rocket" to "M12 3.5c3 2 4.5 5 4.5 8.5l-2 4h-5l-2-4c0-3.5 1.5-6.5 4.5-8.5z M10.4 10a1.6 1.6 0 1 0 3.2 0a1.6 1.6 0 1 0 -3.2 0z M9.5 16L7 19.5M14.5 16l2.5 3.5M12 16v4",
    "expand" to "M4.5 9.5v-5h5M19.5 9.5v-5h-5M4.5 14.5v5h5M19.5 14.5v5h-5",
    "shrink" to "M9.5 4.5v5h-5M14.5 4.5v5h5M9.5 19.5v-5h-5M14.5 19.5v-5h5",
    "spark" to "M12 3.5c.6 4.2 2.3 5.9 6.5 6.5-4.2.6-5.9 2.3-6.5 6.5-.6-4.2-2.3-5.9-6.5-6.5 4.2-.6 5.9-2.3 6.5-6.5z M18 15.5c.3 1.8 1 2.5 2.5 2.7-1.5.3-2.2 1-2.5 2.8-.3-1.8-1-2.5-2.5-2.8 1.5-.2 2.2-.9 2.5-2.7z",
    "device" to "M6 5h12a1.5 1.5 0 0 1 1.5 1.5v7.5a1.5 1.5 0 0 1-1.5 1.5H6a1.5 1.5 0 0 1-1.5-1.5V6.5A1.5 1.5 0 0 1 6 5z M2.5 19h19",
    "apps" to "M5 5h5v5H5z M14 5h5v5h-5z M5 14h5v5H5z M14 14h5v5h-5z",
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

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
fun KimonoBranch(size: Dp = 30.dp, tint: Color = app.kimono.theme.plumInk, modifier: Modifier = Modifier) {
    Image(KimonoBranchVector, contentDescription = null, colorFilter = ColorFilter.tint(tint), modifier = modifier.size(size, size * 106f / 111f))
}

/* 24px line icons with round joins, as drawn in the mockups. */
internal val iconPaths = mapOf(
    "home" to "M4 11 12 4l8 7M6 9.5V20h12V9.5 M10 20v-5h4v5",
    "back" to "M19 12H5M11 6l-6 6 6 6",
    "close" to "M6 6l12 12M18 6 6 18",
    "mic" to "M12 3.5a3 3 0 0 1 3 3v5a3 3 0 0 1-6 0v-5a3 3 0 0 1 3-3zM5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v2.5",
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
    "sound" to "M4 9.5h3.5L12 5.5v13l-4.5-4H4z M15.5 9a4.2 4.2 0 0 1 0 6 M18.2 6.5a8 8 0 0 1 0 11",
    "sound-off" to "M4 9.5h3.5L12 5.5v13l-4.5-4H4z M16 9.5l5 5 M21 9.5l-5 5",
    "bolt" to "M13.5 3 5.5 13.5h6L10.5 21l8-10.5h-6z",
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
    "reply" to "M9.5 6.5 4.5 11.5l5 5M4.5 11.5h9a6 6 0 0 1 6 6v1",
    "diff" to "M12 4v8M8 8h8M8 19h8",
    "rocket" to "M12 3.5c3 2 4.5 5 4.5 8.5l-2 4h-5l-2-4c0-3.5 1.5-6.5 4.5-8.5z M10.4 10a1.6 1.6 0 1 0 3.2 0a1.6 1.6 0 1 0 -3.2 0z M9.5 16L7 19.5M14.5 16l2.5 3.5M12 16v4",
    "expand" to "M4.5 9.5v-5h5M19.5 9.5v-5h-5M4.5 14.5v5h5M19.5 14.5v5h-5",
    "shrink" to "M9.5 4.5v5h-5M14.5 4.5v5h5M9.5 19.5v-5h-5M14.5 19.5v-5h5",
    "spark" to "M12 3.5c.6 4.2 2.3 5.9 6.5 6.5-4.2.6-5.9 2.3-6.5 6.5-.6-4.2-2.3-5.9-6.5-6.5 4.2-.6 5.9-2.3 6.5-6.5z M18 15.5c.3 1.8 1 2.5 2.5 2.7-1.5.3-2.2 1-2.5 2.8-.3-1.8-1-2.5-2.5-2.8 1.5-.2 2.2-.9 2.5-2.7z",
    "device" to "M6 5h12a1.5 1.5 0 0 1 1.5 1.5v7.5a1.5 1.5 0 0 1-1.5 1.5H6a1.5 1.5 0 0 1-1.5-1.5V6.5A1.5 1.5 0 0 1 6 5z M2.5 19h19",
    "apps" to "M5 5h5v5H5z M14 5h5v5h-5z M5 14h5v5H5z M14 14h5v5h-5z",
    "thumb-up" to "M7.5 10.5v9h-3v-9z M7.5 10.5L11 3.8a1.8 1.8 0 0 1 3.3 1.2l-.8 4.5h5a1.6 1.6 0 0 1 1.6 1.9l-1.4 6.6a1.8 1.8 0 0 1-1.8 1.5H7.5",
    "thumb-down" to "M7.5 13.5v-9h-3v9z M7.5 13.5L11 20.2a1.8 1.8 0 0 0 3.3-1.2l-.8-4.5h5a1.6 1.6 0 0 0 1.6-1.9l-1.4-6.6a1.8 1.8 0 0 0-1.8-1.5H7.5",
    "flag" to "M5.5 20.5v-16 M5.5 4.5h11l-2.5 4 2.5 4h-11",
    "pin" to "M9 3.5h6 M10 3.5v6l-3 3.5h10l-3-3.5v-6 M12 13v7.5",
    "menu" to "M4 7h16 M4 12h10 M4 17h16",
    "people" to "M12.5 8.5a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0z M2.5 19.5c.8-3.3 3.4-5 6.5-5s5.7 1.7 6.5 5 M19.6 9.5a2.6 2.6 0 1 1-5.2 0 2.6 2.6 0 0 1 5.2 0z M16.5 14.6c2.5.1 4.3 1.6 5 4.4",
    "moon" to "M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10z",
    "notes" to "M7 3.5h10a1.5 1.5 0 0 1 1.5 1.5v14a1.5 1.5 0 0 1-1.5 1.5H7A1.5 1.5 0 0 1 5.5 19V5A1.5 1.5 0 0 1 7 3.5z M9 8.5h6 M9 12h6 M9 15.5h3.5",
    "checklist" to "M4 6.5l1.5 1.5 3-3 M4 15.5l1.5 1.5 3-3 M11.5 7h8.5 M11.5 16h8.5",
    "heading" to "M6 4.5v15 M18 4.5v15 M6 12h12",
    "italic" to "M10 4.5h8 M6 19.5h8 M14 4.5l-4 15",
    "bold" to "M7 4.5h6a3.75 3.75 0 0 1 0 7.5H7z M7 12h7a3.75 3.75 0 0 1 0 7.5H7z",
    "list" to "M9 6.5h11 M9 12h11 M9 17.5h11 M4.5 6.5h.5 M4.5 12h.5 M4.5 17.5h.5",
    "table" to "M5.5 5h13a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z M3.5 10h17 M3.5 14.5h17 M12 5v14",
)

/** One of Kimono's line icons, brushed in ink as on the website (see InkIcon.kt). */
fun kimonoIcon(name: String): ImageVector = inkIcon(name)

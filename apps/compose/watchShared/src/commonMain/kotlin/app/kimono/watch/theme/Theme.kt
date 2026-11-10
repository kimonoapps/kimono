package app.kimono.watch.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.remember
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp
import app.kimono.watch.ink.LocalInkTint
import app.kimono.watch.ink.accentRamp
import app.kimono.watch.resources.Res
import app.kimono.watch.resources.shippori_mincho_extrabold
import app.kimono.watch.resources.shippori_mincho_semibold
import app.kimono.watch.resources.zen_maru_bold
import app.kimono.watch.resources.zen_maru_medium
import app.kimono.watch.resources.zen_maru_regular
import org.jetbrains.compose.resources.Font

/** The night palette from the Watch demo (design/mockups/watch). Dark only. */
object Night {
    val bg = Color(0xFF110C0A)
    val surface = Color(0xFF1B1412)
    val surface2 = Color(0xFF261E1B)
    val surface3 = Color(0xFF312825)
    val line = Color(0xFF3C3330)
    val fg = Color(0xFFEFE0DA)
    val fg2 = Color(0xFFD8C2BD)
    val fg3 = Color(0xFFA08C88)
    val suo = Color(0xFFD06A82)
    val suoDeep = Color(0xFF7E3448)
    val suoEdge = Color(0xFFA84D63)
    val blush = Color(0xFFE2A0A8)
    val moss = Color(0xFFBFD0AE)
    val mossDeep = Color(0xFF3E5236)
    val paper = Color(0xFFF4E9E1)
    val ink = Color(0xFF1B1412)
}

/** Watch's own colour (apps/portal/app-definitions/watch/app.json). */
const val WATCH_ACCENT = "#a84d63"
const val WATCH_ID = "kimono-watch"

/** Shippori Mincho for titles and logos. */
val Mincho: FontFamily
    @Composable get() = FontFamily(
        Font(Res.font.shippori_mincho_semibold, FontWeight.SemiBold),
        Font(Res.font.shippori_mincho_extrabold, FontWeight.ExtraBold),
    )

/** Zen Maru Gothic for everything else. */
val Maru: FontFamily
    @Composable get() = FontFamily(
        Font(Res.font.zen_maru_regular, FontWeight.Normal),
        Font(Res.font.zen_maru_medium, FontWeight.Medium),
        Font(Res.font.zen_maru_bold, FontWeight.Bold),
    )

@Composable
fun ui(size: Int, weight: FontWeight = FontWeight.Normal, color: Color = Night.fg) = TextStyle(fontFamily = Maru, fontSize = size.sp, fontWeight = weight, color = color)
@Composable
fun display(size: Int, weight: FontWeight = FontWeight.ExtraBold, color: Color = Night.fg) =
    TextStyle(fontFamily = Mincho, fontSize = size.sp, fontWeight = weight, color = color, lineHeight = (size * 0.98).sp, letterSpacing = (size * 0.01).sp)

@Composable
fun WatchTheme(content: @Composable () -> Unit) {
    val base = Typography()
    val maru = Maru
    val tint = remember { accentRamp(WATCH_ACCENT).soft }
    MaterialTheme(
        colorScheme = darkColorScheme(
            primary = Night.suo, onPrimary = Night.paper, secondary = Night.blush, background = Night.bg, onBackground = Night.fg,
            surface = Night.surface, onSurface = Night.fg, surfaceVariant = Night.surface2, onSurfaceVariant = Night.fg2, outline = Night.line,
            surfaceContainer = Night.surface2, surfaceContainerHigh = Night.surface3, error = Night.blush,
        ),
        typography = Typography(
            bodyLarge = base.bodyLarge.copy(fontFamily = maru), bodyMedium = base.bodyMedium.copy(fontFamily = maru), bodySmall = base.bodySmall.copy(fontFamily = maru),
            labelLarge = base.labelLarge.copy(fontFamily = maru), labelMedium = base.labelMedium.copy(fontFamily = maru), labelSmall = base.labelSmall.copy(fontFamily = maru),
            titleLarge = base.titleLarge.copy(fontFamily = maru), titleMedium = base.titleMedium.copy(fontFamily = maru), titleSmall = base.titleSmall.copy(fontFamily = maru),
        ),
    ) {
        /* Ink marks (the loaders) washed in Watch's colour. */
        CompositionLocalProvider(LocalInkTint provides tint, content = content)
    }
}

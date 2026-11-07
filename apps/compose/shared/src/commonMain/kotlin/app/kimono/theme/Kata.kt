@file:OptIn(ExperimentalMaterial3ExpressiveApi::class)

package app.kimono.theme

import androidx.compose.material3.ExperimentalMaterial3ExpressiveApi
import androidx.compose.material3.MaterialExpressiveTheme
import androidx.compose.material3.MotionScheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.lightColorScheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.staticCompositionLocalOf
import kotlinx.coroutines.flow.MutableStateFlow
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.kimono.resources.Res
import app.kimono.resources.shippori_mincho_semibold
import app.kimono.resources.zen_maru_bold
import app.kimono.resources.zen_maru_medium
import app.kimono.resources.zen_maru_regular
import org.jetbrains.compose.resources.Font


/*
 * Material 3 Expressive, seeded from suō. Surfaces are a warm near-white that
 * steps into soft beige containers, the way Material's tonal palettes do;
 * suō is the primary, plum the secondary, moss the tertiary. Shapes are
 * Material's own (round, and morphing when pressed).
 */
private val kimonoColors = lightColorScheme(
    primary = Kata.suo,
    onPrimary = Color.White,
    primaryContainer = Color(0xFFFFD9DF),
    onPrimaryContainer = Kata.suoDeep,
    inversePrimary = Color(0xFFFFB1C0),
    secondary = Color(0xFF74565C),
    onSecondary = Color.White,
    secondaryContainer = Color(0xFFF6E0E2),
    onSecondaryContainer = Kata.plum,
    tertiary = Kata.moss,
    onTertiary = Color.White,
    tertiaryContainer = Color(0xFFDCE8CF),
    onTertiaryContainer = Kata.mossDeep,
    background = Color(0xFFFFFBF7),
    onBackground = Color(0xFF221A17),
    surface = Color(0xFFFFFBF7),
    onSurface = Color(0xFF221A17),
    surfaceVariant = Color(0xFFF2E6DF),
    onSurfaceVariant = Color(0xFF54443F),
    surfaceTint = Kata.suo,
    surfaceBright = Color(0xFFFFFBF7),
    surfaceDim = Color(0xFFE6DAD3),
    surfaceContainerLowest = Color.White,
    surfaceContainerLow = Color(0xFFFCF4EF),
    surfaceContainer = Color(0xFFF7EEE8),
    surfaceContainerHigh = Color(0xFFF1E8E2),
    surfaceContainerHighest = Color(0xFFEBE2DC),
    outline = Color(0xFF86736E),
    outlineVariant = Color(0xFFD9C2BC),
    error = Color(0xFFBA1A1A),
    onError = Color.White,
    errorContainer = Color(0xFFFFDAD6),
    onErrorContainer = Color(0xFF93000A),
    inverseSurface = Color(0xFF382E2B),
    inverseOnSurface = Color(0xFFFFEDE8),
    scrim = Color.Black,
)

/*
 * The same household at night: a warm near-black lifted in soft brown steps. Coloured text turns the
 * cream of the day's paper; suō stays in the seals and containers, plum and moss turn pale.
 */
private val kimonoNight = darkColorScheme(
    /* coloured text by night is the cream of the day's paper, not pink */
    primary = Color(0xFFFBF3EE),
    onPrimary = Color(0xFF3A2128),
    primaryContainer = Kata.suoDeep,
    onPrimaryContainer = Color(0xFFFFD9DF),
    inversePrimary = Kata.suo,
    secondary = Color(0xFFE3BDC2),
    onSecondary = Color(0xFF422930),
    secondaryContainer = Color(0xFF5B3F45),
    onSecondaryContainer = Color(0xFFFFD9DF),
    tertiary = Color(0xFFBFD0AE),
    onTertiary = Color(0xFF2A3522),
    tertiaryContainer = Kata.mossDeep,
    onTertiaryContainer = Color(0xFFDCE8CF),
    background = Color(0xFF19120F),
    onBackground = Color(0xFFEFE0DA),
    surface = Color(0xFF19120F),
    onSurface = Color(0xFFEFE0DA),
    surfaceVariant = Color(0xFF534340),
    onSurfaceVariant = Color(0xFFD8C2BD),
    surfaceTint = Color(0xFFD06A82),
    surfaceBright = Color(0xFF413734),
    surfaceDim = Color(0xFF19120F),
    surfaceContainerLowest = Color(0xFF130D0B),
    surfaceContainerLow = Color(0xFF221A17),
    surfaceContainer = Color(0xFF261E1B),
    surfaceContainerHigh = Color(0xFF312825),
    surfaceContainerHighest = Color(0xFF3C3330),
    outline = Color(0xFFA08C88),
    outlineVariant = Color(0xFF534340),
    error = Color(0xFFFFB4AB),
    onError = Color(0xFF690005),
    errorContainer = Color(0xFF93000A),
    onErrorContainer = Color(0xFFFFDAD6),
    inverseSurface = Color(0xFFEFE0DA),
    inverseOnSurface = Color(0xFF382E2B),
    scrim = Color.Black,
)

/** Light, dark, or as the phone is: "system", "light" or "dark", kept on the phone. */
object Appearance {
    const val KEY = "kimono.appearance"
    val choice = MutableStateFlow("system")
}

/** Whether Kimono is drawn at night just now. */
val LocalNight = staticCompositionLocalOf { false }

/** Plum ink: deep on paper, pale by night. For marks drawn straight on a surface. */
val plumInk: Color @Composable get() = if (LocalNight.current) Color(0xFFFBF3EE) else Kata.plum

@Composable
private fun kataTypography(): Typography {
    val mincho = FontFamily(Font(Res.font.shippori_mincho_semibold, FontWeight.SemiBold))
    val gothic = FontFamily(
        Font(Res.font.zen_maru_regular, FontWeight.Normal),
        Font(Res.font.zen_maru_medium, FontWeight.Medium),
        Font(Res.font.zen_maru_bold, FontWeight.Bold),
    )
    val display = TextStyle(fontFamily = mincho, fontWeight = FontWeight.SemiBold)
    val text = TextStyle(fontFamily = gothic)
    return Typography(
        displayLarge = display.copy(fontSize = 52.sp, lineHeight = 56.sp, letterSpacing = (-1).sp),
        displayMedium = display.copy(fontSize = 42.sp, lineHeight = 46.sp, letterSpacing = (-.8).sp),
        displaySmall = display.copy(fontSize = 34.sp, lineHeight = 38.sp, letterSpacing = (-.6).sp),
        headlineLarge = display.copy(fontSize = 30.sp, lineHeight = 34.sp),
        headlineMedium = display.copy(fontSize = 26.sp, lineHeight = 31.sp),
        headlineSmall = display.copy(fontSize = 22.sp, lineHeight = 27.sp),
        titleLarge = display.copy(fontSize = 21.sp, lineHeight = 26.sp),
        titleMedium = text.copy(fontWeight = FontWeight.Bold, fontSize = 16.sp, lineHeight = 22.sp),
        titleSmall = text.copy(fontWeight = FontWeight.Bold, fontSize = 14.sp, lineHeight = 20.sp),
        bodyLarge = text.copy(fontSize = 16.sp, lineHeight = 24.sp),
        bodyMedium = text.copy(fontSize = 14.sp, lineHeight = 20.sp),
        bodySmall = text.copy(fontSize = 12.5.sp, lineHeight = 18.sp),
        labelLarge = text.copy(fontWeight = FontWeight.Bold, fontSize = 13.sp, lineHeight = 16.sp, letterSpacing = .5.sp),
        labelMedium = text.copy(fontWeight = FontWeight.Bold, fontSize = 12.sp, lineHeight = 16.sp),
        labelSmall = text.copy(fontWeight = FontWeight.Bold, fontSize = 11.sp, lineHeight = 14.sp),
    )
}

@Composable
fun KimonoTheme(content: @Composable () -> Unit) {
    val choice by Appearance.choice.collectAsState()
    val system = isSystemInDarkTheme()
    val night = when (choice) { "dark" -> true; "light" -> false; else -> system }
    CompositionLocalProvider(LocalNight provides night) {
        MaterialExpressiveTheme(
            colorScheme = if (night) kimonoNight else kimonoColors,
            motionScheme = MotionScheme.expressive(),
            shapes = Shapes(),
            typography = kataTypography(),
            content = content,
        )
    }
}

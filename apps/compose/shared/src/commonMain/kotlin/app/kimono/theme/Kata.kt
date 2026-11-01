@file:OptIn(ExperimentalMaterial3ExpressiveApi::class)

package app.kimono.theme

import androidx.compose.material3.ExperimentalMaterial3ExpressiveApi
import androidx.compose.material3.MaterialExpressiveTheme
import androidx.compose.material3.MotionScheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.lightColorScheme
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
    MaterialExpressiveTheme(
        colorScheme = kimonoColors,
        motionScheme = MotionScheme.expressive(),
        shapes = Shapes(),
        typography = kataTypography(),
        content = content,
    )
}

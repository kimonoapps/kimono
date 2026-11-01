@file:OptIn(ExperimentalMaterial3ExpressiveApi::class)

package app.kimono.theme

import androidx.compose.foundation.shape.RoundedCornerShape
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

/**
 * 型 Kata on Material 3 Expressive.
 *
 * Material supplies the structure and the motion: flexible app bars, the
 * navigation bar, sheets, springs that overshoot a little. Kata supplies the
 * materials: warm paper instead of tinted surfaces, suō as the one action
 * colour, Mincho for names and headings, and corners cut nearly square, so
 * nothing turns into a pill.
 */

private val kataColors = lightColorScheme(
    primary = Kata.suo,
    onPrimary = Kata.lift,
    primaryContainer = Kata.suoWash,
    onPrimaryContainer = Kata.suoDeep,
    secondary = Kata.plum,
    onSecondary = Kata.lift,
    secondaryContainer = Kata.sakuraWash,
    onSecondaryContainer = Kata.plum,
    tertiary = Kata.moss,
    onTertiary = Kata.lift,
    tertiaryContainer = Kata.mossWash,
    onTertiaryContainer = Kata.mossDeep,
    background = Kata.ground,
    onBackground = Kata.ink,
    surface = Kata.ground,
    onSurface = Kata.ink,
    surfaceVariant = Kata.fold,
    onSurfaceVariant = Kata.inkSoft,
    surfaceTint = Color.Transparent,
    surfaceBright = Kata.lift,
    surfaceDim = Kata.fold,
    surfaceContainerLowest = Kata.lift,
    surfaceContainerLow = Kata.sheet,
    surfaceContainer = Kata.sheet,
    surfaceContainerHigh = Kata.fold,
    surfaceContainerHighest = Kata.fold,
    outline = Kata.hairDeep,
    outlineVariant = Kata.hair,
    error = Kata.suoDeep,
    onError = Kata.lift,
    errorContainer = Kata.suoWash,
    onErrorContainer = Kata.suoDeep,
    inverseSurface = Color(0xFF2A1D22),
    inverseOnSurface = Color(0xFFF3E9E0),
    scrim = Color(0xFF2A1D22),
)

/* Carved, not pressed from plastic: every corner stays within a few pixels. */
private val kataShapes = Shapes(
    extraSmall = RoundedCornerShape(1.dp),
    small = RoundedCornerShape(2.dp),
    medium = RoundedCornerShape(2.dp),
    large = RoundedCornerShape(3.dp),
    extraLarge = RoundedCornerShape(4.dp),
)

@Composable
private fun kataTypography(): Typography {
    val mincho = FontFamily(Font(Res.font.shippori_mincho_semibold, FontWeight.SemiBold))
    val gothic = FontFamily(
        Font(Res.font.zen_maru_regular, FontWeight.Normal),
        Font(Res.font.zen_maru_medium, FontWeight.Medium),
        Font(Res.font.zen_maru_bold, FontWeight.Bold),
    )
    val display = TextStyle(fontFamily = mincho, fontWeight = FontWeight.SemiBold, color = Kata.plum)
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
        colorScheme = kataColors,
        motionScheme = MotionScheme.expressive(),
        shapes = kataShapes,
        typography = kataTypography(),
        content = content,
    )
}

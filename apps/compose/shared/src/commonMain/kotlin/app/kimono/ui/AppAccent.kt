@file:OptIn(ExperimentalMaterial3ExpressiveApi::class)

package app.kimono.ui

import androidx.compose.material3.ExperimentalMaterial3ExpressiveApi
import androidx.compose.material3.MaterialExpressiveTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.remember
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color

/*
 * 色 Inside an app, its colour. As on the website (docs/design-system.md,
 * "An app's colour"), an app's own screens take its accent for the primary
 * action, the chosen thing and focus, so you can tell whose room you are in;
 * surfaces, text and status colours stay Kimono's. Ink marks drawn inside
 * (blots, the loader) are washed in the app's colour too.
 */

/** The colour ink marks are washed in here: an app's own, or null for Kimono's suō. */
val LocalInkTint = staticCompositionLocalOf<Color?> { null }

@Composable
fun AppAccentTheme(accent: String?, content: @Composable () -> Unit) {
    if (accent == null) return content()
    val base = MaterialTheme.colorScheme
    val ramp = remember(accent) { accentRamp(accent) }
    val night = app.kimono.theme.LocalNight.current
    val scheme = remember(accent, base, night) {
        /* By night the accent's pale tone leads and its containers sink into the dark. */
        if (night) base.copy(
            primary = mix(ramp.soft, Color.White, .35f),
            onPrimary = mix(ramp.deep, Color.Black, .45f),
            primaryContainer = mix(ramp.deep, Color.Black, .25f),
            onPrimaryContainer = mix(ramp.tint, Color.White, .6f),
            inversePrimary = ramp.deep,
            secondaryContainer = mix(ramp.deep, base.surface, .55f),
            onSecondaryContainer = mix(ramp.tint, Color.White, .6f),
            surfaceTint = ramp.soft,
        ) else base.copy(
            primary = ramp.deep,
            onPrimary = Color.White,
            primaryContainer = mix(ramp.tint, Color.White, .25f),
            onPrimaryContainer = ramp.deep,
            inversePrimary = ramp.soft,
            secondaryContainer = mix(ramp.tint, Color.White, .45f),
            onSecondaryContainer = ramp.deep,
            surfaceTint = ramp.deep,
        )
    }
    MaterialExpressiveTheme(colorScheme = scheme) {
        CompositionLocalProvider(LocalInkTint provides ramp.soft, content = content)
    }
}

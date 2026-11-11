package app.kimono.watch.ink

import androidx.compose.foundation.layout.size
import androidx.compose.material3.ExperimentalMaterial3ExpressiveApi
import androidx.compose.material3.LoadingIndicator
import androidx.compose.material3.LoadingIndicatorDefaults
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/*
 * Material 3 Expressive's loading indicator as it comes, in the theme's
 * primary: for a wait with no measure of how far along; a real progress is
 * the wavy bar (InkProgress.kt) or InkRing. [color] only where it sits on
 * something coloured (a Seal's face).
 */
@OptIn(ExperimentalMaterial3ExpressiveApi::class)
@Composable
fun InkLoader(modifier: Modifier = Modifier, size: Dp = 48.dp, color: Color? = null) {
    LoadingIndicator(
        modifier = modifier.size(size).semantics { contentDescription = "Loading" },
        color = color ?: LoadingIndicatorDefaults.indicatorColor,
    )
}

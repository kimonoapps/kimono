package app.kimono.ui

import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/**
 * The loader, for something slow to arrive: the update's wavy bar, brushed,
 * with its waves running (InkProgress.kt). [size] sets how tall it reads; it
 * is three times as long, or as long as there is room for.
 */
@Composable
fun InkLoader(modifier: Modifier = Modifier, size: Dp = 48.dp, color: Color? = null) =
    InkWaveBar(null, modifier.size(size * 3, (size / 4).coerceAtLeast(8.dp)), color)

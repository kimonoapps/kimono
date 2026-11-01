@file:OptIn(ExperimentalMaterial3ExpressiveApi::class)

package app.kimono.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ExperimentalMaterial3ExpressiveApi
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.LoadingIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

enum class SealTone { Primary, Quiet, Danger }

/**
 * Kimono's button, on Material's expressive one: round at rest, squaring off
 * as it is pressed and springing back. Primary is suō; quiet is tonal; danger
 * says the consequence on the error container.
 */
@Composable
fun Seal(
    label: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    tone: SealTone = SealTone.Primary,
    enabled: Boolean = true,
    busy: Boolean = false,
    compact: Boolean = false,
) {
    val padding = PaddingValues(horizontal = if (compact) 16.dp else 24.dp)
    val sized = modifier.heightIn(min = if (compact) 40.dp else 52.dp)
    val content: @Composable RowScope.() -> Unit = {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            if (busy) LoadingIndicator(modifier = Modifier.size(22.dp), color = MaterialTheme.colorScheme.onPrimary)
            Text(label, style = if (compact) MaterialTheme.typography.labelLarge else MaterialTheme.typography.titleSmall, maxLines = 1)
        }
    }
    when (tone) {
        /* Busy keeps its colour: it is working, not unavailable. */
        SealTone.Primary -> Button(
            onClick = onClick, modifier = sized, enabled = enabled && !busy, shapes = ButtonDefaults.shapes(), contentPadding = padding,
            colors = if (busy) ButtonDefaults.buttonColors(disabledContainerColor = MaterialTheme.colorScheme.primary, disabledContentColor = MaterialTheme.colorScheme.onPrimary) else ButtonDefaults.buttonColors(),
            content = content,
        )
        SealTone.Quiet -> FilledTonalButton(onClick = onClick, modifier = sized, enabled = enabled && !busy, shapes = ButtonDefaults.shapes(), contentPadding = padding, content = content)
        SealTone.Danger -> Button(
            onClick = onClick, modifier = sized, enabled = enabled && !busy, shapes = ButtonDefaults.shapes(), contentPadding = padding,
            colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.errorContainer, contentColor = MaterialTheme.colorScheme.onErrorContainer),
            content = content,
        )
    }
}

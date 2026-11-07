package app.kimono.ui

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.DpOffset
import androidx.compose.ui.unit.dp
import app.kimono.theme.Kata

/*
 * 墨 Kimono's menu: a slip of the dialogs' paper, each choice with its inked mark in a small puddle, the one that
 * can't be undone tinted with the error colour.
 */
@Composable
fun InkMenu(
    expanded: Boolean,
    onDismissRequest: () -> Unit,
    modifier: Modifier = Modifier,
    offset: DpOffset = DpOffset(0.dp, 0.dp),
    content: @Composable ColumnScope.() -> Unit,
) {
    DropdownMenu(
        expanded = expanded,
        onDismissRequest = onDismissRequest,
        modifier = modifier,
        offset = offset,
        shape = RoundedCornerShape(20.dp),
        containerColor = MaterialTheme.colorScheme.surfaceContainerLow,
        tonalElevation = 0.dp,
        shadowElevation = 10.dp,
    ) {
        Column(content = content)
    }
}

/** One choice in an InkMenu. [chosen] puts an inked tick at its end. */
@Composable
fun InkMenuItem(label: String, onClick: () -> Unit, icon: String? = null, danger: Boolean = false, chosen: Boolean = false, enabled: Boolean = true) {
    val colour = if (danger) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurface
    DropdownMenuItem(
        text = { Text(label, style = MaterialTheme.typography.bodyLarge, color = colour) },
        onClick = onClick,
        enabled = enabled,
        leadingIcon = icon?.let {
            {
                InkBlot("menu:$label", tint = if (danger) MaterialTheme.colorScheme.error else Kata.suo, size = 30.dp) {
                    Icon(inkIcon(it), null, tint = if (danger) Kata.suoPad else Kata.plum, modifier = Modifier.size(16.dp))
                }
            }
        },
        trailingIcon = if (chosen) ({ Icon(inkIcon("check"), null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(18.dp)) }) else null,
    )
}

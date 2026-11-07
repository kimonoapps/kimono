package app.kimono.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.padding
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
        shape = RoundedCornerShape(16.dp),
        /* A clear step above the page: white paper by day, the highest tone by night, lifted on a soft shadow and a hairline. */
        containerColor = if (app.kimono.theme.LocalNight.current) MaterialTheme.colorScheme.surfaceContainerHighest else MaterialTheme.colorScheme.surfaceContainerLowest,
        tonalElevation = 0.dp,
        shadowElevation = 16.dp,
        border = BorderStroke(1.dp, if (app.kimono.theme.LocalNight.current) MaterialTheme.colorScheme.outline.copy(alpha = .4f) else MaterialTheme.colorScheme.outlineVariant.copy(alpha = .6f)),
    ) {
        Column(Modifier.padding(vertical = 4.dp), content = content)
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
        contentPadding = PaddingValues(horizontal = 16.dp),
        leadingIcon = icon?.let {
            {
                InkBlot("menu:$label", tint = if (danger) MaterialTheme.colorScheme.error else Kata.suo, size = 28.dp) {
                    Icon(inkIcon(it), null, tint = if (danger) Kata.suoPad else Kata.plum, modifier = Modifier.size(15.dp))
                }
            }
        },
        trailingIcon = if (chosen) ({ Icon(inkIcon("check"), null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(18.dp)) }) else null,
    )
}

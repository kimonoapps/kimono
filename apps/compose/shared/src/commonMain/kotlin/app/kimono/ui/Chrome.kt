@file:OptIn(ExperimentalMaterial3Api::class, ExperimentalMaterial3ExpressiveApi::class)

package app.kimono.ui

import androidx.compose.ui.graphics.Color
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExperimentalMaterial3ExpressiveApi
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ListItemDefaults
import androidx.compose.material3.MaterialShapes
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SegmentedListItem
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.toShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.unit.dp
import app.kimono.theme.Kata

/** A plain bar: back, a title, actions at the right edge. */
@Composable
fun KimonoTopBar(title: String, onBack: (() -> Unit)? = null, mark: (@Composable () -> Unit)? = null, onMenu: (() -> Unit)? = null, actions: @Composable () -> Unit = {}) {
    TopAppBar(
        title = {
            Row(verticalAlignment = androidx.compose.ui.Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                mark?.invoke()
                Text(title, style = MaterialTheme.typography.titleLarge)
            }
        },
        navigationIcon = {
            if (onMenu != null) IconButton(onClick = onMenu) { Icon(kimonoIcon("menu"), "Chats") }
            else if (onBack != null) IconButton(onClick = onBack) { Icon(kimonoIcon("back"), "Back") }
        },
        actions = { Row(Modifier.padding(end = 12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) { actions() } },
        colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.surface, scrolledContainerColor = MaterialTheme.colorScheme.surfaceContainer),
    )
}

@Composable
fun GroupLabel(text: String) {
    Text(text, style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.primary, modifier = Modifier.padding(start = 28.dp, top = 24.dp, bottom = 8.dp))
}

/** One entry in a grouped list. */
class GroupItem(
    val label: String,
    val detail: String? = null,
    val icon: String? = null,
    val danger: Boolean = false,
    val onLongClick: (() -> Unit)? = null,
    val onClick: () -> Unit,
)

/**
 * Material's grouped list: rows as rounded segments with small gaps, the
 * group's outer corners rounder than the inner ones.
 */
@Composable
fun KimonoGroup(items: List<GroupItem>, modifier: Modifier = Modifier) {
    Column(modifier.padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(ListItemDefaults.SegmentedGap)) {
        items.forEachIndexed { index, item ->
            val tint = if (item.danger) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurface
            SegmentedListItem(
                onClick = item.onClick,
                onLongClick = item.onLongClick,
                shapes = ListItemDefaults.segmentedShapes(index, items.size),
                colors = segmentColors(),
                leadingContent = item.icon?.let { name ->
                    {
                        /* Each row's icon sits in its own watercolour puddle. */
                        InkBlot(item.label, tint = if (item.danger) MaterialTheme.colorScheme.error else Kata.suo) {
                            Icon(kimonoIcon(name), null, tint = if (item.danger) Color(0xFF93000A) else Kata.plum, modifier = Modifier.size(20.dp))
                        }
                    }
                },
                supportingContent = item.detail?.let { { Text(it) } },
                trailingContent = if (item.danger) null else ({ Icon(kimonoIcon("go"), null, modifier = Modifier.size(18.dp)) }),
            ) {
                Text(item.label, style = MaterialTheme.typography.bodyLarge, color = tint)
            }
        }
    }
}

/* Segments sit a tone above the page, so the group reads as a group. */
@Composable
fun segmentColors() = ListItemDefaults.segmentedColors(containerColor = MaterialTheme.colorScheme.surfaceContainer)

@Composable
fun Problem(text: String?) {
    if (text != null) Text(text, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.error)
}

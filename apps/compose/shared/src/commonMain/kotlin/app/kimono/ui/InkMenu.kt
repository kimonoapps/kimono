package app.kimono.ui

import androidx.compose.foundation.layout.Box
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
import androidx.compose.runtime.remember
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.DpOffset
import androidx.compose.ui.unit.dp
import app.kimono.theme.Kata

/*
 * 墨 Kimono's menu: a slip of the dialogs' paper with a pool of wash behind its first mark, each choice with its inked mark in a small puddle, the one that
 * can't be undone tinted with the error colour.
 */
@Composable
fun InkMenu(
    expanded: Boolean,
    onDismissRequest: () -> Unit,
    modifier: Modifier = Modifier,
    offset: DpOffset = DpOffset(0.dp, 0.dp),
    /* Held rows: the menu hangs from the row's top edge, over the row, instead of under or above it. */
    atTop: Boolean = false,
    content: @Composable ColumnScope.() -> Unit,
) {
    val menu: @Composable () -> Unit = {
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
            Column(Modifier.inkPool("menu").padding(vertical = 4.dp), content = content)
        }
    }
    /* A point at the parent's top-left is the anchor, so the menu opens from the row's top. */
    if (atTop) Box(Modifier.size(0.dp)) { menu() } else menu()
}

/**
 * The menu's wash: a small pool of [tint] behind its first mark, wholly
 * inside the slip, so nothing of it is cut off at the edge.
 */
@Composable
private fun Modifier.inkPool(seed: String, tint: Color = LocalInkTint.current ?: Kata.suo, ground: Color = MaterialTheme.colorScheme.surfaceContainerLow): Modifier {
    val pool = remember(seed) { InkRandom(inkSeed("pool:$seed")).let { inkBlot(it, 50f, 50f, 46f, lobes = 10, low = .84f, high = 1.06f) } }
    return drawBehind {
        val r = 30.dp.toPx()
        val c = Offset(30.dp.toPx(), 32.dp.toPx())
        translate(c.x - r, c.y - r) {
            scale(r * 2 / 100f, r * 2 / 100f, pivot = Offset.Zero) {
                drawWash(pool, inkWash(mix(tint, ground, .9f), mix(tint, ground, .82f), mix(tint, ground, .68f), Offset(50f, 50f), 50f, paper = mix(tint, ground, .95f)), tint, alpha = .85f, pool = .3f)
            }
        }
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
                InkBlot("menu:$label", tint = if (danger) MaterialTheme.colorScheme.error else LocalInkTint.current ?: Kata.suo, size = 28.dp) {
                    Icon(inkIcon(it), null, tint = if (danger) Kata.suoPad else Kata.plum, modifier = Modifier.size(15.dp))
                }
            }
        },
        trailingIcon = if (chosen) ({ Icon(inkIcon("check"), null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(18.dp)) }) else null,
    )
}

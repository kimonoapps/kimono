package app.kimono.ui

import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp

/*
 * 裾 The hem: how far chrome anchored to the bottom (a bar, a composer, an action
 * row) stands off the screen's edge.
 *
 * A whole navigation inset stacked under the chrome leaves a dead band (34pt on an
 * iPhone) between its words and the edge. So a thin gesture inset (the iPhone's home
 * indicator, Android's gesture handle) is mostly reclaimed: the chrome reaches down
 * into it, keeping about 14dp clear of the indicator. Android's three buttons (an inset
 * of 40dp or more) sit on top of the app, so they keep all of theirs.
 *
 * It is a WindowInsets, so it plays with the rest: what it pads counts as consumed (an
 * imePadding() after it adds only the rest of the keyboard, landing on its top), and
 * whatever a parent already took of the inset isn't padded twice.
 * Only chrome takes this; content that scrolls under the inset keeps the inset whole.
 */
private class Hem(private val base: WindowInsets) : WindowInsets {
    override fun getLeft(density: Density, layoutDirection: LayoutDirection) = 0
    override fun getTop(density: Density) = 0
    override fun getRight(density: Density, layoutDirection: LayoutDirection) = 0
    override fun getBottom(density: Density): Int = with(density) {
        val inset = base.getBottom(density)
        if (inset >= 40.dp.roundToPx()) inset else (inset - 20.dp.roundToPx()).coerceAtLeast(minOf(inset, 6.dp.roundToPx()))
    }
}

/** The bottom inset for chrome: see Hem. */
@Composable
fun hemInsets(): WindowInsets {
    val nav = WindowInsets.navigationBars
    return remember(nav) { Hem(nav) }
}

@Composable
fun Modifier.bottomChrome(): Modifier = windowInsetsPadding(hemInsets())

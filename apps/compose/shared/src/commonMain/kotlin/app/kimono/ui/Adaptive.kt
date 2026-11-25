package app.kimono.ui

import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.wrapContentWidth
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.coerceAtLeast
import androidx.compose.ui.unit.dp

/*
 * 広 Room to spread out. A phone is one column held upright; an iPad (or an
 * unfolded Android) is a page turned either way, resized by Split View and
 * Stage Manager at any moment. Every decision here is made from the space a
 * composable is actually given, never from the device's name, so a narrow
 * Split View window on an iPad behaves like a phone and nothing is special-cased.
 *
 * The breakpoints are Material's window size classes:
 *   Compact  < 600dp   phones held upright, narrow Split View
 *   Medium   600–839dp iPad mini and 11" iPads upright, half-screen Split View
 *   Expanded ≥ 840dp   iPads on their side, 13" iPads either way
 */

enum class WidthClass { Compact, Medium, Expanded }

fun widthClassOf(width: Dp): WidthClass = when {
    width < 600.dp -> WidthClass.Compact
    width < 840.dp -> WidthClass.Medium
    else -> WidthClass.Expanded
}

/** The whole window's width class, provided once by the app's root (see [ProvideWindowWidth]). */
val LocalWindowWidth = staticCompositionLocalOf { WidthClass.Compact }

/**
 * Measures the space the app is drawn in and hands its width class down. Placed at the root,
 * it follows rotation, Split View and Stage Manager resizes, since all of them re-measure it.
 */
@Composable
fun ProvideWindowWidth(content: @Composable () -> Unit) {
    /* Passes its own constraints on unchanged, so screens that relied on the Surface above sizing them still do. */
    BoxWithConstraints(propagateMinConstraints = true) {
        CompositionLocalProvider(LocalWindowWidth provides widthClassOf(maxWidth)) { content() }
    }
}

/** Widths past which a column stops growing and centres itself instead. */
object Readable {
    /** Running text: chats, notes, an article. About 75 characters of body text. */
    val Text = 760.dp
    /** Settings, forms and grouped lists. */
    val Form = 640.dp
    /** Lists of rows with a little more on each: Home, Drive. */
    val List = 840.dp
}

/**
 * A column that fills the width it's given up to [max], then stays centred with
 * margins either side. Use on a Column or a single item; for a lazy list, whose
 * scrolling should still reach the edges, take [gutter] as its horizontal padding.
 */
fun Modifier.readable(max: Dp = Readable.Text): Modifier =
    this.fillMaxWidth().wrapContentWidth(Alignment.CenterHorizontally).widthIn(max = max).fillMaxWidth()

/** The margin each side that centres a column of at most [max] inside [available]. */
fun gutter(available: Dp, max: Dp = Readable.Text, least: Dp = 0.dp): Dp =
    ((available - max) / 2).coerceAtLeast(least)

/**
 * Grid columns of at least [minSize] each, as many as fit, but never fewer than [least]: a
 * small phone keeps its two columns (where [GridCells.Adaptive] would drop to one) while an
 * iPad gets four or five instead of two stretched ones. Spare pixels go to the first columns.
 */
data class AdaptiveAtLeast(val minSize: Dp, val least: Int = 2) : GridCells {
    override fun Density.calculateCrossAxisCellSizes(availableSize: Int, spacing: Int): List<Int> {
        val count = maxOf(least, (availableSize + spacing) / (minSize.roundToPx() + spacing))
        val room = (availableSize - spacing * (count - 1)).coerceAtLeast(0)
        val base = room / count
        val extra = room % count
        return List(count) { base + if (it < extra) 1 else 0 }
    }
}

/**
 * Measures the width a lazy list will get and hands [content] the horizontal padding that keeps
 * its rows at most [max] wide and centred, never less than [least] (the list's phone padding).
 * The list itself still spans the whole width, so it scrolls from anywhere across an iPad.
 */
@Composable
fun WithGutter(max: Dp = Readable.List, least: Dp = 16.dp, modifier: Modifier = Modifier, content: @Composable (gutter: Dp) -> Unit) {
    BoxWithConstraints(modifier, propagateMinConstraints = true) { content(gutter(maxWidth, max, least)) }
}

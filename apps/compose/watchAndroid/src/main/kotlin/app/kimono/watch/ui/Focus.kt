package app.kimono.watch.ui

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.unit.dp
import app.kimono.watch.theme.Night

/**
 * Clickable with the demo's feel: presses in to 97%, and shows the blush
 * focus outline when reached by keyboard or D-pad (focus-visible).
 */
fun Modifier.clickableScale(onClick: () -> Unit, focusScale: Float = 1f, outline: Boolean = true): Modifier = composed {
    val source = remember { MutableInteractionSource() }
    val pressed by source.collectIsPressedAsState()
    val focused by source.collectIsFocusedAsState()
    val scale by animateFloatAsState(if (pressed) 0.97f else if (focused) focusScale else 1f, spring(dampingRatio = 0.55f, stiffness = 500f), label = "press")
    this
        .graphicsLayer { scaleX = scale; scaleY = scale }
        .drawWithContent {
            drawContent()
            if (focused && outline) {
                val pad = 3.dp.toPx()
                drawRoundRect(Night.blush, topLeft = androidx.compose.ui.geometry.Offset(-pad, -pad),
                    size = androidx.compose.ui.geometry.Size(size.width + pad * 2, size.height + pad * 2), cornerRadius = CornerRadius(8.dp.toPx()), style = Stroke(2.dp.toPx()))
            }
        }
        .clickable(interactionSource = source, indication = null, onClick = onClick)
}

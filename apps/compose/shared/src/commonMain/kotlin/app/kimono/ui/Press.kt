@file:OptIn(ExperimentalMaterial3ExpressiveApi::class, ExperimentalFoundationApi::class)

package app.kimono.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.LocalIndication
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.interaction.Interaction
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.PressInteraction
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.RowScope
import androidx.compose.material3.ButtonColors
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ButtonShapes
import androidx.compose.material3.ExperimentalMaterial3ExpressiveApi
import androidx.compose.material3.IconButtonColors
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.IconButtonShapes
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.contentColorFor
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.RectangleShape
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.positionChanged
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.flow.Flow
import androidx.compose.foundation.clickable as foundationClickable
import androidx.compose.foundation.combinedClickable as foundationCombinedClickable
import androidx.compose.material3.Button as M3Button
import androidx.compose.material3.FilledIconButton as M3FilledIconButton
import androidx.compose.material3.FilledTonalButton as M3FilledTonalButton
import androidx.compose.material3.IconButton as M3IconButton
import androidx.compose.material3.Surface as M3Surface
import androidx.compose.material3.TextButton as M3TextButton

/*
 * Press feedback the moment a finger lands.
 *
 * Inside anything that scrolls, Compose holds a tap's press back (150 ms on
 * iOS, 100 ms on Android) in case it turns into a scroll, so a quick tap only
 * lights up as the finger lifts and the app feels a beat behind. Here the
 * press is shown on touch down instead, and taken back if a scroll claims the
 * finger. The click itself is still the platform's.
 *
 * The app imports these in place of Material's IconButton, TextButton, Button,
 * FilledTonalButton, FilledIconButton, Surface(onClick) and Modifier.clickable.
 */

/** What a component reads its pressed state from: our presses, never the clickable's late ones. */
private class InstantPressSource(val shown: MutableInteractionSource = MutableInteractionSource()) : MutableInteractionSource {
    override val interactions: Flow<Interaction> get() = shown.interactions
    override suspend fun emit(interaction: Interaction) { if (interaction !is PressInteraction) shown.emit(interaction) }
    override fun tryEmit(interaction: Interaction): Boolean = interaction is PressInteraction || shown.tryEmit(interaction)
}

private fun Modifier.pressNow(source: InstantPressSource, enabled: Boolean): Modifier =
    if (!enabled) this else pointerInput(source) {
        awaitEachGesture {
            val down = awaitFirstDown(requireUnconsumed = false, pass = PointerEventPass.Initial)
            val press = PressInteraction.Press(down.position)
            source.shown.tryEmit(press)
            var lifted = false
            while (true) {
                val change = awaitPointerEvent(PointerEventPass.Final).changes.firstOrNull { it.id == down.id } ?: break
                if (!change.pressed) { lifted = true; break }
                /* A scroll or swipe took the finger, or it slid off. */
                if (change.isConsumed && change.positionChanged()) break
                val pad = extendedTouchPadding
                val at = change.position
                if (at.x < -pad.width || at.y < -pad.height || at.x > size.width + pad.width || at.y > size.height + pad.height) break
            }
            source.shown.tryEmit(if (lifted) PressInteraction.Release(press) else PressInteraction.Cancel(press))
        }
    }

/** The source to hand a component, and the modifier that presses it on touch down. */
@Composable
private fun instantPress(given: MutableInteractionSource?, enabled: Boolean): Pair<MutableInteractionSource, Modifier> {
    val source = remember(given) { if (given != null) InstantPressSource(given) else InstantPressSource() }
    return source to Modifier.pressNow(source, enabled)
}

fun Modifier.clickable(enabled: Boolean = true, onClickLabel: String? = null, role: Role? = null, onClick: () -> Unit): Modifier = composed {
    val (source, press) = instantPress(null, enabled)
    then(press).foundationClickable(interactionSource = source, indication = LocalIndication.current, enabled = enabled, onClickLabel = onClickLabel, role = role, onClick = onClick)
}

fun Modifier.clickable(interactionSource: MutableInteractionSource?, indication: androidx.compose.foundation.Indication?, enabled: Boolean = true, onClickLabel: String? = null, role: Role? = null, onClick: () -> Unit): Modifier =
    if (indication == null) foundationClickable(interactionSource, null, enabled, onClickLabel, role, onClick = onClick)
    else composed {
        val (source, press) = instantPress(interactionSource, enabled)
        then(press).foundationClickable(source, indication, enabled, onClickLabel, role, onClick = onClick)
    }

fun Modifier.combinedClickable(
    enabled: Boolean = true,
    onClickLabel: String? = null,
    role: Role? = null,
    onLongClickLabel: String? = null,
    onLongClick: (() -> Unit)? = null,
    onDoubleClick: (() -> Unit)? = null,
    hapticFeedbackEnabled: Boolean = true,
    onClick: () -> Unit,
): Modifier = composed {
    val (source, press) = instantPress(null, enabled)
    then(press).foundationCombinedClickable(
        interactionSource = source, indication = LocalIndication.current, enabled = enabled, onClickLabel = onClickLabel, role = role,
        onLongClickLabel = onLongClickLabel, onLongClick = onLongClick, onDoubleClick = onDoubleClick, hapticFeedbackEnabled = hapticFeedbackEnabled, onClick = onClick,
    )
}

@Composable
fun IconButton(
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    colors: IconButtonColors = IconButtonDefaults.iconButtonColors(),
    interactionSource: MutableInteractionSource? = null,
    content: @Composable () -> Unit,
) {
    val (source, press) = instantPress(interactionSource, enabled)
    M3IconButton(onClick, modifier.then(press), enabled, colors, source, content = content)
}

@Composable
fun FilledIconButton(
    onClick: () -> Unit,
    shapes: IconButtonShapes,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    colors: IconButtonColors = IconButtonDefaults.filledIconButtonColors(),
    interactionSource: MutableInteractionSource? = null,
    content: @Composable () -> Unit,
) {
    val (source, press) = instantPress(interactionSource, enabled)
    M3FilledIconButton(onClick = onClick, shapes = shapes, modifier = modifier.then(press), enabled = enabled, colors = colors, interactionSource = source, content = content)
}

@Composable
fun TextButton(
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    shape: Shape = ButtonDefaults.textShape,
    colors: ButtonColors = ButtonDefaults.textButtonColors(),
    contentPadding: PaddingValues = ButtonDefaults.TextButtonContentPadding,
    interactionSource: MutableInteractionSource? = null,
    content: @Composable RowScope.() -> Unit,
) {
    val (source, press) = instantPress(interactionSource, enabled)
    M3TextButton(onClick = onClick, modifier = modifier.then(press), enabled = enabled, shape = shape, colors = colors, contentPadding = contentPadding, interactionSource = source, content = content)
}

@Composable
fun Button(
    onClick: () -> Unit,
    shapes: ButtonShapes,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    colors: ButtonColors = ButtonDefaults.buttonColors(),
    contentPadding: PaddingValues = ButtonDefaults.ContentPadding,
    interactionSource: MutableInteractionSource? = null,
    content: @Composable RowScope.() -> Unit,
) {
    val (source, press) = instantPress(interactionSource, enabled)
    M3Button(onClick = onClick, shapes = shapes, modifier = modifier.then(press), enabled = enabled, colors = colors, contentPadding = contentPadding, interactionSource = source, content = content)
}

@Composable
fun FilledTonalButton(
    onClick: () -> Unit,
    shapes: ButtonShapes,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    colors: ButtonColors = ButtonDefaults.filledTonalButtonColors(),
    contentPadding: PaddingValues = ButtonDefaults.ContentPadding,
    interactionSource: MutableInteractionSource? = null,
    content: @Composable RowScope.() -> Unit,
) {
    val (source, press) = instantPress(interactionSource, enabled)
    M3FilledTonalButton(onClick = onClick, shapes = shapes, modifier = modifier.then(press), enabled = enabled, colors = colors, contentPadding = contentPadding, interactionSource = source, content = content)
}

@Composable
fun Surface(
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    shape: Shape = RectangleShape,
    color: Color = MaterialTheme.colorScheme.surface,
    contentColor: Color = contentColorFor(color),
    tonalElevation: Dp = 0.dp,
    shadowElevation: Dp = 0.dp,
    border: BorderStroke? = null,
    interactionSource: MutableInteractionSource? = null,
    content: @Composable () -> Unit,
) {
    val (source, press) = instantPress(interactionSource, enabled)
    M3Surface(onClick, modifier.then(press), enabled, shape, color, contentColor, tonalElevation, shadowElevation, border, source, content)
}

/** The plain one, so importing ours keeps every Surface working. */
@Composable
fun Surface(
    modifier: Modifier = Modifier,
    shape: Shape = RectangleShape,
    color: Color = MaterialTheme.colorScheme.surface,
    contentColor: Color = contentColorFor(color),
    tonalElevation: Dp = 0.dp,
    shadowElevation: Dp = 0.dp,
    border: BorderStroke? = null,
    content: @Composable () -> Unit,
) = M3Surface(modifier, shape, color, contentColor, tonalElevation, shadowElevation, border, content)

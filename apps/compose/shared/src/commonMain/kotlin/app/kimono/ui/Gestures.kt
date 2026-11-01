@file:OptIn(ExperimentalMaterial3Api::class, ExperimentalMaterial3ExpressiveApi::class)

package app.kimono.ui

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.tween
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExperimentalMaterial3ExpressiveApi
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SwipeToDismissBox
import androidx.compose.material3.SwipeToDismissBoxValue
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.material3.pulltorefresh.PullToRefreshDefaults
import androidx.compose.material3.pulltorefresh.rememberPullToRefreshState
import androidx.compose.material3.rememberSwipeToDismissBoxState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.onClick
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import app.kimono.theme.Kata
import kotlinx.coroutines.launch
import kotlin.math.cos
import kotlin.math.sin
import kotlin.random.Random

/*
 * The Kata gesture kit: Material's interactions, Kimono's materials.
 *
 *   HoldSeal      press and hold to confirm something that can't be undone.
 *   SwipeRow      swipe a row left to act on it; the action is drawn underneath.
 *   holdMenu      long-press anything for a menu of what you can do with it.
 *   KimonoRefresh pull a list down to refresh, with the morphing indicator.
 */

private val petalPath: Path by lazy {
    PathParser().parsePathString("M50 48 C36 39 31 21 41 9 C45 4 50 2 50 2 C55 4 59 7 62 11 C69 22 63 39 50 48Z").toPath()
}

private class Petal(val x: Float, val rest: Float, val turn: Float, val size: Float, val drift: Float)

/**
 * 留 Hold — the seal for things that can't be taken back. Press and hold for
 * [holdMillis]: sakura petals fall onto the seal and pile up, one with each
 * tick of the phone, and when it is full the action happens. Let go early and
 * the petals scatter. Reads how long you have held; tells you how close you
 * are to committing, without a countdown.
 *
 * Screen readers get a plain double-tap action: holding is for hands, not a
 * barrier for people who can't.
 */
@Composable
fun HoldSeal(
    label: String,
    onConfirm: () -> Unit,
    modifier: Modifier = Modifier,
    holdingLabel: String = "Keep holding",
    holdMillis: Int = 1400,
    enabled: Boolean = true,
) {
    val haptics = LocalHapticFeedback.current
    val scope = rememberCoroutineScope()
    val progress = remember { Animatable(0f) }
    val scatter = remember { Animatable(0f) }
    var holding by remember { mutableStateOf(false) }
    val petals = remember {
        val random = Random(7)
        List(14) { index -> Petal(x = .06f + .88f * random.nextFloat(), rest = .55f + .35f * random.nextFloat(), turn = random.nextFloat() * 360f, size = .8f + .5f * random.nextFloat(), drift = (random.nextFloat() - .5f) * 2f).also { index } }
    }

    /* One tick per petal as it lands. */
    LaunchedEffect(Unit) {
        var landed = 0
        snapshotFlow { (progress.value * petals.size).toInt() }.collect { count ->
            if (count > landed && holding) haptics.performHapticFeedback(HapticFeedbackType.TextHandleMove)
            landed = count
        }
    }

    Box(
        modifier
            .heightIn(min = 48.dp)
            .fillMaxWidth()
            .clip(MaterialTheme.shapes.small)
            .semantics {
                role = Role.Button
                contentDescription = label
                if (enabled) onClick(label = label) { onConfirm(); true }
            }
            .pointerInput(enabled) {
                if (!enabled) return@pointerInput
                detectTapGestures(onPress = {
                    holding = true
                    scatter.snapTo(0f)
                    val run = scope.launch {
                        progress.animateTo(1f, tween(((1f - progress.value) * holdMillis).toInt(), easing = LinearEasing))
                        haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                        holding = false
                        onConfirm()
                        progress.snapTo(0f)
                    }
                    val released = tryAwaitRelease()
                    if (holding) {
                        run.cancel()
                        holding = false
                        scope.launch {
                            /* Let go early: the petals blow away and the seal is bare again. */
                            launch { scatter.animateTo(1f, tween(420, easing = FastOutSlowInEasing)) }
                            progress.animateTo(0f, tween(420))
                            scatter.snapTo(0f)
                        }
                    }
                    released
                })
            }
            .drawWithContent {
                val p = progress.value
                /* The face deepens from rose wash to suō as it fills, slowly at
                   first so the label stays readable on it. */
                val ink = p * p
                drawRect(lerp(Kata.suoWash, Kata.suo, ink))
                drawRect(lerp(Color(0xFFEBC4CC), Color(0xFF8A3E51), ink), topLeft = Offset(0f, size.height - 2.dp.toPx()), size = Size(size.width, 2.dp.toPx()))
                if (p > .5f) {
                    val inset = 3.dp.toPx()
                    drawRoundRect(Kata.lift.copy(alpha = .32f * (p - .5f) * 2f), Offset(inset, inset), Size(size.width - inset * 2, size.height - inset * 2 - 2.dp.toPx()), CornerRadius(1.dp.toPx()), style = Stroke(1.dp.toPx()))
                }
                petals.forEachIndexed { index, petal ->
                    val start = index.toFloat() / petals.size
                    val local = ((p - start) * petals.size * 1.6f).coerceIn(0f, 1f)
                    if (local <= 0f && scatter.value == 0f) return@forEachIndexed
                    val s = scatter.value
                    val fallY = -12.dp.toPx() + (size.height * petal.rest + 12.dp.toPx()) * local
                    val x = size.width * petal.x + petal.drift * 10.dp.toPx() * (1f - local) + cos(petal.turn) * s * 60.dp.toPx()
                    val y = fallY - sin(petal.turn) * s * 40.dp.toPx() - s * 30.dp.toPx()
                    val alpha = (if (s > 0f) 1f - s else 1f) * (if (local > 0f) 1f else 0f)
                    val scale = petal.size * 12.dp.toPx() / 50f
                    translate(x, y) {
                        rotate(petal.turn + local * 90f, pivot = Offset.Zero) {
                            scale(scale, scale, pivot = Offset.Zero) {
                                translate(-50f, -25f) { drawPath(petalPath, Kata.sakura.copy(alpha = alpha * .9f)) }
                            }
                        }
                    }
                }
                drawContent()
            },
        contentAlignment = Alignment.Center,
    ) {
        val p = progress.value
        Text(
            if (holding) holdingLabel else label,
            style = MaterialTheme.typography.labelLarge,
            /* Dark on the light face, light once the face is dark: never pink on pink. */
            color = if (!enabled) Kata.faint else if (p * p < .55f) Kata.suoDeep else Kata.lift,
        )
    }
}

/**
 * A row you can swipe left to act on. The action waits underneath on rose
 * wash and inks to suō once the swipe is far enough to count, with a tick.
 * [onAction] says whether it happened; if not, the row slides back.
 */
@Composable
fun SwipeRow(actionLabel: String, onAction: suspend () -> Boolean, modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    val haptics = LocalHapticFeedback.current
    val scope = rememberCoroutineScope()
    val state = rememberSwipeToDismissBoxState()
    var armed by remember { mutableStateOf(false) }
    LaunchedEffect(state) {
        snapshotFlow { state.targetValue }.collect { target ->
            val now = target == SwipeToDismissBoxValue.EndToStart
            if (now && !armed) haptics.performHapticFeedback(HapticFeedbackType.LongPress)
            armed = now
        }
    }
    SwipeToDismissBox(
        state = state,
        modifier = modifier,
        enableDismissFromStartToEnd = false,
        /* If the action didn't happen, the row slides back. */
        onDismiss = { scope.launch { if (!onAction()) state.reset() } },
        backgroundContent = {
            Row(
                Modifier.fillMaxSize().background(if (armed) Kata.suo else Kata.suoWash).padding(horizontal = 20.dp),
                horizontalArrangement = Arrangement.End,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(actionLabel, style = MaterialTheme.typography.labelLarge, color = if (armed) Kata.lift else Kata.suoDeep)
            }
        },
    ) {
        Box(Modifier.background(Kata.ground)) { content() }
    }
}

class MenuChoice(val label: String, val danger: Boolean = false, val onClick: () -> Unit)

/**
 * Long-press for a menu of what you can do with the thing pressed. The menu
 * is Kimono paper on Material's popup, with a tick when it opens.
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun HoldMenu(choices: List<MenuChoice>, onClick: () -> Unit = {}, modifier: Modifier = Modifier, content: @Composable BoxScope.() -> Unit) {
    val haptics = LocalHapticFeedback.current
    var open by remember { mutableStateOf(false) }
    Box(modifier.combinedClickable(onClick = onClick, onLongClick = {
        haptics.performHapticFeedback(HapticFeedbackType.LongPress)
        open = true
    })) {
        content()
        DropdownMenu(expanded = open, onDismissRequest = { open = false }, containerColor = Kata.lift, shape = MaterialTheme.shapes.small) {
            choices.forEach { choice ->
                DropdownMenuItem(
                    text = { Text(choice.label, style = MaterialTheme.typography.bodyLarge, color = if (choice.danger) Kata.suoDeep else Kata.ink) },
                    onClick = { open = false; choice.onClick() },
                )
            }
        }
    }
}

/** Pull down to refresh, with Material's morphing indicator in Kimono's colours. */
@Composable
fun KimonoRefresh(refreshing: Boolean, onRefresh: () -> Unit, modifier: Modifier = Modifier, content: @Composable BoxScope.() -> Unit) {
    val state = rememberPullToRefreshState()
    PullToRefreshBox(
        isRefreshing = refreshing,
        onRefresh = onRefresh,
        state = state,
        modifier = modifier,
        indicator = {
            PullToRefreshDefaults.LoadingIndicator(
                state = state,
                isRefreshing = refreshing,
                modifier = Modifier.align(Alignment.TopCenter),
                containerColor = Kata.lift,
                color = Kata.suo,
            )
        },
        content = content,
    )
}

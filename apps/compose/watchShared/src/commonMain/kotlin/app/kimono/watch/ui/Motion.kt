package app.kimono.watch.ui

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.animation.scaleIn
import androidx.compose.animation.fadeIn
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import app.kimono.watch.LocalWatch
import app.kimono.watch.theme.Night
import kotlinx.coroutines.delay

/*
 * The house motion, as on the web: sections rise in one after another, pages
 * fade up as they open, a saved tick pops in. All of it stands still when the
 * device asks for less motion.
 */

/** Whether this device asks for less motion. */
@Composable
fun reducedMotion(): Boolean {
    val watch = LocalWatch.current
    return remember { watch.reducedMotion() }
}

/**
 * Rises in from 16 dp below, [index] × 60 ms after the first. With [since]
 * (when the page opened), only as the page opens: rows scrolled to later just show.
 */
fun Modifier.riseIn(index: Int, since: Long? = null): Modifier = composed {
    if (reducedMotion() || (since != null && app.kimono.watch.nowMs() - since > 900)) return@composed this
    val t = remember { Animatable(0f) }
    LaunchedEffect(Unit) { delay(index.coerceAtMost(12) * 60L); t.animateTo(1f, tween(420, easing = FastOutSlowInEasing)) }
    val lift = 16.dp
    this.graphicsLayer { alpha = t.value; translationY = (1f - t.value) * lift.toPx() }
}

/** A page opening: it fades up a little. */
@Composable
fun pageEnter() = if (reducedMotion()) fadeIn(tween(1)) else fadeIn(tween(260)) + androidx.compose.animation.slideInVertically(tween(380, easing = FastOutSlowInEasing)) { it / 24 }

/** The moss tick that says a change was saved: pops in, then fades. */
@Composable
fun SavedTick(at: Long?, size: Dp = 18.dp) {
    if (at == null) return
    val reduced = reducedMotion()
    val s = remember(at) { Animatable(if (reduced) 1f else 0.4f) }
    val a = remember(at) { Animatable(1f) }
    LaunchedEffect(at) {
        if (!reduced) s.animateTo(1f, spring(dampingRatio = 0.45f, stiffness = 600f))
        delay(1200); a.animateTo(0f, tween(300))
    }
    I(Ic.check, size, Night.moss, Modifier.graphicsLayer { scaleX = s.value; scaleY = s.value; alpha = a.value })
}

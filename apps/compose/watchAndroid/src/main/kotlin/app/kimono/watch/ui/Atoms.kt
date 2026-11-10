package app.kimono.watch.ui

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.kimono.watch.data.Profile
import app.kimono.watch.theme.Mincho
import app.kimono.watch.theme.Night
import app.kimono.watch.theme.display
import app.kimono.watch.theme.ui
import coil3.compose.AsyncImage
import coil3.compose.AsyncImagePainter
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.SharedFlow
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.sin

/** The Kimono loading mark: an expressive wavy ring, three quarters round, turning. */
@Composable
fun WavyRing(size: Dp, color: Color = Night.suo, radius: Float = 30f, amp: Float = 2.4f, waves: Int = 10, stroke: Float = 5f, periodMs: Int = 1600, modifier: Modifier = Modifier) {
    val turn by rememberInfiniteTransition(label = "ring").animateFloat(0f, 360f, infiniteRepeatable(tween(periodMs, easing = LinearEasing)), label = "turn")
    Canvas(modifier.size(size).rotate(turn)) {
        val k = this.size.minDimension / 72f
        val path = Path()
        for (i in 0..240) {
            val a = i / 240f * PI.toFloat() * 2f * .78f
            val rr = radius + amp * sin(a * waves)
            val x = (36 + rr * cos(a)) * k
            val y = (36 + rr * sin(a)) * k
            if (i == 0) path.moveTo(x, y) else path.lineTo(x, y)
        }
        drawPath(path, color, style = Stroke(width = stroke * k, cap = StrokeCap.Round))
    }
}

/** A grey block with light running across it, standing in while something loads. */
@Composable
fun Skeleton(modifier: Modifier, shape: androidx.compose.ui.graphics.Shape = RoundedCornerShape(8.dp)) {
    val x by rememberInfiniteTransition(label = "shim").animateFloat(-1f, 1f, infiniteRepeatable(tween(1250, easing = androidx.compose.animation.core.FastOutSlowInEasing)), label = "x")
    Box(modifier.clip(shape).background(Night.surface2).drawWithContent {
        val w = size.width
        drawRect(Brush.horizontalGradient(listOf(Color(0x00EFE0DA), Color(0x12EFE0DA), Color(0x00EFE0DA)), startX = x * w, endX = x * w + w))
    })
}

/** 観, the seal. */
@Composable
fun Seal(size: Dp = 44.dp, modifier: Modifier = Modifier) {
    Box(modifier.size(size).clip(RoundedCornerShape(size * 0.2f)).background(Night.suoDeep).border(2.dp * (size / 44.dp), Night.suoEdge, RoundedCornerShape(size * 0.2f)), contentAlignment = Alignment.Center) {
        Text("観", style = display((size.value * 0.55f).toInt(), color = Night.paper), textAlign = TextAlign.Center)
    }
}

@Composable
fun Brand(compact: Boolean = false) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        Seal(32.dp)
        Text("KIMONO", style = display(20).copy(letterSpacing = 2.8.sp))
    }
}

/** The small TOP 10 seal. */
@Composable
fun Top10(width: Dp = 26.dp, modifier: Modifier = Modifier) {
    val s = width / 26.dp
    Column(modifier.width(width).height(width * 28f / 26f).clip(RoundedCornerShape(4.dp)).background(Night.suoDeep).border(1.dp, Night.suoEdge, RoundedCornerShape(4.dp)),
        horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
        Text("TOP", style = ui((7 * s).toInt().coerceAtLeast(6), FontWeight.Bold, Night.paper).copy(letterSpacing = 0.4.sp, lineHeight = (7 * s).sp))
        Text("10", style = display((13 * s).toInt(), color = Night.paper).copy(lineHeight = (12 * s).sp))
    }
}

/** A ribbon hanging from a card's top edge: "New episode", "New season". */
@Composable
fun Ribbon(text: String, modifier: Modifier = Modifier) {
    val moss = text == "New"
    Text(text, style = ui(11, FontWeight.Bold, Night.paper), maxLines = 1,
        modifier = modifier.clip(RoundedCornerShape(bottomStart = 6.dp, bottomEnd = 6.dp)).background(if (moss) Night.mossDeep else Night.suoDeep).padding(horizontal = 9.dp, vertical = 3.dp))
}

/** An outlined label: the age rating, HD. */
@Composable
fun Boxed(text: String) {
    Text(text, style = ui(12, color = Night.fg2), modifier = Modifier.border(1.dp, Night.fg3, RoundedCornerShape(3.dp)).padding(horizontal = 6.dp, vertical = 0.dp))
}

/** A thin bar for how far into something someone is. */
@Composable
fun ProgressLine(fraction: Float, modifier: Modifier = Modifier, height: Dp = 3.dp) {
    Box(modifier.height(height).background(Color(0x38EFE0DA))) {
        Box(Modifier.fillMaxHeight().fillMaxWidth(fraction.coerceIn(0f, 1f)).background(Night.suo))
    }
}

/** An image from Kimono that fades in once it arrives, on the surface colour until then. */
@Composable
fun Img(url: String?, modifier: Modifier = Modifier, scale: ContentScale = ContentScale.Crop, alignment: Alignment = Alignment.Center) {
    var shown by remember(url) { mutableStateOf(false) }
    val alpha by androidx.compose.animation.core.animateFloatAsState(if (shown) 1f else 0f, tween(450), label = "fade")
    Box(modifier.background(Night.surface2)) {
        if (url != null) AsyncImage(url, null, Modifier.fillMaxSize().graphicsLayer { this.alpha = alpha }, contentScale = scale, alignment = alignment,
            onState = { if (it is AsyncImagePainter.State.Success) shown = true })
    }
}

/** A title in Shippori Mincho, or the title's own logo art when TMDB has one. */
@Composable
fun Logo(name: String, logo: String?, size: Int, modifier: Modifier = Modifier, center: Boolean = false, maxHeight: Dp = (size * 1.6f).dp) {
    var failed by remember(logo) { mutableStateOf(logo == null) }
    if (!failed) {
        AsyncImage(logo, name, modifier.height(maxHeight).fillMaxWidth(), contentScale = ContentScale.Fit, alignment = if (center) Alignment.BottomCenter else Alignment.BottomStart,
            onState = { if (it is AsyncImagePainter.State.Error) failed = true })
    } else {
        Text(name, style = display(size).copy(shadow = androidx.compose.ui.graphics.Shadow(Color(0x73000000), Offset(0f, 2f), 24f)), textAlign = if (center) TextAlign.Center else TextAlign.Start, modifier = modifier, maxLines = 3, overflow = TextOverflow.Ellipsis)
    }
}

private val faces = listOf(Color(0xFF7E3448), Color(0xFF3E5236), Color(0xFF5B3F45), Color(0xFF8A5A2B), Color(0xFF3F4A5B))

fun faceColor(key: String) = faces[(key.hashCode() and 0x7fffffff) % faces.size]

/** Someone's face: their portrait from Kimono, or their initial on their colour. */
@Composable
fun Face(profile: Profile, size: Dp, corner: Float = 0.28f, modifier: Modifier = Modifier) {
    Box(modifier.size(size).clip(RoundedCornerShape(size * corner)).background(faceColor(profile.key)), contentAlignment = Alignment.Center) {
        Text(profile.shown.take(1).uppercase(), style = display((size.value * 0.42f).toInt(), color = Night.paper))
        profile.picture?.let { pic -> Img(if (pic.startsWith("http")) pic else profile.server + pic, Modifier.fillMaxSize().background(Color.Transparent)) }
    }
}

/** The paper (primary) button and the tonal one beside it. */
@Composable
fun PaperButton(text: String, icon: androidx.compose.ui.graphics.vector.ImageVector?, onClick: () -> Unit, modifier: Modifier = Modifier, tonal: Boolean = false, height: Dp = 44.dp, fill: Float? = null) {
    val shape = RoundedCornerShape(8.dp)
    Row(modifier.pressable(onClick).height(height).clip(shape).background(if (tonal) Color(0x52A08C88) else Night.paper)
        .drawWithContent {
            if (fill != null) drawRect(Color(0x387E3448), size = size.copy(width = size.width * fill))
            drawContent()
        }.padding(start = 16.dp, end = 22.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterHorizontally)) {
        if (icon != null) I(icon, tint = if (tonal) Night.fg else Night.ink)
        Text(text, style = ui(16, FontWeight.Bold, if (tonal) Night.fg else Night.ink), maxLines = 1)
    }
}

/** A round outlined button (the hero's mute, a card's My list). */
@Composable
fun RingButton(icon: androidx.compose.ui.graphics.vector.ImageVector, onClick: () -> Unit, modifier: Modifier = Modifier, size: Dp = 40.dp, on: Boolean = false) {
    Box(modifier.size(size).clip(CircleShape).background(Color(0x33110C0A)).border(1.dp, Color(0x8CEFE0DA), CircleShape).pressable(onClick), contentAlignment = Alignment.Center) {
        I(icon, size * 0.5f, if (on) Night.blush else Night.fg)
    }
}

/** A tap that presses in a little, like the demo's buttons. */
fun Modifier.pressable(onClick: () -> Unit): Modifier = this.then(Modifier.clickableScale(onClick))

/** The toast at the bottom: paper on ink, for a moment. */
@Composable
fun BoxScope.ToastHost(flow: SharedFlow<String>, bottom: Dp = 90.dp) {
    var text by remember { mutableStateOf<String?>(null) }
    /* What the pill says, kept while it fades out. */
    var last by remember { mutableStateOf("") }
    var seq by remember { mutableStateOf(0) }
    LaunchedEffect(flow) { flow.collect { text = it; last = it; seq++ } }
    LaunchedEffect(seq) { if (text != null) { delay(1800); text = null } }
    AnimatedVisibility(text != null, Modifier.align(Alignment.BottomCenter).padding(bottom = bottom),
        enter = fadeIn(tween(200)) + slideInVertically(spring(dampingRatio = 0.6f)) { it / 2 }, exit = fadeOut(tween(200)) + slideOutVertically { it / 2 }) {
        Text(last, style = ui(14, FontWeight.Bold, Night.ink), modifier = Modifier.clip(RoundedCornerShape(10.dp)).background(Night.paper).padding(horizontal = 18.dp, vertical = 10.dp))
    }
}

fun minutesText(min: Int): String = if (min >= 60) "${min / 60}h ${min % 60}m" else "${min}m"

/** "1:02:03" or "4:05". */
fun clock(seconds: Double): String {
    val s = seconds.coerceAtLeast(0.0).toLong()
    val h = s / 3600; val m = s % 3600 / 60; val x = s % 60
    return if (h > 0) "$h:${m.toString().padStart(2, '0')}:${x.toString().padStart(2, '0')}" else "$m:${x.toString().padStart(2, '0')}"
}

@Composable
fun Dots(items: List<String>, size: Int = 14) {
    Text(items.joinToString("  ·  "), style = ui(size, color = Night.fg), maxLines = 2, overflow = TextOverflow.Ellipsis)
}

@Composable
fun RowScope.Spacer1() = androidx.compose.foundation.layout.Spacer(Modifier.weight(1f))

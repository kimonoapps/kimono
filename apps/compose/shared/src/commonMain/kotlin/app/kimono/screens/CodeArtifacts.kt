@file:OptIn(ExperimentalMaterial3Api::class)

package app.kimono.screens

import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.spring
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.RoundRect
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathMeasure
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.detectVerticalDragGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Slider
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import app.kimono.data.Code
import app.kimono.data.Platform
import app.kimono.data.WebFrameControl
import app.kimono.ui.InkLoader
import app.kimono.ui.kimonoIcon
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.conflate
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put

/*
 * Artifacts (docs/kimono-ai.md, "Artifacts"): a page it made, drawn in the
 * phone's own web view at the same /ai/frame the website frames, with no
 * cookies and no internet but the engine. It renders while it is being
 * written, every card shows the latest version, and any of them opens full
 * screen. Animations report their time; their controls are drawn here.
 */

/** What every artifact card in a chat shares: the saved versions, what's being written, and which one is full screen. */
@Stable
internal class Artifacts(val workspaceId: String) {
    var versions by mutableStateOf<Map<String, Pair<Int, String>>>(emptyMap())
    var drafts by mutableStateOf<Map<String, Pair<String, String>>>(emptyMap())
    var full by mutableStateOf<String?>(null)
    /** The chat is this person's: its artifacts can be shared. */
    var canShare by mutableStateOf(false)
    /* The saved text of each, by name and version: fetched once, shared by every card. */
    val saved = androidx.compose.runtime.mutableStateMapOf<String, Pair<Int, String>>()
    /* Where each one's media/<file> is served, once it's kept. */
    val media = androidx.compose.runtime.mutableStateMapOf<String, String>()
}

internal class SceneParam(val name: String, val label: String, val min: Float, val max: Float, val step: Float, val value: Float, val unit: String)
/** voiced: it narrates; muted: its sound is off; blocked: the web view wants a tap before it plays sound. */
internal class SceneState(val t: Double, val end: Double, val playing: Boolean, val complete: Boolean, val params: List<SceneParam>, val voiced: Boolean = false, val muted: Boolean = false, val blocked: Boolean = false, val volume: Double = 1.0, val held: Boolean = false)

private val loose = Json { ignoreUnknownKeys = true }

/** The artifact's text now (a draft as it's written, else its latest version), its title, and whether it's still being written. */
@Composable
private fun artifactOf(code: Code, shared: Artifacts, name: String): Triple<String?, String, Boolean> {
    val version = shared.versions[name]?.first ?: 0
    LaunchedEffect(name, version) {
        if (version == 0 || shared.saved[name]?.first == version) return@LaunchedEffect
        runCatching { code.artifact(shared.workspaceId, name) }.onSuccess { shared.saved[name] = it.version to it.content; it.media?.let { m -> shared.media[name] = m } }
    }
    val draft = shared.drafts[name]?.second
    val content = draft ?: shared.saved[name]?.second
    val title = shared.versions[name]?.second?.takeIf { it.isNotBlank() }
        ?: content?.let { Regex("<title>([^<]{1,120})</title>", RegexOption.IGNORE_CASE).find(it)?.groupValues?.get(1)?.trim() }
        ?: name.replace(Regex("[-_]+"), " ").replaceFirstChar { it.uppercase() }
    return Triple(content, title, draft != null)
}

/** An artifact in the chat: as tall as its page up to most of the screen; its bottom edge drags to any height. */
@Composable
internal fun ArtifactCard(code: Code, platform: Platform, shared: Artifacts, name: String) {
    val (content, title, writing) = artifactOf(code, shared, name)
    var height by remember { mutableStateOf(0) }
    var chosen by remember { mutableStateOf<Int?>(null) }
    var scene by remember { mutableStateOf<SceneState?>(null) }
    /* In the chat it is as tall as its page and never scrolls by itself: one finger, one scroll. */
    val control = remember { WebFrameControl().apply { scrolls = false } }
    val density = LocalDensity.current
    var sharing by remember { mutableStateOf(false) }
    if (sharing) ArtifactShareSheet(code, platform, shared.workspaceId, name, title) { sharing = false }
    BoxWithConstraints(Modifier.fillMaxWidth()) {
        val shown = chosen ?: height.coerceIn(120, 4000)
        Surface(shape = RoundedCornerShape(28.dp), color = MaterialTheme.colorScheme.surfaceContainerLowest, tonalElevation = 1.dp, modifier = Modifier.fillMaxWidth()) {
            Column {
                ArtifactHead(title, writing, animated = content?.contains("<k-scene", ignoreCase = true) == true, full = false, onShare = if (shared.canShare && !writing && shared.versions.containsKey(name)) ({ sharing = true }) else null) { shared.full = name }
                if (content == null) Box(Modifier.fillMaxWidth().height(160.dp), contentAlignment = Alignment.Center) { InkLoader() }
                else if (shared.full == name) Box(Modifier.fillMaxWidth().height(80.dp), contentAlignment = Alignment.Center) {
                    Text("Open full screen", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                else {
                    ArtifactFrame(platform, code.server, content, final = !writing, control, Modifier.fillMaxWidth().height(shown.dp), onHeight = { height = it }, onScene = { scene = it }, media = shared.media[name])
                    /* The grip: drag to resize; a double tap fits it to its page again. */
                    Box(Modifier.fillMaxWidth().height(22.dp).pointerInput(Unit) {
                        detectVerticalDragGestures { _, drag -> chosen = ((chosen ?: shown) + with(density) { drag.toDp().value }.toInt()).coerceIn(120, 2400) }
                    }.pointerInput(Unit) { detectTapGestures(onDoubleTap = { chosen = null }) }, contentAlignment = Alignment.Center) {
                        Box(Modifier.width(36.dp).height(4.dp).background(MaterialTheme.colorScheme.outlineVariant, CircleShape))
                    }
                    scene?.takeIf { it.end > 0 }?.let { SceneBar(it, control) }
                }
            }
        }
    }
}

/** An edit to an artifact shown earlier: the card above already shows it; this says so, and opens it. */
@Composable
internal fun ArtifactChanged(shared: Artifacts, code: Code, name: String) {
    val (_, title, _) = artifactOf(code, shared, name)
    Note("spark", "Changed $title", trailing = { TextLink("Open") { shared.full = name } })
}

/** One artifact over everything, as big as the phone. */
@Composable
internal fun ArtifactFull(code: Code, platform: Platform, shared: Artifacts, name: String) {
    val (content, title, writing) = artifactOf(code, shared, name)
    var scene by remember { mutableStateOf<SceneState?>(null) }
    val control = remember { WebFrameControl() }
    Dialog(onDismissRequest = { shared.full = null }, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Column(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.surfaceContainerLowest).statusBarsPadding().navigationBarsPadding()) {
            ArtifactHead(title, writing, animated = content?.contains("<k-scene", ignoreCase = true) == true, full = true) { shared.full = null }
            Box(Modifier.weight(1f).fillMaxWidth()) {
                if (content == null) Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { InkLoader() }
                else ArtifactFrame(platform, code.server, content, final = !writing, control, Modifier.fillMaxSize(), onHeight = {}, onScene = { scene = it }, media = shared.media[name])
            }
            scene?.takeIf { it.end > 0 }?.let { SceneBar(it, control) }
        }
    }
}

@Composable
private fun ArtifactHead(title: String, writing: Boolean, animated: Boolean, full: Boolean, onShare: (() -> Unit)? = null, toggle: () -> Unit) {
    Row(Modifier.fillMaxWidth().padding(start = 16.dp, end = 6.dp, top = 6.dp, bottom = 6.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        BlotIcon("spark", "artifact-$title", 36.dp)
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.titleSmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                if (writing) InkLoader(size = 14.dp)
                Text(if (writing) "Writing" else if (animated) "Animation" else "Artifact", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        if (onShare != null) IconButton(onClick = onShare) { Icon(kimonoIcon("share"), "Share") }
        IconButton(onClick = toggle) { Icon(kimonoIcon(if (full) "shrink" else "expand"), if (full) "Leave full screen" else "Full screen") }
    }
}

/** An artifact someone shared, opened by its link: the page, as big as the phone, and whose it is. */
@Composable
fun SharedArtifactScreen(code: Code, platform: Platform, token: String, back: () -> Unit) {
    val people = rememberPeople(code)
    val link by androidx.compose.runtime.produceState<Result<app.kimono.data.SharedLink>?>(null, token) { value = runCatching { code.link(token) } }
    var scene by remember { mutableStateOf<SceneState?>(null) }
    val control = remember { WebFrameControl() }
    val shown = link?.getOrNull()?.takeIf { it.kind == "artifact" }
    val content = shown?.content
    val title = shown?.title?.takeIf { it.isNotBlank() }
        ?: content?.let { Regex("<title>([^<]{1,120})</title>", RegexOption.IGNORE_CASE).find(it)?.groupValues?.get(1)?.trim() }
        ?: shown?.name?.replace(Regex("[-_]+"), " ")?.replaceFirstChar { it.uppercase() } ?: ""
    Column(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.surfaceContainerLowest).statusBarsPadding().navigationBarsPadding()) {
        Row(Modifier.fillMaxWidth().padding(start = 4.dp, end = 6.dp, top = 6.dp, bottom = 6.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            IconButton(onClick = back) { Icon(kimonoIcon("back"), "Back") }
            BlotIcon("spark", "artifact-$token", 36.dp)
            Column(Modifier.weight(1f)) {
                Text(title, style = MaterialTheme.typography.titleSmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
                if (shown != null) Text("Shared by ${people.nameOf(shown.owner)}", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            if (shown != null) IconButton(onClick = { platform.share(code.artifactLink(token)) }) { Icon(kimonoIcon("share"), "Share") }
        }
        Box(Modifier.weight(1f).fillMaxWidth()) {
            val failed = link?.exceptionOrNull()?.message ?: if (link != null && shown == null) "This link doesn't work any more." else null
            when {
                failed != null -> Box(Modifier.fillMaxSize().padding(32.dp), contentAlignment = Alignment.Center) { Text(failed, style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                content == null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { InkLoader() }
                else -> ArtifactFrame(platform, code.server, content, final = true, control, Modifier.fillMaxSize(), onHeight = {}, onScene = { scene = it }, media = shown?.media)
            }
        }
        scene?.takeIf { it.end > 0 }?.let { SceneBar(it, control) }
    }
}

/* The page's postMessage, wrapped: what the frame tells its shower goes to the phone; what the phone sends goes in as from the shower. */
private const val BRIDGE = """(function(){if(window.__kimonoSend)return;var own=window.postMessage.bind(window);
var out=window.KimonoNative?function(s){window.KimonoNative.post(s)}:function(s){window.webkit.messageHandlers.kimono.postMessage(s)};
window.postMessage=function(m,o){if(m&&m.kimono==='artifact'&&m.type!=='render'&&m.type!=='scene-control'){try{out(JSON.stringify(m))}catch(e){}}else own(m,o||'*')};
window.__kimonoSend=function(m){own(m,'*')};})();"""

/** The frame, and the conversation with it: the text as it arrives, its height and its scenes back. */
@Composable
private fun ArtifactFrame(platform: Platform, server: String?, content: String, final: Boolean, control: WebFrameControl, modifier: Modifier, onHeight: (Int) -> Unit, onScene: (SceneState) -> Unit, media: String? = null) {
    if (server == null) return
    var loaded by remember { mutableStateOf(false) }
    val latest by rememberUpdatedState(Triple(content, final, media))
    val heightTo by rememberUpdatedState(onHeight)
    val sceneTo by rememberUpdatedState(onScene)
    /* While it's being written the text grows a little at a time: posted at most a few times a second, the latest each time. */
    LaunchedEffect(loaded) {
        if (!loaded) return@LaunchedEffect
        snapshotFlow { latest }.conflate().collect { (text, done, where) ->
            val message = buildJsonObject { put("kimono", "artifact"); put("type", "render"); put("content", text); put("final", done); if (where != null) put("media", where) }
            control.evaluate("$BRIDGE;window.__kimonoSend($message);")
            delay(if (done) 0 else 200)
        }
    }
    platform.WebFrame("$server/ai/frame", modifier, control, keepLinks = false,
        onMessage = { text ->
            val m = runCatching { loose.parseToJsonElement(text).jsonObject }.getOrNull() ?: return@WebFrame
            when (m["type"]?.jsonPrimitive?.content) {
                "size" -> m["height"]?.jsonPrimitive?.doubleOrNull?.let { heightTo(it.toInt()) }
                "scene" -> sceneOf(m)?.let { sceneTo(it) }
                else -> {}
            }
        },
        onLoaded = { control.evaluate(BRIDGE); loaded = true },
    )
}

private fun sceneOf(m: JsonObject): SceneState? {
    val t = m["t"]?.jsonPrimitive?.doubleOrNull ?: return null
    val end = m["end"]?.jsonPrimitive?.doubleOrNull ?: return null
    val params = runCatching { m["params"]!!.jsonArray.mapNotNull { p ->
        val o = p.jsonObject
        val name = o["name"]?.jsonPrimitive?.content ?: return@mapNotNull null
        val min = o["min"]?.jsonPrimitive?.doubleOrNull ?: return@mapNotNull null
        val max = o["max"]?.jsonPrimitive?.doubleOrNull ?: return@mapNotNull null
        val value = o["value"]?.jsonPrimitive?.doubleOrNull ?: return@mapNotNull null
        SceneParam(name, o["label"]?.jsonPrimitive?.content ?: name, min.toFloat(), max.toFloat(), (o["step"]?.jsonPrimitive?.doubleOrNull ?: 0.0).toFloat(), value.toFloat(), o["unit"]?.jsonPrimitive?.content ?: "")
    }.take(8) }.getOrDefault(emptyList())
    val flag = { key: String -> m[key]?.jsonPrimitive?.booleanOrNull == true }
    return SceneState(t, end, flag("playing"), flag("complete"), params, voiced = flag("voiced"), muted = flag("muted"), blocked = flag("blocked"), held = flag("held"), volume = m["volume"]?.jsonPrimitive?.doubleOrNull ?: 1.0)
}

private fun sceneControl(control: WebFrameControl, action: String, t: Double? = null, name: String? = null, value: Double? = null) {
    val message = buildJsonObject {
        put("kimono", "artifact"); put("type", "scene-control"); put("action", action)
        if (t != null) put("t", t)
        if (name != null) put("name", name)
        if (value != null) put("value", value)
    }
    control.evaluate("window.__kimonoSend&&window.__kimonoSend($message);")
}

/**
 * Play and pause, as Kimono's seal: suō, round at rest and squaring off as it's pressed, with its carved
 * ring inked as far as the animation has played.
 */
@Composable
private fun PlaySeal(scene: SceneState, ended: Boolean, onClick: () -> Unit) {
    val source = remember { MutableInteractionSource() }
    val pressed by source.collectIsPressedAsState()
    val corner by animateDpAsState(if (pressed) 12.dp else 22.dp, spring(dampingRatio = 0.55f, stiffness = 600f))
    val progress = if (scene.end > 0) (scene.t / scene.end).toFloat().coerceIn(0f, 1f) else 0f
    val ink = MaterialTheme.colorScheme.onPrimary
    /* playing, but not all there yet: the seal shows it loading, not a pause */
    val loading = scene.playing && (!scene.complete || scene.held)
    val label = if (loading) "Loading" else if (scene.playing) "Pause" else if (ended) "Play again" else "Play"
    Surface(onClick = onClick, interactionSource = source, shape = RoundedCornerShape(corner), color = MaterialTheme.colorScheme.primary, modifier = Modifier.size(44.dp)) {
        Box(Modifier.fillMaxSize().drawWithContent {
            drawContent()
            val inset = 4.5.dp.toPx()
            val ring = Path().apply { addRoundRect(RoundRect(Rect(inset, inset, size.width - inset, size.height - inset), CornerRadius((corner.toPx() - inset).coerceAtLeast(0f)))) }
            drawPath(ring, ink.copy(alpha = 0.26f), style = Stroke(1.2.dp.toPx()))
            if (progress > 0f) {
                val measure = PathMeasure().apply { setPath(ring, false) }
                val done = Path()
                measure.getSegment(0f, measure.length * progress, done, true)
                drawPath(done, ink, style = Stroke(1.8.dp.toPx(), cap = StrokeCap.Round))
            }
        }, contentAlignment = Alignment.Center) {
            if (loading) InkLoader(size = 22.dp, color = ink)
            else if (scene.playing) Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) { repeat(2) { Box(Modifier.width(4.dp).height(13.dp).clip(RoundedCornerShape(2.dp)).background(ink)) } }
            else Icon(kimonoIcon(if (ended) "restart" else "play"), label, tint = ink, modifier = Modifier.size(18.dp))
        }
    }
}

/** Kimono's own controls for an artifact's animation: play, pause, again, scrub, sound, and each of its settings. */
@Composable
private fun SceneBar(scene: SceneState, control: WebFrameControl) {
    val ended = scene.complete && scene.t >= scene.end - 0.01
    Column(Modifier.fillMaxWidth().padding(horizontal = 14.dp).padding(bottom = 10.dp)) {
        scene.params.forEach { p ->
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(p.label, style = MaterialTheme.typography.labelMedium, modifier = Modifier.weight(1f))
                Text("${(p.value * 10000).toInt() / 10000.0}${p.unit}".replace(".0${p.unit}", p.unit), style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.SemiBold)
            }
            val steps = if (p.step > 0) (((p.max - p.min) / p.step).toInt() - 1).coerceIn(0, 200) else 0
            Slider(value = p.value, onValueChange = { sceneControl(control, "set", name = p.name, value = it.toDouble()) }, valueRange = p.min..p.max, steps = steps)
        }
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            PlaySeal(scene, ended) { sceneControl(control, if (scene.playing) "pause" else if (ended) "replay" else "play") }
            /* A narrated animation's sound, beside play: at full volume, and the speaker mutes or unmutes it (the phone's buttons set how loud). */
            if (scene.voiced) {
                LaunchedEffect(scene.volume) { if (scene.volume < 1.0) sceneControl(control, "volume", value = 1.0) }
                val off = scene.muted || scene.blocked
                val label = if (scene.blocked) "Turn sound on" else if (off) "Unmute" else "Mute"
                IconButton(onClick = {
                    if (scene.blocked && !scene.playing) sceneControl(control, "play")
                    sceneControl(control, if (off) "sound-on" else "sound-off")
                }, modifier = Modifier.size(36.dp)) {
                    Icon(kimonoIcon(if (off) "sound-off" else "sound"), label, tint = if (scene.blocked) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(20.dp))
                }
            }
            Slider(value = if (scene.end > 0) (scene.t / scene.end).toFloat().coerceIn(0f, 1f) else 0f, onValueChange = { sceneControl(control, "seek", t = it * scene.end) }, modifier = Modifier.weight(1f))
            Text("${(scene.t * 10).toInt() / 10.0} / ${(scene.end * 10).toInt() / 10.0}s", style = MaterialTheme.typography.labelSmall, fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
            if (!scene.complete && !scene.playing) InkLoader(size = 16.dp)
        }
    }
}

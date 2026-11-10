package app.kimono.watch.phone

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.focusable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shadow
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.kimono.watch.Entry
import app.kimono.watch.LocalWatch
import app.kimono.watch.WatchServices
import app.kimono.watch.ink.InkLoader
import app.kimono.watch.model.Prefs
import app.kimono.watch.theme.Night
import app.kimono.watch.theme.display
import app.kimono.watch.theme.ui
import app.kimono.watch.ui.Face
import app.kimono.watch.ui.I
import app.kimono.watch.ui.Ic
import app.kimono.watch.ui.Screen
import app.kimono.watch.ui.SettingsState
import app.kimono.watch.ui.SettingsViewModel
import app.kimono.watch.ui.clickableScale
import app.kimono.watch.ui.clickableScaleClipped
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/** The qualities a device can keep, as the server names them (lib/watch/releases.ts qualityLabels). */
val qualityChoices = listOf("auto" to "Auto", "2160" to "4K", "1080" to "1080p", "720" to "720p", "saver" to "Data saver")

/** Languages to pick from, by their ISO 639-1 code. */
private val languages = listOf(
    "en" to "English", "ja" to "Japanese", "es" to "Spanish", "fr" to "French", "de" to "German", "it" to "Italian",
    "pt" to "Portuguese", "ko" to "Korean", "zh" to "Chinese", "ar" to "Arabic", "hi" to "Hindi", "ru" to "Russian",
    "nl" to "Dutch", "sv" to "Swedish", "pl" to "Polish", "tr" to "Turkish",
)
private fun languageName(code: String) = languages.firstOrNull { it.first == code }?.second ?: code.uppercase()

/** The player's preferences first (language, quality, anime lead), then the app's. */
private enum class Part(val title: String, val player: Boolean) {
    Languages("Languages", true), Quality("Quality", true), Anime("Anime", true), Look("Subtitle look", true), Playing("Playing", true),
    Home("Home", false), Downloads("Downloads", false), Account("Account", false),
}

/**
 * Settings in two halves, the same everywhere. Player: Languages, Quality,
 * Anime, Subtitle look, Playing. App: Home, Downloads, Account. Every change
 * saves as it's made. A phone shows them as one list; a TV as two panes, the
 * groups on the left and the chosen one on the right. From the player
 * ([playerOnly]) only the player's half shows.
 */
@Composable
fun SettingsScreen(onClose: () -> Unit, onProfiles: (() -> Unit)? = null, tv: Boolean = false, wide: Boolean = tv, playerOnly: Boolean = false) {
    val parts = Part.entries.filter { it.player || !playerOnly }
    val watch = LocalWatch.current
    val entry = remember { Entry(Screen.Settings) }
    androidx.compose.runtime.DisposableEffect(entry) { onDispose { entry.store.clear() } }
    val vm = entry.vm { SettingsViewModel(watch.api, watch.deviceId, watch.cellular) }
    val state by vm.state.collectAsState()
    val prefs by watch.prefs.state.collectAsState()
    LaunchedEffect(Unit) { if (prefs == null) watch.prefs.load() }
    val p = prefs
    Box(Modifier.fillMaxSize().background(Night.bg)) {
        if (p == null || state.loading) Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { InkLoader(size = 40.dp) }
        else if (tv) TwoPanes(parts, watch, state, vm, p, onProfiles)
        else {
            val gutter = if (wide) 48.dp else 16.dp
            LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(top = statusTop + 64.dp, bottom = navBottom + 32.dp, start = gutter, end = gutter)) {
                item { Text(if (playerOnly) "Player" else "Settings", style = display(if (wide) 40 else 28), modifier = Modifier.padding(bottom = 8.dp)) }
                parts.forEachIndexed { i, part ->
                    if (!playerOnly && (i == 0 || part.player != parts[i - 1].player)) item("half${part.player}") { Half(if (part.player) "Player" else "App", first = i == 0) }
                    item("h${part.name}") { Group(part.title) }
                    item("p${part.name}") { Column(Modifier.widthIn(max = 620.dp)) { PartBody(part, watch, state, vm, p, onProfiles, tv = false) } }
                }
            }
        }
        if (!tv) Box(Modifier.align(Alignment.TopEnd).padding(top = statusTop + 12.dp, end = 12.dp).size(38.dp).clip(CircleShape).background(Color(0xBF110C0A)).clickableScale(onClose), contentAlignment = Alignment.Center) { I(Ic.close) }
    }
}

@Composable
private fun TwoPanes(parts: List<Part>, watch: WatchServices, state: SettingsState, vm: SettingsViewModel, p: Prefs, onProfiles: (() -> Unit)?) {
    var part by remember { mutableStateOf(parts.first()) }
    val first = remember { FocusRequester() }
    LaunchedEffect(Unit) { runCatching { first.requestFocus() } }
    Row(Modifier.fillMaxSize()) {
        Column(Modifier.width(360.dp).fillMaxHeight().background(Night.surface).verticalScroll(rememberScrollState()).padding(horizontal = 28.dp, vertical = 40.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text("Settings", style = display(34), modifier = Modifier.padding(start = 14.dp, bottom = 18.dp))
            parts.forEachIndexed { i, it ->
                if (parts.any { !it.player } && (i == 0 || it.player != parts[i - 1].player))
                    Text(if (it.player) "Player" else "App", style = ui(14, FontWeight.Bold, Night.fg3), modifier = Modifier.padding(start = 14.dp, top = if (i == 0) 0.dp else 22.dp, bottom = 2.dp))
                val on = it == part
                /* Moving onto a group shows it; the right pane is a step to the right. */
                Text(it.title, style = ui(20, if (on) FontWeight.Bold else FontWeight.Normal, if (on) Night.fg else Night.fg2),
                    modifier = Modifier.fillMaxWidth().then(if (i == 0) Modifier.focusRequester(first) else Modifier)
                        .onFocusChanged { f -> if (f.isFocused) part = it }
                        .clickableScaleClipped(RoundedCornerShape(10.dp), { part = it })
                        .background(if (on) Night.surface3 else Color.Transparent, RoundedCornerShape(10.dp)).padding(horizontal = 14.dp, vertical = 10.dp))
            }
        }
        Column(Modifier.weight(1f).fillMaxHeight().verticalScroll(rememberScrollState()).padding(start = 56.dp, end = 64.dp, top = 64.dp, bottom = 64.dp).widthIn(max = 760.dp)) {
            Text(part.title, style = ui(26, FontWeight.Bold), modifier = Modifier.padding(bottom = 14.dp))
            PartBody(part, watch, state, vm, p, onProfiles, tv = true)
        }
    }
}

@Composable
private fun PartBody(part: Part, watch: WatchServices, state: SettingsState, vm: SettingsViewModel, p: Prefs, onProfiles: (() -> Unit)?, tv: Boolean) {
    val store = watch.prefs
    when (part) {
        Part.Quality -> {
            val device = remember { runCatching { watch.api.device() }.getOrNull() }
            val tiers = qualityChoices.filter { it.first != "2160" || (device?.maxHeight ?: 0) >= 2160 }.map { (v, l) -> v to if (v == "saver") "Saver" else l }
            val thing = if (watch.tv) "TV" else "phone"
            Field("On this $thing") {
                Joint(tiers, state.quality ?: "auto") { vm.quality(it, cell = false) }
                device?.let { d -> Text("This $thing plays " + (listOf(if (d.maxHeight >= 2160) "4K" else "${minOf(d.maxHeight, 1080)}p") + d.hdr.map { hdrName(it) } + d.passthrough.filter { it == "truehd" || it == "eac3" }.map { if (it == "truehd") "Dolby TrueHD" else "Dolby Digital Plus" }).joinToString(" · "),
                    style = ui(13, color = Night.fg3), modifier = Modifier.padding(top = 8.dp)) }
            }
            if (watch.cellular) Field("On mobile data") { Joint(tiers, state.cellQuality ?: "auto") { vm.quality(it, cell = true) } }
        }
        Part.Playing -> {
            Toggle("Play the next episode", p.autoplayNext) { on -> store.set("autoplayNext", on) { it.copy(autoplayNext = on) } }
            Toggle("Skip intros and recaps", p.skipIntros) { on -> store.set("skipIntros", on) { it.copy(skipIntros = on) } }
        }
        Part.Home -> {
            Toggle("Previews", p.previews) { on -> store.set("previews", on) { it.copy(previews = on) } }
        }
        Part.Languages -> {
            Picker("My language", languageName(p.audioLanguage), languages, p.audioLanguage) { v -> store.set("audioLanguage", v) { it.copy(audioLanguage = v) } }
            Field("Anime") { Joint(if (tv) listOf("original" to "Original, with subtitles", "dub" to "Dubbed when there is one") else listOf("original" to "Subtitles", "dub" to "Dubbed"), p.animeAudio) { v -> store.set("animeAudio", v) { it.copy(animeAudio = v) } } }
            Field("Films and series") { Joint(if (tv) listOf("original" to "Original audio", "mine" to "My language when there is one") else listOf("original" to "Original", "mine" to "My language"), p.filmAudio) { v -> store.set("filmAudio", v) { it.copy(filmAudio = v) } } }
            Field("Subtitles", if (p.subtitles == "auto") "Automatic: when the audio isn’t in your language." else null) {
                Joint(listOf("auto" to "Automatic", "always" to "Always", "off" to "Off"), p.subtitles) { v -> store.set("subtitles", v) { it.copy(subtitles = v) } }
            }
            Picker("Subtitle language", if (p.subtitleLanguage.isBlank()) "Same as my language" else languageName(p.subtitleLanguage),
                listOf("" to "Same as my language") + languages, p.subtitleLanguage) { v -> store.set("subtitleLanguage", v) { it.copy(subtitleLanguage = v) } }
        }
        Part.Look -> {
            SubtitleSample(p.subtitleSize, p.subtitleBackground, watch.tv, Modifier.padding(top = 6.dp, bottom = 6.dp))
            Field("Size") { Joint(listOf("small" to "Small", "medium" to "Medium", "large" to "Large"), p.subtitleSize) { v -> store.set("subtitleSize", v) { it.copy(subtitleSize = v) } } }
            Field("Background") { Joint(listOf("none" to "None", "shadow" to "Shadow", "box" to "Box"), p.subtitleBackground) { v -> store.set("subtitleBackground", v) { it.copy(subtitleBackground = v) } } }
        }
        Part.Anime -> {
            Field("Episodes") { Joint(listOf("seasons" to "By season", "continuous" to "One list"), p.animeEpisodes) { v -> store.set("animeEpisodes", v) { it.copy(animeEpisodes = v) } } }
            Field("Filler episodes") { Joint(listOf("ask" to "Ask", "skip" to "Skip", "watch" to "Watch"), p.fillers) { v -> store.set("fillers", v) { it.copy(fillers = v) } } }
        }
        Part.Downloads -> {
            val dl = watch.downloads
            val wifi by dl.wifiOnly.collectAsState()
            val states by dl.states.collectAsState()
            var used by remember { mutableLongStateOf(0L) }
            LaunchedEffect(states) { used = runCatching { dl.usedBytes() }.getOrDefault(0L) }
            Field("Quality") { Joint(listOf("standard" to "Standard", "higher" to "Higher"), p.downloadQuality) { v -> store.set("downloadQuality", v) { it.copy(downloadQuality = v) } } }
            Toggle("Wi‑Fi only", wifi) { dl.setWifiOnly(it) }
            Line("Storage used", sizeOf(used))
            if (states.isNotEmpty()) Confirming("Delete all downloads", "Delete every download?") { dl.removeAll() }
        }
        Part.Account -> {
            val profile by watch.accounts.active.collectAsState()
            val scope = rememberCoroutineScope()
            profile?.let { pr ->
                Row(Modifier.padding(vertical = 10.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                    Face(pr, if (tv) 56.dp else 48.dp)
                    Column {
                        Text(pr.shown, style = ui(17, FontWeight.Bold))
                        Text(pr.username, style = ui(14, color = Night.fg3))
                    }
                }
                if (onProfiles != null) Action("Switch profile") { onProfiles() }
                if (!tv) Action("Kimono account") { watch.openUrl(pr.server + "/account") }
                Confirming("Sign out", "Sign out of ${pr.shown}?") { scope.launch { watch.prefs.clear(); watch.accounts.remove(pr) } }
                Text("About", style = ui(15, FontWeight.Bold), modifier = Modifier.padding(top = 22.dp, bottom = 4.dp))
                Line("Server", pr.server.removePrefix("https://").removePrefix("http://"))
                if (watch.version.isNotBlank()) Line("Version", watch.version)
            }
        }
    }
}

private fun hdrName(h: String) = when (h) { "dv" -> "Dolby Vision"; "hdr10" -> "HDR10"; "hdr10plus" -> "HDR10+"; "hlg" -> "HLG"; else -> h.uppercase() }

private fun sizeOf(bytes: Long): String = when {
    bytes >= 1L shl 30 -> "${(bytes * 10 / (1L shl 30)) / 10.0} GB"
    bytes >= 1L shl 20 -> "${bytes / (1L shl 20)} MB"
    bytes > 0 -> "Under 1 MB"
    else -> "None"
}

/** "Player" or "App": the two halves of Settings. */
@Composable
private fun Half(title: String, first: Boolean) {
    Text(title, style = display(22), color = Night.fg2, modifier = Modifier.padding(top = if (first) 8.dp else 40.dp))
}

@Composable
private fun Group(title: String) {
    Text(title, style = ui(19, FontWeight.Bold), modifier = Modifier.padding(top = 26.dp, bottom = 6.dp))
}

/** A labelled control, with at most one quiet line under the label. */
@Composable
private fun Field(label: String, note: String? = null, content: @Composable () -> Unit) {
    Column(Modifier.fillMaxWidth().padding(vertical = 10.dp)) {
        Text(label, style = ui(15, FontWeight.Bold), modifier = Modifier.padding(bottom = if (note == null) 8.dp else 2.dp))
        note?.let { Text(it, style = ui(13, color = Night.fg3), modifier = Modifier.padding(bottom = 8.dp)) }
        content()
    }
}

/**
 * The segmented joint: options set side by side in one flat frame, the chosen
 * one in paper. Each part is its own D-pad stop.
 */
@Composable
fun Joint(options: List<Pair<String, String>>, selected: String, onPick: (String) -> Unit) {
    Row(Modifier.clip(RoundedCornerShape(10.dp)).border(1.5.dp, Night.line, RoundedCornerShape(10.dp)).background(Night.surface2).padding(3.dp),
        horizontalArrangement = Arrangement.spacedBy(3.dp)) {
        options.forEach { (value, label) ->
            val on = value == selected
            Text(label, style = ui(14, if (on) FontWeight.Bold else FontWeight.Normal, if (on) Night.ink else Night.fg2), textAlign = TextAlign.Center,
                modifier = Modifier.clickableScaleClipped(RoundedCornerShape(7.dp), { onPick(value) }).background(if (on) Night.paper else Color.Transparent, RoundedCornerShape(7.dp))
                    .padding(horizontal = 12.dp, vertical = 9.dp))
        }
    }
}

@Composable
private fun Toggle(label: String, on: Boolean, onChange: (Boolean) -> Unit) {
    Row(Modifier.fillMaxWidth().clickableScaleClipped(RoundedCornerShape(8.dp), { onChange(!on) }).padding(horizontal = 4.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically) {
        Text(label, style = ui(15, color = Night.fg), modifier = Modifier.weight(1f))
        Switch(on)
    }
}

/** A value with its options folded under it until it's opened. */
@Composable
private fun Picker(label: String, shown: String, options: List<Pair<String, String>>, selected: String, onPick: (String) -> Unit) {
    var open by remember { mutableStateOf(false) }
    Column(Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
        Row(Modifier.fillMaxWidth().clickableScaleClipped(RoundedCornerShape(8.dp), { open = !open }).padding(horizontal = 4.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(label, style = ui(15, FontWeight.Bold), modifier = Modifier.weight(1f))
            Text(shown + if (open) "" else "  ›", style = ui(15, color = Night.fg2))
        }
        AnimatedVisibility(open) {
            Column(Modifier.padding(start = 4.dp)) {
                options.forEach { (value, name) -> Choice(name, value == selected) { onPick(value); open = false } }
            }
        }
    }
}

/** An option as a row, never a chip: a tick when chosen. */
@Composable
fun Choice(label: String, selected: Boolean, onClick: () -> Unit) {
    Row(Modifier.widthIn(max = 560.dp).fillMaxWidth().clickableScaleClipped(RoundedCornerShape(8.dp), onClick).padding(horizontal = 6.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        I(Ic.check, 20.dp, if (selected) Night.blush else Color.Transparent)
        Text(label, style = ui(15, if (selected) FontWeight.Bold else FontWeight.Normal, if (selected) Night.fg else Night.fg2))
    }
}

@Composable
private fun Line(label: String, value: String) {
    Row(Modifier.fillMaxWidth().padding(horizontal = 4.dp, vertical = 10.dp)) {
        Text(label, style = ui(15), modifier = Modifier.weight(1f))
        Text(value, style = ui(15, color = Night.fg2))
    }
}

@Composable
private fun Action(label: String, onClick: () -> Unit) {
    Row(Modifier.fillMaxWidth().clickableScaleClipped(RoundedCornerShape(8.dp), onClick).padding(horizontal = 4.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(label, style = ui(15), modifier = Modifier.weight(1f))
        Text("›", style = ui(17, color = Night.fg3))
    }
}

/** Something that can't be undone: the first press asks, the second does it. */
@Composable
private fun Confirming(label: String, ask: String, onConfirm: () -> Unit) {
    var asking by remember { mutableStateOf(false) }
    LaunchedEffect(asking) { if (asking) { delay(4000); asking = false } }
    Text(if (asking) "$ask Press again" else label, style = ui(15, FontWeight.Bold, Night.blush),
        modifier = Modifier.fillMaxWidth().clickableScaleClipped(RoundedCornerShape(8.dp), { if (asking) { asking = false; onConfirm() } else asking = true }).padding(horizontal = 4.dp, vertical = 12.dp))
}

/** A line of dialogue over a dark frame, drawn the way the player will draw it. */
@Composable
fun SubtitleSample(size: String, background: String, tv: Boolean, modifier: Modifier = Modifier) {
    /* The size it will be in the player, whose picture fills the screen's short side. */
    val window = androidx.compose.ui.platform.LocalWindowInfo.current.containerSize
    val picture = with(androidx.compose.ui.platform.LocalDensity.current) { minOf(window.width, window.height).toDp() }
    Box(modifier.fillMaxWidth().widthIn(max = 560.dp).aspectRatio(16f / 9f).clip(RoundedCornerShape(10.dp)).background(Night.surface3), contentAlignment = Alignment.BottomCenter) {
        androidx.compose.foundation.layout.BoxWithConstraints(Modifier.fillMaxSize()) {
            /* The player's sizes, as a share of the picture's height (Engine.subtitleLook). */
            val share = when (size) { "small" -> 0.036f; "large" -> 0.054f; else -> 0.044f } * (if (tv) 1.15f else 1.4f)
            val px = picture * share
            CaptionText("I’ll wait for you here.", px, background, Modifier.align(Alignment.BottomCenter).padding(bottom = maxHeight * 0.08f))
        }
    }
}

@Composable
private fun CaptionText(text: String, size: Dp, background: String, modifier: Modifier) {
    val fontSize = (size.value).sp
    val base = ui(16, FontWeight.Bold, Night.paper).copy(fontSize = fontSize, lineHeight = fontSize * 1.25f, textAlign = TextAlign.Center)
    when (background) {
        "box" -> Text(text, style = base, modifier = modifier.background(Color(0xB8110C0A), RoundedCornerShape(4.dp)).padding(horizontal = 8.dp, vertical = 3.dp))
        "shadow" -> Text(text, style = base.copy(shadow = Shadow(Color(0xCC000000), Offset(0f, 3f), 8f)), modifier = modifier)
        else -> Box(modifier) {
            /* An ink outline under the paper, so it reads on any picture. */
            Text(text, style = base.copy(color = Night.bg, drawStyle = Stroke(width = 5f)))
            Text(text, style = base)
        }
    }
}

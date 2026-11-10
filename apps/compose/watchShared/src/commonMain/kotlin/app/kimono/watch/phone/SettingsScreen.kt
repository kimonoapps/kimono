package app.kimono.watch.phone

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import app.kimono.watch.Entry
import app.kimono.watch.LocalWatch
import app.kimono.watch.ink.InkLoader
import app.kimono.watch.theme.Night
import app.kimono.watch.theme.display
import app.kimono.watch.theme.ui
import app.kimono.watch.ui.I
import app.kimono.watch.ui.Ic
import app.kimono.watch.ui.Screen
import app.kimono.watch.ui.SettingsViewModel
import app.kimono.watch.ui.clickableScale
import app.kimono.watch.ui.clickableScaleClipped

/** The qualities a device can keep, as the server names them (lib/watch/releases.ts qualityLabels). */
val qualityChoices = listOf("auto" to "Auto", "2160" to "4K", "1080" to "1080p", "720" to "720p", "saver" to "Data saver")

/** Settings: quality on this device (and on mobile data), and how playback behaves. */
@Composable
fun SettingsScreen(onClose: () -> Unit, wide: Boolean = false) {
    val watch = LocalWatch.current
    val entry = remember { Entry(Screen.Settings) }
    androidx.compose.runtime.DisposableEffect(entry) { onDispose { entry.store.clear() } }
    val vm = entry.vm { SettingsViewModel(watch.api, watch.deviceId, watch.cellular) }
    val state by vm.state.collectAsState()
    val gutter = if (wide) 48.dp else 16.dp
    Box(Modifier.fillMaxSize().background(Night.bg)) {
        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(top = statusTop + 64.dp, bottom = navBottom + 32.dp, start = gutter, end = gutter)) {
            item { Text("Settings", style = display(if (wide) 40 else 28), modifier = Modifier.padding(bottom = 18.dp)) }
            if (state.loading) { item { Box(Modifier.fillMaxWidth().padding(40.dp), contentAlignment = Alignment.Center) { InkLoader(size = 40.dp) } }; return@LazyColumn }
            item { Group("Quality on this device", "Used unless you pick another in the player.") }
            qualityChoices.forEach { (value, label) -> item("q$value") { Choice(label, (state.quality ?: "auto") == value) { vm.quality(value, cell = false) } } }
            if (watch.cellular) {
                item { Group("On mobile data", "When this phone isn’t on Wi‑Fi.") }
                qualityChoices.forEach { (value, label) -> item("c$value") { Choice(label, (state.cellQuality ?: "auto") == value) { vm.quality(value, cell = true) } } }
            }
            state.prefs?.let { prefs ->
                item { Group("Playback", null) }
                item { Toggle("Skip intros by themselves", prefs.skipIntros) { vm.toggle("skipIntros", it) } }
                item { Toggle("Play the next episode", prefs.autoplayNext) { vm.toggle("autoplayNext", it) } }
            }
        }
        Box(Modifier.align(Alignment.TopEnd).padding(top = statusTop + 12.dp, end = 12.dp).size(38.dp).clip(CircleShape).background(Color(0xBF110C0A)).clickableScale(onClose), contentAlignment = Alignment.Center) { I(Ic.close) }
    }
}

@Composable
private fun Group(title: String, note: String?) {
    Column(Modifier.padding(top = 18.dp, bottom = 6.dp)) {
        Text(title, style = ui(17, FontWeight.Bold))
        note?.let { Text(it, style = ui(13, color = Night.fg2)) }
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
private fun Toggle(label: String, on: Boolean, onChange: (Boolean) -> Unit) {
    Row(Modifier.widthIn(max = 560.dp).fillMaxWidth().clickableScaleClipped(RoundedCornerShape(8.dp), { onChange(!on) }).padding(horizontal = 6.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically) {
        Text(label, style = ui(15, color = Night.fg), modifier = Modifier.weight(1f))
        Switch(on)
    }
}

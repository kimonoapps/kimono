@file:OptIn(ExperimentalMaterial3Api::class, ExperimentalMaterial3ExpressiveApi::class)

package app.kimono.screens

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExperimentalMaterial3ExpressiveApi
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.kimono.data.AccountProfile
import app.kimono.data.AppUpdate
import app.kimono.data.Code
import app.kimono.data.CodeWorkspace
import app.kimono.data.Drive
import app.kimono.data.DriveNode
import app.kimono.data.KimonoProblem
import app.kimono.data.LauncherApp
import app.kimono.data.Platform
import app.kimono.data.Vpn
import app.kimono.data.VpnView
import app.kimono.theme.Kata
import app.kimono.ui.InkBlot
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.shape.RoundedCornerShape
import app.kimono.ui.FileTypeMark
import app.kimono.ui.fileMarkUri
import app.kimono.ui.InkBloom
import app.kimono.ui.InkCrest
import app.kimono.ui.InkDot
import app.kimono.ui.KimonoBranch
import app.kimono.ui.KimonoRefresh
import app.kimono.ui.kimonoIcon
import kotlinx.coroutines.launch
import kotlin.time.Clock

/*
 * 家 Home: what's happening in your house now. Not the apps (the flower in
 * the middle of the bar has those) but a glance at them: an update that's
 * ready, Code's tasks that are working or waiting, what's new in Drive, and
 * which of your devices are connected. A card shows only when it has
 * something to say; when nothing does, Home says so.
 */
@Composable
fun HomeScreen(
    me: AccountProfile?, platform: Platform, update: AppUpdate?, onLater: () -> Unit,
    drive: Drive, code: Code, vpn: Vpn, admin: Boolean,
    here: (LauncherApp) -> PhoneAppHere, go: (String) -> Unit,
) {
    val first = me?.name?.split(" ")?.firstOrNull()?.takeIf { it.isNotBlank() } ?: me?.username ?: "home"
    val apps by drive.launcher.collectAsState()
    val driveOn by drive.driveOn.collectAsState()
    var recent by remember { mutableStateOf<List<DriveNode>?>(null) }
    var tasks by remember { mutableStateOf(code.knownWorkspaces()) }
    var devices by remember { mutableStateOf(vpn.known()) }
    var refreshing by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val codeApp = apps?.firstOrNull { it.id == Code.APP_ID }
    val vpnApp = apps?.firstOrNull { it.id == "kimono-vpn" }
    val driveApp = apps?.firstOrNull { it.id == "kimono-drive" }

    suspend fun load() {
        runCatching { drive.otherApps() }
        if (driveOn != false) recent = runCatching { drive.recent() }.getOrNull() ?: recent
        if (codeApp != null) tasks = runCatching { code.workspaces() }.getOrNull() ?: tasks
        if (vpnApp != null) devices = runCatching { vpn.view() }.getOrNull() ?: devices
    }
    LaunchedEffect(codeApp != null, vpnApp != null) { load() }

    val updates = apps.orEmpty().mapNotNull { app -> here(app).update?.let { app to it } }
    val waiting = tasks.orEmpty().filter { it.running }.sortedByDescending { it.updatedAt }
    val shownTasks = (waiting.ifEmpty { tasks.orEmpty().sortedByDescending { it.updatedAt } }).take(3)
    val newFiles = recent.orEmpty().filter { !it.isFolder }.take(4)
    val mesh = devices?.takeIf { it.member && it.available && it.devices.isNotEmpty() }

    KimonoRefresh(refreshing, { scope.launch { refreshing = true; load(); refreshing = false } }, Modifier.fillMaxSize()) {
        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 32.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            item {
                Column {
                    TopAppBar(
                        title = { Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) { KimonoBranch(30.dp); Text("kimono", style = MaterialTheme.typography.titleLarge) } },
                        colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.surface),
                    )
                    Column(Modifier.padding(start = 20.dp, end = 20.dp, top = 14.dp, bottom = 6.dp)) {
                        Text("Your household", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary)
                        Text(buildAnnotatedString {
                            append("Welcome home, ")
                            withStyle(SpanStyle(color = MaterialTheme.colorScheme.primary)) { append("$first.") }
                        }, style = MaterialTheme.typography.displaySmall, modifier = Modifier.padding(top = 6.dp))
                    }
                }
            }
            if (update != null) item { UpdateCard(update, platform, onLater) }
            if (updates.isNotEmpty()) item {
                Glance(null, "Updates ready", null) {
                    updates.forEach { (app, version) ->
                        Line(lead = { InkBloom(app.id, app.accent, app.glyph, 32.dp) }, title = app.phoneApp?.name ?: app.name, detail = "$version is ready") { go("app/${app.id}") }
                    }
                }
            }
            if (codeApp != null && shownTasks.isNotEmpty()) item {
                val working = tasks.orEmpty().count { it.running }
                Glance(codeApp, "Kimono AI", if (working > 0) "$working working" else null, onOpen = { go("code") }) {
                    shownTasks.forEach { task ->
                        Line(
                            lead = { InkDot(if (task.running) Kata.moss else Color(0xFFB9A8A2), size = 10.dp, seed = task.id) },
                            title = task.title,
                            detail = listOfNotNull(task.repo.name.takeIf { task.isProject }, if (task.running) "working" else task.pullRequest?.let { "pull request #${it.number}" } ?: whenAgo(task.updatedAt)).joinToString(" · "),
                            mono = true,
                        ) { go("code/${task.id}") }
                    }
                }
            }
            if (driveOn != false && newFiles.isNotEmpty()) item {
                val spaces = drive.knownSpaces().orEmpty()
                Glance(driveApp, "New in Drive", null, onOpen = { go("drive") }) {
                    newFiles.forEach { file ->
                        val space = spaces.firstOrNull { it.id == file.spaceId }
                        Line(
                            /* The file's own mark when it has one (the space is named underneath), else the space's crest. */
                            lead = {
                                if (fileMarkUri(file.name) != null) Box(Modifier.size(32.dp).background(MaterialTheme.colorScheme.surfaceContainerLowest, RoundedCornerShape(10.dp)).border(1.dp, MaterialTheme.colorScheme.outlineVariant, RoundedCornerShape(10.dp)), contentAlignment = Alignment.Center) {
                                    FileTypeMark(file.name, Modifier.size(19.dp)) { Icon(kimonoIcon("file"), null, tint = Kata.plum, modifier = Modifier.size(16.dp)) }
                                }
                                else if (space != null) InkCrest(space.crest, space.color, 32.dp)
                                else InkBlot(file.id, size = 32.dp) { Icon(kimonoIcon("file"), null, tint = Kata.plum, modifier = Modifier.size(16.dp)) }
                            },
                            title = file.name,
                            detail = listOfNotNull(space?.name, whenAgo(file.updatedAt.toLong())).joinToString(" · "),
                        ) { file.parentId?.let { go("folder/$it") } }
                    }
                }
            }
            if (mesh != null) item {
                val connected = mesh.devices.count { it.online }
                Glance(vpnApp, "Your devices", "$connected of ${mesh.devices.size} connected", onOpen = { go("vpn") }) {
                    mesh.devices.sortedByDescending { it.online }.take(4).forEach { device ->
                        Line(lead = { InkDot(if (device.online) Kata.moss else Color(0xFFB9A8A2), size = 10.dp, seed = device.id) }, title = device.name, detail = device.seen) { go("vpn") }
                    }
                }
            }
            if (update == null && updates.isEmpty() && shownTasks.isEmpty() && newFiles.isEmpty() && mesh == null && apps != null) item {
                Column(Modifier.fillMaxWidth().padding(vertical = 36.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                    InkBlot("home-quiet", size = 72.dp) { KimonoBranch(32.dp) }
                    Text("All quiet at home.", style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(top = 12.dp))
                    Text("Your apps are under the flower.", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }
    }
}

private fun whenAgo(at: Long): String? {
    if (at <= 0) return null
    val minutes = (Clock.System.now().toEpochMilliseconds() - at) / 60_000
    return when {
        minutes < 1 -> "just now"
        minutes < 60 -> "${minutes}m ago"
        minutes < 60 * 24 -> "${minutes / 60}h ago"
        else -> "${minutes / (60 * 24)}d ago"
    }
}

/** One glance: the app's bloom, a title, a note, its lines; the whole card opens the app. */
@Composable
private fun Glance(app: LauncherApp?, title: String, note: String?, onOpen: (() -> Unit)? = null, lines: @Composable () -> Unit) {
    Card(
        shape = MaterialTheme.shapes.extraLarge,
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer),
        modifier = Modifier.padding(horizontal = 16.dp).fillMaxWidth(),
    ) {
        Row(
            Modifier.fillMaxWidth().let { if (onOpen != null) it.clickable(onClick = onOpen) else it }.padding(start = 18.dp, end = 14.dp, top = 16.dp, bottom = 6.dp),
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            if (app != null) InkBloom(app.id, app.accent, app.glyph, 30.dp)
            Text(title, style = MaterialTheme.typography.titleLarge, modifier = Modifier.weight(1f))
            if (note != null) Text(note, style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.primary)
            if (onOpen != null) Icon(kimonoIcon("go"), null, modifier = Modifier.size(18.dp))
        }
        Column(Modifier.padding(bottom = 8.dp)) { lines() }
    }
}

@Composable
private fun Line(lead: @Composable () -> Unit, title: String, detail: String?, mono: Boolean = false, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().clickable(onClick = onClick).padding(horizontal = 18.dp, vertical = 9.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        androidx.compose.foundation.layout.Box(Modifier.size(32.dp), contentAlignment = Alignment.Center) { lead() }
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.bodyLarge, maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (!detail.isNullOrBlank()) Text(detail, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis, fontFamily = if (mono) FontFamily.Monospace else null, fontSize = if (mono) 12.sp else MaterialTheme.typography.bodySmall.fontSize)
        }
    }
}

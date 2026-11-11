@file:OptIn(ExperimentalMaterial3Api::class, ExperimentalMaterial3ExpressiveApi::class)

package app.kimono.screens

import app.kimono.ui.InkDialog
import app.kimono.ui.InkConfirm
import app.kimono.ui.InkTitle
import app.kimono.ui.InkSheet
import app.kimono.ui.InkMenuItem
import app.kimono.ui.InkMenu
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
import androidx.compose.ui.draw.clip
import androidx.compose.foundation.shape.RoundedCornerShape
import app.kimono.ui.FileTypeMark
import app.kimono.ui.fileMarkUri
import app.kimono.ui.InkBloom
import app.kimono.ui.InkCrest
import app.kimono.ui.InkDot
import app.kimono.ui.KimonoBranch
import app.kimono.ui.KimonoRefresh
import app.kimono.ui.kimonoIcon
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch
import app.kimono.ui.segmentColors
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.itemsIndexed
import kotlin.time.Clock

/*
 * 家 Home, in three parts that don't run into each other:
 *  - Your apps: the ones pinned (My apps, shared with the website's rail), a tap away.
 *  - New: apps just added and still in beta, unless pinned.
 *  - Now: a short row of glances, only those with something to say (Kimono AI's chats,
 *    what's new in Drive, your devices, updates ready), sliding sideways so they never push
 *    the apps down.
 *  - Everything else: every other app under what it's for, as a quiet list.
 * Hold an app anywhere to pin or unpin it.
 */
@Composable
fun HomeScreen(
    me: AccountProfile?, platform: Platform, update: AppUpdate?, onLater: () -> Unit, recheck: suspend () -> Unit,
    drive: Drive, code: Code, vpn: Vpn, admin: Boolean,
    here: (LauncherApp) -> PhoneAppHere, open: (LauncherApp) -> Unit, go: (String) -> Unit,
) {
    val first = me?.name?.split(" ")?.firstOrNull()?.takeIf { it.isNotBlank() } ?: me?.username ?: "home"
    val apps by drive.launcher.collectAsState()
    val driveOn by drive.driveOn.collectAsState()
    val mine by drive.myApps.collectAsState()
    val groups by drive.appGroups.collectAsState()
    val newIds by drive.newApps.collectAsState()
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
    val chats = tasks.orEmpty().filter { !it.isProject || admin }
    val working = chats.count { it.running }
    val shownTasks = chats.sortedWith(compareByDescending<CodeWorkspace> { if (it.running) 1 else 0 }.thenByDescending { it.updatedAt }).take(3)
    val newFiles = recent.orEmpty().filter { !it.isFolder }.take(3)
    val mesh = devices?.takeIf { it.member && it.available && it.devices.isNotEmpty() }
    val pinned = apps?.let { all -> myAppsOf(all, mine) }.orEmpty()
    val pinnedIds = pinned.map { it.id }.toSet()
    val fresh = newIds.mapNotNull { id -> apps?.firstOrNull { it.id == id && id !in pinnedIds } }
    /* Every other app under what it's for; a Kimono from before the groups lists them all as one. */
    val rest = apps.orEmpty().filter { it.id !in pinnedIds && it.id !in newIds }
    val sections = rest.let { all ->
        val byId = all.associateBy { it.id }
        val placed = groups.flatMap { it.apps }.toSet()
        val listed = groups.map { it.label to it.apps.mapNotNull { id -> byId[id] } } + listOf("More" to all.filter { it.id !in placed })
        if (groups.isEmpty()) listOf("Apps" to all).filter { it.second.isNotEmpty() } else listed.filter { it.second.isNotEmpty() }
    }
    fun pin(app: LauncherApp) {
        val now = mine ?: return
        scope.launch { runCatching { drive.setMyApps(if (app.id in now) now - app.id else now + app.id) } }
    }
    val canPin = mine != null

    KimonoRefresh(refreshing, { scope.launch { refreshing = true; coroutineScope { launch { recheck() }; load() }; refreshing = false } }, Modifier.fillMaxSize()) {
        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 32.dp)) {
            item(key = "head") {
                Column {
                    TopAppBar(
                        title = { Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) { KimonoBranch(30.dp); Text("kimono", style = MaterialTheme.typography.titleLarge) } },
                        colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.surface),
                    )
                    Text(buildAnnotatedString {
                        append("Welcome home, ")
                        withStyle(SpanStyle(color = MaterialTheme.colorScheme.primary)) { append("$first.") }
                    }, style = MaterialTheme.typography.headlineLarge, modifier = Modifier.padding(start = 20.dp, end = 20.dp, top = 8.dp, bottom = 4.dp))
                }
            }
            if (update != null) item(key = "update") { UpdateCard(update, platform, onLater) }

            /* ── Your apps ── */
            if (pinned.isNotEmpty() || apps != null) item(key = "mine-label") { Part("Your apps") }
            if (apps == null) item(key = "loading") { Box(Modifier.fillMaxWidth().padding(48.dp), contentAlignment = Alignment.Center) { app.kimono.ui.InkLoader() } }
            if (apps != null && pinned.isEmpty()) item(key = "mine-empty") {
                Text("Hold an app below to pin it here.", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(horizontal = 20.dp, vertical = 8.dp))
            }
            pinned.chunked(4).forEachIndexed { row, four ->
                item(key = "mine:$row") {
                    Row(Modifier.padding(horizontal = 12.dp).fillMaxWidth()) {
                        four.forEach { app -> Box(Modifier.weight(1f)) { Launch(app, here(app), pinned = true, canPin = canPin, pin = { pin(app) }) { open(app) } } }
                        repeat(4 - four.size) { Spacer(Modifier.weight(1f)) }
                    }
                }
            }

            /* ── New ── */
            if (fresh.isNotEmpty()) item(key = "new-label") { Part("New") }
            itemsIndexed(fresh, key = { _, app -> "new:${app.id}" }) { index, app ->
                Box(Modifier.padding(horizontal = 16.dp, vertical = 1.dp)) {
                    AppLine(app, here(app), index, fresh.size, canPin = canPin, fresh = true, pin = { pin(app) }) { open(app) }
                }
            }

            /* ── Now ── */
            val glances = buildList<@Composable () -> Unit> {
                if (codeApp != null && shownTasks.isNotEmpty()) add {
                    Glance(codeApp, "Kimono AI", if (working > 0) "$working working" else null, onOpen = { go("code") }) {
                        shownTasks.forEach { task ->
                            Line(
                                lead = { InkDot(if (task.running) Kata.moss else quietGrey, size = 8.dp, seed = task.id) },
                                title = task.title,
                                detail = if (task.running) "working" else whenAgo(task.updatedAt),
                            ) { go("code/${task.id}") }
                        }
                    }
                }
                if (driveOn != false && newFiles.isNotEmpty()) add {
                    val spaces = drive.knownSpaces().orEmpty()
                    Glance(driveApp, "New in Drive", null, onOpen = { go("drive") }) {
                        newFiles.forEach { file ->
                            val space = spaces.firstOrNull { it.id == file.spaceId }
                            Line(
                                lead = {
                                    if (fileMarkUri(file.name) != null) FileTypeMark(file.name, Modifier.size(18.dp)) { Icon(kimonoIcon("file"), null, modifier = Modifier.size(16.dp)) }
                                    else Icon(kimonoIcon("file"), null, modifier = Modifier.size(16.dp))
                                },
                                title = file.name,
                                detail = listOfNotNull(space?.name, whenAgo(file.updatedAt.toLong())).joinToString(" · "),
                            ) { file.parentId?.let { go("folder/$it") } }
                        }
                    }
                }
                if (mesh != null) add {
                    val connected = mesh.devices.count { it.online }
                    Glance(vpnApp, "Your devices", "$connected of ${mesh.devices.size}", onOpen = { go("vpn") }) {
                        mesh.devices.sortedByDescending { it.online }.take(3).forEach { device ->
                            Line(lead = { InkDot(if (device.online) Kata.moss else quietGrey, size = 8.dp, seed = device.id) }, title = device.name, detail = if (device.online) "connected" else device.seen) { go("vpn") }
                        }
                    }
                }
                if (updates.isNotEmpty()) add {
                    Glance(null, "Updates ready", "${updates.size}", onOpen = null) {
                        updates.take(3).forEach { (app, version) ->
                            Line(lead = { InkBloom(app.id, app.accent, app.glyph, 22.dp) }, title = app.phoneApp?.name ?: app.name, detail = version) { go("app/${app.id}") }
                        }
                    }
                }
            }
            if (glances.isNotEmpty()) {
                item(key = "now-label") { Part("Now") }
                item(key = "now") {
                    LazyRow(contentPadding = PaddingValues(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        items(glances.size) { i -> glances[i]() }
                    }
                }
            }

            /* ── Everything else ── */
            if (rest.isNotEmpty()) item(key = "rest-label") { Part(if (pinned.isEmpty()) "Apps" else "More apps") }
            sections.forEach { (label, list) ->
                if (sections.size > 1) item(key = "group:$label") {
                    Text(label, style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(start = 24.dp, top = 10.dp, bottom = 6.dp))
                }
                itemsIndexed(list, key = { _, app -> "rest:${app.id}" }) { index, app ->
                    Box(Modifier.padding(horizontal = 16.dp, vertical = 1.dp)) {
                        AppLine(app, here(app), index, list.size, canPin = canPin, fresh = app.id in newIds, pin = { pin(app) }) { open(app) }
                    }
                }
            }
        }
    }
}

/** A part of Home: big enough to tell the parts apart at a glance. */
@Composable
private fun Part(title: String) {
    Text(title, style = MaterialTheme.typography.titleLarge, modifier = Modifier.padding(start = 20.dp, end = 20.dp, top = 22.dp, bottom = 10.dp))
}

/** A pinned app: its bloom and its name, nothing more. Held, it can be unpinned. */
@Composable
private fun Launch(app: LauncherApp, here: PhoneAppHere, pinned: Boolean, canPin: Boolean, pin: () -> Unit, onClick: () -> Unit) {
    var menu by remember { mutableStateOf(false) }
    Box {
        Column(
            Modifier.fillMaxWidth().clip(MaterialTheme.shapes.large).combinedClickable(onClick = onClick, onLongClick = if (canPin) ({ menu = true }) else null).padding(vertical = 10.dp),
            horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Box(Modifier.size(60.dp), contentAlignment = Alignment.Center) {
                InkBloom(app.id, app.accent, app.glyph, 60.dp)
                if (app.glyph == null && app.icon != null) coil3.compose.AsyncImage(model = app.icon, contentDescription = null, modifier = Modifier.size(18.dp))
                if (here.update != null) Box(Modifier.align(Alignment.TopEnd).size(10.dp).clip(androidx.compose.foundation.shape.CircleShape).background(MaterialTheme.colorScheme.primary))
            }
            Text(app.name, style = MaterialTheme.typography.labelLarge, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(horizontal = 4.dp))
        }
        PinMenu(menu, pinned, app.name, { menu = false }, pin)
    }
}

/** Any other app: a quiet row with what it's for. Held, it can be pinned. */
@Composable
private fun AppLine(app: LauncherApp, here: PhoneAppHere, index: Int, count: Int, canPin: Boolean, fresh: Boolean, pin: () -> Unit, onClick: () -> Unit) {
    var menu by remember { mutableStateOf(false) }
    Box {
        androidx.compose.material3.SegmentedListItem(
            onClick = onClick,
            onLongClick = if (canPin) ({ menu = true }) else null,
            shapes = androidx.compose.material3.ListItemDefaults.segmentedShapes(index, count),
            colors = segmentColors(),
            leadingContent = {
                Box(Modifier.size(40.dp), contentAlignment = Alignment.Center) {
                    InkBloom(app.id, app.accent, app.glyph, 40.dp)
                    if (app.glyph == null && app.icon != null) coil3.compose.AsyncImage(model = app.icon, contentDescription = null, modifier = Modifier.size(12.dp))
                }
            },
            supportingContent = { if (app.description.isNotBlank()) Text(app.description, maxLines = 1, overflow = TextOverflow.Ellipsis) },
            trailingContent = {
                when {
                    here.update != null -> Text("Update", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary)
                    here.installed == false -> Text("Get", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    !app.own && app.phoneApp == null -> Icon(kimonoIcon("out"), "Opens in the browser", tint = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(16.dp))
                }
            },
        ) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(app.name, style = MaterialTheme.typography.bodyLarge, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
                if (fresh) { Tag("New", strong = true); Tag("Beta", strong = false) }
            }
        }
        PinMenu(menu, false, app.name, { menu = false }, pin)
    }
}

/** A small flat tag beside an app's name: New in the app's ink, Beta quiet. */
@Composable
private fun Tag(text: String, strong: Boolean) {
    val colors = MaterialTheme.colorScheme
    Text(
        text, style = MaterialTheme.typography.labelSmall, color = if (strong) colors.onPrimary else colors.onSurfaceVariant,
        modifier = Modifier.clip(MaterialTheme.shapes.extraSmall).background(if (strong) colors.primary else colors.surfaceContainerHighest).padding(horizontal = 6.dp, vertical = 1.dp),
    )
}

@Composable
private fun PinMenu(open: Boolean, pinned: Boolean, name: String, close: () -> Unit, pin: () -> Unit) {
    InkMenu(expanded = open, onDismissRequest = close, atTop = true) {
        InkMenuItem(if (pinned) "Unpin $name" else "Pin to Your apps", icon = "pin", onClick = { close(); pin() })
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

/** One glance, a card in Now's row: the app's bloom, a title, a note and a few lines; its head opens the app. */
@Composable
private fun Glance(app: LauncherApp?, title: String, note: String?, onOpen: (() -> Unit)? = null, lines: @Composable () -> Unit) {
    Card(
        shape = MaterialTheme.shapes.extraLarge,
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer),
        modifier = Modifier.width(272.dp),
    ) {
        Row(
            Modifier.fillMaxWidth().let { if (onOpen != null) it.clickable(onClick = onOpen) else it }.padding(start = 16.dp, end = 14.dp, top = 14.dp, bottom = 4.dp),
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            if (app != null) InkBloom(app.id, app.accent, app.glyph, 28.dp)
            Text(title, style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f), maxLines = 1)
            if (note != null) Text(note, style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.primary)
            if (onOpen != null) Icon(kimonoIcon("go"), null, modifier = Modifier.size(16.dp))
        }
        Column(Modifier.padding(bottom = 8.dp)) { lines() }
    }
}

@Composable
private fun Line(lead: @Composable () -> Unit, title: String, detail: String?, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().clickable(onClick = onClick).padding(horizontal = 16.dp, vertical = 7.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Box(Modifier.size(22.dp), contentAlignment = Alignment.Center) { lead() }
        Text(title, style = MaterialTheme.typography.bodyMedium, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
        if (!detail.isNullOrBlank()) Text(detail, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
    }
}

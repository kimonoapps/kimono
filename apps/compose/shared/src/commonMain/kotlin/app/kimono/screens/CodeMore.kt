@file:OptIn(ExperimentalMaterial3Api::class, ExperimentalMaterial3ExpressiveApi::class)

package app.kimono.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExperimentalMaterial3ExpressiveApi
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ListItemDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SegmentedListItem
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import app.kimono.data.AppDetails
import app.kimono.data.AppPage
import app.kimono.data.Code
import app.kimono.data.CodeProfile
import app.kimono.data.Connection
import app.kimono.data.Connections
import app.kimono.data.KimonoProblem
import app.kimono.data.Memory
import app.kimono.data.Platform
import app.kimono.theme.Kata
import app.kimono.ui.InkLoader
import app.kimono.ui.KimonoTopBar
import app.kimono.ui.Problem
import app.kimono.ui.Seal
import app.kimono.ui.SealTone
import app.kimono.ui.kimonoIcon
import app.kimono.ui.segmentColors
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/*
 * Kimono AI's two pages of its own: Connections (the person's apps, through
 * Composio, and each app in full) and Memory (their instructions, and what it
 * keeps about them).
 */

private fun connStatus(c: Connection, now: Long) = when (c.status) {
    "ACTIVE" -> c.since?.let { since -> runCatching { kotlin.time.Instant.parse(since).toEpochMilliseconds() }.getOrNull()?.let { "Connected ${whenText(it, now)} ago".replace("now ago", "just now") } } ?: "Connected"
    "FAILED" -> "Needs connecting again"
    else -> "Connecting…"
}

/** The person's connections, kept fresh: coming back from signing in (in the browser) looks again. */
private class Conn(val code: Code, val platform: Platform) {
    var state by mutableStateOf<Connections?>(null)
    var problem by mutableStateOf<String?>(null)
    var busy by mutableStateOf<String?>(null)
    suspend fun load() { try { state = code.connections(); problem = null } catch (p: KimonoProblem) { problem = p.message } }
    suspend fun connect(app: String) {
        busy = app; problem = null
        try { platform.openUrl(code.connect(app)) } catch (p: KimonoProblem) { problem = p.message }
        busy = null
    }
    suspend fun remove(c: Connection) {
        busy = c.account; problem = null
        try { code.disconnect(c.account); load() } catch (p: KimonoProblem) { problem = p.message }
        busy = null
    }
}

@Composable
private fun rememberConn(code: Code, platform: Platform): Conn {
    val conn = remember { Conn(code, platform) }
    /* Each time the screen comes back (from the browser, say), and every so often while it's open. */
    WhileShown(Unit) { while (true) { conn.load(); delay(15_000) } }
    return conn
}

@Composable
fun ConnectionsScreen(code: Code, platform: Platform, back: () -> Unit, open: (String) -> Unit) {
    val scope = rememberCoroutineScope()
    val conn = rememberConn(code, platform)
    val time = ticking(false)
    var query by remember { mutableStateOf("") }
    var found by remember { mutableStateOf<Pair<String, AppPage>?>(null) }
    var more by remember { mutableStateOf(false) }
    LaunchedEffect(query) {
        if (query.isNotEmpty()) delay(250)
        try { found = query to code.findApps(query).let { it.copy(apps = it.apps.filter { a -> a.real }) } } catch (p: KimonoProblem) { conn.problem = p.message }
    }
    val state = conn.state
    val mine = state?.connections.orEmpty()
    /* What's connected is listed above, so the catalogue leaves it out. */
    val apps = found?.takeIf { it.first == query }?.second?.apps?.filter { !it.connected }
    Scaffold(containerColor = MaterialTheme.colorScheme.surface, topBar = { KimonoTopBar("Connections", onBack = back, mark = { AiMark(code, 32.dp) }) }) { padding ->
        LazyColumn(Modifier.padding(padding).fillMaxSize().imePadding(), contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 4.dp, bottom = 40.dp), verticalArrangement = Arrangement.spacedBy(ListItemDefaults.SegmentedGap)) {
            if (conn.problem != null) item { Problem(conn.problem) }
            when {
                state == null && conn.problem == null -> item { Box(Modifier.fillMaxWidth().padding(40.dp), contentAlignment = Alignment.Center) { InkLoader() } }
                state != null && !state.available -> item { Text("Connections aren’t available on this Kimono yet.", color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(8.dp)) }
                state != null -> {
                    if (mine.isNotEmpty()) {
                        item { Heading("Connected") }
                        itemsIndexed(mine, key = { _, c -> c.account }) { index, c ->
                            SegmentedListItem(
                                onClick = { open("ai/connections/${c.app}") },
                                shapes = ListItemDefaults.segmentedShapes(index, mine.size), colors = segmentColors(),
                                leadingContent = { LogoTile(c.logo, 40.dp) },
                                supportingContent = { Text(connStatus(c, time), color = if (c.status == "FAILED") MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant) },
                                trailingContent = { if (c.status == "FAILED") Seal("Connect again", compact = true, busy = conn.busy == c.app, onClick = { scope.launch { conn.connect(c.app) } }) else Icon(kimonoIcon("go"), null, modifier = Modifier.size(16.dp)) },
                            ) { Text(c.name, style = MaterialTheme.typography.bodyLarge) }
                        }
                        item { Box(Modifier.padding(top = 12.dp)) { Heading("Add apps") } }
                    }
                    item {
                        OutlinedTextField(
                            query, { query = it }, singleLine = true, placeholder = { Text("Search apps") },
                            leadingIcon = { Icon(kimonoIcon("search"), null, modifier = Modifier.size(20.dp)) },
                            shape = CircleShape, keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                            modifier = Modifier.fillMaxWidth().padding(bottom = 8.dp),
                        )
                    }
                    when {
                        apps == null -> item { Box(Modifier.fillMaxWidth().padding(24.dp), contentAlignment = Alignment.Center) { InkLoader(size = 32.dp) } }
                        found?.second?.apps.isNullOrEmpty() -> item { Text("No app by that name.", color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(8.dp)) }
                        else -> {
                            itemsIndexed(apps, key = { _, a -> "app-${a.app}" }) { index, a ->
                                SegmentedListItem(
                                    onClick = { open("ai/connections/${a.app}") },
                                    shapes = ListItemDefaults.segmentedShapes(index, apps.size), colors = segmentColors(),
                                    leadingContent = { LogoTile(a.logo, 40.dp) },
                                    supportingContent = { if (a.description.isNotBlank()) Text(a.description, maxLines = 2, overflow = TextOverflow.Ellipsis) },
                                    trailingContent = { Seal("Connect", compact = true, tone = SealTone.Quiet, busy = conn.busy == a.app, onClick = { scope.launch { conn.connect(a.app) } }) },
                                ) { Text(a.name, style = MaterialTheme.typography.bodyLarge) }
                            }
                            /* The catalogue is long: a page at a time, the next one added below when asked for. */
                            val next = found?.second?.next
                            if (next != null) item {
                                Box(Modifier.fillMaxWidth().padding(top = 12.dp), contentAlignment = Alignment.Center) {
                                    Seal("Show more", tone = SealTone.Quiet, busy = more, onClick = {
                                        val asked = found ?: return@Seal
                                        more = true
                                        scope.launch {
                                            try {
                                                val page = code.findApps(asked.first, next)
                                                val now = found
                                                if (now != null && now.first == asked.first) found = now.first to AppPage(now.second.apps + page.apps.filter { a -> a.real && now.second.apps.none { it.app == a.app } }, page.next)
                                            } catch (p: KimonoProblem) { conn.problem = p.message }
                                            more = false
                                        }
                                    })
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun Heading(text: String) = Text(text, style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(start = 4.dp, top = 8.dp, bottom = 6.dp))

/** One app in full: what it is, whether it's connected, and what Kimono AI can do with it. */
@Composable
fun AppConnectionScreen(code: Code, platform: Platform, slug: String, back: () -> Unit) {
    val scope = rememberCoroutineScope()
    val conn = rememberConn(code, platform)
    val time = ticking(false)
    val about by produceState<AppDetails?>(null, slug) { value = runCatching { code.appDetails(slug) }.getOrNull() ?: AppDetails(slug, app.kimono.data.plainName(slug)) }
    var confirming by remember { mutableStateOf(false) }
    val mine = conn.state?.connections?.firstOrNull { it.app == slug }
    val look by produceState(code.knownLook(slug), slug) { value = code.appLook(slug) }
    val name = about?.name ?: mine?.name ?: look?.name ?: slug
    val logo = about?.logo?.takeIf { it.isNotBlank() } ?: mine?.logo ?: look?.logo
    Scaffold(containerColor = MaterialTheme.colorScheme.surface, topBar = { KimonoTopBar(name, onBack = back) }) { padding ->
        LazyColumn(Modifier.padding(padding).fillMaxSize(), contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 4.dp, bottom = 40.dp), verticalArrangement = Arrangement.spacedBy(ListItemDefaults.SegmentedGap)) {
            if (conn.problem != null) item { Problem(conn.problem) }
            item {
                Row(Modifier.fillMaxWidth().padding(bottom = 12.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                    LogoTile(logo, 64.dp)
                    Column(Modifier.weight(1f)) {
                        Text(name, style = MaterialTheme.typography.titleLarge)
                        about?.categories?.takeIf { it.isNotEmpty() }?.let { Text(it.joinToString(" · "), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                        Text(if (mine != null) connStatus(mine, time) else if (conn.state != null) "Not connected" else " ", style = MaterialTheme.typography.bodySmall, color = if (mine?.status == "FAILED") MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
            if (conn.state?.available == true) item {
                Row(Modifier.padding(bottom = 12.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    when {
                        mine == null -> Seal("Connect", busy = conn.busy == slug, onClick = { scope.launch { conn.connect(slug) } })
                        confirming -> {
                            Seal("Disconnect", tone = SealTone.Danger, busy = conn.busy == mine.account, onClick = { scope.launch { conn.remove(mine); confirming = false } })
                            Seal("Keep", tone = SealTone.Quiet, onClick = { confirming = false })
                        }
                        else -> {
                            if (mine.status == "FAILED") Seal("Connect again", busy = conn.busy == slug, onClick = { scope.launch { conn.connect(slug) } })
                            Seal("Disconnect", tone = SealTone.Quiet, onClick = { confirming = true })
                        }
                    }
                }
            }
            val a = about
            if (a == null) item { Box(Modifier.fillMaxWidth().padding(32.dp), contentAlignment = Alignment.Center) { InkLoader() } }
            else {
                if (a.description.isNotBlank()) item { Text(a.description, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.padding(bottom = 12.dp)) }
                if (a.tools.isNotEmpty()) {
                    item { Heading("What Kimono AI can do with it") }
                    itemsIndexed(a.tools, key = { _, t -> t.name }) { index, t ->
                        SegmentedListItem(
                            onClick = {}, shapes = ListItemDefaults.segmentedShapes(index, a.tools.size), colors = segmentColors(),
                            supportingContent = { if (t.description.isNotBlank()) Text(t.description, maxLines = 3, overflow = TextOverflow.Ellipsis) },
                        ) { Text(t.name, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Medium) }
                    }
                    val more = (a.toolCount ?: 0) - a.tools.size
                    if (more > 0) item { Text("And $more more.", color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(8.dp)) }
                } else if (a.toolCount != null && a.toolCount > 0) item {
                    Text("${a.toolCount} things Kimono AI can do with it${if (mine != null) "" else " once it’s connected"}.", style = MaterialTheme.typography.bodyLarge)
                }
            }
        }
    }
}

/* ── memory: the person's instructions, and what it keeps about them ── */

@Composable
fun MemoryScreen(code: Code, back: () -> Unit) {
    val scope = rememberCoroutineScope()
    var profile by remember { mutableStateOf<CodeProfile?>(null) }
    var draft by remember { mutableStateOf<String?>(null) }
    var adding by remember { mutableStateOf("") }
    var problem by remember { mutableStateOf<String?>(null) }
    var saving by remember { mutableStateOf(false) }
    var saved by remember { mutableStateOf(false) }
    var editing by remember { mutableStateOf<Memory?>(null) }
    val time = ticking(false)
    LaunchedEffect(Unit) { try { profile = code.memory() } catch (p: KimonoProblem) { problem = p.message } }
    LaunchedEffect(saved) { if (saved) { delay(1600); saved = false } }
    val instructions = draft ?: profile?.instructions ?: ""
    val changed = draft != null && draft != profile?.instructions
    fun add() {
        if (adding.isBlank()) return
        problem = null
        scope.launch { try { profile = code.remember(adding.trim()); adding = "" } catch (p: KimonoProblem) { problem = p.message } }
    }
    Scaffold(containerColor = MaterialTheme.colorScheme.surface, topBar = { KimonoTopBar("Memory", onBack = back, mark = { AiMark(code, 32.dp) }) }) { padding ->
        LazyColumn(Modifier.padding(padding).fillMaxSize().imePadding(), contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 4.dp, bottom = 40.dp), verticalArrangement = Arrangement.spacedBy(ListItemDefaults.SegmentedGap)) {
            if (problem != null) item { Problem(problem) }
            val p = profile
            if (p == null && problem == null) item { Box(Modifier.fillMaxWidth().padding(40.dp), contentAlignment = Alignment.Center) { InkLoader() } }
            if (p != null) {
                item { Heading("Instructions") }
                item {
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedTextField(
                            instructions, { draft = it.take(4000) }, minLines = 4, maxLines = 10,
                            placeholder = { Text("How it should work for you. For example: call me Mina, keep answers short, use metric units.") },
                            shape = MaterialTheme.shapes.large, modifier = Modifier.fillMaxWidth(),
                        )
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Text(if (saved) "Saved" else "${instructions.length} / 4000", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.weight(1f))
                            if (changed) Seal("Undo", compact = true, tone = SealTone.Quiet, onClick = { draft = null })
                            Seal("Save", compact = true, busy = saving, enabled = changed, onClick = {
                                saving = true; problem = null
                                scope.launch { try { profile = code.saveInstructions(instructions); draft = null; saved = true } catch (e: KimonoProblem) { problem = e.message }; saving = false }
                            })
                        }
                    }
                }
                item { Box(Modifier.padding(top = 16.dp)) { Heading("What it remembers") } }
                item {
                    OutlinedTextField(
                        adding, { adding = it.take(500) }, singleLine = true, placeholder = { Text("Something it should remember") },
                        leadingIcon = { Icon(kimonoIcon("plus"), null, modifier = Modifier.size(20.dp)) },
                        trailingIcon = { if (adding.isNotBlank()) TextButton(onClick = { add() }) { Text("Add") } },
                        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done), keyboardActions = KeyboardActions(onDone = { add() }),
                        shape = CircleShape, modifier = Modifier.fillMaxWidth().padding(bottom = 8.dp),
                    )
                }
                if (p.memories.isEmpty()) item { Text("Nothing yet. It keeps things you tell it to remember.", color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(8.dp)) }
                itemsIndexed(p.memories, key = { _, m -> m.id }) { index, m ->
                    SegmentedListItem(
                        onClick = { editing = m },
                        shapes = ListItemDefaults.segmentedShapes(index, p.memories.size), colors = segmentColors(),
                        supportingContent = { Text("${if (m.source == "ai") "It kept this" else "You added this"} · ${whenText(m.createdAt, time)}") },
                        trailingContent = {
                            IconButton(onClick = {
                                profile = p.copy(memories = p.memories.filter { it.id != m.id })
                                scope.launch { try { profile = code.forget(m.id) } catch (e: KimonoProblem) { problem = e.message; profile = runCatching { code.memory() }.getOrNull() ?: profile } }
                            }) { Icon(kimonoIcon("trash"), "Forget this") }
                        },
                    ) { Text(m.text, style = MaterialTheme.typography.bodyLarge) }
                }
            }
        }
    }
    editing?.let { m ->
        NameDialog(title = "Memory", action = "Save", initial = m.text, onDismiss = { editing = null }) { text ->
            if (text != m.text) profile = code.changeMemory(m.id, text)
            editing = null
        }
    }
}


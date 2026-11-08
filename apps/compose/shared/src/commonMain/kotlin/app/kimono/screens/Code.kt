@file:OptIn(ExperimentalMaterial3Api::class, ExperimentalMaterial3ExpressiveApi::class, androidx.compose.foundation.layout.ExperimentalLayoutApi::class)

package app.kimono.screens

import app.kimono.ui.InkDialog
import app.kimono.ui.InkConfirm
import app.kimono.ui.InkTitle
import app.kimono.ui.InkSheet
import app.kimono.ui.InkMenuItem
import app.kimono.ui.InkMenu
import app.kimono.ui.bottomChrome
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.systemBars
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExperimentalMaterial3ExpressiveApi
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ListItemDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SegmentedListItem
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.kimono.data.Code
import app.kimono.data.CodeAttachment
import app.kimono.data.CodeProject
import app.kimono.data.CodeRepository
import app.kimono.data.CodeWorkspace
import app.kimono.data.ConnectableApp
import app.kimono.data.Drive
import app.kimono.data.KimonoProblem
import app.kimono.data.ShownMeters
import app.kimono.data.PickedFile
import app.kimono.data.Platform
import app.kimono.data.Usage
import app.kimono.data.elapsedText
import app.kimono.data.percent
import app.kimono.data.readableSize
import app.kimono.theme.Kata
import app.kimono.ui.InkBlot
import app.kimono.ui.InkBloom
import app.kimono.ui.InkDot
import app.kimono.ui.InkLoader
import app.kimono.ui.KimonoRefresh
import app.kimono.ui.KimonoTopBar
import app.kimono.ui.Portrait
import app.kimono.ui.Problem
import app.kimono.ui.Seal
import app.kimono.ui.SealTone
import app.kimono.ui.kimonoIcon
import app.kimono.ui.segmentColors
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.ui.draw.clip
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.material3.LocalContentColor

/*
 * 工 Kimono AI on the phone: the chats, the projects they're kept in, and a
 * new chat. A chat opens in CodeChat.kt; Connections and Memory in CodeMore.kt.
 */

internal val mono = FontFamily.Monospace

private fun working(w: CodeWorkspace) = if (w.running) 1 else 0

/** Chats, a working one first, then the newest. */
private fun chatsOf(list: List<CodeWorkspace>) = list.filter { !it.isProject }.sortedWith(compareByDescending<CodeWorkspace> { working(it) }.thenByDescending { it.updatedAt })

/** Projects' chats by repository: the one with the latest activity first. */
private fun reposOf(list: List<CodeWorkspace>) = list.filter { it.isProject }.groupBy { "${it.repo.owner}/${it.repo.name}" }
    .map { (key, tasks) -> Triple(key, tasks.first().repo.name, tasks.sortedWith(compareByDescending<CodeWorkspace> { working(it) }.thenByDescending { it.updatedAt })) }
    .sortedWith(compareByDescending<Triple<String, String, List<CodeWorkspace>>> { t -> t.third.maxOf { working(it) } }.thenByDescending { it.third.first().updatedAt })

/* ── the drawer: every chat, as the website's side list ── */

/**
 * Kimono AI is one chat at a time, with the rest in a drawer, as on the website: a new chat,
 * Connections, Memory and Archived up top, then Recent, Shared with you and Projects. The apps
 * your chats published sit at the bottom. [current] is the open chat, or null on a new one.
 */
@Composable
fun AiDrawer(code: Code, admin: Boolean, current: String?, open: (String) -> Unit, content: @Composable (menu: () -> Unit) -> Unit) {
    val drawer = androidx.compose.material3.rememberDrawerState(androidx.compose.material3.DrawerValue.Closed)
    val scope = rememberCoroutineScope()
    LaunchedEffect(drawer) { app.kimono.AiDrawerAsk.open.collect { if (it) { app.kimono.AiDrawerAsk.open.value = false; drawer.open() } } }
    androidx.compose.material3.ModalNavigationDrawer(
        drawerState = drawer,
        drawerContent = {
            androidx.compose.material3.ModalDrawerSheet(
                drawerState = drawer,
                drawerContainerColor = MaterialTheme.colorScheme.surfaceContainerLow,
                drawerShape = RoundedCornerShape(topEnd = 28.dp, bottomEnd = 28.dp),
                modifier = Modifier.widthIn(max = 340.dp),
            ) {
                AiDrawerSheet(code, admin, current, shown = drawer.targetValue == androidx.compose.material3.DrawerValue.Open) { to ->
                    scope.launch { drawer.close() }
                    if (!(to == "code" && current == null)) open(to)
                }
            }
        },
    ) { content { scope.launch { drawer.open() } } }
}

@Composable
private fun AiDrawerSheet(code: Code, admin: Boolean, current: String?, shown: Boolean, go: (String) -> Unit) {
    val scope = rememberCoroutineScope()
    var list by remember { mutableStateOf(code.knownChats()?.own) }
    var shared by remember { mutableStateOf(code.knownChats()) }
    val people = rememberPeople(code)
    var projects by remember { mutableStateOf<List<CodeProject>>(emptyList()) }
    var problem by remember { mutableStateOf<String?>(null) }
    var naming by remember { mutableStateOf<CodeProject?>(null) }
    var moreChats by remember { mutableStateOf(false) }
    var moreShared by remember { mutableStateOf(false) }
    var makingProject by remember { mutableStateOf(false) }
    var removing by remember { mutableStateOf<CodeProject?>(null) }
    var deleting by remember { mutableStateOf<CodeWorkspace?>(null) }
    var reporting by remember { mutableStateOf<CodeWorkspace?>(null) }
    suspend fun load() {
        try { val chats = code.chats(); list = chats.own; shared = chats; projects = runCatching { code.projects() }.getOrDefault(projects); problem = null } catch (p: KimonoProblem) { problem = p.message }
    }
    /* Kept fresh while it's open, and asked once as the screen opens so it's ready to slide out. */
    LaunchedEffect(Unit) { load() }
    if (shown) WhileShown(Unit) { while (true) { load(); delay(if (list?.any { it.running } == true) 3000 else 10_000) } }
    val time = ticking(shown && list?.any { it.running } == true)
    val act: (CodeWorkspace, String) -> Unit = { w, what ->
        if (what == "delete") deleting = w
        else if (what == "report") reporting = w
        else scope.launch {
            list = list?.map { if (it.id == w.id) it.copy(archivedAt = 1) else it }
            try { code.archive(w.id, true); load() } catch (p: KimonoProblem) { problem = p.message; load() }
        }
    }
    val everything = list.orEmpty()
    val all = everything.filter { it.archivedAt == null }
    val archived = everything.count { it.archivedAt != null }
    val apps = everything.filter { it.preview != null && it.archivedAt == null }

    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().padding(start = 20.dp, end = 12.dp, top = 18.dp, bottom = 10.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            AiMark(code, 32.dp)
            Text("Kimono AI", style = MaterialTheme.typography.titleLarge)
        }
        LazyColumn(Modifier.weight(1f).fillMaxWidth(), contentPadding = PaddingValues(start = 12.dp, end = 12.dp, bottom = 16.dp)) {
            item(key = "new") { DrawerPlace("plus", "New chat", selected = current == null, strong = true) { go("code") } }
            item(key = "connections") { DrawerPlace("link", "Connections") { go("ai/connections") } }
            item(key = "memory") { DrawerPlace("spark", "Personalization") { go("ai/memory") } }
            if (archived > 0) item(key = "archived") { DrawerPlace("archive", "Archived", count = archived) { go("ai/archived") } }
            if (problem != null) item(key = "problem") { Row(Modifier.padding(horizontal = 12.dp), verticalAlignment = Alignment.CenterVertically) { Box(Modifier.weight(1f)) { Problem(problem) }; TextButton(onClick = { scope.launch { load() } }) { Text("Retry") } } }
            if (list == null && problem == null) item(key = "loading") { Box(Modifier.fillMaxWidth().padding(24.dp), contentAlignment = Alignment.Center) { InkLoader(size = 28.dp) } }

            val allLoose = chatsOf(all).filter { it.folder == null }
            val loose = if (moreChats) allLoose else allLoose.take(5)
            if (loose.isNotEmpty()) {
                item(key = "recent-label") { DrawerLabel("Recent") }
                items(loose, key = { "recent-${it.id}" }) { w -> DrawerChat(w, current, time, go, act) }
                if (allLoose.size > 5) item(key = "recent-more") { DrawerMore(moreChats, allLoose.size - 5) { moreChats = !moreChats } }
            }

            val allTheirs = shared?.shared.orEmpty().sortedByDescending { it.updatedAt }
            val allPages = shared?.sharedArtifacts.orEmpty()
            val theirs = if (moreShared) allTheirs else allTheirs.take(5)
            val pages = if (moreShared) allPages else allPages.take(maxOf(0, 5 - theirs.size))
            if (theirs.isNotEmpty() || pages.isNotEmpty()) {
                item(key = "shared-label") { DrawerLabel("Shared with you") }
                items(theirs, key = { "shared-${it.id}" }) { w ->
                    val person = people[w.owner.lowercase()]
                    DrawerChat(w, current, time, go, act = null, lead = { Portrait(person?.picture, person?.name, w.owner, 22.dp) })
                }
                items(pages, key = { "shared-artifact-${it.token}" }) { a ->
                    DrawerRow(selected = false, onClick = { go("ai/a/${a.token}") }, lead = { Icon(kimonoIcon("spark"), null, modifier = Modifier.size(18.dp)) }) {
                        Text(a.title.ifBlank { a.name }, style = MaterialTheme.typography.bodyLarge, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                    }
                }
                if (allTheirs.size + allPages.size > 5) item(key = "shared-more") { DrawerMore(moreShared, allTheirs.size + allPages.size - 5) { moreShared = !moreShared } }
            }

            item(key = "projects-label") { DrawerLabel("Projects") { IconButton(onClick = { naming = CodeProject("", "") }, modifier = Modifier.size(36.dp)) { Icon(kimonoIcon("plus"), "New project", modifier = Modifier.size(18.dp)) } } }
            if (projects.isEmpty() && list != null) item(key = "projects-empty") { Text("Keep chats together in a project.", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(start = 16.dp, top = 2.dp, bottom = 8.dp)) }
            projects.forEach { project ->
                item(key = "project-${project.id}") {
                    ProjectHead(project, onNew = { go("ai/new/${project.id}") }, onRename = { name -> code.renameProject(project.id, name); load() }, onRemove = { removing = project })
                }
                val inside = chatsOf(all).filter { it.folder?.id == project.id }
                items(inside, key = { "p-${project.id}-${it.id}" }) { w -> DrawerChat(w, current, time, go, act, indent = true) }
            }
            /* Administrators' projects on Kimono Git, each repository's chats together. */
            val repos = reposOf(all)
            if (repos.isNotEmpty()) item(key = "repos-label") { DrawerLabel("Repositories") }
            repos.forEach { (key, name, tasks) ->
                item(key = "repo-$key") {
                    Row(Modifier.fillMaxWidth().padding(start = 12.dp, top = 4.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        Icon(kimonoIcon("branch"), null, modifier = Modifier.size(18.dp))
                        Text(name, style = MaterialTheme.typography.titleSmall, modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
                        if (admin) IconButton(onClick = { code.workOnProject = true; code.lastRepo = key; go("ai/new") }, modifier = Modifier.size(36.dp)) { Icon(kimonoIcon("plus"), "New chat in $name", modifier = Modifier.size(18.dp)) }
                    }
                }
                items(tasks, key = { "r-$key-${it.id}" }) { w -> DrawerChat(w, current, time, go, act, indent = true) }
            }
            if (list != null && all.isEmpty() && theirs.isEmpty() && pages.isEmpty() && problem == null) item(key = "quiet") {
                Text("Your chats will be here.", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(16.dp))
            }
        }
        /* The apps your chats published, at the foot of the drawer: each opens its settings. */
        if (apps.isNotEmpty()) {
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = .6f))
            Text("Your apps", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(start = 24.dp, top = 12.dp, bottom = 6.dp))
            LazyRow(contentPadding = PaddingValues(horizontal = 12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.bottomChrome().padding(bottom = 14.dp)) {
                items(apps, key = { it.id }) { w -> AppChip(w) { go("code/${w.id}/app") } }
            }
        } else Spacer(Modifier.bottomChrome())
    }
    naming?.let { project ->
        NameDialog(title = if (project.id.isEmpty()) "New project" else "Rename project", action = if (project.id.isEmpty()) "Make it" else "Rename", initial = project.name, onDismiss = { naming = null }) { name ->
            if (makingProject) return@NameDialog
            makingProject = true
            try { if (project.id.isEmpty()) code.createProject(name) else code.renameProject(project.id, name); load(); naming = null } finally { makingProject = false }
        }
    }
    deleting?.let { w ->
        InkConfirm(
            title = "Delete this chat?",
            text = "Its files stay in Drive.",
            action = "Delete",
            icon = "trash",
            danger = true,
            keep = "Keep",
            onConfirm = { deleting = null; scope.launch { try { code.remove(w.id); load(); if (w.id == current) go("code") } catch (p: KimonoProblem) { problem = p.message } } },
            onDismiss = { deleting = null },
        )
    }
    reporting?.let { w -> ReportDialog(code, w) { reporting = null } }
    removing?.let { project ->
        InkConfirm(
            title = "Remove ${project.name}?",
            text = "Its chats stay.",
            action = "Remove",
            icon = "trash",
            danger = true,
            keep = "Keep",
            onConfirm = { removing = null; scope.launch { try { code.removeProject(project.id); load() } catch (p: KimonoProblem) { problem = p.message } } },
            onDismiss = { removing = null },
        )
    }
}

@Composable
private fun DrawerLabel(text: String, action: (@Composable () -> Unit)? = null) {
    Row(Modifier.fillMaxWidth().heightIn(min = 40.dp).padding(start = 16.dp, top = 14.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(text, style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.weight(1f))
        action?.invoke()
    }
}

/** A place in the drawer's head: New chat, Connections, Memory, Archived. */
@Composable
private fun DrawerPlace(icon: String, label: String, selected: Boolean = false, strong: Boolean = false, count: Int? = null, onClick: () -> Unit) {
    DrawerRow(selected = selected, onClick = onClick, lead = { Icon(kimonoIcon(icon), null, modifier = Modifier.size(20.dp), tint = if (strong) MaterialTheme.colorScheme.primary else LocalContentColor.current) }) {
        Text(label, style = if (strong) MaterialTheme.typography.titleSmall else MaterialTheme.typography.bodyLarge, modifier = Modifier.weight(1f))
        if (count != null) Text("$count", fontFamily = mono, fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

/** One row of the drawer: a full round pill, filled when it's where you are. */
@Composable
private fun DrawerRow(selected: Boolean, onClick: () -> Unit, onLongClick: (() -> Unit)? = null, indent: Boolean = false, lead: (@Composable () -> Unit)? = null, body: @Composable androidx.compose.foundation.layout.RowScope.() -> Unit) {
    val colour = if (selected) MaterialTheme.colorScheme.secondaryContainer else Color.Transparent
    androidx.compose.runtime.CompositionLocalProvider(LocalContentColor provides if (selected) MaterialTheme.colorScheme.onSecondaryContainer else MaterialTheme.colorScheme.onSurface) {
        Row(
            Modifier.fillMaxWidth().heightIn(min = 48.dp).clip(CircleShape).background(colour)
                .combinedClickable(onClick = onClick, onLongClick = onLongClick)
                .padding(start = if (indent) 40.dp else 16.dp, end = 14.dp),
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            lead?.invoke()
            body()
        }
    }
}

@Composable
private fun DrawerMore(more: Boolean, hidden: Int, toggle: () -> Unit) {
    TextButton(onClick = toggle, modifier = Modifier.padding(start = 4.dp)) { Text(if (more) "Fewer" else "··· $hidden more") }
}

/** A chat in the drawer: its title and, when it says something, how it is. Held, it can be archived, reported or deleted. */
@Composable
private fun DrawerChat(w: CodeWorkspace, current: String?, time: Long, go: (String) -> Unit, act: ((CodeWorkspace, String) -> Unit)?, indent: Boolean = false, lead: (@Composable () -> Unit)? = null) {
    var menu by remember { mutableStateOf(false) }
    Box {
        DrawerRow(selected = w.id == current, onClick = { go("code/${w.id}") }, onLongClick = act?.let { { menu = true } }, indent = indent, lead = lead) {
            Text(w.title, style = MaterialTheme.typography.bodyLarge, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
            val turn = w.turn
            when {
                turn?.state == "running" -> InkLoader(size = 16.dp)
                w.preview != null && !w.preview.stopped -> InkDot(Kata.moss, size = 8.dp, seed = w.id)
                else -> Text(whenText(w.updatedAt, time), fontFamily = mono, fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        if (act != null) InkMenu(expanded = menu, onDismissRequest = { menu = false }) {
            InkMenuItem("Archive", icon = "archive", onClick = { menu = false; act(w, "archive") })
            InkMenuItem("Report", icon = "flag", onClick = { menu = false; act(w, "report") })
            InkMenuItem("Delete", icon = "trash", danger = true, onClick = { menu = false; act(w, "delete") })
        }
    }
}

/** One published app at the foot of the drawer: its name and whether it's up. */
@Composable
private fun AppChip(w: CodeWorkspace, onClick: () -> Unit) {
    val preview = w.preview ?: return
    Surface(onClick = onClick, shape = RoundedCornerShape(20.dp), color = MaterialTheme.colorScheme.surfaceContainerHigh) {
        Row(Modifier.heightIn(min = 52.dp).padding(start = 8.dp, end = 14.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            InkBlot("app-${w.id}", size = 36.dp) { Icon(kimonoIcon("out"), null, modifier = Modifier.size(16.dp), tint = Kata.ink) }
            Column {
                Text(preview.name, style = MaterialTheme.typography.titleSmall, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.widthIn(max = 140.dp))
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                    InkDot(if (preview.stopped) quietGrey else Kata.moss, size = 7.dp, seed = w.id)
                    Text(if (preview.stopped) "Stopped" else "Live", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }
    }
}

/* ── archived chats: out of the list, kept until deleted ── */

@Composable
fun ArchivedScreen(code: Code, back: () -> Unit, open: (String) -> Unit) {
    val scope = rememberCoroutineScope()
    var list by remember { mutableStateOf(code.knownChats()?.own?.filter { it.archivedAt != null }) }
    var problem by remember { mutableStateOf<String?>(null) }
    var deleting by remember { mutableStateOf<CodeWorkspace?>(null) }
    var reporting by remember { mutableStateOf<CodeWorkspace?>(null) }
    suspend fun load() {
        try { list = code.chats().own.filter { it.archivedAt != null }.sortedByDescending { it.archivedAt }; problem = null } catch (p: KimonoProblem) { problem = p.message }
    }
    LaunchedEffect(Unit) { load() }
    val time = ticking(false)
    Scaffold(containerColor = MaterialTheme.colorScheme.surface, topBar = { KimonoTopBar("Archived", onBack = back, mark = { AiMark(code, 32.dp) }) }) { padding ->
        val shown = list
        if (shown == null && problem == null) Box(Modifier.padding(padding).fillMaxSize(), contentAlignment = Alignment.Center) { InkLoader() }
        else LazyColumn(Modifier.padding(padding).fillMaxSize(), contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 8.dp, bottom = 120.dp), verticalArrangement = Arrangement.spacedBy(ListItemDefaults.SegmentedGap)) {
            if (problem != null) item { Problem(problem) }
            val chats = shown.orEmpty()
            if (chats.isEmpty() && problem == null) item { Quiet("Nothing archived.") }
            itemsIndexed(chats, key = { _, w -> w.id }) { index, w ->
                SegmentedListItem(
                    onClick = { open("code/${w.id}") },
                    shapes = ListItemDefaults.segmentedShapes(index, chats.size), colors = segmentColors(),
                    supportingContent = { Text(listOfNotNull(w.folder?.name, whenText(w.updatedAt, time)).joinToString(" · "), maxLines = 1, overflow = TextOverflow.Ellipsis) },
                    trailingContent = {
                        Row {
                            IconButton(onClick = { scope.launch { try { code.archive(w.id, false); load() } catch (p: KimonoProblem) { problem = p.message } } }) { Icon(kimonoIcon("unarchive"), "Unarchive") }
                            IconButton(onClick = { deleting = w }) { Icon(kimonoIcon("trash"), "Delete", tint = MaterialTheme.colorScheme.error) }
                        }
                    },
                ) { Text(w.title, style = MaterialTheme.typography.bodyLarge, maxLines = 2, overflow = TextOverflow.Ellipsis) }
            }
        }
    }
    deleting?.let { w ->
        InkConfirm(
            title = "Delete this chat?",
            text = "Its files stay in Drive.",
            action = "Delete",
            icon = "trash",
            danger = true,
            keep = "Keep",
            onConfirm = { deleting = null; scope.launch { try { code.remove(w.id); load() } catch (p: KimonoProblem) { problem = p.message } } },
            onDismiss = { deleting = null },
        )
    }
}

/** A project in the list: its name, a new chat in it, renaming and removing it. */
@Composable
private fun ProjectHead(project: CodeProject, onNew: () -> Unit, onRename: suspend (String) -> Unit, onRemove: () -> Unit) {
    var menu by remember { mutableStateOf(false) }
    /* Its name is renamed where it sits: a tap turns it into a field of the same size. */
    var editing by remember(project.id) { mutableStateOf(false) }
    Row(Modifier.fillMaxWidth().padding(start = 16.dp, top = 2.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        Icon(kimonoIcon("folder"), null, modifier = Modifier.size(18.dp))
        if (editing) InlineName(project.name, MaterialTheme.typography.titleSmall, Modifier.weight(1f), onSave = onRename, onEnd = { editing = false })
        else Text(project.name, style = MaterialTheme.typography.titleSmall, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f).clickable { editing = true })
        IconButton(onClick = onNew) { Icon(kimonoIcon("plus"), "New chat in ${project.name}") }
        Box {
            IconButton(onClick = { menu = true }) { Icon(kimonoIcon("more"), "More") }
            InkMenu(expanded = menu, onDismissRequest = { menu = false }) {
                InkMenuItem("Rename", icon = "edit", onClick = { menu = false; editing = true })
                InkMenuItem("Remove", icon = "trash", danger = true, onClick = { menu = false; onRemove() })
            }
        }
    }
}

@Composable
internal fun Quiet(text: String) {
    Column(Modifier.fillMaxWidth().padding(horizontal = 40.dp, vertical = 60.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        InkBlot("code-quiet", size = 96.dp) { Icon(kimonoIcon("chat"), null, modifier = Modifier.size(40.dp), tint = Kata.plum) }
        Spacer(Modifier.size(20.dp))
        Text(text, style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

/* ── a new chat ── */

/** A file chosen for a chat that doesn't exist yet: from the phone, or a Drive file by its id. */
private class Held(val name: String, val size: Long, val file: PickedFile? = null, val node: String? = null, val failed: String? = null) {
    val key = "held:${kotlin.random.Random.nextLong()}"
}

/**
 * What can I do for you? A chat is just what you ask, with files if you like.
 * Administrators can instead work on a project: a Kimono Git repository and a branch.
 * Under it, the person's own use, and a few apps they could connect.
 */
@Composable
fun NewChatScreen(code: Code, drive: Drive, platform: Platform, admin: Boolean, folderId: String?, back: () -> Unit, menu: (() -> Unit)? = null, open: (String) -> Unit, started: (CodeWorkspace) -> Unit) {
    val scope = rememberCoroutineScope()
    var onProject by remember { mutableStateOf(admin && code.workOnProject) }
    var repos by remember { mutableStateOf<List<CodeRepository>?>(null) }
    var repo by remember { mutableStateOf<CodeRepository?>(null) }
    var branches by remember { mutableStateOf<List<String>>(emptyList()) }
    var base by remember { mutableStateOf("") }
    val draftKey = "draft:new${folderId?.let { "-$it" } ?: ""}"
    var prompt by remember { mutableStateOf(code.recall(draftKey) ?: "") }
    LaunchedEffect(prompt) { code.keep(draftKey, prompt) }
    var problem by remember { mutableStateOf<String?>(null) }
    var sending by remember { mutableStateOf(false) }
    var naming by remember { mutableStateOf<String?>(null) }
    var making by remember { mutableStateOf(false) }
    var choosing by remember { mutableStateOf(false) }
    val held = remember { mutableStateListOf<Held>() }
    val field = remember { FocusRequester() }
    val folder by androidx.compose.runtime.produceState<CodeProject?>(null, folderId) { if (folderId != null) value = runCatching { code.projects() }.getOrNull()?.firstOrNull { it.id == folderId } }
    val marks = rememberAiMarks(drive)
    LaunchedEffect(onProject) {
        code.workOnProject = onProject
        if (!onProject || repos != null) return@LaunchedEffect
        try {
            val list = code.repositories()
            repos = list
            repo = list.firstOrNull { "${it.owner}/${it.name}" == code.lastRepo } ?: list.firstOrNull()
        } catch (p: KimonoProblem) { problem = p.message; repos = emptyList() }
    }
    LaunchedEffect(repo) {
        val r = repo ?: return@LaunchedEffect
        code.lastRepo = "${r.owner}/${r.name}"
        base = r.defaultBranch
        branches = listOf(r.defaultBranch)
        runCatching { code.branches(r.owner, r.name) }.getOrNull()?.let { list -> branches = if (r.defaultBranch in list) list else listOf(r.defaultBranch) + list }
    }
    fun makeProject() {
        val name = naming?.trim().orEmpty()
        if (name.isEmpty() || making) return
        making = true; problem = null
        scope.launch {
            try { val made = code.createRepository(name); repos = listOf(made) + (repos ?: emptyList()); repo = made; naming = null; runCatching { field.requestFocus() } } catch (p: KimonoProblem) { problem = p.message }
            making = false
        }
    }
    val chosen = if (onProject) repo else null
    val ready = prompt.isNotBlank() && (!onProject || chosen != null) && !sending
    val keyboard = androidx.compose.ui.platform.LocalSoftwareKeyboardController.current
    val focus = androidx.compose.ui.platform.LocalFocusManager.current
    fun send() {
        if (!ready) return
        focus.clearFocus(); keyboard?.hide()
        sending = true; problem = null
        scope.launch {
            try {
                val toSend = held.filter { it.failed == null }
                val made = if (chosen != null) code.start(prompt, chosen.owner, chosen.name, base.ifEmpty { chosen.defaultBranch }, hold = toSend.isNotEmpty())
                    else code.start(prompt, folder = folderId, hold = toSend.isNotEmpty())
                if (toSend.isNotEmpty()) {
                    /* The chat exists now: its files go to it, then the message, as any turn would. */
                    val uploads = toSend.mapNotNull { h -> h.file?.let { runCatching { code.attach(made.id, it) }.getOrNull() } }
                    val nodes = toSend.mapNotNull { it.node }
                    val copied = if (nodes.isNotEmpty()) runCatching { code.fromDrive(made.id, nodes) }.getOrDefault(emptyList()) else emptyList()
                    code.ask(made.id, prompt, uploads + copied)
                }
                code.keep(draftKey, null)
                started(made)
            } catch (p: KimonoProblem) { problem = p.message; sending = false }
        }
    }
    Scaffold(
        containerColor = MaterialTheme.colorScheme.surface,
        /* The composer stands on the screen's hem itself (bottomChrome), so the scaffold leaves the bottom alone. */
        contentWindowInsets = androidx.compose.foundation.layout.WindowInsets.systemBars.only(androidx.compose.foundation.layout.WindowInsetsSides.Top + androidx.compose.foundation.layout.WindowInsetsSides.Horizontal),
        topBar = { KimonoTopBar("Kimono AI", onBack = back.takeIf { menu == null }, onMenu = menu, mark = { AiMark(code, 32.dp) }) },
    ) { padding ->
        /* As in any chat, the box sits at the bottom, over the keyboard; what's above it scrolls. */
        Column(Modifier.padding(padding).fillMaxSize().imePadding()) {
        Column(Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 18.dp).padding(bottom = 16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            Text(if (onProject) "What should we build?" else "What can I do for you?", style = MaterialTheme.typography.headlineMedium, modifier = Modifier.padding(top = 8.dp))
            if (folder != null && !onProject) Note("folder", "In ${folder!!.name}")
            if (onProject) {
                if (naming != null || repos?.isEmpty() == true) {
                    OutlinedTextField(
                        naming ?: "", { naming = it.take(60) }, label = { Text("New project") }, placeholder = { Text("Family recipes") }, singleLine = true,
                        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done), keyboardActions = KeyboardActions(onDone = { makeProject() }), modifier = Modifier.fillMaxWidth(),
                    )
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        Seal("Make project", compact = true, busy = making, enabled = !naming.isNullOrBlank(), onClick = { makeProject() })
                        if (!repos.isNullOrEmpty()) Seal("Cancel", compact = true, tone = SealTone.Quiet, onClick = { naming = null })
                    }
                } else {
                    Picker("Project", repo?.name ?: if (repos == null) "Loading…" else "None yet", (repos ?: emptyList()).map { Option("${it.owner}/${it.name}", it.name, it.description.ifBlank { it.owner }) }, action = "New project" to { naming = "" }) { key -> repo = repos?.firstOrNull { "${it.owner}/${it.name}" == key } }
                    Picker("Starting from", base.ifEmpty { "—" }, branches.map { Option(it, it, if (it == repo?.defaultBranch) "The main version" else null) }) { base = it }
                }
            }
            Problem(problem)
            HomeUsage(code)
            if (!onProject) SuggestedApps(code, open)
        }
        Column(Modifier.fillMaxWidth().bottomChrome().padding(start = 14.dp, end = 14.dp, top = 6.dp, bottom = 10.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            /* What kind of chat, and how it answers: above the box. */
            FlowRow(Modifier.fillMaxWidth().padding(horizontal = 4.dp), horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp), itemVerticalAlignment = Alignment.CenterVertically) {
                        if (admin) Surface(onClick = { onProject = !onProject }, shape = androidx.compose.foundation.shape.CircleShape, color = if (onProject) MaterialTheme.colorScheme.secondaryContainer else MaterialTheme.colorScheme.surfaceContainerHigh) {
                            Row(Modifier.padding(horizontal = 12.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                Icon(kimonoIcon(if (onProject) "check" else "code"), null, modifier = Modifier.size(16.dp))
                                Text("Build a website", style = MaterialTheme.typography.labelLarge)
                            }
                        }
                        if (marks.spaces.isNotEmpty()) AccessChip(code)
                        ModelChip(code)
                        EffortChip(code)
            }
            /* The message, its files, and how it should answer. */
            Surface(shape = RoundedCornerShape(28.dp), color = MaterialTheme.colorScheme.surfaceContainer, modifier = Modifier.fillMaxWidth()) {
                Column(Modifier.padding(horizontal = 14.dp, vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    if (held.isNotEmpty()) LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        items(held.toList()) { h ->
                            val file = h.file
                            if (file != null && h.failed == null && (isPictureFile(h.name, file.mimeType) || isVideoFile(h.name, file.mimeType)))
                                PendingMedia(platform, h.key, h.name, isVideoFile(h.name, file.mimeType), busy = false, onRemove = { held.remove(h) }) { readAll(file) }
                            else FileChip(h.name, h.failed ?: readableSize(h.size), failed = h.failed != null) { held.remove(h) }
                        }
                    }
                    /* attach, the words, Send: one line, as in the chat; the buttons keep to the last line as the words grow */
                    SlashCommands(code, prompt) { prompt = it }
                    Row(verticalAlignment = Alignment.Bottom) {
                        val hold: (suspend () -> List<app.kimono.data.PickedFile>) -> Unit = { pick ->
                            scope.launch {
                                pick().take(10 - held.size).forEach { f -> held += Held(f.name, f.size, file = f, failed = if (f.size > Code.MAX_ATTACHMENT) "Over 20 MB" else null) }
                            }
                        }
                        AttachMenu(
                            onDevice = { hold { platform.pickFiles() } },
                            onDrive = if (marks.driveApp != null || marks.spaces.isNotEmpty()) ({ choosing = true }) else null,
                            onPhotos = if (platform.photoPicker) ({ hold { platform.pickMedia() } }) else null,
                        )
                        BasicTextField(
                            prompt, { prompt = it.take(32_000) },
                            textStyle = MaterialTheme.typography.bodyLarge.copy(color = MaterialTheme.colorScheme.onSurface),
                            cursorBrush = androidx.compose.ui.graphics.SolidColor(MaterialTheme.colorScheme.primary),
                            maxLines = 10,
                            modifier = Modifier.weight(1f).heightIn(min = 44.dp).focusRequester(field).padding(horizontal = 4.dp, vertical = 11.dp),
                            decorationBox = { inner -> Box { if (prompt.isEmpty()) Text(if (onProject) "Describe what you want" else "Ask anything", style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis); inner() } },
                        )
                        app.kimono.screens.SendStop(stop = false, enabled = ready, busy = sending, onSend = { send() })
                    }
                }
            }
        }
        }
    }
    if (choosing) FromDriveSheet(drive, onDismiss = { choosing = false }) { nodes ->
        choosing = false
        nodes.take(10 - held.size).forEach { held += Held(it.name, it.size, node = it.id) }
    }
}

/** A labelled choice that opens its options in a menu. */
@Composable
internal fun Picker(label: String, value: String, options: List<Option>, action: Pair<String, () -> Unit>? = null, choose: (String) -> Unit) {
    var open by remember { mutableStateOf(false) }
    Box {
        Surface(onClick = { if (options.isNotEmpty() || action != null) open = true }, shape = MaterialTheme.shapes.large, color = MaterialTheme.colorScheme.surfaceContainer, modifier = Modifier.fillMaxWidth()) {
            Row(Modifier.padding(horizontal = 16.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(label, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Text(value, style = MaterialTheme.typography.bodyLarge, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                Icon(kimonoIcon("chevron"), null, modifier = Modifier.size(18.dp))
            }
        }
        InkMenu(expanded = open, onDismissRequest = { open = false }) {
            options.forEach { option ->
                DropdownMenuItem(text = {
                    Column {
                        Text(option.label, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        option.detail?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis) }
                    }
                }, onClick = { open = false; choose(option.value) })
            }
            if (action != null) {
                if (options.isNotEmpty()) HorizontalDivider()
                DropdownMenuItem(
                    text = { Text(action.first, fontWeight = FontWeight.Bold) },
                    leadingIcon = { Icon(kimonoIcon("plus"), null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(18.dp)) },
                    onClick = { open = false; action.second() },
                )
            }
        }
    }
}

/** The person's own use, under the new-chat box: the 5-hour window, the week and the month's Pro Tools, each only once it's past half. */
@Composable
private fun HomeUsage(code: Code) {
    val usage by androidx.compose.runtime.produceState<Usage?>(null) { value = runCatching { code.usage() }.getOrNull() }
    val u = usage ?: return
    val shown = ShownMeters.of(u, null).takeIf { it.any } ?: return
    val whose = if (u.unlimited) "of the plan" else "of your share"
    Column(verticalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.padding(top = 4.dp)) {
        shown.fiveHour?.let { UsageRow("5-hour window", it, "${percent(it)} $whose${resetWords(u.fiveHour.resetsAt)?.let { r -> " · resets $r" } ?: ""}") }
        shown.week?.let { UsageRow("This week", it, "${percent(it)} $whose${resetWords(u.week.resetsAt)?.let { r -> " · resets $r" } ?: ""}") }
        u.media?.takeIf { shown.tools != null }?.let { m -> UsageRow("Pro Tools", m.fraction, m.words?.let { w -> "$w${resetWords(m.resetsAt)?.let { " · resets $it" } ?: ""}" } ?: "Not reported yet", icon = "bolt") }
    }
}

@Composable
internal fun UsageRow(title: String, value: Double?, detail: String, icon: String? = null, trailing: (@Composable () -> Unit)? = null) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Ring(value, 26.dp)
        Column(Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                if (icon != null) Icon(kimonoIcon(icon), null, modifier = Modifier.size(15.dp))
                Text(title, style = MaterialTheme.typography.titleSmall)
            }
            Text(detail, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        trailing?.invoke()
    }
}

/** A few apps the person hasn't connected yet, each opening its page in Connections. */
@Composable
private fun SuggestedApps(code: Code, open: (String) -> Unit) {
    val apps by androidx.compose.runtime.produceState<List<ConnectableApp>?>(null) { value = runCatching { code.findApps("").apps.filter { !it.connected && it.real }.take(6) }.getOrDefault(emptyList()) }
    val list = apps?.takeIf { it.isNotEmpty() } ?: return
    Column(verticalArrangement = Arrangement.spacedBy(ListItemDefaults.SegmentedGap), modifier = Modifier.padding(top = 10.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("Connect your apps", style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f))
            TextButton(onClick = { open("ai/connections") }) { Text("All apps") }
        }
        list.forEachIndexed { index, a ->
            SegmentedListItem(
                onClick = { open("ai/connections/${a.app}") },
                shapes = ListItemDefaults.segmentedShapes(index, list.size), colors = segmentColors(),
                leadingContent = { LogoTile(a.logo, 40.dp) },
                supportingContent = { if (a.description.isNotBlank()) Text(a.description, maxLines = 2, overflow = TextOverflow.Ellipsis) },
            ) { Text(a.name, style = MaterialTheme.typography.bodyLarge) }
        }
    }
}

/* ── how it answers: which Claude, how hard it thinks, what it may do with Drive ── */

@Composable
internal fun ModelChip(code: Code) {
    val scope = rememberCoroutineScope()
    val model by code.model.collectAsState()
    ChoiceChip(null, model, app.kimono.data.modelChoices.map { Option(it, app.kimono.data.modelWords.getValue(it).first, app.kimono.data.modelWords.getValue(it).second) }) { scope.launch { code.chooseModel(it) } }
}

@Composable
internal fun EffortChip(code: Code) {
    val scope = rememberCoroutineScope()
    val model by code.model.collectAsState()
    val effort by code.effort.collectAsState()
    /* Auto picks how hard it thinks along with the model: nothing to choose. */
    if (model == "auto") return
    /* Sonnet and Haiku think at low or medium only; the choice made for Opus is kept for when it comes back. */
    val light = model == "sonnet" || model == "haiku"
    val offered = if (light) listOf("low", "medium") else app.kimono.data.efforts
    val shown = if (light && effort !in offered) "medium" else effort
    ChoiceChip("Thinking ·", shown, offered.map { Option(it, app.kimono.data.effortWords.getValue(it)) }) { scope.launch { code.chooseEffort(it) } }
}

private val accessWords = mapOf("ask" to ("Asks first" to "Asks before opening your files"), "read" to ("Reads" to "Reads your files without asking"), "change" to ("Reads and edits" to "Reads and edits your files without asking"))

/** What Kimono AI may do with Drive without asking, as one compact choice for every space. */
@Composable
internal fun AccessChip(code: Code) {
    val scope = rememberCoroutineScope()
    var settings by remember { mutableStateOf<app.kimono.data.AccessSettings?>(null) }
    LaunchedEffect(Unit) { settings = runCatching { code.access() }.getOrNull() }
    val s = settings?.takeIf { it.spaces.isNotEmpty() } ?: return
    /* The one mode the spaces add up to: the least any of them allows. */
    val mode = when {
        s.spaces.any { it.auto == null } -> "ask"
        s.spaces.all { it.auto == "change" || !it.canChange } && s.spaces.any { it.auto == "change" } -> "change"
        else -> "read"
    }
    val offered = if (s.spaces.any { it.canChange }) listOf("ask", "read", "change") else listOf("ask", "read")
    ChoiceChip(null, mode, offered.map { Option(it, accessWords.getValue(it).first, accessWords.getValue(it).second) }) { next ->
        val spaces = s.spaces.map { it.copy(auto = if (next == "ask") null else if (next == "change" && it.canChange) "change" else "read") }
        settings = s.copy(spaces = spaces)
        scope.launch { runCatching { spaces.forEach { code.setSpaceAccess(it.id, it.auto) } }.onFailure { settings = runCatching { code.access() }.getOrNull() } }
    }
}

/**
 * One attach button: a menu of where the files come from, or straight to the phone's when there's no Drive.
 * Where the phone has its own photo picker ([onPhotos]), Photos and Files stand apart in the menu.
 */
@Composable
internal fun AttachMenu(onDevice: () -> Unit, onDrive: (() -> Unit)?, enabled: Boolean = true, onPhotos: (() -> Unit)? = null) {
    var open by remember { mutableStateOf(false) }
    Box {
        IconButton(onClick = { if (onDrive != null || onPhotos != null) open = true else onDevice() }, enabled = enabled) { Icon(kimonoIcon("clip"), "Attach files") }
        InkMenu(expanded = open, onDismissRequest = { open = false }) {
            if (onPhotos != null) {
                InkMenuItem("Photos", icon = "image", onClick = { open = false; onPhotos() })
                InkMenuItem("Files", icon = "file", onClick = { open = false; onDevice() })
            } else InkMenuItem("From your phone", icon = "phone", onClick = { open = false; onDevice() })
            if (onDrive != null) InkMenuItem("From Drive", icon = "folder", onClick = { open = false; onDrive() })
        }
    }
}

@Composable
internal fun FileChip(name: String, detail: String, failed: Boolean = false, busy: Boolean = false, onRemove: (() -> Unit)? = null) {
    Surface(shape = RoundedCornerShape(14.dp), color = if (failed) MaterialTheme.colorScheme.errorContainer else MaterialTheme.colorScheme.surfaceContainerHighest) {
        Row(Modifier.heightIn(min = 40.dp).padding(start = 10.dp, end = if (onRemove == null) 12.dp else 0.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            app.kimono.ui.FileTypeMark(name, Modifier.size(20.dp)) { Icon(kimonoIcon("file"), null, modifier = Modifier.size(16.dp)) }
            Text(name, style = MaterialTheme.typography.labelLarge, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.widthIn(max = 160.dp))
            if (busy) InkLoader(size = 16.dp) else Text(detail, fontFamily = mono, fontSize = 11.sp, color = if (failed) MaterialTheme.colorScheme.onErrorContainer else MaterialTheme.colorScheme.onSurfaceVariant)
            if (onRemove != null) IconButton(onClick = onRemove, modifier = Modifier.size(36.dp)) { Icon(kimonoIcon("close"), "Remove $name", modifier = Modifier.size(14.dp)) }
        }
    }
}

/** Drive's mark and spaces, for the cards and calls that touch someone's files. */
@Composable
internal fun rememberAiMarks(drive: Drive): AiMarks {
    val spaces by androidx.compose.runtime.produceState(drive.knownSpaces().orEmpty()) { value = runCatching { drive.spaces() }.getOrDefault(value) }
    val driveApp = drive.knownApps()?.firstOrNull { it.id == "kimono-drive" }
    return remember(spaces, driveApp) { AiMarks(driveApp, spaces) }
}

/** Reports a whole chat: it goes with no name on it. */
@Composable
private fun ReportDialog(code: Code, w: CodeWorkspace, onDone: () -> Unit) {
    val scope = rememberCoroutineScope()
    var reason by remember { mutableStateOf("") }
    var sending by remember { mutableStateOf(false) }
    var sent by remember { mutableStateOf(false) }
    var problem by remember { mutableStateOf<String?>(null) }
    InkDialog(
        title = if (sent) "Reported" else "Report “${w.title}”",
        icon = if (sent) "check" else "flag",
        onDismiss = onDone,
        actions = {
            if (sent) Seal("Done", compact = true, onClick = onDone)
            else {
                Seal("Cancel", compact = true, tone = SealTone.Quiet, onClick = onDone)
                Seal("Send report", compact = true, busy = sending, onClick = { sending = true; problem = null; scope.launch { try { code.report(w.id, reason.trim()); sent = true } catch (p: KimonoProblem) { problem = p.message } finally { sending = false } } })
            }
        },
    ) {
        if (sent) Text("Thanks. It was sent without your name.", style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
        else Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text("Admins can see the whole chat. Your name isn’t attached.", style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
            OutlinedTextField(reason, { reason = it.take(4000) }, placeholder = { Text("What went wrong? (optional)") }, minLines = 3, modifier = Modifier.fillMaxWidth())
            problem?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
        }
    }
}

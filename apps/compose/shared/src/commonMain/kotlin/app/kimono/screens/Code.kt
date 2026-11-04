@file:OptIn(ExperimentalMaterial3Api::class, ExperimentalMaterial3ExpressiveApi::class, androidx.compose.foundation.layout.ExperimentalLayoutApi::class)

package app.kimono.screens

import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.material3.HorizontalDivider
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
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
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExperimentalMaterial3ExpressiveApi
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ListItemDefaults
import androidx.compose.material3.LoadingIndicator
import androidx.compose.material3.MaterialShapes
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SegmentedListItem
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.material3.toShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import app.kimono.data.Code
import app.kimono.data.Drive
import app.kimono.data.DriveFolder
import app.kimono.data.DriveNode
import app.kimono.data.DriveSpace
import app.kimono.data.CodeAttachment
import app.kimono.data.CodeChanges
import app.kimono.data.CodeEntry
import app.kimono.data.CodeEvent
import app.kimono.data.CodeRepository
import app.kimono.data.CodeWorkspace
import app.kimono.data.KimonoProblem
import app.kimono.data.PickedFile
import app.kimono.data.Platform
import app.kimono.data.StoredCodeEvent
import app.kimono.data.elapsedText
import app.kimono.data.readableSize
import app.kimono.theme.Kata
import app.kimono.ui.KimonoRefresh
import app.kimono.ui.KimonoTopBar
import app.kimono.ui.Problem
import app.kimono.ui.Seal
import app.kimono.ui.SealTone
import app.kimono.ui.SvgMark
import app.kimono.ui.kimonoIcon
import app.kimono.ui.segmentColors
import coil3.compose.AsyncImage
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlin.time.Clock

/*
 * 工 Kimono Code on the phone: the workspaces, and one workspace's
 * conversation with the agent, its files and its changes. The same timeline
 * the web page shows, asked for a second apart while the agent works.
 */

private val mono = FontFamily.Monospace
private fun now() = Clock.System.now().toEpochMilliseconds()

/** A clock that ticks every second while [running]. */
@Composable
private fun ticking(running: Boolean): Long {
    val time by produceState(now(), running) { while (running) { value = now(); delay(1000) } }
    return time
}

/** Runs [block] again and again while the screen is in front. */
@Composable
private fun WhileShown(key: Any?, block: suspend () -> Unit) {
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    LaunchedEffect(key, lifecycle) { lifecycle.repeatOnLifecycle(Lifecycle.State.RESUMED) { block() } }
}

private fun whenText(at: Long, now: Long): String {
    val minutes = (now - at) / 60_000
    return when {
        minutes < 1 -> "now"
        minutes < 60 -> "${minutes}m"
        minutes < 60 * 24 -> "${minutes / 60}h"
        else -> "${minutes / (60 * 24)}d"
    }
}

/* ── the workspaces ── */

@Composable
fun CodeScreen(code: Code, bloom: String?, open: (String) -> Unit) {
    val scope = rememberCoroutineScope()
    var list by remember { mutableStateOf(code.knownWorkspaces()) }
    var problem by remember { mutableStateOf<String?>(null) }
    var refreshing by remember { mutableStateOf(false) }
    var starting by remember { mutableStateOf(false) }
    suspend fun load() { try { list = code.workspaces(); problem = null } catch (p: KimonoProblem) { problem = p.message } }
    val anyRunning = list?.any { it.running } == true
    WhileShown(Unit) { while (true) { load(); delay(if (list?.any { it.running } == true) 3000 else 10_000) } }
    val time = ticking(anyRunning)
    Scaffold(
        containerColor = MaterialTheme.colorScheme.surface,
        topBar = { KimonoTopBar("Code", mark = { SvgMark(bloom, 32.dp) }) },
        floatingActionButton = {
            ExtendedFloatingActionButton(onClick = { starting = true }, icon = { Icon(kimonoIcon("plus"), null) }, text = { Text("New task") }, containerColor = MaterialTheme.colorScheme.primaryContainer, contentColor = MaterialTheme.colorScheme.onPrimaryContainer)
        },
    ) { padding ->
        KimonoRefresh(refreshing, { scope.launch { refreshing = true; load(); refreshing = false } }, Modifier.padding(padding).fillMaxSize()) {
            val shown = list
            when {
                shown == null && problem == null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { LoadingIndicator() }
                shown.isNullOrEmpty() -> Quiet(problem ?: "Give the agent a task on one of your repositories.")
                else -> LazyColumn(contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 8.dp, bottom = 120.dp), verticalArrangement = Arrangement.spacedBy(ListItemDefaults.SegmentedGap)) {
                    if (problem != null) item { Problem(problem) }
                    itemsIndexed(shown, key = { _, w -> w.id }) { index, w ->
                        SegmentedListItem(
                            onClick = { open("code/${w.id}") },
                            shapes = ListItemDefaults.segmentedShapes(index, shown.size),
                            colors = segmentColors(),
                            supportingContent = { Text(w.repo.name, fontFamily = mono, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                            trailingContent = { StatusWord(w, time) },
                        ) { Text(w.title, style = MaterialTheme.typography.bodyLarge, maxLines = 2, overflow = TextOverflow.Ellipsis) }
                    }
                }
            }
        }
    }
    if (starting) NewTaskSheet(code, onDismiss = { starting = false }) { made ->
        starting = false
        open("code/${made.id}")
    }
}

/** One word, and only when it says something. Moss is for working, and nothing else. */
@Composable
private fun StatusWord(w: CodeWorkspace, time: Long) {
    val turn = w.turn
    when {
        turn?.state == "running" -> Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Box(Modifier.size(7.dp).background(Kata.moss, RoundedCornerShape(1.dp)))
            Text("working ${elapsedText(time - turn.startedAt)}", fontFamily = mono, fontSize = 12.sp, color = Kata.mossDeep, fontWeight = FontWeight.SemiBold)
        }
        turn?.state == "failed" -> Text("stopped", fontFamily = mono, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
        w.preview != null -> Text("live", fontFamily = mono, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
        w.pullRequest != null -> Text("#${w.pullRequest.number}", fontFamily = mono, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
        else -> Text(whenText(w.updatedAt, time), fontFamily = mono, fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun Quiet(text: String) {
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(horizontal = 40.dp, vertical = 80.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        item {
            Box(Modifier.size(96.dp).background(MaterialTheme.colorScheme.secondaryContainer, MaterialShapes.Cookie9Sided.toShape()), contentAlignment = Alignment.Center) {
                Icon(kimonoIcon("code"), null, modifier = Modifier.size(40.dp), tint = MaterialTheme.colorScheme.onSecondaryContainer)
            }
            Spacer(Modifier.size(20.dp))
            Text(text, style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.width(280.dp))
        }
    }
}

/* ── a new task ── */

@Composable
private fun NewTaskSheet(code: Code, onDismiss: () -> Unit, started: (CodeWorkspace) -> Unit) {
    val scope = rememberCoroutineScope()
    val sheet = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    var repos by remember { mutableStateOf<List<CodeRepository>?>(null) }
    var repo by remember { mutableStateOf<CodeRepository?>(null) }
    var branches by remember { mutableStateOf<List<String>>(emptyList()) }
    var base by remember { mutableStateOf("") }
    var prompt by remember { mutableStateOf("") }
    var problem by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    /* Naming a new project: null while choosing from the list. */
    var naming by remember { mutableStateOf<String?>(null) }
    var making by remember { mutableStateOf(false) }
    var loadFailed by remember { mutableStateOf(false) }
    val taskFocus = remember { FocusRequester() }
    LaunchedEffect(Unit) {
        try { repos = code.repositories().also { repo = it.firstOrNull() } } catch (p: KimonoProblem) { problem = p.message; repos = emptyList(); loadFailed = true }
    }
    fun makeProject() {
        val name = naming?.trim().orEmpty()
        if (name.isEmpty() || making) return
        making = true
        problem = null
        scope.launch {
            try {
                val made = code.createRepository(name)
                repos = listOf(made) + (repos ?: emptyList())
                repo = made
                naming = null
                runCatching { taskFocus.requestFocus() }
            } catch (p: KimonoProblem) { problem = p.message }
            making = false
        }
    }
    val noProjects = repos?.isEmpty() == true && !loadFailed
    LaunchedEffect(repo) {
        val r = repo ?: return@LaunchedEffect
        base = r.defaultBranch
        branches = listOf(r.defaultBranch)
        runCatching { code.branches(r.owner, r.name) }.getOrNull()?.let { list -> branches = if (r.defaultBranch in list) list else listOf(r.defaultBranch) + list }
    }
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheet, containerColor = MaterialTheme.colorScheme.surfaceContainerLow, shape = MaterialTheme.shapes.large) {
        Column(Modifier.fillMaxWidth().padding(horizontal = 20.dp).padding(bottom = 24.dp).imePadding(), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            Text("New task", style = MaterialTheme.typography.headlineSmall)
            if (naming != null || noProjects) {
                OutlinedTextField(
                    naming ?: "", { naming = it }, label = { Text("New project") }, placeholder = { Text("Family recipes") }, singleLine = true,
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done), keyboardActions = KeyboardActions(onDone = { makeProject() }),
                    modifier = Modifier.fillMaxWidth(),
                )
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.fillMaxWidth()) {
                    if (!noProjects) Seal("Cancel", tone = SealTone.Quiet, modifier = Modifier.weight(1f), onClick = { naming = null; problem = null })
                    Seal("Make project", busy = making, enabled = !naming.isNullOrBlank(), modifier = Modifier.weight(1f), onClick = { makeProject() })
                }
            } else {
                Picker("Project", repo?.name ?: if (repos == null) "Loading…" else "None", (repos ?: emptyList()).map { "${it.owner}/${it.name}" }, action = "New project" to { naming = ""; problem = null }) { chosen -> repo = repos?.firstOrNull { "${it.owner}/${it.name}" == chosen } }
                Picker("Starting from", base.ifEmpty { "—" }, branches) { base = it }
            }
            OutlinedTextField(prompt, { prompt = it }, label = { Text("Task") }, minLines = 4, maxLines = 10, modifier = Modifier.fillMaxWidth().focusRequester(taskFocus))
            Problem(problem)
            Seal("Start", busy = busy, enabled = repo != null && prompt.isNotBlank(), modifier = Modifier.fillMaxWidth(), onClick = {
                val r = repo ?: return@Seal
                busy = true
                problem = null
                scope.launch {
                    try { started(code.start(r.owner, r.name, base.ifEmpty { r.defaultBranch }, prompt)) } catch (p: KimonoProblem) { problem = p.message }
                    busy = false
                }
            })
        }
    }
}

/** A labelled choice that opens its options in a menu. */
@Composable
private fun Picker(label: String, value: String, options: List<String>, action: Pair<String, () -> Unit>? = null, choose: (String) -> Unit) {
    var open by remember { mutableStateOf(false) }
    Box {
        Surface(onClick = { if (options.isNotEmpty() || action != null) open = true }, shape = MaterialTheme.shapes.medium, color = MaterialTheme.colorScheme.surfaceContainer, modifier = Modifier.fillMaxWidth()) {
            Row(Modifier.padding(horizontal = 16.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(label, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Text(value, style = MaterialTheme.typography.bodyLarge, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                Icon(kimonoIcon("chevron"), null, modifier = Modifier.size(18.dp))
            }
        }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }, shape = MaterialTheme.shapes.large) {
            options.forEach { option -> DropdownMenuItem(text = { Text(option, maxLines = 1, overflow = TextOverflow.Ellipsis) }, onClick = { open = false; choose(option) }) }
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

/* ── a workspace ── */

@Composable
fun WorkspaceScreen(code: Code, drive: Drive, platform: Platform, id: String, open: (String) -> Unit, back: () -> Unit) {
    val scope = rememberCoroutineScope()
    var workspace by remember { mutableStateOf(code.knownWorkspaces()?.firstOrNull { it.id == id }) }
    val events = remember { mutableStateListOf<StoredCodeEvent>() }
    var problem by remember { mutableStateOf<String?>(null) }
    var tab by remember { mutableStateOf(0) }
    var publishing by remember { mutableStateOf(false) }
    var deleting by remember { mutableStateOf(false) }

    WhileShown(id) {
        while (true) {
            try {
                val (now, fresh) = code.events(id, events.lastOrNull()?.seq ?: 0)
                workspace = now
                events.addAll(fresh.filter { e -> e.seq > (events.lastOrNull()?.seq ?: 0) })
                problem = null
            } catch (p: KimonoProblem) { problem = p.message }
            delay(if (workspace?.running == true) 1000 else 5000)
        }
    }
    val w = workspace
    val time = ticking(w?.running == true)
    Scaffold(
        containerColor = MaterialTheme.colorScheme.surface,
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text(w?.title ?: "", style = MaterialTheme.typography.titleMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        if (w != null) Text("${w.repo.name} · ${w.branch}", fontFamily = mono, fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                },
                navigationIcon = { IconButton(onClick = back) { Icon(kimonoIcon("back"), "Back") } },
                actions = {
                    if (w?.preview != null) TextButton(onClick = { platform.openUrl(w.preview.url) }) {
                        Icon(kimonoIcon("open"), null, modifier = Modifier.size(16.dp)); Spacer(Modifier.width(6.dp)); Text("Open app")
                    }
                    if (w?.drive != null) IconButton(onClick = { open("folder/${w.drive.folderId}") }) { Icon(kimonoIcon("folder"), "Open in Drive") }
                    IconButton(onClick = { deleting = true }) { Icon(kimonoIcon("trash"), "Delete workspace") }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.surface),
            )
        },
    ) { padding ->
        Column(Modifier.padding(padding).fillMaxSize()) {
            Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                if (w?.pullRequest != null) TextButton(onClick = { platform.openUrl(w.pullRequest.url) }) {
                    Icon(kimonoIcon("pr"), null, modifier = Modifier.size(16.dp)); Spacer(Modifier.width(6.dp)); Text("Pull request #${w.pullRequest.number}")
                }
                Spacer(Modifier.weight(1f))
                if (w?.running == true) Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    Box(Modifier.size(8.dp).background(Kata.moss, RoundedCornerShape(1.dp)))
                    Text("Working ${elapsedText(time - w.turn!!.startedAt)}", fontFamily = mono, fontSize = 12.sp, color = Kata.mossDeep, fontWeight = FontWeight.SemiBold)
                } else if (w != null) Seal(if (w.pullRequest != null) "Push changes" else "Open pull request", compact = true, busy = publishing, tone = if (w.pullRequest != null) SealTone.Quiet else SealTone.Primary, onClick = {
                    publishing = true
                    scope.launch {
                        try { workspace = code.publish(id, w.title); problem = null } catch (p: KimonoProblem) { problem = p.message }
                        publishing = false
                    }
                })
            }
            SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp)) {
                val tabs = listOf("Chat", "Files", "Changes")
                tabs.forEachIndexed { index, label ->
                    SegmentedButton(selected = tab == index, onClick = { tab = index }, shape = SegmentedButtonDefaults.itemShape(index, tabs.size)) { Text(label) }
                }
            }
            if (problem != null) Box(Modifier.padding(horizontal = 20.dp, vertical = 4.dp)) { Problem(problem) }
            Box(Modifier.weight(1f).fillMaxWidth()) {
                if (w == null) Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { LoadingIndicator() }
                else when (tab) {
                    0 -> Chat(code, drive, platform, w, events)
                    1 -> Files(code, w)
                    else -> Changes(code, w, events.lastOrNull()?.seq ?: 0)
                }
            }
        }
    }
    if (deleting) AlertDialog(
        onDismissRequest = { deleting = false },
        title = { Text("Delete the sandbox?") },
        text = { Text("Its files stay in Drive.") },
        confirmButton = { TextButton(onClick = {
            deleting = false
            scope.launch { try { code.remove(id); back() } catch (p: KimonoProblem) { problem = p.message } }
        }) { Text("Delete", color = MaterialTheme.colorScheme.error) } },
        dismissButton = { TextButton(onClick = { deleting = false }) { Text("Keep") } },
    )
}

/* ── chat ── */

private class ToolCall(val event: CodeEvent.Tool) { var result by mutableStateOf<CodeEvent.ToolResult?>(null) }

private sealed interface Item {
    val key: Long
    data class Ask(override val key: Long, val event: CodeEvent.Ask) : Item
    data class Say(override val key: Long, val text: String) : Item
    data class Tools(override val key: Long, val calls: MutableList<ToolCall>) : Item
    data class Done(override val key: Long, val event: CodeEvent.Done) : Item
    data class Published(override val key: Long, val event: CodeEvent.Published) : Item
    data class Shots(override val key: Long, val shots: MutableList<CodeEvent.Image>) : Item
    data class Preview(override val key: Long, val event: CodeEvent.Preview) : Item
    data class PreviewStopped(override val key: Long) : Item
}

private fun itemsOf(events: List<StoredCodeEvent>): List<Item> {
    val items = mutableListOf<Item>()
    val calls = mutableMapOf<String, ToolCall>()
    for (stored in events) {
        when (val e = stored.event) {
            is CodeEvent.Ask -> items += Item.Ask(stored.seq, e)
            is CodeEvent.Say -> items += Item.Say(stored.seq, e.text)
            is CodeEvent.Tool -> {
                val call = ToolCall(e).also { calls[e.id] = it }
                val last = items.lastOrNull()
                if (last is Item.Tools) last.calls += call else items += Item.Tools(stored.seq, mutableListOf(call))
            }
            is CodeEvent.ToolResult -> calls[e.id]?.result = e
            is CodeEvent.Done -> items += Item.Done(stored.seq, e)
            is CodeEvent.Published -> items += Item.Published(stored.seq, e)
            is CodeEvent.Image -> { val last = items.lastOrNull(); if (last is Item.Shots) last.shots += e else items += Item.Shots(stored.seq, mutableListOf(e)) }
            is CodeEvent.Preview -> items += Item.Preview(stored.seq, e)
            is CodeEvent.PreviewStopped -> items += Item.PreviewStopped(stored.seq)
            else -> {}
        }
    }
    return items
}

@Composable
private fun Chat(code: Code, drive: Drive, platform: Platform, w: CodeWorkspace, events: List<StoredCodeEvent>) {
    val items = remember(events.size) { itemsOf(events) }
    val list = rememberLazyListState()
    val scope = rememberCoroutineScope()
    /* Follows the agent while you're at the bottom; leaves you alone once you scroll up. */
    val atBottom by remember { derivedStateOf { val info = list.layoutInfo; val last = info.visibleItemsInfo.lastOrNull(); last == null || last.index >= info.totalItemsCount - 1 } }
    var following by remember { mutableStateOf(true) }
    LaunchedEffect(atBottom) { if (atBottom) following = true else if (list.isScrollInProgress) following = false }
    LaunchedEffect(items.size) { if (following && items.isNotEmpty()) list.animateScrollToItem(items.size) }
    /* Only the turn under way may hold a group open. */
    val lastAsk = items.indexOfLast { it is Item.Ask }
    val lastTools = items.drop(lastAsk + 1).lastOrNull { it is Item.Tools }
    val lastPreview = items.lastOrNull { it is Item.Preview }?.key
    var viewing by remember { mutableStateOf<Pair<List<CodeEvent.Image>, Int>?>(null) }
    Column(Modifier.fillMaxSize()) {
        Box(Modifier.weight(1f).fillMaxWidth()) {
            LazyColumn(state = list, contentPadding = PaddingValues(horizontal = 16.dp, vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(12.dp), modifier = Modifier.fillMaxSize()) {
                items(items, key = { it.key }) { item ->
                    when (item) {
                        is Item.Ask -> AskBubble(code, platform, w, item.event)
                        is Item.Say -> Markdown(item.text)
                        is Item.Tools -> ToolGroup(item.calls, live = w.running && item === lastTools)
                        is Item.Done -> DoneNote(item.event)
                        is Item.Shots -> ShotGallery(code, w, item.shots) { at -> viewing = item.shots.toList() to at }
                        is Item.Preview -> if (w.preview?.url == item.event.url && item.key == lastPreview) PreviewCard(code, platform, w, item.event)
                            else QuietLine("link", "The app ran at ${item.event.host}")
                        is Item.PreviewStopped -> QuietLine("link", "The app\u2019s link was taken down.")
                        is Item.Published -> Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.clickable { platform.openUrl(item.event.url) }) {
                            Icon(kimonoIcon("pr"), null, modifier = Modifier.size(16.dp))
                            Text("Opened pull request #${item.event.number}", style = MaterialTheme.typography.labelLarge)
                        }
                    }
                }
                item(key = "tail") {
                    if (w.running && items.lastOrNull() !is Item.Tools) Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Box(Modifier.size(8.dp).background(Kata.moss, RoundedCornerShape(1.dp)))
                        Text("Working", fontFamily = mono, fontSize = 12.sp, color = Kata.mossDeep, fontWeight = FontWeight.SemiBold)
                    }
                }
            }
            if (!atBottom && !following) Surface(
                onClick = { following = true; scope.launch { list.animateScrollToItem(items.size) } },
                shape = RoundedCornerShape(2.dp), color = MaterialTheme.colorScheme.surface, border = androidx.compose.foundation.BorderStroke(2.dp, Kata.ink),
                modifier = Modifier.align(Alignment.BottomCenter).padding(bottom = 12.dp),
            ) { Text("Latest ↓", style = MaterialTheme.typography.labelLarge, modifier = Modifier.padding(horizontal = 14.dp, vertical = 8.dp)) }
        }
        Composer(code, drive, platform, w)
    }
    viewing?.let { (shots, at) -> ShotViewer(code, w, shots, at) { viewing = null } }
}

@Composable
private fun QuietLine(icon: String, text: String) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Icon(kimonoIcon(icon), null, modifier = Modifier.size(16.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(text, style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

/* ── what the agent shows: screenshots, and the app it is running ── */

@Composable
private fun ShotImage(code: Code, w: CodeWorkspace, shot: CodeEvent.Image, modifier: Modifier, scale: ContentScale) {
    val bytes by produceState<ByteArray?>(null, shot.name) { value = runCatching { code.shot(w.id, shot.name) }.getOrNull() }
    Box(modifier.background(Kata.fold)) {
        if (bytes != null) AsyncImage(model = bytes, contentDescription = shot.caption ?: "Screenshot", contentScale = scale, alignment = Alignment.TopCenter, modifier = Modifier.fillMaxSize())
    }
}

/** One screenshot full width; several, two to a row. */
@Composable
private fun ShotGallery(code: Code, w: CodeWorkspace, shots: List<CodeEvent.Image>, onOpen: (Int) -> Unit) {
    val columns = if (shots.size == 1) 1 else 2
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        shots.withIndex().chunked(columns).forEach { row ->
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                row.forEach { (index, shot) ->
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        ShotImage(code, w, shot,
                            Modifier.fillMaxWidth().aspectRatio(if (columns == 1) 1.6f else 0.75f).clip(RoundedCornerShape(2.dp))
                                .border(1.dp, Kata.hair, RoundedCornerShape(2.dp)).clickable { onOpen(index) },
                            ContentScale.Crop)
                        shot.caption?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 2, overflow = TextOverflow.Ellipsis) }
                    }
                }
                if (row.size < columns) Spacer(Modifier.weight(1f))
            }
        }
    }
}

/** Screenshots full screen: swipe between them, back or ✕ to close. */
@Composable
private fun ShotViewer(code: Code, w: CodeWorkspace, shots: List<CodeEvent.Image>, at: Int, onClose: () -> Unit) {
    Dialog(onDismissRequest = onClose, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        val pager = rememberPagerState(initialPage = at) { shots.size }
        Column(Modifier.fillMaxSize().background(Kata.ink)) {
            Row(Modifier.fillMaxWidth().statusBarsPadding().padding(horizontal = 8.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(shots[pager.currentPage].caption ?: "", color = Kata.lift, style = MaterialTheme.typography.bodyMedium, maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f).padding(start = 8.dp))
                if (shots.size > 1) Text("${pager.currentPage + 1} / ${shots.size}", color = Kata.lift, fontFamily = mono, fontSize = 12.sp)
                IconButton(onClick = onClose) { Icon(kimonoIcon("close"), "Close", tint = Kata.lift) }
            }
            HorizontalPager(pager, Modifier.weight(1f).fillMaxWidth().navigationBarsPadding()) { page ->
                ShotImage(code, w, shots[page], Modifier.fillMaxSize().background(Kata.ink), ContentScale.Fit)
            }
        }
    }
}

/** The app the agent is running: a link anyone can open while it's up. */
@Composable
private fun PreviewCard(code: Code, platform: Platform, w: CodeWorkspace, preview: CodeEvent.Preview) {
    val scope = rememberCoroutineScope()
    var stopping by remember { mutableStateOf(false) }
    var problem by remember { mutableStateOf<String?>(null) }
    Row(Modifier.fillMaxWidth().border(2.dp, Kata.ink, RoundedCornerShape(2.dp)).background(Kata.lift, RoundedCornerShape(2.dp))) {
        Box(Modifier.width(3.dp).heightIn(min = 120.dp).background(MaterialTheme.colorScheme.primary))
        Column(Modifier.weight(1f).padding(14.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text("Your app is running", style = MaterialTheme.typography.titleSmall, color = Kata.ink)
            Text(preview.host, fontFamily = mono, fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text("Anyone with the link can open it while it\u2019s up.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            FlowRow(Modifier.padding(top = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Seal("Open", compact = true, onClick = { platform.openUrl(preview.url) })
                Seal("Share", compact = true, tone = SealTone.Quiet, onClick = { platform.share(preview.url) })
                Seal(if (stopping) "Stopping\u2026" else "Take down", compact = true, tone = SealTone.Quiet, busy = stopping, onClick = {
                    stopping = true
                    scope.launch { try { code.stopPreview(w.id); problem = null } catch (p: KimonoProblem) { problem = p.message; stopping = false } }
                })
            }
            problem?.let { Problem(it) }
        }
    }
}

@Composable
private fun AskBubble(code: Code, platform: Platform, w: CodeWorkspace, ask: CodeEvent.Ask) {
    Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.CenterEnd) {
        Column(
            Modifier.widthIn(max = 320.dp).background(Kata.fold, RoundedCornerShape(2.dp)).border(1.dp, Kata.hair, RoundedCornerShape(2.dp)).padding(horizontal = 14.dp, vertical = 10.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            if (ask.text.isNotBlank()) Text(ask.text, style = MaterialTheme.typography.bodyLarge, color = Kata.ink)
            if (ask.attachments.isNotEmpty()) Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                ask.attachments.forEach { a -> if (a.isPicture) AttachedPicture(code, w, a) else FileChip(a.name, readableSize(a.size)) }
            }
        }
    }
}

@Composable
private fun AttachedPicture(code: Code, w: CodeWorkspace, a: CodeAttachment) {
    val bytes by produceState<ByteArray?>(null, a.path) { value = runCatching { code.attachment(w.id, a) }.getOrNull() }
    Box(Modifier.size(width = 120.dp, height = 90.dp).clip(RoundedCornerShape(1.dp)).background(Kata.lift).border(1.dp, Kata.hair, RoundedCornerShape(1.dp))) {
        if (bytes != null) AsyncImage(model = bytes, contentDescription = a.name, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
    }
}

@Composable
private fun FileChip(name: String, detail: String, onRemove: (() -> Unit)? = null) {
    Row(
        Modifier.heightIn(min = 40.dp).background(Kata.lift, RoundedCornerShape(1.dp)).border(1.dp, Kata.hair, RoundedCornerShape(1.dp)).padding(start = 10.dp, end = if (onRemove == null) 10.dp else 0.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Icon(kimonoIcon("file"), null, modifier = Modifier.size(16.dp))
        Text(name, style = MaterialTheme.typography.labelLarge, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.widthIn(max = 160.dp))
        Text(detail, fontFamily = mono, fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
        if (onRemove != null) IconButton(onClick = onRemove, modifier = Modifier.size(36.dp)) { Icon(kimonoIcon("close"), "Remove $name", modifier = Modifier.size(14.dp)) }
    }
}

/** Tool calls as one line — "Used 5 tools" — open while the agent is still in them, unless you closed it. */
@Composable
private fun ToolGroup(calls: List<ToolCall>, live: Boolean) {
    var chosen by remember { mutableStateOf<Boolean?>(null) }
    val open = chosen ?: live
    val pending = calls.any { it.result == null }
    val failed = calls.count { it.result?.ok == false }
    Column(Modifier.fillMaxWidth().padding(start = 2.dp)) {
        Row(Modifier.fillMaxWidth().heightIn(min = 40.dp).clickable { chosen = !open }, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Icon(kimonoIcon("chevron"), null, modifier = Modifier.size(14.dp).rotate(if (open) 90f else 0f), tint = MaterialTheme.colorScheme.onSurfaceVariant)
            Text(if (live && pending) "Using tools" else "Used ${calls.size} ${if (calls.size == 1) "tool" else "tools"}", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
            if (failed > 0) Text("$failed failed", fontFamily = mono, fontSize = 11.sp, fontWeight = FontWeight.SemiBold)
        }
        if (open) Column(Modifier.padding(start = 10.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            calls.forEach { call -> ToolRow(call) }
        }
    }
}

@Composable
private fun ToolRow(call: ToolCall) {
    var open by remember { mutableStateOf(false) }
    val result = call.result
    Column {
        Row(Modifier.fillMaxWidth().heightIn(min = 36.dp).clickable(enabled = !result?.output.isNullOrBlank()) { open = !open }, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Box(Modifier.size(16.dp), contentAlignment = Alignment.Center) {
                when {
                    result == null -> Box(Modifier.size(7.dp).background(Kata.moss, RoundedCornerShape(1.dp)))
                    result.ok -> Icon(kimonoIcon("check"), "Done", modifier = Modifier.size(14.dp))
                    else -> Icon(kimonoIcon("close"), "Failed", modifier = Modifier.size(14.dp), tint = Kata.suoDeep)
                }
            }
            Text(call.event.label, style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
            call.event.detail?.let { Text(it.lineSequence().first(), fontFamily = mono, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false)) }
            if (result?.ok == false) Text("failed", fontFamily = mono, fontSize = 11.sp, fontWeight = FontWeight.SemiBold)
        }
        if (open && result != null) Lacquer(result.output, Modifier.padding(start = 24.dp, top = 4.dp, bottom = 6.dp).heightIn(max = 260.dp))
    }
}

@Composable
private fun DoneNote(e: CodeEvent.Done) {
    when {
        e.cancelled -> Text("Stopped.", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
        !e.ok -> Row(
            Modifier.fillMaxWidth().background(Kata.suoWash, RoundedCornerShape(1.dp)).border(1.dp, Kata.hair, RoundedCornerShape(1.dp)).padding(10.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Icon(kimonoIcon("close"), null, modifier = Modifier.size(16.dp), tint = Kata.suoDeep)
            Text(e.error ?: "The agent stopped with an error.", style = MaterialTheme.typography.bodyMedium, color = Kata.suoDeep)
        }
        else -> Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Icon(kimonoIcon("check"), null, modifier = Modifier.size(16.dp))
            Text("Done", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
            val facts = listOfNotNull(e.durationMs?.let { elapsedText(it) }, e.costUsd?.let { "$" + ((it * 100).toLong() / 100.0).toString() })
            if (facts.isNotEmpty()) Text(facts.joinToString(" · "), fontFamily = mono, fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

/* ── the composer ── */

/** A file on its way into the sandbox: picked from the phone, or already copied from Drive. */
private class Pending(val name: String, val size: Long) {
    var attachment by mutableStateOf<CodeAttachment?>(null)
    var failed by mutableStateOf<String?>(null)
}

@Composable
private fun Composer(code: Code, drive: Drive, platform: Platform, w: CodeWorkspace) {
    var choosing by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    var text by remember(w.id) { mutableStateOf("") }
    val pending = remember(w.id) { mutableStateListOf<Pending>() }
    var problem by remember { mutableStateOf<String?>(null) }
    var sending by remember { mutableStateOf(false) }
    val uploading = pending.any { it.attachment == null && it.failed == null }
    val ready = pending.mapNotNull { it.attachment }
    val canSend = !w.running && !sending && !uploading && (text.isNotBlank() || ready.isNotEmpty())
    Column(
        Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.surface).padding(horizontal = 12.dp, vertical = 8.dp).navigationBarsPadding().imePadding()
            .border(2.dp, Kata.hairDeep, RoundedCornerShape(2.dp)).background(Kata.lift, RoundedCornerShape(2.dp)).padding(horizontal = 10.dp, vertical = 8.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        if (pending.isNotEmpty()) LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            items(pending) { p -> FileChip(p.name, p.failed ?: if (p.attachment != null) readableSize(p.size) else "Attaching…") { pending.remove(p) } }
        }
        androidx.compose.foundation.text.BasicTextField(
            value = text, onValueChange = { text = it },
            textStyle = MaterialTheme.typography.bodyLarge.copy(color = Kata.ink),
            maxLines = 6,
            modifier = Modifier.fillMaxWidth().heightIn(min = 28.dp).padding(horizontal = 4.dp, vertical = 4.dp),
            decorationBox = { inner -> Box { if (text.isEmpty()) Text(if (w.running) "The agent is working…" else "Ask for a change, or reply", style = MaterialTheme.typography.bodyLarge, color = Kata.faint); inner() } },
        )
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            IconButton(onClick = {
                scope.launch {
                    val picked = platform.pickFiles().take(10 - pending.size)
                    for (file in picked) {
                        val item = Pending(file.name, file.size)
                        pending += item
                        launch { try { item.attachment = code.attach(w.id, file) } catch (p: KimonoProblem) { item.failed = p.message ?: "Didn't attach" } }
                    }
                }
            }) { Icon(kimonoIcon("clip"), "Attach files") }
            IconButton(onClick = { choosing = true }) { Icon(kimonoIcon("folder"), "From Drive") }
            Box(Modifier.weight(1f)) { Problem(problem) }
            if (w.running) Seal("Stop", compact = true, tone = SealTone.Quiet, onClick = { scope.launch { try { code.stop(w.id) } catch (p: KimonoProblem) { problem = p.message } } })
            else Seal("Send", compact = true, busy = sending, enabled = canSend, onClick = {
                sending = true
                problem = null
                scope.launch {
                    try { code.ask(w.id, text, ready); text = ""; pending.clear() } catch (p: KimonoProblem) { problem = p.message }
                    sending = false
                }
            })
        }
    }
    if (choosing) FromDriveSheet(drive, onDismiss = { choosing = false }) { nodes ->
        choosing = false
        val items = nodes.map { Pending(it.name, it.size) }
        pending += items
        scope.launch {
            try {
                val attached = code.fromDrive(w.id, nodes.map { it.id })
                items.forEachIndexed { i, item -> item.attachment = attached.getOrNull(i); if (item.attachment == null) item.failed = "Didn't attach" }
            } catch (p: KimonoProblem) { items.forEach { it.failed = p.message ?: "Didn't attach" } }
        }
    }
}

/**
 * Files from Drive for the agent: your spaces, then folders down to files,
 * any number chosen across folders. Added files are copied into the task.
 */
@Composable
private fun FromDriveSheet(drive: Drive, onDismiss: () -> Unit, onAdd: (List<DriveNode>) -> Unit) {
    val sheet = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    /* Where you are: null is the list of spaces; otherwise the folders you came down through. */
    val trail = remember { mutableStateListOf<Pair<String, String>>() }
    val chosen = remember { mutableStateMapOf<String, DriveNode>() }
    val here = trail.lastOrNull()
    val spaces by produceState<Result<List<DriveSpace>>?>(drive.knownSpaces()?.let { Result.success(it) }) { value = runCatching { drive.spaces() } }
    val folder by produceState<Result<DriveFolder>?>(null, here?.first) { value = null; if (here != null) value = runCatching { drive.folder(here.first) } }
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheet, containerColor = MaterialTheme.colorScheme.surfaceContainerLow, shape = MaterialTheme.shapes.large) {
        Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp).padding(bottom = 16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                if (here != null) IconButton(onClick = { trail.removeAt(trail.lastIndex) }) { Icon(kimonoIcon("back"), "Back") }
                Text(here?.second ?: "From Drive", style = MaterialTheme.typography.titleLarge, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f).padding(start = if (here == null) 4.dp else 0.dp))
            }
            LazyColumn(Modifier.fillMaxWidth().heightIn(max = 420.dp), verticalArrangement = Arrangement.spacedBy(ListItemDefaults.SegmentedGap)) {
                if (here == null) {
                    val result = spaces
                    when {
                        result == null -> item { Box(Modifier.fillMaxWidth().padding(32.dp), contentAlignment = Alignment.Center) { LoadingIndicator() } }
                        result.isFailure -> item { Problem(result.exceptionOrNull()?.message ?: "Drive isn't answering.") }
                        else -> {
                            val list = result.getOrThrow()
                            itemsIndexed(list, key = { _, s -> s.id }) { index, space ->
                                SegmentedListItem(
                                    onClick = { trail += space.rootId to space.name },
                                    shapes = ListItemDefaults.segmentedShapes(index, list.size), colors = segmentColors(),
                                    leadingContent = { Icon(kimonoIcon("folder"), null, modifier = Modifier.size(20.dp)) },
                                    trailingContent = { Icon(kimonoIcon("go"), null, modifier = Modifier.size(16.dp)) },
                                ) { Text(space.name, style = MaterialTheme.typography.bodyLarge, maxLines = 1, overflow = TextOverflow.Ellipsis) }
                            }
                        }
                    }
                } else {
                    val result = folder
                    when {
                        result == null -> item { Box(Modifier.fillMaxWidth().padding(32.dp), contentAlignment = Alignment.Center) { LoadingIndicator() } }
                        result.isFailure -> item { Problem(result.exceptionOrNull()?.message ?: "That folder couldn't be opened.") }
                        else -> {
                            val list = result.getOrThrow().children.sortedWith(compareBy({ !it.isFolder }, { it.name.lowercase() }))
                            if (list.isEmpty()) item { Text("Nothing here.", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(16.dp)) }
                            itemsIndexed(list, key = { _, n -> n.id }) { index, node ->
                                val picked = chosen.containsKey(node.id)
                                SegmentedListItem(
                                    onClick = { if (node.isFolder) trail += node.id to node.name else if (picked) chosen.remove(node.id) else chosen[node.id] = node },
                                    shapes = ListItemDefaults.segmentedShapes(index, list.size), colors = segmentColors(),
                                    leadingContent = { Icon(kimonoIcon(if (node.isFolder) "folder" else "file"), null, modifier = Modifier.size(20.dp)) },
                                    trailingContent = {
                                        when {
                                            node.isFolder -> Icon(kimonoIcon("go"), null, modifier = Modifier.size(16.dp))
                                            picked -> Icon(kimonoIcon("check"), "Chosen", tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(20.dp))
                                            else -> Text(readableSize(node.size), fontFamily = mono, fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                        }
                                    },
                                ) { Text(node.name, style = MaterialTheme.typography.bodyLarge, fontWeight = if (picked) FontWeight.SemiBold else null, maxLines = 1, overflow = TextOverflow.Ellipsis) }
                            }
                        }
                    }
                }
            }
            Seal(if (chosen.isEmpty()) "Choose files" else if (chosen.size == 1) "Add 1 file" else "Add ${chosen.size} files", enabled = chosen.isNotEmpty(), modifier = Modifier.fillMaxWidth(), onClick = { onAdd(chosen.values.toList()) })
        }
    }
}

/* ── files ── */

@Composable
private fun Files(code: Code, w: CodeWorkspace) {
    var path by remember { mutableStateOf("") }
    var opened by remember { mutableStateOf<String?>(null) }
    val file = opened
    if (file != null) { FileViewer(code, w, file) { opened = null }; return }
    val entries by produceState<Result<List<CodeEntry>>?>(null, path) { value = null; value = runCatching { code.files(w.id, path) } }
    LazyColumn(contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 4.dp, bottom = 40.dp), verticalArrangement = Arrangement.spacedBy(ListItemDefaults.SegmentedGap), modifier = Modifier.fillMaxSize()) {
        if (path.isNotEmpty()) item {
            Row(Modifier.fillMaxWidth().clickable { path = path.substringBeforeLast('/', "") }.padding(vertical = 10.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Icon(kimonoIcon("back"), "Up", modifier = Modifier.size(18.dp))
                Text(path, fontFamily = mono, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
        val result = entries
        when {
            result == null -> item { Box(Modifier.fillMaxWidth().padding(40.dp), contentAlignment = Alignment.Center) { LoadingIndicator() } }
            result.isFailure -> item { Problem(result.exceptionOrNull()?.message ?: "Those files couldn't be listed.") }
            else -> {
                val list = result.getOrThrow()
                itemsIndexed(list, key = { _, e -> e.name }) { index, entry ->
                    val full = if (path.isEmpty()) entry.name else "$path/${entry.name}"
                    SegmentedListItem(
                        onClick = { if (entry.kind == "dir") path = full else opened = full },
                        shapes = ListItemDefaults.segmentedShapes(index, list.size),
                        colors = segmentColors(),
                        leadingContent = { Icon(kimonoIcon(if (entry.kind == "dir") "folder" else "file"), null, modifier = Modifier.size(20.dp)) },
                        trailingContent = { if (entry.kind == "dir") Icon(kimonoIcon("go"), null, modifier = Modifier.size(16.dp)) else Text(readableSize(entry.size), fontFamily = mono, fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurfaceVariant) },
                    ) { Text(entry.name, style = MaterialTheme.typography.bodyLarge, maxLines = 1, overflow = TextOverflow.Ellipsis) }
                }
            }
        }
    }
}

private val pictureTypes = setOf("png", "jpg", "jpeg", "gif", "webp")

@Composable
private fun FileViewer(code: Code, w: CodeWorkspace, path: String, close: () -> Unit) {
    val bytes by produceState<Result<ByteArray>?>(null, path) { value = runCatching { code.file(w.id, path) } }
    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().clickable(onClick = close).padding(horizontal = 16.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Icon(kimonoIcon("back"), "Back to files", modifier = Modifier.size(18.dp))
            Text(path, fontFamily = mono, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        val result = bytes
        when {
            result == null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { LoadingIndicator() }
            result.isFailure -> Box(Modifier.padding(20.dp)) { Problem(result.exceptionOrNull()?.message) }
            path.substringAfterLast('.').lowercase() in pictureTypes -> AsyncImage(model = result.getOrThrow(), contentDescription = path, contentScale = ContentScale.Fit, modifier = Modifier.fillMaxSize().background(Kata.fold).padding(16.dp))
            else -> {
                val raw = result.getOrThrow()
                val text = raw.takeIf { b -> b.none { it == 0.toByte() } }?.decodeToString()
                if (text == null) Text("Not a text file · ${readableSize(raw.size.toLong())}", modifier = Modifier.padding(20.dp), color = MaterialTheme.colorScheme.onSurfaceVariant)
                else {
                    val lines = remember(text) { text.split('\n') }
                    val width = lines.size.toString().length
                    LazyColumn(Modifier.fillMaxSize().background(Kata.urushi).horizontalScroll(rememberScrollState()), contentPadding = PaddingValues(vertical = 10.dp)) {
                        itemsIndexed(lines) { n, line ->
                            Text(buildAnnotatedString {
                                withStyle(SpanStyle(color = Kata.urushiComment)) { append((n + 1).toString().padStart(width)); append("  ") }
                                append(line.ifEmpty { " " })
                            }, fontFamily = mono, fontSize = 12.sp, color = Kata.urushiText, softWrap = false, modifier = Modifier.padding(horizontal = 12.dp))
                        }
                    }
                }
            }
        }
    }
}

/* ── changes ── */

private fun splitDiff(diff: String): Map<String, List<String>> {
    val out = linkedMapOf<String, MutableList<String>>()
    var current: MutableList<String>? = null
    val meta = Regex("^(index |--- |\\+\\+\\+ |new file mode|deleted file mode|similarity index|rename (from|to) |old mode|new mode)")
    for (line in diff.split('\n')) {
        val head = Regex("^diff --git a/(.+?) b/(.+)$").find(line)
        if (head != null) { current = mutableListOf<String>().also { out[head.groupValues[2]] = it }; continue }
        if (current == null || meta.containsMatchIn(line)) continue
        current += line
    }
    return out
}

@Composable
private fun Changes(code: Code, w: CodeWorkspace, lastSeq: Long) {
    var changes by remember { mutableStateOf<CodeChanges?>(null) }
    var problem by remember { mutableStateOf<String?>(null) }
    val openFiles = remember { mutableStateMapOf<String, Boolean>() }
    LaunchedEffect(lastSeq, w.running) {
        if (changes != null) delay(2500)
        try { changes = code.changes(w.id); problem = null } catch (p: KimonoProblem) { problem = p.message }
    }
    val c = changes
    when {
        c == null && problem != null -> Box(Modifier.padding(20.dp)) { Problem(problem) }
        c == null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { LoadingIndicator() }
        c.files.isEmpty() -> Text("No changes from ${c.base} yet.", modifier = Modifier.padding(20.dp), color = MaterialTheme.colorScheme.onSurfaceVariant)
        else -> {
            val diffs = remember(c.diff) { splitDiff(c.diff) }
            LazyColumn(contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 4.dp, bottom = 40.dp), verticalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.fillMaxSize()) {
                item {
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text("${c.files.size} ${if (c.files.size == 1) "file" else "files"}", style = MaterialTheme.typography.titleSmall)
                        Text("+${c.files.sumOf { it.additions }} −${c.files.sumOf { it.deletions }}", fontFamily = mono, fontSize = 12.sp)
                        Text("against ${c.base}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
                items(c.files, key = { it.path }) { file ->
                    val open = openFiles[file.path] ?: false
                    Column(Modifier.fillMaxWidth().border(2.dp, Kata.hair, RoundedCornerShape(2.dp)).clip(RoundedCornerShape(2.dp))) {
                        Row(Modifier.fillMaxWidth().background(Kata.ground).clickable { openFiles[file.path] = !open }.padding(horizontal = 12.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            val letter = when (file.status) { "added" -> "A"; "deleted" -> "D"; "renamed" -> "R"; else -> "M" }
                            Box(Modifier.size(20.dp).border(1.dp, Kata.hairDeep, RoundedCornerShape(1.dp)), contentAlignment = Alignment.Center) { Text(letter, fontFamily = mono, fontSize = 11.sp, fontWeight = FontWeight.Bold) }
                            Text(file.path, fontFamily = mono, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                            Text("+${file.additions} −${file.deletions}", fontFamily = mono, fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        if (open) {
                            val lines = diffs[file.path].orEmpty()
                            if (lines.isEmpty()) Text("No text to show.", modifier = Modifier.padding(12.dp), color = MaterialTheme.colorScheme.onSurfaceVariant)
                            else androidx.compose.foundation.layout.BoxWithConstraints(Modifier.fillMaxWidth().background(Kata.urushi)) {
                                val least = maxWidth
                                Column(Modifier.horizontalScroll(rememberScrollState()).padding(vertical = 8.dp).widthIn(min = least).width(androidx.compose.foundation.layout.IntrinsicSize.Max)) {
                                lines.forEach { line ->
                                    val kind = when { line.startsWith("@@") -> 'h'; line.startsWith("+") -> '+'; line.startsWith("-") -> '-'; else -> ' ' }
                                    val bg = when (kind) { '+' -> Kata.urushiString.copy(alpha = .14f); '-' -> Color.Black.copy(alpha = .22f); else -> Color.Transparent }
                                    val fg = when (kind) { '+' -> Color(0xFFFFF6EC); '-', 'h' -> Kata.urushiComment; else -> Kata.urushiText }
                                    Text(buildAnnotatedString {
                                        withStyle(SpanStyle(color = if (kind == '+') Kata.urushiString else Kata.urushiComment, fontWeight = FontWeight.Bold)) { append(when (kind) { '+' -> "+ "; '-' -> "− "; else -> "  " }) }
                                        append(if (kind == 'h') line else line.drop(1).ifEmpty { " " })
                                    }, fontFamily = mono, fontSize = 12.sp, color = fg, softWrap = false, modifier = Modifier.fillMaxWidth().background(bg).padding(horizontal = 10.dp))
                                }
                                }
                            }
                        }
                    }
                }
                if (c.truncated) item { Text("The rest is too long to show here.", color = MaterialTheme.colorScheme.onSurfaceVariant) }
            }
        }
    }
}

/* ── the little Markdown an agent writes ── */

@Composable
private fun Lacquer(text: String, modifier: Modifier = Modifier) {
    Box(modifier.fillMaxWidth().background(Kata.urushi, RoundedCornerShape(2.dp)).horizontalScroll(rememberScrollState()).padding(horizontal = 12.dp, vertical = 10.dp)) {
        Text(text, fontFamily = mono, fontSize = 12.sp, color = Kata.urushiText, softWrap = false)
    }
}

private fun inline(text: String, codeBg: Color): AnnotatedString = buildAnnotatedString {
    val pattern = Regex("(`[^`\\n]+`)|(\\*\\*[^*\\n]+\\*\\*)|(\\*[^*\\n]+\\*|_[^_\\n]+_)|(\\[([^\\]\\n]+)\\]\\((https?://[^)\\s]+)\\))")
    var last = 0
    for (m in pattern.findAll(text)) {
        append(text.substring(last, m.range.first))
        when {
            m.groups[1] != null -> withStyle(SpanStyle(fontFamily = FontFamily.Monospace, background = codeBg, fontSize = 13.sp)) { append(m.value.drop(1).dropLast(1)) }
            m.groups[2] != null -> withStyle(SpanStyle(fontWeight = FontWeight.SemiBold)) { append(m.value.drop(2).dropLast(2)) }
            m.groups[3] != null -> withStyle(SpanStyle(fontStyle = androidx.compose.ui.text.font.FontStyle.Italic)) { append(m.value.drop(1).dropLast(1)) }
            m.groups[4] != null -> withStyle(SpanStyle(fontWeight = FontWeight.SemiBold, textDecoration = androidx.compose.ui.text.style.TextDecoration.Underline)) { append(m.groups[5]!!.value) }
        }
        last = m.range.last + 1
    }
    append(text.substring(last))
}

@Composable
private fun Markdown(source: String) {
    val lines = remember(source) { source.replace("\r\n", "\n").split('\n') }
    val style = MaterialTheme.typography.bodyLarge.copy(color = Kata.ink)
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        var i = 0
        while (i < lines.size) {
            val line = lines[i]
            val fence = Regex("^\\s*(```|~~~)").find(line)
            when {
                fence != null -> {
                    val body = mutableListOf<String>()
                    i++
                    while (i < lines.size && !lines[i].trimStart().startsWith(fence.groupValues[1])) body += lines[i++]
                    i++
                    Lacquer(body.joinToString("\n"))
                }
                line.isBlank() -> i++
                Regex("^#{1,4}\\s+").containsMatchIn(line) -> { Text(inline(line.replace(Regex("^#{1,4}\\s+"), ""), Kata.fold), style = MaterialTheme.typography.titleSmall.copy(color = Kata.ink)); i++ }
                Regex("^\\s*([-*+]|\\d+[.)])\\s+").containsMatchIn(line) -> {
                    val ordered = Regex("^\\s*\\d+[.)]\\s+").containsMatchIn(line)
                    var n = 1
                    while (i < lines.size && Regex("^\\s*([-*+]|\\d+[.)])\\s+").containsMatchIn(lines[i])) {
                        val item = lines[i].replace(Regex("^\\s*([-*+]|\\d+[.)])\\s+"), "")
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Text(if (ordered) "${n}." else "•", style = style)
                            Text(inline(item, Kata.fold), style = style)
                        }
                        n++; i++
                    }
                }
                else -> {
                    val body = mutableListOf<String>()
                    while (i < lines.size && lines[i].isNotBlank() && !Regex("^(#{1,4}\\s|\\s*```|\\s*~~~|\\s*[-*+]\\s+|\\s*\\d+[.)]\\s+)").containsMatchIn(lines[i])) body += lines[i++]
                    Text(inline(body.joinToString("\n"), Kata.fold), style = style)
                }
            }
        }
    }
}

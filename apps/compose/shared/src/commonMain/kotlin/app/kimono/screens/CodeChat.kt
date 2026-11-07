@file:OptIn(ExperimentalMaterial3Api::class, ExperimentalMaterial3ExpressiveApi::class, androidx.compose.foundation.layout.ExperimentalLayoutApi::class)

package app.kimono.screens

import kotlin.math.roundToInt
import androidx.compose.foundation.combinedClickable
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.TextStyle
import androidx.compose.foundation.text.appendInlineContent
import androidx.compose.foundation.isSystemInDarkTheme
import com.hrm.latex.renderer.Latex
import com.hrm.latex.renderer.model.LatexConfig
import com.hrm.latex.renderer.model.LatexTheme
import com.hrm.latex.renderer.model.LatexThemeColors
import com.hrm.latex.renderer.measure.rememberLatexMeasurer
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
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
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.Stable
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
import androidx.compose.animation.togetherWith
import androidx.compose.animation.core.animateFloat
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.draw.drawBehind
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.key
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.text.withLink
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import app.kimono.data.AppStatus
import app.kimono.data.Code
import app.kimono.data.CodeAttachment
import app.kimono.data.CodeChanges
import app.kimono.data.CodeEntry
import app.kimono.data.CodeEvent
import app.kimono.data.CodeProject
import app.kimono.data.CodeWorkspace
import app.kimono.data.ContextUse
import app.kimono.data.Drive
import app.kimono.data.DriveFolder
import app.kimono.data.DriveNode
import app.kimono.data.DriveSpace
import app.kimono.data.KimonoProblem
import app.kimono.data.ShownMeters
import app.kimono.data.Platform
import app.kimono.data.SandboxStatus
import app.kimono.data.StoredCodeEvent
import app.kimono.data.Usage
import app.kimono.data.elapsedText
import app.kimono.data.gigabytes
import app.kimono.data.kTokens
import app.kimono.data.modelNames
import app.kimono.data.percent
import app.kimono.data.readableSize
import app.kimono.theme.Kata
import app.kimono.ui.CodeView
import app.kimono.ui.InkCrest
import app.kimono.ui.InkDot
import app.kimono.ui.InkBlot
import app.kimono.ui.InkLoader
import app.kimono.ui.MarkdownView
import app.kimono.ui.Problem
import app.kimono.ui.Seal
import app.kimono.ui.SealTone
import app.kimono.ui.Urushi
import app.kimono.ui.isMarkdown
import app.kimono.ui.kimonoIcon
import app.kimono.ui.segmentColors
import coil3.compose.AsyncImage
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.io.buffered
import kotlinx.io.files.Path
import kotlinx.io.files.SystemFileSystem

/*
 * 工 One Kimono AI chat on the phone: the conversation, streamed while it is
 * on screen with what it is writing as it writes, and the message box. A
 * chat that builds something (a project, or one running an app) also has its
 * files, its changes and its app.
 */

/** What it is writing right now: never kept, only sent while it writes. */
@Stable
internal class Drafts {
    var text by mutableStateOf<String?>(null)
    val artifacts = mutableStateMapOf<String, Pair<String, String>>()
    var now by mutableStateOf<CodeEvent.Phase?>(null)
    fun clear() { text = null; artifacts.clear(); now = null }
}

@Composable
fun WorkspaceScreen(code: Code, drive: Drive, platform: Platform, id: String, showApp: Boolean = false, open: (String) -> Unit, back: () -> Unit) {
    val scope = rememberCoroutineScope()
    var workspace by remember { mutableStateOf(code.knownWorkspaces()?.firstOrNull { it.id == id }) }
    val events = remember { mutableStateListOf<StoredCodeEvent>() }
    val drafts = remember { Drafts() }
    var connected by remember { mutableStateOf(true) }
    var gone by remember { mutableStateOf(false) }
    var problem by remember { mutableStateOf<String?>(null) }
    var tab by remember { mutableStateOf(if (showApp) "app" else code.recall("tab:$id") ?: "chat") }
    LaunchedEffect(tab) { if (!showApp) code.keep("tab:$id", tab.takeIf { it != "chat" }) }
    var projects by remember { mutableStateOf<List<CodeProject>>(emptyList()) }
    LaunchedEffect(Unit) { projects = runCatching { code.projects() }.getOrDefault(emptyList()) }
    val marks = rememberAiMarks(drive)

    fun refresh() = scope.launch { runCatching { code.workspace(id) }.onSuccess { workspace = it } }
    fun take(stored: StoredCodeEvent) {
        val e = stored.event
        if (stored.seq == 0L) {
            when (e) {
                is CodeEvent.Draft -> drafts.text = e.text
                is CodeEvent.ArtifactDraft -> drafts.artifacts[e.name] = e.id to e.content
                is CodeEvent.Phase -> drafts.now = e
                is CodeEvent.Renamed -> refresh()
                /* A message was changed: the chat from it on went, and runs again from there. */
                is CodeEvent.Rewound -> { events.removeAll { it.seq >= e.seq }; drafts.clear(); refresh() }
                else -> {}
            }
            return
        }
        if (stored.seq <= (events.lastOrNull()?.seq ?: 0)) return
        when (e) {
            is CodeEvent.Say, is CodeEvent.Tool, is CodeEvent.Artifact -> drafts.text = null
            is CodeEvent.ArtifactKept -> drafts.artifacts.remove(e.name)
            is CodeEvent.Done -> drafts.clear()
            else -> {}
        }
        events += stored
        if (e is CodeEvent.Done || e is CodeEvent.Ask || e is CodeEvent.Published || e is CodeEvent.Preview || e is CodeEvent.PreviewStopped) refresh()
    }

    /* The timeline: streamed while on screen; asked for instead when the stream can't be held. */
    WhileShown(id) {
        while (true) {
            try {
                workspace = code.workspace(id)
                problem = null
                connected = true
                code.stream(id, events.lastOrNull()?.seq ?: 0) { take(it) }
            } catch (cancel: CancellationException) { throw cancel } catch (p: KimonoProblem) {
                if (p.message?.contains("isn't here", ignoreCase = true) == true || p.message?.contains("not found", ignoreCase = true) == true) gone = true
                connected = false
                try {
                    val (now, fresh) = code.events(id, events.lastOrNull()?.seq ?: 0)
                    workspace = now
                    fresh.forEach { take(it) }
                    problem = null
                } catch (again: KimonoProblem) { problem = again.message }
            }
            delay(if (workspace?.running == true) 1000 else 2500)
        }
    }

    val w = workspace
    val time = ticking(w?.running == true)
    var renaming by remember { mutableStateOf(false) }
    var menu by remember { mutableStateOf(false) }
    var moving by remember { mutableStateOf(false) }
    var publishing by remember { mutableStateOf(false) }
    var sharing by remember { mutableStateOf(false) }
    val people = rememberPeople(code)
    /* Someone else's chat, shared with this person: no renaming, moving, sharing, Drive or the app's controls. */
    val owns = w?.isOwner ?: true
    val versions by remember { derivedStateOf { events.mapNotNull { (it.event as? CodeEvent.ArtifactKept) }.associate { it.name to (it.version to it.title) } } }
    val artifacts = remember(id) { Artifacts(id) }
    artifacts.versions = versions
    artifacts.drafts = drafts.artifacts
    artifacts.canShare = owns
    val tabs = when {
        w == null || !w.isApp -> listOf("chat")
        w.isProject -> listOf("chat", "files", "changes") + if (owns) listOf("app") else emptyList()
        else -> listOf("chat", "files") + if (owns) listOf("app") else emptyList()
    }
    val shownTab = if (tab in tabs) tab else "chat"
    Scaffold(
        /* The composer keeps itself above the home indicator and the keyboard: the screen adds nothing below. */
        contentWindowInsets = androidx.compose.foundation.layout.WindowInsets(0, 0, 0, 0),
        containerColor = MaterialTheme.colorScheme.surface,
        topBar = {
            TopAppBar(
                title = {
                    Column(Modifier.clip(RoundedCornerShape(10.dp)).clickable(enabled = w != null && owns) { renaming = true }) {
                        Text(w?.title ?: "", style = MaterialTheme.typography.titleMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        val under = when {
                            w == null -> null
                            !connected -> "Reconnecting…"
                            !owns -> "Shared by ${people.nameOf(w.owner)}"
                            w.isApp && w.running -> "Working ${elapsedText(time - w.turn!!.startedAt)}"
                            w.isProject -> "${w.repo.name} · ${w.branch}"
                            w.folder != null -> w.folder.name
                            else -> null
                        }
                        if (under != null) Text(under, fontFamily = if (w?.isProject == true && owns && connected && !(w.running)) mono else null, fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                },
                navigationIcon = {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        IconButton(onClick = back) { Icon(kimonoIcon("back"), "Back") }
                        AiMark(code, 30.dp)
                    }
                },
                actions = {
                    if (w?.preview != null && !w.preview.stopped) IconButton(onClick = { platform.openUrl(w.preview.url) }) { Icon(kimonoIcon("out"), "Open app") }
                    if (w?.drive != null && owns) IconButton(onClick = { open("folder/${w.drive.folderId}") }) { Icon(kimonoIcon("folder"), "Open in Drive") }
                    if (owns || w?.pullRequest != null) Box {
                        IconButton(onClick = { menu = true }) { Icon(kimonoIcon("more"), "More") }
                        DropdownMenu(expanded = menu, onDismissRequest = { menu = false }, shape = MaterialTheme.shapes.large) {
                            if (owns && w != null) DropdownMenuItem(text = { Text("Share") }, leadingIcon = { Icon(kimonoIcon("share"), null, modifier = Modifier.size(18.dp)) }, onClick = { menu = false; sharing = true })
                            if (owns) DropdownMenuItem(text = { Text("Rename") }, leadingIcon = { Icon(kimonoIcon("edit"), null, modifier = Modifier.size(18.dp)) }, onClick = { menu = false; renaming = true })
                            if (owns && w != null && !w.isProject && projects.isNotEmpty()) DropdownMenuItem(text = { Text(if (w.folder == null) "Put in a project" else "Move to another project") }, leadingIcon = { Icon(kimonoIcon("move"), null, modifier = Modifier.size(18.dp)) }, onClick = { menu = false; moving = true })
                            if (w?.pullRequest != null) DropdownMenuItem(text = { Text("Pull request #${w.pullRequest.number}") }, leadingIcon = { Icon(kimonoIcon("pr"), null, modifier = Modifier.size(18.dp)) }, onClick = { menu = false; platform.openUrl(w.pullRequest.url) })
                        }
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.surface),
            )
        },
    ) { padding ->
        Column(Modifier.padding(padding).fillMaxSize()) {
            if (w != null && tabs.size > 1) {
                SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp)) {
                    tabs.forEachIndexed { index, t ->
                        SegmentedButton(selected = shownTab == t, onClick = { tab = t }, shape = SegmentedButtonDefaults.itemShape(index, tabs.size)) {
                            Text(mapOf("chat" to "Chat", "files" to "Files", "changes" to "Changes", "app" to "App").getValue(t))
                        }
                    }
                }
                /* A project's one strong action: publish what it changed. */
                if (w.isProject && owns) Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                    if (w.pullRequest != null) TextButton(onClick = { platform.openUrl(w.pullRequest.url) }) { Icon(kimonoIcon("pr"), null, modifier = Modifier.size(16.dp)); Spacer(Modifier.width(6.dp)); Text("Pull request #${w.pullRequest.number}") }
                    Spacer(Modifier.weight(1f))
                    Seal(if (w.pullRequest != null) "Push changes" else "Open pull request", compact = true, busy = publishing, enabled = !w.running, tone = if (w.pullRequest != null) SealTone.Quiet else SealTone.Primary, onClick = {
                        publishing = true
                        scope.launch { try { workspace = code.publish(id, w.title); problem = null } catch (p: KimonoProblem) { problem = p.message }; publishing = false }
                    })
                }
            }
            if (problem != null && !gone) Box(Modifier.padding(horizontal = 20.dp, vertical = 4.dp)) { Problem(problem) }
            Box(Modifier.weight(1f).fillMaxWidth()) {
                when {
                    gone && w == null -> Column(Modifier.fillMaxSize().padding(32.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
                        Text("That chat isn’t here any more.", style = MaterialTheme.typography.bodyLarge)
                        Spacer(Modifier.size(16.dp))
                        Seal("New chat", tone = SealTone.Quiet, onClick = { open("ai/new") })
                    }
                    w == null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { InkLoader() }
                    shownTab == "files" -> Files(code, platform, w)
                    shownTab == "changes" -> Changes(code, w, events.lastOrNull()?.seq ?: 0)
                    shownTab == "app" -> AppTab(code, platform, w, goChat = { tab = "chat" }) { workspace = it }
                    else -> Chat(code, drive, platform, marks, artifacts, people, w, events, drafts, open)
                }
            }
        }
    }
    if (sharing && w != null) ChatShareSheet(code, platform, w) { sharing = false }
    if (renaming && w != null) NameDialog(title = "Rename chat", action = "Rename", initial = w.title, onDismiss = { renaming = false }) { name ->
        val title = name.replace(Regex("\\s+"), " ").take(120)
        if (title != w.title) workspace = code.rename(id, title)
        renaming = false
    }
    if (moving && w != null) AlertDialog(
        onDismissRequest = { moving = false },
        title = { Text("Project") },
        text = {
            Column {
                (listOf<CodeProject?>(null) + projects).forEach { p ->
                    Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).clickable {
                        moving = false
                        scope.launch { try { workspace = code.moveChat(id, p?.id) } catch (e: KimonoProblem) { problem = e.message } }
                    }.padding(horizontal = 8.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        Icon(kimonoIcon(if (p == null) "close" else "folder"), null, modifier = Modifier.size(18.dp))
                        Text(p?.name ?: "No project", modifier = Modifier.weight(1f))
                        if (w.folder?.id == p?.id) Icon(kimonoIcon("check"), null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(18.dp))
                    }
                }
            }
        },
        confirmButton = { TextButton(onClick = { moving = false }) { Text("Close") } },
    )
}

/* ── the timeline, as the reader sees it ── */

private class ToolCall(val event: CodeEvent.Tool) { var result by mutableStateOf<CodeEvent.ToolResult?>(null) }

private sealed interface Item {
    val key: Long
    data class Ask(override val key: Long, val event: CodeEvent.Ask) : Item
    data class Say(override val key: Long, val text: String) : Item
    data class Tools(override val key: Long, val calls: MutableList<ToolCall>) : Item
    data class Done(override val key: Long, val event: CodeEvent.Done) : Item
    data class Plain(override val key: Long, val event: CodeEvent) : Item
    data class Shots(override val key: Long, val shots: MutableList<CodeEvent.Image>) : Item
    data class Access(override val key: Long, val event: CodeEvent.Access, val answer: CodeEvent.AccessAnswer?) : Item
}

/** Consecutive tool calls fold into one group, each call paired with its result; pictures in a row together. */
private fun itemsOf(events: List<StoredCodeEvent>): List<Item> {
    val items = mutableListOf<Item>()
    val calls = mutableMapOf<String, ToolCall>()
    val answers = events.mapNotNull { it.event as? CodeEvent.AccessAnswer }.associateBy { it.id }
    for (stored in events) {
        val last = items.lastOrNull()
        when (val e = stored.event) {
            is CodeEvent.Ask -> items += Item.Ask(stored.seq, e)
            is CodeEvent.Say -> items += Item.Say(stored.seq, e.text)
            is CodeEvent.Tool -> {
                val call = ToolCall(e).also { calls[e.id] = it }
                if (last is Item.Tools) last.calls += call else items += Item.Tools(stored.seq, mutableListOf(call))
            }
            is CodeEvent.ToolResult -> calls[e.id]?.result = e
            is CodeEvent.Done -> items += Item.Done(stored.seq, e)
            is CodeEvent.Image -> if (last is Item.Shots) last.shots += e else items += Item.Shots(stored.seq, mutableListOf(e))
            is CodeEvent.Access -> items += Item.Access(stored.seq, e, answers[e.id])
            is CodeEvent.Published, is CodeEvent.Preview, CodeEvent.PreviewStopped, is CodeEvent.Slept, is CodeEvent.Disk, is CodeEvent.Compacted,
            is CodeEvent.Remembered, is CodeEvent.Artifact, is CodeEvent.Connect, is CodeEvent.Sent -> items += Item.Plain(stored.seq, e)
            else -> {}
        }
    }
    return items
}

@Composable
private fun Chat(code: Code, drive: Drive, platform: Platform, marks: AiMarks, artifacts: Artifacts, people: Map<String, app.kimono.data.Person>, w: CodeWorkspace, events: List<StoredCodeEvent>, drafts: Drafts, open: (String) -> Unit) {
    val items = remember(events.size) { itemsOf(events) }
    /* Where you were in it: the end (following along), or a place you scrolled back to. */
    val savedScroll = remember(w.id) { code.recall("scroll:${w.id}")?.split(',')?.mapNotNull { it.toIntOrNull() }?.takeIf { it.size == 2 } }
    val list = rememberLazyListState()
    val scope = rememberCoroutineScope()
    /* An artifact still being written has no place in the timeline yet: it is drawn at the end until its call lands. */
    val placed = items.mapNotNull { ((it as? Item.Plain)?.event as? CodeEvent.Artifact)?.id }.toSet()
    val writing = drafts.artifacts.entries.filter { it.value.first !in placed }.map { it.key }
    /* Follows it while you're at the bottom; leaves you alone once you scroll up. */
    val atBottom by remember { derivedStateOf { val info = list.layoutInfo; val last = info.visibleItemsInfo.lastOrNull(); last == null || last.index >= info.totalItemsCount - 1 } }
    var following by remember { mutableStateOf(savedScroll == null) }
    LaunchedEffect(atBottom) { if (atBottom) following = true else if (list.isScrollInProgress) following = false }
    /* Back to the saved place once the timeline is long enough to have it. */
    var restored by remember(w.id) { mutableStateOf(savedScroll == null) }
    LaunchedEffect(items.size) {
        val at = savedScroll ?: return@LaunchedEffect
        if (!restored && items.size > at[0]) { list.scrollToItem(at[0], at[1]); restored = true }
    }
    LaunchedEffect(list, restored) {
        if (!restored) return@LaunchedEffect
        androidx.compose.runtime.snapshotFlow { Triple(list.isScrollInProgress, list.firstVisibleItemIndex, list.firstVisibleItemScrollOffset) }.collect { (moving, index, offset) ->
            if (!moving) code.keep("scroll:${w.id}", if (following) null else "$index,$offset")
        }
    }
    val total = items.size + writing.size + 2
    LaunchedEffect(items.size, writing.size, drafts.text?.length?.div(80), w.running) { if (following && total > 0) list.animateScrollToItem(total - 1) }
    /* Only the turn under way may hold a group open. */
    val lastAsk = items.indexOfLast { it is Item.Ask }
    val lastTools = items.drop(lastAsk + 1).lastOrNull { it is Item.Tools }
    val lastPreview = items.lastOrNull { (it as? Item.Plain)?.event is CodeEvent.Preview }?.key
    val lastContext = items.lastOrNull { it is Item.Done && it.event.context != null }?.let { (it as Item.Done).event.context }
    var viewing by remember { mutableStateOf<Pair<List<CodeEvent.Image>, Int>?>(null) }
    Column(Modifier.fillMaxSize()) {
        Box(Modifier.weight(1f).fillMaxWidth()) {
            LazyColumn(state = list, contentPadding = PaddingValues(horizontal = 16.dp, vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(12.dp), modifier = Modifier.fillMaxSize()) {
                if (items.isEmpty() && !w.running) item(key = "empty") { Box(Modifier.fillMaxWidth().padding(40.dp), contentAlignment = Alignment.Center) { InkLoader() } }
                items(items, key = { it.key }) { item ->
                    when (item) {
                        is Item.Ask -> AskBubble(code, platform, people, w, item.event, seq = item.key)
                        is Item.Say -> Markdown(item.text)
                        is Item.Tools -> ToolGroup(code, marks, item.calls, live = w.running && item === lastTools, open)
                        is Item.Done -> DoneNote(item.event)
                        is Item.Shots -> ShotGallery(code, w, item.shots) { at -> viewing = item.shots.toList() to at }
                        is Item.Access -> AccessCard(code, drive, marks, people, w, item.event, item.answer, open)
                        is Item.Plain -> when (val e = item.event) {
                            is CodeEvent.Preview -> if (w.running && w.preview?.url == e.url && item.key == lastPreview) PreviewCard(code, platform, w, e.url, ready = false)
                                else Note("link", "The app ran at ${e.host}")
                            CodeEvent.PreviewStopped -> Note("link", "The app’s link was taken down.")
                            is CodeEvent.Slept -> Note("restart", "Put to sleep to make room for “${e.forTitle}”. It wakes when you open it.")
                            is CodeEvent.Disk -> Note("close", if (e.full) "Stopped: this chat's files took ${gigabytes(e.used)}, past its ${gigabytes(e.quota)}. Its app was stopped too. Ask it to free some space."
                                else "This chat's files take ${gigabytes(e.used)} of its ${gigabytes(e.quota)}. It was asked to free some space first.", failed = true)
                            is CodeEvent.Compacted -> Note("diff", "Compacted the conversation${e.before?.let { " · it held ${kTokens(it)} tokens" } ?: ""}")
                            is CodeEvent.Remembered -> Note("chat", "${when (e.how) { "forgot" -> "Forgot"; "changed" -> "Now remembers"; else -> "Remembered" }}: ${e.text}", trailing = { TextLink("Memory") { open("ai/memory") } })
                            is CodeEvent.Published -> Note("pr", "Opened pull request #${e.number}", trailing = { TextLink("Open") { platform.openUrl(e.url) } })
                            is CodeEvent.Connect -> ConnectCard(code, platform, e.app, e.url, waitingFor = if (w.isOwner) null else people.nameOf(w.owner))
                            is CodeEvent.Sent -> Column(verticalArrangement = Arrangement.spacedBy(8.dp)) { e.files.forEach { SentFile(code, platform, w, it) } }
                            is CodeEvent.Artifact -> if (e.action == "edited") ArtifactChanged(artifacts, code, e.name) else ArtifactCard(code, platform, artifacts, e.name)
                            else -> {}
                        }
                    }
                }
                items(writing, key = { "writing-${drafts.artifacts[it]?.first ?: it}" }) { name -> ArtifactCard(code, platform, artifacts, name) }
                item(key = "draft") { drafts.text?.let { Box(Modifier.alpha(.75f)) { Markdown(it) } } }
                item(key = "tail") {
                    when {
                        /* Not while the reply's own words are coming in: those show it's working. */
                        w.running && (drafts.text.isNullOrBlank() && drafts.now?.phase != "writing") -> Working(code, marks, w.turn?.startedAt, drafts.now, artifact = drafts.artifacts.isNotEmpty())
                        w.running -> Spacer(Modifier.size(1.dp))
                        w.preview != null && !w.preview.stopped && items.lastOrNull() !is Item.Ask -> PreviewCard(code, platform, w, w.preview.url, ready = true)
                        else -> Spacer(Modifier.size(1.dp))
                    }
                }
            }
            if (!atBottom && !following) Surface(
                onClick = { following = true; scope.launch { list.animateScrollToItem(total - 1) } },
                shape = CircleShape, color = MaterialTheme.colorScheme.secondaryContainer, shadowElevation = 2.dp,
                modifier = Modifier.align(Alignment.BottomCenter).padding(bottom = 12.dp),
            ) { Text("Latest ↓", style = MaterialTheme.typography.labelLarge, modifier = Modifier.padding(horizontal = 16.dp, vertical = 9.dp)) }
        }
        if (w.canWrite) Composer(code, drive, platform, marks, w, lastContext)
        else Text("You can view this chat", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.surface).navigationBarsPadding().padding(horizontal = 24.dp, vertical = 16.dp))
    }
    viewing?.let { (shots, at) -> ShotViewer(code, w, shots, at) { viewing = null } }
    artifacts.full?.let { name -> ArtifactFull(code, platform, artifacts, name) }
}

/** Working, at the end of the conversation: what it's doing, in its own words and ink, and how long. */
@Composable
private fun Working(code: Code, marks: AiMarks, since: Long?, doing: CodeEvent.Phase?, artifact: Boolean) {
    val time = ticking(true)
    val phase = if (artifact || doing?.phase == "artifact") "artifact" else doing?.phase ?: "working"
    val appName = doing?.app?.let { AppName(code, it) }
    val words = when (phase) {
        "artifact" -> "Working my magic"
        "thinking" -> "Thinking"
        "writing" -> "Writing"
        "tools" -> when {
            appName != null -> "Using $appName"
            doing?.space != null -> "Looking in ${doing.space}"
            doing?.tool == "web" -> "Searching the web"
            doing?.tool == "command" -> "Running a command"
            doing?.tool == "files" -> "Going through files"
            doing?.tool == "helper" -> "Asking a helper"
            else -> "Using tools"
        }
        else -> "Working"
    }
    val seal = if (phase == "tools") doing?.app ?: doing?.space?.let { "space:$it" } else null
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.padding(vertical = 4.dp).semantics(mergeDescendants = true) { }) {
        Box(Modifier.size(26.dp), contentAlignment = Alignment.Center) {
            if (seal != null) key(seal) { NowSeal { if (doing?.app != null) AppLogo(code, doing.app, 16.dp) else DriveMark(marks, 16.dp) } }
            else {
                CompositionLocalProvider(app.kimono.ui.LocalInkTint provides when (phase) { "thinking" -> thinkingInk; "artifact" -> null; else -> app.kimono.ui.LocalInkTint.current }) { InkLoader(size = 22.dp) }
                if (phase == "artifact") InkSparks()
            }
        }
        androidx.compose.animation.AnimatedContent(
            targetState = phase to words,
            transitionSpec = { (androidx.compose.animation.fadeIn(androidx.compose.animation.core.tween(240)) + androidx.compose.animation.slideInVertically { it / 4 }) togetherWith androidx.compose.animation.fadeOut(androidx.compose.animation.core.tween(120)) },
            label = "now",
        ) { (p, w) -> NowWords(p, w) }
        since?.let { Text(elapsedText(time - it), style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = .7f)) }
    }
}

/* Thinking is the working ink, a little toward ai (indigo). */
private val thinkingInk = Color(0xFF6A7596)

/** Its words: thinking comes in letter by letter like ink taking; the magic rises in suō over a brush stroke; writing has a brush tip. */
@Composable
private fun NowWords(phase: String, words: String) {
    val style = MaterialTheme.typography.labelLarge
    val base = MaterialTheme.colorScheme.onSurfaceVariant
    when (phase) {
        "thinking", "artifact" -> {
            val magic = phase == "artifact"
            val wave = androidx.compose.animation.core.rememberInfiniteTransition(label = "ink")
            val t by wave.animateFloat(0f, 1f, androidx.compose.animation.core.infiniteRepeatable(androidx.compose.animation.core.tween(if (magic) 1700 else 1900, easing = androidx.compose.animation.core.LinearEasing)), label = "t")
            val stroke by wave.animateFloat(0f, 1f, androidx.compose.animation.core.infiniteRepeatable(androidx.compose.animation.core.tween(2200, easing = androidx.compose.animation.core.LinearEasing)), label = "stroke")
            val ink = if (magic) Kata.suoDeep else base
            val text = buildAnnotatedString {
                words.forEachIndexed { i, c ->
                    /* Each letter's own moment in the wave. */
                    val at = ((t - i * (if (magic) .032f else .045f)) % 1f + 1f) % 1f
                    val bump = if (at < .4f) kotlin.math.sin(at / .4f * kotlin.math.PI).toFloat() else 0f
                    withStyle(SpanStyle(
                        color = ink.copy(alpha = if (magic) 1f - .3f * bump else .34f + .66f * bump),
                        baselineShift = if (magic) androidx.compose.ui.text.style.BaselineShift(.18f * bump) else null,
                    )) { append(c) }
                }
            }
            Text(text, style = style, modifier = if (!magic) Modifier else Modifier.drawBehind {
                val drawn = (stroke / .55f).coerceAtMost(1f)
                val fade = if (stroke < .85f) .55f else .55f * (1f - (stroke - .85f) / .15f)
                drawLine(Kata.suo.copy(alpha = fade), androidx.compose.ui.geometry.Offset(0f, size.height + 3.dp.toPx()), androidx.compose.ui.geometry.Offset(size.width * drawn, size.height + 3.dp.toPx()), strokeWidth = 2.dp.toPx(), cap = androidx.compose.ui.graphics.StrokeCap.Round)
            })
        }
        "writing" -> Row(verticalAlignment = Alignment.CenterVertically) {
            Text(words, style = style, color = base)
            val tip = androidx.compose.animation.core.rememberInfiniteTransition(label = "tip")
            val a by tip.animateFloat(1f, .15f, androidx.compose.animation.core.infiniteRepeatable(androidx.compose.animation.core.tween(500), androidx.compose.animation.core.RepeatMode.Reverse), label = "a")
            Box(Modifier.padding(start = 4.dp).size(2.dp, 14.dp).alpha(a).background(base, RoundedCornerShape(1.dp, 1.dp, 2.dp, 2.dp)))
        }
        else -> Text(words, style = style, color = base)
    }
}

/** A tool's app logo or Drive's mark, pressed in like a seal, then breathing with a ring while it works. */
@Composable
private fun NowSeal(content: @Composable () -> Unit) {
    val press = remember { androidx.compose.animation.core.Animatable(0f) }
    LaunchedEffect(Unit) { press.animateTo(1f, androidx.compose.animation.core.spring(dampingRatio = .45f, stiffness = 420f)) }
    val breath = androidx.compose.animation.core.rememberInfiniteTransition(label = "seal")
    val b by breath.animateFloat(0f, 1f, androidx.compose.animation.core.infiniteRepeatable(androidx.compose.animation.core.tween(2600, easing = androidx.compose.animation.core.LinearEasing)), label = "b")
    val ring = MaterialTheme.colorScheme.onSurfaceVariant
    val p = press.value
    Box(
        Modifier.size(24.dp)
            .drawBehind {
                if (p < .99f) return@drawBehind
                val r = (b / .7f).coerceAtMost(1f)
                drawRoundRect(ring.copy(alpha = .45f * (1f - r)), topLeft = androidx.compose.ui.geometry.Offset(-size.width * .12f * r, -size.height * .12f * r),
                    size = androidx.compose.ui.geometry.Size(size.width * (1 + .24f * r), size.height * (1 + .24f * r)),
                    cornerRadius = androidx.compose.ui.geometry.CornerRadius(10.dp.toPx()), style = androidx.compose.ui.graphics.drawscope.Stroke(1.5.dp.toPx()))
            }
            .graphicsLayer {
                val breathe = 1f - .07f * kotlin.math.sin(b * kotlin.math.PI).toFloat()
                val s = (1.5f - .5f * p) * breathe
                scaleX = s; scaleY = s; rotationZ = -12f * (1f - p); alpha = p.coerceIn(0f, 1f)
            }
            .background(MaterialTheme.colorScheme.surfaceContainerHigh, RoundedCornerShape(8.dp)),
        contentAlignment = Alignment.Center,
    ) { content() }
}

/** Three suō sparks flying off the shape while it works its magic. */
@Composable
private fun InkSparks() {
    val sparks = androidx.compose.animation.core.rememberInfiniteTransition(label = "sparks")
    val t by sparks.animateFloat(0f, 1f, androidx.compose.animation.core.infiniteRepeatable(androidx.compose.animation.core.tween(1800, easing = androidx.compose.animation.core.LinearEasing)), label = "t")
    androidx.compose.foundation.Canvas(Modifier.size(26.dp)) {
        val c = center
        listOf(Triple(13f, -12f, 0f), Triple(-12f, -10f, .33f), Triple(4f, 14f, .66f)).forEach { (x, y, delay) ->
            val at = ((t - delay) % 1f + 1f) % 1f
            val alpha = if (at < .2f) at / .2f * .9f else .9f * (1f - (at - .2f) / .8f)
            drawCircle(Kata.suo.copy(alpha = alpha), radius = (.8f + 1.2f * at).dp.toPx(), center = androidx.compose.ui.geometry.Offset(c.x + x.dp.toPx() * at, c.y + y.dp.toPx() * at))
        }
    }
}

/* ── what someone asked ── */

@Composable
private fun AskBubble(code: Code, platform: Platform, people: Map<String, app.kimono.data.Person>, w: CodeWorkspace, ask: CodeEvent.Ask, seq: Long) {
    /* Someone else's message: who sent it, by name and face. */
    val other = ask.by.takeIf { it.isNotBlank() && !it.equals(code.me ?: w.owner, ignoreCase = true) }
    if (ask.text.trim() == "/compact" && ask.attachments.isEmpty()) { Note("diff", "${other?.let { people.nameOf(it) } ?: "You"} asked it to compact the conversation${if (ask.queued) " after this step" else ""}"); return }
    var opened by remember { mutableStateOf<CodeAttachment?>(null) }
    /* Your own message, while it isn't working: a long press changes it, and it runs again from there. */
    val editable = other == null && !ask.queued && !w.running && w.canWrite
    var editing by remember { mutableStateOf<String?>(null) }
    var saving by remember { mutableStateOf(false) }
    var problem by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    val haptics = LocalHapticFeedback.current
    editing?.let { draft ->
        Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.End) {
            Column(
                Modifier.widthIn(max = 340.dp).fillMaxWidth().background(MaterialTheme.colorScheme.secondaryContainer, RoundedCornerShape(24.dp, 24.dp, 8.dp, 24.dp))
                    .border(2.dp, MaterialTheme.colorScheme.primary, RoundedCornerShape(24.dp, 24.dp, 8.dp, 24.dp)).padding(horizontal = 16.dp, vertical = 12.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                val focus = remember { FocusRequester() }
                LaunchedEffect(Unit) { focus.requestFocus() }
                BasicTextField(draft, { editing = it }, Modifier.fillMaxWidth().focusRequester(focus),
                    textStyle = MaterialTheme.typography.bodyLarge.copy(color = MaterialTheme.colorScheme.onSecondaryContainer),
                    cursorBrush = SolidColor(MaterialTheme.colorScheme.primary))
                Text(problem ?: "It answers again from here; what came after goes.", style = MaterialTheme.typography.labelSmall, color = if (problem != null) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSecondaryContainer.copy(alpha = .8f))
                Row(Modifier.align(Alignment.End), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                    Seal("Cancel", compact = true, tone = SealTone.Quiet, onClick = { editing = null })
                    Seal("Send", compact = true, busy = saving, enabled = draft.isNotBlank(), onClick = {
                        val next = draft.trim()
                        if (next == ask.text.trim()) { editing = null; return@Seal }
                        saving = true; problem = null
                        scope.launch {
                            runCatching { code.editAsk(w.id, seq, next) }
                                .onSuccess { editing = null }
                                .onFailure { problem = it.message ?: "Couldn't change it." }
                            saving = false
                        }
                    })
                }
            }
        }
        return
    }
    Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.End) {
        if (other != null) Row(Modifier.padding(bottom = 4.dp, end = 4.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(people.nameOf(other), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            val person = people[other.lowercase()]
            app.kimono.ui.Portrait(person?.picture, person?.name, other, 22.dp)
        }
        Column(
            Modifier.widthIn(max = 320.dp).alpha(if (ask.queued) .72f else 1f).clip(RoundedCornerShape(24.dp, 24.dp, 8.dp, 24.dp))
                .then(if (editable) Modifier.combinedClickable(onClick = {}, onLongClickLabel = "Edit", onLongClick = { haptics.performHapticFeedback(HapticFeedbackType.LongPress); problem = null; editing = ask.text }) else Modifier)
                .background(MaterialTheme.colorScheme.secondaryContainer, RoundedCornerShape(24.dp, 24.dp, 8.dp, 24.dp)).padding(horizontal = 16.dp, vertical = 11.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            if (ask.text.isNotBlank()) Text(ask.text, style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSecondaryContainer)
            if (ask.attachments.isNotEmpty()) Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                ask.attachments.forEach { a ->
                    if (a.isPicture) AttachedPicture(code, w, a, Modifier.clickable { opened = a })
                    else Box(Modifier.clip(RoundedCornerShape(14.dp)).clickable { opened = a }) { FileChip(a.name, readableSize(a.size)) }
                }
            }
        }
        if (ask.queued) Text("Read as soon as the current step ends", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 4.dp, end = 6.dp))
    }
    opened?.let { a -> OpenAttachment(code, platform, w, a) { opened = null } }
}

@Composable
private fun AttachedPicture(code: Code, w: CodeWorkspace, a: CodeAttachment, modifier: Modifier = Modifier) {
    val bytes by produceState<ByteArray?>(null, a.path) { value = runCatching { code.attachment(w.id, a) }.getOrNull() }
    Box(Modifier.size(width = 120.dp, height = 90.dp).clip(RoundedCornerShape(14.dp)).background(MaterialTheme.colorScheme.surfaceContainerHighest).then(modifier)) {
        if (bytes != null) AsyncImage(model = bytes, contentDescription = a.name, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
    }
}

/** Saves [bytes] where the phone's own viewer can open them, and returns the path. */
internal fun cacheFile(platform: Platform, folder: String, name: String, bytes: ByteArray): String {
    val dir = Path(platform.cacheDir(), "ai", folder)
    SystemFileSystem.createDirectories(dir)
    val safe = name.replace(Regex("[/\\\\:]"), "_").ifBlank { "file" }
    val path = Path(dir, safe)
    SystemFileSystem.sink(path).buffered().use { it.write(bytes) }
    return path.toString()
}

/** A file it sent or someone attached, opened: pictures here; anything else in the phone's own viewer, which can save or share it. */
@Composable
private fun OpenAttachment(code: Code, platform: Platform, w: CodeWorkspace, a: CodeAttachment, close: () -> Unit) {
    val result by produceState<Result<ByteArray>?>(null, a.path) { value = runCatching { code.attachment(w.id, a) } }
    val bytes = result
    LaunchedEffect(bytes) {
        val got = bytes?.getOrNull() ?: return@LaunchedEffect
        if (!a.isPicture) { runCatching { platform.openFile(cacheFile(platform, w.id, a.name, got), a.type) }; close() }
    }
    if (a.isPicture || bytes?.isFailure == true || bytes == null) Dialog(onDismissRequest = close, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Column(Modifier.fillMaxSize().background(Kata.ink)) {
            Row(Modifier.fillMaxWidth().statusBarsPadding().padding(horizontal = 8.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(a.name, color = Kata.lift, style = MaterialTheme.typography.bodyMedium, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f).padding(start = 8.dp))
                bytes?.getOrNull()?.let { got -> IconButton(onClick = { runCatching { platform.openFile(cacheFile(platform, w.id, a.name, got), a.type) } }) { Icon(kimonoIcon("download"), "Download", tint = Kata.lift) } }
                IconButton(onClick = close) { Icon(kimonoIcon("close"), "Close", tint = Kata.lift) }
            }
            Box(Modifier.weight(1f).fillMaxWidth().navigationBarsPadding(), contentAlignment = Alignment.Center) {
                when {
                    bytes == null -> InkLoader()
                    bytes.isFailure -> Text(bytes.exceptionOrNull()?.message ?: "That file couldn't be opened.", color = Kata.lift, modifier = Modifier.padding(24.dp))
                    else -> AsyncImage(model = bytes.getOrThrow(), contentDescription = a.name, contentScale = ContentScale.Fit, modifier = Modifier.fillMaxSize())
                }
            }
        }
    }
}

/** What a file is, in a word: "PDF document", "PNG picture". */
private fun fileKind(name: String, type: String): String {
    val ext = name.substringAfterLast('.', "").uppercase().ifEmpty { "FILE" }
    return when {
        type.startsWith("image/") -> "$ext picture"
        type.startsWith("video/") -> "$ext video"
        type.startsWith("audio/") -> "$ext sound"
        type == "application/pdf" -> "PDF document"
        type.startsWith("text/") -> "$ext text"
        ext == "FILE" -> "File"
        else -> "$ext file"
    }
}

/** A file Kimono AI sent: its picture or mark, what it is, and a way to open or keep it. */
@Composable
private fun SentFile(code: Code, platform: Platform, w: CodeWorkspace, file: CodeAttachment) {
    var opening by remember { mutableStateOf(false) }
    Surface(onClick = { opening = true }, shape = RoundedCornerShape(24.dp), color = MaterialTheme.colorScheme.surfaceContainer, modifier = Modifier.fillMaxWidth()) {
        Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            if (file.isPicture) AttachedPicture(code, w, file, Modifier.size(56.dp))
            else Surface(shape = RoundedCornerShape(14.dp), color = MaterialTheme.colorScheme.surfaceContainerHighest, modifier = Modifier.size(56.dp)) {
                Box(contentAlignment = Alignment.Center) { app.kimono.ui.FileTypeMark(file.name, Modifier.size(30.dp)) { Icon(kimonoIcon("file"), null) } }
            }
            Column(Modifier.weight(1f)) {
                Text(file.name, style = MaterialTheme.typography.titleSmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text("${fileKind(file.name, file.type)} · ${readableSize(file.size)}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            IconButton(onClick = { opening = true }) { Icon(kimonoIcon("download"), "Download") }
        }
    }
    if (opening) OpenAttachment(code, platform, w, file) { opening = false }
}

/* ── tool calls ── */

private val toolIcons = mapOf("Read" to "file", "Wrote" to "file", "Edited" to "diff", "Ran" to "code", "Searched for" to "search", "Looked for" to "search", "Fetched" to "link", "Searched the web for" to "search", "Asked a helper" to "chat")

/** A few words on how a call went: how much it read, what it changed, how many matches. */
private fun toolMeta(call: ToolCall): String {
    val result = call.result ?: return "running"
    if (!result.ok) return "failed"
    fun count(text: String) = text.split('\n').count { it.isNotBlank() }
    val change = call.event.change.orEmpty().split('\n')
    val added = change.count { it.startsWith("+ ") }
    val removed = change.count { it.startsWith("- ") }
    return when (call.event.label) {
        "Read" -> "${count(result.output)} lines"
        "Wrote" -> "+$added"
        "Edited" -> "+$added −$removed"
        "Searched for", "Looked for" -> count(result.output).let { if (it > 0) "$it match${if (it == 1) "" else "es"}" else "nothing found" }
        "Ran" -> "done"
        else -> ""
    }
}

/** Tool calls as one line — "Used 5 tools" — open while it's still in them, unless you closed it. */
@Composable
private fun ToolGroup(code: Code, marks: AiMarks, calls: List<ToolCall>, live: Boolean, open: (String) -> Unit) {
    /* Long work the agent said it's doing (kimono-progress): one card with a bar, the steps folded under it. */
    if (calls.any { it.event.progress?.label != null }) { ProgressGroup(code, marks, calls, live, open); return }
    var chosen by remember { mutableStateOf<Boolean?>(null) }
    val shown = chosen ?: live
    val pending = calls.any { it.result == null }
    val failed = calls.count { it.result?.ok == false }
    val touched = calls.filter { it.event.label == "Edited" || it.event.label == "Wrote" }.mapNotNull { it.event.detail }.distinct()
    val apps = calls.mapNotNull { it.event.app }.distinct().take(3)
    val drive = calls.any { it.event.space != null && it.event.app == null }
    Column(Modifier.fillMaxWidth()) {
        Row(Modifier.fillMaxWidth().heightIn(min = 40.dp).clip(RoundedCornerShape(12.dp)).clickable { chosen = !shown }.padding(horizontal = 4.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            when {
                live && pending -> InkLoader(size = 18.dp)
                apps.isEmpty() && !drive -> Icon(kimonoIcon("gear"), null, modifier = Modifier.size(16.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
                else -> Row(horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.CenterVertically) {
                    if (drive) DriveMark(marks, 16.dp)
                    apps.forEach { app -> AppLogo(code, app, 16.dp, pro = calls.any { it.event.app == app && it.event.pro }) }
                }
            }
            Text(if (live && pending) "Using tools" else "Used ${calls.size} ${if (calls.size == 1) "tool" else "tools"}", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
            if (touched.isNotEmpty()) Text("· edited ${if (touched.size == 1) touched[0].substringAfterLast('/') else "${touched.size} files"}", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
            if (failed > 0) Text("$failed failed", fontFamily = mono, fontSize = 11.sp, fontWeight = FontWeight.SemiBold, color = MaterialTheme.colorScheme.error)
            Spacer(Modifier.weight(1f))
            Icon(kimonoIcon("chevron"), null, modifier = Modifier.size(14.dp).rotate(if (shown) 90f else 0f), tint = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        if (shown) Column(Modifier.padding(start = 6.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            calls.forEach { call -> ToolRow(code, marks, call, open) }
        }
    }
}

private fun clockWords(ms: Long): String { val s = (ms / 1000).coerceAtLeast(0); return "${s / 60}:${(s % 60).toString().padStart(2, '0')}" }
private fun aboutWords(seconds: Double) = if (seconds < 90) "about ${((seconds / 5).toInt() * 5).coerceAtLeast(5)} s" else "about ${(seconds / 60).toInt()} min"

/**
 * A long piece of work as one card: what it's doing, a bar filling toward the time the agent expected (slowing,
 * never quite full, if it runs over), how long so far; done when the agent says so. Its steps open under it.
 */
@Composable
private fun ProgressGroup(code: Code, marks: AiMarks, calls: List<ToolCall>, live: Boolean, open: (String) -> Unit) {
    val start = calls.last { it.event.progress?.label != null }.event.progress!!
    val doneAt = calls.firstOrNull { it.event.progress?.done == true && it.event.progress.at >= start.at }?.event?.progress?.at
    val finished = doneAt != null
    val stopped = !finished && !live
    var now by remember { mutableStateOf(app.kimono.screens.now()) }
    LaunchedEffect(finished, stopped) { while (!finished && !stopped) { now = app.kimono.screens.now(); kotlinx.coroutines.delay(1000) } }
    val took = (doneAt ?: now) - start.at
    val about = ((start.about ?: 60.0) * 1000).toLong()
    /* What the tool itself last said: its percent when it gave one; else its time left moves the expected end; else the estimate. */
    val update = calls.lastOrNull { it.event.progress?.status != null && it.event.progress.at >= start.at }?.event?.progress
    val total = update?.let { u -> u.left?.let { maxOf(1000L, u.at - start.at + (it * 1000).toLong()) } } ?: about
    val timed = if (took < total) 0.9f * took / total else (0.9 + 0.08 * (1 - kotlin.math.exp(-(took - total).toDouble() / total))).toFloat()
    val fill = if (finished) 1f else update?.percent?.let { minOf(0.98f, (it / 100).toFloat()) } ?: timed
    val remaining = (total - took) / 1000.0
    val estimate = when {
        update?.percent != null -> "${update.percent!!.roundToInt()}%"
        update?.left != null -> if (remaining > 5) "${aboutWords(remaining)} left" else "almost done"
        else -> aboutWords(about / 1000.0)
    }
    val apps = calls.mapNotNull { it.event.app }.distinct().take(3)
    var shown by remember { mutableStateOf(false) }
    Column(Modifier.fillMaxWidth()) {
        Surface(onClick = { shown = !shown }, shape = RoundedCornerShape(20.dp), color = MaterialTheme.colorScheme.surfaceContainer, modifier = Modifier.fillMaxWidth()) {
            Row(Modifier.padding(horizontal = 14.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Box(Modifier.size(34.dp).clip(RoundedCornerShape(11.dp)).background(MaterialTheme.colorScheme.surfaceContainerLowest), contentAlignment = Alignment.Center) {
                    if (finished) Icon(kimonoIcon("check"), "Done", modifier = Modifier.size(18.dp), tint = MaterialTheme.colorScheme.primary)
                    else if (!stopped) InkLoader(size = 18.dp)
                    else Icon(kimonoIcon("gear"), null, modifier = Modifier.size(16.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text(start.label ?: "", style = MaterialTheme.typography.titleSmall, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
                        apps.forEach { app -> AppLogo(code, app, 16.dp, pro = calls.any { it.event.app == app && it.event.pro }) }
                    }
                    /* Kimono's own wavy ink bar; grey once it stopped */
                    app.kimono.ui.InkProgress({ fill }, Modifier.fillMaxWidth(), color = if (stopped) MaterialTheme.colorScheme.onSurfaceVariant else null)
                    Text(if (finished) "Done · ${clockWords(took)}" else if (stopped) "Stopped after ${clockWords(took)}" else listOfNotNull(clockWords(took), update?.status, estimate).joinToString(" · "), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                Icon(kimonoIcon("chevron"), null, modifier = Modifier.size(14.dp).rotate(if (shown) 90f else 0f), tint = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        if (shown) Column(Modifier.padding(start = 6.dp, top = 4.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            calls.forEach { call -> ToolRow(code, marks, call, open) }
        }
    }
}

@Composable
private fun ToolRow(code: Code, marks: AiMarks, call: ToolCall, open: (String) -> Unit) {
    var opened by remember { mutableStateOf(false) }
    val result = call.result
    val e = call.event
    val state = when { result == null -> "running"; result.ok -> "ok"; else -> "failed" }
    val detail = e.detail?.let { d -> (if (e.space != null) d.split("/workspace/.kimono/files/${e.space}/").joinToString("").split("/files/${e.space}/").joinToString("") else d).lineSequence().first() }
    val meta = toolMeta(call)
    Column {
        Row(Modifier.fillMaxWidth().heightIn(min = 38.dp).clip(RoundedCornerShape(10.dp)).clickable { opened = !opened }.padding(horizontal = 4.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Box(Modifier.size(18.dp), contentAlignment = Alignment.Center) {
                when {
                    state == "running" -> InkLoader(size = 16.dp)
                    e.app != null -> AppLogo(code, e.app, 16.dp, pro = e.pro)
                    e.space != null -> DriveMark(marks, 14.dp)
                    else -> Icon(kimonoIcon(toolIcons[e.label] ?: "gear"), null, modifier = Modifier.size(15.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            val label = if (e.app != null && e.label in setOf("Used", "Connecting", "Read how to use")) "${e.label} ${AppName(code, e.app)}" else e.label
            Text(label, style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
            if (e.space != null) SpaceChip(marks, e.space, open)
            if (detail != null) Text(detail.ifEmpty { " " }, fontFamily = mono, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
            Spacer(Modifier.weight(1f))
            if (meta.isNotEmpty() && state != "running") Text(meta, fontFamily = mono, fontSize = 11.sp, color = if (state == "failed") MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant, fontWeight = if (state == "failed") FontWeight.SemiBold else null, maxLines = 1)
        }
        if (opened) Box(Modifier.padding(start = 30.dp, top = 2.dp, bottom = 6.dp)) {
            val output = result?.output?.trim().orEmpty()
            val command = if (e.label == "Ran") e.detail else null
            when {
                e.change != null && state != "failed" -> DiffLines(e.change.split('\n'), Modifier.heightIn(max = 280.dp))
                command != null || output.isNotEmpty() -> Lacquer(buildString { if (command != null) { append("$ "); append(command); if (output.isNotEmpty()) append('\n') }; append(output) }, Modifier.heightIn(max = 280.dp))
                else -> Text(if (state == "running") "Still running." else "Nothing came back.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}

/** What a write or an edit changed, as "+ added" and "- removed" lines. */
@Composable
private fun DiffLines(lines: List<String>, modifier: Modifier = Modifier) {
    Box(modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(Urushi).verticalScroll(rememberScrollState()).horizontalScroll(rememberScrollState()).padding(vertical = 8.dp)) {
        Column {
            lines.forEach { line ->
                val add = line.startsWith("+ "); val del = line.startsWith("- ")
                Text(line.ifEmpty { " " }, fontFamily = mono, fontSize = 12.sp, softWrap = false,
                    color = if (add) Kata.urushiString else if (del) Kata.urushiComment else Kata.urushiText,
                    modifier = Modifier.background(if (add) Kata.urushiString.copy(alpha = .12f) else if (del) Color.Black.copy(alpha = .2f) else Color.Transparent).padding(horizontal = 12.dp))
            }
        }
    }
}

@Composable
private fun DoneNote(e: CodeEvent.Done) {
    when {
        e.cancelled -> Note(null, "Stopped.")
        !e.ok -> Surface(shape = RoundedCornerShape(20.dp), color = MaterialTheme.colorScheme.errorContainer, modifier = Modifier.fillMaxWidth()) {
            Row(Modifier.padding(14.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Icon(kimonoIcon("close"), null, modifier = Modifier.size(16.dp), tint = MaterialTheme.colorScheme.onErrorContainer)
                Text(e.error ?: "It stopped with an error.", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onErrorContainer)
            }
        }
        /* Which Claude answered, and how long it took. Never what it cost. */
        else -> Note("check", listOfNotNull("Done", e.model?.let { modelNames[it] }, e.durationMs?.let { elapsedText(it) }).joinToString(" · "))
    }
}

/* ── asking for the person's Drive ── */

@Composable
private fun AccessCard(code: Code, drive: Drive, marks: AiMarks, people: Map<String, app.kimono.data.Person>, w: CodeWorkspace, e: CodeEvent.Access, answer: CodeEvent.AccessAnswer?, open: (String) -> Unit) {
    val scope = rememberCoroutineScope()
    var busy by remember { mutableStateOf<String?>(null) }
    var problem by remember { mutableStateOf<String?>(null) }
    var picking by remember { mutableStateOf(false) }
    val verb = if (e.need == "change") "change" else "read"
    val what = e.path.substringAfterLast('/')
    /* A line around the space's chip: what came before it, the chip, what follows. */
    @Composable fun Said(before: String, after: String) = FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(4.dp), itemVerticalAlignment = Alignment.CenterVertically) {
        DriveMark(marks, 16.dp)
        val muted = MaterialTheme.colorScheme.onSurfaceVariant
        Text(before, style = MaterialTheme.typography.bodyMedium, color = muted)
        SpaceChip(marks, e.space, open)
        if (after.isNotEmpty()) Text(after, style = MaterialTheme.typography.bodyMedium, color = muted)
    }
    val whatIn = if (e.path.isNotEmpty()) "$what in" else ""
    /* Told to someone the chat is shared with: whose Drive it is, and who answered. */
    val who = if (w.isOwner) "You" else people.nameOf(w.owner)
    val whose = if (w.isOwner) "your" else "${people.nameOf(w.owner)}’s"
    when {
        e.state == "missing" -> { Said("It asked for $whatIn".trim(), "which isn’t in $whose Drive."); return }
        e.state == "auto" -> { Said("Opened ${whatIn.ifEmpty { "files in" }}", "to $verb, as ${if (w.isOwner) "you" else people.nameOf(w.owner)} allowed before."); return }
        answer != null -> {
            if (answer.state == "denied") Said("$who didn’t let it $verb ${whatIn.ifEmpty { "files in" }}", "")
            else Said("$who let it ${if (answer.need == "change") "read and change" else "read"} ${if (answer.scope == "file") "one file from " else ""}${whatIn.ifEmpty { "files in" }}", if (answer.scope == "always") "from now on." else "in this chat.")
            return
        }
    }
    fun say(choice: String, file: String? = null) {
        busy = choice; problem = null
        scope.launch { try { code.answerAccess(w.id, e.id, choice, file) } catch (p: KimonoProblem) { problem = p.message; busy = null } }
    }
    Surface(shape = RoundedCornerShape(28.dp), color = MaterialTheme.colorScheme.surfaceContainerHigh, modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                DriveMark(marks, 24.dp)
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text("Kimono AI wants to $verb ${if (e.path.isNotEmpty()) what else "files"} in", style = MaterialTheme.typography.titleMedium)
                    SpaceChip(marks, e.space, open)
                    if (e.why.isNotBlank()) Text(e.why, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            /* Only the owner answers for their Drive. */
            if (!w.isOwner) Text("Waiting for ${people.nameOf(w.owner)}", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
            else FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Seal(if (e.file) "Allow" else "Allow for this chat", compact = true, busy = busy == "chat", enabled = busy == null, onClick = { say("chat") })
                if (!e.file && e.node != null) Seal("Only one file…", compact = true, tone = SealTone.Quiet, enabled = busy == null, onClick = { picking = !picking })
                Seal("Always allow", compact = true, tone = SealTone.Quiet, busy = busy == "always", enabled = busy == null, onClick = { say("always") })
                Seal("Don’t allow", compact = true, tone = SealTone.Quiet, busy = busy == "deny", enabled = busy == null, onClick = { say("deny") })
            }
            if (picking && e.node != null) OneFilePicker(drive, e.node) { file -> picking = false; say("file", file) }
            Problem(problem)
        }
    }
}

/** The files in what it asked for, a folder at a time, to allow just one. */
@Composable
private fun OneFilePicker(drive: Drive, root: String, pick: (String) -> Unit) {
    val stack = remember { mutableStateListOf(root) }
    val at = stack.last()
    val folder by produceState<DriveFolder?>(null, at) { value = null; value = runCatching { drive.folder(at) }.getOrNull() ?: DriveFolder(DriveNode(at, "", kind = "folder", name = ""), emptyList(), emptyList()) }
    Surface(shape = RoundedCornerShape(20.dp), color = MaterialTheme.colorScheme.surfaceContainerLowest) {
        Column(Modifier.fillMaxWidth().heightIn(max = 320.dp).verticalScroll(rememberScrollState()).padding(vertical = 6.dp)) {
            @Composable fun Line(icon: String, text: String, onClick: () -> Unit) = Row(Modifier.fillMaxWidth().clickable(onClick = onClick).padding(horizontal = 14.dp, vertical = 11.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Icon(kimonoIcon(icon), null, modifier = Modifier.size(18.dp)); Text(text, style = MaterialTheme.typography.bodyMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            if (stack.size > 1) Line("back", "Back") { stack.removeAt(stack.lastIndex) }
            val f = folder
            when {
                f == null -> Box(Modifier.fillMaxWidth().padding(16.dp), contentAlignment = Alignment.Center) { InkLoader(size = 28.dp) }
                f.children.isEmpty() -> Text("Nothing here.", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(14.dp))
                else -> f.children.sortedWith(compareBy({ !it.isFolder }, { it.name.lowercase() })).forEach { node ->
                    Line(if (node.isFolder) "folder" else "file", node.name) { if (node.isFolder) stack += node.id else pick(node.id) }
                }
            }
        }
    }
}

/** One of the person's apps needs connecting: a button that opens its sign-in. Says so once it's connected. */
@Composable
private fun ConnectCard(code: Code, platform: Platform, app: String, url: String, waitingFor: String? = null) {
    var connected by remember { mutableStateOf(false) }
    WhileShown(app to connected) {
        while (!connected) {
            runCatching { code.connections() }.getOrNull()?.let { r -> if (r.connections.any { it.app == app && it.status == "ACTIVE" }) connected = true }
            delay(5000)
        }
    }
    val name = AppName(code, app)
    Surface(shape = RoundedCornerShape(28.dp), color = MaterialTheme.colorScheme.surfaceContainerHigh, modifier = Modifier.fillMaxWidth()) {
        Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            InkBlot("connect-$app", size = 48.dp) { AppLogo(code, app, 24.dp) }
            Column(Modifier.weight(1f)) {
                Text(if (connected) "$name is connected" else "Connect $name", style = MaterialTheme.typography.titleSmall)
                Text(if (connected) "Kimono AI can use it now." else if (waitingFor != null) "Waiting for $waitingFor" else "Sign in, then come back here.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            if (connected) Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) { Icon(kimonoIcon("check"), null, tint = Kata.moss, modifier = Modifier.size(16.dp)); Text("Connected", style = MaterialTheme.typography.labelLarge) }
            else if (waitingFor == null) Seal("Connect", compact = true, onClick = { platform.openUrl(url) })
        }
    }
}

/* ── the composer: what to say next, and what to show it ── */

/** A file on its way into the sandbox: picked from the phone, or already copied from Drive. */
private class Pending(val name: String, val size: Long) {
    var attachment by mutableStateOf<CodeAttachment?>(null)
    var failed by mutableStateOf<String?>(null)
}

@Composable
private fun Composer(code: Code, drive: Drive, platform: Platform, marks: AiMarks, w: CodeWorkspace, context: ContextUse?) {
    var choosing by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    var text by remember(w.id) { mutableStateOf(code.recall("draft:${w.id}") ?: "") }
    val pending = remember(w.id) { mutableStateListOf<Pending>() }
    var problem by remember { mutableStateOf<String?>(null) }
    var sending by remember { mutableStateOf(false) }
    var meters by remember { mutableStateOf(false) }
    /* The … sheet: files, model and thinking, and all usage. */
    var more by remember { mutableStateOf(false) }
    /* The person's usage for the rings beside Send, again after each turn. */
    val usage by produceState<Usage?>(null, w.id, w.running) { value = runCatching { code.usage(w.id) }.getOrNull() }
    val shown = ShownMeters.of(usage, context?.let { it.used.toDouble() / (it.window ?: 200_000) })
    /* A different model than the one this chat has been on has to take in the whole chat again. */
    val model by code.model.collectAsState()
    val switching = w.lastModel?.takeIf { model != "auto" && model != it }
    val uploading = pending.any { it.attachment == null && it.failed == null }
    val ready = pending.mapNotNull { it.attachment }
    val canSend = !sending && !uploading && (text.isNotBlank() || ready.isNotEmpty())
    val keyboard = androidx.compose.ui.platform.LocalSoftwareKeyboardController.current
    val focus = androidx.compose.ui.platform.LocalFocusManager.current
    fun send() {
        if (!canSend) return
        /* On an iPhone, sending puts the keyboard away, as Messages does; Android keeps it up for the next line. */
        if (platform.os == "ios") { focus.clearFocus(); keyboard?.hide() }
        sending = true; problem = null
        scope.launch {
            try { code.ask(w.id, text, ready); text = ""; code.keep("draft:${w.id}", null); pending.clear() } catch (p: KimonoProblem) { problem = p.message }
            sending = false
        }
    }
    Column(Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.surface).navigationBarsPadding().imePadding().padding(start = 12.dp, end = 12.dp, top = 6.dp, bottom = 4.dp)) {
        Surface(shape = RoundedCornerShape(28.dp), color = MaterialTheme.colorScheme.surfaceContainer, modifier = Modifier.fillMaxWidth()) {
            Column(Modifier.padding(horizontal = 10.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                if (switching != null) {
                    val words = app.kimono.data.modelWords
                    Text(
                        "This chat has been on ${words[switching]?.first ?: switching}. Switching to ${words[model]?.first ?: model} uses more of your plan.",
                        style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(horizontal = 8.dp, vertical = 2.dp),
                    )
                }
                if (pending.isNotEmpty()) LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp), contentPadding = PaddingValues(horizontal = 4.dp)) {
                    items(pending.toList()) { p -> FileChip(p.name, p.failed ?: readableSize(p.size), failed = p.failed != null, busy = p.attachment == null && p.failed == null) { pending.remove(p) } }
                }
                BasicTextField(
                    value = text, onValueChange = { text = it; code.keep("draft:${w.id}", it) },
                    textStyle = MaterialTheme.typography.bodyLarge.copy(color = MaterialTheme.colorScheme.onSurface),
                    cursorBrush = androidx.compose.ui.graphics.SolidColor(MaterialTheme.colorScheme.primary),
                    maxLines = 8,
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Default),
                    modifier = Modifier.fillMaxWidth().heightIn(min = 28.dp).padding(horizontal = 8.dp, vertical = 6.dp),
                    decorationBox = { inner -> Box { if (text.isEmpty()) Text(if (w.running) "Steer it: read as soon as this step ends" else "Ask for a change, or reply", style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis); inner() } },
                )
                Row(verticalAlignment = Alignment.CenterVertically) {
                    AttachMenu(onDevice = {
                        scope.launch {
                            val picked = platform.pickFiles().take(10 - pending.size)
                            for (file in picked) {
                                val item = Pending(file.name, file.size)
                                pending += item
                                launch { try { item.attachment = code.attach(w.id, file) } catch (p: KimonoProblem) { item.failed = p.message ?: "Didn't attach" } }
                            }
                        }
                    }, onDrive = if (w.drive != null && w.isOwner) ({ choosing = true }) else null)
                    Spacer(Modifier.weight(1f))
                    /* Files, model and thinking, and every meter whatever its level, behind … */
                    IconButton(onClick = { more = true }) { Icon(kimonoIcon("more"), "Settings and usage") }
                    /* The fullest meter past half as a ring beside Send; open it for the numbers and to compact. Nothing past half, no ring. */
                    if (shown.any) IconButton(onClick = { meters = true }) { Ring(shown.most, 22.dp) }
                    if (w.running) IconButton(onClick = { scope.launch { try { code.stop(w.id) } catch (p: KimonoProblem) { problem = p.message } } }) { Icon(kimonoIcon("stop"), "Stop") }
                    Surface(onClick = { send() }, enabled = canSend, shape = CircleShape, color = if (canSend) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.surfaceContainerHighest, modifier = Modifier.size(44.dp)) {
                        Box(contentAlignment = Alignment.Center) {
                            if (sending) InkLoader(size = 22.dp) else Icon(kimonoIcon("send"), "Send", tint = if (canSend) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(20.dp))
                        }
                    }
                }
                if (problem != null) Box(Modifier.padding(horizontal = 8.dp, vertical = 2.dp)) { Problem(problem) }
            }
        }
    }
    if (meters && shown.any) MetersSheet(code, w, context, usage) { meters = false }
    if (more) MetersSheet(code, w, context, usage, all = true, settings = {
        if (w.drive != null && w.isOwner && marks.spaces.isNotEmpty()) SettingRow("Files") { AccessChip(code) }
        SettingRow("Model") { ModelChip(code) }
        SettingRow("Thinking") { EffortChip(code) }
    }) { more = false }
    if (choosing) FromDriveSheet(drive, onDismiss = { choosing = false }) { nodes ->
        choosing = false
        val items = nodes.take(10 - pending.size).map { Pending(it.name, it.size) }
        pending += items
        scope.launch {
            try {
                val attached = code.fromDrive(w.id, nodes.take(items.size).map { it.id })
                items.forEachIndexed { i, item -> item.attachment = attached.getOrNull(i); if (item.attachment == null) item.failed = "Didn't attach" }
            } catch (p: KimonoProblem) { items.forEach { it.failed = p.message ?: "Didn't attach" } }
        }
    }
}

/** One setting in the … sheet: its name, and its chip. */
@Composable
private fun SettingRow(name: String, chip: @Composable () -> Unit) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Text(name, style = MaterialTheme.typography.titleSmall, modifier = Modifier.weight(1f))
        chip()
    }
}

/**
 * Context and usage, in full: the meters past half (how full the conversation is, and compacting it; the
 * 5-hour window; the week; the month's Pro Tools), or with [all] every one of them, under [settings].
 */
@Composable
private fun MetersSheet(code: Code, w: CodeWorkspace, context: ContextUse?, usage: Usage?, all: Boolean = false, settings: (@Composable () -> Unit)? = null, close: () -> Unit) {
    val scope = rememberCoroutineScope()
    val sheet = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    var compacting by remember { mutableStateOf(false) }
    var problem by remember { mutableStateOf<String?>(null) }
    val window = context?.window ?: 200_000
    val ctx = context?.let { it.used.toDouble() / window }
    val u = usage
    /* Always this person's own use: of their share, or (the owner, who has no share) of the whole plan. */
    val whose = if (u?.unlimited == true) "of the plan, used by you" else "of your share"
    ModalBottomSheet(onDismissRequest = close, sheetState = sheet, containerColor = MaterialTheme.colorScheme.surfaceContainerLow) {
        Column(Modifier.fillMaxWidth().padding(horizontal = 20.dp).padding(bottom = 28.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            Text(if (settings != null) "Settings and usage" else "Context and usage", style = MaterialTheme.typography.titleLarge)
            if (settings != null) {
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) { settings() }
                Text("Usage", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            val shown = ShownMeters.of(u, ctx)
            if (all || shown.context != null) {
                UsageRow("Context", ctx, if (context != null) "${kTokens(context.used)} of ${kTokens(window)} tokens${if (context.window == null) " (about)" else ""}" else "Known after the next reply") {
                    Seal(if (w.running) "Compact after this" else "Compact now", compact = true, tone = SealTone.Quiet, busy = compacting, enabled = context != null, onClick = {
                        compacting = true; problem = null
                        scope.launch { try { code.ask(w.id, "/compact", emptyList()); close() } catch (p: KimonoProblem) { problem = p.message }; compacting = false }
                    })
                }
                Text("Compacting folds the conversation so far into a summary, so there’s room to keep going. It also happens by itself when the context fills.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            if (all) {
                /* everything, whatever its level */
                val five = u?.takeIf { it.reported && !it.noFiveHour }?.fiveHour?.fraction
                val week = u?.takeIf { it.reported }?.week?.fraction
                when {
                    u?.noFiveHour == true -> UsageRow("5-hour window", null, "This plan has no 5-hour limit")
                    five != null -> UsageRow("5-hour window", five, "${percent(five)} $whose${resetWords(u.fiveHour.resetsAt)?.let { " · resets $it" } ?: ""}")
                    else -> UsageRow("5-hour window", null, "Not reported yet")
                }
                if (week != null) UsageRow("This week", week, "${percent(week)} $whose${resetWords(u.week.resetsAt)?.let { " · resets $it" } ?: ""}")
                else UsageRow("This week", null, "Not reported yet")
            } else {
                if (u != null && shown.fiveHour != null) UsageRow("5-hour window", shown.fiveHour, "${percent(shown.fiveHour)} $whose${resetWords(u.fiveHour.resetsAt)?.let { " · resets $it" } ?: ""}")
                if (u != null && shown.week != null) UsageRow("This week", shown.week, "${percent(shown.week)} $whose${resetWords(u.week.resetsAt)?.let { " · resets $it" } ?: ""}")
            }
            u?.media?.takeIf { all || shown.tools != null }?.let { m -> UsageRow("Pro Tools", m.fraction, m.words?.let { w -> "$w${resetWords(m.resetsAt)?.let { " · resets $it" } ?: ""}" } ?: "Not reported yet", icon = "bolt") }
            if (u != null && !u.unlimited && (all || shown.fiveHour != null || shown.week != null)) Text(if (u.noFiveHour) "Your share is ${percent(u.week.share)} of the week." else "Your share is ${percent(u.fiveHour.share)} of each 5-hour window and ${percent(u.week.share)} of the week.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Problem(problem)
        }
    }
}

/**
 * Files from Drive for it: your spaces, then folders down to files,
 * up to ten chosen across folders. Added files are copied into the chat.
 */
@Composable
internal fun FromDriveSheet(drive: Drive, onDismiss: () -> Unit, onAdd: (List<DriveNode>) -> Unit) {
    val sheet = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val trail = remember { mutableStateListOf<Triple<String, String, DriveSpace?>>() }
    val chosen = remember { mutableStateMapOf<String, DriveNode>() }
    val here = trail.lastOrNull()
    val spaces by produceState<Result<List<DriveSpace>>?>(drive.knownSpaces()?.let { Result.success(it) }) { value = runCatching { drive.spaces() } }
    val folder by produceState<Result<DriveFolder>?>(null, here?.first) { value = null; if (here != null) value = runCatching { drive.folder(here.first) } }
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheet, containerColor = MaterialTheme.colorScheme.surfaceContainerLow, shape = MaterialTheme.shapes.large) {
        Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp).padding(bottom = 16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                if (here != null) IconButton(onClick = { trail.removeAt(trail.lastIndex) }) { Icon(kimonoIcon("back"), "Back") }
                Text(here?.second ?: "From Drive", style = MaterialTheme.typography.titleLarge, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f).padding(start = if (here == null) 4.dp else 0.dp))
                if (chosen.isNotEmpty()) Text("${chosen.size} chosen", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.primary)
            }
            LazyColumn(Modifier.fillMaxWidth().heightIn(max = 420.dp), verticalArrangement = Arrangement.spacedBy(ListItemDefaults.SegmentedGap)) {
                if (here == null) {
                    val result = spaces
                    when {
                        result == null -> item { Box(Modifier.fillMaxWidth().padding(32.dp), contentAlignment = Alignment.Center) { InkLoader() } }
                        result.isFailure -> item { Problem(result.exceptionOrNull()?.message ?: "Drive isn't answering.") }
                        else -> {
                            val list = result.getOrThrow()
                            if (list.isEmpty()) item { Text("Nothing here.", color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(16.dp)) }
                            itemsIndexed(list, key = { _, s -> s.id }) { index, space ->
                                SegmentedListItem(
                                    onClick = { trail += Triple(space.rootId, space.name, space) },
                                    shapes = ListItemDefaults.segmentedShapes(index, list.size), colors = segmentColors(),
                                    leadingContent = { InkCrest(space.crest, space.color, 24.dp) },
                                    trailingContent = { Icon(kimonoIcon("go"), null, modifier = Modifier.size(16.dp)) },
                                ) { Text(space.name, style = MaterialTheme.typography.bodyLarge, maxLines = 1, overflow = TextOverflow.Ellipsis) }
                            }
                        }
                    }
                } else {
                    val result = folder
                    when {
                        result == null -> item { Box(Modifier.fillMaxWidth().padding(32.dp), contentAlignment = Alignment.Center) { InkLoader() } }
                        result.isFailure -> item { Problem(result.exceptionOrNull()?.message ?: "That folder couldn't be opened.") }
                        else -> {
                            val list = result.getOrThrow().children.sortedWith(compareBy({ !it.isFolder }, { it.name.lowercase() }))
                            if (list.isEmpty()) item { Text("Nothing here.", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(16.dp)) }
                            itemsIndexed(list, key = { _, n -> n.id }) { index, node ->
                                val picked = chosen.containsKey(node.id)
                                SegmentedListItem(
                                    onClick = { if (node.isFolder) trail += Triple(node.id, node.name, null) else if (picked) chosen.remove(node.id) else if (chosen.size < 10) chosen[node.id] = node },
                                    shapes = ListItemDefaults.segmentedShapes(index, list.size), colors = segmentColors(),
                                    leadingContent = { if (node.isFolder) Icon(kimonoIcon("folder"), null, modifier = Modifier.size(20.dp)) else app.kimono.ui.FileTypeMark(node.name, Modifier.size(22.dp)) { Icon(kimonoIcon("file"), null, modifier = Modifier.size(20.dp)) } },
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

/* ── screenshots it took ── */

@Composable
private fun ShotImage(code: Code, w: CodeWorkspace, shot: CodeEvent.Image, modifier: Modifier, scale: ContentScale) {
    val bytes by produceState<ByteArray?>(null, shot.name) { value = runCatching { code.shot(w.id, shot.name) }.getOrNull() }
    Box(modifier.background(MaterialTheme.colorScheme.surfaceContainerHighest)) {
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
                        ShotImage(code, w, shot, Modifier.fillMaxWidth().aspectRatio(if (columns == 1) 1.6f else 0.75f).clip(RoundedCornerShape(20.dp)).clickable { onOpen(index) }, ContentScale.Crop)
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

/* ── the app a chat runs ── */

/** The app it is running, or ready: a link anyone can open while it's up, to open, copy or take down. */
@Composable
private fun PreviewCard(code: Code, platform: Platform, w: CodeWorkspace, url: String, ready: Boolean) {
    val scope = rememberCoroutineScope()
    val clipboard = LocalClipboardManager.current
    var copied by remember { mutableStateOf(false) }
    var stopping by remember { mutableStateOf(false) }
    var problem by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(copied) { if (copied) { delay(1500); copied = false } }
    Surface(shape = RoundedCornerShape(28.dp), color = Kata.moss.copy(alpha = .14f), modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Surface(shape = CircleShape, color = Kata.moss, modifier = Modifier.size(32.dp)) { Box(contentAlignment = Alignment.Center) { Icon(kimonoIcon("out"), null, tint = Color.White, modifier = Modifier.size(16.dp)) } }
                Column(Modifier.weight(1f)) {
                    Text(if (ready) "Your app is ready" else "Your app is running", style = MaterialTheme.typography.titleMedium)
                    if (ready) w.preview?.kind?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                }
            }
            Text(url.substringAfter("://"), fontFamily = mono, fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 4.dp))
            if (!ready) Text("Anyone with the link can open it while it’s up.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            FlowRow(Modifier.padding(top = 10.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Seal(if (ready) "Open app" else "Open", compact = true, onClick = { platform.openUrl(url) })
                Seal(if (copied) "Copied" else "Copy link", compact = true, tone = SealTone.Quiet, onClick = { clipboard.setText(AnnotatedString(url)); copied = true })
                Seal("Share", compact = true, tone = SealTone.Quiet, onClick = { platform.share(url) })
                if (w.isOwner) Seal("Take down", compact = true, tone = SealTone.Quiet, busy = stopping, onClick = {
                    stopping = true
                    scope.launch { try { code.stopPreview(w.id); problem = null } catch (p: KimonoProblem) { problem = p.message; stopping = false } }
                })
            }
            Problem(problem)
        }
    }
}

private val healthWords = mapOf("running" to "Running", "starting" to "Starting", "crashed" to "Crashing", "stopped" to "Stopped", "asleep" to "Asleep", "down" to "Not answering")

/** The App tab: the running app, big, with everything you do to it, and the app itself below. */
@Composable
private fun AppTab(code: Code, platform: Platform, w: CodeWorkspace, goChat: () -> Unit, changed: (CodeWorkspace) -> Unit) {
    val scope = rememberCoroutineScope()
    val preview = w.preview
    if (preview == null) {
        var asking by remember { mutableStateOf(false) }
        var problem by remember { mutableStateOf<String?>(null) }
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Spacer(Modifier.size(24.dp))
            Icon(kimonoIcon("rocket"), null, modifier = Modifier.size(40.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
            Text("Nothing is running", style = MaterialTheme.typography.titleMedium)
            Text("It runs the app when it changes something you can see. You can ask it to now.", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Seal(if (w.running) "Run it after this step" else "Run the app", busy = asking, onClick = {
                asking = true; problem = null
                scope.launch { try { code.ask(w.id, "Run the app and show it to me.", emptyList()); goChat() } catch (p: KimonoProblem) { problem = p.message; asking = false } }
            })
            Problem(problem)
            SandboxLimitsLine(code, w)
        }
        return
    }
    var status by remember(w.id) { mutableStateOf<AppStatus?>(null) }
    var acting by remember { mutableStateOf<String?>(null) }
    var problem by remember { mutableStateOf<String?>(null) }
    var name by remember(preview.url) { mutableStateOf(preview.name) }
    var renaming by remember { mutableStateOf(false) }
    var renameProblem by remember { mutableStateOf<String?>(null) }
    suspend fun look() { runCatching { code.previewStatus(w.id) }.onSuccess { status = it } }
    suspend fun reload() { runCatching { code.workspace(w.id) }.onSuccess(changed) }
    WhileShown(w.id to preview.stopped) { while (true) { look(); delay(4000) } }
    fun act(what: String) {
        acting = what; problem = null
        scope.launch {
            try { if (what == "restart") code.restartPreview(w.id) else code.pausePreview(w.id); reload() } catch (p: KimonoProblem) { problem = p.message }
            look(); acting = null
        }
    }
    val clean = name.trim().lowercase()
    val health = status?.health
    val state = if (preview.stopped) "stopped" else health?.state
    val word = when (acting) { "restart" -> if (preview.stopped) "Starting" else "Restarting"; "stop" -> "Stopping"; else -> state?.let { healthWords[it] } ?: "Looking" }
    val times = { n: Int -> if (n == 1) "1 time" else "$n times" }
    val detail = when {
        state == "crashed" && health != null -> "Exited${health.exit?.let { " with code $it" } ?: ""}, restarted ${times(health.restarts)}"
        state == "asleep" -> "Wakes when someone opens the link"
        state == "stopped" -> "The link stays. Start it again any time."
        state == "running" && (health?.restarts ?: 0) > 0 -> "Restarted ${times(health!!.restarts)}"
        else -> null
    }
    val dot = when { acting != null || state == "starting" -> Kata.suoDeep; state == "running" -> Kata.moss; state == "crashed" || state == "down" -> MaterialTheme.colorScheme.error; else -> quietGrey }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 10.dp).imePadding(), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        if (!preview.stopped) PreviewCard(code, platform, w, preview.url, ready = true)
        /* Whether it's running, and turning it off and on. */
        Surface(shape = RoundedCornerShape(24.dp), color = MaterialTheme.colorScheme.surfaceContainer) {
            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    InkDot(dot, size = 12.dp, seed = "app-${w.id}")
                    Column(Modifier.weight(1f)) {
                        Text(word, style = MaterialTheme.typography.titleSmall)
                        detail?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                        if (preview.stopped) preview.kind?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                    }
                    if (preview.stopped) Seal("Start", compact = true, enabled = acting == null, onClick = { act("restart") })
                    else {
                        IconButton(onClick = { act("restart") }, enabled = acting == null) { Icon(kimonoIcon("restart"), "Restart") }
                        IconButton(onClick = { act("stop") }, enabled = acting == null) { Icon(kimonoIcon("stop"), "Stop") }
                    }
                }
                Problem(problem)
                /* What it printed last, newest at the bottom. */
                val logScroll = rememberScrollState()
                val log = status?.log?.trimEnd()
                LaunchedEffect(log) { logScroll.scrollTo(logScroll.maxValue) }
                Box(Modifier.fillMaxWidth().heightIn(min = 120.dp, max = 320.dp).background(Urushi, RoundedCornerShape(16.dp)).verticalScroll(logScroll).padding(12.dp)) {
                    Text(if (status == null) " " else log?.ifEmpty { "Nothing printed yet." } ?: "", fontFamily = mono, fontSize = 11.sp, lineHeight = 15.sp, color = Kata.urushiText)
                }
            }
        }
        SandboxLimitsLine(code, w)
        /* The name in its link: [recipes].example.dev. */
        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text("Link name", style = MaterialTheme.typography.titleSmall)
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                OutlinedTextField(
                    name, { name = it.lowercase().replace(Regex("[^a-z0-9-]"), "-").take(50) }, singleLine = true,
                    suffix = { Text(preview.suffix, fontFamily = mono, fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant) },
                    textStyle = MaterialTheme.typography.bodyLarge.copy(fontFamily = mono),
                    keyboardOptions = KeyboardOptions(autoCorrectEnabled = false, imeAction = ImeAction.Done),
                    modifier = Modifier.weight(1f),
                )
                Seal("Rename", compact = true, busy = renaming, enabled = clean.isNotEmpty() && clean != preview.name, onClick = {
                    renaming = true; renameProblem = null
                    scope.launch { try { code.renamePreview(w.id, clean); reload() } catch (p: KimonoProblem) { renameProblem = p.message }; renaming = false }
                })
            }
            if (renameProblem != null) Problem(renameProblem)
            else Text("The old link stops working. A name of your own is easier to share, and easier to guess: anyone with the link can open the app.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        /* The app itself. */
        if (!preview.stopped) Surface(shape = RoundedCornerShape(24.dp), color = MaterialTheme.colorScheme.surfaceContainerLowest, modifier = Modifier.fillMaxWidth().border(1.dp, MaterialTheme.colorScheme.outlineVariant, RoundedCornerShape(24.dp))) {
            Column {
                Row(Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.surfaceContainer).padding(horizontal = 14.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    repeat(3) { Box(Modifier.size(8.dp).background(MaterialTheme.colorScheme.outlineVariant, CircleShape)) }
                    Text(preview.host, fontFamily = mono, fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(start = 6.dp))
                }
                platform.WebFrame(preview.url, Modifier.fillMaxWidth().height(560.dp), null, keepLinks = true, onMessage = {}, onLoaded = {})
            }
        }
        Spacer(Modifier.size(24.dp))
    }
}

/** What the chat's sandbox may use: its CPUs and memory, and its disk against the quota. */
@Composable
private fun SandboxLimitsLine(code: Code, w: CodeWorkspace) {
    var status by remember(w.id) { mutableStateOf<SandboxStatus?>(null) }
    WhileShown(w.id) { while (true) { runCatching { code.sandbox(w.id) }.onSuccess { status = it }; delay(60_000) } }
    val s = status ?: return
    val used = s.disk.used
    val full = used != null && used > s.disk.quota
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(14.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("${s.limits.cpus} ${if (s.limits.cpus == 1) "CPU" else "CPUs"}", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text("${gigabytes(s.limits.memoryMb.toLong() * 1024 * 1024)} memory", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            if (used != null) Box(Modifier.width(48.dp).height(5.dp).background(MaterialTheme.colorScheme.outlineVariant, CircleShape)) {
                Box(Modifier.fillMaxWidth(minOf(used.toFloat() / s.disk.quota.coerceAtLeast(1), 1f)).height(5.dp).background(if (full) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.primary, CircleShape))
            }
            Text(if (used != null) "${gigabytes(used)} of ${gigabytes(s.disk.quota)} disk" else "${gigabytes(s.disk.quota)} disk", style = MaterialTheme.typography.labelMedium, color = if (full) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant)
        }
        if (full) Text("Full. Ask it to free some space; a little past this, work stops.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error)
    }
}

/* ── files ── */

@Composable
private fun Files(code: Code, platform: Platform, w: CodeWorkspace) {
    var path by remember { mutableStateOf(code.recall("path:${w.id}") ?: "") }
    var opened by remember { mutableStateOf(code.recall("file:${w.id}")) }
    LaunchedEffect(path) { code.keep("path:${w.id}", path) }
    LaunchedEffect(opened) { code.keep("file:${w.id}", opened) }
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
            result == null -> item { Box(Modifier.fillMaxWidth().padding(40.dp), contentAlignment = Alignment.Center) { InkLoader() } }
            result.isFailure -> item { Problem(result.exceptionOrNull()?.message ?: "Those files couldn't be listed.") }
            else -> {
                val list = result.getOrThrow()
                if (list.isEmpty()) item { Text("Nothing here yet.", color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(16.dp)) }
                itemsIndexed(list, key = { _, e -> e.name }) { index, entry ->
                    val full = if (path.isEmpty()) entry.name else "$path/${entry.name}"
                    SegmentedListItem(
                        onClick = { if (entry.kind == "dir") path = full else opened = full },
                        shapes = ListItemDefaults.segmentedShapes(index, list.size),
                        colors = segmentColors(),
                        leadingContent = { if (entry.kind == "dir") Icon(kimonoIcon("folder"), null, modifier = Modifier.size(20.dp)) else app.kimono.ui.FileTypeMark(entry.name, Modifier.size(22.dp)) { Icon(kimonoIcon("file"), null, modifier = Modifier.size(20.dp)) } },
                        trailingContent = { if (entry.kind == "dir") Icon(kimonoIcon("go"), null, modifier = Modifier.size(16.dp)) else Text(readableSize(entry.size), fontFamily = mono, fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurfaceVariant) },
                    ) { Text(entry.name, style = MaterialTheme.typography.bodyLarge, maxLines = 1, overflow = TextOverflow.Ellipsis) }
                }
            }
        }
    }
}

private val pictureTypes = setOf("png", "jpg", "jpeg", "gif", "webp")

@OptIn(androidx.compose.ui.ExperimentalComposeUiApi::class)
@Composable
private fun FileViewer(code: Code, w: CodeWorkspace, path: String, close: () -> Unit) {
    androidx.compose.ui.backhandler.BackHandler(onBack = close)
    val clipboard = LocalClipboardManager.current
    var copied by remember { mutableStateOf(false) }
    LaunchedEffect(copied) { if (copied) { delay(1500); copied = false } }
    val bytes by produceState<Result<ByteArray>?>(null, path) { value = runCatching { code.file(w.id, path) } }
    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 2.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = close) { Icon(kimonoIcon("back"), "Back to files", modifier = Modifier.size(18.dp)) }
            Text(path, fontFamily = mono, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
            IconButton(onClick = { clipboard.setText(AnnotatedString(path)); copied = true }) { Icon(kimonoIcon(if (copied) "check" else "copy"), if (copied) "Copied" else "Copy path", modifier = Modifier.size(18.dp)) }
        }
        val result = bytes
        when {
            result == null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { InkLoader() }
            result.isFailure -> Box(Modifier.padding(20.dp)) { Problem(result.exceptionOrNull()?.message) }
            path.substringAfterLast('.').lowercase() in pictureTypes -> AsyncImage(model = result.getOrThrow(), contentDescription = path, contentScale = ContentScale.Fit, modifier = Modifier.fillMaxSize().background(MaterialTheme.colorScheme.surfaceContainer).padding(16.dp))
            else -> {
                val raw = result.getOrThrow()
                val text = raw.takeIf { b -> b.none { it == 0.toByte() } }?.decodeToString()
                when {
                    text == null -> Text("Not a text file · ${readableSize(raw.size.toLong())}", modifier = Modifier.padding(20.dp), color = MaterialTheme.colorScheme.onSurfaceVariant)
                    isMarkdown(path) -> MarkdownView(text, Modifier.fillMaxSize())
                    else -> CodeView(text, path, Modifier.fillMaxSize())
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
    val closed = remember { mutableStateMapOf<String, Boolean>() }
    LaunchedEffect(lastSeq, w.running) {
        if (changes != null) delay(2500)
        try { changes = code.changes(w.id); problem = null } catch (p: KimonoProblem) { problem = p.message }
    }
    val c = changes
    when {
        c == null && problem != null -> Box(Modifier.padding(20.dp)) { Problem(problem) }
        c == null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { InkLoader() }
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
                    val open = closed[file.path] != true
                    Surface(shape = RoundedCornerShape(20.dp), color = MaterialTheme.colorScheme.surfaceContainer) {
                        Column(Modifier.fillMaxWidth()) {
                            Row(Modifier.fillMaxWidth().clickable { closed[file.path] = open }.padding(horizontal = 14.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                                Icon(kimonoIcon("chevron"), null, modifier = Modifier.size(14.dp).rotate(if (open) 90f else 0f))
                                val letter = when (file.status) { "added" -> "A"; "deleted" -> "D"; "renamed" -> "R"; else -> "M" }
                                Surface(shape = RoundedCornerShape(6.dp), color = MaterialTheme.colorScheme.secondaryContainer, modifier = Modifier.size(20.dp)) { Box(contentAlignment = Alignment.Center) { Text(letter, fontFamily = mono, fontSize = 11.sp, fontWeight = FontWeight.Bold) } }
                                Text(file.path, fontFamily = mono, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                                Text("+${file.additions} −${file.deletions}", fontFamily = mono, fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                            if (open) {
                                val lines = diffs[file.path].orEmpty()
                                if (lines.isEmpty()) Text("No text to show.", modifier = Modifier.padding(14.dp), color = MaterialTheme.colorScheme.onSurfaceVariant)
                                else BoxWithConstraints(Modifier.fillMaxWidth().background(Urushi)) {
                                    val least = maxWidth
                                    Column(Modifier.horizontalScroll(rememberScrollState()).padding(vertical = 8.dp).widthIn(min = least).width(IntrinsicSize.Max)) {
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
                }
                if (c.truncated) item { Text("The rest is too long to show here.", color = MaterialTheme.colorScheme.onSurfaceVariant) }
            }
        }
    }
}

/* ── the Markdown it writes ── */

@Composable
internal fun Lacquer(text: String, modifier: Modifier = Modifier) {
    Box(modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(Urushi).verticalScroll(rememberScrollState()).horizontalScroll(rememberScrollState()).padding(horizontal = 12.dp, vertical = 10.dp)) {
        Text(text, fontFamily = mono, fontSize = 12.sp, color = Kata.urushiText, softWrap = false)
    }
}

/* Inline maths as the website reads it: $$…$$, \(…\), and $…$ the pandoc way, so prices stay prices
   ("$5 and $10" is money, "$x^2$" is maths). Code comes first, so maths in code is left alone. */
private val inlinePattern = Regex(
    "(`[^`\\n]+`)" +
        """|(\$\$[^$]+?\$\$)|(\\\([\s\S]+?\\\))|((?<![\\\w$])\$(?=[^\s$])[^$\n]*?[^\s\\$]\$(?!\d))""" +
        "|(\\*\\*[^*\\n]+\\*\\*)|(\\*[^*\\n]+\\*|_[^_\\n]+_)|(\\[([^\\]\\n]+)\\]\\((https?://[^)\\s]+)\\))",
)

/** \$ is a dollar sign written so it can't open maths: shown as the sign alone. */
private fun plain(text: String) = text.replace("\\$", "$")

/** The text with its maths as placeholders `math0`, `math1`…, and the maths' sources in that order. */
private fun inline(text: String, codeBg: Color, link: Color): Pair<AnnotatedString, List<String>> {
    val maths = mutableListOf<String>()
    val out = buildAnnotatedString {
        var last = 0
        for (m in inlinePattern.findAll(text)) {
            append(plain(text.substring(last, m.range.first)))
            val g = m.groups
            when {
                g[1] != null -> withStyle(SpanStyle(fontFamily = FontFamily.Monospace, background = codeBg, fontSize = 13.sp)) { append(m.value.drop(1).dropLast(1)) }
                g[2] != null || g[3] != null || g[4] != null -> {
                    val tex = if (g[4] != null) m.value.drop(1).dropLast(1) else m.value.drop(2).dropLast(2)
                    appendInlineContent("math${maths.size}", m.value)
                    maths += tex
                }
                g[5] != null -> withStyle(SpanStyle(fontWeight = FontWeight.SemiBold)) { append(plain(m.value.drop(2).dropLast(2))) }
                g[6] != null -> withStyle(SpanStyle(fontStyle = androidx.compose.ui.text.font.FontStyle.Italic)) { append(plain(m.value.drop(1).dropLast(1))) }
                g[7] != null -> withLink(androidx.compose.ui.text.LinkAnnotation.Url(g[9]!!.value, androidx.compose.ui.text.TextLinkStyles(SpanStyle(color = link, fontWeight = FontWeight.SemiBold, textDecoration = androidx.compose.ui.text.style.TextDecoration.Underline)))) { append(g[8]!!.value) }
            }
            last = m.range.last + 1
        }
        append(plain(text.substring(last)))
    }
    return out to maths
}

private val textArgs = Regex("""\\(text\w*|mbox|operatorname\*?|href|url|color|textcolor|begin|end|label|tag)\s*\{""")

/** The renderer draws `-` as a hyphen; its `\minus` is the real minus sign, so maths gets that (text inside maths keeps its hyphens). */
private fun mathSource(tex: String): String {
    val out = StringBuilder()
    var i = 0
    while (i < tex.length) {
        val text = textArgs.matchAt(tex, i)
        if (text != null) {
            var depth = 0
            var j = text.range.last
            while (j < tex.length) {
                if (tex[j] == '\\') j++ else if (tex[j] == '{') depth++ else if (tex[j] == '}' && --depth == 0) break
                j++
            }
            val end = minOf(j + 1, tex.length)
            out.append(tex, i, end)
            i = end
            continue
        }
        if (tex[i] == '\\' && i + 1 < tex.length) { out.append(tex, i, i + 2); i += 2; continue }
        if (tex[i] == '-') {
            // With nothing before it to subtract from, it's a sign: no spacing, as TeX does.
            val before = out.trimEnd()
            val unary = before.isEmpty() || before.last() in "{([=<>,;:^_&|\\" || before.endsWith("\\minus") || before.endsWith("\\pm")
            out.append(if (unary) "{\\minus}" else "\\minus ")
        } else out.append(tex[i])
        i++
    }
    return out.toString()
}

private fun mathConfig(style: TextStyle) = LatexConfig(
    fontSize = style.fontSize * 1.05f,
    theme = LatexTheme.auto(light = LatexThemeColors(style.color), dark = LatexThemeColors(style.color)),
)

/** A line of Markdown text, its maths sitting in the line. */
@Composable
private fun MdText(text: String, style: TextStyle, codeBg: Color, link: Color, modifier: Modifier = Modifier) {
    val (annotated, maths) = remember(text, codeBg, link) { inline(text, codeBg, link) }
    if (maths.isEmpty()) { Text(annotated, style = style, modifier = modifier); return }
    val config = remember(style.fontSize, style.color) { mathConfig(style) }
    val measurer = rememberLatexMeasurer(config)
    val dark = isSystemInDarkTheme()
    val content = remember(maths, measurer, dark) {
        maths.withIndex().mapNotNull { (k, tex) -> measurer.inlineContent("\\textstyle ${mathSource(tex)}", config, dark)?.let { "math$k" to it } }.toMap()
    }
    Text(annotated, style = style, inlineContent = content, modifier = modifier)
}

/** Maths on a line of its own: centred, scrolling sideways when wide. */
@Composable
private fun MathBlock(tex: String, style: TextStyle) {
    val config = remember(style.fontSize, style.color) { mathConfig(style) }
    Box(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(vertical = 4.dp), contentAlignment = Alignment.Center) {
        Latex(mathSource(tex.trim()), config = config)
    }
}

/** Display maths starting at [i]: $$…$$ or \[…\], on lines of their own (or one line); its source and the next line's index. */
private fun displayMath(lines: List<String>, i: Int): Pair<String, Int>? {
    val opens = Regex("^\\s*(\\$\\$|\\\\\\[)").find(lines[i]) ?: return null
    val close = if (opens.groupValues[1] == "$$") "$$" else "\\]"
    val rest = lines[i].trimStart().drop(2)
    val end = rest.indexOf(close)
    if (end >= 0) return if (rest.substring(end + 2).isBlank()) rest.substring(0, end) to i + 1 else null
    val body = mutableListOf(rest)
    var j = i + 1
    while (j < lines.size && !lines[j].contains(close)) body += lines[j++]
    if (j >= lines.size || lines[j].substring(lines[j].indexOf(close) + 2).isNotBlank()) return null
    body += lines[j].substring(0, lines[j].indexOf(close))
    return body.joinToString("\n") to j + 1
}

@Composable
private fun Markdown(source: String) {
    val lines = remember(source) { source.replace("\r\n", "\n").split('\n') }
    val style = MaterialTheme.typography.bodyLarge.copy(color = MaterialTheme.colorScheme.onSurface)
    val codeBg = MaterialTheme.colorScheme.surfaceContainerHighest
    val link = MaterialTheme.colorScheme.primary
    androidx.compose.foundation.text.selection.SelectionContainer {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            var i = 0
            while (i < lines.size) {
                val line = lines[i]
                val fence = Regex("^\\s*(```|~~~)").find(line)
                val display = if (fence == null) displayMath(lines, i) else null
                when {
                    display != null -> { MathBlock(display.first, style); i = display.second }
                    fence != null -> {
                        val lang = line.trim().removePrefix(fence.groupValues[1]).trim()
                        val body = mutableListOf<String>()
                        i++
                        while (i < lines.size && !lines[i].trimStart().startsWith(fence.groupValues[1])) body += lines[i++]
                        i++
                        Box(Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(Urushi).padding(vertical = 10.dp)) { app.kimono.ui.CodeLines(body.joinToString("\n"), "x.${lang.ifEmpty { "txt" }}") }
                    }
                    line.isBlank() -> i++
                    Regex("^#{1,4}\\s+").containsMatchIn(line) -> { MdText(line.replace(Regex("^#{1,4}\\s+"), ""), MaterialTheme.typography.titleMedium.copy(color = MaterialTheme.colorScheme.onSurface), codeBg, link); i++ }
                    Regex("^\\s*>\\s?").containsMatchIn(line) -> {
                        val body = mutableListOf<String>()
                        while (i < lines.size && Regex("^\\s*>\\s?").containsMatchIn(lines[i])) body += lines[i++].replace(Regex("^\\s*>\\s?"), "")
                        Row(Modifier.height(IntrinsicSize.Min)) {
                            Box(Modifier.width(3.dp).fillMaxSize().background(MaterialTheme.colorScheme.outlineVariant, RoundedCornerShape(2.dp)))
                            MdText(body.joinToString("\n"), style.copy(color = MaterialTheme.colorScheme.onSurfaceVariant), codeBg, link, Modifier.padding(start = 12.dp))
                        }
                    }
                    Regex("^\\s*([-*+]|\\d+[.)])\\s+").containsMatchIn(line) -> {
                        val ordered = Regex("^\\s*\\d+[.)]\\s+").containsMatchIn(line)
                        var n = 1
                        while (i < lines.size && Regex("^\\s*([-*+]|\\d+[.)])\\s+").containsMatchIn(lines[i])) {
                            val depth = (lines[i].length - lines[i].trimStart().length) / 2
                            val item = lines[i].replace(Regex("^\\s*([-*+]|\\d+[.)])\\s+"), "")
                            Row(Modifier.padding(start = (depth * 16).dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                Text(if (ordered) "${n}." else "•", style = style)
                                MdText(item, style, codeBg, link)
                            }
                            n++; i++
                        }
                    }
                    Regex("^\\s*\\|.*\\|\\s*$").containsMatchIn(line) -> {
                        val rows = mutableListOf<List<String>>()
                        while (i < lines.size && Regex("^\\s*\\|.*\\|\\s*$").containsMatchIn(lines[i])) {
                            val cells = lines[i].trim().removePrefix("|").removeSuffix("|").split("|").map { it.trim() }
                            if (!cells.all { Regex("^:?-{2,}:?$").matches(it) }) rows += cells
                            i++
                        }
                        Column(Modifier.horizontalScroll(rememberScrollState()).border(1.dp, MaterialTheme.colorScheme.outlineVariant, RoundedCornerShape(12.dp))) {
                            rows.forEachIndexed { r, row ->
                                Row(Modifier.background(if (r == 0) MaterialTheme.colorScheme.surfaceContainer else Color.Transparent)) {
                                    row.forEach { cell -> MdText(cell, MaterialTheme.typography.bodyMedium.copy(color = MaterialTheme.colorScheme.onSurface, fontWeight = if (r == 0) FontWeight.SemiBold else null), codeBg, link, Modifier.width(130.dp).padding(horizontal = 10.dp, vertical = 7.dp)) }
                                }
                            }
                        }
                    }
                    Regex("^\\s*(---|\\*\\*\\*|___)\\s*$").matches(line) -> { HorizontalDivider(); i++ }
                    else -> {
                        val body = mutableListOf<String>()
                        while (i < lines.size && lines[i].isNotBlank() && !Regex("^(#{1,4}\\s|\\s*```|\\s*~~~|\\s*[-*+]\\s+|\\s*\\d+[.)]\\s+|\\s*>|\\s*\\||\\s*\\$\\$|\\s*\\\\\\[)").containsMatchIn(lines[i])) body += lines[i++]
                        if (body.isEmpty()) { body += lines[i++] }
                        MdText(body.joinToString("\n"), style, codeBg, link)
                    }
                }
            }
        }
    }
}

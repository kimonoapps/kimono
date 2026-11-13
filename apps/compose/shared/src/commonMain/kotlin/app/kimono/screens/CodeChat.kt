@file:OptIn(ExperimentalMaterial3Api::class, ExperimentalMaterial3ExpressiveApi::class, androidx.compose.foundation.layout.ExperimentalLayoutApi::class)

package app.kimono.screens

import app.kimono.ui.InkDialog
import app.kimono.ui.InkConfirm
import app.kimono.ui.InkTitle
import app.kimono.ui.InkSheet
import app.kimono.ui.InkMenuItem
import app.kimono.ui.InkMenu
import app.kimono.ui.bottomChrome
import kotlin.math.roundToInt
import kotlin.math.roundToLong
import app.kimono.ui.combinedClickable
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
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
import app.kimono.ui.clickable
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
import app.kimono.ui.IconButton
import androidx.compose.material3.ListItemDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SegmentedListItem
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import app.kimono.ui.Surface
import androidx.compose.material3.Text
import app.kimono.ui.TextButton
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
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.draw.drawBehind
import androidx.compose.foundation.selection.selectable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.key
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.foundation.layout.offset
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
import androidx.compose.ui.unit.em
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import app.kimono.data.SkillCommand
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
import app.kimono.data.PickedFile
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
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.type
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.platform.LocalTextToolbar
import androidx.compose.ui.platform.TextToolbar
import androidx.compose.ui.platform.TextToolbarStatus
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntRect
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.window.Popup
import androidx.compose.ui.window.PopupPositionProvider
import androidx.compose.ui.text.input.OffsetMapping
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.text.input.TransformedText
import androidx.compose.ui.text.input.VisualTransformation

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
    /** Its words just landed as a reply, and it hasn't started anything since: no Working under it while the turn ends. */
    var said by mutableStateOf(false)
    fun clear() { text = null; artifacts.clear(); now = null; said = false }
}

@Composable
fun WorkspaceScreen(code: Code, drive: Drive, platform: Platform, id: String, showApp: Boolean = false, chats: (() -> Unit)? = null, open: (String) -> Unit, back: () -> Unit) {
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
                /* "Writing" can come in after its words have landed (it waits a moment to settle): that starts nothing new. */
                is CodeEvent.Phase -> { drafts.now = e; if (e.phase != "writing") drafts.said = false }
                is CodeEvent.Renamed -> refresh()
                /* A message was changed: the chat from it on went, and runs again from there. */
                is CodeEvent.Rewound -> { events.removeAll { it.seq >= e.seq }; drafts.clear(); refresh() }
                else -> {}
            }
            return
        }
        if (stored.seq <= (events.lastOrNull()?.seq ?: 0)) return
        when (e) {
            is CodeEvent.Say -> { drafts.text = null; drafts.said = true }
            is CodeEvent.Tool, is CodeEvent.Artifact -> { drafts.text = null; drafts.said = false }
            is CodeEvent.Ask -> drafts.said = false
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
    /* Settings and usage: opened from the top bar, filled by the composer, which knows the usage. */
    val usageTop = remember(id) { UsageTop() }
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
                        if (renaming && w != null) InlineName(w.title, MaterialTheme.typography.titleMedium, Modifier.fillMaxWidth(), onSave = { name -> workspace = code.rename(id, name.take(120)) }, onEnd = { renaming = false })
                        else if (w != null) ChatName(w, MaterialTheme.typography.titleMedium)
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
                    if (chats != null) IconButton(onClick = chats) { Icon(kimonoIcon("menu"), "Chats") }
                    else Row(verticalAlignment = Alignment.CenterVertically) {
                        IconButton(onClick = back) { Icon(kimonoIcon("back"), "Back") }
                        AiMark(code, 30.dp)
                    }
                },
                actions = {
                    if (w?.canWrite == true && (shownTab == "chat")) UsageButton(usageTop)
                    if (w?.preview != null && !w.preview.stopped) IconButton(onClick = { platform.openUrl(w.preview.url) }) { Icon(kimonoIcon("out"), "Open app") }
                    if (w?.drive != null && owns) IconButton(onClick = { open("folder/${w.drive.folderId}") }) { Icon(kimonoIcon("folder"), "Open in Drive") }
                    if (owns || w?.pullRequest != null) Box {
                        IconButton(onClick = { menu = true }) { Icon(kimonoIcon("more"), "More") }
                        InkMenu(expanded = menu, onDismissRequest = { menu = false }) {
                            if (owns && w != null) InkMenuItem("Share", icon = "share", onClick = { menu = false; sharing = true })
                            if (owns) InkMenuItem("Rename", icon = "edit", onClick = { menu = false; renaming = true })
                            if (owns && w != null && !w.isProject && projects.isNotEmpty()) InkMenuItem(if (w.folder == null) "Put in a project" else "Move to another project", icon = "move", onClick = { menu = false; moving = true })
                            if (w?.pullRequest != null) InkMenuItem("Pull request #${w.pullRequest.number}", icon = "pr", onClick = { menu = false; platform.openUrl(w.pullRequest.url) })
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
                        Seal("New chat", tone = SealTone.Quiet, onClick = { open("code") })
                    }
                    w == null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { InkLoader() }
                    shownTab == "files" -> Files(code, platform, w)
                    shownTab == "changes" -> Changes(code, w, events.lastOrNull()?.seq ?: 0)
                    shownTab == "app" -> AppTab(code, platform, w, goChat = { tab = "chat" }) { workspace = it }
                    else -> Chat(code, drive, platform, marks, artifacts, people, w, events, drafts, open, usageTop)
                }
            }
        }
    }
    if (sharing && w != null) ChatShareSheet(code, platform, w) { sharing = false }
    if (moving && w != null) InkDialog(
        title = "Project",
        icon = "move",
        onDismiss = { moving = false },
        actions = { Seal("Close", compact = true, tone = SealTone.Quiet, onClick = { moving = false }) },
    ) {
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
    }
}

/* ── the timeline, as the reader sees it ── */

private class ToolCall(val event: CodeEvent.Tool) {
    var result by mutableStateOf<CodeEvent.ToolResult?>(null)
    /** For a card's start: how its job stands, as Kimono last read it from the sandbox. */
    var probe by mutableStateOf<CodeEvent.Progress?>(null)
}

private sealed interface Item {
    val key: Long
    data class Ask(override val key: Long, val event: CodeEvent.Ask, val at: Long = 0) : Item
    data class Say(override val key: Long, val text: String) : Item
    data class Tools(override val key: Long, val calls: MutableList<ToolCall>) : Item
    data class Done(override val key: Long, val event: CodeEvent.Done, val at: Long = 0, /** what it said this turn, to copy */ val answer: String = "") : Item
    data class Plain(override val key: Long, val event: CodeEvent) : Item
    data class Shots(override val key: Long, val shots: MutableList<CodeEvent.Image>) : Item
    data class Access(override val key: Long, val event: CodeEvent.Access, val answer: CodeEvent.AccessAnswer?) : Item
    /** A question it asked that has been answered or skipped; one still waiting is in the writing bar's place instead. */
    data class Asked(override val key: Long, val event: CodeEvent.Question, val answer: CodeEvent.QuestionAnswer) : Item
    /** Two takes on one message, each its own run of items to its Done; which one the person [kept], or which was [dropped]. */
    class Takes(override val key: Long, val id: String) : Item {
        val takes = mutableListOf(mutableListOf<Item>())
        var kept: Int? = null
        var dropped: Int? = null
    }
}

/** Every item, the takes of a pair in order among them. */
private fun flatItems(items: List<Item>): List<Item> = items.flatMap { if (it is Item.Takes) it.takes.flatten() else listOf(it) }

/** Consecutive tool calls fold into one group, each call paired with its result; pictures in a row together. */
private fun itemsOf(events: List<StoredCodeEvent>): List<Item> {
    val items = mutableListOf<Item>()
    val calls = mutableMapOf<String, ToolCall>()
    val answers = events.mapNotNull { it.event as? CodeEvent.AccessAnswer }.associateBy { it.id }
    val replied = events.mapNotNull { it.event as? CodeEvent.QuestionAnswer }.associateBy { it.id }
    val said = mutableListOf<String>()
    /* Where items go: the timeline, or the take under way. */
    var into: MutableList<Item> = items
    fun pairOf(id: String) = items.lastOrNull { it is Item.Takes && it.id == id } as Item.Takes?
    for (stored in events) {
        val last = into.lastOrNull()
        when (val e = stored.event) {
            is CodeEvent.Ask -> { into = items; items += Item.Ask(stored.seq, e, stored.at); said.clear() }
            is CodeEvent.Take -> {
                val pair = if (e.n == 0) null else pairOf(e.id)
                if (pair != null) { val second = mutableListOf<Item>(); if (pair.takes.size > 1) pair.takes[1] = second else pair.takes += second; into = second }
                else { val fresh = Item.Takes(stored.seq, e.id); items += fresh; into = fresh.takes[0] }
                said.clear()
            }
            is CodeEvent.TakeKept -> pairOf(e.id)?.kept = e.n
            is CodeEvent.TakeDropped -> pairOf(e.id)?.dropped = e.n
            /* sent while it worked: read now, so no longer waiting; or never read, because it was stopped */
            is CodeEvent.Steered -> for (i in items.indices) { val a = items[i]; if (a is Item.Ask && a.key in e.seqs) items[i] = a.copy(event = a.event.copy(queued = false)) }
            is CodeEvent.Dropped -> for (i in items.indices) { val a = items[i]; if (a is Item.Ask && a.key in e.seqs) items[i] = a.copy(event = a.event.copy(dropped = true)) }
            is CodeEvent.Say -> { into += Item.Say(stored.seq, e.text); said += e.text }
            is CodeEvent.Tool -> {
                val call = ToolCall(e).also { calls[e.id] = it }
                if (last is Item.Tools) last.calls += call else into += Item.Tools(stored.seq, mutableListOf(call))
            }
            is CodeEvent.ToolResult -> calls[e.id]?.result = e
            is CodeEvent.Progress -> calls[e.id]?.probe = e
            is CodeEvent.Done -> {
                into += Item.Done(stored.seq, e, stored.at, said.joinToString("\n\n")); said.clear()
                /* The second take ends at its Done; what follows is the timeline's again. */
                if (into !== items && (items.lastOrNull() as? Item.Takes)?.takes?.getOrNull(1) === into) into = items
            }
            is CodeEvent.Image -> if (last is Item.Shots) last.shots += e else into += Item.Shots(stored.seq, mutableListOf(e))
            is CodeEvent.Access -> into += Item.Access(stored.seq, e, answers[e.id])
            is CodeEvent.Question -> replied[e.id]?.let { into += Item.Asked(stored.seq, e, it) }
            is CodeEvent.Published, is CodeEvent.Preview, CodeEvent.PreviewStopped, is CodeEvent.Slept, is CodeEvent.Disk, is CodeEvent.Compacted,
            is CodeEvent.Remembered, is CodeEvent.SkillMade, is CodeEvent.Artifact, is CodeEvent.Connect, is CodeEvent.Sent -> into += Item.Plain(stored.seq, e)
            else -> {}
        }
    }
    return items
}

@Composable
private fun Chat(code: Code, drive: Drive, platform: Platform, marks: AiMarks, artifacts: Artifacts, people: Map<String, app.kimono.data.Person>, w: CodeWorkspace, events: List<StoredCodeEvent>, drafts: Drafts, open: (String) -> Unit, usageTop: UsageTop) {
    /* the replies' Quran and hadith cards fetch through the chat, and the notice before an answer on Islam asks in it */
    androidx.compose.runtime.CompositionLocalProvider(LocalChatScope provides remember(w.id) { ChatScope(code, w.id) }) { ChatBody(code, drive, platform, marks, artifacts, people, w, events, drafts, open, usageTop) }
}

@Composable
private fun ChatBody(code: Code, drive: Drive, platform: Platform, marks: AiMarks, artifacts: Artifacts, people: Map<String, app.kimono.data.Person>, w: CodeWorkspace, events: List<StoredCodeEvent>, drafts: Drafts, open: (String) -> Unit, usageTop: UsageTop) {
    val items = remember(events.size) { itemsOf(events) }
    /* Where you were in it: the end (following along), or a place you scrolled back to. */
    val savedScroll = remember(w.id) { code.recall("scroll:${w.id}")?.split(',')?.mapNotNull { it.toIntOrNull() }?.takeIf { it.size == 2 } }
    val list = rememberLazyListState()
    val scope = rememberCoroutineScope()
    /* An artifact still being written has no place in the timeline yet: it is drawn at the end until its call lands. */
    val flat = remember(items) { flatItems(items) }
    val placed = flat.mapNotNull { ((it as? Item.Plain)?.event as? CodeEvent.Artifact)?.id }.toSet()
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
    LaunchedEffect(flat.size, writing.size, drafts.text?.length?.div(80), w.running) { if (following && total > 0) list.animateScrollToItem(total - 1) }
    /* Only the turn under way may hold a group open. */
    val lastAsk = flat.indexOfLast { it is Item.Ask }
    val lastTools = flat.drop(lastAsk + 1).lastOrNull { it is Item.Tools }
    val lastPreview = flat.lastOrNull { (it as? Item.Plain)?.event is CodeEvent.Preview }?.key
    val lastContext = flat.lastOrNull { it is Item.Done && it.event.context != null }?.let { (it as Item.Done).event.context }
    var viewing by remember { mutableStateOf<Pair<List<CodeEvent.Image>, Int>?>(null) }
    /* Replies that land after the chat has opened are let out word by word; ones already there just show. */
    var liveFrom by remember(w.id) { mutableStateOf(Long.MAX_VALUE) }
    /* How far each live reply has been let out, kept while the chat is open so a reply scrolled off and back doesn't start again. */
    val revealed = remember(w.id) { mutableMapOf<Long, Int>() }
    val hasItems = items.isNotEmpty()
    val itemsNow by androidx.compose.runtime.rememberUpdatedState(flat)
    LaunchedEffect(w.id, hasItems) { if (hasItems && liveFrom == Long.MAX_VALUE) { kotlinx.coroutines.delay(500); liveFrom = itemsNow.lastOrNull()?.key ?: 0L } }
    var ratings by remember(w.id) { mutableStateOf<Map<Long, Int>>(emptyMap()) }
    LaunchedEffect(w.id) { runCatching { code.ratings(w.id) }.onSuccess { ratings = it } }
    /* An administrator's thank-you for a thumb, shown under its answer. */
    var replies by remember(w.id) { mutableStateOf<Map<Long, String>>(emptyMap()) }
    LaunchedEffect(w.id) { runCatching { code.replies(w.id) }.onSuccess { replies = it } }
    val asking = askingFor(flat, ratings)
    /* The latest question it asked that has no answer yet: it takes the writing bar's place until it has one. */
    val waiting = remember(events.size) {
        val replied = events.mapNotNullTo(mutableSetOf()) { (it.event as? CodeEvent.QuestionAnswer)?.id }
        events.lastOrNull { (it.event as? CodeEvent.Question)?.let { q -> q.id !in replied && q.questions.isNotEmpty() } == true }?.event as? CodeEvent.Question
    }
    val asked = remember(waiting?.id) { waiting?.let { QuestionDraft(it) } }
    /* Answered here and on its way: the bar comes back at once, and the panel again if it didn't go. */
    var sentQuestion by remember(w.id) { mutableStateOf<String?>(null) }
    fun answerQuestion(draft: QuestionDraft, replies: List<app.kimono.data.QuestionReply>?) {
        draft.problem = null
        sentQuestion = draft.question.id
        scope.launch {
            try { code.answerQuestion(w.id, draft.question.id, replies) }
            catch (p: KimonoProblem) { draft.problem = p.message ?: "Didn't send"; if (sentQuestion == draft.question.id) sentQuestion = null }
        }
    }
    /* What it's writing now, and that it's working: inside the last take while a pair runs, else at the end. */
    val tailInPair = w.running && items.lastOrNull() is Item.Takes
    @Composable
    fun Tail() {
        writing.forEach { name -> ArtifactCard(code, platform, artifacts, name) }
        drafts.text?.let { DraftWords(it) }
        if (drafts.text.isNullOrBlank() && !drafts.said) Working(code, drafts.now, artifact = drafts.artifacts.isNotEmpty())
    }
    /* One item of the timeline, or of a take. */
    @Composable
    fun Show(item: Item) {
        when (item) {
            is Item.Takes -> TakesBlock(code, w, item, latest = item === items.lastOrNull(), withTail = tailInPair && item === items.lastOrNull(), tail = { Tail() }, show = { Show(it) })
            is Item.Ask -> AskBubble(code, platform, people, w, item.event, seq = item.key)
            /* Let out once: scrolled away and back, or already out, it just shows. */
            is Item.Say -> if (item.key > liveFrom && (revealed[item.key] ?: -1) < item.text.length) RevealWords(item.text, from = revealed[item.key]) { revealed[item.key] = it } else Markdown(item.text)
            is Item.Tools -> ToolGroup(code, marks, item.calls, live = w.running && item === lastTools, open)
            is Item.Done -> DoneNote(item.event, item.answer, ratings[item.key], asking = asking == item.key, reply = if (ratings[item.key] != null) replies[item.key] else null) { rating, note ->
                ratings = if (rating == null) ratings - item.key else ratings + (item.key to rating)
                /* Not saved: show what the server has, not what was hoped. */
                scope.launch { runCatching { code.rate(w.id, item.key, rating, note) }.onSuccess { ratings = it }.onFailure { runCatching { code.ratings(w.id) }.onSuccess { ratings = it } } }
            }
            is Item.Shots -> ShotGallery(code, w, item.shots) { at -> viewing = item.shots.toList() to at }
            is Item.Access -> AccessCard(code, drive, marks, people, w, item.event, item.answer, open)
            is Item.Asked -> Note("chat", askedLine(item.event, item.answer))
            is Item.Plain -> when (val e = item.event) {
                is CodeEvent.Preview -> if (w.running && w.preview?.url == e.url && item.key == lastPreview) PreviewCard(code, platform, w, e.url, ready = false)
                    else Note("link", "The app ran at ${e.host}")
                CodeEvent.PreviewStopped -> Note("link", "The app’s link was taken down.")
                /* only a project's chat says it was put to sleep; a plain chat just wakes */
                is CodeEvent.Slept -> if (w.isProject) Note("restart", "Put to sleep to make room for “${e.forTitle}”. It wakes when you open it.")
                is CodeEvent.Disk -> Note("close", if (e.full) "Stopped: this chat's files took ${gigabytes(e.used)}, past its ${gigabytes(e.quota)}. Its app was stopped too. Ask it to free some space."
                    else "This chat's files take ${gigabytes(e.used)} of its ${gigabytes(e.quota)}. It was asked to free some space first.", failed = true)
                is CodeEvent.Compacted -> Note("diff", "Compacted the conversation${e.before?.let { " · it held ${kTokens(it)} tokens" } ?: ""}")
                is CodeEvent.Remembered -> Note("chat", "${when (e.how) { "forgot" -> "Forgot"; "changed" -> "Now remembers"; else -> "Remembered" }}: ${e.text}", trailing = { TextLink("For you") { open("ai/memory") } })
                is CodeEvent.SkillMade -> if (e.problem != null) Note("spark", "Couldn’t save ${e.name}: ${e.problem}", failed = true)
                    else Note("spark", "${if (e.updated) "Changed" else "Made"} ${e.name}${e.command?.let { " · /$it" } ?: ""}${if (e.published) " · in the Marketplace" else ""}", trailing = { if (w.isOwner) TextLink("For you") { open("ai/memory") } })
                is CodeEvent.Published -> Note("pr", "Opened pull request #${e.number}", trailing = { TextLink("Open") { platform.openUrl(e.url) } })
                is CodeEvent.Connect -> ConnectCard(code, platform, e.app, e.url, waitingFor = if (w.isOwner) null else people.nameOf(w.owner))
                is CodeEvent.Sent -> Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    e.files.filter { it.isMedia }.takeIf { it.isNotEmpty() }?.let { AttachedMedia(code, platform, w, it) }
                    e.files.filterNot { it.isMedia }.forEach { SentFile(code, platform, w, it) }
                }
                is CodeEvent.Artifact -> if (e.action == "edited") ArtifactChanged(artifacts, code, e.name) else ArtifactCard(code, platform, artifacts, e.name)
                else -> {}
            }
        }
    }
    val focusManager = androidx.compose.ui.platform.LocalFocusManager.current
    /* Swiping the conversation left slides it over to show when each message was sent, as in Messages; let go and it slides back. */
    val reveal = remember { androidx.compose.animation.core.Animatable(0f) }
    val shownAt = remember(flat.size) { now() }
    /* A tap on the conversation itself (not on something in it) puts the keyboard away, ending a rename as tapping away does on the website. */
    Column(Modifier.fillMaxSize().pointerInput(Unit) { detectTapGestures(onTap = { focusManager.clearFocus() }) }) {
        Box(Modifier.weight(1f).fillMaxWidth().pointerInput(Unit) {
            val reach = 72.dp.toPx()
            detectHorizontalDragGestures(
                onDragEnd = { scope.launch { reveal.animateTo(0f, androidx.compose.animation.core.spring(dampingRatio = .8f)) } },
                onDragCancel = { scope.launch { reveal.animateTo(0f) } },
            ) { change, dx -> if (dx < 0 || reveal.value > 0f) { change.consume(); scope.launch { reveal.snapTo((reveal.value - dx / reach).coerceIn(0f, 1f)) } } }
        }) {
            LazyColumn(state = list, contentPadding = PaddingValues(horizontal = 16.dp, vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(12.dp), modifier = Modifier.fillMaxSize()) {
                if (items.isEmpty() && !w.running) item(key = "empty") { Box(Modifier.fillMaxWidth().padding(40.dp), contentAlignment = Alignment.Center) { InkLoader() } }
                items(items, key = { it.key }) { item ->
                    /* What arrives once the chat is open fades and settles into place; a finished reply takes its draft's place without a fade. */
                    Box(Modifier.animateItem(
                        fadeInSpec = if (item is Item.Say) null else androidx.compose.animation.core.tween(380),
                        placementSpec = androidx.compose.animation.core.spring(dampingRatio = .8f, stiffness = 380f, visibilityThreshold = androidx.compose.ui.unit.IntOffset(1, 1)),
                        fadeOutSpec = null,
                    )) {
                    TimeAside(when (item) { is Item.Ask -> item.at; is Item.Done -> item.at; else -> 0L }.takeIf { it > 0 }?.let { messageTime(it, shownAt, platform.utcOffsetMillis(it)) }, reveal.value) {
                        Show(item)
                    }
                    }
                }
                items(if (tailInPair) emptyList() else writing, key = { "writing-${drafts.artifacts[it]?.first ?: it}" }) { name -> ArtifactCard(code, platform, artifacts, name) }
                item(key = "draft") { if (!tailInPair) drafts.text?.let { DraftWords(it) } }
                item(key = "tail") {
                    when {
                        tailInPair -> Spacer(Modifier.size(1.dp))
                        /* Not while the reply's own words are coming in: those show it's working. */
                        w.running && drafts.text.isNullOrBlank() && !drafts.said -> Working(code, drafts.now, artifact = drafts.artifacts.isNotEmpty())
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
        if (w.canWrite) Composer(code, drive, platform, marks, w, lastContext, usageTop, standIn = asked?.takeIf { it.question.id != sentQuestion && !w.running }?.let { draft -> @Composable {
            QuestionPanel(draft,
                onAnswer = { replies -> answerQuestion(draft, replies) },
                onSkip = { answerQuestion(draft, null) })
        } })
        else Text("You can view this chat", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.surface).bottomChrome().padding(horizontal = 24.dp, vertical = 16.dp))
    }
    viewing?.let { (shots, at) -> ShotViewer(code, w, shots, at) { viewing = null } }
    artifacts.full?.let { name -> ArtifactFull(code, platform, artifacts, name) }
}

/* ── two takes on one answer (portal lib/code/takes.ts) ──
   Two tabs, First and Second, and the person keeps one; from then on it answers them that way.
   Kept, the other folds away behind a quiet line. */

@Composable
private fun TakesBlock(code: Code, w: CodeWorkspace, item: Item.Takes, latest: Boolean, withTail: Boolean, tail: @Composable () -> Unit, show: @Composable (Item) -> Unit) {
    val scope = rememberCoroutineScope()
    var tab by remember(item.key) { mutableStateOf(0) }
    var other by remember(item.key) { mutableStateOf(false) }
    var busy by remember(item.key) { mutableStateOf<Int?>(null) }
    var problem by remember(item.key) { mutableStateOf<String?>(null) }
    val gap = Arrangement.spacedBy(12.dp)
    val hair = MaterialTheme.colorScheme.outlineVariant
    /* The second hasn't begun, or one of them didn't come off: the other is just the answer. */
    val alone = when {
        item.takes.size < 2 || item.dropped == 1 -> 0
        item.dropped == 0 -> 1
        else -> null
    }
    if (alone != null) {
        Column(verticalArrangement = gap) {
            item.takes[alone].forEach { show(it) }
            if (withTail) tail()
        }
        return
    }
    val kept = item.kept?.takeIf { it in 0..1 }
    if (kept != null) {
        Column(verticalArrangement = gap) {
            item.takes[kept].forEach { show(it) }
            TextLink(if (other) "Hide the other take" else "The other take") { other = !other }
            if (other) Column(
                Modifier.fillMaxWidth().drawBehind { drawLine(hair, androidx.compose.ui.geometry.Offset(1.dp.toPx(), 0f), androidx.compose.ui.geometry.Offset(1.dp.toPx(), size.height), 2.dp.toPx()) }.padding(start = 16.dp),
                verticalArrangement = gap,
            ) { item.takes[1 - kept].forEach { show(it) } }
        }
        return
    }
    val ends = item.takes.map { take -> take.firstNotNullOfOrNull { it as? Item.Done } }
    /* Only the chat's owner keeps one, once both are in and neither went wrong, and only on the latest answer. */
    val keepable = w.isOwner && latest && !w.running && ends.all { it?.event?.ok == true }
    fun keep(n: Int) {
        busy = n; problem = null
        scope.launch {
            try { code.keepTake(w.id, item.id, n) }
            catch (p: KimonoProblem) { problem = p.message ?: "That didn’t work. Try again." }
            finally { busy = null }
        }
    }
    val accent = MaterialTheme.colorScheme.primary
    val shown = tab.coerceIn(0, item.takes.lastIndex)
    Column(Modifier.fillMaxWidth().drawBehind { drawLine(hair, androidx.compose.ui.geometry.Offset(0f, 1.dp.toPx()), androidx.compose.ui.geometry.Offset(size.width, 1.dp.toPx()), 2.dp.toPx()) }.padding(top = 14.dp), verticalArrangement = gap) {
        Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text("Two takes", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold)
            if (keepable || (w.running && latest)) Text("Keep the one you’d like from now on.", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        /* Tabs as on the website: a hairline under them, the open one underlined in suō, how long each took beside its name. */
        Row(Modifier.fillMaxWidth().drawBehind { drawLine(hair, androidx.compose.ui.geometry.Offset(0f, size.height - 0.5.dp.toPx()), androidx.compose.ui.geometry.Offset(size.width, size.height - 0.5.dp.toPx()), 1.dp.toPx()) }) {
            item.takes.indices.forEach { n ->
                val on = shown == n
                val took = ends[n]?.event?.durationMs?.let { elapsedText(it) } ?: if (w.running && latest && n == 1) "…" else null
                Row(
                    Modifier.heightIn(min = 44.dp)
                        .selectable(selected = on, role = androidx.compose.ui.semantics.Role.Tab, onClick = { tab = n })
                        .drawBehind { if (on) drawLine(accent, androidx.compose.ui.geometry.Offset(0f, size.height - 1.5.dp.toPx()), androidx.compose.ui.geometry.Offset(size.width, size.height - 1.5.dp.toPx()), 3.dp.toPx()) }
                        .padding(horizontal = 14.dp, vertical = 12.dp),
                    verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    Text(if (n == 0) "First" else "Second", style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.Bold, color = if (on) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant)
                    took?.let { Text(it, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                }
            }
        }
        item.takes[shown].forEach { show(it) }
        if (withTail && shown == item.takes.lastIndex) tail()
        if (keepable) Seal("Keep this one", compact = true, busy = busy == shown, enabled = busy == null, onClick = { keep(shown) })
        /* Keeping one sends both takes' artifacts to the admins' feedback bank, never what anyone said: it says so. */
        if (keepable && item.takes.any { take -> take.any { (it as? Item.Plain)?.event is CodeEvent.Artifact } })
            Text("Note: this sends the artifact to the admin. None of your chat messages are shared.", style = MaterialTheme.typography.bodySmall.copy(fontSize = 13.sp), color = MaterialTheme.colorScheme.onSurfaceVariant)
        Problem(problem)
    }
}

/**
 * Working, at the end of the conversation: Material's loading indicator where its first word will land,
 * and a few words only when they say something (where it's looking, an app it's using, an artifact on its way).
 */
@Composable
private fun Working(code: Code, doing: CodeEvent.Phase?, artifact: Boolean) {
    val phase = if (artifact || doing?.phase == "artifact") "artifact" else doing?.phase ?: "working"
    val appName = doing?.app?.let { AppName(code, it) }
    val words = when (phase) {
        "artifact" -> "Working my magic"
        "tools" -> when {
            appName != null -> "Using $appName"
            doing?.space != null -> "Looking in ${doing.space}"
            doing?.tool == "web" -> "Searching the web"
            doing?.tool == "command" -> "Running a command"
            doing?.tool == "files" -> "Going through files"
            doing?.tool == "helper" -> "Asking a helper"
            else -> "Using tools"
        }
        else -> null
    }
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.heightIn(min = 26.dp).semantics(mergeDescendants = true) { contentDescription = words ?: "Working" }) {
        androidx.compose.material3.LoadingIndicator(Modifier.size(20.dp), color = MaterialTheme.colorScheme.primary)
        androidx.compose.animation.AnimatedContent(
            targetState = words,
            transitionSpec = { androidx.compose.animation.fadeIn(androidx.compose.animation.core.tween(180)) togetherWith androidx.compose.animation.fadeOut(androidx.compose.animation.core.tween(120)) },
            label = "now",
        ) { w -> if (w != null) Text(w, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant) }
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
            val ink = if (magic) MaterialTheme.colorScheme.primary else base
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
    /* Holding your message offers Edit (when it can be changed) and Copy. */
    var held by remember { mutableStateOf(false) }
    @Suppress("DEPRECATION") val clipboard = androidx.compose.ui.platform.LocalClipboardManager.current
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
            Modifier.widthIn(max = 320.dp).alpha(if (ask.dropped) .5f else if (ask.queued) .72f else 1f).clip(RoundedCornerShape(24.dp, 24.dp, 8.dp, 24.dp))
                .combinedClickable(onClick = {}, onLongClickLabel = "Copy or edit", onLongClick = { haptics.performHapticFeedback(HapticFeedbackType.LongPress); held = true })
                .background(MaterialTheme.colorScheme.secondaryContainer, RoundedCornerShape(24.dp, 24.dp, 8.dp, 24.dp)).padding(horizontal = 16.dp, vertical = 11.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            if (ask.text.isNotBlank()) {
                val (quoted, words) = splitQuote(ask.text)
                val ink = MaterialTheme.colorScheme.onSecondaryContainer
                if (quoted != null) Text(quoted, style = MaterialTheme.typography.bodyMedium, color = ink.copy(alpha = .75f), maxLines = 4, overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.drawBehind { drawRect(ink.copy(alpha = .4f), size = androidx.compose.ui.geometry.Size(3.dp.toPx(), size.height)) }.padding(start = 10.dp))
                if (words.isNotBlank()) Text(words, style = MaterialTheme.typography.bodyLarge, color = ink)
            }
            val media = ask.attachments.filter { it.isMedia }
            val others = ask.attachments.filterNot { it.isMedia }
            if (media.isNotEmpty()) AttachedMedia(code, platform, w, media)
            if (others.isNotEmpty()) Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                others.forEach { a -> Box(Modifier.clip(RoundedCornerShape(14.dp)).clickable { opened = a }) { FileChip(a.name, readableSize(a.size)) } }
            }
            DropdownMenu(held, onDismissRequest = { held = false }) {
                if (editable) DropdownMenuItem(text = { Text("Edit") }, leadingIcon = { Icon(kimonoIcon("edit"), null, Modifier.size(18.dp)) }, onClick = { held = false; problem = null; editing = ask.text })
                if (ask.text.isNotBlank()) DropdownMenuItem(text = { Text("Copy") }, leadingIcon = { Icon(kimonoIcon("copy"), null, Modifier.size(18.dp)) }, onClick = { held = false; clipboard.setText(AnnotatedString(ask.text)) })
            }
        }
        if (ask.dropped) Text("Not sent: it was stopped first", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 4.dp, end = 6.dp))
        else if (ask.queued) Text("Read after its current step", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 4.dp, end = 6.dp))
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

/* ── photos and videos, as squares ── */

private val videoExtensions = setOf("mp4", "m4v", "mov", "webm")
private val pictureExtensions = setOf("png", "jpg", "jpeg", "gif", "webp")

internal fun isVideoFile(name: String, type: String?) = type?.startsWith("video/") == true || name.substringAfterLast('.', "").lowercase() in videoExtensions
internal fun isPictureFile(name: String, type: String?) = type in setOf("image/png", "image/jpeg", "image/gif", "image/webp") ||
    ((type.isNullOrEmpty() || type == "application/octet-stream") && name.substringAfterLast('.', "").lowercase() in pictureExtensions)
internal val CodeAttachment.isVideo get() = isVideoFile(name, type)
/** A photo or a video: what shows as a square in the chat. */
internal val CodeAttachment.isMedia get() = isPicture || isVideo

/** A picked file's bytes, for showing it before it's sent; null past 20 MB. */
internal suspend fun readAll(file: PickedFile): ByteArray? {
    if (file.size > Code.MAX_ATTACHMENT) return null
    val bytes = ByteArray(file.size.toInt())
    var at = 0
    while (at < bytes.size) {
        val piece = file.read(at.toLong(), minOf(1024 * 1024, bytes.size - at))
        if (piece.isEmpty()) break
        piece.copyInto(bytes, at)
        at += piece.size
    }
    return bytes.copyOf(at)
}

/** How long a video runs: "0:07", "12:40", "1:02:09". */
private fun runningTime(seconds: Double): String {
    val s = seconds.roundToLong()
    val h = s / 3600; val m = (s % 3600) / 60; val r = (s % 60).toString().padStart(2, '0')
    return if (h > 0) "$h:${m.toString().padStart(2, '0')}:$r" else "$m:$r"
}

private class MediaFace(val picture: ByteArray?, val seconds: Double?)

/**
 * A photo or video as a square: the photo cropped to fill it; a video's frame with a play
 * mark and how long it runs. [load] gives the file's bytes, once per [key].
 */
@Composable
internal fun MediaSquare(platform: Platform, key: String, name: String, video: Boolean, modifier: Modifier = Modifier, small: Boolean = false, onClick: (() -> Unit)? = null, load: suspend () -> ByteArray?) {
    val face by produceState<MediaFace?>(null, key) {
        value = runCatching {
            val bytes = load() ?: return@runCatching null
            if (!video) MediaFace(bytes, null)
            else platform.videoFrame(cacheFile(platform, "frames", "${key.hashCode().toUInt()}-$name", bytes), 480)?.let { MediaFace(it.picture, it.seconds) }
        }.getOrNull() ?: MediaFace(null, null)
    }
    val shape = RoundedCornerShape(12.dp)
    Box(modifier.aspectRatio(1f).clip(shape).background(if (video) Kata.ink else MaterialTheme.colorScheme.surfaceContainerHighest)
        .then(if (onClick != null) Modifier.clickable(onClickLabel = "Open $name", onClick = onClick) else Modifier), contentAlignment = Alignment.Center) {
        val picture = face?.picture
        when {
            picture != null -> AsyncImage(model = picture, contentDescription = name, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
            face == null -> InkLoader(size = 18.dp)
            !video -> app.kimono.ui.FileTypeMark(name, Modifier.size(28.dp)) { Icon(kimonoIcon("file"), null) }
        }
        if (video) {
            /* A round ink seal with the play stroke, flat. */
            Box(Modifier.size(if (small) 28.dp else 40.dp).background(Kata.ink.copy(alpha = .62f), CircleShape), contentAlignment = Alignment.Center) {
                Icon(kimonoIcon("play"), "Video", tint = Color.White, modifier = Modifier.size(if (small) 14.dp else 20.dp))
            }
            face?.seconds?.let { length ->
                Text(runningTime(length), fontFamily = mono, fontSize = if (small) 10.sp else 11.sp, fontWeight = FontWeight.SemiBold, color = Color.White,
                    modifier = Modifier.align(Alignment.BottomStart).padding(if (small) 4.dp else 6.dp).background(Kata.ink.copy(alpha = .62f), RoundedCornerShape(4.dp)).padding(horizontal = 5.dp, vertical = 2.dp))
            }
        }
    }
}

/** Photos and videos in a message, as a grid of squares, up to three across; each opens as before. */
@Composable
private fun AttachedMedia(code: Code, platform: Platform, w: CodeWorkspace, files: List<CodeAttachment>) {
    var opened by remember { mutableStateOf<CodeAttachment?>(null) }
    val cols = minOf(files.size, 3)
    val edge = when (cols) { 1 -> 200.dp; 2 -> 124.dp; else -> 92.dp }
    Column(Modifier.width(edge * cols + 4.dp * (cols - 1)), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        files.chunked(cols).forEach { row ->
            Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                row.forEach { a -> MediaSquare(platform, "${w.id}:${a.path}", a.name, a.isVideo, Modifier.weight(1f), onClick = { opened = a }) { code.attachment(w.id, a) } }
                repeat(cols - row.size) { Spacer(Modifier.weight(1f)) }
            }
        }
    }
    opened?.let { a -> OpenAttachment(code, platform, w, a) { opened = null } }
}

/** A photo or video waiting in the message box: its square, ink while it uploads, and a way to take it out. */
@Composable
internal fun PendingMedia(platform: Platform, key: String, name: String, video: Boolean, busy: Boolean, onRemove: () -> Unit, onOpen: (() -> Unit)? = null, load: suspend () -> ByteArray?) {
    Box(Modifier.size(72.dp)) {
        MediaSquare(platform, key, name, video, Modifier.fillMaxSize(), small = true, onClick = onOpen, load = load)
        if (busy) Box(Modifier.matchParentSize().clip(RoundedCornerShape(12.dp)).background(MaterialTheme.colorScheme.surface.copy(alpha = .55f)), contentAlignment = Alignment.Center) { InkLoader(size = 18.dp) }
        Box(Modifier.align(Alignment.TopEnd).padding(2.dp).size(28.dp).clip(CircleShape).clickable(onClickLabel = "Remove $name", onClick = onRemove), contentAlignment = Alignment.Center) {
            Box(Modifier.size(22.dp).background(Kata.ink.copy(alpha = .62f), CircleShape), contentAlignment = Alignment.Center) {
                Icon(kimonoIcon("close"), "Remove $name", tint = Color.White, modifier = Modifier.size(12.dp))
            }
        }
    }
}

/** Shows a file waiting in the message box in the phone's own viewer (Quick Look, or the app that opens it). */
internal suspend fun previewPending(platform: Platform, name: String, mimeType: String?, load: suspend () -> ByteArray?) {
    val bytes = runCatching { load() }.getOrNull() ?: return
    runCatching { platform.openFile(cacheFile(platform, "pending", name, bytes), mimeType) }
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
    val shown = chosen ?: false
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

/** A card's time left, in words; only when the job or its tool said. */
private fun leftWords(seconds: Double) = when {
    seconds < 10 -> "almost done"
    seconds < 90 -> "about ${(seconds / 5).roundToInt() * 5} s left"
    else -> "about ${(seconds / 60).roundToInt()} min left"
}

/**
 * How a long job's card stands, as lib/code/progress-card.ts reads it on the web: the job's own word as Kimono
 * read it from the sandbox, else what the agent last reported. No guess from the clock.
 */
private class Card(val label: String, val state: String, val stopped: Boolean, val status: String?, val percent: Double?, val left: Double?) {
    fun words(failedSteps: Int): String {
        val words = when {
            state == "done" -> listOf("Done", status?.takeIf { it != "Finished" })
            state == "failed" -> listOf("Didn't finish", status)
            stopped -> listOf("Stopped", percent?.let { "at ${it.roundToInt()}%" })
            else -> listOf(status, percent?.let { "${it.roundToInt()}%" }, left?.let { leftWords(it) })
        } + (if (failedSteps > 0) "$failedSteps step${if (failedSteps == 1) "" else "s"} failed" else null)
        return words.filterNotNull().joinToString(" · ").ifEmpty { "Working on it" }
    }
}

private fun cardOf(calls: List<ToolCall>, live: Boolean): Card {
    val startCall = calls.last { it.event.progress?.label != null }
    val start = startCall.event.progress!!
    val later = calls.mapNotNull { it.event.progress }.filter { it.at >= start.at }
    val said = later.lastOrNull { it.status != null }
    val probe = startCall.probe
    val state = probe?.state ?: if (later.any { it.done }) "done" else "running"
    val stopped = state == "running" && !live && probe?.watched != true
    val left = if (state != "running") null else if (probe != null) probe.left else said?.left
    return Card(start.label ?: "", state, stopped, probe?.status ?: said?.status, if (state == "done") 100.0 else probe?.percent ?: said?.percent, left)
}

/**
 * A long piece of work as one card: what it's doing and how far it really is. The bar fills only with a percent
 * the job itself gave; until then it's the open wave. Kimono reads the job's state from the sandbox while it runs,
 * so the card moves by itself. The kimono-progress bookkeeping isn't shown; any other steps open under it.
 */
@Composable
private fun ProgressGroup(code: Code, marks: AiMarks, calls: List<ToolCall>, live: Boolean, open: (String) -> Unit) {
    val card = cardOf(calls, live)
    val steps = calls.filter { it.event.progress?.only != true }
    val failed = steps.count { it.result?.ok == false && it.event.label != "Ran" }
    val done = card.state == "done"
    val ended = done || card.state == "failed" || card.stopped
    val apps = calls.mapNotNull { it.event.app }.distinct().take(3)
    var shown by remember { mutableStateOf(false) }
    Column(Modifier.fillMaxWidth()) {
        Surface(onClick = { if (steps.isNotEmpty()) shown = !shown }, enabled = steps.isNotEmpty(), shape = RoundedCornerShape(20.dp), color = MaterialTheme.colorScheme.surfaceContainer, modifier = Modifier.fillMaxWidth()) {
            Row(Modifier.padding(horizontal = 14.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Box(Modifier.size(34.dp).clip(RoundedCornerShape(11.dp)).background(MaterialTheme.colorScheme.surfaceContainerLowest), contentAlignment = Alignment.Center) {
                    if (done) Icon(kimonoIcon("check"), "Done", modifier = Modifier.size(18.dp), tint = MaterialTheme.colorScheme.primary)
                    else if (!ended) InkLoader(size = 18.dp)
                    else Icon(kimonoIcon("gear"), null, modifier = Modifier.size(16.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text(card.label, style = MaterialTheme.typography.titleSmall, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
                        apps.forEach { app -> AppLogo(code, app, 16.dp, pro = calls.any { it.event.app == app && it.event.pro }) }
                    }
                    /* Kimono's own wavy ink bar, only once there's a real percent: before that the shape above says it's working */
                    val percent = card.percent
                    if (!ended && percent != null) app.kimono.ui.InkWaveBar({ (percent / 100).toFloat() }, Modifier.fillMaxWidth().height(10.dp), null)
                    Text(card.words(failed), style = MaterialTheme.typography.labelSmall, color = if (card.state == "failed") MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant)
                }
                if (steps.isNotEmpty()) Icon(kimonoIcon("chevron"), null, modifier = Modifier.size(14.dp).rotate(if (shown) 90f else 0f), tint = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        if (shown) Column(Modifier.padding(start = 6.dp, top = 4.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            steps.forEach { call -> ToolRow(code, marks, call, open) }
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

/* What someone says next that shows how an answer landed: put out, or pleased (as on the website). */
private val putOut = Regex("\\b(wtf|useless|stupid|terrible|awful|garbage|annoying|frustrat\\w*|ridiculous|(that'?s|it'?s|still|all) wrong|still (broken|not|doesn'?t|isn'?t)|not what i (asked|wanted|meant|said)|why (did|would|do) you|you (didn'?t|keep|never|ignored))\\b|\uD83D\uDE21|\uD83E\uDD2C|\uD83D\uDE24|\uD83D\uDE44|!{3,}", RegexOption.IGNORE_CASE)
private val pleased = Regex("\\b(thanks?|thank you|thx|ty|perfect|great|awesome|amazing|excellent|brilliant|love (it|this|that)|nice|exactly|well done|good job|works now|that works|you'?re the best)\\b|\uD83D\uDE4F|\u2764|\uD83C\uDF89|\uD83D\uDC4D|\uD83D\uDE0D|\uD83E\uDD70", RegexOption.IGNORE_CASE)
private fun shouting(text: String): Boolean { val letters = text.filter { it in 'A'..'Z' || it in 'a'..'z' }; return letters.length >= 8 && letters == letters.uppercase() }
private fun feeling(text: String) = putOut.containsMatchIn(text) || pleased.containsMatchIn(text) || shouting(text)
/* A reply this slow is worth a word on. */
private const val SLOW_REPLY = 2 * 60_000L

/** The answer worth a thumb, when one isn't given yet: the last one or the one before, if what came after it sounds put out or pleased, or the last one if it took long. */
private fun askingFor(items: List<Item>, ratings: Map<Long, Int>): Long? {
    val dones = items.indices.filter { (items[it] as? Item.Done)?.event?.cancelled == false }
    dones.takeLast(2).reversed().forEachIndexed { i, at ->
        val done = items[at] as Item.Done
        if (ratings[done.key] != null) return@forEachIndexed
        val next = (at + 1 until items.size).firstOrNull { items[it] is Item.Done } ?: items.size
        if (items.subList(at + 1, next).any { it is Item.Ask && feeling(it.event.text) }) return done.key
        if (i == 0 && (done.event.durationMs ?: 0) >= SLOW_REPLY) return done.key
    }
    return null
}

@Composable
private fun DoneNote(e: CodeEvent.Done, answer: String, rating: Int?, asking: Boolean, reply: String? = null, rate: (Int?, String?) -> Unit) {
    @Suppress("DEPRECATION") val clipboard = androidx.compose.ui.platform.LocalClipboardManager.current
    var copied by remember { mutableStateOf(false) }
    LaunchedEffect(copied) { if (copied) { kotlinx.coroutines.delay(1500); copied = false } }
    /* A thumb holds as soon as it's given; then there's room to say why, and who sees it. */
    var confirming by remember { mutableStateOf<Int?>(null) }
    val give = { next: Int -> if (rating == next) rate(null, null) else { rate(next, null); confirming = next } }
    val thumbs: @Composable () -> Unit = {
        Row(verticalAlignment = Alignment.CenterVertically) {
            /* An answer worth a thumb (they sound put out or pleased, or it took long): the thumbs come forward and ask. */
            androidx.compose.animation.AnimatedVisibility(asking && rating == null, enter = androidx.compose.animation.fadeIn() + androidx.compose.animation.slideInHorizontally { it / 4 }, exit = androidx.compose.animation.fadeOut()) {
                Text("How was this?", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(end = 2.dp))
            }
            val idle = if (asking) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant
            /* The answer's words, to paste elsewhere; a tick for a moment says it's done. */
            if (answer.isNotBlank()) IconButton(onClick = { clipboard.setText(AnnotatedString(answer.trim())); copied = true }, modifier = Modifier.size(36.dp)) {
                Icon(kimonoIcon(if (copied) "check" else "copy"), if (copied) "Copied" else "Copy answer", modifier = Modifier.size(18.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            IconButton(onClick = { give(1) }, modifier = Modifier.size(36.dp)) { Icon(kimonoIcon("thumb-up"), "Good answer", modifier = Modifier.size(18.dp), tint = if (rating == 1) MaterialTheme.colorScheme.primary else idle) }
            IconButton(onClick = { give(-1) }, modifier = Modifier.size(36.dp)) { Icon(kimonoIcon("thumb-down"), "Bad answer", modifier = Modifier.size(18.dp), tint = if (rating == -1) MaterialTheme.colorScheme.primary else idle) }
        }
    }
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
    when {
        e.cancelled -> Note(null, "Stopped.")
        !e.ok -> Surface(shape = RoundedCornerShape(20.dp), color = MaterialTheme.colorScheme.errorContainer, modifier = Modifier.fillMaxWidth()) {
            Row(Modifier.padding(start = 14.dp, top = 6.dp, bottom = 6.dp, end = 4.dp), horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
                Icon(kimonoIcon("close"), null, modifier = Modifier.size(16.dp), tint = MaterialTheme.colorScheme.onErrorContainer)
                Text(e.error ?: "It stopped with an error.", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onErrorContainer, modifier = Modifier.weight(1f))
                thumbs()
            }
        }
        /* Which Claude answered, and how long it took. Never what it cost. */
        else -> Row(verticalAlignment = Alignment.CenterVertically) {
            Note(null, listOfNotNull(e.model?.let { modelNames[it] }, e.durationMs?.let { elapsedText(it) }).joinToString(" · "), Modifier.weight(1f))
            thumbs()
        }
    }
    if (reply != null && !e.cancelled) Surface(shape = RoundedCornerShape(16.dp), color = MaterialTheme.colorScheme.surfaceContainer, modifier = Modifier.fillMaxWidth()) {
        Row(Modifier.padding(horizontal = 14.dp, vertical = 10.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Icon(kimonoIcon(if (rating == 1) "thumb-up" else "thumb-down"), null, modifier = Modifier.padding(top = 2.dp).size(16.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
            Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text("Thank you for your feedback!", style = MaterialTheme.typography.bodyMedium.copy(fontWeight = androidx.compose.ui.text.font.FontWeight.SemiBold))
                if (reply.isNotBlank()) Text(reply, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
    }
    confirming?.let { next ->
        var note by remember(next) { mutableStateOf("") }
        InkDialog(
            title = if (next == 1) "Good answer" else "Bad answer",
            icon = if (next == 1) "thumb-up" else "thumb-down",
            onDismiss = { confirming = null },
            actions = {
                Seal("Skip", compact = true, tone = SealTone.Quiet, onClick = { confirming = null })
                Seal("Send", compact = true, onClick = { rate(next, note.trim().ifBlank { null }); confirming = null })
            },
        ) {
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text("Admins can see this answer and your feedback. Your name isn’t attached.", style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    OutlinedTextField(note, { note = it.take(2000) }, placeholder = { Text(if (next == 1) "What was good? (optional)" else "What went wrong? (optional)") }, minLines = 2, modifier = Modifier.fillMaxWidth())
                }
        }
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
private class Pending(val name: String, val size: Long, val type: String? = null, val file: PickedFile? = null) {
    val key = "pending:${kotlin.random.Random.nextLong()}"
    var attachment by mutableStateOf<CodeAttachment?>(null)
    var failed by mutableStateOf<String?>(null)
    /** Bytes uploaded so far, for one over 20 MB on its way to the chat's Drive folder. */
    var sent by mutableStateOf<Long?>(null)
}

/** "42%" of a big file on its way, or null for one that attaches in one go. */
internal fun sentShare(sent: Long?, size: Long): String? = if (sent == null || size <= 0) null else "${minOf(99L, sent * 100 / size)}%"

/**
 * A name edited where it sits: the same words in the same type, selected, an ink line drawn under them.
 * Done on the keyboard, or tapping away, keeps it; an empty or unchanged name leaves it as it was.
 */
@Composable
internal fun InlineName(initial: String, style: androidx.compose.ui.text.TextStyle, modifier: Modifier = Modifier, onSave: suspend (String) -> Unit, onEnd: () -> Unit) {
    var value by remember { mutableStateOf(androidx.compose.ui.text.input.TextFieldValue(initial, androidx.compose.ui.text.TextRange(0, initial.length))) }
    val focus = remember { FocusRequester() }
    val scope = rememberCoroutineScope()
    var focused by remember { mutableStateOf(false) }
    var done by remember { mutableStateOf(false) }
    fun finish() {
        if (done) return
        done = true
        val name = value.text.replace(Regex("\\s+"), " ").trim()
        scope.launch { try { if (name.isNotEmpty() && name != initial) onSave(name) } catch (_: KimonoProblem) { }; onEnd() }
    }
    LaunchedEffect(Unit) { focus.requestFocus() }
    val ink = MaterialTheme.colorScheme.primary
    BasicTextField(
        value, { if (it.text.contains('\n')) finish() else value = it }, singleLine = true,
        textStyle = style.copy(color = MaterialTheme.colorScheme.onSurface),
        cursorBrush = androidx.compose.ui.graphics.SolidColor(ink),
        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
        keyboardActions = androidx.compose.foundation.text.KeyboardActions(onDone = { finish() }),
        modifier = modifier.focusRequester(focus)
            /* Return on a hardware keyboard keeps it too, as Done does on the screen's */
            .onPreviewKeyEvent { if (it.key == androidx.compose.ui.input.key.Key.Enter && it.type == androidx.compose.ui.input.key.KeyEventType.KeyDown) { finish(); true } else false }
            .onFocusChanged { if (it.isFocused) focused = true else if (focused) finish() }
            .drawBehind { val y = size.height + 1.dp.toPx(); drawLine(ink, androidx.compose.ui.geometry.Offset(0f, y), androidx.compose.ui.geometry.Offset(size.width, y), 1.5.dp.toPx()) },
    )
}

/**
 * Send and Stop are one square seal: while the agent works and nothing is written it stops it; a word
 * typed turns it back into Send. The arrow lifts away as the square turns in, the seal's ink changing with it.
 */
@Composable
internal fun SendStop(stop: Boolean, enabled: Boolean, busy: Boolean = false, onSend: () -> Unit, onStop: () -> Unit = {}) {
    val turn by androidx.compose.animation.core.animateFloatAsState(if (stop) 1f else 0f, androidx.compose.animation.core.spring(dampingRatio = 0.62f, stiffness = 380f), label = "send-stop")
    val scheme = MaterialTheme.colorScheme
    val face by androidx.compose.animation.animateColorAsState(when { stop -> scheme.errorContainer; enabled -> scheme.primary; else -> scheme.surfaceContainerHighest }, label = "send-stop-face")
    val ink by androidx.compose.animation.animateColorAsState(when { stop -> scheme.onErrorContainer; enabled -> scheme.onPrimary; else -> scheme.onSurfaceVariant }, label = "send-stop-ink")
    Surface(onClick = { if (stop) onStop() else onSend() }, enabled = enabled && !busy, shape = RoundedCornerShape(14.dp), color = face, modifier = Modifier.size(44.dp).semantics { contentDescription = if (stop) "Stop" else "Send" }) {
        Box(contentAlignment = Alignment.Center) {
            if (busy) InkLoader(size = 22.dp)
            else {
                val lift = turn.coerceIn(0f, 1f)
                Icon(kimonoIcon("send"), null, tint = ink, modifier = Modifier.size(22.dp).graphicsLayer {
                    alpha = 1f - lift; translationY = -14.dp.toPx() * lift; scaleX = 1f - .3f * lift; scaleY = 1f - .3f * lift
                })
                Box(Modifier.size(14.dp).graphicsLayer {
                    alpha = lift; rotationZ = -90f * (1f - turn); scaleX = .3f + .7f * turn; scaleY = .3f + .7f * turn
                }.background(ink, RoundedCornerShape(3.dp)))
            }
        }
    }
}

/** The chat's settings and usage, behind one button in the top bar so the writing line keeps its room. */
@Stable
internal class UsageTop {
    var open by mutableStateOf(false)
    var shown by mutableStateOf<ShownMeters?>(null)
}

/**
 * Model, thinking, files and usage, in the top bar: the fullest meter as a ring once one is past half,
 * a gear otherwise. Narrower than a full icon button, beside the bar's others.
 */
@Composable
private fun UsageButton(top: UsageTop) {
    val shown = top.shown
    IconButton(onClick = { top.open = true }, modifier = Modifier.size(40.dp).semantics { contentDescription = "Settings and usage" }) {
        if (shown != null && shown.any) Ring(shown.most, 20.dp) else Icon(kimonoIcon("gear"), null, modifier = Modifier.size(20.dp))
    }
}

@Composable
private fun Composer(code: Code, drive: Drive, platform: Platform, marks: AiMarks, w: CodeWorkspace, context: ContextUse?, usageTop: UsageTop, standIn: (@Composable () -> Unit)? = null) {
    var choosing by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    var text by remember(w.id) { mutableStateOf(code.recall("draft:${w.id}") ?: "") }
    val pending = remember(w.id) { mutableStateListOf<Pending>() }
    var problem by remember { mutableStateOf<String?>(null) }
    var sending by remember { mutableStateOf(false) }
    /* The person's usage, for the ring in the top bar, again after each turn. */
    val usage by produceState<Usage?>(null, w.id, w.running) { value = runCatching { code.usage(w.id) }.getOrNull() }
    val shown = ShownMeters.of(usage, context?.let { it.used.toDouble() / (it.window ?: 200_000) })
    androidx.compose.runtime.SideEffect { usageTop.shown = shown }
    /* A different model than the one this chat has been on has to take in the whole chat again. */
    val model by code.model.collectAsState()
    val switching = w.lastModel?.takeIf { model != "auto" && model != it }
    val uploading = pending.any { it.attachment == null && it.failed == null }
    val ready = pending.mapNotNull { it.attachment }
    val canSend = !sending && !uploading && (text.isNotBlank() || ready.isNotEmpty())
    val keyboard = androidx.compose.ui.platform.LocalSoftwareKeyboardController.current
    val focus = androidx.compose.ui.platform.LocalFocusManager.current
    val dictation = rememberDictation(code, platform, onText = { said -> val kept = joinSaid(text, said).take(MAX_MESSAGE); text = kept; code.keep("draft:${w.id}", kept) }, onProblem = { problem = it })
    fun send() {
        if (!canSend) return
        /* Sending puts the keyboard away, so the answer can be read as it comes. */
        focus.clearFocus(); keyboard?.hide()
        sending = true; problem = null
        scope.launch {
            try {
                val quote = replyQuote
                code.ask(w.id, if (quote != null && text.isNotBlank()) withQuote(quote, text) else text, ready)
                text = ""; replyQuote = null; code.keep("draft:${w.id}", null); pending.clear()
            } catch (p: KimonoProblem) { problem = p.message }
            sending = false
        }
    }
    /* A question it asked stands in the bar's place; the settings sheet and what was written stay. */
    if (standIn != null) standIn()
    else Column(Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.surface).bottomChrome().imePadding().padding(start = 12.dp, end = 12.dp, top = 6.dp, bottom = 4.dp)) {
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
                    items(pending.toList()) { p ->
                        val file = p.file
                        val done = p.attachment
                        val open: (() -> Unit)? = when {
                            p.failed != null -> null
                            file != null -> ({ scope.launch { previewPending(platform, p.name, p.type) { readAll(file) } } })
                            done != null -> ({ scope.launch { previewPending(platform, p.name, done.type) { code.attachment(w.id, done) } } })
                            else -> null
                        }
                        when {
                            p.failed == null && file != null && file.size <= Code.MAX_ATTACHMENT && (isPictureFile(p.name, p.type) || isVideoFile(p.name, p.type)) ->
                                PendingMedia(platform, p.key, p.name, isVideoFile(p.name, p.type), busy = done == null, onRemove = { pending.remove(p) }, onOpen = open) { readAll(file) }
                            p.failed == null && done != null && done.isMedia ->
                                PendingMedia(platform, "${w.id}:${done.path}", p.name, done.isVideo, busy = false, onRemove = { pending.remove(p) }, onOpen = open) { code.attachment(w.id, done) }
                            else -> {
                                /* A big file shows how far its upload got instead of the spinner. */
                                val share = if (p.attachment == null && p.failed == null) sentShare(p.sent, p.size) else null
                                FileChip(p.name, p.failed ?: share ?: readableSize(p.size), failed = p.failed != null, busy = p.attachment == null && p.failed == null && share == null, onOpen = open) { pending.remove(p) }
                            }
                        }
                    }
                }
                QuoteAboveBox()
                SlashCommands(code, text) { val kept = it; text = kept; code.keep("draft:${w.id}", kept) }
                /* As in any chat app: attach beside the words, Send at their end, on one line; as the words grow, both stay on their last line. */
                Box {
                Row(verticalAlignment = Alignment.Bottom) {
                    val attach: (suspend () -> List<app.kimono.data.PickedFile>) -> Unit = { pick ->
                        scope.launch {
                            val picked = pick().take(10 - pending.size)
                            for (file in picked) {
                                val item = Pending(file.name, file.size, file.mimeType, file)
                                pending += item
                                when {
                                    file.size > Code.LARGEST_ATTACHMENT -> item.failed = "Over 4 GB"
                                    file.size > Code.MAX_ATTACHMENT && !w.isOwner -> item.failed = "Over 20 MB"
                                    else -> launch { try { item.attachment = code.attach(w.id, file) { item.sent = it } } catch (p: KimonoProblem) { item.failed = p.message ?: "Didn't attach" } }
                                }
                            }
                        }
                    }
                    AttachMenu(
                        onDevice = { attach { platform.pickFiles() } },
                        onDrive = if (w.drive != null && w.isOwner) ({ choosing = true }) else null,
                        onPhotos = if (platform.photoPicker) ({ attach { platform.pickMedia() } }) else null,
                    )
                    MessageField(
                        code,
                        /* the longest message it takes (the server refuses more) */
                        value = text, onValueChange = { val kept = it.take(MAX_MESSAGE); text = kept; code.keep("draft:${w.id}", kept); if (kept.isNotBlank()) scope.launch { code.warm(w.id) } },
                        maxLines = 8,
                        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Default),
                        onLongPaste = { said -> attach { listOf(PastedText(said, pending.map { it.name })) } },
                        modifier = Modifier.weight(1f).heightIn(min = 44.dp).padding(horizontal = 4.dp, vertical = 11.dp),
                        decorationBox = { inner -> Box { if (text.isEmpty()) Text("Ask for a change, or reply", style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis); inner() } },
                    )
                    if (dictation != null) MicButton(dictation)
                    /* One seal: Stop while it works and nothing is written, Send otherwise. */
                    val stopping = w.running && text.isBlank() && pending.isEmpty()
                    SendStop(stop = stopping, enabled = stopping || canSend, busy = sending, onSend = { send() }, onStop = { scope.launch { try { code.stop(w.id) } catch (p: KimonoProblem) { problem = p.message } } })
                }
                DictationStrip(dictation)
                }
                if (problem != null) Box(Modifier.padding(horizontal = 8.dp, vertical = 2.dp)) { Problem(problem) }
            }
        }
    }
    if (usageTop.open) MetersSheet(code, w, context, usage, all = true, settings = {
        if (w.drive != null && w.isOwner && marks.spaces.isNotEmpty()) SettingRow("Files") { AccessChip(code) }
        SettingRow("Model") { ModelChip(code) }
        SettingRow("Thinking") { EffortChip(code) }
    }) { usageTop.open = false }
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
    InkSheet(onDismissRequest = close, sheetState = sheet) {
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
            u?.media?.takeIf { all || shown.tools != null }?.let { m ->
                UsageRow("Pro Tools", m.fraction, m.words?.let { w -> "$w${resetWords(m.resetsAt)?.let { " · resets $it" } ?: ""}" } ?: "Not reported yet", icon = "bolt")
                /* People take the Pro Tools budget for their plan: running out never stops Kimono AI. */
                Text("If Pro Tools run out, Kimono AI keeps working. Only Pro Tools stop${resetWords(m.resetsAt)?.let { " until $it" } ?: " until they reset"}.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
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
    InkSheet(onDismissRequest = onDismiss, sheetState = sheet) {
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
                                    leadingContent = { InkCrest(space.crest, space.color, 24.dp, seed = space.id) },
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
private fun MdText(text: String, style: TextStyle, codeBg: Color, link: Color, modifier: Modifier = Modifier, fadeTail: Boolean = false, tip: Boolean = false) {
    val (inlined, maths) = remember(text, codeBg, link) { inline(text, codeBg, link) }
    /* A reply still being written: Material's loading indicator rides just after its last word, on its line. */
    val plainAnnotated = if (!tip) inlined else remember(inlined) {
        androidx.compose.ui.text.buildAnnotatedString { append(inlined); append("\u2009"); appendInlineContent("tip", "…") }
    }
    val tipContent = if (!tip) emptyMap() else mapOf("tip" to androidx.compose.foundation.text.InlineTextContent(
        androidx.compose.ui.text.Placeholder(1.15.em, 1.15.em, androidx.compose.ui.text.PlaceholderVerticalAlign.TextCenter),
    ) { androidx.compose.material3.LoadingIndicator(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.primary) })
    /* the end of a reply being written: its last letters fade from full ink to faint, so new words fade in */
    val annotated = if (!fadeTail) plainAnnotated else remember(plainAnnotated, style.color) {
        val builder = androidx.compose.ui.text.AnnotatedString.Builder(plainAnnotated)
        val n = minOf(28, plainAnnotated.length)
        for (k in 0 until n) {
            val at = plainAnnotated.length - 1 - k
            /* the last letter at 15% ink, rising evenly to full ink [n] letters back */
            builder.addStyle(androidx.compose.ui.text.SpanStyle(color = style.color.copy(alpha = style.color.alpha * (.15f + .85f * k / n))), at, at + 1)
        }
        builder.toAnnotatedString()
    }
    if (maths.isEmpty()) { Text(annotated, style = style, inlineContent = tipContent, modifier = modifier); return }
    val config = remember(style.fontSize, style.color) { mathConfig(style) }
    val measurer = rememberLatexMeasurer(config)
    val dark = isSystemInDarkTheme()
    val content = remember(maths, measurer, dark) {
        maths.withIndex().mapNotNull { (k, tex) -> measurer.inlineContent("\\textstyle ${mathSource(tex)}", config, dark)?.let { "math$k" to it } }.toMap()
    }
    Text(annotated, style = style, inlineContent = content + tipContent, modifier = modifier)
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

/**
 * A reply as it's written. Words reach the phone in bursts of any size; they're let out a word at a
 * time and the newest few letters are drawn fading, so each word fades in as the end of the reply
 * moves past it. It never holds the reply back: whatever has arrived is out within about a fifth of
 * a second, however fast it comes.
 */
@Composable
private fun DraftWords(text: String) = RevealWords(text, tip = true)

/* How far the reply being written has been let out. A finished reply that takes its draft's place
   carries on from here instead of jumping to its end; any other starts from its first word. */
private object Revealed { var text = ""; var at = 0 }

/** Lets [text] out from [from] (or where its draft got to): at least 150 letters a second, and faster the further behind it is. */
@Composable
private fun RevealWords(text: String, from: Int? = null, tip: Boolean = false, onShown: (Int) -> Unit = {}) {
    val latest by androidx.compose.runtime.rememberUpdatedState(text)
    val report by androidx.compose.runtime.rememberUpdatedState(onShown)
    var shown by remember {
        mutableStateOf(when {
            from != null && from in 0..text.length -> from
            Revealed.at in 1..text.length && text.startsWith(Revealed.text.take(Revealed.at)) -> Revealed.at
            else -> 0
        })
    }
    LaunchedEffect(Unit) {
        var last = 0L
        var owed = 0f
        while (true) {
            androidx.compose.runtime.withFrameMillis { now ->
                val step = if (last == 0L) 16L else (now - last).coerceIn(0L, 100L)
                last = now
                val goal = latest.length
                /* a shorter text is a new reply: start it from the top */
                if (shown > goal) shown = 0
                if (shown < goal) {
                    /* what's waiting goes out within ~200 ms; never slower than 150 letters a second */
                    owed += step * maxOf(.15f, (goal - shown) / 200f)
                    if (owed >= 1f) {
                        var next = minOf(goal, shown + owed.toInt())
                        owed -= owed.toInt()
                        val space = latest.substring(next).indexOfFirst { it.isWhitespace() }
                        next = if (space < 0 || space > 24) next else minOf(goal, next + space)
                        shown = next
                        report(shown)
                    }
                } else owed = 0f
                Revealed.text = latest; Revealed.at = shown
            }
        }
    }
    /* once it's all out, it's drawn as any reply is */
    /* A draft keeps its loading indicator just after its last word: more is on its way. */
    if (tip) Markdown(text.take(shown), fadeTail = shown < text.length, tip = true)
    else if (shown >= text.length) Markdown(text) else Markdown(text.take(shown), fadeTail = true)
}

@Composable
private fun Markdown(source: String, fadeTail: Boolean = false, tip: Boolean = false) {
    val lines = remember(source) { source.replace("\r\n", "\n").split('\n') }
    val style = MaterialTheme.typography.bodyLarge.copy(color = MaterialTheme.colorScheme.onSurface)
    val codeBg = MaterialTheme.colorScheme.surfaceContainerHighest
    val link = MaterialTheme.colorScheme.primary
    AnswerSelection {
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
                        val closed = i < lines.size
                        i++
                        /* Quran and hadith are cited by reference and shown from their sources (Scripture.kt) */
                        if (lang == "quran" || lang == "hadith" || lang == "islam-notice") ScriptureBlock(lang, body.joinToString("\n"), closed)
                        else Box(Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(Urushi).padding(vertical = 10.dp)) { app.kimono.ui.CodeLines(body.joinToString("\n"), "x.${lang.ifEmpty { "txt" }}") }
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
                        var n = Regex("^\\s*(\\d+)").find(line)?.groupValues?.get(1)?.toIntOrNull() ?: 1
                        while (i < lines.size) {
                            /* a loose list (a blank line between items) is still one list: it keeps counting */
                            if (lines[i].isBlank()) {
                                var j = i
                                while (j < lines.size && lines[j].isBlank()) j++
                                if (j < lines.size && Regex("^\\s*([-*+]|\\d+[.)])\\s+").containsMatchIn(lines[j])) { i = j; continue } else break
                            }
                            if (!Regex("^\\s*([-*+]|\\d+[.)])\\s+").containsMatchIn(lines[i])) break
                            val depth = (lines[i].length - lines[i].trimStart().length) / 2
                            val item = lines[i].replace(Regex("^\\s*([-*+]|\\d+[.)])\\s+"), "")
                            val endsIt = fadeTail && lines.drop(i + 1).all { it.isBlank() }
                            Row(Modifier.padding(start = (depth * 16).dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                Text(if (ordered) "${n}." else "•", style = style)
                                MdText(item, style, codeBg, link, fadeTail = endsIt, tip = tip && lines.drop(i + 1).all { it.isBlank() })
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
                        MdText(body.joinToString("\n"), style, codeBg, link, fadeTail = fadeTail && lines.drop(i).all { it.isBlank() }, tip = tip && lines.drop(i).all { it.isBlank() })
                    }
                }
            }
        }
    }
    }
}


/**
 * The / menu: while the box holds "/" and the start of a command, the
 * commands of the skills the person turned on (For you), to tap into
 * the box. Loaded once, the first time a "/" is typed.
 */
@Composable
internal fun SlashCommands(code: Code, text: String, pick: (String) -> Unit) {
    val typed = Regex("^/([a-z-]*)$").find(text)?.groupValues?.get(1) ?: return
    val shown = commandsOf(code, text).filter { it.name.startsWith(typed) }
    if (shown.isEmpty()) return
    Surface(shape = RoundedCornerShape(20.dp), color = MaterialTheme.colorScheme.surfaceContainerHigh, modifier = Modifier.fillMaxWidth().padding(bottom = 6.dp)) {
        Column(Modifier.padding(4.dp)) {
            shown.forEach { c ->
                Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).clickable { pick("/${c.name} ") }.padding(horizontal = 14.dp, vertical = 9.dp)) {
                    Text(buildString { append("/"); append(c.name); c.hint?.let { append(" "); append(it) } }, style = MaterialTheme.typography.labelLarge)
                    if (c.does.isNotEmpty()) Text(c.does, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }
    }
}

/** The commands of the skills that are on, fetched once the box starts with "/" (and kept for the screen). */
@Composable
private fun commandsOf(code: Code, text: String): List<SkillCommand> {
    var commands by remember { mutableStateOf<List<SkillCommand>?>(null) }
    val wanted = text.startsWith("/")
    LaunchedEffect(wanted) { if (wanted && commands == null) commands = runCatching { code.skills().filter { it.enabled }.mapNotNull { it.command } }.getOrDefault(emptyList()) }
    return commands.orEmpty()
}

/**
 * The message box. Words come in and go out as a String, as before; when they're
 * set from outside (a command picked, a draft restored) the cursor goes to their
 * end, and a command they start with is picked out in the accent, in bold.
 */
@Composable
internal fun MessageField(
    code: Code, value: String, onValueChange: (String) -> Unit, maxLines: Int, modifier: Modifier,
    keyboardOptions: KeyboardOptions = KeyboardOptions.Default,
    decorationBox: @Composable (inner: @Composable () -> Unit) -> Unit,
    /** Words pasted in one go that are too long for the box; they stay out of it. */
    onLongPaste: ((String) -> Unit)? = null,
) {
    var field by remember { mutableStateOf(TextFieldValue(value, TextRange(value.length))) }
    val current = if (field.text == value) field else TextFieldValue(value, TextRange(value.length)).also { field = it }
    val names = commandsOf(code, value).map { it.name }
    val accent = MaterialTheme.colorScheme.primary
    val mark = remember(names, accent) { CommandMark(names.toSet(), accent) }
    BasicTextField(
        value = current, onValueChange = { next ->
            val pasted = onLongPaste?.let { insertedText(current.text, next.text) }
            if (pasted != null && (pasted.length >= PASTE_AS_FILE || next.text.length > MAX_MESSAGE)) { onLongPaste(pasted); return@BasicTextField }
            field = next; if (next.text != value) onValueChange(next.text)
        },
        textStyle = MaterialTheme.typography.bodyLarge.copy(color = MaterialTheme.colorScheme.onSurface),
        cursorBrush = androidx.compose.ui.graphics.SolidColor(accent),
        maxLines = maxLines, keyboardOptions = keyboardOptions, visualTransformation = mark,
        modifier = modifier, decorationBox = decorationBox,
    )
}

/** The longest message the server takes. */
internal const val MAX_MESSAGE = 32_000
/** Pasted words this long, or that won't fit in the box, come in as a text file instead. */
private const val PASTE_AS_FILE = 4_000

/** What one change put in the middle of [before] to make [after] (what it replaced is gone), or null when nothing longer than a few letters went in. */
private fun insertedText(before: String, after: String): String? {
    if (after.length - before.length < 2) return null
    var head = 0
    while (head < before.length && head < after.length && before[head] == after[head]) head++
    var tail = 0
    while (tail < before.length - head && tail < after.length - head && before[before.length - 1 - tail] == after[after.length - 1 - tail]) tail++
    return after.substring(head, after.length - tail)
}

/** Words that came in as a file: "Pasted text.txt", then "Pasted text 2.txt" beside one already there. */
internal class PastedText(text: String, taken: List<String>) : PickedFile {
    private val bytes = text.encodeToByteArray()
    override val name = generateSequence(1) { it + 1 }.map { if (it == 1) "Pasted text.txt" else "Pasted text $it.txt" }.first { it !in taken }
    override val size = bytes.size.toLong()
    override val mimeType = "text/plain"
    override suspend fun read(offset: Long, max: Int): ByteArray = bytes.copyOfRange(offset.toInt().coerceAtMost(bytes.size), (offset + max).toInt().coerceAtMost(bytes.size))
}

/** Draws a leading "/command" that is one of [names] in the accent, bold, on a light wash of it. Letters only change look, so the cursor's places stay the same. */
private class CommandMark(val names: Set<String>, val accent: androidx.compose.ui.graphics.Color) : VisualTransformation {
    override fun filter(text: AnnotatedString): TransformedText {
        val name = Regex("^/([a-z0-9-]+)(?=\\s|$)").find(text.text)?.groupValues?.get(1)
        if (name == null || name !in names) return TransformedText(text, OffsetMapping.Identity)
        val marked = buildAnnotatedString {
            append(text)
            addStyle(SpanStyle(color = accent, fontWeight = FontWeight.Bold, background = accent.copy(alpha = .14f)), 0, name.length + 1)
        }
        return TransformedText(marked, OffsetMapping.Identity)
    }
    override fun equals(other: Any?) = other is CommandMark && other.names == names && other.accent == accent
    override fun hashCode() = names.hashCode() * 31 + accent.hashCode()
}


/* ── replying to part of an answer ── */

/** What the next message answers: words chosen in one of its answers, until it's sent or dropped. One chat is open at a time. */
internal var replyQuote by mutableStateOf<String?>(null)

/** A reply's words as sent: the part it answers, each line as "> ", then a blank line and what they wrote. Kimono reads it as a quote. */
internal fun withQuote(quote: String, words: String) = quote.trim().lines().joinToString("\n") { "> $it" } + "\n\n" + words

/** A sent message split into the part it replies to (its "> " lines at the start) and its words. */
internal fun splitQuote(text: String): Pair<String?, String> {
    val lines = text.lines()
    val quoted = lines.takeWhile { it.startsWith(">") }
    if (quoted.isEmpty()) return null to text
    val rest = lines.drop(quoted.size).dropWhile { it.isBlank() }.joinToString("\n")
    return quoted.joinToString("\n") { it.removePrefix(">").removePrefix(" ") } to rest
}

/**
 * Selected words in an answer get Kimono's own small menu (Copy, Reply) in place
 * of the system's, which can't take another item. Reply copies them, as Copy
 * does, and takes them from the clipboard as what the next message answers.
 */
@Composable
private fun AnswerSelection(content: @Composable () -> Unit) {
    var shown by remember { mutableStateOf<Pair<Rect, () -> Unit>?>(null) }
    @Suppress("DEPRECATION") val clipboard = androidx.compose.ui.platform.LocalClipboardManager.current
    val toolbar = remember {
        object : TextToolbar {
            override var status = TextToolbarStatus.Hidden
                private set
            override fun showMenu(rect: Rect, onCopyRequested: (() -> Unit)?, onPasteRequested: (() -> Unit)?, onCutRequested: (() -> Unit)?, onSelectAllRequested: (() -> Unit)?) {
                val copy = onCopyRequested ?: return
                status = TextToolbarStatus.Shown
                shown = rect to copy
            }
            override fun hide() { status = TextToolbarStatus.Hidden; shown = null }
        }
    }
    androidx.compose.runtime.CompositionLocalProvider(LocalTextToolbar provides toolbar) { content() }
    val (rect, copy) = shown ?: return
    val above = remember(rect) {
        object : PopupPositionProvider {
            override fun calculatePosition(anchorBounds: IntRect, windowSize: IntSize, layoutDirection: LayoutDirection, popupContentSize: IntSize): IntOffset {
                val x = (rect.center.x - popupContentSize.width / 2f).toInt().coerceIn(0, (windowSize.width - popupContentSize.width).coerceAtLeast(0))
                val y = (rect.top - popupContentSize.height - 16).toInt().let { if (it < 0) (rect.bottom + 16).toInt() else it }
                return IntOffset(x, y)
            }
        }
    }
    Popup(popupPositionProvider = above, onDismissRequest = { toolbar.hide() }) {
        Surface(shape = RoundedCornerShape(12.dp), color = MaterialTheme.colorScheme.inverseSurface, contentColor = MaterialTheme.colorScheme.inverseOnSurface, shadowElevation = 6.dp) {
            Row {
                TextButton(onClick = { copy(); toolbar.hide() }, colors = androidx.compose.material3.ButtonDefaults.textButtonColors(contentColor = MaterialTheme.colorScheme.inverseOnSurface)) { Text("Copy") }
                TextButton(onClick = {
                    copy()
                    clipboard.getText()?.text?.trim()?.takeIf { it.isNotEmpty() }?.let { replyQuote = it.take(2000) }
                    toolbar.hide()
                }, colors = androidx.compose.material3.ButtonDefaults.textButtonColors(contentColor = MaterialTheme.colorScheme.inverseOnSurface)) {
                    Icon(kimonoIcon("reply"), null, Modifier.size(18.dp)); Spacer(Modifier.width(6.dp)); Text("Reply")
                }
            }
        }
    }
}

/** Above the message box: the part of an answer the next message replies to, with a way to drop it. */
@Composable
internal fun QuoteAboveBox() {
    val quote = replyQuote ?: return
    val accent = MaterialTheme.colorScheme.primary
    Row(
        Modifier.fillMaxWidth().padding(horizontal = 6.dp, vertical = 4.dp).clip(RoundedCornerShape(topEnd = 10.dp, bottomEnd = 10.dp))
            .background(accent.copy(alpha = .08f)).drawBehind { drawRect(accent, size = androidx.compose.ui.geometry.Size(3.dp.toPx(), size.height)) }
            .padding(start = 12.dp, top = 6.dp, bottom = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(kimonoIcon("reply"), null, Modifier.size(16.dp), tint = accent)
        Spacer(Modifier.width(8.dp))
        Text(quote, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 3, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
        IconButton(onClick = { replyQuote = null }) { Icon(kimonoIcon("close"), "Don't reply to this", Modifier.size(16.dp)) }
    }
}


/* ── when each message was sent ── */

/** The time today ("3:41 PM"), with the day this week ("Tue 3:41 PM"), with the date before that ("3 Nov, 3:41 PM"). */
internal fun messageTime(at: Long, now: Long, offset: Long): String {
    val minutes = ((at + offset).mod(86_400_000L)) / 60_000
    val h = (minutes / 60).toInt(); val m = (minutes % 60).toInt()
    val time = "${if (h % 12 == 0) 12 else h % 12}:${m.toString().padStart(2, '0')} ${if (h < 12) "AM" else "PM"}"
    val day = (at + offset).floorDiv(86_400_000L)
    val today = (now + offset).floorDiv(86_400_000L)
    return when {
        day == today -> time
        today - day < 7 -> "${listOf("Thu", "Fri", "Sat", "Sun", "Mon", "Tue", "Wed")[day.mod(7L).toInt()]} $time"
        else -> "${noteWhen(at, now, offset)}, $time"
    }
}

/** A message slid left by [reveal] (0 to 1) with its time showing in the space it leaves. */
@Composable
private fun TimeAside(time: String?, reveal: Float, content: @Composable () -> Unit) {
    val reach = 72.dp
    Box(Modifier.fillMaxWidth()) {
        Box(Modifier.offset { androidx.compose.ui.unit.IntOffset((-reveal * reach.toPx()).toInt(), 0) }) { content() }
        if (time != null && reveal > 0f) Text(time, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1,
            modifier = Modifier.align(Alignment.CenterEnd).offset { androidx.compose.ui.unit.IntOffset(((1f - reveal) * reach.toPx()).toInt(), 0) }.alpha(reveal))
    }
}

@file:OptIn(ExperimentalMaterial3Api::class, ExperimentalMaterial3ExpressiveApi::class, androidx.compose.foundation.ExperimentalFoundationApi::class)

package app.kimono.screens

import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.DrawerValue
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExperimentalMaterial3ExpressiveApi
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ListItemDefaults
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.ModalDrawerSheet
import androidx.compose.material3.ModalNavigationDrawer
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.SnackbarDuration
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.SnackbarResult
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.rememberDrawerState
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.kimono.data.KimonoProblem
import app.kimono.data.NoteMeta
import app.kimono.data.NoteSection
import app.kimono.data.Notebook
import app.kimono.data.Notes
import app.kimono.ui.HoldSeal
import app.kimono.ui.InkBlot
import app.kimono.ui.InkBloom
import app.kimono.ui.InkCrest
import app.kimono.ui.InkLoader
import app.kimono.ui.InkPortraitFrame
import app.kimono.ui.InkRandom
import app.kimono.ui.Portrait
import app.kimono.ui.Problem
import app.kimono.ui.Seal
import app.kimono.ui.SealTone
import app.kimono.ui.inkSeed
import app.kimono.ui.kimonoIcon
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/*
 * 帳 Kimono Notes on the phone: notebooks and their sections in a drawer, as
 * Kimono AI keeps its chats; the notes of the place chosen on the main
 * screen, newest first; New note a square seal at the foot. A note opens
 * full screen (NoteEditor.kt).
 */

/** One word for when, only when it says something: "now", "12m", "2h", "Tue", "3 Nov". */
internal fun noteWhen(at: Long, now: Long, offset: Long): String {
    val minutes = (now - at) / 60_000
    if (minutes < 1) return "now"
    if (minutes < 60) return "${minutes}m"
    if (minutes < 24 * 60) return "${minutes / 60}h"
    val day = (at + offset).floorDiv(86_400_000L)
    val today = (now + offset).floorDiv(86_400_000L)
    if (today - day < 7) return listOf("Thu", "Fri", "Sat", "Sun", "Mon", "Tue", "Wed")[day.mod(7L).toInt()]
    /* Days since 1970 as a date (Howard Hinnant's civil_from_days). */
    val z = day + 719_468
    val era = z.floorDiv(146_097L)
    val doe = z - era * 146_097
    val yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365
    val doy = doe - (365 * yoe + yoe / 4 - yoe / 100)
    val mp = (5 * doy + 2) / 153
    val d = doy - (153 * mp + 2) / 5 + 1
    val m = if (mp < 10) mp + 3 else mp - 9
    return "$d ${listOf("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")[(m - 1).toInt()]}"
}

/** Notes' own bloom. */
@Composable
internal fun NotesMark(accent: String, size: androidx.compose.ui.unit.Dp = 30.dp) = InkBloom(Notes.APP_ID, accent, "notes", size)

/**
 * A notebook's mark: the notes glyph in a watercolour blot washed in Notes' colour, seeded by the
 * notebook so each one's puddle is its own, as Drive shows it. A space keeps its crest; a notebook isn't one.
 */
@Composable
internal fun NotebookMark(id: String, size: androidx.compose.ui.unit.Dp) {
    InkBlot("notebook-$id", size = size, tint = app.kimono.ui.inkHex("#b56d78")) {
        Icon(kimonoIcon("notes"), null, modifier = Modifier.size(size * .5f), tint = app.kimono.theme.Kata.ink)
    }
}

/** A rule brushed across in ink: thicker in the middle, lifting off at both ends. */
@Composable
internal fun InkRule(modifier: Modifier = Modifier, seed: String = "rule") {
    val colour = MaterialTheme.colorScheme.outlineVariant
    Canvas(modifier.fillMaxWidth().height(6.dp)) {
        val random = InkRandom(inkSeed(seed))
        val steps = 24
        val mid = size.height / 2
        val top = (0..steps).map { i -> val t = i / steps.toFloat(); Offset(size.width * t, mid - (1.4f + random.next() * .4f) * kotlin.math.sin(kotlin.math.PI * t).toFloat() * 1.dp.toPx()) }
        val bottom = (0..steps).map { i -> val t = i / steps.toFloat(); Offset(size.width * t, mid + (1.2f + random.next() * .4f) * kotlin.math.sin(kotlin.math.PI * t).toFloat() * 1.dp.toPx()) }.reversed()
        val path = Path().apply { moveTo(top[0].x, top[0].y); top.drop(1).forEach { lineTo(it.x, it.y) }; bottom.forEach { lineTo(it.x, it.y) }; close() }
        drawPath(path, colour, alpha = .9f)
    }
}

/** The quiet ink blot holding the notes mark, and one line under it. */
@Composable
internal fun NotesQuiet(seed: String, line: String, action: (@Composable () -> Unit)? = null) {
    Column(Modifier.fillMaxWidth().padding(horizontal = 40.dp, vertical = 64.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        InkBlot("notes-quiet-$seed", size = 96.dp, tint = quietGrey) { Icon(kimonoIcon("notes"), null, modifier = Modifier.size(40.dp), tint = app.kimono.theme.Kata.inkSoft) }
        Spacer(Modifier.size(20.dp))
        Text(line, style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
        if (action != null) { Spacer(Modifier.size(16.dp)); action() }
    }
}

/**
 * Notes' drawer round the list: notebooks, and the sections folded under
 * each, as Kimono AI's drawer holds its chats.
 */
@Composable
fun NotesDrawer(model: NotesModel, accent: String, me: String?, platform: app.kimono.data.Platform, openNote: (String) -> Unit, content: @Composable (menu: () -> Unit, search: Boolean, endSearch: () -> Unit) -> Unit) {
    val drawer = rememberDrawerState(DrawerValue.Closed)
    val scope = rememberCoroutineScope()
    var searching by remember { mutableStateOf(false) }
    ModalNavigationDrawer(
        drawerState = drawer,
        drawerContent = {
            ModalDrawerSheet(
                drawerState = drawer,
                drawerContainerColor = MaterialTheme.colorScheme.surfaceContainerLow,
                drawerShape = RoundedCornerShape(topEnd = 28.dp, bottomEnd = 28.dp),
                modifier = Modifier.widthIn(max = 340.dp),
            ) {
                NotesDrawerSheet(model, accent, me, platform, close = { scope.launch { drawer.close() } }, search = { searching = true; scope.launch { drawer.close() } }) { id -> scope.launch { drawer.close() }; openNote(id) }
            }
        },
    ) { content({ scope.launch { drawer.open() } }, searching) { searching = false } }
}

@Composable
private fun NotesDrawerSheet(model: NotesModel, accent: String, me: String?, platform: app.kimono.data.Platform, close: () -> Unit, search: () -> Unit, openNote: (String) -> Unit) {
    val scope = rememberCoroutineScope()
    val library = model.library
    val place = model.place
    var naming by remember { mutableStateOf<Pair<String?, NoteSection?>?>(null) }
    var renaming by remember { mutableStateOf<Notebook?>(null) }
    var making by remember { mutableStateOf(false) }
    var sharing by remember { mutableStateOf<Notebook?>(null) }
    var leaving by remember { mutableStateOf<Notebook?>(null) }
    var confirming by remember { mutableStateOf<String?>(null) }
    var problem by remember { mutableStateOf<String?>(null) }
    val reduce = model.platform.reduceMotion
    fun go(to: NotePlace) { model.go(to); close() }
    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().padding(start = 20.dp, end = 12.dp, top = 18.dp, bottom = 10.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            NotesMark(accent, 32.dp)
            Text("Notes", style = MaterialTheme.typography.titleLarge)
        }
        LazyColumn(Modifier.weight(1f).fillMaxWidth(), contentPadding = PaddingValues(start = 12.dp, end = 12.dp, bottom = 16.dp)) {
            item(key = "search") { NotesRow(selected = false, onClick = search, lead = { Icon(kimonoIcon("search"), null, modifier = Modifier.size(20.dp)) }) { Text("Search notes", style = MaterialTheme.typography.bodyLarge, modifier = Modifier.weight(1f)) } }
            item(key = "rule") { InkRule(Modifier.padding(horizontal = 16.dp, vertical = 8.dp)) }
            item(key = "all") {
                NotesRow(selected = place == NotePlace.All, onClick = { go(NotePlace.All) }, lead = { Icon(kimonoIcon("notes"), null, modifier = Modifier.size(20.dp)) }) {
                    Text("All notes", style = MaterialTheme.typography.bodyLarge, modifier = Modifier.weight(1f))
                }
            }
            if (problem != null) item(key = "problem") { Box(Modifier.padding(horizontal = 16.dp, vertical = 6.dp)) { Problem(problem) } }
            /* A notebook, its sections folded under it. */
            fun book(notebook: Notebook) {
                item(key = "nb-${notebook.id}") {
                    LaunchedEffect(notebook.id) { model.loadMembers(notebook.id); if (notebook.sharedWithYou && model.people.isEmpty()) model.loadPeople() }
                    val shared = model.members[notebook.id].orEmpty().isNotEmpty()
                    var menu by remember { mutableStateOf(false) }
                    if (confirming == notebook.id) InlineConfirm(notebook.name, model.notesIn(NotePlace.InNotebook(notebook.id)).size, keep = { confirming = null }) {
                        confirming = null
                        scope.launch { try { model.notes.deleteNotebook(notebook.id); model.load() } catch (_: KimonoProblem) { problem = DIDNT_WORK } }
                    } else Box(Modifier.animateItem(fadeInSpec = if (reduce) null else tween(380), placementSpec = if (reduce) null else spring(dampingRatio = .8f, stiffness = 380f, visibilityThreshold = IntOffset(1, 1)), fadeOutSpec = null)) {
                        NotesRow(
                            selected = place == NotePlace.InNotebook(notebook.id), onClick = { go(NotePlace.InNotebook(notebook.id)) },
                            onLongClick = { menu = true },
                            lead = {
                                if (notebook.sharedWithYou) model.people[notebook.createdBy.lowercase()].let { person -> InkPortraitFrame(notebook.createdBy, 30.dp) { Portrait(person?.picture, person?.name, notebook.createdBy, 22.dp) } }
                                else NotebookMark(notebook.id, 30.dp)
                            },
                        ) {
                            Row(Modifier.weight(1f), verticalAlignment = Alignment.CenterVertically) {
                                Text(notebook.name, style = MaterialTheme.typography.bodyLarge, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
                                if (shared) MemberFaces(model, notebook, me)
                            }
                            if (notebook.canWrite) IconButton(onClick = { naming = notebook.id to null }, modifier = Modifier.size(36.dp)) { Icon(kimonoIcon("plus"), "New section", modifier = Modifier.size(18.dp)) }
                        }
                        DropdownMenu(expanded = menu, onDismissRequest = { menu = false }, shape = MaterialTheme.shapes.large) {
                            if (notebook.canWrite) DropdownMenuItem(text = { Text("New section") }, leadingIcon = { Icon(kimonoIcon("plus"), null, modifier = Modifier.size(18.dp)) }, onClick = { menu = false; naming = notebook.id to null })
                            if (notebook.canWrite) DropdownMenuItem(text = { Text("Rename") }, leadingIcon = { Icon(kimonoIcon("edit"), null, modifier = Modifier.size(18.dp)) }, onClick = { menu = false; renaming = notebook })
                            DropdownMenuItem(text = { Text("Share") }, leadingIcon = { Icon(kimonoIcon("share"), null, modifier = Modifier.size(18.dp)) }, onClick = { menu = false; sharing = notebook })
                            if (notebook.sharedWithYou) DropdownMenuItem(text = { Text("Leave", color = MaterialTheme.colorScheme.error) }, leadingIcon = { Icon(kimonoIcon("door"), null, modifier = Modifier.size(18.dp), tint = MaterialTheme.colorScheme.error) }, onClick = { menu = false; leaving = notebook })
                            if (notebook.canWrite && !notebook.sharedWithYou) DropdownMenuItem(text = { Text("Delete", color = MaterialTheme.colorScheme.error) }, leadingIcon = { Icon(kimonoIcon("trash"), null, modifier = Modifier.size(18.dp), tint = MaterialTheme.colorScheme.error) }, onClick = {
                                menu = false
                                if (model.notesIn(NotePlace.InNotebook(notebook.id)).isEmpty()) scope.launch { try { model.notes.deleteNotebook(notebook.id); model.load() } catch (_: KimonoProblem) { problem = DIDNT_WORK } }
                                else confirming = notebook.id
                            })
                        }
                    }
                }
                /* Its sections, folded under it, deeper ones further in. */
                fun walk(parent: String, depth: Int): List<Pair<NoteSection, Int>> =
                    library?.sections.orEmpty().filter { it.parentId == parent }.flatMap { listOf(it to depth) + walk(it.id, depth + 1) }
                items(walk(notebook.id, 1), key = { "sec-${it.first.id}" }) { (section, depth) ->
                    Box(Modifier.animateItem(fadeInSpec = if (reduce) null else tween(380), placementSpec = if (reduce) null else spring(dampingRatio = .8f, stiffness = 380f, visibilityThreshold = IntOffset(1, 1)), fadeOutSpec = null)) {
                        SectionRow(
                            model, notebook, section, depth, selected = place == NotePlace.InSection(section.id), confirming = confirming == section.id,
                            open = { go(NotePlace.InSection(section.id)) },
                            rename = { naming = null to section },
                            delete = {
                                val inside = model.within(section.id)
                                if (model.library?.notes.orEmpty().none { it.parentId in inside }) scope.launch { try { model.notes.deleteSection(section.id); model.load() } catch (_: KimonoProblem) { problem = DIDNT_WORK } }
                                else confirming = section.id
                            },
                            confirmed = { confirming = null; scope.launch { try { model.notes.deleteSection(section.id); model.load() } catch (_: KimonoProblem) { problem = DIDNT_WORK } } },
                            keep = { confirming = null },
                        )
                    }
                }
                        }
            val books = library?.notebooks.orEmpty()
            books.filter { !it.sharedWithYou }.forEach(::book)
            if (library != null) item(key = "new-notebook") {
                NotesRow(selected = false, onClick = { making = true }, lead = { Icon(kimonoIcon("plus"), null, modifier = Modifier.size(20.dp)) }) {
                    Text("New notebook", style = MaterialTheme.typography.bodyLarge, modifier = Modifier.weight(1f))
                }
            }
            /* Below your own: what others shared with you, notebooks then single notes, each with whoever's it is. */
            val theirs = books.filter { it.sharedWithYou }
            val loose = library?.notes.orEmpty().filter { it.notebookId == null }
            if (theirs.isNotEmpty() || loose.isNotEmpty()) item(key = "shared-label") {
                Text("Shared with you", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(start = 16.dp, top = 16.dp, bottom = 6.dp))
            }
            theirs.forEach(::book)
            items(loose, key = { "shared-note-${it.id}" }) { note ->
                val person = model.people[note.createdBy.lowercase()]
                NotesRow(selected = false, onClick = { openNote(note.id) }, lead = { InkPortraitFrame(note.createdBy, 30.dp) { Portrait(person?.picture, person?.name, note.createdBy, 22.dp) } }) {
                    Text(note.title, style = MaterialTheme.typography.bodyLarge, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                }
            }
            if (library == null && model.problem == null) item(key = "loading") { Box(Modifier.fillMaxWidth().padding(24.dp), contentAlignment = Alignment.Center) { InkLoader(size = 28.dp) } }
        }
        Spacer(Modifier.navigationBarsPadding())
    }
    naming?.let { (parent, section) ->
        NameDialog(title = if (section == null) "New section" else "Rename section", action = if (section == null) "Make it" else "Rename", initial = section?.name.orEmpty(), onDismiss = { naming = null }) { name ->
            try {
                if (section == null) model.notes.createSection(name, parent) else model.notes.renameSection(section.id, name)
            } catch (_: KimonoProblem) { throw KimonoProblem(DIDNT_WORK) }
            model.load()
            naming = null
        }
    }
    renaming?.let { notebook ->
        NameDialog(title = "Rename notebook", action = "Rename", initial = notebook.name, onDismiss = { renaming = null }) { name ->
            try { model.notes.renameNotebook(notebook.id, name) } catch (_: KimonoProblem) { throw KimonoProblem(DIDNT_WORK) }
            model.load()
            renaming = null
        }
    }
    if (making) NewNotebookSheet(model, onDismiss = { making = false }) { made -> making = false; go(NotePlace.InNotebook(made)) }
    sharing?.let { notebook -> ShareSheet(shareTarget(model, notebook.id, true, notebook.name, notebook.canWrite), me, platform) { sharing = null; scope.launch { model.loadMembers(notebook.id) } } }
    leaving?.let { notebook -> LeaveSheet(model, notebook.name, notebook.id, true, me, onDismiss = { leaving = null }) }
}

/** "Delete Recipes and its 4 notes?" in the row's place, with Delete and Keep. */
@Composable
private fun InlineConfirm(name: String, count: Int, keep: () -> Unit, delete: () -> Unit) {
    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(24.dp)).background(MaterialTheme.colorScheme.errorContainer).padding(start = 20.dp, end = 8.dp, top = 12.dp, bottom = 4.dp)) {
        Text("Delete $name and its $count ${if (count == 1) "note" else "notes"}?", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onErrorContainer)
        Row(Modifier.align(Alignment.End)) {
            TextButton(onClick = keep) { Text("Keep") }
            TextButton(onClick = delete) { Text("Delete", color = MaterialTheme.colorScheme.error) }
        }
    }
}

/** Up to two members' faces, overlapping, after a shared notebook's name. */
@Composable
private fun MemberFaces(model: NotesModel, notebook: Notebook, me: String?) {
    val others = model.members[notebook.id].orEmpty().filter { !it.equals(me, ignoreCase = true) }.take(2)
    if (others.isEmpty()) return
    LaunchedEffect(Unit) { if (model.people.isEmpty()) model.loadPeople() }
    Row(horizontalArrangement = Arrangement.spacedBy((-8).dp), modifier = Modifier.padding(start = 6.dp)) {
        others.forEach { username ->
            val person = model.people[username.lowercase()]
            InkPortraitFrame(username, 24.dp) { Portrait(person?.picture, person?.name, username, 18.dp) }
        }
    }
}

/** A section in the drawer. Held, it can be renamed, shared (owners) or deleted; one with notes asks first, in its place. */
@Composable
private fun SectionRow(
    model: NotesModel, notebook: Notebook, section: NoteSection, depth: Int, selected: Boolean, confirming: Boolean,
    open: () -> Unit, rename: () -> Unit, delete: () -> Unit, confirmed: () -> Unit, keep: () -> Unit,
) {
    var menu by remember { mutableStateOf(false) }
    if (confirming) {
        val count = model.within(section.id).let { inside -> model.library?.notes.orEmpty().count { it.parentId in inside } }
        InlineConfirm(section.name, count, keep, confirmed)
        return
    }
    Box {
        NotesRow(selected = selected, onClick = open, onLongClick = if (notebook.canWrite) ({ menu = true }) else null, indent = 16.dp + 24.dp * depth) {
            Text(section.name, style = MaterialTheme.typography.bodyLarge, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
        }
        DropdownMenu(expanded = menu, onDismissRequest = { menu = false }, shape = MaterialTheme.shapes.large) {
            DropdownMenuItem(text = { Text("Rename") }, leadingIcon = { Icon(kimonoIcon("edit"), null, modifier = Modifier.size(18.dp)) }, onClick = { menu = false; rename() })
            DropdownMenuItem(text = { Text("Delete", color = MaterialTheme.colorScheme.error) }, leadingIcon = { Icon(kimonoIcon("trash"), null, modifier = Modifier.size(18.dp), tint = MaterialTheme.colorScheme.error) }, onClick = { menu = false; delete() })
        }
    }
}

/** One row of the drawer: a 48dp pill, filled when it's where you are. */
@Composable
private fun NotesRow(selected: Boolean, onClick: () -> Unit, onLongClick: (() -> Unit)? = null, indent: androidx.compose.ui.unit.Dp = 16.dp, lead: (@Composable () -> Unit)? = null, body: @Composable RowScope.() -> Unit) {
    val colour = if (selected) MaterialTheme.colorScheme.secondaryContainer else Color.Transparent
    CompositionLocalProvider(LocalContentColor provides if (selected) MaterialTheme.colorScheme.onSecondaryContainer else MaterialTheme.colorScheme.onSurface) {
        Row(
            Modifier.fillMaxWidth().heightIn(min = 48.dp).clip(CircleShape).background(colour)
                .combinedClickable(onClick = onClick, onLongClick = onLongClick)
                .padding(start = indent, end = 8.dp),
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            lead?.invoke()
            body()
        }
    }
}

/* ── the list ── */

/** The notes of the place chosen in the drawer, newest first. */
@Composable
fun NotesScreen(model: NotesModel, platform: app.kimono.data.Platform, accent: String, admin: Boolean, me: String?, back: () -> Unit, open: (String) -> Unit, go: (String) -> Unit) {
    NotesDrawer(model, accent, me, platform, openNote = open) { menu, searching, endSearch ->
        NotesList(model, platform, accent, admin, me, menu, searching, endSearch, back, open, go)
    }
}

@Composable
private fun NotesList(model: NotesModel, platform: app.kimono.data.Platform, accent: String, admin: Boolean, me: String?, menu: () -> Unit, searching: Boolean, endSearch: () -> Unit, back: () -> Unit, open: (String) -> Unit, go: (String) -> Unit) {
    val snackbar = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()
    var query by remember { mutableStateOf("") }
    var moving by remember { mutableStateOf<NoteMeta?>(null) }
    var leaving by remember { mutableStateOf<Notebook?>(null) }
    var sharing by remember { mutableStateOf<Pair<String, Boolean>?>(null) }
    var leavingNote by remember { mutableStateOf<NoteMeta?>(null) }
    LaunchedEffect(Unit) { model.load() }
    /* On coming back (from a note, or to the app) the list asks again, then follows Drive's change feed. */
    WhileShown(Unit) { model.load(); model.follow() }
    val time = remember(model.library, model.place) { now() }
    /* Delete has Undo, for 6 seconds. */
    LaunchedEffect(model.deleted) {
        val note = model.deleted ?: return@LaunchedEffect
        val shown = launch {
            val result = snackbar.showSnackbar("Deleted ${note.title}", actionLabel = "Undo", duration = SnackbarDuration.Indefinite)
            if (result == SnackbarResult.ActionPerformed) model.undoDelete(note)
        }
        delay(6_000)
        shown.cancel()
        snackbar.currentSnackbarData?.dismiss()
        if (model.deleted == note) model.deleted = null
    }
    fun failed() { scope.launch { snackbar.showSnackbar(DIDNT_WORK) } }

    val place = model.place
    val notebook = (place as? NotePlace.InNotebook)?.let { model.notebook(it.id) }
    val section = (place as? NotePlace.InSection)?.let { model.section(it.id) }
    val reduce = model.platform.reduceMotion
    val focus = remember { FocusRequester() }
    LaunchedEffect(searching) { if (searching) runCatching { focus.requestFocus() } else query = "" }
    Scaffold(
        containerColor = MaterialTheme.colorScheme.surface,
        topBar = {
            TopAppBar(
                title = {
                    if (searching) BasicTextField(
                        query, { query = it }, singleLine = true, textStyle = MaterialTheme.typography.bodyLarge.copy(color = MaterialTheme.colorScheme.onSurface),
                        cursorBrush = SolidColor(MaterialTheme.colorScheme.primary), keyboardOptions = KeyboardOptions(imeAction = androidx.compose.ui.text.input.ImeAction.Search),
                        modifier = Modifier.fillMaxWidth().focusRequester(focus),
                        decorationBox = { field -> Box { if (query.isEmpty()) Text("Search notes", style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant); field() } },
                    ) else Text(when (place) { NotePlace.All -> "All notes"; is NotePlace.InSection -> section?.name.orEmpty(); is NotePlace.InNotebook -> "" }, style = MaterialTheme.typography.titleLarge, maxLines = 1, overflow = TextOverflow.Ellipsis)
                },
                navigationIcon = { IconButton(onClick = menu) { Icon(kimonoIcon("menu"), "Notebooks") } },
                actions = {
                    if (searching) IconButton(onClick = endSearch) { Icon(kimonoIcon("close"), "Stop searching") }
                    else IconButton(onClick = back) { Icon(kimonoIcon("home"), "Home") }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.surface, scrolledContainerColor = MaterialTheme.colorScheme.surfaceContainer),
            )
        },
        snackbarHost = { SnackbarHost(snackbar) },
        floatingActionButton = {
            if (model.library != null && model.canWrite(place) && !searching) NewNoteSeal(busy = model.creating) {
                open(model.startNew(place))
            }
        },
    ) { padding ->
        val library = model.library
        val shown = if (searching) model.notesIn(NotePlace.All).filter { query.isBlank() || it.title.contains(query.trim(), ignoreCase = true) || it.excerpt.contains(query.trim(), ignoreCase = true) } else model.notesIn(place)
        Box(Modifier.padding(padding).fillMaxSize()) {
            when {
                library == null && model.problem == "Notes isn't switched on." -> NotesQuiet("off", "Notes isn't switched on.") {
                    if (admin) Seal("Open its page", compact = true, onClick = { go("manage/${Notes.APP_ID}") })
                }
                library == null && model.problem != null -> NotesQuiet("problem", DIDNT_WORK) { Seal("Try again", compact = true, tone = SealTone.Quiet, onClick = { scope.launch { model.load() } }) }
                library == null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { InkLoader() }
                else -> LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(start = 12.dp, end = 12.dp, top = 4.dp, bottom = 120.dp)) {
                    if (notebook != null && !searching) item(key = "head-${notebook.id}") { NotebookHead(model, notebook, me, share = { sharing = notebook.id to true }) { leaving = notebook } }
                    if (shown.isEmpty()) item(key = "quiet-${place.key}-$searching") {
                        NotesQuiet(if (searching) "search" else place.key, when { searching && query.isNotBlank() -> "No notes match."; place is NotePlace.InSection -> "Nothing here yet."; else -> "Your notes will be here." })
                    }
                    items(shown, key = { it.id }) { note ->
                        val nb = model.notebook(note.notebookId)
                        Box(Modifier.animateItem(
                            fadeInSpec = if (reduce) null else tween(380),
                            placementSpec = if (reduce) null else spring(dampingRatio = .8f, stiffness = 380f, visibilityThreshold = IntOffset(1, 1)),
                            fadeOutSpec = if (reduce) null else tween(200),
                        )) {
                            NoteRow(
                                model, note, crest = if (place == NotePlace.All || searching) nb else null, lifted = model.lastOpened == note.id, now = time,
                                canWrite = nb?.canWrite != false,
                                open = { open(note.id) }, move = { moving = note }, share = { sharing = note.id to false }, leave = { leavingNote = note }, delete = { model.delete(note) { failed() } },
                            )
                        }
                    }
                }
            }
        }
    }
    moving?.let { note -> MoveSheet(model, note, onDismiss = { moving = null }, failed = ::failed) }
    leaving?.let { nb -> LeaveSheet(model, nb.name, nb.id, true, me, onDismiss = { leaving = null }) }
    leavingNote?.let { note -> LeaveSheet(model, note.title, note.id, false, me, onDismiss = { leavingNote = null }) }
    sharing?.let { (id, notebook) ->
        val name = if (notebook) model.notebook(id)?.name.orEmpty() else model.meta(id)?.title.orEmpty()
        val canWrite = if (notebook) model.notebook(id)?.canWrite != false else true
        ShareSheet(shareTarget(model, id, notebook, name, canWrite), me, platform) { sharing = null; if (notebook) scope.launch { model.loadMembers(id) } }
    }
}

/** The square seal for a new note: the same shape as Send. */
@Composable
private fun NewNoteSeal(busy: Boolean, onClick: () -> Unit) {
    /* By night the seal keeps its red, from the container, as Seal does. */
    val night = app.kimono.theme.LocalNight.current
    Surface(
        onClick = onClick, shape = RoundedCornerShape(18.dp),
        color = if (night) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.primary,
        contentColor = if (night) MaterialTheme.colorScheme.onPrimaryContainer else MaterialTheme.colorScheme.onPrimary,
        shadowElevation = 3.dp, modifier = Modifier.size(60.dp).semantics { contentDescription = "New note" },
    ) {
        Box(contentAlignment = Alignment.Center) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                if (busy) InkLoader(size = 20.dp)
                Icon(kimonoIcon("edit"), null, modifier = Modifier.size(24.dp))
            }
        }
    }
}

/** A notebook's page head: its crest, large, its name, and who it's shared with. */
@Composable
private fun NotebookHead(model: NotesModel, notebook: Notebook, me: String?, share: () -> Unit, leave: () -> Unit) {
    LaunchedEffect(notebook.id) { model.loadMembers(notebook.id); if (model.people.isEmpty()) model.loadPeople() }
    Row(Modifier.fillMaxWidth().padding(start = 8.dp, end = 8.dp, top = 4.dp, bottom = 16.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(16.dp)) {
        NotebookMark(notebook.id, 64.dp)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(notebook.name, style = MaterialTheme.typography.headlineMedium, maxLines = 2, overflow = TextOverflow.Ellipsis)
            MemberFaces(model, notebook, me)
        }
        if (notebook.sharedWithYou) Seal("Leave", compact = true, tone = SealTone.Quiet, onClick = leave)
        else Seal("Share", compact = true, tone = SealTone.Quiet, onClick = share)
    }
}

/** A note in the list: its title, a line of it, and when, only when it says something. */
@Composable
private fun NoteRow(
    model: NotesModel, note: NoteMeta, crest: Notebook?, lifted: Boolean, now: Long, canWrite: Boolean,
    open: () -> Unit, move: () -> Unit, share: () -> Unit, leave: () -> Unit, delete: () -> Unit,
) {
    /* A note shared with you on its own is yours to leave, not to move or delete. */
    val alone = note.notebookId == null
    var menu by remember { mutableStateOf(false) }
    val draft = if (model.hasDraft(note.id)) model.draft(note.id) else null
    val shape = RoundedCornerShape(20.dp)
    Row(
        Modifier.fillMaxWidth().padding(vertical = 2.dp)
            .then(if (lifted) Modifier.shadow(1.dp, shape, ambientColor = Color.Black.copy(alpha = .2f), spotColor = Color.Black.copy(alpha = .2f)) else Modifier)
            .clip(shape).background(if (lifted) MaterialTheme.colorScheme.surfaceContainerLowest else Color.Transparent)
            .combinedClickable(onClick = open, onLongClick = { menu = true })
            .heightIn(min = 64.dp).padding(start = 16.dp, top = 10.dp, bottom = 10.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(note.title, fontSize = 15.sp, fontWeight = FontWeight.Bold, style = MaterialTheme.typography.bodyLarge, maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (note.excerpt.isNotBlank()) Text(note.excerpt, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        if (crest != null) NotebookMark(crest.id, 22.dp)
        if (draft?.state == SaveState.Saving) InkLoader(size = 14.dp)
        else Text(noteWhen(note.updatedAt.toLong(), now, model.notes.localOffset(now)), fontFamily = mono, fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Box {
            IconButton(onClick = { menu = true }) { Icon(kimonoIcon("more"), "More", modifier = Modifier.size(20.dp)) }
            DropdownMenu(expanded = menu, onDismissRequest = { menu = false }, shape = MaterialTheme.shapes.large) {
                DropdownMenuItem(text = { Text("Share") }, leadingIcon = { Icon(kimonoIcon("share"), null, modifier = Modifier.size(18.dp)) }, onClick = { menu = false; share() })
                if (alone) DropdownMenuItem(text = { Text("Leave", color = MaterialTheme.colorScheme.error) }, leadingIcon = { Icon(kimonoIcon("door"), null, modifier = Modifier.size(18.dp), tint = MaterialTheme.colorScheme.error) }, onClick = { menu = false; leave() })
                if (canWrite && !alone) DropdownMenuItem(text = { Text("Move") }, leadingIcon = { Icon(kimonoIcon("move"), null, modifier = Modifier.size(18.dp)) }, onClick = { menu = false; move() })
                if (canWrite && !alone) DropdownMenuItem(text = { Text("Delete", color = MaterialTheme.colorScheme.error) }, leadingIcon = { Icon(kimonoIcon("trash"), null, modifier = Modifier.size(18.dp), tint = MaterialTheme.colorScheme.error) }, onClick = { menu = false; delete() })
            }
        }
    }
}

/* ── sheets ── */

/** Where to move a note: the top of its notebook, or one of its sections. */
@Composable
internal fun MoveSheet(model: NotesModel, note: NoteMeta, onDismiss: () -> Unit, failed: () -> Unit, moved: () -> Unit = {}) {
    val scope = rememberCoroutineScope()
    val notebook = model.notebook(note.notebookId) ?: return onDismiss()
    fun walk(parent: String, depth: Int): List<Pair<NoteSection, Int>> =
        model.library?.sections.orEmpty().filter { it.parentId == parent }.flatMap { listOf(it to depth) + walk(it.id, depth + 1) }
    /* Any notebook in the same space, and its sections. */
    val books = model.library?.notebooks.orEmpty().filter { it.space.id == notebook.space.id }
    val places = books.flatMap { book -> listOf(book.id to (book.name to 0)) + walk(book.id, 1).map { (s, d) -> s.id to (s.name to d) } }
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true), containerColor = MaterialTheme.colorScheme.surfaceContainerLow) {
        Column(Modifier.padding(horizontal = 12.dp).padding(bottom = 24.dp)) {
            Text("Move ${note.title}", style = MaterialTheme.typography.titleLarge, modifier = Modifier.padding(start = 12.dp, bottom = 12.dp), maxLines = 1, overflow = TextOverflow.Ellipsis)
            LazyColumn(Modifier.heightIn(max = 460.dp)) {
                items(places, key = { it.first }) { (id, label) ->
                    val (name, depth) = label
                    NotesRow(
                        selected = id == note.parentId, indent = 16.dp + 24.dp * depth,
                        lead = if (depth == 0) ({ NotebookMark(notebook.id, 28.dp) }) else null,
                        onClick = {
                            onDismiss()
                            if (id != note.parentId) scope.launch {
                                try { val after = model.notes.move(note.id, id); model.heard(after, null); moved() } catch (_: KimonoProblem) { failed() }
                            }
                        },
                    ) { Text(name, style = MaterialTheme.typography.bodyLarge, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f)) }
                }
            }
        }
    }
}

/** How the share sheet reads and changes a notebook's or a note's sharing, and its public link. */
internal fun shareTarget(model: NotesModel, id: String, notebook: Boolean, name: String, canEdit: Boolean) = ShareTarget(
    name = name,
    known = model.notes.knownSharing(id, notebook),
    load = { model.notes.sharing(id, notebook) },
    set = { username, role -> model.notes.share(id, notebook, username, role) },
    people = { model.notes.people() },
    knownPeople = model.people.values.toList(),
    link = { on -> model.notes.link(id, notebook, on) },
    canEdit = canEdit,
)

/** A new notebook: a name, and which space it goes in (your own first). */
@Composable
internal fun NewNotebookSheet(model: NotesModel, onDismiss: () -> Unit, made: (String) -> Unit) {
    val scope = rememberCoroutineScope()
    var name by remember { mutableStateOf("") }
    var spaces by remember { mutableStateOf(model.drive.knownSpaces()) }
    var space by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    var problem by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(Unit) { runCatching { model.drive.spaces() }.onSuccess { spaces = it } }
    /* Your own space first: the one only you are in. */
    val writable = spaces.orEmpty().filter { it.role == "owner" || it.role == "editor" }.sortedWith(compareBy({ it.members > 1 }, { it.name }))
    val chosen = space ?: writable.firstOrNull()?.id
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true), containerColor = MaterialTheme.colorScheme.surfaceContainerLow) {
        Column(Modifier.padding(horizontal = 20.dp).padding(bottom = 24.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("New notebook", style = MaterialTheme.typography.titleLarge)
            androidx.compose.material3.OutlinedTextField(name, { name = it; problem = null }, singleLine = true, label = { Text("Name") }, modifier = Modifier.fillMaxWidth())
            if (writable.size > 1) LazyColumn(Modifier.heightIn(max = 280.dp)) {
                items(writable, key = { it.id }) { each ->
                    NotesRow(selected = each.id == chosen, onClick = { space = each.id }, lead = { InkCrest(each.crest, each.color, 24.dp) }) {
                        Text(each.name, style = MaterialTheme.typography.bodyLarge, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                    }
                }
            }
            Problem(problem)
            Seal("Make", busy = busy, enabled = name.isNotBlank(), modifier = Modifier.fillMaxWidth(), onClick = {
                busy = true
                scope.launch {
                    try { val book = model.notes.createNotebook(name.trim(), chosen); model.load(); made(book.id) } catch (_: KimonoProblem) { problem = DIDNT_WORK }
                    busy = false
                }
            })
        }
    }
}

/** Leaving something shared with you: only someone who can edit it can bring you back, so it's held to confirm. */
@Composable
internal fun LeaveSheet(model: NotesModel, name: String, id: String, notebook: Boolean, me: String?, onDismiss: () -> Unit) {
    val scope = rememberCoroutineScope()
    var problem by remember { mutableStateOf<String?>(null) }
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true), containerColor = MaterialTheme.colorScheme.surfaceContainerLow) {
        Column(Modifier.padding(horizontal = 20.dp).padding(bottom = 28.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                if (notebook) NotebookMark(id, 40.dp)
                Text("Leave $name?", style = MaterialTheme.typography.titleLarge)
            }
            Text("You'll need to be asked back.", style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Problem(problem)
            HoldSeal("Leave", onConfirm = {
                scope.launch {
                    try {
                        model.notes.leave(id, notebook, me ?: return@launch)
                        if (notebook) model.go(NotePlace.All)
                        model.load()
                        onDismiss()
                    } catch (_: KimonoProblem) { problem = DIDNT_WORK }
                }
            })
        }
    }
}

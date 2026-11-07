@file:OptIn(ExperimentalMaterial3Api::class, ExperimentalMaterial3ExpressiveApi::class)

package app.kimono.screens

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.foundation.ScrollState
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.waitForUpOrCancellation
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.ime
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.input.TextFieldLineLimits
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExperimentalMaterial3ExpressiveApi
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarDuration
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.SnackbarResult
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.kimono.data.Platform
import app.kimono.ui.InkCheck
import app.kimono.ui.InkLoader
import app.kimono.ui.NoteLook
import app.kimono.ui.Seal
import app.kimono.ui.SealTone
import app.kimono.ui.cycleHeading
import app.kimono.ui.kimonoIcon
import app.kimono.ui.noteInput
import app.kimono.ui.noteOutput
import app.kimono.ui.noteSpans
import app.kimono.ui.toggleBold
import app.kimono.ui.toggleCheck
import app.kimono.ui.toggleChecklist
import app.kimono.ui.toggleList
import kotlinx.coroutines.FlowPreview
import kotlinx.coroutines.flow.debounce
import kotlinx.coroutines.flow.drop
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull

/*
 * 筆 A note, full screen: a Mincho title over a body that stays Markdown and
 * is styled where you type. It saves itself; the word at the top says how
 * that's going, and only when it says something.
 */

/** A note open to write in. [key] is its id, or a new note's key while it's made. */
@OptIn(FlowPreview::class)
@Composable
fun NoteEditorScreen(model: NotesModel, platform: Platform, key: String, me: String?, back: () -> Unit, open: (String) -> Unit) {
    /* A new note's key from a launch before this one: there's nothing to open. */
    if (key.startsWith("new-") && !model.hasDraft(key)) { LaunchedEffect(Unit) { back() }; return }
    val draft = remember(key) { model.draft(key) }
    val scope = rememberCoroutineScope()
    val snackbar = remember { SnackbarHostState() }
    val focusManager = LocalFocusManager.current
    val titleFocus = remember { FocusRequester() }
    val bodyFocus = remember { FocusRequester() }
    var titleFocused by remember { mutableStateOf(false) }
    var bodyFocused by remember { mutableStateOf(false) }
    var menu by remember { mutableStateOf(false) }
    var moving by remember { mutableStateOf(false) }
    var sharing by remember { mutableStateOf(false) }
    var leaving by remember { mutableStateOf(false) }
    LaunchedEffect(draft) {
        draft.open()
        model.lastOpened = draft.id
        /* A new note opens with focus in its title. */
        if (draft.isNew && draft.title.text.isEmpty()) runCatching { titleFocus.requestFocus() }
    }
    /* 800ms after typing stops. */
    LaunchedEffect(draft) {
        snapshotFlow { draft.body.text.toString() }.distinctUntilChanged().drop(1).debounce(800).collect { if (draft.loaded) draft.save() }
    }
    LaunchedEffect(draft.id) { draft.id?.let { model.lastOpened = it } }
    /* Edits made elsewhere come in: on coming back to the app, and every 15s while it's open. */
    WhileShown(draft) { while (true) { if (draft.loaded) draft.refresh(); kotlinx.coroutines.delay(15_000) } }
    DisposableEffect(draft) { onDispose { draft.leave() } }
    LaunchedEffect(draft.copy) {
        val copy = draft.copy ?: return@LaunchedEffect
        val result = snackbar.showSnackbar("Someone else changed this. Yours is kept as a copy.", actionLabel = "Open copy", duration = SnackbarDuration.Long)
        draft.copy = null
        if (result == SnackbarResult.ActionPerformed) open(copy)
    }
    val meta = model.meta(draft.id)
    val notebook = model.notebook(meta?.notebookId)
    val canWrite = notebook?.canWrite != false
    /* Shared with you on its own: yours to leave, not to move or delete. */
    val alone = meta != null && meta.notebookId == null
    val keyboard = WindowInsets.ime.getBottom(LocalDensity.current) > 0

    Scaffold(
        containerColor = MaterialTheme.colorScheme.surface,
        topBar = {
            TopAppBar(
                title = {},
                navigationIcon = { IconButton(onClick = { focusManager.clearFocus(); back() }) { Icon(kimonoIcon("back"), "Back") } },
                actions = {
                    SaveWord(model, draft)
                    if (meta != null) Box {
                        IconButton(onClick = { menu = true }) { Icon(kimonoIcon("more"), "More") }
                        DropdownMenu(expanded = menu, onDismissRequest = { menu = false }, shape = MaterialTheme.shapes.large) {
                            DropdownMenuItem(text = { Text("Share") }, leadingIcon = { Icon(kimonoIcon("share"), null, modifier = Modifier.size(18.dp)) }, onClick = { menu = false; sharing = true })
                            if (canWrite && !alone) DropdownMenuItem(text = { Text("Move") }, leadingIcon = { Icon(kimonoIcon("move"), null, modifier = Modifier.size(18.dp)) }, onClick = { menu = false; moving = true })
                            DropdownMenuItem(text = { Text("Send") }, leadingIcon = { Icon(kimonoIcon("out"), null, modifier = Modifier.size(18.dp)) }, onClick = {
                                menu = false
                                platform.share(listOf(draft.title.text.toString().trim(), draft.body.text.toString()).filter { it.isNotBlank() }.joinToString("\n\n"))
                            })
                            if (alone) DropdownMenuItem(text = { Text("Leave", color = MaterialTheme.colorScheme.error) }, leadingIcon = { Icon(kimonoIcon("door"), null, modifier = Modifier.size(18.dp), tint = MaterialTheme.colorScheme.error) }, onClick = { menu = false; leaving = true })
                            if (canWrite && !alone) DropdownMenuItem(text = { Text("Delete", color = MaterialTheme.colorScheme.error) }, leadingIcon = { Icon(kimonoIcon("trash"), null, modifier = Modifier.size(18.dp), tint = MaterialTheme.colorScheme.error) }, onClick = {
                                menu = false
                                draft.discard()
                                model.delete(meta)
                                back()
                            })
                        }
                    }
                    Spacer(Modifier.size(4.dp))
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.surface, scrolledContainerColor = MaterialTheme.colorScheme.surface),
            )
        },
        snackbarHost = { SnackbarHost(snackbar) },
    ) { padding ->
        Column(Modifier.padding(padding).consumeWindowInsets(padding).fillMaxSize().imePadding()) {
            val scroll = rememberScrollState()
            Column(
                Modifier.weight(1f).fillMaxWidth().verticalScroll(scroll)
                    /* A tap below the words goes to the end of the note. */
                    .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null, enabled = canWrite) {
                        draft.body.edit { selection = TextRange(length) }
                        runCatching { bodyFocus.requestFocus() }
                    }
                    .padding(horizontal = 24.dp).padding(top = 4.dp, bottom = 160.dp),
            ) {
                NoteTitle(draft, canWrite, titleFocus, onFocus = { focused ->
                    if (titleFocused && !focused) scope.launch { draft.rename() }
                    titleFocused = focused
                }) { runCatching { bodyFocus.requestFocus() } }
                Spacer(Modifier.size(14.dp))
                NoteBody(model, platform, draft, canWrite, scroll, bodyFocus) { focused ->
                    if (bodyFocused && !focused) scope.launch { draft.save() }
                    bodyFocused = focused
                }
            }
            if (bodyFocused && keyboard && canWrite) KeyboardRow(draft) { focusManager.clearFocus() }
        }
    }
    if (sharing && meta != null) ShareSheet(shareTarget(model, meta.id, false, draft.title.text.toString().ifBlank { meta.title }, canWrite), me, platform) { sharing = false }
    if (leaving && meta != null) LeaveSheet(model, meta.title, meta.id, false, me, onDismiss = { leaving = false; back() })
    if (moving && meta != null) MoveSheet(model, meta, onDismiss = { moving = false }, failed = { scope.launch { snackbar.showSnackbar(DIDNT_WORK) } })
}

/** The one word for how saving is going, where the time goes: a loader while it saves, the time once it has. */
@Composable
private fun SaveWord(model: NotesModel, draft: NoteDraft) {
    val now = remember(draft.savedAt, draft.state) { now() }
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(end = 4.dp)) {
        when (draft.state) {
            SaveState.Saving -> InkLoader(size = 14.dp)
            SaveState.Waiting -> Text("Waiting for a connection", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            SaveState.Failed -> {
                Text("Not saved", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.error)
                Seal("Retry", compact = true, tone = SealTone.Quiet, onClick = { draft.retryNow() })
            }
            SaveState.Saved -> if (draft.savedAt > 0 && draft.id != null) Text(noteWhen(draft.savedAt, now, model.notes.localOffset(now)), fontFamily = mono, fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

/** The title: a Mincho headline, with a brush stroke spreading along its foot while you write in it. */
@Composable
private fun NoteTitle(draft: NoteDraft, canWrite: Boolean, focus: FocusRequester, onFocus: (Boolean) -> Unit, next: () -> Unit) {
    var focused by remember { mutableStateOf(false) }
    val spread by animateFloatAsState(if (focused) 1f else 0f, spring(dampingRatio = .9f, stiffness = 220f))
    val ink = MaterialTheme.colorScheme.primary
    val style = MaterialTheme.typography.headlineMedium.copy(color = MaterialTheme.colorScheme.onSurface)
    Box(Modifier.fillMaxWidth()) {
        if (draft.title.text.isEmpty()) Text("Untitled", style = style.copy(color = MaterialTheme.colorScheme.outline))
        BasicTextField(
            draft.title, readOnly = !canWrite, textStyle = style, cursorBrush = SolidColor(ink),
            lineLimits = TextFieldLineLimits.MultiLine(maxHeightInLines = 3),
            keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences, imeAction = ImeAction.Next),
            onKeyboardAction = { next() },
            modifier = Modifier.fillMaxWidth().focusRequester(focus)
                .onFocusChanged { focused = it.isFocused; onFocus(it.isFocused) }
                .drawBehind {
                    if (spread <= 0f) return@drawBehind
                    /* A brush stroke: thick where it starts, thinning as it runs out. */
                    val y = size.height + 6.dp.toPx()
                    val w = size.width * spread
                    val thick = 3.dp.toPx()
                    val stroke = Path().apply {
                        moveTo(0f, y - thick * .4f)
                        cubicTo(w * .3f, y - thick * .65f, w * .7f, y - thick * .3f, w, y)
                        cubicTo(w * .7f, y + thick * .25f, w * .3f, y + thick * .5f, 0f, y + thick * .45f)
                        close()
                    }
                    drawPath(stroke, ink, alpha = .85f)
                },
        )
    }
}

/** The body: Markdown, styled where it's typed, with checkboxes you can tap and links a long press opens. */
@Composable
private fun NoteBody(model: NotesModel, platform: Platform, draft: NoteDraft, canWrite: Boolean, scroll: ScrollState, focus: FocusRequester, onFocus: (Boolean) -> Unit) {
    val scheme = MaterialTheme.colorScheme
    val headline = MaterialTheme.typography.headlineMedium.fontFamily
    val look = remember(scheme, headline) { NoteLook(text = scheme.onSurface, mark = scheme.outline, accent = scheme.primary, quiet = scheme.onSurfaceVariant, code = scheme.onSurface, headline = headline) }
    val output = remember(look) { noteOutput(look) }
    var layout by remember { mutableStateOf<TextLayoutResult?>(null) }
    val haptics = LocalHapticFeedback.current
    val spans = remember(draft.body.text, look) { noteSpans(draft.body.text, look) }
    Box(Modifier.fillMaxWidth()) {
        BasicTextField(
            draft.body, readOnly = !canWrite,
            textStyle = MaterialTheme.typography.bodyLarge.copy(color = scheme.onSurface, fontSize = 17.sp, lineHeight = 27.sp),
            cursorBrush = SolidColor(scheme.primary),
            inputTransformation = noteInput, outputTransformation = output,
            keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences),
            onTextLayout = { result -> layout = result() },
            modifier = Modifier.fillMaxWidth().heightIn(min = 240.dp).focusRequester(focus)
                .onFocusChanged { onFocus(it.isFocused) }
                /* A long press on a link opens it. */
                .pointerInput(spans) {
                    awaitEachGesture {
                        val down = awaitFirstDown(requireUnconsumed = false, pass = PointerEventPass.Initial)
                        val at = layout?.getOffsetForPosition(down.position) ?: return@awaitEachGesture
                        val link = spans.links.firstOrNull { at in it.start until it.end } ?: return@awaitEachGesture
                        val up = withTimeoutOrNull(viewConfiguration.longPressTimeoutMillis) { waitForUpOrCancellation(PointerEventPass.Initial) }
                        if (up == null) {
                            haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                            val url = link.url.trim()
                            if (url.startsWith("https://") || url.startsWith("http://") || url.startsWith("mailto:")) platform.openUrl(url)
                            draft.body.edit { selection = TextRange(selection.end) }
                        }
                    }
                },
        )
        /* Each checkbox's ink ring, over the brackets it stands for. */
        val result = layout
        if (result != null) {
            val density = LocalDensity.current
            spans.checks.forEach { check ->
                if (check.at + 2 >= result.layoutInput.text.length) return@forEach
                val box: Rect = result.getBoundingBox(check.at).let { first -> first.copy(right = result.getBoundingBox(check.at + 2).right) }
                val side = with(density) { maxOf(box.height * .78f, 18.dp.toPx()) }
                /* Centred on the brackets, nudged to the letters' middle. */
                val x = box.left + (box.width - side) / 2
                val y = box.top + (box.height - side) / 2 + with(density) { 2.dp.toPx() }
                with(density) {
                    InkCheck(
                        checked = check.checked, ring = scheme.outline, ink = scheme.primary, seed = "check-${check.at % 97}",
                        modifier = Modifier.offset { IntOffset(x.toInt(), y.toInt()) }.size(side.toDp())
                            .semantics { contentDescription = if (check.checked) "Ticked" else "Not ticked" }
                            .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null, enabled = canWrite) {
                                haptics.performHapticFeedback(HapticFeedbackType.TextHandleMove)
                                draft.body.toggleCheck(check.at)
                                model.scope.launch { draft.save() }
                            },
                    )
                }
            }
        }
    }
}

/** Above the keyboard: checklist, heading, bold, list, and done. */
@Composable
private fun KeyboardRow(draft: NoteDraft, done: () -> Unit) {
    Surface(color = MaterialTheme.colorScheme.surfaceContainer) {
        Row(Modifier.fillMaxWidth().heightIn(min = 48.dp).padding(horizontal = 6.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = { draft.body.toggleChecklist() }) { Icon(kimonoIcon("checklist"), "Checklist") }
            IconButton(onClick = { draft.body.cycleHeading() }) { Icon(kimonoIcon("heading"), "Heading") }
            IconButton(onClick = { draft.body.toggleBold() }) { Icon(kimonoIcon("bold"), "Bold") }
            IconButton(onClick = { draft.body.toggleList() }) { Icon(kimonoIcon("list"), "List") }
            Spacer(Modifier.weight(1f))
            TextButton(onClick = done) { Text("Done", style = MaterialTheme.typography.titleSmall) }
        }
    }
}

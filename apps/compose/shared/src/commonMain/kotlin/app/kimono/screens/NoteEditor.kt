@file:OptIn(ExperimentalMaterial3Api::class, ExperimentalMaterial3ExpressiveApi::class)

package app.kimono.screens

import app.kimono.ui.InkDialog
import app.kimono.ui.InkConfirm
import app.kimono.ui.InkTitle
import app.kimono.ui.InkSheet
import app.kimono.ui.InkMenuItem
import app.kimono.ui.InkMenu
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
import androidx.compose.foundation.layout.height
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
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.foundation.layout.statusBarsPadding
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
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.background
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.isAltPressed
import androidx.compose.ui.input.key.isCtrlPressed
import androidx.compose.ui.input.key.isMetaPressed
import androidx.compose.ui.input.key.isShiftPressed
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.runtime.SideEffect
import app.kimono.ui.makeLink
import app.kimono.ui.setHeading
import app.kimono.ui.toggleCheckOn
import app.kimono.ui.toggleCode
import app.kimono.ui.toggleItalic
import app.kimono.ui.toggleNumbered
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
import app.kimono.ui.toggleChecklist
import app.kimono.ui.insertTable
import app.kimono.ui.noteDisplay
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
    var formats by remember { mutableStateOf(emptySet<String>()) }
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

    val section = model.library?.sections?.firstOrNull { it.id == meta?.parentId }
    val page = MaterialTheme.colorScheme.surfaceContainerLowest
    Scaffold(
        containerColor = page,
        topBar = {
            /* The mockup's note head: back, then where the note lives, its save word and ··· at the end. */
            Row(
                Modifier.fillMaxWidth().background(page).statusBarsPadding().padding(top = 4.dp).padding(horizontal = 6.dp).height(40.dp),
                verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                HeadButton("back", "Back") { focusManager.clearFocus(); back() }
                val crumb = MaterialTheme.typography.labelMedium.copy(fontSize = 11.5.sp, fontWeight = FontWeight.SemiBold, color = MaterialTheme.colorScheme.onSurfaceVariant)
                if (notebook != null) NotebookMark(notebook.id, 14.dp)
                Text(
                    buildAnnotatedString {
                        append(notebook?.name ?: if (alone) "Shared with you" else "Notes")
                        if (section != null) {
                            withStyle(SpanStyle(color = faintColor())) { append(" / ") }
                            append(section.name)
                        }
                    },
                    style = crumb, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f),
                )
                SaveWord(model, draft)
                if (meta != null) Box {
                    HeadButton("more", "More") { menu = true }
                    InkMenu(expanded = menu, onDismissRequest = { menu = false }) {
                        InkMenuItem("Share", icon = "share", onClick = { menu = false; sharing = true })
                        if (canWrite && !alone) InkMenuItem("Move", icon = "move", onClick = { menu = false; moving = true })
                        InkMenuItem("Send", icon = "out", onClick = {
                            menu = false
                            platform.share(listOf(draft.title.text.toString().trim(), draft.body.text.toString()).filter { it.isNotBlank() }.joinToString("\n\n"))
                        })
                        if (alone) InkMenuItem("Leave", icon = "door", danger = true, onClick = { menu = false; leaving = true })
                        if (canWrite && !alone) InkMenuItem("Delete", icon = "trash", danger = true, onClick = {
                            menu = false
                            draft.discard()
                            model.delete(meta)
                            back()
                        })
                    }
                }
            }
        },
        snackbarHost = { SnackbarHost(snackbar) },
    ) { padding ->
        Column(Modifier.padding(padding).consumeWindowInsets(padding).fillMaxSize().imePadding()) {
            val scroll = rememberScrollState()
            Column(
                Modifier.weight(1f).fillMaxWidth().verticalScroll(scroll).padding(horizontal = 16.dp),
            ) {
                NoteTitle(draft, canWrite, titleFocus, onFocus = { focused ->
                    if (titleFocused && !focused) scope.launch { draft.rename() }
                    titleFocused = focused
                }) {
                    /* After the edit that asked for it, so the keyboard follows the focus to the body. */
                    scope.launch { kotlinx.coroutines.delay(50); runCatching { bodyFocus.requestFocus() } }
                }
                NoteBody(model, platform, draft, canWrite, scroll, bodyFocus, onFormats = { formats = it }) { focused ->
                    if (bodyFocused && !focused) scope.launch { draft.save() }
                    bodyFocused = focused
                }
                /* A tap below the words goes to the end of the note (only below: taps on the title stay in the title). */
                Spacer(Modifier.fillMaxWidth().height(200.dp).clickable(interactionSource = remember { MutableInteractionSource() }, indication = null, enabled = canWrite) {
                    draft.body.edit { selection = TextRange(length) }
                    runCatching { bodyFocus.requestFocus() }
                })
            }
            /* The format bar sits just above the keyboard (or at the foot, with a hardware one) while you write. */
            if (bodyFocused && canWrite) FormatBar(draft, formats) { focusManager.clearFocus() }
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
    /* 24px Mincho 600 at 1.25, 8 above, 10 below its 6 of padding. */
    val style = MaterialTheme.typography.headlineMedium.copy(color = MaterialTheme.colorScheme.onSurface, fontSize = 24.sp, lineHeight = 30.sp, fontWeight = FontWeight.SemiBold)
    Box(Modifier.fillMaxWidth().padding(top = 8.dp, bottom = 16.dp)) {
        if (draft.title.text.isEmpty()) Text("Untitled", style = style.copy(color = MaterialTheme.colorScheme.outline))
        BasicTextField(
            draft.title, readOnly = !canWrite, textStyle = style, cursorBrush = SolidColor(ink),
            lineLimits = TextFieldLineLimits.MultiLine(maxHeightInLines = 3),
            keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences),
            /* A title is one line: Return goes on to the body instead. */
            inputTransformation = {
                val text = asCharSequence()
                val at = text.indexOf('\n')
                if (at >= 0) {
                    replace(0, length, text.toString().replace("\n", ""))
                    selection = TextRange(length)
                    next()
                }
            },
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

/** The body: Markdown that reads as it will look, with dots for bullets, rings you can tick, and links a long press opens. */
@Composable
private fun NoteBody(
    model: NotesModel, platform: Platform, draft: NoteDraft, canWrite: Boolean, scroll: ScrollState, focus: FocusRequester,
    onFormats: (Set<String>) -> Unit, onFocus: (Boolean) -> Unit,
) {
    val scheme = MaterialTheme.colorScheme
    val headline = MaterialTheme.typography.headlineMedium.fontFamily
    val faint = faintColor()
    val accent = appAccent()
    val look = remember(scheme, headline, faint, accent) {
        NoteLook(text = scheme.onSurface, mark = faint, faint = faint, link = accent, accent = accent, quiet = scheme.onSurfaceVariant, code = scheme.onSurface, codeBack = scheme.surfaceContainerHigh, headline = headline)
    }
    var focused by remember { mutableStateOf(false) }
    /* The markup at the caret shows, so the styling follows the caret as well as the text. */
    val output = remember(look) { noteOutput(look, draft.body) { focused } }
    var layout by remember { mutableStateOf<TextLayoutResult?>(null) }
    val haptics = LocalHapticFeedback.current
    val caret = if (focused) draft.body.selection else null
    val spans = remember(draft.body.text, caret, look) { noteSpans(draft.body.text, look, caret) }
    /* What's drawn over the text goes where the text is shown, past a table's padding. */
    val display = remember(draft.body.text, caret) { noteDisplay(draft.body.text.toString(), caret?.start) }
    val d = display::map
    SideEffect { onFormats(spans.formats) }
    val rule = scheme.outlineVariant
    val headWash = scheme.surfaceContainerHigh.copy(alpha = .7f)
    val dot = accent
    val bar = accent.copy(alpha = .55f)
    val chip = scheme.surfaceContainerHigh
    Box(
        Modifier.fillMaxWidth().drawWithContent {
            /* Inline code's chip, behind its words: 4 either side, 1 above and below, 5 round. */
            layout?.let { result ->
                val length = result.layoutInput.text.length
                /* A table: its head washed, a hairline under each row, as wide as its widest row. */
                spans.tables.forEach { table ->
                    if (d(table.range.last) > length) return@forEach
                    val shown = table.rows.filterIndexed { i, _ -> i != 1 }
                    val firstLine = result.getLineForOffset(d(table.range.first))
                    val lastLine = result.getLineForOffset(minOf(d(table.range.last), length))
                    val right = (firstLine..lastLine).maxOf { result.getLineRight(it) } + 4.dp.toPx()
                    val hair = 1.dp.toPx()
                    shown.forEachIndexed { i, row ->
                        val top = result.getLineTop(result.getLineForOffset(d(row.first)))
                        val bottom = result.getLineBottom(result.getLineForOffset(minOf(d(maxOf(row.first, row.last)), length)))
                        if (i == 0) drawRect(headWash, Offset(-4.dp.toPx(), top), Size(right + 4.dp.toPx(), bottom - top))
                        drawRect(rule, Offset(-4.dp.toPx(), bottom - hair), Size(right + 4.dp.toPx(), hair))
                    }
                }
                spans.chips.forEach { range ->
                    val first = d(range.first); val last = d(range.last)
                    if (range.isEmpty() || last >= length) return@forEach
                    for (line in result.getLineForOffset(first)..result.getLineForOffset(last)) {
                        val from = maxOf(first, result.getLineStart(line))
                        val to = minOf(last, result.getLineEnd(line, visibleEnd = true) - 1)
                        if (to < from) continue
                        val a = result.getBoundingBox(from)
                        val b = result.getBoundingBox(to)
                        val mid = (a.top + a.bottom) / 2
                        val half = 9.5.dp.toPx()
                        drawRoundRect(chip, Offset(a.left - 4.dp.toPx(), mid - half), Size(b.right - a.left + 8.dp.toPx(), half * 2), CornerRadius(5.dp.toPx()))
                    }
                }
            }
            drawContent()
            val result = layout ?: return@drawWithContent
            val length = result.layoutInput.text.length
            /* Bullets as dots: filled at even depths, open rings at odd ones. */
            spans.bullets.forEach { bullet ->
                val at = d(bullet.at)
                if (at >= length) return@forEach
                val box = result.getBoundingBox(at)
                /* A .36em dot; an open ring with a 1.5 stroke at odd depths. */
                val r = 2.88.dp.toPx()
                val line = result.getLineForOffset(at)
                val c = Offset(box.left + 7.dp.toPx(), (result.getLineTop(line) + result.getLineBottom(line)) / 2 + .5.dp.toPx())
                if (bullet.depth % 2 == 0) drawCircle(dot, r, c) else drawCircle(dot, r - .75.dp.toPx(), c, style = Stroke(1.5.dp.toPx()))
            }
            /* A quote's bar, down its lines. */
            spans.quotes.forEach { lines ->
                val first = d(lines.first)
                if (first >= length) return@forEach
                val top = result.getLineTop(result.getLineForOffset(first))
                val bottom = result.getLineBottom(result.getLineForOffset(d(lines.last - 1).coerceIn(first, length - 1)))
                drawRect(bar, Offset(0f, top), Size(3.dp.toPx(), bottom - top))
            }
        },
    ) {
        BasicTextField(
            draft.body, readOnly = !canWrite,
            textStyle = MaterialTheme.typography.bodyLarge.copy(color = scheme.onSurface, fontSize = 16.sp, lineHeight = 26.4.sp, fontWeight = FontWeight.Normal),
            cursorBrush = SolidColor(scheme.primary),
            inputTransformation = noteInput, outputTransformation = output,
            keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences),
            onTextLayout = { result -> layout = result() },
            modifier = Modifier.fillMaxWidth().heightIn(min = 240.dp).focusRequester(focus)
                .onFocusChanged { focused = it.isFocused; onFocus(it.isFocused) }
                /* A hardware keyboard's shortcuts, where the phone or tablet passes them on. */
                .onPreviewKeyEvent { event -> canWrite && event.type == KeyEventType.KeyDown && shortcut(draft, event) }
                /* A long press on a link opens it. */
                .pointerInput(spans) {
                    awaitEachGesture {
                        val down = awaitFirstDown(requireUnconsumed = false, pass = PointerEventPass.Initial)
                        val at = layout?.getOffsetForPosition(down.position) ?: return@awaitEachGesture
                        val link = spans.links.firstOrNull { at in d(it.start) until d(it.end) } ?: return@awaitEachGesture
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
                val at = d(check.at)
                if (at + 2 >= result.layoutInput.text.length) return@forEach
                val box: Rect = result.getBoundingBox(at).let { first -> first.copy(right = result.getBoundingBox(at + 2).right) }
                /* 1.2em, at the line's start, centred on the line. */
                val side = with(density) { 19.2.dp.toPx() }
                val line = result.getLineForOffset(at)
                val x = box.left
                val y = (result.getLineTop(line) + result.getLineBottom(line) - side) / 2
                with(density) {
                    InkCheck(
                        checked = check.checked, ring = (if (check.checked) faint else scheme.onSurface).copy(alpha = .7f), ink = accent, seed = "check-${check.line}",
                        modifier = Modifier.offset { IntOffset(x.toInt(), y.toInt()) }.size(side.toDp())
                            .semantics { contentDescription = if (check.checked) "Ticked" else "Not ticked" }
                            .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null, enabled = canWrite) {
                                haptics.performHapticFeedback(HapticFeedbackType.TextHandleMove)
                                /* Found again by its line, as the text is now. */
                                draft.body.toggleCheckOn(check.line)
                                model.scope.launch { draft.save() }
                            },
                    )
                }
            }
        }
    }
}

/** ⌘ or Ctrl with B, I, E, K; ⇧7, ⇧8, ⇧9 for lists; ⌥1, ⌥2, ⌥3 for headings. */
private fun shortcut(draft: NoteDraft, event: androidx.compose.ui.input.key.KeyEvent): Boolean {
    if (!event.isMetaPressed && !event.isCtrlPressed) return false
    val body = draft.body
    when {
        event.isShiftPressed -> when (event.key) {
            Key.Seven -> body.toggleNumbered()
            Key.Eight -> body.toggleList()
            Key.Nine -> body.toggleChecklist()
            else -> return false
        }
        event.isAltPressed -> when (event.key) {
            Key.One -> body.setHeading(1)
            Key.Two -> body.setHeading(2)
            Key.Three -> body.setHeading(3)
            else -> return false
        }
        else -> when (event.key) {
            Key.B -> body.toggleBold()
            Key.I -> body.toggleItalic()
            Key.E -> body.toggleCode()
            Key.K -> body.makeLink()
            else -> return false
        }
    }
    return true
}

/**
 * Just above the keyboard: Bold, Italic | Heading | Bullets, Checklist, Table | Link,
 * Code. Flat buttons; the one for the formatting at the caret sits filled, as
 * a seal block with a pressed base. Done puts the keyboard away.
 */
@Composable
private fun FormatBar(draft: NoteDraft, formats: Set<String>, done: () -> Unit) {
    val body = draft.body
    val level = (1..3).firstOrNull { "h$it" in formats }
    /* A dock floating just above the keyboard, inset from the edges, on its own soft shadow. */
    Box(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp), contentAlignment = Alignment.Center) {
        Surface(
            color = MaterialTheme.colorScheme.surfaceContainerHigh, shape = RoundedCornerShape(18.dp), shadowElevation = 8.dp,
        ) {
            Row(
                Modifier.horizontalScroll(rememberScrollState()).padding(horizontal = 8.dp, vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(2.dp),
            ) {
                FormatButton("bold", "Bold", "bold" in formats) { body.toggleBold() }
                FormatButton("italic", "Italic", "italic" in formats) { body.toggleItalic() }
                Gap()
                FormatButton("heading", if (level == null) "Heading" else "Heading $level", level != null, label = level?.let { "H$it" }) { body.cycleHeading() }
                FormatButton("list", "Bullets", "bullet" in formats) { body.toggleList() }
                FormatButton("checklist", "Checklist", "check" in formats) { body.toggleChecklist() }
                FormatButton("table", "Table", "table" in formats) { body.insertTable() }
                Gap()
                FormatButton("link", "Link", "link" in formats) { body.makeLink() }
                FormatButton("code", "Code", "code" in formats) { body.toggleCode() }
                Gap()
                FormatButton("check", "Done", false, onClick = done)
            }
        }
    }
}

@Composable
private fun Gap() = Spacer(Modifier.width(6.dp)) /* 8 between groups, with the row's 2 */

@Composable
private fun FormatButton(icon: String, name: String, on: Boolean, label: String? = null, onClick: () -> Unit) {
    val scheme = MaterialTheme.colorScheme
    val base = scheme.onPrimaryContainer.copy(alpha = .22f)
    Box(
        Modifier.size(width = 32.dp, height = 30.dp).clip(RoundedCornerShape(6.dp))
            .then(if (on) Modifier.background(scheme.primaryContainer).drawBehind {
                /* A 2dp pressed base, so it reads as a seal block. */
                drawRect(base, Offset(0f, size.height - 2.dp.toPx()), Size(size.width, 2.dp.toPx()))
            } else Modifier)
            .clickable(onClickLabel = name, onClick = onClick)
            .semantics { contentDescription = name },
        contentAlignment = Alignment.Center,
    ) {
        val tint = if (on) scheme.onPrimaryContainer else scheme.onSurfaceVariant
        if (label != null) Text(label, style = MaterialTheme.typography.titleSmall, color = tint)
        else Icon(kimonoIcon(icon), null, tint = tint, modifier = Modifier.size(17.dp))
    }
}

/** Kata's faint ink, by light or dark. */
@Composable
internal fun faintColor(): Color = if (MaterialTheme.colorScheme.surface.luminance() < .5f) Color(0xFFB9A69F) else Color(0xFF6B605A)

/** The app's accent, suo, by light or dark. */
@Composable
internal fun appAccent(): Color = if (MaterialTheme.colorScheme.surface.luminance() < .5f) Color(0xFFD06A82) else Color(0xFFA84D63)

/** A 32dp icon button in the note head. */
@Composable
private fun HeadButton(icon: String, name: String, onClick: () -> Unit) = Box(
    Modifier.size(32.dp).clip(RoundedCornerShape(8.dp)).clickable(onClickLabel = name, onClick = onClick).semantics { contentDescription = name },
    contentAlignment = Alignment.Center,
) { Icon(kimonoIcon(icon), null, tint = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(18.dp)) }

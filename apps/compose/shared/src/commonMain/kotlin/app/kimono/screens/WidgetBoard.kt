@file:OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)

package app.kimono.screens

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.animation.core.animateIntOffsetAsState
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.detectDragGesturesAfterLongPress
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.requiredSize
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.times
import androidx.compose.ui.unit.sp
import androidx.compose.ui.zIndex
import app.kimono.data.Pick
import app.kimono.data.Friends
import app.kimono.data.KimonoProblem
import app.kimono.data.ProfileSection
import app.kimono.data.ReadBook
import app.kimono.data.ShareItem
import app.kimono.data.Widget
import app.kimono.theme.Kata
import app.kimono.theme.plumInk
import app.kimono.ui.InkLoader
import app.kimono.ui.InkSheet
import app.kimono.ui.InkTitle
import app.kimono.ui.Problem
import app.kimono.ui.Seal
import app.kimono.ui.SealTone
import app.kimono.ui.allZones
import app.kimono.ui.clickable
import app.kimono.ui.hereZone
import app.kimono.ui.kimonoIcon
import app.kimono.ui.nowMs
import coil3.compose.AsyncImage
import kotlinx.coroutines.delay

/*
 * 庭 The board: a profile's home screen of widgets on a two-wide grid
 * (small is one cell, wide is a row, large and full are two by two), packed
 * densely as a phone's home screen is. Your own can be arranged as one is:
 * hold a widget (or press Arrange) and they wiggle; drag one to move it,
 * press × to take it off, pick its size underneath, and add more from the
 * gallery. Done saves.
 */

class WidgetKind(val kind: String, val name: String, val says: String, val icon: String, val sizes: List<String>, val size: String)

val widgetKinds = listOf(
    WidgetKind("listening", "Now playing", "What you're playing, the record sliding out of its sleeve while you listen", "music", listOf("s", "m", "l", "xl"), "l"),
    WidgetKind("song", "Favourite song", "One song to sum you up", "music", listOf("s", "m", "l"), "m"),
    WidgetKind("album", "Favourite album", "The record you'd take to an island", "music", listOf("s", "m", "l"), "l"),
    WidgetKind("onrepeat", "On repeat", "The song you can't stop playing", "restore", listOf("s", "m"), "m"),
    WidgetKind("playlist", "A playlist", "One of yours, for friends to play", "music", listOf("s", "m", "l"), "m"),
    WidgetKind("loved", "Loved songs", "The songs you've loved, stacked", "heart", listOf("m", "l"), "m"),
    WidgetKind("artists", "Top artists", "Who you've played most this month", "people", listOf("m", "l", "xl"), "m"),
    WidgetKind("reading", "Reading", "The book you're in, and how far", "book", listOf("s", "m", "l"), "m"),
    WidgetKind("review", "Your review", "What you said about a book", "book", listOf("m", "l", "xl"), "l"),
    WidgetKind("bookshelf", "Bookshelf", "What you've read, spine by spine", "book", listOf("m", "l", "xl"), "xl"),
    WidgetKind("book", "Favourite book", "The one you press on everyone", "book", listOf("s", "m", "l"), "m"),
    WidgetKind("yearbooks", "Year in books", "How many you've read this year", "book", listOf("s", "m"), "s"),
    WidgetKind("watching", "Watching", "What's on, and how far", "film", listOf("s", "m", "l"), "m"),
    WidgetKind("watched", "Watched lately", "What you've seen, fanned out", "film", listOf("m", "l", "xl"), "m"),
    WidgetKind("show", "Favourite film or show", "The one you'd watch again tonight", "film", listOf("s", "m", "l"), "l"),
    WidgetKind("stats", "Your month", "Songs, hours and books", "clock", listOf("s", "m"), "s"),
    WidgetKind("note", "A note", "A few words, on paper", "brush", listOf("s", "m", "l"), "s"),
    WidgetKind("quote", "A quote", "Words you live by", "brush", listOf("m", "l", "xl"), "m"),
    WidgetKind("status", "Status", "How you are, in an emoji and a few words", "spark", listOf("s", "m"), "s"),
    WidgetKind("countdown", "Countdown", "The days until something", "clock", listOf("s", "m"), "s"),
    WidgetKind("clock", "Your time", "What time it is where you are", "clock", listOf("s", "m"), "s"),
    WidgetKind("links", "Links", "Your links, at hand", "link", listOf("m", "l", "xl"), "m"),
    WidgetKind("friends", "Friends", "Your friends' faces", "people", listOf("m", "l"), "m"),
)
fun kindOf(k: String) = widgetKinds.firstOrNull { it.kind == k } ?: widgetKinds.last()
private val sizeName = mapOf("s" to "Small", "m" to "Wide", "l" to "Large", "xl" to "Full")

private class Shelf(val title: String, val tint: Color, val kinds: List<String>)
private val shelves = listOf(
    Shelf("Music", Color(0xFF946C25), listOf("listening", "song", "album", "onrepeat", "playlist", "loved", "artists")),
    Shelf("Books", Color(0xFF5C7150), listOf("reading", "review", "bookshelf", "book", "yearbooks")),
    Shelf("Watch", Color(0xFFA84D63), listOf("watching", "watched", "show")),
    Shelf("About you", Color(0xFF74565C), listOf("status", "note", "quote", "countdown", "clock", "stats", "links")),
)

private var made = 0
private fun newId() = "w${nowMs().toString(36)}${(made++).toString(36)}"

/** Friends are always on the board, wherever you've put them; never for a visitor when there are none. */
fun withFriends(ws: List<Widget>, d: BoardData): List<Widget> =
    if (ws.any { it.kind == "friends" } || (d.friends.isEmpty() && d.own == null)) ws else ws + Widget("friends", "friends", "m")

/** The row of someone's activity a widget shows (lib/friends/model.ts rowsOf). */
private val widgetRow = mapOf(
    "listening" to "music:playing", "onrepeat" to "music:stats", "artists" to "music:stats", "stats" to "music:stats", "loved" to "music:loved",
    "reading" to "books:reading", "review" to "books:reviews", "bookshelf" to "books:read", "yearbooks" to "books:read",
    "watching" to "watch:watching", "watched" to "watch:watched",
)

/** Whether a widget of their activity has anything in it for whoever's looking; those that don't aren't drawn for others. */
private fun hasData(w: Widget, d: BoardData): Boolean {
    fun has(app: String, kind: String) = d.sections.any { it.app == app && it.kind == kind && it.items.isNotEmpty() }
    return when (w.kind) {
        "listening" -> d.music?.listening != null
        "onrepeat" -> d.music?.onRepeat != null
        "artists" -> d.music?.artists?.isNotEmpty() == true
        "stats" -> (d.music?.plays ?: 0) > 0
        "loved" -> has("music", "loved")
        "reading" -> has("books", "reading")
        "review" -> d.books?.reviews?.isNotEmpty() == true
        "bookshelf" -> d.books?.read?.isNotEmpty() == true
        "watching" -> has("watch", "watching")
        "watched" -> has("watch", "watched")
        "links" -> d.links.any(::inLinks)
        else -> true
    }
}

/** A home screen for someone who hasn't arranged one: what they have, at sensible sizes. */
fun defaultWidgets(d: BoardData): List<Widget> {
    fun has(app: String, kind: String) = d.sections.any { it.app == app && it.kind == kind && it.items.isNotEmpty() }
    return buildList {
        if (d.music?.listening != null) add(Widget("d-listening", "listening", "l"))
        if (has("books", "reading")) add(Widget("d-reading", "reading", "m"))
        if (has("watch", "watching")) add(Widget("d-watching", "watching", "m"))
        if (d.music?.artists?.isNotEmpty() == true) add(Widget("d-artists", "artists", "m"))
        if (d.links.isNotEmpty()) add(Widget("d-links", "links", if (d.links.size > 2) "l" else "m"))
        if ((d.music?.plays ?: 0) > 0) add(Widget("d-stats", "stats", "s"))
    }
}

/*
 * Where each widget sits: cells of a grid [columns] wide (two on a phone, more as the board
 * widens on an iPad), packed densely (the first gap each fits). Widgets keep their spans, so a
 * small widget stays one phone-sized cell instead of swelling to half a tablet.
 */
private fun span(size: String) = when (size) { "s" -> 1 to 1; "m" -> 2 to 1; else -> 2 to 2 }
private data class Slot(val col: Int, val row: Int, val w: Int, val h: Int)
private fun pack(sizes: List<String>, columns: Int = 2): List<Slot> {
    val taken = HashSet<Pair<Int, Int>>()
    return sizes.map { s ->
        val (w, h) = span(s)
        var row = 0
        while (true) {
            val col = (0..columns - w).firstOrNull { c -> (0 until w).all { dx -> (0 until h).all { dy -> (c + dx to row + dy) !in taken } } }
            if (col != null) {
                for (dx in 0 until w) for (dy in 0 until h) taken += (col + dx) to (row + dy)
                return@map Slot(col, row, w, h)
            }
            row++
        }
        @Suppress("UNREACHABLE_CODE") Slot(0, 0, 1, 1)
    }
}

/**
 * The board, as [d] has it. [arranging] is the profile's to turn on (its Arrange seal, or holding a
 * widget); turning it off saves what was arranged with [onSave].
 */
@Composable
fun WidgetBoard(
    d: BoardData, widgets: List<Widget>?, editable: Boolean, arranging: Boolean, onArranging: (Boolean) -> Unit,
    friends: Friends, act: BoardActions, onSave: suspend (List<Widget>) -> Unit,
) {
    val shown = remember(widgets, d) { withFriends(widgets ?: defaultWidgets(d), d) }
    var draft by remember { mutableStateOf(shown) }
    var was by remember { mutableStateOf(arranging) }
    var adding by remember { mutableStateOf(false) }
    val save by rememberUpdatedState(onSave)
    if (was != arranging) {
        if (arranging) draft = shown
        was = arranging
    }
    /* Done: what was arranged is saved, once; a clock without a zone takes the one you're in. */
    LaunchedEffect(arranging) {
        if (!arranging && draft != shown) {
            val zone = hereZone()
            save(draft.map { if (it.kind == "clock" && it.config?.get("zone").isNullOrBlank()) it.copy(config = mapOf("zone" to zone)) else it })
        }
    }
    val list = if (arranging) draft else if (editable) shown else shown.filter { hasData(it, d) }
    if (list.isEmpty() && !editable) return
    val still = LocalStill.current
    var dragging by remember { mutableStateOf<String?>(null) }
    var dragAt by remember { mutableStateOf(Offset.Zero) }
    var grab by remember { mutableStateOf(Offset.Zero) }
    val density = LocalDensity.current
    val dashInk = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = .4f)
    BoxWithConstraints(Modifier.fillMaxWidth().padding(horizontal = 12.dp)) {
        val gap = 10.dp
        /* As many cells of about a phone's half-width as fit; never fewer than two, the widest span. */
        val columns = ((maxWidth + gap) / (176.dp + gap)).toInt().coerceIn(2, 6)
        val cell = (maxWidth - gap * (columns - 1)) / columns
        val rowH = cell * .92f
        val cells = list.map { it.size } + (if (editable) listOf(if (list.isEmpty()) "m" else "s") else emptyList())
        val slots = pack(cells, columns)
        val rows = slots.maxOfOrNull { it.row + it.h } ?: 0
        fun rect(s: Slot) = with(density) {
            Rect(Offset((s.col * (cell + gap)).toPx(), (s.row * (rowH + gap)).toPx()), androidx.compose.ui.geometry.Size((s.w * cell + (s.w - 1) * gap).toPx(), (s.h * rowH + (s.h - 1) * gap).toPx()))
        }
        val rects = slots.map(::rect)
        val currentRects by rememberUpdatedState(rects)
        val currentList by rememberUpdatedState(list)
        /*
         * Holding a widget picks it up (and starts arranging); dragging it over another puts it there.
         * The board listens, not the widget, so the widget can follow the finger.
         */
        val dragging_ = Modifier.pointerInput(editable) {
            if (!editable) return@pointerInput
            detectDragGesturesAfterLongPress(
                onDragStart = { at ->
                    val i = currentRects.take(currentList.size).indexOfFirst { it.contains(at) }
                    if (i >= 0) { onArranging(true); dragging = currentList[i].id; dragAt = at; grab = at - currentRects[i].topLeft }
                },
                onDragEnd = { dragging = null },
                onDragCancel = { dragging = null },
            ) { change, amount ->
                val id = dragging ?: return@detectDragGesturesAfterLongPress
                change.consume()
                dragAt += amount
                val over = currentRects.take(draft.size).indexOfFirst { it.contains(dragAt) }
                val from = draft.indexOfFirst { it.id == id }
                if (over >= 0 && from >= 0 && over != from) draft = draft.toMutableList().apply { add(over, removeAt(from)) }
            }
        }
        Box(Modifier.fillMaxWidth().height(rowH * rows + gap * (rows - 1).coerceAtLeast(0)).then(dragging_)) {
            list.forEachIndexed { n, w ->
                key(w.id) {
                    val r = rects[n]
                    val lifted = dragging == w.id
                    val at by animateIntOffsetAsState(IntOffset(r.left.toInt(), r.top.toInt()), spring(.7f, 400f), label = "slot")
                    val place = if (lifted) IntOffset((dragAt.x - grab.x).toInt(), (dragAt.y - grab.y).toInt()) else at
                    val arrive = remember { Animatable(if (still) 1f else 0f) }
                    LaunchedEffect(Unit) { if (!still) { delay(80L + n * 70L); arrive.animateTo(1f, spring(.62f, 220f)) } }
                    val wiggle = if (arranging && !still && !lifted) rememberInfiniteTransition(label = "wiggle").animateFloat(-.7f, .7f, infiniteRepeatable(tween(160 + (n % 3) * 20), RepeatMode.Reverse), label = "w") else null
                    Box(
                        Modifier.offset { place }.size(with(density) { r.width.toDp() }, with(density) { r.height.toDp() })
                            .zIndex(if (lifted) 2f else if (d.own != null && widgetRow[w.kind].let { it != null && (it in d.own.keptRows || it in d.own.friendsOnlyRows) }) 1f else 0f)
                            .graphicsLayer {
                                alpha = arrive.value * if (lifted) .9f else 1f
                                translationY = (1 - arrive.value) * 18.dp.toPx()
                                val sc = .97f + .03f * arrive.value
                                scaleX = if (lifted) 1.05f else sc; scaleY = if (lifted) 1.05f else sc
                                rotationZ = wiggle?.value ?: 0f
                            },
                    ) {
                        val row = widgetRow[w.kind]
                        val own = d.own
                        /* Only a warning: where your settings keep a widget from people who can see your profile. */
                        val warn = when {
                            arranging || row == null || own == null -> null
                            row in own.keptRows -> if (own.publicProfile) "Nobody else sees this" to "everyone" else "Friends don't see this" to "friends"
                            row in own.friendsOnlyRows -> "Public doesn't see this" to "everyone"
                            else -> null
                        }
                        androidx.compose.runtime.CompositionLocalProvider(LocalArranging provides arranging) { WidgetView(w, d, if (arranging) BoardActions() else act) }
                        if (warn != null && row != null) {
                            Box(Modifier.matchParentSize().border(2.dp, WarnGold.copy(alpha = .7f), RoundedCornerShape(28.dp)))
                            KeptMark(warn.first, Modifier.align(Alignment.BottomCenter).offset(y = 11.dp), own?.onShare?.let { share -> { share(row, warn.second) } })
                        }
                        if (arranging) {
                            /* While arranging, a widget is something to move: what's in it doesn't open. */
                            Box(Modifier.matchParentSize().pointerInput(Unit) {})
                            if (w.kind != "friends") Box(
                                Modifier.offset((-6).dp, (-6).dp).size(30.dp).shadow(4.dp, CircleShape).clip(CircleShape).background(MaterialTheme.colorScheme.onSurface)
                                    .clickable { draft = draft.filter { it.id != w.id } }.semantics { contentDescription = "Remove ${kindOf(w.kind).name}" },
                                contentAlignment = Alignment.Center,
                            ) { Icon(kimonoIcon("close"), null, tint = MaterialTheme.colorScheme.surface, modifier = Modifier.size(16.dp)) }
                            SizePick(kindOf(w.kind).sizes, w.size, Modifier.align(Alignment.BottomEnd).padding(8.dp)) { s -> draft = draft.map { if (it.id == w.id) it.copy(size = s) else it } }
                        }
                    }
                }
            }
            /* The last cell: add one. */
            if (cells.size > list.size) {
                val r = rects.last()
                Column(
                    Modifier.offset { IntOffset(r.left.toInt(), r.top.toInt()) }.size(with(density) { r.width.toDp() }, with(density) { r.height.toDp() })
                        .clip(RoundedCornerShape(28.dp))
                        .then(if (list.isEmpty()) Modifier.background(MaterialTheme.colorScheme.surfaceContainer) else Modifier.drawBehind {
                            /* A dashed [ + ]: room for one more. */
                            drawRoundRect(dashInk, cornerRadius = androidx.compose.ui.geometry.CornerRadius(28.dp.toPx()), style = androidx.compose.ui.graphics.drawscope.Stroke(2.dp.toPx(), pathEffect = androidx.compose.ui.graphics.PathEffect.dashPathEffect(floatArrayOf(8.dp.toPx(), 6.dp.toPx()))))
                        })
                        .clickable { if (!arranging) onArranging(true); adding = true }.semantics { contentDescription = "Add a widget" },
                    horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterVertically),
                ) {
                    Icon(kimonoIcon("plus"), null, tint = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(if (list.isEmpty()) 28.dp else 34.dp))
                    if (list.isEmpty()) Text("Make this yours: add widgets", style = MaterialTheme.typography.labelLarge.copy(fontWeight = FontWeight.Bold), color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }
    }
    /* Arranging: Done, under the board. */
    if (arranging) Row(
        Modifier.fillMaxWidth().padding(horizontal = 16.dp).padding(top = 14.dp).clip(RoundedCornerShape(topStart = 18.dp, bottomEnd = 18.dp, topEnd = 6.dp, bottomStart = 6.dp))
            .background(MaterialTheme.colorScheme.surfaceContainerHighest).padding(start = 18.dp, end = 8.dp, top = 8.dp, bottom = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text("Hold and drag to move", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.weight(1f))
        app.kimono.ui.Seal("Done", compact = true, icon = "check", onClick = { onArranging(false) })
    }
    if (adding) Gallery(d, friends, onClose = { adding = false }) { w ->
        draft = (draft + w).take(16)
        adding = false
        if (!arranging) onArranging(true)
    }
}

private val WarnGold = Color(0xFFE8B04A)
private val WarnInk = Color(0xFF3A2A12)

/** A gold tag on a widget's foot: your settings keep it from some who see your profile, and Share is right there. */
@Composable
private fun KeptMark(says: String, modifier: Modifier, share: (() -> Unit)?) {
    Row(
        modifier.height(26.dp).shadow(6.dp, RoundedCornerShape(10.dp, 4.dp, 10.dp, 4.dp)).clip(RoundedCornerShape(10.dp, 4.dp, 10.dp, 4.dp)).background(WarnGold).padding(start = 9.dp, end = 3.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Icon(kimonoIcon("lock"), null, tint = WarnInk, modifier = Modifier.size(13.dp))
        Text(says, style = MaterialTheme.typography.labelSmall.copy(fontWeight = FontWeight.Bold), color = WarnInk, maxLines = 1)
        if (share != null) Text(
            "Share", style = MaterialTheme.typography.labelSmall.copy(fontWeight = FontWeight.Bold), color = Color(0xFFF6E2B8), maxLines = 1,
            modifier = Modifier.clip(RoundedCornerShape(7.dp, 3.dp, 7.dp, 3.dp)).background(WarnInk).clickable(onClick = share).padding(horizontal = 8.dp, vertical = 4.dp),
        ) else Spacer(Modifier.width(3.dp))
    }
}

/** A widget's sizes, as little outlines of each shape; the one it is, filled. */
@Composable
private fun SizePick(sizes: List<String>, now: String, modifier: Modifier, pick: (String) -> Unit) {
    Row(modifier.shadow(6.dp, RoundedCornerShape(14.dp)).clip(RoundedCornerShape(14.dp)).background(MaterialTheme.colorScheme.surfaceContainerHighest).padding(3.dp), horizontalArrangement = Arrangement.spacedBy(2.dp)) {
        sizes.forEach { s ->
            val on = s == now
            val ink = if (on) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant
            Box(
                Modifier.size(32.dp, 30.dp).clip(RoundedCornerShape(10.dp)).background(if (on) MaterialTheme.colorScheme.secondaryContainer else Color.Transparent)
                    .clickable { pick(s) }.semantics { contentDescription = sizeName[s] ?: s },
                contentAlignment = Alignment.Center,
            ) {
                val (gw, gh) = when (s) { "s" -> 10 to 10; "m" -> 18 to 10; "l" -> 16 to 16; else -> 22 to 14 }
                Box(Modifier.size(gw.dp, gh.dp).border(2.dp, ink, RoundedCornerShape(3.dp)))
            }
        }
    }
}

/* ── The gallery ──────────────────────────────────────────────────────── */

/* What a preview shows for a widget that's made from your choices. */
private val samples: Map<String, Map<String, String>> = mapOf(
    "book" to mapOf("key" to "ol:0", "title" to "Your book", "subtitle" to "Any author", "cover" to ""),
    "show" to mapOf("key" to "x", "title" to "Your film or show", "subtitle" to "", "cover" to ""),
    "playlist" to mapOf("key" to "xxxxxxxx", "title" to "Your playlist", "subtitle" to "", "cover" to ""),
    "countdown" to mapOf("date" to "", "label" to "Holidays"),
    "quote" to mapOf("text" to "Not all those who wander are lost.", "by" to "Tolkien"),
    "yearbooks" to mapOf("goal" to "24"),
    "song" to mapOf("key" to "dz:0", "title" to "Your song", "subtitle" to "Any artist", "cover" to ""),
    "album" to mapOf("key" to "dz:0", "title" to "Your album", "subtitle" to "Any artist", "cover" to ""),
    "note" to mapOf("text" to "ask me about city pop", "tint" to "sakura"),
    "status" to mapOf("emoji" to "🎧", "text" to "In a city pop phase"),
    "clock" to mapOf("zone" to ""),
)
private val needsChoosing = setOf("song", "album", "note", "status", "clock", "book", "show", "playlist", "countdown", "quote", "yearbooks")

/** Where someone has nothing yet (no books read, nothing watched), a few made-up things show what a widget looks like. */
private fun previewData(d: BoardData): BoardData {
    val titles = listOf("The Remains of the Day" to "Kazuo Ishiguro", "Piranesi" to "Susanna Clarke", "Kitchen" to "Banana Yoshimoto", "Dune" to "Frank Herbert", "Norwegian Wood" to "Haruki Murakami", "Circe" to "Madeline Miller", "The Hobbit" to "J.R.R. Tolkien", "Beloved" to "Toni Morrison", "Stoner" to "John Williams")
    val now = nowMs()
    val read = titles.mapIndexed { i, (t, a) -> ReadBook("demo:$i", t, a, null, if (i % 3 == 0) "love" else null, now - i * 86_400_000L * 9) }
    val posters = d.sections.filter { it.app == "watch" }.flatMap { it.items }.filter { it.cover != null }
    val watched = if (d.sections.any { it.app == "watch" && it.kind == "watched" && it.items.isNotEmpty() } || posters.isEmpty()) emptyList()
    else listOf(ProfileSection("watch", "Watch", "watched", "Watched", List(4) { i -> posters[i % posters.size].copy(itemId = "demo$i") }))
    val books = if (d.books?.read?.isNotEmpty() == true) d.books else app.kimono.data.BooksExtras(listOf(read[0].copy(review = "Quiet, restrained and devastating: a whole life told in what's left unsaid.")), read)
    return BoardData(d.person, d.sections + watched, d.links, d.friends, d.music, books, d.color, d.own, d.server)
}

@Composable
private fun Gallery(real: BoardData, friends: Friends, onClose: () -> Unit, onPick: (Widget) -> Unit) {
    val data = remember { previewData(real) }
    var choosing by remember { mutableStateOf<String?>(null) }
    InkSheet(onDismissRequest = onClose, seed = "gallery") {
        val k = choosing?.let(::kindOf)
        Row(Modifier.fillMaxWidth().padding(start = 24.dp, end = 16.dp, bottom = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.weight(1f)) { InkTitle(k?.name ?: "Add a widget", "plus") }
            Seal(if (k != null) "Back" else "Cancel", compact = true, tone = SealTone.Quiet, onClick = { if (k != null) choosing = null else onClose() })
        }
        if (k == null) Column(Modifier.heightIn(max = 620.dp).verticalScroll(rememberScrollState()).padding(bottom = 16.dp)) {
            shelves.forEach { shelf ->
                Text(shelf.title, style = MaterialTheme.typography.titleLarge.copy(fontFamily = MaterialTheme.typography.headlineSmall.fontFamily), color = inkOf(shelf.tint), modifier = Modifier.padding(start = 24.dp, top = 12.dp, bottom = 8.dp))
                Row(Modifier.horizontalScroll(rememberScrollState()).padding(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    shelf.kinds.forEach { kd ->
                        val x = kindOf(kd)
                        val preview = if (x.size == "s") "s" else "m"
                        Column(
                            Modifier.width(if (preview == "s") 150.dp else 230.dp).clip(RoundedCornerShape(20.dp)).clickable {
                                if (kd in needsChoosing) choosing = kd else onPick(Widget(newId(), kd, x.size))
                            }.padding(6.dp),
                            verticalArrangement = Arrangement.spacedBy(3.dp),
                        ) {
                            /* The widget itself, small, made from your own things. */
                            Box(Modifier.fillMaxWidth().height(128.dp).clip(RoundedCornerShape(18.dp)).background(androidx.compose.ui.graphics.lerp(MaterialTheme.colorScheme.surfaceContainerHigh, shelf.tint, .1f)), contentAlignment = Alignment.Center) {
                                val (pw, ph) = if (preview == "s") 165.dp to 152.dp else 340.dp to 152.dp
                                val scale = if (preview == "s") .74f else .62f
                                Box(Modifier.requiredSize(pw, ph).graphicsLayer { scaleX = scale; scaleY = scale }) {
                                    androidx.compose.runtime.CompositionLocalProvider(LocalStill provides true, LocalArranging provides true) {
                                        WidgetView(Widget("p", kd, preview, samples[kd]?.let { s -> if (kd == "countdown") s + ("date" to sampleDate()) else s }), data, BoardActions())
                                    }
                                }
                                /* A preview is to look at: a tap picks it. */
                                Box(Modifier.matchParentSize().pointerInput(Unit) {})
                            }
                            Text(x.name, style = MaterialTheme.typography.labelLarge.copy(fontWeight = FontWeight.Bold), modifier = Modifier.padding(start = 4.dp, top = 4.dp))
                            Text(x.says, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 2, modifier = Modifier.padding(start = 4.dp))
                        }
                    }
                }
            }
        } else Column(Modifier.padding(horizontal = 24.dp).padding(bottom = 16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            val kd = k.kind
            fun pick(size: String, config: Map<String, String>) = onPick(Widget(newId(), kd, size, config))
            when (kd) {
                "song", "album" -> Finder(if (kd == "album") "Find an album" else "Find a song", if (kd == "album") "Random Access Memories" else "Plastic Love", "Music isn't there to search.", { q -> friends.findMusic(q, kd == "album") }, { pick(k.size, it.asConfig()) })
                "book" -> Finder("Find a book", "The Left Hand of Darkness", "Books isn't there to search.", { q -> friends.findBooks(q) }, { pick(k.size, it.asConfig()) })
                "show" -> Finder("Find a film or a show", "Spirited Away", "Watch isn't there to search.", { q -> friends.findShows(q) }, { pick(k.size, it.asConfig()) })
                "playlist" -> PlaylistPicker(friends) { pick(k.size, it.asConfig()) }
                "note" -> NoteMaker { t, tint -> pick("s", mapOf("text" to t, "tint" to tint)) }
                "status" -> StatusMaker { e, t -> pick("s", mapOf("emoji" to e, "text" to t)) }
                "clock" -> ClockMaker { pick("s", mapOf("zone" to it)) }
                "countdown" -> CountdownMaker { label, date -> pick("s", mapOf("label" to label, "date" to date)) }
                "quote" -> QuoteMaker { t, by -> pick("m", mapOf("text" to t, "by" to by)) }
                else -> GoalMaker { pick("s", mapOf("goal" to it)) }
            }
        }
    }
}

private fun sampleDate(): String { val (y, m, d) = civil(epochDayNow() + 12); return "$y-${m.toString().padStart(2, '0')}-${d.toString().padStart(2, '0')}" }
private fun Pick.asConfig() = mapOf("key" to key, "title" to title, "subtitle" to subtitle, "cover" to (cover ?: ""))

/** Search one app for something to put on a widget. */
@Composable
private fun Finder(label: String, example: String, missing: String, search: suspend (String) -> List<Pick>, onPick: (Pick) -> Unit) {
    var q by remember { mutableStateOf("") }
    var found by remember { mutableStateOf<List<Pick>?>(null) }
    var problem by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(q) {
        if (q.trim().length < 2) { found = null; return@LaunchedEffect }
        delay(260)
        try { found = search(q); problem = null } catch (_: KimonoProblem) { problem = missing } catch (_: Exception) { problem = missing }
    }
    OutlinedTextField(q, { q = it }, label = { Text(label) }, placeholder = { Text(example) }, singleLine = true, colors = kataFieldColors(), modifier = Modifier.fillMaxWidth())
    Problem(problem)
    Column(Modifier.heightIn(max = 360.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(2.dp)) {
        found.orEmpty().forEach { f -> FoundRow(f) { onPick(f) } }
    }
}

@Composable
private fun FoundRow(f: Pick, onClick: () -> Unit) {
    Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).clickable(onClick = onClick).padding(6.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Box(Modifier.size(48.dp).clip(RoundedCornerShape(10.dp)).background(MaterialTheme.colorScheme.surfaceContainerHigh)) { f.cover?.let { AsyncImage(it, null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize()) } }
        Column(Modifier.weight(1f)) {
            Text(f.title, style = MaterialTheme.typography.bodyLarge, maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (f.subtitle.isNotBlank()) Text(f.subtitle, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
        }
    }
}

@Composable
private fun PlaylistPicker(friends: Friends, onPick: (Pick) -> Unit) {
    var lists by remember { mutableStateOf<List<Pick>?>(null) }
    LaunchedEffect(Unit) { lists = runCatching { friends.playlists() }.getOrDefault(emptyList()) }
    val now = lists
    when {
        now == null -> Box(Modifier.fillMaxWidth().padding(24.dp), contentAlignment = Alignment.Center) { InkLoader(size = 32.dp) }
        now.isEmpty() -> Text("Make a playlist in Music first.", color = MaterialTheme.colorScheme.onSurfaceVariant)
        else -> Column(Modifier.heightIn(max = 420.dp).verticalScroll(rememberScrollState())) { now.forEach { f -> FoundRow(f) { onPick(f) } } }
    }
}

@Composable
private fun NoteMaker(onPick: (String, String) -> Unit) {
    var text by remember { mutableStateOf("") }
    var tint by remember { mutableStateOf("sakura") }
    OutlinedTextField(text, { if (it.length <= 160) text = it }, label = { Text("Your note") }, placeholder = { Text("Ask me about city pop") }, minLines = 3, colors = kataFieldColors(), modifier = Modifier.fillMaxWidth())
    Swatches(tint) { tint = it }
    Seal("Add", compact = true, enabled = text.isNotBlank(), onClick = { onPick(text.trim(), tint) })
}

/** The house's pigments, each a dab to pick. */
@Composable
internal fun Swatches(chosen: String?, pick: (String) -> Unit) {
    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        noteTints.forEach { (id, hex) ->
            val on = id == chosen
            Box(
                Modifier.size(36.dp).clip(CircleShape).background(hex).then(if (on) Modifier.border(3.dp, MaterialTheme.colorScheme.surface, CircleShape).border(5.dp, hex, CircleShape) else Modifier)
                    .clickable { pick(id) }.semantics { contentDescription = id },
                contentAlignment = Alignment.Center,
            ) { if (on) Icon(kimonoIcon("check"), null, tint = Color.White, modifier = Modifier.size(16.dp)) }
        }
    }
}

private val statusEmoji = listOf("🌸", "🎧", "📚", "🍿", "☕", "😴", "🔥", "🌧️", "✈️", "💻", "🎮", "🍜")

@Composable
private fun StatusMaker(onPick: (String, String) -> Unit) {
    var emoji by remember { mutableStateOf("🎧") }
    var text by remember { mutableStateOf("") }
    FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        statusEmoji.forEach { e ->
            Box(
                Modifier.size(44.dp).clip(RoundedCornerShape(14.dp)).background(if (e == emoji) MaterialTheme.colorScheme.secondaryContainer else MaterialTheme.colorScheme.surfaceContainerHighest)
                    .then(if (e == emoji) Modifier.border(2.dp, MaterialTheme.colorScheme.primary, RoundedCornerShape(14.dp)) else Modifier).clickable { emoji = e },
                contentAlignment = Alignment.Center,
            ) { Text(e, fontSize = 22.sp) }
        }
    }
    OutlinedTextField(text, { if (it.length <= 60) text = it }, label = { Text("Status") }, placeholder = { Text("In a city pop phase") }, singleLine = true, colors = kataFieldColors(), modifier = Modifier.fillMaxWidth())
    Seal("Add", compact = true, onClick = { onPick(emoji, text.trim()) })
}

@Composable
private fun ClockMaker(onPick: (String) -> Unit) {
    val here = remember { hereZone() }
    val zones = remember { allZones().ifEmpty { listOf(here) } }
    var zone by remember { mutableStateOf(here) }
    var typed by remember { mutableStateOf("") }
    OutlinedTextField(typed, { typed = it }, label = { Text("Where you are") }, placeholder = { Text(here.replace('_', ' ')) }, singleLine = true, colors = kataFieldColors(), modifier = Modifier.fillMaxWidth())
    val shown = zones.filter { typed.isBlank() || it.replace('_', ' ').contains(typed.trim(), ignoreCase = true) }.let { if (typed.isBlank()) listOf(here) + it.filter { z -> z != here } else it }.take(40)
    Column(Modifier.heightIn(max = 300.dp).verticalScroll(rememberScrollState())) {
        shown.forEach { z ->
            Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(if (z == zone) MaterialTheme.colorScheme.secondaryContainer else Color.Transparent).clickable { zone = z }.padding(horizontal = 12.dp, vertical = 10.dp)) {
                Text(z.replace('_', ' '), style = MaterialTheme.typography.bodyLarge, modifier = Modifier.weight(1f))
                Text(apart(z), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
    Seal("Add", compact = true, onClick = { onPick(zone) })
}

@Composable
private fun CountdownMaker(onPick: (String, String) -> Unit) {
    var label by remember { mutableStateOf("") }
    var date by remember { mutableStateOf("") }
    var picking by remember { mutableStateOf(false) }
    OutlinedTextField(label, { if (it.length <= 40) label = it }, label = { Text("What's coming") }, placeholder = { Text("Japan trip") }, singleLine = true, colors = kataFieldColors(), modifier = Modifier.fillMaxWidth())
    Seal(if (date.isBlank()) "Pick the day" else epochDayOf(date)?.let(::longDate) ?: date, compact = true, tone = SealTone.Quiet, icon = "clock", onClick = { picking = true })
    Seal("Add", compact = true, enabled = date.isNotBlank(), onClick = { onPick(label.trim(), date) })
    if (picking) {
        val state = rememberDatePickerState(initialSelectedDateMillis = (epochDayNow() + 7) * 86_400_000L)
        DatePickerDialog(onDismissRequest = { picking = false }, confirmButton = {
            Seal("Done", compact = true, onClick = {
                state.selectedDateMillis?.let { ms -> val (y, m, d) = civil(ms / 86_400_000L); date = "$y-${m.toString().padStart(2, '0')}-${d.toString().padStart(2, '0')}" }
                picking = false
            })
        }, dismissButton = { Seal("Cancel", compact = true, tone = SealTone.Quiet, onClick = { picking = false }) }) { DatePicker(state) }
    }
}

@Composable
private fun QuoteMaker(onPick: (String, String) -> Unit) {
    var text by remember { mutableStateOf("") }
    var by by remember { mutableStateOf("") }
    OutlinedTextField(text, { if (it.length <= 200) text = it }, label = { Text("The words") }, minLines = 3, colors = kataFieldColors(), modifier = Modifier.fillMaxWidth())
    OutlinedTextField(by, { if (it.length <= 60) by = it }, label = { Text("Who said it") }, singleLine = true, colors = kataFieldColors(), modifier = Modifier.fillMaxWidth())
    Seal("Add", compact = true, enabled = text.isNotBlank(), onClick = { onPick(text.trim(), by.trim()) })
}

@Composable
private fun GoalMaker(onPick: (String) -> Unit) {
    var goal by remember { mutableStateOf("12") }
    OutlinedTextField(goal, { goal = it.filter(Char::isDigit).take(3) }, label = { Text("Books you mean to read this year") }, singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number), colors = kataFieldColors(), modifier = Modifier.fillMaxWidth())
    Seal("Add", compact = true, onClick = { onPick((goal.toIntOrNull() ?: 0).coerceIn(0, 999).toString()) })
}

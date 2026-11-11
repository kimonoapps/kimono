package app.kimono.watch.player

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.kimono.watch.LocalWatch
import app.kimono.watch.ink.InkLoader
import app.kimono.watch.model.Person
import app.kimono.watch.theme.Night
import app.kimono.watch.theme.display
import app.kimono.watch.theme.ui
import app.kimono.watch.ui.I
import app.kimono.watch.ui.Ic
import app.kimono.watch.ui.Img
import app.kimono.watch.ui.PaperButton
import app.kimono.watch.ui.TogetherViewModel
import app.kimono.watch.ui.clickableScaleClipped
import app.kimono.watch.ui.faceColor
import app.kimono.watch.ui.partyReactions
import kotlinx.coroutines.delay

/** A household face, by username: their Kimono portrait, or their initial on their colour. */
@Composable
fun PersonFace(person: Person?, username: String, size: Dp, modifier: Modifier = Modifier) {
    val server = LocalWatch.current.accounts.server.orEmpty()
    Box(modifier.size(size).clip(RoundedCornerShape(size * .28f)).background(faceColor(username)), contentAlignment = Alignment.Center) {
        Text((person?.shown ?: username).take(1).uppercase(), style = display((size.value * .44f).toInt(), color = Night.paper))
        person?.picture?.let { pic -> Img(if (pic.startsWith("http")) pic else server + pic, Modifier.fillMaxSize().background(Color.Transparent)) }
    }
}

/**
 * What the party looks like over the picture: "Waiting for Sami…" while the
 * party is held, "Sami paused" when someone else steers (or why this screen
 * can't), and reactions floating up, clear of the chat when it's open.
 */
@Composable
fun PartyLayer(party: TogetherViewModel, chrome: Boolean, tv: Boolean, endInset: Dp = 0.dp) {
    val state by party.state.collectAsState()
    val problem by party.problem.collectAsState()
    val s = state ?: return
    Box(Modifier.fillMaxSize()) {
        /* Held for someone: name them, with Kimono's loader, and offer to start without them after a while. */
        val waiting = s.hold?.waitingFor.orEmpty().filter { it != party.client }
            .mapNotNull { c -> s.members.firstOrNull { it.client == c }?.username }.distinct().map { firstName(party.nameOf(it)) }
        if (s.hold != null && waiting.isNotEmpty()) {
            var long by remember(s.hold.since) { mutableStateOf(false) }
            LaunchedEffect(s.hold.since) { delay(10_000); long = true }
            Column(Modifier.align(Alignment.Center).widthIn(max = 420.dp).clip(RoundedCornerShape(14.dp)).background(Color(0xDB110C0A)).padding(horizontal = 24.dp, vertical = 20.dp),
                horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(14.dp)) {
                InkLoader(size = 36.dp)
                Text("Waiting for ${waiting.joinToString(", ")}…", style = display(21), maxLines = 2, overflow = TextOverflow.Ellipsis)
                if (long) PaperButton(if (waiting.size == 1) "Start without them" else "Start without everyone", null, { party.startWithoutThem() }, tonal = true)
            }
        }
        /* Who did what, when it wasn't this screen; or why this screen's move didn't land. */
        val by = s.by
        var note by remember { mutableStateOf<String?>(null) }
        LaunchedEffect(s.seq) {
            if (by != null && by.client != party.client) {
                val who = firstName(party.nameOf(by.username))
                note = when (by.type) { "play" -> "$who played"; "pause" -> "$who paused"; "seek" -> "$who skipped"; "episode" -> "$who changed the episode"; "rate" -> "$who changed the speed"; "next" -> "$who started the next episode"; else -> null }
                delay(2_500); note = null
            }
        }
        LaunchedEffect(problem) { if (problem != null) { note = problem; delay(2_500); note = null } }
        AnimatedVisibility(note != null, Modifier.align(Alignment.TopCenter).padding(top = if (chrome) 72.dp else 20.dp), enter = fadeIn(), exit = fadeOut()) {
            Text(note ?: "", style = ui(14, FontWeight.Bold, Night.ink), modifier = Modifier.clip(RoundedCornerShape(10.dp)).background(Night.paper).padding(horizontal = 16.dp, vertical = 9.dp))
        }
        /* Reactions, rising from the bottom right with who sent them. */
        val floating = remember { mutableStateListOf<app.kimono.watch.ui.Floating>() }
        LaunchedEffect(party) { party.floating.collect { f -> floating.add(f); if (floating.size > 12) floating.removeAt(0) } }
        floating.forEach { f -> key(f.key) { Rising(f, Modifier.align(Alignment.BottomEnd).padding(end = endInset + 40.dp + ((f.key % 5).toInt() * 14).dp, bottom = 130.dp)) { floating.remove(f) } } }
    }
}

private fun firstName(name: String) = name.trim().substringBefore(' ').ifEmpty { name }

@Composable
private fun key(k: Any, content: @Composable () -> Unit) = androidx.compose.runtime.key(k) { content() }

@Composable
private fun Rising(f: app.kimono.watch.ui.Floating, modifier: Modifier, done: () -> Unit) {
    val t = remember { Animatable(0f) }
    LaunchedEffect(Unit) { t.animateTo(1f, tween(2_600)); done() }
    Column(modifier.graphicsLayer { translationY = -t.value * 420f; alpha = 1f - t.value }, horizontalAlignment = Alignment.CenterHorizontally) {
        Text(f.emoji, style = ui(34).copy(lineHeight = 40.sp))
        Text(firstName(f.name), style = ui(11, FontWeight.Bold, Night.fg2))
    }
}

/** A face that shows how its screen is doing: dimmed with a blush ring while it gets ready or buffers. */
@Composable
private fun MemberFace(person: Person?, username: String, state: String?, size: Dp) {
    val busy = state == "loading" || state == "buffering"
    PersonFace(person, username, size, Modifier.alpha(if (busy) .55f else 1f)
        .then(if (busy) Modifier.border(2.dp, Night.blush, RoundedCornerShape(size * .28f)) else Modifier))
}

/** Who's watching, in the top bar: a tap opens the party. */
@Composable
fun PartyFaces(party: TogetherViewModel, onClick: () -> Unit) {
    val state by party.state.collectAsState()
    val people by party.people.collectAsState()
    val here = state?.members.orEmpty().filter { it.present }.distinctBy { it.username.lowercase() }
    if (here.isEmpty()) return
    Row(Modifier.height(48.dp).clickableScaleClipped(RoundedCornerShape(12.dp), onClick).padding(horizontal = 6.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(5.dp)) {
        here.take(4).forEach { m -> MemberFace(people.firstOrNull { it.username.equals(m.username, true) }, m.username, m.state, 30.dp) }
        if (here.size > 4) Text("+${here.size - 4}", style = ui(13, FontWeight.Bold, Night.fg2))
    }
}

@Composable
private fun PartyRow(modifier: Modifier = Modifier, onClick: (() -> Unit)? = null, content: @Composable androidx.compose.foundation.layout.RowScope.() -> Unit) {
    Row(Modifier.fillMaxWidth().then(modifier).then(if (onClick != null) Modifier.clickableScaleClipped(RoundedCornerShape(8.dp), onClick) else Modifier)
        .padding(horizontal = 6.dp, vertical = 7.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp), content = content)
}

/** The party sheet, as on the web: who's here, who to invite, the link, steering, and leaving. */
@Composable
fun PartySheet(party: TogetherViewModel, tv: Boolean, first: FocusRequester, onLeave: () -> Unit) {
    val state by party.state.collectAsState()
    val people by party.people.collectAsState()
    val s = state ?: return
    val personOf = { u: String -> people.firstOrNull { it.username.equals(u, true) } }
    val here = s.members.filter { it.present }.distinctBy { it.client }
    val watching = here.map { it.username.lowercase() }.toSet()
    val others = people.filter { !it.username.equals(party.me, true) && it.username.lowercase() !in watching }
    val invited = s.invited.map { it.lowercase() }.toSet()
    var firstSet = false
    fun firstOnce(): Modifier = if (!firstSet) { firstSet = true; Modifier.focusRequester(first) } else Modifier
    Column(Modifier.widthIn(min = 300.dp, max = 420.dp)) {
        Text("Watching together", style = ui(18, FontWeight.Bold), modifier = Modifier.padding(start = 6.dp, bottom = 6.dp))
        here.forEach { m ->
            PartyRow {
                MemberFace(personOf(m.username), m.username, m.state, 30.dp)
                Text(party.nameOf(m.username) + if (m.client == party.client) " (you)" else "", style = ui(15, FontWeight.Bold), modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
                val status = when { m.username.equals(s.host, true) -> "Host"; m.state == "buffering" -> "Buffering"; m.state == "loading" -> "Getting ready"; else -> "" }
                if (status.isNotEmpty()) Text(status, style = ui(13, color = Night.fg3))
            }
        }
        if (others.isNotEmpty()) {
            Text("Invite", style = ui(18, FontWeight.Bold), modifier = Modifier.padding(start = 6.dp, top = 14.dp, bottom = 6.dp))
            /* On a phone: the three most recent, and a search for anyone else. A TV lists everyone. */
            var query by remember { mutableStateOf("") }
            val recent by party.recent.collectAsState()
            val shown = if (tv) others else if (query.isNotBlank()) others.filter { it.shown.contains(query.trim(), true) || it.username.contains(query.trim(), true) }
                else others.sortedBy { recent.indexOf(it.username.lowercase()).let { i -> if (i < 0) Int.MAX_VALUE else i } }.take(3)
            if (!tv && others.size > 3) Row(Modifier.padding(horizontal = 6.dp, vertical = 4.dp).fillMaxWidth().height(44.dp).clip(RoundedCornerShape(10.dp)).background(Night.surface2)
                .border(1.dp, Night.line, RoundedCornerShape(10.dp)).padding(horizontal = 12.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                I(Ic.search, 18.dp, Night.fg3)
                Box(Modifier.weight(1f), contentAlignment = Alignment.CenterStart) {
                    if (query.isEmpty()) Text("Search people", style = ui(15, color = Night.fg3))
                    BasicTextField(query, { query = it.take(60) }, Modifier.fillMaxWidth(), singleLine = true, textStyle = ui(15), cursorBrush = SolidColor(Night.suo),
                        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search))
                }
            }
            if (shown.isEmpty()) Text("No one by that name", style = ui(14, color = Night.fg3), modifier = Modifier.padding(start = 6.dp, top = 8.dp, bottom = 4.dp))
            shown.forEach { p ->
                val asked = p.username.lowercase() in invited
                PartyRow(firstOnce(), onClick = if (asked) null else ({ party.invite(listOf(p.username)) })) {
                    PersonFace(p, p.username, 30.dp)
                    Text(p.shown, style = ui(15, FontWeight.Bold), modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
                    if (asked) Text("Invited", style = ui(13, color = Night.fg3)) else I(Ic.add, 20.dp, Night.fg2)
                }
            }
        }
        Box(Modifier.padding(top = 10.dp, bottom = 4.dp).fillMaxWidth().height(1.dp).background(Night.line))
        val server = LocalWatch.current.accounts.server.orEmpty()
        val clipboard = LocalClipboardManager.current
        var copied by remember { mutableStateOf(false) }
        LaunchedEffect(copied) { if (copied) { delay(2_000); copied = false } }
        if (!tv && server.isNotEmpty()) PartyRow(firstOnce(), onClick = { clipboard.setText(AnnotatedString("$server/watch?party=${party.partyId}")); copied = true }) {
            I(if (copied) Ic.check else Ic.link, 20.dp, Night.fg3)
            Text(if (copied) "Link copied" else "Copy link", style = ui(15))
        }
        if (party.isHost) PartyRow(firstOnce(), onClick = { party.hostOnly(!s.hostOnly) }) {
            I(Ic.check, 20.dp, if (s.hostOnly) Night.blush else Night.fg3.copy(alpha = .3f))
            Text("Only I can steer", style = ui(15))
        }
        PartyRow(firstOnce(), onClick = onLeave) {
            I(Ic.close, 20.dp, Night.fg3)
            Text("Leave the party", style = ui(15))
        }
    }
}

/**
 * The chat, down the right side at full height so the picture stays in
 * view: what's been said, the reactions, and (on phones) a line to type
 * on that rides above the keyboard.
 */
@Composable
fun PartyChat(party: TogetherViewModel, open: Boolean, tv: Boolean, onClose: () -> Unit, first: FocusRequester) {
    val chat by party.chat.collectAsState()
    val people by party.people.collectAsState()
    BoxWithConstraints(Modifier.fillMaxSize()) {
        val panel = if (maxWidth < 520.dp) maxWidth else 360.dp
        AnimatedVisibility(open, Modifier.align(Alignment.CenterEnd),
            enter = slideInHorizontally(tween(320)) { it }, exit = slideOutHorizontally(tween(260)) { it }) {
            Column(Modifier.width(panel).fillMaxHeight().background(Color(0xF2110C0A))
                .pointerInput(Unit) { detectTapGestures { } }
                .windowInsetsPadding(WindowInsets.safeDrawing.only(WindowInsetsSides.Vertical + WindowInsetsSides.End))
                .imePadding()) {
                Row(Modifier.fillMaxWidth().padding(start = 20.dp, end = 8.dp, top = 8.dp, bottom = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text("Chat", style = display(20), modifier = Modifier.weight(1f))
                    Box(Modifier.size(44.dp).clickableScaleClipped(CircleShape, onClose), contentAlignment = Alignment.Center) { I(Ic.close, 22.dp, Night.fg2) }
                }
                val list = rememberLazyListState()
                LaunchedEffect(chat.size, open) { if (chat.isNotEmpty()) list.scrollToItem(chat.size - 1) }
                LazyColumn(Modifier.weight(1f).fillMaxWidth(), state = list, verticalArrangement = Arrangement.spacedBy(12.dp),
                    contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 16.dp, vertical = 6.dp)) {
                    if (chat.isEmpty()) item { Text("Say hello.", style = ui(14, color = Night.fg3)) }
                    items(chat, key = { it.id }) { line ->
                        val mine = line.username.equals(party.me, true)
                        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            PersonFace(people.firstOrNull { it.username.equals(line.username, true) }, line.username, 28.dp)
                            Column(Modifier.weight(1f)) {
                                Text(firstName(party.nameOf(line.username)), style = ui(13, FontWeight.Bold, if (mine) Night.blush else Night.fg3))
                                Text(line.text, style = ui(15).copy(lineHeight = 21.sp), modifier = Modifier.padding(top = 2.dp))
                            }
                        }
                    }
                }
                Row(Modifier.fillMaxWidth().padding(horizontal = 10.dp, vertical = 4.dp), horizontalArrangement = Arrangement.SpaceBetween) {
                    partyReactions.forEachIndexed { i, e ->
                        Box(Modifier.size(44.dp).clickableScaleClipped(RoundedCornerShape(12.dp), { party.react(e) }, focusScale = 1.12f).then(if (i == 0) Modifier.focusRequester(first) else Modifier), contentAlignment = Alignment.Center) {
                            Text(e, style = ui(24))
                        }
                    }
                }
                if (!tv) {
                    var text by remember { mutableStateOf("") }
                    val send = { party.say(text); text = "" }
                    Row(Modifier.fillMaxWidth().padding(start = 16.dp, end = 8.dp, top = 4.dp, bottom = 10.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        Box(Modifier.weight(1f).height(44.dp).clip(RoundedCornerShape(10.dp)).background(Night.surface2).border(1.dp, Night.line, RoundedCornerShape(10.dp)).padding(horizontal = 14.dp), contentAlignment = Alignment.CenterStart) {
                            if (text.isEmpty()) Text("Message", style = ui(15, color = Night.fg3))
                            BasicTextField(text, { text = it.take(300) }, Modifier.fillMaxWidth(), singleLine = true, textStyle = ui(15), cursorBrush = SolidColor(Night.suo),
                                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send), keyboardActions = KeyboardActions(onSend = { send() }))
                        }
                        Box(Modifier.size(44.dp).clickableScaleClipped(CircleShape, send), contentAlignment = Alignment.Center) { I(Ic.send, 22.dp, if (text.isBlank()) Night.fg3 else Night.fg) }
                    }
                }
            }
        }
    }
}

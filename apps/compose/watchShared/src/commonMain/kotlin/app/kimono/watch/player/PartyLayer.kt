package app.kimono.watch.player

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
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
 * What the party looks like over the picture: who's here (faces, the ones
 * holding things up dimmed), "Waiting for Sami…" while the party is held,
 * "Sami paused" when someone else steers, and reactions floating up.
 */
@Composable
fun PartyLayer(party: TogetherViewModel, chrome: Boolean, tv: Boolean) {
    val state by party.state.collectAsState()
    val people by party.people.collectAsState()
    val s = state ?: return
    Box(Modifier.fillMaxSize()) {
        /* Faces, top right: each screen once, the present ones bright. */
        Row(Modifier.align(Alignment.TopEnd).padding(top = if (chrome) 72.dp else 16.dp, end = 20.dp), horizontalArrangement = Arrangement.spacedBy((-6).dp)) {
            s.members.distinctBy { it.username }.take(6).forEach { m ->
                PersonFace(people.firstOrNull { it.username.equals(m.username, true) }, m.username, 30.dp,
                    Modifier.alpha(if (m.present) 1f else .4f).border(2.dp, if (m.state == "ready") Night.bg else Night.blush, RoundedCornerShape(9.dp)))
            }
        }
        /* Held for someone: name them, with Kimono's loader, and offer to start without them after a while. */
        val waiting = s.hold?.waitingFor.orEmpty().filter { it != party.client }
            .mapNotNull { c -> s.members.firstOrNull { it.client == c }?.username }.distinct().map { party.nameOf(it) }
        if (s.hold != null && waiting.isNotEmpty()) {
            var long by remember(s.hold.since) { mutableStateOf(false) }
            LaunchedEffect(s.hold.since) { delay(10_000); long = true }
            Column(Modifier.align(Alignment.Center).clip(RoundedCornerShape(14.dp)).background(Color(0xCC110C0A)).padding(horizontal = 22.dp, vertical = 16.dp),
                horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(10.dp)) {
                InkLoader(size = 36.dp)
                Text("Waiting for ${waiting.joinToString(", ")}…", style = ui(16, FontWeight.Bold))
                if (long) PaperButton("Start without them", null, { party.startWithoutThem() }, tonal = true)
            }
        }
        /* Who did what, when it wasn't this screen. */
        val by = s.by
        var note by remember { mutableStateOf<String?>(null) }
        LaunchedEffect(s.seq) {
            if (by != null && by.client != party.client) {
                val who = party.nameOf(by.username)
                note = when (by.type) { "play" -> "$who played"; "pause" -> "$who paused"; "seek" -> "$who skipped"; "episode" -> "$who changed the episode"; "rate" -> "$who changed the speed"; "next" -> "$who started the next episode"; else -> null }
                delay(2_500); note = null
            }
        }
        AnimatedVisibility(note != null, Modifier.align(Alignment.TopCenter).padding(top = if (chrome) 64.dp else 20.dp), enter = fadeIn(), exit = fadeOut()) {
            Text(note ?: "", style = ui(14, FontWeight.Bold, Night.ink), modifier = Modifier.clip(RoundedCornerShape(10.dp)).background(Night.paper).padding(horizontal = 16.dp, vertical = 8.dp))
        }
        /* Reactions, rising from the bottom right with who sent them. */
        val floating = remember { mutableStateListOf<app.kimono.watch.ui.Floating>() }
        LaunchedEffect(party) { party.floating.collect { f -> floating.add(f); if (floating.size > 12) floating.removeAt(0) } }
        floating.forEach { f -> key(f.key) { Rising(f, Modifier.align(Alignment.BottomEnd).padding(end = 48.dp + ((f.key % 5).toInt() * 14).dp, bottom = 110.dp)) { floating.remove(f) } } }
    }
}

@Composable
private fun key(k: Any, content: @Composable () -> Unit) = androidx.compose.runtime.key(k) { content() }

@Composable
private fun Rising(f: app.kimono.watch.ui.Floating, modifier: Modifier, done: () -> Unit) {
    val t = remember { Animatable(0f) }
    LaunchedEffect(Unit) { t.animateTo(1f, tween(2_600)); done() }
    Column(modifier.graphicsLayer { translationY = -t.value * 420f; alpha = 1f - t.value }, horizontalAlignment = Alignment.CenterHorizontally) {
        Text(f.emoji, style = ui(34).copy(lineHeight = 40.sp))
        Text(f.name, style = ui(11, FontWeight.Bold, Night.fg2))
    }
}

/** The party sheet: reactions, the chat (typing on phones), and asking the household in. */
@Composable
fun PartySheet(party: TogetherViewModel, tv: Boolean, first: FocusRequester) {
    val state by party.state.collectAsState()
    val people by party.people.collectAsState()
    val chat by party.chat.collectAsState()
    val s = state ?: return
    Column(Modifier.widthIn(min = 360.dp, max = 440.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text("Watching together", style = ui(18, FontWeight.Bold))
        Text(if (party.isHost) "You started this party." else "${party.nameOf(s.host)} started this party.", style = ui(13, color = Night.fg2))
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            partyReactions.forEachIndexed { i, e ->
                Box(Modifier.size(48.dp).clickableScaleClipped(CircleShape, { party.react(e) }, focusScale = 1.12f).then(if (i == 0) Modifier.focusRequester(first) else Modifier), contentAlignment = Alignment.Center) {
                    Text(e, style = ui(24))
                }
            }
        }
        Text("Chat", style = ui(15, FontWeight.Bold), modifier = Modifier.padding(top = 6.dp))
        val list = rememberLazyListState()
        LaunchedEffect(chat.size) { if (chat.isNotEmpty()) list.scrollToItem(chat.size - 1) }
        LazyColumn(Modifier.fillMaxWidth().height(150.dp), state = list, verticalArrangement = Arrangement.spacedBy(6.dp)) {
            if (chat.isEmpty()) item { Text("Nothing said yet.", style = ui(13, color = Night.fg3)) }
            items(chat, key = { it.id }) { line ->
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    PersonFace(people.firstOrNull { it.username.equals(line.username, true) }, line.username, 22.dp)
                    Text(buildString { append(party.nameOf(line.username)); append("  "); append(line.text) }, style = ui(14))
                }
            }
        }
        if (!tv) {
            var text by remember { mutableStateOf("") }
            Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).background(Night.surface3).padding(start = 12.dp, end = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.weight(1f).padding(vertical = 10.dp)) {
                    if (text.isEmpty()) Text("Say something", style = ui(15, color = Night.fg3))
                    BasicTextField(text, { text = it.take(300) }, Modifier.fillMaxWidth(), singleLine = true, textStyle = ui(15), cursorBrush = SolidColor(Night.suo),
                        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send), keyboardActions = KeyboardActions(onSend = { party.say(text); text = "" }))
                }
                Box(Modifier.size(40.dp).clickableScaleClipped(CircleShape, { party.say(text); text = "" }), contentAlignment = Alignment.Center) { I(Ic.send, 20.dp) }
            }
        }
        /* The household, to ask in: the ones not here or asked yet. */
        val here = s.members.map { it.username.lowercase() }.toSet() + s.invited.map { it.lowercase() }
        val ask = people.filter { it.username.lowercase() !in here }
        if (ask.isNotEmpty()) {
            Text("Ask someone in", style = ui(15, FontWeight.Bold), modifier = Modifier.padding(top = 6.dp))
            ask.take(8).forEach { p ->
                Row(Modifier.fillMaxWidth().clickableScaleClipped(RoundedCornerShape(8.dp), { party.invite(listOf(p.username)) }).padding(horizontal = 6.dp, vertical = 6.dp),
                    verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    PersonFace(p, p.username, 28.dp)
                    Text(p.shown, style = ui(15), modifier = Modifier.weight(1f))
                    Text("Ask", style = ui(13, FontWeight.Bold, Night.blush))
                }
            }
        }
        if (s.invited.isNotEmpty()) Text("Asked: ${s.invited.joinToString(", ") { party.nameOf(it) }}", style = ui(13, color = Night.fg3))
    }
}

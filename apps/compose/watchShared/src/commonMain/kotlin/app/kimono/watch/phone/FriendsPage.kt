package app.kimono.watch.phone

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import app.kimono.watch.LocalWatch
import app.kimono.watch.model.Friend
import app.kimono.watch.model.FriendsPage as Page
import app.kimono.watch.model.JoinAsk
import app.kimono.watch.model.Person
import app.kimono.watch.nowMs
import app.kimono.watch.player.PersonFace
import app.kimono.watch.theme.Night
import app.kimono.watch.theme.display
import app.kimono.watch.theme.ui
import app.kimono.watch.ui.I
import app.kimono.watch.ui.Ic
import app.kimono.watch.ui.PaperButton
import app.kimono.watch.ui.ProgressLine
import app.kimono.watch.ui.Skeleton
import app.kimono.watch.ui.clickableScaleClipped
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * Friends: what each is watching now (with "Ask to join") and where they are
 * in things, who asked to be friends, and everyone else to add. Asked again
 * every 15 s while open; an ask to join is followed every 2.5 s until it's
 * answered, and a yes opens the player in their party.
 */
@Composable
fun FriendsPage(go: Go) {
    val watch = LocalWatch.current
    val scope = rememberCoroutineScope()
    var page by remember { mutableStateOf<Page?>(null) }
    var problem by remember { mutableStateOf<String?>(null) }
    var asking by remember { mutableStateOf<JoinAsk?>(null) }
    var removing by remember { mutableStateOf<Friend?>(null) }

    suspend fun load() {
        runCatching { watch.api.friends() }
            .onSuccess { p -> page = p; problem = null; if (asking == null) asking = p.outgoing.firstOrNull { it.answer == "waiting" } }
            .onFailure { if (page == null) problem = it.message ?: "Friends didn't load." }
    }
    fun change(type: String, username: String) = scope.launch {
        runCatching { watch.api.friend(type, username) }.onFailure { watch.toasts.show(it.message ?: "That didn't go through. Try again.") }
        load()
    }
    LaunchedEffect(Unit) { while (true) { load(); delay(15_000) } }

    /* Waiting on an answer: a yes goes straight into their party. */
    LaunchedEffect(asking?.id) {
        val ask = asking ?: return@LaunchedEffect
        while (true) {
            delay(2500)
            val answers = runCatching { watch.api.asks() }.getOrNull() ?: continue
            val now = answers.outgoing.firstOrNull { it.id == ask.id }
            when {
                now == null -> { watch.toasts.show("${ask.name.ifBlank { ask.to }} didn't answer"); asking = null }
                now.answer == "yes" && now.partyId != null -> { asking = null; go.join(now.partyId) }
                now.answer == "no" -> { watch.toasts.show("${ask.name.ifBlank { ask.to }} said not now"); asking = null }
                else -> continue
            }
            break
        }
    }

    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(top = statusTop + 76.dp, bottom = navBottom + 100.dp, start = 16.dp, end = 16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item { Text("Friends", style = display(28), modifier = Modifier.padding(top = 12.dp, bottom = 4.dp)) }
        val p = page
        when {
            p == null && problem != null -> item { Text(problem!!, style = ui(15, color = Night.fg3), modifier = Modifier.padding(vertical = 24.dp)) }
            p == null -> items(3) { Skeleton(Modifier.fillMaxWidth().size(Dp.Unspecified, 96.dp), RoundedCornerShape(14.dp)) }
            else -> {
                if (p.asked.isNotEmpty()) {
                    item { Heading("Asked to be friends") }
                    items(p.asked, key = { "asked" + it.username }) { who ->
                        PersonRow(who) {
                            PaperButton("Accept", Ic.check, { change("yes", who.username) }, height = 38.dp)
                            Box(Modifier.size(36.dp).clickableScaleClipped(CircleShape, { change("no", who.username) }), contentAlignment = Alignment.Center) { I(Ic.close, 18.dp, Night.fg2) }
                        }
                    }
                }
                if (p.friends.isEmpty()) item {
                    Text("Add friends to see what they're watching.", style = ui(15, color = Night.fg3), modifier = Modifier.padding(vertical = 16.dp))
                }
                items(p.friends, key = { "f" + it.username }) { f ->
                    FriendCard(f, go, asking?.takeIf { it.to.equals(f.username, true) },
                        onAsk = {
                            scope.launch {
                                runCatching { watch.api.askToJoin(f.username) }
                                    .onSuccess { asking = it }
                                    .onFailure { watch.toasts.show(it.message ?: "That didn't send. Try again.") }
                            }
                        },
                        onCancel = { a -> asking = null; scope.launch { runCatching { watch.api.cancelAsk(a.id) } } },
                        onRemove = { removing = f })
                }
                if (p.people.isNotEmpty() || p.asking.isNotEmpty()) {
                    item { Heading("Add friends") }
                    items(p.asking, key = { "asking" + it.username }) { who ->
                        PersonRow(who) { PaperButton("Asked", Ic.check, { change("remove", who.username) }, tonal = true, height = 38.dp) }
                    }
                    items(p.people, key = { "p" + it.username }) { who ->
                        PersonRow(who) { PaperButton("Add", Ic.people, { change("ask", who.username) }, tonal = true, height = 38.dp) }
                    }
                }
            }
        }
    }

    removing?.let { f ->
        app.kimono.watch.ui.Dialog(onDismiss = { removing = null }) {
            Text("Remove ${f.shown}?", style = ui(18, FontWeight.Bold))
            Text("You'll stop seeing what each other watches.", style = ui(14, color = Night.fg2), modifier = Modifier.padding(top = 4.dp, bottom = 18.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                PaperButton("Cancel", null, { removing = null }, tonal = true)
                PaperButton("Remove", null, { removing = null; change("remove", f.username) })
            }
        }
    }
}

@Composable
private fun Heading(text: String) {
    Text(text, style = ui(15, FontWeight.Bold, Night.fg2), modifier = Modifier.padding(top = 12.dp))
}

@Composable
private fun PersonRow(who: Person, actions: @Composable () -> Unit) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        PersonFace(who, who.username, 40.dp)
        Text(who.shown, style = ui(15, FontWeight.Bold), modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
        actions()
    }
}

/** A friend: their face (lit while they watch), what they're on, and where they are in what they've watched lately. */
@Composable
private fun FriendCard(f: Friend, go: Go, asking: JoinAsk?, onAsk: () -> Unit, onCancel: (JoinAsk) -> Unit, onRemove: () -> Unit) {
    val now = f.now
    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(Night.surface2).padding(14.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Box(Modifier.clickableScaleClipped(RoundedCornerShape(12.dp), onRemove)) {
                PersonFace(f.person, f.username, 44.dp)
                if (now != null) Box(Modifier.align(Alignment.BottomEnd).offset(3.dp, 3.dp).size(14.dp).clip(CircleShape).background(Night.surface2).padding(2.dp).clip(CircleShape).background(Night.suo))
            }
            Column(Modifier.weight(1f)) {
                Text(f.shown, style = ui(16, FontWeight.Bold), maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(when {
                    !f.sharing -> "Keeps what they watch to themselves"
                    now != null -> "Watching now"
                    f.recent.isNotEmpty() -> "Watched ${ago(f.recent[0].at)}"
                    else -> "Hasn't watched anything yet"
                }, style = ui(13, color = if (now != null) Night.fg else Night.fg3), maxLines = 1)
            }
            if (now != null) {
                if (asking != null) PaperButton("Asking…", null, { onCancel(asking) }, tonal = true, height = 38.dp)
                else PaperButton("Ask to join", Ic.people, onAsk, height = 38.dp)
            }
        }
        if (now != null) Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).background(Night.bg).clickableScaleClipped(RoundedCornerShape(10.dp), { go.open(now.title) }),
            verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.width(112.dp).size(112.dp, 63.dp)) {
                app.kimono.watch.ui.Img(now.title.backdrop ?: now.title.poster, Modifier.fillMaxSize())
                ProgressLine(now.progress.toFloat(), Modifier.align(Alignment.BottomStart).fillMaxWidth())
            }
            Column(Modifier.weight(1f).padding(horizontal = 12.dp)) {
                Text(now.title.name, style = ui(15, FontWeight.Bold), maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(listOfNotNull(now.label, "together".takeIf { now.partyId != null }).joinToString(" · ").ifEmpty { now.title.shelf }, style = ui(13, color = Night.fg2), maxLines = 1)
            }
        }
        val recent = f.recent.filter { it.title.id != now?.title?.id }
        if (recent.isNotEmpty()) LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            items(recent, key = { it.title.id }) { s ->
                Column(Modifier.width(84.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Box(Modifier.clip(RoundedCornerShape(8.dp))) {
                        PosterCard(s.title, go, width = 84.dp)
                        if (!s.finished) ProgressLine(s.progress.toFloat(), Modifier.align(Alignment.BottomStart).fillMaxWidth())
                    }
                    Text(if (s.finished && s.label == null) "Finished" else listOfNotNull(s.label, "done".takeIf { s.finished && s.label != null }).joinToString(" · "),
                        style = ui(12, color = Night.fg3), maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
            }
        }
        Spacer(Modifier.size(0.dp))
    }
}

/** "just now", "12 min ago", "3 h ago", "2 days ago". */
internal fun ago(at: Long): String {
    val min = ((nowMs() - at) / 60_000).coerceAtLeast(0)
    return when {
        min < 2 -> "just now"
        min < 60 -> "$min min ago"
        min < 24 * 60 -> "${min / 60} h ago"
        min < 2 * 24 * 60 -> "yesterday"
        else -> "${min / (24 * 60)} days ago"
    }
}

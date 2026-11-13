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
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
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
 * Friends' state, for the phone's page and the TV's: the page (asked again
 * every 15 s while shown), the ask to join waiting on an answer (followed
 * every 2.5 s; a yes opens the player in their party), and the changes.
 */
class FriendsModel internal constructor() {
    var page by mutableStateOf<Page?>(null)
    var problem by mutableStateOf<String?>(null)
    var asking by mutableStateOf<JoinAsk?>(null)
    var removing by mutableStateOf<Friend?>(null)
    internal var change: (type: String, username: String) -> Unit = { _, _ -> }
    internal var ask: (Friend) -> Unit = {}
    internal var cancel: (JoinAsk) -> Unit = {}
    fun add(username: String) = change("ask", username)
    fun accept(username: String) = change("yes", username)
    fun decline(username: String) = change("no", username)
    fun remove(username: String) = change("remove", username)
    fun askToJoin(f: Friend) = ask(f)
    fun cancelAsk(a: JoinAsk) = cancel(a)
    fun askingOf(f: Friend) = asking?.takeIf { it.to.equals(f.username, true) }
    internal var prefs: app.kimono.watch.ui.PrefsStore? = null
    /** From the person's settings (kept as they change), else what the page said. */
    val invisible: Boolean get() = prefs?.state?.value?.invisible ?: page?.invisible ?: false
    fun setInvisible(on: Boolean) {
        page = page?.copy(invisible = on)
        prefs?.set("invisible", on) { it.copy(invisible = on) }
    }
}

@Composable
fun rememberFriends(go: Go): FriendsModel {
    val watch = LocalWatch.current
    val scope = rememberCoroutineScope()
    val m = remember { FriendsModel() }
    m.prefs = watch.prefs
    val prefs by watch.prefs.state.collectAsState()
    LaunchedEffect(Unit) { if (prefs == null) watch.prefs.load() }
    suspend fun load() {
        runCatching { watch.api.friends() }
            .onSuccess { p -> m.page = p; m.problem = null; if (m.asking == null) m.asking = p.outgoing.firstOrNull { it.answer == "waiting" } }
            .onFailure { if (m.page == null) m.problem = it.message ?: "Friends didn't load." }
    }
    m.change = { type, username ->
        scope.launch {
            runCatching { watch.api.friend(type, username) }.onFailure { watch.toasts.show(it.message ?: "That didn't go through. Try again.") }
            load()
        }
    }
    m.ask = { f ->
        scope.launch {
            runCatching { watch.api.askToJoin(f.username) }
                .onSuccess { m.asking = it }
                .onFailure { watch.toasts.show(it.message ?: "That didn't send. Try again.") }
        }
    }
    m.cancel = { a -> m.asking = null; scope.launch { runCatching { watch.api.cancelAsk(a.id) } } }
    LaunchedEffect(Unit) { while (true) { load(); delay(15_000) } }

    /* Waiting on an answer: a yes goes straight into their party. */
    LaunchedEffect(m.asking?.id) {
        val ask = m.asking ?: return@LaunchedEffect
        while (true) {
            delay(2500)
            val answers = runCatching { watch.api.asks() }.getOrNull() ?: continue
            val now = answers.outgoing.firstOrNull { it.id == ask.id }
            when {
                now == null -> { watch.toasts.show("${ask.name.ifBlank { ask.to }} didn't answer"); m.asking = null }
                now.answer == "yes" && now.partyId != null -> { m.asking = null; go.join(now.partyId) }
                now.answer == "no" -> { watch.toasts.show("${ask.name.ifBlank { ask.to }} said not now"); m.asking = null }
                else -> continue
            }
            break
        }
    }
    return m
}

/** Friends on a phone: what each is watching now (with "Ask to join") and where they are in things, who asked to be friends, and everyone else to add. */
@Composable
fun FriendsPage(go: Go) {
    val m = rememberFriends(go)
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(top = statusTop + 76.dp, bottom = navBottom + 100.dp, start = 16.dp, end = 16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item {
            Row(Modifier.padding(top = 12.dp, bottom = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                Text("Friends", style = display(28), modifier = Modifier.weight(1f))
                InvisibleChip(m)
            }
        }
        val p = m.page
        when {
            p == null && m.problem != null -> item { Text(m.problem!!, style = ui(15, color = Night.fg3), modifier = Modifier.padding(vertical = 24.dp)) }
            p == null -> items(3) { Skeleton(Modifier.fillMaxWidth().size(Dp.Unspecified, 96.dp), RoundedCornerShape(14.dp)) }
            else -> {
                if (p.asked.isNotEmpty()) {
                    item { Heading("Asked to be friends") }
                    items(p.asked, key = { "asked" + it.username }) { who ->
                        PersonRow(who) {
                            PaperButton("Accept", Ic.check, { m.accept(who.username) }, height = 38.dp)
                            Box(Modifier.size(36.dp).clickableScaleClipped(CircleShape, { m.decline(who.username) }), contentAlignment = Alignment.Center) { I(Ic.close, 18.dp, Night.fg2) }
                        }
                    }
                }
                if (p.friends.isEmpty()) item {
                    Text("Add friends to see what they're watching.", style = ui(15, color = Night.fg3), modifier = Modifier.padding(vertical = 16.dp))
                }
                items(p.friends, key = { "f" + it.username }) { f ->
                    FriendCard(f, go, m.askingOf(f), onAsk = { m.askToJoin(f) }, onCancel = m::cancelAsk, onRemove = { m.removing = f })
                }
                if (p.people.isNotEmpty() || p.asking.isNotEmpty()) {
                    item { Heading("Add friends") }
                    items(p.asking, key = { "asking" + it.username }) { who ->
                        PersonRow(who) { PaperButton("Asked", Ic.check, { m.remove(who.username) }, tonal = true, height = 38.dp) }
                    }
                    items(p.people, key = { "p" + it.username }) { who ->
                        PersonRow(who) { PaperButton("Add", Ic.people, { m.add(who.username) }, tonal = true, height = 38.dp) }
                    }
                }
            }
        }
    }

    m.removing?.let { f ->
        app.kimono.watch.ui.Dialog(onDismiss = { m.removing = null }) {
            Text("Remove ${f.shown}?", style = ui(18, FontWeight.Bold))
            Text("You'll stop seeing what each other watches.", style = ui(14, color = Night.fg2), modifier = Modifier.padding(top = 4.dp, bottom = 18.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                PaperButton("Cancel", null, { m.removing = null }, tonal = true)
                PaperButton("Remove", null, { m.removing = null; m.remove(f.username) })
            }
        }
    }
}

/** Invisible: on, friends don't see you watching and what you watch meanwhile stays yours. */
@Composable
fun InvisibleChip(m: FriendsModel) {
    val on = m.invisible
    Row(Modifier.clip(RoundedCornerShape(999.dp)).background(if (on) Night.paper else Night.surface2).border(1.dp, if (on) Night.paper else Night.line, RoundedCornerShape(999.dp))
        .clickableScaleClipped(RoundedCornerShape(999.dp), { m.setInvisible(!on) }).padding(start = 10.dp, end = 14.dp, top = 6.dp, bottom = 6.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        I(if (on) Ic.check else Ic.people, 16.dp, if (on) Night.ink else Night.fg2)
        Text(if (on) "Invisible" else "Go invisible", style = ui(14, FontWeight.Bold, if (on) Night.ink else Night.fg))
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
            Box {
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
            FriendMenu(f, onRemove)
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

/** ··· on a friend: Remove (asked again in a dialog). */
@Composable
private fun FriendMenu(f: Friend, onRemove: () -> Unit) {
    var open by remember { mutableStateOf(false) }
    Box {
        Box(Modifier.size(36.dp).clickableScaleClipped(CircleShape, { open = true }), contentAlignment = Alignment.Center) { I(Ic.dots, 22.dp, Night.fg2) }
        androidx.compose.material3.DropdownMenu(open, { open = false }, containerColor = Night.surface3, shape = RoundedCornerShape(12.dp), modifier = Modifier.widthIn(min = 200.dp)) {
            Text("Remove ${f.shown}", style = ui(15, FontWeight.Medium), maxLines = 1, overflow = TextOverflow.Ellipsis,
                modifier = Modifier.fillMaxWidth().clickableScaleClipped(RoundedCornerShape(8.dp), { open = false; onRemove() }).padding(horizontal = 14.dp, vertical = 12.dp))
        }
    }
}

/** "just now", "12 min ago", "3 h ago", "2 days ago". */
fun ago(at: Long): String {
    val min = ((nowMs() - at) / 60_000).coerceAtLeast(0)
    return when {
        min < 2 -> "just now"
        min < 60 -> "$min min ago"
        min < 24 * 60 -> "${min / 60} h ago"
        min < 2 * 24 * 60 -> "yesterday"
        else -> "${min / (24 * 60)} days ago"
    }
}

/** Friends whose place is this episode (or film): their faces, a little stacked, and "Sami is here". */
@Composable
fun FriendsAt(friends: List<app.kimono.watch.model.FriendHere>, modifier: Modifier = Modifier) {
    if (friends.isEmpty()) return
    Row(modifier, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        val shown = friends.take(3)
        Box(Modifier.width(18.dp + 12.dp * (shown.size - 1)).size(Dp.Unspecified, 18.dp)) {
            shown.forEachIndexed { i, f ->
                PersonFace(f.person, f.username, 18.dp, Modifier.offset(x = 12.dp * i).border(1.5.dp, Night.bg, RoundedCornerShape(5.dp)))
            }
        }
        Text(hereText(friends), style = ui(12, FontWeight.Bold, Night.blush), maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

internal fun hereText(friends: List<app.kimono.watch.model.FriendHere>): String {
    val first = friends.first().shown
    return when {
        friends.size == 1 && friends[0].now -> "$first is watching it now"
        friends.size == 1 -> "$first is here"
        friends.size == 2 -> "$first and ${friends[1].shown} are here"
        else -> "$first and ${friends.size - 1} others are here"
    }
}

/**
 * Friends on Home: a row of who's watching now (each with Ask to join), then
 * who watched lately. Nothing when no friend has watched anything. [onAll]
 * opens the Friends tab.
 */
@Composable
fun HomeFriends(go: Go, onAll: () -> Unit, modifier: Modifier = Modifier) {
    val m = rememberFriends(go)
    val shown = m.page?.friends.orEmpty().filter { it.sharing && (it.now != null || it.recent.isNotEmpty()) }.take(10)
    if (shown.isEmpty()) return
    Column(modifier) {
        Row(Modifier.fillMaxWidth().padding(start = 16.dp, end = 8.dp, bottom = 10.dp), verticalAlignment = Alignment.CenterVertically) {
            val live = shown.count { it.now != null }
            Text(if (live > 0) "Friends watching now" else "Friends", style = ui(18, FontWeight.Bold), modifier = Modifier.weight(1f))
            Text("See all", style = ui(14, color = Night.fg2), modifier = Modifier.clip(RoundedCornerShape(8.dp)).clickableScaleClipped(RoundedCornerShape(8.dp), onAll).padding(horizontal = 8.dp, vertical = 4.dp))
        }
        LazyRow(contentPadding = PaddingValues(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            items(shown, key = { it.username }) { f -> HomeFriendCard(f, go, m) }
        }
    }
}

@Composable
private fun HomeFriendCard(f: Friend, go: Go, m: FriendsModel) {
    val now = f.now
    val last = f.recent.firstOrNull()
    val title = now?.title ?: last?.title
    Column(Modifier.width(232.dp).clip(RoundedCornerShape(14.dp)).background(Night.surface2).clickableScaleClipped(RoundedCornerShape(14.dp), { title?.let(go.open) }).padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Box {
                PersonFace(f.person, f.username, 36.dp)
                if (now != null) Box(Modifier.align(Alignment.BottomEnd).offset(3.dp, 3.dp).size(12.dp).clip(CircleShape).background(Night.surface2).padding(2.dp).clip(CircleShape).background(Night.suo))
            }
            Column(Modifier.weight(1f)) {
                Text(f.shown, style = ui(15, FontWeight.Bold), maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(if (now != null) "Watching now" else "Watched ${ago(last?.at ?: 0)}", style = ui(12, color = if (now != null) Night.fg else Night.fg3), maxLines = 1)
            }
        }
        if (title != null) Column(verticalArrangement = Arrangement.spacedBy(5.dp)) {
            Text(listOfNotNull(title.name, now?.label ?: last?.label).joinToString(" · "), style = ui(13, color = Night.fg2), maxLines = 1, overflow = TextOverflow.Ellipsis)
            val progress = now?.progress ?: last?.progress?.takeIf { !last.finished }
            if (progress != null) ProgressLine(progress.toFloat(), Modifier.fillMaxWidth().clip(RoundedCornerShape(2.dp)))
        }
        if (now != null) {
            val asking = m.askingOf(f)
            if (asking != null) PaperButton("Asking…", null, { m.cancelAsk(asking) }, Modifier.fillMaxWidth(), tonal = true, height = 36.dp)
            else PaperButton("Ask to join", Ic.people, { m.askToJoin(f) }, Modifier.fillMaxWidth(), height = 36.dp)
        }
    }
}

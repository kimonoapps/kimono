package app.kimono.watch.tv

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
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
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.tv.material3.Text
import app.kimono.watch.model.Friend
import app.kimono.watch.model.Person
import app.kimono.watch.phone.FriendsModel
import app.kimono.watch.phone.Go
import app.kimono.watch.phone.ago
import app.kimono.watch.phone.rememberFriends
import app.kimono.watch.player.PersonFace
import app.kimono.watch.theme.Night
import app.kimono.watch.theme.display
import app.kimono.watch.theme.ui
import app.kimono.watch.ui.Ic
import app.kimono.watch.ui.Skeleton

private val gutter = 48.dp

/** Friends on a TV: the phone's page laid out wide, every button a D-pad surface. */
@Composable
fun TvFriends(go: Go, nav: @Composable () -> Unit) {
    val m = rememberFriends(go)
    val p = m.page
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 64.dp), verticalArrangement = Arrangement.spacedBy(18.dp)) {
        item { nav() }
        item {
            Row(Modifier.padding(horizontal = gutter), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(20.dp)) {
                Text("Friends", style = display(34))
                TvButton(if (m.invisible) "Invisible" else "Go invisible", if (m.invisible) Ic.check else Ic.people, { m.setInvisible(!m.invisible) }, tonal = !m.invisible)
            }
        }
        when {
            p == null && m.problem != null -> item { Text(m.problem!!, style = ui(15, color = Night.fg3), modifier = Modifier.padding(horizontal = gutter)) }
            p == null -> items(2) { Skeleton(Modifier.padding(horizontal = gutter).widthIn(max = 900.dp).fillMaxWidth().size(0.dp, 160.dp), RoundedCornerShape(14.dp)) }
            else -> {
                if (p.asked.isNotEmpty()) {
                    item { Heading("Asked to be friends") }
                    items(p.asked, key = { "asked" + it.username }) { who ->
                        PersonLine(who) {
                            TvButton("Accept", Ic.check, { m.accept(who.username) })
                            TvButton("Not now", null, { m.decline(who.username) }, tonal = true)
                        }
                    }
                }
                if (p.friends.isEmpty()) item { Text("Add friends to see what they're watching.", style = ui(15, color = Night.fg3), modifier = Modifier.padding(horizontal = gutter)) }
                items(p.friends, key = { "f" + it.username }) { f -> FriendBlock(f, m, go) }
                if (p.people.isNotEmpty() || p.asking.isNotEmpty()) {
                    item { Heading("Add friends") }
                    items(p.asking, key = { "asking" + it.username }) { who -> PersonLine(who) { TvButton("Asked", Ic.check, { m.remove(who.username) }, tonal = true) } }
                    items(p.people, key = { "p" + it.username }) { who -> PersonLine(who) { TvButton("Add", Ic.people, { m.add(who.username) }, tonal = true) } }
                }
            }
        }
    }
}

@Composable
private fun Heading(text: String) {
    Text(text, style = ui(17, FontWeight.Bold, Night.fg2), modifier = Modifier.padding(start = gutter, top = 12.dp))
}

@Composable
private fun PersonLine(who: Person, actions: @Composable () -> Unit) {
    Row(Modifier.padding(horizontal = gutter).widthIn(max = 900.dp).fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
        PersonFace(who, who.username, 44.dp)
        Text(who.shown, style = ui(17, FontWeight.Bold), modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
        actions()
    }
}

/** A friend: face, what they're on (Ask to join while they watch), and their lately as a row of cards. */
@Composable
private fun FriendBlock(f: Friend, m: FriendsModel, go: Go) {
    val now = f.now
    val asking = m.askingOf(f)
    Column(Modifier.padding(horizontal = gutter).widthIn(max = 1100.dp).fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(Night.surface).padding(vertical = 16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row(Modifier.padding(horizontal = 18.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
            Box {
                PersonFace(f.person, f.username, 52.dp)
                if (now != null) Box(Modifier.align(Alignment.BottomEnd).offset(3.dp, 3.dp).size(16.dp).clip(CircleShape).background(Night.surface).padding(2.dp).clip(CircleShape).background(Night.suo))
            }
            Column(Modifier.weight(1f)) {
                Text(f.shown, style = ui(18, FontWeight.Bold), maxLines = 1)
                Text(when {
                    !f.sharing -> "Keeps what they watch to themselves"
                    now != null -> listOfNotNull("Watching ${now.title.name}", now.label, "together".takeIf { now.partyId != null }).joinToString(" · ")
                    f.recent.isNotEmpty() -> "Watched ${ago(f.recent[0].at)}"
                    else -> "Hasn't watched anything yet"
                }, style = ui(14, color = if (now != null) Night.fg else Night.fg3), maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            if (now != null) {
                if (asking != null) TvButton("Asking…", null, { m.cancelAsk(asking) }, tonal = true)
                else TvButton("Ask to join", Ic.people, { m.askToJoin(f) })
            }
            TvButton("Remove", null, { m.remove(f.username) }, tonal = true)
        }
        val cards = listOfNotNull(now?.title) + f.recent.filter { it.title.id != now?.title?.id }.map { it.title }
        if (cards.isNotEmpty()) LazyRow(contentPadding = PaddingValues(horizontal = 18.dp, vertical = 6.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            items(cards, key = { it.id }) { c ->
                val spot = f.recent.firstOrNull { it.title.id == c.id }
                Column(Modifier.width(196.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    TvCard(c, go)
                    Text(when {
                        now?.title?.id == c.id -> listOfNotNull("Now", now.label).joinToString(" · ")
                        spot?.finished == true -> listOfNotNull(spot.label, "done").joinToString(" · ")
                        else -> spot?.label ?: "${((spot?.progress ?: 0.0) * 100).toInt()}% in"
                    }, style = ui(13, color = Night.fg3), maxLines = 1)
                }
            }
        }
    }
}

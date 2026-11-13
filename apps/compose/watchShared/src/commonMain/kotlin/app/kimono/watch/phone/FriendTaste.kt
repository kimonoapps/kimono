package app.kimono.watch.phone

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
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
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import app.kimono.watch.LocalWatch
import app.kimono.watch.model.Card
import app.kimono.watch.model.FriendRating
import app.kimono.watch.model.FriendTaste
import app.kimono.watch.model.Person
import app.kimono.watch.player.PersonFace
import app.kimono.watch.theme.Night
import app.kimono.watch.theme.display
import app.kimono.watch.theme.ui
import app.kimono.watch.ui.I
import app.kimono.watch.ui.Ic
import app.kimono.watch.ui.Screen
import app.kimono.watch.ui.Skeleton
import app.kimono.watch.ui.clickableScale

/**
 * A friend's taste, phone and TV: their face and name, then rows of posters
 * for what they loved, liked, have on their list and didn't like. A poster
 * opens its title page.
 */
@Composable
fun FriendTasteScreen(s: Screen.Friend, go: Go, onClose: () -> Unit, wide: Boolean = false) {
    val watch = LocalWatch.current
    var taste by remember(s.username) { mutableStateOf<FriendTaste?>(null) }
    var problem by remember(s.username) { mutableStateOf<String?>(null) }
    LaunchedEffect(s.username) {
        runCatching { watch.api.friendTaste(s.username) }
            .onSuccess { taste = it; problem = null }
            .onFailure { problem = it.message ?: "That didn't load." }
    }
    val gutter = if (wide) 48.dp else 16.dp
    val poster = if (wide) 140.dp else 112.dp
    val back = remember { FocusRequester() }
    LaunchedEffect(Unit) { if (wide) runCatching { back.requestFocus() } }
    val t = taste
    val who = t?.person ?: Person(s.username, s.name, s.picture)
    LazyColumn(Modifier.fillMaxSize().background(if (wide) Night.surface else Night.bg), contentPadding = PaddingValues(top = statusTop + 6.dp, bottom = navBottom + 32.dp)) {
        item("bar") {
            Row(Modifier.fillMaxWidth().padding(start = gutter - 10.dp, end = gutter, bottom = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(44.dp).clip(CircleShape).focusRequester(back).clickableScale(onClose), contentAlignment = Alignment.Center) { I(Ic.back) }
            }
        }
        item("who") {
            Row(Modifier.padding(horizontal = gutter).padding(bottom = 22.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                PersonFace(who, who.username, if (wide) 88.dp else 72.dp)
                Text(who.shown, style = display(if (wide) 34 else 28), maxLines = 2, overflow = TextOverflow.Ellipsis)
            }
        }
        when {
            t == null && problem != null -> item { Text(problem!!, style = ui(15, color = Night.fg3), modifier = Modifier.padding(horizontal = gutter)) }
            t == null -> items(3) {
                Column(Modifier.padding(start = gutter, bottom = 22.dp)) {
                    Skeleton(Modifier.padding(bottom = 12.dp).size(140.dp, 20.dp), RoundedCornerShape(6.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) { repeat(5) { Skeleton(Modifier.width(poster).aspectRatio(2f / 3f)) } }
                }
            }
            !t.sharing -> item { Quiet("Keeps their list and ratings to themselves", gutter) }
            t.empty -> item { Quiet("Nothing rated yet", gutter) }
            else -> {
                val rows = listOf("Loved" to t.loved, "Liked" to t.liked, "On their list" to t.list, "Didn't like" to t.disliked).filter { it.second.isNotEmpty() }
                items(rows, key = { it.first }) { (title, cards) -> TasteRow(title, cards, go, gutter, poster) }
            }
        }
    }
}

@Composable
private fun Quiet(text: String, gutter: Dp) {
    Text(text, style = ui(15, color = Night.fg3), modifier = Modifier.padding(horizontal = gutter, vertical = 8.dp))
}

@Composable
private fun TasteRow(title: String, cards: List<Card>, go: Go, gutter: Dp, poster: Dp) {
    Column(Modifier.padding(bottom = 22.dp)) {
        Text(title, style = ui(17, FontWeight.Bold), modifier = Modifier.padding(start = gutter, end = gutter, bottom = 10.dp))
        LazyRow(contentPadding = PaddingValues(horizontal = gutter, vertical = 4.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            items(cards, key = { it.id }, contentType = { "poster" }) { PosterCard(it, go, poster) }
        }
    }
}

/** What friends thought of a title, on its page: a few small faces and "Sami loved it · Noor liked it · On Maya's list". */
@Composable
fun FriendRatingsLine(ratings: List<FriendRating>, modifier: Modifier = Modifier) {
    if (ratings.isEmpty()) return
    Row(modifier, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        val faces = ratings.take(3)
        Box(Modifier.width(22.dp + 14.dp * (faces.size - 1)).height(22.dp)) {
            faces.forEachIndexed { i, f ->
                PersonFace(f.person, f.username, 22.dp, Modifier.offset(x = 14.dp * i).border(1.5.dp, Night.bg, CircleShape))
            }
        }
        Text(ratingsText(ratings), style = ui(14, color = Night.fg2), maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
    }
}

/** At most three friends by name, then "and 2 others". */
internal fun ratingsText(ratings: List<FriendRating>): String {
    val named = ratings.take(3).map { f ->
        val first = f.shown.substringBefore(' ')
        when (f.rating) {
            "love" -> "$first loved it"
            "up" -> "$first liked it"
            "down" -> "$first didn't like it"
            else -> "On $first's list"
        }
    }
    val rest = ratings.size - named.size
    return named.joinToString(" · ") + when (rest) { 0 -> ""; 1 -> " and 1 other"; else -> " and $rest others" }
}

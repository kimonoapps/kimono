package app.kimono.watch.phone

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import app.kimono.watch.LocalWatch
import app.kimono.watch.model.Person
import app.kimono.watch.player.PersonFace
import app.kimono.watch.theme.Night
import app.kimono.watch.theme.ui
import app.kimono.watch.ui.I
import app.kimono.watch.ui.Ic
import app.kimono.watch.ui.PaperButton
import app.kimono.watch.ui.clickableScaleClipped
import kotlinx.coroutines.launch

/**
 * Watch together from a title: who to ask first (the three you've watched
 * with most lately, a search for anyone else), then Start makes the party
 * with them invited and opens the player in it.
 */
@Composable
fun TogetherStart(name: String, what: String?, titleId: String, season: Int?, episode: Int?, at: Double, onDismiss: () -> Unit, onStarted: (partyId: String) -> Unit) {
    val watch = LocalWatch.current
    val scope = rememberCoroutineScope()
    var people by remember { mutableStateOf<List<Person>>(emptyList()) }
    var recent by remember { mutableStateOf<List<String>>(emptyList()) }
    val picked = remember { mutableStateListOf<String>() }
    var query by remember { mutableStateOf("") }
    var starting by remember { mutableStateOf(false) }
    val me = watch.accounts.active.value?.username.orEmpty()
    LaunchedEffect(Unit) {
        runCatching { watch.api.parties() }.onSuccess { a -> people = a.people.filter { !it.username.equals(me, true) }; recent = a.recent }
    }
    val q = query.trim()
    val shown = if (q.isNotEmpty()) people.filter { it.shown.contains(q, true) || it.username.contains(q, true) }
        else (people.filter { it.username.lowercase() in picked } + people.sortedBy { recent.indexOf(it.username.lowercase()).let { i -> if (i < 0) Int.MAX_VALUE else i } }).distinct().take(maxOf(3, picked.size))

    app.kimono.watch.ui.Dialog(onDismiss = { if (!starting) onDismiss() }) {
        Text("Watch together", style = ui(18, FontWeight.Bold))
        Text(listOfNotNull(name, what).joinToString(" · "), style = ui(14, color = Night.fg2), maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 2.dp, bottom = 14.dp))
        Text("Who's joining?", style = ui(14, FontWeight.Bold, Night.fg2), modifier = Modifier.padding(bottom = 6.dp))
        if (people.size > 3) Row(Modifier.padding(bottom = 6.dp).fillMaxWidth().height(44.dp).clip(RoundedCornerShape(10.dp)).background(Night.surface2)
            .border(1.dp, Night.line, RoundedCornerShape(10.dp)).padding(horizontal = 12.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            I(Ic.search, 18.dp, Night.fg3)
            Box(Modifier.weight(1f), contentAlignment = Alignment.CenterStart) {
                if (query.isEmpty()) Text("Search people", style = ui(15, color = Night.fg3))
                BasicTextField(query, { query = it.take(60) }, Modifier.fillMaxWidth(), singleLine = true, textStyle = ui(15), cursorBrush = SolidColor(Night.suo),
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search))
            }
        }
        if (q.isNotEmpty() && shown.isEmpty()) Text("No one by that name", style = ui(14, color = Night.fg3), modifier = Modifier.padding(vertical = 8.dp))
        shown.forEach { p ->
            val u = p.username.lowercase()
            val on = u in picked
            Row(Modifier.fillMaxWidth().clickableScaleClipped(RoundedCornerShape(10.dp), { if (on) picked.remove(u) else picked.add(u) }).padding(horizontal = 4.dp, vertical = 7.dp),
                verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                PersonFace(p, p.username, 32.dp)
                Text(p.shown, style = ui(15, FontWeight.Bold), modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
                Box(Modifier.size(24.dp).clip(RoundedCornerShape(7.dp)).background(if (on) Night.suo else Night.surface2).border(1.dp, if (on) Night.suo else Night.line, RoundedCornerShape(7.dp)), contentAlignment = Alignment.Center) {
                    if (on) I(Ic.check, 16.dp, Night.paper)
                }
            }
        }
        Spacer(Modifier.size(18.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            PaperButton("Cancel", null, { if (!starting) onDismiss() }, tonal = true)
            PaperButton(if (starting) "Starting…" else if (picked.isEmpty()) "Start" else "Start and invite ${picked.size}", Ic.people, {
                if (starting) return@PaperButton
                starting = true
                scope.launch {
                    runCatching { watch.api.startParty(titleId, season ?: 0, episode ?: 0, at, watch.deviceId, picked.toList()) }
                        .onSuccess { onStarted(it.id) }
                        .onFailure { starting = false; watch.toasts.show(it.message ?: "The party didn't start. Try again.") }
                }
            })
        }
    }
}

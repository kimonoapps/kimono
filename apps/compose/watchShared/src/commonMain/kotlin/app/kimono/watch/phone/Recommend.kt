package app.kimono.watch.phone

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
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
 * Recommend a title: to friends, or onto your Kimono profile, with a note if
 * you like. Recommendations are Kimono's (lib/friends), shared with Books.
 */
@Composable
fun RecommendSheet(titleId: String, name: String, year: Int?, poster: String?, onDismiss: () -> Unit) {
    val watch = LocalWatch.current
    val scope = rememberCoroutineScope()
    var friends by remember { mutableStateOf<List<Person>?>(null) }
    val picked = remember { mutableStateListOf<String>() }
    var onProfile by remember { mutableStateOf(false) }
    var note by remember { mutableStateOf("") }
    var sending by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) {
        friends = runCatching { watch.api.friends().friends.map { Person(it.username, it.name, it.picture) } }.getOrDefault(emptyList())
    }
    fun row(on: Boolean, toggle: () -> Unit, lead: @Composable () -> Unit, label: String) =
        @Composable {
            Row(Modifier.fillMaxWidth().clickableScaleClipped(RoundedCornerShape(10.dp), toggle).padding(horizontal = 4.dp, vertical = 7.dp),
                verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                lead()
                Text(label, style = ui(15, FontWeight.Bold), modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
                Box(Modifier.size(24.dp).clip(RoundedCornerShape(7.dp)).background(if (on) Night.suo else Night.surface2).border(1.dp, if (on) Night.suo else Night.line, RoundedCornerShape(7.dp)), contentAlignment = Alignment.Center) {
                    if (on) I(Ic.check, 16.dp, Night.paper)
                }
            }
        }

    app.kimono.watch.ui.Dialog(onDismiss = { if (!sending) onDismiss() }) {
        Text("Recommend", style = ui(18, FontWeight.Bold))
        Text(name, style = ui(14, color = Night.fg2), maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 2.dp, bottom = 14.dp))
        val list = friends
        if (list != null && list.isEmpty()) Text("No friends yet", style = ui(14, color = Night.fg3), modifier = Modifier.padding(vertical = 8.dp))
        list?.forEach { p ->
            val u = p.username.lowercase()
            row(u in picked, { if (u in picked) picked.remove(u) else picked.add(u) }, { PersonFace(p, p.username, 32.dp) }, p.shown)()
        }
        row(onProfile, { onProfile = !onProfile }, { Box(Modifier.size(32.dp), contentAlignment = Alignment.Center) { I(Ic.people, 22.dp, Night.fg2) } }, "On my profile")()
        Box(Modifier.padding(top = 10.dp).fillMaxWidth().heightIn(min = 64.dp).clip(RoundedCornerShape(10.dp)).background(Night.surface2)
            .border(1.dp, Night.line, RoundedCornerShape(10.dp)).padding(12.dp)) {
            if (note.isEmpty()) Text("Add a note", style = ui(15, color = Night.fg3))
            BasicTextField(note, { note = it.take(500) }, Modifier.fillMaxWidth(), textStyle = ui(15), cursorBrush = SolidColor(Night.suo))
        }
        Spacer(Modifier.size(18.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            PaperButton("Cancel", null, { if (!sending) onDismiss() }, tonal = true)
            PaperButton(if (sending) "Sending…" else "Send", Ic.send, {
                if (sending || (picked.isEmpty() && !onProfile)) return@PaperButton
                sending = true
                scope.launch {
                    runCatching {
                        if (picked.isNotEmpty()) watch.api.recommend(titleId, name, year, poster, picked.toList(), note)
                        if (onProfile) watch.api.recommend(titleId, name, year, poster, emptyList(), note)
                    }.onSuccess {
                        val names = list.orEmpty().filter { it.username.lowercase() in picked }.map { it.shown.substringBefore(' ') }
                        watch.toasts.show(if (names.isEmpty()) "On your profile" else if (names.size > 2) "Sent to ${names.size} friends" else "Sent to ${names.joinToString(" and ")}")
                        onDismiss()
                    }.onFailure { sending = false; watch.toasts.show(it.message ?: "That didn't send. Try again.") }
                }
            })
        }
    }
}

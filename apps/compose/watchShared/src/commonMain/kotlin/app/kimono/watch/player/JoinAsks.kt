package app.kimono.watch.player

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
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
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import app.kimono.watch.LocalWatch
import app.kimono.watch.model.JoinAsk
import app.kimono.watch.theme.Night
import app.kimono.watch.theme.ui
import app.kimono.watch.ui.Ic
import app.kimono.watch.ui.PaperButton
import app.kimono.watch.ui.TogetherViewModel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * "Sami wants to join": a friend asked from their Friends page. Let in brings
 * them into the party this screen is in, or starts one from here with them
 * invited and moves the player into it ([onJoinParty]). Asked of the server
 * every 6 s while the player is open.
 */
@Composable
fun JoinAsks(
    titleId: String, season: Int, episode: Int, at: () -> Double,
    party: TogetherViewModel?, tv: Boolean, onJoinParty: ((partyId: String) -> Unit)?, modifier: Modifier = Modifier,
) {
    val watch = LocalWatch.current
    val scope = rememberCoroutineScope()
    var ask by remember { mutableStateOf<JoinAsk?>(null) }
    var handled by remember { mutableStateOf(setOf<String>()) }
    var busy by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) {
        while (true) {
            runCatching { watch.api.asks() }.onSuccess { a -> ask = a.incoming.firstOrNull { it.id !in handled } }
            delay(6_000)
        }
    }
    fun answer(a: JoinAsk, yes: Boolean) {
        if (busy) return
        busy = true
        handled = handled + a.id
        scope.launch {
            runCatching {
                if (!yes) { watch.api.answerAsk(a.id, false); return@runCatching }
                val joined = party?.partyId
                if (joined != null) { watch.api.answerAsk(a.id, true, joined); return@runCatching }
                val started = watch.api.startParty(titleId, season, episode, at(), watch.deviceId, listOf(a.from))
                watch.api.answerAsk(a.id, true, started.id)
                onJoinParty?.invoke(started.id)
            }.onFailure { watch.toasts.show(it.message ?: "That didn't go through.") }
            ask = null
            busy = false
        }
    }
    val shown = ask?.takeIf { party != null || onJoinParty != null }
    var last by remember { mutableStateOf<JoinAsk?>(null) }
    if (shown != null) last = shown
    AnimatedVisibility(shown != null, modifier, enter = fadeIn(tween(250)) + slideInVertically(tween(300)) { -it / 3 }, exit = fadeOut(tween(200))) {
        val a = last ?: return@AnimatedVisibility
        val letIn = remember { FocusRequester() }
        LaunchedEffect(a.id) { if (tv) runCatching { letIn.requestFocus() } }
        Row(Modifier.padding(top = 72.dp).widthIn(max = 460.dp).shadow(16.dp, RoundedCornerShape(14.dp)).clip(RoundedCornerShape(14.dp)).background(Night.surface2).padding(12.dp),
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            PersonFace(a.other, a.from, 40.dp)
            Column(Modifier.weight(1f, fill = false)) {
                Text("${a.name.ifBlank { a.from }} wants to join", style = ui(15, FontWeight.Bold), maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(if (party != null) "Into this party" else "Watch together from here", style = ui(13, color = Night.fg2), maxLines = 1)
            }
            PaperButton("Not now", null, { answer(a, false) }, tonal = true, height = 38.dp)
            PaperButton(if (busy) "…" else "Let in", Ic.people, { answer(a, true) }, Modifier.focusRequester(letIn), height = 38.dp)
        }
    }
}

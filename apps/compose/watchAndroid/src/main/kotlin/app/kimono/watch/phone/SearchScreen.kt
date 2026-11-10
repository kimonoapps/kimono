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
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import app.kimono.watch.theme.Night
import app.kimono.watch.theme.ui
import app.kimono.watch.ui.I
import app.kimono.watch.ui.Ic
import app.kimono.watch.ui.Img
import app.kimono.watch.ui.SearchViewModel
import app.kimono.watch.ui.Skeleton
import app.kimono.watch.ui.clickableScale

/** Search: titles, people and genres; a result opens its title page, the play circle plays it. */
@Composable
fun SearchScreen(vm: SearchViewModel, go: Go, onClose: () -> Unit, tv: Boolean = false) {
    val state by vm.state.collectAsState()
    val focus = remember { FocusRequester() }
    val gutter = if (tv) 48.dp else 16.dp
    LazyColumn(Modifier.fillMaxSize().background(Night.bg).imePadding(), contentPadding = PaddingValues(top = statusTop + 12.dp, bottom = navBottom + 24.dp, start = gutter, end = gutter), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        item("bar") {
            Row(Modifier.fillMaxWidth().padding(bottom = 14.dp).clip(RoundedCornerShape(12.dp)).background(Night.surface2).padding(start = 12.dp, end = 6.dp, top = 4.dp, bottom = 4.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                I(Ic.search)
                Box(Modifier.weight(1f).padding(vertical = 10.dp, horizontal = 4.dp)) {
                    if (state.query.isEmpty()) Text("Titles, people, genres", style = ui(17, color = Night.fg3))
                    BasicTextField(state.query, vm::type, Modifier.fillMaxWidth().focusRequester(focus), singleLine = true, textStyle = ui(17), cursorBrush = SolidColor(Night.suo),
                        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search))
                }
                Box(Modifier.size(40.dp).clip(CircleShape).clickableScale(onClose), contentAlignment = Alignment.Center) { I(Ic.close) }
            }
        }
        item("h") {
            if (state.loading) Skeleton(Modifier.width(120.dp).height(18.dp).padding(bottom = 6.dp))
            else Text(if (state.query.isBlank()) "Popular searches" else if (state.results.isEmpty()) "Nothing matches that yet" else "Results", style = ui(18, FontWeight.Bold), modifier = Modifier.padding(bottom = 4.dp))
        }
        if (state.loading) items(4) { Skeleton(Modifier.fillMaxWidth().height(80.dp)) }
        else items(state.results, key = { it.id }) { c ->
            Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp)).background(Night.surface).clickableScale({ go.open(c) }), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                Img(c.backdrop ?: c.poster, Modifier.width(140.dp).aspectRatio(16f / 9f))
                Text(c.name, style = ui(15), modifier = Modifier.weight(1f), maxLines = 2, overflow = TextOverflow.Ellipsis)
                Box(Modifier.padding(end = 12.dp).size(40.dp).clip(CircleShape).border(1.5.dp, Night.fg2, CircleShape).clickableScale({ go.play(c.id, null, null) }), contentAlignment = Alignment.Center) { I(Ic.play, 22.dp) }
            }
        }
    }
    LaunchedEffect(Unit) { runCatching { focus.requestFocus() } }
}

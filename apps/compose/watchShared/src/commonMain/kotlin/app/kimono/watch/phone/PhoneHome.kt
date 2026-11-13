package app.kimono.watch.phone

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.requiredWidth
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.blur
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.kimono.watch.data.Profile
import app.kimono.watch.model.Card
import app.kimono.watch.model.Row as WatchRow
import app.kimono.watch.theme.Night
import app.kimono.watch.theme.display
import app.kimono.watch.theme.ui
import app.kimono.watch.ui.Boxed
import app.kimono.watch.ui.Brand
import app.kimono.watch.ui.Coming
import app.kimono.watch.ui.Dots
import app.kimono.watch.ui.Face
import app.kimono.watch.ui.HomeViewModel
import app.kimono.watch.ui.HotViewModel
import app.kimono.watch.ui.I
import app.kimono.watch.ui.Ic
import app.kimono.watch.ui.Img
import app.kimono.watch.ui.ListViewModel
import app.kimono.watch.ui.Logo
import app.kimono.watch.ui.PaperButton
import app.kimono.watch.LocalWatch
import kotlinx.coroutines.launch
import app.kimono.watch.ui.ProgressLine
import app.kimono.watch.ui.Ribbon
import app.kimono.watch.ui.RingButton
import app.kimono.watch.ui.Skeleton
import app.kimono.watch.ui.Top10
import app.kimono.watch.ui.clickableScale
import app.kimono.watch.ui.clickableScaleClipped

/** What a tap on a card or button asks for. */
class Go(
    val open: (Card) -> Unit,
    val play: (id: String, season: Int?, episode: Int?) -> Unit,
    /** Watch Together: start a party on this title (from [at] seconds), or join one. */
    val together: (id: String, season: Int?, episode: Int?, at: Double) -> Unit = { _, _, _, _ -> },
    val join: (partyId: String) -> Unit = {},
    /** A friend's list and ratings. */
    val friend: (app.kimono.watch.model.Person) -> Unit = {},
)

val statusTop @Composable get() = WindowInsets.statusBars.asPaddingValues().calculateTopPadding()
val navBottom @Composable get() = WindowInsets.navigationBars.asPaddingValues().calculateBottomPadding()

/* ───── The shell: top bar, the three pages, the bottom bar ───── */

@Composable
fun PhoneShell(profile: Profile, home: HomeViewModel, hot: HotViewModel, list: ListViewModel, go: Go, onSearch: () -> Unit, onProfiles: () -> Unit, onSettings: () -> Unit, previewing: Boolean) {
    var page by remember { mutableStateOf("home") }
    val homeScroll = rememberLazyListState()
    val scrolled by remember { derivedStateOf { homeScroll.firstVisibleItemIndex > 0 || homeScroll.firstVisibleItemScrollOffset > 120 } }
    Box(Modifier.fillMaxSize().background(Night.bg)) {
        when (page) {
            "home" -> HomePage(profile, home, go, homeScroll, previewing) { page = "friends" }
            "hot" -> HotPage(hot, go)
            "downloads" -> DownloadsPage(go)
            "friends" -> FriendsPage(go)
            else -> ListPage(list, go)
        }
        val solid = scrolled || page != "home"
        val bar by animateColorAsState(if (solid) Night.bg.copy(alpha = 0.97f) else Color.Transparent, tween(300), label = "bar")
        Row(Modifier.fillMaxWidth().background(bar).padding(top = statusTop + 12.dp, bottom = 12.dp, start = 16.dp, end = 16.dp), verticalAlignment = Alignment.CenterVertically) {
            Brand()
            Spacer(Modifier.weight(1f))
            Box(Modifier.size(40.dp).clip(CircleShape).clickableScale(onSearch), contentAlignment = Alignment.Center) { I(Ic.search) }
            Spacer(Modifier.width(12.dp))
            AvatarMenu(profile, onProfiles, onSettings)
        }
        if (page == "home") {
            val shelf = home.state.collectAsState().value.shelf
            val chips by animateFloatAsState(if (scrolled) 0f else 1f, tween(250), label = "chips")
            Row(Modifier.padding(top = statusTop + 64.dp, start = 16.dp).graphicsLayer { alpha = chips; translationY = (1 - chips) * -8.dp.toPx() }, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                listOf("Series" to "Series", "Film" to "Films", "Anime" to "Anime").forEach { (kind, label) ->
                    Chip(label, shelf == kind) { if (chips > 0.5f) home.shelf(kind) }
                }
            }
        }
        BottomBar(page, Modifier.align(Alignment.BottomCenter)) { page = it; if (it == "list") list.refresh() }
    }
}

@Composable
fun Chip(label: String, on: Boolean, onClick: () -> Unit) {
    Text(label, style = ui(14, color = if (on) Night.ink else Night.fg),
        modifier = Modifier.clip(RoundedCornerShape(999.dp)).background(if (on) Night.paper else Color(0x40110C0A))
            .border(1.dp, if (on) Night.paper else Color(0x66EFE0DA), RoundedCornerShape(999.dp)).clickableScale(onClick).padding(horizontal = 14.dp, vertical = 6.dp))
}

@Composable
private fun BottomBar(page: String, modifier: Modifier, onPage: (String) -> Unit) {
    Row(modifier.fillMaxWidth().background(Night.bg).border(BorderStroke(1.dp, Color(0x0DFFFFFF)), RoundedCornerShape(0.dp))
        .padding(top = 8.dp, bottom = navBottom.coerceAtLeast(8.dp), start = 16.dp, end = 16.dp), horizontalArrangement = Arrangement.SpaceAround) {
        listOf(Triple("home", "Home", Ic.home), Triple("friends", "Friends", Ic.people), Triple("list", "My list", Ic.bookmark), Triple("downloads", "Downloads", Ic.dl)).forEach { (id, label, icon) ->
            val on = page == id
            val pill by animateColorAsState(if (on) Color(0x38D06A82) else Color.Transparent, label = "pill")
            Column(Modifier.width(72.dp).clickableScale({ onPage(id) }, outline = false), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Box(Modifier.size(56.dp, 30.dp).clip(RoundedCornerShape(999.dp)).background(pill), contentAlignment = Alignment.Center) { I(icon, tint = if (on) Night.fg else Night.fg3) }
                Text(label, style = ui(11, color = if (on) Night.fg else Night.fg3), maxLines = 1)
            }
        }
    }
}

/* ───── Home ───── */

@Composable
private fun HomePage(profile: Profile, vm: HomeViewModel, go: Go, scroll: androidx.compose.foundation.lazy.LazyListState, previewing: Boolean, onFriends: () -> Unit) {
    val state by vm.state.collectAsState()
    val home = state.home
    /* The hero's preview stops once Home is scrolled, so the rows have the phone to themselves. */
    val top by remember(scroll) { derivedStateOf { scroll.firstVisibleItemIndex == 0 && scroll.firstVisibleItemScrollOffset < 240 } }
    LazyColumn(Modifier.fillMaxSize(), state = scroll, contentPadding = PaddingValues(bottom = navBottom + 96.dp)) {
        item("hero", contentType = "hero") { Hero(home?.featured, home?.rows.orEmpty(), go, previewing && top) }
        item("party") { PartyInvites(go, Modifier.padding(start = 16.dp, end = 16.dp, bottom = 22.dp)) }
        item("friends") { FriendsRow(go, onFriends, Modifier.padding(bottom = 22.dp)) }
        if (home == null) {
            if (state.problem != null) item { Text(state.problem!!, style = ui(15, color = Night.fg3), modifier = Modifier.padding(16.dp)) }
            else items(4) { SkeletonRow() }
        } else {
            items(home.rows, key = { it.id + state.shelf }, contentType = { it.kind }) { row -> RailRow(row, profile, go) }
            /* More rows on the way: skeletons where they'll land. */
            if (home.cursor != null) items(2, key = { "more$it" }, contentType = { "skeleton" }) { SkeletonRow() }
        }
    }
    /* Three rows from the end, the next page is asked for. */
    androidx.compose.runtime.LaunchedEffect(scroll, vm) {
        androidx.compose.runtime.snapshotFlow { scroll.layoutInfo.let { it.totalItemsCount - (it.visibleItemsInfo.lastOrNull()?.index ?: 0) } }
            .collect { left -> if (left <= 5) vm.more() }
    }
}

@Composable
fun SkeletonRow() {
    Column(Modifier.padding(bottom = 22.dp)) {
        Skeleton(Modifier.padding(start = 16.dp, bottom = 12.dp).size(220.dp, 20.dp), RoundedCornerShape(6.dp))
        Row(Modifier.padding(start = 16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) { repeat(5) { Skeleton(Modifier.width(112.dp).aspectRatio(2f / 3f)) } }
    }
}

@Composable
private fun Hero(featured: Card?, rows: List<WatchRow>, go: Go, active: Boolean) {
    var playing by remember(featured?.id) { mutableStateOf(false) }
    var muted by remember { mutableStateOf(true) }
    val logoScale by animateFloatAsState(if (playing && active) 0.72f else 1f, tween(1200), label = "logo")
    val rank = featured?.let { f -> rows.firstOrNull { it.id == "top" }?.items?.firstOrNull { it.id == f.id }?.top }
    val resuming = featured?.let { f -> rows.firstOrNull { it.id == "continue" }?.items?.any { it.id == f.id } } == true
    Box(Modifier.fillMaxWidth()) {
        /* The backdrop bleeding out behind the card, blurred. */
        if (featured != null) Box(Modifier.matchParentSize()) {
            Img(featured.backdropLarge ?: featured.poster, Modifier.fillMaxSize().graphicsLayer { scaleX = 1.2f; scaleY = 1.2f; alpha = 0.55f }.blur(40.dp))
            Box(Modifier.fillMaxSize().background(Brush.verticalGradient(0f to Color(0x33110C0A), 0.92f to Night.bg)))
        }
    Box(Modifier.fillMaxWidth().padding(top = statusTop + 112.dp, start = 16.dp, end = 16.dp, bottom = 20.dp)) {
        if (featured == null) { Skeleton(Modifier.fillMaxWidth().aspectRatio(3f / 4f), RoundedCornerShape(14.dp)); return@Box }
        Box(Modifier.fillMaxWidth().aspectRatio(3f / 4f).shadow(40.dp, RoundedCornerShape(14.dp), ambientColor = Color.Black, spotColor = Color.Black).clip(RoundedCornerShape(14.dp))) {
            Img(featured.poster ?: featured.backdropLarge, Modifier.fillMaxSize())
            BoxWithConstraints(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                LocalWatch.current.preview.Show(featured.id, if (featured.isFilm) 0 else 1, if (featured.isFilm) 0 else 1, muted, active, { playing = it }, Modifier.requiredWidth(maxHeight * 16f / 9f).height(maxHeight))
            }
            Box(Modifier.fillMaxSize().background(Brush.verticalGradient(0.45f to Color(0x00110C0A), 1f to Color(0xEB110C0A))))
            Column(Modifier.align(Alignment.BottomCenter).padding(start = 16.dp, end = 16.dp, bottom = 18.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(14.dp)) {
                Logo(featured.name, featured.logo, 48, Modifier.graphicsLayer { scaleX = logoScale; scaleY = logoScale; transformOrigin = androidx.compose.ui.graphics.TransformOrigin(0.5f, 1f) }, center = true, maxHeight = 96.dp)
                if (rank != null) RankLine(rank, featured.shelf)
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    PaperButton(if (resuming) "Resume" else "Play", Ic.play, { go.play(featured.id, null, null) }, Modifier.weight(1f))
                    PaperButton("More info", Ic.info, { go.open(featured) }, Modifier.weight(1f), tonal = true)
                }
            }
            RingButton(if (muted) Ic.mute else Ic.vol, { muted = !muted }, Modifier.align(Alignment.TopEnd).padding(12.dp))
        }
    }
    }
}

@Composable
fun RankLine(rank: Int, shelf: String, size: Int = 15) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        Top10()
        Text("#$rank in ${if (shelf == "Film") "Films" else shelf} today", style = ui(size, FontWeight.Bold))
    }
}

@Composable
private fun RailRow(row: WatchRow, profile: Profile, go: Go) {
    /* Removed from history meanwhile: off Continue watching before Home loads again. */
    val forgotten by LocalWatch.current.api.forgotten.collectAsState()
    if (row.kind == "continue" && row.items.all { it.id in forgotten }) return
    Column(Modifier.padding(bottom = 22.dp)) {
        val title = if (row.id == "continue") "Continue watching" else row.title
        Text(title, style = ui(17, FontWeight.Bold), modifier = Modifier.padding(start = 16.dp, end = 16.dp, bottom = 10.dp))
        LazyRow(contentPadding = PaddingValues(horizontal = 16.dp, vertical = 4.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            when (row.kind) {
                "continue" -> items(row.items.filter { it.id !in forgotten }, key = { it.id }, contentType = { "continue" }) { ContinueCard(it, go) }
                "top" -> itemsIndexed(row.items, key = { _, c -> c.id }, contentType = { _, _ -> "top" }) { i, c -> TopTen(i + 1, c, go) }
                else -> items(row.items, key = { it.id }, contentType = { "poster" }) { PosterCard(it, go) }
            }
        }
    }
}

@Composable
fun PosterCard(card: Card, go: Go, width: Dp = 112.dp, plain: Boolean = false, modifier: Modifier = Modifier) {
    Box(modifier.width(width).aspectRatio(2f / 3f).clip(RoundedCornerShape(8.dp)).background(Night.surface2).clickableScale({ go.open(card) })) {
        Img(card.poster ?: card.backdrop, Modifier.fillMaxSize())
        if (card.poster == null) {
            Box(Modifier.fillMaxSize().background(Brush.verticalGradient(0.55f to Color.Transparent, 1f to Color(0x99000000))))
            Text(card.name, style = display(16), modifier = Modifier.align(Alignment.BottomStart).padding(10.dp), maxLines = 3)
        }
        if (!plain) {
            card.badge?.let { Ribbon(it, Modifier.align(Alignment.TopCenter)) }
            if (card.top != null) Top10(22.dp, Modifier.align(Alignment.TopEnd).padding(6.dp))
        }
    }
}

@Composable
private fun ContinueCard(card: Card, go: Go) {
    val watch = LocalWatch.current
    val scope = rememberCoroutineScope()
    Column(Modifier.width(168.dp).clip(RoundedCornerShape(8.dp)).background(Night.surface)) {
        Box(Modifier.fillMaxWidth().aspectRatio(16f / 9f).clickableScale({ go.open(card) })) {
            Img(card.backdrop ?: card.poster, Modifier.fillMaxSize())
        }
        ProgressLine(((card.fraction ?: 0.0).coerceAtLeast(0.04)).toFloat(), Modifier.fillMaxWidth())
        Row(Modifier.padding(start = 12.dp, end = 6.dp, top = 8.dp, bottom = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(card.name, style = ui(14, FontWeight.Bold), maxLines = 1, overflow = TextOverflow.Ellipsis)
                val label = if (card.isFilm || (card.season ?: 0) == 0) "Film" else card.label ?: "S${card.season}:E${card.episode}"
                Text("$label · ${card.left ?: 0}m left", style = ui(13, color = Night.fg2), maxLines = 1)
            }
            Box(Modifier.size(40.dp).clip(CircleShape).clickableScale({ go.play(card.id, card.season?.takeIf { it > 0 }, card.episode?.takeIf { it > 0 }) }), contentAlignment = Alignment.Center) { I(Ic.play) }
            Box(Modifier.size(32.dp).clip(CircleShape).clickableScale({ scope.launch { runCatching { watch.api.forget(card.id) }.onSuccess { watch.toasts.show("Removed from history") }.onFailure { watch.toasts.show("That didn't work. Try again.") } } }), contentAlignment = Alignment.Center) { I(Ic.close, 18.dp, Night.fg3) }
        }
    }
}

@Composable
private fun TopTen(n: Int, card: Card, go: Go) {
    Row(verticalAlignment = Alignment.Bottom) {
        Box(contentAlignment = Alignment.BottomEnd, modifier = Modifier.offset(x = 14.dp)) {
            val style = display(124).copy(lineHeight = 90.sp, letterSpacing = (-9).sp)
            Text("$n", style = style.copy(color = Night.bg))
            Text("$n", style = style.copy(color = Night.fg3, drawStyle = Stroke(width = 6f)))
        }
        PosterCard(card, go, 96.dp, plain = true)
    }
}

/* ───── New & hot ───── */

private val months = listOf("JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC")
private val monthNames = listOf("January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December")

fun whenLine(item: Coming): String {
    val (_, m, d) = item.date.split("-").map { it.toIntOrNull() ?: 1 }
    val tracker = item.page.tracker
    val newSeason = item.page.seasons.lastOrNull()?.let { s -> s.airDate == item.date || (tracker != null && s.number > tracker.season && s.airDate?.let { it >= item.date } == true) } == true
    val what = if (newSeason) "Season ${item.page.seasons.last().number} arrives" else "New episode arrives"
    return "$what ${monthNames[m - 1]} $d"
}

fun dateParts(date: String): Pair<String, String> {
    val parts = date.split("-")
    return months[(parts.getOrNull(1)?.toIntOrNull() ?: 1) - 1] to (parts.getOrNull(2) ?: "")
}

@Composable
private fun HotPage(vm: HotViewModel, go: Go) {
    val state by vm.state.collectAsState()
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(top = statusTop + 76.dp, bottom = navBottom + 100.dp, start = 16.dp, end = 16.dp), verticalArrangement = Arrangement.spacedBy(34.dp)) {
        item { Text("Coming soon", style = display(28), modifier = Modifier.padding(top = 12.dp)) }
        when {
            state.loading -> items(2) { Column(verticalArrangement = Arrangement.spacedBy(10.dp)) { Skeleton(Modifier.fillMaxWidth().aspectRatio(16f / 9f)); Skeleton(Modifier.fillMaxWidth(0.5f).height(14.dp)); Skeleton(Modifier.fillMaxWidth().height(14.dp)) } }
            state.items.isEmpty() -> item { Text(state.problem ?: "Nothing new is on its way for your shows yet.", style = ui(15, color = Night.fg3)) }
            else -> items(state.items, key = { it.card.id }) { item -> ComingArticle(item, go, onRemind = { vm.remind(item) }) }
        }
    }
}

@Composable
fun ComingArticle(item: Coming, go: Go, onRemind: () -> Unit, wide: Boolean = false) {
    val (mon, day) = dateParts(item.date)
    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Column(Modifier.width(52.dp).padding(top = 4.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Text(mon, style = ui(12, color = Night.fg3).copy(letterSpacing = 1.sp))
            Text(day, style = display(30))
        }
        Column(Modifier.weight(1f)) {
            Box(Modifier.fillMaxWidth().aspectRatio(16f / 9f).clickableScaleClipped(RoundedCornerShape(10.dp), { go.open(item.card) })) { Img(item.page.title.backdropLarge ?: item.card.backdrop, Modifier.fillMaxSize()) }
            Row(Modifier.padding(top = 12.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Box(Modifier.weight(1f)) { Logo(item.card.name, item.card.logo, 26, maxHeight = 48.dp) }
                Stack(Ic.bell, if (item.page.reminding) "Reminding" else "Remind me", item.page.reminding, onRemind)
                Stack(Ic.info, "Info", false) { go.open(item.card) }
            }
            Text(whenLine(item), style = ui(14, FontWeight.Bold), modifier = Modifier.padding(top = 8.dp))
            Text(item.page.title.overview, style = ui(14, color = Night.fg2).copy(lineHeight = 22.sp), modifier = Modifier.padding(top = 8.dp), maxLines = 4, overflow = TextOverflow.Ellipsis)
            Box(Modifier.padding(top = 8.dp)) { Dots(item.page.title.genres.take(4), 13) }
        }
    }
}

@Composable
private fun Stack(icon: androidx.compose.ui.graphics.vector.ImageVector, label: String, on: Boolean, onClick: () -> Unit) {
    Column(Modifier.width(60.dp).clickableScale(onClick), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(2.dp)) {
        I(icon, tint = if (on) Night.blush else Night.fg2)
        Text(label, style = ui(11, color = if (on) Night.blush else Night.fg2), maxLines = 1)
    }
}

/* ───── My list ───── */

@Composable
private fun ListPage(vm: ListViewModel, go: Go) {
    val state by vm.state.collectAsState()
    LazyVerticalGrid(GridCells.Adaptive(108.dp), Modifier.fillMaxSize(), contentPadding = PaddingValues(top = statusTop + 76.dp, bottom = navBottom + 100.dp, start = 16.dp, end = 16.dp),
        horizontalArrangement = Arrangement.spacedBy(10.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        item(span = { androidx.compose.foundation.lazy.grid.GridItemSpan(maxLineSpan) }) { Text("My list", style = display(28), modifier = Modifier.padding(top = 12.dp, bottom = 8.dp)) }
        when {
            state.loading -> items(6) { Skeleton(Modifier.fillMaxWidth().aspectRatio(2f / 3f)) }
            state.items.isEmpty() -> item(span = { androidx.compose.foundation.lazy.grid.GridItemSpan(maxLineSpan) }) { Text("Titles you add show up here.", style = ui(15, color = Night.fg3), modifier = Modifier.padding(vertical = 40.dp)) }
            else -> items(state.items, key = { it.id }) { PosterCard(it, go, width = Dp.Unspecified, modifier = Modifier.fillMaxWidth()) }
        }
    }
}

/** What's on this phone: each download with how far it's got and its size; a finished one plays, offline too. */
@Composable
private fun DownloadsPage(go: Go) {
    val downloads = LocalWatch.current.downloads
    val states by downloads.states.collectAsState()
    val entries = remember(states) { downloads.entries().sortedWith(compareBy({ it.name.substringBefore(" S") }, { it.season }, { it.episode })) }
    var used by remember { mutableStateOf(0L) }
    androidx.compose.runtime.LaunchedEffect(states) { used = runCatching { downloads.usedBytes() }.getOrDefault(0L) }
    androidx.compose.foundation.lazy.LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(top = statusTop + 76.dp, bottom = navBottom + 100.dp, start = 16.dp, end = 16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item {
            Column(Modifier.padding(top = 12.dp, bottom = 4.dp)) {
                Text("Downloads", style = display(28))
                if (entries.isNotEmpty()) Text(app.kimono.watch.bytesText(used) + " on this phone", style = ui(14, color = Night.fg3))
            }
        }
        if (entries.isEmpty()) item { Text("Episodes and films you download show up here.", style = ui(15, color = Night.fg3), modifier = Modifier.padding(vertical = 40.dp)) }
        items(entries, key = { app.kimono.watch.dlKey(it.titleId, it.season, it.episode) }) { e ->
            val d = states[app.kimono.watch.dlKey(e.titleId, e.season, e.episode)]
            val done = d?.done == true
            Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).clickableScale({ if (done) go.play(e.titleId, e.season.takeIf { it > 0 }, e.episode.takeIf { it > 0 }) }, outline = false),
                verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Box(Modifier.width(128.dp).aspectRatio(16f / 9f).clip(RoundedCornerShape(8.dp)).background(Night.surface2), contentAlignment = Alignment.Center) {
                    app.kimono.watch.ui.Img(e.art, Modifier.fillMaxSize())
                    if (done) Box(Modifier.size(32.dp).clip(CircleShape).background(Color(0x99110C0A)), contentAlignment = Alignment.Center) { I(Ic.play, 20.dp, Color.White) }
                }
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text(e.name, style = ui(15, FontWeight.Bold), maxLines = 2, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis)
                    val size = e.bytes?.takeIf { it > 0 }?.let { app.kimono.watch.bytesText(it) }
                    Text(when {
                        d?.failed == true -> "Didn't download"
                        done -> size ?: "Downloaded"
                        d != null && d.progress > 0f -> "${(d.progress * 100).toInt()}%" + (size?.let { " of about $it" } ?: "")
                        else -> "Waiting"
                    }, style = ui(13, color = if (d?.failed == true) Night.blush else Night.fg3))
                }
                Box(Modifier.size(40.dp), contentAlignment = Alignment.Center) {
                    when {
                        d != null && !done && !d.failed && d.progress <= 0f -> app.kimono.watch.ink.InkLoader(size = 26.dp)
                        d != null && !done && !d.failed -> app.kimono.watch.ink.InkRing({ d.progress }, size = 28.dp)
                    }
                }
                Box(Modifier.size(40.dp).clip(CircleShape).clickableScale({ downloads.remove(e.titleId, e.season, e.episode) }), contentAlignment = Alignment.Center) { I(Ic.close, 22.dp, Night.fg3) }
            }
        }
    }
}

/**
 * The avatar is about the person: switch profile, Settings, and their Kimono
 * account. (Quality lives in Settings and the player, not here.)
 */
@Composable
fun AvatarMenu(profile: Profile, onProfiles: () -> Unit, onSettings: () -> Unit, size: Dp = 32.dp) {
    var open by remember { mutableStateOf(false) }
    val watch = LocalWatch.current
    Box {
        Box(Modifier.clickableScale({ open = true })) { Face(profile, size, corner = 0.28f) }
        androidx.compose.material3.DropdownMenu(open, { open = false }, containerColor = Night.surface3, shape = RoundedCornerShape(12.dp), modifier = Modifier.widthIn(min = 220.dp)) {
            MenuRow("Switch profile") { open = false; onProfiles() }
            MenuRow("Settings") { open = false; onSettings() }
            MenuRow("Kimono account") { open = false; watch.openUrl(profile.server + "/account") }
        }
    }
}

@Composable
fun MenuRow(label: String, onClick: () -> Unit) {
    Text(label, style = ui(15, FontWeight.Medium), modifier = Modifier.fillMaxWidth().clickableScaleClipped(RoundedCornerShape(8.dp), onClick).padding(horizontal = 14.dp, vertical = 12.dp))
}

/**
 * "Sami is watching Frieren · Join": parties someone in the household asked
 * this person to, or is watching right now, asked of the server every 15 s
 * while Home is open (there's no push for it yet).
 */
@Composable
fun PartyInvites(go: Go, modifier: Modifier = Modifier) {
    val watch = LocalWatch.current
    val me = watch.accounts.active.collectAsState().value?.username.orEmpty()
    var parties by remember { mutableStateOf<List<app.kimono.watch.model.PartySummary>>(emptyList()) }
    var people by remember { mutableStateOf<List<app.kimono.watch.model.Person>>(emptyList()) }
    var dismissed by remember { mutableStateOf(setOf<String>()) }
    androidx.compose.runtime.LaunchedEffect(me) {
        while (true) {
            runCatching { watch.api.parties() }.onSuccess { a -> people = a.people; parties = a.parties.filter { p -> p.invited || p.watching.isNotEmpty() } }
            kotlinx.coroutines.delay(15_000)
        }
    }
    val shown = parties.filter { it.id !in dismissed }
    if (shown.isEmpty()) return
    Column(modifier, verticalArrangement = Arrangement.spacedBy(8.dp)) {
        shown.take(2).forEach { p ->
            val host = people.firstOrNull { it.username.equals(p.host, true) }
            Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(Night.surface2).padding(12.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                app.kimono.watch.player.PersonFace(host, p.host, 40.dp)
                Column(Modifier.weight(1f)) {
                    val mine = p.host.equals(me, true)
                    Text(if (mine) "You’re watching ${p.title?.name ?: "something"} on another screen" else "${p.hostName.ifBlank { p.host }} is watching ${p.title?.name ?: "something"}", style = ui(15, FontWeight.Bold), maxLines = 2, overflow = TextOverflow.Ellipsis)
                    if (p.season > 0) Text("${p.label ?: "S${p.season}:E${p.episode}"} · together", style = ui(13, color = Night.fg2))
                }
                PaperButton("Join", Ic.people, { go.join(p.id) }, height = 40.dp)
                Box(Modifier.size(36.dp).clickableScaleClipped(CircleShape, { dismissed = dismissed + p.id }), contentAlignment = Alignment.Center) { I(Ic.close, 18.dp, Night.fg2) }
            }
        }
    }
}

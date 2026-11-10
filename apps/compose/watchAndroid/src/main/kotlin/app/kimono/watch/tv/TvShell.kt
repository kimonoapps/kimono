package app.kimono.watch.tv

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.requiredWidth
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.tv.material3.Border
import androidx.tv.material3.ClickableSurfaceDefaults
import androidx.tv.material3.Surface
import androidx.tv.material3.Text
import app.kimono.watch.Entry
import app.kimono.watch.LocalWatch
import app.kimono.watch.TvShellSlot
import app.kimono.watch.phone.SettingsScreen
import app.kimono.watch.data.Profile
import app.kimono.watch.model.Card
import app.kimono.watch.model.Row as WatchRow
import app.kimono.watch.phone.ComingArticle
import app.kimono.watch.phone.Go
import app.kimono.watch.phone.RankLine
import app.kimono.watch.phone.SearchScreen
import app.kimono.watch.phone.TitleScreen
import app.kimono.watch.theme.Night
import app.kimono.watch.theme.display
import app.kimono.watch.theme.ui
import app.kimono.watch.ui.Boxed
import app.kimono.watch.ui.Brand
import app.kimono.watch.ui.Face
import app.kimono.watch.ui.HomeViewModel
import app.kimono.watch.ui.HotViewModel
import app.kimono.watch.ui.I
import app.kimono.watch.ui.Ic
import app.kimono.watch.ui.Img
import app.kimono.watch.ui.ListViewModel
import app.kimono.watch.ui.Logo
import app.kimono.watch.ui.PreviewVideo
import app.kimono.watch.ui.ProgressLine
import app.kimono.watch.ui.Ribbon
import app.kimono.watch.ui.Screen
import app.kimono.watch.ui.SearchViewModel
import app.kimono.watch.ui.Skeleton
import app.kimono.watch.ui.TitleViewModel
import app.kimono.watch.ui.Top10

private val gutter = 48.dp

/**
 * Watch on a TV: the demo's wide layout (top nav, a full-bleed hero that
 * turns into a muted preview, rows of 16:9 cards) with D-pad focus on
 * androidx.tv surfaces: a focused card grows and takes the blush outline.
 */
object AndroidTvShell : TvShellSlot {
    @Composable
    override fun Show(profile: Profile, home: HomeViewModel, hot: HotViewModel, list: ListViewModel, top: Entry?, go: Go, onSearch: () -> Unit, onProfiles: () -> Unit, onSettings: () -> Unit, onBack: () -> Unit) =
        TvShell(profile, home, hot, list, top, go, onSearch, onProfiles, onSettings, onBack)
}

@Composable
fun TvShell(profile: Profile, home: HomeViewModel, hot: HotViewModel, list: ListViewModel, top: Entry?, go: Go, onSearch: () -> Unit, onProfiles: () -> Unit, onSettings: () -> Unit, onBack: () -> Unit) {
    val app = LocalWatch.current
    var page by rememberSaveable { mutableStateOf("home") }
    Box(Modifier.fillMaxSize().background(Night.bg)) {
        Box(Modifier.fillMaxSize().graphicsLayer { alpha = if (top == null) 1f else 0f }) {
            when (page) {
                "home" -> TvHome(profile, home, go, active = top == null) { Nav(page, { page = it; if (it == "list") list.refresh() }, profile, onSearch, onProfiles, onSettings) }
                "hot" -> TvHot(hot, go) { Nav(page, { page = it }, profile, onSearch, onProfiles, onSettings) }
                else -> TvList(list, go) { Nav(page, { page = it; list.refresh() }, profile, onSearch, onProfiles, onSettings) }
            }
        }
        AnimatedContent(top, transitionSpec = { fadeIn(tween(250)) togetherWith fadeOut(tween(200)) }, label = "tvstack") { entry ->
            when (val s = entry?.screen) {
                is Screen.Title -> TitleScreen(entry.vm { TitleViewModel(app.api, app.toasts, s.id) }, go, s.top, onClose = onBack, downloads = app.downloads, wide = true)
                Screen.Search -> SearchScreen(entry.vm { SearchViewModel(app.api) }, go, onClose = onBack, tv = true)
                Screen.Settings -> SettingsScreen(onClose = onBack, onProfiles = onProfiles, tv = true)
                null -> Box(Modifier) {}
            }
        }
    }
}

@Composable
private fun Nav(page: String, onPage: (String) -> Unit, profile: Profile, onSearch: () -> Unit, onProfiles: () -> Unit, onSettings: () -> Unit) {
    Row(Modifier.fillMaxWidth().padding(start = gutter, end = gutter, top = 20.dp, bottom = 12.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(20.dp)) {
        Brand()
        Spacer(Modifier.width(8.dp))
        listOf("home" to "Home", "hot" to "New & hot", "list" to "My list").forEach { (id, label) ->
            Pill(onClick = { onPage(id) }) { Text(label, style = ui(15, if (page == id) FontWeight.Bold else FontWeight.Normal, if (page == id) Night.fg else Night.fg2), modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp)) }
        }
        Spacer(Modifier.weight(1f))
        Pill(onClick = onSearch, shape = CircleShape) { Box(Modifier.size(40.dp), contentAlignment = Alignment.Center) { I(Ic.search) } }
        Pill(onClick = onSettings, shape = CircleShape) { Box(Modifier.size(40.dp), contentAlignment = Alignment.Center) { I(Ic.gear) } }
        Pill(onClick = onProfiles, shape = RoundedCornerShape(9.dp)) { Face(profile, 32.dp) }
    }
}

/** A focusable surface with the TV focus look: grows a little, blush outline, no fill change. */
@Composable
fun Pill(onClick: () -> Unit, modifier: Modifier = Modifier, shape: androidx.compose.ui.graphics.Shape = RoundedCornerShape(8.dp), scale: Float = 1.06f, content: @Composable () -> Unit) {
    Surface(onClick = onClick, modifier = modifier,
        shape = ClickableSurfaceDefaults.shape(shape),
        colors = ClickableSurfaceDefaults.colors(containerColor = Color.Transparent, focusedContainerColor = Color(0x14FFFFFF), pressedContainerColor = Color(0x1FFFFFFF)),
        scale = ClickableSurfaceDefaults.scale(focusedScale = scale),
        border = ClickableSurfaceDefaults.border(focusedBorder = Border(BorderStroke(2.dp, Night.blush), inset = 0.dp, shape = shape))) { content() }
}

/* ───── Home ───── */

@Composable
private fun TvHome(profile: Profile, vm: HomeViewModel, go: Go, active: Boolean, nav: @Composable () -> Unit) {
    val state by vm.state.collectAsState()
    val home = state.home
    val list = rememberLazyListState()
    val playFocus = remember { FocusRequester() }
    val top by remember(list) { androidx.compose.runtime.derivedStateOf { list.firstVisibleItemIndex == 0 } }
    LazyColumn(Modifier.fillMaxSize(), state = list, contentPadding = PaddingValues(bottom = 64.dp)) {
        item("hero", contentType = "hero") { TvHero(home?.featured, home?.rows.orEmpty(), go, active && top, playFocus, nav, state.shelf) { vm.shelf(it) } }
        item("party") { app.kimono.watch.phone.PartyInvites(go, Modifier.padding(start = gutter, end = gutter, bottom = 24.dp).widthIn(max = 760.dp)) }
        if (home == null) items(3) { TvSkeletonRow() }
        else items(home.rows, key = { it.id + state.shelf }, contentType = { it.kind }) { row -> TvRail(row, profile, go) }
    }
    LaunchedEffect(home != null) { if (home != null) { runCatching { playFocus.requestFocus() }; kotlinx.coroutines.delay(100); list.scrollToItem(0) } }
}

@Composable
private fun TvSkeletonRow() {
    Column(Modifier.padding(bottom = 32.dp)) {
        Skeleton(Modifier.padding(start = gutter, bottom = 12.dp).size(220.dp, 20.dp), RoundedCornerShape(6.dp))
        Row(Modifier.padding(start = gutter), horizontalArrangement = Arrangement.spacedBy(12.dp)) { repeat(5) { Skeleton(Modifier.width(196.dp).aspectRatio(16f / 9f)) } }
    }
}

@Composable
private fun TvHero(featured: Card?, rows: List<WatchRow>, go: Go, active: Boolean, playFocus: FocusRequester, nav: @Composable () -> Unit, shelf: String?, onShelf: (String) -> Unit) {
    var playing by remember(featured?.id) { mutableStateOf(false) }
    val logoScale by animateFloatAsState(if (playing && active) 0.72f else 1f, tween(1200), label = "logo")
    val tagline by animateFloatAsState(if (playing && active) 0f else 1f, tween(800), label = "tag")
    val rank = featured?.let { f -> rows.firstOrNull { it.id == "top" }?.items?.firstOrNull { it.id == f.id }?.top }
    val resuming = featured?.let { f -> rows.firstOrNull { it.id == "continue" }?.items?.any { it.id == f.id } } == true
    BoxWithConstraints(Modifier.fillMaxWidth().height(440.dp)) {
        if (featured != null) {
            Img(featured.backdropLarge ?: featured.backdrop, Modifier.fillMaxSize())
            PreviewVideo(featured.id, if (featured.isFilm) 0 else 1, if (featured.isFilm) 0 else 1, true, active, { playing = it }, Modifier.requiredWidth(maxOf(maxWidth, maxHeight * 16f / 9f)).fillMaxHeight().align(Alignment.Center))
        }
        Box(Modifier.fillMaxSize().background(Brush.verticalGradient(0f to Color(0x8C110C0A), 0.22f to Color.Transparent, 0.45f to Color.Transparent, 0.82f to Color(0xD9110C0A), 1f to Night.bg)))
        Box(Modifier.fillMaxSize().background(Brush.horizontalGradient(0f to Color(0xB3110C0A), 0.55f to Color.Transparent)))
        Column {
            nav()
            Row(Modifier.padding(start = gutter), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                listOf("Series" to "Series", "Film" to "Films", "Anime" to "Anime").forEach { (kind, label) ->
                    val on = shelf == kind
                    Pill(onClick = { onShelf(kind) }, shape = RoundedCornerShape(999.dp)) {
                        Text(label, style = ui(14, color = if (on) Night.ink else Night.fg), modifier = Modifier.background(if (on) Night.paper else Color(0x40110C0A), RoundedCornerShape(999.dp)).padding(horizontal = 14.dp, vertical = 6.dp))
                    }
                }
            }
        }
        if (featured == null) return@BoxWithConstraints
        Column(Modifier.align(Alignment.BottomStart).padding(start = gutter, bottom = 48.dp).widthIn(max = 560.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            Logo(featured.name, featured.logo, 64, Modifier.graphicsLayer { scaleX = logoScale; scaleY = logoScale; transformOrigin = androidx.compose.ui.graphics.TransformOrigin(0f, 1f) }, maxHeight = 120.dp)
            if (rank != null) RankLine(rank, featured.shelf)
            featured.overview?.takeIf { it.isNotBlank() }?.let {
                Text(it, style = ui(15, color = Night.fg2).copy(lineHeight = 23.sp), maxLines = 3, overflow = TextOverflow.Ellipsis, modifier = Modifier.graphicsLayer { alpha = tagline })
            }
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                TvButton(if (resuming) "Resume" else "Play", Ic.play, { go.play(featured.id, null, null) }, Modifier.focusRequester(playFocus))
                TvButton("More info", Ic.info, { go.open(featured) }, tonal = true)
            }
        }
        if (featured.age.isNotBlank()) Text(featured.age, style = ui(14), modifier = Modifier.align(Alignment.BottomEnd).padding(bottom = 56.dp)
            .background(Color(0x73110C0A)).padding(start = 10.dp, end = 28.dp, top = 6.dp, bottom = 6.dp))
    }
}

@Composable
fun TvButton(text: String, icon: androidx.compose.ui.graphics.vector.ImageVector?, onClick: () -> Unit, modifier: Modifier = Modifier, tonal: Boolean = false) {
    val shape = RoundedCornerShape(8.dp)
    Surface(onClick = onClick, modifier = modifier.height(44.dp), shape = ClickableSurfaceDefaults.shape(shape),
        colors = ClickableSurfaceDefaults.colors(containerColor = if (tonal) Color(0x52A08C88) else Night.paper, focusedContainerColor = if (tonal) Color(0x73A08C88) else Color.White,
            contentColor = if (tonal) Night.fg else Night.ink, focusedContentColor = if (tonal) Night.fg else Night.ink),
        scale = ClickableSurfaceDefaults.scale(focusedScale = 1.05f),
        border = ClickableSurfaceDefaults.border(focusedBorder = Border(BorderStroke(2.dp, Night.blush), inset = 2.dp, shape = shape))) {
        Row(Modifier.fillMaxHeight().padding(start = 16.dp, end = 22.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            if (icon != null) I(icon, tint = if (tonal) Night.fg else Night.ink)
            Text(text, style = ui(16, FontWeight.Bold, if (tonal) Night.fg else Night.ink))
        }
    }
}

@Composable
private fun TvRail(row: WatchRow, profile: Profile, go: Go) {
    Column(Modifier.padding(bottom = 28.dp)) {
        Text(if (row.id == "continue") "Continue watching" else row.title, style = ui(19, FontWeight.Bold), modifier = Modifier.padding(start = gutter, bottom = 10.dp))
        LazyRow(contentPadding = PaddingValues(horizontal = gutter, vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            when (row.kind) {
                "continue" -> items(row.items, key = { it.id }, contentType = { "continue" }) { TvContinue(it, go) }
                "top" -> itemsIndexed(row.items, key = { _, c -> c.id }, contentType = { _, _ -> "top" }) { i, c -> TvTopTen(i + 1, c, go) }
                else -> items(row.items, key = { it.id }, contentType = { "card" }) { TvCard(it, go) }
            }
        }
    }
}

/** A 16:9 card: the backdrop, the name in Mincho, the ribbon and Top 10 seal. */
@Composable
fun TvCard(card: Card, go: Go, width: Dp = 196.dp, modifier: Modifier = Modifier) {
    val shape = RoundedCornerShape(8.dp)
    Surface(onClick = { go.open(card) }, modifier = modifier.width(width).aspectRatio(16f / 9f), shape = ClickableSurfaceDefaults.shape(shape),
        colors = ClickableSurfaceDefaults.colors(containerColor = Night.surface2, focusedContainerColor = Night.surface2),
        scale = ClickableSurfaceDefaults.scale(focusedScale = 1.1f),
        border = ClickableSurfaceDefaults.border(focusedBorder = Border(BorderStroke(2.dp, Night.blush), inset = 0.dp, shape = shape))) {
        Img(card.backdrop ?: card.poster, Modifier.fillMaxSize())
        Box(Modifier.fillMaxSize().background(Brush.verticalGradient(0.55f to Color.Transparent, 1f to Color(0x99000000))))
        Text(card.name, style = display(17).copy(shadow = androidx.compose.ui.graphics.Shadow(Color(0xCC000000), blurRadius = 10f)), maxLines = 2, overflow = TextOverflow.Ellipsis,
            modifier = Modifier.align(Alignment.BottomStart).padding(horizontal = 10.dp, vertical = 8.dp))
        card.badge?.let { Ribbon(it, Modifier.align(Alignment.TopCenter)) }
        if (card.top != null) Top10(22.dp, Modifier.align(Alignment.TopEnd).padding(6.dp))
    }
}

@Composable
private fun TvContinue(card: Card, go: Go) {
    val shape = RoundedCornerShape(8.dp)
    Surface(onClick = { go.play(card.id, card.season?.takeIf { it > 0 }, card.episode?.takeIf { it > 0 }) }, onLongClick = { go.open(card) }, modifier = Modifier.width(228.dp),
        shape = ClickableSurfaceDefaults.shape(shape), colors = ClickableSurfaceDefaults.colors(containerColor = Night.surface, focusedContainerColor = Night.surface2),
        scale = ClickableSurfaceDefaults.scale(focusedScale = 1.08f),
        border = ClickableSurfaceDefaults.border(focusedBorder = Border(BorderStroke(2.dp, Night.blush), inset = 0.dp, shape = shape))) {
        Column {
            Box(Modifier.fillMaxWidth().aspectRatio(16f / 9f), contentAlignment = Alignment.Center) {
                Img(card.backdrop ?: card.poster, Modifier.fillMaxSize())
                Box(Modifier.size(48.dp).background(Color(0x73110C0A), CircleShape), contentAlignment = Alignment.Center) { I(Ic.play) }
            }
            ProgressLine(((card.fraction ?: 0.0).coerceAtLeast(0.04)).toFloat(), Modifier.fillMaxWidth())
            Column(Modifier.padding(horizontal = 12.dp, vertical = 8.dp)) {
                Text(card.name, style = ui(14, FontWeight.Bold), maxLines = 1, overflow = TextOverflow.Ellipsis)
                val label = if (card.isFilm || (card.season ?: 0) == 0) "Film" else card.label ?: "S${card.season}:E${card.episode}"
                Text("$label · ${card.left ?: 0}m left", style = ui(13, color = Night.fg2))
            }
        }
    }
}

@Composable
private fun TvTopTen(n: Int, card: Card, go: Go) {
    Row(verticalAlignment = Alignment.Bottom) {
        Box(Modifier.offset(x = 30.dp)) {
            val style = display(150).copy(lineHeight = 108.sp, letterSpacing = (-11).sp)
            Text("$n", style = style.copy(color = Night.bg))
            Text("$n", style = style.copy(color = Night.fg3, drawStyle = Stroke(width = 6f)))
        }
        val shape = RoundedCornerShape(8.dp)
        Surface(onClick = { go.open(card) }, modifier = Modifier.width(112.dp).aspectRatio(2f / 3f), shape = ClickableSurfaceDefaults.shape(shape),
            colors = ClickableSurfaceDefaults.colors(containerColor = Night.surface2, focusedContainerColor = Night.surface2), scale = ClickableSurfaceDefaults.scale(focusedScale = 1.1f),
            border = ClickableSurfaceDefaults.border(focusedBorder = Border(BorderStroke(2.dp, Night.blush), inset = 0.dp, shape = shape))) {
            Img(card.poster ?: card.backdrop, Modifier.fillMaxSize())
        }
    }
}

/* ───── New & hot, My list ───── */

@Composable
private fun TvHot(vm: HotViewModel, go: Go, nav: @Composable () -> Unit) {
    val state by vm.state.collectAsState()
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 64.dp), verticalArrangement = Arrangement.spacedBy(34.dp)) {
        item { nav() }
        item { Text("Coming soon", style = display(34), modifier = Modifier.padding(horizontal = gutter)) }
        when {
            state.loading -> items(2) { Skeleton(Modifier.padding(horizontal = gutter).widthIn(max = 900.dp).fillMaxWidth().aspectRatio(16f / 9f)) }
            state.items.isEmpty() -> item { Text(state.problem ?: "Nothing new is on its way for your shows yet.", style = ui(15, color = Night.fg3), modifier = Modifier.padding(horizontal = gutter)) }
            else -> items(state.items, key = { it.card.id }) { item ->
                Box(Modifier.padding(horizontal = gutter).widthIn(max = 900.dp)) { ComingArticle(item, go, onRemind = { vm.remind(item) }, wide = true) }
            }
        }
    }
}

@Composable
private fun TvList(vm: ListViewModel, go: Go, nav: @Composable () -> Unit) {
    val state by vm.state.collectAsState()
    Column(Modifier.fillMaxSize()) {
        nav()
        Text("My list", style = display(34), modifier = Modifier.padding(horizontal = gutter, vertical = 12.dp))
        when {
            state.loading -> Row(Modifier.padding(horizontal = gutter), horizontalArrangement = Arrangement.spacedBy(12.dp)) { repeat(4) { Skeleton(Modifier.width(196.dp).aspectRatio(16f / 9f)) } }
            state.items.isEmpty() -> Text("Titles you add show up here.", style = ui(15, color = Night.fg3), modifier = Modifier.padding(horizontal = gutter, vertical = 40.dp))
            else -> LazyVerticalGrid(GridCells.Adaptive(196.dp), contentPadding = PaddingValues(horizontal = gutter, vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(12.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                items(state.items.size) { i -> TvCard(state.items[i], go, width = Dp.Unspecified, modifier = Modifier.fillMaxWidth()) }
            }
        }
    }
}

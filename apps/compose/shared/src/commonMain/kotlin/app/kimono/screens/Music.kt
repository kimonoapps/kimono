@file:OptIn(ExperimentalMaterial3Api::class, ExperimentalMaterial3ExpressiveApi::class)

package app.kimono.screens

import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.ContentScale
import coil3.compose.AsyncImage
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.coerceAtMost
import androidx.compose.ui.unit.dp
import app.kimono.data.FriendListening
import app.kimono.data.FriendParty
import app.kimono.data.Music
import app.kimono.data.MusicHome
import app.kimono.data.MusicMe
import app.kimono.data.QueueSource
import app.kimono.data.SearchResults
import app.kimono.data.Track
import app.kimono.music.MusicPlayer
import app.kimono.music.megabytes
import app.kimono.ui.IconButton
import app.kimono.ui.KimonoTopBar
import app.kimono.ui.Portrait
import app.kimono.ui.Surface
import app.kimono.ui.clickable
import app.kimono.ui.kimonoIcon
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/** Music's header: its name, the room you're in beside it, search at the right. */
@Composable
private fun MusicHead(title: String, openSearch: (() -> Unit)?) {
    Row(Modifier.fillMaxWidth().statusBarsPadding().padding(start = 20.dp, end = 8.dp, top = 12.dp, bottom = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(title, style = MaterialTheme.typography.displaySmall, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
        if (openSearch != null) IconButton(onClick = openSearch) { Icon(kimonoIcon("search"), "Search") }
    }
}

private fun greeting(hour: Int) = when (hour) { in 5..11 -> "Good morning"; in 12..17 -> "Good afternoon"; in 18..22 -> "Good evening"; else -> "Up late" }

/* ── Home ───────────────────────────────────────────────────────────────── */

@Composable
fun MusicHomeScreen(player: MusicPlayer, me: app.kimono.data.AccountProfile?, go: MusicGo, openSearch: () -> Unit) {
    val firstName = me?.name?.substringBefore(' ')?.takeIf { it.isNotBlank() }
    val music = player.music
    var home by remember { mutableStateOf(music.known<MusicHome>("home")) }
    var friends by remember { mutableStateOf<List<FriendListening>>(emptyList()) }
    var parties by remember { mutableStateOf<List<FriendParty>>(emptyList()) }
    var sent by remember { mutableStateOf<List<app.kimono.data.Recommendation>>(emptyList()) }
    var problem by remember { mutableStateOf<String?>(null) }
    var tries by remember { mutableIntStateOf(0) }
    LaunchedEffect(tries) {
        runCatching { music.home() }
            .onSuccess { home = it; problem = null; player.connected(true) }
            .onFailure { if (it.message == app.kimono.data.OFFLINE) player.connected(false); if (home == null) problem = it.message ?: "Music couldn't load." }
    }
    /* Offline: look again now and then, and say so once it's back. */
    if (player.offline) WhileShown(Unit) { while (true) { delay(15_000); runCatching { music.home() }.onSuccess { home = it; problem = null; player.connected(true) } ; if (!player.offline) break } }
    WhileShown(Unit) { while (true) { runCatching { music.friends() }.onSuccess { friends = it }; runCatching { music.parties() }.onSuccess { parties = it }; delay(30_000) } }
    LaunchedEffect(Unit) { runCatching { music.sent() }.onSuccess { sent = it } }
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 24.dp)) {
        item { MusicHead("Music", openSearch) }
        item {
            Text("${greeting(player.localHour())}${firstName?.let { ", $it" } ?: ""}", style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(horizontal = 20.dp))
        }
        /* The turntable: what's on, or what was, ready to carry on. */
        val lead = player.current ?: home?.jumpBack?.firstOrNull()
        if (lead != null) item { Deck(player, lead, onOpen = { if (player.current != null) player.nowPlayingOpen = true else player.play(listOf(lead) + home?.jumpBack.orEmpty().drop(1), 0, QueueSource("history", "recent", "Played lately")) }) }
        /* Parties someone asked you to: a line to join each. */
        parties.filter { it.invited && it.id != player.party?.id }.forEach { x -> item(key = "invite" + x.id) { PartyInvite(x) { go(MusicRoutes.party(x.id)) } } }
        if (friends.isNotEmpty()) item {
            Shelf("Friends listening") {
                items(friends, key = { it.username }) { f -> FriendRecord(player, f, go) }
            }
        }
        /* No connection: what's downloaded comes first, ready to play. */
        if (player.offline) item(key = "offline") { OfflineDeck(player, go) { tries++ } }
        val h = home
        if (h == null) item { if (player.offline) Unit else if (problem != null) MusicProblem(problem!!) { tries++ } else MusicLoading() }
        else {
            /* Yours first: the songs you play most, then your playlists and artists. */
            val personal = h.listenAgain.size >= 6
            if (personal) item(key = "again") { ListenAgain(player, h.listenAgain.filter { player.ratingOf("track", it.key) != "down" }, me, firstName) }
            else if (h.jumpBack.size > 1) item {
                Shelf("Jump back in") { items(h.jumpBack.take(12), key = { "jb" + it.key }) { t -> SleeveTile(t.title, t.byline, t.cover, player.current?.key == t.key && player.playing) { player.play(h.jumpBack, h.jumpBack.indexOf(t), QueueSource("history", "recent", "Played lately")) } } }
            }
            if (h.playlists.isNotEmpty()) item {
                Shelf("Your playlists", more = { go("music/you") }) { items(h.playlists, key = { it.id }) { PlaylistTile(player, it, go) } }
            }
            if (h.yourArtists.isNotEmpty()) item { Shelf("Your artists") { items(h.yourArtists, key = { "ya" + it.key }) { ArtistTile(it, go) } } }
            /* Sent by friends, with their notes. */
            if (sent.isNotEmpty()) item { Shelf("Sent to you") { items(sent, key = { "sent" + it.id }) { r -> SentTile(r) { go(MusicRoutes.song(r.itemId)) } } } }
            /* With a history: your mixes, artists like yours, then the chart. Someone new starts from the chart beside a mix or two, then popular artists. */
            val mixes = {
                if (h.mixes.isNotEmpty()) item {
                    Shelf("Made for you") {
                        items(h.mixes, key = { it.id }) { m ->
                            SleeveTile(m.title, "${m.items.size} songs", m.items.firstOrNull()?.cover, player.source?.id == m.id && player.playing, covers = m.items.mapNotNull { it.cover }.distinct().take(4)) {
                                go(MusicRoutes.mix(m.id))
                            }
                        }
                    }
                }
            }
            val artists = {
                if (h.artists.isNotEmpty()) item { Shelf(if (personal || h.greeting == "back") "Artists for you" else "Popular artists") { items(h.artists, key = { it.key }) { ArtistTile(it, go) } } }
            }
            val chart = {
                h.charts?.takeIf { it.items.isNotEmpty() }?.let { chart -> item {
                    Column(Modifier.padding(top = 24.dp)) {
                        Row(Modifier.fillMaxWidth().padding(start = 20.dp, end = 8.dp, top = 6.dp, bottom = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                            Text(if (personal) "Popular right now" else chart.title, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
                            TextButtonSmall("See all") { go(MusicRoutes.mix("chart")) }
                        }
                        chart.items.take(5).forEachIndexed { i, t -> SongRow(player, t, { player.play(chart.items, i, QueueSource("chart", "chart", chart.title)) }, go, number = i + 1) }
                    }
                } }
            }
            if (personal) { mixes(); artists(); chart() } else { mixes(); chart(); artists() }
            if (h.albums.isNotEmpty()) item { Shelf("Popular albums") { items(h.albums, key = { it.key }) { AlbumTile(player, it, go) } } }
            if (h.genres.isNotEmpty()) item { Genres(h.genres) { go(MusicRoutes.genre(it)) } }
        }
    }
}

/** A friend asked you to listen together: who's in, what's on, and Join. */
@Composable
private fun PartyInvite(x: FriendParty, onJoin: () -> Unit) {
    val people = listOf(x.host) + x.members.filter { it.username != x.host.username }
    Row(
        Modifier.padding(start = 16.dp, end = 16.dp, top = 16.dp).fillMaxWidth().clip(RoundedCornerShape(14.dp))
            .background(MaterialTheme.colorScheme.primaryContainer).clickable(onClick = onJoin).padding(horizontal = 14.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.width((32 + 18 * (people.take(3).size - 1)).dp)) {
            people.take(3).forEachIndexed { i, m -> Portrait(m.picture, m.name, m.username, 32.dp, Modifier.offset(x = (18 * i).dp)) }
        }
        Column(Modifier.weight(1f).padding(horizontal = 12.dp)) {
            Text("${x.host.name.substringBefore(' ').ifBlank { x.host.username }} asked you to listen together", style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.onPrimaryContainer, maxLines = 2, overflow = TextOverflow.Ellipsis)
            x.song?.let { Text("${it.title} · ${it.byline}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onPrimaryContainer.copy(alpha = .75f), maxLines = 1, overflow = TextOverflow.Ellipsis) }
        }
        app.kimono.ui.Seal("Join", onJoin, compact = true, icon = "play")
    }
}

/** A song a friend sent: its cover with their face on the corner, and their note. */
@Composable
private fun SentTile(r: app.kimono.data.Recommendation, onClick: () -> Unit) {
    Column(Modifier.width(148.dp).clickable(onClick = onClick)) {
        Box(Modifier.size(148.dp)) {
            Cover(r.cover, 136.dp, Modifier.align(Alignment.TopStart))
            Portrait(r.from.picture, r.from.name, r.from.username, 34.dp, Modifier.align(Alignment.BottomEnd))
        }
        Text(r.title, style = MaterialTheme.typography.titleSmall, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 4.dp))
        Text("from ${r.from.name.substringBefore(' ').ifBlank { r.from.username }}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
        r.note?.takeIf { it.isNotBlank() }?.let { Text("“$it”", style = MaterialTheme.typography.bodySmall, fontStyle = androidx.compose.ui.text.font.FontStyle.Italic, maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 2.dp)) }
    }
}

/** Genres, two across: each a flat card with its name and its picture tipped into the corner. */
@Composable
private fun Genres(genres: List<app.kimono.data.Genre>, open: (Int) -> Unit) {
    Column(Modifier.padding(top = 24.dp)) {
        Text("Genres", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(horizontal = 20.dp, vertical = 6.dp))
        Column(Modifier.padding(horizontal = 16.dp, vertical = 6.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            genres.chunked(2).forEach { row ->
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    row.forEachIndexed { n, g ->
                        Box(Modifier.weight(1f).height(76.dp).clip(RoundedCornerShape(12.dp)).background(MaterialTheme.colorScheme.secondaryContainer).clickable { open(g.id) }) {
                            if (g.picture != null) AsyncImage(model = g.picture, contentDescription = null, contentScale = ContentScale.Crop,
                                modifier = Modifier.align(Alignment.BottomEnd).offset(x = 14.dp, y = 10.dp).size(64.dp).graphicsLayer { rotationZ = if (n == 0) 18f else -14f; shape = RoundedCornerShape(6.dp); clip = true })
                            Text(g.name, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold, color = MaterialTheme.colorScheme.onSecondaryContainer, maxLines = 2,
                                modifier = Modifier.padding(start = 14.dp, top = 12.dp, end = 56.dp))
                        }
                    }
                    if (row.size == 1) Spacer(Modifier.weight(1f))
                }
            }
        }
    }
}

/**
 * Listen again: the songs you play most, nine to a page (three by three),
 * swiped sideways for the next nine. Your top three carry a seal with their place.
 */
@Composable
private fun ListenAgain(player: MusicPlayer, tracks: List<Track>, me: app.kimono.data.AccountProfile?, firstName: String?) {
    val pages = remember(tracks) { tracks.chunked(9) }
    val pager = rememberPagerState { pages.size }
    val source = QueueSource("history", "most", "Listen again")
    Column(Modifier.padding(top = 24.dp)) {
        Row(Modifier.padding(horizontal = 20.dp), verticalAlignment = Alignment.CenterVertically) {
            Portrait(me?.picture, me?.name, me?.username, 36.dp)
            Spacer(Modifier.width(12.dp))
            Column {
                if (firstName != null) Text(firstName, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Text("Listen again", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold)
            }
        }
        /*
         * A page is the screen less its margins on a phone, as before; on an iPad it stops at about
         * a phone's width and the next pages show beside it, rather than nine tiles each a third of a tablet wide.
         */
        androidx.compose.foundation.layout.BoxWithConstraints(Modifier.padding(top = 12.dp)) {
        val page = (maxWidth - 56.dp).coerceAtMost(420.dp)
        HorizontalPager(pager, contentPadding = PaddingValues(start = 16.dp, end = 40.dp), pageSize = androidx.compose.foundation.pager.PageSize.Fixed(page), pageSpacing = 12.dp, verticalAlignment = Alignment.Top) { n ->
            Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
                pages[n].chunked(3).forEach { row ->
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        row.forEach { t ->
                            val i = tracks.indexOf(t)
                            AgainTile(t, i, player.current?.key == t.key, player.playing, Modifier.weight(1f)) {
                                if (player.current?.key == t.key) player.toggle() else player.play(tracks, i, source)
                            }
                        }
                        repeat(3 - row.size) { Spacer(Modifier.weight(1f)) }
                    }
                }
            }
        }
        }
        if (pages.size > 1) Row(Modifier.fillMaxWidth().padding(top = 10.dp), horizontalArrangement = Arrangement.Center) {
            repeat(pages.size) { n ->
                val on = pager.currentPage == n
                val w by animateDpAsState(if (on) 18.dp else 6.dp, label = "dot")
                Box(Modifier.padding(horizontal = 3.dp).size(w, 6.dp).clip(CircleShape).background(if (on) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outlineVariant))
            }
        }
    }
}

@Composable
private fun AgainTile(t: Track, place: Int, now: Boolean, playing: Boolean, modifier: Modifier, onClick: () -> Unit) {
    val press by animateFloatAsState(if (now) 1f else 0f, spring(dampingRatio = .6f, stiffness = 300f), label = "now")
    Column(modifier.clickable(onClick = onClick)) {
        Box(Modifier.fillMaxWidth().aspectRatio(1f)) {
            Box(Modifier.fillMaxSize().graphicsLayer { val s = 1f - press * .04f; scaleX = s; scaleY = s }.clip(RoundedCornerShape(12.dp)).background(MaterialTheme.colorScheme.secondaryContainer)) {
                if (t.cover != null) AsyncImage(model = t.cover, contentDescription = null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
                if (now) Box(Modifier.fillMaxSize().background(Color.Black.copy(alpha = .35f)), contentAlignment = Alignment.Center) { Bars(Color.White, playing) }
            }
            if (place < 3) Box(
                Modifier.padding(6.dp).size(24.dp).graphicsLayer { rotationZ = listOf(-6f, 4f, -2f)[place] }
                    .clip(RoundedCornerShape(5.dp)).background(MaterialTheme.colorScheme.primary),
                contentAlignment = Alignment.Center,
            ) { Text("${place + 1}", style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onPrimary) }
        }
        Text(t.title, style = MaterialTheme.typography.titleSmall, maxLines = 1, overflow = TextOverflow.Ellipsis, color = if (now) MaterialTheme.colorScheme.primary else Color.Unspecified, modifier = Modifier.padding(top = 6.dp))
        Text(t.byline, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

/**
 * The deck on Home: the record on its platter under a tone arm that swings in
 * while it plays and lifts away when it stops.
 */
@Composable
private fun Deck(player: MusicPlayer, track: Track, onOpen: () -> Unit) {
    val live = player.current?.key == track.key
    val spinning = live && player.playing
    Surface(onClick = onOpen, shape = RoundedCornerShape(28.dp), color = MaterialTheme.colorScheme.surfaceContainer, modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 16.dp)) {
        Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(16.dp)) {
            Sleeve(track.cover, spinning, 112.dp)
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(if (spinning) "Now playing" else if (live) "Paused" else "Pick up where you left off", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.primary)
                Text(track.title, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold, maxLines = 2, overflow = TextOverflow.Ellipsis)
                Text(track.byline, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Row(Modifier.padding(top = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                    FilledIconButtonBig(if (spinning) "pause" else "play", "Play", 48.dp) { if (live) player.toggle() else onOpen() }
                }
            }
        }
    }
}

/** A tone arm on its base at the top right: [down] 0 is resting off the record, 1 on it. */
@Composable
fun ToneArm(down: Float, modifier: Modifier = Modifier) {
    val metal = MaterialTheme.colorScheme.outline
    val head = MaterialTheme.colorScheme.primary
    Canvas(modifier) {
        val pivot = Offset(size.width * .92f, size.height * .1f)
        val angle = 100f + 26f * down
        val len = size.width * .74f
        drawCircle(metal, size.width * .07f, pivot)
        drawCircle(Color.Black.copy(alpha = .25f), size.width * .03f, pivot)
        val end = around(pivot, len, angle)
        drawLine(metal, pivot, end, strokeWidth = size.width * .03f, cap = StrokeCap.Round)
        val tip = around(end, size.width * .08f, angle + 35f)
        drawLine(head, end, tip, strokeWidth = size.width * .06f, cap = StrokeCap.Round)
    }
}

/** A friend's record: their portrait on the label of what they're on. */
@Composable
private fun FriendRecord(player: MusicPlayer, f: FriendListening, go: MusicGo) {
    Column(Modifier.width(112.dp).clickable { player.play(listOf(f.track), 0, QueueSource("friend", f.username, f.name)) }, horizontalAlignment = Alignment.CenterHorizontally) {
        Box(Modifier.size(104.dp)) {
            Vinyl(f.track.cover, spinning = f.live, size = 104.dp)
            Portrait(f.picture, f.name, f.username, 34.dp, Modifier.align(Alignment.BottomEnd))
            if (f.live) Box(Modifier.align(Alignment.TopEnd).size(12.dp).clip(CircleShape).background(app.kimono.theme.Kata.moss))
        }
        Text(f.name.substringBefore(' ').ifBlank { f.username }, style = MaterialTheme.typography.labelLarge, modifier = Modifier.padding(top = 6.dp), maxLines = 1)
        Text(f.track.title, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

/* ── Search ─────────────────────────────────────────────────────────────── */

@Composable
fun MusicSearchScreen(player: MusicPlayer, go: MusicGo, back: () -> Unit) {
    var text by remember { mutableStateOf("") }
    var found by remember { mutableStateOf<SearchResults?>(null) }
    var busy by remember { mutableStateOf(false) }
    var problem by remember { mutableStateOf<String?>(null) }
    val focus = remember { FocusRequester() }
    LaunchedEffect(Unit) { focus.requestFocus() }
    LaunchedEffect(text) {
        if (text.isBlank()) { found = null; return@LaunchedEffect }
        delay(300)
        busy = true
        runCatching { player.music.search(text) }.onSuccess { found = it; problem = null }.onFailure { problem = it.message }
        busy = false
    }
    val list = androidx.compose.foundation.lazy.rememberLazyListState()
    /* Once the title has scrolled away, the field holds the top: below the status bar, on the page's own paper. */
    val stuck by remember { androidx.compose.runtime.derivedStateOf { list.firstVisibleItemIndex > 0 } }
    LazyColumn(Modifier.fillMaxSize(), state = list, contentPadding = PaddingValues(bottom = 24.dp)) {
        item { MusicHead("Search", null) }
        @OptIn(androidx.compose.foundation.ExperimentalFoundationApi::class)
        stickyHeader(key = "field") {
            Box(Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.surface).then(if (stuck) Modifier.windowInsetsPadding(androidx.compose.foundation.layout.WindowInsets.statusBars) else Modifier)) {
                OutlinedTextField(
                    text, { text = it }, Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp).focusRequester(focus), singleLine = true,
                    placeholder = { Text("Songs, albums, artists, genres") }, leadingIcon = { Icon(kimonoIcon("search"), null) },
                    trailingIcon = { if (busy) app.kimono.ui.InkLoader(size = 22.dp) else if (text.isNotEmpty()) IconButton(onClick = { text = "" }) { Icon(kimonoIcon("close"), "Clear") } },
                    shape = RoundedCornerShape(28.dp), keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search), keyboardActions = KeyboardActions(onSearch = {}),
                )
            }
        }
        problem?.let { p -> item { Text(p, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(20.dp)) } }
        val f = found
        val g = f?.genre
        if (f != null && g != null) {
            /* A genre typed ("city pop", "90s"): the genre first, its songs and artists, then what's named that. */
            val src = QueueSource("genre", "tag:${g.tag}", g.title)
            item(key = "genre") {
                Column(Modifier.padding(start = 20.dp, end = 20.dp, top = 16.dp)) {
                    Text("Genre", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Text(g.title, style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.SemiBold, color = MaterialTheme.colorScheme.primary)
                    if (g.artists.isNotEmpty()) Text(g.artists.take(3).joinToString(", ") { it.name }, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                PlayAll(player, g.tracks, src, Modifier.padding(vertical = 8.dp), download = false)
            }
            itemsIndexed(g.tracks.take(8), key = { _, t -> "g" + t.key }) { i, t -> SongRow(player, t, { player.play(g.tracks, i, src) }, go) }
            if (g.artists.isNotEmpty()) item(key = "gartists") { Shelf("Artists") { items(g.artists, key = { "ga" + it.key }) { ArtistTile(it, go, 100.dp) } } }
            if (g.tracks.size > 8) {
                item(key = "gmore") { Text("More ${g.title}", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(start = 20.dp, top = 20.dp, bottom = 4.dp)) }
                itemsIndexed(g.tracks.drop(8), key = { _, t -> "gm" + t.key }) { i, t -> SongRow(player, t, { player.play(g.tracks, i + 8, src) }, go) }
            }
            if (f.albums.isNotEmpty()) item { Shelf("Albums") { items(f.albums, key = { it.key }) { AlbumTile(player, it, go) } } }
            if (f.tracks.isNotEmpty()) {
                item { Text("Named “$text”", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(start = 20.dp, top = 20.dp, bottom = 4.dp)) }
                itemsIndexed(f.tracks.take(10), key = { _, t -> "s" + t.key }) { _, t -> SongRow(player, t, { player.playWithRadio(t) }, go) }
            }
        } else if (f != null) {
            if (f.artists.isNotEmpty()) item { Shelf("Artists") { items(f.artists, key = { it.key }) { ArtistTile(it, go, 100.dp) } } }
            if (f.tracks.isNotEmpty()) {
                item { Text("Songs", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(start = 20.dp, top = 20.dp, bottom = 4.dp)) }
                itemsIndexed(f.tracks, key = { _, t -> "s" + t.key }) { i, t -> SongRow(player, t, { player.playWithRadio(t) }, go) }
            }
            if (f.albums.isNotEmpty()) item { Shelf("Albums") { items(f.albums, key = { it.key }) { AlbumTile(player, it, go) } } }
            if (f.tracks.isEmpty() && f.albums.isEmpty() && f.artists.isEmpty()) item { Text("Nothing by that name.", color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(20.dp)) }
        }
    }
}

/* ── You ────────────────────────────────────────────────────────────────── */

@Composable
fun MusicYouScreen(player: MusicPlayer, me: app.kimono.data.AccountProfile?, go: MusicGo, openSearch: () -> Unit) {
    var mine by remember { mutableStateOf(player.music.known<MusicMe>("me")) }
    var problem by remember { mutableStateOf<String?>(null) }
    var tries by remember { mutableIntStateOf(0) }
    var making by remember { mutableStateOf(false) }
    var bringing by remember { mutableStateOf(false) }
    LaunchedEffect(tries) { runCatching { player.music.me() }.onSuccess { mine = it; problem = null }.onFailure { if (mine == null) problem = it.message } }
    val kept = player.downloads.kept.collectAsState().value
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 24.dp)) {
        item { MusicHead("You", openSearch) }
        item {
            Row(Modifier.padding(horizontal = 20.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                Portrait(me?.picture, me?.name, me?.username, 72.dp)
                Column {
                    Text(me?.name ?: "", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.SemiBold)
                    mine?.let { m -> Text("This month: ${m.minutes} min across ${m.plays} plays", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                }
            }
        }
        mine?.tags?.takeIf { it.isNotEmpty() }?.let { tags -> item { TagCloud(tags) } }
        item {
            Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Crate("Liked", "${mine?.liked ?: 0} songs", "love", Modifier.weight(1f)) { go("music/liked") }
                Crate("History", "Lately", "restart", Modifier.weight(1f)) { go("music/history") }
                val coming = player.downloads.waiting.collectAsState().value.size
                val lost = player.downloads.failed.collectAsState().value.size
                Crate("Downloads", when {
                    coming > 0 -> "Getting $coming…"
                    lost > 0 -> "$lost didn't download"
                    kept.isEmpty() -> "None yet"
                    else -> "${kept.size} · ${megabytes(kept.values.sumOf { it.size })}"
                }, "downloaded", Modifier.weight(1f)) { go("music/downloads") }
            }
        }
        val m = mine
        if (m == null) item { if (problem != null) MusicProblem(problem!!) { tries++ } else MusicLoading() }
        else {
            item {
                Shelf("Your playlists") {
                    item { NewPlaylistTile { making = true } }
                    item { BringInTile { bringing = true } }
                    items(m.playlists, key = { it.id }) { PlaylistTile(player, it, go) }
                }
            }
            if (m.onRepeat.isNotEmpty()) item { Shelf("On repeat") { items(m.onRepeat, key = { "r" + it.key }) { t -> SleeveTile(t.title, t.byline, t.cover, player.current?.key == t.key && player.playing) { player.play(m.onRepeat, m.onRepeat.indexOf(t), QueueSource("repeat", "me", "On repeat")) } } } }
            if (m.artists.isNotEmpty()) item { Shelf("Your top artists") { items(m.artists, key = { it.key }) { ArtistTile(it, go, 104.dp) } } }
        }
    }
    if (bringing) BringInDialog(player, onClose = { bringing = false; tries++ }, open = go)
    if (making) NewPlaylistDialog(player, onDone = { made -> making = false; if (made != null) { tries++; go(MusicRoutes.playlist(made)) } })
}

/** Your genres, in sizes by how much they're yours. */
@Composable
private fun TagCloud(tags: List<String>) {
    FlowRow(Modifier.padding(horizontal = 20.dp, vertical = 4.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        tags.forEachIndexed { i, t ->
            Surface(shape = RoundedCornerShape(50), color = if (i == 0) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surfaceContainerHigh) {
                Text(t.replaceFirstChar { it.uppercase() }, style = if (i < 2) MaterialTheme.typography.titleSmall else MaterialTheme.typography.labelLarge, modifier = Modifier.padding(horizontal = 14.dp, vertical = 8.dp))
            }
        }
    }
}

/** A crate of records: Liked, History, Downloads. */
@Composable
private fun Crate(title: String, caption: String, glyph: String, modifier: Modifier, onClick: () -> Unit) {
    Surface(onClick = onClick, shape = RoundedCornerShape(20.dp), color = MaterialTheme.colorScheme.secondaryContainer, modifier = modifier.height(104.dp)) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.SpaceBetween) {
            if (glyph == "restart") Icon(kimonoIcon("restart"), null, tint = MaterialTheme.colorScheme.onSecondaryContainer)
            else MusicGlyph(glyph, MaterialTheme.colorScheme.onSecondaryContainer, 24.dp, filled = glyph == "love")
            Spacer(Modifier.weight(1f))
            Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold, color = MaterialTheme.colorScheme.onSecondaryContainer)
            Text(caption, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSecondaryContainer.copy(alpha = .75f), maxLines = 1)
        }
    }
}

@Composable
private fun NewPlaylistTile(onClick: () -> Unit) {
    Column(Modifier.width(148.dp).clickable(onClick = onClick)) {
        Box(Modifier.size(136.dp).clip(RoundedCornerShape(10.dp)).background(MaterialTheme.colorScheme.surfaceContainerHigh), contentAlignment = Alignment.Center) {
            Icon(kimonoIcon("plus"), null, Modifier.size(36.dp), tint = MaterialTheme.colorScheme.primary)
        }
        Text("New playlist", style = MaterialTheme.typography.titleSmall, modifier = Modifier.padding(top = 8.dp))
    }
}

@Composable
fun NewPlaylistDialog(player: MusicPlayer, onDone: (String?) -> Unit) {
    var name by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    app.kimono.ui.InkDialog("New playlist", onDismiss = { onDone(null) }, actions = {
        app.kimono.ui.Seal("Cancel", { onDone(null) }, tone = app.kimono.ui.SealTone.Quiet, compact = true)
        app.kimono.ui.Seal("Make", {
            busy = true
            scope.launchCatching({ player.music.createPlaylist(name.trim()) }, { onDone(it.id) }) { busy = false; player.say(it) }
        }, compact = true, busy = busy, enabled = name.isNotBlank())
    }) {
        OutlinedTextField(name, { name = it.take(100) }, Modifier.fillMaxWidth(), singleLine = true, placeholder = { Text("Name it") }, shape = RoundedCornerShape(16.dp))
    }
}

/** Runs [work]; [ok] with its answer, or [failed] with what to tell the person. */
internal fun <T> kotlinx.coroutines.CoroutineScope.launchCatching(work: suspend () -> T, ok: (T) -> Unit, failed: (String) -> Unit) {
    launch { runCatching { work() }.onSuccess(ok).onFailure { failed(it.message ?: "That didn't work.") } }
}

/* ── Lists of songs: Liked, History, Downloads ─────────────────────────── */

@Composable
private fun SongList(player: MusicPlayer, title: String, tracks: List<Track>?, problem: String?, source: QueueSource, go: MusicGo, back: () -> Unit, empty: String, retry: () -> Unit) {
    Scaffold(containerColor = MaterialTheme.colorScheme.surface, topBar = { KimonoTopBar(title, onBack = back) }) { pad ->
        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(top = pad.calculateTopPadding(), bottom = 24.dp)) {
            when {
                tracks == null -> item { if (problem != null) MusicProblem(problem, retry) else MusicLoading() }
                tracks.isEmpty() -> item { Text(empty, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(24.dp)) }
                else -> {
                    item { PlayAll(player, tracks, source, Modifier.padding(vertical = 8.dp)) }
                    itemsIndexed(tracks, key = { i, t -> "$i" + t.key }) { i, t -> SongRow(player, t, { player.play(tracks, i, source) }, go) }
                }
            }
        }
    }
}

@Composable
fun MusicLikedScreen(player: MusicPlayer, go: MusicGo, back: () -> Unit) {
    var tracks by remember { mutableStateOf<List<Track>?>(null) }
    var problem by remember { mutableStateOf<String?>(null) }
    var tries by remember { mutableIntStateOf(0) }
    LaunchedEffect(tries) { runCatching { player.music.liked() }.onSuccess { tracks = it }.onFailure { problem = it.message } }
    SongList(player, "Liked songs", tracks, problem, QueueSource("liked", "liked", "Liked songs"), go, back, "Rate a song up or love it, and it's kept here.") { tries++ }
}

@Composable
fun MusicHistoryScreen(player: MusicPlayer, go: MusicGo, back: () -> Unit) {
    var tracks by remember { mutableStateOf<List<Track>?>(null) }
    var problem by remember { mutableStateOf<String?>(null) }
    var tries by remember { mutableIntStateOf(0) }
    LaunchedEffect(tries) { runCatching { player.music.history() }.onSuccess { tracks = it }.onFailure { problem = it.message } }
    SongList(player, "History", tracks, problem, QueueSource("history", "all", "History"), go, back, "What you play shows up here.") { tries++ }
}



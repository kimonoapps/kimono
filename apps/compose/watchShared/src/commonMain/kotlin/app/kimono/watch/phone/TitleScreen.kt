package app.kimono.watch.phone

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.horizontalScroll
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
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.DpOffset
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Popup
import app.kimono.watch.model.EpisodeInfo
import app.kimono.watch.model.TitlePage
import app.kimono.watch.DlState
import app.kimono.watch.LocalWatch
import app.kimono.watch.WatchDownloads
import app.kimono.watch.dlKey
import app.kimono.watch.ink.InkLoader
import app.kimono.watch.ink.InkProgress
import app.kimono.watch.ink.InkRing
import app.kimono.watch.theme.Night
import app.kimono.watch.theme.ui
import app.kimono.watch.ui.Boxed
import app.kimono.watch.ui.I
import app.kimono.watch.ui.Ic
import app.kimono.watch.ui.Img
import app.kimono.watch.ui.Logo
import app.kimono.watch.ui.PaperButton
import app.kimono.watch.ui.ProgressLine
import app.kimono.watch.ui.RingButton
import app.kimono.watch.ui.Skeleton
import app.kimono.watch.ui.TitleViewModel
import app.kimono.watch.ui.clickableScale
import app.kimono.watch.ui.clickableScaleClipped
import app.kimono.watch.ui.minutesText

private val monthNames = listOf("January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December")
fun prettyDate(date: String): String {
    val p = date.split("-")
    val m = p.getOrNull(1)?.toIntOrNull() ?: return date
    return "${monthNames[m - 1]} ${p.getOrNull(2)?.toIntOrNull() ?: ""}"
}

/** The title page: full screen on a phone, a wide two-column page on TV. */
@Composable
fun TitleScreen(vm: TitleViewModel, go: Go, top: Int?, onClose: () -> Unit, downloads: WatchDownloads, wide: Boolean = false, active: Boolean = true) {
    val state by vm.state.collectAsState()
    val page = state.page
    val dl by downloads.states.collectAsState()
    var tab by remember { mutableStateOf("eps") }
    var muted by remember { mutableStateOf(true) }
    var previewing by remember { mutableStateOf(false) }
    val gutter = if (wide) 48.dp else 16.dp
    val playFocus = remember { androidx.compose.ui.focus.FocusRequester() }
    androidx.compose.runtime.LaunchedEffect(page != null) { if (page != null && wide) { kotlinx.coroutines.delay(150); runCatching { playFocus.requestFocus() } } }
    Box(Modifier.fillMaxSize().background(if (wide) Night.surface else Night.bg)) {
        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = navBottom + 32.dp)) {
            item("top") {
                Box(Modifier.fillMaxWidth().aspectRatio(if (wide) 3.1f else 16f / 9f).background(Color.Black)) {
                    Img(page?.title?.backdropLarge ?: page?.title?.backdrop, Modifier.fillMaxSize())
                    if (page != null && page.playable) {
                        val r = page.resume
                        BoxWithConstraints(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                            LocalWatch.current.preview.Show(vm.id, if (page.title.isFilm) 0 else r?.season ?: 1, if (page.title.isFilm) 0 else r?.episode ?: 1, muted, active, { previewing = it },
                                Modifier.requiredWidth(maxOf(maxWidth, maxHeight * 16f / 9f)).height(maxOf(maxHeight, maxWidth * 9f / 16f)))
                        }
                    }
                    Box(Modifier.fillMaxSize().background(Brush.verticalGradient(0.5f to Color.Transparent, 1f to if (wide) Night.surface else Night.bg)))
                    if (page != null) Logo(page.title.name, page.title.logo, if (wide) 56 else 40, Modifier.align(Alignment.BottomStart).padding(start = gutter, bottom = 28.dp).fillMaxWidth(0.7f), maxHeight = if (wide) 120.dp else 72.dp)
                    if (previewing) RingButton(if (muted) Ic.mute else Ic.vol, { muted = !muted }, Modifier.align(Alignment.BottomEnd).padding(end = gutter, bottom = 28.dp))
                }
            }
            if (page == null) {
                item { Column(Modifier.padding(horizontal = gutter)) { Skeleton(Modifier.fillMaxWidth(0.4f).height(14.dp)); repeat(4) { Spacer(Modifier.height(10.dp)); Skeleton(Modifier.fillMaxWidth().height(96.dp)) } } }
                state.problem?.let { item { Text(it, style = ui(15, color = Night.fg3), modifier = Modifier.padding(gutter)) } }
            } else {
                item("head") { Head(page, vm, go, top, dl, downloads, wide, gutter, playFocus) }
                item("tabs") {
                    Row(Modifier.padding(horizontal = gutter).padding(top = 18.dp).fillMaxWidth().drawBehind { drawLine(Night.line, Offset(0f, 0f), Offset(size.width, 0f), 1.dp.toPx()) }, horizontalArrangement = Arrangement.spacedBy(24.dp)) {
                        if (!page.title.isFilm) Tab("Episodes", tab == "eps") { tab = "eps" }
                        Tab("More like this", tab == "more" || page.title.isFilm) { tab = "more" }
                    }
                }
                if (!page.title.isFilm && tab == "eps") episodes(page, state.season ?: page.season ?: 1, state.seasonLoading, vm, go, dl, downloads, wide, gutter)
                else more(state.more, go, gutter, wide)
            }
        }
        /* Under the status bar, the page fades out rather than running beneath the clock. */
        if (!wide) Box(Modifier.fillMaxWidth().height(statusTop + 8.dp).background(Brush.verticalGradient(0f to Night.bg, 1f to Color.Transparent)))
        Box(Modifier.align(Alignment.TopEnd).padding(top = statusTop + 12.dp, end = 12.dp).size(38.dp).clip(CircleShape).background(Color(0xBF110C0A)).clickableScale(onClose), contentAlignment = Alignment.Center) { I(Ic.close) }
    }
}

@Composable
private fun Tab(label: String, on: Boolean, onClick: () -> Unit) {
    val color by animateColorAsState(if (on) Night.suo else Color.Transparent, label = "tab")
    Text(label, style = ui(15, FontWeight.Bold, if (on) Night.fg else Night.fg3), modifier = Modifier.drawBehind { drawLine(color, Offset(0f, 0f), Offset(size.width, 0f), 3.dp.toPx()) }.clickableScale(onClick).padding(top = 12.dp, bottom = 10.dp))
}

@Composable
private fun Head(page: TitlePage, vm: TitleViewModel, go: Go, top: Int?, dl: Map<String, DlState>, downloads: WatchDownloads, wide: Boolean, gutter: Dp, playFocus: androidx.compose.ui.focus.FocusRequester) {
    val t = page.title
    val r = page.resume
    val started = if (t.isFilm) (r?.fraction ?: 0.0) > 0 else r?.started == true
    val seasons = page.seasons.size
    val length = when {
        t.isFilm -> t.runtime?.let(::minutesText) ?: ""
        seasons > 1 -> "$seasons seasons"
        else -> "${page.seasons.firstOrNull()?.episodeCount ?: page.episodes.size} episodes"
    }
    val main: @Composable () -> Unit = {
        Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                page.badge?.let { Text(it, style = ui(14, FontWeight.Bold, Night.moss)) }
                t.year?.let { Text("$it", style = ui(14, color = Night.fg2)) }
                if (t.age.isNotBlank()) Boxed(t.age)
                if (length.isNotBlank()) Text(length, style = ui(14, color = Night.fg2))
            }
            if (top != null) RankLine(top, t.shelf)
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                /* Can't play: say why (not out yet, only in cinemas, no copy found). */
                val label = when { !page.playable -> page.availability?.note ?: "Not available yet"; started -> "Resume"; !t.isFilm -> "Play " + (r?.label ?: page.label(r?.season ?: 1, r?.episode ?: 1)); else -> "Play" }
                val icon = when { page.playable -> Ic.play; page.availability?.state == "upcoming" -> Ic.bell; page.availability?.state == "cinemas" -> Ic.film; else -> Ic.info }
                PaperButton(label, icon, { if (page.playable) go.play(t.id, r?.season?.takeIf { it > 0 }, r?.episode?.takeIf { it > 0 }) }, (if (wide) Modifier.widthIn(min = 260.dp) else Modifier.fillMaxWidth()).focusRequester(playFocus))
                if (started) ResumeLine(page)
            }
            page.tracker?.let { Tracker(page) }
            Text(t.overview, style = ui(15).copy(lineHeight = 24.sp))
            Actions(page, vm, go, dl, downloads)
        }
    }
    val side: @Composable () -> Unit = {
        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            if (t.cast.isNotEmpty()) Kv("Cast", t.cast.take(4).joinToString(", "))
            if (t.genres.isNotEmpty()) Kv("Genres", t.genres.joinToString(", "))
            if (t.moods.isNotEmpty()) Kv(if (t.isFilm) "This film is" else "This show is", t.moods.take(4).joinToString(", "))
        }
    }
    if (wide) Row(Modifier.padding(horizontal = gutter), horizontalArrangement = Arrangement.spacedBy(28.dp)) {
        Box(Modifier.weight(1.7f)) { main() }
        Box(Modifier.weight(1f)) { side() }
    } else Column(Modifier.padding(horizontal = gutter), verticalArrangement = Arrangement.spacedBy(14.dp)) { main(); side() }
}

@Composable
private fun Kv(key: String, value: String) {
    Text(androidx.compose.ui.text.buildAnnotatedString {
        append("$key: ")
        pushStyle(androidx.compose.ui.text.SpanStyle(color = Night.fg2)); append(value); pop()
    }, style = ui(14, color = Night.fg3).copy(lineHeight = 24.sp))
}

@Composable
private fun ResumeLine(page: TitlePage) {
    val r = page.resume ?: return
    if (page.title.isFilm) {
        val left = page.title.runtime?.let { (it * (1 - (r.fraction ?: 0.0))).toInt() }
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            ProgressLine((r.fraction ?: 0.0).toFloat(), Modifier.width(220.dp))
            left?.let { Text("${it}m left", style = ui(13, color = Night.fg2)) }
        }
        return
    }
    val ep = page.episode(r.season, r.episode)
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        Text((r.label ?: page.label(r.season, r.episode)) + (ep?.let { " “${it.name}”" } ?: ""), style = ui(13, color = Night.fg2), maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
        if (ep != null) {
            ProgressLine(ep.fraction.toFloat(), Modifier.widthIn(max = 220.dp).width(90.dp))
            ep.runtime?.let { Text("${(it * (1 - ep.fraction)).toInt()}m left", style = ui(13, color = Night.fg2)) }
        }
    }
}

/** Where you are in the season, a mark per episode, and how many are left. */
@Composable
private fun Tracker(page: TitlePage) {
    val tr = page.tracker ?: return
    val later = page.seasons.any { it.number > tr.season }
    val after = when {
        later -> "Season ${tr.season + 1} is ready after that"
        tr.nextAirDate != null -> "Next episode ${prettyDate(tr.nextAirDate!!)}"
        page.title.nextAirDate != null -> "More on ${prettyDate(page.title.nextAirDate!!)}"
        else -> "That's the end of the series so far"
    }
    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).background(Night.surface2).padding(horizontal = 14.dp, vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            val where = if (page.bySeason) " in Season ${tr.season}" else ""
            Text(if (tr.left == 1) "Last episode$where" else "${tr.left} episodes left$where", style = ui(13, FontWeight.Bold), modifier = Modifier.weight(1f))
            Text(after, style = ui(13, color = Night.fg2), maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        Row(horizontalArrangement = Arrangement.spacedBy(if (tr.marks.size > 30) 1.dp else 4.dp)) {
            tr.marks.forEach { m ->
                Box(Modifier.weight(1f).height(6.dp).clip(RoundedCornerShape(3.dp)).background(when (m.state) { "done" -> Night.blush; "upcoming" -> Color(0x14EFE0DA); else -> Color(0x29EFE0DA) })
                    .drawBehind {
                        if (m.state == "skip") {
                            var x = -size.height
                            while (x < size.width) { drawLine(Color(0x29EFE0DA), Offset(x, size.height), Offset(x + size.height, 0f), 3f); x += 6.dp.toPx() }
                        }
                    }) {
                    if (m.state == "open" && m.fraction > 0) Box(Modifier.fillMaxHeight().fillMaxWidth(m.fraction.toFloat()).clip(RoundedCornerShape(3.dp)).background(Night.suo))
                }
            }
        }
    }
}

@Composable
private fun Actions(page: TitlePage, vm: TitleViewModel, go: Go, dl: Map<String, DlState>, downloads: WatchDownloads) {
    var rating by remember { mutableStateOf(false) }
    val t = page.title
    Row(Modifier.horizontalScroll(androidx.compose.foundation.rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(24.dp)) {
        Act(if (page.inList) Ic.check else Ic.add, "My list", page.inList) { vm.toggleList() }
        Box {
            Act(when (page.rating) { "down" -> Ic.down; "love" -> Ic.love; else -> Ic.up }, "Rate", page.rating != null) { rating = true }
            if (rating) Popup(alignment = Alignment.TopCenter, offset = IntOffset(0, -170), onDismissRequest = { rating = false }, properties = androidx.compose.ui.window.PopupProperties(focusable = true)) {
                Row(Modifier.clip(RoundedCornerShape(999.dp)).background(Night.surface3).padding(6.dp), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    listOf("down" to Ic.down, "up" to Ic.up, "love" to Ic.love).forEach { (k, icon) ->
                        Box(Modifier.size(44.dp).clip(CircleShape).clickableScale({ vm.rate(k); rating = false }, focusScale = 1.12f), contentAlignment = Alignment.Center) { I(icon, tint = if (page.rating == k) Night.blush else Night.fg2) }
                    }
                }
            }
        }
        if (t.isFilm) {
            val d = dl[dlKey(t.id, 0, 0)]
            DlAct(d, if (d?.done == true) "Downloaded" else if (d != null) "Downloading" else "Download") { if (d == null) downloads.start(t.id, 0, 0, t.name) }
        } else {
            val all = page.episodes.isNotEmpty() && page.episodes.all { dl[dlKey(t.id, page.seasonOf(it), it.number)]?.done == true }
            val some = page.episodes.any { dl[dlKey(t.id, page.seasonOf(it), it.number)] != null }
            val avg = page.episodes.map { dl[dlKey(t.id, page.seasonOf(it), it.number)]?.progress ?: 0f }.average().toFloat()
            val what = if (page.bySeason) "season" else "all"
            DlAct(if (all) DlState(1f, true) else if (some) DlState(avg, false) else null, if (all) (if (page.bySeason) "Season downloaded" else "Downloaded") else "Download $what") {
                page.episodes.forEach { e -> val es = page.seasonOf(e); if (dl[dlKey(t.id, es, e.number)] == null) downloads.start(t.id, es, e.number, "${t.name} ${e.label ?: page.label(es, e.number)}") }
            }
        }
        if (page.hasFillers) SwitchAct("Skip fillers", page.fillers == "skip") { vm.skipFillers(it) }
        if (page.playable) Act(Ic.people, "Watch together", false) {
            val r = page.resume
            go.together(t.id, r?.season?.takeIf { it > 0 }, r?.episode?.takeIf { it > 0 }, r?.position ?: 0.0)
        }
    }
}

@Composable
private fun Act(icon: ImageVector, label: String, on: Boolean, onClick: () -> Unit) {
    Column(Modifier.widthIn(min = 56.dp).clickableScale(onClick), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(4.dp)) {
        I(icon, 26.dp, if (on) Night.fg else Night.fg2)
        Text(label, style = ui(12, color = if (on) Night.fg else Night.fg2))
    }
}

@Composable
private fun DlAct(d: DlState?, label: String, onClick: () -> Unit) {
    Column(Modifier.widthIn(min = 56.dp).clickableScale(onClick), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(4.dp)) {
        when {
            d?.done == true -> I(Ic.dlDone, 26.dp, Night.blush)
            d != null -> InkRing({ d.progress }, size = 28.dp)
            else -> I(Ic.dl, 26.dp, Night.fg2)
        }
        Text(label, style = ui(12, color = Night.fg2))
    }
}

/** The demo's switch: a pill that fills suō and grows its knob when on. */
@Composable
fun Switch(on: Boolean, small: Boolean = false) {
    val w = if (small) 40.dp else 46.dp; val h = if (small) 24.dp else 28.dp
    val knob by animateDpAsState(if (on) (if (small) 16.dp else 20.dp) else (if (small) 12.dp else 14.dp), spring(dampingRatio = 0.5f), label = "k")
    val x by animateDpAsState(if (on) w - knob - (if (small) 5.dp else 6.dp) else (if (small) 3.dp else 4.dp), spring(dampingRatio = 0.5f, stiffness = 400f), label = "x")
    val bg by animateColorAsState(if (on) Night.suo else Night.surface3, label = "bg")
    Box(Modifier.size(w, h).clip(RoundedCornerShape(999.dp)).background(bg).border(2.dp, if (on) Night.suo else Night.fg3, RoundedCornerShape(999.dp))) {
        Box(Modifier.align(Alignment.CenterStart).offset(x = x - 2.dp).size(knob).clip(CircleShape).background(if (on) Night.paper else Night.fg3))
    }
}

@Composable
private fun SwitchAct(label: String, on: Boolean, onChange: (Boolean) -> Unit) {
    Column(Modifier.widthIn(min = 56.dp).clickableScale({ onChange(!on) }), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Box(Modifier.height(26.dp), contentAlignment = Alignment.Center) { Switch(on, small = true) }
        Text(label, style = ui(12, color = if (on) Night.fg else Night.fg2))
    }
}

private fun LazyListScope.episodes(page: TitlePage, season: Int, loading: Boolean, vm: TitleViewModel, go: Go, dl: Map<String, DlState>, downloads: WatchDownloads, wide: Boolean, gutter: Dp) {
    item("eps-head") {
        var open by remember { mutableStateOf(false) }
        Row(Modifier.padding(horizontal = gutter).padding(top = 12.dp, bottom = 4.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            /* One season, or one numbered run: no season shown, just the episodes. */
            if (!page.bySeason) Text("Episodes", style = ui(18, FontWeight.Bold))
            else Box {
                val turn by animateFloatAsState(if (open) 180f else 0f, label = "chev")
                Row(Modifier.height(44.dp).clip(RoundedCornerShape(8.dp)).background(Night.surface3).border(1.dp, Night.line, RoundedCornerShape(8.dp)).clickableScale({ if (page.seasons.size > 1) open = true }).padding(start = 16.dp, end = 10.dp),
                    verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text(page.seasons.firstOrNull { it.number == season }?.name?.takeIf { it.isNotBlank() && !it.startsWith("Season") }?.let { "Season $season" } ?: "Season $season", style = ui(16, FontWeight.Bold))
                    if (page.seasons.size > 1) I(Ic.more, modifier = Modifier.rotate(turn))
                }
                DropdownMenu(open, { open = false }, offset = DpOffset(0.dp, 6.dp), containerColor = Night.surface3, shape = RoundedCornerShape(12.dp), modifier = Modifier.widthIn(min = 240.dp)) {
                    page.seasons.forEach { s ->
                        Row(Modifier.fillMaxWidth().clickableScaleClipped(RoundedCornerShape(8.dp), { open = false; vm.season(s.number) }).padding(horizontal = 12.dp, vertical = 10.dp),
                            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            I(Ic.check, 18.dp, if (s.number == season) Night.blush else Color.Transparent)
                            Text("Season ${s.number}", style = ui(15, FontWeight.Bold), modifier = Modifier.weight(1f))
                            Text("${s.episodeCount} episodes", style = ui(13, color = Night.fg3))
                        }
                    }
                }
            }
            Text("${(if (page.bySeason) page.seasons.firstOrNull { it.number == season }?.episodeCount else null) ?: page.episodes.size} episodes", style = ui(14, color = Night.fg3))
        }
        /* Anime with more than one season: this show by season or as one list, over the default in Settings. */
        if (page.title.shelf == "Anime" && page.layout != "single") {
            Row(Modifier.padding(horizontal = gutter).padding(top = 8.dp, bottom = 4.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                Joint(listOf("seasons" to "By season", "continuous" to "One list"), page.layout) { v -> if (v != page.layout) vm.episodes(v) }
                if (page.showEpisodes != null) Text("Use default", style = ui(14, FontWeight.Bold, Night.fg2),
                    modifier = Modifier.clickableScaleClipped(RoundedCornerShape(8.dp), { vm.episodes(null) }).padding(horizontal = 8.dp, vertical = 8.dp))
            }
        }
    }
    if (loading) items(4) { Skeleton(Modifier.padding(horizontal = gutter, vertical = 10.dp).fillMaxWidth().height(96.dp)) }
    else {
        val r = page.resume
        val last = page.episodes.lastOrNull()
        val finalSeason = !page.bySeason || page.seasons.lastOrNull()?.number == season
        items(page.episodes, key = { "ep${page.seasonOf(it)}:${it.number}" }) { e ->
            /* In one run the list crosses seasons: each episode plays by its own season. */
            val s = page.seasonOf(e)
            EpisodeRow(page, e, now = r?.started == true && r.season == s && r.episode == e.number,
                finale = if (e === last) (if (finalSeason && page.title.status.contains("Ended", true)) "FINALE" else "SEASON FINALE") else null,
                dl = dl[dlKey(page.title.id, s, e.number)], wide = wide, gutter = gutter,
                onPlay = { go.play(page.title.id, s, e.number) },
                onDownload = { downloads.start(page.title.id, s, e.number, "${page.title.name} ${e.label ?: page.label(s, e.number)}") })
        }
    }
}

@Composable
private fun EpisodeRow(page: TitlePage, e: EpisodeInfo, now: Boolean, finale: String?, dl: DlState?, wide: Boolean, gutter: Dp, onPlay: () -> Unit, onDownload: () -> Unit) {
    val skipped = page.fillers == "skip" && e.filler
    Row(Modifier.fillMaxWidth().padding(horizontal = if (wide) gutter - 12.dp else gutter).alpha(if (skipped) 0.5f else 1f)
        .clip(RoundedCornerShape(if (wide) 8.dp else 0.dp)).background(if (now) Night.surface2 else Color.Transparent)
        .clickableScale(onPlay).drawBehind { if (wide) drawLine(Night.line, Offset(0f, size.height), Offset(size.width, size.height), 1.dp.toPx()) }
        .padding(horizontal = if (wide) 12.dp else 0.dp, vertical = if (wide) 16.dp else 12.dp),
        horizontalArrangement = Arrangement.spacedBy(if (wide) 16.dp else 12.dp), verticalAlignment = Alignment.Top) {
        val n = if (page.layout == "continuous") e.absolute ?: e.number else e.number
        if (wide) Text("$n", style = ui(22, color = Night.fg3), modifier = Modifier.widthIn(min = 26.dp).align(Alignment.CenterVertically))
        Box(Modifier.width(if (wide) 150.dp else 120.dp).aspectRatio(16f / 9f).clip(RoundedCornerShape(6.dp))) {
            Img(e.still ?: page.title.backdrop, Modifier.fillMaxSize())
            if (e.fraction > 0) ProgressLine(e.fraction.toFloat(), Modifier.align(Alignment.BottomCenter).padding(6.dp).fillMaxWidth().clip(RoundedCornerShape(2.dp)))
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text((if (wide) "" else "$n. ") + e.name, style = ui(15, FontWeight.Bold), modifier = Modifier.weight(1f, fill = false), maxLines = 2, overflow = TextOverflow.Ellipsis)
                if (e.filler) FTag("Filler", false) else if (e.recap) FTag("Recap", true)
                if (wide) { Spacer(Modifier.weight(1f)); Text(if (skipped) "Skipped" else e.runtime?.let { "${it}m" } ?: "", style = ui(14, color = Night.fg2)) }
            }
            if (!wide) Text(if (skipped) "Skipped" else e.runtime?.let { "${it}m" } ?: "", style = ui(14, color = Night.fg2))
            finale?.let { Text(it, style = ui(11, FontWeight.Bold, Night.blush).copy(letterSpacing = 0.5.sp)) }
            if (wide) Text(e.overview, style = ui(13, color = Night.fg2).copy(lineHeight = 20.sp), maxLines = 3, overflow = TextOverflow.Ellipsis)
        }
        Box(Modifier.size(40.dp).clip(CircleShape).clickableScale(onDownload).align(Alignment.CenterVertically), contentAlignment = Alignment.Center) {
            when {
                dl?.done == true -> I(Ic.dlDone, tint = Night.blush)
                dl != null && dl.progress <= 0f -> InkLoader(size = 26.dp)
                dl != null -> InkRing({ dl.progress }, size = 28.dp)
                else -> I(Ic.dl, tint = Night.fg2)
            }
        }
    }
    if (!wide) Text(e.overview, style = ui(13, color = Night.fg2).copy(lineHeight = 20.sp), maxLines = 3, overflow = TextOverflow.Ellipsis,
        modifier = Modifier.padding(horizontal = gutter).fillMaxWidth().alpha(if (skipped) 0.5f else 1f)
            .drawBehind { drawLine(Night.line, Offset(0f, size.height), Offset(size.width, size.height), 1.dp.toPx()) }.padding(bottom = 12.dp))
}

@Composable
fun FTag(text: String, dashed: Boolean) {
    Text(text, style = ui(11, FontWeight.Bold, if (dashed) Night.fg3 else Night.fg2).copy(letterSpacing = 0.4.sp),
        modifier = Modifier.drawBehind {
            drawRoundRect(Night.fg3, cornerRadius = androidx.compose.ui.geometry.CornerRadius(5.dp.toPx()),
                style = Stroke(1.dp.toPx(), pathEffect = if (dashed) PathEffect.dashPathEffect(floatArrayOf(6f, 4f)) else null))
        }.padding(horizontal = 7.dp, vertical = 1.dp))
}

private fun LazyListScope.more(cards: List<app.kimono.watch.model.Card>?, go: Go, gutter: Dp, wide: Boolean) {
    if (cards == null) { item { Row(Modifier.padding(gutter), horizontalArrangement = Arrangement.spacedBy(14.dp)) { repeat(2) { Skeleton(Modifier.weight(1f).aspectRatio(16f / 9f)) } } }; return }
    val per = if (wide) 3 else 2
    items(cards.chunked(per)) { row ->
        Row(Modifier.padding(horizontal = gutter, vertical = 7.dp), horizontalArrangement = Arrangement.spacedBy(14.dp)) {
            row.forEach { c ->
                Column(Modifier.weight(1f).clip(RoundedCornerShape(8.dp)).background(Night.surface2).clickableScale({ go.open(c) })) {
                    Box(Modifier.fillMaxWidth().aspectRatio(16f / 9f)) {
                        Img(c.backdrop ?: c.poster, Modifier.fillMaxSize())
                        Box(Modifier.fillMaxSize().background(Brush.verticalGradient(0.55f to Color.Transparent, 1f to Color(0x99000000))))
                        Text(c.name, style = app.kimono.watch.theme.display(18), modifier = Modifier.align(Alignment.BottomStart).padding(10.dp), maxLines = 2, overflow = TextOverflow.Ellipsis)
                    }
                    Row(Modifier.padding(horizontal = 12.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        if (c.age.isNotBlank()) Boxed(c.age)
                        c.year?.let { Text("$it", style = ui(13, color = Night.fg2)) }
                    }
                }
            }
            repeat(per - row.size) { Spacer(Modifier.weight(1f)) }
        }
    }
}

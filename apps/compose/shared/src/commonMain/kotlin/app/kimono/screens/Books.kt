@file:OptIn(ExperimentalMaterial3Api::class, ExperimentalMaterial3ExpressiveApi::class)

package app.kimono.screens

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExperimentalMaterial3ExpressiveApi
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Slider
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.kimono.data.Book
import app.kimono.data.BookFile
import app.kimono.data.BookPage
import app.kimono.data.Books
import app.kimono.data.BooksHome
import app.kimono.data.FriendOnBook
import app.kimono.data.ShelfItem
import app.kimono.ui.InkLoader
import app.kimono.ui.InkSheet
import app.kimono.ui.Portrait
import app.kimono.ui.bottomChrome
import coil3.compose.AsyncImage
import kotlinx.coroutines.launch

/*
 * 本 Kimono Books on the phone. Thumb-first: Home is what you're reading,
 * what friends are reading, then shelves to swipe through; a book opens as a
 * sheet risen from the bottom with everything in reach. Books stand turned a
 * little on their shelves, spine showing, and turn to face you when pressed.
 */

/* Cloth colours for spines and bindings with no cover: tonal, from Kimono's family. */
private val cloths = listOf(
    Color(0xFF3F4A2C) to Color(0xFFE6ECD6), Color(0xFF5B3242) to Color(0xFFF6DDE3), Color(0xFF2F3A52) to Color(0xFFDDE4F3),
    Color(0xFF6B4A22) to Color(0xFFF5E6CF), Color(0xFF3C2F4F) to Color(0xFFE7DEF3), Color(0xFF26443F) to Color(0xFFD7ECE7),
)
private fun clothOf(key: String): Pair<Color, Color> { var h = 7; for (c in key) h = h * 31 + c.code; return cloths[(h and 0x7fffffff) % cloths.size] }

/** A book with its spine showing: it turns to face you, and lifts, while pressed. */
@Composable
fun Book3D(book: Book, width: Dp, modifier: Modifier = Modifier, progress: Double? = null, still: Boolean = false, badge: (@Composable () -> Unit)? = null, onOpen: (() -> Unit)? = null) {
    val press = remember { MutableInteractionSource() }
    val pressed by press.collectIsPressedAsState()
    val turn by animateFloatAsState(if (pressed || still) 0f else 16f, spring(dampingRatio = .55f, stiffness = 380f))
    val lift by animateDpAsState(if (pressed) (-6).dp else 0.dp, spring(dampingRatio = .55f, stiffness = 380f))
    val (cloth, ink) = clothOf(book.key)
    val spine = (width.value * .085f).coerceIn(8f, 18f).dp
    Box(modifier.width(width + spine).offset(y = lift)) {
        Box(
            Modifier.width(width + spine).height(width * 1.5f)
                .graphicsLayer { rotationY = turn; cameraDistance = 14f * density; transformOrigin = androidx.compose.ui.graphics.TransformOrigin(1f, .5f) }
                .then(if (onOpen != null) Modifier.clickable(interactionSource = press, indication = null, role = Role.Button, onClick = onOpen).semantics { contentDescription = "${book.title}${if (book.author.isNotBlank()) ", ${book.author}" else ""}" } else Modifier),
        ) {
            Row(Modifier.fillMaxSize().shadow(if (pressed) 14.dp else 6.dp, RoundedCornerShape(2.dp, 5.dp, 5.dp, 2.dp))) {
                /* The spine, darker, with the title down it. */
                Box(Modifier.width(spine).fillMaxHeight().background(lerpColor(cloth, Color.Black, .25f)), contentAlignment = Alignment.Center) {
                    Text(book.title, color = ink.copy(alpha = .85f), fontSize = 8.sp, maxLines = 1, overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.graphicsLayer { rotationZ = 90f }.widthIn(max = width * 1.3f))
                }
                Box(Modifier.width(width).fillMaxHeight().clip(RoundedCornerShape(0.dp, 5.dp, 5.dp, 0.dp)).background(cloth)) {
                    ClothCover(book, ink, width)
                    if (book.cover != null) AsyncImage(model = book.cover, contentDescription = null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
                    /* The hinge's pressed line. */
                    Box(Modifier.padding(start = 5.dp).width(1.5.dp).fillMaxHeight().background(Color.Black.copy(alpha = .16f)))
                }
            }
            if (progress != null && progress > 0) Box(
                Modifier.align(Alignment.TopEnd).padding(end = width * .16f).width(8.dp).height((width.value * 1.5f * progress.toFloat() * .5f + 12f).dp)
                    .clip(RoundedCornerShape(bottomStart = 2.dp, bottomEnd = 2.dp)).background(Color(0xFFA8475F)),
            )
        }
        if (badge != null) Box(Modifier.offset((-6).dp, (-6).dp)) { badge() }
    }
}

@Composable
private fun ClothCover(book: Book, ink: Color, width: Dp) {
    Column(Modifier.fillMaxSize().padding(start = width * .14f, end = width * .1f, top = width * .16f, bottom = width * .12f), verticalArrangement = Arrangement.SpaceBetween) {
        Text(book.title, color = ink, fontWeight = FontWeight.Bold, fontSize = (width.value * .11f).sp, lineHeight = (width.value * .125f).sp, maxLines = 5, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.titleLarge)
        if (book.author.isNotBlank()) Text(book.author, color = ink.copy(alpha = .8f), fontSize = (width.value * .075f).sp, maxLines = 2)
    }
}

private fun lerpColor(a: Color, b: Color, t: Float) = Color(a.red + (b.red - a.red) * t, a.green + (b.green - a.green) * t, a.blue + (b.blue - a.blue) * t, 1f)

/* ── Home ───────────────────────────────────────────────────────────────── */

@Composable
fun BooksHomeScreen(books: Books, platform: app.kimono.data.Platform, firstName: String?, openSearch: () -> Unit, openShelf: () -> Unit) {
    var home by remember { mutableStateOf<BooksHome?>(books.knownHome()) }
    var problem by remember { mutableStateOf<String?>(null) }
    var open by remember { mutableStateOf<String?>(null) }
    val snackbar = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()
    suspend fun load() { runCatching { books.home() }.onSuccess { home = it; problem = null }.onFailure { if (home == null) problem = it.message ?: "Books couldn't load." } }
    LaunchedEffect(Unit) { load() }
    WhileShown(Unit) { load() }

    Scaffold(snackbarHost = { SnackbarHost(snackbar) }, containerColor = MaterialTheme.colorScheme.surface) { pad ->
        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(top = pad.calculateTopPadding() + 8.dp, bottom = 120.dp)) {
            item {
                Column(Modifier.padding(horizontal = 20.dp)) {
                    Text("Books", style = MaterialTheme.typography.displaySmall, fontWeight = FontWeight.Bold, modifier = Modifier.padding(top = 12.dp, bottom = 16.dp))
                    SearchPill("Title, author or ISBN", onClick = openSearch)
                }
            }
            val reading = home?.shelf?.filter { it.state == "reading" }.orEmpty()
            reading.firstOrNull()?.let { lead -> item { ReadingNow(lead, more = reading.size - 1, open = { open = lead.key }, openShelf = openShelf) } }
            if (home != null && reading.isEmpty()) item {
                Text("What are you reading${firstName?.let { ", $it" } ?: ""}?", style = MaterialTheme.typography.titleLarge, modifier = Modifier.padding(start = 20.dp, end = 20.dp, top = 28.dp))
                Text("Find a book, put it on your shelf, and keep your place.", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(horizontal = 20.dp, vertical = 6.dp))
            }
            home?.friends?.takeIf { it.isNotEmpty() }?.let { friends -> item {
                ShelfRow("Friends are reading") {
                    items(friends, key = { "${it.username}:${it.book?.key}" }) { f ->
                        val b = f.book ?: return@items
                        BookTile(b, progress = if (f.state == "reading") f.fraction else null, caption = "${f.name.substringBefore(' ')} · ${f.verdict.lowercase()}",
                            badge = { Portrait(f.picture, f.name, f.username, 26.dp) }) { open = b.key }
                    }
                }
            } }
            if (home == null && problem == null) item { Box(Modifier.fillMaxWidth().padding(64.dp), contentAlignment = Alignment.Center) { InkLoader(size = 48.dp) } }
            problem?.let { p -> item { Text(p, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(24.dp)) } }
            home?.rows?.let { rows -> items(rows, key = { it.id }) { row ->
                ShelfRow(row.title) {
                    items(row.books, key = { it.key }) { b ->
                        val rank = if (row.id == "trending") row.books.indexOf(b).takeIf { it < 10 } else null
                        BookTile(b, caption = b.author, badge = rank?.let { { RankMark(it + 1) } }) { open = b.key }
                    }
                }
            } }
        }
    }
    open?.let { key -> BookSheet(books, platform, key, onDismiss = { open = null }, onOpen = { open = it }, say = { msg -> scope.launch { snackbar.showSnackbar(msg) } }, changed = { scope.launch { load() } }) }
}

@Composable
private fun SearchPill(hint: String, onClick: () -> Unit) {
    Surface(onClick = onClick, shape = RoundedCornerShape(28.dp), color = MaterialTheme.colorScheme.surfaceContainerHigh, modifier = Modifier.fillMaxWidth().height(56.dp)) {
        Row(Modifier.padding(horizontal = 20.dp), verticalAlignment = Alignment.CenterVertically) {
            androidx.compose.material3.Icon(app.kimono.ui.inkIcon("search"), null, Modifier.size(22.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
            Spacer(Modifier.width(12.dp))
            Text(hint, color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodyLarge)
        }
    }
}

@Composable
private fun ReadingNow(item: ShelfItem, more: Int, open: () -> Unit, openShelf: () -> Unit) {
    Surface(onClick = open, shape = RoundedCornerShape(28.dp), color = MaterialTheme.colorScheme.surfaceContainer, modifier = Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, top = 20.dp)) {
        Row(Modifier.padding(20.dp), verticalAlignment = Alignment.CenterVertically) {
            Book3D(item.asBook(), 96.dp, progress = item.fraction)
            Spacer(Modifier.width(20.dp))
            Column(Modifier.weight(1f)) {
                Text("READING NOW", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary, fontWeight = FontWeight.Bold)
                Text(item.title, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold, maxLines = 3, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 4.dp))
                item.authors.firstOrNull()?.let { Text(it, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                Spacer(Modifier.height(14.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Box(Modifier.weight(1f).height(8.dp).clip(CircleShape).background(MaterialTheme.colorScheme.surfaceContainerHighest)) {
                        Box(Modifier.fillMaxHeight().fillMaxWidth(item.fraction.toFloat().coerceIn(.02f, 1f)).clip(CircleShape).background(MaterialTheme.colorScheme.primary))
                    }
                    Text("${(item.fraction * 100).toInt()}%", style = MaterialTheme.typography.labelLarge, modifier = Modifier.padding(start = 10.dp))
                }
                if (more > 0) Text("$more more on the go", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.padding(top = 10.dp).clip(RoundedCornerShape(8.dp)).clickable(onClick = openShelf).padding(vertical = 4.dp))
            }
        }
    }
}

@Composable
private fun ShelfRow(title: String, content: androidx.compose.foundation.lazy.LazyListScope.() -> Unit) {
    Column(Modifier.padding(top = 28.dp)) {
        Text(title, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold, modifier = Modifier.padding(horizontal = 20.dp))
        LazyRow(contentPadding = PaddingValues(start = 20.dp, end = 20.dp, top = 18.dp, bottom = 4.dp), horizontalArrangement = Arrangement.spacedBy(16.dp), content = content)
    }
}

@Composable
private fun BookTile(book: Book, caption: String, progress: Double? = null, badge: (@Composable () -> Unit)? = null, onOpen: () -> Unit) {
    Column(Modifier.width(112.dp)) {
        Book3D(book, 104.dp, progress = progress, badge = badge, onOpen = onOpen)
        Text(book.title, style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.SemiBold, maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 12.dp))
        Text(caption, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

@Composable
private fun RankMark(n: Int) {
    Box(Modifier.size(28.dp).clip(RoundedCornerShape(14.dp, 14.dp, 14.dp, 6.dp)).background(MaterialTheme.colorScheme.primary), contentAlignment = Alignment.Center) {
        Text("$n", color = MaterialTheme.colorScheme.onPrimary, fontWeight = FontWeight.ExtraBold, fontSize = 14.sp)
    }
}

/* ── Search ─────────────────────────────────────────────────────────────── */

@Composable
fun BooksSearchScreen(books: Books, platform: app.kimono.data.Platform, back: () -> Unit) {
    var query by remember { mutableStateOf("") }
    var found by remember { mutableStateOf<List<Book>?>(null) }
    var looking by remember { mutableStateOf(false) }
    var open by remember { mutableStateOf<String?>(null) }
    val focus = remember { FocusRequester() }
    val snackbar = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()
    LaunchedEffect(Unit) { runCatching { focus.requestFocus() } }
    LaunchedEffect(query) {
        val q = query.trim()
        if (q.length < 2) { found = null; return@LaunchedEffect }
        kotlinx.coroutines.delay(320)
        looking = true
        found = runCatching { books.search(q) }.getOrElse { found }
        looking = false
    }
    Scaffold(snackbarHost = { SnackbarHost(snackbar) }) { pad ->
        Column(Modifier.fillMaxSize().padding(top = pad.calculateTopPadding())) {
            Surface(shape = RoundedCornerShape(28.dp), color = MaterialTheme.colorScheme.surfaceContainerHigh, modifier = Modifier.fillMaxWidth().padding(16.dp).height(56.dp)) {
                Row(Modifier.padding(horizontal = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                    Surface(onClick = back, shape = CircleShape, color = Color.Transparent, modifier = Modifier.size(44.dp)) {
                        Box(contentAlignment = Alignment.Center) { androidx.compose.material3.Icon(app.kimono.ui.inkIcon("back"), "Back", Modifier.size(22.dp), tint = MaterialTheme.colorScheme.onSurface) }
                    }
                    BasicTextField(query, { query = it }, singleLine = true, cursorBrush = SolidColor(MaterialTheme.colorScheme.primary),
                        textStyle = TextStyle(color = MaterialTheme.colorScheme.onSurface, fontSize = 17.sp),
                        modifier = Modifier.weight(1f).padding(horizontal = 6.dp).focusRequester(focus),
                        decorationBox = { inner -> Box { if (query.isEmpty()) Text("Title, author or ISBN", color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 17.sp); inner() } })
                    if (looking) InkLoader(size = 28.dp, modifier = Modifier.padding(end = 10.dp))
                }
            }
            val list = found
            when {
                list == null -> Text("Books, authors, or the ISBN on the back.", color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(24.dp))
                list.isEmpty() && !looking -> Text("Nothing for “${query.trim()}” yet. Books keeps looking.", color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(24.dp))
                else -> LazyVerticalGrid(GridCells.Adaptive(108.dp), contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 12.dp, bottom = 120.dp),
                    horizontalArrangement = Arrangement.spacedBy(14.dp), verticalArrangement = Arrangement.spacedBy(28.dp), modifier = Modifier.bottomChrome()) {
                    items(list, key = { it.key }) { b -> BookTile(b, caption = b.author) { open = b.key } }
                }
            }
        }
    }
    open?.let { key -> BookSheet(books, platform, key, onDismiss = { open = null }, onOpen = { open = it }, say = { msg -> scope.launch { snackbar.showSnackbar(msg) } }, changed = {}) }
}

/* ── My shelf ───────────────────────────────────────────────────────────── */

@Composable
fun BooksShelfScreen(books: Books, platform: app.kimono.data.Platform, openSearch: () -> Unit) {
    var shelf by remember { mutableStateOf<List<ShelfItem>?>(books.knownHome()?.shelf) }
    var only by remember { mutableStateOf<String?>(null) }
    var open by remember { mutableStateOf<String?>(null) }
    val snackbar = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()
    suspend fun load() { runCatching { books.shelf() }.onSuccess { shelf = it } }
    WhileShown(Unit) { load() }
    Scaffold(snackbarHost = { SnackbarHost(snackbar) }) { pad ->
        val list = shelf
        Column(Modifier.fillMaxSize().padding(top = pad.calculateTopPadding())) {
            Text("My shelf", style = MaterialTheme.typography.displaySmall, fontWeight = FontWeight.Bold, modifier = Modifier.padding(start = 20.dp, top = 20.dp, bottom = 12.dp))
            if (list == null) { Box(Modifier.fillMaxWidth().padding(64.dp), contentAlignment = Alignment.Center) { InkLoader(size = 48.dp) }; return@Column }
            if (list.isEmpty()) {
                Column(Modifier.fillMaxWidth().padding(32.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                    Text("Your shelf is empty", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                    Text("Books you want to read, are reading and have read live here, and on your profile.", color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(vertical = 10.dp))
                    PillButton("Find a book", filled = true, onClick = openSearch)
                }
                return@Column
            }
            LazyRow(contentPadding = PaddingValues(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                item { Chip("All ${list.size}", only == null) { only = null } }
                listOf("reading", "want", "read").forEach { s ->
                    val n = list.count { it.state == s }
                    if (n > 0) item { Chip("${Books.stateLabel(s)} $n", only == s) { only = s } }
                }
            }
            LazyVerticalGrid(GridCells.Adaptive(108.dp), contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 24.dp, bottom = 120.dp),
                horizontalArrangement = Arrangement.spacedBy(14.dp), verticalArrangement = Arrangement.spacedBy(28.dp)) {
                items(list.filter { only == null || it.state == only }, key = { it.key }) { s ->
                    BookTile(s.asBook(), caption = when { s.state == "reading" -> "${(s.fraction * 100).toInt()}% in"; s.rating != null -> Books.ratingLabel(s.rating); else -> Books.stateLabel(s.state) },
                        progress = if (s.state == "reading") s.fraction else null) { open = s.key }
                }
            }
        }
    }
    open?.let { key -> BookSheet(books, platform, key, onDismiss = { open = null }, onOpen = { open = it }, say = { msg -> scope.launch { snackbar.showSnackbar(msg) } }, changed = { scope.launch { load() } }) }
}

@Composable
private fun Chip(label: String, selected: Boolean, onClick: () -> Unit) {
    val corner by animateDpAsState(if (selected) 20.dp else 10.dp, spring(dampingRatio = .6f))
    Surface(onClick = onClick, shape = RoundedCornerShape(corner), color = if (selected) MaterialTheme.colorScheme.secondaryContainer else MaterialTheme.colorScheme.surfaceContainerHigh,
        contentColor = if (selected) MaterialTheme.colorScheme.onSecondaryContainer else MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.height(40.dp)) {
        Box(Modifier.padding(horizontal = 16.dp), contentAlignment = Alignment.Center) { Text(label, style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.SemiBold) }
    }
}

/* ── A book's sheet ─────────────────────────────────────────────────────── */

@Composable
fun BookSheet(books: Books, platform: app.kimono.data.Platform, key: String, onDismiss: () -> Unit, onOpen: (String) -> Unit, say: (String) -> Unit, changed: () -> Unit) {
    var page by remember(key) { mutableStateOf<BookPage?>(books.knownBook(key)) }
    var files by remember(key) { mutableStateOf<List<BookFile>?>(null) }
    var missing by remember(key) { mutableStateOf(false) }
    var fetching by remember(key) { mutableStateOf<Float?>(null) }
    var expanded by remember(key) { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    LaunchedEffect(key) {
        runCatching { books.book(key) }.onSuccess { page = it }.onFailure { if (page == null) say(it.message ?: "This book didn't open.") }
        files = runCatching { books.files(key) }.getOrElse { emptyList() }
    }
    InkSheet(onDismissRequest = onDismiss, seed = key, wash = false) {
        val p = page
        if (p == null) { Box(Modifier.fillMaxWidth().height(320.dp), contentAlignment = Alignment.Center) { InkLoader(size = 48.dp) }; return@InkSheet }
        val b = p.book
        Column(Modifier.verticalScroll(rememberScrollState()).padding(bottom = 24.dp)) {
            Row(Modifier.padding(start = 24.dp, end = 20.dp, top = 8.dp), verticalAlignment = Alignment.Top) {
                Book3D(b, 112.dp, still = true, progress = p.shelf?.takeIf { it.state == "reading" }?.fraction)
                Spacer(Modifier.width(20.dp))
                Column(Modifier.weight(1f)) {
                    if (b.genres.isNotEmpty()) Text(b.genres.take(2).joinToString(" · ").uppercase(), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.primary, fontWeight = FontWeight.Bold)
                    Text(b.title, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold, maxLines = 4, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 4.dp))
                    if (b.authors.isNotEmpty()) Text(b.authors.joinToString(", "), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 4.dp))
                    Row(Modifier.padding(top = 12.dp), horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                        b.rating?.let { Fact("★ ${(it * 10).toInt() / 10.0}", if (b.ratings > 0) Books.count(b.ratings) else "rating") }
                        if (b.readers > 0) Fact(Books.count(b.readers), "readers")
                        b.year?.let { Fact("$it", "first out") }
                        b.pages?.let { Fact("$it", "pages") }
                    }
                }
            }
            /* Read it here: the ink loader while Books looks for a copy, a plain word when there isn't one. */
            Row(Modifier.padding(start = 20.dp, end = 20.dp, top = 20.dp), horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
                val best = files?.firstOrNull { it.readable }
                PillButton(if (best?.sample == true) "Preview" else "Read", filled = best != null, modifier = Modifier.weight(1f), busy = files == null || fetching != null) {
                    if (best == null) { missing = true; return@PillButton }
                    scope.launch {
                        fetching = 0f
                        runCatching {
                            val path = books.download(best, platform.cacheDir()) { got -> fetching = best.size?.let { (got.toFloat() / it).coerceIn(0f, 1f) } ?: 0f }
                            platform.openFile(path, if (best.format == "pdf") "application/pdf" else "application/epub+zip")
                            if (p.shelf?.state != "reading" && p.shelf?.state != "read") { books.place(key, "reading"); page = p.copy(shelf = app.kimono.data.Mine("reading")); changed() }
                        }.onFailure { say(it.message ?: "That book didn't open.") }
                        fetching = null
                    }
                }
            }
            fetching?.let { f -> if (f > 0f) Box(Modifier.padding(horizontal = 24.dp, vertical = 8.dp).fillMaxWidth().height(4.dp).clip(CircleShape).background(MaterialTheme.colorScheme.surfaceContainerHighest)) {
                Box(Modifier.fillMaxHeight().fillMaxWidth(f).background(MaterialTheme.colorScheme.primary))
            } }
            AnimatedVisibility(missing) {
                Surface(shape = RoundedCornerShape(18.dp), color = MaterialTheme.colorScheme.tertiaryContainer, contentColor = MaterialTheme.colorScheme.onTertiaryContainer, modifier = Modifier.padding(start = 20.dp, end = 20.dp, top = 12.dp).fillMaxWidth()) {
                    Column(Modifier.padding(16.dp)) {
                        Text("Not here to read yet", fontWeight = FontWeight.Bold)
                        Text("Kimono has no copy of this book. Put it on your shelf and it'll be ready to open when one turns up.", style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(top = 4.dp))
                    }
                }
            }
            /* Want to read · Reading · Read: a connected group; the chosen one rounds out. */
            Row(Modifier.padding(start = 20.dp, end = 20.dp, top = 16.dp), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                listOf("want", "reading", "read").forEachIndexed { i, s ->
                    val on = p.shelf?.state == s
                    val outer = 24.dp
                    val inner by animateDpAsState(if (on) 24.dp else 8.dp, spring(dampingRatio = .55f))
                    Surface(onClick = {
                        scope.launch {
                            runCatching { books.place(key, if (on) null else s) }
                                .onSuccess { page = p.copy(shelf = if (on) null else app.kimono.data.Mine(s, if (s == "read") 1.0 else p.shelf?.fraction ?: 0.0, p.shelf?.rating)); changed(); say(if (on) "Taken off your shelf" else "${Books.stateLabel(s)} · ${b.title}") }
                                .onFailure { say("That didn't save.") }
                        }
                    }, shape = RoundedCornerShape(if (i == 0) outer else inner, if (i == 2) outer else inner, if (i == 2) outer else inner, if (i == 0) outer else inner),
                        color = if (on) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.surfaceContainerHighest,
                        contentColor = if (on) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.weight(if (on) 1.2f else 1f).height(52.dp)) {
                        Box(contentAlignment = Alignment.Center) { Text(Books.stateLabel(s), style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.SemiBold, maxLines = 1) }
                    }
                }
            }
            if (p.shelf?.state == "reading") {
                var at by remember(key, p.shelf.fraction) { mutableStateOf(p.shelf.fraction.toFloat()) }
                Row(Modifier.padding(horizontal = 20.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text("Where you are", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Slider(at, { at = it }, onValueChangeFinished = { scope.launch { runCatching { books.progress(key, at.toDouble()) }.onSuccess { r -> page = p.copy(shelf = app.kimono.data.Mine(r.state, r.fraction, p.shelf.rating)); changed() } } },
                        modifier = Modifier.weight(1f).padding(horizontal = 12.dp))
                    Text("${(at * 100).toInt()}%", style = MaterialTheme.typography.labelLarge)
                }
            }
            /* How was it? The same three as Watch. */
            Row(Modifier.padding(start = 20.dp, end = 20.dp, top = 16.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Text(p.shelf?.rating?.let { Books.ratingLabel(it) } ?: "How was it?", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.weight(1f))
                listOf("down" to "thumb-down", "up" to "thumb-up", "love" to "heart").forEach { (r, icon) ->
                    val on = p.shelf?.rating == r
                    val corner by animateDpAsState(if (on) 16.dp else 26.dp, spring(dampingRatio = .55f))
                    Surface(onClick = {
                        scope.launch { runCatching { books.rate(key, if (on) null else r) }.onSuccess { mine -> page = p.copy(shelf = mine); changed(); if (!on) say("${Books.ratingLabel(r)} · ${b.title}") } }
                    }, shape = RoundedCornerShape(corner), color = when { !on -> MaterialTheme.colorScheme.surfaceContainerHighest; r == "love" -> Color(0xFFA8475F); else -> MaterialTheme.colorScheme.primary },
                        contentColor = if (on) Color.White else MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(52.dp).semantics { contentDescription = Books.ratingLabel(r) }) {
                        Box(contentAlignment = Alignment.Center) {
                            if (icon == "heart") Text("\u2665", fontSize = 22.sp) else androidx.compose.material3.Icon(app.kimono.ui.inkIcon(icon), null, Modifier.size(24.dp))
                        }
                    }
                }
            }
            if (p.friends.isNotEmpty()) FriendsOn(p.friends)
            if (b.description.isNotBlank()) {
                Text(b.description, style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = if (expanded) Int.MAX_VALUE else 6, overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.padding(start = 24.dp, end = 24.dp, top = 24.dp).clickable { expanded = !expanded })
            }
            if (p.byAuthor.isNotEmpty()) ShelfStrip("More by ${b.author}", p.byAuthor, onOpen)
            if (p.similar.isNotEmpty()) ShelfStrip("If you like this", p.similar, onOpen)
        }
    }
}

@Composable
private fun Fact(value: String, label: String) {
    Column {
        Text(value, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold)
        Text(label, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun FriendsOn(friends: List<FriendOnBook>) {
    Surface(shape = RoundedCornerShape(22.dp), color = MaterialTheme.colorScheme.surfaceContainer, modifier = Modifier.padding(start = 16.dp, end = 16.dp, top = 20.dp).fillMaxWidth()) {
        Column(Modifier.padding(vertical = 8.dp)) {
            val loved = friends.count { it.rating == "love" }
            Text(if (friends.size == 1) "A friend has this" else "${friends.size} friends${if (loved > 0) " · $loved loved it" else ""}",
                style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold, modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp))
            friends.forEach { f ->
                Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                    Portrait(f.picture, f.name, f.username, 40.dp)
                    Text(f.name, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f).padding(horizontal = 12.dp))
                    Text(f.verdict, style = MaterialTheme.typography.labelLarge, color = if (f.rating == "love") Color(0xFFA8475F) else MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }
    }
}

@Composable
private fun ShelfStrip(title: String, list: List<Book>, onOpen: (String) -> Unit) {
    ShelfRow(title) { items(list, key = { it.key }) { b -> BookTile(b, caption = b.author) { onOpen(b.key) } } }
}

@Composable
private fun PillButton(label: String, filled: Boolean, modifier: Modifier = Modifier, busy: Boolean = false, onClick: () -> Unit) {
    val press = remember { MutableInteractionSource() }
    val pressed by press.collectIsPressedAsState()
    val corner by animateDpAsState(if (pressed) 14.dp else 26.dp, spring(dampingRatio = .55f))
    Surface(onClick = onClick, interactionSource = press, shape = RoundedCornerShape(corner),
        color = if (filled) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.secondaryContainer,
        contentColor = if (filled) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSecondaryContainer, modifier = modifier.height(52.dp)) {
        Row(Modifier.padding(horizontal = 22.dp), horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically) {
            if (busy) { InkLoader(size = 24.dp); Spacer(Modifier.width(10.dp)) }
            Text(label, style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.Bold)
        }
    }
}

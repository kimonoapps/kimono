@file:OptIn(ExperimentalMaterial3Api::class)

package app.kimono.screens

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.animateScrollBy
import androidx.compose.foundation.interaction.MutableInteractionSource
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
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import app.kimono.data.BookFile
import app.kimono.data.Books
import app.kimono.ui.InkLoader
import app.kimono.ui.InkSheet
import app.kimono.ui.inkIcon
import coil3.compose.AsyncImage
import kotlinx.coroutines.FlowPreview
import kotlinx.coroutines.flow.debounce
import kotlinx.coroutines.launch

/*
 * 本 Reading in Kimono, on the phone. The book comes a part at a time
 * (api/v1/books/epub): its package and the chapter you're on, then the next
 * one ahead of you, each kept on the phone. Chapters are laid out as native
 * text in Kimono's book face; tap an edge to turn a page, or scroll. Paper,
 * sepia or night; your place is kept as you read.
 */

/* ── The book's shape: its package, read from the EPUB's XML ───────────── */

private class Chapter(val href: String, val title: String, val weight: Int)
private class Epub(val title: String, val base: String, val chapters: List<Chapter>)

private sealed interface Block {
    class Heading(val level: Int, val text: AnnotatedString) : Block
    class Para(val text: AnnotatedString, val quote: Boolean = false, val bullet: Boolean = false) : Block
    class Image(val path: String) : Block
    data object Rule : Block
}

private fun attr(tag: String, name: String): String? = Regex("""\b$name\s*=\s*("([^"]*)"|'([^']*)')""", RegexOption.IGNORE_CASE).find(tag)?.let { it.groupValues[2].ifEmpty { it.groupValues[3] } }

private fun decode(text: String): String = text
    .replace(Regex("&#x([0-9a-fA-F]+);")) { it.groupValues[1].toIntOrNull(16)?.let { c -> codePoint(c) } ?: "" }
    .replace(Regex("&#(\\d+);")) { it.groupValues[1].toIntOrNull()?.let { c -> codePoint(c) } ?: "" }
    .replace("&nbsp;", " ").replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", "\"").replace("&apos;", "'").replace("&mdash;", "—").replace("&ndash;", "–").replace("&hellip;", "…").replace("&rsquo;", "’").replace("&lsquo;", "‘").replace("&rdquo;", "”").replace("&ldquo;", "“").replace("&amp;", "&")

private fun codePoint(c: Int): String = if (c < 0x10000) c.toChar().toString() else {
    val v = c - 0x10000
    charArrayOf(((v shr 10) + 0xD800).toChar(), ((v and 0x3FF) + 0xDC00).toChar()).concatToString()
}

/** Where `href` points, from a part at `from` (both paths inside the book). */
private fun resolve(from: String, href: String): String {
    val clean = href.substringBefore('#')
    if (clean.isEmpty()) return from
    val parts = from.substringBeforeLast('/', "").split('/').filter { it.isNotEmpty() }.toMutableList()
    for (seg in clean.split('/')) when (seg) { "", "." -> {} ; ".." -> if (parts.isNotEmpty()) parts.removeAt(parts.size - 1); else -> parts.add(seg) }
    return parts.joinToString("/")
}

private suspend fun loadEpub(books: Books, file: BookFile, cache: String, fallbackTitle: String): Epub {
    val container = books.epubPart(file.address, "META-INF/container.xml", cache).decodeToString()
    val opfPath = Regex("""full-path\s*=\s*"([^"]+)"""").find(container)?.groupValues?.get(1) ?: error("This book has no package.")
    val opf = books.epubPart(file.address, opfPath, cache).decodeToString()
    val manifest = Regex("""<item\b[^>]*>""", RegexOption.IGNORE_CASE).findAll(opf).mapNotNull { m ->
        val tag = m.value
        val id = attr(tag, "id") ?: return@mapNotNull null
        id to (resolve(opfPath, decode(attr(tag, "href") ?: return@mapNotNull null)) to (attr(tag, "properties") ?: ""))
    }.toMap()
    val spine = Regex("""<itemref\b[^>]*idref\s*=\s*["']([^"']+)["']""", RegexOption.IGNORE_CASE).findAll(opf).mapNotNull { manifest[it.groupValues[1]]?.first }.toList()
    /* Chapter names from the book's own contents page, when it has one. */
    val names = mutableMapOf<String, String>()
    manifest.values.firstOrNull { "nav" in it.second.split(' ') }?.first?.let { nav ->
        runCatching {
            val html = books.epubPart(file.address, nav, cache).decodeToString()
            Regex("""<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>(.*?)</a>""", setOf(RegexOption.IGNORE_CASE, RegexOption.DOT_MATCHES_ALL)).findAll(html).forEach {
                val target = resolve(nav, decode(it.groupValues[1]))
                names.getOrPut(target) { decode(it.groupValues[2].replace(Regex("<[^>]+>"), "")).trim() }
            }
        }
    }
    val title = Regex("""<dc:title[^>]*>(.*?)</dc:title>""", setOf(RegexOption.IGNORE_CASE, RegexOption.DOT_MATCHES_ALL)).find(opf)?.groupValues?.get(1)?.let { decode(it).trim() } ?: fallbackTitle
    val chapters = spine.mapIndexed { i, href -> Chapter(href, names[href] ?: "Part ${i + 1}", 1) }
    if (chapters.isEmpty()) error("This book has no chapters.")
    return Epub(title, opfPath, chapters)
}

/** A chapter's XHTML as blocks of styled text and images. Tolerant: books' markup varies a lot. */
private fun blocksOf(xhtml: String, path: String): List<Block> {
    val body = xhtml.substringAfter("<body", xhtml).substringAfter('>')
    val out = mutableListOf<Block>()
    val text = StringBuilder()
    val spans = mutableListOf<Triple<Int, Int, SpanStyle>>()
    val open = ArrayDeque<Pair<String, Int>>()
    var heading = 0
    var quote = 0
    var bullet = false
    var skip = 0
    fun flush() {
        val raw = text.toString()
        val trimmed = raw.trim()
        if (trimmed.isNotEmpty()) {
            val lead = raw.indexOf(trimmed)
            val styled = buildAnnotatedString {
                append(trimmed)
                for ((s, e, style) in spans) {
                    val a = (s - lead).coerceIn(0, trimmed.length)
                    val b = (e - lead).coerceIn(0, trimmed.length)
                    if (b > a) addStyle(style, a, b)
                }
            }
            out += if (heading > 0) Block.Heading(heading, styled) else Block.Para(styled, quote > 0, bullet)
        }
        text.clear(); spans.clear(); bullet = false
    }
    for (m in Regex("""<!--.*?-->|<[^>]+>|[^<]+""", RegexOption.DOT_MATCHES_ALL).findAll(body)) {
        val t = m.value
        if (t.startsWith("<!--")) continue
        if (!t.startsWith("<")) {
            if (skip == 0) text.append(decode(t).replace(Regex("\\s+"), " "))
            continue
        }
        val closing = t.startsWith("</")
        val name = Regex("""^</?\s*([a-zA-Z0-9:]+)""").find(t)?.groupValues?.get(1)?.lowercase()?.substringAfter(':') ?: continue
        val selfClosing = t.endsWith("/>")
        when (name) {
            "script", "style", "head", "title" -> if (!selfClosing) skip += if (closing) -1 else 1
            "h1", "h2", "h3", "h4", "h5", "h6" -> { flush(); heading = if (closing) 0 else name[1].digitToInt() }
            "p", "div", "section", "article", "figure", "figcaption", "tr", "dt", "dd", "header", "footer", "aside" -> flush()
            "li" -> { flush(); if (!closing) bullet = true }
            "blockquote" -> { flush(); quote += if (closing) -1 else 1 }
            "br" -> text.append('\n')
            "hr" -> { flush(); out += Block.Rule }
            "img", "image" -> {
                val src = attr(t, "src") ?: attr(t, "xlink:href") ?: attr(t, "href")
                if (src != null) { flush(); out += Block.Image(resolve(path, decode(src))) }
            }
            "em", "i", "cite", "dfn" -> if (closing) open.removeLastOrNull()?.let { spans += Triple(it.second, text.length, SpanStyle(fontStyle = FontStyle.Italic)) } else if (!selfClosing) open.addLast(name to text.length)
            "strong", "b" -> if (closing) open.removeLastOrNull()?.let { spans += Triple(it.second, text.length, SpanStyle(fontWeight = FontWeight.Bold)) } else if (!selfClosing) open.addLast(name to text.length)
            "sup", "sub", "small" -> if (closing) open.removeLastOrNull()?.let { spans += Triple(it.second, text.length, SpanStyle(fontSize = 11.sp)) } else if (!selfClosing) open.addLast(name to text.length)
        }
    }
    flush()
    return out
}

/* ── The reader ─────────────────────────────────────────────────────────── */

private enum class Paper(val label: String, val bg: Color, val ink: Color) {
    Paper("Paper", Color(0xFFFBF8F2), Color(0xFF2A2622)),
    Sepia("Sepia", Color(0xFFF1E6D0), Color(0xFF3D3125)),
    Night("Night", Color(0xFF1C1A18), Color(0xFFE2DCD2)),
}

@OptIn(FlowPreview::class)
@Composable
fun BookReader(books: Books, platform: app.kimono.data.Platform, bookKey: String, title: String, file: BookFile, startAt: Double, onClose: () -> Unit, onProgress: (Double) -> Unit) {
    val scope = rememberCoroutineScope()
    val cache = remember { platform.cacheDir() }
    var book by remember { mutableStateOf<Epub?>(null) }
    var problem by remember { mutableStateOf<String?>(null) }
    val chapters = remember { mutableStateMapOf<Int, List<Block>>() }
    var at by remember { mutableStateOf(0) }
    val night = app.kimono.theme.LocalNight.current
    var paper by remember { mutableStateOf(if (night) Paper.Night else Paper.Paper) }
    var size by remember { mutableStateOf(18) }
    var chrome by remember { mutableStateOf(true) }
    var contents by remember { mutableStateOf(false) }
    val list = rememberLazyListState()
    /* Where you opened, taken once: saving your place mustn't reopen the book. */
    val opening = remember { startAt }
    /* Your place is only saved once you've turned a page or scrolled: opening a book never moves it. */
    var moved by remember { mutableStateOf(false) }
    /* Set once the book has opened at your place; the jump there isn't you scrolling. */
    var settled by remember { mutableStateOf(false) }
    LaunchedEffect(list) { snapshotFlow { list.isScrollInProgress }.collect { if (it && settled) moved = true } }

    suspend fun chapter(i: Int): List<Block> {
        chapters[i]?.let { return it }
        val epub = book ?: return emptyList()
        val href = epub.chapters[i].href
        val blocks = blocksOf(books.epubPart(file.address, href, cache).decodeToString(), href)
        chapters[i] = blocks
        return blocks
    }

    LaunchedEffect(file.address) {
        runCatching { loadEpub(books, file, cache, title) }.onSuccess { epub ->
            book = epub
            val start = (opening * epub.chapters.size).toInt().coerceIn(0, epub.chapters.size - 1)
            at = start
            runCatching { chapter(start) }.onFailure { problem = it.message ?: "This chapter didn't open." }
            /* Within the chapter, where the fraction falls. */
            val within = opening * epub.chapters.size - start
            val blocks = chapters[start].orEmpty()
            if (within > 0 && blocks.isNotEmpty()) list.scrollToItem((within * blocks.size).toInt().coerceIn(0, blocks.size - 1))
            settled = true
            /* The next chapter, ahead of you. */
            if (start + 1 < epub.chapters.size) launch { runCatching { chapter(start + 1) } }
        }.onFailure { problem = it.message ?: "This book didn't open." }
    }

    /* Your place, a moment after the page settles: chapter, then how far through it. */
    LaunchedEffect(book, at, moved) {
        val epub = book ?: return@LaunchedEffect
        snapshotFlow { list.firstVisibleItemIndex to list.layoutInfo.totalItemsCount }
            .debounce(1500)
            .collect { (first, total) ->
                if (!moved || total == 0) return@collect
                val within = if (total > 1) first.toDouble() / (total - 1) else 0.0
                val fraction = ((at + within) / epub.chapters.size).coerceIn(0.0, 1.0)
                runCatching { books.progress(bookKey, fraction) }.onSuccess { onProgress(it.fraction) }
            }
    }

    fun go(i: Int) {
        val epub = book ?: return
        moved = true
        if (i !in epub.chapters.indices) return
        scope.launch {
            runCatching { chapter(i) }.onSuccess {
                at = i
                list.scrollToItem(0)
                if (i + 1 < epub.chapters.size) launch { runCatching { chapter(i + 1) } }
            }.onFailure { problem = it.message ?: "That chapter didn't open." }
        }
    }

    fun turn(forward: Boolean) {
        moved = true
        scope.launch {
            val info = list.layoutInfo
            val page = (info.viewportEndOffset - info.viewportStartOffset) * .9f
            val atEnd = !list.canScrollForward
            val atStart = !list.canScrollBackward
            when {
                forward && atEnd -> go(at + 1)
                !forward && atStart -> go(at - 1)
                else -> list.animateScrollBy(if (forward) page else -page)
            }
        }
    }

    /* Edge to edge: the page runs under the status bar and home indicator, its bars keep clear of them. */
    /* Jumps to a point in the book (0–1): the chapter it falls in, then how far through it. */
    fun seek(f: Float) {
        val epub = book ?: return
        moved = true
        val n = epub.chapters.size
        val i = (f * n).toInt().coerceIn(0, n - 1)
        val within = f * n - i
        scope.launch {
            runCatching { chapter(i) }.onSuccess { blocks ->
                at = i
                list.scrollToItem((within * blocks.size).toInt().coerceIn(0, (blocks.size - 1).coerceAtLeast(0)))
                if (i + 1 < n) launch { runCatching { chapter(i + 1) } }
            }
        }
    }

    Dialog(onDismissRequest = onClose, properties = app.kimono.ui.edgeToEdgeDialog()) {
        Box(Modifier.fillMaxSize().background(paper.bg)) {
            val epub = book
            val blocks = chapters[at]
            when {
                problem != null -> Text(problem!!, color = paper.ink, modifier = Modifier.align(Alignment.Center).padding(32.dp), textAlign = TextAlign.Center)
                epub == null || blocks == null -> Column(Modifier.align(Alignment.Center), horizontalAlignment = Alignment.CenterHorizontally) {
                    InkLoader(size = 56.dp)
                    Text("Opening $title", color = paper.ink.copy(alpha = .8f), fontSize = 17.sp, modifier = Modifier.padding(top = 16.dp))
                }
                /* Taps on the page itself (scrolling stays the page's): an edge turns the page, the middle shows and hides the bars. */
                else -> LazyColumn(state = list, modifier = Modifier.fillMaxSize().pointerInput(Unit) {
                    val wide = this.size.width.toFloat()
                    detectTapGestures { o ->
                        when {
                            o.x < wide * .25f -> turn(false)
                            o.x > wide * .75f -> turn(true)
                            else -> chrome = !chrome
                        }
                    }
                },
                    contentPadding = PaddingValues(start = 28.dp, end = 28.dp, top = 112.dp, bottom = 96.dp)) {
                    itemsIndexed(blocks) { _, block ->
                        when (block) {
                            is Block.Heading -> Text(block.text, color = paper.ink, fontWeight = FontWeight.Bold, fontSize = (size + (7 - block.level.coerceIn(1, 6)) * 2.5f).sp,
                                lineHeight = (size + (7 - block.level.coerceIn(1, 6)) * 2.5f).sp * 1.25f, modifier = Modifier.padding(top = 20.dp, bottom = 10.dp))
                            is Block.Para -> Row(Modifier.padding(bottom = 12.dp, start = if (block.quote) 18.dp else 0.dp)) {
                                if (block.bullet) Text("•  ", color = paper.ink, fontSize = size.sp)
                                Text(block.text, color = paper.ink.copy(alpha = if (block.quote) .85f else 1f), fontSize = size.sp, lineHeight = (size * 1.6f).sp,
                                    fontStyle = if (block.quote) FontStyle.Italic else FontStyle.Normal, textAlign = TextAlign.Start)
                            }
                            is Block.Image -> PartImage(books, file, block.path, cache, Modifier.padding(vertical = 14.dp).fillMaxWidth().heightIn(max = 420.dp))
                            Block.Rule -> Box(Modifier.padding(vertical = 22.dp).fillMaxWidth(), contentAlignment = Alignment.Center) {
                                Box(Modifier.width(48.dp).height(1.dp).background(paper.ink.copy(alpha = .3f)))
                            }
                        }
                    }
                    item {
                        if (at + 1 < epub.chapters.size) Surface(onClick = { go(at + 1) }, shape = RoundedCornerShape(24.dp), color = paper.ink.copy(alpha = .07f), contentColor = paper.ink,
                            modifier = Modifier.padding(top = 24.dp).fillMaxWidth().height(52.dp)) {
                            Box(contentAlignment = Alignment.Center) { Text("Next: ${epub.chapters[at + 1].title}", fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(horizontal = 20.dp)) }
                        } else Text("The end.", color = paper.ink.copy(alpha = .6f), fontSize = size.sp, modifier = Modifier.padding(top = 32.dp).fillMaxWidth(), textAlign = TextAlign.Center)
                    }
                }
            }
            /* The status bar always sits on the paper, never on the text. */
            Box(Modifier.align(Alignment.TopCenter).fillMaxWidth().background(paper.bg).statusBarsPadding())
            /* The bars: back, the chapter, contents and the page's look; how far in at the foot. */
            AnimatedVisibility(chrome, enter = fadeIn(), exit = fadeOut(), modifier = Modifier.align(Alignment.TopCenter)) {
                Row(Modifier.fillMaxWidth().background(paper.bg).statusBarsPadding().padding(horizontal = 8.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                    ReaderButton("back", "Close the book", paper.ink, onClose)
                    Column(Modifier.weight(1f).padding(horizontal = 6.dp)) {
                        Text(epub?.title ?: title, color = paper.ink, fontWeight = FontWeight.Bold, fontSize = 16.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        epub?.chapters?.getOrNull(at)?.let { Text(it.title, color = paper.ink.copy(alpha = .65f), fontSize = 13.sp, maxLines = 1, overflow = TextOverflow.Ellipsis) }
                    }
                    ReaderButton("list", "Contents", paper.ink) { contents = true }
                    Text("A", color = paper.ink, fontSize = 14.sp, fontWeight = FontWeight.Bold, modifier = Modifier.clip(CircleShape).clickable { size = (size - 1).coerceAtLeast(14) }.padding(12.dp))
                    Text("A", color = paper.ink, fontSize = 21.sp, fontWeight = FontWeight.Bold, modifier = Modifier.clip(CircleShape).clickable { size = (size + 1).coerceAtMost(28) }.padding(10.dp))
                    Box(Modifier.padding(start = 4.dp, end = 8.dp).size(26.dp).clip(CircleShape).background(paper.ink.copy(alpha = .14f)).clickable { paper = Paper.entries[(paper.ordinal + 1) % Paper.entries.size] }
                        .semantics { contentDescription = "Page: ${paper.label}" }, contentAlignment = Alignment.Center) {
                        Box(Modifier.size(18.dp).clip(CircleShape).background(Paper.entries[(paper.ordinal + 1) % Paper.entries.size].bg))
                    }
                }
            }
            if (epub != null) {
                val within = if (list.layoutInfo.totalItemsCount > 1) list.firstVisibleItemIndex.toFloat() / (list.layoutInfo.totalItemsCount - 1) else 0f
                val fraction = ((at + within) / epub.chapters.size).coerceIn(0f, 1f)
                Column(Modifier.align(Alignment.BottomCenter).fillMaxWidth().background(if (chrome) paper.bg else Color.Transparent).navigationBarsPadding()) {
                    AnimatedVisibility(chrome, enter = fadeIn(), exit = fadeOut()) {
                        /* With the bars up, one compact row: turn back, a bar to jump anywhere, turn on; where you are above it. */
                        Column(Modifier.padding(start = 12.dp, end = 12.dp, top = 6.dp, bottom = 2.dp)) {
                            var seeking by remember { mutableStateOf<Float?>(null) }
                            val showing = seeking ?: fraction
                            val chapterAt = ((showing * epub.chapters.size).toInt().coerceIn(0, epub.chapters.size - 1))
                            Text(if (seeking != null) epub.chapters[chapterAt].title else "Chapter ${chapterAt + 1} of ${epub.chapters.size} · ${(showing * 100).toInt()}%",
                                color = paper.ink.copy(alpha = .7f), fontSize = 12.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis,
                                modifier = Modifier.fillMaxWidth(), textAlign = TextAlign.Center)
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                TurnButton(forward = false, ink = paper.ink) { turn(false) }
                                androidx.compose.material3.Slider(showing, { seeking = it }, onValueChangeFinished = { seeking?.let { seek(it) }; seeking = null },
                                    colors = androidx.compose.material3.SliderDefaults.colors(thumbColor = paper.ink, activeTrackColor = paper.ink.copy(alpha = .7f), inactiveTrackColor = paper.ink.copy(alpha = .15f)),
                                    modifier = Modifier.weight(1f).padding(horizontal = 8.dp).height(32.dp))
                                TurnButton(forward = true, ink = paper.ink) { turn(true) }
                            }
                        }
                    }
                    /* Always: a thin line for how far in. */
                    if (!chrome) Row(Modifier.fillMaxWidth().padding(horizontal = 28.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                        Box(Modifier.weight(1f).height(3.dp).clip(CircleShape).background(paper.ink.copy(alpha = .1f))) {
                            Box(Modifier.fillMaxHeight().fillMaxWidth(fraction.coerceAtLeast(.01f)).background(paper.ink.copy(alpha = .4f)))
                        }
                        Text("${(fraction * 100).toInt()}%", color = paper.ink.copy(alpha = .45f), fontSize = 12.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(start = 12.dp))
                    }
                }
            }
        }
        if (contents && book != null) InkSheet(onDismissRequest = { contents = false }, seed = "contents", wash = false) {
            Text("Contents", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold, modifier = Modifier.padding(horizontal = 24.dp, vertical = 8.dp))
            LazyColumn(Modifier.heightIn(max = 520.dp), contentPadding = PaddingValues(bottom = 24.dp)) {
                itemsIndexed(book!!.chapters) { i, c ->
                    Row(Modifier.fillMaxWidth().clickable { contents = false; go(i) }.padding(horizontal = 24.dp, vertical = 14.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text(c.title, style = MaterialTheme.typography.bodyLarge, fontWeight = if (i == at) FontWeight.Bold else FontWeight.Normal,
                            color = if (i == at) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface, modifier = Modifier.weight(1f), maxLines = 2, overflow = TextOverflow.Ellipsis)
                        if (i == at) Text("Here", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary)
                    }
                }
            }
        }
    }
}

/** A big round button to turn the page. */
@Composable
private fun TurnButton(forward: Boolean, ink: Color, onClick: () -> Unit) {
    Box(Modifier.size(44.dp).clip(CircleShape).background(ink.copy(alpha = .08f)).clickable(onClick = onClick)
        .semantics { contentDescription = if (forward) "Next page" else "Previous page" }, contentAlignment = Alignment.Center) {
        Icon(inkIcon("back"), null, Modifier.size(20.dp).graphicsLayer { if (forward) rotationZ = 180f }, tint = ink)
    }
}

@Composable
private fun ReaderButton(icon: String, label: String, tint: Color, onClick: () -> Unit) {
    Box(Modifier.size(44.dp).clip(CircleShape).clickable(onClick = onClick).semantics { contentDescription = label }, contentAlignment = Alignment.Center) {
        Icon(inkIcon(icon), null, Modifier.size(22.dp), tint = tint)
    }
}

/** An image inside the book, fetched as a part and kept with the rest. */
@Composable
private fun PartImage(books: Books, file: BookFile, path: String, cache: String, modifier: Modifier) {
    var bytes by remember(path) { mutableStateOf<ByteArray?>(null) }
    LaunchedEffect(path) { bytes = runCatching { books.epubPart(file.address, path, cache) }.getOrNull() }
    bytes?.let { AsyncImage(model = it, contentDescription = null, contentScale = ContentScale.Fit, modifier = modifier) } ?: Spacer(Modifier.height(1.dp))
}

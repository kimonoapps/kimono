package app.kimono.screens

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateContentSize
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import app.kimono.ui.inkBleed
import app.kimono.ui.InkTitle
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.DisableSelection
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDirection
import androidx.compose.ui.text.withLink
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.kimono.data.Code
import app.kimono.data.Hadith
import app.kimono.data.QuranPassage
import app.kimono.data.QuranVerse
import app.kimono.data.Tafsir
import app.kimono.resources.Res
import app.kimono.resources.scheherazade_new
import app.kimono.ui.Seal
import kotlinx.coroutines.launch
import org.jetbrains.compose.resources.Font

/*
 * Quran and hadith as Kimono AI cites them, as on the website (scripture.tsx):
 * it writes only the reference in a ```quran or ```hadith block, and the chat
 * shows the real text from its source. The verses cited are in full ink, one
 * either side in grey; tapping a verse shows its translation (English or
 * French) under it, and the tafsirs open beneath. An ```islam-notice block is
 * the notice before the first answer on Islam, until it's accepted.
 */

/** The chat a reply is drawn in: the cards fetch through it, and accepting the notice asks in it. */
class ChatScope(val code: Code, val workspace: String)
val LocalChatScope = compositionLocalOf<ChatScope?> { null }

private val translators = mapOf("en" to "Saheeh International", "fr" to "Muhammad Hamidullah")
private fun firstLang(option: String?) = when (option) {
    "fr", "en" -> option
    else -> if (androidx.compose.ui.text.intl.Locale.current.language == "fr") "fr" else "en"
}
private fun arabicDigits(n: Int) = n.toString().map { "٠١٢٣٤٥٦٧٨٩"[it - '0'] }.joinToString("")

@Composable
private fun arabicFont() = FontFamily(Font(Res.font.scheherazade_new))

/** A ```quran, ```hadith or ```islam-notice block; until it's closed its reference may still be growing. */
@Composable
fun ScriptureBlock(lang: String, body: String, closed: Boolean) {
    val chat = LocalChatScope.current
    DisableSelection {
        when {
            chat == null -> Unit
            !closed -> if (lang != "islam-notice") Loading(null)
            lang == "islam-notice" -> IslamNotice(chat)
            lang == "quran" -> QuranCard(chat.code, body)
            else -> HadithCard(chat.code, body)
        }
    }
}

@Composable
private fun Card(content: @Composable () -> Unit) {
    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(MaterialTheme.colorScheme.surfaceContainerLow).padding(horizontal = 16.dp, vertical = 14.dp).animateContentSize()) { content() }
}

@Composable
private fun Loading(title: String?, failed: Boolean = false) = Card {
    if (title != null) Text(title, style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurface)
    if (failed) Text("This couldn't be loaded.", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 4.dp))
    else Column(Modifier.padding(top = if (title != null) 10.dp else 0.dp), verticalArrangement = Arrangement.spacedBy(10.dp), horizontalAlignment = Alignment.End) {
        Box(Modifier.fillMaxWidth().height(22.dp).clip(RoundedCornerShape(11.dp)).background(MaterialTheme.colorScheme.surfaceContainerHigh))
        Box(Modifier.fillMaxWidth(.62f).height(22.dp).clip(RoundedCornerShape(11.dp)).background(MaterialTheme.colorScheme.surfaceContainerHigh))
    }
}

@Composable
private fun Head(title: String, detail: String, arabic: String?, lang: String, langs: List<String>, setLang: (String) -> Unit) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        Text(buildAnnotatedString {
            withStyle(SpanStyle(fontWeight = FontWeight.Bold)) { append(title) }
            append("  ")
            withStyle(SpanStyle(color = MaterialTheme.colorScheme.onSurfaceVariant, fontFamily = FontFamily.Monospace, fontSize = 12.sp)) { append(detail) }
        }, style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurface)
        if (arabic != null) Text(arabic, fontFamily = arabicFont(), fontSize = 19.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Spacer(Modifier.weight(1f))
        if (langs.size > 1) Row(Modifier.clip(RoundedCornerShape(8.dp)).background(MaterialTheme.colorScheme.surfaceContainerHigh).padding(2.dp), horizontalArrangement = Arrangement.spacedBy(2.dp)) {
            langs.forEach { l ->
                val on = l == lang
                Text(l.uppercase(), style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.Bold,
                    color = if (on) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.clip(RoundedCornerShape(6.dp)).background(if (on) MaterialTheme.colorScheme.surfaceContainerLowest else MaterialTheme.colorScheme.surfaceContainerHigh)
                        .clickable { setLang(l) }.padding(horizontal = 10.dp, vertical = 5.dp))
            }
        }
    }
}

/* The translation of what was tapped, under the Arabic: a phone's stand-in for the website's hover. */
@Composable
private fun Translation(text: String?, source: String?) {
    AnimatedVisibility(text != null) {
        Column(Modifier.fillMaxWidth().padding(top = 10.dp).clip(RoundedCornerShape(12.dp)).background(MaterialTheme.colorScheme.surfaceContainerHighest).padding(horizontal = 14.dp, vertical = 10.dp)) {
            Text(text.orEmpty(), style = MaterialTheme.typography.bodyMedium.copy(lineHeight = 22.sp), color = MaterialTheme.colorScheme.onSurface)
            if (source != null) Text(source, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 6.dp))
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun QuranCard(code: Code, body: String) {
    val parts = body.trim().split(Regex("\\s+"))
    val ref = parts.firstOrNull().orEmpty()
    val inverted = "translation" in parts.drop(1)
    val passage by produceState<Result<QuranPassage>?>(null, ref) { value = runCatching { code.quran(ref) } }
    var lang by remember { mutableStateOf(firstLang(parts.drop(1).firstOrNull { it == "en" || it == "fr" })) }
    var open by remember { mutableStateOf<String?>(null) }
    var reading by remember { mutableStateOf(false) }
    val p = passage?.getOrNull()
    if (p == null) { Loading("Quran ${ref.replace("-", "–")}", failed = passage?.isFailure == true); return }
    val label = p.ref.replace("-", "–")
    Card {
        Head(p.chapter.name, label, p.chapter.arabic, lang, listOf("en", "fr")) { lang = it }
        if (inverted) Text(translators[lang].orEmpty(), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 2.dp))
        Column(Modifier.fillMaxWidth().padding(top = 6.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            p.before.forEach { VerseLine(it, context = true, open = open == it.key, lang = lang, inverted = inverted) { open = if (open == it.key) null else it.key } }
            p.verses.forEach { VerseLine(it, context = false, open = open == it.key, lang = lang, inverted = inverted) { open = if (open == it.key) null else it.key } }
            p.after.forEach { VerseLine(it, context = true, open = open == it.key, lang = lang, inverted = inverted) { open = if (open == it.key) null else it.key } }
        }
        HorizontalDivider(Modifier.padding(top = 10.dp, bottom = 10.dp), color = MaterialTheme.colorScheme.outlineVariant)
        Text("Tafsir  ›", style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onSurface,
            modifier = Modifier.clip(RoundedCornerShape(8.dp)).background(MaterialTheme.colorScheme.surfaceContainerHigh).clickable { reading = true }.padding(horizontal = 14.dp, vertical = 9.dp))
    }
    if (reading) TafsirSheet(code, p, lang) { reading = false }
}

/* One verse a line: the cited ones large, the ones around them smaller and dimmed; a tap shows its translation under it. */
@Composable
private fun VerseLine(v: QuranVerse, context: Boolean, open: Boolean, lang: String, inverted: Boolean, toggle: () -> Unit) {
    val scheme = MaterialTheme.colorScheme
    if (inverted) {
        /* translation first: the meaning is the text, a tap shows the Arabic */
        Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).background(if (open) scheme.secondaryContainer.copy(alpha = .6f) else androidx.compose.ui.graphics.Color.Transparent).clickable(onClick = toggle).padding(horizontal = 6.dp, vertical = 4.dp)) {
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Text(v.number.toString(), style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.Bold, color = if (context) scheme.onSurfaceVariant else scheme.primary, modifier = Modifier.padding(top = 3.dp))
                Text(v.translation[lang].orEmpty(), modifier = Modifier.alpha(if (context && !open) .62f else 1f), maxLines = if (context && !open) 2 else Int.MAX_VALUE, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis,
                    style = (if (context) MaterialTheme.typography.bodyMedium else MaterialTheme.typography.bodyLarge).copy(lineHeight = if (context) 21.sp else 26.sp, color = if (context) scheme.onSurfaceVariant else scheme.onSurface))
            }
            AnimatedVisibility(open) {
                Column(Modifier.fillMaxWidth().padding(top = 6.dp, bottom = 6.dp)) {
                    Text(v.arabic, style = TextStyle(fontFamily = arabicFont(), fontSize = 23.sp, lineHeight = 44.sp, textDirection = TextDirection.Rtl, textAlign = TextAlign.Right, color = scheme.onSurface), modifier = Modifier.fillMaxWidth())
                    Text(v.key, style = MaterialTheme.typography.labelSmall, color = scheme.onSurfaceVariant)
                }
            }
        }
        return
    }
    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).background(if (open) scheme.secondaryContainer.copy(alpha = .6f) else androidx.compose.ui.graphics.Color.Transparent).clickable(onClick = toggle).padding(horizontal = 6.dp, vertical = 2.dp)) {
        Text(buildAnnotatedString {
            append(v.arabic); append("  ")
            withStyle(SpanStyle(color = if (context) scheme.onSurfaceVariant else scheme.primary, fontSize = if (context) 14.sp else 17.sp)) { append("(${arabicDigits(v.number)})") }
        }, modifier = Modifier.fillMaxWidth().alpha(if (context && !open) .62f else 1f), maxLines = if (context && !open) 2 else Int.MAX_VALUE, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis,
            style = TextStyle(fontFamily = arabicFont(), fontSize = if (context) 19.sp else 27.sp, lineHeight = if (context) 36.sp else 54.sp, textDirection = TextDirection.Rtl, textAlign = TextAlign.Right, color = if (context) scheme.onSurfaceVariant else scheme.onSurface))
        AnimatedVisibility(open) {
            Column(Modifier.fillMaxWidth().padding(top = 2.dp, bottom = 8.dp)) {
                Text(v.translation[lang].orEmpty(), style = MaterialTheme.typography.bodyMedium.copy(lineHeight = 22.sp), color = scheme.onSurface)
                Text("${v.key} · ${translators[lang]}", style = MaterialTheme.typography.labelSmall, color = scheme.onSurfaceVariant, modifier = Modifier.padding(top = 4.dp))
            }
        }
    }
}

private fun span(keys: List<String>) = if (keys.size > 1) "${keys.first()}–${keys.last().substringAfter(':')}" else keys.firstOrNull().orEmpty()

/* The tafsirs on a passage, full screen: they run long. Which tafsir, and all the verses or one. */
@Composable
private fun TafsirSheet(code: Code, p: QuranPassage, lang: String, close: () -> Unit) {
    val ids = p.tafsirs.map { it.id }
    var id by remember { mutableStateOf(lastTafsir?.takeIf { it in ids } ?: ids.first()) }
    var only by remember { mutableStateOf<String?>(null) }
    val cited = p.verses.map { it.key }
    val scheme = MaterialTheme.colorScheme
    androidx.compose.ui.window.Dialog(onDismissRequest = close, properties = androidx.compose.ui.window.DialogProperties(usePlatformDefaultWidth = false)) {
        androidx.compose.material3.Surface(color = scheme.surfaceContainerLow, modifier = Modifier.fillMaxSize()) {
            Column(Modifier.fillMaxSize().windowInsetsPadding(androidx.compose.foundation.layout.WindowInsets.Companion.safeDrawing)) {
                Column(Modifier.fillMaxWidth().inkBleed("tafsir:${p.ref}").padding(start = 20.dp, end = 8.dp, top = 12.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        InkTitle("Tafsir", modifier = Modifier.weight(1f))
                        androidx.compose.material3.IconButton(onClick = close) { androidx.compose.material3.Icon(app.kimono.ui.kimonoIcon("close"), "Close") }
                    }
                    Text("${p.chapter.name} ${p.ref.replace("-", "–")}", style = MaterialTheme.typography.labelLarge, color = scheme.onSurfaceVariant, modifier = Modifier.padding(top = 2.dp))
                }
                Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 12.dp, vertical = 6.dp), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    p.tafsirs.forEach { t ->
                        val on = t.id == id
                        Column(Modifier.clip(RoundedCornerShape(8.dp)).clickable { id = t.id; lastTafsir = t.id }.padding(horizontal = 10.dp, vertical = 8.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                            Text(t.name + if (t.lang == "ar") "  ·  عربي" else "", style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.Bold, color = if (on) scheme.onSurface else scheme.onSurfaceVariant)
                            Box(Modifier.padding(top = 6.dp).height(3.dp).width(28.dp).clip(RoundedCornerShape(2.dp)).background(if (on) scheme.primary else androidx.compose.ui.graphics.Color.Transparent))
                        }
                    }
                }
                if (cited.size > 1) Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 20.dp, vertical = 4.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    (listOf<String?>(null) + cited).forEach { k ->
                        val on = only == k
                        Text(k?.substringAfter(':') ?: "All", style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.Bold,
                            color = if (on) scheme.onSecondaryContainer else scheme.onSurfaceVariant,
                            modifier = Modifier.clip(RoundedCornerShape(8.dp)).background(if (on) scheme.secondaryContainer else scheme.surfaceContainerHighest).clickable { only = k }.padding(horizontal = 14.dp, vertical = 8.dp))
                    }
                }
                HorizontalDivider(color = scheme.outlineVariant, modifier = Modifier.padding(top = 6.dp))
                val keys = only?.let { listOf(it) } ?: cited
                androidx.compose.foundation.lazy.LazyColumn(Modifier.fillMaxSize(), contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 20.dp, vertical = 16.dp), verticalArrangement = Arrangement.spacedBy(20.dp)) {
                    keys.forEachIndexed { n, k -> item(key = "$id-$k") { TafsirSection(code, id, k, p, keys, lang, first = n == 0) } }
                }
            }
        }
    }
}

/* Kept for the screen's life: the tafsir last read opens first. */
private var lastTafsir: Int? = null

/* One tafsir on the verses it explains together: those verses, then its words. A group already shown under an earlier verse isn't shown again. */
@Composable
private fun TafsirSection(code: Code, id: Int, key: String, p: QuranPassage, cited: List<String>, lang: String, first: Boolean) {
    val loaded by produceState<Result<Tafsir>?>(null, id, key) { value = runCatching { code.tafsir(id, key) } }
    val t = loaded?.getOrNull()
    val scheme = MaterialTheme.colorScheme
    if (loaded == null) { if (first) Box(Modifier.fillMaxWidth().height(120.dp).clip(RoundedCornerShape(16.dp)).background(scheme.surfaceContainerHigh)); return }
    if (t == null) { Text("The tafsir on $key couldn't be loaded.", color = scheme.onSurfaceVariant); return }
    val opener = t.covers.firstOrNull { it in cited }
    if (opener != null && opener != key) return
    val covers = t.covers.ifEmpty { listOf(key) }
    val all = p.before + p.verses + p.after
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(scheme.surfaceContainerHigh).padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(span(covers), style = MaterialTheme.typography.labelMedium, fontFamily = FontFamily.Monospace, color = scheme.onSurfaceVariant)
            covers.mapNotNull { c -> all.firstOrNull { it.key == c } }.forEach { v ->
                Text(v.arabic + "  (" + arabicDigits(v.number) + ")", style = TextStyle(fontFamily = arabicFont(), fontSize = 23.sp, lineHeight = 44.sp, textDirection = TextDirection.Rtl, textAlign = TextAlign.Right, color = scheme.onSurface), modifier = Modifier.fillMaxWidth())
                Text(v.translation[lang].orEmpty(), style = MaterialTheme.typography.bodyMedium.copy(lineHeight = 21.sp), color = scheme.onSurfaceVariant)
            }
        }
        if (t.parts.isEmpty()) Text("${t.name} has nothing on ${span(covers)}.", color = scheme.onSurfaceVariant)
        val rtl = t.lang == "ar"
        val arabic = TextStyle(fontFamily = arabicFont(), fontSize = 21.sp, lineHeight = 40.sp, textDirection = TextDirection.Rtl, textAlign = TextAlign.Right, color = scheme.onSurface)
        val body = MaterialTheme.typography.bodyLarge.copy(lineHeight = 27.sp, color = scheme.onSurface)
        t.parts.forEach { part ->
            when {
                part.kind == "h" -> Text(part.text, style = MaterialTheme.typography.titleMedium, color = scheme.onSurface, modifier = Modifier.padding(top = 6.dp))
                part.kind == "gloss" -> Text(buildAnnotatedString {
                    withStyle(SpanStyle(fontFamily = arabicFont(), fontSize = 22.sp, color = scheme.onSurface)) { append(part.ar.orEmpty()) }
                    append(" "); append(part.text)
                }, style = body.copy(color = scheme.onSurfaceVariant))
                part.kind == "ar" || rtl -> Text(part.text, style = arabic, modifier = Modifier.fillMaxWidth())
                else -> Text(part.text, style = body)
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun HadithCard(code: Code, body: String) {
    val parts = body.trim().split(Regex("\\s+"))
    val book = parts.getOrNull(0).orEmpty()
    val number = parts.getOrNull(1)?.toIntOrNull() ?: 0
    val loaded by produceState<Result<Hadith>?>(null, book, number) { value = runCatching { code.hadith(book, number) } }
    var lang by remember { mutableStateOf(firstLang(parts.drop(2).firstOrNull { it == "en" || it == "fr" })) }
    val inverted = "translation" in parts.drop(2)
    var open by remember { mutableStateOf(false) }
    val h = loaded?.getOrNull()
    if (h == null) { Loading("$book $number", failed = loaded?.isFailure == true); return }
    val langs = listOf("en", "fr").filter { !h.translation[it].isNullOrBlank() }
    val shown = if (h.translation[lang].isNullOrBlank()) "en" else lang
    val translation = h.translation[shown].orEmpty()
    Card {
        Head(h.bookName, h.number.toString(), null, shown, langs) { lang = it }
        if (h.chapter != null) Text(h.chapter, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 2.dp))
        if (inverted && h.arabic.isNotBlank()) {
            Text(translation, style = MaterialTheme.typography.bodyLarge.copy(lineHeight = 26.sp), color = MaterialTheme.colorScheme.onSurface,
                modifier = Modifier.fillMaxWidth().padding(top = 8.dp).clip(RoundedCornerShape(8.dp)).background(if (open) MaterialTheme.colorScheme.secondaryContainer else androidx.compose.ui.graphics.Color.Transparent).clickable { open = !open })
            AnimatedVisibility(open) {
                Text(h.arabic, style = TextStyle(fontFamily = arabicFont(), fontSize = 20.sp, lineHeight = 40.sp, textDirection = TextDirection.Rtl, textAlign = TextAlign.Right, color = MaterialTheme.colorScheme.onSurface), modifier = Modifier.fillMaxWidth().padding(top = 10.dp))
            }
        } else if (h.arabic.isNotBlank()) {
            Text(h.arabic, modifier = Modifier.fillMaxWidth().padding(top = 8.dp).clip(RoundedCornerShape(8.dp))
                .background(if (open) MaterialTheme.colorScheme.secondaryContainer else androidx.compose.ui.graphics.Color.Transparent).clickable { open = !open },
                style = TextStyle(fontFamily = arabicFont(), fontSize = 20.sp, lineHeight = 40.sp, textDirection = TextDirection.Rtl, textAlign = TextAlign.Right, color = MaterialTheme.colorScheme.onSurface))
            Translation(if (open) translation else null, null)
        } else Text(translation, style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurface, modifier = Modifier.padding(top = 6.dp))
        if (h.grades.isNotEmpty()) {
            HorizontalDivider(Modifier.padding(top = 12.dp, bottom = 10.dp), color = MaterialTheme.colorScheme.outlineVariant)
            FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                h.grades.forEach { g ->
                    Text(buildAnnotatedString { withStyle(SpanStyle(fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onSurface)) { append(g.grade) }; append(" "); append(g.name) },
                        style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.clip(RoundedCornerShape(8.dp)).background(MaterialTheme.colorScheme.surfaceContainerHigh).padding(horizontal = 10.dp, vertical = 5.dp))
                }
            }
        }
    }
}

/* Asked once a screen; accepted, it stays so for good (kept on the person's account). */
private var noticeAccepted: Boolean? = null

@Composable
private fun IslamNotice(chat: ChatScope) {
    var seen by remember { mutableStateOf(noticeAccepted) }
    var saving by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    LaunchedEffect(Unit) { if (seen == null) seen = runCatching { chat.code.noticeSeen("islam") }.getOrDefault(true).also { if (it) noticeAccepted = true } }
    if (seen != false) return
    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(MaterialTheme.colorScheme.secondaryContainer).padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        val color = MaterialTheme.colorScheme.onSecondaryContainer
        val body = MaterialTheme.typography.bodyMedium.copy(lineHeight = 21.sp, color = color)
        Text("Before you ask about Islam", style = MaterialTheme.typography.titleSmall, color = color)
        Text("Use Kimono AI like a search engine, not a scholar. It doesn't give fiqh rulings of its own: it shows what the madhabs and scholars have said, with their sources. AI can still forget something, leave it out or narrow the scope, so stay vigilant and check what matters with a scholar you trust. We take many precautions against mistakes, but we can't guarantee there are none.", style = body)
        Text("If anything looks wrong or suspicious, give it a thumbs down straight away.", style = body)
        Seal("I understand", busy = saving, compact = true, modifier = Modifier.padding(top = 4.dp), onClick = {
            saving = true
            scope.launch {
                /* accepting sends the question on: the reply waited for it */
                runCatching { chat.code.seeNotice("islam") }.onSuccess {
                    noticeAccepted = true; seen = true
                    runCatching { chat.code.ask(chat.workspace, "I understand. Please answer my question now.", emptyList()) }
                }
                saving = false
            }
        })
    }
}

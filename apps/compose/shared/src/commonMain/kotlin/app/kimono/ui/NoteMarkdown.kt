@file:OptIn(androidx.compose.foundation.ExperimentalFoundationApi::class)

package app.kimono.ui

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.text.input.InputTransformation
import androidx.compose.foundation.text.input.OutputTransformation
import androidx.compose.foundation.text.input.TextFieldBuffer
import androidx.compose.foundation.text.input.TextFieldState
import androidx.compose.foundation.text.input.delete
import androidx.compose.foundation.text.input.insert
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathMeasure
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.sp

/*
 * 筆 A note's body stays Markdown and takes its look where it's typed: headings,
 * bold, italics, lists, quotes, code and links styled in place, the markup
 * itself faded to the outline colour. Checkboxes are drawn over their
 * brackets as ink rings; pictures stay as their words, and HTML is only text.
 */

/** Where a checkbox's brackets are, whether it's ticked, and where its line ends. */
data class NoteCheck(val at: Int, val checked: Boolean, val lineEnd: Int)

/** A link's words and where it goes. */
data class NoteLink(val start: Int, val end: Int, val url: String)

class NoteLook(
    val text: Color, val mark: Color, val accent: Color, val quiet: Color, val code: Color, val headline: FontFamily?,
)

class NoteSpans(val styles: List<Triple<SpanStyle, Int, Int>>, val checks: List<NoteCheck>, val links: List<NoteLink>)

private val heading = Regex("^(#{1,6})[ \\t]+")
private val item = Regex("^([ \\t]*)([-*+]|\\d{1,3}[.)])[ \\t]+(\\[[ xX]\\][ \\t]?)?")
private val quote = Regex("^[ \\t]*>[ \\t]?")
private val fence = Regex("^[ \\t]*(```|~~~)")
private val inlines = listOf(
    Regex("`[^`\\n]+`") to "code",
    Regex("!?\\[([^\\]\\n]*)\\]\\(([^)\\s]*)\\)") to "link",
    Regex("(\\*\\*|__)(?=\\S)(.+?)(?<=\\S)\\1") to "bold",
    Regex("(?<![*\\w])([*_])(?=\\S)([^*_\\n]+?)(?<=\\S)\\1(?![*\\w])") to "italic",
    Regex("~~(?=\\S)(.+?)(?<=\\S)~~") to "strike",
)

/** How [text] should look, line by line. */
fun noteSpans(text: CharSequence, look: NoteLook): NoteSpans {
    val styles = mutableListOf<Triple<SpanStyle, Int, Int>>()
    val checks = mutableListOf<NoteCheck>()
    val links = mutableListOf<NoteLink>()
    val faded = SpanStyle(color = look.mark)
    val mono = SpanStyle(fontFamily = FontFamily.Monospace, fontSize = 14.sp, color = look.code)
    fun add(style: SpanStyle, start: Int, end: Int) { if (end > start) styles += Triple(style, start, end) }
    var inFence = false
    var start = 0
    val all = text.toString()
    while (start <= all.length) {
        val end = all.indexOf('\n', start).let { if (it < 0) all.length else it }
        val line = all.substring(start, end)
        when {
            fence.containsMatchIn(line) -> { add(faded, start, end); inFence = !inFence }
            inFence -> add(mono, start, end)
            else -> {
                var body = 0
                heading.find(line)?.let { m ->
                    val level = m.groupValues[1].length
                    add(faded, start, start + m.range.last + 1)
                    val size = when (level) { 1 -> 26.sp; 2 -> 22.sp; 3 -> 19.sp; else -> 17.sp }
                    add(SpanStyle(fontSize = size, fontWeight = FontWeight.Bold, fontFamily = if (level <= 2) look.headline else null), start + m.range.last + 1, end)
                    body = m.range.last + 1
                }
                if (body == 0) quote.find(line)?.let { m ->
                    add(faded, start, start + m.range.last + 1)
                    add(SpanStyle(fontStyle = FontStyle.Italic, color = look.quiet), start + m.range.last + 1, end)
                    body = m.range.last + 1
                }
                if (body == 0) item.find(line)?.let { m ->
                    val marker = m.groups[2]!!.range
                    add(SpanStyle(color = look.accent, fontWeight = FontWeight.Bold), start + marker.first, start + marker.last + 1)
                    m.groups[3]?.let { box ->
                        val at = start + box.range.first
                        val checked = line[box.range.first + 1] != ' '
                        /* The brackets give way to the ink ring drawn over them. */
                        /* Monospaced, so "[ ]" and "[x]" are the same width and the ring stays put as it's ticked. */
                        add(SpanStyle(color = Color.Transparent, fontFamily = FontFamily.Monospace), at, at + 3)
                        if (checked) add(SpanStyle(color = look.mark), at + 3, end)
                        checks += NoteCheck(at, checked, end)
                    }
                    body = m.range.last + 1
                }
                inline(line, start, body, look, faded, mono, links, ::add)
            }
        }
        start = end + 1
    }
    return NoteSpans(styles, checks, links)
}

private fun inline(line: String, offset: Int, from: Int, look: NoteLook, faded: SpanStyle, mono: SpanStyle, links: MutableList<NoteLink>, add: (SpanStyle, Int, Int) -> Unit) {
    val taken = BooleanArray(line.length)
    for ((pattern, kind) in inlines) {
        for (m in pattern.findAll(line, from.coerceAtMost(line.length))) {
            if ((m.range.first..m.range.last).any { taken[it] }) continue
            val s = offset + m.range.first
            val e = offset + m.range.last + 1
            when (kind) {
                "code" -> { add(mono, s, e); add(faded, s, s + 1); add(faded, e - 1, e) }
                "link" -> {
                    val words = m.groups[1]!!.range
                    val picture = m.value.startsWith("!")
                    add(faded, s, offset + words.first)
                    add(faded, offset + words.last + 1, e)
                    if (!picture) {
                        add(SpanStyle(color = look.accent, textDecoration = TextDecoration.Underline), offset + words.first, offset + words.last + 1)
                        links += NoteLink(s, e, m.groupValues[2])
                    } else add(SpanStyle(color = look.quiet, fontStyle = FontStyle.Italic), offset + words.first, offset + words.last + 1)
                }
                "bold" -> { val w = m.groupValues[1].length; add(SpanStyle(fontWeight = FontWeight.Bold), s, e); add(faded, s, s + w); add(faded, e - w, e) }
                "italic" -> { add(SpanStyle(fontStyle = FontStyle.Italic), s, e); add(faded, s, s + 1); add(faded, e - 1, e) }
                "strike" -> { add(SpanStyle(textDecoration = TextDecoration.LineThrough), s + 2, e - 2); add(faded, s, s + 2); add(faded, e - 2, e) }
            }
            for (i in m.range) taken[i] = true
        }
    }
}

/** Styles the body as it's drawn; the text itself stays as typed. */
fun noteOutput(look: NoteLook) = OutputTransformation {
    noteSpans(asCharSequence(), look).styles.forEach { (style, s, e) -> if (e <= length) addStyle(style, s, e) }
}

/**
 * A new line after a list item starts the next one ("- ", "- [ ] ", "2. ");
 * a new line on an empty item ends the list instead.
 */
val noteInput = InputTransformation {
    val changes = this.changes
    if (changes.changeCount != 1) return@InputTransformation
    val range = changes.getRange(0)
    if (range.length != 1 || asCharSequence()[range.start] != '\n' || changes.getOriginalRange(0).length != 0) return@InputTransformation
    val text = asCharSequence().toString()
    val lineStart = text.lastIndexOf('\n', range.start - 1).let { if (it < 0) 0 else it + 1 }
    val line = text.substring(lineStart, range.start)
    val m = item.find(line) ?: return@InputTransformation
    if (line.trim() == m.value.trim()) {
        /* An empty item: Return leaves the list. */
        delete(lineStart, range.start + 1)
        placeCursorBeforeCharAt(lineStart)
        return@InputTransformation
    }
    val marker = m.groupValues[2]
    val next = marker.toIntOrNull()?.let { "${it + 1}." } ?: marker.takeIf { it.length == 1 } ?: marker.dropLast(1).toIntOrNull()?.let { "${it + 1}${marker.last()}" } ?: marker
    val prefix = m.groupValues[1] + next + " " + (if (m.groups[3] != null) "[ ] " else "")
    insert(range.end, prefix)
    placeCursorBeforeCharAt(range.end + prefix.length)
}

/* ── the keyboard row's edits ── */

private fun TextFieldBuffer.lineAt(at: Int): IntRange {
    val text = asCharSequence()
    var s = at.coerceIn(0, length)
    while (s > 0 && text[s - 1] != '\n') s--
    var e = at.coerceIn(0, length)
    while (e < length && text[e] != '\n') e++
    return s until e
}

/** Swaps the line's leading markup for [prefix], or takes it away when it already has it. */
private fun TextFieldBuffer.setPrefix(prefix: (String) -> String?) {
    val line = lineAt(selection.start)
    val text = asCharSequence().substring(line.first, line.last + 1)
    val now = heading.find(text) ?: item.find(text)
    val old = now?.value ?: ""
    val want = prefix(old) ?: ""
    val keep = selection.start - line.first - old.length
    replace(line.first, line.first + old.length, want)
    val at = (line.first + want.length + keep).coerceIn(line.first + want.length, length)
    selection = TextRange(at)
}

fun TextFieldState.toggleChecklist() = edit { setPrefix { old -> if (old.contains("[")) null else "- [ ] " } }
fun TextFieldState.toggleList() = edit { setPrefix { old -> if (old.isNotEmpty() && !old.startsWith("#") && !old.contains("[")) null else "- " } }
fun TextFieldState.cycleHeading() = edit {
    setPrefix { old -> when (old.trim()) { "#" -> "## "; "##" -> "### "; "###" -> null; else -> "# " } }
}
fun TextFieldState.toggleBold() = edit {
    val s = selection
    if (s.collapsed) { insert(s.start, "****"); selection = TextRange(s.start + 2) }
    else { insert(s.end, "**"); insert(s.start, "**"); selection = TextRange(s.start + 2, s.end + 2) }
}

/** Ticks or unticks the checkbox whose brackets start at [at]. */
fun TextFieldState.toggleCheck(at: Int) = edit {
    if (at + 2 >= length || asCharSequence()[at] != '[') return@edit
    val ticked = asCharSequence()[at + 1] != ' '
    val keep = selection
    replace(at + 1, at + 2, if (ticked) " " else "x")
    selection = keep
}

/* ── the ink ring over a checkbox ── */

private val tickPath: Path by lazy { PathParser().parsePathString("M31 52 L44 64 L70 35").toPath() }

/** A checkbox in a note: an open brushed ring, and once ticked an ink tick drawn on a spring. */
@Composable
fun InkCheck(checked: Boolean, ring: Color, ink: Color, seed: String, modifier: Modifier = Modifier) {
    val marks = remember(seed) {
        val random = InkRandom(inkSeed(seed))
        val open = inkBrush(inkRing(random, 38f, .18f), random, 6f, closed = false, lift = null)
        val blot = inkBlot(random, 50f, 50f, 34f, lobes = 8, low = .94f, high = 1.04f)
        open to blot
    }
    val drawn by animateFloatAsState(if (checked) 1f else 0f, spring(dampingRatio = .55f, stiffness = 380f))
    val measure = remember { PathMeasure().apply { setPath(tickPath, false) } }
    Canvas(modifier) {
        inBox {
            drawPath(marks.first, ring, alpha = .7f)
            if (drawn > 0f) {
                drawPath(marks.second, ink, alpha = .12f * drawn.coerceIn(0f, 1f))
                val part = Path()
                measure.getSegment(0f, measure.length * drawn.coerceIn(0f, 1f), part, true)
                drawPath(part, ink, style = androidx.compose.ui.graphics.drawscope.Stroke(width = 9f, cap = androidx.compose.ui.graphics.StrokeCap.Round, join = androidx.compose.ui.graphics.StrokeJoin.Round))
            }
        }
    }
}

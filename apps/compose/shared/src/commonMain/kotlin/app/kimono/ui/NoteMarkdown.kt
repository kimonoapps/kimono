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
 * 筆 A note's body stays Markdown and reads as it will look: markup shows
 * only where the caret is (bold, italic, code and link markers when it
 * touches the span; heading and quote markers when it's on the line; code
 * fences while it's in the block). Bullets are drawn as dots, checkboxes as
 * ink rings; numbers stay. Pictures stay as their words, and HTML is only text.
 */

/** A checkbox: which line it's on, where its brackets are, and whether it's ticked. */
data class NoteCheck(val line: Int, val at: Int, val checked: Boolean)

/** A bullet, drawn as a dot over its marker: filled at even depths, a ring at odd ones. */
data class NoteBullet(val at: Int, val depth: Int)

/** A link's words and where it goes. */
data class NoteLink(val start: Int, val end: Int, val url: String)

class NoteLook(
    val text: Color, val mark: Color, val faint: Color, val link: Color, val accent: Color, val quiet: Color, val code: Color, val codeBack: Color, val headline: FontFamily?,
)

/**
 * How the body looks: the styles to lay over it, what to draw (rings, dots,
 * quote bars, by line start), and the formatting at the caret for the format bar.
 */
class NoteSpans(
    val styles: List<Triple<SpanStyle, Int, Int>>, val checks: List<NoteCheck>, val links: List<NoteLink>,
    val bullets: List<NoteBullet>, val quotes: List<IntRange>, val formats: Set<String>,
    /** Inline code, drawn as a chip behind its words. */
    val chips: List<IntRange> = emptyList(),
)

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

/* Markup that isn't being edited takes no room at all. */
private val gone = SpanStyle(color = Color.Transparent, fontSize = 0.01.sp, letterSpacing = 0.sp)

/** How [text] should look with the caret at [caret] (null: nowhere, so all markup hides). */
fun noteSpans(text: CharSequence, look: NoteLook, caret: TextRange? = null): NoteSpans {
    val styles = mutableListOf<Triple<SpanStyle, Int, Int>>()
    val checks = mutableListOf<NoteCheck>()
    val links = mutableListOf<NoteLink>()
    val bullets = mutableListOf<NoteBullet>()
    val quotes = mutableListOf<IntRange>()
    val chips = mutableListOf<IntRange>()
    val formats = mutableSetOf<String>()
    val faded = SpanStyle(color = look.mark)
    val mono = SpanStyle(fontFamily = FontFamily.Monospace, fontSize = 14.08.sp, color = look.code)
    fun add(style: SpanStyle, start: Int, end: Int) { if (end > start) styles += Triple(style, start, end) }
    val all = text.toString()
    val at = caret?.let { minOf(it.start, it.end) }
    /* Code blocks first: their fences show only while the caret is inside. */
    val blocks = mutableListOf<IntRange>()
    run {
        var start = 0
        var open: Int? = null
        while (start <= all.length) {
            val end = all.indexOf('\n', start).let { if (it < 0) all.length else it }
            if (fence.containsMatchIn(all.substring(start, end))) {
                if (open == null) open = start else { blocks += open!!..end; open = null }
            }
            start = end + 1
        }
        open?.let { blocks += it..all.length }
    }
    var start = 0
    var lineNo = 0
    while (start <= all.length) {
        val end = all.indexOf('\n', start).let { if (it < 0) all.length else it }
        val line = all.substring(start, end)
        val here = at != null && at in start..end
        val block = blocks.firstOrNull { start in it }
        when {
            block != null -> {
                val inBlock = at != null && at in block
                if (fence.containsMatchIn(line)) add(if (inBlock) faded else gone, start, end)
                else add(mono, start, end)
                if (here) formats += "code"
            }
            else -> {
                var body = 0
                heading.find(line)?.let { m ->
                    val level = m.groupValues[1].length
                    add(if (here) faded else gone, start, start + m.range.last + 1)
                    /* The mockup's heading: 1.3em Mincho 600; smaller levels step down from it. */
                    val size = when (level) { 1 -> 20.8.sp; 2 -> 18.sp; else -> 16.sp }
                    add(SpanStyle(fontSize = size, fontWeight = FontWeight.SemiBold, fontFamily = look.headline), start + m.range.last + 1, end)
                    body = m.range.last + 1
                    if (here) formats += "h$level"
                }
                if (body == 0) quote.find(line)?.let { m ->
                    /* Off the line the marker keeps its room, as the quote's indent, and a bar is drawn beside it. */
                    /* Off the line the marker keeps its room, about 14 in, and a bar is drawn beside it. */
                    add(if (here) faded else SpanStyle(color = Color.Transparent), start, start + m.range.last + 1)
                    add(SpanStyle(fontStyle = FontStyle.Italic, color = look.quiet), start + m.range.last + 1, end)
                    quotes += start..end
                    body = m.range.last + 1
                    if (here) formats += "quote"
                }
                if (body == 0) item.find(line)?.let { m ->
                    val marker = m.groups[2]!!.range
                    val depth = m.groupValues[1].replace("\t", "  ").length / 2
                    val box = m.groups[3]
                    when {
                        box != null -> {
                            /* "- " takes no room, so the ring stands where the marker was. */
                            add(gone, start + marker.first, start + box.range.first)
                            val bracket = start + box.range.first
                            val checked = line[box.range.first + 1] != ' '
                            /* Monospaced, so "[ ]" and "[x]" are the same width and the ring stays put: 1.2em wide, the ring's room. */
                            add(SpanStyle(color = Color.Transparent, fontFamily = FontFamily.Monospace, fontSize = 10.67.sp, letterSpacing = 0.sp), bracket, bracket + 3)
                            if (checked) add(SpanStyle(color = look.faint), bracket + 3, end)
                            checks += NoteCheck(lineNo, bracket, checked)
                            if (here) formats += "check"
                        }
                        m.groups[2]!!.value.first().isDigit() -> {
                            add(SpanStyle(color = look.quiet), start + marker.first, start + marker.last + 1)
                            if (here) formats += "number"
                        }
                        else -> {
                            /* The dash keeps its room, invisible and widened to 1.1em with its space; its dot is drawn over it. */
                            add(SpanStyle(color = Color.Transparent, letterSpacing = 5.sp), start + marker.first, start + marker.last + 1)
                            bullets += NoteBullet(start + marker.first, depth)
                            if (here) formats += "bullet"
                        }
                    }
                    body = m.range.last + 1
                }
                inline(line, start, body, look, faded, mono, links, chips, at, formats, ::add)
            }
        }
        start = end + 1
        lineNo++
    }
    return NoteSpans(styles, checks, links, bullets, quotes, formats, chips)
}

private fun inline(
    line: String, offset: Int, from: Int, look: NoteLook, faded: SpanStyle, mono: SpanStyle, links: MutableList<NoteLink>, chips: MutableList<IntRange>,
    at: Int?, formats: MutableSet<String>, add: (SpanStyle, Int, Int) -> Unit,
) {
    val taken = BooleanArray(line.length)
    for ((pattern, kind) in inlines) {
        for (m in pattern.findAll(line, from.coerceAtMost(line.length))) {
            if ((m.range.first..m.range.last).any { taken[it] }) continue
            val s = offset + m.range.first
            val e = offset + m.range.last + 1
            /* Its markers come back while the caret touches the span. */
            val touched = at != null && at in s..e
            val mark = if (touched) faded else gone
            if (touched) formats += kind
            when (kind) {
                "code" -> { add(mono, s, e); chips += (s + 1) until (e - 1); add(mark, s, s + 1); add(mark, e - 1, e) }
                "link" -> {
                    val words = m.groups[1]!!.range
                    val picture = m.value.startsWith("!")
                    add(if (picture) faded else mark, s, offset + words.first)
                    add(if (picture) faded else mark, offset + words.last + 1, e)
                    if (!picture) {
                        add(SpanStyle(color = look.link, textDecoration = TextDecoration.Underline), offset + words.first, offset + words.last + 1)
                        links += NoteLink(s, e, m.groupValues[2])
                    } else add(SpanStyle(color = look.quiet, fontStyle = FontStyle.Italic), offset + words.first, offset + words.last + 1)
                }
                "bold" -> { val w = m.groupValues[1].length; add(SpanStyle(fontWeight = FontWeight.Bold), s, e); add(mark, s, s + w); add(mark, e - w, e) }
                "italic" -> { add(SpanStyle(fontStyle = FontStyle.Italic), s, e); add(mark, s, s + 1); add(mark, e - 1, e) }
                "strike" -> { add(SpanStyle(textDecoration = TextDecoration.LineThrough), s + 2, e - 2); add(mark, s, s + 2); add(mark, e - 2, e) }
            }
            for (i in m.range) taken[i] = true
        }
    }
}

/** Styles the body as it's drawn, following the caret in [state]; the text itself stays as typed. */
fun noteOutput(look: NoteLook, state: TextFieldState, focused: () -> Boolean) = OutputTransformation {
    noteSpans(asCharSequence(), look, if (focused()) state.selection else null).styles.forEach { (style, s, e) -> if (e <= length) addStyle(style, s, e) }
}

/*
 * Typing: a new line after a list item or quote starts the next one, and an
 * empty one ends it; "[] " at a line's start becomes a checkbox; Backspace
 * right after a marker takes the marker away.
 */
private val marker = Regex("^([-*+]|\\d{1,3}[.)]|[-*+] \\[[ xX]\\]|>|#{1,6})$")

val noteInput = InputTransformation {
    val changes = this.changes
    if (changes.changeCount != 1) return@InputTransformation
    val range = changes.getRange(0)
    val original = changes.getOriginalRange(0)
    val text = asCharSequence().toString()
    /* Backspace: the space after a marker gone, so the marker goes too. */
    if (range.length == 0 && original.length == 1) {
        if (originalText[original.start] != ' ') return@InputTransformation
        val p = range.start
        val lineStart = text.lastIndexOf('\n', p - 1).let { if (it < 0) 0 else it + 1 }
        val before = text.substring(lineStart, p)
        val indent = before.length - before.trimStart().length
        if (p > lineStart && marker.matches(before.trimStart())) {
            delete(lineStart + indent, p)
            placeCursorBeforeCharAt(lineStart + indent)
        }
        return@InputTransformation
    }
    if (original.length != 0 || range.length != 1) return@InputTransformation
    val typed = asCharSequence()[range.start]
    val lineStart = text.lastIndexOf('\n', range.start - 1).let { if (it < 0) 0 else it + 1 }
    /* "[] " becomes a checkbox. */
    if (typed == ' ' && text.substring(lineStart, range.end).trimStart() == "[] ") {
        val indent = text.substring(lineStart, range.end).takeWhile { it == ' ' || it == '\t' }.length
        replace(lineStart + indent, range.end, "- [ ] ")
        placeCursorBeforeCharAt(lineStart + indent + 6)
        return@InputTransformation
    }
    if (typed != '\n') return@InputTransformation
    val line = text.substring(lineStart, range.start)
    val q = quote.find(line)
    val m = item.find(line)
    val prefixed = m ?: q ?: return@InputTransformation
    if (line.trim() == prefixed.value.trim()) {
        /* An empty item or quote line: Return leaves the list. */
        delete(lineStart, range.start + 1)
        placeCursorBeforeCharAt(lineStart)
        return@InputTransformation
    }
    val prefix = if (m != null) {
        val bullet = m.groupValues[2]
        val next = bullet.toIntOrNull()?.let { "${it + 1}." } ?: bullet.takeIf { it.length == 1 } ?: bullet.dropLast(1).toIntOrNull()?.let { "${it + 1}${bullet.last()}" } ?: bullet
        m.groupValues[1] + next + " " + (if (m.groups[3] != null) "[ ] " else "")
    } else q!!.value.let { if (it.endsWith(" ")) it else "$it " }
    insert(range.end, prefix)
    placeCursorBeforeCharAt(range.end + prefix.length)
}

/* ── the format bar's and keyboard's edits ── */

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
    val now = heading.find(text) ?: item.find(text) ?: quote.find(text)
    val old = now?.value ?: ""
    val want = prefix(old) ?: ""
    val keep = selection.start - line.first - old.length
    replace(line.first, line.first + old.length, want)
    val at = (line.first + want.length + keep).coerceIn(line.first + want.length, length)
    selection = TextRange(at)
}

fun TextFieldState.toggleChecklist() = edit { setPrefix { old -> if (old.contains("[")) null else "- [ ] " } }
fun TextFieldState.toggleList() = edit { setPrefix { old -> if (old.trim().let { it == "-" || it == "*" || it == "+" }) null else "- " } }
fun TextFieldState.toggleNumbered() = edit { setPrefix { old -> if (old.trim().firstOrNull()?.isDigit() == true) null else "1. " } }
/** H1, H2, H3, then plain. */
fun TextFieldState.cycleHeading() = edit {
    setPrefix { old -> when (old.trim()) { "#" -> "## "; "##" -> "### "; "###" -> null; else -> "# " } }
}
fun TextFieldState.setHeading(level: Int) = edit {
    setPrefix { old -> if (old.trim() == "#".repeat(level)) null else "#".repeat(level) + " " }
}

/**
 * Wraps the selection in [mark] (** for bold, * italic, ` code), or with
 * nothing selected unwraps the span the caret is in, or steps out of it when
 * the caret is at its end, or starts a new one.
 */
private fun TextFieldState.wrap(mark: String, kind: String) = edit {
    val s = selection
    if (!s.collapsed) {
        insert(s.max, mark); insert(s.min, mark)
        selection = TextRange(s.min + mark.length, s.max + mark.length)
        return@edit
    }
    val line = lineAt(s.start)
    val lineText = asCharSequence().substring(line.first, line.last + 1)
    val pattern = inlines.first { it.second == kind }.first
    val span = pattern.findAll(lineText).map { (line.first + it.range.first)..(line.first + it.range.last + 1) }.firstOrNull { s.start in it }
    when {
        span == null -> { insert(s.start, mark + mark); selection = TextRange(s.start + mark.length) }
        /* At its end: step out. */
        s.start >= span.last - mark.length -> selection = TextRange(span.last)
        else -> {
            replace(span.last - mark.length, span.last, "")
            replace(span.first, span.first + mark.length, "")
            selection = TextRange((s.start - mark.length).coerceIn(span.first, span.last - 2 * mark.length))
        }
    }
}

fun TextFieldState.toggleBold() = wrap("**", "bold")
fun TextFieldState.toggleItalic() = wrap("*", "italic")
fun TextFieldState.toggleCode() = wrap("`", "code")

/** A link: the selection becomes its words and the caret goes to the address; with nothing selected, to the words. */
fun TextFieldState.makeLink() = edit {
    val s = selection
    if (!s.collapsed) {
        insert(s.max, "]()"); insert(s.min, "[")
        selection = TextRange(s.max + 3)
    } else {
        insert(s.start, "[]()")
        selection = TextRange(s.start + 1)
    }
}

/** Ticks or unticks the checkbox on [line], found by reading that line as it is now. */
fun TextFieldState.toggleCheckOn(line: Int) = edit {
    val all = asCharSequence().toString()
    var start = 0
    repeat(line) { start = all.indexOf('\n', start).let { if (it < 0) return@edit else it + 1 } }
    val end = all.indexOf('\n', start).let { if (it < 0) all.length else it }
    val m = item.find(all.substring(start, end)) ?: return@edit
    val box = m.groups[3] ?: return@edit
    val at = start + box.range.first + 1
    val ticked = all[at] != ' '
    val keep = selection
    replace(at, at + 1, if (ticked) " " else "x")
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

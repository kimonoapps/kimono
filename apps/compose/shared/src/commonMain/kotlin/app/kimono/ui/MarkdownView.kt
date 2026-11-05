package app.kimono.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.withLink
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.kimono.theme.Kata

/*
 * A Markdown file, read, as Drive's drawer on the website (markdown.tsx):
 * headings, paragraphs, lists and task lists, quotes, rules, tables and fenced
 * code, with bold, italic, inline code and links. Raw HTML stays as words, and
 * pictures stay as their alt text, so reading a file never reaches another site.
 */

private sealed interface Block {
    data class Heading(val level: Int, val text: String) : Block
    data class Paragraph(val text: String) : Block
    data class Item(val ordered: Int?, val depth: Int, val checked: Boolean?, val text: String) : Block
    data class Quote(val text: String) : Block
    data class Code(val lang: String, val text: String) : Block
    data class Table(val head: List<String>, val rows: List<List<String>>) : Block
    data object Rule : Block
}

private val bullet = Regex("^(\\s*)([-*+]|(\\d+)[.)])\\s+(.*)$")
private val task = Regex("^\\[([ xX])]\\s+(.*)$")
private fun cells(line: String) = line.trim().removePrefix("|").removeSuffix("|").split("|").map { it.trim() }

private fun parse(source: String): List<Block> {
    val lines = source.replace("\r\n", "\n").split("\n")
    val out = mutableListOf<Block>()
    val paragraph = StringBuilder()
    fun flush() { if (paragraph.isNotBlank()) out += Block.Paragraph(paragraph.toString().trim()); paragraph.clear() }
    var i = 0
    while (i < lines.size) {
        val line = lines[i]
        val trimmed = line.trim()
        when {
            trimmed.startsWith("```") || trimmed.startsWith("~~~") -> {
                flush()
                val fence = trimmed.take(3); val lang = trimmed.drop(3).trim()
                val body = mutableListOf<String>()
                i++
                while (i < lines.size && !lines[i].trim().startsWith(fence)) { body += lines[i]; i++ }
                out += Block.Code(lang, body.joinToString("\n"))
            }
            trimmed.isEmpty() -> flush()
            Regex("^#{1,6}\\s").containsMatchIn(trimmed) -> { flush(); val level = trimmed.takeWhile { it == '#' }.length; out += Block.Heading(level, trimmed.drop(level).trim().trimEnd('#').trim()) }
            Regex("^([-*_])(\\s*\\1){2,}$").matches(trimmed) -> { flush(); out += Block.Rule }
            trimmed.startsWith(">") -> {
                flush()
                val body = mutableListOf<String>()
                while (i < lines.size && lines[i].trim().startsWith(">")) { body += lines[i].trim().removePrefix(">").trim(); i++ }
                out += Block.Quote(body.joinToString(" ")); continue
            }
            trimmed.startsWith("|") && i + 1 < lines.size && Regex("^\\|?\\s*:?-{2,}").containsMatchIn(lines[i + 1].trim()) -> {
                flush()
                val head = cells(line); i += 2
                val rows = mutableListOf<List<String>>()
                while (i < lines.size && lines[i].trim().startsWith("|")) { rows += cells(lines[i]); i++ }
                out += Block.Table(head, rows); continue
            }
            bullet.matches(line) -> {
                flush()
                val m = bullet.find(line)!!
                val rest = m.groupValues[4]
                val t = task.find(rest)
                out += Block.Item(m.groupValues[3].toIntOrNull(), m.groupValues[1].length / 2, t?.let { it.groupValues[1].isNotBlank() }, t?.groupValues?.get(2) ?: rest)
            }
            else -> { if (paragraph.isNotEmpty()) paragraph.append(' '); paragraph.append(trimmed) }
        }
        i++
    }
    flush()
    return out
}

private val inline = Regex("`([^`]+)`|!\\[([^\\]]*)]\\([^)]*\\)|\\[([^\\]]+)]\\(([^)\\s]+)[^)]*\\)|\\*\\*(.+?)\\*\\*|__(.+?)__|\\*(.+?)\\*|(?<![\\w])_(.+?)_(?![\\w])|~~(.+?)~~")

private fun safeLink(url: String) = url.startsWith("https://") || url.startsWith("http://") || url.startsWith("mailto:")

private fun AnnotatedString.Builder.inlineText(text: String, accent: Color) {
    var at = 0
    for (m in inline.findAll(text)) {
        if (m.range.first > at) append(text.substring(at, m.range.first))
        val g = m.groupValues
        when {
            g[1].isNotEmpty() -> withStyle(SpanStyle(fontFamily = FontFamily.Monospace, background = Color(0x14000000), fontSize = 13.sp)) { append(g[1]) }
            m.value.startsWith("![") -> withStyle(SpanStyle(fontStyle = FontStyle.Italic, color = Kata.inkSoft)) { append(g[2]) }
            g[3].isNotEmpty() -> if (safeLink(g[4])) withLink(LinkAnnotation.Url(g[4], TextLinkStyles(SpanStyle(color = accent, textDecoration = TextDecoration.Underline)))) { inlineText(g[3], accent) } else inlineText(g[3], accent)
            g[5].isNotEmpty() || g[6].isNotEmpty() -> withStyle(SpanStyle(fontWeight = FontWeight.SemiBold)) { inlineText(g[5].ifEmpty { g[6] }, accent) }
            g[7].isNotEmpty() || g[8].isNotEmpty() -> withStyle(SpanStyle(fontStyle = FontStyle.Italic)) { inlineText(g[7].ifEmpty { g[8] }, accent) }
            g[9].isNotEmpty() -> withStyle(SpanStyle(textDecoration = TextDecoration.LineThrough)) { inlineText(g[9], accent) }
        }
        at = m.range.last + 1
    }
    if (at < text.length) append(text.substring(at))
}

@Composable
private fun Inline(text: String, style: androidx.compose.ui.text.TextStyle, modifier: Modifier = Modifier) {
    val accent = LocalInkTint.current ?: Kata.suo
    val built = remember(text, accent) { buildAnnotatedString { inlineText(text, accent) } }
    Text(built, style = style, modifier = modifier)
}

/** A Markdown file's words, typeset on paper; scrolls, and its words can be selected. */
@Composable
fun MarkdownView(text: String, modifier: Modifier = Modifier) {
    val blocks = remember(text) { parse(text) }
    val type = MaterialTheme.typography
    val body = type.bodyLarge.copy(color = Kata.ink, lineHeight = 24.sp)
    val accent = LocalInkTint.current ?: Kata.suo
    Box(modifier.background(MaterialTheme.colorScheme.surfaceContainerLowest).verticalScroll(rememberScrollState())) {
        SelectionContainer {
            Column(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 18.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                for (block in blocks) when (block) {
                    is Block.Heading -> Inline(block.text, when (block.level) {
                        1 -> type.headlineMedium; 2 -> type.headlineSmall; 3 -> type.titleLarge; else -> type.titleMedium
                    }.copy(color = Kata.plum), Modifier.padding(top = if (block.level <= 2) 10.dp else 4.dp))
                    is Block.Paragraph -> Inline(block.text, body)
                    is Block.Item -> Row(Modifier.padding(start = (block.depth * 18).dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        if (block.checked != null) Box(
                            Modifier.padding(top = 3.dp).size(18.dp)
                                .background(if (block.checked) accent else Color.Transparent, RoundedCornerShape(5.dp))
                                .border(1.5.dp, if (block.checked) accent else Kata.hairDeep, RoundedCornerShape(5.dp)),
                            contentAlignment = Alignment.Center,
                        ) { if (block.checked) Icon(kimonoIcon("check"), null, tint = Color.White, modifier = Modifier.size(13.dp)) }
                        else Text(if (block.ordered != null) "${block.ordered}." else "•", style = body.copy(color = Kata.inkSoft), modifier = Modifier.widthIn(min = 16.dp))
                        Inline(block.text, if (block.checked == true) body.copy(color = Kata.inkSoft, textDecoration = TextDecoration.LineThrough) else body)
                    }
                    is Block.Quote -> Row(Modifier.height(IntrinsicSize.Min)) {
                        Box(Modifier.width(3.dp).fillMaxHeight().background(Kata.hair, RoundedCornerShape(2.dp)))
                        Inline(block.text, body.copy(color = Kata.inkSoft), Modifier.padding(start = 12.dp))
                    }
                    is Block.Code -> Box(Modifier.fillMaxWidth().background(Urushi, RoundedCornerShape(14.dp)).padding(vertical = 12.dp)) {
                        CodeLines(block.text, "x.${block.lang.ifEmpty { "txt" }}")
                    }
                    is Block.Table -> Column(Modifier.horizontalScroll(rememberScrollState()).border(1.dp, Kata.hair, RoundedCornerShape(10.dp))) {
                        val columns = block.head.size
                        (listOf(block.head) + block.rows).forEachIndexed { r, row ->
                            Row(Modifier.background(if (r == 0) MaterialTheme.colorScheme.surfaceContainer else Color.Transparent)) {
                                for (c in 0 until columns) Inline(row.getOrElse(c) { "" }, type.bodyMedium.copy(color = Kata.ink, fontWeight = if (r == 0) FontWeight.SemiBold else null), Modifier.width(120.dp).padding(horizontal = 10.dp, vertical = 7.dp))
                            }
                        }
                    }
                    Block.Rule -> Box(Modifier.fillMaxWidth().padding(vertical = 6.dp).height(1.dp).background(Kata.hair))
                }
            }
        }
    }
}

/** Whether [name] is Markdown, read rather than shown as text. */
fun isMarkdown(name: String) = name.substringAfterLast('.', "").lowercase() in setOf("md", "markdown", "mdx")

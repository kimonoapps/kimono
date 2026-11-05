package app.kimono.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/*
 * Code on the phone, as Drive's drawer on the web (peek.tsx): numbered lines and
 * a light highlighter (comments, strings, numbers, keywords) that fits every
 * language well enough for reading. Plain text files get the same page, uncoloured.
 */

private class Language(val name: String, val line: List<String> = emptyList(), val block: Pair<String, String>? = null, val keywords: String = "")

private val cLike = listOf("//") to ("/*" to "*/")
private const val JS = "const let var function return if else for while do switch case break continue new class extends import from export default async await try catch finally throw typeof instanceof in of this super null undefined true false void yield static get set interface type enum implements as readonly public private protected declare keyof"

private val languages: Map<String, Language> = buildMap {
    fun add(exts: String, language: Language) = exts.split(" ").forEach { put(it, language) }
    fun c(name: String, keywords: String) = Language(name, cLike.first, cLike.second, keywords)
    fun hash(name: String, keywords: String) = Language(name, listOf("#"), null, keywords)
    add("js mjs cjs jsx", c("JavaScript", JS))
    add("ts mts cts tsx", c("TypeScript", JS))
    add("go", c("Go", "package import func return if else for range switch case default break continue go defer chan select struct interface map type var const nil true false"))
    add("rs", c("Rust", "fn let mut pub use mod struct enum impl trait for in if else match loop while return self Self crate super as where async await move ref dyn const static true false None Some Ok Err"))
    add("swift", c("Swift", "func let var return if else guard for in while switch case default break continue struct class enum protocol extension import self Self init nil true false async await throws try catch public private internal static override some any"))
    add("kt kts gradle", c("Kotlin", "fun val var return if else when for in while class object interface data sealed enum import package this super null true false suspend override private public internal companion is as"))
    add("java", c("Java", "public private protected class interface enum extends implements import package return if else for while switch case break continue new static final void this super null true false try catch finally throw throws"))
    add("c h", c("C", "int char long short float double void unsigned signed struct union enum typedef static const return if else for while do switch case break continue sizeof NULL include define"))
    add("cc cpp cxx hpp hh", c("C++", "int char long float double void bool auto struct class namespace using template typename public private protected virtual override const static return if else for while switch case break continue new delete nullptr true false include define"))
    add("cs", c("C#", "public private protected internal class interface struct enum namespace using return if else for foreach in while switch case break continue new static void var this base null true false async await"))
    add("css scss sass", c("CSS", ""))
    add("php", c("PHP", "function return if else foreach as for while class public private protected new echo null true false"))
    add("dart", c("Dart", "void var final const return if else for in while class extends implements import async await null true false"))
    add("py pyw", hash("Python", "def class return if elif else for in while import from as with try except finally raise pass break continue lambda yield async await None True False and or not is self"))
    add("rb", hash("Ruby", "def class module end return if elsif else unless for in while do require self nil true false yield"))
    add("sh bash zsh fish env command", hash("Shell", "if then else elif fi for in do done while case esac function return export local echo"))
    add("yaml yml", hash("YAML", "true false null"))
    add("r", hash("R", "function return if else for in while TRUE FALSE NULL"))
    add("toml ini conf cfg properties", Language("Config", listOf("#", ";"), null, "true false"))
    add("sql", Language("SQL", listOf("--"), "/*" to "*/", "select from where insert into values update set delete create table index primary key foreign references join left right inner outer on group by order having limit as and or not null default unique"))
    add("lua", Language("Lua", listOf("--"), null, "local function return if then else elseif end for in while do nil true false and or not"))
    add("json jsonc json5", Language("JSON", keywords = "true false null"))
    add("html htm xml plist svg", Language("HTML", block = "<!--" to "-->"))
}

private val texts = setOf("txt", "md", "markdown", "mdx", "csv", "tsv", "log", "srt", "vtt", "tex", "dockerfile", "makefile", "gitignore")

private fun extOf(name: String): String { val dot = name.lastIndexOf('.'); return (if (dot > 0) name.substring(dot + 1) else name).lowercase() }

/** Whether Kimono reads [name] itself, as code or text, rather than handing it to another app. */
fun readsAsText(name: String, mime: String?): Boolean = extOf(name).let { it in languages || it in texts } || mime?.startsWith("text/") == true

/** The language Kimono colours [name] as, if any. */
fun codeLanguage(name: String): String? = languages[extOf(name)]?.name

private val comment = SpanStyle(color = Color(0xFF8F8A80), fontStyle = FontStyle.Italic)
private val string = SpanStyle(color = Color(0xFFB9CF94))
private val number = SpanStyle(color = Color(0xFFE6B07A))
private val keyword = SpanStyle(color = Color(0xFFE79BB0))

private fun quote(text: String) = Regex.escape(text)

private fun highlight(text: String, name: String): AnnotatedString {
    val language = languages[extOf(name)] ?: return AnnotatedString(text)
    val parts = listOf(
        language.block?.let { (open, close) -> "${quote(open)}[\\s\\S]*?(?:${quote(close)}|$)" },
        language.line.takeIf { it.isNotEmpty() }?.let { marks -> "(?:${marks.joinToString("|") { quote(it) }})[^\\n]*" },
        "\"(?:[^\"\\\\\\n]|\\\\.)*\"?|'(?:[^'\\\\\\n]|\\\\.)*'?|`(?:[^`\\\\]|\\\\.)*`?",
        "\\b\\d[\\d_]*(?:\\.\\d+)?(?:[eE][+-]?\\d+)?\\b|\\b0[xX][\\da-fA-F]+\\b",
        language.keywords.takeIf { it.isNotBlank() }?.let { "\\b(?:${it.split(" ").joinToString("|")})\\b" },
    )
    val styles = listOf(comment, comment, string, number, keyword)
    val pattern = Regex(parts.joinToString("|") { "(${it ?: "(?!)"})" })
    return buildAnnotatedString {
        append(text)
        for (match in pattern.findAll(text)) {
            val group = (1..5).firstOrNull { match.groups[it] != null } ?: continue
            addStyle(styles[group - 1], match.range.first, match.range.last + 1)
        }
    }
}

/** A text or code file's words, numbered, on urushi; selectable, scrolling both ways. */
@Composable
fun CodeView(text: String, name: String, modifier: Modifier = Modifier) {
    val marked = remember(text, name) { highlight(text, name) }
    val lines = remember(text) { (1..text.count { it == '\n' } + 1).joinToString("\n") }
    val style = TextStyle(fontFamily = FontFamily.Monospace, fontSize = 13.sp, lineHeight = 20.sp)
    Box(modifier.background(Urushi).verticalScroll(rememberScrollState())) {
        Row(Modifier.padding(vertical = 14.dp)) {
            Text(lines, style = style.copy(color = Color(0xFF8A7D78), textAlign = TextAlign.End), modifier = Modifier.padding(start = 12.dp, end = 12.dp))
            SelectionContainer(Modifier.horizontalScroll(rememberScrollState())) {
                Text(marked, style = style.copy(color = Color(0xFFECE4DC)), softWrap = false, modifier = Modifier.padding(end = 20.dp))
            }
        }
    }
}

val Urushi = Color(0xFF2A2326)

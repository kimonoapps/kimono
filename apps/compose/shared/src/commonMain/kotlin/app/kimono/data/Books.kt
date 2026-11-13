package app.kimono.data

import io.ktor.client.request.header
import io.ktor.client.request.setBody
import io.ktor.client.statement.bodyAsBytes
import io.ktor.client.statement.bodyAsChannel
import io.ktor.http.ContentType
import io.ktor.http.HttpMethod
import io.ktor.http.contentType
import io.ktor.http.encodeURLPathPart
import io.ktor.http.encodeURLQueryComponent
import io.ktor.http.isSuccess
import io.ktor.utils.io.readAvailable
import kotlinx.io.buffered
import kotlinx.io.files.Path
import kotlinx.io.files.SystemFileSystem
import kotlinx.io.readByteArray
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/* ── What /api/v1/books answers with (apps/portal/src/lib/books) ── */

@Serializable
data class Book(
    val key: String, val title: String, val subtitle: String = "", val authors: List<String> = emptyList(), val year: Int? = null,
    val publisher: String = "", val language: String = "", val pages: Int? = null, val isbns: List<String> = emptyList(),
    val genres: List<String> = emptyList(), val description: String = "", val cover: String? = null,
    val rating: Double? = null, val ratings: Int = 0, val readers: Int = 0,
) { val author get() = authors.firstOrNull().orEmpty() }

@Serializable
data class ShelfItem(
    val key: String, val title: String, val authors: List<String> = emptyList(), val cover: String? = null, val year: Int? = null,
    val isbn: String? = null, val state: String, val fraction: Double = 0.0, val rating: String? = null, val updatedAt: String = "",
) { fun asBook() = Book(key, title, authors = authors, year = year, cover = cover, isbns = listOfNotNull(isbn)) }

@Serializable
data class BookRow(val id: String, val title: String, val books: List<Book> = emptyList())

@Serializable
data class FriendOnBook(
    val username: String, val name: String = "", val picture: String? = null, val state: String, val fraction: Double = 0.0,
    val rating: String? = null, val review: String? = null, val reviewedAt: String? = null, val updatedAt: String = "", val book: Book? = null,
) {
    /** "Loved it", "Reading · 40%", "Wants to read". */
    val verdict get() = when {
        rating != null -> Books.ratingLabel(rating)
        state == "reading" -> "Reading · ${(fraction * 100).toInt()}%"
        state == "want" -> "Wants to read"
        else -> "Read it"
    }
}

@Serializable
data class BooksHome(val shelf: List<ShelfItem> = emptyList(), val friends: List<FriendOnBook> = emptyList(), val rows: List<BookRow> = emptyList())

@Serializable
data class Mine(val state: String, val fraction: Double = 0.0, val rating: String? = null, val review: String? = null, val reviewedAt: String? = null)

@Serializable
data class BookPage(val book: Book, val byAuthor: List<Book> = emptyList(), val similar: List<Book> = emptyList(), val shelf: Mine? = null, val friends: List<FriendOnBook> = emptyList())

@Serializable
data class BookFile(val address: String, val source: String, val format: String, val size: Long? = null, val label: String? = null, val sample: Boolean = false, val readable: Boolean = false)

@Serializable private data class Found(val books: List<Book> = emptyList())
@Serializable private data class ShelfList(val books: List<ShelfItem> = emptyList())
@Serializable private data class Files(val files: List<BookFile> = emptyList())
@Serializable private data class Rated(val shelf: Mine? = null)
@Serializable data class Progressed(val key: String, val state: String, val fraction: Double)

private val json = Json { ignoreUnknownKeys = true }

/**
 * 本 Kimono Books: what you're reading, shelves to browse, a book's page with
 * your rating and which friends read it, and the files the household's
 * sources have for it. The same API the web and a Kimono Read use.
 */
class Books(private val session: Session) {
    suspend fun home(): BooksHome = json.decodeFromString(session.fetch(HOME))
    fun knownHome(): BooksHome? = session.answers.peek(HOME)?.let { runCatching { json.decodeFromString<BooksHome>(it) }.getOrNull() }

    suspend fun search(q: String): List<Book> = json.decodeFromString<Found>(session.call("$BASE/search?q=${q.trim().encodeURLQueryComponent()}")).books
    suspend fun book(key: String): BookPage = json.decodeFromString(session.fetch("$BASE/book?key=${key.encodeURLQueryComponent()}"))
    fun knownBook(key: String): BookPage? = session.answers.peek("$BASE/book?key=${key.encodeURLQueryComponent()}")?.let { runCatching { json.decodeFromString<BookPage>(it) }.getOrNull() }
    suspend fun shelf(): List<ShelfItem> = json.decodeFromString<ShelfList>(session.fetch("$BASE/shelf")).books
    suspend fun files(key: String): List<BookFile> = json.decodeFromString<Files>(session.call("$BASE/files?key=${key.encodeURLQueryComponent()}")).files

    /** "want", "reading", "read", or null to take it off. */
    suspend fun place(key: String, state: String?): List<ShelfItem> = json.decodeFromString<ShelfList>(session.call("$BASE/shelf", HttpMethod.Put) {
        contentType(ContentType.Application.Json)
        setBody(buildJsonObject { put("key", key); if (state == null) put("state", JsonNull) else put("state", state) }.toString())
    }).books

    /** "down", "up", "love", or null. */
    suspend fun rate(key: String, rating: String?): Mine? = json.decodeFromString<Rated>(session.call("$BASE/rating", HttpMethod.Put) {
        contentType(ContentType.Application.Json)
        setBody(buildJsonObject { put("key", key); if (rating == null) put("rating", JsonNull) else put("rating", rating) }.toString())
    }).shelf

    /** What you thought, in your own words; null takes it down. Your friends see it. */
    suspend fun review(key: String, review: String?): Mine? = json.decodeFromString<Rated>(session.call("$BASE/review", HttpMethod.Put) {
        contentType(ContentType.Application.Json)
        setBody(buildJsonObject { put("key", key); if (review == null) put("review", JsonNull) else put("review", review) }.toString())
    }).shelf

    suspend fun progress(key: String, fraction: Double): Progressed = json.decodeFromString(session.call("$BASE/progress", HttpMethod.Post) {
        contentType(ContentType.Application.Json); setBody(buildJsonObject { put("key", key); put("fraction", fraction) }.toString())
    })

    /**
     * Fetches a book's file into [directory], reporting bytes as they arrive.
     * A copy already fetched is used as it is; a fetch cut short carries on
     * from where it stopped (the file answers byte ranges).
     */
    suspend fun download(file: BookFile, directory: String, progress: (Long) -> Unit): String {
        val name = "${file.address.replace(Regex("[^A-Za-z0-9._-]"), "_")}.${file.format}"
        val folder = Path(directory, "books")
        val target = Path(folder, name)
        SystemFileSystem.metadataOrNull(target)?.let { if (file.size == null || it.size == file.size) return target.toString() }
        SystemFileSystem.createDirectories(folder)
        val partial = Path(folder, ".$name.part")
        val have = SystemFileSystem.metadataOrNull(partial)?.size ?: 0L
        session.respond("$BASE/file?f=${file.address.encodeURLQueryComponent()}&format=${file.format}", configure = {
            if (have > 0) header("Range", "bytes=$have-")
        }, handle = { response ->
            val append = response.status.value == 206
            if (!append && !response.status.isSuccess()) throw session.problemOf(response, "That book couldn't be opened.")
            val channel = response.bodyAsChannel()
            val buffer = ByteArray(64 * 1024)
            var received = if (append) have else 0L
            progress(received)
            SystemFileSystem.sink(partial, append = append).buffered().use { sink ->
                while (true) {
                    val read = channel.readAvailable(buffer)
                    if (read < 0) break
                    if (read == 0) { if (channel.isClosedForRead) break else continue }
                    sink.write(buffer, 0, read)
                    received += read
                    progress(received)
                }
            }
        })
        SystemFileSystem.atomicMove(partial, target)
        return target.toString()
    }

    /**
     * One part of an EPUB (its container, package, a chapter, an image), as
     * the server serves them (api/v1/books/epub), so the reader opens on a few
     * small requests. Parts are kept on the phone: a book read once opens at
     * once, and works offline for what's been read.
     */
    suspend fun epubPart(address: String, path: String, cacheDir: String): ByteArray {
        val id = kotlin.io.encoding.Base64.UrlSafe.encode(address.encodeToByteArray()).trimEnd('=')
        val clean = path.trimStart('/').split('/').joinToString("/") { it.encodeURLPathPart() }
        val keep = Path(cacheDir, "books", "parts", id.take(80), clean.replace('/', '_').take(180))
        runCatching { if (SystemFileSystem.exists(keep)) return SystemFileSystem.source(keep).buffered().use { it.readByteArray() } }
        val bytes = session.respond("$BASE/epub/$id/$clean") { response ->
            if (!response.status.isSuccess()) throw session.problemOf(response, "That book didn't open.")
            response.bodyAsBytes()
        }
        runCatching {
            keep.parent?.let { SystemFileSystem.createDirectories(it) }
            SystemFileSystem.sink(keep).buffered().use { it.write(bytes) }
        }
        return bytes
    }

    /** A file's address on this Kimono, for the reader or to save a copy. */
    fun fileUrl(file: BookFile, download: Boolean = false): String =
        "${session.server.orEmpty()}$BASE/file?f=${file.address.encodeURLQueryComponent()}&format=${file.format}${if (download) "&download=1" else ""}"

    companion object {
        const val APP_ID = "kimono-books"
        const val REVIEW_MAX = 5000
        private const val BASE = "/api/v1/books"
        private const val HOME = "$BASE/home"
        fun stateLabel(state: String) = when (state) { "want" -> "Want to read"; "reading" -> "Reading"; else -> "Read" }
        fun ratingLabel(rating: String) = when (rating) { "down" -> "Not for me"; "up" -> "Liked it"; else -> "Loved it" }
        fun count(n: Int): String = when {
            n >= 1_000_000 -> "${(n / 100_000) / 10.0}M".replace(".0M", "M")
            n >= 10_000 -> "${n / 1000}k"
            n >= 1_000 -> "${(n / 100) / 10.0}k".replace(".0k", "k")
            else -> n.toString()
        }
    }
}

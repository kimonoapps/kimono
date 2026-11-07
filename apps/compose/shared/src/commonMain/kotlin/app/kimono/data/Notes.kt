package app.kimono.data

import io.ktor.client.request.setBody
import io.ktor.http.ContentType
import io.ktor.http.HttpMethod
import io.ktor.http.contentType
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.put

/* ── What /api/v1/notes answers with (apps/portal/src/lib/notes/model.ts) ── */

/** The space a notebook is in: whoever is in it shares the notebook, and its crest is the notebook's mark. */
@Serializable
data class NotebookSpace(val id: String, val name: String = "", val crest: String = "kikyo", val color: String = "plum", val members: Int = 1)

/** A notebook: a folder marked as one, in any space. Notes and sections name it as their notebookId. */
@Serializable
data class Notebook(
    val id: String, val name: String, val createdBy: String = "", val createdAt: Double = 0.0, val updatedAt: Double = 0.0,
    val space: NotebookSpace, val role: String = "viewer",
    /** It is its space's top folder. */
    val isSpace: Boolean = false,
    /** Shared with this person from a space they aren't in: it's theirs to leave, not to delete. */
    val sharedWithYou: Boolean = false,
) {
    val canWrite get() = role == "owner" || role == "editor"
    val shared get() = space.members > 1
}

/** A folder in a notebook. */
@Serializable
data class NoteSection(val id: String, val notebookId: String, val parentId: String, val name: String, val updatedAt: Double = 0.0)

@Serializable
data class NoteMeta(
    /** Null for a note shared with this person on its own, outside any notebook of theirs. */
    val id: String, val notebookId: String? = null, val parentId: String, val title: String, val createdBy: String = "",
    val createdAt: Double = 0.0, val updatedAt: Double = 0.0,
    /** The version an edit starts from, to save over it. */
    val version: Int = 0,
    val excerpt: String = "",
)

@Serializable
data class NoteLibrary(val notebooks: List<Notebook> = emptyList(), val sections: List<NoteSection> = emptyList(), val notes: List<NoteMeta> = emptyList())

@Serializable
data class NoteText(val note: NoteMeta, val text: String)

@Serializable
data class NoteSaved(val note: NoteMeta, val conflict: Boolean = false)


/* ── sharing: Drive's shares, for a notebook, a note, or any folder or file ── */

@Serializable
data class Share(val username: String, val role: String, val addedBy: String = "")

@Serializable
data class ShareVia(val id: String, val name: String)

/** Someone who has it through a folder above it (a note through its notebook). */
@Serializable
data class InheritedShare(val username: String, val role: String, val via: ShareVia)

/** Its space, for "Everyone in Family can see this." (no name and 0 when it was shared with you). */
@Serializable
data class ShareSpace(val id: String = "", val name: String = "", val members: Int = 0)

@Serializable
data class Sharing(
    val shares: List<Share> = emptyList(), val inherited: List<InheritedShare> = emptyList(), val space: ShareSpace = ShareSpace(),
    /** Your own access to it; null where the answer doesn't say (Drive's). */
    val role: String? = null,
    /** Its public, read-only link, when on. */
    val link: String? = null,
)

@Serializable
private data class NoteLinkAnswer(val link: String? = null)

@Serializable
private data class PeopleAnswer(val people: List<Person> = emptyList())

/** An edit made with no connection, kept on the phone until it can be sent under the version rule. */
@Serializable
data class WaitingEdit(
    val id: String, val text: String, val version: Int,
    /* A note made with no connection has no id yet: it waits with where it goes and what it's called. */
    val new: Boolean = false, val parent: String? = null, val title: String? = null,
)

private val json = Json { ignoreUnknownKeys = true; explicitNulls = false }

/* An answer that doesn't read is a failure a person can be told about, never a crash. */
private inline fun <reified T> read(text: String): T =
    try { json.decodeFromString<T>(text) } catch (_: kotlinx.serialization.SerializationException) { throw KimonoProblem("That didn't work.") } catch (_: IllegalArgumentException) { throw KimonoProblem("That didn't work.") }

/**
 * 帳 Kimono Notes, as the phone uses it. Every answer is kept (Answers), so
 * the library and the notes opened before read with no connection; edits
 * made then wait on the phone and go when it's back, under the version rule.
 */
class Notes(private val session: Session, private val platform: Platform) {
    private val answers get() = session.answers

    fun knownLibrary(): NoteLibrary? = answers.peek(LIBRARY)?.let { runCatching { json.decodeFromString<NoteLibrary>(it) }.getOrNull() }
    fun knownNote(id: String): NoteText? = answers.peek("$LIBRARY/$id")?.let { runCatching { json.decodeFromString<NoteText>(it) }.getOrNull() }

    suspend fun library(): NoteLibrary = read(session.fetch(LIBRARY))
    suspend fun note(id: String): NoteText = read(session.fetch("$LIBRARY/$id"))

    private suspend fun send(path: String, method: HttpMethod, body: kotlinx.serialization.json.JsonObject? = null): String =
        session.call(path, method) { if (body != null) { contentType(ContentType.Application.Json); setBody(body.toString()) } }

    /** A new, empty note in [parent] (a notebook's top or a section), or in the person's own notebook. */
    suspend fun create(parent: String?, title: String? = null, text: String? = null): NoteMeta =
        read(send(LIBRARY, HttpMethod.Post, buildJsonObject { parent?.let { put("parent", it) }; title?.let { put("title", it) }; text?.let { put("text", it) } }))

    /** Saves [text] over [version]. If someone saved first, [NoteSaved.conflict] is true and its note is the copy kept beside theirs. */
    suspend fun save(id: String, text: String, version: Int): NoteSaved {
        val saved = read<NoteSaved>(send("$LIBRARY/$id", HttpMethod.Put, buildJsonObject { put("text", text); put("version", version) }))
        if (!saved.conflict) answers.put("$LIBRARY/$id", json.encodeToString(NoteText.serializer(), NoteText(saved.note, text)))
        return saved
    }

    suspend fun retitle(id: String, title: String): NoteMeta = read(send("$LIBRARY/$id", HttpMethod.Patch, buildJsonObject { put("title", title) }))
    suspend fun move(id: String, parent: String): NoteMeta = read(send("$LIBRARY/$id", HttpMethod.Patch, buildJsonObject { put("parent", parent) }))
    suspend fun delete(id: String) { send("$LIBRARY/$id", HttpMethod.Delete) }
    suspend fun restore(id: String) { send("$LIBRARY/$id/restore", HttpMethod.Post) }

    suspend fun createSection(name: String, parent: String?): NoteSection =
        read(send("$LIBRARY/sections", HttpMethod.Post, buildJsonObject { put("name", name); parent?.let { put("parent", it) } }))
    suspend fun renameSection(id: String, name: String) { send("$LIBRARY/sections/$id", HttpMethod.Patch, buildJsonObject { put("name", name) }) }
    suspend fun deleteSection(id: String) { send("$LIBRARY/sections/$id", HttpMethod.Delete) }

    /** A new notebook in [space], or in the person's own space. */
    suspend fun createNotebook(name: String, space: String?): Notebook =
        read(send("$LIBRARY/notebooks", HttpMethod.Post, buildJsonObject { put("name", name); space?.let { put("space", it) } }))
    suspend fun renameNotebook(id: String, name: String) { send("$LIBRARY/notebooks/$id", HttpMethod.Patch, buildJsonObject { put("name", name) }) }
    suspend fun deleteNotebook(id: String) { send("$LIBRARY/notebooks/$id", HttpMethod.Delete) }

    /* A notebook's sharing lives at /notes/notebooks/:id/…, a note's at /notes/:id/…. */
    private fun base(id: String, notebook: Boolean) = if (notebook) "$LIBRARY/notebooks/$id" else "$LIBRARY/$id"

    fun knownSharing(id: String, notebook: Boolean): Sharing? = answers.peek("${base(id, notebook)}/members")?.let { runCatching { json.decodeFromString<Sharing>(it) }.getOrNull() }

    /** Who it's shared with, who has it through its notebook, who sees it in its space, and its link. */
    suspend fun sharing(id: String, notebook: Boolean): Sharing = read(session.fetch("${base(id, notebook)}/members"))

    /** Shares it with [username] as "editor" or "viewer", or (null) takes them off. */
    suspend fun share(id: String, notebook: Boolean, username: String, role: String?): Sharing? {
        val text = send("${base(id, notebook)}/members", HttpMethod.Put, buildJsonObject { put("username", username); if (role == null) put("role", JsonNull) else put("role", role) })
        return runCatching { json.decodeFromString<Sharing>(text) }.getOrNull()?.takeIf { text.contains("\"shares\"") }
    }

    /** Turns its public link on (giving it) or off. */
    suspend fun link(id: String, notebook: Boolean, on: Boolean): String? =
        read<NoteLinkAnswer>(send("${base(id, notebook)}/link", if (on) HttpMethod.Post else HttpMethod.Delete)).link

    /** Leaves something shared with you. */
    suspend fun leave(id: String, notebook: Boolean, me: String) {
        send("${base(id, notebook)}/members", HttpMethod.Put, buildJsonObject { put("username", me); put("role", JsonNull) })
        answers.drop("${base(id, notebook)}/members")
    }

    /** Everyone it can be shared with. */
    suspend fun people(): List<Person> = read<PeopleAnswer>(session.fetch("$LIBRARY/people")).people
    fun knownPeople(): List<Person>? = answers.peek("$LIBRARY/people")?.let { runCatching { json.decodeFromString<PeopleAnswer>(it).people }.getOrNull() }

    /* ── keeping in step with Drive's change feed ── */

    private var cursor: Long? = null

    /** Whether anything in Drive changed since last asked; the first ask only marks where the log is. */
    suspend fun changed(): Boolean {
        val since = cursor
        if (since == null) {
            cursor = json.parseToJsonElement(session.call(CHANGES)).jsonObject["cursor"]?.jsonPrimitive?.longOrNull
            return false
        }
        val answer = runCatching { json.parseToJsonElement(session.call("$CHANGES?since=$since")).jsonObject }.getOrElse { problem ->
            if (problem is KimonoProblem && problem.message == OFFLINE) throw problem
            /* The cursor is older than the log: start again from now. */
            cursor = null
            return true
        }
        cursor = answer["cursor"]?.jsonPrimitive?.longOrNull ?: since
        val changed = (answer["changed"] as? JsonArray)?.size ?: 0
        val removed = (answer["removed"] as? JsonArray)?.size ?: 0
        return changed + removed > 0
    }

    /* ── edits waiting for a connection ── */

    suspend fun waiting(): List<WaitingEdit> =
        platform.readKept(WAITING)?.let { runCatching { json.decodeFromString(ListSerializer(WaitingEdit.serializer()), it) }.getOrNull() }.orEmpty()

    suspend fun keepWaiting(edit: WaitingEdit) {
        val rest = waiting().filter { it.id != edit.id }
        platform.keep(WAITING, json.encodeToString(ListSerializer(WaitingEdit.serializer()), rest + edit))
    }

    suspend fun doneWaiting(id: String) {
        val rest = waiting().filter { it.id != id }
        platform.keep(WAITING, if (rest.isEmpty()) null else json.encodeToString(ListSerializer(WaitingEdit.serializer()), rest))
    }

    /** Which place the list was showing, kept between launches. */
    suspend fun lastPlace(): String? = platform.readKept(PLACE)
    suspend fun keepPlace(place: String) = platform.keep(PLACE, place)

    fun localOffset(at: Long): Long = platform.utcOffsetMillis(at)

    companion object {
        const val APP_ID = "kimono-notes"
        private const val LIBRARY = "/api/v1/notes"
        private const val CHANGES = "/api/v1/drive/changes"
        private const val WAITING = "kimono.notes.waiting"
        private const val PLACE = "kimono.notes.place"
    }
}

/** A dropped or missing connection, rather than a refusal. */
val KimonoProblem.offline: Boolean get() = message == OFFLINE

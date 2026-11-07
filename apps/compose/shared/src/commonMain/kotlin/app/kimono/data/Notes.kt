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
    /** It is its space's top folder: shared on its own. */
    val isSpace: Boolean = false,
) {
    val canWrite get() = role == "owner" || role == "editor"
    val shared get() = space.members > 1
}

/** A folder in a notebook. */
@Serializable
data class NoteSection(val id: String, val notebookId: String, val parentId: String, val name: String, val updatedAt: Double = 0.0)

@Serializable
data class NoteMeta(
    val id: String, val notebookId: String, val parentId: String, val title: String, val createdBy: String = "",
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

@Serializable
data class NotebookMembers(val id: String, val name: String, val role: String, val isSpace: Boolean = false, val space: NotebookSpace? = null, val members: List<SpaceMember> = emptyList())

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
    fun knownMembers(notebookId: String): NotebookMembers? = answers.peek(membersPath(notebookId))?.let { runCatching { json.decodeFromString<NotebookMembers>(it) }.getOrNull() }

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

    /** Shares a notebook on its own, as a space of its own, with each person as "editor" or "viewer". */
    suspend fun shareNotebook(id: String, people: Map<String, String>) {
        send("$LIBRARY/notebooks/$id/share", HttpMethod.Post, buildJsonObject {
            put("members", buildJsonArray { people.forEach { (username, role) -> add(buildJsonObject { put("username", username); put("role", role) }) } })
        })
    }

    suspend fun members(notebookId: String): NotebookMembers = read(session.fetch(membersPath(notebookId)))

    /** Leaves a shared notebook. */
    suspend fun leave(notebookId: String, me: String) {
        send(membersPath(notebookId), HttpMethod.Put, buildJsonObject { put("username", me); put("role", JsonNull) })
        answers.drop(membersPath(notebookId))
    }

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
        private fun membersPath(id: String) = "$LIBRARY/notebooks/$id/members"
    }
}

/** A dropped or missing connection, rather than a refusal. */
val KimonoProblem.offline: Boolean get() = message == OFFLINE

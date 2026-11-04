package app.kimono.data

import io.ktor.client.request.setBody
import io.ktor.client.statement.bodyAsBytes
import io.ktor.http.ContentType
import io.ktor.http.HttpMethod
import io.ktor.http.content.ByteArrayContent
import io.ktor.http.contentType
import io.ktor.http.encodeURLParameter
import io.ktor.http.isSuccess
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.encodeToJsonElement
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.put

/* ── What Code answers with (apps/portal/src/lib/code/model.ts, events.ts) ── */

@Serializable
data class CodeRepo(val owner: String, val name: String)

@Serializable
data class CodePullRequest(val url: String, val number: Int)

@Serializable
data class CodePreview(val url: String, val port: Int) {
    /** The address without its scheme, as the cards show it. */
    val host get() = url.substringAfter("://")
}

@Serializable
data class CodeTurn(val id: String, val state: String, val startedAt: Long, val endedAt: Long? = null)

/** Where a task's files live in Drive: its folder in the person's Code space. */
@Serializable
data class CodeDrive(val spaceId: String, val folderId: String)

@Serializable
data class CodeWorkspace(
    val id: String, val title: String, val repo: CodeRepo, val base: String, val branch: String,
    val pullRequest: CodePullRequest? = null,
    val preview: CodePreview? = null,
    val drive: CodeDrive? = null,
    val createdAt: Long = 0, val updatedAt: Long = 0, val lastSeq: Long = 0,
    val turn: CodeTurn? = null,
) {
    val running get() = turn?.state == "running"
}

@Serializable
data class CodeRepository(val owner: String, val name: String, val description: String = "", val defaultBranch: String = "main", val updatedAt: Long = 0, val private: Boolean = false)

@Serializable
data class CodeAttachment(val name: String, val path: String, val size: Long, val type: String) {
    val isPicture get() = type in setOf("image/png", "image/jpeg", "image/gif", "image/webp")
}

/** One entry on a workspace's timeline, in the few kinds Portal stores. */
sealed interface CodeEvent {
    data class Ask(val by: String, val text: String, val attachments: List<CodeAttachment>) : CodeEvent
    data object Started : CodeEvent
    data class Say(val text: String) : CodeEvent
    data class Tool(val id: String, val name: String, val label: String, val detail: String?) : CodeEvent
    data class ToolResult(val id: String, val ok: Boolean, val output: String) : CodeEvent
    data class Done(val ok: Boolean, val cancelled: Boolean, val error: String?, val costUsd: Double?, val durationMs: Long?) : CodeEvent
    data class Published(val url: String, val number: Int) : CodeEvent
    data class Image(val name: String, val caption: String?) : CodeEvent
    data class Preview(val url: String, val port: Int) : CodeEvent { val host get() = url.substringAfter("://") }
    data object PreviewStopped : CodeEvent
    data object Unknown : CodeEvent
}

data class StoredCodeEvent(val seq: Long, val at: Long, val event: CodeEvent)

@Serializable
data class CodeEntry(val name: String, val kind: String, val size: Long = 0)

@Serializable
data class CodeChangedFile(val path: String, val status: String, val additions: Int = 0, val deletions: Int = 0)

@Serializable
data class CodeChanges(val base: String, val branch: String, val truncated: Boolean = false, val diff: String = "", val files: List<CodeChangedFile> = emptyList())

@Serializable private data class WorkspaceList(val workspaces: List<CodeWorkspace>)
@Serializable private data class RepoList(val repositories: List<CodeRepository>)
@Serializable private data class BranchList(val branches: List<String>)
@Serializable private data class Folder(val path: String = "", val entries: List<CodeEntry>)

private val json = Json { ignoreUnknownKeys = true }

private fun JsonObject.text(key: String) = this[key]?.jsonPrimitive?.takeIf { it.isString }?.content

private fun eventOf(o: JsonObject): CodeEvent = when (o.text("kind")) {
    "ask" -> CodeEvent.Ask(o.text("by") ?: "", o.text("text") ?: "", (o["attachments"] as? JsonArray)?.map { json.decodeFromJsonElement(CodeAttachment.serializer(), it) } ?: emptyList())
    "started" -> CodeEvent.Started
    "text" -> CodeEvent.Say(o.text("text") ?: "")
    "tool" -> CodeEvent.Tool(o.text("id") ?: "", o.text("name") ?: "", o.text("label") ?: "", o.text("detail"))
    "tool-result" -> CodeEvent.ToolResult(o.text("id") ?: "", o["ok"]?.jsonPrimitive?.booleanOrNull ?: true, o.text("output") ?: "")
    "done" -> CodeEvent.Done(
        o["ok"]?.jsonPrimitive?.booleanOrNull ?: false, o["cancelled"]?.jsonPrimitive?.booleanOrNull ?: false, o.text("error"),
        o["costUsd"]?.jsonPrimitive?.doubleOrNull, o["durationMs"]?.jsonPrimitive?.longOrNull,
    )
    "published" -> CodeEvent.Published(o.text("url") ?: "", o["number"]?.jsonPrimitive?.intOrNull ?: 0)
    "image" -> CodeEvent.Image(o.text("name") ?: "", o.text("caption"))
    "preview" -> CodeEvent.Preview(o.text("url") ?: "", o["port"]?.jsonPrimitive?.intOrNull ?: 0)
    "preview-stopped" -> CodeEvent.PreviewStopped
    else -> CodeEvent.Unknown
}

/**
 * 工 Kimono Code, as the phone uses it: the same /api/v1/code endpoints as the
 * web page. The phone asks for the timeline after the last event it has, a
 * second apart while the agent works, instead of holding a stream open.
 */
class Code(private val session: Session) {
    private fun ws(id: String) = "/api/v1/code/workspaces/${id.encodeURLParameter()}"
    private fun jsonBody(body: JsonObject): io.ktor.client.request.HttpRequestBuilder.() -> Unit = {
        contentType(ContentType.Application.Json)
        setBody(body.toString())
    }

    fun knownWorkspaces(): List<CodeWorkspace>? = session.answers.peek(WORKSPACES)?.let { runCatching { json.decodeFromString<WorkspaceList>(it).workspaces }.getOrNull() }

    suspend fun workspaces(): List<CodeWorkspace> = json.decodeFromString<WorkspaceList>(session.fetch(WORKSPACES)).workspaces

    suspend fun repositories(): List<CodeRepository> = json.decodeFromString<RepoList>(session.call("/api/v1/code/repos")).repositories

    /** A new, private Kimono Git repository with a main branch, ready to work on. */
    suspend fun createRepository(name: String): CodeRepository =
        json.decodeFromString(session.call("/api/v1/code/repos", HttpMethod.Post, jsonBody(buildJsonObject { put("name", name) })))

    suspend fun branches(owner: String, name: String): List<String> =
        json.decodeFromString<BranchList>(session.call("/api/v1/code/branches?owner=${owner.encodeURLParameter()}&name=${name.encodeURLParameter()}")).branches

    suspend fun start(owner: String, name: String, base: String, prompt: String): CodeWorkspace =
        json.decodeFromString(session.call(WORKSPACES, HttpMethod.Post, jsonBody(buildJsonObject { put("owner", owner); put("name", name); put("base", base); put("prompt", prompt) })))

    suspend fun remove(id: String) { session.call(ws(id), HttpMethod.Delete); session.answers.drop(WORKSPACES) }

    /** The workspace as it is now and what happened after [after]. */
    suspend fun events(id: String, after: Long): Pair<CodeWorkspace, List<StoredCodeEvent>> {
        val answer = json.parseToJsonElement(session.call("${ws(id)}/events?after=$after")).jsonObject
        val workspace = json.decodeFromJsonElement(CodeWorkspace.serializer(), answer.getValue("workspace"))
        val events = answer["events"]?.jsonArray?.map { element ->
            val o = element.jsonObject
            StoredCodeEvent(o["seq"]!!.jsonPrimitive.longOrNull ?: 0, o["at"]?.jsonPrimitive?.longOrNull ?: 0, eventOf(o["event"]!!.jsonObject))
        } ?: emptyList()
        return workspace to events
    }

    suspend fun ask(id: String, text: String, attachments: List<CodeAttachment>) {
        session.call("${ws(id)}/turns", HttpMethod.Post, jsonBody(buildJsonObject {
            put("text", text)
            put("attachments", json.encodeToJsonElement(attachments))
        }))
    }

    suspend fun stop(id: String) { session.call("${ws(id)}/stop", HttpMethod.Post) }

    /** Takes the app's link down. */
    suspend fun stopPreview(id: String) { session.call("${ws(id)}/preview", HttpMethod.Delete) }

    /** A screenshot the agent took. */
    suspend fun shot(id: String, name: String): ByteArray = bytes("${ws(id)}/shots/${name.encodeURLParameter()}")

    suspend fun publish(id: String, title: String): CodeWorkspace =
        json.decodeFromString(session.call("${ws(id)}/publish", HttpMethod.Post, jsonBody(buildJsonObject { put("title", title) })))

    suspend fun files(id: String, path: String): List<CodeEntry> = json.decodeFromString<Folder>(session.call("${ws(id)}/files?path=${path.encodeURLParameter()}")).entries

    suspend fun changes(id: String): CodeChanges = json.decodeFromString(session.call("${ws(id)}/changes"))

    /** A file's bytes from the sandbox, or from what was attached. */
    suspend fun bytes(path: String): ByteArray = session.respond(path) { response ->
        if (!response.status.isSuccess()) throw session.problemOf(response, if (response.status.value == 413) "That file is too large to show here." else "That file couldn't be opened.")
        response.bodyAsBytes()
    }

    suspend fun file(id: String, path: String): ByteArray = bytes("${ws(id)}/file?path=${path.encodeURLParameter()}")

    suspend fun attachment(id: String, a: CodeAttachment): ByteArray =
        bytes("${ws(id)}/attachments/${a.path.removePrefix("/attachments/").encodeURLParameter()}?type=${a.type.encodeURLParameter()}")

    /** Copies Drive files into the task, for the next message. Each comes back as an attachment. */
    suspend fun fromDrive(id: String, nodes: List<String>): List<CodeAttachment> =
        json.decodeFromString(session.call("${ws(id)}/from-drive", HttpMethod.Post, jsonBody(buildJsonObject {
            put("nodes", kotlinx.serialization.json.JsonArray(nodes.map { kotlinx.serialization.json.JsonPrimitive(it) }))
        })))

    /** Puts a picked file in the sandbox for the next message. Up to 20 MB. */
    suspend fun attach(id: String, file: PickedFile): CodeAttachment {
        if (file.size > MAX_ATTACHMENT) throw KimonoProblem("Attachments can be up to 20 MB.")
        val bytes = ByteArray(file.size.toInt())
        var at = 0
        while (at < bytes.size) {
            val piece = file.read(at.toLong(), minOf(1024 * 1024, bytes.size - at))
            if (piece.isEmpty()) break
            piece.copyInto(bytes, at)
            at += piece.size
        }
        val type = file.mimeType?.let { runCatching { ContentType.parse(it) }.getOrNull() } ?: ContentType.Application.OctetStream
        return json.decodeFromString(session.call("${ws(id)}/attachments?name=${file.name.encodeURLParameter()}", HttpMethod.Post) {
            setBody(ByteArrayContent(bytes.copyOf(at), type))
        })
    }

    companion object {
        private const val WORKSPACES = "/api/v1/code/workspaces"
        const val MAX_ATTACHMENT = 20L * 1024 * 1024
        const val APP_ID = "kimono-code"
    }
}

/** m:ss, or hours and minutes past an hour. */
fun elapsedText(ms: Long): String {
    val s = (ms / 1000).coerceAtLeast(0)
    return if (s < 3600) "${s / 60}:${(s % 60).toString().padStart(2, '0')}" else "${s / 3600}h ${(s / 60) % 60}m"
}

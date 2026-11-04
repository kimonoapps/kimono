package app.kimono.data

import io.ktor.client.request.header
import io.ktor.client.request.setBody
import io.ktor.client.statement.bodyAsChannel
import io.ktor.http.ContentType
import io.ktor.http.HttpMethod
import io.ktor.http.content.ByteArrayContent
import io.ktor.http.contentType
import io.ktor.http.encodeURLParameter
import io.ktor.http.isSuccess
import io.ktor.utils.io.readAvailable
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.io.buffered
import kotlinx.io.files.Path
import kotlinx.io.files.SystemFileSystem
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.decodeFromJsonElement
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put
import kotlin.io.encoding.Base64
import kotlin.io.encoding.ExperimentalEncodingApi

/* ── What Drive answers with (apps/portal/src/lib/drive/model.ts) ── */

@Serializable
data class DriveSpace(val id: String, val name: String, val crest: String, val rootId: String, val role: String, val members: Int)

@Serializable
data class DriveNode(
    val id: String,
    val spaceId: String,
    val parentId: String? = null,
    val kind: String,
    val name: String,
    val size: Long = 0,
    val mime: String? = null,
    val updatedAt: Double = 0.0,
    val link: String? = null,
    val guest: String? = null,
    val version: Int = 1,
    val contentVersion: Int = 1,
) {
    val isFolder get() = kind == "folder"
}

@Serializable
data class DriveFolder(val folder: DriveNode, val path: List<DriveNode>, val children: List<DriveNode>)

@Serializable
private data class FileAnswer(val file: DriveNode)

@Serializable
private data class SpaceList(val spaces: List<DriveSpace>)

@Serializable
/** A plain list of files and folders: the trash, search results, recent files. */
private data class TrashList(val items: List<DriveNode>)

@Serializable
private data class LinkAnswer(val url: String)

/** One of the person's other Kimono apps, for "More Kimono apps". */
@Serializable
data class KimonoAppLink(
    val id: String,
    val name: String,
    val shortName: String,
    val description: String,
    val accent: String,
    val icon: String? = null,
    val web: String,
    val ios: String? = null,
    val android: String? = null,
)

@Serializable
private data class AppList(val apps: List<KimonoAppLink>)

private val json = Json { ignoreUnknownKeys = true }

/**
 * 堂 Kimono Drive, as the Kimono apps use it. Uploads speak tus to the same
 * endpoints as the iPhone's Files app, in pieces small enough for any proxy,
 * and pick up where they stopped after a dropped connection.
 */
class Drive(private val session: Session) {
    suspend fun spaces(): List<DriveSpace> = json.decodeFromString<SpaceList>(session.call("/api/v1/drive/spaces")).spaces

    suspend fun folder(id: String): DriveFolder = json.decodeFromString(session.call("/api/v1/drive/nodes/$id"))

    /** One file or folder, by id. */
    suspend fun node(id: String): DriveNode {
        val text = session.call("/api/v1/drive/nodes/$id")
        val answer = json.parseToJsonElement(text).jsonObject
        return if ("file" in answer) json.decodeFromJsonElement<FileAnswer>(answer).file else json.decodeFromJsonElement<DriveFolder>(answer).folder
    }

    suspend fun move(id: String, parentId: String) {
        session.call("/api/v1/drive/nodes/$id", HttpMethod.Patch) {
            contentType(ContentType.Application.Json)
            setBody(buildJsonObject { put("parent", parentId) }.toString())
        }
    }

    /** Up to [length] bytes of a file from [offset], for reading it in place without downloading it all. */
    suspend fun read(id: String, offset: Long, length: Int): ByteArray =
        session.respond("/api/v1/drive/nodes/$id/content", configure = { header("Range", "bytes=$offset-${offset + length - 1}") }) { response ->
            if (response.status.value == 416) return@respond ByteArray(0)
            if (!response.status.isSuccess()) throw session.problemOf(response, "That file couldn't be opened.")
            val channel = response.bodyAsChannel()
            /* A server that ignores ranges sends it all: skip to the part asked for. */
            var skip = if (response.status.value == 206) 0L else offset
            val out = ByteArray(length)
            var filled = 0
            val buffer = ByteArray(64 * 1024)
            while (filled < length) {
                val read = channel.readAvailable(buffer)
                if (read < 0) break
                if (read == 0) { if (channel.isClosedForRead) break else continue }
                var start = 0
                if (skip > 0) { val dropped = minOf(skip, read.toLong()).toInt(); skip -= dropped; start = dropped }
                val take = minOf(read - start, length - filled)
                buffer.copyInto(out, filled, start, start + take)
                filled += take
            }
            if (filled == length) out else out.copyOf(filled)
        }

    suspend fun trash(): List<DriveNode> = json.decodeFromString<TrashList>(session.call("/api/v1/drive/trash")).items

    /** Files and folders whose names contain [query], closest first. */
    suspend fun search(query: String): List<DriveNode> =
        json.decodeFromString<TrashList>(session.call("/api/v1/drive/search?q=${query.encodeURLParameter()}")).items

    /** The most recently changed files, newest first. */
    suspend fun recent(): List<DriveNode> = json.decodeFromString<TrashList>(session.call("/api/v1/drive/recent")).items

    suspend fun createSpace(name: String): DriveSpace = json.decodeFromString(session.call("/api/v1/drive/spaces", HttpMethod.Post) {
        contentType(ContentType.Application.Json)
        setBody(buildJsonObject { put("name", name) }.toString())
    })

    suspend fun createFolder(parentId: String, name: String): DriveNode = json.decodeFromString(session.call("/api/v1/drive/nodes/$parentId/folders", HttpMethod.Post) {
        contentType(ContentType.Application.Json)
        setBody(buildJsonObject { put("name", name) }.toString())
    })

    suspend fun rename(id: String, name: String) {
        session.call("/api/v1/drive/nodes/$id", HttpMethod.Patch) {
            contentType(ContentType.Application.Json)
            setBody(buildJsonObject { put("name", name) }.toString())
        }
    }

    suspend fun moveToTrash(id: String) { session.call("/api/v1/drive/nodes/$id", HttpMethod.Delete) }

    suspend fun restore(id: String) { session.call("/api/v1/drive/nodes/$id/restore", HttpMethod.Post) }

    /** Turns on the file's public link (or returns the one it has). */
    suspend fun link(id: String): String = json.decodeFromString<LinkAnswer>(session.call("/api/v1/drive/nodes/$id/link", HttpMethod.Post)).url

    suspend fun unlink(id: String) { session.call("/api/v1/drive/nodes/$id/link", HttpMethod.Delete) }

    suspend fun otherApps(): List<KimonoAppLink> = json.decodeFromString<AppList>(session.call("/api/v1/apps")).apps

    /**
     * Downloads a file into [directory], reporting bytes as they arrive. A copy
     * already downloaded at the same content version is used as it is. What
     * arrived before a dropped connection is kept: the next try (automatic, or
     * the person's) asks only for the rest.
     */
    suspend fun download(node: DriveNode, directory: String, progress: (Long) -> Unit): String {
        val folder = Path(directory, "drive", "${node.id}-${node.contentVersion}")
        val target = Path(folder, node.name)
        SystemFileSystem.metadataOrNull(target)?.let { if (it.size == node.size) return target.toString() }
        SystemFileSystem.createDirectories(folder)
        val partial = Path(folder, ".${node.name}.part")
        var failures = 0
        while (true) {
            val have = SystemFileSystem.metadataOrNull(partial)?.size ?: 0L
            if (have >= node.size && have > 0) break
            try {
                session.respond("/api/v1/drive/nodes/${node.id}/content", configure = {
                    if (have > 0) header("Range", "bytes=$have-")
                }, handle = { response ->
                    /* 206: the rest, after what's kept. 200: the whole file (the server ignored the range). */
                    val append = response.status.value == 206
                    if (!append && !response.status.isSuccess()) throw session.problemOf(response, "That file couldn't be opened.")
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
                if ((SystemFileSystem.metadataOrNull(partial)?.size ?: 0L) >= node.size) break
                throw KimonoProblem(OFFLINE)
            } catch (problem: KimonoProblem) {
                if (problem.message != OFFLINE || ++failures > 5) throw problem
                delay(minOf(15_000L, 1_000L shl failures))
            }
        }
        SystemFileSystem.atomicMove(partial, target)
        return target.toString()
    }

    /**
     * Uploads [file] into [folderId] and returns the new file's id. Bytes go
     * in pieces of [PIECE]; after a dropped connection it asks the server how
     * much arrived and carries on from there, backing off a little each time.
     */
    @OptIn(ExperimentalEncodingApi::class)
    suspend fun upload(file: PickedFile, folderId: String, resumeAt: String? = null, replaces: Replacing? = null, started: (String) -> Unit = {}, progress: (Long) -> Unit): String {
        val tus = "1.0.0"
        fun encoded(text: String) = Base64.encode(text.encodeToByteArray())
        /* A new version of an existing file names it and the version it was edited from: a clash keeps both. */
        val metadata = "filename ${encoded(file.name)}," + if (replaces == null) "folder ${encoded(folderId)}" else "replaces ${encoded(replaces.fileId)},base ${encoded(replaces.contentVersion.toString())}"
        /* Carrying on from an earlier run: ask how far it got. Gone (thrown away, or the link expired): start again. */
        val known = resumeAt?.let { at -> resumePoint(at)?.let { at to it } }
        val location = known?.first ?: session.respond("/api/v1/drive/uploads", HttpMethod.Post, {
            header("Tus-Resumable", tus)
            header("Upload-Length", file.size.toString())
            header("Upload-Metadata", metadata)
        }) { response ->
            if (response.status.value != 201) throw session.problemOf(response, "That file couldn't be uploaded.")
            response.headers["Location"] ?: throw KimonoProblem("That file couldn't be uploaded.")
        }
        started(location)
        var offset = known?.second ?: 0L
        progress(offset)
        var failures = 0
        while (true) {
            val piece = if (file.size == 0L) ByteArray(0) else file.read(offset, PIECE)
            val answer: Pair<Long, String?>? = try {
                session.respond(location, HttpMethod.Patch, {
                    header("Tus-Resumable", tus)
                    header("Upload-Offset", offset.toString())
                    setBody(ByteArrayContent(piece, ContentType("application", "offset+octet-stream")))
                }) { response ->
                    when {
                        response.status.isSuccess() -> (response.headers["Upload-Offset"]?.toLongOrNull() ?: (offset + piece.size)) to response.headers["Kimono-File"]
                        response.status.value == 409 -> null
                        else -> throw session.problemOf(response, "That file couldn't be uploaded.")
                    }
                }
            } catch (problem: KimonoProblem) {
                /* Offline for now: wait, then ask where to carry on from. */
                failures += 1
                if (failures > 8) throw problem
                delay(minOf(30_000L, 1_000L shl failures))
                null
            }
            if (answer == null) {
                offset = resumePoint(location) ?: offset
                continue
            }
            failures = 0
            offset = answer.first
            progress(offset)
            answer.second?.let { return it }
            if (offset >= file.size) throw KimonoProblem("That file couldn't be uploaded.")
        }
    }

    private suspend fun resumePoint(location: String): Long? = runCatching {
        session.respond(location, HttpMethod.Head, { header("Tus-Resumable", "1.0.0") }) { if (it.status.isSuccess()) it.headers["Upload-Offset"]?.toLongOrNull() else null }
    }.getOrNull()

    companion object {
        /** 8 MB: small enough for any proxy and a phone's memory, big enough to move quickly. */
        const val PIECE = 8 * 1024 * 1024
    }
}

/** The file an upload is a new version of, and the version it was edited from. */
data class Replacing(val fileId: String, val contentVersion: Int)

/** "3.1 MB", "15 KB": sizes as people read them. */
fun readableSize(bytes: Long): String {
    if (bytes < 1000) return "$bytes B"
    val units = listOf("KB", "MB", "GB", "TB")
    var value = bytes / 1000.0
    var unit = 0
    while (value >= 1000 && unit < units.lastIndex) { value /= 1000; unit += 1 }
    val rounded = if (value >= 100) value.toLong().toString() else ((value * 10).toLong() / 10.0).toString().removeSuffix(".0")
    return "$rounded ${units[unit]}"
}

/** Uploads kept in the app: they go on while it's open, and stop when it closes. */
class InAppUploads(private val drive: Drive) : Uploads {
    private val scope = kotlinx.coroutines.CoroutineScope(kotlinx.coroutines.SupervisorJob())
    private val state = kotlinx.coroutines.flow.MutableStateFlow<List<UploadStatus>>(emptyList())
    private val jobs = mutableMapOf<String, kotlinx.coroutines.Job>()
    override val statuses: kotlinx.coroutines.flow.StateFlow<List<UploadStatus>> = state

    private fun update(id: String, change: (UploadStatus) -> UploadStatus) {
        state.value = state.value.map { if (it.id == id) change(it) else it }
    }

    private val files = mutableMapOf<String, Pair<PickedFile, String>>()
    private val locations = mutableMapOf<String, String>()

    override fun start(files: List<PickedFile>, folderId: String) {
        files.forEach { file ->
            val id = randomId()
            this.files[id] = file to folderId
            state.value = state.value + UploadStatus(id, file.name, file.size, 0, folderId)
            run(id)
        }
    }

    private fun run(id: String) {
        val (file, folderId) = files[id] ?: return
        jobs[id] = scope.launch {
            try {
                drive.upload(file, folderId, resumeAt = locations[id], started = { locations[id] = it }) { sent -> update(id) { it.copy(sent = sent, failed = null) } }
                update(id) { it.copy(sent = it.size, done = true) }
                files.remove(id); locations.remove(id)
            } catch (problem: KimonoProblem) {
                update(id) { it.copy(failed = problem.message) }
            }
        }
    }

    override fun retry(id: String) {
        update(id) { it.copy(failed = null) }
        run(id)
    }

    override fun dismiss(id: String) {
        jobs.remove(id)?.cancel()
        files.remove(id); locations.remove(id)
        state.value = state.value.filterNot { it.id == id }
    }

    private fun randomId() = (1..16).map { "abcdefghijklmnopqrstuvwxyz0123456789".random() }.joinToString("")
}

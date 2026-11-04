package app.kimono.data

import io.ktor.client.request.header
import io.ktor.client.request.setBody
import io.ktor.client.statement.bodyAsChannel
import io.ktor.http.ContentType
import io.ktor.http.HttpMethod
import io.ktor.http.content.ByteArrayContent
import io.ktor.http.contentType
import io.ktor.http.isSuccess
import io.ktor.utils.io.readAvailable
import kotlinx.coroutines.delay
import kotlinx.io.buffered
import kotlinx.io.files.Path
import kotlinx.io.files.SystemFileSystem
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.buildJsonObject
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
private data class SpaceList(val spaces: List<DriveSpace>)

@Serializable
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

    suspend fun trash(): List<DriveNode> = json.decodeFromString<TrashList>(session.call("/api/v1/drive/trash")).items

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
     * already downloaded at the same content version is used as it is.
     */
    suspend fun download(node: DriveNode, directory: String, progress: (Long) -> Unit): String {
        val folder = Path(directory, "drive", "${node.id}-${node.contentVersion}")
        val target = Path(folder, node.name)
        SystemFileSystem.metadataOrNull(target)?.let { if (it.size == node.size) return target.toString() }
        SystemFileSystem.createDirectories(folder)
        val partial = Path(folder, ".${node.name}.part")
        session.respond("/api/v1/drive/nodes/${node.id}/content", handle = { response ->
            if (!response.status.isSuccess()) throw session.problemOf(response, "That file couldn't be opened.")
            val channel = response.bodyAsChannel()
            val buffer = ByteArray(64 * 1024)
            var received = 0L
            SystemFileSystem.sink(partial).buffered().use { sink ->
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
     * Uploads [file] into [folderId] and returns the new file's id. Bytes go
     * in pieces of [PIECE]; after a dropped connection it asks the server how
     * much arrived and carries on from there, backing off a little each time.
     */
    @OptIn(ExperimentalEncodingApi::class)
    suspend fun upload(file: PickedFile, folderId: String, progress: (Long) -> Unit): String {
        val tus = "1.0.0"
        val metadata = "filename ${Base64.encode(file.name.encodeToByteArray())},folder ${Base64.encode(folderId.encodeToByteArray())}"
        val location = session.respond("/api/v1/drive/uploads", HttpMethod.Post, {
            header("Tus-Resumable", tus)
            header("Upload-Length", file.size.toString())
            header("Upload-Metadata", metadata)
        }) { response ->
            if (response.status.value != 201) throw session.problemOf(response, "That file couldn't be uploaded.")
            response.headers["Location"] ?: throw KimonoProblem("That file couldn't be uploaded.")
        }
        var offset = 0L
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
        session.respond(location, HttpMethod.Head, { header("Tus-Resumable", "1.0.0") }) { it.headers["Upload-Offset"]?.toLongOrNull() }
    }.getOrNull()

    companion object {
        /** 8 MB: small enough for any proxy and a phone's memory, big enough to move quickly. */
        const val PIECE = 8 * 1024 * 1024
    }
}

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

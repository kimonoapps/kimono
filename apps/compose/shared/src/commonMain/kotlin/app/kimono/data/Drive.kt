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
data class DriveSpace(
    val id: String, val name: String, val crest: String, val rootId: String, val role: String, val members: Int,
    val createdBy: String = "",
    val color: String = "plum",
)

@Serializable
data class SpaceMember(val username: String, val role: String)

/** A space with who is in it. */
@Serializable
data class SpaceDetail(val id: String, val name: String, val crest: String, val rootId: String, val role: String, val memberList: List<SpaceMember>, val color: String = "plum", val mark: String? = null, val link: String? = null, val linkAccess: String? = null)

@Serializable
data class CrestChoice(val id: String, val jp: String, val name: String)

@Serializable
data class CrestColour(val id: String, val jp: String, val name: String, val hex: String)

/** Every crest a space can have, in every colour, drawn by the Portal. */
@Serializable
data class CrestCatalogue(val crests: List<CrestChoice>, val colors: List<CrestColour>, val marks: Map<String, Map<String, String>>) {
    fun mark(crest: String, colour: String): String? = marks[crest]?.get(colour)
}

/** Someone with a Kimono account, whom a space can be shared with. */
@Serializable
data class Person(val username: String, val name: String, val picture: String? = null)

@Serializable
private data class PeopleList(val people: List<Person>)

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
    /** What a folder is to another app: "notebook" (Notes), "chat" or "project" (Kimono AI); null for a plain folder. */
    val purpose: String? = null,
    /** For a chat, the chat it holds. */
    val ref: String? = null,
) {
    val isFolder get() = kind == "folder"

    /** Where a notebook or chat opens, in its own app; null for anything Drive opens itself. */
    val appRoute: String? get() = when {
        !isFolder -> null
        purpose == "notebook" -> "notes/$id"
        purpose == "chat" && ref != null -> "code/$ref"
        else -> null
    }

    /** Photos, videos and PDFs: the files a small picture says more about than an icon. */
    val mayHaveThumbnail: Boolean get() {
        if (isFolder || size <= 0) return false
        val type = mime ?: when (name.substringAfterLast('.', "").lowercase()) {
            "jpg", "jpeg", "png", "heic", "heif", "gif", "webp", "bmp", "tif", "tiff", "dng" -> "image/"
            "mp4", "mov", "m4v", "3gp", "mkv", "webm", "avi" -> "video/"
            "pdf" -> "application/pdf"
            else -> return false
        }
        return type.startsWith("image/") || type.startsWith("video/") || type == "application/pdf"
    }
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
    /** The mark at the centre of its bloom, when it has one of Kimono's own. */
    val glyph: String? = null,
    val icon: String? = null,
    val web: String,
    val ios: String? = null,
    val android: String? = null,
)

@Serializable
private data class DriveLook(val id: String = "kimono-drive", val accent: String? = null, val glyph: String? = null)

/** What an app's bloom is drawn from: its id, its one colour and the glyph at its heart. */
data class BloomLook(val id: String, val accent: String, val glyph: String?)

@Serializable
private data class AppList(
    val apps: List<KimonoAppLink>, val launcher: List<LauncherApp>? = null, val drive: DriveLook? = null, val driveOn: Boolean = true,
    val myApps: List<String>? = null, val categories: List<AppGroup> = emptyList(),
)

/** One of Home's groups of apps (Productivity, For you…), by id, in order. */
@Serializable
data class AppGroup(val id: String, val label: String, val apps: List<String>)

@Serializable
private data class MyAppList(val apps: List<String>)

/** An app this person can open, as the website's rail and Apps grid list it. [own] apps live inside Kimono. */
@Serializable
data class LauncherApp(
    val id: String, val name: String, val fullName: String = name, val description: String = "", val accent: String, val glyph: String? = null,
    val icon: String? = null, val own: Boolean = false, val web: String, val ios: String? = null, val android: String? = null,
    val phoneApp: PhoneApp? = null,
)

/** An app's own phone app (Immich for Photos): where to get it, and the website's steps for setting it up. */
@Serializable
data class PhoneApp(val name: String, val guide: String = "", val androidPackage: String? = null, val release: PhoneAppRelease? = null, val steps: List<PhoneAppStep> = emptyList())

/** A phone app Kimono hands out itself (an APK, not a store): the version to be on, where it is, and the package's SHA-256. */
@Serializable
data class PhoneAppRelease(val url: String, val version: String, val sha256: String? = null)

@Serializable
data class PhoneAppStep(val title: String, val description: String, val kind: String, val href: String? = null, val label: String? = null)

/** The link that opens this phone app already pointed at its server (kimono-photos://connect?server=…), when it has one. */
val PhoneApp.connectLink: String? get() = steps.firstOrNull { it.kind == "open" }?.href

/**
 * Whether version [offered] is newer than [installed] ("3.1.0-kimono.2" over
 * "3.1.0-kimono.1"): compared part by part, numbers as numbers.
 */
fun newerVersion(offered: String, installed: String): Boolean {
    val a = Regex("[0-9]+|[A-Za-z]+").findAll(offered).map { it.value }.toList()
    val b = Regex("[0-9]+|[A-Za-z]+").findAll(installed).map { it.value }.toList()
    for (i in 0 until maxOf(a.size, b.size)) {
        val x = a.getOrNull(i) ?: return false
        val y = b.getOrNull(i) ?: return true
        val nx = x.toLongOrNull(); val ny = y.toLongOrNull()
        val order = if (nx != null && ny != null) nx.compareTo(ny) else x.compareTo(y)
        if (order != 0) return order > 0
    }
    return false
}

private val json = Json { ignoreUnknownKeys = true }

/**
 * 堂 Kimono Drive, as the Kimono apps use it. Uploads speak tus to the same
 * endpoints as the iPhone's Files app, in pieces small enough for any proxy,
 * and pick up where they stopped after a dropped connection.
 */
class Drive(private val session: Session) {
    private val answers get() = session.answers

    /** What [path] answered last time, if it still reads. */
    private inline fun <reified T> known(path: String): T? =
        answers.peek(path)?.let { text -> runCatching { json.decodeFromString<T>(text) }.getOrNull() }

    /* What each screen showed last, to open on while it asks again. */
    fun knownSpaces(): List<DriveSpace>? = known<SpaceList>(SPACES)?.spaces
    fun knownFolder(id: String): DriveFolder? = known("/api/v1/drive/nodes/$id")
    fun knownSpace(id: String): SpaceDetail? = known("/api/v1/drive/spaces/$id")
    fun knownTrash(): List<DriveNode>? = known<TrashList>(TRASH)?.items
    fun knownPeople(): List<Person>? = known<PeopleList>(PEOPLE)?.people
    fun knownApps(): List<KimonoAppLink>? = known<AppList>(APPS)?.also(::heard)?.apps

    suspend fun spaces(): List<DriveSpace> = json.decodeFromString<SpaceList>(session.fetch(SPACES)).spaces

    suspend fun folder(id: String): DriveFolder = json.decodeFromString(session.fetch("/api/v1/drive/nodes/$id"))

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
        answers.drop("/api/v1/drive/nodes/$parentId")
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

    suspend fun trash(): List<DriveNode> = json.decodeFromString<TrashList>(session.fetch(TRASH)).items

    /** Files and folders whose names contain [query], closest first. */
    suspend fun search(query: String): List<DriveNode> =
        json.decodeFromString<TrashList>(session.call("/api/v1/drive/search?q=${query.encodeURLParameter()}")).items

    /** The most recently changed files, newest first. */
    suspend fun recent(): List<DriveNode> = json.decodeFromString<TrashList>(session.fetch("/api/v1/drive/recent")).items

    /** A new space, with its crest and the people it starts with. */
    suspend fun createSpace(name: String, crest: String = "sakura", colour: String = "plum", members: List<SpaceMember> = emptyList()): DriveSpace = json.decodeFromString<DriveSpace>(session.call(SPACES, HttpMethod.Post) {
        contentType(ContentType.Application.Json)
        setBody(buildJsonObject {
            put("name", name)
            put("crest", crest)
            put("color", colour)
            put("members", kotlinx.serialization.json.buildJsonArray {
                members.forEach { member -> add(buildJsonObject { put("username", member.username); put("role", member.role) }) }
            })
        }.toString())
    }).also { answers.drop(SPACES) }

    suspend fun space(id: String): SpaceDetail = json.decodeFromString(session.fetch("/api/v1/drive/spaces/$id"))

    /* A space changed here: keep what it answered, and let the list of spaces ask again. */
    private fun changed(detail: SpaceDetail): SpaceDetail {
        answers.put("/api/v1/drive/spaces/${detail.id}", json.encodeToString(SpaceDetail.serializer(), detail))
        answers.drop(SPACES)
        return detail
    }

    /** Renames a space or changes its crest. Owners only. */
    suspend fun editSpace(id: String, name: String? = null, crest: String? = null, colour: String? = null): SpaceDetail = changed(json.decodeFromString(session.call("/api/v1/drive/spaces/$id", HttpMethod.Patch) {
        contentType(ContentType.Application.Json)
        setBody(buildJsonObject { name?.let { put("name", it) }; crest?.let { put("crest", it) }; colour?.let { put("color", it) } }.toString())
    }))

    /** Adds someone, changes their role, or (role null) takes them out; anyone may take themselves out. Null when you left. */
    suspend fun setMember(spaceId: String, username: String, role: String?): SpaceDetail? {
        val answer = session.call("/api/v1/drive/spaces/$spaceId/members", HttpMethod.Put) {
            contentType(ContentType.Application.Json)
            setBody(buildJsonObject { put("username", username); put("role", role) }.toString())
        }
        if (json.parseToJsonElement(answer).jsonObject.containsKey("left")) {
            answers.drop("/api/v1/drive/spaces/$spaceId"); answers.drop(SPACES)
            return null
        }
        return changed(json.decodeFromString<SpaceDetail>(answer))
    }

    /** Opens the space to anyone with its link ("view" or "add"), or closes the link (null). Owners only. */
    suspend fun setSpaceLink(spaceId: String, access: String?): SpaceDetail =
        if (access == null) { session.call("/api/v1/drive/spaces/$spaceId/link", HttpMethod.Delete); space(spaceId) }
        else changed(json.decodeFromString(session.call("/api/v1/drive/spaces/$spaceId/link", HttpMethod.Put) {
            contentType(ContentType.Application.Json)
            setBody(buildJsonObject { put("access", access) }.toString())
        }))

    /** Where a space's link opens: the Kimono's own guest page. */
    fun spaceLinkUrl(token: String): String = "${session.server?.trimEnd('/') ?: ""}/s/$token"

    /** Everyone with a Kimono account. */
    suspend fun people(): List<Person> = json.decodeFromString<PeopleList>(session.fetch(PEOPLE)).people

    suspend fun createFolder(parentId: String, name: String): DriveNode = json.decodeFromString(session.call("/api/v1/drive/nodes/$parentId/folders", HttpMethod.Post) {
        contentType(ContentType.Application.Json)
        setBody(buildJsonObject { put("name", name) }.toString())
    })

    suspend fun rename(id: String, name: String) {
        session.call("/api/v1/drive/nodes/$id", HttpMethod.Patch) {
            contentType(ContentType.Application.Json)
            setBody(buildJsonObject { put("name", name) }.toString())
        }
        /* A folder's own answer carries its name. */
        answers.drop("/api/v1/drive/nodes/$id")
    }

    suspend fun moveToTrash(id: String) { session.call("/api/v1/drive/nodes/$id", HttpMethod.Delete); answers.drop(TRASH) }

    /* Back in a folder this phone may have kept without it: that folder asks again when opened. */
    suspend fun restore(id: String) {
        session.call("/api/v1/drive/nodes/$id/restore", HttpMethod.Post)
        knownTrash()?.firstOrNull { it.id == id }?.parentId?.let { answers.drop("/api/v1/drive/nodes/$it") }
    }

    /** Turns on the file's public link (or returns the one it has). */
    suspend fun link(id: String): String = json.decodeFromString<LinkAnswer>(session.call("/api/v1/drive/nodes/$id/link", HttpMethod.Post)).url

    suspend fun unlink(id: String) { session.call("/api/v1/drive/nodes/$id/link", HttpMethod.Delete) }

    /** What Drive's own bloom is drawn from; arrives with the list of apps. */
    val driveBloom = kotlinx.coroutines.flow.MutableStateFlow<BloomLook?>(null)
    /** Whether the household's Kimono has Drive switched on; null until asked. */
    val driveOn = kotlinx.coroutines.flow.MutableStateFlow<Boolean?>(null)

    suspend fun otherApps(): List<KimonoAppLink> = json.decodeFromString<AppList>(session.fetch(APPS)).also(::heard).apps

    /** Every app this person can open, for the Apps tab; null until the Portal has answered once. */
    val launcher = kotlinx.coroutines.flow.MutableStateFlow<List<LauncherApp>?>(null)

    /**
     * My apps: the few under the flower, in order, the same list as the
     * website's rail. Kept on the server; null until it has answered.
     */
    val myApps = kotlinx.coroutines.flow.MutableStateFlow<List<String>?>(null)
    /** Home's groups of every app. */
    val appGroups = kotlinx.coroutines.flow.MutableStateFlow<List<AppGroup>>(emptyList())

    /** Changes My apps: shown at once, saved behind it; if saving fails, the server's list comes back. */
    suspend fun setMyApps(ids: List<String>) {
        val before = myApps.value
        myApps.value = ids
        try {
            session.call(MY_APPS, HttpMethod.Put) { contentType(ContentType.Application.Json); setBody(json.encodeToString(MyAppList.serializer(), MyAppList(ids))) }
            answers.drop(APPS)
        } catch (problem: KimonoProblem) { myApps.value = before; throw problem }
    }

    private fun heard(list: AppList) {
        list.myApps?.let { myApps.value = it }
        appGroups.value = list.categories
        list.drive?.let { look -> look.accent?.let { driveBloom.value = BloomLook(look.id, it, look.glyph ?: "file") } }
        driveOn.value = list.driveOn
        launcher.value = list.launcher ?: olderLauncher(list)
    }

    /* A Portal from before the Apps tab sends no launcher list: make one from what it does send. */
    private fun olderLauncher(list: AppList): List<LauncherApp> = buildList {
        val drive = list.drive
        if (list.driveOn && drive?.accent != null) add(LauncherApp(drive.id, "Drive", "Kimono Drive", "Your spaces and files.", drive.accent, drive.glyph ?: "file", own = true, web = ""))
        list.apps.forEach { add(LauncherApp(it.id, it.shortName, it.name, it.description, it.accent, it.glyph, it.icon, own = it.id == Code.APP_ID, web = it.web, ios = it.ios, android = it.android, phoneApp = phoneAppFrom(it))) }
    }

    /* An app with a phone app of its own, worked out from its download links: the package from a Play link, the version from an APK's name. */
    private fun phoneAppFrom(app: KimonoAppLink): PhoneApp? {
        if (app.ios == null && app.android == null) return null
        val android = app.android
        val playId = android?.let { Regex("[?&]id=([\\w.]+)").find(it)?.groupValues?.get(1) }
        val apk = android?.takeIf { Regex("\\.apk(\\?|$)").containsMatchIn(it) }
        val version = apk?.let { Regex("-(\\d+\\.\\d+(?:\\.\\d+)?(?:[-+.][\\w.]+)?)\\.apk").find(it.substringBefore('?').substringAfterLast('/'))?.groupValues?.get(1) }
        /* Kimono Photos from a Portal that doesn't describe it: its package, and the link that hands it its address. */
        val photos = apk?.substringBefore('?')?.substringAfterLast('/')?.startsWith("kimono-photos-") == true
        val origin = Regex("^https://[^/]+").find(app.web)?.value
        val connect = if (photos && origin != null) listOf(PhoneAppStep("Open ${app.name}", "", "open", "kimono-photos://connect?server=" + origin.encodeURLParameter())) else emptyList()
        return PhoneApp(name = app.name, androidPackage = playId ?: "app.kimono.photos".takeIf { photos }, release = if (apk != null && version != null) PhoneAppRelease(apk, version) else null, steps = connect)
    }

    /* Drive's tab and bloom are there from the first frame, as they were last time. */
    init { knownApps() }

    private var catalogue: CrestCatalogue? = null

    /** The crests and colours to pick from: kept, and asked again once per launch. */
    suspend fun crests(): CrestCatalogue = catalogue
        ?: runCatching { json.decodeFromString<CrestCatalogue>(session.fetch(CRESTS)) }.getOrElse { problem -> known<CrestCatalogue>(CRESTS) ?: throw problem }.also { catalogue = it }

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
        private const val SPACES = "/api/v1/drive/spaces"
        private const val TRASH = "/api/v1/drive/trash"
        private const val PEOPLE = "/api/v1/drive/people"
        private const val APPS = "/api/v1/apps"
        private const val MY_APPS = "/api/v1/me/apps"
        private const val CRESTS = "/api/v1/drive/crests"

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

package app.kimono.data

import io.ktor.client.request.header
import io.ktor.client.request.setBody
import io.ktor.client.statement.bodyAsBytes
import io.ktor.client.statement.bodyAsChannel
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpMethod
import io.ktor.http.content.ByteArrayContent
import io.ktor.http.contentType
import io.ktor.http.encodeURLParameter
import io.ktor.http.isSuccess
import io.ktor.utils.io.readUTF8Line
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.flow.StateFlow
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.encodeToJsonElement
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.put

/* ── What Kimono AI answers with (apps/portal/src/lib/code/model.ts, events.ts; the web's code/api.ts) ── */

@Serializable
data class CodeRepo(val owner: String, val name: String)

@Serializable
data class CodePullRequest(val url: String, val number: Int)

@Serializable
data class CodePreview(val url: String, val port: Int, val kind: String? = null, val stopped: Boolean = false) {
    /** The address without its scheme, as the cards show it. */
    val host get() = url.substringAfter("://")
    /** The link's own name, the first part of its host: recipes in recipes.example.dev. */
    val name get() = host.substringBefore(".")
    /** What follows the name: .example.dev, and a port if it has one. */
    val suffix get() = host.removePrefix(name).substringBefore("/")
}

/** How a published app is doing, as the node says: running, starting, crashed, stopped, asleep or down. */
@Serializable
data class AppHealth(val state: String = "down", val restarts: Int = 0, val exit: Int? = null, val since: Long? = null)

@Serializable
data class AppStatus(val health: AppHealth = AppHealth(), val log: String = "")

@Serializable
data class CodeTurn(val id: String, val state: String, val startedAt: Long, val endedAt: Long? = null)

/** Where a chat's files live in Drive: its folder in the person's Kimono AI space. */
@Serializable
data class CodeDrive(val spaceId: String, val folderId: String)

/** The project (a folder of chats) a chat is in. */
@Serializable
data class CodeFolder(val id: String, val name: String)

@Serializable
data class CodeWorkspace(
    val id: String, val title: String, val repo: CodeRepo, val base: String, val branch: String,
    /** A chat has no project; a project works on a Kimono Git repository. */
    val kind: String = "chat",
    val folder: CodeFolder? = null,
    val pullRequest: CodePullRequest? = null,
    val preview: CodePreview? = null,
    val previewName: String? = null,
    val drive: CodeDrive? = null,
    val createdAt: Long = 0, val updatedAt: Long = 0, val lastSeq: Long = 0,
    val turn: CodeTurn? = null,
    /** When its owner archived it: then it shows under Archived, not in the list. */
    val archivedAt: Long? = null,
    /** The model that answered its last message. */
    val lastModel: String? = null,
    /** Whose chat it is, and what this person may do in it: "owner", or shared with them to "edit" (write) or "read". */
    val owner: String = "",
    val access: String = "owner",
) {
    val running get() = turn?.state == "running"
    val isOwner get() = access == "owner"
    /** Writing in it: the owner, or someone it was shared with to write. */
    val canWrite get() = access != "read"
    val isProject get() = kind == "project"
    /** A chat that is building something: a project, or one running an app. Only these show files, changes and the app. */
    val isApp get() = isProject || preview != null
}

/** A folder a person keeps chats in. */
@Serializable
data class CodeProject(val id: String, val name: String, val createdAt: Long = 0)

@Serializable
data class CodeRepository(val owner: String, val name: String, val description: String = "", val defaultBranch: String = "main", val updatedAt: Long = 0, val private: Boolean = false)

@Serializable
/** A file sent with a message. One over 20 MB is a file in the chat's Drive folder ([node]), in the sandbox at its /workspace path. */
data class CodeAttachment(val name: String, val path: String, val size: Long, val type: String, val node: String? = null) {
    val isPicture get() = type in setOf("image/png", "image/jpeg", "image/gif", "image/webp")
}

@Serializable
data class Memory(val id: String, val text: String, val source: String = "person", val createdAt: Long = 0)

/** A skill's slash command: what to type, what goes after it, and what it does. */
@Serializable
data class SkillCommand(val name: String, val hint: String? = null, val does: String = "")

/** A skill from For you, and whether it's on for this person. */
@Serializable
data class SkillChoice(val id: String, val name: String, val description: String = "", val enabled: Boolean = false, val command: SkillCommand? = null, val icon: String = "spark", val author: String = "", val source: String = "", val kind: String = "on-demand", val custom: CustomSkill? = null)

/** A skill someone here wrote: whether it's this person's, in the Marketplace, its instructions, how many use it, and who wrote it (username). */
@Serializable
data class CustomSkill(val mine: Boolean = false, val published: Boolean = false, val editable: Boolean = false, val body: String? = null, val uses: Int = 0, val by: String = "") {
    /** Someone else's, published: in the Marketplace, and in this person's Skills only once added. */
    val inMarket: Boolean get() = published && !mine
}

/** The skills, and whether this person is an admin (who can take anyone's down). Everyone publishes their own. */
@Serializable
data class SkillCatalog(val skills: List<SkillChoice> = emptyList(), val admin: Boolean = false)

@Serializable
private data class SkillList(val skills: List<SkillChoice> = emptyList())

/** What Kimono AI keeps about a person: their instructions, and its memories. */
@Serializable
data class CodeProfile(val instructions: String = "", val memories: List<Memory> = emptyList())

/** An app the person connected through Composio. */
@Serializable
data class Connection(val app: String, val name: String, val logo: String = "", val account: String, val status: String, val since: String? = null)

@Serializable
data class Connections(val available: Boolean = false, val connections: List<Connection> = emptyList(), val pro: List<ConnectableApp> = emptyList())

@Serializable
data class ConnectableApp(val app: String, val name: String, val logo: String = "", val description: String = "", val connected: Boolean = false) {
    /** Composio's own toolkits are how apps connect, not apps of their own. */
    val real get() = !app.startsWith("composio")
}

@Serializable
data class AppPage(val apps: List<ConnectableApp> = emptyList(), val next: String? = null)

@Serializable
data class AppTool(val name: String, val description: String = "")

/** One app in full, for its own page in Connections. */
@Serializable
data class AppDetails(val app: String, val name: String, val logo: String = "", val description: String = "", val categories: List<String> = emptyList(), val tools: List<AppTool> = emptyList(), val toolCount: Int? = null)

@Serializable
data class AppLook(val name: String, val logo: String = "")

@Serializable
data class AccessSpace(val id: String, val name: String, val crest: String = "", val color: String = "plum", val canChange: Boolean = false, val auto: String? = null)

@Serializable
data class AccessGrant(val id: String, val spaceId: String, val spaceName: String, val path: String, val need: String)

/** What Kimono AI may use without asking. */
@Serializable
data class AccessSettings(val spaces: List<AccessSpace> = emptyList(), val grants: List<AccessGrant> = emptyList())

@Serializable
data class SandboxLimits(val cpus: Int = 1, val memoryMb: Int = 0, val awakePerPerson: Int = 0, val awakePerNode: Int = 0, val diskGb: Double = 0.0)

@Serializable
data class SandboxDisk(val used: Long? = null, val quota: Long = 0, val at: Long? = null)

/** What a chat's sandbox may use, and its disk as last measured (bytes). */
@Serializable
data class SandboxStatus(val limits: SandboxLimits = SandboxLimits(), val disk: SandboxDisk = SandboxDisk())

@Serializable
data class UsageWindow(val used: Double = 0.0, val share: Double = 1.0, val resetsAt: Long? = null) {
    val fraction get() = if (share <= 0.0) 0.0 else used / share
}

/** This month's allowance for paid tools (voice, video, pictures, web search…), in US dollars; spent is null until it's known. */
@Serializable
data class MediaAllowance(val budget: Double = 0.0, val spent: Double? = null, val resetsAt: Long? = null, val chatSpent: Double = 0.0) {
    val fraction get() = spent?.let { if (budget <= 0.0) 0.0 else (it / budget).coerceAtMost(1.0) }
    /** What's left of the month's budget: "1,753 of 2,000 credits left". */
    val leftWords get() = spent?.let { "${credits((budget - it).coerceAtLeast(0.0))} of ${credits(budget)} credits left" } ?: "${credits(budget)} credits"
    val words get() = spent?.let { "${credits(it)} of ${credits(budget)} credits this month${if (chatSpent > 0) " · ${credits(chatSpent)} in this chat" else ""}" }
}

/**
 * Which meters show: each only once it's past half; tools also once the chat
 * asked about has spent some. Null is hidden.
 */
data class ShownMeters(val context: Double?, val fiveHour: Double?, val week: Double?, val tools: Double?) {
    val any get() = context != null || fiveHour != null || week != null || tools != null
    /** The fullest one shown, for a single ring. */
    val most get() = listOfNotNull(context, fiveHour, week, tools).maxOrNull()

    companion object {
        private fun past(v: Double?) = v?.takeIf { it > 0.5 }
        fun of(usage: Usage?, context: Double?): ShownMeters {
            val reported = usage?.takeIf { it.reported }
            val media = usage?.media
            return ShownMeters(
                context = past(context),
                fiveHour = past(reported?.takeIf { !it.noFiveHour }?.fiveHour?.fraction),
                week = past(reported?.week?.fraction),
                tools = media?.let { m -> m.fraction?.takeIf { it > 0.5 || m.chatSpent > 0 } },
            )
        }
    }
}

/** Pro Tools are counted in credits, a hundred to the dollar: "247 of 1,000 credits". Under ten, to a tenth. */
private fun credits(usd: Double): String {
    val c = usd * 100
    if (c > 0 && c < 10) return (kotlin.math.round(c * 10) / 10).toString().removeSuffix(".0")
    val whole = kotlin.math.round(c).toLong().toString()
    return whole.reversed().chunked(3).joinToString(",").reversed()
}

/** The person's own use of the plan (this 5-hour window and this week, against their share), and of this month's Pro Tools allowance. */
@Serializable
data class Usage(
    val model: String = "", val unlimited: Boolean = false, val reported: Boolean = false, val fiveHourLimited: Boolean? = null,
    val fiveHour: UsageWindow = UsageWindow(), val week: UsageWindow = UsageWindow(),
    val media: MediaAllowance? = null,
) {
    /** This plan has no 5-hour window at all. */
    val noFiveHour get() = reported && fiveHourLimited == false
}

@Serializable
/** `media` is where its media/<file> sounds, videos and pictures are served. */
data class ArtifactSaved(val name: String, val title: String = "", val content: String = "", val version: Int = 0, val updatedAt: Long = 0, val media: String? = null)

/** How full the conversation is, as the last reply said. */
data class ContextUse(val used: Long, val window: Long?)

/** One entry on a chat's timeline, in the kinds Portal stores (lib/code/events.ts). */
sealed interface CodeEvent {
    /** [dropped]: sent while it worked and never read, because it was stopped first (set from a later "dropped" event). */
    data class Ask(val by: String, val text: String, val attachments: List<CodeAttachment>, val queued: Boolean, val dropped: Boolean = false) : CodeEvent
    data object Started : CodeEvent
    data class Say(val text: String) : CodeEvent
    /** [pro]: it ran on one of Composio's own accounts, a Pro Tool. */
    data class Tool(val id: String, val name: String, val label: String, val detail: String?, val change: String?, val app: String?, val space: String?, val pro: Boolean = false, val progress: ToolProgress? = null) : CodeEvent
    data class ToolResult(val id: String, val ok: Boolean, val output: String) : CodeEvent
    /** How a long job stands, as Kimono read it from the sandbox; [id] is the call that started its card. [watched]: the sandbox follows it after the turn too. */
    data class Progress(val id: String, val state: String, val status: String?, val percent: Double?, val left: Double?, val watched: Boolean) : CodeEvent
    data class Done(val ok: Boolean, val cancelled: Boolean, val error: String?, val durationMs: Long?, val model: String?, val context: ContextUse?) : CodeEvent
    data class Compacted(val before: Long?) : CodeEvent
    data class Published(val url: String, val number: Int) : CodeEvent
    data class Image(val name: String, val caption: String?) : CodeEvent
    data class Preview(val url: String, val port: Int, val app: String?) : CodeEvent { val host get() = url.substringAfter("://") }
    data object PreviewStopped : CodeEvent
    data class Slept(val forTitle: String) : CodeEvent
    data class Disk(val used: Long, val quota: Long, val full: Boolean) : CodeEvent
    data class Access(val id: String, val space: String, val path: String, val need: String, val why: String, val file: Boolean, val state: String, val node: String?) : CodeEvent
    data class AccessAnswer(val id: String, val state: String, val scope: String?, val need: String?) : CodeEvent
    /** It asks the person 1 to 4 questions at once; the panel stands in for the composer until a [QuestionAnswer] with this [id]. */
    data class Question(val id: String, val questions: List<AskedQuestion>) : CodeEvent
    data class QuestionAnswer(val id: String, val skipped: Boolean, val answers: List<QuestionReply>) : CodeEvent
    data class Remembered(val text: String, val how: String?) : CodeEvent
    /** A skill it made with the person (the Skill builder): saved as theirs, in the Marketplace when [published]; [problem] when it couldn't be. */
    data class SkillMade(val skill: String?, val name: String, val command: String?, val published: Boolean, val updated: Boolean, val problem: String?) : CodeEvent
    data class Connect(val app: String, val url: String) : CodeEvent
    data class Artifact(val id: String, val name: String, val action: String) : CodeEvent
    data class ArtifactKept(val name: String, val version: Int, val title: String) : CodeEvent
    data class Sent(val files: List<CodeAttachment>) : CodeEvent
    /* Passing only (seq 0): what it's writing right now, never kept. */
    data class Draft(val text: String) : CodeEvent
    data class ArtifactDraft(val id: String, val name: String, val content: String) : CodeEvent
    data class Renamed(val title: String) : CodeEvent
    /** Never stored: a message was changed, so the chat from it ([seq]) on went, and runs again from there. */
    data class Rewound(val seq: Long) : CodeEvent
    /** Messages sent while it worked: read by it now ([Steered]), or never, because it was stopped first ([Dropped]). */
    data class Steered(val seqs: List<Long>) : CodeEvent
    data class Dropped(val seqs: List<Long>) : CodeEvent
    /** What it is doing right now: working, thinking, writing, tools (with the app, space or sort of tool) or artifact. */
    data class Phase(val phase: String, val tool: String?, val app: String?, val space: String?) : CodeEvent
    data object Unknown : CodeEvent
}

data class QuestionOption(val label: String, val description: String?)
data class AskedQuestion(val question: String, val header: String, val options: List<QuestionOption>, val multi: Boolean)
/** One question's answer: the options picked, and what they wrote under Other, if anything. */
data class QuestionReply(val picked: List<String>, val other: String?)

data class StoredCodeEvent(val seq: Long, val at: Long, val event: CodeEvent)

@Serializable
data class CodeEntry(val name: String, val kind: String, val size: Long = 0)

@Serializable
data class CodeChangedFile(val path: String, val status: String, val additions: Int = 0, val deletions: Int = 0)

@Serializable
data class CodeChanges(val base: String, val branch: String, val truncated: Boolean = false, val diff: String = "", val files: List<CodeChangedFile> = emptyList())

/** An artifact someone shared with this person: its link opens it. */
@Serializable
data class SharedArtifact(val token: String, val name: String, val title: String = "", val owner: String = "", val updatedAt: Long = 0)

/** A person's chats: their own, and what others shared with them. */
@Serializable
data class CodeChats(
    @kotlinx.serialization.SerialName("workspaces") val own: List<CodeWorkspace> = emptyList(),
    val shared: List<CodeWorkspace> = emptyList(),
    val sharedArtifacts: List<SharedArtifact> = emptyList(),
)

/** Who a chat is shared with, and its link. Each person "read" or "edit"; the link too, or off. */
@Serializable
/** [publicLinks]: whether this Kimono lets a link open for someone not signed in (an administrator's switch). */
data class ChatSharing(val people: List<ChatInvite> = emptyList(), val link: ChatLink? = null, val publicLinks: Boolean = true)

@Serializable
data class ChatInvite(val username: String, val access: String)

@Serializable
data class ChatLink(val token: String, val access: String)

/** An artifact's link, and who may open it: the people it was shared with, or anyone once public. */
@Serializable
data class ArtifactSharing(val token: String? = null, val public: Boolean = false, val people: List<String> = emptyList(), val publicLinks: Boolean = true)

/** What a share link opens: a chat (kind "chat": id, access) or an artifact (kind "artifact": name, content). */
@Serializable
data class SharedLink(
    val kind: String, val title: String = "", val owner: String = "",
    val id: String? = null, val access: String? = null,
    val name: String? = null, val content: String? = null, val version: Int = 0, val public: Boolean = false,
    val media: String? = null,
)
@Serializable private data class People(val people: List<Person> = emptyList())
@Serializable private data class ProjectList(val projects: List<CodeProject>)
@Serializable private data class RepoList(val repositories: List<CodeRepository>)
@Serializable private data class BranchList(val branches: List<String>)
@Serializable private data class Folder(val path: String = "", val entries: List<CodeEntry>)
@Serializable private data class Attached(val attachments: List<CodeAttachment> = emptyList())
@Serializable private data class Link(val url: String)

/** How hard it thinks. Sonnet and Haiku stop at medium. */
val efforts = listOf("low", "medium", "high", "xhigh", "max")
val effortWords = mapOf("low" to "Low", "medium" to "Medium", "high" to "High", "xhigh" to "Extra high", "max" to "Max")
/** Which Claude answers: Auto (Kimono picks per message), or one the person chose. */
val modelChoices = listOf("auto", "fable", "opus", "sonnet", "haiku")
val modelWords = mapOf("auto" to ("Auto" to "Opus"), "fable" to ("Fable" to "Experimental, usually overkill"), "opus" to ("Opus" to "Best for building things"), "sonnet" to ("Sonnet" to "Everyday work"), "haiku" to ("Haiku" to "Quick answers"))
val modelNames = mapOf("fable" to "Fable", "opus" to "Opus", "sonnet" to "Sonnet", "haiku" to "Haiku")

private val json = Json { ignoreUnknownKeys = true; explicitNulls = false }

/**
 * A kimono-progress call: it began something long ([label], about [about] seconds), it's waiting, the tool
 * reported its [status] (with [percent] done or [left] seconds when it gave them), or it's [done]; [at] is when Kimono heard it (ms).
 */
data class ToolProgress(val label: String?, val about: Double?, val done: Boolean, val at: Long, val status: String? = null, val percent: Double? = null, val left: Double? = null, val only: Boolean = false)

private fun JsonObject.text(key: String) = this[key]?.jsonPrimitive?.takeIf { it.isString }?.content
private fun JsonObject.flag(key: String) = (this[key] as? JsonPrimitive)?.booleanOrNull
private fun JsonObject.long(key: String) = (this[key] as? JsonPrimitive)?.let { it.longOrNull ?: it.doubleOrNull?.toLong() }
private fun attachmentsOf(element: JsonElement?) = (element as? JsonArray)?.mapNotNull { runCatching { json.decodeFromJsonElement(CodeAttachment.serializer(), it) }.getOrNull() } ?: emptyList()

private fun repliesOf(element: JsonElement?) = (element as? JsonArray)?.mapNotNull { a ->
    (a as? JsonObject)?.let { ao -> QuestionReply((ao["picked"] as? JsonArray)?.mapNotNull { (it as? JsonPrimitive)?.contentOrNull } ?: emptyList(), ao.text("other")?.takeIf { it.isNotBlank() }) }
} ?: emptyList()

private fun eventOf(o: JsonObject): CodeEvent = when (o.text("kind")) {
    "ask" -> CodeEvent.Ask(o.text("by") ?: "", o.text("text") ?: "", attachmentsOf(o["attachments"]), o.flag("queued") == true)
    "started" -> CodeEvent.Started
    "text" -> CodeEvent.Say(o.text("text") ?: "")
    "tool" -> CodeEvent.Tool(o.text("id") ?: "", o.text("name") ?: "", o.text("label") ?: "", o.text("detail"), o.text("change"), o.text("app"), o.text("space"), o.flag("pro") == true,
        (o["progress"] as? JsonObject)?.let { p -> p.long("at")?.let { at -> ToolProgress(p.text("label"), (p["about"] as? JsonPrimitive)?.doubleOrNull, p.flag("done") == true, at, p.text("status"), (p["percent"] as? JsonPrimitive)?.doubleOrNull, (p["left"] as? JsonPrimitive)?.doubleOrNull, p.flag("only") == true) } })
    "tool-result" -> CodeEvent.ToolResult(o.text("id") ?: "", o.flag("ok") ?: true, o.text("output") ?: "")
    "progress" -> CodeEvent.Progress(o.text("id") ?: "", o.text("state") ?: "running", o.text("status"), (o["percent"] as? JsonPrimitive)?.doubleOrNull, (o["left"] as? JsonPrimitive)?.doubleOrNull, o.flag("watched") == true)
    "done" -> CodeEvent.Done(
        o.flag("ok") ?: false, o.flag("cancelled") ?: false, o.text("error"), o.long("durationMs"), o.text("model"),
        (o["context"] as? JsonObject)?.let { c -> c.long("used")?.let { ContextUse(it, c.long("window")) } },
    )
    "compacted" -> CodeEvent.Compacted(o.long("before"))
    "published" -> CodeEvent.Published(o.text("url") ?: "", o["number"]?.jsonPrimitive?.intOrNull ?: 0)
    "image" -> CodeEvent.Image(o.text("name") ?: "", o.text("caption"))
    "preview" -> CodeEvent.Preview(o.text("url") ?: "", o["port"]?.jsonPrimitive?.intOrNull ?: 0, o.text("app"))
    "preview-stopped" -> CodeEvent.PreviewStopped
    "slept" -> CodeEvent.Slept(o.text("for") ?: "")
    "disk" -> CodeEvent.Disk(o.long("used") ?: 0, o.long("quota") ?: 0, o.flag("full") == true)
    "access" -> CodeEvent.Access(o.text("id") ?: "", o.text("space") ?: "", o.text("path") ?: "", o.text("need") ?: "read", o.text("why") ?: "", o.flag("file") == true, o.text("state") ?: "pending", o.text("node"))
    "access-answer" -> CodeEvent.AccessAnswer(o.text("id") ?: "", o.text("state") ?: "denied", o.text("scope"), o.text("need"))
    "question" -> CodeEvent.Question(o.text("id") ?: "", (o["questions"] as? JsonArray)?.mapNotNull { q ->
        (q as? JsonObject)?.let { qo ->
            AskedQuestion(qo.text("question") ?: "", qo.text("header") ?: "",
                (qo["options"] as? JsonArray)?.mapNotNull { (it as? JsonObject)?.let { op -> QuestionOption(op.text("label") ?: "", op.text("description")?.takeIf { d -> d.isNotBlank() }) } }?.filter { it.label.isNotBlank() } ?: emptyList(),
                qo.flag("multi") == true)
        }
    }?.filter { it.question.isNotBlank() } ?: emptyList())
    "question-answer" -> CodeEvent.QuestionAnswer(o.text("id") ?: "", o.flag("skipped") == true, repliesOf(o["answers"]))
    "remembered" -> CodeEvent.Remembered(o.text("text") ?: "", o.text("how"))
    "skill-made" -> CodeEvent.SkillMade(o.text("skill"), o.text("name") ?: "A skill", o.text("command"), o.flag("published") == true, o.flag("updated") == true, o.text("problem"))
    "connect" -> CodeEvent.Connect(o.text("app") ?: "", o.text("url") ?: "")
    "artifact" -> CodeEvent.Artifact(o.text("id") ?: "", o.text("name") ?: "", o.text("action") ?: "wrote")
    "artifact-saved" -> CodeEvent.ArtifactKept(o.text("name") ?: "", o["version"]?.jsonPrimitive?.intOrNull ?: 0, o.text("title") ?: "")
    "sent" -> CodeEvent.Sent(attachmentsOf(o["files"]))
    "draft" -> CodeEvent.Draft(o.text("text") ?: "")
    "artifact-draft" -> CodeEvent.ArtifactDraft(o.text("id") ?: "", o.text("name") ?: "", o.text("content") ?: "")
    "renamed" -> CodeEvent.Renamed(o.text("title") ?: "")
    "rewound" -> CodeEvent.Rewound(o["seq"]?.jsonPrimitive?.longOrNull ?: 0L)
    "steered" -> CodeEvent.Steered((o["seqs"] as? kotlinx.serialization.json.JsonArray)?.mapNotNull { it.jsonPrimitive.longOrNull } ?: emptyList())
    "dropped" -> CodeEvent.Dropped((o["seqs"] as? kotlinx.serialization.json.JsonArray)?.mapNotNull { it.jsonPrimitive.longOrNull } ?: emptyList())
    "phase" -> CodeEvent.Phase(o.text("phase") ?: "working", o.text("tool"), o.text("app"), o.text("space"))
    else -> CodeEvent.Unknown
}

private fun storedOf(o: JsonObject) = StoredCodeEvent(o.long("seq") ?: 0, o.long("at") ?: 0, eventOf(o["event"]!!.jsonObject))

/**
 * 工 Kimono AI, as the phone uses it: the same /api/v1/code endpoints as the
 * web page. A chat's timeline streams while it's on screen, with what it is
 * writing as it writes; if the stream can't be held, it is asked for instead.
 */
@Serializable data class QuranChapter(val name: String, val arabic: String, val meaning: String = "", val verses: Int = 0)
@Serializable data class QuranVerse(val key: String, val number: Int, val arabic: String, val translation: Map<String, String> = emptyMap())
@Serializable data class TafsirSource(val id: Int, val name: String, val lang: String)
@Serializable data class ScriptureSource(val name: String, val url: String)
@Serializable data class QuranPassage(val ref: String, val surah: Int, val chapter: QuranChapter, val before: List<QuranVerse> = emptyList(), val verses: List<QuranVerse>, val after: List<QuranVerse> = emptyList(), val tafsirs: List<TafsirSource> = emptyList(), val source: ScriptureSource? = null)
@Serializable data class TafsirPart(val kind: String, val text: String, val ar: String? = null)
@Serializable data class Tafsir(val id: Int, val name: String, val lang: String, val covers: List<String> = emptyList(), val parts: List<TafsirPart> = emptyList(), val edition: String? = null, val source: ScriptureSource? = null)
@Serializable data class HadithGrade(val name: String, val grade: String)
@Serializable data class Hadith(val book: String, val bookName: String, val number: Int, val chapter: String? = null, val arabic: String = "", val translation: Map<String, String> = emptyMap(), val grades: List<HadithGrade> = emptyList(), val source: ScriptureSource? = null)
@Serializable private data class NoticeSeen(val seen: Boolean)

class Code(private val session: Session, private val platform: Platform? = null) {
    private fun ws(id: String) = "/api/v1/code/workspaces/${id.encodeURLParameter()}"
    private fun jsonBody(body: JsonObject): io.ktor.client.request.HttpRequestBuilder.() -> Unit = {
        contentType(ContentType.Application.Json)
        setBody(body.toString())
    }
    private fun JsonObject.Companion.of(vararg pairs: Pair<String, Any?>) = buildJsonObject {
        for ((key, value) in pairs) when (value) {
            null -> put(key, JsonNull)
            is String -> put(key, value)
            is Boolean -> put(key, value)
            is Number -> put(key, value)
            is JsonElement -> put(key, value)
            else -> error("unsupported")
        }
    }

    /* ── what a person chose: which Claude, how hard it thinks; kept between launches ── */
    private val _model = MutableStateFlow("auto")
    private val _effort = MutableStateFlow("high")
    val model: StateFlow<String> = _model
    val effort: StateFlow<String> = _effort
    suspend fun loadChoices() {
        platform?.readKept("kimono.ai.model")?.takeIf { it in modelChoices }?.let { _model.value = it }
        platform?.readKept("kimono.ai.effort")?.takeIf { it in efforts }?.let { _effort.value = it }
        platform?.readKept(STATE)?.let { text ->
            runCatching { json.parseToJsonElement(text).jsonObject }.getOrNull()?.forEach { (key, value) -> (value as? JsonPrimitive)?.content?.let { state[key] = it } }
        }
    }

    /*
     * Where someone was inside Kimono AI, kept between launches: what they were writing in
     * each chat and on the new-chat screen, the tab a chat was on, the folder and file open
     * in its files, and how far they had scrolled. Written a moment after it changes.
     */
    private val state = mutableMapOf<String, String>()
    private val saver = kotlinx.coroutines.CoroutineScope(kotlinx.coroutines.SupervisorJob() + kotlinx.coroutines.Dispatchers.Default)
    private var saving: kotlinx.coroutines.Job? = null
    fun recall(key: String): String? = state[key]
    fun keep(key: String, value: String?) {
        if (value.isNullOrEmpty()) { if (state.remove(key) == null) return } else { if (state[key] == value) return; state[key] = value }
        saving?.cancel()
        saving = saver.launch {
            kotlinx.coroutines.delay(400)
            val snapshot = JsonObject(state.toMap().mapValues { JsonPrimitive(it.value) })
            platform?.keep(STATE, snapshot.toString())
        }
    }
    /** Forgets everything kept about one chat, once it's deleted. */
    fun forgetChat(id: String) { state.keys.filter { it.endsWith(":$id") }.forEach { keep(it, null) } }
    suspend fun chooseModel(m: String) { _model.value = m; platform?.keep("kimono.ai.model", m) }
    suspend fun chooseEffort(e: String) { _effort.value = e; platform?.keep("kimono.ai.effort", e) }

    /** An administrator's new chat works on a project (a Kimono Git repository), and which one they used last. */
    var workOnProject = false
    /** Kimono AI's own app, as the launcher draws it: its watercolour bloom on every screen. */
    var appLink: KimonoAppLink? = null
    var lastRepo: String? = null

    /* ── chats ── */

    fun knownChats(): CodeChats? = session.answers.peek(WORKSPACES)?.let { runCatching { json.decodeFromString<CodeChats>(it) }.getOrNull() }
    /** The person's own chats, then those shared with them, as last heard. */
    fun knownWorkspaces(): List<CodeWorkspace>? = knownChats()?.let { it.own + it.shared }

    suspend fun chats(): CodeChats = json.decodeFromString(session.fetch(WORKSPACES))
    suspend fun workspaces(): List<CodeWorkspace> = chats().own

    suspend fun workspace(id: String): CodeWorkspace = json.decodeFromString(session.call(ws(id)))

    /**
     * Starts a chat with what's asked. [owner]/[name]/[base] work on a project (administrators);
     * [folder] puts it in a project folder; [hold] makes it without starting, for files to follow.
     */
    suspend fun start(prompt: String, owner: String? = null, name: String? = null, base: String? = null, folder: String? = null, hold: Boolean = false): CodeWorkspace =
        json.decodeFromString(session.call(WORKSPACES, HttpMethod.Post, jsonBody(buildJsonObject {
            if (owner != null && name != null) { put("owner", owner); put("name", name); put("base", base ?: "main") }
            put("prompt", prompt)
            if (_model.value != "auto") put("effort", _effort.value)
            put("model", _model.value)
            if (folder != null) put("folder", folder)
            if (hold) put("hold", true)
        })))

    suspend fun rename(id: String, title: String): CodeWorkspace = json.decodeFromString(session.call(ws(id), HttpMethod.Patch, jsonBody(JsonObject.of("title" to title))))

    /** Puts a chat in a project folder, or takes it out (null). */
    suspend fun moveChat(id: String, folder: String?): CodeWorkspace = json.decodeFromString(session.call(ws(id), HttpMethod.Patch, jsonBody(JsonObject.of("folder" to folder))))

    suspend fun remove(id: String) { session.call(ws(id), HttpMethod.Delete); session.answers.drop(WORKSPACES); forgetChat(id) }

    /** Archives a chat, or brings it back to the list. */
    suspend fun archive(id: String, archived: Boolean): CodeWorkspace =
        json.decodeFromString<CodeWorkspace>(session.call(ws(id), HttpMethod.Patch, jsonBody(JsonObject.of("archived" to archived)))).also { session.answers.drop(WORKSPACES) }

    /* ── projects: folders of chats ── */

    suspend fun projects(): List<CodeProject> = json.decodeFromString<ProjectList>(session.call("/api/v1/code/projects")).projects
    suspend fun createProject(name: String): CodeProject = json.decodeFromString(session.call("/api/v1/code/projects", HttpMethod.Post, jsonBody(JsonObject.of("name" to name))))
    suspend fun renameProject(id: String, name: String): CodeProject = json.decodeFromString(session.call("/api/v1/code/projects/${id.encodeURLParameter()}", HttpMethod.Patch, jsonBody(JsonObject.of("name" to name))))
    /** Removes the project; its chats stay. */
    suspend fun removeProject(id: String) { session.call("/api/v1/code/projects/${id.encodeURLParameter()}", HttpMethod.Delete) }

    /* ── repositories, for administrators' projects on Kimono Git ── */

    suspend fun repositories(): List<CodeRepository> = json.decodeFromString<RepoList>(session.call("/api/v1/code/repos")).repositories

    /** A new, private Kimono Git repository with a main branch, ready to work on. */
    suspend fun createRepository(name: String): CodeRepository =
        json.decodeFromString(session.call("/api/v1/code/repos", HttpMethod.Post, jsonBody(JsonObject.of("name" to name))))

    suspend fun branches(owner: String, name: String): List<String> =
        json.decodeFromString<BranchList>(session.call("/api/v1/code/branches?owner=${owner.encodeURLParameter()}&name=${name.encodeURLParameter()}")).branches

    /* ── the timeline ── */

    /** The chat as it is now and what happened after [after]. */
    suspend fun events(id: String, after: Long): Pair<CodeWorkspace, List<StoredCodeEvent>> {
        val answer = json.parseToJsonElement(session.call("${ws(id)}/events?after=$after")).jsonObject
        val workspace = json.decodeFromJsonElement(CodeWorkspace.serializer(), answer.getValue("workspace"))
        val events = answer["events"]?.jsonArray?.map { storedOf(it.jsonObject) } ?: emptyList()
        return workspace to events
    }

    /**
     * Streams the timeline after [after], with what it is writing (seq 0), until the
     * stream ends or the caller stops listening. Returns normally when the server closes it.
     */
    suspend fun stream(id: String, after: Long, each: suspend (StoredCodeEvent) -> Unit) {
        session.respond("${ws(id)}/events?after=$after", long = true, configure = { header(HttpHeaders.Accept, "text/event-stream") }) { response ->
            if (!response.status.isSuccess()) throw session.problemOf(response, "Kimono AI isn't answering.")
            val channel = response.bodyAsChannel()
            val data = StringBuilder()
            while (true) {
                val line = channel.readUTF8Line() ?: break
                when {
                    line.isEmpty() -> if (data.isNotEmpty()) {
                        val text = data.toString(); data.clear()
                        runCatching { storedOf(json.parseToJsonElement(text).jsonObject) }.getOrNull()?.let { each(it) }
                    }
                    line.startsWith("data:") -> { if (data.isNotEmpty()) data.append('\n'); data.append(line.removePrefix("data:").removePrefix(" ")) }
                    else -> {}
                }
            }
        }
    }

    suspend fun ask(id: String, text: String, attachments: List<CodeAttachment>) {
        session.call("${ws(id)}/turns", HttpMethod.Post, jsonBody(buildJsonObject {
            put("text", text)
            put("attachments", json.encodeToJsonElement(attachments))
            if (_model.value != "auto") put("effort", _effort.value)
            put("model", _model.value)
        }))
    }

    /** Changes a message sent earlier ([seq]) and runs it again from there; what came after it goes. */
    suspend fun editAsk(id: String, seq: Long, text: String) {
        session.call("${ws(id)}/turns", HttpMethod.Patch, jsonBody(buildJsonObject {
            put("seq", seq)
            put("text", text)
            if (_model.value != "auto") put("effort", _effort.value)
            put("model", _model.value)
        }))
    }

    suspend fun stop(id: String) { session.call("${ws(id)}/stop", HttpMethod.Post) }

    private fun ratingsOf(text: String): Map<Long, Int> =
        (json.parseToJsonElement(text).jsonObject["ratings"] as? JsonObject).orEmpty().mapNotNull { (seq, v) -> seq.toLongOrNull()?.let { s -> (v as? JsonPrimitive)?.intOrNull?.let { s to it } } }.toMap()

    /** Your thumbs on this chat's answers (1 up, -1 down), by the seq of each answer's end. */
    suspend fun ratings(id: String): Map<Long, Int> = ratingsOf(session.call("${ws(id)}/feedback"))

    /** An administrator's thank-you for your thumbs, by the seq of the answer each was on: their note, or "" for none. */
    suspend fun replies(id: String): Map<Long, String> =
        (json.parseToJsonElement(session.call("${ws(id)}/feedback")).jsonObject["replies"] as? JsonObject).orEmpty().mapNotNull { (seq, v) ->
            seq.toLongOrNull()?.let { s -> s to ((v as? JsonObject)?.get("note") as? JsonPrimitive)?.contentOrNull.orEmpty() }
        }.toMap()

    /** Thumbs up (1) or down (-1) on the answer ending at [seq], with what went wrong; null takes it back. */
    suspend fun rate(id: String, seq: Long, rating: Int?, note: String? = null): Map<Long, Int> =
        ratingsOf(session.call("${ws(id)}/feedback", HttpMethod.Post, jsonBody(buildJsonObject { put("seq", seq); if (rating == null) put("rating", JsonNull) else put("rating", rating); if (!note.isNullOrBlank()) put("note", note) })))

    /** Reports the whole chat; it goes with no name on it. */
    suspend fun report(id: String, reason: String) { session.call("${ws(id)}/report", HttpMethod.Post, jsonBody(JsonObject.of("reason" to reason))) }

    /** Answers its request to open some of Drive: "file" (with the one [file]), "chat", "always" or "deny". */
    suspend fun answerAccess(id: String, request: String, choice: String, file: String? = null) {
        session.call("${ws(id)}/access/${request.encodeURLParameter()}", HttpMethod.Post, jsonBody(buildJsonObject { put("choice", choice); if (file != null) put("file", file) }))
    }

    /** Answers its questions, one [QuestionReply] per question in order, or skips them all ([answers] null). The server posts it as their message and starts its next turn. */
    suspend fun answerQuestion(id: String, question: String, answers: List<QuestionReply>?) {
        session.call("${ws(id)}/questions/${question.encodeURLParameter()}", HttpMethod.Post, jsonBody(buildJsonObject {
            if (answers == null) put("skip", true)
            else put("answers", kotlinx.serialization.json.buildJsonArray {
                answers.forEach { a -> add(buildJsonObject {
                    put("picked", kotlinx.serialization.json.buildJsonArray { a.picked.forEach { add(JsonPrimitive(it)) } })
                    if (!a.other.isNullOrBlank()) put("other", a.other)
                }) }
            })
        }))
    }

    /** The latest saved version of one of the chat's artifacts. */
    suspend fun artifact(id: String, name: String): ArtifactSaved = json.decodeFromString(session.call("${ws(id)}/artifacts/${name.encodeURLParameter()}"))

    /* ── sharing: a chat with people or by its link; an artifact by its own link ── */

    suspend fun chatSharing(id: String): ChatSharing = json.decodeFromString(session.call("${ws(id)}/sharing"))
    /** Invites [username] to read or write ("read", "edit"), changes it, or takes them off (null). */
    suspend fun shareChat(id: String, username: String, access: String?): ChatSharing =
        json.decodeFromString(session.call("${ws(id)}/sharing", HttpMethod.Put, jsonBody(JsonObject.of("username" to username, "access" to access))))
    /** Turns the chat's link on for reading or writing, or off (null). */
    suspend fun setChatLink(id: String, access: String?): ChatSharing =
        json.decodeFromString(session.call("${ws(id)}/sharing", HttpMethod.Patch, jsonBody(JsonObject.of("link" to access))))

    private fun artifactPath(id: String, name: String) = "${ws(id)}/artifacts/${name.encodeURLParameter()}/sharing"
    suspend fun artifactSharing(id: String, name: String): ArtifactSharing = json.decodeFromString(session.call(artifactPath(id, name)))
    suspend fun shareArtifact(id: String, name: String, username: String, on: Boolean): ArtifactSharing =
        json.decodeFromString(session.call(artifactPath(id, name), HttpMethod.Put, jsonBody(JsonObject.of("username" to username, "on" to on))))
    /** Opens the artifact's link to anyone, or only to its people. Makes the link if it has none yet. */
    suspend fun setArtifactPublic(id: String, name: String, public: Boolean): ArtifactSharing =
        json.decodeFromString(session.call(artifactPath(id, name), HttpMethod.Patch, jsonBody(JsonObject.of("public" to public))))

    /** What a share link opens. */
    suspend fun link(token: String): SharedLink = json.decodeFromString(session.call("/api/v1/code/links/${token.encodeURLParameter()}"))
    /** Keeps a chat's link: the chat is this person's to come back to. */
    suspend fun join(token: String): CodeWorkspace = json.decodeFromString(session.call("/api/v1/code/links/${token.encodeURLParameter()}", HttpMethod.Post))

    fun chatLink(token: String) = "${session.server}/ai/c/$token"
    fun artifactLink(token: String) = "${session.server}/ai/a/$token"

    /** Everyone with a Kimono account, to share with and to put names and faces to usernames. */
    fun knownPeople(): List<Person>? = session.answers.peek(PEOPLE)?.let { runCatching { json.decodeFromString<People>(it).people }.getOrNull() }
    suspend fun people(): List<Person> = json.decodeFromString<People>(session.fetch(PEOPLE)).people

    /** Who is using the app. */
    val me: String? get() = (session.state.value as? SessionState.SignedIn)?.me?.username

    /* ── usage, and what it may do with Drive ── */

    /** The person's usage; with [chat], also what that chat of theirs spent on paid tools. */
    suspend fun usage(chat: String? = null): Usage = json.decodeFromString(session.call("/api/v1/code/usage" + (chat?.let { "?chat=${it.encodeURLParameter()}" } ?: "")))

    suspend fun access(): AccessSettings = json.decodeFromString(session.call("/api/v1/code/access"))
    suspend fun setSpaceAccess(spaceId: String, need: String?) { session.call("/api/v1/code/access/spaces/${spaceId.encodeURLParameter()}", HttpMethod.Put, jsonBody(JsonObject.of("need" to need))) }
    suspend fun revokeAccess(grantId: String) { session.call("/api/v1/code/access/grants/${grantId.encodeURLParameter()}", HttpMethod.Delete) }

    /* ── memory ── */

    suspend fun memory(): CodeProfile = json.decodeFromString(session.call("/api/v1/code/memory"))
    /* ── Quran and hadith, cited by reference (the website's scripture.tsx) ── */

    private val scripture = mutableMapOf<String, String>()
    private suspend fun scriptureCall(path: String): String = scripture[path] ?: session.call(path).also { scripture[path] = it }
    suspend fun quran(ref: String): QuranPassage = json.decodeFromString(scriptureCall("/api/v1/code/scripture/quran?ref=${ref.encodeURLParameter()}"))
    suspend fun tafsir(id: Int, key: String): Tafsir = json.decodeFromString(scriptureCall("/api/v1/code/scripture/tafsir?id=$id&key=${key.encodeURLParameter()}"))
    suspend fun hadith(book: String, number: Int): Hadith = json.decodeFromString(scriptureCall("/api/v1/code/scripture/hadith?book=${book.encodeURLParameter()}&n=$number"))
    /** Whether the person accepted the notice before Kimono AI's first answer on Islam. */
    suspend fun noticeSeen(notice: String): Boolean = json.decodeFromString<NoticeSeen>(session.call("/api/v1/code/notices?notice=${notice.encodeURLParameter()}")).seen
    suspend fun seeNotice(notice: String) { session.call("/api/v1/code/notices", HttpMethod.Post, jsonBody(JsonObject.of("notice" to notice))) }

    suspend fun skills(): List<SkillChoice> = json.decodeFromString<SkillList>(session.call("/api/v1/code/skills")).skills
    /** Turns a skill on or off for every chat; answers with the whole list. */
    suspend fun setSkill(id: String, enabled: Boolean): List<SkillChoice> =
        json.decodeFromString<SkillList>(session.call("/api/v1/code/skills", HttpMethod.Post, jsonBody(JsonObject.of("id" to id, "enabled" to enabled)))).skills
    suspend fun skillCatalog(): SkillCatalog = json.decodeFromString(session.call("/api/v1/code/skills"))
    /** Writes a skill of this person's own; [published] puts it in the Marketplace. */
    suspend fun createSkill(name: String, description: String, kind: String, body: String, published: Boolean?): SkillCatalog =
        json.decodeFromString(session.call("/api/v1/code/skills", HttpMethod.Post, jsonBody(JsonObject.of("create" to JsonObject.of("name" to name, "description" to description, "kind" to kind, "body" to body, *(if (published != null) arrayOf("published" to published) else emptyArray()))))))
    suspend fun changeSkill(id: String, name: String, description: String, kind: String, body: String, published: Boolean?): SkillCatalog =
        json.decodeFromString(session.call("/api/v1/code/skills/${id.encodeURLParameter()}", HttpMethod.Patch, jsonBody(JsonObject.of("name" to name, "description" to description, "kind" to kind, "body" to body, *(if (published != null) arrayOf("published" to published) else emptyArray())))))
    suspend fun deleteSkill(id: String): SkillCatalog = json.decodeFromString(session.call("/api/v1/code/skills/${id.encodeURLParameter()}", HttpMethod.Delete))
    suspend fun saveInstructions(instructions: String): CodeProfile = json.decodeFromString(session.call("/api/v1/code/memory", HttpMethod.Post, jsonBody(JsonObject.of("instructions" to instructions))))
    suspend fun remember(text: String): CodeProfile = json.decodeFromString(session.call("/api/v1/code/memory", HttpMethod.Post, jsonBody(JsonObject.of("remember" to text))))
    suspend fun forget(id: String): CodeProfile = json.decodeFromString(session.call("/api/v1/code/memory/${id.encodeURLParameter()}", HttpMethod.Delete))
    suspend fun changeMemory(id: String, text: String): CodeProfile = json.decodeFromString(session.call("/api/v1/code/memory/${id.encodeURLParameter()}", HttpMethod.Patch, jsonBody(JsonObject.of("text" to text))))

    /* ── connections: the person's own apps, through Composio ── */

    suspend fun connections(): Connections = json.decodeFromString(session.call("/api/v1/code/connections"))
    suspend fun findApps(q: String, cursor: String? = null): AppPage =
        json.decodeFromString(session.call("/api/v1/code/connections/apps?q=${q.encodeURLParameter()}${cursor?.let { "&cursor=${it.encodeURLParameter()}" } ?: ""}"))
    /** The link that signs the person in to [app]. */
    suspend fun connect(app: String): String = json.decodeFromString<Link>(session.call("/api/v1/code/connections", HttpMethod.Post, jsonBody(JsonObject.of("app" to app)))).url
    suspend fun disconnect(account: String) { session.call("/api/v1/code/connections/${account.encodeURLParameter()}", HttpMethod.Delete) }

    private val looks = mutableMapOf<String, AppLook>()
    /** How Composio names and draws an app; its plain name when it won't say. */
    suspend fun appLook(slug: String): AppLook = looks[slug] ?: (runCatching { json.decodeFromString<AppLook>(session.call("/api/v1/code/apps/${slug.encodeURLParameter()}")) }.getOrNull()
        ?: AppLook(plainName(slug), "https://logos.composio.dev/api/${slug.encodeURLParameter()}")).also { looks[slug] = it }
    fun knownLook(slug: String): AppLook? = looks[slug]
    suspend fun appDetails(slug: String): AppDetails = json.decodeFromString(session.call("/api/v1/code/apps/${slug.encodeURLParameter()}?details=2"))

    /* ── the app a chat runs ── */

    /** Takes the app's link down. */
    suspend fun stopPreview(id: String) { session.call("${ws(id)}/preview", HttpMethod.Delete) }

    /** How the app is doing and the end of its log. Asking doesn't wake a sleeping sandbox. */
    suspend fun previewStatus(id: String): AppStatus = json.decodeFromString(session.call("${ws(id)}/preview"))

    /** Names the app's link: [name] becomes https://name.<domain>; the old link stops answering. */
    suspend fun renamePreview(id: String, name: String) { session.call("${ws(id)}/preview", HttpMethod.Patch, jsonBody(JsonObject.of("name" to name))) }

    /** Starts the app again, or for the first time since it was stopped; the link stays. */
    suspend fun restartPreview(id: String) { session.call("${ws(id)}/preview/restart", HttpMethod.Post) }

    /** Stops the app but keeps its link, to start again later. */
    suspend fun pausePreview(id: String) { session.call("${ws(id)}/preview/stop", HttpMethod.Post) }

    /** What the chat's sandbox may use, and its disk. */
    suspend fun sandbox(id: String): SandboxStatus = json.decodeFromString(session.call("${ws(id)}/sandbox"))

    /** A screenshot it took. */
    suspend fun shot(id: String, name: String): ByteArray = bytes("${ws(id)}/shots/${name.encodeURLParameter()}")

    suspend fun publish(id: String, title: String): CodeWorkspace =
        json.decodeFromString(session.call("${ws(id)}/publish", HttpMethod.Post, jsonBody(JsonObject.of("title" to title))))

    suspend fun files(id: String, path: String): List<CodeEntry> = json.decodeFromString<Folder>(session.call("${ws(id)}/files?path=${path.encodeURLParameter()}")).entries

    suspend fun changes(id: String): CodeChanges = json.decodeFromString(session.call("${ws(id)}/changes"))

    /** A file's bytes from the sandbox, or from what was attached. */
    suspend fun bytes(path: String): ByteArray = session.respond(path) { response ->
        if (!response.status.isSuccess()) throw session.problemOf(response, if (response.status.value == 413) "That file is too large to show here." else "That file couldn't be opened.")
        response.bodyAsBytes()
    }

    suspend fun file(id: String, path: String): ByteArray = bytes("${ws(id)}/file?path=${path.encodeURLParameter()}")

    suspend fun attachment(id: String, a: CodeAttachment): ByteArray =
        if (a.node != null) bytes("${ws(id)}/attachments/drive/${a.node.encodeURLParameter()}?type=${a.type.encodeURLParameter()}")
        else bytes("${ws(id)}/attachments/${a.path.removePrefix("/attachments/").encodeURLParameter()}?type=${a.type.encodeURLParameter()}")

    /** Copies Drive files into the chat, for the next message. Each comes back as an attachment. */
    suspend fun fromDrive(id: String, nodes: List<String>): List<CodeAttachment> =
        json.decodeFromString<Attached>(session.call("${ws(id)}/from-drive", HttpMethod.Post, jsonBody(buildJsonObject {
            put("nodes", JsonArray(nodes.map { JsonPrimitive(it) }))
        }))).attachments

    /** The chat's Drive folder, for a file over 20 MB to be uploaded into. Only the chat's owner gets it. */
    suspend fun uploadFolder(id: String): String =
        ((json.parseToJsonElement(session.call("${ws(id)}/upload-folder", HttpMethod.Post)) as? JsonObject)?.get("folder") as? JsonPrimitive)?.content
            ?: throw KimonoProblem("Didn't attach")

    /**
     * Puts a picked file in the sandbox for the next message. Up to 20 MB it goes
     * as it is; past that (up to 4 GB) it's uploaded resumably into the chat's
     * Drive folder, with [progress] in bytes, and attached from there.
     */
    suspend fun attach(id: String, file: PickedFile, progress: (Long) -> Unit = {}): CodeAttachment {
        if (file.size > LARGEST_ATTACHMENT) throw KimonoProblem("Over 4 GB")
        if (file.size > MAX_ATTACHMENT) {
            val node = Drive(session).upload(file, uploadFolder(id), progress = progress)
            return fromDrive(id, listOf(node)).firstOrNull() ?: throw KimonoProblem("Didn't attach")
        }
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

    /** Whether speaking a message is set up on this Kimono; asked once. */
    private var dictation: Boolean? = null
    suspend fun dictationOn(): Boolean = dictation ?: runCatching {
        (json.parseToJsonElement(session.call("/api/v1/code/dictation")) as? JsonObject)?.get("on")?.let { (it as? JsonPrimitive)?.content == "true" } == true
    }.onSuccess { dictation = it }.getOrDefault(false)

    /** A finished recording (AAC in MP4) turned into words. */
    suspend fun transcribe(audio: ByteArray): String {
        val answer = json.parseToJsonElement(session.call("/api/v1/code/dictation", HttpMethod.Post) {
            setBody(ByteArrayContent(audio, ContentType("audio", "mp4")))
        }) as? JsonObject
        return (answer?.get("text") as? JsonPrimitive)?.content?.trim() ?: ""
    }

    /** The Kimono this app talks to, for the artifact frame and its engine. */
    val server: String? get() = session.server

    companion object {
        private const val WORKSPACES = "/api/v1/code/workspaces"
        private const val STATE = "kimono.ai.state"
        private const val PEOPLE = "/api/v1/drive/people"
        /** Up to this a file is attached as it is; past it, through the chat's Drive folder. */
        const val MAX_ATTACHMENT = 20L * 1024 * 1024
        const val LARGEST_ATTACHMENT = 4L * 1024 * 1024 * 1024
        const val APP_ID = "kimono-code"
    }
}

fun plainName(slug: String) = slug.replace(Regex("[_-]+"), " ").split(" ").joinToString(" ") { it.replaceFirstChar { c -> c.uppercase() } }

/** m:ss, or hours and minutes past an hour. */
fun elapsedText(ms: Long): String {
    val s = (ms / 1000).coerceAtLeast(0)
    return if (s < 3600) "${s / 60}:${(s % 60).toString().padStart(2, '0')}" else "${s / 3600}h ${(s / 60) % 60}m"
}

/** Gigabytes, as limits are spoken of: "2 GB", "3.4 GB". */
fun gigabytes(bytes: Long): String {
    val value = bytes / (1024.0 * 1024 * 1024)
    return if (value == kotlin.math.floor(value)) "${value.toLong()} GB" else "${(value * 10).toLong() / 10.0} GB"
}

/** Tokens, short: 12k, 1.2M. */
fun kTokens(n: Long): String = when {
    n >= 1_000_000 -> "${(n / 100_000) / 10.0}M".replace(".0M", "M")
    n >= 1000 -> "${(n + 500) / 1000}k"
    else -> n.toString()
}

fun percent(x: Double) = "${kotlin.math.round(x * 100).toInt()}%"

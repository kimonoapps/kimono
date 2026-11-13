package app.kimono.data

import io.ktor.client.request.setBody
import io.ktor.http.ContentType
import io.ktor.http.HttpMethod
import io.ktor.http.contentType
import io.ktor.http.encodeURLPathPart
import io.ktor.http.encodeURLQueryComponent
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/* ── What /api/v1/friends, /profiles and /recommendations answer with (apps/portal/src/lib/friends) ── */

@Serializable
data class FriendPerson(val username: String, val name: String = "", val picture: String? = null, val bio: String = "")

@Serializable
data class FriendsList(val friends: List<FriendPerson> = emptyList(), val asked: List<FriendPerson> = emptyList(), val asking: List<FriendPerson> = emptyList(), val unseen: Int = 0)

@Serializable
data class FoundPeople(val people: List<FriendPerson> = emptyList())

/** A title from one app, as a profile or a recommendation shows it. */
@Serializable
data class ShareItem(val app: String, val itemId: String, val title: String, val subtitle: String? = null, val cover: String? = null, val href: String? = null, val progress: Double? = null)

@Serializable
data class ProfileSection(val app: String, val appName: String, val kind: String, val title: String, val items: List<ShareItem> = emptyList())

@Serializable
data class Recommendation(
    val id: String, val app: String, val itemId: String, val title: String, val subtitle: String? = null, val cover: String? = null,
    val from: FriendPerson, val to: FriendPerson? = null, val note: String? = null, val at: Long = 0, val seen: Boolean = true, val appName: String = "",
) { val item get() = ShareItem(app, itemId, title, subtitle, cover) }

@Serializable
data class KimonoProfile(
    val username: String, val name: String = "", val picture: String? = null,
    val you: Boolean = false, val link: String? = null, val open: Boolean = false, val bio: String = "",
    val sections: List<ProfileSection> = emptyList(), val recommendations: List<Recommendation> = emptyList(), val friends: Int = 0,
    /** On your own profile: the apps you keep from friends (all of them while you're invisible), the rows ("watch:listed") and parts ("friends") you keep, and all of what friends see. */
    val hidden: List<String> = emptyList(),
    val kept: List<String> = emptyList(),
    val privacy: Privacy? = null,
    /** Who they're friends with; null when they keep it to themselves. */
    val friendList: List<FriendPerson>? = null,
    /** They read on a Kimono Read, since this ISO date. */
    val kimonoRead: KimonoRead? = null,
)

@Serializable
data class KimonoRead(val since: String)

/** What you let friends see (lib/friends/model.ts privacyOf): going invisible, your friends list, and each app and its rows. */
@Serializable
data class Privacy(val invisible: Boolean = false, val friends: Boolean = true, val apps: List<PrivacyApp> = emptyList()) {
    val kept: List<String> get() = (if (friends) emptyList() else listOf("friends")) + apps.flatMap { a -> a.rows.filter { !it.shown }.map { "${a.app}:${it.kind}" } }
}

@Serializable
data class PrivacyApp(val app: String, val name: String, val shown: Boolean = true, val rows: List<PrivacyRow> = emptyList())

@Serializable
data class PrivacyRow(val kind: String, val title: String, val shown: Boolean = true)

@Serializable
data class PrivacyNow(val privacy: Privacy, val hidden: List<String> = emptyList())

@Serializable
private data class Hidden(val hidden: List<String> = emptyList())

/** One friend's latest, for Home (lib/friends activityOf): "watching", "watched", "reading", "read" or "recommended". Only what they let friends see. */
@Serializable
data class FriendActivity(
    val kind: String, val app: String, val itemId: String, val title: String, val subtitle: String? = null, val cover: String? = null,
    /** Its page on the Portal ("/watch?t=…"). */
    val href: String? = null, val at: Long = 0, val progress: Double? = null, val label: String? = null, val note: String? = null,
    val from: FriendPerson, val appName: String = "",
)

@Serializable
private data class Activity(val items: List<FriendActivity> = emptyList())

@Serializable
data class Recommendations(val received: List<Recommendation> = emptyList(), val sent: List<Recommendation> = emptyList(), val profile: List<Recommendation> = emptyList())

@Serializable
private data class Bio(val bio: String = "")

private val json = Json { ignoreUnknownKeys = true }

/**
 * 友 Kimono's friends: who you're friends with, profiles (private until you're
 * friends), and the titles you recommend each other from any app. Watch's live
 * side stays Watch's own.
 */
class Friends(private val session: Session) {
    /** The Kimono this is, for links into it (the Silkscreen Kimono's NOTICE). */
    val server: String? get() = (session.state.value as? SessionState.SignedIn)?.server

    suspend fun list(): FriendsList = json.decodeFromString(session.fetch(FRIENDS))
    fun known(): FriendsList? = session.answers.peek(FRIENDS)?.let { runCatching { json.decodeFromString<FriendsList>(it) }.getOrNull() }

    suspend fun find(typed: String): List<FriendPerson> = json.decodeFromString<FoundPeople>(session.call("$FRIENDS?q=${typed.trim().encodeURLQueryComponent()}")).people

    /** "ask", "yes", "no" or "remove". */
    suspend fun change(type: String, username: String) {
        session.call(FRIENDS, HttpMethod.Post) { contentType(ContentType.Application.Json); setBody(buildJsonObject { put("type", type); put("username", username) }.toString()) }
    }

    suspend fun profile(username: String): KimonoProfile = json.decodeFromString(session.fetch("/api/v1/profiles/${username.encodeURLPathPart()}"))
    fun knownProfile(username: String): KimonoProfile? = session.answers.peek("/api/v1/profiles/${username.encodeURLPathPart()}")?.let { runCatching { json.decodeFromString<KimonoProfile>(it) }.getOrNull() }

    suspend fun saveBio(bio: String): String = json.decodeFromString<Bio>(session.call("/api/v1/profile", HttpMethod.Patch) {
        contentType(ContentType.Application.Json); setBody(buildJsonObject { put("bio", bio) }.toString())
    }).bio

    /** Shows or keeps one app's activity off your profile; answers the apps now kept off. */
    suspend fun showApp(app: String, shown: Boolean): List<String> = json.decodeFromString<Hidden>(session.call("/api/v1/profile", HttpMethod.Patch) {
        contentType(ContentType.Application.Json); setBody(buildJsonObject { put("app", app); put("shown", shown) }.toString())
    }).hidden

    /** Goes invisible to friends, or comes back. */
    suspend fun setInvisible(on: Boolean): PrivacyNow = privacy(buildJsonObject { put("invisible", on) }.toString())
    /** Shows or keeps one app from friends. */
    suspend fun showAppOf(app: String, shown: Boolean): PrivacyNow = privacy(buildJsonObject { put("app", app); put("shown", shown) }.toString())
    /** Shows or keeps one row ("watch:listed") or your friends list ("friends") from friends. */
    suspend fun showPart(key: String, shown: Boolean): PrivacyNow = privacy(buildJsonObject { put("keep", key); put("shown", shown) }.toString())
    /** Takes one title off one row of your own profile ("watch" + "listed", "books" + "read"…), as its app would. */
    suspend fun removeFromRow(app: String, kind: String, itemId: String) {
        session.call("/api/v1/profile", HttpMethod.Patch) {
            contentType(ContentType.Application.Json)
            setBody(buildJsonObject { put("remove", buildJsonObject { put("app", app); put("kind", kind); put("itemId", itemId) }) }.toString())
        }
    }
    private suspend fun privacy(body: String): PrivacyNow = json.decodeFromString(session.call("/api/v1/profile", HttpMethod.Patch) {
        contentType(ContentType.Application.Json); setBody(body)
    })

    /** What friends are up to, the latest first, for Home. */
    suspend fun activity(): List<FriendActivity> = json.decodeFromString<Activity>(session.fetch(ACTIVITY)).items
    fun knownActivity(): List<FriendActivity>? = session.answers.peek(ACTIVITY)?.let { runCatching { json.decodeFromString<Activity>(it).items }.getOrNull() }

    suspend fun recommendations(): Recommendations = json.decodeFromString(session.fetch(RECOMMENDATIONS))

    /** Recommends [item] to [to]; with no one, puts it on your profile. */
    suspend fun recommend(item: ShareItem, to: List<String>, note: String) {
        session.call(RECOMMENDATIONS, HttpMethod.Post) {
            contentType(ContentType.Application.Json)
            setBody(buildJsonObject {
                put("app", item.app); put("itemId", item.itemId); put("title", item.title)
                item.subtitle?.let { put("subtitle", it) }; item.cover?.let { put("cover", it) }
                put("note", note); put("to", JsonArray(to.map { JsonPrimitive(it) }))
            }.toString())
        }
    }

    /** The sender takes it back; the one it was sent to puts it away. */
    suspend fun drop(id: String) { session.call("$RECOMMENDATIONS/$id", HttpMethod.Delete) }

    companion object {
        const val FRIENDS = "/api/v1/friends"
        const val RECOMMENDATIONS = "/api/v1/recommendations"
        const val ACTIVITY = "/api/v1/friends/activity"
    }
}

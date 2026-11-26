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
data class ShareItem(val app: String, val itemId: String, val title: String, val subtitle: String? = null, val cover: String? = null, val href: String? = null, val progress: Double? = null, val rating: String? = null, val at: Long? = null)

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
    /** They read on a Kimono Reader, since this ISO date. */
    val kimonoRead: KimonoRead? = null,
    /** On your own profile: the titles you took off its rows, to put back. */
    val off: List<OffProfile> = emptyList(),
    /* What makes it theirs: pronouns, a colour, links, and the home screen of widgets (null: the default set). */
    val pronouns: String = "",
    val color: String? = null,
    /** A photo across the top of the profile, as a path on the Portal; null for the colour alone. */
    val banner: String? = null,
    val links: List<ProfileLink> = emptyList(),
    val widgets: List<Widget>? = null,
    val music: MusicExtras? = null,
    val books: BooksExtras? = null,
)

@Serializable
/** [show]: "name" (a mark under the name), "links" (a button in the Links widget) or "both"; none is both for a social site, the widget for the rest. */
data class ProfileLink(val title: String = "", val url: String, val icon: String? = null, val show: String? = null)

/** One widget on a profile's home screen: a kind, a size ("s", "m", "l", "xl") and what it keeps (lib/friends/model.ts widgetsFrom). */
@Serializable
data class Widget(val id: String, val kind: String, val size: String, val config: Map<String, String>? = null)

@Serializable
data class MusicArtistRef(val key: String = "", val name: String = "")

@Serializable
data class MusicAlbumRef(val key: String = "", val title: String = "", val cover: String? = null)

@Serializable
data class MusicTrack(val key: String, val title: String = "", val artists: List<MusicArtistRef> = emptyList(), val album: MusicAlbumRef? = null) {
    val by get() = artists.joinToString(", ") { it.name }
}

@Serializable
data class Listening(val track: MusicTrack, val at: String = "", val live: Boolean = false)

@Serializable
data class TopArtist(val key: String, val name: String = "", val picture: String? = null, val plays: Int? = null)

@Serializable
data class OnRepeat(val track: MusicTrack, val plays: Int = 0)

/** Music's widgets on a profile (lib/music/social.ts musicExtras): the record, this month, top artists, play counts. */
@Serializable
data class MusicExtras(
    val listening: Listening? = null, val plays: Int = 0, val minutes: Int = 0, val artists: List<TopArtist> = emptyList(),
    val counts: Map<String, Int> = emptyMap(), val onRepeat: OnRepeat? = null,
)

@Serializable
data class ReadBook(val key: String, val title: String = "", val author: String = "", val cover: String? = null, val rating: String? = null, val at: Long = 0, val review: String = "")

/** Books' widgets (lib/friends/books-section.ts booksExtras): reviews, and what they've read. */
@Serializable
data class BooksExtras(val reviews: List<ReadBook> = emptyList(), val read: List<ReadBook> = emptyList())

/** Something found to put on a widget: a song, an album, a book, a film or show, a playlist. */
data class Pick(val key: String, val title: String, val subtitle: String, val cover: String?)

@Serializable private data class BannerNow(val banner: String? = null)
@Serializable private data class Look(val pronouns: String = "", val color: String? = null, val links: List<ProfileLink> = emptyList(), val bio: String? = null)
@Serializable private data class MusicSearch(val tracks: List<MusicTrack> = emptyList(), val albums: List<MusicAlbumHit> = emptyList())
@Serializable private data class MusicAlbumHit(val key: String, val title: String = "", val artist: MusicArtistRef? = null, val cover: String? = null)
@Serializable private data class BookSearch(val books: List<BookHit> = emptyList())
@Serializable private data class BookHit(val key: String, val title: String = "", val authors: List<String> = emptyList(), val cover: String? = null)
@Serializable private data class WatchSearch(val results: List<WatchHit> = emptyList())
@Serializable private data class WatchHit(val id: String, val name: String = "", val year: Int? = null, val poster: String? = null)
@Serializable private data class PlaylistHits(val playlists: List<PlaylistHit> = emptyList())
@Serializable private data class PlaylistHit(val id: String, val name: String = "", val count: Int = 0, val covers: List<String> = emptyList())

/** Whether an app asks you, the first time you open it with a friend, what friends see of it (GET /api/v1/profile/sharing); each choice starts [on] or off. */
@Serializable
data class SharingAsk(val ask: Boolean = false, val asks: List<ShareChoice> = emptyList())

@Serializable
data class ShareChoice(val key: String, val says: String = "", val on: Boolean = false)

/** A title you took off one row of your profile (lib/friends/model.ts offProfileList). */
@Serializable
data class OffProfile(
    val app: String, val appName: String = "", val kind: String, val rowTitle: String = "", val itemId: String,
    val title: String = "", val subtitle: String? = null, val cover: String? = null, val at: Long = 0,
) { val item get() = ShareItem(app, itemId, title, subtitle, cover) }

@Serializable
private data class OffNow(val off: List<OffProfile> = emptyList())

@Serializable
data class KimonoRead(val since: String)

/** What you let friends see (lib/friends/model.ts privacyOf): going invisible, your friends list, and each app and its rows. */
@Serializable
data class Privacy(
    /** Who sees your profile: "friends", "public" (anyone with the link) or "private" (only you). */
    val visibility: String? = null,
    val invisible: Boolean = false, val friends: Boolean = true,
    /** On a public profile, whether anyone with the link sees your friends list too (null from an older server). */
    val friendsEveryone: Boolean? = null,
    val apps: List<PrivacyApp> = emptyList()) {
    val kept: List<String> get() = (if (friends) emptyList() else listOf("friends")) + apps.flatMap { a -> a.rows.filter { !it.shown }.map { "${a.app}:${it.kind}" } }
}

@Serializable
data class PrivacyApp(val app: String, val name: String, val shown: Boolean = true, val everyone: Boolean? = null, val rows: List<PrivacyRow> = emptyList())

@Serializable
data class PrivacyRow(val kind: String, val title: String, val shown: Boolean = true, val everyone: Boolean? = null)

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
    /** Who sees one app, row ("watch:listed") or your friends list ("friends"): "me", "friends" or "everyone" (anyone with a public profile's link). */
    suspend fun setAudience(key: String, to: String): PrivacyNow = privacy(buildJsonObject { put("audience", key); put("to", to) }.toString())
    /** Takes one title off one row of your own profile ("listed", "read"…) until you put it back; answers all you've taken off. */
    suspend fun removeFromRow(kind: String, item: ShareItem): List<OffProfile> = offCall("remove", buildJsonObject {
        put("app", item.app); put("kind", kind); put("itemId", item.itemId); put("title", item.title)
        item.subtitle?.let { put("subtitle", it) }; item.cover?.let { put("cover", it) }
    })
    /** Puts a title you took off back on its row; answers what's still off. */
    suspend fun putBack(off: OffProfile): List<OffProfile> = offCall("restore", buildJsonObject { put("app", off.app); put("kind", off.kind); put("itemId", off.itemId) })
    private suspend fun offCall(key: String, body: kotlinx.serialization.json.JsonObject): List<OffProfile> =
        json.decodeFromString<OffNow>(session.call("/api/v1/profile", HttpMethod.Patch) {
            contentType(ContentType.Application.Json); setBody(buildJsonObject { put(key, body) }.toString())
        }).off
    private suspend fun privacy(body: String): PrivacyNow = json.decodeFromString(session.call("/api/v1/profile", HttpMethod.Patch) {
        contentType(ContentType.Application.Json); setBody(body)
    })

    /** Puts up a banner (a 2400×800 JPEG from Platform.pickBanner); answers its path. */
    suspend fun saveBanner(jpeg: ByteArray): String? = json.decodeFromString<BannerNow>(session.call("/api/v1/me/banner", HttpMethod.Put) {
        setBody(io.ktor.http.content.ByteArrayContent(jpeg, ContentType.Image.JPEG))
    }).banner
    /** Takes the banner down: the band is your colour again. */
    suspend fun dropBanner() { session.call("/api/v1/me/banner", HttpMethod.Delete) }

    /** Your home screen of widgets, as arranged. */
    suspend fun saveWidgets(widgets: List<Widget>) {
        session.call("/api/v1/profile", HttpMethod.Patch) { contentType(ContentType.Application.Json); setBody(buildJsonObject { put("widgets", json.encodeToJsonElement(kotlinx.serialization.builtins.ListSerializer(Widget.serializer()), widgets)) }.toString()) }
    }

    /** Your links, in order; answers them as kept (named and made whole). */
    suspend fun saveLinks(links: List<ProfileLink>): List<ProfileLink> = json.decodeFromString<Look>(session.call("/api/v1/profile", HttpMethod.Patch) {
        contentType(ContentType.Application.Json); setBody(buildJsonObject { put("links", json.encodeToJsonElement(kotlinx.serialization.builtins.ListSerializer(ProfileLink.serializer()), links)) }.toString())
    }).links

    /** Your pronouns, colour and words, saved together. */
    suspend fun saveLook(pronouns: String, color: String?, bio: String): Triple<String, String?, String> = json.decodeFromString<Look>(session.call("/api/v1/profile", HttpMethod.Patch) {
        contentType(ContentType.Application.Json); setBody(buildJsonObject { put("pronouns", pronouns); put("color", color ?: ""); put("bio", bio) }.toString())
    }).let { Triple(it.pronouns, it.color, it.bio ?: bio) }

    /** Who sees your profile: "friends", "public" or "private". */
    suspend fun setVisibility(visibility: String): PrivacyNow = privacy(buildJsonObject { put("visibility", visibility) }.toString())

    /** Whether [app] should ask you about sharing it with friends now. */
    suspend fun sharingAsk(app: String): SharingAsk = json.decodeFromString(session.call("/api/v1/profile/sharing?app=${app.encodeURLQueryComponent()}"))
    /** Your answer: the choices of [app] friends see ([on]; none shares nothing). It doesn't ask again. */
    suspend fun answerSharing(app: String, on: List<String>): PrivacyNow = privacy(buildJsonObject { put("share", app); put("on", JsonArray(on.map { JsonPrimitive(it) })) }.toString())

    /* What can go on a widget, found by search. */
    suspend fun findMusic(q: String, album: Boolean): List<Pick> = json.decodeFromString<MusicSearch>(session.call("/api/v1/music/search?q=${q.trim().encodeURLQueryComponent()}")).let { r ->
        if (album) r.albums.take(8).map { Pick(it.key, it.title, it.artist?.name ?: "", it.cover) }
        else r.tracks.take(8).map { Pick(it.key, it.title, it.by, it.album?.cover) }
    }
    suspend fun findBooks(q: String): List<Pick> = json.decodeFromString<BookSearch>(session.call("/api/v1/books/search?q=${q.trim().encodeURLQueryComponent()}")).books.take(8).map { Pick(it.key, it.title, it.authors.firstOrNull() ?: "", it.cover) }
    suspend fun findShows(q: String): List<Pick> = json.decodeFromString<WatchSearch>(session.call("/api/v1/watch/search?q=${q.trim().encodeURLQueryComponent()}")).results.take(8).map { hit ->
        /* A poster on this Kimono is kept by its path, as the website keeps it. */
        val local = server?.let { s -> hit.poster?.takeIf { it.startsWith(s) }?.removePrefix(s) } ?: hit.poster
        Pick(hit.id, hit.name, hit.year?.toString() ?: "", local)
    }
    suspend fun playlists(): List<Pick> = json.decodeFromString<PlaylistHits>(session.call("/api/v1/music/playlists")).playlists.map { Pick(it.id, it.name, "${it.count} ${if (it.count == 1) "song" else "songs"}", it.covers.firstOrNull()) }

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

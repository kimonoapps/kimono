package app.kimono.watch.data

import app.kimono.watch.model.Device
import app.kimono.watch.model.Home
import app.kimono.watch.model.PlayAnswer
import app.kimono.watch.model.Prefs
import app.kimono.watch.model.PrepareAnswer
import app.kimono.watch.model.SearchAnswer
import app.kimono.watch.model.TitlePage
import app.kimono.watch.model.TrackChoice
import io.ktor.client.request.setBody
import io.ktor.http.ContentType
import io.ktor.http.HttpMethod
import io.ktor.http.contentType
import io.ktor.http.encodeURLParameter
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.encodeToJsonElement
import kotlinx.serialization.json.put

/**
 * The Portal's Watch API (apps/portal/src/app/api/v1/watch): the only
 * thing the app talks to. TMDB, AIOStreams and debrid stay on the server.
 */
class WatchApi(
    val accounts: Accounts,
    private val device: () -> Device,
    /** This install's id, so the server keeps a quality per device (a phone on mobile data counts as its own). */
    val deviceId: () -> String,
) {
    val json = Json { ignoreUnknownKeys = true; explicitNulls = false; encodeDefaults = true }
    private val base = "/api/v1/watch"

    private suspend fun get(path: String): String = accounts.call("$base$path")
    private suspend fun send(method: HttpMethod, path: String, body: JsonElement): String = accounts.call("$base$path", method) {
        contentType(ContentType.Application.Json)
        setBody(body.toString())
    }

    /** Home's rows; [shelf] is "Series", "Film" or "Anime". */
    suspend fun home(shelf: String? = null): Home = json.decodeFromString(get("/home" + (shelf?.let { "?shelf=$it" } ?: "")))

    suspend fun search(query: String): SearchAnswer = json.decodeFromString(get("/search?q=${query.encodeURLParameter()}"))

    suspend fun title(id: String, season: Int? = null): TitlePage = json.decodeFromString(get("/titles/$id" + (season?.let { "?season=$it" } ?: "")))

    /** Marks on a title: My list, a rating ("down", "up", "love", or null to clear), a reminder, the tracks picked in the player. */
    suspend fun mark(id: String, inList: Boolean? = null, rating: String? = null, clearRating: Boolean = false, reminding: Boolean? = null, tracks: TrackChoice? = null): TitlePage =
        json.decodeFromString(send(HttpMethod.Put, "/titles/$id", buildJsonObject {
            inList?.let { put("inList", it) }
            reminding?.let { put("reminding", it) }
            if (clearRating) put("rating", JsonNull) else rating?.let { put("rating", it) }
            tracks?.let { put("tracks", json.encodeToJsonElement(it)) }
        }))

    /** Starts a play; [quality] is a one-off choice from the player's Quality menu. */
    suspend fun play(titleId: String, season: Int = 0, episode: Int = 0, version: Int? = null, quality: String? = null): PlayAnswer =
        json.decodeFromString(send(HttpMethod.Post, "/play", buildJsonObject {
            put("titleId", titleId)
            if (season > 0) { put("season", season); put("episode", episode) }
            version?.let { put("version", it) }
            quality?.let { put("quality", it) }
            put("deviceId", deviceId())
            put("device", json.encodeToJsonElement(device()))
        }))

    /** Gets the next episode ready, sent ~70% into the one playing. */
    suspend fun prepare(titleId: String, season: Int, episode: Int): PrepareAnswer =
        json.decodeFromString(send(HttpMethod.Post, "/prepare", buildJsonObject {
            put("titleId", titleId); put("season", season); put("episode", episode)
            put("deviceId", deviceId())
            put("device", json.encodeToJsonElement(device()))
        }))

    suspend fun progress(titleId: String, season: Int, episode: Int, position: Double, duration: Double) {
        send(HttpMethod.Put, "/progress", buildJsonObject {
            put("titleId", titleId); put("season", season); put("episode", episode); put("position", position); put("duration", duration)
        })
    }

    suspend fun prefs(device: String? = null): Prefs = json.decodeFromString(get("/prefs" + (device?.let { "?device=${it.encodeURLParameter()}" } ?: "")))

    /** A device's own quality ("auto", "2160", "1080", "720", "saver"), or null to follow the person's. */
    suspend fun deviceQuality(device: String, quality: String?): Prefs =
        json.decodeFromString(send(HttpMethod.Put, "/prefs", buildJsonObject { put("device", device); put("quality", quality?.let { JsonPrimitive(it) } ?: JsonNull) }))

    suspend fun savePrefs(change: JsonObject): Prefs = json.decodeFromString(send(HttpMethod.Put, "/prefs", change))
}

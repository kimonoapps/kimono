package app.kimono.watch.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/*
 * 観 The shapes the Portal's Watch API answers with (apps/portal/src/lib/watch).
 * Everything optional the server may leave out is optional here, so a newer
 * Portal never breaks an older app.
 */

/** A poster card on a row, a search result, or Continue watching (which adds where you are). */
@Serializable
data class Card(
    val id: String,
    val name: String,
    /** "movie" or "series". */
    val kind: String = "series",
    /** "Film", "Series" or "Anime". */
    val shelf: String = "Series",
    val year: Int? = null,
    val age: String = "",
    val poster: String? = null,
    val backdrop: String? = null,
    val logo: String? = null,
    val badge: String? = null,
    val top: Int? = null,
    /* Continue watching. */
    val season: Int? = null,
    val episode: Int? = null,
    val fraction: Double? = null,
    val left: Int? = null,
    /* Home's featured title. */
    val backdropLarge: String? = null,
    val overview: String? = null,
) {
    val isFilm get() = kind == "movie"
}

@Serializable
data class Row(val id: String, val title: String, val kind: String = "cards", val items: List<Card> = emptyList())

@Serializable
data class Home(val featured: Card? = null, val rows: List<Row> = emptyList())

@Serializable
data class SearchAnswer(val results: List<Card> = emptyList())

@Serializable
data class TitleInfo(
    val id: String,
    val name: String,
    val kind: String = "series",
    val shelf: String = "Series",
    val year: Int? = null,
    val age: String = "",
    val poster: String? = null,
    val backdrop: String? = null,
    val logo: String? = null,
    val overview: String = "",
    val genres: List<String> = emptyList(),
    val moods: List<String> = emptyList(),
    val cast: List<String> = emptyList(),
    val runtime: Int? = null,
    val status: String = "",
    val nextAirDate: String? = null,
    val backdropLarge: String? = null,
) {
    val isFilm get() = kind == "movie"
}

/** Where Resume goes. Films: position and fraction. Series: the episode, and whether they've started. */
@Serializable
data class Resume(
    val season: Int = 0,
    val episode: Int = 0,
    val position: Double = 0.0,
    val started: Boolean = false,
    val fraction: Double? = null,
)

@Serializable
data class Mark(val episode: Int, val state: String, val fraction: Double = 0.0)

@Serializable
data class Tracker(val season: Int, val left: Int, val marks: List<Mark> = emptyList(), val nextAirDate: String? = null)

@Serializable
data class SeasonInfo(val number: Int, val name: String = "", val episodeCount: Int = 0, val airDate: String? = null)

@Serializable
data class EpisodeInfo(
    val number: Int,
    val name: String = "",
    val overview: String = "",
    val still: String? = null,
    val runtime: Int? = null,
    val airDate: String? = null,
    val filler: Boolean = false,
    val recap: Boolean = false,
    val fraction: Double = 0.0,
)

@Serializable
data class TrackChoice(val audio: String, val subtitles: String)

@Serializable
data class TitlePage(
    val title: TitleInfo,
    val inList: Boolean = false,
    val rating: String? = null,
    val reminding: Boolean = false,
    val tracks: TrackChoice? = null,
    val playable: Boolean = true,
    val resume: Resume? = null,
    val seasons: List<SeasonInfo> = emptyList(),
    val tracker: Tracker? = null,
    val badge: String? = null,
    val hasFillers: Boolean = false,
    /** "ask", "skip" or "watch". */
    val fillers: String = "ask",
    val season: Int? = null,
    val episodes: List<EpisodeInfo> = emptyList(),
)

/** What a device can play, sent with every play so the server picks a version that works. */
@Serializable
data class Device(
    /** "android" or "android-tv". */
    val client: String,
    val maxHeight: Int,
    val hdr: List<String> = emptyList(),
    val dvProfiles: List<Int> = emptyList(),
    val codecs: List<String> = listOf("h264"),
    val passthrough: List<String> = emptyList(),
    val mbps: Double? = null,
)

@Serializable
data class EpisodeRef(val season: Int, val episode: Int, val skipped: Int = 0)

@Serializable
data class FillerAhead(val first: EpisodeRef, val count: Int, val canon: EpisodeRef? = null)

@Serializable
data class Version(val index: Int, val label: String, val badges: List<String> = emptyList(), val source: String = "")

/** Seconds: intro and recap as [start, end], credits as where they start. */
@Serializable
data class Markers(val intro: List<Double>? = null, val recap: List<Double>? = null, val credits: Double? = null)

@Serializable
data class AudioHint(val language: String, val tags: List<String> = emptyList())

@Serializable
data class SubtitleHint(val language: String, val tags: List<String> = emptyList(), val kind: String = "full", val signsTitles: List<String> = emptyList())

@Serializable
data class TrackHints(val audio: AudioHint? = null, val subtitles: SubtitleHint? = null)

@Serializable
data class Languages(val audio: List<String> = emptyList(), val subtitles: List<String> = emptyList())

@Serializable
data class PlayAnswer(
    val url: String,
    val version: Version? = null,
    val versions: List<Version> = emptyList(),
    val startAt: Double = 0.0,
    val next: EpisodeRef? = null,
    val fillerAhead: FillerAhead? = null,
    val autoplayNext: Boolean = true,
    val markers: Markers = Markers(),
    val skipIntros: Boolean = false,
    val tracks: TrackHints = TrackHints(),
    val languages: Languages = Languages(),
)

@Serializable
data class PrepareAnswer(val next: EpisodeRef? = null, val ready: Boolean = false)

@Serializable
data class Prefs(
    val fillers: String = "ask",
    val quality: String = "auto",
    val audioLanguage: String = "en",
    val subtitleLanguage: String = "",
    val animeAudio: String = "original",
    val filmAudio: String = "original",
    val subtitles: String = "auto",
    val autoplayNext: Boolean = true,
    val skipIntros: Boolean = false,
)

/* ───── Signing in ───── */

@Serializable
data class AccountProfile(val username: String, val name: String = "", val email: String = "", val role: String = "", val picture: String? = null)

@Serializable
data class SignInConfig(val issuer: String, val clientId: String, val scopes: List<String>)

@Serializable
data class Discovery(
    @SerialName("authorization_endpoint") val authorizationEndpoint: String,
    @SerialName("token_endpoint") val tokenEndpoint: String,
    @SerialName("revocation_endpoint") val revocationEndpoint: String? = null,
)

@Serializable
data class TokenAnswer(
    @SerialName("access_token") val accessToken: String? = null,
    @SerialName("refresh_token") val refreshToken: String? = null,
    @SerialName("expires_in") val expiresIn: Long = 600,
    val error: String? = null,
)

@Serializable
data class ApiFailure(val error: String)

/** A sentence a person can read, for the screen to show as it is. */
class WatchProblem(message: String, val status: Int = 0) : Exception(message)

package app.kimono.watch.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/*
 * The shapes the Portal's Watch API answers with (apps/portal/src/lib/watch).
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
    /** How the episode is named for the title's layout ("S2:E3", "E27", "E3"), when the server sends it. */
    val label: String? = null,
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
/** A page of Home: rows in this person's taste order, and [next] to ask for more (null once there are no more). */
data class Home(val featured: Card? = null, val rows: List<Row> = emptyList(), val next: kotlinx.serialization.json.JsonPrimitive? = null) {
    /** The cursor as sent (a number today), or null at the end. */
    val cursor: String? get() = next?.takeUnless { it is kotlinx.serialization.json.JsonNull }?.content
}

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
    val label: String? = null,
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
    /** Missing from older servers: the page's season then. */
    val season: Int? = null,
    /** Counted from the first episode, specials left out. */
    val absolute: Int? = null,
    /** "S2:E3", "E27" or "E3": how this episode is named everywhere. */
    val label: String? = null,
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

/** A title's language as it will play: [subtitles] is "off", "signs" or a language code. */
@Serializable
data class TitleLanguage(val audio: String, val subtitles: String, val original: String, val mine: String, val subtitleLanguage: String, val preferred: String? = null, val fallback: String? = null)

/** [state]: "ready", "upcoming", "cinemas" or "missing"; [note] says so in a few words. */
@Serializable
data class Availability(val state: String = "ready", val note: String? = null)

@Serializable
data class TitlePage(
    val title: TitleInfo,
    val inList: Boolean = false,
    val rating: String? = null,
    val reminding: Boolean = false,
    val tracks: TrackChoice? = null,
    val playable: Boolean = true,
    /** Why it can't play, when it can't: not out yet, only in cinemas, or no copy found. */
    val availability: Availability? = null,
    val resume: Resume? = null,
    val seasons: List<SeasonInfo> = emptyList(),
    val tracker: Tracker? = null,
    val badge: String? = null,
    val hasFillers: Boolean = false,
    /** "ask", "skip" or "watch". */
    val fillers: String = "ask",
    val season: Int? = null,
    val episodes: List<EpisodeInfo> = emptyList(),
    /** "single": one season, no season shown anywhere; "continuous": one list numbered from the first; "seasons": the picker. */
    val layout: String = "seasons",
    /** This show's own choice ("seasons" | "continuous"), or null to follow Settings' anime default. */
    val showEpisodes: String? = null,
    /** What it plays in now and the languages to offer; [tracks] set means this show has its own. */
    val language: TitleLanguage? = null,
) {
    val bySeason get() = layout == "seasons"
    /** The season an episode on this page belongs to. */
    fun seasonOf(e: EpisodeInfo) = e.season ?: season ?: 1
    fun episode(season: Int, number: Int) = episodes.firstOrNull { seasonOf(it) == season && it.number == number }
    /** How [season]/[number] is named on screen: the server's label, else made the same way. */
    fun label(season: Int, number: Int): String = episode(season, number)?.label ?: episodeLabel(layout, season, number, episode(season, number)?.absolute)
    /** The number people see: counted from the first in one run, else within the season. */
    fun shownNumber(season: Int, number: Int): Int = label(season, number).substringAfterLast('E').toIntOrNull() ?: number
}

/** As the server names episodes (apps/portal/src/lib/watch/labels.ts). */
fun episodeLabel(layout: String, season: Int, number: Int, absolute: Int? = null): String =
    if (layout == "seasons") "S$season:E$number" else "E${if (layout == "continuous") absolute ?: number else number}"

/** The long form for a heading: "Season 2: Episode 3" or "Episode 27". */
fun longLabel(short: String): String {
    val m = Regex("^S(\\d+):E(\\d+)$").find(short)
    return if (m != null) "Season ${m.groupValues[1]}: Episode ${m.groupValues[2]}" else "Episode ${short.removePrefix("E")}"
}

/** What a device can play, sent with every play so the server picks a version that works. */
@Serializable
data class Device(
    /** "android", "android-tv" or "ios". */
    val client: String,
    val maxHeight: Int,
    val hdr: List<String> = emptyList(),
    val dvProfiles: List<Int> = emptyList(),
    val codecs: List<String> = listOf("h264"),
    val passthrough: List<String> = emptyList(),
    val mbps: Double? = null,
    /** false: no 10-bit HEVC/AV1 decoding here. Left out when it can. */
    val tenBit: Boolean? = null,
    /** true only where 10-bit H.264 ("Hi10P") decodes. Left out otherwise. */
    val hi10p: Boolean? = null,
)

@Serializable
data class EpisodeRef(val season: Int, val episode: Int, val skipped: Int = 0, val label: String? = null)

@Serializable
data class FillerAhead(val first: EpisodeRef, val count: Int, val canon: EpisodeRef? = null)

@Serializable
/** [bytes]: about how big the file is, when the listing says. */
data class Version(val index: Int, val label: String, val key: String = "", val badges: List<String> = emptyList(), val source: String = "", val bytes: Long? = null)

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
data class QualityOption(val value: String, val label: String)

/** The Quality menu: what's in effect and what else plays on this device. */
@Serializable
data class QualityMenu(val current: String = "auto", val options: List<QualityOption> = emptyList())

@Serializable
data class PlayAnswer(
    val url: String,
    /** The HLS rendition (web, AirPlay, Chromecast): set when asked with `cast`. Relative to the Portal. */
    val hls: String? = null,
    val quality: QualityMenu? = null,
    val version: Version? = null,
    val versions: List<Version> = emptyList(),
    val startAt: Double = 0.0,
    val next: EpisodeRef? = null,
    /** Series only: the person's layout and this episode's label ("S2:E3", "E27", "E3"). */
    val layout: String? = null,
    val label: String? = null,
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
    /** "original" (each title's own language) or a language; each show can have its own. */
    val preferredLanguage: String = "original",
    /** The audio when no copy has the preferred language. */
    val fallbackLanguage: String = "en",
    /** The server's: the language understood (the preferred one, or the fallback while that's "original"). */
    val audioLanguage: String = "en",
    val subtitleLanguage: String = "",
    val subtitles: String = "auto",
    /** Anime "seasons" or "continuous" (one numbered run). */
    val animeEpisodes: String = "seasons",
    /** Text subtitles: "small" | "medium" | "large", and "none" | "shadow" | "box" behind them. Styled ASS keeps its own look. */
    val subtitleSize: String = "medium",
    val subtitleBackground: String = "shadow",
    /** Silent previews on Home and title pages. */
    val previews: Boolean = true,
    /** Downloads "standard" (smaller) or "higher" (near streaming quality). */
    val downloadQuality: String = "standard",
    val autoplayNext: Boolean = true,
    val skipIntros: Boolean = false,
    /** With `?device=`: this device's own quality, null when it follows the person's. */
    val device: DevicePref? = null,
)

@Serializable
data class DevicePref(val id: String, val quality: String? = null)

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

/** While a stream stalls: "server" when the server's side can't keep up, "connection" when this screen's connection is the slow part. */
@Serializable
data class Health(val slow: String? = null)

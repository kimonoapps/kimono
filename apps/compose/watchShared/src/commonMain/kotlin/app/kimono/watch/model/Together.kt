package app.kimono.watch.model

import kotlinx.serialization.Serializable

/*
 * Watch Together (apps/portal/src/lib/watch/together.ts): one timeline for
 * the household. Times are server milliseconds, positions seconds.
 */

@Serializable
data class Timeline(
    val titleId: String,
    val season: Int = 0,
    val episode: Int = 0,
    val playing: Boolean = false,
    /** Seconds in at [at]; while playing it moves on from there at [rate]. */
    val position: Double = 0.0,
    val rate: Double = 1.0,
    val at: Long = 0,
)

@Serializable
data class Hold(val reason: String, val waitingFor: List<String> = emptyList(), val since: Long = 0, val resume: Boolean? = null)

@Serializable
data class Countdown(val to: EpisodeRef, val endsAt: Long)

@Serializable
data class PartyBy(val username: String, val client: String, val type: String)

@Serializable
data class PartyMember(val client: String, val username: String, val state: String = "loading", val present: Boolean = true)

@Serializable
data class PartyView(
    val id: String,
    val host: String,
    val hostOnly: Boolean = false,
    val invited: List<String> = emptyList(),
    val seq: Long = 0,
    val moved: Long = 0,
    val timeline: Timeline,
    val hold: Hold? = null,
    val countdown: Countdown? = null,
    val by: PartyBy? = null,
    val members: List<PartyMember> = emptyList(),
    val ended: Boolean = false,
    val now: Long = 0,
)

@Serializable
data class ChatLine(val id: String, val username: String, val text: String, val at: Long = 0)

@Serializable
data class Person(val username: String, val name: String = "", val picture: String? = null) {
    val shown get() = name.ifBlank { username }
}

@Serializable
data class PartySummary(
    val id: String,
    val host: String,
    val hostName: String = "",
    /** Asked to and not in it yet: show "Sami is watching X — Join". */
    val invited: Boolean = false,
    val title: Card? = null,
    val season: Int = 0,
    val episode: Int = 0,
    /** The episode as the title names it, when the server sends it. */
    val label: String? = null,
    val watching: List<String> = emptyList(),
    val seq: Long = 0,
)

@Serializable
/** recent: usernames watched with or asked lately, most recent first. */
data class Parties(val parties: List<PartySummary> = emptyList(), val people: List<Person> = emptyList(), val recent: List<String> = emptyList(), /** Their friends, watched with lately first: what Watch together suggests. */ val friends: List<String> = emptyList())

@Serializable
data class PartyAnswer(val ok: Boolean = true, val state: PartyView? = null, val reason: String? = null)

@Serializable
data class PartyNow(val state: PartyView, val chat: List<ChatLine> = emptyList(), val title: PartyTitle? = null)

@Serializable
data class PartyTitle(val id: String, val name: String)

@Serializable
data class Reaction(val username: String, val client: String = "", val emoji: String, val at: Long = 0)

@Serializable
data class ChatEvent(val lines: List<ChatLine> = emptyList())

@Serializable
data class ClockAnswer(val now: Long)

package app.kimono.watch.model

import kotlinx.serialization.Serializable

/*
 * Friends (apps/portal/src/lib/watch/friends.ts): what friends are watching
 * now, where they are in things, and asking to join them.
 */

/** Where someone is in a title: [progress] 0–1 through that episode or film. */
@Serializable
data class Spot(
    val title: Card,
    val season: Int = 0,
    val episode: Int = 0,
    val label: String? = null,
    val progress: Double = 0.0,
    val finished: Boolean = false,
    val at: Long = 0,
)

@Serializable
data class NowWatching(
    val title: Card,
    val season: Int = 0,
    val episode: Int = 0,
    val label: String? = null,
    val progress: Double = 0.0,
    val position: Double = 0.0,
    val duration: Double = 0.0,
    /** In a party: asking brings you into that one. */
    val partyId: String? = null,
)

@Serializable
data class Friend(
    val username: String,
    val name: String = "",
    val picture: String? = null,
    val now: NowWatching? = null,
    val recent: List<Spot> = emptyList(),
    /** False when they keep what they watch to themselves. */
    val sharing: Boolean = true,
) {
    val person get() = Person(username, name, picture)
    val shown get() = name.ifBlank { username }
}

/** An ask to join: [answer] "waiting", "yes" (go to [partyId]) or "no". [name] and [picture] are the other person's. */
@Serializable
data class JoinAsk(
    val id: String,
    val from: String,
    val to: String,
    val answer: String = "waiting",
    val partyId: String? = null,
    val at: Long = 0,
    val name: String = "",
    val picture: String? = null,
    val title: String? = null,
    val label: String? = null,
) {
    val other get() = Person(from, name, picture)
}

@Serializable
data class Asks(val incoming: List<JoinAsk> = emptyList(), val outgoing: List<JoinAsk> = emptyList())

@Serializable
data class AskAnswer(val ask: JoinAsk? = null)

@Serializable
data class FriendsPage(
    /** Whether this person shows friends what they watch. */
    val sharing: Boolean = true,
    /** Invisible: friends don't see them watching, can't ask to join, and don't see what's watched meanwhile. */
    val invisible: Boolean = false,
    val friends: List<Friend> = emptyList(),
    /** Asked to be your friend. */
    val asked: List<Person> = emptyList(),
    /** You asked them. */
    val asking: List<Person> = emptyList(),
    /** Everyone else on this Kimono. */
    val people: List<Person> = emptyList(),
    val incoming: List<JoinAsk> = emptyList(),
    val outgoing: List<JoinAsk> = emptyList(),
)

/** A friend's place in one title, for its page. */
@Serializable
data class FriendHere(
    val username: String,
    val name: String = "",
    val picture: String? = null,
    val season: Int = 0,
    val episode: Int = 0,
    val label: String? = null,
    val progress: Double = 0.0,
    val finished: Boolean = false,
    val at: Long = 0,
    /** Watching it right now. */
    val now: Boolean = false,
) {
    val person get() = Person(username, name, picture)
    val shown get() = name.ifBlank { username }
}

package app.kimono.watch.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.kimono.watch.PlaybackEngine
import app.kimono.watch.data.WatchApi
import app.kimono.watch.model.ChatEvent
import app.kimono.watch.model.ChatLine
import app.kimono.watch.model.PartyView
import app.kimono.watch.model.Person
import app.kimono.watch.model.Reaction
import app.kimono.watch.model.Timeline
import app.kimono.watch.model.WatchProblem
import app.kimono.watch.nowMs
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonObjectBuilder
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlin.math.abs
import kotlin.math.ceil
import kotlin.math.max
import kotlin.math.min

/*
 * 共 Watch Together's maths, as the server's (apps/portal/src/lib/watch/together.ts),
 * so every screen keeps to one timeline the same way.
 */
object TogetherMaths {
    /** Drift: seek past this; nudge the rate past [NUDGE_FROM], until under [NUDGE_TO]. */
    const val SEEK_PAST = 2.0
    const val NUDGE_FROM = 0.15
    const val NUDGE_TO = 0.04
    const val MAX_NUDGE = 0.05

    /** Where the timeline is at server time [now], in seconds. */
    fun positionAt(t: Timeline, now: Long): Double = if (!t.playing) t.position else t.position + (max(0L, now - t.at) / 1000.0) * t.rate

    data class Correction(val seek: Double?, val rate: Double, val correcting: Boolean)

    /**
     * What a screen playing at [local] does to keep to [expected]: seek when
     * it's more than 2 s out, else ease the rate (never past ±5%) until it's
     * back within 40 ms; under 150 ms it leaves well alone.
     */
    fun correction(local: Double, expected: Double, correcting: Boolean, rate: Double = 1.0): Correction {
        val drift = local - expected
        if (abs(drift) > SEEK_PAST) return Correction(expected, rate, false)
        if (abs(drift) < (if (correcting) NUDGE_TO else NUDGE_FROM)) return Correction(null, rate, false)
        val nudge = max(-MAX_NUDGE, min(MAX_NUDGE, drift * 0.2))
        return Correction(null, rate * (1 - nudge), true)
    }

    data class ClockSample(val sent: Long, val received: Long, val server: Long)

    /** The server clock less this one, NTP-style: the median offset of the quickest third of pings. */
    fun clockOffset(samples: List<ClockSample>): Long? {
        val ok = samples.filter { it.received >= it.sent }
        if (ok.isEmpty()) return null
        val best = ok.sortedBy { it.received - it.sent }.take(max(1, ceil(ok.size / 3.0).toInt()))
        val offsets = best.map { it.server - (it.sent + it.received) / 2.0 }.sorted()
        val mid = offsets.size / 2
        return (if (offsets.size % 2 == 1) offsets[mid] else (offsets[mid - 1] + offsets[mid]) / 2).toLong()
    }
}

/** A reaction floating up the screen. */
data class Floating(val emoji: String, val name: String, val key: Long)

val partyReactions = listOf("❤️", "😂", "😮", "😢", "👏", "🔥")

/**
 * One screen in a party: the live channel (state, chat, reactions), the
 * server clock, this screen's status (loading, ready, buffering, every 5 s),
 * the commands, and [sync], which keeps the player on the party's timeline.
 */
class TogetherViewModel(private val api: WatchApi, val client: String, val partyId: String, val me: String) : ViewModel() {
    private val _state = MutableStateFlow<PartyView?>(null)
    val state: StateFlow<PartyView?> = _state
    private val _chat = MutableStateFlow<List<ChatLine>>(emptyList())
    val chat: StateFlow<List<ChatLine>> = _chat
    private val _people = MutableStateFlow<List<Person>>(emptyList())
    val people: StateFlow<List<Person>> = _people
    private val _recent = MutableStateFlow<List<String>>(emptyList())
    /** Usernames watched with or asked lately, most recent first. */
    val recent: StateFlow<List<String>> = _recent
    private val _floating = MutableSharedFlow<Floating>(extraBufferCapacity = 16)
    val floating: SharedFlow<Floating> = _floating
    private val _ended = MutableStateFlow(false)
    val ended: StateFlow<Boolean> = _ended
    private val _problem = MutableStateFlow<String?>(null)
    val problem: StateFlow<String?> = _problem

    private val samples = ArrayDeque<TogetherMaths.ClockSample>()
    private var offset = 0L
    private var status = "loading"
    private var lastStatusAt = 0L
    private var correcting = false
    /* Right after this screen's own command, the player leads and the echo catches up. */
    private var quietUntil = 0L

    fun serverNow(): Long = nowMs() + offset
    val isHost get() = _state.value?.host?.equals(me, ignoreCase = true) == true
    fun nameOf(username: String) = _people.value.firstOrNull { it.username.equals(username, true) }?.shown ?: username

    init {
        viewModelScope.launch { runCatching { api.party(partyId) }.onSuccess { take(it.state, force = true); _chat.value = it.chat } }
        viewModelScope.launch { runCatching { api.parties() }.onSuccess { _people.value = it.people; _recent.value = it.recent } }
        /* The clock: six pings to start, then one every 20 s, the last 15 kept. */
        viewModelScope.launch {
            repeat(6) { ping(); delay(150) }
            while (true) { delay(20_000); ping() }
        }
        viewModelScope.launch { listen() }
        /* This screen's status, every 5 s as a heartbeat. */
        viewModelScope.launch { while (true) { delay(5_000); send("status") { put("state", status) } } }
    }

    private suspend fun ping() {
        val sent = nowMs()
        val server = runCatching { api.serverClock() }.getOrNull() ?: return
        samples.addLast(TogetherMaths.ClockSample(sent, nowMs(), server))
        while (samples.size > 15) samples.removeFirst()
        TogetherMaths.clockOffset(samples.toList())?.let { offset = it }
    }

    /** The live channel, reconnected when it drops or goes quiet for 25 s. */
    private suspend fun listen() {
        while (!_ended.value) {
            var heard = nowMs()
            val watchdog = viewModelScope.launch { while (true) { delay(5_000); if (nowMs() - heard > 25_000) break } }
            val job: Job = viewModelScope.launch {
                try {
                    api.partyEvents(partyId, client) { event, data ->
                        heard = nowMs()
                        when (event) {
                            "state" -> runCatching { api.json.decodeFromString<PartyView>(data) }.getOrNull()?.let { take(it) }
                            "chat" -> runCatching { api.json.decodeFromString<ChatEvent>(data) }.getOrNull()?.let { e ->
                                _chat.value = (_chat.value + e.lines).distinctBy { it.id }.takeLast(50)
                            }
                            "react" -> runCatching { api.json.decodeFromString<Reaction>(data) }.getOrNull()?.let { r ->
                                _floating.tryEmit(Floating(r.emoji, nameOf(r.username), nowMs()))
                            }
                            "ended" -> _ended.value = true
                        }
                    }
                } catch (e: CancellationException) { throw e } catch (e: WatchProblem) {
                    if (e.status == 404) _ended.value = true
                } catch (_: Exception) {}
            }
            /* Whichever comes first: the stream ending, or 25 s of silence. */
            while (job.isActive && watchdog.isActive) delay(500)
            job.cancel(); watchdog.cancel()
            if (!_ended.value) delay(1_500)
        }
    }

    /** Takes a state if it's news (or always, when the server said our command didn't land). */
    private fun take(next: PartyView, force: Boolean = false) {
        val held = _state.value
        if (force || held == null || next.seq > held.seq) {
            _state.value = next
            if (next.ended) _ended.value = true
        }
    }

    private fun send(type: String, extra: JsonObjectBuilder.() -> Unit = {}) {
        val body = buildJsonObject {
            put("client", client); put("seq", _state.value?.seq ?: 0); put("type", type)
            extra()
        }
        viewModelScope.launch { command(body) }
    }

    private suspend fun command(body: JsonObject) {
        val answer = runCatching { api.partyCommand(partyId, body) }.getOrNull() ?: return
        answer.state?.let { take(it, force = !answer.ok) }
        _problem.value = when (answer.reason) {
            "host-only" -> "Only ${nameOf(_state.value?.host ?: "")} can steer this party."
            else -> null
        }
    }

    /* ── Commands: applied on this screen at once; the state echo confirms ── */
    fun play(position: Double) { quietUntil = nowMs() + 1200; send("play") { put("position", position) } }
    fun pause(position: Double) { quietUntil = nowMs() + 1200; send("pause") { put("position", position) } }
    fun seek(position: Double) { quietUntil = nowMs() + 1200; send("seek") { put("position", position) } }
    fun rate(rate: Float) { quietUntil = nowMs() + 1200; send("rate") { put("rate", rate.toDouble()) } }
    fun episode(season: Int, episode: Int) = send("episode") { put("season", season); put("episode", episode) }
    /** At the credits: the shared countdown (the server picks the episode). */
    fun next() { if (_state.value?.countdown == null) send("next") }
    fun watchCredits() = send("cancel-countdown")
    fun startWithoutThem() = send("skip-wait")
    fun react(emoji: String) = send("react") { put("emoji", emoji) }
    fun say(text: String) { val t = text.trim().take(300); if (t.isNotEmpty()) send("chat") { put("text", t) } }
    fun invite(usernames: List<String>) = send("invite") { put("usernames", JsonArray(usernames.map { JsonPrimitive(it) })) }
    fun hostOnly(on: Boolean) = send("host-only") { put("on", on) }

    /** Leaving: the party goes on for everyone else. */
    @OptIn(kotlinx.coroutines.DelicateCoroutinesApi::class)
    fun leave() {
        val body = buildJsonObject { put("client", client); put("seq", _state.value?.seq ?: 0); put("type", "leave") }
        kotlinx.coroutines.GlobalScope.launch { withTimeoutOrNull(5_000) { runCatching { api.partyCommand(partyId, body) } } }
    }

    /** This screen's status: loading until it can play, then ready, or buffering when it stalls. */
    fun report(next: String) {
        if (next == status && nowMs() - lastStatusAt < 5_000) return
        status = next; lastStatusAt = nowMs()
        send("status") { put("state", next) }
    }

    /**
     * Keeps [engine] on the party's timeline (run every ~200 ms once this
     * screen's stream for the party's episode is loaded): paused or held, it
     * waits at the timeline's position; playing, it starts at the shared
     * moment and is nudged or, past 2 s, seeked back into step.
     */
    fun sync(engine: PlaybackEngine) {
        if (nowMs() < quietUntil) return
        val s = _state.value ?: return
        val t = s.timeline
        val now = serverNow()
        val shouldPlay = t.playing && s.hold == null && now >= t.at
        if (!shouldPlay) {
            if (engine.playWhenReady) engine.pause()
            if (abs(engine.position - t.position) > .25) engine.seekTo(t.position)
            correcting = false
            engine.setSpeed(t.rate.toFloat())
            return
        }
        val expected = TogetherMaths.positionAt(t, now)
        if (!engine.playWhenReady) engine.play()
        val c = TogetherMaths.correction(engine.position, expected, correcting, t.rate)
        correcting = c.correcting
        if (c.seek != null) engine.seekTo(c.seek + .2) else engine.setSpeed(c.rate.toFloat())
    }
}

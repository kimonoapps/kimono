package app.kimono.watch.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.kimono.watch.data.WatchApi
import app.kimono.watch.model.Card
import app.kimono.watch.model.EpisodeInfo
import app.kimono.watch.model.FillerAhead
import app.kimono.watch.model.PlayAnswer
import app.kimono.watch.model.TitlePage
import app.kimono.watch.model.TrackChoice
import app.kimono.watch.model.WatchProblem
import kotlinx.coroutines.Job
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject

/** What covers the picture once the credits roll. */
sealed interface Post {
    data object None : Post
    /** The corner vignette: Watch credits, and Next episode filling itself. */
    data class Next(val skipped: Int) : Post
    /** The first time filler is up next: skip it from now on, or watch it. */
    data class Ask(val filler: FillerAhead) : Post
    /** No next episode: the end-of-season (or film) card. */
    data object End : Post
}

/** [progress] runs out over [SKIP_SHOWN] seconds; once [gone] it shows only with the controls. */
data class SkipOffer(val label: String, val to: Double, val progress: Float, val gone: Boolean = false)

/** Seconds Skip intro / Skip recap stays up by itself. */
const val SKIP_SHOWN = 10.0

data class PlayerState(
    val titleId: String,
    val page: TitlePage? = null,
    val season: Int = 0,
    val episode: Int = 0,
    val answer: PlayAnswer? = null,
    /** Goes up each time a new stream should be loaded. */
    val loads: Int = 0,
    /** Where to start the stream just loaded, in seconds. */
    val startAt: Double = 0.0,
    val loading: Boolean = true,
    val problem: String? = null,
    val skip: SkipOffer? = null,
    val post: Post = Post.None,
    val recs: List<Card> = emptyList(),
    /** Waiting for the server to find and pick a copy (the ring's first stages). */
    val finding: Boolean = true,
) {
    val isFilm get() = page?.title?.isFilm == true
    /** All of this person's screens are in use elsewhere (the server's 429). */
    val tooMany get() = problem?.startsWith("You're already watching") == true
    val current: EpisodeInfo? get() = page?.episode(season, episode)
    /** "S2:E3", "E27" or "E3", as the title names its episodes. */
    val label: String get() = answer?.label ?: page?.label(season, episode) ?: answer?.layout?.let { app.kimono.watch.model.episodeLabel(it, season, episode) } ?: "S$season:E$episode"
    /** Seconds where the credits start: the marker, else the last 25 s. */
    fun creditsAt(duration: Double): Double = answer?.markers?.credits?.takeIf { it > 0 && it < duration } ?: (duration - 25).coerceAtLeast(duration * 0.9)
}

/**
 * The player's mind, apart from the decoder: which episode, skip intro and
 * recap, the next-up corner, the filler question, and telling the Portal where
 * playback is (every 10 s, on pause, on leaving) and to get the next episode
 * ready at 70%.
 */
class PlayerViewModel(
    private val api: WatchApi,
    private val toasts: Toasts,
    val titleId: String,
    /** A downloaded episode's kept play answer, played with no connection. */
    private val offline: (String, Int, Int) -> PlayAnswer? = { _, _, _ -> null },
) : ViewModel() {
    private val _state = MutableStateFlow(PlayerState(titleId))
    val state: StateFlow<PlayerState> = _state
    private var loadJob: Job? = null
    private var lastSaved = -100.0
    private var prepared = false
    private var autoSkipped = false
    /* The part's start and where its skip first showed (a seek into the middle counts from there). */
    private var skipFrom: Pair<Double, Double>? = null
    private var creditsDone = false
    private var lastPos = 0.0
    private var lastDur = 0.0

    /** While stalling: "server" or "connection", whichever is holding the stream up; null for a download played from the device. */
    suspend fun slowSide(): String? {
        val s = _state.value
        if (s.answer?.url?.startsWith("http") != true) return null
        return runCatching { api.health(s.titleId, s.season, s.episode).slow }.getOrNull() ?: "connection"
    }

    /** Starts at [season]/[episode], or wherever Resume points when they're null. */
    fun start(season: Int?, episode: Int?) {
        loadJob?.cancel()
        _state.value = _state.value.copy(loading = true, problem = null)
        loadJob = viewModelScope.launch {
            try {
                val page = api.title(titleId, season?.takeIf { it > 0 })
                val film = page.title.isFilm
                val s = if (film) 0 else season ?: page.resume?.season ?: 1
                val e = if (film) 0 else episode ?: page.resume?.episode ?: 1
                val shown = if (!film && page.season != s) api.title(titleId, s) else page
                _state.value = _state.value.copy(page = shown)
                load(s, e)
                if (_state.value.recs.isEmpty()) runCatching {
                    val home = api.home(shown.title.shelf)
                    _state.value = _state.value.copy(recs = listOf("similar", "anime", "series", "films", "top").flatMap { id -> home.rows.firstOrNull { it.id == id }?.items.orEmpty() }
                        .filter { it.id != titleId }.distinctBy { it.id }.take(3))
                }
            } catch (e: Exception) {
                if (e is kotlinx.coroutines.CancellationException) throw e
                _state.value = _state.value.copy(loading = false, problem = (e as? WatchProblem)?.message ?: "This didn't start. Try again.")
            }
        }
    }

    /** Copies already tried for what's loading, by key: "another copy" skips them however the server ranks next time. */
    private var tried = emptyList<String>()

    private suspend fun load(season: Int, episode: Int, version: Int? = null, at: Double? = null, quality: String? = null, avoid: List<String> = emptyList()) {
        tried = avoid
        _state.value = _state.value.copy(season = season, episode = episode, loading = true, finding = true, problem = null, skip = null, post = Post.None)
        prepared = false; autoSkipped = false; skipFrom = null; creditsDone = false; lastSaved = -100.0
        val page = _state.value.page
        if (page != null && !page.title.isFilm && page.bySeason && page.season != season) {
            runCatching { api.title(titleId, season) }.getOrNull()?.let { _state.value = _state.value.copy(page = it) }
        }
        val answer = (if (version == null && quality == null && avoid.isEmpty()) offline(titleId, season, episode) else null) ?: api.play(titleId, season, episode, version, quality, avoid = avoid)
        _state.value = _state.value.copy(answer = answer, finding = false, startAt = at ?: answer.startAt, loads = _state.value.loads + 1)
    }

    /** The decoder has the first frames: the loading ring goes. */
    fun started() { _state.value = _state.value.copy(loading = false) }

    fun failed(message: String) { _state.value = _state.value.copy(loading = false, problem = message) }

    fun retry() {
        val s = _state.value
        loadJob?.cancel()
        loadJob = viewModelScope.launch { runCatching { load(s.season, s.episode, at = lastPos.takeIf { it > 0 }) }.onFailure { e -> failed((e as? WatchProblem)?.message ?: "This didn't start. Try again.") } }
    }

    /** Asks the admins for one more screen; [done] says whether it went. */
    fun askForScreens(done: (Boolean) -> Unit) {
        viewModelScope.launch { done(runCatching { api.askScreens() }.isSuccess) }
    }

    /** Every screen is taken: end them everywhere, then start here. */
    fun endOthers() {
        _state.value = _state.value.copy(loading = true, problem = null)
        viewModelScope.launch {
            if (runCatching { api.endStreams() }.isFailure) failed("Those didn't stop. Try again.") else retry()
        }
    }

    private fun offer(label: String, span: List<Double>, position: Double): SkipOffer {
        val from = skipFrom?.takeIf { it.first == span[0] && position >= it.second } ?: (span[0] to position).also { skipFrom = it }
        val shownFor = position - from.second
        return SkipOffer(label, span[1], (shownFor / SKIP_SHOWN).coerceAtMost(1.0).toFloat(), shownFor >= SKIP_SHOWN)
    }

    /**
     * Called a few times a second with where playback is. Returns a position to
     * seek to when an intro should be skipped by itself (the person's setting).
     */
    fun tick(position: Double, duration: Double, playing: Boolean): Double? {
        val s = _state.value
        val answer = s.answer ?: return null
        if (duration <= 0) return null
        lastPos = position; lastDur = duration
        val markers = answer.markers
        val intro = markers.intro?.takeIf { it.size == 2 }
        val recap = markers.recap?.takeIf { it.size == 2 }
        var autoSeek: Double? = null
        val skip = when {
            s.post !is Post.None -> null
            recap != null && position >= recap[0] && position < recap[1] -> offer("Skip recap", recap, position)
            intro != null && position >= intro[0] && position < intro[1] -> {
                if (answer.skipIntros && !autoSkipped) { autoSkipped = true; autoSeek = intro[1]; null }
                else offer("Skip intro", intro, position)
            }
            else -> null
        }
        if (skip == null) skipFrom = null
        val credits = s.creditsAt(duration)
        var post = s.post
        if (position < credits - 1) {
            creditsDone = false
            if (post is Post.Next || post is Post.Ask) post = Post.None
        } else if (!creditsDone && post is Post.None) {
            post = when {
                answer.fillerAhead != null -> Post.Ask(answer.fillerAhead)
                answer.next != null -> Post.Next(answer.next.skipped)
                else -> Post.End
            }
        }
        if (skip != s.skip || post != s.post) _state.value = s.copy(skip = skip, post = post)
        /* The next one gets ready while this one is still on. */
        if (!prepared && !s.isFilm && position / duration > 0.7) {
            prepared = true
            viewModelScope.launch { runCatching { api.prepare(titleId, s.season, s.episode) } }
        }
        if (playing && (position - lastSaved > 10 || position < lastSaved)) save(position, duration)
        return autoSeek
    }

    /* The picture's shape as it plays, told once per copy: a copy cropped to 16:9 is passed over next time. */
    private var shape: Pair<String, Float>? = null
    private var shapeTold: String? = null
    fun shape(ratio: Float) { _state.value.answer?.url?.let { shape = it to ratio } }

    /** Tells the Portal where playback is. */
    fun save(position: Double, duration: Double) {
        if (duration <= 0) return
        lastSaved = position
        val s = _state.value
        val measured = shape?.takeIf { it.first == s.answer?.url && it.first != shapeTold }
        if (measured != null) shapeTold = measured.first
        viewModelScope.launch { runCatching { api.progress(titleId, s.season, s.episode, position, duration, measured?.first, measured?.second) } }
    }

    /** Leaving the player: the last position is sent even as the screen goes. */
    @OptIn(kotlinx.coroutines.DelicateCoroutinesApi::class)
    fun leave(position: Double, duration: Double) {
        if (duration <= 0) return
        val s = _state.value
        kotlinx.coroutines.GlobalScope.launch { withContext(NonCancellable) { runCatching { api.progress(titleId, s.season, s.episode, position, duration) } } }
    }

    fun watchCredits() {
        creditsDone = true
        _state.value = _state.value.copy(post = Post.None)
    }

    fun playNext() {
        val next = _state.value.answer?.next ?: return
        finishCurrent()
        play(next.season, next.episode)
    }

    fun play(season: Int, episode: Int) {
        loadJob?.cancel()
        loadJob = viewModelScope.launch { runCatching { load(season, episode) }.onFailure { e -> if (e !is kotlinx.coroutines.CancellationException) failed((e as? WatchProblem)?.message ?: "This didn't start. Try again.") } }
    }

    /** Another version (4K, a smaller file, another source), from the same moment. */
    fun version(index: Int, at: Double) {
        val s = _state.value
        loadJob?.cancel()
        loadJob = viewModelScope.launch { runCatching { load(s.season, s.episode, index, at) }.onFailure { e -> failed((e as? WatchProblem)?.message ?: "That version didn't start.") } }
    }

    /** Another quality from the player's menu, from the same moment; this play only (Settings keeps the device's). */
    fun quality(value: String, at: Double) {
        val s = _state.value
        loadJob?.cancel()
        loadJob = viewModelScope.launch { runCatching { load(s.season, s.episode, at = at, quality = value) }.onFailure { e -> failed((e as? WatchProblem)?.message ?: "That quality didn't start.") } }
    }

    /** Whether there's a copy left to try. */
    fun hasAnother(): Boolean {
        val answer = _state.value.answer ?: return false
        val avoid = tried + listOfNotNull(answer.version?.key?.takeIf { it.isNotEmpty() })
        return if (avoid.isEmpty()) (answer.version?.index ?: 0) + 1 < answer.versions.size else answer.versions.any { it.key !in avoid }
    }

    /** This device couldn't decode the version picked: the next one down, from the same moment. False when there's none left. */
    fun fallback(at: Double): Boolean {
        val s = _state.value
        val answer = s.answer ?: return false
        val avoid = tried + listOfNotNull(answer.version?.key?.takeIf { it.isNotEmpty() })
        if (avoid.isEmpty()) {
            /* An older server without keys: the next place in its list. */
            val next = (answer.version?.index ?: 0) + 1
            if (next >= answer.versions.size) return false
            version(next, at)
            return true
        }
        if (answer.versions.none { it.key !in avoid }) return false
        loadJob?.cancel()
        loadJob = viewModelScope.launch { runCatching { load(s.season, s.episode, at = at, avoid = avoid) }.onFailure { e -> failed((e as? WatchProblem)?.message ?: "That copy didn't start.") } }
        return true
    }

    private fun finishCurrent() {
        if (lastDur > 0) save(lastDur, lastDur)
    }

    /** The filler question, answered once for good. */
    fun fillers(skip: Boolean) {
        val ask = (_state.value.post as? Post.Ask)?.filler ?: return
        viewModelScope.launch { runCatching { api.savePrefs(buildJsonObject { put("fillers", JsonPrimitive(if (skip) "skip" else "watch")) }) } }
        finishCurrent()
        val target = if (skip) ask.canon else ask.first
        if (skip) toasts.show(target?.let { "Skipping to ${it.label ?: "episode " + (_state.value.page?.shownNumber(it.season, it.episode) ?: it.episode)}" } ?: "Fillers will be skipped")
        if (target != null) play(target.season, target.episode) else _state.value = _state.value.copy(post = Post.End)
    }

    /** Audio and subtitles picked in the player, kept for this show so the next episode starts the same way. */
    fun tracks(audio: String, subtitles: String) {
        viewModelScope.launch { runCatching { api.mark(titleId, tracks = TrackChoice(audio, subtitles)) } }
    }

    fun remind() {
        val page = _state.value.page ?: return
        _state.value = _state.value.copy(page = page.copy(reminding = true))
        toasts.show("We'll let you know when it arrives")
        viewModelScope.launch { runCatching { api.mark(titleId, reminding = true) } }
    }
}

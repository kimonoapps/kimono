@file:OptIn(kotlin.time.ExperimentalTime::class)

package app.kimono.watch.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.kimono.watch.data.WatchApi
import app.kimono.watch.model.Card
import app.kimono.watch.model.Home
import app.kimono.watch.model.TitlePage
import app.kimono.watch.model.WatchProblem
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import kotlin.time.Clock

/** A short sentence to show at the bottom of the screen ("Added to My list"). */
class Toasts {
    private val _flow = MutableSharedFlow<String>(extraBufferCapacity = 4)
    val flow: SharedFlow<String> = _flow
    fun show(text: String) { _flow.tryEmit(text) }
}

private fun problemOf(e: Throwable) = (e as? WatchProblem)?.message ?: "Something went wrong. Try again."

/* ───── Home ───── */

data class HomeState(val loading: Boolean = true, val home: Home? = null, val shelf: String? = null, val problem: String? = null, val more: Boolean = false)

/**
 * Home's hero and rows, narrowed by the Series / Films / Anime chips. Rows
 * come a page at a time in this person's taste order: [more] asks for the next
 * page as the list nears its end, until the server says there are no more.
 */
class HomeViewModel(private val api: WatchApi) : ViewModel() {
    private val _state = MutableStateFlow(HomeState())
    val state: StateFlow<HomeState> = _state
    private val kept = mutableMapOf<String?, Home>()
    private var job: Job? = null
    private var moreJob: Job? = null
    /** Rows in the first page, so a refresh can swap it and keep the pages after. */
    private val firstPage = mutableMapOf<String?, Int>()
    /* After a failed page, a short rest before asking again (the list keeps asking as it nears its end). */
    private var failedAt = 0L

    init { load(null) }

    fun shelf(shelf: String?) {
        val next = if (_state.value.shelf == shelf) null else shelf
        load(next)
    }

    /** Asks again, showing what's known meanwhile (back from the player, say). */
    fun refresh() = load(_state.value.shelf, quiet = true)

    private fun load(shelf: String?, quiet: Boolean = false) {
        job?.cancel(); moreJob?.cancel()
        val known = kept[shelf]
        _state.value = _state.value.copy(shelf = shelf, loading = known == null && !quiet, home = known ?: if (quiet) _state.value.home else null, problem = null, more = false)
        job = viewModelScope.launch {
            try {
                val fresh = api.home(shelf)
                val old = kept[shelf]
                val firstCount = firstPage[shelf] ?: 0
                /* The first page anew; pages already scrolled into stay after it. */
                val home = if (old != null && quiet && old.rows.size > firstCount) {
                    val ids = fresh.rows.map { it.id }.toSet()
                    fresh.copy(rows = fresh.rows + old.rows.drop(firstCount).filter { it.id !in ids }, next = old.next)
                } else fresh
                firstPage[shelf] = fresh.rows.size
                kept[shelf] = home
                _state.value = _state.value.copy(loading = false, home = home)
            } catch (e: Exception) {
                if (e is kotlinx.coroutines.CancellationException) throw e
                _state.value = _state.value.copy(loading = false, problem = if (_state.value.home == null) problemOf(e) else null)
            }
        }
    }

    /** The next page of rows, once; nothing when one is on its way or there are no more. */
    fun more() {
        val s = _state.value
        val home = s.home ?: return
        val cursor = home.cursor ?: return
        if (s.more || job?.isActive == true || app.kimono.watch.nowMs() - failedAt < 5_000) return
        val shelf = s.shelf
        _state.value = s.copy(more = true)
        moreJob = viewModelScope.launch {
            try {
                val page = api.home(shelf, cursor)
                val now = kept[shelf] ?: home
                val ids = now.rows.map { it.id }.toSet()
                val joined = now.copy(rows = now.rows + page.rows.filter { it.id !in ids }, next = page.next)
                kept[shelf] = joined
                if (_state.value.shelf == shelf) _state.value = _state.value.copy(home = joined, more = false)
            } catch (e: Exception) {
                if (e is kotlinx.coroutines.CancellationException) throw e
                failedAt = app.kimono.watch.nowMs()
                _state.value = _state.value.copy(more = false)
            }
        }
    }

    /** The cards on My list, from Home's own row. */
    fun myList(): List<Card> = kept[null]?.rows?.firstOrNull { it.id == "list" }?.items.orEmpty()
}

/* ───── My list ───── */

data class ListState(val loading: Boolean = true, val items: List<Card> = emptyList(), val problem: String? = null)

class ListViewModel(private val api: WatchApi) : ViewModel() {
    private val _state = MutableStateFlow(ListState())
    val state: StateFlow<ListState> = _state
    init { refresh() }
    fun refresh() {
        viewModelScope.launch {
            try { _state.value = ListState(false, api.home().rows.firstOrNull { it.id == "list" }?.items.orEmpty()) }
            catch (e: Exception) { _state.value = _state.value.copy(loading = false, problem = problemOf(e)) }
        }
    }
}

/* ───── New & hot ───── */

data class Coming(val card: Card, val page: TitlePage, val date: String)
data class HotState(val loading: Boolean = true, val items: List<Coming> = emptyList(), val problem: String? = null)

/**
 * Coming soon: the shows on Home with a next episode or season on the way,
 * soonest first. (The API has no list of what's coming; title pages say
 * when each show's next episode airs.)
 */
class HotViewModel(private val api: WatchApi, private val toasts: Toasts) : ViewModel() {
    private val _state = MutableStateFlow(HotState())
    val state: StateFlow<HotState> = _state
    init { refresh() }

    fun refresh() {
        viewModelScope.launch {
            try {
                val home = api.home()
                val order = listOf("list", "continue", "similar", "series", "anime", "top")
                val cards = order.flatMap { id -> home.rows.firstOrNull { it.id == id }?.items.orEmpty() }
                    .filter { !it.isFilm }.distinctBy { it.id }.take(18)
                val gate = Semaphore(4)
                val today = Clock.System.now().toString().take(10)
                val found = cards.map { card ->
                    viewModelScope.async { gate.withPermit { runCatching { api.title(card.id) }.getOrNull() }?.let { page ->
                        val date = page.tracker?.nextAirDate ?: page.title.nextAirDate
                        if (date != null && date >= today) Coming(card, page, date) else null
                    } }
                }.awaitAll().filterNotNull().sortedBy { it.date }
                _state.value = HotState(false, found)
            } catch (e: Exception) {
                _state.value = _state.value.copy(loading = false, problem = problemOf(e))
            }
        }
    }

    fun remind(item: Coming) {
        val on = !item.page.reminding
        _state.value = _state.value.copy(items = _state.value.items.map { if (it.card.id == item.card.id) it.copy(page = it.page.copy(reminding = on)) else it })
        toasts.show(if (on) "We'll let you know when ${item.card.name} arrives" else "Reminder off")
        viewModelScope.launch { runCatching { api.mark(item.card.id, reminding = on) } }
    }
}

/* ───── Search ───── */

data class SearchState(val query: String = "", val loading: Boolean = true, val results: List<Card> = emptyList(), val problem: String? = null)

class SearchViewModel(private val api: WatchApi) : ViewModel() {
    private val _state = MutableStateFlow(SearchState())
    val state: StateFlow<SearchState> = _state
    private var job: Job? = null
    init { run("", 0) }

    fun type(query: String) {
        _state.value = _state.value.copy(query = query, loading = true)
        run(query, 350)
    }

    private fun run(query: String, wait: Long) {
        job?.cancel()
        job = viewModelScope.launch {
            delay(wait)
            try { _state.value = _state.value.copy(loading = false, results = api.search(query.trim()).results, problem = null) }
            catch (e: Exception) { if (e is kotlinx.coroutines.CancellationException) throw e; _state.value = _state.value.copy(loading = false, problem = problemOf(e)) }
        }
    }
}

/* ───── A title page ───── */

data class TitleState(
    val loading: Boolean = true,
    val page: TitlePage? = null,
    /** The season shown in the episode list. */
    val season: Int? = null,
    val seasonLoading: Boolean = false,
    val more: List<Card>? = null,
    val problem: String? = null,
)

/**
 * The title page: Resume, the season tracker, My list, Rate, Skip fillers,
 * the seasons and their episodes, More like this.
 */
class TitleViewModel(private val api: WatchApi, private val toasts: Toasts, val id: String) : ViewModel() {
    private val _state = MutableStateFlow(TitleState())
    val state: StateFlow<TitleState> = _state

    init { refresh() }

    fun refresh() {
        viewModelScope.launch {
            try {
                val page = api.title(id, _state.value.season)
                _state.value = _state.value.copy(loading = false, page = page, season = page.season, problem = null)
                if (_state.value.more == null) loadMore(page)
            } catch (e: Exception) {
                _state.value = _state.value.copy(loading = false, problem = if (_state.value.page == null) problemOf(e) else null)
            }
        }
    }

    /* More like this: what Home shows on the same shelf (the API has no per-title recommendations). */
    private suspend fun loadMore(page: TitlePage) {
        val home = runCatching { api.home(page.title.shelf) }.getOrNull() ?: return
        val order = listOf("similar", "anime", "series", "films", "top")
        _state.value = _state.value.copy(more = order.flatMap { id -> home.rows.firstOrNull { it.id == id }?.items.orEmpty() }
            .filter { it.id != id }.distinctBy { it.id }.take(12))
    }

    fun season(number: Int) {
        if (number == _state.value.season) return
        _state.value = _state.value.copy(season = number, seasonLoading = true)
        viewModelScope.launch {
            try { _state.value = _state.value.copy(page = api.title(id, number), seasonLoading = false) }
            catch (e: Exception) { _state.value = _state.value.copy(seasonLoading = false); toasts.show(problemOf(e)) }
        }
    }

    /* A PUT answers with the season someone is on: keep the one on screen. */
    private fun keepSeason(fresh: TitlePage): TitlePage {
        val shown = _state.value.page ?: return fresh
        return keepFriends(if (fresh.season != shown.season) fresh.copy(season = shown.season, episodes = shown.episodes) else fresh)
    }

    /** A change's answer leaves friends out (only the page's own load asks for them), so the ones shown stay. */
    private fun keepFriends(fresh: TitlePage): TitlePage {
        val shown = _state.value.page ?: return fresh
        return fresh.copy(friends = fresh.friends.ifEmpty { shown.friends }, friendRatings = fresh.friendRatings.ifEmpty { shown.friendRatings })
    }

    /** This show by season or as one list ([value]), or back to the default (null): the episode list is laid out again. */
    fun episodes(value: String?) {
        val page = _state.value.page ?: return
        _state.value = _state.value.copy(page = page.copy(showEpisodes = value), seasonLoading = true)
        viewModelScope.launch {
            try {
                val fresh = keepFriends(api.showEpisodes(id, value))
                _state.value = _state.value.copy(page = fresh, season = fresh.season ?: _state.value.season, seasonLoading = false)
            } catch (e: Exception) {
                _state.value = _state.value.copy(page = page, seasonLoading = false); toasts.show(problemOf(e))
            }
        }
    }

    fun toggleList() {
        val page = _state.value.page ?: return
        val on = !page.inList
        _state.value = _state.value.copy(page = page.copy(inList = on))
        toasts.show(if (on) "Added to My list" else "Removed from My list")
        viewModelScope.launch { runCatching { api.mark(id, inList = on) }.onSuccess { _state.value = _state.value.copy(page = keepSeason(it)) } }
    }

    /** This title's own audio and subtitles, or back to the person's settings (null). */
    fun language(tracks: app.kimono.watch.model.TrackChoice?) {
        val page = _state.value.page ?: return
        val lang = page.language
        _state.value = _state.value.copy(page = page.copy(tracks = tracks, language = if (tracks != null && lang != null) lang.copy(audio = tracks.audio, subtitles = tracks.subtitles) else lang))
        viewModelScope.launch {
            runCatching { if (tracks == null) api.mark(id, clearTracks = true) else api.mark(id, tracks = tracks) }
                .onSuccess { _state.value = _state.value.copy(page = keepSeason(it)) }
                .onFailure { _state.value = _state.value.copy(page = page); toasts.show("That didn't work.") }
        }
    }

    fun rate(rating: String) {
        val page = _state.value.page ?: return
        val next = if (page.rating == rating) null else rating
        _state.value = _state.value.copy(page = page.copy(rating = next))
        toasts.show(when (next) { "down" -> "Got it. We'll show you less like this."; "up" -> "Thanks. Rated."; "love" -> "Love it. We'll find more."; else -> "Rating removed" })
        viewModelScope.launch { runCatching { if (next == null) api.mark(id, clearRating = true) else api.mark(id, rating = next) } }
    }

    fun remind() {
        val page = _state.value.page ?: return
        val on = !page.reminding
        _state.value = _state.value.copy(page = page.copy(reminding = on))
        toasts.show(if (on) "We'll let you know when it arrives" else "Reminder off")
        viewModelScope.launch { runCatching { api.mark(id, reminding = on) } }
    }

    /** The Skip fillers switch: the person's setting, for every show. */
    fun skipFillers(on: Boolean) {
        val page = _state.value.page ?: return
        _state.value = _state.value.copy(page = page.copy(fillers = if (on) "skip" else "watch"))
        toasts.show(if (on) "Fillers will be skipped" else "Fillers will play")
        viewModelScope.launch {
            runCatching { api.savePrefs(kotlinx.serialization.json.buildJsonObject { put("fillers", kotlinx.serialization.json.JsonPrimitive(if (on) "skip" else "watch")) }) }
            refresh()
        }
    }
}

/* ───── Settings ───── */

data class SettingsState(
    val loading: Boolean = true,
    /** This device's own quality, null when it follows the person's. */
    val quality: String? = null,
    /** On mobile data (phones), its own quality. */
    val cellQuality: String? = null,
    val prefs: app.kimono.watch.model.Prefs? = null,
)

/**
 * Settings: quality for this device (and for mobile data on a phone, kept
 * as a device of its own), and how playback behaves for the person.
 */
class SettingsViewModel(private val api: WatchApi, private val deviceId: String, private val cellular: Boolean) : ViewModel() {
    private val _state = MutableStateFlow(SettingsState())
    val state: StateFlow<SettingsState> = _state
    val cellId get() = "$deviceId.cell"

    init {
        viewModelScope.launch {
            runCatching {
                val mine = api.prefs(deviceId)
                val cell = if (cellular) api.prefs(cellId).device?.quality else null
                _state.value = SettingsState(false, mine.device?.quality, cell, mine)
            }.onFailure { _state.value = _state.value.copy(loading = false) }
        }
    }

    fun quality(value: String, cell: Boolean) {
        _state.value = if (cell) _state.value.copy(cellQuality = value) else _state.value.copy(quality = value)
        viewModelScope.launch { runCatching { api.deviceQuality(if (cell) cellId else deviceId, value) } }
    }

    /** Anime by season, or as one list numbered from the first episode. */
    fun animeEpisodes(value: String) {
        val prefs = _state.value.prefs ?: return
        _state.value = _state.value.copy(prefs = prefs.copy(animeEpisodes = value))
        viewModelScope.launch { runCatching { api.savePrefs(kotlinx.serialization.json.buildJsonObject { put("animeEpisodes", kotlinx.serialization.json.JsonPrimitive(value)) }) } }
    }

    fun toggle(key: String, on: Boolean) {
        val prefs = _state.value.prefs ?: return
        _state.value = _state.value.copy(prefs = when (key) { "skipIntros" -> prefs.copy(skipIntros = on); else -> prefs.copy(autoplayNext = on) })
        viewModelScope.launch { runCatching { api.savePrefs(kotlinx.serialization.json.buildJsonObject { put(key, kotlinx.serialization.json.JsonPrimitive(on)) }) } }
    }
}

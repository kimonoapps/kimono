package app.kimono.watch.ui

import app.kimono.watch.data.WatchApi
import app.kimono.watch.model.Prefs
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject

/**
 * The person's Watch preferences (PUT /api/v1/watch/prefs), one copy for the
 * whole app: Settings changes them, and the player, previews and downloads
 * read them. Every change shows at once and saves in the background.
 */
class PrefsStore(private val api: WatchApi) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private val _state = MutableStateFlow<Prefs?>(null)
    val state: StateFlow<Prefs?> = _state

    /** Read again for whoever is signed in now. */
    fun load() {
        scope.launch { runCatching { api.prefs() }.onSuccess { _state.value = it.copy(device = null) } }
    }

    fun clear() { _state.value = null }

    /** Changes one preference: [apply] shows it here, [key]/[value] save it. */
    fun set(key: String, value: Any, apply: (Prefs) -> Prefs) {
        _state.value?.let { _state.value = apply(it) }
        scope.launch {
            runCatching {
                api.savePrefs(buildJsonObject {
                    put(key, when (value) { is Boolean -> JsonPrimitive(value); is Number -> JsonPrimitive(value); else -> JsonPrimitive(value.toString()) })
                })
            }.onSuccess { _state.value = it.copy(device = null) }
        }
    }
}

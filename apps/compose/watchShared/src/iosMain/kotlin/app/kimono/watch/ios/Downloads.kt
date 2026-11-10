package app.kimono.watch.ios

import app.kimono.watch.DlState
import app.kimono.watch.WatchDownloads
import app.kimono.watch.data.WatchApi
import app.kimono.watch.dlKey
import app.kimono.watch.model.PlayAnswer
import app.kimono.watch.ui.Toasts
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import platform.Foundation.NSURL
import platform.Foundation.NSUserDefaults

@Serializable
private data class Kept(val answer: PlayAnswer, val name: String, val art: String? = null)

/**
 * Downloads for watching offline: the episode's file (asked of /play like any
 * play, so it's the version that suits this phone) fetched by a background
 * URLSession into the app's own storage, with the play answer kept beside it
 * so skip intro and the tracks work offline too.
 */
class IosDownloads(private val downloader: IosDownloader, private val api: WatchApi, private val toasts: Toasts) : WatchDownloads {
    private val json = Json { ignoreUnknownKeys = true }
    private val defaults = NSUserDefaults.standardUserDefaults
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private val _states = MutableStateFlow<Map<String, DlState>>(emptyMap())
    override val states: StateFlow<Map<String, DlState>> = _states
    private val _wifi = MutableStateFlow(defaults.boolForKey("dl.wifi"))
    override val wifiOnly: StateFlow<Boolean> = _wifi
    /** The person's preferences, for the download quality; set once the app's services exist. */
    var prefs: app.kimono.watch.ui.PrefsStore? = null

    override fun setWifiOnly(on: Boolean) {
        defaults.setBool(on, "dl.wifi")
        _wifi.value = on
        downloader.setCellular(!on)
    }

    @OptIn(kotlinx.cinterop.ExperimentalForeignApi::class)
    override fun usedBytes(): Long = _states.value.keys.sumOf { key ->
        val path = downloader.file(key) ?: return@sumOf 0L
        (platform.Foundation.NSFileManager.defaultManager.attributesOfItemAtPath(path, null)?.get(platform.Foundation.NSFileSize) as? Number)?.toLong() ?: 0L
    }

    override fun removeAll() {
        _states.value.keys.toList().forEach { key ->
            downloader.cancel(key)
            defaults.removeObjectForKey("dl.$key")
        }
        _states.value = emptyMap()
    }

    init {
        downloader.setCellular(!_wifi.value)
        _states.value = downloader.keys().filter { kept(it) != null }.associateWith { key ->
            if (downloader.file(key) != null) DlState(1f, true) else DlState(0f, false)
        }
        downloader.listen(object : IosDownloadEvents {
            override fun changed(key: String, progress: Double, done: Boolean, failed: Boolean) {
                _states.value = _states.value + (key to DlState(progress.toFloat(), done, failed))
            }
        })
    }

    private fun kept(key: String): Kept? = defaults.stringForKey("dl.$key")?.let { runCatching { json.decodeFromString(Kept.serializer(), it) }.getOrNull() }

    @OptIn(kotlinx.cinterop.ExperimentalForeignApi::class)
    override fun entries(): List<app.kimono.watch.DlEntry> = _states.value.keys.mapNotNull { key ->
        val (titleId, season, episode) = app.kimono.watch.dlParts(key) ?: return@mapNotNull null
        val k = kept(key)
        val size = downloader.file(key)?.let { (platform.Foundation.NSFileManager.defaultManager.attributesOfItemAtPath(it, null)?.get(platform.Foundation.NSFileSize) as? Number)?.toLong() }
        app.kimono.watch.DlEntry(titleId, season, episode, k?.name ?: titleId, k?.art, size ?: k?.answer?.version?.bytes)
    }

    override fun start(titleId: String, season: Int, episode: Int, name: String, art: String?) {
        val key = dlKey(titleId, season, episode)
        if (_states.value[key]?.done == true) return
        _states.value = _states.value + (key to DlState(0f, false))
        scope.launch {
            runCatching { api.play(titleId, season, episode, quality = app.kimono.watch.downloadQualityOf(prefs?.state?.value)) }.onSuccess { answer ->
                defaults.setObject(json.encodeToString(Kept.serializer(), Kept(answer, name, art)), "dl.$key")
                downloader.start(key, answer.url, answer.version?.bytes ?: 0L)
            }.onFailure {
                _states.value = _states.value - key
                toasts.show("That didn't download. Try again.")
            }
        }
    }

    override fun remove(titleId: String, season: Int, episode: Int) {
        val key = dlKey(titleId, season, episode)
        downloader.cancel(key)
        defaults.removeObjectForKey("dl.$key")
        _states.value = _states.value - key
    }

    /** The kept answer, pointed at the file on this phone. */
    override fun offline(titleId: String, season: Int, episode: Int): PlayAnswer? {
        val key = dlKey(titleId, season, episode)
        val path = downloader.file(key) ?: return null
        val answer = kept(key)?.answer ?: return null
        return answer.copy(url = NSURL.fileURLWithPath(path).absoluteString ?: return null)
    }
}

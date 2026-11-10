@file:OptIn(UnstableApi::class)

package app.kimono.watch.player

import android.app.Notification
import android.content.Context
import android.net.Uri
import androidx.annotation.OptIn
import androidx.media3.common.util.UnstableApi
import androidx.media3.database.StandaloneDatabaseProvider
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.cache.CacheDataSource
import androidx.media3.datasource.cache.NoOpCacheEvictor
import androidx.media3.datasource.cache.SimpleCache
import androidx.media3.datasource.okhttp.OkHttpDataSource
import androidx.media3.exoplayer.offline.Download
import androidx.media3.exoplayer.offline.DownloadManager
import androidx.media3.exoplayer.offline.DownloadNotificationHelper
import androidx.media3.exoplayer.offline.DownloadRequest
import androidx.media3.exoplayer.offline.DownloadService
import androidx.media3.exoplayer.scheduler.Requirements
import androidx.media3.exoplayer.scheduler.Scheduler
import app.kimono.watch.DlState
import app.kimono.watch.R
import app.kimono.watch.WatchDownloads
import app.kimono.watch.dlKey
import app.kimono.watch.model.PlayAnswer
import app.kimono.watch.watch
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import okhttp3.OkHttpClient
import java.io.File
import java.util.concurrent.Executors

@Serializable
private data class Kept(val answer: PlayAnswer, val name: String, val art: String? = null)

/**
 * Downloads for watching offline: the episode's stream (asked of /play like
 * any play, so it's the version that suits this device) saved whole in a
 * cache that the player reads before the network. The play answer is kept
 * beside it, so skip intro and the tracks work offline too.
 */
class Downloads(private val context: Context) : WatchDownloads {
    private val json = Json { ignoreUnknownKeys = true }
    val manager: DownloadManager by lazy {
        DownloadManager(context, database(context), cache(context), OkHttpDataSource.Factory(OkHttpClient()), Executors.newFixedThreadPool(2)).apply {
            maxParallelDownloads = 2
            requirements = Requirements(if (keep.getBoolean("dl.wifi", false)) Requirements.NETWORK_UNMETERED else Requirements.NETWORK)
            addListener(object : DownloadManager.Listener {
                override fun onDownloadChanged(downloadManager: DownloadManager, download: Download, finalException: Exception?) { publish() }
                override fun onDownloadRemoved(downloadManager: DownloadManager, download: Download) { publish() }
            })
        }
    }
    private val keep = context.getSharedPreferences("watch", Context.MODE_PRIVATE)
    private val _wifi = MutableStateFlow(keep.getBoolean("dl.wifi", false))
    override val wifiOnly: StateFlow<Boolean> = _wifi

    /** Waiting for Wi-Fi holds downloads (with the reason in their notification) until it's back. */
    override fun setWifiOnly(on: Boolean) {
        keep.edit().putBoolean("dl.wifi", on).apply()
        _wifi.value = on
        DownloadService.sendSetRequirements(context, WatchDownloadService::class.java, Requirements(if (on) Requirements.NETWORK_UNMETERED else Requirements.NETWORK), false)
    }

    override fun usedBytes(): Long = cache(context).cacheSpace

    override fun removeAll() = DownloadService.sendRemoveAllDownloads(context, WatchDownloadService::class.java, false)

    private val _states = MutableStateFlow<Map<String, DlState>>(emptyMap())
    override val states: StateFlow<Map<String, DlState>> = _states
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)

    init {
        scope.launch {
            publish()
            /* While anything is downloading, its percentage is read every second. */
            while (true) { delay(1000); if (manager.currentDownloads.isNotEmpty()) publish() }
        }
    }

    private fun publish() {
        val out = mutableMapOf<String, DlState>()
        manager.downloadIndex.getDownloads().use { c -> while (c.moveToNext()) out[c.download.request.id] = c.download.state() }
        manager.currentDownloads.forEach { out[it.request.id] = it.state() }
        _states.value = out
    }

    /* What each download was kept with, read once per download. */
    private val kept = mutableMapOf<String, Kept?>()
    private fun keptOf(d: Download): Kept? = kept.getOrPut(d.request.id) { runCatching { json.decodeFromString(Kept.serializer(), String(d.request.data)) }.getOrNull() }

    /** How far: by the file's length when the server says it, else by the size its listing gave. */
    private fun Download.state(): DlState {
        val expected = keptOf(this)?.answer?.version?.bytes ?: 0L
        val progress = when {
            percentDownloaded >= 0f -> percentDownloaded / 100f
            expected > 0 -> (bytesDownloaded.toFloat() / expected).coerceAtMost(0.99f)
            else -> 0f
        }
        return DlState(progress, state == Download.STATE_COMPLETED, state == Download.STATE_FAILED)
    }

    override fun entries(): List<app.kimono.watch.DlEntry> {
        val out = mutableListOf<app.kimono.watch.DlEntry>()
        manager.downloadIndex.getDownloads().use { c ->
            while (c.moveToNext()) {
                val d = c.download
                val (titleId, season, episode) = app.kimono.watch.dlParts(d.request.id) ?: continue
                val k = keptOf(d)
                val bytes = if (d.state == Download.STATE_COMPLETED) d.bytesDownloaded else d.contentLength.takeIf { it > 0 } ?: k?.answer?.version?.bytes
                out += app.kimono.watch.DlEntry(titleId, season, episode, k?.name ?: titleId, k?.art, bytes)
            }
        }
        return out
    }

    /** Downloads one episode (or a film, with season and episode 0). */
    override fun start(titleId: String, season: Int, episode: Int, name: String, art: String?) {
        val id = key(titleId, season, episode)
        if (_states.value[id]?.done == true) return
        _states.value = _states.value + (id to DlState(0f, false))
        scope.launch {
            runCatching { context.watch.api.play(titleId, season, episode, quality = app.kimono.watch.downloadQualityOf(context.watch.services.prefs.state.value)) }.onSuccess { answer ->
                val request = DownloadRequest.Builder(id, Uri.parse(answer.url)).setCustomCacheKey(id)
                    .setData(json.encodeToString(Kept.serializer(), Kept(answer, name, art)).toByteArray()).build()
                DownloadService.sendAddDownload(context, WatchDownloadService::class.java, request, false)
            }.onFailure {
                _states.value = _states.value - id
                context.watch.toasts.show("That didn't download. Try again.")
            }
        }
    }

    override fun remove(titleId: String, season: Int, episode: Int) =
        DownloadService.sendRemoveDownload(context, WatchDownloadService::class.java, key(titleId, season, episode), false)

    /** The play answer kept with a finished download, for playing it with no connection. */
    override fun offline(titleId: String, season: Int, episode: Int): PlayAnswer? {
        val d = manager.downloadIndex.getDownload(key(titleId, season, episode)) ?: return null
        if (d.state != Download.STATE_COMPLETED) return null
        return runCatching { json.decodeFromString(Kept.serializer(), String(d.request.data)).answer }.getOrNull()
    }

    companion object {
        fun key(titleId: String, season: Int, episode: Int) = dlKey(titleId, season, episode)
        private var cache: SimpleCache? = null
        private var db: StandaloneDatabaseProvider? = null
        @Synchronized fun database(context: Context) = db ?: StandaloneDatabaseProvider(context.applicationContext).also { db = it }
        @Synchronized fun cache(context: Context): SimpleCache = cache ?: SimpleCache(File(context.applicationContext.filesDir, "downloads"), NoOpCacheEvictor(), database(context)).also { cache = it }

        /** Playback reads downloads first and never writes to them. */
        fun readThrough(context: Context, upstream: DataSource.Factory): DataSource.Factory =
            CacheDataSource.Factory().setCache(cache(context)).setUpstreamDataSourceFactory(upstream).setCacheWriteDataSinkFactory(null)
                .setFlags(CacheDataSource.FLAG_IGNORE_CACHE_ON_ERROR)
    }
}

/** Keeps downloads going with the app closed, with a notification saying how far they've got. */
class WatchDownloadService : DownloadService(7, 1000, "downloads", R.string.downloads, 0) {
    private val helper by lazy { DownloadNotificationHelper(this, "downloads") }
    override fun getDownloadManager(): DownloadManager = watch.downloads.manager
    override fun getScheduler(): Scheduler? = null
    override fun getForegroundNotification(downloads: MutableList<Download>, notMetRequirements: Int): Notification =
        helper.buildProgressNotification(this, R.drawable.ic_stat_watch, null, if (downloads.size == 1) "Downloading" else "Downloading ${downloads.size} episodes", downloads, notMetRequirements)
}

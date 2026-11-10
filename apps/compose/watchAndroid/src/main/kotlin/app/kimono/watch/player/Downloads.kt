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
private data class Kept(val answer: PlayAnswer, val name: String)

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
            addListener(object : DownloadManager.Listener {
                override fun onDownloadChanged(downloadManager: DownloadManager, download: Download, finalException: Exception?) { publish() }
                override fun onDownloadRemoved(downloadManager: DownloadManager, download: Download) { publish() }
            })
        }
    }
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

    private fun Download.state() = DlState((percentDownloaded.coerceAtLeast(0f) / 100f), state == Download.STATE_COMPLETED, state == Download.STATE_FAILED)

    /** Downloads one episode (or a film, with season and episode 0). */
    override fun start(titleId: String, season: Int, episode: Int, name: String) {
        val id = key(titleId, season, episode)
        if (_states.value[id]?.done == true) return
        _states.value = _states.value + (id to DlState(0f, false))
        scope.launch {
            runCatching { context.watch.api.play(titleId, season, episode) }.onSuccess { answer ->
                val request = DownloadRequest.Builder(id, Uri.parse(answer.url)).setCustomCacheKey(id)
                    .setData(json.encodeToString(Kept.serializer(), Kept(answer, name)).toByteArray()).build()
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

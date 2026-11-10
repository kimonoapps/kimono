package app.kimono.watch.player

import android.graphics.Bitmap
import android.media.MediaMetadataRetriever
import android.os.Build
import android.util.LruCache
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import app.kimono.watch.Thumbnails
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/**
 * The scrubber's thumbnails: frames read from the stream itself, ten
 * seconds apart, a few at a time while someone drags. (The API has no
 * storyboard yet; this reads a frame over the relay, so the first look at a
 * spot takes a moment and the episode's still stands in meanwhile.)
 */
class Thumbs(private val url: String) : Thumbnails {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val cache = LruCache<Int, Bitmap>(60)
    private val lock = Mutex()
    private var retriever: MediaMetadataRetriever? = null
    private var job: Job? = null
    private val _frame = MutableStateFlow<Pair<Int, ImageBitmap>?>(null)
    override val frame: StateFlow<Pair<Int, ImageBitmap>?> = _frame
    @Volatile private var broken = false

    override fun want(seconds: Double) {
        val slot = (seconds / 10).toInt()
        cache.get(slot)?.let { _frame.value = slot to it.asImageBitmap(); return }
        if (broken) return
        job?.cancel()
        job = scope.launch {
            delay(140)
            lock.withLock {
                val r = retriever ?: runCatching { MediaMetadataRetriever().apply { setDataSource(url, emptyMap()) } }.getOrNull().also { retriever = it }
                if (r == null) { broken = true; return@launch }
                val us = slot * 10_000_000L + 5_000_000L
                val bmp = runCatching {
                    if (Build.VERSION.SDK_INT >= 27) r.getScaledFrameAtTime(us, MediaMetadataRetriever.OPTION_CLOSEST_SYNC, 320, 180) else r.getFrameAtTime(us, MediaMetadataRetriever.OPTION_CLOSEST_SYNC)
                }.getOrNull() ?: return@launch
                cache.put(slot, bmp)
                _frame.value = slot to bmp.asImageBitmap()
            }
        }
    }

    override fun close() {
        scope.launch { lock.withLock { runCatching { retriever?.release() }; retriever = null } }.invokeOnCompletion { scope.cancel() }
    }
}

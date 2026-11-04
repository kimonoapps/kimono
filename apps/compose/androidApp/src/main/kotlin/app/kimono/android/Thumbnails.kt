package app.kimono.android

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import android.graphics.ImageDecoder
import android.graphics.Matrix
import android.graphics.pdf.PdfRenderer
import android.media.ExifInterface
import android.media.MediaDataSource
import android.media.MediaMetadataRetriever
import android.os.Build
import android.os.ParcelFileDescriptor
import app.kimono.data.Drive
import app.kimono.data.DriveNode
import app.kimono.data.KimonoProblem
import app.kimono.data.OFFLINE
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import java.io.ByteArrayInputStream
import java.io.File
import java.io.IOException
import java.nio.ByteBuffer

/**
 * Reads a file on Kimono at any offset, fetching it in ranged pieces and
 * keeping the last few. Blocking: for callers that can't suspend (the
 * system reading a file through Kimono, a video's frame grabber).
 */
internal class RangedReader(private val drive: Drive, private val node: DriveNode, private val piece: Int = 4 * 1024 * 1024, keep: Int = 4) {
    private val pieces = object : LinkedHashMap<Long, ByteArray>(8, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<Long, ByteArray>?) = size > keep
    }

    val size get() = node.size

    /** Copies up to [count] bytes from [offset] into [data] at [at]; fewer only at the end of the file. */
    @Synchronized
    fun read(offset: Long, data: ByteArray, at: Int, count: Int): Int {
        var done = 0
        while (done < count && offset + done < node.size) {
            val position = offset + done
            val index = position / piece
            val bytes = pieces[index] ?: fetch(index)
            val within = (position - index * piece).toInt()
            if (within >= bytes.size) break
            val take = minOf(count - done, bytes.size - within)
            System.arraycopy(bytes, within, data, at + done, take)
            done += take
        }
        return done
    }

    @Synchronized
    fun clear() = pieces.clear()

    private fun fetch(index: Long): ByteArray {
        val start = index * piece
        val length = minOf(piece.toLong(), node.size - start).toInt()
        val bytes = try {
            runBlocking(Dispatchers.IO) { fetchWithRetries(start, length) }
        } catch (problem: Exception) {
            throw IOException(problem.message, problem)
        }
        pieces[index] = bytes
        return bytes
    }

    /** A dropped connection gets a few quick tries before the reader hears about it. */
    private suspend fun fetchWithRetries(start: Long, length: Int): ByteArray {
        var tries = 0
        while (true) {
            try {
                return drive.read(node.id, start, length)
            } catch (problem: KimonoProblem) {
                if (problem.message != OFFLINE || ++tries > 3) throw problem
                delay(1_000L * tries)
            }
        }
    }
}

/**
 * Thumbnails for the Files app, made on the phone and kept per version:
 * photos from the preview cameras tuck into the first few KB where there
 * is one, videos from a frame read in place, PDFs from their first page.
 */
internal class Thumbnails(context: Context, private val drive: Drive) {
    private val dir = File(context.cacheDir, "thumbs").apply { mkdirs() }
    /* The Files app asks for a screenful at once: a few at a time is kinder to the connection. */
    private val gate = Semaphore(3)
    /* Versions that couldn't be made (an unplayable video, a damaged photo): not tried again while Kimono runs. */
    private val failed = java.util.concurrent.ConcurrentHashMap.newKeySet<String>()

    companion object {
        private const val MAX_IMAGE = 40L * 1024 * 1024
        private const val MAX_PDF = 20L * 1024 * 1024
        private const val HEAD = 256 * 1024

        fun canMake(node: DriveNode, mime: String): Boolean = !node.isFolder && node.size > 0 && when {
            mime.startsWith("image/") -> node.size <= MAX_IMAGE
            mime.startsWith("video/") -> true
            mime == "application/pdf" -> node.size <= MAX_PDF
            else -> false
        }
    }

    /** A JPEG at least [wanted] pixels on its longer side (where the original is that big), or null. */
    suspend fun make(node: DriveNode, mime: String, wanted: Int): File? {
        val edge = when { wanted <= 256 -> 256; wanted <= 512 -> 512; else -> 1024 }
        val target = File(dir, "${node.id}-${node.contentVersion}-$edge.jpg")
        if (target.length() > 0) return target
        val version = "${node.id}-${node.contentVersion}"
        if (version in failed) return null
        return gate.withPermit {
            if (target.length() > 0) return@withPermit target
            val made = runCatching {
                when {
                    mime.startsWith("image/") -> image(node, edge)
                    mime.startsWith("video/") -> video(node, edge)
                    mime == "application/pdf" -> pdf(node, edge)
                    else -> null
                }
            }
            /* Offline isn't the file's fault: that one is tried again. */
            val offline = made.exceptionOrNull().let { it is KimonoProblem || it is IOException }
            val bitmap = made.getOrNull() ?: run { if (!offline) failed += version; return@withPermit null }
            val partial = File(dir, "${target.name}.part")
            partial.outputStream().use { bitmap.compress(Bitmap.CompressFormat.JPEG, 85, it) }
            bitmap.recycle()
            partial.renameTo(target)
            target
        }
    }

    private suspend fun image(node: DriveNode, edge: Int): Bitmap? {
        val head = drive.read(node.id, 0, minOf(node.size, HEAD.toLong()).toInt())
        /* Cameras keep a small preview near the start: often enough for a list. */
        runCatching {
            val exif = ExifInterface(ByteArrayInputStream(head))
            val preview = if (exif.hasThumbnail()) exif.thumbnailBitmap else null
            if (preview != null && maxOf(preview.width, preview.height) * 2 >= edge) return upright(preview, exif)
        }
        val whole = if (head.size.toLong() == node.size) head else drive.read(node.id, 0, node.size.toInt())
        if (Build.VERSION.SDK_INT >= 28) {
            /* Turns the photo the way it was taken, and reads HEIC too. */
            return ImageDecoder.decodeBitmap(ImageDecoder.createSource(ByteBuffer.wrap(whole))) { decoder, info, _ ->
                val longer = maxOf(info.size.width, info.size.height)
                if (longer > edge) decoder.setTargetSize(info.size.width * edge / longer, info.size.height * edge / longer)
                decoder.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
            }
        }
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(whole, 0, whole.size, bounds)
        var sample = 1
        while (maxOf(bounds.outWidth, bounds.outHeight) / (sample * 2) >= edge) sample *= 2
        val bitmap = BitmapFactory.decodeByteArray(whole, 0, whole.size, BitmapFactory.Options().apply { inSampleSize = sample }) ?: return null
        return upright(bitmap, runCatching { ExifInterface(ByteArrayInputStream(whole)) }.getOrNull())
    }

    private fun upright(bitmap: Bitmap, exif: ExifInterface?): Bitmap {
        val degrees = when (exif?.getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)) {
            ExifInterface.ORIENTATION_ROTATE_90 -> 90f
            ExifInterface.ORIENTATION_ROTATE_180 -> 180f
            ExifInterface.ORIENTATION_ROTATE_270 -> 270f
            else -> return bitmap
        }
        return Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, Matrix().apply { postRotate(degrees) }, true)
    }

    private fun video(node: DriveNode, edge: Int): Bitmap? {
        /* Small pieces: a frame needs the file's index and a little of its start, not the whole video. */
        val reader = RangedReader(drive, node, piece = 1024 * 1024, keep = 8)
        val retriever = MediaMetadataRetriever()
        var dropped: IOException? = null
        try {
            retriever.setDataSource(object : MediaDataSource() {
                override fun readAt(position: Long, buffer: ByteArray, offset: Int, size: Int): Int {
                    if (position >= reader.size) return -1
                    return try { reader.read(position, buffer, offset, size) } catch (problem: IOException) { dropped = problem; -1 }
                }
                override fun getSize() = reader.size
                override fun close() = reader.clear()
            })
            val frame = if (Build.VERSION.SDK_INT >= 27) {
                retriever.getScaledFrameAtTime(1_000_000, MediaMetadataRetriever.OPTION_CLOSEST_SYNC, edge, edge)
                    ?: retriever.getScaledFrameAtTime(0, MediaMetadataRetriever.OPTION_CLOSEST_SYNC, edge, edge)
            } else {
                retriever.getFrameAtTime(1_000_000, MediaMetadataRetriever.OPTION_CLOSEST_SYNC)?.let { scaled(it, edge) }
            }
            /* No frame because the connection dropped: say so, so it's tried again. */
            dropped?.let { if (frame == null) throw it }
            return frame
        } finally {
            retriever.release()
        }
    }

    private suspend fun pdf(node: DriveNode, edge: Int): Bitmap? {
        val copy = File(dir, "${node.id}.pdf.part")
        try {
            copy.writeBytes(drive.read(node.id, 0, node.size.toInt()))
            ParcelFileDescriptor.open(copy, ParcelFileDescriptor.MODE_READ_ONLY).use { descriptor ->
                PdfRenderer(descriptor).use { renderer ->
                    if (renderer.pageCount == 0) return null
                    renderer.openPage(0).use { page ->
                        val scale = edge.toFloat() / maxOf(page.width, page.height)
                        val bitmap = Bitmap.createBitmap((page.width * scale).toInt().coerceAtLeast(1), (page.height * scale).toInt().coerceAtLeast(1), Bitmap.Config.ARGB_8888)
                        bitmap.eraseColor(Color.WHITE)
                        page.render(bitmap, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
                        return bitmap
                    }
                }
            }
        } finally {
            copy.delete()
        }
    }

    private fun scaled(bitmap: Bitmap, edge: Int): Bitmap {
        val longer = maxOf(bitmap.width, bitmap.height)
        if (longer <= edge) return bitmap
        return Bitmap.createScaledBitmap(bitmap, bitmap.width * edge / longer, bitmap.height * edge / longer, true)
    }
}

@file:OptIn(ExperimentalForeignApi::class)

package app.kimono.ios

import androidx.compose.ui.window.ComposeUIViewController
import app.kimono.KimonoApp
import app.kimono.data.PickedFile
import app.kimono.data.DriveNode
import app.kimono.data.UploadStatus
import app.kimono.data.Uploads
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import app.kimono.data.Platform
import app.kimono.data.Session
import io.ktor.client.HttpClient
import io.ktor.client.engine.darwin.Darwin
import kotlinx.cinterop.ExperimentalForeignApi
import kotlinx.cinterop.addressOf
import kotlinx.cinterop.usePinned
import kotlinx.coroutines.suspendCancellableCoroutine
import platform.Foundation.NSData
import platform.Foundation.NSDate
import platform.Foundation.NSTimeZone
import platform.Foundation.dateWithTimeIntervalSince1970
import platform.Foundation.localTimeZone
import platform.Foundation.create
import platform.UIKit.UIViewController
import platform.posix.memcpy
import kotlin.coroutines.resume

/**
 * What the iPhone shell (iosApp/, in Swift) does for the shared app: the
 * Keychain, the sign-in sheet, the photo picker. Plain callbacks, so Swift
 * implements it without touching coroutines.
 */
interface IosHost {
    /** A value kept in the Keychain, shared with the Files app extension. */
    fun readKept(key: String): String?
    fun keep(key: String, value: String?)
    fun randomBytes(count: Int): NSData
    fun sha256(data: NSData): NSData
    /** Opens the sign-in page in ASWebAuthenticationSession; [done] gets the return address, or null if closed. */
    fun openSignIn(url: String, redirect: String, done: (String?) -> Unit)
    /** A photo from the picker, squared to a 512×512 PNG, or null. */
    fun pickPicture(done: (NSData?) -> Unit)
    fun openUrl(url: String)
    fun cacheDir(): String
    /** Shows a downloaded file in Quick Look, with its share button. */
    fun openFile(path: String)
    /** The app's build number (CFBundleVersion). */
    fun appBuild(): Long
    /** The share sheet, with a link or some text. */
    fun share(text: String)
    fun driveAvailable(on: Boolean)
    /** Files from the document picker, copied somewhere the app can read. */
    fun pickFiles(done: (List<IosPickedFile>) -> Unit)
    /** Up to [max] bytes of the file at [path], from [offset]. */
    fun readFile(path: String, offset: Long, max: Int): NSData
    /** Hands a picked file to iOS's background uploads; the file is moved, not copied. */
    fun startUpload(name: String, path: String, size: Long, folderId: String)
    fun dismissUpload(id: String)
    fun retryUpload(id: String)
    fun observeUploads(callback: (List<IosUploadStatus>) -> Unit)
    /** A thumbnail's local path, from the thumbnails the Files app shares; null when there can't be one. */
    fun thumbnail(id: String, contentVersion: Long, name: String, mime: String?, size: Long, pixels: Long, done: (String?) -> Unit)
    /** A frame of the local video at [path], saved as a JPEG, and how long the video runs; null when AVFoundation can't. */
    fun videoFrame(path: String, pixels: Long, done: (IosVideoFrame?) -> Unit)
}

/** A video's poster, as the Swift side makes it: where the JPEG is, and the length in seconds (0 when unknown). */
class IosVideoFrame(val path: String, val seconds: Double)

/** An upload's state, as the Swift uploader reports it. */
class IosUploadStatus(val id: String, val name: String, val size: Long, val sent: Long, val folderId: String, val waiting: Boolean, val failed: String?, val done: Boolean)

private class IosUploads(private val host: IosHost) : Uploads {
    private val state = MutableStateFlow<List<UploadStatus>>(emptyList())
    override val statuses: StateFlow<List<UploadStatus>> = state

    init {
        host.observeUploads { list ->
            state.value = list.map { UploadStatus(it.id, it.name, it.size, it.sent, it.folderId, it.waiting, it.failed, it.done) }
        }
    }

    override fun start(files: List<PickedFile>, folderId: String) {
        files.filterIsInstance<IosFile>().forEach { host.startUpload(it.name, it.path, it.size, folderId) }
    }

    override fun dismiss(id: String) = host.dismissUpload(id)

    override fun retry(id: String) = host.retryUpload(id)
}

private class IosFile(val path: String, override val name: String, override val size: Long, override val mimeType: String?, private val host: IosHost) : PickedFile {
    override suspend fun read(offset: Long, max: Int) = host.readFile(path, offset, max).toByteArray()
}

/** A file the person picked on iPhone; the Swift side fills it in. */
class IosPickedFile(val name: String, val path: String, val size: Long, val mimeType: String?)

private class IosPlatform(private val host: IosHost) : Platform {
    override suspend fun readKept(key: String) = host.readKept(key)
    override suspend fun keep(key: String, value: String?) = host.keep(key, value)
    override fun randomBytes(count: Int) = host.randomBytes(count).toByteArray()
    override fun sha256(bytes: ByteArray) = host.sha256(bytes.toNSData()).toByteArray()
    override suspend fun openSignIn(url: String, redirect: String): String? =
        suspendCancellableCoroutine { waiting -> host.openSignIn(url, redirect) { waiting.resume(it) } }
    override suspend fun pickPicture(): ByteArray? =
        suspendCancellableCoroutine { waiting -> host.pickPicture { waiting.resume(it?.toByteArray()) } }
    override val os = "ios"
    override fun openUrl(url: String) = host.openUrl(url)
    override fun cacheDir() = host.cacheDir()
    override fun openFile(path: String, mimeType: String?) = host.openFile(path)
    override fun share(text: String) = host.share(text)
    override fun driveAvailable(on: Boolean) = host.driveAvailable(on)
    override val reduceMotion: Boolean get() = platform.UIKit.UIAccessibilityIsReduceMotionEnabled()
    override fun utcOffsetMillis(at: Long): Long =
        NSTimeZone.localTimeZone.secondsFromGMTForDate(NSDate.dateWithTimeIntervalSince1970(at / 1000.0)) * 1000L
    override val build: Long get() = host.appBuild()
    override suspend fun pickFiles(): List<PickedFile> =
        suspendCancellableCoroutine<List<IosPickedFile>> { waiting -> host.pickFiles { waiting.resume(it) } }
            .map { IosFile(it.path, it.name, it.size, it.mimeType, host) }
    override val uploads: Uploads = IosUploads(host)
    @androidx.compose.runtime.Composable
    override fun WebFrame(url: String, modifier: androidx.compose.ui.Modifier, control: app.kimono.data.WebFrameControl?, keepLinks: Boolean, onMessage: (String) -> Unit, onLoaded: () -> Unit) =
        IosWebFrame(url, modifier, control, keepLinks, ::openUrl, onMessage, onLoaded)
    override suspend fun thumbnail(node: DriveNode, pixels: Int): String? = suspendCancellableCoroutine { waiting ->
        host.thumbnail(node.id, node.contentVersion.toLong(), node.name, node.mime, node.size, pixels.toLong()) { waiting.resume(it) }
    }
    override suspend fun videoFrame(path: String, pixels: Int): app.kimono.data.VideoFrame? {
        val made = suspendCancellableCoroutine<IosVideoFrame?> { waiting -> host.videoFrame(path, pixels.toLong()) { waiting.resume(it) } } ?: return null
        val picture = host.readFile(made.path, 0, 8 * 1024 * 1024).toByteArray()
        return if (picture.isEmpty()) null else app.kimono.data.VideoFrame(picture, made.seconds.takeIf { it > 0 })
    }
}

fun NSData.toByteArray(): ByteArray = ByteArray(length.toInt()).also { out ->
    if (out.isNotEmpty()) out.usePinned { memcpy(it.addressOf(0), this.bytes, length) }
}

fun ByteArray.toNSData(): NSData = usePinned { NSData.create(bytes = it.addressOf(0), length = size.toULong()) }

/** The whole app, for the Swift shell to put on screen. */
fun MainViewController(host: IosHost): UIViewController {
    val platform = IosPlatform(host)
    val session = Session(platform, HttpClient(Darwin) { followRedirects = true })
    return ComposeUIViewController { KimonoApp(session, platform, null) {} }
}

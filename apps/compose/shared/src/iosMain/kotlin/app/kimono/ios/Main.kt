@file:OptIn(ExperimentalForeignApi::class)

package app.kimono.ios

import androidx.compose.ui.window.ComposeUIViewController
import app.kimono.KimonoApp
import app.kimono.data.PickedFile
import app.kimono.data.Platform
import app.kimono.data.Session
import io.ktor.client.HttpClient
import io.ktor.client.engine.darwin.Darwin
import kotlinx.cinterop.ExperimentalForeignApi
import kotlinx.cinterop.addressOf
import kotlinx.cinterop.usePinned
import kotlinx.coroutines.suspendCancellableCoroutine
import platform.Foundation.NSData
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
    /** Files from the document picker, copied somewhere the app can read. */
    fun pickFiles(done: (List<IosPickedFile>) -> Unit)
    /** Up to [max] bytes of the file at [path], from [offset]. */
    fun readFile(path: String, offset: Long, max: Int): NSData
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
    override suspend fun pickFiles(): List<PickedFile> =
        suspendCancellableCoroutine<List<IosPickedFile>> { waiting -> host.pickFiles { waiting.resume(it) } }.map { picked ->
            object : PickedFile {
                override val name = picked.name
                override val size = picked.size
                override val mimeType = picked.mimeType
                override suspend fun read(offset: Long, max: Int) = host.readFile(picked.path, offset, max).toByteArray()
            }
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

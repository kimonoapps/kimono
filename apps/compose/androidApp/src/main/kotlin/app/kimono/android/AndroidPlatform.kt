package app.kimono.android

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.ImageDecoder
import android.net.Uri
import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import androidx.browser.customtabs.CustomTabsIntent
import app.kimono.data.PickedFile
import app.kimono.data.Platform
import android.content.Intent
import android.provider.OpenableColumns
import androidx.core.content.FileProvider
import java.io.File
import java.io.FileInputStream
import java.nio.ByteBuffer
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.ByteArrayOutputStream
import java.security.KeyStore
import java.security.MessageDigest
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * The Android half of [Platform]. Kept values are encrypted with an AES key
 * that never leaves the Android Keystore; the sign-in page opens in a Custom
 * Tab; photos come from the system photo picker.
 */
class AndroidPlatform(private val context: Context) : Platform {
    private val prefs = context.getSharedPreferences("kimono", Context.MODE_PRIVATE)
    private var signIn: CompletableDeferred<String?>? = null
    var launchPicker: (() -> Unit)? = null
    /** The activity on screen, so the browser sheet opens over it rather than in a new task. */
    var activity: android.app.Activity? = null
    private var picking: CompletableDeferred<Uri?>? = null

    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getEntry("kimono-kept", null) as? KeyStore.SecretKeyEntry)?.let { return it.secretKey }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
            init(KeyGenParameterSpec.Builder("kimono-kept", KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .build())
        }.generateKey()
    }

    override suspend fun readKept(key: String): String? = withContext(Dispatchers.IO) {
        val stored = prefs.getString(key, null) ?: return@withContext null
        runCatching {
            val bytes = Base64.decode(stored, Base64.NO_WRAP)
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, bytes, 0, 12))
            String(cipher.doFinal(bytes, 12, bytes.size - 12))
        }.getOrNull()
    }

    override suspend fun keep(key: String, value: String?) = withContext(Dispatchers.IO) {
        if (value == null) { prefs.edit().remove(key).commit(); return@withContext }
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key())
        val sealed = cipher.iv + cipher.doFinal(value.toByteArray())
        prefs.edit().putString(key, Base64.encodeToString(sealed, Base64.NO_WRAP)).commit()
    }

    override fun randomBytes(count: Int) = ByteArray(count).also { SecureRandom().nextBytes(it) }
    override fun sha256(bytes: ByteArray): ByteArray = MessageDigest.getInstance("SHA-256").digest(bytes)

    override suspend fun openSignIn(url: String, redirect: String): String? {
        val waiting = CompletableDeferred<String?>()
        signIn = waiting
        val tab = CustomTabsIntent.Builder().setShowTitle(true).build()
        val host = activity
        if (host != null) tab.launchUrl(host, Uri.parse(url))
        else tab.apply { intent.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK) }.launchUrl(context, Uri.parse(url))
        return waiting.await().also { signIn = null }
    }

    /** The browser sheet came back to kimono://auth. */
    fun signInReturned(uri: Uri) { signIn?.complete(uri.toString()) }
    /** The activity came back to the front without a return: the sheet was closed. */
    fun signInMaybeAbandoned() { signIn?.complete(null) }
    val signingIn get() = signIn != null

    override suspend fun pickPicture(): ByteArray? {
        val waiting = CompletableDeferred<Uri?>()
        picking = waiting
        launchPicker?.invoke() ?: return null
        val uri = waiting.await() ?: return null
        return squarePicture(uri)
    }

    fun picked(uri: Uri?) { picking?.complete(uri); picking = null }

    override val os = "android"

    override val uploads: app.kimono.data.Uploads by lazy { AndroidUploads(context) }

    override suspend fun thumbnail(node: app.kimono.data.DriveNode, pixels: Int): String? = withContext(Dispatchers.IO) {
        val mime = node.mime ?: android.webkit.MimeTypeMap.getSingleton().getMimeTypeFromExtension(node.name.substringAfterLast('.', "").lowercase()) ?: return@withContext null
        if (!Thumbnails.canMake(node, mime)) return@withContext null
        runCatching { (context.applicationContext as KimonoApplication).thumbnails.make(node, mime, pixels)?.absolutePath }.getOrNull()
    }

    override suspend fun videoFrame(path: String, pixels: Int): app.kimono.data.VideoFrame? = withContext(Dispatchers.IO) {
        val retriever = android.media.MediaMetadataRetriever()
        try {
            retriever.setDataSource(path)
            val seconds = retriever.extractMetadata(android.media.MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull()?.let { it / 1000.0 }
            /* Half a second in: the very first frame is often black. */
            val frame = (if (android.os.Build.VERSION.SDK_INT >= 27) retriever.getScaledFrameAtTime(500_000, android.media.MediaMetadataRetriever.OPTION_CLOSEST_SYNC, pixels, pixels)
                else retriever.getFrameAtTime(500_000, android.media.MediaMetadataRetriever.OPTION_CLOSEST_SYNC)) ?: return@withContext null
            val out = java.io.ByteArrayOutputStream()
            frame.compress(android.graphics.Bitmap.CompressFormat.JPEG, 82, out)
            app.kimono.data.VideoFrame(out.toByteArray(), seconds)
        } catch (_: Exception) {
            null
        } finally {
            runCatching { retriever.release() }
        }
    }

    override fun installedVersion(packageId: String): String? =
        runCatching { context.packageManager.getPackageInfo(packageId, 0).versionName }.getOrNull()

    override suspend fun installApp(url: String, packageId: String, sha256: String, progress: (Float) -> Unit): String? = SelfUpdate.install(context, url, sha256, progress, packageId)

    override fun isInstalled(packageId: String): Boolean? =
        runCatching { context.packageManager.getPackageInfo(packageId, 0); true }.getOrDefault(false)

    override fun openInstalled(packageId: String): Boolean {
        val intent = context.packageManager.getLaunchIntentForPackage(packageId) ?: return false
        if (activity == null) intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        return runCatching { (activity ?: context).startActivity(intent) }.isSuccess
    }

    override fun openUrl(url: String) {
        val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url))
        if (activity == null) intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        (activity ?: context).startActivity(intent)
    }

    override fun cacheDir(): String = context.cacheDir.absolutePath

    /** Hands the file to whichever app opens its type, through Kimono's FileProvider. */
    override fun openFile(path: String, mimeType: String?) {
        val uri = FileProvider.getUriForFile(context, "${context.packageName}.files", File(path))
        val intent = Intent(Intent.ACTION_VIEW).setDataAndType(uri, mimeType ?: context.contentResolver.getType(uri) ?: "*/*")
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        val chooser = Intent.createChooser(intent, null)
        if (activity == null) chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        (activity ?: context).startActivity(chooser)
    }

    override val build: Long get() = SelfUpdate.build(context)

    override suspend fun installUpdate(url: String, sha256: String?, progress: (Float) -> Unit): String? = SelfUpdate.install(context, url, sha256, progress)

    override fun driveAvailable(on: Boolean) {
        if (prefs.getBoolean(KimonoDocuments.DRIVE_ON, true) == on) return
        prefs.edit().putBoolean(KimonoDocuments.DRIVE_ON, on).apply()
        KimonoDocuments.rootsChanged(context)
    }

    /** A WebView, its JavaScript bridge as KimonoNative; links leave for the browser unless [keepLinks]. */
    @androidx.compose.runtime.Composable
    override fun WebFrame(url: String, modifier: androidx.compose.ui.Modifier, control: app.kimono.data.WebFrameControl?, keepLinks: Boolean, onMessage: (String) -> Unit, onLoaded: () -> Unit) {
        val heard = androidx.compose.runtime.rememberUpdatedState(onMessage)
        val loaded = androidx.compose.runtime.rememberUpdatedState(onLoaded)
        androidx.compose.ui.viewinterop.AndroidView(
            modifier = modifier,
            factory = { context ->
                android.webkit.WebView(context).apply {
                    setBackgroundColor(android.graphics.Color.TRANSPARENT)
                    settings.javaScriptEnabled = true
                    settings.domStorageEnabled = keepLinks
                    settings.mediaPlaybackRequiresUserGesture = false
                    if (control?.scrolls == false) { isVerticalScrollBarEnabled = false; overScrollMode = android.view.View.OVER_SCROLL_NEVER; isNestedScrollingEnabled = false }
                    val main = android.os.Handler(android.os.Looper.getMainLooper())
                    addJavascriptInterface(object {
                        @android.webkit.JavascriptInterface fun post(text: String) { main.post { heard.value(text) } }
                    }, "KimonoNative")
                    val first = android.net.Uri.parse(url)
                    webViewClient = object : android.webkit.WebViewClient() {
                        override fun onPageFinished(view: android.webkit.WebView, address: String?) { loaded.value() }
                        override fun shouldOverrideUrlLoading(view: android.webkit.WebView, request: android.webkit.WebResourceRequest): Boolean {
                            val to = request.url
                            if (to.toString().substringBefore('#') == url.substringBefore('#') || (keepLinks && to.host == first.host)) return false
                            if (to.scheme == "http" || to.scheme == "https" || to.scheme == "mailto") openUrl(to.toString())
                            return true
                        }
                    }
                    control?.run = { script -> main.post { evaluateJavascript(script, null) } }
                    loadUrl(url)
                }
            },
            onRelease = { view -> control?.run = null; view.destroy() },
        )
    }

    override val reduceMotion: Boolean get() =
        android.provider.Settings.Global.getFloat(context.contentResolver, android.provider.Settings.Global.ANIMATOR_DURATION_SCALE, 1f) == 0f
    override fun utcOffsetMillis(at: Long): Long = java.util.TimeZone.getDefault().getOffset(at).toLong()

    override fun share(text: String) {
        val send = Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, text)
        val chooser = Intent.createChooser(send, null)
        if (activity == null) chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        (activity ?: context).startActivity(chooser)
    }

    var launchFilePicker: (() -> Unit)? = null
    private var pickingFiles: CompletableDeferred<List<Uri>>? = null

    override suspend fun pickFiles(): List<PickedFile> {
        val waiting = CompletableDeferred<List<Uri>>()
        pickingFiles = waiting
        launchFilePicker?.invoke() ?: return emptyList()
        return waiting.await().mapNotNull { pickedFile(it) }
    }

    fun filesPicked(uris: List<Uri>) {
        /* Keep read access after the app closes, so a background upload can carry on reading. */
        uris.forEach { runCatching { context.contentResolver.takePersistableUriPermission(it, Intent.FLAG_GRANT_READ_URI_PERMISSION) } }
        pickingFiles?.complete(uris)
        pickingFiles = null
    }

    /** A shared or picked file, read straight from its provider a piece at a time. */
    fun pickedFile(uri: Uri): PickedFile? {
        var name = "File"
        var size = -1L
        context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use { cursor ->
            if (cursor.moveToFirst()) {
                cursor.getString(0)?.let { name = it }
                if (!cursor.isNull(1)) size = cursor.getLong(1)
            }
        }
        if (size < 0) size = context.contentResolver.openFileDescriptor(uri, "r")?.use { it.statSize } ?: return null
        val type = context.contentResolver.getType(uri)
        val resolver = context.contentResolver
        return object : UriFile {
            override val uri = uri
            override val name = name
            override val size = size
            override val mimeType = type
            override suspend fun read(offset: Long, max: Int): ByteArray = withContext(Dispatchers.IO) {
                resolver.openFileDescriptor(uri, "r")!!.use { descriptor ->
                    FileInputStream(descriptor.fileDescriptor).channel.use { channel ->
                        channel.position(offset)
                        val buffer = ByteBuffer.allocate(minOf(max.toLong(), size - offset).toInt())
                        while (buffer.hasRemaining() && channel.read(buffer) > 0) Unit
                        buffer.array().copyOf(buffer.position())
                    }
                }
            }
        }
    }

    /** A photo, cut square from the middle and scaled to the 512×512 PNG the Portal stores. */
    suspend fun squarePicture(uri: Uri): ByteArray? = withContext(Dispatchers.Default) {
        val bitmap = runCatching {
            if (Build.VERSION.SDK_INT >= 28) ImageDecoder.decodeBitmap(ImageDecoder.createSource(context.contentResolver, uri)) { decoder, _, _ ->
                decoder.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
                decoder.setTargetSampleSize(1)
            } else context.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it) }
        }.getOrNull() ?: return@withContext null
        val side = minOf(bitmap.width, bitmap.height)
        val square = Bitmap.createBitmap(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side)
        val scaled = Bitmap.createScaledBitmap(square, 512, 512, true)
        ByteArrayOutputStream().use { out ->
            scaled.compress(Bitmap.CompressFormat.PNG, 100, out)
            out.toByteArray()
        }
    }
}

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

    /* ── speaking a message: AAC in MP4, which gpt-transcribe reads ── */
    var askMicrophone: (() -> Unit)? = null
    private var microphone: CompletableDeferred<Boolean>? = null
    private var recorder: android.media.MediaRecorder? = null
    private var recording: File? = null

    fun microphoneAnswered(allowed: Boolean) { microphone?.complete(allowed); microphone = null }

    override val canRecord: Boolean get() = context.packageManager.hasSystemFeature(android.content.pm.PackageManager.FEATURE_MICROPHONE)

    override suspend fun startRecording(): String? {
        if (context.checkSelfPermission(android.Manifest.permission.RECORD_AUDIO) != android.content.pm.PackageManager.PERMISSION_GRANTED) {
            val waiting = CompletableDeferred<Boolean>()
            microphone = waiting
            askMicrophone?.invoke() ?: return "Kimono can't hear you. Allow the microphone in Settings, then try again."
            if (!waiting.await()) return "Kimono can't hear you. Allow the microphone in Settings, then try again."
        }
        return withContext(Dispatchers.IO) {
            runCatching { recorder?.release() }
            val file = File(context.cacheDir, "spoken.m4a").apply { delete() }
            val made = (if (Build.VERSION.SDK_INT >= 31) android.media.MediaRecorder(context) else @Suppress("DEPRECATION") android.media.MediaRecorder())
            try {
                made.setAudioSource(android.media.MediaRecorder.AudioSource.VOICE_RECOGNITION)
                made.setOutputFormat(android.media.MediaRecorder.OutputFormat.MPEG_4)
                made.setAudioEncoder(android.media.MediaRecorder.AudioEncoder.AAC)
                made.setAudioChannels(1)
                made.setAudioSamplingRate(24_000)
                made.setAudioEncodingBitRate(48_000)
                made.setOutputFile(file.absolutePath)
                made.prepare()
                made.start()
                recorder = made; recording = file
                null
            } catch (e: Exception) {
                runCatching { made.release() }
                "The microphone didn't start. Try again."
            }
        }
    }

    override fun recordingLevel(): Float {
        val amplitude = runCatching { recorder?.maxAmplitude ?: 0 }.getOrDefault(0)
        return kotlin.math.sqrt(amplitude / 32767f).coerceIn(0f, 1f)
    }

    override suspend fun stopRecording(keep: Boolean): ByteArray? = withContext(Dispatchers.IO) {
        val made = recorder ?: return@withContext null
        val file = recording
        recorder = null; recording = null
        /* stop() throws when nothing was recorded yet */
        val stopped = runCatching { made.stop() }.isSuccess
        runCatching { made.release() }
        val bytes = if (keep && stopped && file != null && file.exists()) file.readBytes() else null
        file?.delete()
        bytes
    }

    override suspend fun pickPicture(): ByteArray? {
        val waiting = CompletableDeferred<Uri?>()
        picking = waiting
        launchPicker?.invoke() ?: return null
        val uri = waiting.await() ?: return null
        return squarePicture(uri)
    }

    override suspend fun pickPhoto(): app.kimono.data.PickedPhoto? {
        val waiting = CompletableDeferred<Uri?>()
        picking = waiting
        launchPicker?.invoke() ?: return null
        val uri = waiting.await() ?: return null
        return withContext(Dispatchers.Default) {
            val bitmap = decodePicked(uri) ?: return@withContext null
            val scale = minOf(1f, 2400f / maxOf(bitmap.width, bitmap.height))
            val fit = if (scale < 1f) Bitmap.createScaledBitmap(bitmap, (bitmap.width * scale).toInt(), (bitmap.height * scale).toInt(), true) else bitmap
            val bytes = ByteArrayOutputStream().use { out -> fit.compress(Bitmap.CompressFormat.JPEG, 92, out); out.toByteArray() }
            app.kimono.data.PickedPhoto(bytes, fit.width, fit.height)
        }
    }

    override suspend fun cropPhoto(photo: app.kimono.data.PickedPhoto, x: Int, y: Int, w: Int, h: Int, outW: Int, outH: Int, png: Boolean): ByteArray? = withContext(Dispatchers.Default) {
        val bitmap = BitmapFactory.decodeByteArray(photo.bytes, 0, photo.bytes.size) ?: return@withContext null
        val left = x.coerceIn(0, bitmap.width - 1); val top = y.coerceIn(0, bitmap.height - 1)
        val cut = Bitmap.createBitmap(bitmap, left, top, w.coerceIn(1, bitmap.width - left), h.coerceIn(1, bitmap.height - top))
        val scaled = Bitmap.createScaledBitmap(cut, outW, outH, true)
        ByteArrayOutputStream().use { out -> scaled.compress(if (png) Bitmap.CompressFormat.PNG else Bitmap.CompressFormat.JPEG, if (png) 100 else 86, out); out.toByteArray() }
    }

    override suspend fun pickBanner(): ByteArray? {
        val waiting = CompletableDeferred<Uri?>()
        picking = waiting
        launchPicker?.invoke() ?: return null
        val uri = waiting.await() ?: return null
        return bannerPicture(uri)
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
    override fun keepDir(): String = context.filesDir.absolutePath
    override fun freeBytes(): Long? = runCatching { android.os.StatFs(context.filesDir.absolutePath).availableBytes }.getOrNull()
    override val musicAudio: app.kimono.music.MusicAudio by lazy { AndroidMusicAudio(context) }

    /** Hands the file to whichever app opens its type, through Kimono's FileProvider. */
    override fun openFile(path: String, mimeType: String?) {
        val uri = FileProvider.getUriForFile(context, "${context.packageName}.files", File(path))
        val intent = Intent(Intent.ACTION_VIEW).setDataAndType(uri, mimeType ?: context.contentResolver.getType(uri) ?: "*/*")
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        val chooser = Intent.createChooser(intent, null)
        if (activity == null) chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        (activity ?: context).startActivity(chooser)
    }

    /**
     * Videos into Movies/Kimono and pictures into Pictures/Kimono, so the gallery shows them;
     * anything else into Downloads. Before Android 10, handed to an app instead.
     */
    override suspend fun saveFile(path: String, name: String, mimeType: String?): String? {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) { openFile(path, mimeType); return null }
        return withContext(Dispatchers.IO) {
            val store = android.provider.MediaStore.VOLUME_EXTERNAL_PRIMARY
            /* The type from the extension when the one given is vague (octet-stream): the gallery only takes videos and pictures. */
            val type = mimeType?.takeIf { it.startsWith("video/") || it.startsWith("image/") }
                ?: android.webkit.MimeTypeMap.getSingleton().getMimeTypeFromExtension(name.substringAfterLast('.', "").lowercase())
                ?: mimeType
            val (collection, folder, said) = when {
                type?.startsWith("video/") == true -> Triple(android.provider.MediaStore.Video.Media.getContentUri(store), "${android.os.Environment.DIRECTORY_MOVIES}/Kimono", "Saved to your gallery")
                type?.startsWith("image/") == true -> Triple(android.provider.MediaStore.Images.Media.getContentUri(store), "${android.os.Environment.DIRECTORY_PICTURES}/Kimono", "Saved to your gallery")
                else -> Triple(android.provider.MediaStore.Downloads.getContentUri(store), android.os.Environment.DIRECTORY_DOWNLOADS, "Saved to Downloads")
            }
            val resolver = context.contentResolver
            val values = android.content.ContentValues().apply {
                put(android.provider.MediaStore.MediaColumns.DISPLAY_NAME, name)
                type?.let { put(android.provider.MediaStore.MediaColumns.MIME_TYPE, it) }
                put(android.provider.MediaStore.MediaColumns.RELATIVE_PATH, folder)
                put(android.provider.MediaStore.MediaColumns.IS_PENDING, 1)
            }
            val uri = runCatching { resolver.insert(collection, values) }.getOrNull() ?: return@withContext "Couldn't save $name."
            try {
                resolver.openOutputStream(uri)!!.use { out -> FileInputStream(File(path)).use { it.copyTo(out, 64 * 1024) } }
                resolver.update(uri, android.content.ContentValues().apply { put(android.provider.MediaStore.MediaColumns.IS_PENDING, 0) }, null, null)
                said
            } catch (e: Exception) {
                resolver.delete(uri, null, null)
                "Couldn't save $name."
            }
        }
    }

    override val build: Long get() = SelfUpdate.build(context)
    override val version: String get() = runCatching { context.packageManager.getPackageInfo(context.packageName, 0).versionName }.getOrNull() ?: ""

    override suspend fun installUpdate(url: String, sha256: String?, progress: (Float) -> Unit): String? = SelfUpdate.install(context, url, sha256, progress)

    override fun driveAvailable(on: Boolean) {
        if (prefs.getBoolean(KimonoDocuments.DRIVE_ON, true) == on) return
        prefs.edit().putBoolean(KimonoDocuments.DRIVE_ON, on).apply()
        KimonoDocuments.rootsChanged(context)
    }

    override val playsVideo: Boolean get() = true

    @androidx.compose.runtime.Composable
    override fun VideoPlayer(stream: app.kimono.data.Stream, modifier: androidx.compose.ui.Modifier, onFailed: (String) -> Unit) = KimonoVideo(stream, modifier, onFailed)

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

    /* ── where you are, for Prayer's nearby places: coarse only, asked the first time it's wanted ── */
    var askLocation: (() -> Unit)? = null
    private var locationAsk: CompletableDeferred<Boolean>? = null

    fun locationAnswered(allowed: Boolean) { locationAsk?.complete(allowed); locationAsk = null }

    override suspend fun whereAmI(): app.kimono.data.Position? {
        val coarse = android.Manifest.permission.ACCESS_COARSE_LOCATION
        if (context.checkSelfPermission(coarse) != android.content.pm.PackageManager.PERMISSION_GRANTED) {
            val waiting = CompletableDeferred<Boolean>()
            locationAsk = waiting
            askLocation?.invoke() ?: return null
            if (!waiting.await()) return null
        }
        val manager = context.getSystemService(android.location.LocationManager::class.java) ?: return null
        val providers = buildList {
            if (Build.VERSION.SDK_INT >= 31) add(android.location.LocationManager.FUSED_PROVIDER)
            add(android.location.LocationManager.NETWORK_PROVIDER)
            add(android.location.LocationManager.GPS_PROVIDER)
        }.filter { runCatching { manager.isProviderEnabled(it) }.getOrDefault(false) }
        @Suppress("MissingPermission")
        fun known() = (providers + android.location.LocationManager.PASSIVE_PROVIDER).mapNotNull { runCatching { manager.getLastKnownLocation(it) }.getOrNull() }.maxByOrNull { it.time }
        val recent = known()?.takeIf { System.currentTimeMillis() - it.time < 30 * 60_000 }
        val found = recent ?: providers.firstOrNull()?.let { provider ->
            kotlinx.coroutines.withTimeoutOrNull(15_000) {
                kotlinx.coroutines.suspendCancellableCoroutine<android.location.Location?> { waiting ->
                    @Suppress("MissingPermission")
                    if (Build.VERSION.SDK_INT >= 30) {
                        val cancel = android.os.CancellationSignal()
                        waiting.invokeOnCancellation { cancel.cancel() }
                        manager.getCurrentLocation(provider, cancel, context.mainExecutor) { waiting.resumeWith(Result.success(it)) }
                    } else {
                        val listener = object : android.location.LocationListener {
                            override fun onLocationChanged(location: android.location.Location) { if (waiting.isActive) waiting.resumeWith(Result.success(location)) }
                            @Deprecated("Deprecated in Java") override fun onStatusChanged(provider: String?, status: Int, extras: android.os.Bundle?) {}
                            override fun onProviderEnabled(provider: String) {}
                            override fun onProviderDisabled(provider: String) {}
                        }
                        waiting.invokeOnCancellation { manager.removeUpdates(listener) }
                        @Suppress("DEPRECATION")
                        manager.requestSingleUpdate(provider, listener, android.os.Looper.getMainLooper())
                    }
                }
            }
        } ?: known()
        return found?.let { app.kimono.data.Position(it.latitude, it.longitude) }
    }

    override val clock24: Boolean get() = android.text.format.DateFormat.is24HourFormat(context)

    override fun prayerChanged() = PrayerWidgets.changed(context)

    override fun dynamicColors(night: Boolean): androidx.compose.material3.ColorScheme? = if (Build.VERSION.SDK_INT < 31) null
        else if (night) androidx.compose.material3.dynamicDarkColorScheme(context) else androidx.compose.material3.dynamicLightColorScheme(context)

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

    var launchCamera: ((Uri) -> Unit)? = null
    private var taking: CompletableDeferred<Boolean>? = null

    override val camera: Boolean get() = context.packageManager.hasSystemFeature(android.content.pm.PackageManager.FEATURE_CAMERA_ANY)

    /* The phone's own camera app takes it, into a file of ours it's lent; Kimono never asks for the camera itself. */
    override suspend fun takePhoto(): List<PickedFile> {
        val launch = launchCamera ?: return emptyList()
        val stamp = java.text.SimpleDateFormat("yyyy-MM-dd 'at' HH.mm.ss", java.util.Locale.US).format(java.util.Date())
        val file = withContext(Dispatchers.IO) {
            File(File(context.cacheDir, "camera/${java.util.UUID.randomUUID()}").apply { mkdirs() }, "Photo $stamp.jpg")
        }
        val uri = FileProvider.getUriForFile(context, "${context.packageName}.files", file)
        val waiting = CompletableDeferred<Boolean>()
        taking?.complete(false)
        taking = waiting
        runCatching { launch(uri) }.onFailure { taking = null; return emptyList() }
        if (!waiting.await() || !file.exists() || file.length() == 0L) { file.delete(); return emptyList() }
        return listOfNotNull(pickedFile(uri))
    }

    fun photoTaken(taken: Boolean) { taking?.complete(taken); taking = null }

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
    /** Cut 3:1 from the middle and scaled to the 2400×800 JPEG the Portal keeps as a banner (lib/banner-jpeg.ts). */
    suspend fun bannerPicture(uri: Uri): ByteArray? = withContext(Dispatchers.Default) {
        val bitmap = decodePicked(uri) ?: return@withContext null
        val w = minOf(bitmap.width, bitmap.height * 3)
        val h = w / 3
        val cut = Bitmap.createBitmap(bitmap, (bitmap.width - w) / 2, (bitmap.height - h) / 2, w, h)
        val scaled = Bitmap.createScaledBitmap(cut, 2400, 800, true)
        ByteArrayOutputStream().use { out ->
            scaled.compress(Bitmap.CompressFormat.JPEG, 86, out)
            out.toByteArray()
        }
    }

    private fun decodePicked(uri: Uri): Bitmap? = runCatching {
        if (Build.VERSION.SDK_INT >= 28) ImageDecoder.decodeBitmap(ImageDecoder.createSource(context.contentResolver, uri)) { decoder, _, _ ->
            decoder.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
            decoder.setTargetSampleSize(1)
        } else context.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it) }
    }.getOrNull()

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

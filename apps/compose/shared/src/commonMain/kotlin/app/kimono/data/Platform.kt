package app.kimono.data

/**
 * What the shared app needs from the phone it runs on. Android implements it
 * in androidApp; the iPhone version comes with the iOS target.
 */
interface Platform {
    /** Reads a value kept between launches, encrypted by the OS keystore. */
    suspend fun readKept(key: String): String?
    /** Keeps a value between launches, or forgets it when null. */
    suspend fun keep(key: String, value: String?)
    fun randomBytes(count: Int): ByteArray
    fun sha256(bytes: ByteArray): ByteArray
    /**
     * Opens the sign-in page in the system browser sheet and waits for it to
     * come back to [redirect]. Returns the full return address, or null if the
     * person closed the sheet.
     */
    suspend fun openSignIn(url: String, redirect: String): String?
    /** Asks the person for a photo; returns it squared up as a 512×512 PNG, or null. */
    suspend fun pickPicture(): ByteArray?

    /** "android" or "ios": which store a phone app lives in. */
    val os: String
    /** Opens a web page, or a store page in the store. */
    fun openUrl(url: String)
    /** A directory for files opened from Drive; the OS may clear it. */
    fun cacheDir(): String
    /** Shows a downloaded file in the system's own viewer (Quick Look, or the app that opens it). */
    fun openFile(path: String, mimeType: String?)
    /** Asks the person for files to upload. Empty if they changed their mind. */
    suspend fun pickFiles(): List<PickedFile>
    /** Whether attaching offers the phone's own photo picker beside its files ([pickMedia]). */
    val photoPicker: Boolean get() = false
    /** Asks for photos and videos from the phone's photo picker. Empty if they changed their mind. */
    suspend fun pickMedia(): List<PickedFile> = pickFiles()
    /** Whether attaching can take a photo with the phone's camera ([takePhoto]). */
    val camera: Boolean get() = false
    /** Opens the camera for one photo; empty if they changed their mind. */
    suspend fun takePhoto(): List<PickedFile> = emptyList()
    /** Uploads the OS carries on with after the app closes; null to upload while the app is open. */
    val uploads: Uploads?
    /** This app's build number (Android's versionCode, iOS's CFBundleVersion), for knowing when to update. */
    val build: Long get() = 0
    /**
     * Updates the app from [url]: Android downloads the package and installs
     * it over itself; an iPhone is sent where its updates come from. Returns a
     * problem to show, or null when it's under way.
     */
    suspend fun installUpdate(url: String, sha256: String?, progress: (Float) -> Unit): String? { openUrl(url); return null }
    /** Installs or updates another of Kimono's apps ([packageId]) from a package Kimono hands out, checked against [sha256]; a problem to show, or null. */
    suspend fun installApp(url: String, packageId: String, sha256: String, progress: (Float) -> Unit): String? { openUrl(url); return null }
    /** Whether the app with [packageId] is on this phone; null where the phone won't say (an iPhone). */
    fun isInstalled(packageId: String): Boolean? = null
    /** The version name of the installed app with [packageId] ("3.1.0-kimono.1"); null if it isn't installed or the phone won't say. */
    fun installedVersion(packageId: String): String? = null
    /** Whether an installed app answers [url] (an iPhone's kimono-photos://, say); null where the phone won't say. */
    fun canOpen(url: String): Boolean? = null
    /** The build number (CFBundleVersion) of the installed app with [packageId], where the phone keeps it apart from the version (an iPhone). */
    fun installedBuild(packageId: String): String? = null
    /** Opens the installed app with [packageId]; false if it couldn't. */
    fun openInstalled(packageId: String): Boolean = false
    /** Opens the system share sheet with [text] (a link, say), so it can go to any app. */
    fun share(text: String) {}
    /** How far the phone's clock is from UTC at [at] (ms since 1970), for showing times as the person reads them. */
    fun utcOffsetMillis(at: Long): Long = 0
    /** Whether this phone can record a spoken message ([startRecording]). */
    val canRecord: Boolean get() = false
    /** Starts recording from the microphone, asking for it the first time; a problem to show, or null once it's listening. */
    suspend fun startRecording(): String? = "This phone can't record."
    /** How loud it is now, from 0 to 1, while recording. */
    fun recordingLevel(): Float = 0f
    /** Stops recording: what was heard as AAC in MP4 (audio/mp4) when [keep], else null and it's thrown away. */
    suspend fun stopRecording(keep: Boolean): ByteArray? = null
    /** Kept as "off" when the person turned Kimono's notifications off in Settings. */
    val notificationsKey: String get() = "kimono.notifications"
    /** Whether the person asked the phone for less motion. */
    val reduceMotion: Boolean get() = false
    /** Drive was switched on or off on the server: the Files app entry follows. */
    fun driveAvailable(on: Boolean) {}
    /** A small picture of a photo, video or PDF, at least [pixels] across, as a local file; null if there can't be one. */
    suspend fun thumbnail(node: DriveNode, pixels: Int): String? = null
    /** A frame of the video at [path] (a local file), at least [pixels] across, and how long it runs; null if the phone can't draw one. */
    suspend fun videoFrame(path: String, pixels: Int): VideoFrame? = null
    /**
     * A web page drawn by the phone's own web view: an artifact's frame, or the app a chat runs.
     * Links leave for the browser unless [keepLinks]. A page can talk back through
     * `window.KimonoNative.post(text)` (Android) or `webkit.messageHandlers.kimono` (iPhone), which
     * arrives at [onMessage]; [control] runs script in it. [onLoaded] follows each finished load.
     */
    @androidx.compose.runtime.Composable
    fun WebFrame(url: String, modifier: androidx.compose.ui.Modifier, control: WebFrameControl?, keepLinks: Boolean, onMessage: (String) -> Unit, onLoaded: () -> Unit) {}
    /** A short silent clip at [url], looping with no controls (a how-to); nothing where the phone has no player for it. */
    @androidx.compose.runtime.Composable
    fun LoopingVideo(url: String, modifier: androidx.compose.ui.Modifier) {}
}

/** A video's poster: one frame as an encoded picture, and its length in seconds when known. */
class VideoFrame(val picture: ByteArray, val seconds: Double?)

/** Runs script in a [Platform.WebFrame] once it's on screen. */
class WebFrameControl {
    var run: ((String) -> Unit)? = null
    /** Whether the page scrolls inside its frame; set before it's shown. Off, the screen around it scrolls instead. */
    var scrolls: Boolean = true
    fun evaluate(script: String) { run?.invoke(script) }
}

/** An upload as the screens show it, wherever it runs. */
data class UploadStatus(
    val id: String,
    val name: String,
    val size: Long,
    val sent: Long,
    val folderId: String,
    /** Waiting for a connection, or for its turn. */
    val waiting: Boolean = false,
    val failed: String? = null,
    val done: Boolean = false,
)

/** Where uploads happen: handed to the OS, or kept in the app while it's open. */
interface Uploads {
    val statuses: kotlinx.coroutines.flow.StateFlow<List<UploadStatus>>
    fun start(files: List<PickedFile>, folderId: String)
    /** Stops an upload and forgets it, done or not. */
    fun dismiss(id: String)
    /** Starts a failed upload again, from where the server says it stopped. */
    fun retry(id: String)
}

/**
 * A file chosen for upload, read a piece at a time so a 150 GB file never
 * sits in memory.
 */
interface PickedFile {
    val name: String
    val size: Long
    val mimeType: String?
    /** Up to [max] bytes from [offset]; fewer only at the end. */
    suspend fun read(offset: Long, max: Int): ByteArray
}

/** Something another app shared into Kimono. */
data class SharedItem(val name: String, val mimeType: String, val sizeBytes: Long?, val preview: Any?, val pictureBytes: suspend () -> ByteArray?)

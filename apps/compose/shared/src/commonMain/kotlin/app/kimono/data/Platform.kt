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
    /** Uploads the OS carries on with after the app closes; null to upload while the app is open. */
    val uploads: Uploads?
    /** A small picture of a photo, video or PDF, at least [pixels] across, as a local file; null if there can't be one. */
    suspend fun thumbnail(node: DriveNode, pixels: Int): String? = null
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

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
}

/** Something another app shared into Kimono. */
data class SharedItem(val name: String, val mimeType: String, val sizeBytes: Long?, val preview: Any?, val pictureBytes: suspend () -> ByteArray?)

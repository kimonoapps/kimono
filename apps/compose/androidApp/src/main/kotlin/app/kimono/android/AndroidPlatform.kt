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
import app.kimono.data.Platform
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
        if (value == null) { prefs.edit().remove(key).apply(); return@withContext }
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key())
        val sealed = cipher.iv + cipher.doFinal(value.toByteArray())
        prefs.edit().putString(key, Base64.encodeToString(sealed, Base64.NO_WRAP)).apply()
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

package app.kimono.watch

import android.app.Application
import android.app.UiModeManager
import android.content.Context
import android.content.res.Configuration
import android.content.pm.PackageManager
import android.media.MediaCodecInfo
import android.media.MediaCodecList
import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import android.view.Display
import android.hardware.display.DisplayManager
import androidx.annotation.OptIn
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.audio.AudioCapabilities
import app.kimono.watch.data.Accounts
import app.kimono.watch.data.Keeper
import app.kimono.watch.data.WatchApi
import app.kimono.watch.model.Device
import app.kimono.watch.ui.Toasts
import io.ktor.client.HttpClient
import io.ktor.client.engine.okhttp.OkHttp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.security.KeyStore
import java.security.MessageDigest
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** One of everything for the app: who's signed in, the Watch API, toasts. */
class WatchApp : Application() {
    lateinit var accounts: Accounts
    lateinit var api: WatchApi
    val toasts = Toasts()
    lateinit var downloads: app.kimono.watch.player.Downloads
    lateinit var services: WatchServices
    val tv by lazy { isTv(this) }
    val device by lazy { capabilities(this, tv) }
    /** This install's own id, kept for good: the server keeps a quality per device. */
    val deviceId: String by lazy {
        val prefs = getSharedPreferences("watch-device", MODE_PRIVATE)
        prefs.getString("id", null) ?: ("android-" + java.util.UUID.randomUUID().toString().take(12)).also { prefs.edit().putString("id", it).apply() }
    }

    override fun onCreate() {
        super.onCreate()
        /* A party's live channel pings every 10 s: reads may wait up to 40 s. */
        accounts = Accounts(AndroidKeeper(this), HttpClient(OkHttp) { engine { config { readTimeout(40, java.util.concurrent.TimeUnit.SECONDS) } } })
        /* On mobile data a phone counts as a device of its own, with its own quality (Settings). */
        api = WatchApi(accounts, { device }) { if (!tv && onMobileData()) "$deviceId.cell" else deviceId }
        downloads = app.kimono.watch.player.Downloads(this)
        services = WatchServices(accounts, api, toasts, downloads, tv, app.kimono.watch.ui.AndroidPreview, deviceId, cellular = !tv, openUrl = { url ->
            runCatching { startActivity(android.content.Intent(android.content.Intent.ACTION_VIEW, android.net.Uri.parse(url)).addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)) }
        }, version = runCatching { packageManager.getPackageInfo(packageName, 0).versionName }.getOrNull().orEmpty(),
            /* "Remove animations" in Android's accessibility settings sets the animator scale to 0. */
            reducedMotion = { android.provider.Settings.Global.getFloat(contentResolver, android.provider.Settings.Global.ANIMATOR_DURATION_SCALE, 1f) == 0f })
    }

    private fun onMobileData(): Boolean {
        val cm = getSystemService(CONNECTIVITY_SERVICE) as android.net.ConnectivityManager
        val caps = cm.getNetworkCapabilities(cm.activeNetwork) ?: return false
        return caps.hasTransport(android.net.NetworkCapabilities.TRANSPORT_CELLULAR) && !caps.hasTransport(android.net.NetworkCapabilities.TRANSPORT_WIFI)
    }
}

val Context.watch get() = applicationContext as WatchApp

fun isTv(context: Context): Boolean =
    (context.getSystemService(Context.UI_MODE_SERVICE) as UiModeManager).currentModeType == Configuration.UI_MODE_TYPE_TELEVISION ||
        context.packageManager.hasSystemFeature(PackageManager.FEATURE_LEANBACK)

/**
 * What this screen and these decoders can really play, told to the server
 * with every play so it picks a version that works: the screen's height, its
 * HDR formats, Dolby Vision profiles and HEVC/AV1 decoders, and which audio
 * formats the TV or receiver takes as they are (passthrough).
 */
@OptIn(UnstableApi::class)
fun capabilities(context: Context, tv: Boolean): Device {
    val display = (context.getSystemService(Context.DISPLAY_SERVICE) as DisplayManager).getDisplay(Display.DEFAULT_DISPLAY)
    val modes = display?.supportedModes.orEmpty()
    val maxHeight = modes.maxOfOrNull { minOf(it.physicalWidth, it.physicalHeight) } ?: 1080
    @Suppress("DEPRECATION")
    val hdrTypes = buildSet {
        display?.hdrCapabilities?.supportedHdrTypes?.forEach { add(it) }
        if (Build.VERSION.SDK_INT >= 34) modes.forEach { m -> m.supportedHdrTypes.forEach { add(it) } }
    }
    val hdr = hdrTypes.mapNotNull {
        when (it) {
            Display.HdrCapabilities.HDR_TYPE_DOLBY_VISION -> "dv"
            Display.HdrCapabilities.HDR_TYPE_HDR10 -> "hdr10"
            Display.HdrCapabilities.HDR_TYPE_HLG -> "hlg"
            Display.HdrCapabilities.HDR_TYPE_HDR10_PLUS -> "hdr10plus"
            else -> null
        }
    }.distinct()
    val codecs = MediaCodecList(MediaCodecList.REGULAR_CODECS).codecInfos.filter { !it.isEncoder }
    fun decodes(mime: String) = codecs.any { info -> info.supportedTypes.any { it.equals(mime, ignoreCase = true) } }
    /* AV1 only with a hardware decoder: software AV1 drains a phone, and some devices garble its 10-bit output. */
    fun hardwareAv1() = Build.VERSION.SDK_INT >= 29 && codecs.any { info -> info.isHardwareAccelerated && info.supportedTypes.any { it.equals("video/av01", true) } }
    fun profile(mime: String, hardware: Boolean, vararg profiles: Int) = codecs.any { info ->
        (!hardware || Build.VERSION.SDK_INT < 29 || info.isHardwareAccelerated) && info.supportedTypes.any { t ->
            t.equals(mime, true) && runCatching { info.getCapabilitiesForType(t).profileLevels.any { it.profile in profiles } }.getOrDefault(false)
        }
    }
    fun main10() = profile("video/hevc", false, MediaCodecInfo.CodecProfileLevel.HEVCProfileMain10)
    fun av1Main10() = Build.VERSION.SDK_INT >= 29 && profile("video/av01", true, MediaCodecInfo.CodecProfileLevel.AV1ProfileMain10)
    /* 10-bit H.264 only counts with a hardware decoder that says so; ExoPlayer has no software one here. */
    fun hi10p() = profile("video/avc", true, MediaCodecInfo.CodecProfileLevel.AVCProfileHigh10)
    val dv = codecs.flatMap { info ->
        info.supportedTypes.filter { it.equals("video/dolby-vision", true) }.flatMap { type -> info.getCapabilitiesForType(type).profileLevels.map { it.profile } }
    }.mapNotNull {
        when (it) {
            MediaCodecInfo.CodecProfileLevel.DolbyVisionProfileDvheStn -> 5
            MediaCodecInfo.CodecProfileLevel.DolbyVisionProfileDvheDtb -> 7
            MediaCodecInfo.CodecProfileLevel.DolbyVisionProfileDvheSt -> 8
            else -> null
        }
    }.distinct().sorted()
    val audio = AudioCapabilities.getCapabilities(context, AudioAttributes.DEFAULT, null)
    val passthrough = listOfNotNull(
        "truehd".takeIf { audio.supportsEncoding(C.ENCODING_DOLBY_TRUEHD) },
        "dts-hd".takeIf { audio.supportsEncoding(C.ENCODING_DTS_HD) },
        "dts".takeIf { audio.supportsEncoding(C.ENCODING_DTS) },
        "eac3".takeIf { audio.supportsEncoding(C.ENCODING_E_AC3) || audio.supportsEncoding(C.ENCODING_E_AC3_JOC) },
        "ac3".takeIf { audio.supportsEncoding(C.ENCODING_AC3) },
    )
    return Device(
        client = if (tv) "android-tv" else "android",
        maxHeight = maxHeight.coerceIn(360, 4320),
        hdr = if (dv.isEmpty()) hdr - "dv" else hdr,
        dvProfiles = if ("dv" in hdr) dv else emptyList(),
        /* 8-bit HEVC plays on any HEVC decoder; tenBit tells the server whether the 10-bit ones do. */
        codecs = listOfNotNull("h264", "hevc".takeIf { decodes("video/hevc") }, "av1".takeIf { hardwareAv1() }),
        passthrough = passthrough,
        tenBit = false.takeUnless { main10() && (!hardwareAv1() || av1Main10()) },
        hi10p = true.takeIf { hi10p() },
    )
}

/** Kept values, encrypted with an AES key that never leaves the Android Keystore (as in the main app). */
class AndroidKeeper(context: Context) : Keeper {
    private val prefs = context.getSharedPreferences("watch", Context.MODE_PRIVATE)

    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getEntry("watch-kept", null) as? KeyStore.SecretKeyEntry)?.let { return it.secretKey }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
            init(KeyGenParameterSpec.Builder("watch-kept", KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
        }.generateKey()
    }

    override suspend fun read(key: String): String? = withContext(Dispatchers.IO) {
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
        prefs.edit().putString(key, Base64.encodeToString(cipher.iv + cipher.doFinal(value.toByteArray()), Base64.NO_WRAP)).commit()
        Unit
    }

    override fun randomBytes(count: Int) = ByteArray(count).also { SecureRandom().nextBytes(it) }
    override fun sha256(bytes: ByteArray): ByteArray = MessageDigest.getInstance("SHA-256").digest(bytes)
}

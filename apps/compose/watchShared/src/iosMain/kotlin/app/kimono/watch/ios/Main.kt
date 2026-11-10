@file:OptIn(kotlinx.cinterop.ExperimentalForeignApi::class, kotlinx.cinterop.BetaInteropApi::class)

package app.kimono.watch.ios

import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.window.ComposeUIViewController
import app.kimono.watch.LocalWatch
import app.kimono.watch.PlayerLauncher
import app.kimono.watch.WatchRoot
import app.kimono.watch.WatchServices
import app.kimono.watch.data.Accounts
import app.kimono.watch.data.Keeper
import app.kimono.watch.data.WatchApi
import app.kimono.watch.model.Device
import app.kimono.watch.theme.WatchTheme
import app.kimono.watch.ui.Toasts
import androidx.compose.runtime.CompositionLocalProvider
import io.ktor.client.HttpClient
import io.ktor.client.engine.darwin.Darwin
import io.ktor.client.plugins.HttpTimeout
import kotlinx.cinterop.addressOf
import kotlinx.cinterop.usePinned
import platform.Foundation.NSData
import platform.Foundation.NSURLComponents
import platform.Foundation.NSURLQueryItem
import platform.Foundation.NSUUID
import platform.Foundation.NSUserDefaults
import platform.Foundation.create
import platform.UIKit.UIViewController
import platform.posix.memcpy

/** Kept values in the Keychain (the Swift side), as the Android app keeps them in the Keystore. */
private class IosKeeper(private val host: IosWatchHost) : Keeper {
    override suspend fun read(key: String) = host.readKept(key)
    override suspend fun keep(key: String, value: String?) = host.keep(key, value)
    override fun randomBytes(count: Int) = host.randomBytes(count).toByteArray()
    override fun sha256(bytes: ByteArray) = host.sha256(bytes.toNSData()).toByteArray()
}

fun NSData.toByteArray(): ByteArray = ByteArray(length.toInt()).also { out ->
    if (out.isNotEmpty()) out.usePinned { memcpy(it.addressOf(0), this.bytes, length) }
}

fun ByteArray.toNSData(): NSData = usePinned { NSData.create(bytes = it.addressOf(0), length = size.toULong()) }

/**
 * Kimono Watch on iPhone: the shared app, with the Swift side's Keychain,
 * player and downloads behind the shared seams. The Swift shell calls
 * [controller] once, [open] with kimono-watch:// links, and [cameForward] and
 * [wentBackground] as the app comes and goes.
 */
object WatchIos {
    private lateinit var host: IosWatchHost
    internal lateinit var services: WatchServices
    private val resumed = mutableIntStateOf(0)
    private val connect = mutableStateOf<String?>(null)
    internal var playing: PlayerSession? = null
        set(value) { field = value; playerUp.value = value != null }
    /** The player is on screen: the hero's preview holds still underneath. */
    internal val playerUp = mutableStateOf(false)

    /** This install's own id, kept for good: the server keeps a quality per device. */
    private val deviceId: String by lazy {
        val defaults = NSUserDefaults.standardUserDefaults
        defaults.stringForKey("watch.device") ?: ("ios-" + NSUUID().UUIDString.lowercase().take(12)).also { defaults.setObject(it, "watch.device") }
    }

    private val device: Device by lazy {
        val d = host.device()
        Device(
            client = "ios",
            maxHeight = d.maxHeight.coerceIn(360, 4320),
            hdr = d.hdr,
            dvProfiles = d.dvProfiles.mapNotNull { it.toIntOrNull() },
            codecs = d.codecs,
            passthrough = emptyList(),
            tenBit = false.takeUnless { d.tenBit },
            hi10p = true.takeIf { d.hi10p },
        )
    }

    fun controller(host: IosWatchHost): UIViewController {
        this.host = host
        val toasts = Toasts()
        /* A party's live channel pings every 10 s: reads may wait up to 40 s. */
        val accounts = Accounts(IosKeeper(host), HttpClient(Darwin) {
            install(HttpTimeout) { socketTimeoutMillis = 40_000; connectTimeoutMillis = 20_000 }
        })
        /* On mobile data a phone counts as a device of its own, with its own quality (Settings). */
        val api = WatchApi(accounts, { device }) { if (host.onCellular()) "$deviceId.cell" else deviceId }
        services = WatchServices(accounts, api, toasts, IosDownloads(host.downloader, api, toasts), tv = false, preview = IosPreview(host, api),
            deviceId = deviceId, cellular = true, openUrl = host::openUrl)
        val launcher = object : PlayerLauncher {
            override fun play(titleId: String, season: Int?, episode: Int?) = openPlayer(PlayerStart(titleId, season, episode))
            override fun together(titleId: String, season: Int?, episode: Int?, at: Double) = openPlayer(PlayerStart(titleId, season, episode, together = true, at = at))
            override fun join(partyId: String) = openPlayer(PlayerStart(null, null, null, party = partyId))
        }
        return ComposeUIViewController {
            WatchTheme {
                CompositionLocalProvider(LocalWatch provides services) {
                    WatchRoot(services, resumed.intValue, connect.value, null, launcher)
                }
            }
        }
    }

    internal fun openPlayer(start: PlayerStart) {
        playing?.close(dismiss = false)
        val session = PlayerSession(host, services, start)
        playing = session
        host.presentPlayer(session.controller())
    }

    /** A kimono-watch://connect?server=… link (the Portal's "Get the app"): sign in to that Kimono. */
    fun open(url: String) {
        val parts = NSURLComponents(string = url) ?: return
        if (parts.scheme != "kimono-watch" || parts.host != "connect") return
        val server = (parts.queryItems?.firstOrNull { (it as NSURLQueryItem).name == "server" } as? NSURLQueryItem)?.value?.trim()?.trimEnd('/') ?: return
        connect.value = if (server.startsWith("https://") || server.startsWith("http://")) server else "https://$server"
    }

    private var away = false

    fun cameForward() { if (away) resumed.intValue++; away = false }

    fun wentBackground() { away = true; playing?.save() }
}

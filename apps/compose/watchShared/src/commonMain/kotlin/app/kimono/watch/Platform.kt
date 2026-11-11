@file:OptIn(kotlin.time.ExperimentalTime::class)

package app.kimono.watch

import androidx.compose.runtime.Composable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.ImageBitmap
import app.kimono.watch.data.Accounts
import app.kimono.watch.data.WatchApi
import app.kimono.watch.model.PlayAnswer
import app.kimono.watch.model.TrackHints
import app.kimono.watch.ui.Toasts
import kotlinx.coroutines.flow.StateFlow
import kotlin.time.Clock

/*
 * What the shared screens need from the device they run on. Android fills
 * it with ExoPlayer, Media3 downloads and its TV screens; the iPhone app will
 * fill it with its own player the same way.
 */

/** How far a download has got: 0–1, or done. */
data class DlState(val progress: Float, val done: Boolean, val failed: Boolean = false)

fun dlKey(titleId: String, season: Int, episode: Int) = "$titleId:$season:$episode"

/** One download as the Downloads page lists it: [bytes] is the file's size (about, until it's done). */
data class DlEntry(val titleId: String, val season: Int, val episode: Int, val name: String, val art: String?, val bytes: Long?)

/** A key back into its title, season and episode (a title id may itself hold a colon). */
fun dlParts(key: String): Triple<String, Int, Int>? {
    val e = key.substringAfterLast(':').toIntOrNull() ?: return null
    val rest = key.substringBeforeLast(':')
    val s = rest.substringAfterLast(':').toIntOrNull() ?: return null
    return Triple(rest.substringBeforeLast(':'), s, e)
}

fun bytesText(bytes: Long): String = when {
    bytes >= 1L shl 30 -> "${(bytes * 10 / (1L shl 30)) / 10.0} GB"
    bytes >= 1L shl 20 -> "${bytes / (1L shl 20)} MB"
    bytes > 0 -> "Under 1 MB"
    else -> "None"
}

/** About how big an episode's download is when its copy isn't known yet: by runtime, at the download quality's usual rate. */
fun bytesGuess(minutes: Int?, higher: Boolean): Long = ((minutes ?: 24) * 60L) * (if (higher) 6_000_000L else 2_500_000L) / 8

/** Downloads for watching offline. */
interface WatchDownloads {
    val states: StateFlow<Map<String, DlState>>
    fun start(titleId: String, season: Int, episode: Int, name: String, art: String? = null)
    /** Everything downloaded or on its way, for the Downloads page. */
    fun entries(): List<DlEntry>
    fun remove(titleId: String, season: Int, episode: Int)
    /** The play answer kept with a finished download, for playing it with no connection. */
    fun offline(titleId: String, season: Int, episode: Int): PlayAnswer?
    /** Downloads wait for Wi-Fi (kept on this device, not with the person). */
    val wifiOnly: StateFlow<Boolean>
    fun setWifiOnly(on: Boolean)
    /** Bytes the downloads take on this device. */
    fun usedBytes(): Long
    fun removeAll()
}

/** The quality a download asks /play for: "standard" keeps it small; "higher" takes this device's own. */
fun downloadQualityOf(prefs: app.kimono.watch.model.Prefs?): String? = if (prefs?.downloadQuality == "higher") null else "720"

/** A track as the audio & subtitles sheet lists it; [handle] is the player's own reference. */
class TrackOption(val handle: Any?, val label: String, val language: String?, val signs: Boolean, val selected: Boolean)

/** What the player tells its screen as it happens. */
interface EngineListener {
    fun firstFrame() {}
    /** [decoder]: this device can't decode what it was given; [network]: the stream stopped answering. */
    fun error(decoder: Boolean, network: Boolean) {}
    fun tracks() {}
    fun aspect(ratio: Float) {}
    fun playing(on: Boolean) {}
    /** The person paused (or played): not a buffering stall. */
    fun userPaused(paused: Boolean) {}
}

/** Frames for the scrubber, ten seconds apart. */
interface Thumbnails {
    /** The latest frame found, with the ten-second slot it belongs to. */
    val frame: StateFlow<Pair<Int, ImageBitmap>?>
    fun want(seconds: Double)
    /** The scrub is over: frames still to come are dropped, so the seek has the source to itself. */
    fun idle() {}
    fun close()
}

/** The decoder behind the player's controls. Seconds throughout. */
interface PlaybackEngine {
    val position: Double
    /** 0 while unknown. */
    val duration: Double
    val buffered: Double
    val playing: Boolean
    val playWhenReady: Boolean
    val buffering: Boolean
    val ended: Boolean
    /** How full the buffer is for starting, 0–1: the last stage of the start-of-playback ring. */
    val startFill: Float
    /** [play]: start by itself (not in a party, where the timeline says when). */
    fun load(url: String, key: String, startAt: Double, play: Boolean)
    fun play()
    fun pause()
    fun seekTo(seconds: Double)
    fun setSpeed(speed: Float)
    /** The player's own loudness, 0–1, under the device's volume. */
    fun setVolume(volume: Float) {}
    /** The phone's own media volume, 0–1, or null where it can't be read (the slider then sets [setVolume]). */
    fun deviceVolume(): Float? = null
    fun setDeviceVolume(volume: Float) {}
    /** The screen's brightness, 0–1, or null where the player can't set it; set for as long as the player is open. */
    fun brightness(): Float? = null
    fun setBrightness(level: Float) {}
    /** Leaving the player: the screen goes back to the brightness it had. */
    fun restoreBrightness() {}
    /** Switches on the audio and subtitles the server asked for. */
    fun applyHints(hints: TrackHints)
    /** How text subtitles look: [size] "small" | "medium" | "large", [background] "none" | "shadow" | "box". Styled ASS keeps its own. */
    fun subtitleLook(size: String, background: String) {}
    /** Whether the video picked is something no decoder here really handles (10-bit H.264, software AV1). */
    fun videoBeyondDecoders(): Boolean
    fun audioOptions(): List<TrackOption>
    fun subtitleOptions(): List<TrackOption>
    fun selectAudio(option: TrackOption)
    fun selectSubtitles(option: TrackOption)
    /** Returns a function that stops listening. */
    fun listen(listener: EngineListener): () -> Unit
    fun thumbnails(url: String): Thumbnails
    /** The picture itself, fitted by the screen around it. */
    @Composable fun Picture(modifier: Modifier)
    /** The picture keeps its own shape inside whatever it's given (mpv): it gets the whole area, so it isn't resized once it's started. */
    val fitsItself: Boolean get() = false
    /** Subtitles, drawn over the picture (libass for styled ones). */
    @Composable fun Captions(modifier: Modifier)
}

/** A muted preview of a title, for the hero and the title page. */
fun interface PreviewPlayer {
    @Composable fun Show(titleId: String, season: Int, episode: Int, muted: Boolean, active: Boolean, onPlaying: (Boolean) -> Unit, modifier: Modifier)
}

/** Everything the screens use, one per app. */
class WatchServices(
    val accounts: Accounts,
    val api: WatchApi,
    val toasts: Toasts,
    val downloads: WatchDownloads,
    val tv: Boolean,
    val preview: PreviewPlayer,
    /** This install's id, as the server keeps quality per device. */
    val deviceId: String,
    /** Whether this is a phone that can be on mobile data (it gets its own quality). */
    val cellular: Boolean,
    /** Opens a link outside the app (Kimono account). */
    val openUrl: (String) -> Unit,
    /** This build's version, for Settings → About. */
    val version: String = "",
    /** The device asks for less motion (Android's animation scale at 0, iOS's Reduce Motion). */
    val reducedMotion: () -> Boolean = { false },
) {
    /** The person's preferences, read once signed in and kept as they change them. */
    val prefs = app.kimono.watch.ui.PrefsStore(api)
}

val LocalWatch = staticCompositionLocalOf<WatchServices> { error("No WatchServices provided") }

internal fun nowMs(): Long = Clock.System.now().toEpochMilliseconds()

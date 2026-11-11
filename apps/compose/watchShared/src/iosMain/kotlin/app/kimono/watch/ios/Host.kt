package app.kimono.watch.ios

import platform.Foundation.NSData
import platform.UIKit.UIView
import platform.UIKit.UIViewController

/*
 * What the iPhone app's Swift side gives the shared Watch app: the Keychain,
 * the screen's and decoders' abilities, and the player (libmpv, with AVPlayer
 * for AirPlay and picture in picture). The Kotlin side wraps these in the
 * seams the shared screens use (PlaybackEngine, WatchDownloads, PreviewPlayer).
 */
interface IosWatchHost {
    fun readKept(key: String): String?
    fun keep(key: String, value: String?)
    fun randomBytes(count: Int): NSData
    fun sha256(data: NSData): NSData
    fun openUrl(url: String)
    /** On mobile data, with no Wi-Fi: the phone gets its own quality. */
    fun onCellular(): Boolean
    fun device(): IosDevice
    /** A player; [preview] is muted, smaller and quiet (no Now Playing, no PiP). */
    fun makePlayer(preview: Boolean): IosPlayer
    /** Shows the player full screen in landscape, in place of any player already up. */
    fun presentPlayer(controller: UIViewController)
    fun dismissPlayer()
    /** The player upright, or back on its side. */
    fun rotatePlayer()
    val downloader: IosDownloader
}

/** What this iPhone plays, as the Swift side reads it. */
class IosDevice(
    val maxHeight: Int,
    val hdr: List<String>,
    val dvProfiles: List<String>,
    val codecs: List<String>,
    val tenBit: Boolean,
    val hi10p: Boolean,
)

/** Where a player is, read four times a second. */
class IosPlayerState(
    val position: Double,
    val duration: Double,
    val buffered: Double,
    val playing: Boolean,
    val playWhenReady: Boolean,
    val buffering: Boolean,
    val ended: Boolean,
    val startFill: Double,
    /** Picture in picture is up (the in-app chrome hides). */
    val pip: Boolean,
)

/** What the player says as it happens, on the main thread. */
interface IosPlayerEvents {
    fun firstFrame()
    fun error(decoder: Boolean, network: Boolean)
    fun tracks()
    fun shape(ratio: Double)
    fun playing(on: Boolean)
    fun userPaused(paused: Boolean)
}

/** Asks the Portal for this play's HLS rendition (AirPlay, picture in picture); null when there isn't one. */
interface IosHlsSource {
    fun ask(done: (String?) -> Unit)
}

/** libmpv for the file as it is; AVPlayer on the HLS rendition while AirPlaying or in picture in picture. */
interface IosPlayer {
    fun view(): UIView
    fun load(url: String, startAt: Double, play: Boolean)
    fun play()
    fun pause()
    fun seek(seconds: Double)
    fun setRate(rate: Double)
    fun setMuted(muted: Boolean)
    /** The player's own loudness, 0–1. */
    fun setLevel(level: Double)
    /** The phone's media volume, 0–1 (negative when unknown), and setting it without the system's volume HUD. */
    fun systemVolume(): Double
    fun setSystemVolume(level: Double)
    fun state(): IosPlayerState
    /** `[{id, type: "audio"|"sub"|"video", lang, title, selected, codec, channels, forced}]`. */
    fun tracksJson(): String
    /** A track id from [tracksJson], or null for none. */
    fun selectAudio(id: String?)
    fun selectSubtitles(id: String?)
    /** Subtitles drawn this far up, as a fraction of the picture, while the controls are showing. */
    fun liftSubtitles(fraction: Double)
    /** Plain subtitles' look: [size] "small" | "medium" | "large", [background] "none" | "shadow" | "box". Styled ASS keeps its own. */
    fun subtitleLook(size: String, background: String)
    fun setEvents(events: IosPlayerEvents?)
    fun setHlsSource(source: IosHlsSource?)
    /** Lock screen and Control Center. */
    fun nowPlaying(title: String, subtitle: String, artwork: String?)
    fun canPip(): Boolean
    fun startPip()
    /** The AirPlay button (AVRoutePickerView). */
    fun routeButton(): UIView
    fun dispose()
}

/** Background URLSession downloads into the app's own storage. */
interface IosDownloader {
    /** [expected]: the file's size as its listing gave it (0 when unknown), for progress when the server sends no length. */
    fun start(key: String, url: String, expected: Long)
    fun cancel(key: String)
    /** The finished file's path, or null. */
    fun file(key: String): String?
    fun keys(): List<String>
    /** Whether downloads may use mobile data (Settings → Downloads → Wi-Fi only turns it off). */
    fun setCellular(allowed: Boolean)
    fun listen(events: IosDownloadEvents)
}

interface IosDownloadEvents {
    fun changed(key: String, progress: Double, done: Boolean, failed: Boolean)
}

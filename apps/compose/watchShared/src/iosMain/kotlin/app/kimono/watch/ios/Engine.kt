@file:OptIn(kotlinx.cinterop.ExperimentalForeignApi::class)

package app.kimono.watch.ios

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.viewinterop.UIKitInteropProperties
import androidx.compose.ui.viewinterop.UIKitView
import app.kimono.watch.EngineListener
import app.kimono.watch.PlaybackEngine
import app.kimono.watch.Thumbnails
import app.kimono.watch.TrackOption
import app.kimono.watch.model.TrackHints
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import platform.Foundation.NSLocale
import platform.Foundation.NSLocaleLanguageCode
import platform.Foundation.canonicalLanguageIdentifierFromString
import platform.Foundation.localeWithLocaleIdentifier

private val signsWords = listOf("signs", "songs", "forced", "s&s")

@Serializable
internal data class MpvTrack(
    val id: String,
    val type: String,
    val lang: String? = null,
    val title: String? = null,
    val selected: Boolean = false,
    val codec: String? = null,
    val channels: Int = 0,
    val forced: Boolean = false,
)

/**
 * The shared player's decoder on iPhone: libmpv through the Swift side, so
 * MKV, HEVC, 10-bit, HDR (EDR) and styled ASS subtitles play as they are.
 * Subtitles are drawn by mpv into the picture, so [Captions] is empty.
 */
class IosEngine(val player: IosPlayer) : PlaybackEngine {
    private val json = Json { ignoreUnknownKeys = true }
    private var last = player.state()
    /** Off by choice, as mpv has no "disabled" kind for a track type. */
    private var subtitlesOff = false

    private fun s() = player.state().also { last = it }

    override val position get() = s().position
    override val duration get() = last.duration
    override val buffered get() = last.buffered
    override val playing get() = s().playing
    override val playWhenReady get() = s().playWhenReady
    override val buffering get() = last.buffering
    override val ended get() = last.ended
    override val startFill get() = last.startFill.toFloat()
    val pip get() = last.pip

    override fun load(url: String, key: String, startAt: Double, play: Boolean) = player.load(url, startAt, play)
    override fun play() = player.play()
    override fun pause() = player.pause()
    override fun seekTo(seconds: Double) = player.seek(seconds)
    override fun setSpeed(speed: Float) = player.setRate(speed.toDouble())
    override fun setVolume(volume: Float) = player.setLevel(volume.toDouble())
    override fun deviceVolume(): Float? = player.systemVolume().takeIf { it >= 0 }?.toFloat()
    override fun setDeviceVolume(volume: Float) = player.setSystemVolume(volume.toDouble())
    /* The screen's brightness is the whole phone's on iPhone: what it was is put back on leaving. */
    private var brightnessBefore: Double? = null
    override fun brightness(): Float? = platform.UIKit.UIScreen.mainScreen.brightness.toFloat()
    override fun setBrightness(level: Float) {
        val screen = platform.UIKit.UIScreen.mainScreen
        if (brightnessBefore == null) brightnessBefore = screen.brightness
        screen.brightness = level.coerceIn(0f, 1f).toDouble()
    }
    override fun restoreBrightness() { brightnessBefore?.let { platform.UIKit.UIScreen.mainScreen.brightness = it }; brightnessBefore = null }
    override fun subtitleLook(size: String, background: String) = player.subtitleLook(size, background)

    internal fun tracks(): List<MpvTrack> = runCatching { json.decodeFromString<List<MpvTrack>>(player.tracksJson()) }.getOrDefault(emptyList())

    override fun applyHints(hints: TrackHints) {
        val all = tracks()
        hints.audio?.let { want ->
            val tags = want.tags + want.language
            all.firstOrNull { it.type == "audio" && matches(it.lang, tags) }?.let { player.selectAudio(it.id) }
        }
        val subs = hints.subtitles
        if (subs == null) { subtitlesOff = true; player.selectSubtitles(null); return }
        subtitlesOff = false
        val words = subs.signsTitles.ifEmpty { signsWords }
        val inLanguage = all.filter { it.type == "sub" && matches(it.lang, subs.tags + subs.language) }
        fun isSigns(t: MpvTrack) = t.forced || (t.title?.lowercase()?.let { l -> words.any { it in l } } == true)
        val pick = if (subs.kind == "signs") inLanguage.firstOrNull(::isSigns) else inLanguage.firstOrNull { !isSigns(it) } ?: inLanguage.firstOrNull()
        if (pick != null) player.selectSubtitles(pick.id)
        else if (subs.kind == "signs") { subtitlesOff = true; player.selectSubtitles(null) }
    }

    /** mpv decodes everything in software when VideoToolbox can't, so nothing here is beyond it. */
    override fun videoBeyondDecoders() = false

    override fun audioOptions(): List<TrackOption> = tracks().filter { it.type == "audio" }.mapIndexed { i, t ->
        TrackOption(t.id, audioLabel(t, i), language2(t.lang), false, t.selected)
    }

    override fun subtitleOptions(): List<TrackOption> {
        val subs = tracks().filter { it.type == "sub" }
        val off = TrackOption(null, "Off", null, false, subtitlesOff || subs.none { it.selected })
        return listOf(off) + subs.map { t ->
            val signs = t.forced || t.title?.lowercase()?.let { l -> signsWords.any { it in l } } == true
            TrackOption(t.id, textLabel(t, signs), language2(t.lang), signs, t.selected && !off.selected)
        }
    }

    override fun selectAudio(option: TrackOption) = player.selectAudio(option.handle as? String)
    override fun selectSubtitles(option: TrackOption) {
        val id = option.handle as? String
        subtitlesOff = id == null
        player.selectSubtitles(id)
    }

    override fun listen(listener: EngineListener): () -> Unit {
        player.setEvents(object : IosPlayerEvents {
            override fun firstFrame() = listener.firstFrame()
            override fun error(decoder: Boolean, network: Boolean) = listener.error(decoder, network)
            override fun tracks() = listener.tracks()
            override fun shape(ratio: Double) = listener.aspect(ratio.toFloat())
            override fun playing(on: Boolean) = listener.playing(on)
            override fun userPaused(paused: Boolean) = listener.userPaused(paused)
        })
        return { player.setEvents(null) }
    }

    /** No storyboard from the API yet, and mpv reads no frames on the side: the episode's still stands in. */
    override fun thumbnails(url: String): Thumbnails = object : Thumbnails {
        override val frame: StateFlow<Pair<Int, ImageBitmap>?> = MutableStateFlow(null)
        override fun want(seconds: Double) {}
        override fun close() {}
    }

    @Composable
    override fun Picture(modifier: Modifier) {
        UIKitView(factory = { player.view() }, modifier = modifier, properties = UIKitInteropProperties(isInteractive = false, isNativeAccessibilityEnabled = false))
    }

    /** mpv draws subtitles itself (libass), inside the picture: this only tells it how far up to sit while the controls show. */
    @Composable
    override fun Captions(modifier: Modifier) {
        androidx.compose.foundation.layout.Box(modifier.onGloballyPositioned { c ->
            val outer = c.parentLayoutCoordinates?.size?.height ?: return@onGloballyPositioned
            if (outer > 0) player.liftSubtitles(((outer - c.size.height).toDouble() / outer).coerceIn(0.0, 0.5))
        })
    }

    companion object {
        private val english = NSLocale.localeWithLocaleIdentifier("en")

        /** "jpn", "ja", "ja-JP" → "ja". */
        fun language2(code: String?): String? {
            val c = code?.trim()?.lowercase()?.takeIf { it.isNotBlank() && it != "und" } ?: return null
            val canon = NSLocale.canonicalLanguageIdentifierFromString(c).substringBefore('-').substringBefore('_')
            return canon.takeIf { it.length == 2 } ?: c.take(2)
        }

        fun matches(language: String?, tags: List<String>): Boolean {
            val l = language?.lowercase() ?: return false
            val two = language2(l)
            return tags.any { t -> t.equals(l, true) || t.equals(l.substringBefore('-'), true) || (two != null && language2(t) == two) }
        }

        private fun languageName(code: String?): String? {
            val two = language2(code) ?: return null
            return english.displayNameForKey(NSLocaleLanguageCode, two)?.replaceFirstChar { it.uppercase() }
        }

        internal fun audioLabel(t: MpvTrack, i: Int): String {
            val name = languageName(t.lang) ?: t.title ?: "Track ${i + 1}"
            val ch = when (t.channels) { 8 -> " 7.1"; 6 -> " 5.1"; else -> "" }
            val atmos = if (t.title?.contains("atmos", true) == true) " Atmos" else ""
            val extra = t.title?.takeIf { it.isNotBlank() && languageName(t.lang) != null && !it.contains(name, true) && it.length < 28 }?.let { " – $it" } ?: ""
            return "$name$ch$atmos$extra"
        }

        internal fun textLabel(t: MpvTrack, signs: Boolean): String {
            val name = languageName(t.lang) ?: t.title ?: "Subtitles"
            val title = t.title
            return when {
                signs -> "$name – Signs & Songs"
                title?.contains("sdh", true) == true -> "$name (CC)"
                title != null && languageName(t.lang) != null && !title.contains(name, true) && title.length < 28 -> "$name – $title"
                else -> name
            }
        }
    }
}

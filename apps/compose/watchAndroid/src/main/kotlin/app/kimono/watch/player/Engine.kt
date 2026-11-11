@file:OptIn(UnstableApi::class)

package app.kimono.watch.player

import android.content.Context
import android.graphics.Color
import androidx.annotation.OptIn
import androidx.core.content.res.ResourcesCompat
import androidx.media3.common.C
import androidx.media3.common.Format
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.TrackSelectionOverride
import androidx.media3.common.Tracks
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.VideoSize
import android.view.SurfaceView
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.viewinterop.AndroidView
import app.kimono.watch.EngineListener
import app.kimono.watch.PlaybackEngine
import app.kimono.watch.Thumbnails
import app.kimono.watch.TrackOption
import androidx.media3.common.util.UnstableApi
import androidx.media3.cast.RemoteCastPlayer
import androidx.media3.cast.SessionAvailabilityListener
import com.google.android.gms.cast.framework.CastContext
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Text
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.Job
import kotlinx.coroutines.MainScope
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import androidx.media3.datasource.okhttp.OkHttpDataSource
import androidx.media3.exoplayer.DefaultLoadControl
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.trackselection.DefaultTrackSelector
import androidx.media3.extractor.DefaultExtractorsFactory
import androidx.media3.ui.CaptionStyleCompat
import androidx.media3.ui.SubtitleView
import app.kimono.watch.R
import app.kimono.watch.model.TrackHints
import io.github.peerless2012.ass.media.kt.buildWithAssSupport
import io.github.peerless2012.ass.media.type.AssRenderType
import okhttp3.OkHttpClient
import java.util.Locale
import java.util.concurrent.TimeUnit


private const val START_MS = 2_500
private val signsWords = listOf("signs", "songs", "forced", "s&s")

/**
 * The decoder side of the player: Media3 ExoPlayer with the ffmpeg audio
 * extension (AC-3, E-AC-3, DTS, TrueHD in software when there's no
 * passthrough), libass for styled anime subtitles, tunnelled playback on TV,
 * and the downloads cache read first so a downloaded episode plays offline.
 */
class Engine(private val context: Context, tv: Boolean, val subtitles: SubtitleView) : PlaybackEngine {
    val selector = DefaultTrackSelector(context).apply {
        setParameters(buildUponParameters().setTunnelingEnabled(tv).setAllowInvalidateSelectionsOnRendererCapabilitiesChange(true))
    }
    private val http = OkHttpClient.Builder().connectTimeout(20, TimeUnit.SECONDS).readTimeout(60, TimeUnit.SECONDS).build()
    private val source = Downloads.readThrough(context, OkHttpDataSource.Factory(http).setUserAgent("KimonoWatch"))

    val player: ExoPlayer = ExoPlayer.Builder(context)
        .setTrackSelector(selector)
        /* The last minute is kept, so skipping back plays from memory instead of asking the server again. */
        .setLoadControl(DefaultLoadControl.Builder().setBufferDurationsMs(20_000, 120_000, START_MS, 4_000).setBackBuffer(60_000, true).build())
        .setSeekBackIncrementMs(10_000).setSeekForwardIncrementMs(10_000)
        .setHandleAudioBecomingNoisy(true)
        .setVideoChangeFrameRateStrategy(if (tv) C.VIDEO_CHANGE_FRAME_RATE_STRATEGY_ONLY_IF_SEAMLESS else C.VIDEO_CHANGE_FRAME_RATE_STRATEGY_OFF)
        .setAudioAttributes(androidx.media3.common.AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MOVIE).build(), true)
        .buildWithAssSupport(
            context,
            renderType = AssRenderType.OVERLAY_CANVAS,
            subtitleView = subtitles,
            dataSourceFactory = source,
            extractorsFactory = DefaultExtractorsFactory().setConstantBitrateSeekingEnabled(true),
            renderersFactory = DefaultRenderersFactory(context)
                .setExtensionRendererMode(DefaultRenderersFactory.EXTENSION_RENDERER_MODE_ON)
                .setEnableDecoderFallback(true),
        )

    private val onTv = tv
    private val captionFont = ResourcesCompat.getFont(context, R.font.zen_maru_medium)

    /*
     * Chromecast: while a TV is picked the TV plays the Portal's HLS rendition
     * and the phone is its remote; the phone's own player stops (no stream
     * held open) and picks up where the TV was when the cast ends.
     * None on Android TV, or without Google Play services.
     */
    private val remote: RemoteCastPlayer? = if (tv) null else runCatching {
        CastContext.getSharedInstance(context)
        RemoteCastPlayer.Builder(context).setSeekBackIncrementMs(10_000).setSeekForwardIncrementMs(10_000).build()
    }.getOrNull()
    /** The TV's name while casting, else null. */
    val castingTo = mutableStateOf<String?>(null)
    val casting get() = onRemote
    /** Whether this phone can cast at all. */
    val canCast get() = remote != null
    /** The episode as a cast item from this many seconds in: the HLS address, title and still. Set by the player. */
    var castItem: (suspend (Double) -> MediaItem?)? = null
    private var onRemote = false
    private var local: Pair<String, String>? = null
    private var remoteAt = 0.0
    private var remoteStarted = false
    private val scope = MainScope()
    private var castJob: Job? = null
    private val active: Player get() = if (onRemote) remote ?: player else player

    private fun tvName() = runCatching { CastContext.getSharedInstance(context).sessionManager.currentCastSession?.castDevice?.friendlyName }.getOrNull() ?: "TV"

    private fun toTv(at: Double, play: Boolean) {
        val r = remote ?: return
        onRemote = true
        castingTo.value = tvName()
        remoteAt = at
        remoteStarted = false
        player.stop()
        castJob?.cancel()
        castJob = scope.launch {
            val item = castItem?.invoke(at)
            if (item == null) { toPhone(); return@launch }
            r.setMediaItem(item, (at * 1000).toLong())
            r.prepare()
            r.playWhenReady = play
        }
    }

    private fun toPhone() {
        if (!onRemote) return
        castJob?.cancel()
        onRemote = false
        castingTo.value = null
        val (url, key) = local ?: return
        load(url, key, remoteAt, play = false)
    }

    init {
        remote?.setSessionAvailabilityListener(object : SessionAvailabilityListener {
            override fun onCastSessionAvailable() { if (!onRemote && local != null) toTv(player.currentPosition / 1000.0, play = true) }
            override fun onCastSessionUnavailable() = toPhone()
        })
        subtitleLook("medium", "shadow")
        subtitles.setApplyEmbeddedStyles(true)
        /* Plain subtitles (SRT, WebVTT, PGS) reach the view only from here; libass draws ASS on its own overlay and sends no cues. */
        player.addListener(object : Player.Listener {
            override fun onCues(cueGroup: androidx.media3.common.text.CueGroup) = subtitles.setCues(cueGroup.cues)
        })
    }

    /**
     * Plain (text) subtitles in the house style: paper Zen Maru Gothic with an
     * ink outline, a shadow, or on a box; sized as a share of the picture,
     * larger on a phone held at arm's length. Styled ASS is drawn by libass as made.
     */
    override fun subtitleLook(size: String, background: String) {
        val paper = 0xFFF4E9E1.toInt(); val ink = 0xFF110C0A.toInt()
        subtitles.setStyle(when (background) {
            "box" -> CaptionStyleCompat(paper, 0xB8110C0A.toInt(), Color.TRANSPARENT, CaptionStyleCompat.EDGE_TYPE_NONE, Color.TRANSPARENT, captionFont)
            "none" -> CaptionStyleCompat(paper, Color.TRANSPARENT, Color.TRANSPARENT, CaptionStyleCompat.EDGE_TYPE_OUTLINE, ink, captionFont)
            else -> CaptionStyleCompat(paper, Color.TRANSPARENT, Color.TRANSPARENT, CaptionStyleCompat.EDGE_TYPE_DROP_SHADOW, 0xE6000000.toInt(), captionFont)
        })
        val share = when (size) { "small" -> 0.036f; "large" -> 0.054f; else -> 0.044f }
        subtitles.setFractionalTextSize(share * if (onTv) 1.15f else 1.4f)
    }

    override fun load(url: String, key: String, startAt: Double, play: Boolean) {
        local = url to key
        /* A TV already picked (before the player opened, or the next episode): it plays there. */
        if (remote?.isCastSessionAvailable == true) return toTv(startAt, play)
        val item = MediaItem.Builder().setUri(url).setCustomCacheKey(key).build()
        player.setMediaItem(item, (startAt * 1000).toLong().coerceAtLeast(0))
        player.prepare()
        player.playWhenReady = play
    }

    /** Switches on the audio and subtitles the server asked for, by the tags containers use. */
    override fun applyHints(hints: TrackHints) {
        /* The HLS rendition carries just the audio and subtitles asked for. */
        if (onRemote) return
        val tracks = player.currentTracks
        val p = selector.buildUponParameters()
        hints.audio?.let { want ->
            tracks.groups.firstOrNull { it.type == C.TRACK_TYPE_AUDIO && matches(it.getTrackFormat(0).language, want.tags + want.language) }
                ?.let { p.setOverrideForType(TrackSelectionOverride(it.mediaTrackGroup, 0)) }
                ?: p.setPreferredAudioLanguage(want.language)
        }
        val subs = hints.subtitles
        if (subs == null) {
            p.setTrackTypeDisabled(C.TRACK_TYPE_TEXT, true)
        } else {
            p.setTrackTypeDisabled(C.TRACK_TYPE_TEXT, false)
            val words = subs.signsTitles.ifEmpty { signsWords }
            /* Tracks this phone can draw, in the language by tag, else untagged ones titled with it ("English", "Eng [Full]"). */
            val text = tracks.groups.filter { it.type == C.TRACK_TYPE_TEXT }.sortedByDescending { it.isTrackSupported(0) }
            val name = languageName(subs.language)?.lowercase()
            val inLanguage = text.filter { matches(it.getTrackFormat(0).language, subs.tags + subs.language) }.ifEmpty {
                text.filter { g ->
                    val f = g.getTrackFormat(0)
                    language2(f.language) == null && f.label?.lowercase()?.let { l -> (name != null && name in l) || subs.tags.any { t -> t.length == 3 && Regex("\\b$t\\b").containsMatchIn(l) } } == true
                }
            }
            fun isSigns(g: Tracks.Group) = g.getTrackFormat(0).label?.lowercase()?.let { l -> words.any { it in l } } == true
            val pick = if (subs.kind == "signs") inLanguage.firstOrNull(::isSigns) else inLanguage.firstOrNull { !isSigns(it) } ?: inLanguage.firstOrNull()
            if (pick != null) p.setOverrideForType(TrackSelectionOverride(pick.mediaTrackGroup, 0))
            else if (subs.kind == "signs") p.setTrackTypeDisabled(C.TRACK_TYPE_TEXT, true)
            else p.setPreferredTextLanguage(subs.language)
        }
        selector.setParameters(p)
    }

    private fun matches(language: String?, tags: List<String>): Boolean {
        val l = language?.lowercase() ?: return false
        val base = l.substringBefore('-')
        return tags.any { it.equals(l, true) || it.equals(base, true) || runCatching { Locale.forLanguageTag(it).isO3Language }.getOrNull().equals(base, true) }
    }

    override fun audioOptions(): List<TrackOption> = if (onRemote) emptyList() else player.currentTracks.groups.filter { it.type == C.TRACK_TYPE_AUDIO }.mapIndexed { i, g ->
        val f = g.getTrackFormat(0)
        TrackOption(g, audioLabel(f, i), language2(f.language), false, g.isSelected)
    }

    override fun subtitleOptions(): List<TrackOption> {
        if (onRemote) return emptyList()
        val groups = player.currentTracks.groups.filter { it.type == C.TRACK_TYPE_TEXT }
        val off = TrackOption(null, "Off", null, false, groups.none { it.isSelected } || selector.parameters.disabledTrackTypes.contains(C.TRACK_TYPE_TEXT))
        return listOf(off) + groups.map { g ->
            val f = g.getTrackFormat(0)
            val signs = f.label?.lowercase()?.let { l -> signsWords.any { it in l } } == true
            TrackOption(g, textLabel(f, signs), language2(f.language), signs, g.isSelected && !off.selected)
        }
    }


    /**
     * Whether the video picked is a profile no decoder here really handles:
     * 10-bit H.264 (common in anime) and 10-bit HEVC, which some decoders accept and then garble.
     */
    override fun videoBeyondDecoders(): Boolean {
        if (onRemote) return false
        val f = player.currentTracks.groups.firstOrNull { it.type == C.TRACK_TYPE_VIDEO }?.getTrackFormat(0) ?: return false
        if (f.sampleMimeType == MimeTypes.VIDEO_AV1) {
            val hw = android.os.Build.VERSION.SDK_INT >= 29 && android.media.MediaCodecList(android.media.MediaCodecList.REGULAR_CODECS).codecInfos.any { !it.isEncoder && it.isHardwareAccelerated && it.supportedTypes.any { t -> t.equals("video/av01", true) } }
            if (!hw) return true
        }
        val codecs = f.codecs?.lowercase() ?: return false
        val (mime, profile) = when {
            codecs.startsWith("avc1.6e") || codecs.startsWith("avc3.6e") -> "video/avc" to android.media.MediaCodecInfo.CodecProfileLevel.AVCProfileHigh10
            codecs.startsWith("avc1.7a") || codecs.startsWith("avc1.f4") -> "video/avc" to android.media.MediaCodecInfo.CodecProfileLevel.AVCProfileHigh422
            codecs.startsWith("hvc1.2") || codecs.startsWith("hev1.2") -> "video/hevc" to android.media.MediaCodecInfo.CodecProfileLevel.HEVCProfileMain10
            else -> return false
        }
        val infos = android.media.MediaCodecList(android.media.MediaCodecList.REGULAR_CODECS).codecInfos.filter { !it.isEncoder }
        val ok = infos.any { info -> info.supportedTypes.any { t -> t.equals(mime, true) && runCatching { info.getCapabilitiesForType(t).profileLevels.any { it.profile == profile } }.getOrDefault(false) } }
        return !ok
    }

    private fun select(option: TrackOption, type: Int) {
        val p = selector.buildUponParameters()
        val group = option.handle as? Tracks.Group
        if (group == null) p.setTrackTypeDisabled(type, true)
        else p.setTrackTypeDisabled(type, false).setOverrideForType(TrackSelectionOverride(group.mediaTrackGroup, 0))
        selector.setParameters(p)
    }
    override fun selectAudio(option: TrackOption) = select(option, C.TRACK_TYPE_AUDIO)
    override fun selectSubtitles(option: TrackOption) = select(option, C.TRACK_TYPE_TEXT)

    /* While the TV is still starting, it's where the phone was. */
    override val position get() = if (onRemote) (if (remoteStarted) remote!!.currentPosition / 1000.0 else remoteAt).also { remoteAt = it } else player.currentPosition / 1000.0
    override val duration get() = active.duration.takeIf { it != C.TIME_UNSET && it > 0 }?.div(1000.0) ?: 0.0
    override val buffered get() = active.bufferedPosition / 1000.0
    override val playing get() = active.isPlaying
    override val playWhenReady get() = active.playWhenReady
    override val buffering get() = if (onRemote) !remoteStarted || remote!!.playbackState == Player.STATE_BUFFERING else player.playbackState == Player.STATE_BUFFERING
    override val ended get() = active.playbackState == Player.STATE_ENDED
    /* ExoPlayer starts once this much is buffered ahead (bufferForPlaybackMs below). */
    override val startFill get() = if (onRemote) (if (remoteStarted) 1f else 0f)
        else if (player.playbackState == Player.STATE_IDLE) 0f else ((player.bufferedPosition - player.currentPosition) / START_MS.toFloat()).coerceIn(0f, 1f)
    override fun play() = active.play()
    override fun pause() = active.pause()
    override fun seekTo(seconds: Double) { if (onRemote && !remoteStarted) remoteAt = seconds; active.seekTo((seconds * 1000).toLong()) }
    override fun setSpeed(speed: Float) = active.setPlaybackSpeed(speed)
    override fun setVolume(volume: Float) { player.volume = volume }
    private val audio = context.getSystemService(Context.AUDIO_SERVICE) as android.media.AudioManager
    private val musicMax get() = audio.getStreamMaxVolume(android.media.AudioManager.STREAM_MUSIC)
    /* Casting, the slider and the side buttons are the TV's volume. */
    private val tvMax get() = remote?.deviceInfo?.maxVolume ?: 0
    override fun deviceVolume(): Float? = when {
        onRemote -> if (tvMax > 0) remote!!.deviceVolume / tvMax.toFloat() else null
        onTv || audio.isVolumeFixed || musicMax <= 0 -> null
        else -> audio.getStreamVolume(android.media.AudioManager.STREAM_MUSIC) / musicMax.toFloat()
    }
    /** The phone's volume buttons while casting: a step on the TV. */
    fun stepTvVolume(up: Boolean) { remote?.let { if (up) it.increaseDeviceVolume(0) else it.decreaseDeviceVolume(0) } }
    /* Brightness is the player window's own: it ends with the player, the phone's setting untouched. */
    private val window get() = (context as? android.app.Activity)?.window
    override fun brightness(): Float? {
        val w = window ?: return null
        if (onTv) return null
        val own = w.attributes.screenBrightness
        if (own >= 0f) return own
        return runCatching { android.provider.Settings.System.getInt(context.contentResolver, android.provider.Settings.System.SCREEN_BRIGHTNESS) / 255f }.getOrDefault(0.5f).coerceIn(0f, 1f)
    }
    override fun setBrightness(level: Float) {
        val w = window ?: return
        w.attributes = w.attributes.apply { screenBrightness = level.coerceIn(0.01f, 1f) }
    }
    override fun restoreBrightness() {
        val w = window ?: return
        w.attributes = w.attributes.apply { screenBrightness = android.view.WindowManager.LayoutParams.BRIGHTNESS_OVERRIDE_NONE }
    }
    /* No flags: the slider on screen is the indicator, not the system's panel. */
    override fun setDeviceVolume(volume: Float) {
        if (onRemote) { if (tvMax > 0) remote?.setDeviceVolume(kotlin.math.round(volume.coerceIn(0f, 1f) * tvMax).toInt(), 0); return }
        runCatching { audio.setStreamVolume(android.media.AudioManager.STREAM_MUSIC, kotlin.math.round(volume.coerceIn(0f, 1f) * musicMax).toInt(), 0) }
    }

    override fun listen(listener: EngineListener): () -> Unit {
        /* The phone's player is heard only while it's the one playing; the TV's while casting. */
        val l = object : Player.Listener {
            override fun onRenderedFirstFrame() { if (!onRemote) listener.firstFrame() }
            override fun onPlayerError(error: PlaybackException) { if (!onRemote) listener.error(decoder = error.errorCode in 4000..4999, network = error.errorCode in 2000..2999) }
            override fun onTracksChanged(tracks: Tracks) { if (!onRemote && tracks.groups.isNotEmpty()) listener.tracks() }
            override fun onVideoSizeChanged(videoSize: VideoSize) { if (videoSize.width > 0 && videoSize.height > 0) listener.aspect(videoSize.width * videoSize.pixelWidthHeightRatio / videoSize.height) }
            override fun onIsPlayingChanged(isPlaying: Boolean) { if (!onRemote) listener.playing(isPlaying) }
            override fun onPlayWhenReadyChanged(playWhenReady: Boolean, reason: Int) { if (!onRemote) listener.userPaused(!playWhenReady) }
        }
        val r = object : Player.Listener {
            override fun onPlaybackStateChanged(state: Int) {
                if (onRemote && state == Player.STATE_READY && !remoteStarted) { remoteStarted = true; listener.firstFrame() }
            }
            /* The receiver lost the stream: asked again like a dropped one. */
            override fun onPlayerError(error: PlaybackException) { if (onRemote) listener.error(decoder = false, network = true) }
            override fun onIsPlayingChanged(isPlaying: Boolean) { if (onRemote) listener.playing(isPlaying) }
            override fun onPlayWhenReadyChanged(playWhenReady: Boolean, reason: Int) { if (onRemote && remoteStarted) listener.userPaused(!playWhenReady) }
        }
        player.addListener(l)
        remote?.addListener(r)
        return { player.removeListener(l); remote?.removeListener(r) }
    }

    override fun thumbnails(url: String): Thumbnails = Thumbs(url)

    @Composable
    override fun Picture(modifier: Modifier) {
        Box(modifier) {
            AndroidView({ SurfaceView(it).also { v -> player.setVideoSurfaceView(v) } }, Modifier.fillMaxSize())
            castingTo.value?.let { name ->
                Box(Modifier.fillMaxSize().background(androidx.compose.ui.graphics.Color.Black), contentAlignment = Alignment.Center) {
                    Text("Playing on $name", color = androidx.compose.ui.graphics.Color(0xFFF4E9E1), fontSize = 15.sp, fontWeight = FontWeight.SemiBold)
                }
            }
        }
    }

    @Composable
    override fun Captions(modifier: Modifier) {
        if (castingTo.value == null) AndroidView({ subtitles }, modifier)
    }

    /** Leaving the player stops the TV too: nothing would be left saying where it got to. */
    fun release() {
        scope.cancel()
        remote?.let { if (onRemote) it.stop(); it.setSessionAvailabilityListener(null); it.release() }
        player.release()
    }

    companion object {
        fun language2(code: String?): String? = code?.takeIf { it.isNotBlank() && it != C.LANGUAGE_UNDETERMINED }?.let { Locale.forLanguageTag(it).language.takeIf { l -> l.length == 2 } ?: it.take(2) }

        private fun languageName(code: String?) = code?.takeIf { it.isNotBlank() && it != C.LANGUAGE_UNDETERMINED }?.let { Locale.forLanguageTag(it).getDisplayLanguage(Locale.ENGLISH).replaceFirstChar { c -> c.uppercase() } }

        fun audioLabel(f: Format, i: Int): String {
            val name = languageName(f.language) ?: f.label ?: "Track ${i + 1}"
            val ch = when (f.channelCount) { 8 -> " 7.1"; 6 -> " 5.1"; 2, 1 -> ""; else -> "" }
            val atmos = if (f.sampleMimeType == MimeTypes.AUDIO_E_AC3_JOC || f.label?.contains("atmos", true) == true) " Atmos" else ""
            val extra = f.label?.takeIf { it.isNotBlank() && languageName(f.language) != null && !it.contains(name, true) && it.length < 28 }?.let { " – $it" } ?: ""
            return "$name$ch$atmos$extra"
        }

        fun textLabel(f: Format, signs: Boolean): String {
            val name = languageName(f.language) ?: f.label ?: "Subtitles"
            return when {
                signs -> "$name – Signs & Songs"
                f.label?.contains("sdh", true) == true || f.roleFlags and C.ROLE_FLAG_DESCRIBES_MUSIC_AND_SOUND != 0 -> "$name (CC)"
                f.label != null && languageName(f.language) != null && !f.label!!.contains(name, true) && f.label!!.length < 28 -> "$name – ${f.label}"
                else -> name
            }
        }
    }
}

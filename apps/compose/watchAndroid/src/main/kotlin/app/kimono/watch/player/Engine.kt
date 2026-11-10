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
import androidx.media3.common.util.UnstableApi
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

/** A track as the audio & subtitles sheet lists it. */
data class TrackOption(val group: Tracks.Group?, val index: Int, val label: String, val language: String?, val signs: Boolean, val selected: Boolean)

private val signsWords = listOf("signs", "songs", "forced", "s&s")

/**
 * The decoder side of the player: Media3 ExoPlayer with the ffmpeg audio
 * extension (AC-3, E-AC-3, DTS, TrueHD in software when there's no
 * passthrough), libass for styled anime subtitles, tunnelled playback on TV,
 * and the downloads cache read first so a downloaded episode plays offline.
 */
class Engine(context: Context, tv: Boolean, val subtitles: SubtitleView) {
    val selector = DefaultTrackSelector(context).apply {
        setParameters(buildUponParameters().setTunnelingEnabled(tv).setAllowInvalidateSelectionsOnRendererCapabilitiesChange(true))
    }
    private val http = OkHttpClient.Builder().connectTimeout(20, TimeUnit.SECONDS).readTimeout(60, TimeUnit.SECONDS).build()
    private val source = Downloads.readThrough(context, OkHttpDataSource.Factory(http).setUserAgent("KimonoWatch"))

    val player: ExoPlayer = ExoPlayer.Builder(context)
        .setTrackSelector(selector)
        .setLoadControl(DefaultLoadControl.Builder().setBufferDurationsMs(20_000, 120_000, 2_000, 4_000).build())
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

    init {
        /* Plain subtitles as the demo draws them: white on a soft dark box, Zen Maru Gothic. */
        subtitles.setStyle(CaptionStyleCompat(Color.WHITE, 0x8C000000.toInt(), Color.TRANSPARENT, CaptionStyleCompat.EDGE_TYPE_NONE, Color.TRANSPARENT,
            ResourcesCompat.getFont(context, R.font.zen_maru_medium)))
        subtitles.setFractionalTextSize(if (tv) 0.052f else 0.065f)
        subtitles.setApplyEmbeddedStyles(true)
    }

    fun load(url: String, key: String, startAt: Double) {
        val item = MediaItem.Builder().setUri(url).setCustomCacheKey(key).build()
        player.setMediaItem(item, (startAt * 1000).toLong().coerceAtLeast(0))
        player.prepare()
        player.playWhenReady = true
    }

    /** Switches on the audio and subtitles the server asked for, by the tags containers use. */
    fun applyHints(hints: TrackHints) {
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
            val inLanguage = tracks.groups.filter { it.type == C.TRACK_TYPE_TEXT && matches(it.getTrackFormat(0).language, subs.tags + subs.language) }
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
        return tags.any { it.equals(l, true) || it.equals(base, true) || Locale.forLanguageTag(it).isO3Language.equals(base, true) }
    }

    fun audioOptions(): List<TrackOption> = player.currentTracks.groups.filter { it.type == C.TRACK_TYPE_AUDIO }.mapIndexed { i, g ->
        val f = g.getTrackFormat(0)
        TrackOption(g, 0, audioLabel(f, i), language2(f.language), false, g.isSelected)
    }

    fun subtitleOptions(): List<TrackOption> {
        val groups = player.currentTracks.groups.filter { it.type == C.TRACK_TYPE_TEXT }
        val off = TrackOption(null, 0, "Off", null, false, groups.none { it.isSelected } || selector.parameters.disabledTrackTypes.contains(C.TRACK_TYPE_TEXT))
        return listOf(off) + groups.map { g ->
            val f = g.getTrackFormat(0)
            val signs = f.label?.lowercase()?.let { l -> signsWords.any { it in l } } == true
            TrackOption(g, 0, textLabel(f, signs), language2(f.language), signs, g.isSelected && !off.selected)
        }
    }

    fun select(option: TrackOption, type: Int) {
        val p = selector.buildUponParameters()
        if (option.group == null) p.setTrackTypeDisabled(type, true)
        else p.setTrackTypeDisabled(type, false).setOverrideForType(TrackSelectionOverride(option.group.mediaTrackGroup, option.index))
        selector.setParameters(p)
    }

    /**
     * Whether the video picked is a profile no decoder here really handles:
     * 10-bit H.264 (common in anime) and 10-bit HEVC, which some decoders accept and then garble.
     */
    fun videoBeyondDecoders(): Boolean {
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

    fun release() { player.release() }

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

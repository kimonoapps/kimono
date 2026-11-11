import AVFoundation
import AVKit
import Libmpv
import MediaPlayer
import UIKit
import WatchShared

/// The surface mpv draws on (gpu-next on Vulkan through MoltenVK).
final class MPVLayer: CAMetalLayer {
    /* MoltenVK sets the drawable to 1×1 to finish a presentation; that flickers and can stick (mpv #13651). */
    override var drawableSize: CGSize {
        get { super.drawableSize }
        set { if Int(newValue.width) > 1 && Int(newValue.height) > 1 { super.drawableSize = newValue } }
    }

    /* target-colorspace-hint turns EDR on from mpv's thread; the screen only switches when it's set on the main one. */
    override var wantsExtendedDynamicRangeContent: Bool {
        get { super.wantsExtendedDynamicRangeContent }
        set {
            if Thread.isMainThread { super.wantsExtendedDynamicRangeContent = newValue }
            else { DispatchQueue.main.sync { super.wantsExtendedDynamicRangeContent = newValue } }
        }
    }
}

/// mpv's layer is a sublayer, not the view's own: MoltenVK sets it up from mpv's thread, which UIKit refuses for a backing layer.
final class MPVView: UIView {
    let metal = MPVLayer()

    override init(frame: CGRect) {
        super.init(frame: frame)
        layer.addSublayer(metal)
    }

    required init?(coder: NSCoder) { fatalError() }

    override func layoutSubviews() {
        super.layoutSubviews()
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        metal.frame = bounds
        /* MoltenVK set the drawable's size when the swapchain was made; it doesn't follow the bounds by itself. */
        let size = CGSize(width: bounds.width * metal.contentsScale, height: bounds.height * metal.contentsScale)
        if size.width > 1, size.height > 1, metal.drawableSize != size { metal.drawableSize = size }
        CATransaction.commit()
    }
}

final class AVView: UIView {
    override class var layerClass: AnyClass { AVPlayerLayer.self }
    var playerLayer: AVPlayerLayer { layer as! AVPlayerLayer }
}

/// mpv's picture, AVPlayer's picture (AirPlay, picture in picture), and a note while it's on another screen.
final class PlayerView: UIView {
    let mpv = MPVView()
    /// Joined a window: mpv's surface has a real size now.
    var attached: (() -> Void)?

    override func didMoveToWindow() {
        super.didMoveToWindow()
        if window != nil { setNeedsLayout(); layoutIfNeeded(); attached?() }
    }
    let av = AVView()
    let away = UIStackView()
    let awayName = UILabel()

    override init(frame: CGRect) {
        super.init(frame: frame)
        backgroundColor = .black
        isUserInteractionEnabled = false
        mpv.metal.contentsScale = UIScreen.main.nativeScale
        mpv.metal.framebufferOnly = true
        mpv.metal.backgroundColor = UIColor.black.cgColor
        av.playerLayer.videoGravity = .resizeAspect
        av.isHidden = true
        let icon = UIImageView(image: UIImage(systemName: "airplayvideo", withConfiguration: UIImage.SymbolConfiguration(pointSize: 44, weight: .light)))
        icon.tintColor = UIColor(white: 1, alpha: 0.8)
        awayName.textColor = UIColor(white: 1, alpha: 0.8)
        awayName.font = UIFont(name: "ZenMaruGothic-Medium", size: 15) ?? .systemFont(ofSize: 15, weight: .medium)
        away.axis = .vertical
        away.alignment = .center
        away.spacing = 12
        away.addArrangedSubview(icon)
        away.addArrangedSubview(awayName)
        away.isHidden = true
        /* AVPlayer's picture sits under mpv's: the muted copy kept ready for picture in picture plays there unseen. */
        [av, mpv, away].forEach(addSubview)
    }

    required init?(coder: NSCoder) { fatalError() }

    override func layoutSubviews() {
        super.layoutSubviews()
        mpv.frame = bounds
        av.frame = bounds
        away.sizeToFit()
        away.center = CGPoint(x: bounds.midX, y: bounds.midY)
    }
}

/**
 * Kimono Watch's player on iPhone. libmpv plays the file as it is (MKV, HEVC,
 * 10-bit, HDR with EDR, styled ASS subtitles with their fonts); mpv can't
 * AirPlay or float in picture in picture, so for those the same episode's
 * HLS rendition plays through AVPlayer from the same moment, and mpv takes
 * over again when it ends. Nothing plays with the app away except those two.
 * So that leaving the app floats the episode at once, that rendition plays
 * muted and in step under mpv's picture; iOS picks it up as the app goes.
 */
final class MPVPlayer: NSObject, IosPlayer, AVPictureInPictureControllerDelegate, @unchecked Sendable {
    private let preview: Bool
    private let screen = PlayerView(frame: CGRect(x: 0, y: 0, width: 640, height: 360))
    private var mpv: OpaquePointer?
    private let queue = DispatchQueue(label: "watch.mpv", qos: .userInitiated)
    private var events: IosPlayerEvents?
    private var hls: IosHlsSource?
    private var disposed = false

    /* mpv's state, kept on the main thread from its events. */
    private var loaded = false
    private var paused = true
    private var coreIdle = true
    private var pausedForCache = false
    private var eof = false
    private var framed = false
    private var lift = -1.0

    /* The AVPlayer side. */
    private enum Why { case airplay, pip }
    private var why: Why?
    private var avPlayer: AVPlayer?
    private var avObservations: [NSKeyValueObservation] = []
    private var avDuration = 0.0
    private var pip: AVPictureInPictureController?
    private var pipObservation: NSKeyValueObservation?
    private var pipWanted = false
    private var asking = false

    /* The muted copy kept in step under mpv's picture, for picture in picture as the app is left. */
    private var shadow: AVPlayer?
    private var shadowReady = false
    /* A seek mpv hasn't finished: the muted copy keeps still, so the source is mpv's alone until it plays again. */
    private var seeks = 0
    private var seeking = false
    private var shadowAsking = false
    private var shadowObservation: NSKeyValueObservation?
    /// Bumped on every new file, so a late answer for the last one is dropped.
    private var generation = 0
    /// mpv's picture was dropped going away and wants starting again.
    private var pictureDropped = false

    /* The lock screen. */
    private var info: [String: Any] = [:]
    private var commands: [(MPRemoteCommand, Any)] = []
    private var tick: Timer?
    private var observers: [NSObjectProtocol] = []

    init(preview: Bool) {
        self.preview = preview
        super.init()
        start()
        if !preview { takeSession(); screen.addSubview(volumeView) }
        observe()
        /* A video output started while the view was off screen drew at no size: start it again on the real surface. */
        screen.attached = { [weak self] in
            guard let self, self.loaded, self.why == nil else { return }
            self.set("vid", "no")
            self.set("vid", "auto")
        }
    }

    // MARK: mpv

    private func start() {
        guard let handle = mpv_create() else { return }
        mpv = handle
        #if DEBUG
        mpv_request_log_messages(handle, "info")
        #else
        mpv_request_log_messages(handle, "error")
        #endif
        var wid = Int64(Int(bitPattern: Unmanaged.passUnretained(screen.mpv.metal).toOpaque()))
        mpv_set_option(handle, "wid", MPV_FORMAT_INT64, &wid)
        let fonts = Bundle.main.resourceURL?.appendingPathComponent("font").path ?? ""
        var options: [(String, String)] = [
            ("vo", "gpu-next"), ("gpu-api", "vulkan"), ("gpu-context", "moltenvk"),
            ("hwdec", "videotoolbox"), ("video-rotate", "no"),
            ("keep-open", "yes"), ("idle", "yes"), ("force-seekable", "yes"),
            ("user-agent", "KimonoWatch"), ("network-timeout", "60"),
            ("cache", "yes"), ("cache-pause-wait", "2.5"),
            ("demuxer-max-bytes", preview ? "40MiB" : "200MiB"), ("demuxer-max-back-bytes", preview ? "8MiB" : "160MiB"),
            ("demuxer-readahead-secs", preview ? "20" : "120"),
            ("input-default-bindings", "no"), ("input-vo-keyboard", "no"), ("osc", "no"), ("osd-level", "0"),
            /* Plain subtitles as the demo draws them: white on a soft dark box, Zen Maru Gothic. Styled ASS stays as made. */
            ("sub-auto", "no"), ("sub-fonts-dir", fonts), ("sub-font", "Zen Maru Gothic Medium"),
            ("sub-font-size", "44"), ("sub-color", "#FFFFFFFF"), ("sub-border-style", "background-box"),
            ("sub-back-color", "#8C000000"), ("sub-border-size", "6"), ("sub-shadow-offset", "0"), ("sub-margin-y", "26"),
            ("sub-ass-override", "no"), ("embeddedfonts", "yes"),
        ]
        if preview { options += [("mute", "yes"), ("sid", "no"), ("vd-lavc-skiploopfilter", "nonref")] }
        /* HDR passes to the screen (EDR) only where it has the headroom; elsewhere libplacebo tone-maps it. */
        if !preview && UIScreen.main.potentialEDRHeadroom > 1.0 { options.append(("target-colorspace-hint", "yes")) }
        for (name, value) in options { mpv_set_option_string(handle, name, value) }
        guard mpv_initialize(handle) >= 0 else { mpv_terminate_destroy(handle); mpv = nil; return }
        for (name, format) in [("pause", MPV_FORMAT_FLAG), ("core-idle", MPV_FORMAT_FLAG), ("paused-for-cache", MPV_FORMAT_FLAG),
                               ("eof-reached", MPV_FORMAT_FLAG), ("video-params/aspect", MPV_FORMAT_DOUBLE), ("track-list/count", MPV_FORMAT_INT64)] {
            mpv_observe_property(handle, 0, name, format)
        }
        mpv_set_wakeup_callback(handle, { context in
            guard let context else { return }
            Unmanaged<MPVPlayer>.fromOpaque(context).takeUnretainedValue().drain()
        }, Unmanaged.passRetained(self).toOpaque())
    }

    private func drain() {
        queue.async { [self] in
            while let h = mpv {
                guard let event = mpv_wait_event(h, 0)?.pointee, event.event_id != MPV_EVENT_NONE else { break }
                handle(event)
                if event.event_id == MPV_EVENT_SHUTDOWN { break }
            }
        }
    }

    private func handle(_ event: mpv_event) {
        #if DEBUG
        if event.event_id != MPV_EVENT_LOG_MESSAGE && event.event_id != MPV_EVENT_PROPERTY_CHANGE { NSLog("mpv event %@", String(cString: mpv_event_name(event.event_id))) }
        #endif
        switch event.event_id {
        case MPV_EVENT_PROPERTY_CHANGE:
            guard let property = event.data?.assumingMemoryBound(to: mpv_event_property.self).pointee else { return }
            let name = String(cString: property.name)
            let flag = property.format == MPV_FORMAT_FLAG ? (property.data?.assumingMemoryBound(to: Int32.self).pointee ?? 0) != 0 : false
            let double = property.format == MPV_FORMAT_DOUBLE ? property.data?.assumingMemoryBound(to: Double.self).pointee ?? 0 : 0
            let int = property.format == MPV_FORMAT_INT64 ? property.data?.assumingMemoryBound(to: Int64.self).pointee ?? 0 : 0
            DispatchQueue.main.async { [self] in
                guard !disposed else { return }
                switch name {
                case "pause":
                    paused = flag
                    if why == nil { events?.userPaused(paused: flag); nowPlayingTime(); follow() }
                case "core-idle":
                    coreIdle = flag
                    if why == nil { events?.playing(on: loaded && !flag) }
                case "paused-for-cache": pausedForCache = flag
                case "eof-reached": eof = flag
                case "video-params/aspect": if double > 0 { events?.shape(ratio: double) }
                /* Only once this load's file is open: a late count from the last file would hint the wrong tracks. */
                case "track-list/count": if int > 0 && loaded && why == nil { events?.tracks() }
                default: break
                }
            }
        case MPV_EVENT_FILE_LOADED:
            /* The tracks are all known now. Said here too, as the count alone stays quiet when the next file has as many tracks as the last. */
            DispatchQueue.main.async { [self] in
                loaded = true; eof = false
                guard !disposed, why == nil else { return }
                events?.tracks()
            }
        case MPV_EVENT_PLAYBACK_RESTART:
            DispatchQueue.main.async { [self] in
                guard !disposed else { return }
                if seeking {
                    /* Playing again: the muted copy catches up once mpv has a few seconds in hand. */
                    let seek = seeks
                    DispatchQueue.main.asyncAfter(deadline: .now() + 4) { [weak self] in
                        guard let self, self.seeks == seek, self.seeking else { return }
                        self.seeking = false
                        self.follow()
                    }
                }
                guard !framed else { return }
                framed = true
                events?.firstFrame()
                nowPlayingTime()
                prepareShadow()
            }
        case MPV_EVENT_END_FILE:
            guard let end = event.data?.assumingMemoryBound(to: mpv_event_end_file.self).pointee, end.reason == MPV_END_FILE_REASON_ERROR else { return }
            let decoder = end.error == MPV_ERROR_UNKNOWN_FORMAT.rawValue || end.error == MPV_ERROR_NOTHING_TO_PLAY.rawValue
            DispatchQueue.main.async { [self] in
                guard !disposed else { return }
                events?.error(decoder: decoder, network: !decoder)
            }
        case MPV_EVENT_LOG_MESSAGE:
            guard let message = event.data?.assumingMemoryBound(to: mpv_event_log_message.self).pointee else { return }
            NSLog("mpv %@: %@", String(cString: message.prefix), String(cString: message.text).trimmingCharacters(in: .newlines))
        default: break
        }
    }

    private func command(_ args: [String]) {
        guard let mpv else { return }
        var cargs = args.map { UnsafePointer<CChar>(strdup($0)) } + [nil]
        defer { cargs.forEach { free(UnsafeMutablePointer(mutating: $0)) } }
        mpv_command_async(mpv, 0, &cargs)
    }

    private func set(_ name: String, _ value: String) {
        guard let mpv else { return }
        mpv_set_property_string(mpv, name, value)
    }

    private func double(_ name: String) -> Double {
        guard let mpv, !disposed else { return 0 }
        var value = 0.0
        return mpv_get_property(mpv, name, MPV_FORMAT_DOUBLE, &value) >= 0 ? value : 0
    }

    private func string(_ name: String) -> String? {
        guard let mpv, !disposed, let c = mpv_get_property_string(mpv, name) else { return nil }
        defer { mpv_free(c) }
        return String(cString: c)
    }

    // MARK: IosPlayer

    func view() -> UIView { screen }

    func load(url: String, startAt: Double, play: Bool) {
        if why != nil { leaveAV(resume: false) }
        dropShadow()
        generation += 1
        seeking = false
        loaded = false; framed = false; eof = false; coreIdle = true
        set("pause", play ? "no" : "yes")
        paused = !play
        command(["loadfile", url, "replace", "-1", "start=\(max(0, startAt))"])
    }

    func play() {
        if let avPlayer, why != nil { avPlayer.play(); return }
        /* Background audio is off: playing from the lock screen with the app away waits for the app. */
        if !preview && UIApplication.shared.applicationState == .background { return }
        set("pause", "no")
    }

    func pause() {
        if let avPlayer, why != nil { avPlayer.pause(); return }
        set("pause", "yes")
    }

    func seek(seconds: Double) {
        if let avPlayer, why != nil {
            avPlayer.seek(to: CMTime(seconds: seconds, preferredTimescale: 600), toleranceBefore: .zero, toleranceAfter: .zero) { _ in self.nowPlayingTime() }
            return
        }
        /* The muted copy following at once had the packager reading the same spot too, so a seek took longer than opening afresh. */
        seeks += 1
        seeking = true
        shadow?.pause()
        command(["seek", String(seconds), "absolute"])
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { self.nowPlayingTime() }
        let seek = seeks
        DispatchQueue.main.asyncAfter(deadline: .now() + 30) { [weak self] in
            guard let self, self.seeks == seek, self.seeking else { return }
            self.seeking = false
            self.follow()
        }
    }

    func setRate(rate speed: Double) {
        set("speed", String(speed))
        if let avPlayer, why != nil, avPlayer.rate > 0 { avPlayer.rate = Float(speed) }
        follow()
    }

    func setMuted(muted: Bool) { set("mute", muted ? "yes" : "no") }

    private var level = 1.0

    func setLevel(level: Double) {
        self.level = max(0, min(1, level))
        set("volume", String(Int((self.level * 100).rounded())))
        avPlayer?.volume = Float(self.level)
    }

    /* The phone's volume is set through MPVolumeView's slider. While one sits in the window (inside its bounds, a point wide and barely visible), iOS keeps its volume HUD away, side buttons included. */
    private lazy var volumeView: MPVolumeView = {
        let v = MPVolumeView(frame: CGRect(x: 0, y: 0, width: 1, height: 1))
        v.alpha = 0.01
        v.clipsToBounds = true
        v.isUserInteractionEnabled = false
        return v
    }()

    func systemVolume() -> Double {
        if preview { return -1 }
        return Double(AVAudioSession.sharedInstance().outputVolume)
    }

    func setSystemVolume(level: Double) {
        if preview { return }
        if volumeView.superview == nil { screen.addSubview(volumeView) }
        guard let slider = volumeView.subviews.compactMap({ $0 as? UISlider }).first else { return }
        slider.setValue(Float(max(0, min(1, level))), animated: false)
        slider.sendActions(for: .valueChanged)
    }

    func state() -> IosPlayerState {
        if disposed { return IosPlayerState(position: 0, duration: 0, buffered: 0, playing: false, playWhenReady: false, buffering: false, ended: false, startFill: 0, pip: false) }
        if let avPlayer, why != nil {
            let item = avPlayer.currentItem
            let position = avPlayer.currentTime().seconds.isFinite ? avPlayer.currentTime().seconds : 0
            let itemDuration = item?.duration.seconds ?? .nan
            let duration = itemDuration.isFinite && itemDuration > 0 ? itemDuration : avDuration
            let buffered = item?.loadedTimeRanges.last.map { CMTimeRangeGetEnd($0.timeRangeValue).seconds } ?? position
            let status = avPlayer.timeControlStatus
            return IosPlayerState(
                position: position, duration: duration, buffered: buffered,
                playing: status == .playing, playWhenReady: status != .paused, buffering: status == .waitingToPlayAtSpecifiedRate,
                ended: duration > 0 && position >= duration - 0.5, startFill: 1, pip: pip?.isPictureInPictureActive ?? false
            )
        }
        let position = double("time-pos")
        let cached = double("demuxer-cache-time")
        let fill = framed ? 1 : min(1, double("demuxer-cache-duration") / 2.5)
        return IosPlayerState(
            position: position, duration: double("duration"), buffered: max(position, cached),
            playing: loaded && framed && !coreIdle && !paused, playWhenReady: !paused,
            buffering: loaded && (pausedForCache || (!paused && coreIdle && !eof)),
            ended: eof, startFill: fill, pip: false
        )
    }

    func tracksJson() -> String {
        var out: [[String: Any]] = []
        if let avPlayer, why != nil, let item = avPlayer.currentItem {
            /* The HLS rendition carries the one audio track asked for, and the text subtitles. */
            out.append(["id": "av-audio", "type": "audio", "lang": item.asset.tracks(withMediaType: .audio).first?.languageCode ?? "", "selected": true])
            if let group = item.asset.mediaSelectionGroup(forMediaCharacteristic: .legible) {
                let chosen = item.currentMediaSelection.selectedMediaOption(in: group)
                for (i, option) in group.options.enumerated() {
                    out.append(["id": "av-sub-\(i)", "type": "sub", "lang": option.extendedLanguageTag ?? option.locale?.identifier ?? "",
                                "title": option.displayName, "selected": option == chosen, "forced": option.hasMediaCharacteristic(.containsOnlyForcedSubtitles)])
                }
            }
        } else {
            let count = Int(string("track-list/count") ?? "0") ?? 0
            for i in 0..<count {
                let p = "track-list/\(i)/"
                guard let id = string(p + "id"), let type = string(p + "type") else { continue }
                var track: [String: Any] = ["id": id, "type": type, "selected": string(p + "selected") == "yes", "forced": string(p + "forced") == "yes"]
                if let lang = string(p + "lang") { track["lang"] = lang }
                if let title = string(p + "title") { track["title"] = title }
                if let codec = string(p + "codec") { track["codec"] = codec }
                if let channels = string(p + "demux-channel-count").flatMap(Int.init) { track["channels"] = channels }
                out.append(track)
            }
        }
        guard let data = try? JSONSerialization.data(withJSONObject: out) else { return "[]" }
        return String(data: data, encoding: .utf8) ?? "[]"
    }

    func selectAudio(id: String?) {
        if why != nil { return }
        set("aid", id ?? "no")
    }

    func selectSubtitles(id: String?) {
        if let item = avPlayer?.currentItem, why != nil {
            guard let group = item.asset.mediaSelectionGroup(forMediaCharacteristic: .legible) else { return }
            let index = id.flatMap { Int($0.replacingOccurrences(of: "av-sub-", with: "")) }
            item.select(index.flatMap { group.options.indices.contains($0) ? group.options[$0] : nil }, in: group)
            return
        }
        set("sid", id ?? "no")
    }

    /// Plain subtitles move up over the controls; mpv measures the margin against a 720-line picture.
    func liftSubtitles(fraction: Double) {
        let margin = (26 + fraction * 720).rounded()
        guard margin != lift else { return }
        lift = margin
        set("sub-margin-y", String(Int(margin)))
    }

    /// Plain subtitles in the house style: paper Zen Maru Gothic with an ink outline, a shadow, or on a box.
    /// Sizes are on mpv's 720-line scale; styled ASS keeps its own look (sub-ass-override stays off).
    func subtitleLook(size: String, background: String) {
        set("sub-font-size", size == "small" ? "36" : size == "large" ? "54" : "44")
        set("sub-color", "#FFF4E9E1")
        switch background {
        case "box":
            set("sub-border-style", "background-box"); set("sub-back-color", "#B8110C0A"); set("sub-border-size", "6"); set("sub-shadow-offset", "0")
        case "none":
            set("sub-border-style", "outline-and-shadow"); set("sub-border-color", "#FF110C0A"); set("sub-border-size", "2.5"); set("sub-shadow-offset", "0")
        default:
            set("sub-border-style", "outline-and-shadow"); set("sub-border-color", "#99110C0A"); set("sub-border-size", "1"); set("sub-shadow-color", "#E6000000"); set("sub-shadow-offset", "2.5")
        }
    }

    func setEvents(events: IosPlayerEvents?) { self.events = events }

    func setHlsSource(source: IosHlsSource?) { hls = source }

    func dispose() {
        guard !disposed else { return }
        disposed = true
        events = nil
        hls = nil
        tick?.invalidate()
        observers.forEach(NotificationCenter.default.removeObserver)
        observers = []
        pip?.stopPictureInPicture()
        pip = nil
        dropShadow()
        avObservations = []
        avPlayer?.pause()
        avPlayer = nil
        if !preview { giveBackSession() }
        if let handle = mpv {
            mpv = nil
            let me = Unmanaged.passUnretained(self)
            queue.async {
                mpv_set_wakeup_callback(handle, nil, nil)
                mpv_terminate_destroy(handle)
                DispatchQueue.main.async { me.release() }
            }
        }
    }

    // MARK: AirPlay and picture in picture, through AVPlayer on the HLS rendition

    func canPip() -> Bool {
        #if targetEnvironment(simulator)
        /* The simulator has no picture in picture; the button still hands over to the HLS rendition, to try that path. */
        return !preview
        #else
        return !preview && AVPictureInPictureController.isPictureInPictureSupported()
        #endif
    }

    func startPip() {
        /* The muted copy is ready: float it (the delegate hands over as it starts). */
        if why == nil, shadowReady, let pip, pip.isPictureInPicturePossible { pip.startPictureInPicture(); return }
        if why != nil {
            if let pip, pip.isPictureInPicturePossible { pip.startPictureInPicture() } else { pipWanted = true }
            return
        }
        pipWanted = true
        enterAV(.pip)
    }

    func routeButton() -> UIView {
        let picker = AVRoutePickerView(frame: CGRect(x: 0, y: 0, width: 48, height: 48))
        picker.prioritizesVideoDevices = true
        picker.tintColor = .white
        picker.activeTintColor = UIColor(red: 0xE9 / 255, green: 0x9A / 255, blue: 0xAE / 255, alpha: 1)
        picker.backgroundColor = .clear
        return picker
    }

    private func airplaying() -> Bool {
        AVAudioSession.sharedInstance().currentRoute.outputs.contains { $0.portType == .airPlay }
    }

    private func enterAV(_ reason: Why) {
        if why == nil && shadowReady {
            promote(reason)
            if reason == .pip { if let pip, pip.isPictureInPicturePossible { pip.startPictureInPicture() } else { pipWanted = true } }
            return
        }
        dropShadow()
        guard !asking, why == nil, let hls else { return }
        asking = true
        avDuration = double("duration")
        hls.ask { [weak self] url in
            DispatchQueue.main.async {
                guard let self, !self.disposed else { return }
                self.asking = false
                #if DEBUG
                NSLog("Kimono Watch: HLS rendition %@", url == nil ? "missing" : "ready")
                #endif
                guard let url, let target = URL(string: url) else { self.pipWanted = false; return }
                /* The packager answers the first playlist only once it has probed the file (up to ~20 s), longer than AVPlayer waits: ask first, patiently. */
                var warm = URLRequest(url: target)
                warm.timeoutInterval = 90
                self.asking = true
                URLSession.shared.dataTask(with: warm) { _, _, _ in
                    DispatchQueue.main.async { self.asking = false; self.switchToAV(reason, target: target) }
                }.resume()
            }
        }
    }

    /// AVPlayer takes over from where mpv has got to by now (the playlist may have taken a while).
    private func switchToAV(_ reason: Why, target: URL) {
        guard !disposed, why == nil else { return }
        if reason == .airplay && !airplaying() { return }
        let from = double("time-pos")
        let wasPlaying = !paused
        why = reason
        set("pause", "yes")
        let item = AVPlayerItem(url: target)
        item.preferredForwardBufferDuration = 30
        let player = AVPlayer(playerItem: item)
        player.volume = Float(level)
        player.allowsExternalPlayback = true
        player.usesExternalPlaybackWhileExternalScreenIsActive = true
        avPlayer = player
        screen.av.playerLayer.player = player
        screen.av.isHidden = false
        screen.mpv.isHidden = true
        watchAV(player, item: item, from: from, play: wasPlaying)
        preparePip()
        events?.tracks()
    }

    private func watchAV(_ player: AVPlayer, item: AVPlayerItem, from: Double, play: Bool, ready: Bool = false) {
        var started = ready
        avObservations = [
            item.observe(\.status, options: [.new]) { [weak self] item, _ in
                DispatchQueue.main.async {
                    guard let self, !started else { return }
                    if item.status == .readyToPlay {
                        started = true
                        NSLog("Kimono Watch: AVPlayer ready on the HLS rendition, from %.1f s", from)
                        if let group = item.asset.mediaSelectionGroup(forMediaCharacteristic: .legible), let wanted = group.defaultOption { item.select(wanted, in: group) }
                        player.seek(to: CMTime(seconds: from, preferredTimescale: 600), toleranceBefore: .zero, toleranceAfter: .zero) { _ in
                            if play || self.pipWanted || self.why == .airplay { player.play() }
                            self.nowPlayingTime()
                            /* Picture in picture may have become possible before the item was ready: start it now, not on the next trip away. */
                            if self.pipWanted, let pip = self.pip, pip.isPictureInPicturePossible { self.pipWanted = false; pip.startPictureInPicture() }
                        }
                    } else if item.status == .failed {
                        NSLog("Kimono Watch: the HLS rendition failed: %@", item.error?.localizedDescription ?? "")
                        self.leaveAV(resume: true)
                    }
                }
            },
            player.observe(\.timeControlStatus, options: [.new]) { [weak self] player, _ in
                DispatchQueue.main.async {
                    guard let self, self.why != nil else { return }
                    self.events?.playing(on: player.timeControlStatus == .playing)
                    self.nowPlayingTime()
                }
            },
            player.observe(\.rate, options: [.new]) { [weak self] player, _ in
                DispatchQueue.main.async {
                    guard let self, self.why != nil, started else { return }
                    self.events?.userPaused(paused: player.rate == 0)
                }
            },
            player.observe(\.isExternalPlaybackActive, options: [.initial, .new]) { [weak self] player, _ in
                DispatchQueue.main.async { self?.showAway(player.isExternalPlaybackActive) }
            },
        ]
    }

    private func showAway(_ on: Bool) {
        let name = AVAudioSession.sharedInstance().currentRoute.outputs.first { $0.portType == .airPlay }?.portName
        screen.awayName.text = name
        screen.away.isHidden = !on
        screen.setNeedsLayout()
    }

    private func preparePip() {
        guard !preview, AVPictureInPictureController.isPictureInPictureSupported() else { return }
        let controller = AVPictureInPictureController(playerLayer: screen.av.playerLayer)
        controller?.delegate = self
        controller?.canStartPictureInPictureAutomaticallyFromInline = true
        pip = controller
        pipObservation = controller?.observe(\.isPictureInPicturePossible, options: [.initial, .new]) { [weak self] controller, _ in
            DispatchQueue.main.async {
                guard let self, self.pipWanted, controller.isPictureInPicturePossible, self.avPlayer?.currentItem?.status == .readyToPlay else { return }
                self.pipWanted = false
                controller.startPictureInPicture()
            }
        }
    }

    /// Back to mpv, from where AVPlayer got to.
    private func leaveAV(resume: Bool) {
        guard let player = avPlayer else { why = nil; return }
        let at = player.currentTime().seconds
        let wasPlaying = player.timeControlStatus != .paused
        player.pause()
        avObservations = []
        pipObservation = nil
        pip?.delegate = nil
        pip = nil
        pipWanted = false
        screen.av.playerLayer.player = nil
        avPlayer = nil
        why = nil
        screen.av.isHidden = true
        screen.away.isHidden = true
        screen.mpv.isHidden = false
        guard resume else { return }
        if at.isFinite && at > 0 { command(["seek", String(at), "absolute"]) }
        let foreground = UIApplication.shared.applicationState != .background
        if foreground && pictureDropped { pictureDropped = false; set("vid", "auto") }
        set("pause", wasPlaying && foreground ? "no" : "yes")
        events?.tracks()
        /* Ready again for the next time the app is left. */
        DispatchQueue.main.asyncAfter(deadline: .now() + 1) { [weak self] in self?.prepareShadow() }
    }

    // MARK: The muted copy, for picture in picture as the app is left

    /// iOS floats a player as the app goes only if one is already playing inline; mpv isn't one.
    private func prepareShadow() {
        guard !preview, !disposed, framed, why == nil, shadow == nil, !shadowAsking, !asking, let hls,
              AVPictureInPictureController.isPictureInPictureSupported() else { return }
        shadowAsking = true
        let asked = generation
        hls.ask { [weak self] url in
            DispatchQueue.main.async {
                guard let self, !self.disposed, self.generation == asked else { return }
                guard let url, let target = URL(string: url) else { self.shadowAsking = false; return }
                /* The first playlist can take a while (the packager probes the file); ask first, patiently. */
                var warm = URLRequest(url: target)
                warm.timeoutInterval = 90
                URLSession.shared.dataTask(with: warm) { _, _, _ in
                    DispatchQueue.main.async {
                        self.shadowAsking = false
                        guard !self.disposed, self.generation == asked, self.why == nil, self.shadow == nil, !self.asking else { return }
                        self.startShadow(target)
                    }
                }.resume()
            }
        }
    }

    private func startShadow(_ target: URL) {
        let item = AVPlayerItem(url: target)
        item.preferredForwardBufferDuration = 10
        let player = AVPlayer(playerItem: item)
        player.isMuted = true
        player.allowsExternalPlayback = false
        shadow = player
        avDuration = double("duration")
        screen.av.playerLayer.player = player
        screen.av.isHidden = false
        preparePip()
        shadowObservation = item.observe(\.status, options: [.initial, .new]) { [weak self] item, _ in
            DispatchQueue.main.async {
                guard let self, self.shadow === player else { return }
                if item.status == .readyToPlay && !self.shadowReady {
                    self.shadowReady = true
                    if let group = item.asset.mediaSelectionGroup(forMediaCharacteristic: .legible), let wanted = group.defaultOption { item.select(wanted, in: group) }
                    self.follow(force: true)
                } else if item.status == .failed {
                    NSLog("Kimono Watch: the HLS rendition failed: %@", item.error?.localizedDescription ?? "")
                    self.dropShadow()
                }
            }
        }
    }

    /// Keeps the muted copy where mpv is, playing when it plays. Left alone while the app goes, so iOS can float it.
    private func follow(force: Bool = false) {
        guard let shadow, shadowReady, !seeking, why == nil, UIApplication.shared.applicationState == .active else { return }
        let at = double("time-pos")
        let now = shadow.currentTime().seconds
        if at > 0 && (force || !now.isFinite || abs(now - at) > 1.5) {
            shadow.seek(to: CMTime(seconds: at, preferredTimescale: 600), toleranceBefore: .zero, toleranceAfter: .zero)
        }
        let speed = Float(Double(string("speed") ?? "1") ?? 1)
        if loaded && !paused && !eof { if shadow.rate != speed { shadow.rate = speed } } else if shadow.rate != 0 { shadow.pause() }
    }

    private func dropShadow() {
        shadowAsking = false
        guard let player = shadow else { return }
        player.pause()
        shadowObservation = nil
        shadow = nil
        shadowReady = false
        if why == nil {
            pipObservation = nil
            pip?.delegate = nil
            pip = nil
            screen.av.playerLayer.player = nil
            screen.av.isHidden = true
        }
    }

    /// The muted copy becomes the player: sound on, mpv paused, from where mpv got to.
    private func promote(_ reason: Why) {
        guard let player = shadow, let item = player.currentItem, shadowReady, why == nil else { return }
        let from = double("time-pos")
        let wasPlaying = player.rate > 0 || !paused
        why = reason
        set("pause", "yes")
        shadowObservation = nil
        shadow = nil
        shadowReady = false
        avPlayer = player
        player.isMuted = false
        player.volume = Float(level)
        player.allowsExternalPlayback = true
        player.usesExternalPlaybackWhileExternalScreenIsActive = true
        screen.mpv.isHidden = true
        let now = player.currentTime().seconds
        if from > 0 && (!now.isFinite || abs(now - from) > 0.25) {
            player.seek(to: CMTime(seconds: from, preferredTimescale: 600), toleranceBefore: .zero, toleranceAfter: .zero)
        }
        watchAV(player, item: item, from: from, play: wasPlaying, ready: true)
        if wasPlaying { player.rate = Float(Double(string("speed") ?? "1") ?? 1) } else { player.pause() }
        events?.userPaused(paused: !wasPlaying)
        events?.playing(on: wasPlaying)
        nowPlayingTime()
        events?.tracks()
    }

    func pictureInPictureControllerWillStartPictureInPicture(_ controller: AVPictureInPictureController) {
        if why == nil { promote(.pip) }
    }

    func pictureInPictureController(_ controller: AVPictureInPictureController, failedToStartPictureInPictureWithError error: Error) {
        NSLog("Kimono Watch: picture in picture didn't start: %@", error.localizedDescription)
        if why == .pip && !airplaying() { leaveAV(resume: true) }
    }

    func pictureInPictureControllerDidStopPictureInPicture(_ controller: AVPictureInPictureController) {
        if why == .pip && !airplaying() { leaveAV(resume: true) }
    }

    func pictureInPictureController(_ controller: AVPictureInPictureController, restoreUserInterfaceForPictureInPictureStopWithCompletionHandler completion: @escaping (Bool) -> Void) {
        completion(true)
    }

    // MARK: The audio session, the lock screen, the app going away

    private func takeSession() {
        let session = AVAudioSession.sharedInstance()
        try? session.setCategory(.playback, mode: .moviePlayback, policy: .longFormVideo)
        try? session.setActive(true)
        let center = MPRemoteCommandCenter.shared()
        func on(_ command: MPRemoteCommand, _ handler: @escaping (MPRemoteCommandEvent) -> MPRemoteCommandHandlerStatus) {
            command.isEnabled = true
            commands.append((command, command.addTarget(handler: handler)))
        }
        on(center.playCommand) { [weak self] _ in self?.play(); return .success }
        on(center.pauseCommand) { [weak self] _ in self?.pause(); return .success }
        on(center.togglePlayPauseCommand) { [weak self] _ in
            guard let self else { return .commandFailed }
            if self.state().playWhenReady { self.pause() } else { self.play() }
            return .success
        }
        center.skipForwardCommand.preferredIntervals = [10]
        center.skipBackwardCommand.preferredIntervals = [10]
        on(center.skipForwardCommand) { [weak self] _ in guard let self else { return .commandFailed }; self.seek(seconds: self.state().position + 10); return .success }
        on(center.skipBackwardCommand) { [weak self] _ in guard let self else { return .commandFailed }; self.seek(seconds: max(0, self.state().position - 10)); return .success }
        on(center.changePlaybackPositionCommand) { [weak self] event in
            guard let self, let event = event as? MPChangePlaybackPositionCommandEvent else { return .commandFailed }
            self.seek(seconds: event.positionTime)
            return .success
        }
        tick = Timer.scheduledTimer(withTimeInterval: 5, repeats: true) { [weak self] _ in self?.nowPlayingTime(); self?.follow() }
    }

    private func giveBackSession() {
        commands.forEach { $0.0.removeTarget($0.1) }
        commands = []
        MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
        let session = AVAudioSession.sharedInstance()
        try? session.setActive(false, options: .notifyOthersOnDeactivation)
        try? session.setCategory(.ambient, mode: .moviePlayback)
    }

    func nowPlaying(title: String, subtitle: String, artwork: String?) {
        guard !preview else { return }
        info[MPMediaItemPropertyTitle] = title
        info[MPMediaItemPropertyArtist] = subtitle
        info[MPNowPlayingInfoPropertyMediaType] = MPNowPlayingInfoMediaType.video.rawValue
        info.removeValue(forKey: MPMediaItemPropertyArtwork)
        nowPlayingTime()
        guard let artwork, let url = URL(string: artwork) else { return }
        URLSession.shared.dataTask(with: url) { [weak self] data, _, _ in
            guard let data, let image = UIImage(data: data) else { return }
            DispatchQueue.main.async {
                guard let self, !self.disposed, self.info[MPMediaItemPropertyTitle] as? String == title else { return }
                self.info[MPMediaItemPropertyArtwork] = MPMediaItemArtwork(boundsSize: image.size) { _ in image }
                self.nowPlayingTime()
            }
        }.resume()
    }

    private func nowPlayingTime() {
        guard !preview, !disposed, info[MPMediaItemPropertyTitle] != nil else { return }
        let s = state()
        info[MPMediaItemPropertyPlaybackDuration] = s.duration
        info[MPNowPlayingInfoPropertyElapsedPlaybackTime] = s.position
        info[MPNowPlayingInfoPropertyPlaybackRate] = s.playing ? (Double(string("speed") ?? "1") ?? 1) : 0
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
    }

    private func observe() {
        let center = NotificationCenter.default
        observers.append(center.addObserver(forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: .main) { [weak self] _ in
            guard let self else { return }
            if let avPlayer = self.avPlayer, self.why != nil {
                /* Picture in picture and AirPlay go on; an AVPlayer shown in the app doesn't. */
                if !(self.pip?.isPictureInPictureActive ?? false) && !avPlayer.isExternalPlaybackActive { avPlayer.pause() }
                return
            }
            /* Background audio is off. The picture is dropped while away (mpv's surface comes back black otherwise). */
            self.set("pause", "yes")
            self.set("vid", "no")
            self.pictureDropped = true
            /* The muted copy is left playing so iOS can float it; if it didn't, it stops. */
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { [weak self] in
                guard let self, self.why == nil, UIApplication.shared.applicationState == .background else { return }
                self.shadow?.pause()
            }
        })
        observers.append(center.addObserver(forName: UIApplication.willEnterForegroundNotification, object: nil, queue: .main) { [weak self] _ in
            guard let self, self.why == nil else { return }
            self.pictureDropped = false
            self.set("vid", "auto")
        })
        observers.append(center.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in
            self?.follow(force: true)
        })
        guard !preview else { return }
        observers.append(center.addObserver(forName: AVAudioSession.interruptionNotification, object: nil, queue: .main) { [weak self] note in
            guard let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt, AVAudioSession.InterruptionType(rawValue: raw) == .began else { return }
            self?.pause()
        })
        /* An AirPlay screen picked: the HLS rendition goes to it; back to mpv when it's let go. */
        observers.append(center.addObserver(forName: AVAudioSession.routeChangeNotification, object: nil, queue: .main) { [weak self] _ in
            guard let self, !self.disposed else { return }
            let on = self.airplaying()
            if on && self.why == nil && self.loaded { self.enterAV(.airplay) }
            else if !on && self.why == .airplay && !(self.avPlayer?.isExternalPlaybackActive ?? false) { self.leaveAV(resume: true) }
            if let avPlayer = self.avPlayer { self.showAway(avPlayer.isExternalPlaybackActive) }
        })
    }
}

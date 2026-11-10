import AVFoundation
import CryptoKit
import Network
import Security
import UIKit
import VideoToolbox
import WatchShared

/// What the shared Watch app needs from iOS: the Keychain, what the screen and decoders can do, the player, downloads.
final class Host: NSObject, IosWatchHost, @unchecked Sendable {
    static let shared = Host()

    private let path = NWPathMonitor()
    private var cellular = false

    override init() {
        super.init()
        path.pathUpdateHandler = { [weak self] p in
            self?.cellular = p.usesInterfaceType(.cellular) && !p.usesInterfaceType(.wifi)
        }
        path.start(queue: DispatchQueue(label: "watch.path"))
        /* Browsing never stops anyone's music: the hero's preview is muted and ambient. The player takes over the session. */
        try? AVAudioSession.sharedInstance().setCategory(.ambient, mode: .moviePlayback)
    }

    // MARK: Keychain (this app's own: Watch shares nothing with the main Kimono app)

    private func query(_ key: String) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "app.kimono.watch", kSecAttrAccount as String: key]
    }

    func readKept(key: String) -> String? {
        var q = query(key)
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: AnyObject?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let data = out as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    func keep(key: String, value: String?) {
        let q = query(key)
        SecItemDelete(q as CFDictionary)
        guard let value else { return }
        var add = q
        add[kSecValueData as String] = Data(value.utf8)
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        SecItemAdd(add as CFDictionary, nil)
    }

    func randomBytes(count: Int32) -> Data {
        var bytes = [UInt8](repeating: 0, count: Int(count))
        _ = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        return Data(bytes)
    }

    func sha256(data: Data) -> Data { Data(SHA256.hash(data: data)) }

    func openUrl(url: String) {
        guard let target = URL(string: url) else { return }
        DispatchQueue.main.async { UIApplication.shared.open(target) }
    }

    func onCellular() -> Bool { cellular }

    // MARK: What this iPhone plays

    /// Told to the server with every play, honestly: mpv decodes HEVC and 10-bit (VideoToolbox, or FFmpeg when it can't),
    /// HDR only where the screen has EDR headroom, Dolby Vision only profile 8 (an HDR10 base mpv always shows right).
    func device() -> IosDevice {
        let screen = UIScreen.main
        let edr = screen.potentialEDRHeadroom > 1.0
        let height = Int32(min(screen.nativeBounds.width, screen.nativeBounds.height))
        var codecs = ["h264", "hevc"]
        /* AV1 only with a hardware decoder (A17 Pro and later): software AV1 drains a phone. */
        if VTIsHardwareDecodeSupported(kCMVideoCodecType_AV1) { codecs.append("av1") }
        return IosDevice(
            maxHeight: height,
            hdr: edr ? ["hdr10", "hlg"] : [],
            dvProfiles: edr ? ["8"] : [],
            codecs: codecs,
            tenBit: true,
            hi10p: true
        )
    }

    func makePlayer(preview: Bool) -> IosPlayer { MPVPlayer(preview: preview) }

    var downloader: IosDownloader { Downloader.shared }

    // MARK: The player's screen

    private weak var showing: UIViewController?

    func presentPlayer(controller: UIViewController) {
        let present = {
            guard let root = Host.root() else { return }
            let container = PlayerContainer(child: controller)
            AppDelegate.orientations = .landscape
            root.present(container, animated: true)
            self.showing = container
        }
        if let showing, showing.presentingViewController != nil {
            showing.dismiss(animated: false, completion: present)
        } else {
            present()
        }
    }

    func dismissPlayer() {
        guard let showing else { return }
        AppDelegate.orientations = .portrait
        showing.dismiss(animated: true) {
            Host.rotate(to: .portrait)
        }
        self.showing = nil
    }

    func rotatePlayer() {
        guard let showing = showing as? PlayerContainer else { return }
        showing.upright.toggle()
        AppDelegate.orientations = showing.upright ? .portrait : .landscape
        showing.setNeedsUpdateOfSupportedInterfaceOrientations()
        Host.rotate(to: AppDelegate.orientations)
    }

    static func root() -> UIViewController? {
        let scene = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first
        return scene?.windows.first(where: \.isKeyWindow)?.rootViewController ?? scene?.windows.first?.rootViewController
    }

    static func rotate(to mask: UIInterfaceOrientationMask) {
        guard let scene = UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene }).first else { return }
        scene.windows.first?.rootViewController?.setNeedsUpdateOfSupportedInterfaceOrientations()
        scene.requestGeometryUpdate(.iOS(interfaceOrientations: mask)) { _ in }
    }
}

/// The player full screen, landscape, with the status bar and home indicator out of the way.
final class PlayerContainer: UIViewController {
    private let child: UIViewController

    init(child: UIViewController) {
        self.child = child
        super.init(nibName: nil, bundle: nil)
        modalPresentationStyle = .fullScreen
        modalTransitionStyle = .crossDissolve
    }

    required init?(coder: NSCoder) { fatalError() }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        addChild(child)
        child.view.frame = view.bounds
        child.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        child.view.backgroundColor = .black
        view.addSubview(child.view)
        child.didMove(toParent: self)
    }

    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        setNeedsUpdateOfSupportedInterfaceOrientations()
        Host.rotate(to: upright ? .portrait : .landscape)
    }

    /** Turned upright from the player's rotate button; it starts on its side. */
    var upright = false

    override var supportedInterfaceOrientations: UIInterfaceOrientationMask { upright ? .portrait : .landscape }
    override var preferredInterfaceOrientationForPresentation: UIInterfaceOrientation { .landscapeRight }
    override var prefersStatusBarHidden: Bool { true }
    override var prefersHomeIndicatorAutoHidden: Bool { true }
    override var preferredScreenEdgesDeferringSystemGestures: UIRectEdge { .all }
}

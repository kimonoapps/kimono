import AuthenticationServices
import CryptoKit
import FileProvider
import PhotosUI
import QuickLook
import UniformTypeIdentifiers
import Security
import Shared
import UIKit

/// What the shared app needs from iOS: the Keychain, the sign-in sheet, the photo picker.
final class Host: NSObject, IosHost, @unchecked Sendable {
    static let shared = Host()

    // MARK: Keychain

    /// Shared with the Files app extension, so one sign-in serves both.
    private let group = Bundle.main.object(forInfoDictionaryKey: "KimonoKeychainGroup") as? String

    private func query(_ key: String, grouped: Bool) -> [String: Any] {
        var q: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "app.kimono", kSecAttrAccount as String: key]
        if grouped, let group, !group.hasPrefix("$(") { q[kSecAttrAccessGroup as String] = group }
        return q
    }

    func readKept(key: String) -> String? {
        for grouped in [true, false] {
            var q = query(key, grouped: grouped)
            q[kSecReturnData as String] = true
            q[kSecMatchLimit as String] = kSecMatchLimitOne
            var out: AnyObject?
            let status = SecItemCopyMatching(q as CFDictionary, &out)
            if status == errSecSuccess, let data = out as? Data { return String(data: data, encoding: .utf8) }
            if status != errSecMissingEntitlement { return nil }
        }
        return nil
    }

    func keep(key: String, value: String?) {
        defer { if key == "kimono.refresh" { Host.showInFiles(value != nil) } }
        for grouped in [true, false] {
            let q = query(key, grouped: grouped)
            let deleted = SecItemDelete(q as CFDictionary)
            if deleted == errSecMissingEntitlement { continue }
            guard let value else { return }
            var add = q
            add[kSecValueData as String] = Data(value.utf8)
            add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            if SecItemAdd(add as CFDictionary, nil) != errSecMissingEntitlement { return }
        }
    }

    func randomBytes(count: Int32) -> Data {
        var bytes = [UInt8](repeating: 0, count: Int(count))
        _ = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        return Data(bytes)
    }

    func sha256(data: Data) -> Data { Data(SHA256.hash(data: data)) }

    // MARK: Links and files

    func openUrl(url: String) {
        guard let target = URL(string: url) else { return }
        DispatchQueue.main.async { UIApplication.shared.open(target) }
    }

    func cacheDir() -> String {
        FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].path
    }

    private var previewing: URL?

    func openFile(path: String) {
        DispatchQueue.main.async {
            self.previewing = URL(fileURLWithPath: path)
            let preview = QLPreviewController()
            preview.dataSource = self
            Host.top()?.present(preview, animated: true)
        }
    }

    func appBuild() -> Int64 { Int64(Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "") ?? 0 }

    /// Drive switched on or off on the server: Kimono joins or leaves the Files app to match.
    func driveAvailable(on: Bool) {
        guard Host.driveOn != on else { return }
        UserDefaults.standard.set(on, forKey: "kimono.driveOn")
        Host.showInFiles(readKept(key: "kimono.refresh") != nil)
    }

    static var driveOn: Bool { UserDefaults.standard.object(forKey: "kimono.driveOn") as? Bool ?? true }

    func share(text: String) {
        DispatchQueue.main.async {
            let sheet = UIActivityViewController(activityItems: [URL(string: text) ?? text], applicationActivities: nil)
            Host.top()?.present(sheet, animated: true)
        }
    }

    /// The attach menu: Photo Library, Take Photo or Video, Choose Files.
    func pickFiles(done: @escaping ([IosPickedFile]) -> Void) {
        DispatchQueue.main.async { Attach.shared.present(done) }
    }

    func readFile(path: String, offset: Int64, max: Int32) -> Data {
        guard let handle = FileHandle(forReadingAtPath: path) else { return Data() }
        defer { try? handle.close() }
        try? handle.seek(toOffset: UInt64(offset))
        return (try? handle.read(upToCount: Int(max))) ?? Data()
    }

    // MARK: Background uploads

    func startUpload(name: String, path: String, size: Int64, folderId: String) {
        BackgroundUploader.shared.start(name: name, path: path, size: size, folderId: folderId)
    }

    func dismissUpload(id: String) { BackgroundUploader.shared.dismiss(id) }

    func retryUpload(id: String) { BackgroundUploader.shared.retry(id) }

    func thumbnail(id: String, contentVersion: Int64, name: String, mime: String?, size: Int64, pixels: Int64, done: @escaping (String?) -> Void) {
        Task {
            let made = try? await Thumbnails.shared.make(id: id, contentVersion: Int(contentVersion), name: name, mime: mime, size: size, pixels: Int(pixels))
            await MainActor.run { done(made?.path) }
        }
    }

    func observeUploads(callback: @escaping ([IosUploadStatus]) -> Void) { BackgroundUploader.shared.observe(callback) }

    // MARK: Files app

    private static let domain: NSFileProviderDomain = {
        let domain = NSFileProviderDomain(identifier: NSFileProviderDomainIdentifier("kimono"), displayName: "Kimono")
        #if DEBUG
        /* Test builds skip the Files app's own switch; people turn Kimono on there once. */
        domain.testingModes = [.alwaysEnabled]
        #endif
        return domain
    }()

    /// Kimono appears in the Files app while signed in, and leaves it (with its copies) on signing out.
    static func showInFiles(_ signedIn: Bool) {
        if signedIn && driveOn {
            NSFileProviderManager.add(domain) { error in
                if let error { NSLog("Kimono couldn't join the Files app: \(error.localizedDescription)") }
                NSFileProviderManager(for: domain)?.signalEnumerator(for: .workingSet) { _ in }
            }
        } else {
            NSFileProviderManager.remove(domain) { _ in }
        }
    }

    /// Whenever the app comes to the front: the Files app looks for changes now, rather than whenever it next would.
    func cameForward() {
        BackgroundUploader.shared.resume()
        guard readKept(key: "kimono.refresh") != nil else { return }
        NSFileProviderManager(for: Host.domain)?.signalEnumerator(for: .workingSet) { error in
            if let error { NSLog("Kimono couldn't nudge the Files app: \(error.localizedDescription)") }
        }
    }

    /// On launch: still signed in means still in the Files app, and worth a fresh look for changes.
    func launched() {
        guard readKept(key: "kimono.refresh") != nil else { return }
        #if DEBUG
        /* A test build re-adds Kimono so the testing switch takes effect on a domain added before it
           (or, launched with -freshFilesDomain, so the Files app picks up a new icon). */
        NSFileProviderManager.getDomainsWithCompletionHandler { domains, _ in
            let fresh = ProcessInfo.processInfo.arguments.contains("-freshFilesDomain")
            if fresh || domains.contains(where: { $0.identifier == Host.domain.identifier && !$0.userEnabled }) {
                NSFileProviderManager.remove(Host.domain) { _ in Host.showInFiles(true) }
            } else {
                Host.showInFiles(true)
            }
        }
        #else
        Host.showInFiles(true)
        #endif
    }

    // MARK: Sign-in

    private var signIn: ASWebAuthenticationSession?

    func openSignIn(url: String, redirect: String, done: @escaping (String?) -> Void) {
        DispatchQueue.main.async {
            guard let address = URL(string: url), let scheme = URL(string: redirect)?.scheme else { return done(nil) }
            let session = ASWebAuthenticationSession(url: address, callbackURLScheme: scheme) { [weak self] returned, _ in
                self?.signIn = nil
                done(returned?.absoluteString)
            }
            session.presentationContextProvider = self
            /* Its own cookie jar: no "wants to use … to sign in" prompt, and the Portal asks for the password anyway. */
            session.prefersEphemeralWebBrowserSession = true
            self.signIn = session
            if !session.start() { self.signIn = nil; done(nil) }
        }
    }

    // MARK: Photos

    private var picked: ((Data?) -> Void)?

    func pickPicture(done: @escaping (Data?) -> Void) {
        DispatchQueue.main.async {
            var config = PHPickerConfiguration()
            config.filter = .images
            config.selectionLimit = 1
            let picker = PHPickerViewController(configuration: config)
            picker.delegate = self
            self.picked = done
            Host.top()?.present(picker, animated: true)
        }
    }

    /// Cut square from the middle and scaled to the 512×512 PNG the Portal stores.
    private static func square(_ image: UIImage) -> Data? {
        let side = min(image.size.width, image.size.height)
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        return UIGraphicsImageRenderer(size: CGSize(width: 512, height: 512), format: format).pngData { _ in
            let scale = 512 / side
            let size = CGSize(width: image.size.width * scale, height: image.size.height * scale)
            image.draw(in: CGRect(x: (512 - size.width) / 2, y: (512 - size.height) / 2, width: size.width, height: size.height))
        }
    }

    static func top() -> UIViewController? {
        let window = UIApplication.shared.connectedScenes.compactMap { ($0 as? UIWindowScene)?.keyWindow }.first
        var top = window?.rootViewController
        while let shown = top?.presentedViewController { top = shown }
        return top
    }
}

extension Host: ASWebAuthenticationPresentationContextProviding {
    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        MainActor.assumeIsolated {
            UIApplication.shared.connectedScenes.compactMap { ($0 as? UIWindowScene)?.keyWindow }.first ?? ASPresentationAnchor()
        }
    }
}

extension Host: PHPickerViewControllerDelegate {
    func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
        picker.dismiss(animated: true)
        let done = picked
        picked = nil
        guard let provider = results.first?.itemProvider, provider.canLoadObject(ofClass: UIImage.self) else { done?(nil); return }
        provider.loadObject(ofClass: UIImage.self) { image, _ in
            let png = (image as? UIImage).flatMap(Host.square)
            DispatchQueue.main.async { done?(png) }
        }
    }
}

extension Host: QLPreviewControllerDataSource {
    func numberOfPreviewItems(in controller: QLPreviewController) -> Int { previewing == nil ? 0 : 1 }
    func previewController(_ controller: QLPreviewController, previewItemAt index: Int) -> QLPreviewItem { previewing! as NSURL }
}

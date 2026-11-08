import PhotosUI
@preconcurrency import Shared
import UIKit
import UniformTypeIdentifiers

/// The attach menu, as iOS apps have it: Photo Library, Take Photo or Video, Choose Files.
/// Whatever is picked is copied into the cache and handed back once; cancelling hands back nothing.
@MainActor
final class Attach: NSObject {
    static let shared = Attach()

    private var done: (([IosPickedFile]) -> Void)?
    private let touches = LastTouch()

    /// Where the finger last went down, so the menu points at what was tapped.
    func watch(_ view: UIView) { view.addGestureRecognizer(touches) }

    func present(_ done: @escaping ([IosPickedFile]) -> Void) {
        finish([])
        self.done = done
        guard let top = Host.top() else { return finish([]) }
        let menu = UIAlertController(title: nil, message: nil, preferredStyle: .actionSheet)
        menu.addAction(UIAlertAction(title: "Photo Library", style: .default) { _ in self.show(self.photos(), over: top) })
        let camera = UIAlertAction(title: "Take Photo or Video", style: .default) { _ in self.show(self.camera(), over: top) }
        camera.isEnabled = UIImagePickerController.isSourceTypeAvailable(.camera)
        menu.addAction(camera)
        menu.addAction(UIAlertAction(title: "Choose Files", style: .default) { _ in self.show(self.files(), over: top) })
        menu.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in self.finish([]) })
        if let pop = menu.popoverPresentationController {
            let at = touches.view.flatMap { from in touches.last.map { top.view.convert($0, from: from) } }
                ?? CGPoint(x: top.view.bounds.midX, y: top.view.bounds.maxY)
            pop.sourceView = top.view
            pop.sourceRect = CGRect(origin: at, size: .zero)
        }
        top.present(menu, animated: true)
    }

    /// Once the menu has gone: presenting while it's still leaving does nothing.
    private func show(_ picker: UIViewController, over top: UIViewController) {
        if let leaving = top.presentedViewController?.transitionCoordinator {
            leaving.animate(alongsideTransition: nil) { _ in top.present(picker, animated: true) }
        } else {
            top.present(picker, animated: true)
        }
    }

    private func finish(_ files: [IosPickedFile]) {
        let waiting = done
        done = nil
        waiting?(files)
    }

    // MARK: Photo Library

    private func photos() -> UIViewController {
        var config = PHPickerConfiguration()
        config.selectionLimit = 10
        config.filter = .any(of: [.images, .videos])
        /* JPEG and H.264 rather than HEIC and HEVC, so anything that reads the file can. */
        config.preferredAssetRepresentationMode = .compatible
        let picker = PHPickerViewController(configuration: config)
        picker.delegate = self
        return picker
    }

    // MARK: Take Photo or Video

    private func camera() -> UIViewController {
        let picker = UIImagePickerController()
        picker.sourceType = .camera
        picker.mediaTypes = UIImagePickerController.availableMediaTypes(for: .camera) ?? [UTType.image.identifier]
        picker.delegate = self
        return picker
    }

    // MARK: Choose Files

    private func files() -> UIViewController {
        let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.item], asCopy: true)
        picker.allowsMultipleSelection = true
        picker.delegate = self
        return picker
    }

    // MARK: Copies

    /// A folder of its own in the cache, so two picks with the same name don't meet.
    nonisolated private static func place(_ name: String) -> URL {
        let folder = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("attach", isDirectory: true)
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        return folder.appendingPathComponent(name)
    }

    nonisolated private static func picked(_ url: URL) -> IosPickedFile {
        let values = try? url.resourceValues(forKeys: [.fileSizeKey, .contentTypeKey])
        return IosPickedFile(name: url.lastPathComponent, path: url.path, size: Int64(values?.fileSize ?? 0), mimeType: values?.contentType?.preferredMIMEType)
    }

    private static func stamp(_ kind: String, _ ext: String) -> String {
        let format = DateFormatter()
        format.dateFormat = "yyyy-MM-dd 'at' HH.mm.ss"
        return "\(kind) \(format.string(from: Date())).\(ext)"
    }
}

extension Attach: PHPickerViewControllerDelegate {
    nonisolated func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
        MainActor.assumeIsolated {
            picker.dismiss(animated: true)
            guard !results.isEmpty else { return finish([]) }
            let group = DispatchGroup()
            var files = [IosPickedFile?](repeating: nil, count: results.count)
            for (i, result) in results.enumerated() {
                let provider = result.itemProvider
                let types = provider.registeredContentTypes
                guard let type = types.first(where: { $0.conforms(to: .image) || $0.conforms(to: .movie) }) ?? types.first else { continue }
                let suggested = provider.suggestedName
                group.enter()
                _ = provider.loadFileRepresentation(for: type) { url, _, _ in
                    defer { group.leave() }
                    guard let url else { return }
                    let ext = url.pathExtension.isEmpty ? (type.preferredFilenameExtension ?? "") : url.pathExtension
                    let base = suggested ?? url.deletingPathExtension().lastPathComponent
                    let to = Attach.place(ext.isEmpty ? base : "\(base).\(ext)")
                    /* The picker's copy goes when this returns, so ours is made now. */
                    guard (try? FileManager.default.copyItem(at: url, to: to)) != nil else { return }
                    let file = Attach.picked(to)
                    DispatchQueue.main.async { files[i] = file }
                }
            }
            group.notify(queue: .main) { self.finish(files.compactMap { $0 }) }
        }
    }
}

extension Attach: UIImagePickerControllerDelegate, UINavigationControllerDelegate {
    nonisolated func imagePickerController(_ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
        MainActor.assumeIsolated {
            picker.dismiss(animated: true)
            if let movie = info[.mediaURL] as? URL {
                let to = Attach.place(Attach.stamp("Video", movie.pathExtension.isEmpty ? "mov" : movie.pathExtension))
                guard (try? FileManager.default.moveItem(at: movie, to: to)) != nil
                    || (try? FileManager.default.copyItem(at: movie, to: to)) != nil else { return finish([]) }
                return finish([Attach.picked(to)])
            }
            guard let image = info[.originalImage] as? UIImage, let jpeg = image.jpegData(compressionQuality: 0.9) else { return finish([]) }
            let to = Attach.place(Attach.stamp("Photo", "jpg"))
            guard (try? jpeg.write(to: to)) != nil else { return finish([]) }
            finish([Attach.picked(to)])
        }
    }

    nonisolated func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
        MainActor.assumeIsolated {
            picker.dismiss(animated: true)
            finish([])
        }
    }
}

extension Attach: UIDocumentPickerDelegate {
    nonisolated func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        MainActor.assumeIsolated { finish(urls.map(Attach.picked)) }
    }

    nonisolated func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        MainActor.assumeIsolated { finish([]) }
    }
}

/// Notes each touch-down and steps aside, so nothing else sees a difference.
private final class LastTouch: UIGestureRecognizer {
    var last: CGPoint?

    init() {
        super.init(target: nil, action: nil)
        cancelsTouchesInView = false
        delaysTouchesBegan = false
        delaysTouchesEnded = false
    }

    override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent) {
        last = touches.first?.location(in: view)
        state = .failed
    }
}

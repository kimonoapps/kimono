import PhotosUI
@preconcurrency import Shared
import UIKit
import UniformTypeIdentifiers

/// Attaching from the phone: the camera, the system's photo picker, or the Files app's.
/// Whatever is picked is copied into the cache and handed back once; cancelling hands back nothing.
@MainActor
final class Attach: NSObject {
    static let shared = Attach()

    private var done: (([IosPickedFile]) -> Void)?

    func photos(_ done: @escaping ([IosPickedFile]) -> Void) {
        var config = PHPickerConfiguration()
        config.selectionLimit = 10
        config.filter = .any(of: [.images, .videos])
        /* JPEG and H.264 rather than HEIC and HEVC, so anything that reads the file can. */
        config.preferredAssetRepresentationMode = .compatible
        let picker = PHPickerViewController(configuration: config)
        picker.delegate = self
        show(picker, done)
    }

    func camera(_ done: @escaping ([IosPickedFile]) -> Void) {
        guard UIImagePickerController.isSourceTypeAvailable(.camera) else { return done([]) }
        let picker = UIImagePickerController()
        picker.sourceType = .camera
        picker.cameraCaptureMode = .photo
        picker.delegate = self
        show(picker, done)
    }

    func files(_ done: @escaping ([IosPickedFile]) -> Void) {
        let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.item], asCopy: true)
        picker.allowsMultipleSelection = true
        picker.delegate = self
        show(picker, done)
    }

    private func show(_ picker: UIViewController, _ done: @escaping ([IosPickedFile]) -> Void) {
        finish([])
        guard let top = Host.top() else { return done([]) }
        self.done = done
        top.present(picker, animated: true)
    }

    private func finish(_ files: [IosPickedFile]) {
        let waiting = done
        done = nil
        waiting?(files)
    }

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

extension Attach: UIDocumentPickerDelegate {
    nonisolated func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        MainActor.assumeIsolated { finish(urls.map(Attach.picked)) }
    }

    nonisolated func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        MainActor.assumeIsolated { finish([]) }
    }
}

extension Attach: UIImagePickerControllerDelegate, UINavigationControllerDelegate {
    nonisolated func imagePickerController(_ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
        MainActor.assumeIsolated {
            picker.dismiss(animated: true)
            guard let image = info[.originalImage] as? UIImage else { return finish([]) }
            DispatchQueue.global(qos: .userInitiated).async {
                let stamp = Attach.stamp.string(from: Date())
                let to = Attach.place("Photo \(stamp).jpg")
                /* JPEG, upright: anything that reads the file sees it as it was taken. */
                guard let data = image.jpegData(compressionQuality: 0.85), (try? data.write(to: to)) != nil else {
                    return DispatchQueue.main.async { self.finish([]) }
                }
                let file = Attach.picked(to)
                DispatchQueue.main.async { self.finish([file]) }
            }
        }
    }

    nonisolated func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
        MainActor.assumeIsolated {
            picker.dismiss(animated: true)
            finish([])
        }
    }

    nonisolated private static let stamp: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd 'at' HH.mm.ss"
        return f
    }()
}

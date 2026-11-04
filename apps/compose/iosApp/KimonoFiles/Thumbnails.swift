import AVFoundation
import FileProvider
import Foundation
import ImageIO
import UIKit
import UniformTypeIdentifiers

/// Thumbnails for Kimono's files, made on the phone and kept per version in
/// the App Group, so the app and the Files app share them. A photo's camera
/// preview is used where its first few KB carry one; a video's frame is read
/// in place; a PDF shows its first page.
actor Thumbnails {
    static let shared = Thumbnails()

    private static let maxImage: Int64 = 40 * 1024 * 1024
    private static let maxPDF: Int64 = 20 * 1024 * 1024
    private static let head = 256 * 1024

    private let folder: URL = {
        let base = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: "group.app.kimono")?.appendingPathComponent("Library/Caches", isDirectory: true)
            ?? FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
        let url = base.appendingPathComponent("thumbs", isDirectory: true)
        try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        return url
    }()
    /// Versions that couldn't be made (an unplayable video, a damaged photo): not tried again while running.
    private var failed: Set<String> = []
    /* The Files app asks for a screenful at once: a few at a time is kinder to the connection. */
    private var slots = 3
    private var waiting: [CheckedContinuation<Void, Never>] = []

    enum Kind { case image, video, pdf }

    static func kind(name: String, mime: String?, size: Int64) -> Kind? {
        guard size > 0 else { return nil }
        let type = mime.flatMap { UTType(mimeType: $0) } ?? UTType(filenameExtension: (name as NSString).pathExtension.lowercased())
        guard let type else { return nil }
        if type.conforms(to: .image) { return size <= maxImage ? .image : nil }
        if type.conforms(to: .movie) || type.conforms(to: .video) { return .video }
        if type.conforms(to: .pdf) { return size <= maxPDF ? .pdf : nil }
        return nil
    }

    /// A JPEG at least `pixels` on its longer side (where the original is that big), or nil when there can't be one.
    func make(id: String, contentVersion: Int, name: String, mime: String?, size: Int64, pixels: Int) async throws -> URL? {
        guard let kind = Self.kind(name: name, mime: mime, size: size) else { return nil }
        let edge = pixels <= 256 ? 256 : pixels <= 512 ? 512 : 1024
        let target = folder.appendingPathComponent("\(id)-\(contentVersion)-\(edge).jpg")
        if FileManager.default.fileExists(atPath: target.path) { return target }
        let version = "\(id)-\(contentVersion)"
        if failed.contains(version) { return nil }
        await enter()
        defer { leave() }
        if FileManager.default.fileExists(atPath: target.path) { return target }
        let image: CGImage?
        do {
            switch kind {
            case .image: image = try await photo(id, size: size, edge: edge)
            case .video: image = try await frame(id, edge: edge)
            case .pdf: image = try await firstPage(id, size: size, edge: edge)
            }
        } catch {
            /* Offline isn't the file's fault: that one is tried again. */
            if !Self.isOffline(error) { failed.insert(version) }
            throw error
        }
        guard let image, let jpeg = UIImage(cgImage: image).jpegData(compressionQuality: 0.85) else {
            failed.insert(version)
            return nil
        }
        try jpeg.write(to: target, options: .atomic)
        return target
    }

    private static func isOffline(_ error: Error) -> Bool {
        if error is URLError { return true }
        let error = error as NSError
        return error.domain == NSFileProviderErrorDomain && (error.code == NSFileProviderError.serverUnreachable.rawValue || error.code == NSFileProviderError.notAuthenticated.rawValue)
            || error.domain == NSURLErrorDomain
    }

    private func enter() async {
        if slots > 0 { slots -= 1; return }
        await withCheckedContinuation { waiting.append($0) }
    }

    private func leave() {
        if waiting.isEmpty { slots += 1 } else { waiting.removeFirst().resume() }
    }

    // MARK: Kinds

    private func photo(_ id: String, size: Int64, edge: Int) async throws -> CGImage? {
        let head = try await Drive.shared.read(id, offset: 0, length: Int(min(size, Int64(Self.head))))
        /* Cameras keep a small preview near the start: often enough for a list. Only that preview,
           though: left to itself ImageIO draws whatever part of the photo has arrived. */
        if let source = CGImageSourceCreateWithData(head as CFData, nil),
           let preview = CGImageSourceCreateThumbnailAtIndex(source, 0, [
               kCGImageSourceCreateThumbnailWithTransform: true,
               kCGImageSourceThumbnailMaxPixelSize: edge,
               kCGImageSourceCreateThumbnailFromImageIfAbsent: false,
               kCGImageSourceCreateThumbnailFromImageAlways: false,
           ] as CFDictionary),
           max(preview.width, preview.height) * 2 >= edge {
            return preview
        }
        let whole = Int64(head.count) == size ? head : try await Drive.shared.read(id, offset: 0, length: Int(size))
        guard let source = CGImageSourceCreateWithData(whole as CFData, nil) else { return nil }
        return CGImageSourceCreateThumbnailAtIndex(source, 0, [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceThumbnailMaxPixelSize: edge,
        ] as CFDictionary)
    }

    private func frame(_ id: String, edge: Int) async throws -> CGImage? {
        let access = try await Drive.shared.contentAccess(id)
        /* The player reads only what it needs (the index, a little of the start) with ranged requests. */
        let asset = AVURLAsset(url: access.url, options: ["AVURLAssetHTTPHeaderFieldsKey": access.headers])
        let generator = AVAssetImageGenerator(asset: asset)
        generator.appliesPreferredTrackTransform = true
        generator.maximumSize = CGSize(width: edge, height: edge)
        generator.requestedTimeToleranceAfter = CMTime(seconds: 2, preferredTimescale: 600)
        do {
            return try await generator.image(at: CMTime(seconds: 1, preferredTimescale: 600)).image
        } catch {
            return try await generator.image(at: .zero).image
        }
    }

    private func firstPage(_ id: String, size: Int64, edge: Int) async throws -> CGImage? {
        let data = try await Drive.shared.read(id, offset: 0, length: Int(size))
        guard let provider = CGDataProvider(data: data as CFData), let document = CGPDFDocument(provider), let page = document.page(at: 1) else { return nil }
        let box = page.getBoxRect(.cropBox)
        let scale = CGFloat(edge) / max(box.width, box.height)
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        let image = UIGraphicsImageRenderer(size: CGSize(width: box.width * scale, height: box.height * scale), format: format).image { context in
            UIColor.white.setFill()
            context.fill(CGRect(origin: .zero, size: context.format.bounds.size))
            context.cgContext.translateBy(x: 0, y: box.height * scale)
            context.cgContext.scaleBy(x: scale, y: -scale)
            context.cgContext.translateBy(x: -box.minX, y: -box.minY)
            context.cgContext.drawPDFPage(page)
        }
        return image.cgImage
    }
}

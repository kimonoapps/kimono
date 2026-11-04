import FileProvider
import Foundation

/// Sends a local file to Drive over tus, in pieces, picking up where it
/// stopped after a dropped connection, and across calls when the system
/// retries (the upload's address is remembered by what is being sent).
enum Upload {
    static let piece = 16 * 1024 * 1024
    private static let remembered = UserDefaults(suiteName: "group.app.kimono") ?? .standard

    /// Uploads [file]; metadata is tus's (filename, folder, or replaces and base). Returns the node id and whether it clashed.
    static func send(_ file: URL, metadata: [String: String], progress: Progress) async throws -> (id: String, conflict: Bool) {
        let size = (try FileManager.default.attributesOfItem(atPath: file.path)[.size] as? NSNumber)?.int64Value ?? 0
        progress.totalUnitCount = size
        let key = "upload:" + metadata.sorted { $0.key < $1.key }.map { "\($0.key)=\($0.value)" }.joined(separator: "&") + ":\(size)"
        let handle = try FileHandle(forReadingFrom: file)
        defer { try? handle.close() }

        var location = remembered.string(forKey: key)
        var offset: Int64 = 0
        if let known = location, let at = try? await headOffset(known) { offset = at } else { location = nil }
        if location == nil {
            let encoded = metadata.map { "\($0.key) \(Data($0.value.utf8).base64EncodedString())" }.joined(separator: ",")
            let request = try await Drive.shared.request("/api/v1/drive/uploads", method: "POST", headers: ["Tus-Resumable": "1.0.0", "Upload-Length": String(size), "Upload-Metadata": encoded])
            let (_, response) = try await Drive.shared.send(request)
            location = response.value(forHTTPHeaderField: "Location")
            remembered.set(location, forKey: key)
        }
        guard let location else { throw NSFileProviderError(.serverUnreachable) }

        var failures = 0
        while true {
            try Task.checkCancellation()
            try handle.seek(toOffset: UInt64(offset))
            let bytes = try handle.read(upToCount: piece) ?? Data()
            let request = try await Drive.shared.request(location, method: "PATCH", headers: ["Tus-Resumable": "1.0.0", "Upload-Offset": String(offset), "Content-Type": "application/offset+octet-stream"])
            do {
                let (_, response) = try await Drive.shared.send(request, body: bytes)
                offset = Int64(response.value(forHTTPHeaderField: "Upload-Offset") ?? "") ?? offset + Int64(bytes.count)
                progress.completedUnitCount = offset
                failures = 0
                if let id = response.value(forHTTPHeaderField: "Kimono-File") {
                    remembered.removeObject(forKey: key)
                    return (id, response.value(forHTTPHeaderField: "Kimono-Conflict") != nil)
                }
            } catch let error as NSFileProviderError where error.code == .serverUnreachable || error.code == .filenameCollision {
                /* Dropped, or out of step: ask where to carry on from, and wait a little longer each time. */
                failures += 1
                if failures > 6 { throw error }
                try await Task.sleep(nanoseconds: UInt64(1 << failures) * 500_000_000)
                offset = try await headOffset(location)
            }
        }
    }

    private static func headOffset(_ location: String) async throws -> Int64 {
        let request = try await Drive.shared.request(location, method: "HEAD", headers: ["Tus-Resumable": "1.0.0"])
        let (_, response) = try await Drive.shared.send(request)
        guard let offset = Int64(response.value(forHTTPHeaderField: "Upload-Offset") ?? "") else { throw NSFileProviderError(.noSuchItem) }
        return offset
    }
}

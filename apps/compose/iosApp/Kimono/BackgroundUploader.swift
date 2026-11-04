import FileProvider
import Foundation
import Shared

/**
 * Uploads that carry on with Kimono closed. Each 8 MB piece goes to iOS's
 * background transfer service as a file; when one lands, iOS wakes Kimono
 * just long enough to queue the next. Uploads that stall (no connection,
 * the phone off) pick up where the server says they stopped.
 */
final class BackgroundUploader: NSObject, URLSessionDataDelegate, @unchecked Sendable {
    static let shared = BackgroundUploader()
    static let piece: Int64 = 8 * 1024 * 1024

    struct Job: Codable {
        let id: String
        let name: String
        let size: Int64
        let folderId: String
        var location: String?
        var offset: Int64 = 0
        var sentInPiece: Int64 = 0
        var waiting = false
        var failed: String?
        var done = false
    }

    private let queue = DispatchQueue(label: "app.kimono.uploads")
    private var jobs: [String: Job] = [:]
    private var bodies: [Int: Data] = [:]
    /** Handed over by iOS when it wakes Kimono for these uploads; called once they've been dealt with. */
    var finishedEvents: (() -> Void)?
    var observer: (([IosUploadStatus]) -> Void)?

    private lazy var session: URLSession = {
        let configuration = URLSessionConfiguration.background(withIdentifier: "app.kimono.uploads")
        configuration.sessionSendsLaunchEvents = true
        configuration.isDiscretionary = false
        return URLSession(configuration: configuration, delegate: self, delegateQueue: nil)
    }()

    private static let folder: URL = {
        let url = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("uploads", isDirectory: true)
        try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        return url
    }()
    private static let saved = folder.appendingPathComponent("jobs.json")

    override init() {
        super.init()
        if let data = try? Data(contentsOf: Self.saved), let list = try? JSONDecoder().decode([Job].self, from: data) {
            jobs = Dictionary(uniqueKeysWithValues: list.map { ($0.id, $0) })
        }
        _ = session
    }

    private func source(_ id: String) -> URL { Self.folder.appendingPathComponent(id) }
    private func pieceFile(_ id: String) -> URL { Self.folder.appendingPathComponent("\(id).piece") }

    private func save() {
        let list = Array(jobs.values)
        try? JSONEncoder().encode(list).write(to: Self.saved, options: .atomic)
        let statuses = list.map { job in
            IosUploadStatus(id: job.id, name: job.name, size: job.size, sent: min(job.size, job.offset + job.sentInPiece), folderId: job.folderId, waiting: job.waiting, failed: job.failed, done: job.done)
        }
        let observer = self.observer
        DispatchQueue.main.async { observer?(statuses) }
    }

    func observe(_ callback: @escaping ([IosUploadStatus]) -> Void) {
        queue.async { self.observer = callback; self.save() }
    }

    /** Takes over a picked file (moved, not copied) and starts sending it. */
    func start(name: String, path: String, size: Int64, folderId: String) {
        queue.async {
            let id = UUID().uuidString
            do { try FileManager.default.moveItem(at: URL(fileURLWithPath: path), to: self.source(id)) } catch {
                do { try FileManager.default.copyItem(at: URL(fileURLWithPath: path), to: self.source(id)) } catch { return }
            }
            self.jobs[id] = Job(id: id, name: name, size: size, folderId: folderId)
            self.save()
            Task { await self.next(id) }
        }
    }

    func dismiss(_ id: String) {
        queue.async {
            self.session.getAllTasks { tasks in tasks.filter { $0.taskDescription == id }.forEach { $0.cancel() } }
            self.jobs[id] = nil
            try? FileManager.default.removeItem(at: self.source(id))
            try? FileManager.default.removeItem(at: self.pieceFile(id))
            self.save()
        }
    }

    /** A failed upload goes again, from where the server says it stopped. */
    func retry(_ id: String) {
        queue.async {
            guard self.jobs[id] != nil else { return }
            self.jobs[id]?.failed = nil
            self.jobs[id]?.waiting = true
            self.save()
            Task { await self.next(id, askFirst: true) }
        }
    }

    /** On launch and whenever Kimono comes forward: anything stalled carries on. */
    func resume() {
        session.getAllTasks { tasks in
            let running = Set(tasks.compactMap { $0.taskDescription })
            self.queue.async {
                for job in self.jobs.values where !job.done && job.failed == nil && !running.contains(job.id) {
                    Task { await self.next(job.id, askFirst: true) }
                }
            }
        }
    }

    private func update(_ id: String, _ change: @escaping (inout Job) -> Void) {
        queue.sync {
            guard var job = jobs[id] else { return }
            change(&job)
            jobs[id] = job
            save()
        }
    }

    private func job(_ id: String) -> Job? { queue.sync { jobs[id] } }

    /** Queues the next piece of [id], creating the upload on the server first if need be. */
    private func next(_ id: String, askFirst: Bool = false) async {
        guard var job = job(id), !job.done else { return }
        do {
            if job.location == nil {
                let metadata = "filename \(Data(job.name.utf8).base64EncodedString()),folder \(Data(job.folderId.utf8).base64EncodedString())"
                let request = try await Drive.shared.request("/api/v1/drive/uploads", method: "POST", headers: ["Tus-Resumable": "1.0.0", "Upload-Length": String(job.size), "Upload-Metadata": metadata])
                let (_, response) = try await Drive.shared.send(request)
                job.location = response.value(forHTTPHeaderField: "Location")
                job.offset = 0
                update(id) { $0.location = job.location; $0.offset = 0 }
            } else if askFirst, let location = job.location {
                let request = try await Drive.shared.request(location, method: "HEAD", headers: ["Tus-Resumable": "1.0.0"])
                do {
                    let (_, response) = try await Drive.shared.send(request)
                    if let offset = Int64(response.value(forHTTPHeaderField: "Upload-Offset") ?? "") { job.offset = offset }
                    update(id) { $0.offset = job.offset }
                } catch let gone as NSFileProviderError where gone.code == .noSuchItem {
                    /* The server let the unfinished upload go (it was left too long): start it again. */
                    update(id) { $0.location = nil; $0.offset = 0 }
                    return await next(id)
                }
            }
            guard let location = job.location else { return }
            /* This piece as a file: background transfers upload from files, not memory. */
            let handle = try FileHandle(forReadingFrom: source(id))
            try handle.seek(toOffset: UInt64(job.offset))
            let bytes = try handle.read(upToCount: Int(Self.piece)) ?? Data()
            try handle.close()
            try bytes.write(to: pieceFile(id), options: .atomic)
            var request = try await Drive.shared.request(location, method: "PATCH", headers: ["Tus-Resumable": "1.0.0", "Upload-Offset": String(job.offset), "Content-Type": "application/offset+octet-stream"])
            request.timeoutInterval = 300
            let task = session.uploadTask(with: request, fromFile: pieceFile(id))
            task.taskDescription = id
            update(id) { $0.waiting = false; $0.sentInPiece = 0 }
            task.resume()
        } catch {
            let refusal = error as NSError
            /* Kimono said no (a viewer, a file too big): that won't change, so say why. Anything else waits for a connection. */
            if refusal.domain == "app.kimono" || (refusal.domain == NSCocoaErrorDomain && refusal.code == NSFileWriteNoPermissionError) {
                update(id) { $0.failed = refusal.localizedDescription }
            } else {
                update(id) { $0.waiting = true }
            }
        }
    }

    // MARK: URLSession

    func urlSession(_ session: URLSession, task: URLSessionTask, didSendBodyData bytesSent: Int64, totalBytesSent: Int64, totalBytesExpectedToSend: Int64) {
        guard let id = task.taskDescription else { return }
        update(id) { $0.sentInPiece = totalBytesSent }
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        queue.sync { bodies[dataTask.taskIdentifier, default: Data()].append(data) }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        guard let id = task.taskDescription else { return }
        let body = queue.sync { bodies.removeValue(forKey: task.taskIdentifier) } ?? Data()
        try? FileManager.default.removeItem(at: pieceFile(id))
        let response = task.response as? HTTPURLResponse
        if error != nil || response == nil {
            /* Dropped: ask the server where it got to, after a moment. */
            update(id) { $0.waiting = true; $0.sentInPiece = 0 }
            Task { try? await Task.sleep(nanoseconds: 5_000_000_000); await self.next(id, askFirst: true) }
            return
        }
        let status = response!.statusCode
        if status == 204 || status == 200 {
            let offset = Int64(response!.value(forHTTPHeaderField: "Upload-Offset") ?? "")
            if response!.value(forHTTPHeaderField: "Kimono-File") != nil {
                update(id) { $0.offset = $0.size; $0.sentInPiece = 0; $0.done = true }
                try? FileManager.default.removeItem(at: source(id))
                return
            }
            update(id) { $0.offset = offset ?? ($0.offset + $0.sentInPiece); $0.sentInPiece = 0 }
            Task { await self.next(id) }
        } else if status == 409 {
            Task { await self.next(id, askFirst: true) }
        } else if status == 401 {
            update(id) { $0.waiting = true; $0.sentInPiece = 0 }
        } else {
            let message = (try? JSONDecoder().decode(Drive.Failure.self, from: body))?.error ?? "That file couldn't be uploaded."
            update(id) { $0.failed = message; $0.sentInPiece = 0 }
        }
    }

    func urlSessionDidFinishEvents(forBackgroundURLSession session: URLSession) {
        DispatchQueue.main.async {
            self.finishedEvents?()
            self.finishedEvents = nil
        }
    }
}

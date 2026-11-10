import Foundation
import WatchShared

/// Episodes for watching offline: a background URLSession, so they keep coming with the app closed,
/// into Application Support (kept out of backups), one file per episode.
final class Downloader: NSObject, IosDownloader, URLSessionDownloadDelegate, @unchecked Sendable {
    static let shared = Downloader()

    /// iOS's completion for a background session's events, called once they're handled.
    var finishedEvents: (() -> Void)?
    private var listeners: [IosDownloadEvents] = []
    private let defaults = UserDefaults.standard

    private lazy var session: URLSession = {
        let config = URLSessionConfiguration.background(withIdentifier: "app.kimono.watch.downloads")
        config.sessionSendsLaunchEvents = true
        config.isDiscretionary = false
        config.allowsCellularAccess = true
        return URLSession(configuration: config, delegate: self, delegateQueue: .main)
    }()

    private lazy var folder: URL = {
        var dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("Downloads", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try? dir.setResourceValues(values)
        return dir
    }()

    private var started: [String] {
        get { defaults.stringArray(forKey: "watch.dl.keys") ?? [] }
        set { defaults.set(newValue, forKey: "watch.dl.keys") }
    }

    func keys() -> [String] { _ = session; return started }

    func start(key: String, url: String) {
        guard let target = URL(string: url) else { return notify(key, 0, done: false, failed: true) }
        cancelTasks(key) {
            let task = self.session.downloadTask(with: target)
            task.taskDescription = key
            task.resume()
            if !self.started.contains(key) { self.started.append(key) }
            self.notify(key, 0, done: false, failed: false)
        }
    }

    func cancel(key: String) {
        cancelTasks(key) {}
        if let name = defaults.string(forKey: "watch.dl.file.\(key)") { try? FileManager.default.removeItem(at: folder.appendingPathComponent(name)) }
        defaults.removeObject(forKey: "watch.dl.file.\(key)")
        started.removeAll { $0 == key }
    }

    func file(key: String) -> String? {
        guard let name = defaults.string(forKey: "watch.dl.file.\(key)") else { return nil }
        let path = folder.appendingPathComponent(name).path
        return FileManager.default.fileExists(atPath: path) ? path : nil
    }

    func listen(events: IosDownloadEvents) {
        listeners.append(events)
        session.getAllTasks { tasks in
            DispatchQueue.main.async {
                for task in tasks where task.state == .running {
                    guard let key = task.taskDescription else { continue }
                    self.notify(key, task.progress.fractionCompleted, done: false, failed: false)
                }
            }
        }
    }

    private func cancelTasks(_ key: String, then: @escaping () -> Void) {
        session.getAllTasks { tasks in
            tasks.filter { $0.taskDescription == key }.forEach { $0.cancel() }
            DispatchQueue.main.async(execute: then)
        }
    }

    private func notify(_ key: String, _ progress: Double, done: Bool, failed: Bool) {
        listeners.forEach { $0.changed(key: key, progress: progress, done: done, failed: failed) }
    }

    // MARK: URLSessionDownloadDelegate

    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didWriteData bytesWritten: Int64, totalBytesWritten: Int64, totalBytesExpectedToWrite: Int64) {
        guard let key = downloadTask.taskDescription, totalBytesExpectedToWrite > 0 else { return }
        notify(key, Double(totalBytesWritten) / Double(totalBytesExpectedToWrite), done: false, failed: false)
    }

    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didFinishDownloadingTo location: URL) {
        guard let key = downloadTask.taskDescription else { return }
        if let status = (downloadTask.response as? HTTPURLResponse)?.statusCode, status >= 400 { return }
        let ext = downloadTask.response?.suggestedFilename.flatMap { URL(fileURLWithPath: $0).pathExtension }.flatMap { $0.isEmpty ? nil : $0 } ?? "mkv"
        let name = key.map { $0.isLetter || $0.isNumber || $0 == "-" ? $0 : "_" }.reduce("") { $0 + String($1) } + "." + ext
        let target = folder.appendingPathComponent(name)
        try? FileManager.default.removeItem(at: target)
        do {
            try FileManager.default.moveItem(at: location, to: target)
            defaults.set(name, forKey: "watch.dl.file.\(key)")
            notify(key, 1, done: true, failed: false)
        } catch {
            notify(key, 0, done: false, failed: true)
        }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        guard let key = task.taskDescription else { return }
        if let error = error as? URLError, error.code == .cancelled { return }
        let status = (task.response as? HTTPURLResponse)?.statusCode ?? 200
        if error != nil || status >= 400 { notify(key, 0, done: false, failed: true) }
    }

    func urlSessionDidFinishEvents(forBackgroundURLSession session: URLSession) {
        DispatchQueue.main.async {
            self.finishedEvents?()
            self.finishedEvents = nil
        }
    }
}

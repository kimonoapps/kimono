import FileProvider
import UniformTypeIdentifiers

/// 堂 Kimono Drive in the Files app, beside iCloud Drive. The system keeps a
/// copy of what people open and asks here for what it lacks; changes made in
/// any app come back here to send to Drive.
final class FileProviderExtension: NSObject, NSFileProviderReplicatedExtension {
    private let domain: NSFileProviderDomain

    required init(domain: NSFileProviderDomain) {
        self.domain = domain
        super.init()
    }

    func invalidate() {}

    private func item(_ id: String) async throws -> Item {
        let node = try await Drive.shared.node(id)
        return Item(node, role: await Drive.shared.role(node.spaceId))
    }

    /// Runs async work for a callback-style call, reporting progress and letting the system cancel it.
    private func run<T>(_ units: Int64 = 1, _ done: @escaping (T?, Error?) -> Void, _ work: @escaping (Progress) async throws -> T) -> Progress {
        let progress = Progress(totalUnitCount: units)
        let task = Task {
            do { done(try await work(progress), nil) } catch { done(nil, error) }
        }
        progress.cancellationHandler = { task.cancel() }
        return progress
    }

    func item(for identifier: NSFileProviderItemIdentifier, request: NSFileProviderRequest, completionHandler: @escaping (NSFileProviderItem?, Error?) -> Void) -> Progress {
        if identifier == .rootContainer || identifier == .trashContainer || identifier == .workingSet {
            completionHandler(Item(root: identifier), nil)
            return Progress()
        }
        return run(1, { completionHandler($0, $1) }) { _ in try await self.item(identifier.rawValue) }
    }

    func fetchContents(for identifier: NSFileProviderItemIdentifier, version requestedVersion: NSFileProviderItemVersion?, request: NSFileProviderRequest, completionHandler: @escaping (URL?, NSFileProviderItem?, Error?) -> Void) -> Progress {
        run(1, { (pair: (URL, Item)?, error) in completionHandler(pair?.0, pair?.1, error) }) { _ in
            let item = try await self.item(identifier.rawValue)
            return (try await Drive.shared.download(identifier.rawValue), item)
        }
    }

    func createItem(basedOn template: NSFileProviderItem, fields: NSFileProviderItemFields, contents url: URL?, options: NSFileProviderCreateItemOptions = [], request: NSFileProviderRequest, completionHandler: @escaping (NSFileProviderItem?, NSFileProviderItemFields, Bool, Error?) -> Void) -> Progress {
        run(100, { item, error in completionHandler(item, [], false, error) }) { progress in
            guard template.parentItemIdentifier != .rootContainer else {
                throw NSError(domain: NSCocoaErrorDomain, code: NSFileWriteNoPermissionError, userInfo: [NSLocalizedDescriptionKey: "Make new spaces in the Kimono app."])
            }
            let parent = template.parentItemIdentifier.rawValue
            if template.contentType == .folder || template.contentType?.conforms(to: .folder) == true {
                let created = try await Drive.shared.call(Drive.Node.self, "/api/v1/drive/nodes/\(parent)/folders", method: "POST", json: ["name": template.filename])
                return Item(created, role: await Drive.shared.role(created.spaceId))
            }
            guard let url else { throw NSFileProviderError(.noSuchItem) }
            let sent = try await Upload.send(url, metadata: ["filename": template.filename, "folder": parent], progress: progress)
            return try await self.item(sent.id)
        }
    }

    func modifyItem(_ item: NSFileProviderItem, baseVersion version: NSFileProviderItemVersion, changedFields: NSFileProviderItemFields, contents newContents: URL?, options: NSFileProviderModifyItemOptions = [], request: NSFileProviderRequest, completionHandler: @escaping (NSFileProviderItem?, NSFileProviderItemFields, Bool, Error?) -> Void) -> Progress {
        run(100, { item, error in completionHandler(item, [], false, error) }) { progress in
            let id = item.itemIdentifier.rawValue
            var resultId = id
            if changedFields.contains(.contents), let newContents {
                /* Saved in another app. If someone else saved first, this lands beside theirs as a copy. */
                let base = String(data: version.contentVersion, encoding: .utf8) ?? "0"
                resultId = try await Upload.send(newContents, metadata: ["replaces": id, "base": base], progress: progress).id
            }
            if item.parentItemIdentifier == .trashContainer {
                /* Moved to Recently Deleted: Drive's trash. */
                let before = try await Drive.shared.node(id)
                _ = try await Drive.shared.send(try await Drive.shared.request("/api/v1/drive/nodes/\(id)", method: "DELETE"))
                return Item(before, role: await Drive.shared.role(before.spaceId), trashed: true)
            }
            if changedFields.contains(.parentItemIdentifier), (try? await Drive.shared.node(id)) == nil {
                /* Brought back out of Recently Deleted. */
                _ = try await Drive.shared.call(AnyDecodable.self, "/api/v1/drive/nodes/\(id)/restore", method: "POST")
            }
            var patch: [String: Any] = [:]
            if changedFields.contains(.filename) { patch["name"] = item.filename }
            if changedFields.contains(.parentItemIdentifier), item.parentItemIdentifier != .rootContainer { patch["parent"] = item.parentItemIdentifier.rawValue }
            if !patch.isEmpty, resultId == id {
                _ = try await Drive.shared.call(AnyDecodable.self, "/api/v1/drive/nodes/\(id)", method: "PATCH", json: patch)
            }
            return try await self.item(id)
        }
    }

    func deleteItem(identifier: NSFileProviderItemIdentifier, baseVersion version: NSFileProviderItemVersion, options: NSFileProviderDeleteItemOptions = [], request: NSFileProviderRequest, completionHandler: @escaping (Error?) -> Void) -> Progress {
        /* Drive keeps deleted things in its trash for 30 days, so a delete here can be undone from the Kimono app. */
        run(1, { (_: Bool?, error) in completionHandler(error) }) { _ in
            do { _ = try await Drive.shared.send(try await Drive.shared.request("/api/v1/drive/nodes/\(identifier.rawValue)", method: "DELETE")) }
            catch let error as NSFileProviderError where error.code == .noSuchItem {}
            return true
        }
    }

    func enumerator(for containerItemIdentifier: NSFileProviderItemIdentifier, request: NSFileProviderRequest) throws -> NSFileProviderEnumerator {
        Enumerator(containerItemIdentifier)
    }
}

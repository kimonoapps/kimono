import FileProvider

/// Lists a folder, the spaces at the top, Shared with you, or the trash.
/// Changes to all of them come through the working set, from Drive's change feed.
final class Enumerator: NSObject, NSFileProviderEnumerator {
    private let container: NSFileProviderItemIdentifier
    init(_ container: NSFileProviderItemIdentifier) { self.container = container }

    func invalidate() {}

    func enumerateItems(for observer: NSFileProviderEnumerationObserver, startingAt page: NSFileProviderPage) {
        Task {
            do {
                let drive = Drive.shared
                var items: [NSFileProviderItem] = []
                switch container {
                case .workingSet:
                    break /* Everything arrives as changes; folders are listed as they are opened. */
                case .rootContainer:
                    for space in try await drive.spaces() {
                        items.append(Item(try await drive.node(space.rootId), role: space.role))
                    }
                    if (try? await drive.sharedWithYou())?.isEmpty == false { items.append(Item(root: Item.shared)) }
                case Item.shared:
                    let shared = try await drive.sharedWithYou()
                    SharedRoles.remember(shared)
                    for node in shared { items.append(Item(node, role: node.role)) }
                case .trashContainer:
                    for node in try await drive.trash() { items.append(Item(node, role: await drive.role(node.spaceId), trashed: true)) }
                default:
                    for node in try await drive.children(container.rawValue) { items.append(Item(node, role: await drive.role(of: node))) }
                }
                observer.didEnumerate(items)
                observer.finishEnumerating(upTo: nil)
            } catch {
                observer.finishEnumeratingWithError(error)
            }
        }
    }

    func enumerateChanges(for observer: NSFileProviderChangeObserver, from anchor: NSFileProviderSyncAnchor) {
        guard container == .workingSet else {
            observer.finishEnumeratingChanges(upTo: anchor, moreComing: false)
            return
        }
        Task {
            do {
                let since = Int(String(data: anchor.rawValue, encoding: .utf8) ?? "") ?? 0
                let drive = Drive.shared
                let changes = try await drive.changes(since: since)
                let roles = Dictionary(uniqueKeysWithValues: changes.spaces.map { ($0.id, $0.role) })
                var updated: [NSFileProviderItem] = changes.changed.map { Item($0, role: $0.role ?? roles[$0.spaceId]) }
                var shared = changes.changed.filter(\.isSharedWithYou)
                /* Once, on a phone that had them before Shared with you: they move into it. */
                if !SharedRoles.seeded, let all = try? await drive.sharedWithYou() {
                    let known = Set(shared.map(\.id))
                    let earlier = all.filter { !known.contains($0.id) }
                    updated.append(contentsOf: earlier.map { Item($0, role: $0.role) })
                    shared.append(contentsOf: earlier)
                    SharedRoles.seeded = true
                }
                /* Shared with you appears with the first thing shared, and goes with the last one left or taken off. */
                if !shared.isEmpty { updated.insert(Item(root: Item.shared), at: 0) }
                /* A share whose role changed: what's inside, already on the phone, changes with it. */
                for node in shared where node.kind == "folder" && SharedRoles.changed(node) {
                    updated.append(contentsOf: try await Enumerator.inside(node.id, role: node.role))
                }
                SharedRoles.remember(shared)
                if !updated.isEmpty { observer.didUpdate(updated) }
                var removed = changes.removed.map { NSFileProviderItemIdentifier($0) }
                if !changes.removed.isEmpty, SharedRoles.forget(changes.removed), (try? await drive.sharedWithYou())?.isEmpty == true { removed.append(Item.shared) }
                if !removed.isEmpty { observer.didDeleteItems(withIdentifiers: removed) }
                observer.finishEnumeratingChanges(upTo: Self.anchor(changes.cursor), moreComing: changes.more)
            } catch {
                observer.finishEnumeratingWithError(error)
            }
        }
    }

    func currentSyncAnchor(completionHandler: @escaping (NSFileProviderSyncAnchor?) -> Void) {
        Task { completionHandler((try? await Drive.shared.latestCursor()).map(Self.anchor)) }
    }

    static func anchor(_ cursor: Int) -> NSFileProviderSyncAnchor { NSFileProviderSyncAnchor(Data(String(cursor).utf8)) }

    /// Everything under a folder, as far as a few hundred items, carrying [role].
    static func inside(_ folderId: String, role: String?) async throws -> [Item] {
        var out: [Item] = [], queue = [folderId]
        while let next = queue.popLast(), out.count < 500 {
            for node in try await Drive.shared.children(next) {
                out.append(Item(node, role: node.role ?? role))
                if node.kind == "folder" { queue.append(node.id) }
            }
        }
        return out
    }
}

/// The roles things were shared with this person as, last heard, so a change of role is noticed.
enum SharedRoles {
    private static let key = "kimono.sharedRoles"
    private static var known: [String: String] { UserDefaults.standard.dictionary(forKey: key) as? [String: String] ?? [:] }

    /// Whether what was shared before this version has been placed in Shared with you.
    static var seeded: Bool {
        get { UserDefaults.standard.bool(forKey: "kimono.sharedSeeded") }
        set { UserDefaults.standard.set(newValue, forKey: "kimono.sharedSeeded") }
    }

    static func changed(_ node: Drive.Node) -> Bool {
        guard let before = known[node.id] else { return false }
        return before != node.role
    }

    static func remember(_ nodes: [Drive.Node]) {
        guard !nodes.isEmpty else { return }
        var all = known
        for node in nodes { all[node.id] = node.role ?? "" }
        UserDefaults.standard.set(all, forKey: key)
    }

    /// Forgets the removed ones; true when any was shared with this person.
    static func forget(_ ids: [String]) -> Bool {
        var all = known
        let gone = ids.filter { all.removeValue(forKey: $0) != nil }
        if !gone.isEmpty { UserDefaults.standard.set(all, forKey: key) }
        return !gone.isEmpty
    }
}

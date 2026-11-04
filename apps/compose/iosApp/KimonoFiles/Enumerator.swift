import FileProvider

/// Lists a folder, the spaces at the top, or the trash. Changes to all of
/// them come through the working set, from Drive's change feed.
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
                case .trashContainer:
                    for node in try await drive.trash() { items.append(Item(node, role: await drive.role(node.spaceId), trashed: true)) }
                default:
                    for node in try await drive.children(container.rawValue) { items.append(Item(node, role: await drive.role(node.spaceId))) }
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
                let changes = try await Drive.shared.changes(since: since)
                let roles = Dictionary(uniqueKeysWithValues: changes.spaces.map { ($0.id, $0.role) })
                if !changes.changed.isEmpty { observer.didUpdate(changes.changed.map { Item($0, role: roles[$0.spaceId]) }) }
                if !changes.removed.isEmpty { observer.didDeleteItems(withIdentifiers: changes.removed.map { NSFileProviderItemIdentifier($0) }) }
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
}

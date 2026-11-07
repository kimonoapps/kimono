import FileProvider
import UniformTypeIdentifiers

/// A Drive node as the Files app sees it. Spaces sit at the top, under Kimono,
/// beside Shared with you, which holds what others shared from their spaces.
final class Item: NSObject, NSFileProviderItem {
    static let shared = NSFileProviderItemIdentifier("shared-with-you")

    let node: Drive.Node?
    let role: String?
    /** In Drive's trash, which the Files app shows as Recently Deleted. */
    let inTrash: Bool
    private let identifier: NSFileProviderItemIdentifier

    init(_ node: Drive.Node, role: String?, trashed: Bool = false) {
        self.node = node
        self.role = role
        self.inTrash = trashed
        self.identifier = NSFileProviderItemIdentifier(node.id)
    }

    /// The top of Kimono in the Files app, holding the spaces.
    init(root identifier: NSFileProviderItemIdentifier) {
        self.node = nil
        self.role = nil
        self.inTrash = false
        self.identifier = identifier
    }

    var itemIdentifier: NSFileProviderItemIdentifier { identifier }

    var parentItemIdentifier: NSFileProviderItemIdentifier {
        if inTrash { return .trashContainer }
        guard let node else { return .rootContainer }
        if node.isSharedWithYou { return Item.shared }
        guard let parent = node.parentId else { return .rootContainer }
        return NSFileProviderItemIdentifier(parent)
    }

    var filename: String { node?.name ?? (identifier == Item.shared ? "Shared with you" : "Kimono") }

    var contentType: UTType {
        guard let node else { return .folder }
        if node.kind == "folder" { return .folder }
        return UTType(filenameExtension: (node.name as NSString).pathExtension) ?? node.mime.flatMap { UTType(mimeType: $0) } ?? .data
    }

    var documentSize: NSNumber? { node.map { NSNumber(value: $0.size) } }
    var creationDate: Date? { node.map { Date(timeIntervalSince1970: $0.createdAt / 1000) } }
    var contentModificationDate: Date? { node.map { Date(timeIntervalSince1970: $0.updatedAt / 1000) } }

    /// Bytes change only with contentVersion; anything else with version.
    var itemVersion: NSFileProviderItemVersion {
        guard let node else { return NSFileProviderItemVersion(contentVersion: Data(identifier.rawValue.utf8), metadataVersion: Data(identifier.rawValue.utf8)) }
        /* What the person may do is part of how it looks: a share made view-only shows anew. */
        return NSFileProviderItemVersion(contentVersion: Data(String(node.contentVersion).utf8), metadataVersion: Data("\(node.version)-\(role ?? "")".utf8))
    }

    /*
     * The simulator can't lay out a read-only file or folder (its daemon fails to set metadata on
     * the Mac's disk after making it read-only), so there everything stays writable on disk and the
     * server refuses a viewer's change. A real iPhone gets the read-only items Files expects.
     */
    #if targetEnvironment(simulator)
    private static let onDiskReadOnly = false
    #else
    private static let onDiskReadOnly = true
    #endif

    var capabilities: NSFileProviderItemCapabilities {
        guard let node else {
            /* Shared with you is a folder on disk too: on the simulator it can't be laid out read-only (see above). */
            return identifier == Item.shared && !Item.onDiskReadOnly ? [.allowsReading, .allowsContentEnumerating, .allowsAddingSubItems] : [.allowsReading, .allowsContentEnumerating]
        }
        let canEdit = role == "owner" || role == "editor"
        let isTop = node.parentId == nil
        let writable = canEdit || !Item.onDiskReadOnly
        if node.isSharedWithYou {
            /* It stays where it is in its owner's space: it can be renamed, and deleting it here leaves it. */
            var caps: NSFileProviderItemCapabilities = [.allowsReading, .allowsDeleting]
            if node.kind == "folder" { caps.formUnion([.allowsContentEnumerating]) }
            if writable { caps.formUnion(node.kind == "folder" ? [.allowsAddingSubItems] : [.allowsWriting]) }
            if canEdit { caps.formUnion([.allowsRenaming]) }
            return caps
        }
        if node.kind == "folder" {
            var caps: NSFileProviderItemCapabilities = [.allowsReading, .allowsContentEnumerating]
            if writable { caps.formUnion([.allowsAddingSubItems]) }
            if canEdit && !isTop { caps.formUnion([.allowsRenaming, .allowsReparenting, .allowsTrashing, .allowsDeleting]) }
            return caps
        }
        var caps: NSFileProviderItemCapabilities = [.allowsReading]
        if writable { caps.formUnion([.allowsWriting]) }
        if canEdit { caps.formUnion([.allowsRenaming, .allowsReparenting, .allowsTrashing, .allowsDeleting]) }
        return caps
    }
}

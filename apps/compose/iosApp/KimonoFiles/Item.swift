import FileProvider
import UniformTypeIdentifiers

/// A Drive node as the Files app sees it. Spaces sit at the top, under Kimono.
final class Item: NSObject, NSFileProviderItem {
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
        guard let node, let parent = node.parentId else { return .rootContainer }
        return NSFileProviderItemIdentifier(parent)
    }

    var filename: String { node?.name ?? "Kimono" }

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
        guard let node else { return NSFileProviderItemVersion(contentVersion: Data("root".utf8), metadataVersion: Data("root".utf8)) }
        return NSFileProviderItemVersion(contentVersion: Data(String(node.contentVersion).utf8), metadataVersion: Data(String(node.version).utf8))
    }

    var capabilities: NSFileProviderItemCapabilities {
        guard let node else { return [.allowsReading, .allowsContentEnumerating] }
        let canEdit = role == "owner" || role == "editor"
        let isTop = node.parentId == nil
        if node.kind == "folder" {
            var caps: NSFileProviderItemCapabilities = [.allowsReading, .allowsContentEnumerating]
            if canEdit { caps.formUnion([.allowsAddingSubItems]) }
            if canEdit && !isTop { caps.formUnion([.allowsRenaming, .allowsReparenting, .allowsTrashing, .allowsDeleting]) }
            return caps
        }
        return canEdit ? [.allowsReading, .allowsWriting, .allowsRenaming, .allowsReparenting, .allowsTrashing, .allowsDeleting] : [.allowsReading]
    }
}

import Foundation
import FileProvider
import Security

/// Kimono Drive's API as the Files app extension uses it, signed in with the
/// app's sign-in (shared through the Keychain).
actor Drive {
    static let shared = Drive()

    struct Node: Decodable, Sendable {
        let id: String
        let spaceId: String
        let parentId: String?
        let kind: String
        let name: String
        let size: Int64
        let mime: String?
        let createdAt: Double
        let updatedAt: Double
        let version: Int
        let contentVersion: Int
        /// What this person may do with it; Drive says so for things shared from spaces they aren't in.
        let role: String?
        /// Shared with them on its own, from a space they aren't in: it stands in Shared with you.
        let sharedWithYou: Bool?

        var isSharedWithYou: Bool { sharedWithYou == true }
    }
    struct Space: Decodable, Sendable { let id: String; let rootId: String; let role: String }
    struct Folder: Decodable { let folder: Node; let children: [Node] }
    struct FileAnswer: Decodable { let file: Node }
    struct Changes: Decodable { let cursor: Int; let changed: [Node]; let removed: [String]; let more: Bool; let spaces: [Space] }
    struct Cursor: Decodable { let cursor: Int }
    struct Failure: Decodable { let error: String }
    struct SpaceList: Decodable { let spaces: [Space] }
    struct TrashList: Decodable { let items: [Node] }
    struct Me: Decodable { let username: String }

    /// Roles by space, refreshed with every change check, deciding what the Files app offers.
    private(set) var roles: [String: String] = [:]
    private var access: (token: String, expires: Date)?

    // MARK: Keychain (the same items the app keeps)

    private static let group = Bundle.main.object(forInfoDictionaryKey: "KimonoKeychainGroup") as? String

    static func kept(_ key: String) -> String? {
        for grouped in [true, false] {
            var q: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "app.kimono", kSecAttrAccount as String: key,
                                    kSecReturnData as String: true, kSecMatchLimit as String: kSecMatchLimitOne]
            if grouped, let group, !group.hasPrefix("$(") { q[kSecAttrAccessGroup as String] = group }
            var out: AnyObject?
            let status = SecItemCopyMatching(q as CFDictionary, &out)
            if status == errSecSuccess, let data = out as? Data { return String(data: data, encoding: .utf8) }
            if status != errSecMissingEntitlement { return nil }
        }
        return nil
    }

    static func keep(_ key: String, _ value: String) {
        for grouped in [true, false] {
            var q: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "app.kimono", kSecAttrAccount as String: key]
            if grouped, let group, !group.hasPrefix("$(") { q[kSecAttrAccessGroup as String] = group }
            /* Moves items kept before ThisDeviceOnly over to it as they are rewritten. */
            let change: [String: Any] = [kSecValueData as String: Data(value.utf8), kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly]
            let status = SecItemUpdate(q as CFDictionary, change as CFDictionary)
            if status != errSecMissingEntitlement { return }
        }
    }

    // MARK: Signing in

    /* One renewal at a time: the actor lets other calls in while one waits on the network. */
    private var renewing: Task<String, Error>?

    private func token() async throws -> String {
        if let access, access.expires.timeIntervalSinceNow > 60 { return access.token }
        if let renewing { return try await renewing.value }
        let task = Task { try await renew() }
        renewing = task
        defer { renewing = nil }
        return try await task.value
    }

    private func renew() async throws -> String {
        guard let issuer = Drive.kept("kimono.issuer"), let client = Drive.kept("kimono.clientId"), var refresh = Drive.kept("kimono.refresh") else {
            throw NSFileProviderError(.notAuthenticated)
        }
        let discovery = try await json([String: AnyDecodable].self, URLRequest(url: URL(string: issuer.trimmingCharacters(in: CharacterSet(charactersIn: "/")) + "/.well-known/openid-configuration")!))
        guard let endpoint = discovery["token_endpoint"]?.string, let url = URL(string: endpoint) else { throw NSFileProviderError(.serverUnreachable) }
        func ask(_ refresh: String) async throws -> [String: AnyDecodable] {
            var request = URLRequest(url: url)
            request.httpMethod = "POST"
            request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
            var form = URLComponents()
            form.queryItems = [.init(name: "grant_type", value: "refresh_token"), .init(name: "client_id", value: client), .init(name: "refresh_token", value: refresh)]
            request.httpBody = form.percentEncodedQuery?.data(using: .utf8)
            let (data, response) = try await fetch(request)
            guard response.statusCode < 500, let answer = try? JSONDecoder().decode([String: AnyDecodable].self, from: data) else { throw NSFileProviderError(.serverUnreachable) }
            return answer
        }
        var answer = try await ask(refresh)
        /* Refused, perhaps because the app renewed at the same moment and is still saving
           the token it got: give it a few seconds, and try again with what it kept. */
        var waited = 0
        while answer["access_token"]?.string == nil, waited < 5 {
            guard let again = Drive.kept("kimono.refresh") else { break }
            if again != refresh { refresh = again; answer = try await ask(again); continue }
            try await Task.sleep(nanoseconds: 1_000_000_000)
            waited += 1
        }
        guard let token = answer["access_token"]?.string else { throw NSFileProviderError(.notAuthenticated) }
        if let renewed = answer["refresh_token"]?.string, renewed != refresh { Drive.keep("kimono.refresh", renewed) }
        access = (token, Date().addingTimeInterval(answer["expires_in"]?.number ?? 300))
        return token
    }

    private func server() throws -> URL {
        guard let server = Drive.kept("kimono.server"), let url = URL(string: server) else { throw NSFileProviderError(.notAuthenticated) }
        return url
    }

    // MARK: Calls

    func request(_ path: String, method: String = "GET", headers: [String: String] = [:]) async throws -> URLRequest {
        var request = URLRequest(url: URL(string: path, relativeTo: try server())!)
        request.httpMethod = method
        request.setValue("Bearer \(try await token())", forHTTPHeaderField: "Authorization")
        for (name, value) in headers { request.setValue(value, forHTTPHeaderField: name) }
        return request
    }

    private nonisolated func fetch(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        let data: Data, response: URLResponse
        do { (data, response) = try await URLSession.shared.data(for: request) } catch { throw NSFileProviderError(.serverUnreachable) }
        return (data, response as! HTTPURLResponse)
    }

    /// Calls the Portal, turning its refusals into errors the Files app understands.
    func send(_ request: URLRequest, body: Data? = nil) async throws -> (Data, HTTPURLResponse) {
        var request = request
        if let body { request.httpBody = body }
        let (data, response) = try await fetch(request)
        switch response.statusCode {
        case 200..<300: return (data, response)
        case 401: access = nil; throw NSFileProviderError(.notAuthenticated)
        case 403:
            /* A refusal by role (a viewer adding or changing something): a kind of error Files knows, so it stops retrying. */
            let message = (try? JSONDecoder().decode(Failure.self, from: data))?.error ?? "You can only view this space."
            throw NSError(domain: NSCocoaErrorDomain, code: NSFileWriteNoPermissionError, userInfo: [NSLocalizedDescriptionKey: message])
        case 404: throw NSFileProviderError(.noSuchItem)
        case 409: throw NSFileProviderError(.filenameCollision)
        case 410: throw NSFileProviderError(.syncAnchorExpired)
        case 507: throw NSFileProviderError(.insufficientQuota)
        default:
            let message = (try? JSONDecoder().decode(Failure.self, from: data))?.error ?? "Kimono couldn't do that."
            throw NSError(domain: "app.kimono", code: response.statusCode, userInfo: [NSLocalizedDescriptionKey: message])
        }
    }

    func json<T: Decodable>(_ type: T.Type, _ request: URLRequest, body: Data? = nil) async throws -> T {
        try JSONDecoder().decode(T.self, from: try await send(request, body: body).0)
    }

    func call<T: Decodable>(_ type: T.Type, _ path: String, method: String = "GET", json body: [String: Any]? = nil) async throws -> T {
        let request = try await request(path, method: method, headers: body == nil ? [:] : ["Content-Type": "application/json"])
        return try await json(T.self, request, body: body.map { try! JSONSerialization.data(withJSONObject: $0) })
    }

    // MARK: Drive

    func spaces() async throws -> [Space] {
        let spaces = try await call(SpaceList.self, "/api/v1/drive/spaces").spaces
        roles = Dictionary(uniqueKeysWithValues: spaces.map { ($0.id, $0.role) })
        return spaces
    }

    func node(_ id: String) async throws -> Node {
        let (data, _) = try await send(try await request("/api/v1/drive/nodes/\(id)"))
        if let file = try? JSONDecoder().decode(FileAnswer.self, from: data) { return file.file }
        return try JSONDecoder().decode(Folder.self, from: data).folder
    }

    func children(_ id: String) async throws -> [Node] {
        try await call(Folder.self, "/api/v1/drive/nodes/\(id)").children
    }

    func trash() async throws -> [Node] { try await call(TrashList.self, "/api/v1/drive/trash").items }

    /// Folders and files shared with this person from spaces they aren't in.
    func sharedWithYou() async throws -> [Node] { try await call(TrashList.self, "/api/v1/drive/shared-with-you").items }

    private var username: String?

    /// Takes this person off something shared with them: it leaves their Drive, not anyone else's.
    func leave(_ id: String) async throws {
        if username == nil { username = try await call(Me.self, "/api/v1/me").username }
        _ = try await call(AnyDecodable.self, "/api/v1/drive/nodes/\(id)/shares", method: "PUT", json: ["username": username!, "role": NSNull()])
    }

    func latestCursor() async throws -> Int { try await call(Cursor.self, "/api/v1/drive/changes").cursor }

    func changes(since: Int) async throws -> Changes {
        let changes = try await call(Changes.self, "/api/v1/drive/changes?since=\(since)")
        roles = Dictionary(uniqueKeysWithValues: changes.spaces.map { ($0.id, $0.role) })
        return changes
    }

    func role(_ spaceId: String) async -> String? {
        if roles[spaceId] == nil { _ = try? await spaces() }
        return roles[spaceId]
    }

    /// What the person may do with a node: as Drive says for it, else their role in its space.
    func role(of node: Node) async -> String? {
        if let role = node.role { return role }
        return await role(node.spaceId)
    }

    /// Up to `length` bytes of a file from `offset`, for reading part of it without downloading it all.
    func read(_ id: String, offset: Int64, length: Int) async throws -> Data {
        let request = try await request("/api/v1/drive/nodes/\(id)/content", headers: ["Range": "bytes=\(offset)-\(offset + Int64(length) - 1)"])
        let (data, response) = try await send(request)
        /* A server that ignores ranges sends it all: keep the part asked for. */
        if response.statusCode == 200, offset > 0 || data.count > length {
            let start = Int(min(offset, Int64(data.count)))
            return data.subdata(in: start..<min(data.count, start + length))
        }
        return data
    }

    /// Where a file's bytes are, with what it takes to read them, for players that fetch ranges themselves.
    func contentAccess(_ id: String) async throws -> (url: URL, headers: [String: String]) {
        let request = try await request("/api/v1/drive/nodes/\(id)/content")
        return (request.url!.absoluteURL, ["Authorization": request.value(forHTTPHeaderField: "Authorization") ?? ""])
    }

    /// Downloads a file's bytes to a temporary file.
    func download(_ id: String) async throws -> URL {
        let request = try await request("/api/v1/drive/nodes/\(id)/content")
        let (url, response): (URL, URLResponse)
        do { (url, response) = try await URLSession.shared.download(for: request) } catch { throw NSFileProviderError(.serverUnreachable) }
        let status = (response as! HTTPURLResponse).statusCode
        if status == 404 { throw NSFileProviderError(.noSuchItem) }
        if status == 401 { access = nil; throw NSFileProviderError(.notAuthenticated) }
        guard status == 200 else { throw NSFileProviderError(.serverUnreachable) }
        let kept = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.moveItem(at: url, to: kept)
        return kept
    }
}

/// Just enough JSON for the sign-in answers.
struct AnyDecodable: Decodable {
    let value: Any
    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if let s = try? c.decode(String.self) { value = s }
        else if let n = try? c.decode(Double.self) { value = n }
        else if let b = try? c.decode(Bool.self) { value = b }
        else { value = NSNull() }
    }
    var string: String? { value as? String }
    var number: Double? { value as? Double }
}

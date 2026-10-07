import Foundation

struct WidgetGrant: Codable {
    let token: String
    let scope: String
    let expires: Double
    let generation: String
}

enum WidgetBackground {
    static var directory: URL? { FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: "group.care.familytrack.app") }
    static func url(_ name: String) -> URL? { directory?.appendingPathComponent(name) }
    static func grant() -> WidgetGrant? {
        guard let file = url("widget-access.json"), let data = try? Data(contentsOf: file) else { return nil }
        return try? JSONDecoder().decode(WidgetGrant.self, from: data)
    }
    static func removeOldCaches() {
        guard let directory = directory, let files = try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil) else { return }
        for file in files where file.lastPathComponent.hasPrefix("widget-cache-") || file.lastPathComponent.hasPrefix("widget-denied-") || file.lastPathComponent.hasPrefix("widget-action-") {
            try? FileManager.default.removeItem(at: file)
        }
    }
    static func denied(_ grant: WidgetGrant) -> Bool {
        guard let file = url("widget-denied-\(grant.generation)") else { return true }
        return FileManager.default.fileExists(atPath: file.path)
    }
    static func save(_ data: Data, name: String) throws {
        guard var file = url(name) else { throw URLError(.cannotCreateFile) }
        try data.write(to: file, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        var values = URLResourceValues(); values.isExcludedFromBackup = true
        try file.setResourceValues(values)
    }
    static func dictionary(_ name: String) -> [String: Any]? {
        guard let file = url(name), let data = try? Data(contentsOf: file), data.count < 250000 else { return nil }
        return (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
    }
    static func snapshotData() -> Data? {
        let local = dictionary("widgets.json")
        guard let access = grant() else { return local.flatMap { try? JSONSerialization.data(withJSONObject: $0) } }
        guard access.expires > Date().timeIntervalSince1970, !denied(access) else { return nil }
        let matchingLocal = local?["scope"] as? String == access.scope ? local : nil
        guard let remote = dictionary("widget-cache-\(access.generation).json"),
              let profiles = remote["children"] as? [[String: Any]] else {
            return matchingLocal.flatMap { try? JSONSerialization.data(withJSONObject: $0) }
        }
        let saved = matchingLocal?["children"] as? [[String: Any]] ?? []
        // The most recent successful catalogue controls which profiles still exist.
        let remoteTime = remote["fetchedAt"] as? Double ?? 0
        let localTime = matchingLocal?["catalogueUpdated"] as? Double ?? 0
        let catalogue = localTime > remoteTime ? saved : profiles
        let merged = catalogue.map { item -> [String: Any] in
            let id = item["id"] as? String
            let localProfile = saved.first { $0["id"] as? String == id }
            let remoteProfile = profiles.first { $0["id"] as? String == id }
            var chosen = (localProfile?["updated"] as? Double ?? 0) > (remoteProfile?["updated"] as? Double ?? 0) ? localProfile ?? item : remoteProfile ?? item
            // Action permissions and state come only from a successful server snapshot.
            for key in ["canStartSleep", "canEndSleep", "sleepLogId", "sleepCompletedAt", "canStartSchool", "canEndSchool", "schoolLogId", "schoolUpdatedAt", "schoolDeparture", "schoolPickupAt", "schoolDayEnd"] {
                chosen[key] = remoteProfile?[key]
            }
            if let photo = localProfile?["photo"] as? String { chosen["photo"] = photo }
            return chosen
        }
        guard grant()?.generation == access.generation else { return nil }
        return try? JSONSerialization.data(withJSONObject: ["children": merged])
    }
    static func revoke(_ access: WidgetGrant) {
        var request = URLRequest(url: URL(string: "https://familytrack.care/api/widgets/access")!)
        request.httpMethod = "DELETE"; request.timeoutInterval = 8
        request.setValue("Bearer \(access.token)", forHTTPHeaderField: "Authorization")
        let session = URLSession(configuration: .ephemeral, delegate: WidgetNoRedirect(), delegateQueue: nil)
        session.dataTask(with: request) { _, _, _ in session.finishTasksAndInvalidate() }.resume()
    }
}

final class WidgetNoRedirect: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) { completionHandler(nil) }
}

actor WidgetFetcher {
    static let shared = WidgetFetcher()
    private var pending: Task<Void, Never>?
    func refresh(force: Bool = false) async {
        if let pending = pending { await pending.value; return }
        let task = Task { await Self.fetch(force: force) }
        pending = task; await task.value; pending = nil
    }
    private static func fetch(force: Bool) async {
        guard let access = WidgetBackground.grant(), access.expires > Date().timeIntervalSince1970,
              !WidgetBackground.denied(access) else { return }
        if !force, let cached = WidgetBackground.dictionary("widget-cache-\(access.generation).json"),
           let fetched = cached["fetchedAt"] as? Double, Date().timeIntervalSince1970 - fetched < 60 { return }
        var components = URLComponents(string: "https://familytrack.care/api/widgets/snapshot")!
        components.queryItems = [URLQueryItem(name: "timeZone", value: TimeZone.current.identifier)]
        var request = URLRequest(url: components.url!); request.timeoutInterval = 12
        request.setValue("Bearer \(access.token)", forHTTPHeaderField: "Authorization")
        let config = URLSessionConfiguration.ephemeral
        config.httpCookieStorage = nil; config.urlCache = nil; config.timeoutIntervalForResource = 15
        let session = URLSession(configuration: config, delegate: WidgetNoRedirect(), delegateQueue: nil)
        defer { session.invalidateAndCancel() }
        do {
            let (bytes, response) = try await session.bytes(for: request)
            guard let response = response as? HTTPURLResponse,
                  WidgetBackground.grant()?.generation == access.generation else { return }
            if [401,403].contains(response.statusCode) {
                try WidgetBackground.save(Data(), name: "widget-denied-\(access.generation)")
                return
            }
            guard response.statusCode == 200, response.expectedContentLength < 200000 else { return }
            var data = Data()
            for try await byte in bytes {
                guard data.count < 200000 else { return }; data.append(byte)
            }
            guard let body = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                  var snapshot = body["data"] as? [String: Any],
                  let profiles = snapshot["children"] as? [[String: Any]], profiles.count <= 50,
                  profiles.allSatisfy({ ($0["id"] as? String)?.hasPrefix(String(access.scope.split(separator: ":").last ?? "") + ":") == true &&
                      $0["name"] is String && $0["updated"] is Double && $0["day"] is String &&
                      $0["fluid"] is Double && $0["target"] is Double && $0["medicines"] is [[String: Any]] && $0["care"] is [String: Any] }),
                  WidgetBackground.grant()?.generation == access.generation else { return }
            snapshot["fetchedAt"] = Date().timeIntervalSince1970
            try WidgetBackground.save(JSONSerialization.data(withJSONObject: snapshot), name: "widget-cache-\(access.generation).json")
        } catch { /* Retain the last successful snapshot and its real timestamp. */ }
    }
}

import Foundation
import Capacitor
import WidgetKit

@objc(WidgetBridgePlugin)
public class WidgetBridgePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "WidgetBridgePlugin"
    public let jsName = "WidgetBridge"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "write", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clear", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "connection", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "connect", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "consumeOpen", returnType: CAPPluginReturnPromise)
    ]
    private var file: URL? {
        FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: "group.care.familytrack.app")?.appendingPathComponent("widgets.json")
    }
    @objc func write(_ call: CAPPluginCall) {
        guard let json = call.getString("json"), let data = json.data(using: .utf8), data.count < 200000, let file = file else {
            call.reject("Widget storage unavailable"); return
        }
        do {
            guard var incoming = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let scope = incoming["scope"] as? String, !scope.isEmpty,
                  let profiles = incoming["children"] as? [[String: Any]] else {
                call.reject("Invalid widget snapshot"); return
            }
            // A relaunch rebuilds the JavaScript cache. Keep each other profile's
            // real snapshot instead of replacing it with an unsynced picker entry.
            // Only merge within the same signed-in account/family, and only retain
            // profiles still present in the incoming authorised catalogue.
            var saved: [String: [String: Any]] = [:]
            if let previousData = try? Data(contentsOf: file),
               let previous = (try? JSONSerialization.jsonObject(with: previousData)) as? [String: Any],
               previous["scope"] as? String == scope,
               let previousProfiles = previous["children"] as? [[String: Any]] {
                for profile in previousProfiles {
                    if let id = profile["id"] as? String { saved[id] = profile }
                }
            }
            incoming["children"] = profiles.map { profile -> [String: Any] in
                guard let id = profile["id"] as? String,
                      let updated = profile["updated"] as? Double, updated == 0,
                      var cached = saved[id] else { return profile }
                cached["name"] = profile["name"]
                return cached
            }
            let merged = try JSONSerialization.data(withJSONObject: incoming)
            guard merged.count < 200000 else { call.reject("Widget snapshot too large"); return }
            try WidgetBackground.save(merged, name: "widgets.json")
            WidgetCenter.shared.reloadAllTimelines()
            call.resolve()
        } catch { call.reject("Could not update widgets") }
    }
    @objc func consumeOpen(_ call: CAPPluginCall) {
        let value = UserDefaults.standard.string(forKey: "widgetOpen") ?? ""
        UserDefaults.standard.removeObject(forKey: "widgetOpen")
        call.resolve(["url": value])
    }
    @objc func clear(_ call: CAPPluginCall) {
        let previous = WidgetBackground.grant()
        if let access = WidgetBackground.url("widget-access.json") { try? FileManager.default.removeItem(at: access) }
        if let file = file { try? FileManager.default.removeItem(at: file) }
        WidgetBackground.removeOldCaches()
        if let previous = previous { WidgetBackground.revoke(previous) }
        WidgetCenter.shared.reloadAllTimelines()
        call.resolve()
    }
    @objc func connection(_ call: CAPPluginCall) {
        let key = "widgetInstallation"
        let installation = UserDefaults.standard.string(forKey: key) ?? UUID().uuidString
        UserDefaults.standard.set(installation, forKey: key)
        let access = WidgetBackground.grant()
        call.resolve(["installationId": installation, "scope": access?.scope ?? "",
                      "expires": access.map { WidgetBackground.denied($0) ? 0 : $0.expires } ?? 0])
    }
    @objc func connect(_ call: CAPPluginCall) {
        guard let token = call.getString("token"), token.range(of: "^ftw_[A-Za-z0-9_-]{43}$", options: .regularExpression) != nil,
              let scope = call.getString("scope"), !scope.isEmpty, let expires = call.getDouble("expires"),
              expires > Date().timeIntervalSince1970 else { call.reject("Invalid widget access"); return }
        do {
            let access = WidgetGrant(token: token, scope: scope, expires: expires, generation: UUID().uuidString)
            try WidgetBackground.save(JSONEncoder().encode(access), name: "widget-access.json")
            WidgetBackground.removeOldCaches()
            Task {
                await WidgetFetcher.shared.refresh(force: true)
                WidgetCenter.shared.reloadAllTimelines()
            }
            WidgetCenter.shared.reloadAllTimelines(); call.resolve()
        } catch { call.reject("Could not connect widgets") }
    }
}

class FamilyTrackBridgeController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(WidgetBridgePlugin())
    }
}

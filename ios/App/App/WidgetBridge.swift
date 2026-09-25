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
            try merged.write(to: file, options: [.atomic, .completeFileProtection])
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
        if let file = file { try? FileManager.default.removeItem(at: file) }
        WidgetCenter.shared.reloadAllTimelines()
        call.resolve()
    }
}

class FamilyTrackBridgeController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(WidgetBridgePlugin())
    }
}

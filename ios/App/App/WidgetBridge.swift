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
            try data.write(to: file, options: [.atomic, .completeFileProtection])
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

import Foundation
import WidgetKit
import SwiftUI
import AppIntents

struct CareRecord: Codable {
    var label: String
    var timestamp: Double
}
struct MedicineRecord: Codable {
    var name: String
    var dose: String
    var timestamp: Double
}
struct ChildSnapshot: Codable, Identifiable {
    var id: String
    var name: String
    var updated: Double
    var day: String
    var fluid: Double
    var target: Double
    var medicines: [MedicineRecord]
    var care: [String: CareRecord]
}
struct WidgetSnapshot: Codable {
    var children: [ChildSnapshot]
    static func load() -> WidgetSnapshot {
        guard let url = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: "group.care.familytrack.app")?.appendingPathComponent("widgets.json"),
              let data = try? Data(contentsOf: url), let snapshot = try? JSONDecoder().decode(Self.self, from: data) else { return Self(children: []) }
        return snapshot
    }
}
@available(iOS 17.0, *)
struct CareChild: AppEntity {
    static var typeDisplayRepresentation: TypeDisplayRepresentation = "Child"
    static var defaultQuery = ChildQuery()
    var id: String
    var name: String
    var displayRepresentation: DisplayRepresentation { DisplayRepresentation(title: "\(name)") }
}
@available(iOS 17.0, *)
struct ChildQuery: EntityQuery {
    func entities(for identifiers: [String]) async throws -> [CareChild] {
        let children = try await suggestedEntities()
        return children.filter { identifiers.contains($0.id) }
    }
    func suggestedEntities() async throws -> [CareChild] {
        WidgetSnapshot.load().children.map { CareChild(id: $0.id, name: $0.name) }
    }
}
@available(iOS 17.0, *)
enum CareChoice: String, AppEnum {
    case latest, toileting, sleep, food
    static var typeDisplayRepresentation: TypeDisplayRepresentation = "Care activity"
    static var caseDisplayRepresentations: [CareChoice: DisplayRepresentation] = [.latest: "Latest activity", .toileting: "Toileting", .sleep: "Sleep", .food: "Food"]
}
@available(iOS 17.0, *)
struct CareConfiguration: WidgetConfigurationIntent {
    static var title: LocalizedStringResource = "FamilyTrack widget"
    static var description = IntentDescription("Open each child's diary in FamilyTrack to update their widget data.")
    @Parameter(title: "Child") var child: CareChild?
    @Parameter(title: "Show child name", default: false) var showName: Bool
    @Parameter(title: "Show medication details", default: false) var showMedicine: Bool
    @Parameter(title: "Care activity", default: .latest) var activity: CareChoice
}
@available(iOS 17.0, *)
struct CareEntry: TimelineEntry {
    let date: Date
    let configuration: CareConfiguration
    let child: ChildSnapshot?
}
@available(iOS 17.0, *)
struct CareProvider: AppIntentTimelineProvider {
    func placeholder(in context: Context) -> CareEntry { CareEntry(date: .now, configuration: CareConfiguration(), child: nil) }
    func snapshot(for configuration: CareConfiguration, in context: Context) async -> CareEntry { entry(configuration) }
    func entry(_ configuration: CareConfiguration) -> CareEntry {
        CareEntry(date: .now, configuration: configuration, child: WidgetSnapshot.load().children.first { $0.id == configuration.child?.id })
    }
    func timeline(for configuration: CareConfiguration, in context: Context) async -> Timeline<CareEntry> {
        let current = entry(configuration)
        // Re-evaluate scheduled times and stale/day boundaries even without opening the app.
        let entries = (0...24).map { index in CareEntry(date: current.date.addingTimeInterval(Double(index)*900), configuration: configuration, child: current.child) }
        return Timeline(entries: entries, policy: .after(current.date.addingTimeInterval(21600)))
    }
}
@available(iOS 17.0, *)
struct CareWidgetView: View {
    let entry: CareEntry
    let kind: String
    private var stale: Bool { guard let child = entry.child else { return true }; return entry.date.timeIntervalSince1970 - child.updated > 21600 }
    private var sameDay: Bool { guard let child = entry.child else { return false }; return Calendar.current.isDate(Date(timeIntervalSince1970: child.updated), inSameDayAs: entry.date) }
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack { Image(systemName: "heart.text.square.fill").foregroundStyle(.teal); Text(entry.configuration.showName ? (entry.child?.name ?? "FamilyTrack") : "FamilyTrack").font(.caption.bold()).lineLimit(1) }
            if let child = entry.child {
                if stale { Text("Open app to refresh").font(.headline); Text("Care information is out of date").font(.caption) }
                else if kind == "all" {
                    HStack(alignment: .top, spacing: 12) { medicine(child); Divider(); VStack(alignment: .leading, spacing: 6) { fluids(child); care(child) } }
                } else if kind == "meds" { medicine(child) }
                else if kind == "fluids" { fluids(child) }
                else { care(child) }
                Spacer(minLength: 0)
                Text("Updated \(Date(timeIntervalSince1970: child.updated), style: .time)").font(.system(size: 10)).foregroundStyle(.secondary)
            } else {
                Text("Choose a child").font(.headline)
                Text("Open their diary, then edit this widget to select them.").font(.caption).foregroundStyle(.secondary)
            }
        }
        .containerBackground(.background, for: .widget)
        .privacySensitive()
        .widgetURL(URL(string: "familytrack://widget?child=\(entry.child?.id ?? "")&section=\(kind)"))
    }
    @ViewBuilder private func medicine(_ child: ChildSnapshot) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text("Next scheduled").font(.caption).foregroundStyle(.secondary)
            if let med = child.medicines.first(where: { $0.timestamp >= entry.date.timeIntervalSince1970 }) {
                Text(entry.configuration.showMedicine ? med.name : "Medication").font(.headline).lineLimit(2)
                if entry.configuration.showMedicine { Text(med.dose).font(.caption).lineLimit(1) }
                Text(Date(timeIntervalSince1970: med.timestamp), style: .time).font(.title3.bold())
                if !Calendar.current.isDate(Date(timeIntervalSince1970: med.timestamp), inSameDayAs: entry.date) { Text("Tomorrow").font(.caption) }
            } else { Text("Check medicine schedule in app").font(.caption) }
        }
    }
    @ViewBuilder private func fluids(_ child: ChildSnapshot) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text("Fluids today").font(.caption).foregroundStyle(.secondary)
            if sameDay {
                Text("\(Int(child.fluid)) ml").font(.headline)
                if child.target > 0 { ProgressView(value: min(child.fluid, child.target), total: child.target).tint(.cyan); Text("of \(Int(child.target)) ml").font(.caption) }
                else { Text("No target set").font(.caption) }
            } else { Text("Open app for today's total").font(.caption) }
        }
    }
    @ViewBuilder private func care(_ child: ChildSnapshot) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text("Latest care").font(.caption).foregroundStyle(.secondary)
            if let record = child.care[entry.configuration.activity.rawValue] {
                Text(record.label).font(.headline).lineLimit(2)
                Text(Date(timeIntervalSince1970: record.timestamp), style: .relative).font(.caption)
            } else { Text("No activity recorded").font(.caption) }
        }
    }
}
@available(iOS 17.0, *)
struct FamilyCareWidget: Widget {
    let kind: String
    let title: String
    let medium: Bool
    var body: some WidgetConfiguration {
        AppIntentConfiguration(kind: "FamilyTrack.\(kind)", intent: CareConfiguration.self, provider: CareProvider()) { entry in CareWidgetView(entry: entry, kind: kind) }
            .configurationDisplayName(title)
            .description("A snapshot from your latest FamilyTrack visit. Open the app to refresh.")
            .supportedFamilies(medium ? [.systemMedium] : [.systemSmall])
    }
}
@main
@available(iOS 17.0, *)
struct FamilyTrackWidgetBundle: WidgetBundle {
    var body: some Widget {
        FamilyCareWidget(kind: "meds", title: "Medication", medium: false)
        FamilyCareWidget(kind: "fluids", title: "Fluids", medium: false)
        FamilyCareWidget(kind: "care", title: "Care", medium: false)
        FamilyCareWidget(kind: "all", title: "Today's care", medium: true)
    }
}

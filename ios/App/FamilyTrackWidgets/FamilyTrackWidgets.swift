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
    static var typeDisplayRepresentation: TypeDisplayRepresentation = "Care profile"
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
enum BarColour: String, AppEnum {
    case automatic, blue, purple, teal, green, pink, orange, slate
    static var typeDisplayRepresentation: TypeDisplayRepresentation = "Bar colour"
    static var caseDisplayRepresentations: [BarColour: DisplayRepresentation] = [
        .automatic: "Automatic", .blue: "Blue", .purple: "Purple",
        .teal: "Teal", .green: "Green", .pink: "Pink", .orange: "Orange", .slate: "Slate"
    ]
    var colour: Color? {
        // Dark enough to keep the white profile name readable.
        switch self {
        case .automatic: return nil
        case .blue: return Color(red: 0.15, green: 0.32, blue: 0.68)
        case .purple: return Color(red: 0.43, green: 0.24, blue: 0.65)
        case .teal: return Color(red: 0.05, green: 0.40, blue: 0.43)
        case .green: return Color(red: 0.18, green: 0.42, blue: 0.27)
        case .pink: return Color(red: 0.65, green: 0.20, blue: 0.40)
        case .orange: return Color(red: 0.65, green: 0.30, blue: 0.08)
        case .slate: return Color(red: 0.28, green: 0.34, blue: 0.43)
        }
    }
}
@available(iOS 17.0, *)
struct CareConfiguration: WidgetConfigurationIntent {
    static var title: LocalizedStringResource = "FamilyTrack widget"
    static var description = IntentDescription("Open each person's diary in FamilyTrack to update their widget data.")
    @Parameter(title: "Care profile") var child: CareChild?
    @Parameter(title: "Show name", default: false) var showName: Bool
    @Parameter(title: "Bar colour", default: .automatic) var barColour: BarColour
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
        // Request a cache refresh in ten minutes; WidgetKit may defer it.
        // Future entries still work if the request is delayed. No network fetch occurs.
        var dates = Set((0...36).map { current.date.addingTimeInterval(Double($0) * 600) })
        for medicine in current.child?.medicines ?? [] {
            let boundary = Date(timeIntervalSince1970: medicine.timestamp + 1)
            if boundary > current.date && boundary < current.date.addingTimeInterval(21600) { dates.insert(boundary) }
        }
        let entries = dates.sorted().map { CareEntry(date: $0, configuration: configuration, child: current.child) }
        return Timeline(entries: entries, policy: .after(current.date.addingTimeInterval(600)))
    }
}
@available(iOS 17.0, *)
struct CareWidgetView: View {
    let entry: CareEntry
    let kind: String
    private var stale: Bool { guard let child = entry.child else { return true }; return entry.date.timeIntervalSince1970 - child.updated > 21600 }
    private var sameDay: Bool { guard let child = entry.child else { return false }; return Calendar.current.isDate(Date(timeIntervalSince1970: child.updated), inSameDayAs: entry.date) }
    private var accent: Color {
        if let selected = entry.configuration.barColour.colour { return selected }
        switch kind {
        case "meds": return .indigo
        case "fluids": return .cyan
        case "care": return .teal
        default: return .indigo
        }
    }
    private var compact: Bool { kind == "all" }
    var body: some View {
        HStack(spacing: 0) {
            GeometryReader { geometry in
                Text(entry.configuration.showName ? (entry.child?.name ?? "FamilyTrack") : "FamilyTrack")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(.white)
                    .lineLimit(1)
                    .truncationMode(.tail)
                    .frame(width: max(0, geometry.size.height - 24), height: 28)
                    .rotationEffect(.degrees(-90))
                    .position(x: geometry.size.width / 2, y: geometry.size.height / 2)
            }
            .frame(width: 28)
            .background(accent.gradient)
            VStack(alignment: .leading, spacing: 8) {
                if let child = entry.child {
                    if stale {
                        Text("Open app to refresh").font(.headline)
                        Text(child.updated == 0 ? "Open this profile’s diary to sync" : "Care information is out of date").font(.caption).foregroundStyle(.secondary)
                    } else if compact {
                        HStack(alignment: .top, spacing: 10) {
                            medicine(child).frame(maxWidth: .infinity, alignment: .topLeading)
                            Divider()
                            fluids(child).frame(maxWidth: .infinity, alignment: .topLeading)
                            Divider()
                            care(child).frame(maxWidth: .infinity, alignment: .topLeading)
                        }
                        .frame(maxHeight: .infinity, alignment: .top)
                    } else if kind == "meds" { medicine(child) }
                    else if kind == "fluids" { fluids(child) }
                    else { care(child) }
                    Spacer(minLength: 0)
                    if child.updated > 0 {
                        Text("Updated \(Date(timeIntervalSince1970: child.updated), style: .time)")
                            .font(.system(size: 10)).foregroundStyle(.secondary).lineLimit(1)
                    }
                } else {
                    Text("Choose a care profile").font(.subheadline.bold())
                    Text("Open their diary, then edit this widget to select them.")
                        .font(.caption).foregroundStyle(.secondary)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .padding(.horizontal, 12)
            .padding(.vertical, 12)
        }
        .containerBackground(.background, for: .widget)
        .privacySensitive()
        .widgetURL(URL(string: "familytrack://widget?child=\(entry.child?.id ?? "")&section=\(kind)"))
    }
    @ViewBuilder private func medicine(_ child: ChildSnapshot) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            Label("Medication", systemImage: "pills.fill").font(.system(size: 11, weight: .medium)).foregroundStyle(.secondary).lineLimit(1)
            if let med = child.medicines.first {
                Text(entry.configuration.showMedicine ? med.name : "Medication").font(compact ? .subheadline.weight(.semibold) : .headline).lineLimit(2)
                if entry.configuration.showMedicine { Text(med.dose).font(.caption).lineLimit(1) }
                Text(Date(timeIntervalSince1970: med.timestamp), style: .time).font(.title3.bold())
                if med.timestamp < entry.date.timeIntervalSince1970 {
                    Text("Overdue").font(.caption.weight(.semibold)).foregroundStyle(.orange)
                }
                if !Calendar.current.isDate(Date(timeIntervalSince1970: med.timestamp), inSameDayAs: entry.date) { Text(Date(timeIntervalSince1970: med.timestamp), style: .date).font(.caption) }
            } else { Text("Check medicine schedule in app").font(.caption) }
        }
    }
    @ViewBuilder private func fluids(_ child: ChildSnapshot) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            Label("Fluids", systemImage: "drop.fill").font(.system(size: 11, weight: .medium)).foregroundStyle(.secondary).lineLimit(1)
            if sameDay {
                Text("\(Int(child.fluid)) ml").font(.headline)
                if child.target > 0 { ProgressView(value: min(child.fluid, child.target), total: child.target).tint(.cyan); Text("of \(Int(child.target)) ml").font(.caption) }
                else { Text("No target set").font(.caption) }
            } else { Text("Open app for today's total").font(.caption) }
        }
    }
    @ViewBuilder private func care(_ child: ChildSnapshot) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            Label("Care", systemImage: "heart.fill").font(.system(size: 11, weight: .medium)).foregroundStyle(.secondary).lineLimit(1)
            if let record = child.care[entry.configuration.activity.rawValue] {
                Text(record.label).font(compact ? .subheadline.weight(.semibold) : .headline).lineLimit(2)
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
    init() { self.init(kind: "all", title: "Today's care", medium: true) }
    init(kind: String, title: String, medium: Bool) { self.kind = kind; self.title = title; self.medium = medium }
    var body: some WidgetConfiguration {
        AppIntentConfiguration(kind: "FamilyTrack.\(kind)", intent: CareConfiguration.self, provider: CareProvider()) { entry in CareWidgetView(entry: entry, kind: kind) }
            .configurationDisplayName(title)
            .description("A snapshot from your latest FamilyTrack visit. Open the app to refresh.")
            .supportedFamilies(medium ? [.systemMedium] : [.systemSmall])
            .contentMarginsDisabled()
    }
}
@available(iOS 17.0, *)
enum LockScreenContent: String, AppEnum {
    case latest, upcoming
    static var typeDisplayRepresentation: TypeDisplayRepresentation = "Display"
    static var caseDisplayRepresentations: [LockScreenContent: DisplayRepresentation] = [
        .latest: "Latest activity", .upcoming: "Next scheduled medication"
    ]
}
@available(iOS 17.0, *)
struct LockScreenConfiguration: WidgetConfigurationIntent {
    static var title: LocalizedStringResource = "FamilyTrack Lock Screen"
    static var description = IntentDescription("Choose the latest logged activity or next scheduled medication. Open the diary to refresh.")
    @Parameter(title: "Care profile") var child: CareChild?
    @Parameter(title: "Display", default: .latest) var content: LockScreenContent
    @Parameter(title: "Show name", default: false) var showName: Bool
    @Parameter(title: "Show medication name", default: false) var showMedicine: Bool
}
@available(iOS 17.0, *)
struct LockScreenEntry: TimelineEntry {
    let date: Date
    let configuration: LockScreenConfiguration
    let child: ChildSnapshot?
}
@available(iOS 17.0, *)
struct LockScreenProvider: AppIntentTimelineProvider {
    func placeholder(in context: Context) -> LockScreenEntry {
        LockScreenEntry(date: .now, configuration: LockScreenConfiguration(), child: nil)
    }
    func snapshot(for configuration: LockScreenConfiguration, in context: Context) async -> LockScreenEntry {
        LockScreenEntry(date: .now, configuration: configuration, child: WidgetSnapshot.load().children.first { $0.id == configuration.child?.id })
    }
    func timeline(for configuration: LockScreenConfiguration, in context: Context) async -> Timeline<LockScreenEntry> {
        let current = await snapshot(for: configuration, in: context)
        // Keep outstanding doses visible and transition to overdue at the due time.
        let end = current.date.addingTimeInterval(21600)
        var dates = Set((0...36).map { current.date.addingTimeInterval(Double($0) * 600) })
        for medicine in current.child?.medicines ?? [] {
            let boundary = Date(timeIntervalSince1970: medicine.timestamp + 1)
            if boundary > current.date && boundary < end { dates.insert(boundary) }
        }
        return Timeline(entries: dates.sorted().map { LockScreenEntry(date: $0, configuration: configuration, child: current.child) }, policy: .after(current.date.addingTimeInterval(600)))
    }
}
@available(iOS 17.0, *)
struct LockScreenCareView: View {
    let entry: LockScreenEntry
    private var upcoming: Bool { entry.configuration.content == .upcoming }
    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Label(entry.configuration.showName ? (entry.child?.name ?? "FamilyTrack") : "FamilyTrack", systemImage: upcoming ? "pills.fill" : "heart.text.square")
                .font(.caption.weight(.semibold)).lineLimit(1)
            if let child = entry.child {
                if child.updated == 0 || entry.date.timeIntervalSince1970 - child.updated > 21600 {
                    Text("Open diary to refresh").font(.headline).lineLimit(1)
                    Text("Saved information is not current").font(.caption2).lineLimit(1)
                } else if upcoming {
                    if let medicine = child.medicines.first {
                        Text(entry.configuration.showMedicine ? medicine.name : "Next scheduled medication")
                            .font(.headline).lineLimit(1)
                        HStack(spacing: 4) {
                            if medicine.timestamp < entry.date.timeIntervalSince1970 { Text("Overdue").bold() }
                            if !Calendar.current.isDate(Date(timeIntervalSince1970: medicine.timestamp), inSameDayAs: entry.date) {
                                Text(Date(timeIntervalSince1970: medicine.timestamp), style: .date)
                            }
                            Text(Date(timeIntervalSince1970: medicine.timestamp), style: .time)
                        }.font(.caption)
                    } else {
                        Text("No outstanding medication").font(.headline).lineLimit(1)
                        Text("Open app for the schedule").font(.caption2).lineLimit(1)
                    }
                } else if let record = child.care["latest"] {
                    Text(record.label).font(.headline).lineLimit(1)
                    HStack(spacing: 4) {
                        Text("Latest")
                        Text(Date(timeIntervalSince1970: record.timestamp), style: .relative)
                    }.font(.caption)
                } else {
                    Text("No activity recorded").font(.headline).lineLimit(1)
                    Text("Open app to log care").font(.caption2).lineLimit(1)
                }
            } else {
                Text("Choose a care profile").font(.headline).lineLimit(1)
                Text("Edit this widget to select one").font(.caption2).lineLimit(1)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .containerBackground(.background, for: .widget)
        .privacySensitive()
        .widgetURL(URL(string: "familytrack://widget?child=\(entry.child?.id ?? "")&section=home"))
    }
}
@available(iOS 17.0, *)
struct FamilyTrackLockScreenWidget: Widget {
    var body: some WidgetConfiguration {
        AppIntentConfiguration(kind: "FamilyTrack.lockScreen", intent: LockScreenConfiguration.self, provider: LockScreenProvider()) { entry in
            LockScreenCareView(entry: entry)
        }
        .configurationDisplayName("Latest or next")
        .description("Latest logged care or next scheduled medication for one profile. Open the diary to refresh.")
        .supportedFamilies([.accessoryRectangular])
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
        FamilyTrackLockScreenWidget()
    }
}

import Foundation
import WidgetKit
import SwiftUI
import UIKit
import AppIntents

struct CareRecord: Codable {
    var label: String
    var timestamp: Double
}
struct SmartInsight: Codable {
    var kind: String
    var title: String
    var detail: String
    var checkedAt: Double?
}
struct MedicineRecord: Codable {
    var name: String
    var dose: String
    var timestamp: Double
    var window: String?
    var windowEnd: Double?
    func windowLabel(at date: Date) -> String? {
        guard let window = window else { return nil }
        if let end = windowEnd, date.timeIntervalSince1970 >= end {
            return "\(window.capitalized) dose not recorded"
        }
        return Calendar.current.isDate(Date(timeIntervalSince1970: timestamp), inSameDayAs: date)
            ? "Due this \(window)" : "Due \(window)"
    }
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
    var usualBedtime: String?
    var sleepLogId: String?
    var sleepCompletedAt: Double?
    var canStartSleep: Bool?
    var canEndSleep: Bool?
    var sleepingSince: Double?
    var schoolSince: Double?
    var schoolPickup: String?
    var photo: String?
    var smartInsights: [SmartInsight]?
}
struct WidgetSnapshot: Codable {
    var children: [ChildSnapshot]
    static func load() -> WidgetSnapshot {
        guard let data = WidgetBackground.snapshotData(), let snapshot = try? JSONDecoder().decode(Self.self, from: data) else { return Self(children: []) }
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
    @Parameter(title: "Show profile photo", default: true) var showPhoto: Bool
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
        await WidgetFetcher.shared.refresh()
        let current = entry(configuration)
        // Re-evaluate saved data at the original fifteen-minute timeline intervals.
        var dates = Set((0...24).map { current.date.addingTimeInterval(Double($0)*900) })
        if let time = current.child?.usualBedtime {
            let parts = time.split(separator: ":").compactMap { Int($0) }
            if parts.count == 2, let bedtime = Calendar.current.date(bySettingHour: parts[0], minute: parts[1], second: 0, of: current.date), bedtime > current.date {
                dates.insert(bedtime)
            }
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
                    if (kind == "care" || compact), let message = WidgetSleepAction.message(for: child.id) {
                        Text(message).font(.system(size: 10)).foregroundStyle(.secondary).lineLimit(2)
                    } else if child.updated > 0 {
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
            HStack(spacing: 3) {
                Label("Medication", systemImage: "pills.fill").font(.system(size: 11, weight: .medium)).foregroundStyle(.secondary).lineLimit(1)
                insightIndicator(child, kind: "medication")
            }
            if let med = child.medicines.first(where: { Calendar.current.isDate(Date(timeIntervalSince1970: $0.timestamp), inSameDayAs: entry.date) }) {
                Text(entry.configuration.showMedicine ? med.name : "Medication").font(compact ? .subheadline.weight(.semibold) : .headline).lineLimit(2)
                if entry.configuration.showMedicine { Text(med.dose).font(.caption).lineLimit(1) }
                if let label = med.windowLabel(at: entry.date) {
                    Text(label).font(.caption.weight(.semibold)).foregroundStyle((med.windowEnd ?? .infinity) <= entry.date.timeIntervalSince1970 ? Color.orange : Color.primary)
                } else {
                    Text(Date(timeIntervalSince1970: med.timestamp), style: .time).font(.title3.bold())
                }
                if med.window == nil && med.timestamp < entry.date.timeIntervalSince1970 {
                    Text("Overdue").font(.caption.weight(.semibold)).foregroundStyle(.orange)
                }
                if !Calendar.current.isDate(Date(timeIntervalSince1970: med.timestamp), inSameDayAs: entry.date) { Text(Date(timeIntervalSince1970: med.timestamp), style: .date).font(.caption) }
            } else if sameDay { Text("Nothing else due today").font(.caption) }
            else { Text("Open app for today's schedule").font(.caption) }
        }
    }
    @ViewBuilder private func fluids(_ child: ChildSnapshot) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack(spacing: 3) {
                Label("Fluids", systemImage: "drop.fill").font(.system(size: 11, weight: .medium)).foregroundStyle(.secondary).lineLimit(1)
                insightIndicator(child, kind: "fluids")
            }
            if sameDay {
                Text("\(Int(child.fluid)) ml").font(.headline)
                if child.target > 0 { ProgressView(value: min(child.fluid, child.target), total: child.target).tint(.cyan); Text("of \(Int(child.target)) ml").font(.caption) }
                else { Text("No target set").font(.caption) }
            } else { Text("Open app for today's total").font(.caption) }
        }
    }
    @ViewBuilder private func care(_ child: ChildSnapshot) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            if let started = child.sleepingSince {
                if entry.configuration.showPhoto, let encoded = child.photo,
                   let data = Data(base64Encoded: encoded), let photo = UIImage(data: data) {
                    Image(uiImage: photo).resizable().scaledToFill()
                        .frame(width: compact ? 24 : 28, height: compact ? 24 : 28).clipShape(Circle())
                        .overlay(alignment: .bottomTrailing) {
                            Image(systemName: "moon.fill").font(.caption).foregroundStyle(.indigo)
                                .padding(3).background(.background, in: Circle())
                        }
                } else {
                    Image(systemName: "moon.zzz.fill").font(.title2).foregroundStyle(.indigo)
                }
                HStack(spacing: 3) {
                    Text(entry.date.timeIntervalSince1970 - started > 46800 ? "Sleep still running?" : "Sleeping")
                        .font(.subheadline.weight(.semibold))
                    insightIndicator(child, kind: "sleep")
                }
                Text("Since \(Date(timeIntervalSince1970: started), style: .time)").font(.caption)
                if child.canEndSleep == true && entry.date.timeIntervalSince1970 - started <= 46800 {
                    sleepButton(child, action: "end", title: "Wake up", symbol: "sun.max.fill")
                }
            } else if let started = child.schoolSince {
                Image(systemName: "building.2.fill").font(.title2).foregroundStyle(.indigo)
                Text(entry.date.timeIntervalSince1970 - started > 64800 ? "School still active?" : "At School / Away")
                    .font(.subheadline.weight(.semibold)).lineLimit(2)
                if Calendar.current.isDate(Date(timeIntervalSince1970: started), inSameDayAs: entry.date), sameDay, let pickup = child.schoolPickup, !pickup.isEmpty {
                    Text("Pickup \(pickup)").font(.caption.weight(.semibold))
                } else { Text("Since \(Date(timeIntervalSince1970: started), style: .time)").font(.caption) }
            } else if canOfferSleep(child) {
                VStack(alignment: .center, spacing: 8) {
                    Image(systemName: "moon.stars.fill")
                        .font(compact ? .title2 : .largeTitle).foregroundStyle(.indigo)
                    Text("Ready for sleep?").font(.caption.weight(.semibold)).lineLimit(2)
                    sleepButton(child, action: "start", title: "Start", symbol: "moon.fill")
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
            Label("Care", systemImage: "heart.fill").font(.system(size: 11, weight: .medium)).foregroundStyle(.secondary).lineLimit(1)
            if let record = child.care[entry.configuration.activity.rawValue] {
                Text(record.label).font(compact ? .subheadline.weight(.semibold) : .headline).lineLimit(2)
                Text(Date(timeIntervalSince1970: record.timestamp), style: .relative).font(.caption)
            } else { Text("No activity recorded").font(.caption) }
            }
        }
    }
    private func canOfferSleep(_ child: ChildSnapshot) -> Bool {
        guard child.canStartSleep == true, let time = child.usualBedtime else { return false }
        let parts = time.split(separator: ":").compactMap { Int($0) }
        guard parts.count == 2, let bedtime = Calendar.current.date(bySettingHour: parts[0], minute: parts[1], second: 0, of: entry.date) else { return false }
        return entry.date >= bedtime && (child.sleepCompletedAt ?? 0) < bedtime.timeIntervalSince1970
    }
    @ViewBuilder private func insightIndicator(_ child: ChildSnapshot, kind: String) -> some View {
        // Expired hints disappear; the actual care widget never goes blank.
        if sameDay, let insight = child.smartInsights?.first(where: { $0.kind == kind }),
           entry.date.timeIntervalSince1970 - (insight.checkedAt ?? child.updated) < 1800 {
            Image(systemName: "info.circle.fill").font(.system(size: 10)).foregroundStyle(.orange)
                .accessibilityLabel("\(insight.title). Open FamilyTrack for details.")
        }
    }
    private func sleepButton(_ child: ChildSnapshot, action: String, title: String, symbol: String) -> some View {
        Button(intent: SleepLogIntent(profileID: child.id, action: action, expectedSleepID: child.sleepLogId ?? "")) {
            Label(title, systemImage: symbol).font(.system(size: compact ? 12 : 14, weight: .semibold)).lineLimit(1).minimumScaleFactor(0.8)
                .frame(maxWidth: .infinity, minHeight: compact ? 30 : 36)
        }.buttonStyle(.borderedProminent).tint(.indigo)
        .accessibilityLabel("\(action == "start" ? "Start sleep" : title) for \(child.name)")
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
        await WidgetFetcher.shared.refresh()
        let current = await snapshot(for: configuration, in: context)
        // Keep outstanding doses visible and transition to overdue at the due time.
        let end = current.date.addingTimeInterval(21600)
        var dates = Set((0...24).map { current.date.addingTimeInterval(Double($0) * 900) })
        for medicine in current.child?.medicines ?? [] {
            let boundary = Date(timeIntervalSince1970: (medicine.windowEnd ?? medicine.timestamp) + 1)
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
                    if let medicine = child.medicines.first(where: { Calendar.current.isDate(Date(timeIntervalSince1970: $0.timestamp), inSameDayAs: entry.date) }) {
                        Text(entry.configuration.showMedicine ? medicine.name : "Next scheduled medication")
                            .font(.headline).lineLimit(1)
                        HStack(spacing: 4) {
                            if medicine.window == nil && medicine.timestamp < entry.date.timeIntervalSince1970 { Text("Overdue").bold() }
                            if !Calendar.current.isDate(Date(timeIntervalSince1970: medicine.timestamp), inSameDayAs: entry.date) {
                                Text(Date(timeIntervalSince1970: medicine.timestamp), style: .date)
                            }
                            if let label = medicine.windowLabel(at: entry.date) { Text(label) }
                            else { Text(Date(timeIntervalSince1970: medicine.timestamp), style: .time) }
                        }.font(.caption)
                    } else if Calendar.current.isDate(Date(timeIntervalSince1970: child.updated), inSameDayAs: entry.date) {
                        Text("Nothing else due today").font(.caption.weight(.semibold)).lineLimit(2)
                    } else {
                        Text("Open app to refresh").font(.headline).lineLimit(1)
                        Text("Check today's schedule").font(.caption2).lineLimit(1)
                    }
                } else if child.sleepingSince == nil, let started = child.schoolSince {
                    Text("At School / Away").font(.headline).lineLimit(1)
                    Text("Since \(Date(timeIntervalSince1970: started), style: .time)").font(.caption)
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

@available(iOS 17.0, *)
struct SleepLogIntent: AppIntent {
    static var title: LocalizedStringResource = "Log sleep"
    static var openAppWhenRun: Bool = false
    static var authenticationPolicy: IntentAuthenticationPolicy = .requiresAuthentication
    @Parameter(title: "Care profile") var profileID: String
    @Parameter(title: "Action") var action: String
    @Parameter(title: "Expected sleep") var expectedSleepID: String
    init() {}
    init(profileID: String, action: String, expectedSleepID: String) {
        self.profileID = profileID; self.action = action; self.expectedSleepID = expectedSleepID
    }
    func perform() async throws -> some IntentResult {
        await WidgetSleepAction.save(profileID: profileID, action: action, expectedSleepID: expectedSleepID)
        WidgetCenter.shared.reloadAllTimelines()
        return .result()
    }
}

@available(iOS 17.0, *)
enum WidgetSleepAction {
    static func message(for profile: String) -> String? {
        guard let access = WidgetBackground.grant(), let saved = WidgetBackground.dictionary("widget-action-\(access.generation).json"),
              saved["profile"] as? String == profile, let time = saved["time"] as? Double,
              Date().timeIntervalSince1970 - time < 180 else { return nil }
        return saved["message"] as? String
    }
    static func save(profileID: String, action: String, expectedSleepID: String) async {
        guard let access = WidgetBackground.grant(), access.expires > Date().timeIntervalSince1970, !WidgetBackground.denied(access),
              let family = access.scope.split(separator: ":").last,
              profileID.hasPrefix("\(family):"), let child = profileID.split(separator: ":").last else { return }
        var message = "Not saved. Open app to check."
        var request = URLRequest(url: URL(string: "https://familytrack.care/api/widgets/sleep")!)
        request.httpMethod = "POST"; request.timeoutInterval = 12
        request.setValue("Bearer \(access.token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try? JSONSerialization.data(withJSONObject: ["childId": String(child), "action": action,
            "expectedSleepId": expectedSleepID, "timeZone": TimeZone.current.identifier])
        let config = URLSessionConfiguration.ephemeral
        config.httpCookieStorage = nil; config.urlCache = nil; config.timeoutIntervalForResource = 15
        let session = URLSession(configuration: config, delegate: WidgetNoRedirect(), delegateQueue: nil)
        defer { session.invalidateAndCancel() }
        do {
            let (_, response) = try await session.data(for: request)
            guard WidgetBackground.grant()?.generation == access.generation else { return }
            if let http = response as? HTTPURLResponse {
                if http.statusCode == 200 { message = action == "start" ? "Sleep started" : "Wake-up saved" }
                else if http.statusCode == 409 { message = "Sleep changed. Check app." }
                else if http.statusCode == 401 || http.statusCode == 403 { message = "Open app to check access." }
            }
        } catch { message = "Check connection; open app." }
        guard WidgetBackground.grant()?.generation == access.generation else { return }
        if let data = try? JSONSerialization.data(withJSONObject: ["profile": profileID,"time": Date().timeIntervalSince1970,"message": message]) {
            try? WidgetBackground.save(data, name: "widget-action-\(access.generation).json")
        }
        await WidgetFetcher.shared.refresh(force: true)
    }
}

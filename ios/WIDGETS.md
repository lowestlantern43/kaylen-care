# FamilyTrack widgets

Four iOS 17+ Home Screen widgets: Medication, Fluids, Care (latest/toileting/sleep/food), and medium Today’s care. Main app deployment target stays unchanged.

## Build
Run `npm run ios:sync`, then `ruby scripts/configure-widgets.rb` on macOS before opening/building the Xcode workspace. CI does this automatically. Source-controlled target generation is idempotent.

## Signing before TestFlight
- Register App Group `group.care.familytrack.app`.
- Enable it on app ID `care.familytrack.app` and new widget extension ID `care.familytrack.app.widgets`.
- Regenerate the main App Store profile (retain Push Notifications).
- Create `FamilyTrack Widgets App Store` profile for the extension.
- Replace `IOS_PROVISIONING_PROFILE`; add base64 profile secret `IOS_WIDGET_PROVISIONING_PROFILE`.
- Both targets must have matching app/build versions. TestFlight workflow sets both.

## Data and limitations
Only a bounded local snapshot is shared through a protected App Group file. No credentials or free-text care notes. Logout and anonymous session clear the shared snapshot. Opening a child's diary syncs that child; widget selection lists children whose diaries have been opened during the current session. No background network fetch. Each widget can select a child and independently hide name/medicine details (hidden by default).

Medication is the next **scheduled** time, not an assertion a dose is still outstanding. PRN excluded. Schedules lacking exact times direct the user to the app. No administration action. Care shows category/time, not private notes. Fluids are never carried into a new day. Snapshots older than six hours request a refresh. iOS controls timeline refresh timing.

## Device acceptance before release
Use demo records. Test all four sizes/options, long names, multiple children, logout/account switch, locked phone, stale cache, midnight and timezone changes, PRN/specific-day schedules, and tap routing for cold/warm launches. Check VoiceOver and large text. Widgets need a real signed TestFlight/device check after unsigned simulator compilation.

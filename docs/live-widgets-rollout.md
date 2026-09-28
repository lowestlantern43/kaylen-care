# Background widget fetching rollout

The widget extension now requests minimal summaries directly from FamilyTrack,
using a separate opaque credential. Normal login cookies are never shared with
widgets. Existing clients continue using their existing snapshots.

## Deployment switch

`WIDGET_BACKGROUND_ENABLED=true` enables issuance, revocation and snapshot routes.
Leave unset/false to disable the feature. A disabled/unreachable endpoint retains
previous snapshots. Disabling does not delete the additive grant table.

Grants are stored as hashes, rotated per installation/family and expire after
seven days. Opening the app renews access when less than a day remains. Server
reads recheck membership, suspension, archive/deletion and current privacy
consent. Logout revokes grants issued by that session. Local clearing removes
credentials and snapshots immediately; in-flight responses use a generation ID
and cannot become readable after logout or a family switch.

## Snapshot contents

The endpoint returns active profile IDs/names, structured medication schedules,
fluid totals/targets, care-category timestamps and active sleep time. It excludes
notes, diagnoses, full care records and remote photo URLs. Existing local tiny
thumbnails are retained only for a matching profile. Profile limits and response
size limits fail closed rather than publish incomplete daily totals.

Date calculations use the requesting device timezone, independently of the
server timezone. Ambiguous dose matching leaves medication outstanding.
Nonexistent DST schedule times return an unavailable response and retain cache.

## iOS behaviour and rollback

Both providers fetch before creating a timeline. They request another fetch after
30 minutes, with the previous six-hour timeline retained as offline fallback.
WidgetKit controls actual execution: this is periodic background fetching, not a
live feed or guaranteed interval. Failed requests do not change saved timestamps.
401/403 responses block that generation's data until the app reconnects.
Files use protection until first unlock and are excluded from device backup.

Roll back by disabling the server flag, or reverting the native change and
shipping another TestFlight build. No Stripe, billing, reminders or existing API
response was changed. Logout adds best-effort grant revocation only when enabled.

## Verification

Local tests cover token isolation/hash storage, live access guards, session
revocation, default-disabled routes, family scoping, minimal fields, medication
completion, sleep/wake/cancellation, fluid totals, timezone/midnight/DST and
existing app login flows. Full backend suite: 44 passed, one optional PostgreSQL
integration test skipped (no test database configured).

Before App Store release, test on a real iPhone: two profiles, locked/offline,
app not open, another carer logging a dose, logout, expiry and midnight. Xcode
compilation and TestFlight upload are checked separately in the build workflow.

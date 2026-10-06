# School / Nursery attendance

Off by default per care profile (`attendanceEnabled`). Migration 036 is additive; runtime profile schema setup also installs the column. Legacy saves preserve the flag when omitted.

Attendance uses structured `general` care logs with `data.attendance=true`; existing category contracts, billing, authentication and widgets stay unchanged. Older clients do not display these new entries. New web/iOS clients show an optional tile, history, timeline category and report tables.

One recorded status per profile/date. Holiday/closure/absence ranges (maximum 93 calendar days) commit atomically. Advisory locks serialize attendance writes; identical retries are no-ops and conflicting days require explicit editing. Correction actions retain existing role, optimistic concurrency, soft deletion and audit rules. No automatic attendance inference or absence percentages. Part-day medical visits are distinct from whole-day absence.

Rollback: revert client commits and the attendance route additions; retain stored rows and the additive column. Do not delete real attendance records.

## Live school state

Left for School and Back Home use a transactional authenticated action with the existing role/plan gates, a per-profile attendance lock and an expected record/version. One school period is retained per day; the end updates that record, rather than creating an extra attendance day. No state is inferred from schedules or manual attendance records.

`schoolSince` is optional in the existing widget snapshot. Both the app projector and server projector derive it from explicitly active, undeleted attendance records. The existing app-group file, background fetcher, latest-snapshot merge and WidgetCenter reload path are reused. Care widgets and the medium Care section show school; the latest-activity lock-screen widget also shows it. Medication/fluids are unchanged. If Sleep and School are both active, existing Sleep presentation retains priority; ending school does not wake the person.

The app refreshes enabled attendance profiles while visible every minute and on foreground. Widgets fetch changes from other devices through their existing background provider. iOS controls redraw/background scheduling, so instant cross-device updates cannot be guaranteed. A local save requests the existing timeline reload; no arbitrary cache-expiry blanking was added.

Validation: server start/end/persistence/projection, no implicit holiday/weekend state, absence/collection clears live state, deleted rows excluded, stale submissions and foreign/archive access, plus existing sleep/medication/hydration regression tests. Physical close/reopen/background widget behavior needs an iPhone TestFlight acceptance test; native CI compilation is not a substitute for that.

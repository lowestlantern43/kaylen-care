# Optional Smart Insights

Off by default, enabled by a parent/owner in Care profile → General. The additive
`smart_insights_enabled` flag is preserved when omitted by older clients.
No new care data or analytics events are stored. No additional notifications.

The home screen and widget use `projectWidget` and its shared server calculation.
The normal authorized profile API exposes only the selected profile's indicators;
it retains family membership, privacy consent and archived-profile checks.
Widgets receive optional fields, so older builds continue decoding normally.

- Fluids: at least five distinct recorded days among the previous fourteen,
  compared at the same local clock time, after 10:00. Median of positive logged
  amounts; no invented zeros for days without records. Indicator below 60% of a
  median of at least 100 ml. These are display heuristics, not clinical thresholds
  or prescribed intake targets. Unknown times/units and partially loaded oldest
  days are excluded. Today's amount uses the existing canonical widget total.
- Medication: an existing unresolved scheduled dose after its time/window.
  Given and skipped doses are resolved by the existing dose matcher. Wording does
  not infer non-administration or recommend taking another dose.
- Sleep: a currently open log beyond 13 hours, or two hours above the median of
  at least five recent completed logs if that threshold is longer. Completed
  duration comparisons use recorded wall-clock times, so DST nights can differ
  by an hour. Wording asks to check the log, not judge sleep quality.

Home indicators open a small explanation dialog. Widgets show an information
symbol beside the relevant section; opening the app gives the explanation.
The app refreshes indicators on diary refresh, foregrounding, and every five
minutes while visible. Widget delivery follows the existing iOS refresh policy;
it is not real time. Hints older than thirty minutes disappear without removing
the care snapshot. A profile preference change reaches widgets on their next
successful refresh.

Rollback: revert the UI and optional widget rendering. Leaving the new database
column and optional response fields is compatible with previous clients. No
changes to medication matching, recorded volumes, sleep actions or subscriptions.

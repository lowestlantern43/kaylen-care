# School / Nursery attendance

Off by default per care profile (`attendanceEnabled`). Migration 036 is additive; runtime profile schema setup also installs the column. Legacy saves preserve the flag when omitted.

Attendance uses structured `general` care logs with `data.attendance=true`; existing category contracts, billing, authentication and widgets stay unchanged. Older clients do not display these new entries. New web/iOS clients show an optional tile, history, timeline category and report tables.

One recorded status per profile/date. Holiday/closure/absence ranges (maximum 93 calendar days) commit atomically. Advisory locks serialize attendance writes; identical retries are no-ops and conflicting days require explicit editing. Correction actions retain existing role, optimistic concurrency, soft deletion and audit rules. No automatic attendance inference or absence percentages. Part-day medical visits are distinct from whole-day absence.

Rollback: revert client commits and the attendance route additions; retain stored rows and the additive column. Do not delete real attendance records.

# Guided activation

Additive rollout for accounts created after `activation_rollout.started_at`. One
journey per user, attached to the first family used. Existing care, billing,
authentication and notification settings retain their contracts.

## Customer experience

- A single invitation to log real care replaces the SaaS seven-item checklist.
- First entry acknowledgement; day-two summary of the first day; day-three and
  day-seven summaries include the current day and say “so far”. Counts are
  recorded entries, not proof of medication administration or target attainment.
- Family summaries query undeleted entries belonging to active care profiles in
  the authorized family. Feeding/flush entries are counted separately.
- Reminders appear after three entries; reports from day three; sharing from day
  seven. All existing features remain accessible through normal navigation.
- Guidance can be hidden/restored and stops its main card after fourteen days.
- At most one optional generic push, 09:00–11:59 in the journey timezone on the
  next calendar day. Requires existing push opt-in, active device, active user,
  family and membership, plus care consent checked by the push service. No email.
- Atomic claim precedes delivery. Ambiguous/failed attempts are not retried, so
  duplicate workers cannot send a second notification. Provider acceptance does
  not prove device display. Results live in `activation_progress.reminder_status`.

## Measurement and privacy

Operational guidance state is account-linked, **not anonymous**. It contains no
care text, names, IPs or user agents and is deleted with the user/family. Analytics
are optional, initially off, and presented to platform admins only as aggregate
counts. Opt-out clears return/report/share flags. General registration/profile
totals are calculated from existing records without adding visitor tracking.

Return days are local calendar days after the first entry was created, not its
possibly backdated care date. The timezone is fixed when the journey begins.
Return-rate denominators include participants who opted in by the first-entry
day and have reached the applicable return day; late opt-ins are excluded.
Foreground visits record returns; summary refreshes/background work do not.
Report/share milestones follow successful export/email actions. Positive payment
audit events after enrollment indicate paid conversion; trial starts alone do not.

Figures are rollout-to-date, not affected by the public-traffic reporting filter.
Current undeleted entries determine entry milestones; deleting a mistaken entry
can therefore reduce these counts. No historical return activity is fabricated.

## Rollout / rollback

Runtime schema initialization uses the same additive SQL as migration 034.
It is isolated from logging and authentication. Deploy backend before web/iOS.
`ACTIVATION_ENABLED=false` disables customer guidance APIs and reminder scanning;
existing data and admin aggregates remain available. Reverting the frontend
restores its previous checklist. Do not drop tables during a routine rollback.

Validation: backend test suite with `node --experimental-test-module-mocks --test
test/*.test.js`, both Vite builds, synthetic phone-width browser preview, and an
isolated PGlite PostgreSQL-engine check of schema, eligibility, summaries, return
denominators, consent withdrawal and scheduler SQL. No production care records
were created or edited during verification.

Reproduce the isolated SQL check from repository root:
```powershell
npm install --prefix tmp/activation-db-test --no-save --package-lock=false @electric-sql/pglite
node --experimental-test-module-mocks backend/test/manual/activation-postgres.mjs
```
The engine runs in memory, with invented UUIDs only; it does not connect to the live database.

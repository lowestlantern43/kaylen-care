# Migration Plan From Current Kaylen's Diary to FamilyTrack

## Current App Summary

The current app is a single-family React/Vite diary. Most product logic lives in `src/KaylenCareMonitorDashboard.jsx`.

Current storage is Supabase tables:

- `milk_logs`
- `food_logs`
- `medication_logs`
- `toileting_logs`
- `sleep_logs`
- `health_logs`

The React app directly reads/writes these tables through `src/Supabase.js`. The SaaS version must replace that with backend API calls.

## Migration Strategy

Create a clean SaaS schema, then write a one-off migration script that reads old Supabase data and inserts into the new PostgreSQL `care_logs` table for a chosen family and child.

Recommended first imported workspace:

- Family: `Bellamy Family`
- Child: `Kaylen`
- Initial owner: Martin

## Old-to-New Table Mapping

`milk_logs` becomes a `care_logs` row:

- `category`: `food`
- `data.type`: `milk`
- `data.amount`: old `amount`
- `data.unit`: `oz`
- `data.location`: parsed from notes
- `data.item`: parsed from notes, default `Milk`
- `notes`: parsed `Notes`

`food_logs` becomes:

- `category`: `food`
- `data.type`: `food`
- `data.item`: old `item`
- `data.amount`: old `amount`
- `data.location`: parsed from notes
- `notes`: parsed `Notes`

`medication_logs` becomes:

- `category`: `medication`
- `data.medicine`: old `medicine`
- `data.dose`: old `dose`
- `data.given_by`: parsed from notes
- `notes`: parsed `Notes`

`toileting_logs` becomes:

- `category`: `toileting`
- `data.entry`: old `entry`
- `notes`: parsed `Notes`

`sleep_logs` becomes:

- `category`: `sleep`
- `log_time`: old `bedtime`
- `data.bedtime`: old `bedtime`
- `data.wake_time`: old `wake_time`
- `data.wake_date`: parsed `Wake Date`
- `data.quality`: old `quality`
- `data.night_wakings`: old `night_wakings`
- `data.nap`: old `nap`
- `notes`: parsed `Notes`

`health_logs` becomes:

- `category`: `health`
- `data.event`: old `event`
- `data.duration`: old `duration`
- `data.happened`: old `happened`
- `data.action`: old `action`
- `data.weight_kg`: old `weight_kg`
- `data.height_cm`: old `height_cm`
- `data.bmi`: calculated where weight and height exist
- `notes`: parsed `Notes`

## Date and Time Handling

The old app stores user-facing date/time in a combined `notes` string such as:

```text
Date: 27/04/2026 | Time: 08:30 | Notes: Example
```

The migration script should parse these values into:

- `care_logs.log_date` as a real `date`
- `care_logs.log_time` as a real `time`
- `care_logs.created_at` using the old `time` timestamp where useful

If parsing fails, use the old row timestamp date as a fallback and store the original row details in `data.legacy`.

## Sleep Preservation

The incomplete sleep concept must be preserved:

- A sleep log with `data.bedtime` and no `data.wake_time` is incomplete.
- The API endpoint for latest incomplete sleep should query `care_logs` by family, child, category `sleep`, and missing wake time.
- Reports should calculate duration from bedtime to wake time, crossing midnight when needed.

## Migration Steps

1. Deploy the new PostgreSQL schema locally.
2. Create the first owner user through the backend sign-up flow.
3. Create `Bellamy Family`.
4. Add Kaylen as the first child.
5. Export current Supabase rows or read them with a temporary service script.
6. Transform each old row into a `care_logs` row.
7. Insert into PostgreSQL with `source_table` and `source_id` filled.
8. Compare counts by category.
9. Open the SaaS frontend against API data.
10. Compare existing reports and PDF output against the current app for the same date ranges.

## What Not To Migrate Blindly

- The hardcoded PIN.
- Supabase anon/service keys.
- Single-family assumptions.
- Any plain-text secrets from `.env`.

## Rollback Plan

Keep the current app untouched until the SaaS version has:

- working auth,
- family/child selection,
- migrated logs visible,
- sleep completion working,
- report filtering working,
- PDF export working.

The old app remains the reference until these checks pass.

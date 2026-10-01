# Widget sleep actions

Optional usualBedtime (HH:mm) is stored on child_profiles; profile PUTs from older clients that omit it preserve it. Empty clears it. Web and iOS edit it under Care profile > Support and during setup.

New iOS clients request sleepActions when rotating their dedicated widget grant. Existing grants remain read-only. POST /api/widgets/sleep accepts only start/end, childId, expectedSleepId and timeZone. Family and user are derived from the grant. Live membership, consent, suspension, grant expiry and plan checks apply. Start requires carer or higher; wake requires parent or owner, matching existing log-edit permissions.

Actions use server time, lock the selected profile and latest sleep in a transaction, and compare the expected sleep ID. Duplicate/stale starts fail without creating logs; repeated wake on the same completed log is a no-op. Wake preserves existing data and notes. Sleeps older than 13 hours require correction in the app. No records are created just because bedtime passes. Errors do not show a false saved confirmation.

The Care and medium widgets offer start after bedtime until midnight, and wake during active sleep. A completed sleep after tonight's bedtime suppresses another start button until the next bedtime. iOS controls actual timeline refresh timing. Network access is required. Native actions require device authentication. Read-only accounts do not receive action buttons.

Rollout: backend and web first, new TestFlight build second. Build 39 already in review is unchanged. Additive migration 031; lazy schema setup also supports the existing deployment model. Rollback: revert frontend/native commits, remove the new sleep route or revoke sleep_actions grants. Retain the nullable column; do not delete care records.

Validation: backend widget sleep/access/snapshot tests, full backend suite, web and iOS Vite builds, iOS companion/widget regression scripts, then macOS Xcode CI. Device acceptance: set a demo bedtime, use separate profile widgets, start twice, wake next day, verify the diary, test offline and stale widgets. Never test writes against real care profiles without the user's intent.

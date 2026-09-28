# Background widget fetching: staged rollout

The current native widgets read an App Group snapshot. Timeline reload requests
do not fetch server data. This work must not be advertised as real-time delivery.

## Implemented foundation

`/widgets` routes are disabled unless `WIDGET_BACKGROUND_ENABLED=true`.
No production flag has been enabled. No existing authentication, billing,
reminder or customer API response is changed.

Authenticated and consented family members can issue a seven-day opaque grant
for an installation. Only its SHA-256 hash is stored in an additive table.
Reissuing rotates that installation's family grant. Reading access checks current
membership, deletion, suspension, expiry, revocation and care-data consent.
The bearer cannot authenticate normal account APIs. Revocation is idempotent.

## Required before enabling

1. Implement a bounded, minimal snapshot projection for medication, fluid totals,
   latest care and sleep. Exclude free-text notes, diagnoses and whole care logs.
   Honour device timezone, daylight-saving transitions, archived profiles,
   day boundaries and the current medication matching rules. Match current
   read-access semantics: an expired trial is currently view-only, not inaccessible.
2. Store the grant in shared protected native storage, separate from account
   credentials. Capture an account generation; discard network responses after
   logout, family switches or grant rotation. Restrict fetch destinations, redirects,
   response size and timeout. Never log the grant or response body.
3. Revoke and erase the grant on logout. Server-side session logout needs a
   tested connection to issued grants before rollout. Offline logout must erase
   local credentials immediately, and server expiry bounds remote lifetime.
4. Fetch in both timeline providers. On connectivity/server failure keep the last
   valid cache with its actual update timestamp. On access denial erase that
   family's cache. Never mark cached data freshly updated after a failed request.
5. Preserve cached thumbnails only for the same authorised profile; remove them
   on archive, account changes and logout. Family access must be rechecked before
   returning any profile data. Test simultaneous widgets on different profiles.
6. Test server endpoint security and snapshot parity, compile with Xcode and test
   on a real iPhone: locked, offline, app terminated, other-carer changes, logout,
   removed membership, consent withdrawal, midnight and daylight saving.
7. Deploy backend while disabled, ship native support behind opt-in, enable only
   after acceptance. Rollback is disabling the flag; old apps keep local widgets.

WidgetKit chooses actual execution times. Keep the previous timing during initial
testing rather than reintroducing the ten-minute change that produced blank widgets.
Push-triggered refresh is a later enhancement, not part of this first stage.

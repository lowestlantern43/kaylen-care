# iPhone notification setup and verification

The iOS companion uses Capacitor Push Notifications and direct Apple Push Notification service (APNs) delivery. The existing server reminder scanner sends to both web subscriptions and native iPhone tokens. Web VAPID credentials are independent of Apple credentials. No Firebase account is needed for iOS.

## Remaining setup when the Apple account is active

1. Enable Push Notifications for the explicit Apple App ID `care.familytrack.app` and regenerate its signing profiles.
2. Create an APNs signing key. Store its `.p8` content only in backend secrets as `APNS_PRIVATE_KEY` (real newlines or escaped `\n` both work). Set `APNS_KEY_ID`, `APNS_TEAM_ID`, and `APNS_TOPIC=care.familytrack.app`.
3. Set `APNS_ENVIRONMENT=production` for TestFlight/App Store. Use `sandbox` only on a separate development backend with development-signed devices. Do not mix development and production tokens in the same backend: it selects one APNs environment. The Xcode Debug entitlement is development and Release is production.
4. Deploy the backend changes with `ENABLE_NOTIFICATION_SCHEDULER=true`. Existing notification tables are reused and upgraded by the service. Keep VAPID keys for web users.
5. Build with `npm ci` and `npm run ios:sync` on macOS, then archive a signed Release build for TestFlight. Windows can build the web bundle and sync files but cannot compile/sign Xcode projects.

## Device acceptance checks (not yet performed)

- Sign in, open Settings → Notifications, enable, accept permission, and send a test. Check the alert in foreground, background and with the app closed.
- Deny permission and verify the Settings guidance; allow it in iPhone Settings and return to the app.
- Create a medication and appointment reminder and verify the scanner sends it once in the expected time window. Given/skipped medication logs from any carer suppress the matching dose for that child and local date; deleted logs do not count. Older logs match a single explicit scheduled window, or the uniquely nearest scheduled time within two hours. Ambiguous logs leave reminders enabled so they cannot silently cancel another dose. A notification already sent cannot be recalled by subsequently logging a dose.
- Test hydration preferences, quiet hours, and optional email fallback with your actual schedules. Enable the optional no-logs nudge and verify it only sends at 8pm local time when there are no care logs (future appointment entries do not count). The scanner runs every five minutes; exact delivery to the minute is not guaranteed.
- Tap notifications and verify their existing app destination. Reject external URLs.
- Sign out and verify that device stops receiving reminders; sign in as another user and verify account isolation.
- Test on two devices: the test button must notify only the selected device. Turning push off unregisters only the current device and preserves the account preference, so other devices continue receiving reminders. Reopening the disabled device must not register it again until notifications are explicitly enabled there.
- Test offline/reconnect. Failed reminder attempts can retry within their due window; server downtime outside that window is not recovered by this change.

An APNs success means Apple accepted the notification, not proof it appeared on the phone. Focus settings, connectivity and device permissions affect presentation. There are no local/offline scheduled reminders in this implementation.

## Automated checks

`npm run test:ios`, `npm run test:notifications`, `npm run build:ios`, and `npm run build` (Node 22.3+). Backend dependencies must be installed with `npm ci --prefix backend`.

References: https://capacitorjs.com/docs/v7/apis/push-notifications and https://developer.apple.com/documentation/usernotifications/sending-notification-requests-to-apns

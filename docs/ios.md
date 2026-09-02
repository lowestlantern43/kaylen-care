# FamilyTrack iOS app

The iOS app is a Capacitor shell around the existing React/Vite frontend. It uses the
production FamilyTrack API at `https://familytrack.care/api`; it does not contain database,
Stripe, or DigitalOcean credentials.

## Local workflow

1. Install root dependencies with `npm ci`.
2. Build and copy the web app into Xcode with `npm run ios:sync`.
3. On a Mac with Xcode and CocoaPods installed, run `npm run ios:open`.
4. Select the FamilyTrack signing team and a test device in Xcode.

The bundle identifier is `care.familytrack.app`.

## Production safety

- DigitalOcean currently deploys `codex/familytrack-saas`; iOS work belongs on a separate
  branch until it has been reviewed and tested.
- The web frontend, API, PostgreSQL database, and Spaces bucket remain the source of truth.
- Native changes must not alter or delete existing database records.
- The backend accepts the exact native origin `capacitor://localhost` for authenticated API
  requests. Browser origins remain restricted to the configured FamilyTrack frontend.

## Before App Store submission

- Test login, logout, uploads, reports, PDF export, invitations, and session persistence on
  a physical iPhone.
- Add StoreKit in-app subscriptions and restore-purchases support. Do not expose Stripe web
  checkout for the app's digital subscription inside the submitted iOS build.
- Add final App Store icon and launch artwork.
- Add the privacy manifest, privacy disclosures, support URL, terms, account-deletion flow,
  and App Review test account.
- Configure signing, App Store Connect products, sandbox testers, and TestFlight.

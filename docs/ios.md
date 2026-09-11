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
- The companion build keeps Stripe subscriptions on the website. Native screens must not
  expose checkout, billing portal, paid storage upgrades, or prompts to buy elsewhere.
  Submit this model transparently for review under guideline 3.1.3(f); eligibility is
  subject to Apple's review, not guaranteed by hiding checkout. If Apple classifies the
  app under 3.1.3(b), reassess the purchase model before release.
- Add final App Store icon and launch artwork.
- Add the privacy manifest, privacy disclosures, support URL, terms, account-deletion flow,
  and App Review test account.
- Configure signing, App Store Connect, and TestFlight.

## Companion branch verification

Worktree: `FamilyTrack-iOS`, branch: `codex/ios-companion`.

Validation completed locally: web build, iOS web build, Capacitor asset copy,
`npm run test:ios` (native/browser transport, payment blocking, HTTP/network errors,
inactive account screen), and browser inspection of the login-only opening screen.
These checks do not establish physical iPhone session persistence or App Store approval.

- `npm run build:ios` selects companion screens even in a browser preview.
- JSON API requests use CapacitorHttp on the device, sharing the native cookie store;
  browser builds use fetch. Login verifies `/auth/me` before accepting the session.
- Keep CapacitorHttp enabled for binary uploads. Test photo/document upload and downloads
  separately on iOS; a JSON login check does not validate file handling.
- Missing workspace/checkout-required accounts see refresh, logout and support actions.
  Existing server-side access rules still control reads and writes.
- The website retains signup, Stripe checkout, portal and storage purchasing.
- Production currently did not return an allow-origin header for `capacitor://localhost`
  in the unauthenticated check on 2026-09-11. Native HTTP avoids browser CORS for JSON
  requests; the backend origin change on the older iOS branch is not proof of deployment.
- Before release: verify valid login, wrong password, restart persistence, logout,
  expired/trial/inactive accounts and no purchase links using test accounts on iPhone.
  No real customer credentials or data are needed in build artifacts.

# Public traffic and nightly owner digest

Admin > Overview > Website traffic. Public page tracking requires an affirmative
analytics choice; declining has no effect on signup or care access. Browser IDs
and event data expire after 90 days. No IP, full user-agent, query string, form
contents or care records are stored. Numbers describe consenting browsers, not
all people. Registrations are a separate count across all registration sources.

Migration 028 is additive and also installed idempotently by the isolated service.
Existing customer emails, Stripe webhooks, authentication and iOS code are untouched.
The old optional analytics endpoint remains unchanged for existing clients.

The digest is disabled until an administrator saves its recipient and enables it.
It runs in the existing API process once a minute. The period is previous 22:30
to current 22:30 Europe/London, including daylight-saving changes. It does not
backfill periods before enabling. Downtime over 12 hours can mean a missed digest.
New user emails and existing email audit delivery facts are included; no care data.
Preview does not send an email. Trial warning labels use the recorded daysLeft.

Resend is required. A database claim prevents simultaneous workers sending, while
a stable provider idempotency key and persisted payload protect retries after a
crash. Failed attempts retry every five minutes for at most 12 hours; runs remain
visible in admin. Sent means provider acceptance. Records/payloads expire at 90 days.

Rollback: disable the digest in admin, revert the web tracking component and the
isolated insights router/scheduler imports. New tables may remain safely in place.

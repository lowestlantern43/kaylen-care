# Billing and dispute evidence foundation

FamilyTrack records billing evidence separately from care data. The evidence
store is append-only and deliberately contains no child profiles, care logs,
medications, meals, toileting, medical episodes, passwords, authentication
tokens, or payment-card details.

## Storage

`billing_audit_events` contains subscription, payment, refund, fraud warning,
dispute, and operational evidence. Stripe event IDs and logical idempotency keys
prevent duplicate webhook deliveries and overlapping invoice success events from
creating duplicate evidence.

`billing_consent_evidence` is the backend foundation for a future versioned
consent flow. It can retain the policy versions and commercial terms presented,
the calculated first payment date, acceptance time, and limited request audit
metadata. No current signup or trial screen writes to it yet.

Both tables reject updates and deletes at database level. They intentionally
retain internal UUID references without foreign keys, so later account cleanup
cannot silently remove or mutate historical billing evidence.

## Stripe behavior

The existing subscription synchronization runs first and is unchanged. Evidence
recording runs afterwards and fails open: a logging failure is reported to server
logs but cannot fail a payment webhook that has already been processed.

Refund, dispute, and Early Fraud Warning events are observation-only. They never
refund, cancel, suspend, reactivate, or alter an account.

## Administrator access

`GET /api/admin/families/:familyId/billing-audit` is protected by the existing
authenticated platform-administrator middleware. Its response contains the
subscription summary, billing timeline, Stripe references, and consent evidence.
It does not join to or return child profiles or care records. There is no customer
route for this data.

## Future evidence report

A future dispute PDF should read only from the subscription summary,
`billing_audit_events`, and `billing_consent_evidence`. The report may show:

- customer account and subscription identifiers;
- trial and policy acceptance evidence;
- payment, refund, fraud warning, and dispute events;
- service-access and billing-email evidence once those safe producers are added.

The report must never query or include child profiles or care-log tables. PDF
generation, customer consent capture, authentication-event capture, and billing
email instrumentation remain separate follow-up changes so they can be reviewed
without changing the current iOS-facing behavior.

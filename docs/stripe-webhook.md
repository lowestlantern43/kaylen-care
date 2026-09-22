# FamilyTrack Stripe Webhook

Configure Stripe Dashboard webhooks to send events to:

```text
https://familytrack.care/api/stripe/webhook
```

Do not use the homepage/root URL (`https://familytrack.care`) as the webhook
endpoint. The homepage cannot verify Stripe signatures or process subscription
events.

Required backend environment variables:

```text
STRIPE_SECRET_KEY=sk_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_EVIDENCE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_ID=price_...
```

Optional document storage add-on price IDs:

```text
STRIPE_DOCUMENTS_50GB_PRICE_ID=price_...
STRIPE_DOCUMENTS_100GB_PRICE_ID=price_...
```

Stripe Price IDs can also be managed from Owner Platform -> Billing -> Stripe
Billing Configuration. Saved owner-platform values are used first; these
environment variables remain as fallbacks for deployments and recovery.

Select these Stripe events:

```text
checkout.session.completed
customer.subscription.created
customer.subscription.updated
customer.subscription.deleted
invoice.payment_succeeded
invoice.paid
invoice.payment_failed
refund.created
refund.updated
refund.failed
charge.refunded
radar.early_fraud_warning.created
radar.early_fraud_warning.updated
charge.dispute.created
charge.dispute.updated
charge.dispute.closed
```

The webhook route uses Stripe's raw request body and verifies the
`Stripe-Signature` header with `STRIPE_WEBHOOK_SECRET`. Successful events are
tracked by Stripe event ID so retries are safe and idempotent.

Subscription and invoice events continue to drive the existing subscription sync.
Refund, dispute, and Early Fraud Warning events are evidence-only: they are written
to the append-only billing audit and do not refund, cancel, suspend, or otherwise
change a customer account.

## Evidence-only destination

For audit collection that is isolated from subscription control, create a second
Stripe event destination at:

```text
https://familytrack.care/api/stripe/evidence-webhook
```

Store that destination's separate signing secret in
`STRIPE_EVIDENCE_WEBHOOK_SECRET`. This endpoint uses its own delivery ledger and
only writes append-only billing evidence. It does not call the subscription sync,
change access, issue refunds, cancel subscriptions, or suspend accounts.

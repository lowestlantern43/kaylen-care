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
invoice.payment_failed
```

The webhook route uses Stripe's raw request body and verifies the
`Stripe-Signature` header with `STRIPE_WEBHOOK_SECRET`. Successful events are
tracked by Stripe event ID so retries are safe and idempotent.

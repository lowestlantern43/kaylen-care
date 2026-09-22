import { query } from "../db/pool.js";

const blockedMetadataKey =
  /(password|passcode|secret|token|authorization|cookie|session|card|cvc|cvv|pan|payment[_-]?method|account[_-]?number|routing|sort[_-]?code|iban|fingerprint|expiry|exp[_-]?(month|year)|medical|medication|diagnosis|care[_-]?log|child|nhs)/i;

function cleanString(value, maximumLength = 500) {
  return String(value ?? "").slice(0, maximumLength);
}

function cleanMetadataValue(value, depth = 0) {
  if (depth > 4 || value === undefined) return undefined;
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "string") return cleanString(value);
  if (Array.isArray(value)) {
    return value
      .slice(0, 25)
      .map((item) => cleanMetadataValue(item, depth + 1))
      .filter((item) => item !== undefined);
  }
  if (typeof value !== "object") return undefined;

  return Object.fromEntries(
    Object.entries(value)
      .slice(0, 75)
      .filter(([key]) => !blockedMetadataKey.test(key))
      .map(([key, item]) => [cleanString(key, 100), cleanMetadataValue(item, depth + 1)])
      .filter(([, item]) => item !== undefined),
  );
}

export function sanitiseBillingMetadata(metadata) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return {};
  return cleanMetadataValue(metadata) || {};
}

export async function appendBillingAuditEvent(event, database = { query }) {
  const metadata = sanitiseBillingMetadata(event.metadata);
  const result = await database.query(
    `
      INSERT INTO billing_audit_events (
        family_id,
        user_id,
        event_type,
        event_source,
        occurred_at,
        stripe_customer_id,
        stripe_subscription_id,
        stripe_checkout_session_id,
        stripe_payment_intent_id,
        stripe_invoice_id,
        stripe_charge_id,
        stripe_refund_id,
        stripe_dispute_id,
        stripe_event_id,
        amount_minor,
        currency,
        metadata,
        ip_address,
        user_agent,
        idempotency_key
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
        $11, $12, $13, $14, $15, $16, $17, $18, $19, $20
      )
      ON CONFLICT DO NOTHING
      RETURNING id
    `,
    [
      event.familyId || null,
      event.userId || null,
      cleanString(event.eventType, 100),
      cleanString(event.eventSource || "backend", 100),
      event.occurredAt || new Date().toISOString(),
      event.stripeCustomerId || null,
      event.stripeSubscriptionId || null,
      event.stripeCheckoutSessionId || null,
      event.stripePaymentIntentId || null,
      event.stripeInvoiceId || null,
      event.stripeChargeId || null,
      event.stripeRefundId || null,
      event.stripeDisputeId || null,
      event.stripeEventId || null,
      Number.isSafeInteger(event.amountMinor) ? event.amountMinor : null,
      event.currency ? cleanString(event.currency, 10).toLowerCase() : null,
      JSON.stringify(metadata),
      event.ipAddress || null,
      event.userAgent ? cleanString(event.userAgent, 500) : null,
      event.idempotencyKey ? cleanString(event.idempotencyKey, 250) : null,
    ],
  );

  return result.rows[0]?.id || null;
}

export async function recordBillingAuditEventSafely(event, database = { query }) {
  try {
    return await appendBillingAuditEvent(event, database);
  } catch (error) {
    console.error("Billing audit event could not be recorded.", {
      eventType: event?.eventType || "unknown",
      stripeEventId: event?.stripeEventId || "",
      message: error.message,
    });
    return null;
  }
}

export async function appendBillingConsentEvidence(evidence, database = { query }) {
  const metadata = sanitiseBillingMetadata(evidence.metadata);
  const result = await database.query(
    `
      INSERT INTO billing_consent_evidence (
        family_id,
        user_id,
        terms_version,
        privacy_policy_version,
        refund_policy_version,
        price_presented_minor,
        currency,
        billing_interval,
        trial_days_presented,
        calculated_first_payment_at,
        accepted_at,
        evidence_source,
        ip_address,
        user_agent,
        metadata,
        idempotency_key
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8,
        $9, $10, $11, $12, $13, $14, $15, $16
      )
      ON CONFLICT DO NOTHING
      RETURNING id
    `,
    [
      evidence.familyId || null,
      evidence.userId || null,
      evidence.termsVersion || null,
      evidence.privacyPolicyVersion || null,
      evidence.refundPolicyVersion || null,
      Number.isSafeInteger(evidence.pricePresentedMinor)
        ? evidence.pricePresentedMinor
        : null,
      evidence.currency ? cleanString(evidence.currency, 10).toLowerCase() : null,
      evidence.billingInterval ? cleanString(evidence.billingInterval, 50) : null,
      Number.isInteger(evidence.trialDaysPresented) ? evidence.trialDaysPresented : null,
      evidence.calculatedFirstPaymentAt || null,
      evidence.acceptedAt || new Date().toISOString(),
      cleanString(evidence.evidenceSource || "backend", 100),
      evidence.ipAddress || null,
      evidence.userAgent ? cleanString(evidence.userAgent, 500) : null,
      JSON.stringify(metadata),
      evidence.idempotencyKey ? cleanString(evidence.idempotencyKey, 250) : null,
    ],
  );

  return result.rows[0]?.id || null;
}

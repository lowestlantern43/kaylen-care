import { query } from "../db/pool.js";
import {
  appendBillingAuditEvent,
  recordBillingAuditEventSafely,
} from "./billingAudit.js";

function stripeId(value) {
  return typeof value === "string" ? value : value?.id || null;
}

function occurredAt(event) {
  return event?.created
    ? new Date(event.created * 1000).toISOString()
    : new Date().toISOString();
}

function baseEvent(event, object, eventType, idempotencyKey) {
  return {
    eventType,
    eventSource: "stripe_webhook",
    occurredAt: occurredAt(event),
    stripeEventId: event.id,
    stripeCustomerId: stripeId(object.customer),
    stripeSubscriptionId:
      object.object === "subscription" ? object.id : stripeId(object.subscription),
    stripeCheckoutSessionId: object.object === "checkout.session" ? object.id : null,
    stripePaymentIntentId: stripeId(object.payment_intent),
    stripeInvoiceId: object.object === "invoice" ? object.id : stripeId(object.invoice),
    stripeChargeId: object.object === "charge" ? object.id : stripeId(object.charge),
    stripeRefundId: object.object === "refund" ? object.id : null,
    stripeDisputeId: object.object === "dispute" ? object.id : null,
    amountMinor:
      Number.isSafeInteger(object.amount_paid)
        ? object.amount_paid
        : Number.isSafeInteger(object.amount)
          ? object.amount
          : null,
    currency: object.currency || null,
    idempotencyKey,
    metadata: {
      stripeObject: object.object || null,
      stripeStatus: object.status || null,
      billingReason: object.billing_reason || null,
      paymentStatus: object.payment_status || null,
      disputeReason: object.reason || null,
      cancelAtPeriodEnd:
        typeof object.cancel_at_period_end === "boolean"
          ? object.cancel_at_period_end
          : null,
      livemode: typeof event.livemode === "boolean" ? event.livemode : null,
    },
  };
}

function logicalKey(prefix, id, eventType, fallbackEventId) {
  return id
    ? `stripe:${prefix}:${id}:${eventType}`
    : `stripe:event:${fallbackEventId}:${eventType}`;
}

function refundEventType(refund) {
  if (refund.status === "succeeded") return "refund_succeeded";
  if (refund.status === "failed" || refund.status === "canceled") return "refund_failed";
  return "refund_requested";
}

function disputeEventType(eventType, dispute) {
  if (dispute.status === "won") return "dispute_won";
  if (dispute.status === "lost") return "dispute_lost";
  return eventType === "charge.dispute.created" ? "dispute_created" : "dispute_updated";
}

export function mapStripeEventToBillingAuditEvents(event) {
  const object = event?.data?.object || {};
  const mapped = [];
  const add = (type, keyPrefix, keyId = object.id) => {
    mapped.push(
      baseEvent(
        event,
        object,
        type,
        logicalKey(keyPrefix, keyId, type, event.id),
      ),
    );
  };

  if (event.type === "customer.subscription.created") {
    add("subscription_created", "subscription");
    if (object.status === "trialing" || object.trial_start) add("trial_started", "subscription");
    if (object.status === "active") add("subscription_activated", "subscription");
  } else if (event.type === "customer.subscription.updated") {
    add("subscription_updated", "event", event.id);
    const priorStatus = event.data?.previous_attributes?.status;
    if (priorStatus === "trialing" && object.status !== "trialing") {
      add("trial_ended", "subscription");
    }
    if (object.status === "active" && priorStatus && priorStatus !== "active") {
      add("subscription_activated", "subscription");
    }
  } else if (event.type === "customer.subscription.deleted") {
    add("subscription_cancelled", "subscription");
  } else if (event.type === "checkout.session.completed" && object.mode === "subscription") {
    add("subscription_created", "subscription", stripeId(object.subscription) || object.id);
  } else if (["invoice.payment_succeeded", "invoice.paid"].includes(event.type)) {
    add("payment_succeeded", "invoice");
  } else if (event.type === "invoice.payment_failed") {
    add("payment_failed", "invoice");
  } else if (["refund.created", "refund.updated", "refund.failed"].includes(event.type)) {
    add(refundEventType(object), "refund");
  } else if (event.type === "charge.refunded") {
    const refunds = object.refunds?.data || [];
    const refund = refunds[refunds.length - 1];
    const audit = baseEvent(
      event,
      { ...object, object: "refund", id: refund?.id, amount: refund?.amount ?? object.amount_refunded },
      "refund_succeeded",
      logicalKey("refund", refund?.id || object.id, "refund_succeeded", event.id),
    );
    audit.stripeChargeId = object.id;
    audit.stripeRefundId = refund?.id || null;
    mapped.push(audit);
  } else if (
    ["radar.early_fraud_warning.created", "radar.early_fraud_warning.updated"].includes(
      event.type,
    )
  ) {
    add("early_fraud_warning", "event", event.id);
  } else if (
    ["charge.dispute.created", "charge.dispute.updated", "charge.dispute.closed"].includes(
      event.type,
    )
  ) {
    const mappedType = disputeEventType(event.type, object);
    add(
      mappedType,
      mappedType === "dispute_updated" ? "event" : "dispute",
      mappedType === "dispute_updated" ? event.id : object.id,
    );
  }

  return mapped;
}

async function resolveFamilyId(auditEvent, object, fallbackFamilyId) {
  const metadataFamilyId =
    object?.metadata?.family_id || object?.metadata?.account_id || object?.metadata?.familyId;
  if (metadataFamilyId) return metadataFamilyId;
  if (fallbackFamilyId) return fallbackFamilyId;

  const identifiers = [
    auditEvent.stripeSubscriptionId,
    auditEvent.stripeCustomerId,
    auditEvent.stripeInvoiceId,
    auditEvent.stripePaymentIntentId,
    auditEvent.stripeChargeId,
    auditEvent.stripeRefundId,
    auditEvent.stripeDisputeId,
  ].filter(Boolean);
  if (!identifiers.length) return null;

  const subscriptionMatch = await query(
    `
      SELECT family_id AS "familyId"
      FROM subscriptions
      WHERE stripe_subscription_id = $1 OR stripe_customer_id = $2
      ORDER BY created_at DESC NULLS LAST
      LIMIT 1
    `,
    [auditEvent.stripeSubscriptionId || "", auditEvent.stripeCustomerId || ""],
  );
  if (subscriptionMatch.rows[0]?.familyId) return subscriptionMatch.rows[0].familyId;

  const evidenceMatch = await query(
    `
      SELECT family_id AS "familyId"
      FROM billing_audit_events
      WHERE family_id IS NOT NULL
        AND (
          stripe_invoice_id = ANY($1::text[])
          OR stripe_payment_intent_id = ANY($1::text[])
          OR stripe_charge_id = ANY($1::text[])
          OR stripe_refund_id = ANY($1::text[])
          OR stripe_dispute_id = ANY($1::text[])
        )
      ORDER BY occurred_at DESC
      LIMIT 1
    `,
    [identifiers],
  );
  return evidenceMatch.rows[0]?.familyId || null;
}

export async function recordStripeBillingAuditEventsSafely(
  event,
  { familyId = null, userId = null } = {},
) {
  const object = event?.data?.object || {};
  const auditEvents = mapStripeEventToBillingAuditEvents(event);

  for (const auditEvent of auditEvents) {
    try {
      const resolvedFamilyId = await resolveFamilyId(auditEvent, object, familyId);
      await recordBillingAuditEventSafely({
        ...auditEvent,
        familyId: resolvedFamilyId,
        userId:
          userId || object?.metadata?.user_id || object?.metadata?.userId || null,
      });
    } catch (error) {
      console.error("Stripe billing audit mapping could not be completed.", {
        eventType: event?.type || "unknown",
        stripeEventId: event?.id || "",
        message: error.message,
      });
    }
  }
}

export async function recordStripeBillingAuditEvents(
  event,
  { familyId = null, userId = null } = {},
) {
  const object = event?.data?.object || {};
  const auditEvents = mapStripeEventToBillingAuditEvents(event);
  const recordedIds = [];

  for (const auditEvent of auditEvents) {
    const resolvedFamilyId = await resolveFamilyId(auditEvent, object, familyId);
    const recordedId = await appendBillingAuditEvent({
      ...auditEvent,
      familyId: resolvedFamilyId,
      userId:
        userId || object?.metadata?.user_id || object?.metadata?.userId || null,
    });
    if (recordedId) recordedIds.push(recordedId);
  }

  return {
    mappedCount: auditEvents.length,
    recordedCount: recordedIds.length,
    recordedIds,
  };
}

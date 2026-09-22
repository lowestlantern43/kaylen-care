import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

process.env.DATABASE_URL ||= "postgresql://test:test@localhost:5432/familytrack_test";

const {
  recordBillingAuditEventSafely,
  sanitiseBillingMetadata,
} = await import("../src/services/billingAudit.js");
const { mapStripeEventToBillingAuditEvents } = await import(
  "../src/services/stripeBillingAudit.js"
);
const { verifyStripeWebhookSignature } = await import("../src/services/stripe.js");

function stripeEvent(type, object, previousAttributes = undefined) {
  return {
    id: `evt_${type.replaceAll(".", "_")}`,
    type,
    created: 1_700_000_000,
    livemode: true,
    data: { object, previous_attributes: previousAttributes },
  };
}

test("redacts sensitive and care-related metadata recursively", () => {
  const cleaned = sanitiseBillingMetadata({
    status: "active",
    password: "never-store-this",
    nested: {
      cardNumber: "4242424242424242",
      payment_method: { number: "4242424242424242" },
      childName: "Sensitive child",
      invoiceReason: "subscription_cycle",
    },
  });

  assert.deepEqual(cleaned, {
    status: "active",
    nested: { invoiceReason: "subscription_cycle" },
  });
});

test("deduplicates invoice success across Stripe's two success event names", () => {
  const invoice = {
    id: "in_123",
    object: "invoice",
    customer: "cus_123",
    subscription: "sub_123",
    payment_intent: "pi_123",
    charge: "ch_123",
    amount_paid: 999,
    currency: "gbp",
  };

  const paid = mapStripeEventToBillingAuditEvents(stripeEvent("invoice.paid", invoice));
  const succeeded = mapStripeEventToBillingAuditEvents(
    stripeEvent("invoice.payment_succeeded", invoice),
  );

  assert.equal(paid[0].eventType, "payment_succeeded");
  assert.equal(paid[0].idempotencyKey, succeeded[0].idempotencyKey);
  assert.equal(paid[0].amountMinor, 999);
});

test("records trial completion and activation without changing subscription state", () => {
  const events = mapStripeEventToBillingAuditEvents(
    stripeEvent(
      "customer.subscription.updated",
      {
        id: "sub_123",
        object: "subscription",
        customer: "cus_123",
        status: "active",
      },
      { status: "trialing" },
    ),
  );

  assert.deepEqual(
    events.map((event) => event.eventType),
    ["subscription_updated", "trial_ended", "subscription_activated"],
  );
});

test("early fraud warnings are mapped to evidence only", () => {
  const events = mapStripeEventToBillingAuditEvents(
    stripeEvent("radar.early_fraud_warning.created", {
      id: "issfr_123",
      object: "radar.early_fraud_warning",
      charge: "ch_123",
    }),
  );

  assert.equal(events.length, 1);
  assert.equal(events[0].eventType, "early_fraud_warning");
  assert.equal(events[0].stripeChargeId, "ch_123");
});

test("closed disputes record their outcome", () => {
  const won = mapStripeEventToBillingAuditEvents(
    stripeEvent("charge.dispute.closed", {
      id: "dp_123",
      object: "dispute",
      charge: "ch_123",
      payment_intent: "pi_123",
      status: "won",
      amount: 999,
      currency: "gbp",
    }),
  );

  assert.equal(won[0].eventType, "dispute_won");
  assert.equal(won[0].stripeDisputeId, "dp_123");
  assert.equal(won[0].stripeChargeId, "ch_123");
});

test("billing evidence persistence is fail-open", async () => {
  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    const result = await recordBillingAuditEventSafely(
      { eventType: "payment_succeeded", stripeEventId: "evt_123" },
      {
        query: async () => {
          throw new Error("simulated evidence database failure");
        },
      },
    );

    assert.equal(result, null);
  } finally {
    console.error = originalConsoleError;
  }
});

test("webhook signature verification accepts an isolated evidence secret", () => {
  const rawBody = Buffer.from('{"id":"evt_evidence"}');
  const timestamp = "1700000000";
  const secret = "whsec_evidence_test";
  const signature = crypto
    .createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody.toString("utf8")}`)
    .digest("hex");

  assert.doesNotThrow(() =>
    verifyStripeWebhookSignature(rawBody, `t=${timestamp},v1=${signature}`, secret),
  );
  assert.throws(() =>
    verifyStripeWebhookSignature(
      rawBody,
      `t=${timestamp},v1=${signature}`,
      "whsec_wrong",
    ),
  );
});

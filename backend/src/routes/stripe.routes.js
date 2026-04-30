import { Router } from "express";
import { query } from "../db/pool.js";
import {
  retrieveStripeSubscription,
  verifyStripeWebhookSignature,
} from "../services/stripe.js";
import { ensurePlanAccessSchema } from "../services/planAccess.js";
import { asyncHandler } from "../utils/asyncHandler.js";

export const stripeRouter = Router();

function normalisePeriodEnd(timestamp) {
  return timestamp ? new Date(timestamp * 1000).toISOString() : null;
}

async function updateSubscriptionFromStripe(subscription) {
  await ensurePlanAccessSchema();

  const familyId = subscription.metadata?.family_id;
  if (!familyId) return;
  const status = subscription.status || "inactive";
  const plan = ["active", "trialing", "past_due"].includes(status)
    ? "family"
    : subscription.metadata?.plan || "family";

  await query(
    `
      INSERT INTO subscriptions (
        family_id,
        stripe_customer_id,
        stripe_subscription_id,
        status,
        plan,
        current_period_end,
        cancel_at_period_end
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (family_id)
      DO UPDATE SET
        stripe_customer_id = EXCLUDED.stripe_customer_id,
        stripe_subscription_id = EXCLUDED.stripe_subscription_id,
        status = EXCLUDED.status,
        plan = EXCLUDED.plan,
        current_period_end = EXCLUDED.current_period_end,
        cancel_at_period_end = EXCLUDED.cancel_at_period_end,
        access_paused_at = CASE
          WHEN EXCLUDED.status IN ('active', 'trialing') THEN NULL
          ELSE subscriptions.access_paused_at
        END,
        access_pause_reason = CASE
          WHEN EXCLUDED.status IN ('active', 'trialing') THEN ''
          ELSE subscriptions.access_pause_reason
        END
    `,
    [
      familyId,
      subscription.customer,
      subscription.id,
      status,
      plan,
      normalisePeriodEnd(subscription.current_period_end),
      Boolean(subscription.cancel_at_period_end),
    ],
  );
}

async function updateSubscriptionFromInvoice(invoice, fallbackStatus = null) {
  const subscriptionId =
    typeof invoice.subscription === "string"
      ? invoice.subscription
      : invoice.subscription?.id;

  if (!subscriptionId) return;

  const subscription = await retrieveStripeSubscription(subscriptionId);
  if (fallbackStatus) {
    subscription.status = fallbackStatus;
  }
  await updateSubscriptionFromStripe(subscription);
}

stripeRouter.post(
  "/webhook",
  asyncHandler(async (req, res) => {
    const rawBody = req.body;
    verifyStripeWebhookSignature(rawBody, req.headers["stripe-signature"]);

    const event = JSON.parse(rawBody.toString("utf8"));

    if (
      [
        "customer.subscription.created",
        "customer.subscription.updated",
        "customer.subscription.deleted",
      ].includes(event.type)
    ) {
      await updateSubscriptionFromStripe(event.data.object);
    }

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      if (session.mode === "subscription" && session.subscription) {
        const subscription = await retrieveStripeSubscription(session.subscription);
        await updateSubscriptionFromStripe(subscription);
      }
    }

    if (event.type === "invoice.payment_succeeded") {
      await updateSubscriptionFromInvoice(event.data.object);
    }

    if (event.type === "invoice.payment_failed") {
      await updateSubscriptionFromInvoice(event.data.object, "past_due");
    }

    res.json({ received: true });
  }),
);

import { Router } from "express";
import { query } from "../db/pool.js";
import {
  retrieveStripeSubscription,
  verifyStripeWebhookSignature,
} from "../services/stripe.js";
import { asyncHandler } from "../utils/asyncHandler.js";

export const stripeRouter = Router();

function normalisePeriodEnd(timestamp) {
  return timestamp ? new Date(timestamp * 1000).toISOString() : null;
}

async function updateSubscriptionFromStripe(subscription) {
  const familyId = subscription.metadata?.family_id;
  if (!familyId) return;

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
        cancel_at_period_end = EXCLUDED.cancel_at_period_end
    `,
    [
      familyId,
      subscription.customer,
      subscription.id,
      subscription.status || "inactive",
      subscription.items?.data?.[0]?.price?.nickname ||
        subscription.items?.data?.[0]?.price?.lookup_key ||
        "family",
      normalisePeriodEnd(subscription.current_period_end),
      Boolean(subscription.cancel_at_period_end),
    ],
  );
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

    res.json({ received: true });
  }),
);

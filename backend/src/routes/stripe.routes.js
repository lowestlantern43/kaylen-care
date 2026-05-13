import { Router } from "express";
import {
  retrieveStripeSubscription,
  verifyStripeWebhookSignature,
} from "../services/stripe.js";
import { syncSubscriptionFromStripe } from "../services/stripeSubscriptionSync.js";
import { asyncHandler } from "../utils/asyncHandler.js";

export const stripeRouter = Router();

async function updateSubscriptionFromStripe(subscription) {
  await syncSubscriptionFromStripe(subscription);
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
    console.info("Stripe webhook received.", {
      type: event.type,
      id: event.id,
    });

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
        console.info("Stripe checkout completed.", {
          sessionId: session.id,
          customerId: session.customer,
          subscriptionId: session.subscription,
          familyId: session.client_reference_id || session.metadata?.family_id,
        });
        const subscription = await retrieveStripeSubscription(session.subscription);
        await updateSubscriptionFromStripe(subscription);
      }
    }

    if (event.type === "invoice.payment_succeeded" || event.type === "invoice.paid") {
      await updateSubscriptionFromInvoice(event.data.object);
    }

    if (event.type === "invoice.payment_failed") {
      await updateSubscriptionFromInvoice(event.data.object, "past_due");
    }

    res.json({ received: true });
  }),
);

import { Router } from "express";
import {
  retrieveStripeCheckoutSession,
  retrieveStripeSubscription,
  verifyStripeWebhookSignature,
} from "../services/stripe.js";
import { query } from "../db/pool.js";
import { requireAuth } from "../middleware/auth.js";
import { buildPlanAccess, ensurePlanAccessSchema } from "../services/planAccess.js";
import { syncSubscriptionFromStripe } from "../services/stripeSubscriptionSync.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { badRequest, forbidden } from "../utils/httpError.js";

export const stripeRouter = Router();

async function loadSubscriptionAccess(familyId) {
  const { rows } = await query(
    `
      SELECT
        family_id AS "familyId",
        stripe_customer_id AS "stripeCustomerId",
        stripe_subscription_id AS "stripeSubscriptionId",
        status,
        COALESCE(billing_status, status, 'none') AS "billingStatus",
        COALESCE(access_status, 'none') AS "accessStatus",
        COALESCE(manual_access_override, 'none') AS "manualAccessOverride",
        plan,
        trial_started_at AS "trialStartedAt",
        trial_ends_at AS "trialEndsAt",
        access_paused_at AS "accessPausedAt",
        current_period_end AS "currentPeriodEnd",
        cancel_at_period_end AS "cancelAtPeriodEnd",
        stripe_synced_at AS "stripeSyncedAt"
      FROM subscriptions
      WHERE family_id = $1
      LIMIT 1
    `,
    [familyId],
  );
  const subscription = rows[0] || {
    familyId,
    status: "incomplete",
    billingStatus: "none",
    accessStatus: "none",
    plan: "family",
  };
  return { ...subscription, access: buildPlanAccess(subscription) };
}

async function familyForVerifiedSession(session, userId) {
  const familyId = session.client_reference_id || session.metadata?.family_id || "";
  if (!familyId) return null;

  const { rows } = await query(
    `
      SELECT f.id AS "familyId", f.name AS "familyName"
      FROM family_members fm
      INNER JOIN families f ON f.id = fm.family_id
      WHERE fm.user_id = $1
        AND fm.family_id = $2
        AND fm.deleted_at IS NULL
        AND f.deleted_at IS NULL
      LIMIT 1
    `,
    [userId, familyId],
  );

  return rows[0] || null;
}

stripeRouter.get(
  "/verify-session",
  requireAuth,
  asyncHandler(async (req, res) => {
    await ensurePlanAccessSchema();
    const sessionId = String(req.query?.session_id || req.query?.sessionId || "").trim();
    if (!sessionId || !sessionId.startsWith("cs_")) {
      throw badRequest("Stripe Checkout session ID is missing.");
    }

    console.info("Stripe verify-session requested.", {
      userId: req.user.id,
      sessionId,
    });

    const session = await retrieveStripeCheckoutSession(sessionId);
    const family = await familyForVerifiedSession(session, req.user.id);
    if (!family) {
      throw forbidden("That Stripe Checkout session is not linked to this account.");
    }

    const subscription =
      typeof session.subscription === "string"
        ? await retrieveStripeSubscription(session.subscription)
        : session.subscription;

    if (!subscription) {
      throw badRequest("Stripe has not attached a subscription to this Checkout session yet.");
    }

    const synced = await syncSubscriptionFromStripe(subscription, family.familyId);
    const localSubscription = await loadSubscriptionAccess(family.familyId);

    console.info("Stripe verify-session synced subscription.", {
      userId: req.user.id,
      familyId: family.familyId,
      sessionId,
      stripeSubscriptionId: localSubscription.stripeSubscriptionId,
      status: localSubscription.status,
      billingStatus: localSubscription.billingStatus,
      access: localSubscription.access?.computedAccess,
    });

    res.json({
      data: {
        family,
        synced,
        subscription: localSubscription,
      },
      error: null,
    });
  }),
);

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

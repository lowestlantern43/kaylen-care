import { Router } from "express";
import { query } from "../db/pool.js";
import { requireAuth } from "../middleware/auth.js";
import {
  retrieveStripeCheckoutSession,
  retrieveStripeSubscription,
} from "../services/stripe.js";
import {
  buildPlanAccess,
  ensurePlanAccessSchema,
} from "../services/planAccess.js";
import { syncSubscriptionFromStripe } from "../services/stripeSubscriptionSync.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { badRequest, forbidden } from "../utils/httpError.js";

export const billingRouter = Router();

billingRouter.use(requireAuth);
billingRouter.use(
  asyncHandler(async (req, res, next) => {
    await ensurePlanAccessSchema();
    next();
  }),
);

async function familyForCheckoutSession(session, userId) {
  const sessionFamilyId =
    session.client_reference_id || session.metadata?.family_id || "";
  const customerId =
    typeof session.customer === "string" ? session.customer : session.customer?.id;

  const params = [userId];
  let where = "";

  if (sessionFamilyId) {
    params.push(sessionFamilyId);
    where = "AND f.id = $2";
  } else if (customerId) {
    params.push(customerId);
    where = "AND s.stripe_customer_id = $2";
  } else {
    throw badRequest("Stripe Checkout session is missing family and customer details.");
  }

  const { rows } = await query(
    `
      SELECT
        f.id AS "familyId",
        f.name AS "familyName",
        fm.role,
        s.stripe_customer_id AS "stripeCustomerId"
      FROM family_members fm
      INNER JOIN families f ON f.id = fm.family_id
      LEFT JOIN subscriptions s ON s.family_id = f.id
      WHERE fm.user_id = $1
        AND fm.deleted_at IS NULL
        AND f.deleted_at IS NULL
        ${where}
      LIMIT 1
    `,
    params,
  );

  return rows[0] || null;
}

async function loadSyncedFamilyAccess(familyId) {
  const { rows } = await query(
    `
      SELECT
        family_id AS "familyId",
        stripe_customer_id AS "stripeCustomerId",
        stripe_subscription_id AS "stripeSubscriptionId",
        status,
        status AS "subscriptionStatus",
        COALESCE(billing_status, status, 'none') AS "billingStatus",
        COALESCE(access_status, 'legacy') AS "accessStatus",
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

  const subscription = rows[0] || { familyId, status: "incomplete", plan: "family" };
  return {
    ...subscription,
    access: buildPlanAccess(subscription),
  };
}

billingRouter.post(
  "/sync-checkout-session",
  asyncHandler(async (req, res) => {
    const sessionId = String(req.body?.sessionId || "").trim();
    if (!sessionId || !sessionId.startsWith("cs_")) {
      throw badRequest("Stripe Checkout session ID is missing.");
    }

    const session = await retrieveStripeCheckoutSession(sessionId);
    const family = await familyForCheckoutSession(session, req.user.id);

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
    const localSubscription = await loadSyncedFamilyAccess(family.familyId);

    console.info("Stripe Checkout session synced from app return.", {
      userId: req.user.id,
      familyId: family.familyId,
      sessionId,
      subscriptionId: localSubscription.stripeSubscriptionId,
      billingStatus: localSubscription.billingStatus,
      accessStatus: localSubscription.accessStatus,
      computedAccess: localSubscription.access?.reason,
    });

    res.json({
      data: {
        synced,
        family,
        subscription: localSubscription,
      },
      error: null,
    });
  }),
);

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

async function ensureStripeWebhookEventsSchema() {
  await query(`
    CREATE TABLE IF NOT EXISTS stripe_webhook_events (
      stripe_event_id TEXT PRIMARY KEY,
      event_type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'processing',
      attempts INTEGER NOT NULL DEFAULT 1,
      last_error TEXT,
      processed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

async function beginStripeWebhookEvent(event) {
  await ensureStripeWebhookEventsSchema();

  const { rows } = await query(
    `
      INSERT INTO stripe_webhook_events (
        stripe_event_id,
        event_type,
        status,
        attempts,
        updated_at
      )
      VALUES ($1, $2, 'processing', 1, now())
      ON CONFLICT (stripe_event_id)
      DO UPDATE SET
        attempts = stripe_webhook_events.attempts + 1,
        status = 'processing',
        last_error = null,
        updated_at = now()
      WHERE stripe_webhook_events.status = 'failed'
      RETURNING stripe_event_id, event_type, status, attempts
    `,
    [event.id, event.type],
  );

  if (rows[0]) return { shouldProcess: true, eventRecord: rows[0] };

  const existing = await query(
    `
      SELECT status, attempts
      FROM stripe_webhook_events
      WHERE stripe_event_id = $1
      LIMIT 1
    `,
    [event.id],
  );

  return {
    shouldProcess: false,
    eventRecord: existing.rows[0] || null,
  };
}

async function completeStripeWebhookEvent(event) {
  await query(
    `
      UPDATE stripe_webhook_events
      SET status = 'processed',
          processed_at = now(),
          last_error = null,
          updated_at = now()
      WHERE stripe_event_id = $1
    `,
    [event.id],
  );
}

async function failStripeWebhookEvent(event, error) {
  await query(
    `
      UPDATE stripe_webhook_events
      SET status = 'failed',
          last_error = $2,
          updated_at = now()
      WHERE stripe_event_id = $1
    `,
    [event.id, error?.message || "Webhook processing failed."],
  );
}

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
  let familyId =
    session.metadata?.family_id ||
    session.metadata?.account_id ||
    session.metadata?.familyId ||
    "";
  const customerId =
    typeof session.customer === "string" ? session.customer : session.customer?.id;
  const sessionUserId =
    session.metadata?.user_id ||
    session.metadata?.userId ||
    "";

  if (sessionUserId && sessionUserId !== userId) {
    throw forbidden("This Stripe Checkout session belongs to another user.");
  }

  if (!familyId) {
    const legacyReference = session.client_reference_id || "";
    const { rows: legacyRows } = await query(
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
      [userId, legacyReference],
    );
    if (legacyRows[0]) return legacyRows[0];
    if (customerId) {
      const { rows: customerRows } = await query(
        `
          SELECT f.id AS "familyId", f.name AS "familyName"
          FROM subscriptions s
          INNER JOIN families f ON f.id = s.family_id
          INNER JOIN family_members fm ON fm.family_id = f.id
          WHERE s.stripe_customer_id = $1
            AND fm.user_id = $2
            AND fm.deleted_at IS NULL
            AND f.deleted_at IS NULL
          LIMIT 1
        `,
        [customerId, userId],
      );
      if (customerRows[0]) return customerRows[0];
    }
    return null;
  }

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
  async (req, res) => {
    const debug = {
      stage: "start",
      userId: req.user?.id || "",
      sessionId: String(req.query?.session_id || req.query?.sessionId || "").trim(),
    };

    try {
      await ensurePlanAccessSchema();
      const sessionId = debug.sessionId;
      if (!sessionId || !sessionId.startsWith("cs_")) {
        debug.stage = "missing_session_id";
        throw badRequest("Stripe Checkout session ID is missing.");
      }

      console.info("Stripe verify-session requested.", debug);

      debug.stage = "retrieve_session";
      let session = null;
      session = await retrieveStripeCheckoutSession(sessionId);
      debug.customerId =
        typeof session.customer === "string" ? session.customer : session.customer?.id;
      debug.subscriptionId =
        typeof session.subscription === "string"
          ? session.subscription
          : session.subscription?.id;
      debug.metadataFamilyId = session.metadata?.family_id || session.metadata?.account_id || "";
      debug.metadataUserId = session.metadata?.user_id || "";
      debug.clientReferenceId = session.client_reference_id || "";
      console.info("Stripe verify-session loaded session.", debug);

      debug.stage = "link_family";
      const family = await familyForVerifiedSession(session, req.user.id);
      if (!family) {
        throw forbidden("That Stripe Checkout session is not linked to this account.");
      }
      debug.familyId = family.familyId;

      debug.stage = "load_subscription";
      const subscription =
        typeof session.subscription === "string"
          ? await retrieveStripeSubscription(session.subscription)
          : session.subscription;

      if (!subscription) {
        throw badRequest("Stripe has not attached a subscription to this Checkout session yet.");
      }

      debug.stage = "sync_subscription";
      let synced = null;
      synced = await syncSubscriptionFromStripe(subscription, family.familyId);
      debug.stage = "load_local_subscription";
      const localSubscription = await loadSubscriptionAccess(family.familyId);
      debug.localStatus = localSubscription.status;
      debug.localBillingStatus = localSubscription.billingStatus;
      debug.computedAccess = localSubscription.access?.computedAccess;

      console.info("Stripe verify-session synced subscription.", debug);

      res.json({
        data: {
          family,
          synced,
          subscription: localSubscription,
          debug,
        },
        error: null,
      });
    } catch (error) {
      const status = error.status || 500;
      const message = error.message || "Stripe verification failed.";
      console.error("Stripe verify-session failed.", { ...debug, message, status });
      res.status(status).json({
        data: null,
        error: {
          code: error.code || "stripe_verify_failed",
          message: `${message} [stage: ${debug.stage}]`,
          details: debug,
        },
      });
    }
  },
);

async function updateSubscriptionFromStripe(subscription) {
  return syncSubscriptionFromStripe(subscription);
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
  return updateSubscriptionFromStripe(subscription);
}

stripeRouter.get("/webhook", (req, res) => {
  res.json({
    data: {
      ok: true,
      method: "POST",
      endpoint: "/api/stripe/webhook",
      message:
        "Stripe webhooks should be configured as POST https://familytrack.care/api/stripe/webhook",
    },
    error: null,
  });
});

stripeRouter.post(
  "/webhook",
  asyncHandler(async (req, res) => {
    const rawBody = req.body;
    if (!Buffer.isBuffer(rawBody)) {
      throw badRequest(
        "Stripe webhook requires the raw request body. Check Express raw body middleware for /api/stripe/webhook.",
      );
    }

    try {
      verifyStripeWebhookSignature(rawBody, req.headers["stripe-signature"]);
    } catch (error) {
      console.warn("Stripe webhook signature verification failed.", {
        message: error.message,
        hasSignature: Boolean(req.headers["stripe-signature"]),
      });
      throw error;
    }

    const event = JSON.parse(rawBody.toString("utf8"));
    console.info("Stripe webhook received.", {
      type: event.type,
      id: event.id,
    });

    const { shouldProcess, eventRecord } = await beginStripeWebhookEvent(event);
    if (!shouldProcess) {
      console.info("Stripe webhook event already handled or in progress.", {
        type: event.type,
        id: event.id,
        status: eventRecord?.status || "unknown",
        attempts: eventRecord?.attempts || 0,
      });
      res.json({ received: true, duplicate: true });
      return;
    }

    try {
      let synced = null;

      if (
        [
          "customer.subscription.created",
          "customer.subscription.updated",
          "customer.subscription.deleted",
        ].includes(event.type)
      ) {
        synced = await updateSubscriptionFromStripe(event.data.object);
      }

      if (event.type === "checkout.session.completed") {
        const session = event.data.object;
        if (session.mode === "subscription" && session.subscription) {
          console.info("Stripe checkout completed.", {
            sessionId: session.id,
            customerId: session.customer,
            subscriptionId: session.subscription,
            familyId: session.metadata?.family_id || session.metadata?.account_id || "",
            userId: session.metadata?.user_id || "",
            clientReferenceId: session.client_reference_id || "",
          });
          const subscription = await retrieveStripeSubscription(session.subscription);
          synced = await updateSubscriptionFromStripe(subscription);
        }
      }

      if (event.type === "invoice.payment_succeeded" || event.type === "invoice.paid") {
        synced = await updateSubscriptionFromInvoice(event.data.object);
      }

      if (event.type === "invoice.payment_failed") {
        synced = await updateSubscriptionFromInvoice(event.data.object, "past_due");
      }

      await completeStripeWebhookEvent(event);

      console.info("Stripe webhook processed.", {
        type: event.type,
        id: event.id,
        familyId: synced?.familyId || "",
        status: synced?.status || "",
        plan: synced?.plan || "",
      });
    } catch (error) {
      await failStripeWebhookEvent(event, error).catch(() => null);
      console.error("Stripe webhook processing failed.", {
        type: event.type,
        id: event.id,
        message: error.message,
      });
      throw error;
    }

    res.json({ received: true });
  }),
);

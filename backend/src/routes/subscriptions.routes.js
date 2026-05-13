import { Router } from "express";
import { config } from "../config.js";
import { query } from "../db/pool.js";
import { requireAuth } from "../middleware/auth.js";
import { requireFamilyMember, requireRole } from "../middleware/familyAccess.js";
import {
  createStripeBillingPortalSession,
  createStripeCheckoutSession,
  createStripeCustomer,
  findActiveStripePromotionCode,
  normalisePromotionCode,
  retrieveStripeCheckoutSession,
  retrieveStripeSubscription,
} from "../services/stripe.js";
import { ensurePlanAccessSchema } from "../services/planAccess.js";
import { syncSubscriptionFromStripe } from "../services/stripeSubscriptionSync.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { frontendUrlFromRequest } from "../utils/frontendUrl.js";
import { badRequest, forbidden } from "../utils/httpError.js";

export const subscriptionsRouter = Router({ mergeParams: true });

subscriptionsRouter.use(requireAuth, requireFamilyMember);
subscriptionsRouter.use(
  asyncHandler(async (req, res, next) => {
    await ensurePlanAccessSchema();
    next();
  }),
);

function normaliseDocumentVaultTiers(tiers = []) {
  const cleanTiers = Array.isArray(tiers)
    ? tiers
        .map((tier, index) => ({
          id:
            typeof tier?.id === "string" && tier.id.trim()
              ? tier.id.trim()
              : `storage-tier-${index + 1}`,
          label:
            typeof tier?.label === "string" && tier.label.trim()
              ? tier.label.trim()
              : `${Number(tier?.includedStorageGb || 100)}GB storage`,
          monthlyPriceGbp: Number(tier?.monthlyPriceGbp || 0),
          includedStorageGb: Number(tier?.includedStorageGb || 0),
          stripePriceId:
            typeof tier?.stripePriceId === "string"
              ? tier.stripePriceId.trim()
              : "",
        }))
        .filter((tier) => tier.id && tier.stripePriceId)
    : [];

  return cleanTiers;
}

async function getDocumentVaultTier(tierId) {
  const { rows } = await query(
    `
      SELECT value
      FROM platform_settings
      WHERE key = 'document_vault'
      LIMIT 1
    `,
  );
  const settings = rows[0]?.value || {};
  if (settings.enabled === false) return null;
  const tiers = normaliseDocumentVaultTiers(settings.tiers);
  return tiers.find((tier) => tier.id === tierId) || null;
}

subscriptionsRouter.get(
  "/",
  requireRole("owner"),
  asyncHandler(async (req, res) => {
    const { rows } = await query(
      `
        SELECT
          family_id AS "familyId",
          stripe_customer_id AS "stripeCustomerId",
          stripe_subscription_id AS "stripeSubscriptionId",
          status,
          COALESCE(billing_status, status, 'none') AS "billingStatus",
          COALESCE(access_status, 'legacy') AS "accessStatus",
          COALESCE(manual_access_override, 'none') AS "manualAccessOverride",
          plan,
          trial_started_at AS "trialStartedAt",
          trial_ends_at AS "trialEndsAt",
          access_paused_at AS "accessPausedAt",
          current_period_end AS "currentPeriodEnd",
          cancel_at_period_end AS "cancelAtPeriodEnd",
          stripe_synced_at AS "stripeSyncedAt",
          stripe_promotion_code_id AS "stripePromotionCodeId",
          stripe_promotion_code AS "stripePromotionCode",
          stripe_coupon_id AS "stripeCouponId",
          stripe_coupon_name AS "stripeCouponName",
          stripe_discount_percent_off AS "stripeDiscountPercentOff",
          stripe_discount_amount_off AS "stripeDiscountAmountOff",
          stripe_discount_currency AS "stripeDiscountCurrency"
        FROM subscriptions
        WHERE family_id = $1
        LIMIT 1
      `,
      [req.familyMember.family_id],
    );

    const subscription = rows[0] || {
      familyId: req.familyMember.family_id,
      status: "incomplete",
      plan: "family",
    };
    const [settings, familyVault, usage] = await Promise.all([
      query(
        `
          SELECT value
          FROM platform_settings
          WHERE key = 'document_vault'
          LIMIT 1
        `,
      ),
      query(
        `
          SELECT document_vault_override AS "documentVaultOverride"
          FROM families
          WHERE id = $1
          LIMIT 1
        `,
        [req.familyMember.family_id],
      ),
      query(
        `
          SELECT
            count(id)::int AS "documentCount",
            COALESCE(sum(file_size_bytes), 0)::bigint AS "totalBytes"
          FROM family_documents
          WHERE family_id = $1
            AND deleted_at IS NULL
        `,
        [req.familyMember.family_id],
      ),
    ]);
    const documentVaultSettings = settings.rows[0]?.value || {};

    res.json({
      data: {
        ...subscription,
        documentVault: {
          settings: {
            enabled: documentVaultSettings.enabled !== false,
            tiers: normaliseDocumentVaultTiers(documentVaultSettings.tiers),
            notes: documentVaultSettings.notes || "",
          },
          override: familyVault.rows[0]?.documentVaultOverride || {
            status: "default",
          },
          usage: {
            documentCount: Number(usage.rows[0]?.documentCount || 0),
            totalBytes: Number(usage.rows[0]?.totalBytes || 0),
          },
        },
      },
      error: null,
    });
  }),
);

subscriptionsRouter.post(
  "/checkout",
  requireRole("owner"),
  asyncHandler(async (req, res) => {
    const requestedPromotionCode = normalisePromotionCode(
      req.body?.promotionCode || "",
    );
    let promotionCode = null;

    if (requestedPromotionCode) {
      promotionCode = await findActiveStripePromotionCode(requestedPromotionCode);
      if (!promotionCode) {
        res.status(400).json({
          data: null,
          error: {
            code: "invalid_promotion_code",
            message: "That Stripe promotion code is not active or does not exist.",
          },
        });
        return;
      }
    }

    const { rows } = await query(
      `
        SELECT
          f.id AS "familyId",
          f.name AS "familyName",
          s.stripe_customer_id AS "stripeCustomerId"
        FROM families f
        LEFT JOIN subscriptions s ON s.family_id = f.id
        WHERE f.id = $1 AND f.deleted_at IS NULL
        LIMIT 1
      `,
      [req.familyMember.family_id],
    );

    const family = rows[0];
    let stripeCustomerId = family.stripeCustomerId;

    if (!stripeCustomerId) {
      const customer = await createStripeCustomer({
        email: req.user.email,
        name: req.user.full_name,
        familyId: family.familyId,
        familyName: family.familyName,
      });
      stripeCustomerId = customer.id;

      await query(
        `
          INSERT INTO subscriptions (
            family_id,
            stripe_customer_id,
            status,
            plan,
            billing_status,
            access_status
          )
          VALUES ($1, $2, 'incomplete', 'family', 'none', 'locked')
          ON CONFLICT (family_id)
          DO UPDATE SET stripe_customer_id = EXCLUDED.stripe_customer_id
        `,
        [family.familyId, stripeCustomerId],
      );
    }

    const session = await createStripeCheckoutSession({
      customerId: stripeCustomerId,
      familyId: family.familyId,
      familyName: family.familyName,
      promotionCodeId: promotionCode?.id || "",
      promotionCode: requestedPromotionCode,
      frontendUrl: frontendUrlFromRequest(req),
    });

    res.json({
      data: {
        checkoutUrl: session.url,
      },
      error: null,
    });
  }),
);

subscriptionsRouter.post(
  "/checkout/sync",
  requireRole("owner"),
  asyncHandler(async (req, res) => {
    const sessionId = String(req.body?.sessionId || "").trim();
    if (!sessionId || !sessionId.startsWith("cs_")) {
      throw badRequest("Stripe Checkout session ID is missing.");
    }

    const session = await retrieveStripeCheckoutSession(sessionId);
    const sessionFamilyId =
      session.client_reference_id || session.metadata?.family_id || "";

    if (sessionFamilyId !== req.familyMember.family_id) {
      throw forbidden("That Stripe Checkout session does not belong to this family.");
    }

    const subscription =
      typeof session.subscription === "string"
        ? await retrieveStripeSubscription(session.subscription)
        : session.subscription;
    if (!subscription) {
      throw badRequest("Stripe has not attached a subscription to this Checkout session yet.");
    }

    const synced = await syncSubscriptionFromStripe(
      subscription,
      req.familyMember.family_id,
    );

    const { rows } = await query(
      `
        SELECT
          family_id AS "familyId",
          stripe_customer_id AS "stripeCustomerId",
          stripe_subscription_id AS "stripeSubscriptionId",
          status,
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
      [req.familyMember.family_id],
    );

    res.json({
      data: {
        synced,
        subscription: rows[0] || null,
      },
      error: null,
    });
  }),
);

subscriptionsRouter.post(
  "/document-vault/checkout",
  requireRole("owner"),
  asyncHandler(async (req, res) => {
    const tierId = String(req.body?.tierId || "").trim();
    const tier = await getDocumentVaultTier(tierId);

    if (!tier) {
      res.status(400).json({
        data: null,
        error: {
          code: "invalid_document_vault_tier",
          message:
            "That Document Vault storage tier is not available. Check the owner pricing settings.",
        },
      });
      return;
    }

    const { rows } = await query(
      `
        SELECT
          f.id AS "familyId",
          f.name AS "familyName",
          s.stripe_customer_id AS "stripeCustomerId"
        FROM families f
        LEFT JOIN subscriptions s ON s.family_id = f.id
        WHERE f.id = $1 AND f.deleted_at IS NULL
        LIMIT 1
      `,
      [req.familyMember.family_id],
    );

    const family = rows[0];
    let stripeCustomerId = family.stripeCustomerId;

    if (!stripeCustomerId) {
      const customer = await createStripeCustomer({
        email: req.user.email,
        name: req.user.full_name,
        familyId: family.familyId,
        familyName: family.familyName,
      });
      stripeCustomerId = customer.id;

      await query(
        `
          INSERT INTO subscriptions (
            family_id,
            stripe_customer_id,
          status,
          plan,
          billing_status,
          access_status
        )
          VALUES ($1, $2, 'incomplete', 'family', 'none', 'locked')
          ON CONFLICT (family_id)
          DO UPDATE SET stripe_customer_id = EXCLUDED.stripe_customer_id
        `,
        [family.familyId, stripeCustomerId],
      );
    }

    const session = await createStripeCheckoutSession({
      customerId: stripeCustomerId,
      familyId: family.familyId,
      familyName: family.familyName,
      priceId: tier.stripePriceId,
      plan: "document_vault",
      trialPeriodDays: 0,
      successPath: "/billing/success?documentVault=success",
      cancelPath: "/billing/cancelled?documentVault=cancelled",
      metadata: {
        add_on: "document_vault",
        tier_id: tier.id,
        tier_label: tier.label,
        monthly_price_gbp: tier.monthlyPriceGbp,
        included_storage_gb: tier.includedStorageGb,
        stripe_price_id: tier.stripePriceId,
      },
      frontendUrl: frontendUrlFromRequest(req),
    });

    res.json({
      data: {
        checkoutUrl: session.url,
      },
      error: null,
    });
  }),
);

subscriptionsRouter.post(
  "/portal",
  requireRole("owner"),
  asyncHandler(async (req, res) => {
    const { rows } = await query(
      `
        SELECT stripe_customer_id AS "stripeCustomerId"
        FROM subscriptions
        WHERE family_id = $1
        LIMIT 1
      `,
      [req.familyMember.family_id],
    );

    const stripeCustomerId = rows[0]?.stripeCustomerId;

    if (!stripeCustomerId) {
      res.status(400).json({
        data: null,
        error: {
          code: "billing_not_started",
          message: "Start a subscription before opening the billing portal.",
        },
      });
      return;
    }

    const session = await createStripeBillingPortalSession(
      stripeCustomerId,
      frontendUrlFromRequest(req),
    );

    res.json({
      data: {
        portalUrl: session.url,
      },
      error: null,
    });
  }),
);

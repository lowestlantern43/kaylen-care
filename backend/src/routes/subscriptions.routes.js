import { Router } from "express";
import { query } from "../db/pool.js";
import { requireAuth } from "../middleware/auth.js";
import { requireFamilyMember, requireRole } from "../middleware/familyAccess.js";
import {
  createStripeBillingPortalSession,
  createStripeCheckoutSession,
  createStripeCustomer,
  extractStripeDiscountInfo,
  findActiveStripePromotionCode,
  listStripeCustomerSubscriptions,
  normalisePromotionCode,
} from "../services/stripe.js";
import { ensurePlanAccessSchema } from "../services/planAccess.js";
import { asyncHandler } from "../utils/asyncHandler.js";

export const subscriptionsRouter = Router({ mergeParams: true });

subscriptionsRouter.use(requireAuth, requireFamilyMember);
subscriptionsRouter.use(
  asyncHandler(async (req, res, next) => {
    await ensurePlanAccessSchema();
    next();
  }),
);

function normalisePeriodEnd(timestamp) {
  return timestamp ? new Date(timestamp * 1000).toISOString() : null;
}

function getPlanName(subscription) {
  return subscription.metadata?.plan || "family";
}

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

async function syncSubscriptionRowFromStripe(subscription, familyId) {
  const discount = extractStripeDiscountInfo(subscription);
  const promotionCode =
    discount.stripePromotionCode ||
    normalisePromotionCode(subscription.metadata?.promotion_code || "");

  const { rows } = await query(
    `
      UPDATE subscriptions
      SET
        stripe_customer_id = $1,
        stripe_subscription_id = $2,
        status = $3,
        plan = $4,
        current_period_end = $5,
        cancel_at_period_end = $6,
        stripe_promotion_code_id = $8,
        stripe_promotion_code = NULLIF($9, ''),
        stripe_coupon_id = $10,
        stripe_coupon_name = $11,
        stripe_discount_percent_off = $12,
        stripe_discount_amount_off = $13,
        stripe_discount_currency = $14
      WHERE family_id = $7
      RETURNING
        family_id AS "familyId",
        stripe_customer_id AS "stripeCustomerId",
        stripe_subscription_id AS "stripeSubscriptionId",
        status,
        plan,
        current_period_end AS "currentPeriodEnd",
        cancel_at_period_end AS "cancelAtPeriodEnd",
        stripe_promotion_code_id AS "stripePromotionCodeId",
        stripe_promotion_code AS "stripePromotionCode",
        stripe_coupon_id AS "stripeCouponId",
        stripe_coupon_name AS "stripeCouponName",
        stripe_discount_percent_off AS "stripeDiscountPercentOff",
        stripe_discount_amount_off AS "stripeDiscountAmountOff",
        stripe_discount_currency AS "stripeDiscountCurrency"
    `,
    [
      subscription.customer,
      subscription.id,
      subscription.status || "inactive",
      ["active", "trialing", "past_due"].includes(subscription.status)
        ? "family"
        : getPlanName(subscription),
      normalisePeriodEnd(subscription.current_period_end),
      Boolean(subscription.cancel_at_period_end),
      familyId,
      discount.stripePromotionCodeId,
      promotionCode,
      discount.stripeCouponId,
      discount.stripeCouponName,
      discount.stripeDiscountPercentOff,
      discount.stripeDiscountAmountOff,
      discount.stripeDiscountCurrency,
    ],
  );

  return rows[0];
}

async function syncFamilySubscriptionIfNeeded(subscriptionRow) {
  if (!subscriptionRow?.stripeCustomerId) return subscriptionRow;

  const shouldSync =
    !subscriptionRow.stripeSubscriptionId ||
    !["active", "trialing"].includes(subscriptionRow.status);

  if (!shouldSync) return subscriptionRow;

  const subscriptions = await listStripeCustomerSubscriptions(
    subscriptionRow.stripeCustomerId,
  );
  const bestMatch = subscriptions.data?.find((subscription) =>
    ["active", "trialing", "past_due", "incomplete"].includes(subscription.status),
  );

  if (!bestMatch) return subscriptionRow;

  return syncSubscriptionRowFromStripe(bestMatch, subscriptionRow.familyId);
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
          plan,
          trial_started_at AS "trialStartedAt",
          trial_ends_at AS "trialEndsAt",
          access_paused_at AS "accessPausedAt",
          current_period_end AS "currentPeriodEnd",
          cancel_at_period_end AS "cancelAtPeriodEnd",
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

    const subscription = await syncFamilySubscriptionIfNeeded(
      rows[0] || {
        familyId: req.familyMember.family_id,
        status: "trialing",
        plan: "trial",
      },
    );
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
            trial_started_at,
            trial_ends_at
          )
          VALUES ($1, $2, 'trialing', 'trial', now(), now() + interval '30 days')
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
            trial_started_at,
            trial_ends_at
          )
          VALUES ($1, $2, 'trialing', 'trial', now(), now() + interval '30 days')
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
      successPath: "?documentVault=success",
      cancelPath: "?documentVault=cancelled",
      metadata: {
        add_on: "document_vault",
        tier_id: tier.id,
        tier_label: tier.label,
        monthly_price_gbp: tier.monthlyPriceGbp,
        included_storage_gb: tier.includedStorageGb,
        stripe_price_id: tier.stripePriceId,
      },
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

    const session = await createStripeBillingPortalSession(stripeCustomerId);

    res.json({
      data: {
        portalUrl: session.url,
      },
      error: null,
    });
  }),
);

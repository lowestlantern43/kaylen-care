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

    res.json({
      data: subscription,
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

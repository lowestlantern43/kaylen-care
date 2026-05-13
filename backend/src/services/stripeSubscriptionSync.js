import { query } from "../db/pool.js";
import {
  extractStripeDiscountInfo,
  normalisePromotionCode,
} from "./stripe.js";
import { ensurePlanAccessSchema } from "./planAccess.js";

function normalisePeriodEnd(timestamp) {
  return timestamp ? new Date(timestamp * 1000).toISOString() : null;
}

function normaliseStripeTimestamp(timestamp) {
  return timestamp ? new Date(timestamp * 1000).toISOString() : null;
}

export async function syncSubscriptionFromStripe(subscription) {
  await ensurePlanAccessSchema();

  const familyId = subscription?.metadata?.family_id;
  if (!familyId) return null;

  if (subscription.metadata?.add_on === "document_vault") {
    const override = {
      status: ["active", "trialing", "past_due"].includes(subscription.status)
        ? "paid"
        : "disabled",
      tierId: subscription.metadata?.tier_id || "",
      monthlyPriceGbp: subscription.metadata?.monthly_price_gbp
        ? Number(subscription.metadata.monthly_price_gbp)
        : null,
      includedStorageGb: subscription.metadata?.included_storage_gb
        ? Number(subscription.metadata.included_storage_gb)
        : null,
      notes: `Stripe Document Vault add-on: ${
        subscription.metadata?.tier_label || subscription.metadata?.tier_id || "tier"
      }`,
    };

    await query(
      "ALTER TABLE families ADD COLUMN IF NOT EXISTS document_vault_override jsonb",
    );
    await query(
      `
        UPDATE families
        SET document_vault_override = $1
        WHERE id = $2
          AND deleted_at IS NULL
      `,
      [JSON.stringify(override), familyId],
    );
    return { familyId, status: subscription.status, plan: "document_vault" };
  }

  const status = subscription.status || "inactive";
  const plan = ["active", "trialing", "past_due"].includes(status)
    ? "family"
    : subscription.metadata?.plan || "family";
  const discount = extractStripeDiscountInfo(subscription);
  const promotionCode =
    discount.stripePromotionCode ||
    normalisePromotionCode(subscription.metadata?.promotion_code || "");

  await query(
    `
      INSERT INTO subscriptions (
        family_id,
        stripe_customer_id,
        stripe_subscription_id,
        status,
        plan,
        trial_started_at,
        trial_ends_at,
        current_period_end,
        cancel_at_period_end,
        stripe_promotion_code_id,
        stripe_promotion_code,
        stripe_coupon_id,
        stripe_coupon_name,
        stripe_discount_percent_off,
        stripe_discount_amount_off,
        stripe_discount_currency
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NULLIF($11, ''), $12, $13, $14, $15, $16)
      ON CONFLICT (family_id)
      DO UPDATE SET
        stripe_customer_id = EXCLUDED.stripe_customer_id,
        stripe_subscription_id = EXCLUDED.stripe_subscription_id,
        status = EXCLUDED.status,
        plan = EXCLUDED.plan,
        trial_started_at = EXCLUDED.trial_started_at,
        trial_ends_at = EXCLUDED.trial_ends_at,
        current_period_end = EXCLUDED.current_period_end,
        cancel_at_period_end = EXCLUDED.cancel_at_period_end,
        stripe_promotion_code_id = EXCLUDED.stripe_promotion_code_id,
        stripe_promotion_code = EXCLUDED.stripe_promotion_code,
        stripe_coupon_id = EXCLUDED.stripe_coupon_id,
        stripe_coupon_name = EXCLUDED.stripe_coupon_name,
        stripe_discount_percent_off = EXCLUDED.stripe_discount_percent_off,
        stripe_discount_amount_off = EXCLUDED.stripe_discount_amount_off,
        stripe_discount_currency = EXCLUDED.stripe_discount_currency,
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
      typeof subscription.customer === "string"
        ? subscription.customer
        : subscription.customer?.id,
      subscription.id,
      status,
      plan,
      normaliseStripeTimestamp(subscription.trial_start),
      normaliseStripeTimestamp(subscription.trial_end),
      normalisePeriodEnd(subscription.current_period_end),
      Boolean(subscription.cancel_at_period_end),
      discount.stripePromotionCodeId,
      promotionCode,
      discount.stripeCouponId,
      discount.stripeCouponName,
      discount.stripeDiscountPercentOff,
      discount.stripeDiscountAmountOff,
      discount.stripeDiscountCurrency,
    ],
  );

  return { familyId, status, plan };
}

import { config } from "../config.js";
import { query } from "../db/pool.js";
import { badRequest } from "../utils/httpError.js";

export const STRIPE_BILLING_SETTINGS_KEY = "stripe_billing";

function cleanPriceId(value = "") {
  return typeof value === "string" ? value.trim() : "";
}

export function validateStripePriceId(value = "", label = "Stripe Price ID") {
  const priceId = cleanPriceId(value);
  if (priceId && !priceId.startsWith("price_")) {
    throw badRequest(`${label} must start with price_.`);
  }
  return priceId;
}

export function normaliseStripeBillingSettings(value = {}) {
  return {
    stripeMonthlyPriceId: validateStripePriceId(
      value.stripeMonthlyPriceId,
      "Base monthly subscription Price ID",
    ),
    stripeDocuments50gbPriceId: validateStripePriceId(
      value.stripeDocuments50gbPriceId,
      "Document storage 50GB Price ID",
    ),
    stripeDocuments100gbPriceId: validateStripePriceId(
      value.stripeDocuments100gbPriceId,
      "Document storage 100GB Price ID",
    ),
  };
}

export function buildEffectiveStripeBillingSettings(saved = {}) {
  const cleanSaved = normaliseStripeBillingSettings(saved);
  const envFallbacks = {
    stripeMonthlyPriceId: config.stripePriceId || "",
    stripeDocuments50gbPriceId: config.stripeDocuments50GbPriceId || "",
    stripeDocuments100gbPriceId: config.stripeDocuments100GbPriceId || "",
  };
  const effective = {
    stripeMonthlyPriceId:
      cleanSaved.stripeMonthlyPriceId || envFallbacks.stripeMonthlyPriceId,
    stripeDocuments50gbPriceId:
      cleanSaved.stripeDocuments50gbPriceId ||
      envFallbacks.stripeDocuments50gbPriceId,
    stripeDocuments100gbPriceId:
      cleanSaved.stripeDocuments100gbPriceId ||
      envFallbacks.stripeDocuments100gbPriceId,
  };

  return {
    ...effective,
    saved: cleanSaved,
    envFallbacks,
    sources: {
      stripeMonthlyPriceId: cleanSaved.stripeMonthlyPriceId
        ? "owner"
        : envFallbacks.stripeMonthlyPriceId
          ? "env"
          : "missing",
      stripeDocuments50gbPriceId: cleanSaved.stripeDocuments50gbPriceId
        ? "owner"
        : envFallbacks.stripeDocuments50gbPriceId
          ? "env"
          : "missing",
      stripeDocuments100gbPriceId: cleanSaved.stripeDocuments100gbPriceId
        ? "owner"
        : envFallbacks.stripeDocuments100gbPriceId
          ? "env"
          : "missing",
    },
  };
}

export async function ensureStripeBillingSettings() {
  await query(
    `
      INSERT INTO platform_settings (key, value)
      VALUES ($1, $2::jsonb)
      ON CONFLICT (key) DO NOTHING
    `,
    [
      STRIPE_BILLING_SETTINGS_KEY,
      JSON.stringify({
        stripeMonthlyPriceId: "",
        stripeDocuments50gbPriceId: "",
        stripeDocuments100gbPriceId: "",
      }),
    ],
  );
}

export async function getStripeBillingSettings() {
  await ensureStripeBillingSettings();
  const { rows } = await query(
    `
      SELECT value
      FROM platform_settings
      WHERE key = $1
      LIMIT 1
    `,
    [STRIPE_BILLING_SETTINGS_KEY],
  );

  return buildEffectiveStripeBillingSettings(rows[0]?.value || {});
}


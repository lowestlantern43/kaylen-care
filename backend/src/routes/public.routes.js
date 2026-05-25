import { Router } from "express";
import { config } from "../config.js";
import { query } from "../db/pool.js";
import { asyncHandler } from "../utils/asyncHandler.js";

export const publicRouter = Router();
const PUBLIC_PRICING_VERSION = "single-plan-2026-05";

function normalisePublicPricing(value = {}) {
  const isCurrentPricing = value.pricingVersion === PUBLIC_PRICING_VERSION;

  return {
    familyMonthlyPriceGbp: isCurrentPricing && Number.isFinite(Number(value.familyMonthlyPriceGbp))
      ? Number(value.familyMonthlyPriceGbp)
      : config.familyPlanMonthlyPriceGbp,
    oneOffEventPriceGbp: Number.isFinite(Number(value.oneOffEventPriceGbp))
      ? Number(value.oneOffEventPriceGbp)
      : 0,
    promoEnabled: value.promoEnabled === true,
    promoLabel: typeof value.promoLabel === "string" ? value.promoLabel : "",
    promoCode: typeof value.promoCode === "string" ? value.promoCode : "",
    trialDays: Number.isFinite(Number(value.trialDays))
      ? Number(value.trialDays)
      : config.proTrialDays,
    pricingVersion: PUBLIC_PRICING_VERSION,
  };
}

function normaliseMarketingSettings(value = {}) {
  return {
    gaMeasurementId:
      typeof value.gaMeasurementId === "string"
        ? value.gaMeasurementId.trim()
        : "",
    googleSiteVerification:
      typeof value.googleSiteVerification === "string"
        ? value.googleSiteVerification.trim()
        : "",
  };
}

function normaliseDocumentVaultSettings(value = {}) {
  const tiers = Array.isArray(value.tiers)
    ? value.tiers
        .map((tier) => ({
          id: typeof tier?.id === "string" ? tier.id : "",
          label:
            typeof tier?.label === "string" && tier.label.trim()
              ? tier.label.trim()
              : "Document storage",
          monthlyPriceGbp: Number.isFinite(Number(tier?.monthlyPriceGbp))
            ? Number(tier.monthlyPriceGbp)
            : 0,
          includedStorageGb: Number.isFinite(Number(tier?.includedStorageGb))
            ? Number(tier.includedStorageGb)
            : 0,
        }))
        .filter((tier) => tier.label && tier.includedStorageGb > 0)
    : [];

  return {
    enabled: value.enabled !== false,
    tiers,
  };
}

async function getPlatformSetting(key) {
  try {
    const { rows } = await query(
      `
        SELECT value
        FROM platform_settings
        WHERE key = $1
        LIMIT 1
      `,
      [key],
    );
    return rows[0]?.value || {};
  } catch (error) {
    if (error.code === "42P01") return {};
    throw error;
  }
}

publicRouter.get(
  "/pricing",
  asyncHandler(async (req, res) => {
    const [publicPricing, documentVault, marketingSettings] = await Promise.all([
      getPlatformSetting("public_pricing"),
      getPlatformSetting("document_vault"),
      getPlatformSetting("marketing_settings"),
    ]);

    res.json({
      data: {
        ...normalisePublicPricing(publicPricing),
        documentVault: normaliseDocumentVaultSettings(documentVault),
        marketing: normaliseMarketingSettings(marketingSettings),
      },
      error: null,
    });
  }),
);

publicRouter.post(
  "/analytics/page-view",
  asyncHandler(async (req, res) => {
    const path =
      typeof req.body?.path === "string" && req.body.path.trim()
        ? req.body.path.trim().slice(0, 240)
        : "/";
    const title =
      typeof req.body?.title === "string" ? req.body.title.trim().slice(0, 180) : "";
    const visitorId =
      typeof req.body?.visitorId === "string"
        ? req.body.visitorId.trim().slice(0, 80)
        : "";
    const referrer =
      typeof req.body?.referrer === "string"
        ? req.body.referrer.trim().slice(0, 240)
        : "";

    try {
      await query(
        `
          INSERT INTO audit_logs (
            action,
            entity_type,
            metadata,
            ip_address,
            user_agent
          )
          VALUES ('page_view', 'page', $1, NULLIF($2, '')::inet, $3)
        `,
        [
          JSON.stringify({
            path,
            title,
            visitorId,
            referrer,
            source: "familytrack_first_party",
          }),
          req.ip || "",
          req.get("user-agent") || "",
        ],
      );
    } catch (error) {
      if (error.code !== "42P01") {
        console.error("First-party analytics page view failed.", {
          code: error.code,
          message: error.message,
        });
      }
    }

    res.json({ data: { tracked: true }, error: null });
  }),
);

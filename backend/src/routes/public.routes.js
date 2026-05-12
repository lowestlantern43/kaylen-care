import { Router } from "express";
import { config } from "../config.js";
import { query } from "../db/pool.js";
import { asyncHandler } from "../utils/asyncHandler.js";

export const publicRouter = Router();

function normalisePublicPricing(value = {}) {
  return {
    familyMonthlyPriceGbp: Number.isFinite(Number(value.familyMonthlyPriceGbp))
      ? Number(value.familyMonthlyPriceGbp)
      : config.familyPlanMonthlyPriceGbp,
    proMonthlyPriceGbp: Number.isFinite(Number(value.proMonthlyPriceGbp))
      ? Number(value.proMonthlyPriceGbp)
      : config.familyPlanMonthlyPriceGbp,
    oneOffEventPriceGbp: Number.isFinite(Number(value.oneOffEventPriceGbp))
      ? Number(value.oneOffEventPriceGbp)
      : 0,
    promoEnabled: value.promoEnabled === true,
    promoLabel: typeof value.promoLabel === "string" ? value.promoLabel : "",
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
    const [publicPricing, documentVault] = await Promise.all([
      getPlatformSetting("public_pricing"),
      getPlatformSetting("document_vault"),
    ]);

    res.json({
      data: {
        ...normalisePublicPricing(publicPricing),
        documentVault: normaliseDocumentVaultSettings(documentVault),
      },
      error: null,
    });
  }),
);

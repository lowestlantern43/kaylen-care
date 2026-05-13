import { Router } from "express";
import crypto from "node:crypto";
import { config } from "../config.js";
import { query, withTransaction } from "../db/pool.js";
import { requireAuth } from "../middleware/auth.js";
import { requirePlatformAdmin } from "../middleware/platformAdmin.js";
import { ensureIssueReportingSchema } from "../services/issueReportingSchema.js";
import {
  archivedFamilyDeletionWarningEmail,
  issueResolvedEmail,
  passwordResetEmail,
  sendAppEmail,
} from "../services/email.js";
import {
  buildPlanAccess,
  ensurePlanAccessSchema,
  normalisePlan,
  normaliseStatus,
} from "../services/planAccess.js";
import {
  listStripePaidInvoices,
  listStripeCustomerSubscriptions,
} from "../services/stripe.js";
import { syncSubscriptionFromStripe } from "../services/stripeSubscriptionSync.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { badRequest, notFound } from "../utils/httpError.js";
import { hashPassword } from "../utils/passwords.js";
import {
  optionalString,
  requireEmail,
  requireEnum,
  requirePassword,
  requireString,
  requireUuid,
} from "../validators/simple.js";

export const adminRouter = Router();

adminRouter.use(requireAuth, requirePlatformAdmin);
adminRouter.use(
  asyncHandler(async (req, res, next) => {
    await ensurePlanAccessSchema();
    await ensureChildProfileFluidTargetSchema();
    await ensureFamilyArchivePolicySchema();
    await ensureDocumentVaultBillingSchema();
    await ensurePublicPricingSettings();
    next();
  }),
);

const memberRoles = ["owner", "parent", "carer", "viewer"];
const issueStatuses = ["new", "in_progress", "resolved"];
const planValues = ["trial", "family", "beta", "professional"];
const statusValues = ["inactive", "trialing", "active", "past_due", "canceled", "cancelled", "unpaid", "incomplete", "incomplete_expired"];
const accessStatusValues = ["active", "approved", "legacy", "legacy_approved", "free", "internal", "test", "locked", "blocked"];
const PUBLIC_PRICING_VERSION = "single-plan-2026-05";

function isMissingFeedbackTable(error) {
  return error?.code === "42P01";
}

function stripeDashboardUrl(type, id) {
  if (!id) return null;
  return `https://dashboard.stripe.com/${type}/${id}`;
}

async function writeAudit(req, { familyId = null, entityType, entityId, action, metadata = {} }) {
  await query(
    `
      INSERT INTO audit_logs (family_id, user_id, action, entity_type, entity_id, metadata)
      VALUES ($1, $2, $3, $4, $5, $6)
    `,
    [familyId, req.user.id, action, entityType, entityId, JSON.stringify(metadata)],
  );
}

async function ensureChildProfileFluidTargetSchema() {
  await query(
    "ALTER TABLE child_profiles ADD COLUMN IF NOT EXISTS daily_fluid_target_ml INTEGER",
  );
}

async function ensureFamilyArchivePolicySchema() {
  await query(
    `
      ALTER TABLE families
        ADD COLUMN IF NOT EXISTS archive_delete_after timestamptz,
        ADD COLUMN IF NOT EXISTS archive_warning_14_sent_at timestamptz,
        ADD COLUMN IF NOT EXISTS archive_warning_7_sent_at timestamptz,
        ADD COLUMN IF NOT EXISTS permanently_deleted_at timestamptz
    `,
  );
}

async function ensureDocumentVaultBillingSchema() {
  await query(
    "ALTER TABLE families ADD COLUMN IF NOT EXISTS document_vault_override jsonb",
  );
  await query(
    `
      INSERT INTO platform_settings (key, value)
      VALUES (
        'document_vault',
        $1::jsonb
      )
      ON CONFLICT (key) DO NOTHING
    `,
    [
      JSON.stringify({
        enabled: true,
        tiers: [
          {
            id: "storage-50gb",
            label: "50GB Secure Document Storage",
            monthlyPriceGbp: 2,
            includedStorageGb: 50,
            stripePriceId: config.stripeDocuments50GbPriceId,
          },
          {
            id: "storage-100gb",
            label: "100GB Secure Document Storage",
            monthlyPriceGbp: 3,
            includedStorageGb: 100,
            stripePriceId: config.stripeDocuments100GbPriceId,
          },
        ],
        notes: "Secure Document Storage add-on pricing.",
      }),
    ],
  );
}

async function ensurePublicPricingSettings() {
  await query(
    `
      INSERT INTO platform_settings (key, value)
      VALUES (
        'public_pricing',
        $1::jsonb
      )
      ON CONFLICT (key) DO NOTHING
    `,
    [
      JSON.stringify({
        familyMonthlyPriceGbp: config.familyPlanMonthlyPriceGbp,
        oneOffEventPriceGbp: 0,
        promoEnabled: false,
        promoLabel: "",
        promoCode: "",
        trialDays: config.proTrialDays,
        pricingVersion: PUBLIC_PRICING_VERSION,
      }),
    ],
  );
}

function normalisePublicPricingSettings(value = {}) {
  const isCurrentPricing = value.pricingVersion === PUBLIC_PRICING_VERSION;

  return {
    familyMonthlyPriceGbp: isCurrentPricing && Number.isFinite(Number(value.familyMonthlyPriceGbp))
      ? Math.max(0, Number(value.familyMonthlyPriceGbp))
      : config.familyPlanMonthlyPriceGbp,
    oneOffEventPriceGbp: Number.isFinite(Number(value.oneOffEventPriceGbp))
      ? Math.max(0, Number(value.oneOffEventPriceGbp))
      : 0,
    promoEnabled: value.promoEnabled === true,
    promoLabel: typeof value.promoLabel === "string" ? value.promoLabel.trim() : "",
    promoCode: typeof value.promoCode === "string" ? value.promoCode.trim() : "",
    trialDays: Number.isFinite(Number(value.trialDays))
      ? Math.max(0, Number(value.trialDays))
      : config.proTrialDays,
    pricingVersion: PUBLIC_PRICING_VERSION,
  };
}

function normaliseDocumentVaultTiers(tiers = []) {
  const cleanTiers = Array.isArray(tiers)
    ? tiers
        .map((tier, index) => {
          const includedStorageGb = Number(tier?.includedStorageGb);
          const monthlyPriceGbp = Number(tier?.monthlyPriceGbp);
          const label =
            typeof tier?.label === "string" && tier.label.trim()
              ? tier.label.trim()
              : `${includedStorageGb || 100}GB storage`;
          return {
            id:
              typeof tier?.id === "string" && tier.id.trim()
                ? tier.id.trim()
                : `storage-tier-${index + 1}`,
            label,
            monthlyPriceGbp: Number.isFinite(monthlyPriceGbp)
              ? Math.max(0, monthlyPriceGbp)
              : 2,
            includedStorageGb: Number.isFinite(includedStorageGb)
              ? Math.max(0, includedStorageGb)
              : 100,
            stripePriceId:
              typeof tier?.stripePriceId === "string"
                ? tier.stripePriceId.trim()
                : "",
          };
        })
        .filter((tier) => tier.includedStorageGb > 0 || tier.monthlyPriceGbp > 0)
    : [];

  return cleanTiers.length
    ? cleanTiers
    : [
        {
          id: "storage-100gb",
          label: "100GB Secure Document Storage",
          monthlyPriceGbp: 3,
          includedStorageGb: 100,
          stripePriceId: config.stripeDocuments100GbPriceId,
        },
      ];
}

function normaliseDocumentVaultSettings(value = {}) {
  const tiers = normaliseDocumentVaultTiers(value.tiers);
  const fallbackTier = tiers[0];
  return {
    enabled: value.enabled !== false,
    tiers,
    monthlyPriceGbp: Number.isFinite(Number(value.monthlyPriceGbp))
      ? Number(value.monthlyPriceGbp)
      : fallbackTier.monthlyPriceGbp,
    includedStorageGb: Number.isFinite(Number(value.includedStorageGb))
      ? Number(value.includedStorageGb)
      : fallbackTier.includedStorageGb,
    notes:
      typeof value.notes === "string"
        ? value.notes
        : "Secure Document Storage add-on pricing.",
  };
}

function normaliseDocumentVaultOverride(value = {}) {
  const status = ["default", "included", "paid", "disabled"].includes(
    value.status,
  )
    ? value.status
    : "default";
  return {
    status,
    monthlyPriceGbp:
      value.monthlyPriceGbp === null || value.monthlyPriceGbp === ""
        ? null
        : Number.isFinite(Number(value.monthlyPriceGbp))
          ? Number(value.monthlyPriceGbp)
          : null,
    includedStorageGb:
      value.includedStorageGb === null || value.includedStorageGb === ""
        ? null
        : Number.isFinite(Number(value.includedStorageGb))
          ? Number(value.includedStorageGb)
          : null,
    tierId:
      typeof value.tierId === "string" && value.tierId.trim()
        ? value.tierId.trim()
        : "",
    notes: typeof value.notes === "string" ? value.notes : "",
  };
}

function buildEffectiveDocumentVaultAccess(settings, override) {
  const cleanSettings = normaliseDocumentVaultSettings(settings);
  const cleanOverride = normaliseDocumentVaultOverride(override);
  const isDefault = cleanOverride.status === "default";
  const selectedTier =
    cleanSettings.tiers.find((tier) => tier.id === cleanOverride.tierId) ||
    cleanSettings.tiers[0];

  return {
    enabled:
      cleanOverride.status === "disabled"
        ? false
        : isDefault
          ? cleanSettings.enabled
          : true,
    status: cleanOverride.status,
    monthlyPriceGbp:
      cleanOverride.monthlyPriceGbp !== null
        ? cleanOverride.monthlyPriceGbp
        : selectedTier.monthlyPriceGbp,
    includedStorageGb:
      cleanOverride.includedStorageGb !== null
        ? cleanOverride.includedStorageGb
        : selectedTier.includedStorageGb,
    stripePriceId: selectedTier.stripePriceId || "",
    tierId: isDefault ? "" : selectedTier.id,
    tierLabel: isDefault ? "Default tier" : selectedTier.label,
    billingLabel:
      cleanOverride.status === "included"
        ? "Included / comped"
        : cleanOverride.status === "paid"
          ? "Paid add-on"
          : cleanOverride.status === "disabled"
            ? "Disabled"
            : "Default pricing",
  };
}

async function getDocumentVaultSettings() {
  const { rows } = await query(
    `
      SELECT value
      FROM platform_settings
      WHERE key = 'document_vault'
      LIMIT 1
    `,
  );

  return normaliseDocumentVaultSettings(rows[0]?.value || {});
}

async function getPublicPricingSettings() {
  const { rows } = await query(
    `
      SELECT value
      FROM platform_settings
      WHERE key = 'public_pricing'
      LIMIT 1
    `,
  );

  return normalisePublicPricingSettings(rows[0]?.value || {});
}

async function getFeedbackSettings() {
  let rows = [];

  try {
    await ensureIssueReportingSchema();
    const result = await query(
      `
        SELECT value
        FROM platform_settings
        WHERE key = 'feedback'
        LIMIT 1
      `,
    );
    rows = result.rows;
  } catch (error) {
    if (isMissingFeedbackTable(error)) {
      return {
        enabled: false,
        setupRequired: true,
      };
    }
    throw error;
  }

  return {
    enabled: rows[0]?.value?.enabled !== false,
    setupRequired: false,
  };
}

async function syncFamilySubscriptionFromStripe(familyId) {
  const { rows } = await query(
    `
      SELECT stripe_customer_id AS "stripeCustomerId"
      FROM subscriptions
      WHERE family_id = $1
      LIMIT 1
    `,
    [familyId],
  );

  const stripeCustomerId = rows[0]?.stripeCustomerId;
  if (!stripeCustomerId) {
    return null;
  }

  const subscriptions = await listStripeCustomerSubscriptions(stripeCustomerId);
  const candidateSubscriptions = (subscriptions.data || []).filter(
    (item) =>
      item.metadata?.add_on !== "document_vault" &&
      ["active", "trialing", "past_due", "incomplete", "canceled", "unpaid"].includes(
        item.status,
      ),
  );
  const statusPriority = {
    trialing: 0,
    active: 1,
    past_due: 2,
    incomplete: 3,
    unpaid: 4,
    canceled: 5,
  };
  const subscription = candidateSubscriptions.sort((a, b) => {
    const priorityA = statusPriority[a.status] ?? 99;
    const priorityB = statusPriority[b.status] ?? 99;
    if (priorityA !== priorityB) return priorityA - priorityB;
    return Number(b.created || 0) - Number(a.created || 0);
  })[0];

  if (!subscription) {
    return null;
  }

  await syncSubscriptionFromStripe(subscription, familyId);

  const updated = await query(
    `
      SELECT
        family_id AS "familyId",
        stripe_customer_id AS "stripeCustomerId",
        stripe_subscription_id AS "stripeSubscriptionId",
        status,
        billing_status AS "billingStatus",
        access_status AS "accessStatus",
        manual_access_override AS "manualAccessOverride",
        plan,
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
    [familyId],
  );

  return updated.rows[0];
}

function amountToMajorUnits(amount, currency = "gbp") {
  const zeroDecimalCurrencies = new Set(["bif", "clp", "djf", "gnf", "jpy", "kmf", "krw", "mga", "pyg", "rwf", "ugx", "vnd", "vuv", "xaf", "xof", "xpf"]);
  const divisor = zeroDecimalCurrencies.has(String(currency).toLowerCase()) ? 1 : 100;
  return Number(amount || 0) / divisor;
}

function getInvoiceDiscountTotal(invoice) {
  if (Array.isArray(invoice.total_discount_amounts) && invoice.total_discount_amounts.length) {
    return invoice.total_discount_amounts.reduce(
      (sum, item) => sum + Number(item.amount || 0),
      0,
    );
  }
  return Math.max(0, Number(invoice.subtotal || 0) - Number(invoice.total || 0));
}

async function buildRevenueSummaryFromStripe() {
  const fallback = {
    currency: "GBP",
    source: config.stripeSecretKey ? "stripe_unavailable" : "not_configured",
    activePaidFamilies: 0,
    estimatedMrrGbp: 0,
    grossPaidGbp: 0,
    discountGbp: 0,
    netPaidGbp: 0,
    recentPayments: [],
  };

  if (!config.stripeSecretKey) return fallback;

  try {
    const [{ data: invoices = [] }, { rows: subscriptions }] = await Promise.all([
      listStripePaidInvoices({ limit: 100 }),
      query(
        `
          SELECT
            s.family_id AS "familyId",
            s.stripe_customer_id AS "stripeCustomerId",
            s.stripe_subscription_id AS "stripeSubscriptionId",
            f.name AS "familyName"
          FROM subscriptions s
          INNER JOIN families f ON f.id = s.family_id
          WHERE f.deleted_at IS NULL
        `,
      ),
    ]);

    const familyByCustomer = new Map();
    const familyBySubscription = new Map();
    subscriptions.forEach((subscription) => {
      if (subscription.stripeCustomerId) {
        familyByCustomer.set(subscription.stripeCustomerId, subscription);
      }
      if (subscription.stripeSubscriptionId) {
        familyBySubscription.set(subscription.stripeSubscriptionId, subscription);
      }
    });

    const now = Date.now();
    const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;
    const paidInLast30Days = invoices.filter((invoice) => {
      const paidAt = Number(invoice.status_transitions?.paid_at || invoice.created || 0) * 1000;
      return paidAt >= thirtyDaysAgo;
    });

    const totals = paidInLast30Days.reduce(
      (sum, invoice) => {
        const currency = invoice.currency || "gbp";
        sum.gross += amountToMajorUnits(invoice.subtotal || invoice.amount_due, currency);
        sum.discount += amountToMajorUnits(getInvoiceDiscountTotal(invoice), currency);
        sum.net += amountToMajorUnits(invoice.amount_paid || invoice.total, currency);
        return sum;
      },
      { gross: 0, discount: 0, net: 0 },
    );

    const activePaidFamilies = new Set(
      paidInLast30Days
        .map((invoice) => {
          const customerId =
            typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id;
          const subscriptionId =
            typeof invoice.subscription === "string"
              ? invoice.subscription
              : invoice.subscription?.id;
          return (
            familyByCustomer.get(customerId)?.familyId ||
            familyBySubscription.get(subscriptionId)?.familyId ||
            invoice.metadata?.family_id ||
            null
          );
        })
        .filter(Boolean),
    ).size;

    const recentPayments = invoices.slice(0, 10).map((invoice) => {
      const currency = (invoice.currency || "gbp").toUpperCase();
      const customerId =
        typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id;
      const subscriptionId =
        typeof invoice.subscription === "string"
          ? invoice.subscription
          : invoice.subscription?.id;
      const matchedFamily =
        familyByCustomer.get(customerId) || familyBySubscription.get(subscriptionId);
      const firstLine = invoice.lines?.data?.[0];
      const product = firstLine?.price?.product;
      const productName =
        typeof product === "object"
          ? product.name
          : firstLine?.description || firstLine?.price?.nickname || "Subscription";

      return {
        id: invoice.id,
        familyId: matchedFamily?.familyId || invoice.metadata?.family_id || null,
        familyName:
          matchedFamily?.familyName ||
          invoice.customer_name ||
          invoice.customer_email ||
          "Stripe customer",
        customerId,
        subscriptionId,
        productName,
        currency,
        gross: amountToMajorUnits(invoice.subtotal || invoice.amount_due, invoice.currency),
        discount: amountToMajorUnits(getInvoiceDiscountTotal(invoice), invoice.currency),
        net: amountToMajorUnits(invoice.amount_paid || invoice.total, invoice.currency),
        paidAt: new Date(
          Number(invoice.status_transitions?.paid_at || invoice.created || 0) * 1000,
        ).toISOString(),
        hostedInvoiceUrl: invoice.hosted_invoice_url || null,
      };
    });

    return {
      currency: "GBP",
      source: "stripe_paid_invoices",
      activePaidFamilies,
      estimatedMrrGbp: totals.net,
      grossPaidGbp: totals.gross,
      discountGbp: totals.discount,
      netPaidGbp: totals.net,
      recentPayments,
    };
  } catch (error) {
    console.error("Stripe revenue summary failed:", error.message);
    return fallback;
  }
}

async function listArchivedFamilies() {
  const { rows } = await query(
    `
      SELECT
        f.id,
        f.name,
        f.timezone,
        f.platform_status AS "platformStatus",
        f.platform_admin_notes AS "platformAdminNotes",
          f.created_at AS "createdAt",
          f.deleted_at AS "archivedAt",
          f.archive_delete_after AS "archiveDeleteAfter",
          f.archive_warning_14_sent_at AS "archiveWarning14SentAt",
          f.archive_warning_7_sent_at AS "archiveWarning7SentAt",
          u.full_name AS "ownerName",
        u.email AS "ownerEmail",
        COALESCE(s.status, 'inactive') AS "subscriptionStatus",
        COALESCE(s.billing_status, s.status, 'none') AS "billingStatus",
        COALESCE(s.access_status, 'legacy') AS "accessStatus",
        COALESCE(s.manual_access_override, 'none') AS "manualAccessOverride",
        COALESCE(s.plan, 'trial') AS plan,
        s.trial_ends_at AS "trialEndsAt",
        s.access_paused_at AS "accessPausedAt",
        s.access_pause_reason AS "accessPauseReason",
        (
          SELECT count(*)::int
          FROM family_members fm
          WHERE fm.family_id = f.id
        ) AS "memberCount",
        (
          SELECT count(*)::int
          FROM children c
          WHERE c.family_id = f.id
            AND c.deleted_at IS NULL
        ) AS "childCount",
        (
          SELECT count(*)::int
          FROM care_logs cl
          WHERE cl.family_id = f.id
            AND cl.deleted_at IS NULL
        ) AS "logCount",
        (
          SELECT max(cl.created_at)
          FROM care_logs cl
          WHERE cl.family_id = f.id
            AND cl.deleted_at IS NULL
        ) AS "lastActivityAt"
      FROM families f
      LEFT JOIN users u ON u.id = f.created_by_user_id
      LEFT JOIN subscriptions s ON s.family_id = f.id
        WHERE f.deleted_at IS NOT NULL
          AND f.permanently_deleted_at IS NULL
      ORDER BY f.deleted_at DESC
      LIMIT 100
    `,
  );

  return rows.map((row) => ({ ...row, access: buildPlanAccess(row) }));
}

async function buildNeedsAttentionSummary() {
  const [
    inactiveFamilies,
    childrenMissingFluidTargets,
    requiredMedicationsMissingSchedules,
    trialsEndingSoon,
    accountsNeverLoggedIn,
  ] = await Promise.all([
    query(
      `
        SELECT
          f.id AS "familyId",
          f.name AS "familyName",
          max(cl.created_at) AS "lastActivityAt"
        FROM families f
        LEFT JOIN care_logs cl ON cl.family_id = f.id AND cl.deleted_at IS NULL
        WHERE f.deleted_at IS NULL
        GROUP BY f.id, f.name
        HAVING max(cl.created_at) IS NULL
          OR max(cl.created_at) < now() - interval '14 days'
        ORDER BY max(cl.created_at) ASC NULLS FIRST, f.created_at DESC
        LIMIT 10
      `,
    ),
    query(
      `
        SELECT
          f.id AS "familyId",
          f.name AS "familyName",
          count(DISTINCT c.id)::int AS count
        FROM families f
        INNER JOIN children c ON c.family_id = f.id AND c.deleted_at IS NULL
        LEFT JOIN child_profiles cp ON cp.child_id = c.id
        WHERE f.deleted_at IS NULL
          AND (cp.daily_fluid_target_ml IS NULL OR cp.daily_fluid_target_ml <= 0)
        GROUP BY f.id, f.name
        ORDER BY count(DISTINCT c.id) DESC, f.name ASC
        LIMIT 10
      `,
    ),
    query(
      `
        SELECT
          f.id AS "familyId",
          f.name AS "familyName",
          count(DISTINCT cp.child_id)::int AS count
        FROM child_profiles cp
        INNER JOIN families f ON f.id = cp.family_id AND f.deleted_at IS NULL
        INNER JOIN children c ON c.id = cp.child_id AND c.deleted_at IS NULL
        WHERE cp.current_medications ILIKE '%required%'
          AND cp.current_medications !~* '(morning|afternoon|evening|[0-2]?[0-9]:[0-5][0-9])'
        GROUP BY f.id, f.name
        ORDER BY count(DISTINCT cp.child_id) DESC, f.name ASC
        LIMIT 10
      `,
    ),
    query(
      `
        SELECT
          f.id AS "familyId",
          f.name AS "familyName",
          s.trial_ends_at AS "trialEndsAt"
        FROM subscriptions s
        INNER JOIN families f ON f.id = s.family_id AND f.deleted_at IS NULL
        WHERE s.trial_ends_at IS NOT NULL
          AND s.trial_ends_at >= now()
          AND s.trial_ends_at <= now() + interval '7 days'
          AND COALESCE(s.status, 'trialing') IN ('trialing', 'inactive')
        ORDER BY s.trial_ends_at ASC
        LIMIT 10
      `,
    ),
    query(
      `
        SELECT
          u.id AS "userId",
          u.full_name AS "fullName",
          u.email,
          min(f.id::text)::uuid AS "familyId",
          min(f.name) AS "familyName"
        FROM users u
        LEFT JOIN family_members fm ON fm.user_id = u.id AND fm.deleted_at IS NULL
        LEFT JOIN families f ON f.id = fm.family_id AND f.deleted_at IS NULL
        WHERE u.deleted_at IS NULL
          AND u.last_login_at IS NULL
          AND NOT EXISTS (
            SELECT 1
            FROM care_logs cl
            WHERE cl.created_by_user_id = u.id
              AND cl.deleted_at IS NULL
            LIMIT 1
          )
        GROUP BY u.id, u.full_name, u.email
        ORDER BY u.created_at DESC
        LIMIT 10
      `,
    ),
  ]);

  let unresolvedIssues = [];
  try {
    const result = await query(
      `
        SELECT
          ir.id AS "issueId",
          ir.family_id AS "familyId",
          f.name AS "familyName",
          ir.message,
          ir.created_at AS "createdAt"
        FROM issue_reports ir
        LEFT JOIN families f ON f.id = ir.family_id
        WHERE COALESCE(ir.resolved, false) = false
          AND COALESCE(ir.status, 'new') <> 'resolved'
        ORDER BY ir.created_at DESC
        LIMIT 10
      `,
    );
    unresolvedIssues = result.rows;
  } catch (error) {
    if (!isMissingFeedbackTable(error)) {
      throw error;
    }
  }

  return {
    inactiveFamilies: inactiveFamilies.rows,
    childrenMissingFluidTargets: childrenMissingFluidTargets.rows,
    requiredMedicationsMissingSchedules: requiredMedicationsMissingSchedules.rows,
    unresolvedIssues,
    trialsEndingSoon: trialsEndingSoon.rows,
    accountsNeverLoggedIn: accountsNeverLoggedIn.rows,
  };
}

async function buildDocumentStorageSummary() {
  const settings = await getDocumentVaultSettings();
  const emptySummary = {
    totalBytes: 0,
    documentCount: 0,
    familyCount: 0,
    largestFamilyBytes: 0,
    families: [],
    setupRequired: false,
    settings,
  };

  try {
    const [totals, families] = await Promise.all([
      query(
        `
          SELECT
            COALESCE(sum(d.file_size_bytes), 0)::bigint AS "totalBytes",
            count(d.id)::int AS "documentCount",
            count(DISTINCT d.family_id)::int AS "familyCount"
          FROM family_documents d
          INNER JOIN families f ON f.id = d.family_id
          WHERE d.deleted_at IS NULL
            AND f.deleted_at IS NULL
        `,
      ),
      query(
        `
          SELECT
            f.id AS "familyId",
            f.name AS "familyName",
            u.full_name AS "ownerName",
            u.email AS "ownerEmail",
            f.document_vault_override AS "documentVaultOverride",
            count(d.id)::int AS "documentCount",
            COALESCE(sum(d.file_size_bytes), 0)::bigint AS "totalBytes",
            COALESCE(max(d.file_size_bytes), 0)::int AS "largestDocumentBytes",
            max(d.created_at) AS "lastUploadedAt"
          FROM family_documents d
          INNER JOIN families f ON f.id = d.family_id
          LEFT JOIN users u ON u.id = f.created_by_user_id
          WHERE d.deleted_at IS NULL
            AND f.deleted_at IS NULL
          GROUP BY f.id, f.name, u.full_name, u.email, f.document_vault_override
          ORDER BY COALESCE(sum(d.file_size_bytes), 0) DESC, max(d.created_at) DESC
          LIMIT 50
        `,
      ),
    ]);

    const familyRows = families.rows.map((row) => ({
      ...row,
      totalBytes: Number(row.totalBytes || 0),
      documentCount: Number(row.documentCount || 0),
      largestDocumentBytes: Number(row.largestDocumentBytes || 0),
      documentVaultOverride: normaliseDocumentVaultOverride(
        row.documentVaultOverride || {},
      ),
      documentVaultEffective: buildEffectiveDocumentVaultAccess(
        settings,
        row.documentVaultOverride || {},
      ),
    }));

    return {
      totalBytes: Number(totals.rows[0]?.totalBytes || 0),
      documentCount: Number(totals.rows[0]?.documentCount || 0),
      familyCount: Number(totals.rows[0]?.familyCount || 0),
      largestFamilyBytes: familyRows[0]?.totalBytes || 0,
      families: familyRows,
      setupRequired: false,
      settings,
    };
  } catch (error) {
    if (
      error.code === "42P01" ||
      error.message?.includes("family_documents")
    ) {
      return { ...emptySummary, setupRequired: true };
    }

    throw error;
  }
}

adminRouter.get(
  "/overview",
  asyncHandler(async (req, res) => {
    const [
      families,
      users,
      children,
      logs,
      subscriptions,
      revenue,
      planBreakdown,
      logsToday,
      logsThisWeek,
      activeUsersLast7Days,
      newAccountsThisWeek,
      needsAttention,
      recentActivity,
      storageUsage,
      publicPricing,
    ] = await Promise.all([
      query("SELECT count(*)::int AS count FROM families WHERE deleted_at IS NULL"),
      query("SELECT count(*)::int AS count FROM users WHERE deleted_at IS NULL"),
      query(`
        SELECT count(*)::int AS count
        FROM (
          SELECT DISTINCT
            family_id,
            lower(trim(first_name)) AS first_name_key,
            lower(trim(COALESCE(last_name, ''))) AS last_name_key
          FROM children
          WHERE deleted_at IS NULL
        ) canonical_children
      `),
      query("SELECT count(*)::int AS count FROM care_logs WHERE deleted_at IS NULL"),
      query(
        `
          SELECT
            count(*) FILTER (WHERE status IN ('active', 'trialing') OR plan = 'beta')::int AS active,
            count(*) FILTER (WHERE status NOT IN ('active', 'trialing') AND plan <> 'beta')::int AS inactive
          FROM subscriptions
          WHERE family_id IN (SELECT id FROM families WHERE deleted_at IS NULL)
        `,
      ),
      buildRevenueSummaryFromStripe(),
      query(
        `
          SELECT
            COALESCE(plan, 'trial') AS plan,
            COALESCE(status, 'inactive') AS status,
            count(*)::int AS count
          FROM subscriptions
          WHERE family_id IN (SELECT id FROM families WHERE deleted_at IS NULL)
          GROUP BY COALESCE(plan, 'trial'), COALESCE(status, 'inactive')
          ORDER BY plan ASC, status ASC
        `,
      ),
      query(
        `
          SELECT count(*)::int AS count
          FROM care_logs
          WHERE deleted_at IS NULL
            AND created_at >= date_trunc('day', now())
        `,
      ),
      query(
        `
          SELECT count(*)::int AS count
          FROM care_logs
          WHERE deleted_at IS NULL
            AND created_at >= now() - interval '7 days'
        `,
      ),
      query(
        `
          SELECT count(*)::int AS count
          FROM users u
          WHERE u.deleted_at IS NULL
            AND COALESCE(
              u.last_login_at,
              (
                SELECT max(cl.created_at)
                FROM care_logs cl
                WHERE cl.created_by_user_id = u.id
                  AND cl.deleted_at IS NULL
              )
            ) >= now() - interval '7 days'
        `,
      ),
      query(
        `
          SELECT count(*)::int AS count
          FROM users
          WHERE deleted_at IS NULL
            AND created_at >= now() - interval '7 days'
        `,
      ),
      buildNeedsAttentionSummary(),
      query(
        `
          SELECT
            al.id,
            al.action,
            al.entity_type AS "entityType",
            al.entity_id AS "entityId",
            al.family_id AS "familyId",
            f.name AS "familyName",
            al.created_at AS "createdAt",
            u.full_name AS "adminName",
            u.email AS "adminEmail"
          FROM audit_logs al
          LEFT JOIN families f ON f.id = al.family_id
          LEFT JOIN users u ON u.id = al.user_id
          ORDER BY al.created_at DESC
          LIMIT 12
        `,
      ),
      buildDocumentStorageSummary(),
      getPublicPricingSettings(),
    ]);

    res.json({
      data: {
        families: families.rows[0].count,
        users: users.rows[0].count,
        children: children.rows[0].count,
        careLogs: logs.rows[0].count,
        activeSubscriptions: subscriptions.rows[0].active,
        inactiveSubscriptions: subscriptions.rows[0].inactive,
        revenue: {
          ...revenue,
          planBreakdown: planBreakdown.rows,
        },
        logsToday: logsToday.rows[0].count,
        logsThisWeek: logsThisWeek.rows[0].count,
        activeUsersLast7Days: activeUsersLast7Days.rows[0].count,
        newAccountsThisWeek: newAccountsThisWeek.rows[0].count,
        needsAttention,
        recentActivity: recentActivity.rows,
        storageUsage,
        publicPricing,
        stripeSetup: {
          hasSecretKey: Boolean(config.stripeSecretKey),
          hasWebhookSecret: Boolean(config.stripeWebhookSecret),
          hasPriceId: Boolean(config.stripePriceId),
          hasDocuments50GbPriceId: Boolean(config.stripeDocuments50GbPriceId),
          hasDocuments100GbPriceId: Boolean(config.stripeDocuments100GbPriceId),
          priceId: config.stripePriceId || null,
          priceEnv: "STRIPE_MAIN_PRICE_ID",
          documentPriceEnvs: [
            "STRIPE_DOCUMENTS_50GB_PRICE_ID",
            "STRIPE_DOCUMENTS_100GB_PRICE_ID",
          ],
          trialDays: config.proTrialDays,
          checkoutRoute: "/api/families/:familyId/subscription/checkout",
          webhookRoute: "/api/stripe/webhook",
          configFile: "backend/.env",
        },
      },
      error: null,
    });
  }),
);

adminRouter.get(
  "/feedback-settings",
  asyncHandler(async (req, res) => {
    res.json({ data: await getFeedbackSettings(), error: null });
  }),
);

adminRouter.patch(
  "/feedback-settings",
  asyncHandler(async (req, res) => {
    const enabled = Boolean(req.body?.enabled);

    let rows = [];

    try {
      await ensureIssueReportingSchema();
      const result = await query(
        `
          INSERT INTO platform_settings (key, value, updated_at, updated_by_user_id)
          VALUES ('feedback', $1, now(), $2)
          ON CONFLICT (key)
          DO UPDATE SET
            value = EXCLUDED.value,
            updated_at = now(),
            updated_by_user_id = EXCLUDED.updated_by_user_id
          RETURNING value
        `,
        [JSON.stringify({ enabled }), req.user.id],
      );
      rows = result.rows;
    } catch (error) {
      if (isMissingFeedbackTable(error)) {
        throw badRequest(
          "Issue reporting tables are not installed yet. Run the database migrations.",
        );
      }
      throw error;
    }

    await writeAudit(req, {
      entityType: "platform_setting",
      entityId: null,
      action: "platform_feedback_setting_updated",
      metadata: { enabled },
    });

    res.json({
      data: {
        enabled: rows[0]?.value?.enabled !== false,
        setupRequired: false,
      },
      error: null,
    });
  }),
);

adminRouter.patch(
  "/public-pricing",
  asyncHandler(async (req, res) => {
    const value = normalisePublicPricingSettings({
      familyMonthlyPriceGbp: req.body?.familyMonthlyPriceGbp,
      oneOffEventPriceGbp: req.body?.oneOffEventPriceGbp,
      promoEnabled: Boolean(req.body?.promoEnabled),
      promoLabel: optionalString(req.body, "promoLabel"),
      promoCode: optionalString(req.body, "promoCode"),
      trialDays: req.body?.trialDays,
    });

    const { rows } = await query(
      `
        INSERT INTO platform_settings (key, value, updated_at, updated_by_user_id)
        VALUES ('public_pricing', $1, now(), $2)
        ON CONFLICT (key)
        DO UPDATE SET
          value = EXCLUDED.value,
          updated_at = now(),
          updated_by_user_id = EXCLUDED.updated_by_user_id
        RETURNING value
      `,
      [JSON.stringify(value), req.user.id],
    );

    await writeAudit(req, {
      entityType: "platform_setting",
      entityId: null,
      action: "platform_public_pricing_updated",
      metadata: value,
    });

    res.json({
      data: normalisePublicPricingSettings(rows[0]?.value || value),
      error: null,
    });
  }),
);

adminRouter.patch(
  "/document-vault-settings",
  asyncHandler(async (req, res) => {
    const tiers = normaliseDocumentVaultTiers(req.body?.tiers);
    if (!tiers.length) {
      throw badRequest("Add at least one Document Vault storage tier.");
    }
    const value = normaliseDocumentVaultSettings({
      enabled: Boolean(req.body?.enabled),
      tiers,
      notes: optionalString(req.body, "notes"),
    });

    const { rows } = await query(
      `
        INSERT INTO platform_settings (key, value, updated_at, updated_by_user_id)
        VALUES ('document_vault', $1, now(), $2)
        ON CONFLICT (key)
        DO UPDATE SET
          value = EXCLUDED.value,
          updated_at = now(),
          updated_by_user_id = EXCLUDED.updated_by_user_id
        RETURNING value
      `,
      [JSON.stringify(value), req.user.id],
    );

    await writeAudit(req, {
      entityType: "platform_setting",
      entityId: null,
      action: "platform_document_vault_settings_updated",
      metadata: value,
    });

    res.json({
      data: normaliseDocumentVaultSettings(rows[0]?.value || value),
      error: null,
    });
  }),
);

adminRouter.post(
  "/family-accounts",
  asyncHandler(async (req, res) => {
    const parentName = requireString(
      req.body,
      "parentName",
      "Parent/carer name",
    );
    const email = requireEmail(req.body);
    const childName = requireString(req.body, "childName", "Child name");
    const notes = optionalString(req.body, "notes");
    const plan = req.body?.plan
      ? requireEnum(req.body, "plan", planValues, "Plan")
      : "trial";

    const existing = await query(
      `
        SELECT id
        FROM users
        WHERE lower(email) = lower($1)
          AND deleted_at IS NULL
        LIMIT 1
      `,
      [email],
    );

    if (existing.rows[0]) {
      throw badRequest(
        "An active user already exists for that email. Add them to an existing family instead.",
      );
    }

    const temporaryPassword = crypto.randomBytes(12).toString("base64url");
    const passwordHash = await hashPassword(temporaryPassword);
    const familyName = `${childName} Family`;
    const subscriptionStatus =
      plan === "trial" ? "trialing" : plan === "beta" ? "active" : "active";
    const trialInterval =
      plan === "trial" ? `${config.proTrialDays} days` : null;

    const created = await withTransaction(async (client) => {
      const userResult = await client.query(
        `
          INSERT INTO users (
            email,
            password_hash,
            full_name,
            platform_admin_notes
          )
          VALUES ($1, $2, $3, $4)
          RETURNING
            id,
            email,
            full_name AS "fullName",
            created_at AS "createdAt"
        `,
        [
          email,
          passwordHash,
          parentName,
          notes
            ? `Owner-created test account. Notes: ${notes}`
            : "Owner-created test account.",
        ],
      );

      const user = userResult.rows[0];

      const familyResult = await client.query(
        `
          INSERT INTO families (
            name,
            created_by_user_id,
            platform_admin_notes
          )
          VALUES ($1, $2, $3)
          RETURNING id, name, created_at AS "createdAt"
        `,
        [
          familyName,
          user.id,
          notes
            ? `Created from owner platform. Notes: ${notes}`
            : "Created from owner platform.",
        ],
      );

      const family = familyResult.rows[0];

      await client.query(
        `
          INSERT INTO family_members (family_id, user_id, role, invited_by_user_id)
          VALUES ($1, $2, 'owner', $3)
        `,
        [family.id, user.id, req.user.id],
      );

      const subscriptionResult = await client.query(
        `
          INSERT INTO subscriptions (
            family_id,
            status,
            plan,
            trial_started_at,
            trial_ends_at
          )
          VALUES (
            $1,
            $2,
            $3,
            CASE WHEN $4::text IS NULL THEN NULL ELSE now() END,
            CASE WHEN $4::text IS NULL THEN NULL ELSE now() + ($4::text)::interval END
          )
          RETURNING
            family_id AS "familyId",
            status,
            plan,
            trial_started_at AS "trialStartedAt",
            trial_ends_at AS "trialEndsAt"
        `,
        [family.id, subscriptionStatus, plan, trialInterval],
      );

      const childResult = await client.query(
        `
          INSERT INTO children (family_id, first_name, created_by_user_id)
          VALUES ($1, $2, $3)
          RETURNING
            id,
            first_name AS "firstName",
            created_at AS "createdAt"
        `,
        [family.id, childName, user.id],
      );

      await client.query(
        `
          INSERT INTO audit_logs (
            family_id,
            user_id,
            action,
            entity_type,
            entity_id,
            metadata
          )
          VALUES ($1, $2, 'platform_family_account_created', 'family', $1, $3)
        `,
        [
          family.id,
          req.user.id,
          JSON.stringify({
            parentName,
            email,
            childName,
            plan,
            notes,
          }),
        ],
      );

      return {
        user,
        family,
        child: childResult.rows[0],
        subscription: subscriptionResult.rows[0],
      };
    });

    const emailResult = await sendAppEmail({
      to: created.user.email,
      subject: "Your FamilyTrack account is ready",
      text: [
        `Hi ${created.user.fullName || "there"},`,
        "",
        "A FamilyTrack test account has been created for you.",
        "",
        `Login: ${config.frontendUrl}`,
        `Email: ${created.user.email}`,
        `Temporary password: ${temporaryPassword}`,
        "",
        "Please change this password after logging in.",
        notes ? "" : null,
        notes ? `Notes from FamilyTrack: ${notes}` : null,
        "",
        `If you need help, contact ${config.supportEmail}.`,
        "",
        "FamilyTrack",
      ]
        .filter(Boolean)
        .join("\n"),
      metadata: {
        type: "owner_created_family_account",
        userId: created.user.id,
        familyId: created.family.id,
      },
    });

    res.status(201).json({
      data: {
        ...created,
        emailSent: emailResult.sent,
        emailSkipped: emailResult.skipped,
        temporaryPassword: emailResult.sent ? null : temporaryPassword,
      },
      error: null,
    });
  }),
);

adminRouter.get(
  "/issues",
  asyncHandler(async (req, res) => {
    let rows = [];

    try {
      await ensureIssueReportingSchema();
      const result = await query(
        `
          SELECT
            ir.id,
            ir.user_id AS "userId",
            u.full_name AS "userName",
            u.email AS "userEmail",
            ir.family_id AS "familyId",
            f.name AS "familyName",
            ir.child_id AS "childId",
            c.first_name AS "childFirstName",
            c.last_name AS "childLastName",
            ir.route,
            ir.message,
            ir.severity,
            ir.browser_info AS "browserInfo",
            ir.app_version AS "appVersion",
            ir.screenshot_url AS "screenshotUrl",
            ir.status,
            ir.internal_note AS "internalNote",
            ir.resolved,
            ir.resolved_at AS "resolvedAt",
            ir.notified,
            ir.context_section AS "contextSection",
            ir.device_type AS "deviceType",
            ir.created_at AS "createdAt",
            ir.updated_at AS "updatedAt"
          FROM issue_reports ir
          LEFT JOIN users u ON u.id = ir.user_id
          LEFT JOIN families f ON f.id = ir.family_id
          LEFT JOIN children c ON c.id = ir.child_id
          ORDER BY ir.created_at DESC
          LIMIT 200
        `,
      );
      rows = result.rows;
    } catch (error) {
      if (!isMissingFeedbackTable(error)) {
        throw error;
      }
    }

    res.json({ data: rows, error: null });
  }),
);

adminRouter.patch(
  "/issues/:issueId",
  asyncHandler(async (req, res) => {
    const issueId = requireUuid(req.params.issueId, "Issue ID");
    const status = requireEnum(req.body, "status", issueStatuses, "Status");
    const internalNote = optionalString(req.body, "internalNote") || "";

    let rows = [];

    try {
      await ensureIssueReportingSchema();
      const result = await query(
        `
          WITH existing AS (
            SELECT status AS previous_status
            FROM issue_reports
            WHERE id = $3
          )
          UPDATE issue_reports
          SET status = $1,
              internal_note = $2,
              resolved = ($1 = 'resolved'),
              resolved_at = CASE
                WHEN $1 = 'resolved' AND issue_reports.status <> 'resolved' THEN now()
                WHEN $1 <> 'resolved' THEN NULL
                ELSE resolved_at
              END,
              notified = CASE
                WHEN $1 = 'resolved' AND issue_reports.status <> 'resolved' THEN false
                WHEN $1 <> 'resolved' THEN true
                ELSE notified
              END,
              updated_at = now()
          FROM existing
          WHERE issue_reports.id = $3
          RETURNING
            issue_reports.id,
            issue_reports.user_id AS "userId",
            issue_reports.status,
            issue_reports.internal_note AS "internalNote",
            issue_reports.resolved,
            issue_reports.resolved_at AS "resolvedAt",
            issue_reports.notified,
            issue_reports.updated_at AS "updatedAt",
            existing.previous_status AS "previousStatus"
        `,
        [status, internalNote, issueId],
      );
      rows = result.rows;
    } catch (error) {
      if (isMissingFeedbackTable(error)) {
        throw badRequest(
          "Issue reporting tables are not installed yet. Run the database migrations.",
        );
      }
      throw error;
    }

    if (!rows[0]) {
      throw notFound("Issue report not found.");
    }

    if (
      rows[0].status === "resolved" &&
      rows[0].previousStatus !== "resolved" &&
      rows[0].userId
    ) {
      const user = await query(
        `
          SELECT email, full_name AS "fullName"
          FROM users
          WHERE id = $1
            AND deleted_at IS NULL
          LIMIT 1
        `,
        [rows[0].userId],
      );
      if (user.rows[0]?.email) {
        const email = issueResolvedEmail({
          fullName: user.rows[0].fullName,
        });
        sendAppEmail({
          to: user.rows[0].email,
          ...email,
          metadata: { type: "issue_resolved", issueId },
        }).catch((error) =>
          console.error("Issue resolved email failed:", error.message),
        );
      }
    }

    await writeAudit(req, {
      entityType: "issue_report",
      entityId: issueId,
      action: "platform_issue_status_updated",
      metadata: { status, internalNote },
    });

    res.json({ data: rows[0], error: null });
  }),
);

adminRouter.get(
  "/archived-families",
  asyncHandler(async (req, res) => {
    res.json({
      data: await listArchivedFamilies(),
      error: null,
    });
  }),
);

adminRouter.get(
  "/families",
  asyncHandler(async (req, res) => {
    const { rows } = await query(
      `
        SELECT
          f.id,
          f.name,
          f.timezone,
          f.platform_status AS "platformStatus",
          f.platform_admin_notes AS "platformAdminNotes",
          f.document_vault_override AS "documentVaultOverride",
          f.created_at AS "createdAt",
          u.full_name AS "ownerName",
          u.email AS "ownerEmail",
          COALESCE(s.status, 'inactive') AS "subscriptionStatus",
          COALESCE(s.billing_status, s.status, 'none') AS "billingStatus",
          COALESCE(s.access_status, 'legacy') AS "accessStatus",
          COALESCE(s.manual_access_override, 'none') AS "manualAccessOverride",
          COALESCE(s.plan, 'trial') AS plan,
          s.trial_ends_at AS "trialEndsAt",
          s.access_paused_at AS "accessPausedAt",
          s.access_pause_reason AS "accessPauseReason",
          max(u.last_login_at) AS "ownerLastLoginAt",
          max(member_users.last_login_at) AS "lastLoginAt",
          max(cl.created_at) AS "lastActivityAt",
          count(DISTINCT fm.id)::int AS "memberCount",
          count(
            DISTINCT concat_ws(
              '|',
              lower(trim(c.first_name)),
              lower(trim(COALESCE(c.last_name, '')))
            )
          )::int AS "childCount",
          count(DISTINCT cl.id)::int AS "logCount",
          COALESCE(
            array_agg(DISTINCT trim(concat_ws(' ', c.first_name, c.last_name)))
              FILTER (WHERE c.id IS NOT NULL),
            '{}'
          ) AS "childNames"
        FROM families f
        LEFT JOIN users u ON u.id = f.created_by_user_id
        LEFT JOIN subscriptions s ON s.family_id = f.id
        LEFT JOIN family_members fm ON fm.family_id = f.id AND fm.deleted_at IS NULL
        LEFT JOIN users member_users ON member_users.id = fm.user_id AND member_users.deleted_at IS NULL
        LEFT JOIN children c ON c.family_id = f.id AND c.deleted_at IS NULL
        LEFT JOIN care_logs cl ON cl.family_id = f.id AND cl.deleted_at IS NULL
        WHERE f.deleted_at IS NULL
        GROUP BY f.id, u.full_name, u.email, s.status, s.billing_status, s.access_status, s.manual_access_override, s.plan, s.trial_ends_at, s.access_paused_at, s.access_pause_reason
        ORDER BY f.created_at DESC
        LIMIT 100
      `,
    );

    res.json({
      data: rows.map((row) => ({ ...row, access: buildPlanAccess(row) })),
      error: null,
    });
  }),
);

adminRouter.get(
  "/families/archived",
  asyncHandler(async (req, res) => {
    res.json({
      data: await listArchivedFamilies(),
      error: null,
    });
  }),
);

adminRouter.get(
  "/families/:familyId",
  asyncHandler(async (req, res) => {
    const { familyId } = req.params;
    requireUuid(familyId, "familyId");

    const family = await query(
      `
        SELECT
          f.id,
          f.name,
          f.timezone,
          f.platform_status AS "platformStatus",
          f.platform_admin_notes AS "platformAdminNotes",
          f.document_vault_override AS "documentVaultOverride",
          f.created_at AS "createdAt",
          u.full_name AS "ownerName",
          u.email AS "ownerEmail",
          COALESCE(s.status, 'trialing') AS "subscriptionStatus",
          COALESCE(s.billing_status, s.status, 'none') AS "billingStatus",
          COALESCE(s.access_status, 'legacy') AS "accessStatus",
          COALESCE(s.manual_access_override, 'none') AS "manualAccessOverride",
          COALESCE(s.plan, 'trial') AS plan,
          s.trial_started_at AS "trialStartedAt",
          s.trial_ends_at AS "trialEndsAt",
          s.access_paused_at AS "accessPausedAt",
          s.access_pause_reason AS "accessPauseReason",
          s.current_period_end AS "currentPeriodEnd",
          s.stripe_customer_id AS "stripeCustomerId",
          s.stripe_subscription_id AS "stripeSubscriptionId",
          s.cancel_at_period_end AS "cancelAtPeriodEnd",
          s.stripe_synced_at AS "stripeSyncedAt",
          s.stripe_promotion_code AS "stripePromotionCode",
          s.stripe_coupon_id AS "stripeCouponId",
          s.stripe_coupon_name AS "stripeCouponName",
          s.stripe_discount_percent_off AS "stripeDiscountPercentOff",
          s.stripe_discount_amount_off AS "stripeDiscountAmountOff",
          s.stripe_discount_currency AS "stripeDiscountCurrency",
          (
            SELECT max(member_users.last_login_at)
            FROM family_members member_links
            INNER JOIN users member_users ON member_users.id = member_links.user_id
            WHERE member_links.family_id = f.id
              AND member_links.deleted_at IS NULL
              AND member_users.deleted_at IS NULL
          ) AS "lastLoginAt",
          (
            SELECT max(cl.created_at)
            FROM care_logs cl
            WHERE cl.family_id = f.id
              AND cl.deleted_at IS NULL
          ) AS "lastActivityAt"
        FROM families f
        LEFT JOIN users u ON u.id = f.created_by_user_id
        LEFT JOIN subscriptions s ON s.family_id = f.id
        WHERE f.id = $1
          AND f.deleted_at IS NULL
        LIMIT 1
      `,
      [familyId],
    );

    if (!family.rows[0]) {
      res.status(404).json({
        data: null,
        error: { code: "not_found", message: "Family not found." },
      });
      return;
    }

    const [members, children, recentLogs, auditLogs, documentStorage] =
      await Promise.all([
      query(
        `
          SELECT
            fm.id,
            fm.role,
            fm.joined_at AS "joinedAt",
            u.id AS "userId",
            u.full_name AS "fullName",
            u.email,
            u.created_at AS "createdAt",
            u.last_login_at AS "lastLoginAt",
            u.platform_status AS "platformStatus"
          FROM family_members fm
          INNER JOIN users u ON u.id = fm.user_id
          WHERE fm.family_id = $1
            AND fm.deleted_at IS NULL
          ORDER BY fm.joined_at ASC
        `,
        [familyId],
      ),
      query(
        `
          WITH canonical_children AS (
            SELECT DISTINCT ON (
              lower(trim(c.first_name)),
              lower(trim(COALESCE(c.last_name, '')))
            )
              c.id,
              c.first_name,
              c.last_name,
              c.date_of_birth,
              cp.daily_fluid_target_ml,
              c.created_at,
              count(*) OVER (
                PARTITION BY
                  lower(trim(c.first_name)),
                  lower(trim(COALESCE(c.last_name, '')))
              ) AS duplicate_count
            FROM children c
            LEFT JOIN child_profiles cp ON cp.child_id = c.id
            WHERE c.family_id = $1
              AND c.deleted_at IS NULL
            ORDER BY
              lower(trim(c.first_name)),
              lower(trim(COALESCE(c.last_name, ''))),
              c.created_at ASC,
              c.id ASC
          )
          SELECT
            id,
            first_name AS "firstName",
            last_name AS "lastName",
            date_of_birth::text AS "dateOfBirth",
            daily_fluid_target_ml AS "dailyFluidTargetMl",
            created_at AS "createdAt",
            duplicate_count::int AS "duplicateCount"
          FROM canonical_children
          ORDER BY created_at ASC
        `,
        [familyId],
      ),
      query(
        `
          SELECT
            cl.id,
            cl.category,
            cl.log_date::text AS "logDate",
            to_char(cl.log_time, 'HH24:MI') AS "logTime",
            cl.notes,
            cl.data,
            cl.created_at AS "createdAt",
            c.first_name AS "childFirstName",
            u.full_name AS "createdByName"
          FROM care_logs cl
          INNER JOIN children c ON c.id = cl.child_id
          INNER JOIN users u ON u.id = cl.created_by_user_id
          WHERE cl.family_id = $1
            AND cl.deleted_at IS NULL
          ORDER BY cl.created_at DESC
          LIMIT 25
        `,
        [familyId],
      ),
      query(
        `
          SELECT
            al.id,
            al.action,
            al.entity_type AS "entityType",
            al.metadata,
            al.created_at AS "createdAt",
            u.full_name AS "adminName",
            u.email AS "adminEmail"
          FROM audit_logs al
          LEFT JOIN users u ON u.id = al.user_id
          WHERE al.family_id = $1
          ORDER BY al.created_at DESC
          LIMIT 20
        `,
        [familyId],
      ),
      query(
        `
          SELECT
            count(id)::int AS "documentCount",
            COALESCE(sum(file_size_bytes), 0)::bigint AS "totalBytes",
            COALESCE(max(file_size_bytes), 0)::int AS "largestDocumentBytes",
            max(created_at) AS "lastUploadedAt"
          FROM family_documents
          WHERE family_id = $1
            AND deleted_at IS NULL
        `,
        [familyId],
      ),
    ]);

    const documentVaultSettings = await getDocumentVaultSettings();
    const documentVaultOverride = normaliseDocumentVaultOverride(
      family.rows[0].documentVaultOverride || {},
    );

    let familyIssues = [];
    try {
      const result = await query(
        `
          SELECT
            ir.id,
            ir.message,
            ir.severity,
            ir.status,
            ir.resolved,
            ir.route,
            ir.created_at AS "createdAt",
            ir.resolved_at AS "resolvedAt",
            u.full_name AS "userName",
            u.email AS "userEmail",
            c.first_name AS "childFirstName",
            c.last_name AS "childLastName"
          FROM issue_reports ir
          LEFT JOIN users u ON u.id = ir.user_id
          LEFT JOIN children c ON c.id = ir.child_id
          WHERE ir.family_id = $1
          ORDER BY ir.created_at DESC
          LIMIT 20
        `,
        [familyId],
      );
      familyIssues = result.rows;
    } catch (error) {
      if (!isMissingFeedbackTable(error)) {
        throw error;
      }
    }

    res.json({
      data: {
        family: {
          ...family.rows[0],
          access: buildPlanAccess({
            ...family.rows[0],
            childCount: children.rows.length,
            memberCount: members.rows.length,
          }),
          documentVaultOverride,
          documentVaultEffective: buildEffectiveDocumentVaultAccess(
            documentVaultSettings,
            documentVaultOverride,
          ),
          documentVaultUsage: {
            documentCount: Number(documentStorage.rows[0]?.documentCount || 0),
            totalBytes: Number(documentStorage.rows[0]?.totalBytes || 0),
            largestDocumentBytes: Number(
              documentStorage.rows[0]?.largestDocumentBytes || 0,
            ),
            lastUploadedAt: documentStorage.rows[0]?.lastUploadedAt || null,
          },
          stripeCustomerUrl: stripeDashboardUrl(
            "customers",
            family.rows[0].stripeCustomerId,
          ),
          stripeSubscriptionUrl: stripeDashboardUrl(
            "subscriptions",
            family.rows[0].stripeSubscriptionId,
          ),
        },
        members: members.rows,
        children: children.rows,
        recentLogs: recentLogs.rows,
        auditLogs: auditLogs.rows,
        issues: familyIssues,
      },
      error: null,
    });
  }),
);

adminRouter.patch(
  "/families/:familyId",
  asyncHandler(async (req, res) => {
    const familyId = requireUuid(req.params.familyId, "Family ID");
    const platformStatus = requireEnum(req.body, "platformStatus", [
      "active",
      "suspended",
      "watch",
    ]);
    const platformAdminNotes = optionalString(req.body, "platformAdminNotes");

    const { rows } = await query(
      `
        UPDATE families
        SET platform_status = $1,
            platform_admin_notes = $2
        WHERE id = $3
          AND deleted_at IS NULL
        RETURNING
          id,
          name,
          platform_status AS "platformStatus",
          platform_admin_notes AS "platformAdminNotes"
      `,
      [platformStatus, platformAdminNotes, familyId],
    );

    if (!rows[0]) {
      throw notFound("Family not found.");
    }

    await writeAudit(req, {
      familyId,
      entityType: "family",
      entityId: familyId,
      action: "platform_family_updated",
      metadata: { platformStatus, platformAdminNotes },
    });

    res.json({ data: rows[0], error: null });
  }),
);

adminRouter.patch(
  "/families/:familyId/profile",
  asyncHandler(async (req, res) => {
    const familyId = requireUuid(req.params.familyId, "Family ID");
    const name = requireString(req.body, "name", "Family name");

    const { rows } = await query(
      `
        UPDATE families
        SET name = $1
        WHERE id = $2
          AND deleted_at IS NULL
        RETURNING
          id,
          name,
          platform_status AS "platformStatus",
          platform_admin_notes AS "platformAdminNotes"
      `,
      [name, familyId],
    );

    if (!rows[0]) {
      throw notFound("Family not found.");
    }

    await writeAudit(req, {
      familyId,
      entityType: "family",
      entityId: familyId,
      action: "platform_family_name_updated",
      metadata: { name },
    });

    res.json({ data: rows[0], error: null });
  }),
);

adminRouter.patch(
  "/families/:familyId/children/:childId",
  asyncHandler(async (req, res) => {
    const familyId = requireUuid(req.params.familyId, "Family ID");
    const childId = requireUuid(req.params.childId, "Child ID");
    const firstName = requireString(req.body, "firstName", "Child name");
    const lastName = optionalString(req.body, "lastName") || "";
    const rawTarget = req.body?.dailyFluidTargetMl;
    const dailyFluidTargetMl =
      rawTarget === null || rawTarget === "" || typeof rawTarget === "undefined"
        ? null
        : Number.parseInt(rawTarget, 10);

    if (
      dailyFluidTargetMl !== null &&
      (!Number.isFinite(dailyFluidTargetMl) || dailyFluidTargetMl < 0)
    ) {
      throw badRequest("Fluid target must be a positive number.");
    }

    const rows = await withTransaction(async (client) => {
      const updatedChild = await client.query(
        `
          UPDATE children
          SET first_name = $1,
              last_name = $2
          WHERE id = $3
            AND family_id = $4
            AND deleted_at IS NULL
          RETURNING
            id,
            first_name AS "firstName",
            last_name AS "lastName",
            date_of_birth::text AS "dateOfBirth",
            created_at AS "createdAt"
        `,
        [firstName, lastName, childId, familyId],
      );

      if (!updatedChild.rows[0]) {
        return [];
      }

      const updatedProfile = await client.query(
        `
          INSERT INTO child_profiles (
            child_id,
            family_id,
            updated_by_user_id,
            daily_fluid_target_ml
          )
          VALUES ($1, $2, $3, $4)
          ON CONFLICT (child_id)
          DO UPDATE SET
            daily_fluid_target_ml = EXCLUDED.daily_fluid_target_ml,
            updated_by_user_id = EXCLUDED.updated_by_user_id
          RETURNING daily_fluid_target_ml AS "dailyFluidTargetMl"
        `,
        [childId, familyId, req.user.id, dailyFluidTargetMl],
      );

      return [
        {
          ...updatedChild.rows[0],
          dailyFluidTargetMl: updatedProfile.rows[0]?.dailyFluidTargetMl ?? null,
        },
      ];
    });

    if (!rows[0]) {
      throw notFound("Child not found.");
    }

    await writeAudit(req, {
      familyId,
      entityType: "child",
      entityId: childId,
      action: "platform_child_updated",
      metadata: {
        firstName,
        lastName,
        dailyFluidTargetMl,
      },
    });

    res.json({ data: rows[0], error: null });
  }),
);

adminRouter.patch(
  "/families/:familyId/plan",
  asyncHandler(async (req, res) => {
    const familyId = requireUuid(req.params.familyId, "Family ID");
    const plan = normalisePlan(requireEnum(req.body, "plan", planValues, "Plan"));
    const status = normaliseStatus(
      requireEnum(req.body, "status", statusValues, "Status"),
      plan,
    );
    const trialEndsAt = optionalString(req.body, "trialEndsAt");
    const accessStatus = requireEnum(
      req.body,
      "accessStatus",
      accessStatusValues,
      "Access status",
    );
    const manualAccessOverride =
      optionalString(req.body, "manualAccessOverride") ||
      (["locked", "blocked"].includes(accessStatus)
        ? "force_locked"
        : ["active", "approved"].includes(accessStatus)
          ? "force_active"
          : ["legacy", "legacy_approved", "free", "internal", "test"].includes(accessStatus)
            ? accessStatus
            : "none");
    const accessPaused = Boolean(req.body.accessPaused);
    const accessPauseReason = optionalString(req.body, "accessPauseReason") || "";

    const family = await query(
      "SELECT id FROM families WHERE id = $1 AND deleted_at IS NULL LIMIT 1",
      [familyId],
    );

    if (!family.rows[0]) {
      throw notFound("Family not found.");
    }

    const { rows } = await query(
      `
        INSERT INTO subscriptions (
          family_id,
          plan,
          status,
          billing_status,
          access_status,
          manual_access_override,
          trial_started_at,
          trial_ends_at,
          access_paused_at,
          access_pause_reason
        )
        VALUES ($1, $2, $3, $3, $4, $5, now(), $6, CASE WHEN $7 THEN now() ELSE NULL END, $8)
        ON CONFLICT (family_id)
        DO UPDATE SET
          plan = EXCLUDED.plan,
          status = EXCLUDED.status,
          billing_status = EXCLUDED.billing_status,
          access_status = EXCLUDED.access_status,
          manual_access_override = EXCLUDED.manual_access_override,
          trial_started_at = COALESCE(subscriptions.trial_started_at, EXCLUDED.trial_started_at),
          trial_ends_at = EXCLUDED.trial_ends_at,
          access_paused_at = EXCLUDED.access_paused_at,
          access_pause_reason = EXCLUDED.access_pause_reason
        RETURNING
          family_id AS "familyId",
          plan,
          status AS "subscriptionStatus",
          billing_status AS "billingStatus",
          access_status AS "accessStatus",
          manual_access_override AS "manualAccessOverride",
          trial_started_at AS "trialStartedAt",
          trial_ends_at AS "trialEndsAt",
          access_paused_at AS "accessPausedAt",
          access_pause_reason AS "accessPauseReason",
          current_period_end AS "currentPeriodEnd"
      `,
      [
        familyId,
        plan,
        status,
        accessStatus,
        manualAccessOverride,
        trialEndsAt || null,
        accessPaused,
        accessPauseReason,
      ],
    );

    await writeAudit(req, {
      familyId,
      entityType: "subscription",
      entityId: familyId,
      action: "platform_plan_updated",
      metadata: {
        plan,
        status,
        accessStatus,
        manualAccessOverride,
        trialEndsAt,
        accessPaused,
        accessPauseReason,
      },
    });

    res.json({
      data: { ...rows[0], access: buildPlanAccess(rows[0]) },
      error: null,
    });
  }),
);

adminRouter.patch(
  "/families/:familyId/document-vault",
  asyncHandler(async (req, res) => {
    const familyId = requireUuid(req.params.familyId, "Family ID");
    const status = requireEnum(
      req.body,
      "status",
      ["default", "included", "paid", "disabled"],
      "Document Vault status",
    );
    const monthlyPriceGbp =
      req.body?.monthlyPriceGbp === "" ||
      typeof req.body?.monthlyPriceGbp === "undefined"
        ? null
        : Number(req.body.monthlyPriceGbp);
    const includedStorageGb =
      req.body?.includedStorageGb === "" ||
      typeof req.body?.includedStorageGb === "undefined"
        ? null
        : Number(req.body.includedStorageGb);

    if (
      monthlyPriceGbp !== null &&
      (!Number.isFinite(monthlyPriceGbp) || monthlyPriceGbp < 0)
    ) {
      throw badRequest("Document Vault price override must be 0 or higher.");
    }

    if (
      includedStorageGb !== null &&
      (!Number.isFinite(includedStorageGb) || includedStorageGb < 0)
    ) {
      throw badRequest("Document Vault storage override must be 0GB or higher.");
    }

    const override = normaliseDocumentVaultOverride({
      status,
      tierId: optionalString(req.body, "tierId"),
      monthlyPriceGbp,
      includedStorageGb,
      notes: optionalString(req.body, "notes"),
    });

    const { rows } = await query(
      `
        UPDATE families
        SET document_vault_override = $1
        WHERE id = $2
          AND deleted_at IS NULL
        RETURNING
          id,
          document_vault_override AS "documentVaultOverride"
      `,
      [JSON.stringify(override), familyId],
    );

    if (!rows[0]) {
      throw notFound("Family not found.");
    }

    const settings = await getDocumentVaultSettings();

    await writeAudit(req, {
      familyId,
      entityType: "family",
      entityId: familyId,
      action: "platform_document_vault_override_updated",
      metadata: override,
    });

    res.json({
      data: {
        documentVaultOverride: override,
        documentVaultEffective: buildEffectiveDocumentVaultAccess(
          settings,
          override,
        ),
      },
      error: null,
    });
  }),
);

adminRouter.post(
  "/families/:familyId/sync-stripe",
  asyncHandler(async (req, res) => {
    const familyId = requireUuid(req.params.familyId, "Family ID");
    const subscription = await syncFamilySubscriptionFromStripe(familyId);

    await writeAudit(req, {
      familyId,
      entityType: "subscription",
      entityId: familyId,
      action: "platform_stripe_sync",
      metadata: { synced: Boolean(subscription), status: subscription?.status || null },
    });

    res.json({
      data: subscription || { synced: false },
      error: null,
    });
  }),
);

adminRouter.post(
  "/families/:familyId/members",
  asyncHandler(async (req, res) => {
    const familyId = requireUuid(req.params.familyId, "Family ID");
    const email = requireEmail(req.body);
    const role = requireEnum(req.body, "role", memberRoles, "Role");

    const family = await query(
      "SELECT id FROM families WHERE id = $1 AND deleted_at IS NULL LIMIT 1",
      [familyId],
    );

    if (!family.rows[0]) {
      throw notFound("Family not found.");
    }

    const user = await query(
      `
        SELECT id, full_name AS "fullName", email
        FROM users
        WHERE lower(email) = lower($1)
          AND deleted_at IS NULL
        LIMIT 1
      `,
      [email],
    );

    if (user.rows[0]) {
      const { rows } = await query(
        `
          INSERT INTO family_members (family_id, user_id, role, invited_by_user_id)
          VALUES ($1, $2, $3, $4)
          ON CONFLICT (family_id, user_id)
          WHERE deleted_at IS NULL
          DO UPDATE SET role = EXCLUDED.role
          RETURNING id, user_id AS "userId", role, joined_at AS "joinedAt"
        `,
        [familyId, user.rows[0].id, role, req.user.id],
      );

      await writeAudit(req, {
        familyId,
        entityType: "family_member",
        entityId: rows[0].id,
        action: "platform_member_added",
        metadata: { email, role, existingUser: true },
      });

      res.status(201).json({
        data: {
          type: "member",
          member: {
            ...rows[0],
            fullName: user.rows[0].fullName,
            email: user.rows[0].email,
          },
        },
        error: null,
      });
      return;
    }

    const token = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const invitation = await query(
      `
        INSERT INTO invitations (
          family_id,
          email,
          role,
          token_hash,
          invited_by_user_id,
          expires_at
        )
        VALUES ($1, $2, $3, $4, $5, now() + interval '14 days')
        RETURNING
          id,
          email,
          role,
          expires_at AS "expiresAt",
          created_at AS "createdAt"
      `,
      [familyId, email, role, tokenHash, req.user.id],
    );

    await writeAudit(req, {
      familyId,
      entityType: "invitation",
      entityId: invitation.rows[0].id,
      action: "platform_invitation_created",
      metadata: { email, role },
    });

    res.status(201).json({
      data: {
        type: "invitation",
        invitation: {
          ...invitation.rows[0],
          acceptUrl: `${config.frontendUrl}/accept-invitation?token=${token}`,
        },
      },
      error: null,
    });
  }),
);

adminRouter.patch(
  "/families/:familyId/members/:memberId",
  asyncHandler(async (req, res) => {
    const familyId = requireUuid(req.params.familyId, "Family ID");
    const memberId = requireUuid(req.params.memberId, "Member ID");
    const role = requireEnum(req.body, "role", memberRoles, "Role");

    const { rows } = await query(
      `
        UPDATE family_members
        SET role = $1
        WHERE id = $2
          AND family_id = $3
          AND deleted_at IS NULL
        RETURNING id, user_id AS "userId", role
      `,
      [role, memberId, familyId],
    );

    if (!rows[0]) {
      throw notFound("Member not found.");
    }

    await writeAudit(req, {
      familyId,
      entityType: "family_member",
      entityId: memberId,
      action: "platform_member_role_updated",
      metadata: { role },
    });

    res.json({ data: rows[0], error: null });
  }),
);

adminRouter.delete(
  "/families/:familyId",
  asyncHandler(async (req, res) => {
    const familyId = requireUuid(req.params.familyId, "Family ID");
    const confirmText = requireString(req.body, "confirmText", "Confirmation");

    if (confirmText !== "DELETE") {
      throw badRequest("Type DELETE to confirm family deletion.");
    }

    const { rows } = await query(
      `
        UPDATE families
        SET deleted_at = now(),
            archive_delete_after = now() + interval '90 days',
            archive_warning_14_sent_at = NULL,
            archive_warning_7_sent_at = NULL,
            platform_status = 'suspended',
            platform_admin_notes = concat_ws(
              E'\n',
              NULLIF(platform_admin_notes, ''),
              'Soft deleted by owner platform on ' || to_char(now(), 'YYYY-MM-DD HH24:MI')
            )
        WHERE id = $1
          AND deleted_at IS NULL
        RETURNING id, name
      `,
      [familyId],
    );

    if (!rows[0]) {
      throw notFound("Family not found.");
    }

    await query(
      `
        UPDATE family_members
        SET deleted_at = now()
        WHERE family_id = $1
          AND deleted_at IS NULL
      `,
      [familyId],
    );

    await query(
      `
        UPDATE subscriptions
        SET status = 'canceled',
            access_paused_at = COALESCE(access_paused_at, now()),
            access_pause_reason = 'Family soft deleted by owner platform'
        WHERE family_id = $1
      `,
      [familyId],
    );

    await writeAudit(req, {
      familyId,
      entityType: "family",
      entityId: familyId,
      action: "platform_family_soft_deleted",
      metadata: { name: rows[0].name },
    });

    res.json({
      data: {
        id: rows[0].id,
        name: rows[0].name,
        deleted: true,
      },
      error: null,
    });
  }),
);

adminRouter.patch(
  "/families/:familyId/restore",
  asyncHandler(async (req, res) => {
    const familyId = requireUuid(req.params.familyId, "Family ID");

    const { rows } = await query(
      `
        UPDATE families
        SET deleted_at = NULL,
            archive_delete_after = NULL,
            archive_warning_14_sent_at = NULL,
            archive_warning_7_sent_at = NULL,
            platform_status = 'active',
            platform_admin_notes = concat_ws(
              E'\n',
              NULLIF(platform_admin_notes, ''),
              'Restored by owner platform on ' || to_char(now(), 'YYYY-MM-DD HH24:MI')
            )
        WHERE id = $1
          AND deleted_at IS NOT NULL
        RETURNING id, name
      `,
      [familyId],
    );

    if (!rows[0]) {
      throw notFound("Archived family not found.");
    }

    await query(
      `
        UPDATE family_members
        SET deleted_at = NULL
        WHERE family_id = $1
      `,
      [familyId],
    );

    await query(
      `
        UPDATE subscriptions
        SET access_paused_at = NULL,
            access_pause_reason = NULL,
            status = CASE
              WHEN status = 'canceled' THEN 'inactive'
              ELSE status
            END
        WHERE family_id = $1
      `,
      [familyId],
    );

    await writeAudit(req, {
      familyId,
      entityType: "family",
      entityId: familyId,
      action: "platform_family_restored",
      metadata: { name: rows[0].name },
    });

    res.json({
      data: {
        id: rows[0].id,
        name: rows[0].name,
        restored: true,
      },
      error: null,
    });
  }),
);

adminRouter.post(
  "/families/:familyId/archive-warning",
  asyncHandler(async (req, res) => {
    const familyId = requireUuid(req.params.familyId, "Family ID");
    const days = Number(req.body?.days) === 7 ? 7 : 14;
    const sentColumn =
      days === 7 ? "archive_warning_7_sent_at" : "archive_warning_14_sent_at";

    const { rows } = await query(
      `
        SELECT
          f.id,
          f.name,
          f.archive_delete_after AS "archiveDeleteAfter",
          u.full_name AS "ownerName",
          u.email AS "ownerEmail"
        FROM families f
        LEFT JOIN users u ON u.id = f.created_by_user_id
        WHERE f.id = $1
          AND f.deleted_at IS NOT NULL
          AND f.permanently_deleted_at IS NULL
        LIMIT 1
      `,
      [familyId],
    );

    if (!rows[0]) {
      throw notFound("Archived family not found.");
    }
    if (!rows[0].ownerEmail) {
      throw badRequest("This archived family has no owner email to warn.");
    }

    const email = archivedFamilyDeletionWarningEmail({
      fullName: rows[0].ownerName,
      familyName: rows[0].name,
      days,
    });
    const result = await sendAppEmail({
      to: rows[0].ownerEmail,
      ...email,
      metadata: { familyId, type: "archive_delete_warning", days },
    });

    await query(
      `
        UPDATE families
        SET ${sentColumn} = now()
        WHERE id = $1
      `,
      [familyId],
    );

    await writeAudit(req, {
      familyId,
      entityType: "family",
      entityId: familyId,
      action: "platform_family_archive_warning_sent",
      metadata: { days, sent: result.sent, skipped: result.skipped },
    });

    res.json({
      data: {
        familyId,
        days,
        sent: result.sent,
        skipped: result.skipped,
      },
      error: null,
    });
  }),
);

adminRouter.delete(
  "/families/:familyId/permanent",
  asyncHandler(async (req, res) => {
    const familyId = requireUuid(req.params.familyId, "Family ID");
    const confirmText = requireString(req.body, "confirmText", "Confirmation");

    if (confirmText !== "PERMANENT DELETE") {
      throw badRequest("Type PERMANENT DELETE to confirm permanent deletion.");
    }

    const { rows } = await query(
      `
        UPDATE families
        SET permanently_deleted_at = now(),
            platform_status = 'suspended',
            platform_admin_notes = concat_ws(
              E'\n',
              NULLIF(platform_admin_notes, ''),
              'Permanently deleted from archive by owner platform on ' || to_char(now(), 'YYYY-MM-DD HH24:MI')
            )
        WHERE id = $1
          AND deleted_at IS NOT NULL
          AND permanently_deleted_at IS NULL
        RETURNING id, name
      `,
      [familyId],
    );

    if (!rows[0]) {
      throw notFound("Archived family not found.");
    }

    await writeAudit(req, {
      familyId,
      entityType: "family",
      entityId: familyId,
      action: "platform_family_permanently_deleted",
      metadata: { name: rows[0].name },
    });

    res.json({
      data: {
        id: rows[0].id,
        name: rows[0].name,
        permanentlyDeleted: true,
      },
      error: null,
    });
  }),
);

adminRouter.delete(
  "/families/:familyId/members/:memberId",
  asyncHandler(async (req, res) => {
    const familyId = requireUuid(req.params.familyId, "Family ID");
    const memberId = requireUuid(req.params.memberId, "Member ID");

    const { rows } = await query(
      `
        UPDATE family_members
        SET deleted_at = now()
        WHERE id = $1
          AND family_id = $2
          AND deleted_at IS NULL
        RETURNING id
      `,
      [memberId, familyId],
    );

    if (!rows[0]) {
      throw notFound("Member not found.");
    }

    await writeAudit(req, {
      familyId,
      entityType: "family_member",
      entityId: memberId,
      action: "platform_member_removed",
      metadata: {},
    });

    res.json({ data: { id: rows[0].id, deleted: true }, error: null });
  }),
);

adminRouter.get(
  "/users",
  asyncHandler(async (req, res) => {
    const { rows } = await query(
      `
        SELECT
          u.id,
          u.full_name AS "fullName",
          u.email,
          u.is_platform_admin AS "isPlatformAdmin",
          u.platform_status AS "platformStatus",
          u.platform_admin_notes AS "platformAdminNotes",
          u.created_at AS "createdAt",
          u.last_login_at AS "lastLoginAt",
          COALESCE(u.last_login_at, max(cl.created_at)) AS "lastSeenAt",
          count(DISTINCT fm.family_id)::int AS "familyCount",
          count(DISTINCT cl.id)::int AS "logCount",
          primary_subscription.plan AS "plan",
          primary_subscription.status AS "subscriptionStatus",
          primary_subscription.billing_status AS "billingStatus",
          primary_subscription.access_status AS "accessStatus",
          primary_subscription.manual_access_override AS "manualAccessOverride",
          primary_subscription.trial_ends_at AS "trialEndsAt",
          primary_subscription.access_paused_at AS "accessPausedAt"
        FROM users u
        LEFT JOIN family_members fm ON fm.user_id = u.id AND fm.deleted_at IS NULL
        LEFT JOIN care_logs cl ON cl.created_by_user_id = u.id AND cl.deleted_at IS NULL
        LEFT JOIN LATERAL (
          SELECT s.plan, s.status, s.billing_status, s.access_status, s.manual_access_override, s.trial_ends_at, s.access_paused_at
          FROM family_members pfm
          INNER JOIN subscriptions s ON s.family_id = pfm.family_id
          WHERE pfm.user_id = u.id
            AND pfm.deleted_at IS NULL
          ORDER BY pfm.joined_at ASC
          LIMIT 1
        ) primary_subscription ON true
        WHERE u.deleted_at IS NULL
        GROUP BY u.id, primary_subscription.plan, primary_subscription.status, primary_subscription.billing_status, primary_subscription.access_status, primary_subscription.manual_access_override, primary_subscription.trial_ends_at, primary_subscription.access_paused_at
        ORDER BY u.created_at DESC
        LIMIT 100
      `,
    );

    res.json({
      data: rows.map((row) => ({ ...row, access: buildPlanAccess(row) })),
      error: null,
    });
  }),
);

adminRouter.get(
  "/users/:userId",
  asyncHandler(async (req, res) => {
    const userId = requireUuid(req.params.userId, "User ID");

    const user = await query(
      `
        SELECT
          id,
          full_name AS "fullName",
          email,
          is_platform_admin AS "isPlatformAdmin",
          platform_status AS "platformStatus",
          platform_admin_notes AS "platformAdminNotes",
          created_at AS "createdAt",
          last_login_at AS "lastLoginAt",
          COALESCE(
            last_login_at,
            (
              SELECT max(cl.created_at)
              FROM care_logs cl
              WHERE cl.created_by_user_id = users.id
                AND cl.deleted_at IS NULL
            )
          ) AS "lastSeenAt"
        FROM users
        WHERE id = $1
          AND deleted_at IS NULL
        LIMIT 1
      `,
      [userId],
    );

    if (!user.rows[0]) {
      throw notFound("User not found.");
    }

    const [memberships, activity, recentLogs, auditLogs] = await Promise.all([
      query(
        `
          SELECT
            fm.id,
            fm.role,
            fm.joined_at AS "joinedAt",
            f.id AS "familyId",
            f.name AS "familyName",
            f.platform_status AS "familyPlatformStatus",
            COALESCE(s.status, 'trialing') AS "subscriptionStatus",
            COALESCE(s.billing_status, s.status, 'none') AS "billingStatus",
            COALESCE(s.access_status, 'legacy') AS "accessStatus",
            COALESCE(s.plan, 'trial') AS plan,
            s.trial_ends_at AS "trialEndsAt",
            s.access_paused_at AS "accessPausedAt"
          FROM family_members fm
          INNER JOIN families f ON f.id = fm.family_id
          LEFT JOIN subscriptions s ON s.family_id = f.id
          WHERE fm.user_id = $1
            AND fm.deleted_at IS NULL
            AND f.deleted_at IS NULL
          ORDER BY fm.joined_at DESC
        `,
        [userId],
      ),
      query(
        `
          SELECT
            count(DISTINCT fm.family_id)::int AS "familyCount",
            count(DISTINCT cl.id)::int AS "logCount",
            max(cl.created_at) AS "lastLogAt"
          FROM users u
          LEFT JOIN family_members fm ON fm.user_id = u.id AND fm.deleted_at IS NULL
          LEFT JOIN care_logs cl ON cl.created_by_user_id = u.id AND cl.deleted_at IS NULL
          WHERE u.id = $1
        `,
        [userId],
      ),
      query(
        `
          SELECT
            cl.id,
            cl.category,
            cl.log_date::text AS "logDate",
            to_char(cl.log_time, 'HH24:MI') AS "logTime",
            cl.notes,
            cl.created_at AS "createdAt",
            f.name AS "familyName",
            c.first_name AS "childFirstName"
          FROM care_logs cl
          INNER JOIN families f ON f.id = cl.family_id
          INNER JOIN children c ON c.id = cl.child_id
          WHERE cl.created_by_user_id = $1
            AND cl.deleted_at IS NULL
          ORDER BY cl.created_at DESC
          LIMIT 20
        `,
        [userId],
      ),
      query(
        `
          SELECT
            al.id,
            al.action,
            al.entity_type AS "entityType",
            al.metadata,
            al.created_at AS "createdAt",
            admin.full_name AS "adminName",
            admin.email AS "adminEmail"
          FROM audit_logs al
          LEFT JOIN users admin ON admin.id = al.user_id
          WHERE al.entity_type = 'user'
            AND al.entity_id = $1
          ORDER BY al.created_at DESC
          LIMIT 20
        `,
        [userId],
      ),
    ]);

    res.json({
      data: {
        user: user.rows[0],
        memberships: memberships.rows,
        activity: activity.rows[0],
        recentLogs: recentLogs.rows,
        auditLogs: auditLogs.rows,
      },
      error: null,
    });
  }),
);

adminRouter.patch(
  "/users/:userId",
  asyncHandler(async (req, res) => {
    const userId = requireUuid(req.params.userId, "User ID");
    const fullName = requireString(req.body, "fullName", "Full name");
    const email = requireEmail(req.body);
    const platformStatus = requireEnum(req.body, "platformStatus", [
      "active",
      "suspended",
      "watch",
    ]);
    const platformAdminNotes = optionalString(req.body, "platformAdminNotes");
    const isPlatformAdmin = Boolean(req.body.isPlatformAdmin);

    const existingEmail = await query(
      `
        SELECT
          id
        FROM users
        WHERE lower(email) = lower($1)
          AND id <> $2
          AND deleted_at IS NULL
        LIMIT 1
      `,
      [email, userId],
    );

    if (existingEmail.rows[0]) {
      throw badRequest("Another account already uses that email address.");
    }

    const { rows } = await query(
      `
        UPDATE users
        SET full_name = $1,
            email = $2,
            platform_status = $3,
            platform_admin_notes = $4,
            is_platform_admin = $5
        WHERE id = $6
          AND deleted_at IS NULL
        RETURNING
          id,
          full_name AS "fullName",
          email,
          is_platform_admin AS "isPlatformAdmin",
          platform_status AS "platformStatus",
          platform_admin_notes AS "platformAdminNotes"
      `,
      [fullName, email, platformStatus, platformAdminNotes, isPlatformAdmin, userId],
    );

    if (!rows[0]) {
      throw notFound("User not found.");
    }

    await writeAudit(req, {
      entityType: "user",
      entityId: userId,
      action: "platform_user_updated",
      metadata: {
        fullName,
        email,
        platformStatus,
        platformAdminNotes,
        isPlatformAdmin,
      },
    });

    res.json({ data: rows[0], error: null });
  }),
);

adminRouter.post(
  "/users/:userId/password",
  asyncHandler(async (req, res) => {
    const userId = requireUuid(req.params.userId, "User ID");
    const password = requirePassword(req.body);
    const passwordHash = await hashPassword(password);

    const { rows } = await query(
      `
        UPDATE users
        SET password_hash = $1,
            reset_token_hash = null,
            reset_token_expires_at = null
        WHERE id = $2
          AND deleted_at IS NULL
        RETURNING id, email, full_name AS "fullName"
      `,
      [passwordHash, userId],
    );

    if (!rows[0]) {
      throw notFound("User not found.");
    }

    await writeAudit(req, {
      entityType: "user",
      entityId: userId,
      action: "platform_user_password_reset",
      metadata: { email: rows[0].email },
    });

    res.json({
      data: { id: rows[0].id, email: rows[0].email, reset: true },
      error: null,
    });
  }),
);

adminRouter.post(
  "/users/:userId/password-reset",
  asyncHandler(async (req, res) => {
    const userId = requireUuid(req.params.userId, "User ID");
    const token = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

    const { rows } = await query(
      `
        UPDATE users
        SET reset_token_hash = $1,
            reset_token_expires_at = now() + interval '24 hours'
        WHERE id = $2
          AND deleted_at IS NULL
        RETURNING id, email, full_name AS "fullName", reset_token_expires_at AS "expiresAt"
      `,
      [tokenHash, userId],
    );

    if (!rows[0]) {
      throw notFound("User not found.");
    }

    await writeAudit(req, {
      entityType: "user",
      entityId: userId,
      action: "platform_user_password_reset_link_created",
      metadata: { email: rows[0].email },
    });

    const resetUrl = `${config.frontendUrl}/reset-password?token=${token}`;
    const email = passwordResetEmail({
      fullName: rows[0].fullName,
      resetUrl,
    });
    sendAppEmail({
      to: rows[0].email,
      ...email,
      metadata: { type: "password_reset", userId },
    }).catch((error) =>
      console.error("Password reset email failed:", error.message),
    );

    res.json({
      data: {
        id: rows[0].id,
        email: rows[0].email,
        resetUrl,
        expiresAt: rows[0].expiresAt,
      },
      error: null,
    });
  }),
);

adminRouter.delete(
  "/users/:userId",
  asyncHandler(async (req, res) => {
    const userId = requireUuid(req.params.userId, "User ID");
    const confirmText = requireString(req.body, "confirmText", "Confirmation");

    if (confirmText !== "DELETE") {
      throw badRequest("Type DELETE to confirm account deletion.");
    }

    if (userId === req.user.id) {
      throw badRequest("You cannot delete your own owner account here.");
    }

    const { rows } = await query(
      `
        UPDATE users
        SET deleted_at = now(),
            platform_status = 'suspended',
            platform_admin_notes = concat_ws(
              E'\n',
              NULLIF(platform_admin_notes, ''),
              'Soft deleted by owner platform on ' || to_char(now(), 'YYYY-MM-DD HH24:MI')
            )
        WHERE id = $1
          AND deleted_at IS NULL
        RETURNING id, email, full_name AS "fullName"
      `,
      [userId],
    );

    if (!rows[0]) {
      throw notFound("User not found.");
    }

    await query(
      `
        UPDATE family_members
        SET deleted_at = now()
        WHERE user_id = $1
          AND deleted_at IS NULL
      `,
      [userId],
    );

    await writeAudit(req, {
      entityType: "user",
      entityId: userId,
      action: "platform_user_soft_deleted",
      metadata: { email: rows[0].email },
    });

    res.json({
      data: {
        id: rows[0].id,
        email: rows[0].email,
        deleted: true,
      },
      error: null,
    });
  }),
);

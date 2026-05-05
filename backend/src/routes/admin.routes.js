import { Router } from "express";
import crypto from "node:crypto";
import { config } from "../config.js";
import { query } from "../db/pool.js";
import { requireAuth } from "../middleware/auth.js";
import { requirePlatformAdmin } from "../middleware/platformAdmin.js";
import { ensureIssueReportingSchema } from "../services/issueReportingSchema.js";
import {
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
  extractStripeDiscountInfo,
  listStripePaidInvoices,
  listStripeCustomerSubscriptions,
  normalisePromotionCode,
} from "../services/stripe.js";
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
    next();
  }),
);

const memberRoles = ["owner", "parent", "carer", "viewer"];
const issueStatuses = ["new", "in_progress", "resolved"];
const planValues = ["trial", "family", "beta", "professional"];
const statusValues = ["inactive", "trialing", "active", "past_due", "canceled", "cancelled"];

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

function normalisePeriodEnd(timestamp) {
  return timestamp ? new Date(timestamp * 1000).toISOString() : null;
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
  const subscription = subscriptions.data?.find((item) =>
    ["active", "trialing", "past_due", "incomplete", "canceled", "unpaid"].includes(
      item.status,
    ),
  );

  if (!subscription) {
    return null;
  }

  const plan = ["active", "trialing", "past_due"].includes(subscription.status)
    ? "family"
    : subscription.metadata?.plan || "family";
  const discount = extractStripeDiscountInfo(subscription);
  const promotionCode =
    discount.stripePromotionCode ||
    normalisePromotionCode(subscription.metadata?.promotion_code || "");

  const updated = await query(
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
      plan,
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
    ] = await Promise.all([
      query("SELECT count(*)::int AS count FROM families WHERE deleted_at IS NULL"),
      query("SELECT count(*)::int AS count FROM users WHERE deleted_at IS NULL"),
      query(`
        SELECT count(*)::int AS count
        FROM (
          SELECT DISTINCT
            family_id,
            lower(trim(first_name)) AS first_name_key,
            lower(trim(COALESCE(last_name, ''))) AS last_name_key,
            date_of_birth
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
          FROM users
          WHERE deleted_at IS NULL
            AND last_login_at >= now() - interval '7 days'
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
        stripeSetup: {
          hasSecretKey: Boolean(config.stripeSecretKey),
          hasWebhookSecret: Boolean(config.stripeWebhookSecret),
          hasPriceId: Boolean(config.stripePriceId),
          priceId: config.stripePriceId || null,
          priceEnv: "STRIPE_FAMILY_PRICE_ID",
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
    const internalNote = optionalString(req.body, "internalNote");

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
          f.created_at AS "createdAt",
          u.full_name AS "ownerName",
          u.email AS "ownerEmail",
          COALESCE(s.status, 'inactive') AS "subscriptionStatus",
          COALESCE(s.plan, 'trial') AS plan,
          s.trial_ends_at AS "trialEndsAt",
          s.access_paused_at AS "accessPausedAt",
          s.access_pause_reason AS "accessPauseReason",
          count(DISTINCT fm.id)::int AS "memberCount",
          count(
            DISTINCT concat_ws(
              '|',
              lower(trim(c.first_name)),
              lower(trim(COALESCE(c.last_name, ''))),
              COALESCE(c.date_of_birth::text, '')
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
        LEFT JOIN children c ON c.family_id = f.id AND c.deleted_at IS NULL
        LEFT JOIN care_logs cl ON cl.family_id = f.id AND cl.deleted_at IS NULL
        WHERE f.deleted_at IS NULL
        GROUP BY f.id, u.full_name, u.email, s.status, s.plan, s.trial_ends_at, s.access_paused_at, s.access_pause_reason
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
  "/families/:familyId",
  asyncHandler(async (req, res) => {
    const { familyId } = req.params;

    const family = await query(
      `
        SELECT
          f.id,
          f.name,
          f.timezone,
          f.platform_status AS "platformStatus",
          f.platform_admin_notes AS "platformAdminNotes",
          f.created_at AS "createdAt",
          u.full_name AS "ownerName",
          u.email AS "ownerEmail",
          COALESCE(s.status, 'trialing') AS "subscriptionStatus",
          COALESCE(s.plan, 'trial') AS plan,
          s.trial_started_at AS "trialStartedAt",
          s.trial_ends_at AS "trialEndsAt",
          s.access_paused_at AS "accessPausedAt",
          s.access_pause_reason AS "accessPauseReason",
          s.current_period_end AS "currentPeriodEnd",
          s.stripe_customer_id AS "stripeCustomerId",
          s.stripe_subscription_id AS "stripeSubscriptionId",
          s.cancel_at_period_end AS "cancelAtPeriodEnd",
          s.stripe_promotion_code AS "stripePromotionCode",
          s.stripe_coupon_id AS "stripeCouponId",
          s.stripe_coupon_name AS "stripeCouponName",
          s.stripe_discount_percent_off AS "stripeDiscountPercentOff",
          s.stripe_discount_amount_off AS "stripeDiscountAmountOff",
          s.stripe_discount_currency AS "stripeDiscountCurrency"
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

    const [members, children, recentLogs, auditLogs] = await Promise.all([
      query(
        `
          SELECT
            fm.id,
            fm.role,
            fm.joined_at AS "joinedAt",
            u.id AS "userId",
            u.full_name AS "fullName",
            u.email
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
              lower(trim(first_name)),
              lower(trim(COALESCE(last_name, ''))),
              date_of_birth
            )
              id,
              first_name,
              last_name,
              date_of_birth,
              created_at,
              count(*) OVER (
                PARTITION BY
                  lower(trim(first_name)),
                  lower(trim(COALESCE(last_name, ''))),
                  date_of_birth
              ) AS duplicate_count
            FROM children
            WHERE family_id = $1
              AND deleted_at IS NULL
            ORDER BY
              lower(trim(first_name)),
              lower(trim(COALESCE(last_name, ''))),
              date_of_birth,
              created_at ASC,
              id ASC
          )
          SELECT
            id,
            first_name AS "firstName",
            last_name AS "lastName",
            date_of_birth::text AS "dateOfBirth",
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
    ]);

    res.json({
      data: {
        family: {
          ...family.rows[0],
          access: buildPlanAccess({
            ...family.rows[0],
            childCount: children.rows.length,
            memberCount: members.rows.length,
          }),
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
  "/families/:familyId/plan",
  asyncHandler(async (req, res) => {
    const familyId = requireUuid(req.params.familyId, "Family ID");
    const plan = normalisePlan(requireEnum(req.body, "plan", planValues, "Plan"));
    const status = normaliseStatus(
      requireEnum(req.body, "status", statusValues, "Status"),
      plan,
    );
    const trialEndsAt = optionalString(req.body, "trialEndsAt");
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
          trial_started_at,
          trial_ends_at,
          access_paused_at,
          access_pause_reason
        )
        VALUES ($1, $2, $3, now(), $4, CASE WHEN $5 THEN now() ELSE NULL END, $6)
        ON CONFLICT (family_id)
        DO UPDATE SET
          plan = EXCLUDED.plan,
          status = EXCLUDED.status,
          trial_started_at = COALESCE(subscriptions.trial_started_at, EXCLUDED.trial_started_at),
          trial_ends_at = EXCLUDED.trial_ends_at,
          access_paused_at = EXCLUDED.access_paused_at,
          access_pause_reason = EXCLUDED.access_pause_reason
        RETURNING
          family_id AS "familyId",
          plan,
          status AS "subscriptionStatus",
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
      metadata: { plan, status, trialEndsAt, accessPaused, accessPauseReason },
    });

    res.json({
      data: { ...rows[0], access: buildPlanAccess(rows[0]) },
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
          count(DISTINCT fm.family_id)::int AS "familyCount",
          count(DISTINCT cl.id)::int AS "logCount",
          primary_subscription.plan AS "plan",
          primary_subscription.status AS "subscriptionStatus",
          primary_subscription.trial_ends_at AS "trialEndsAt",
          primary_subscription.access_paused_at AS "accessPausedAt"
        FROM users u
        LEFT JOIN family_members fm ON fm.user_id = u.id AND fm.deleted_at IS NULL
        LEFT JOIN care_logs cl ON cl.created_by_user_id = u.id AND cl.deleted_at IS NULL
        LEFT JOIN LATERAL (
          SELECT s.plan, s.status, s.trial_ends_at, s.access_paused_at
          FROM family_members pfm
          INNER JOIN subscriptions s ON s.family_id = pfm.family_id
          WHERE pfm.user_id = u.id
            AND pfm.deleted_at IS NULL
          ORDER BY pfm.joined_at ASC
          LIMIT 1
        ) primary_subscription ON true
        WHERE u.deleted_at IS NULL
        GROUP BY u.id, primary_subscription.plan, primary_subscription.status, primary_subscription.trial_ends_at, primary_subscription.access_paused_at
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
          last_login_at AS "lastLoginAt"
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

import { query } from "../db/pool.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const planAccessSchemaSql = `
ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS trial_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS trial_ends_at timestamptz,
  ADD COLUMN IF NOT EXISTS access_paused_at timestamptz,
  ADD COLUMN IF NOT EXISTS access_pause_reason text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS billing_status text,
  ADD COLUMN IF NOT EXISTS access_status text NOT NULL DEFAULT 'legacy',
  ADD COLUMN IF NOT EXISTS manual_access_override text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS stripe_synced_at timestamptz,
  ADD COLUMN IF NOT EXISTS stripe_promotion_code_id text,
  ADD COLUMN IF NOT EXISTS stripe_promotion_code text,
  ADD COLUMN IF NOT EXISTS stripe_coupon_id text,
  ADD COLUMN IF NOT EXISTS stripe_coupon_name text,
  ADD COLUMN IF NOT EXISTS stripe_discount_percent_off numeric,
  ADD COLUMN IF NOT EXISTS stripe_discount_amount_off integer,
  ADD COLUMN IF NOT EXISTS stripe_discount_currency text;

ALTER TABLE subscriptions
  DROP CONSTRAINT IF EXISTS subscriptions_status_valid;

ALTER TABLE subscriptions
  ADD CONSTRAINT subscriptions_status_valid CHECK (
    status IN (
      'inactive',
      'trialing',
      'active',
      'past_due',
      'canceled',
      'cancelled',
      'unpaid',
      'incomplete',
      'incomplete_expired'
    )
  );

UPDATE subscriptions
SET
  plan = CASE
    WHEN plan IS NULL OR trim(plan) = '' OR plan = 'free' THEN 'family'
    ELSE plan
  END,
  status = CASE
    WHEN status IS NULL OR trim(status) = '' THEN 'incomplete'
    ELSE status
  END,
  trial_started_at = CASE WHEN stripe_subscription_id IS NOT NULL THEN COALESCE(trial_started_at, created_at, now()) ELSE trial_started_at END,
  trial_ends_at = CASE WHEN stripe_subscription_id IS NOT NULL THEN COALESCE(trial_ends_at, COALESCE(created_at, now()) + interval '30 days') ELSE trial_ends_at END,
  billing_status = COALESCE(billing_status, status, 'none'),
  access_status = COALESCE(NULLIF(access_status, ''), 'legacy'),
  manual_access_override = COALESCE(NULLIF(manual_access_override, ''), 'none')
WHERE plan IS NULL
   OR trim(plan) = ''
   OR plan = 'free'
   OR status IS NULL
   OR trim(status) = ''
   OR billing_status IS NULL
   OR access_status IS NULL
   OR trim(access_status) = ''
   OR manual_access_override IS NULL
   OR trim(manual_access_override) = '';

UPDATE subscriptions
SET access_status = 'active',
    manual_access_override = 'none'
WHERE COALESCE(NULLIF(manual_access_override, ''), 'none') <> 'force_locked'
  AND (
    COALESCE(billing_status, '') IN ('trialing', 'active')
    OR COALESCE(status, '') IN ('trialing', 'active')
  );
`;

let setupPromise = null;

export const planTypes = ["trial", "family", "beta", "professional"];
export const subscriptionStatuses = [
  "inactive",
  "trialing",
  "active",
  "past_due",
  "canceled",
  "cancelled",
  "unpaid",
  "incomplete",
  "incomplete_expired",
];

export async function ensurePlanAccessSchema() {
  if (!setupPromise) {
    setupPromise = query(planAccessSchemaSql).catch((error) => {
      setupPromise = null;
      throw error;
    });
  }

  await setupPromise;
}

function asDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function daysUntil(value) {
  const date = asDate(value);
  if (!date) return 0;
  return Math.max(0, Math.ceil((date.getTime() - Date.now()) / DAY_MS));
}

export function normalisePlan(plan) {
  const value = String(plan || "").toLowerCase();
  if (value === "free" || value === "") return "trial";
  if (value === "professional/future") return "professional";
  return planTypes.includes(value) ? value : "family";
}

export function normaliseStatus(status, plan) {
  const value = String(status || "").toLowerCase();
  if (value === "cancelled") return "canceled";
  if (value === "free" || value === "") return normalisePlan(plan) === "trial" ? "trialing" : "inactive";
  return subscriptionStatuses.includes(value) ? value : "inactive";
}

const FULL_ACCESS = {
  canAddLogs: true,
  canEditLogs: true,
  canDeleteLogs: true,
  canAddChild: true,
  canInviteCarer: true,
};

const NO_WRITE_ACCESS = {
  canAddLogs: false,
  canEditLogs: false,
  canDeleteLogs: false,
  canAddChild: false,
  canInviteCarer: false,
};

function withFlags(base, flags) {
  const computedAccess =
    flags.canAddLogs || flags.canAddChild || flags.canInviteCarer
      ? "full"
      : base.reason === "checkout_required"
        ? "needs_subscription"
        : base.reason === "locked"
          ? "locked"
          : "view_only";

  return {
    ...base,
    computedAccess,
    viewOnly: computedAccess !== "full",
    ...flags,
  };
}

export function computeAccess(record = {}) {
  const plan = normalisePlan(record.plan);
  const status = normaliseStatus(record.status || record.subscriptionStatus, plan);
  const billingStatus = String(
    record.billingStatus || record.billing_status || status || "none",
  ).toLowerCase();
  const accessStatus = String(record.accessStatus || record.access_status || "none").toLowerCase();
  const manualAccessOverride = String(
    record.manualAccessOverride || record.manual_access_override || "none",
  ).toLowerCase();
  const trialEndsAt = record.trialEndsAt || record.trial_ends_at || null;
  const stripeSubscriptionId =
    record.stripeSubscriptionId || record.stripe_subscription_id || "";
  const paused = Boolean(record.accessPausedAt || record.access_paused_at);
  const trialDaysLeft = daysUntil(trialEndsAt);
  const hasStripeSubscription = Boolean(stripeSubscriptionId);
  const effectiveStatus = billingStatus || status || "none";
  const base = {
    plan,
    status,
    billingStatus,
    accessStatus,
    manualAccessOverride,
    trialEndsAt,
    trialDaysLeft,
  };

  if (record.isPlatformAdmin || record.is_platform_admin || record.role === "admin") {
    return withFlags({ ...base, label: "Admin", tone: "indigo", reason: "admin" }, FULL_ACCESS);
  }

  if (manualAccessOverride === "force_locked") {
    return withFlags({ ...base, label: "Access paused", tone: "rose", reason: "locked" }, NO_WRITE_ACCESS);
  }

  if (accessStatus === "blocked") {
    return withFlags({ ...base, label: "Access paused", tone: "rose", reason: "locked" }, NO_WRITE_ACCESS);
  }

  if (["active", "approved", "legacy", "legacy_approved", "free", "internal", "test"].includes(accessStatus)) {
    const label =
      accessStatus === "active" || accessStatus === "approved"
        ? "Active"
        : accessStatus === "free"
          ? "Free/internal"
          : accessStatus === "test"
            ? "Test account"
            : accessStatus === "internal"
              ? "Internal"
              : "Legacy approved";
    const tone = accessStatus === "active" || accessStatus === "approved" ? "emerald" : "indigo";
    return withFlags({ ...base, label, tone, reason: accessStatus }, FULL_ACCESS);
  }

  if (
    ["trialing", "active"].includes(effectiveStatus) ||
    ["trialing", "active"].includes(status)
  ) {
    const isTrialing = effectiveStatus === "trialing" || status === "trialing";
    return withFlags(
      {
        ...base,
        label: isTrialing
          ? trialDaysLeft > 0
            ? `Trial - ${trialDaysLeft} day${trialDaysLeft === 1 ? "" : "s"} left`
            : "Trial active"
          : "Active",
        tone: isTrialing ? "sky" : "emerald",
        reason: isTrialing ? "trial" : "active",
      },
      FULL_ACCESS,
    );
  }

  if (paused || ["past_due", "canceled", "cancelled", "unpaid"].includes(effectiveStatus)) {
    return withFlags(
      {
        ...base,
        label: "View only",
        tone: "amber",
        reason: paused ? "paused" : effectiveStatus,
      },
      NO_WRITE_ACCESS,
    );
  }

  if (!hasStripeSubscription || ["none", "incomplete", "incomplete_expired", "inactive"].includes(effectiveStatus)) {
    return withFlags(
      { ...base, label: "Finish setup", tone: "amber", reason: "checkout_required" },
      NO_WRITE_ACCESS,
    );
  }

  return withFlags(
    { ...base, label: "View only", tone: "amber", reason: effectiveStatus || "inactive" },
    NO_WRITE_ACCESS,
  );
}

export const buildPlanAccess = computeAccess;

export async function getFamilyPlanAccess(familyId) {
  await ensurePlanAccessSchema();

  const { rows } = await query(
    `
      SELECT
        COALESCE(s.plan, 'family') AS plan,
        COALESCE(s.status, 'incomplete') AS status,
        COALESCE(s.billing_status, s.status, 'none') AS "billingStatus",
        COALESCE(s.access_status, 'legacy') AS "accessStatus",
        COALESCE(s.manual_access_override, 'none') AS "manualAccessOverride",
        s.stripe_subscription_id AS "stripeSubscriptionId",
        s.trial_ends_at AS "trialEndsAt",
        s.access_paused_at AS "accessPausedAt",
        count(DISTINCT c.id)::int AS "childCount",
        count(DISTINCT fm.id)::int AS "memberCount"
      FROM families f
      LEFT JOIN subscriptions s ON s.family_id = f.id
      LEFT JOIN children c ON c.family_id = f.id AND c.deleted_at IS NULL
      LEFT JOIN family_members fm ON fm.family_id = f.id AND fm.deleted_at IS NULL
      WHERE f.id = $1
        AND f.deleted_at IS NULL
      GROUP BY f.id, s.plan, s.status, s.billing_status, s.access_status, s.manual_access_override, s.stripe_subscription_id, s.trial_ends_at, s.access_paused_at
      LIMIT 1
    `,
    [familyId],
  );

  return buildPlanAccess(rows[0] || {});
}

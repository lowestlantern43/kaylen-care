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
  access_status = COALESCE(NULLIF(access_status, ''), 'legacy')
WHERE plan IS NULL
   OR trim(plan) = ''
   OR plan = 'free'
   OR status IS NULL
   OR trim(status) = ''
   OR billing_status IS NULL
   OR access_status IS NULL
   OR trim(access_status) = '';
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

export function buildPlanAccess(record = {}) {
  const plan = normalisePlan(record.plan);
  const status = normaliseStatus(record.status || record.subscriptionStatus, plan);
  const billingStatus = String(
    record.billingStatus || record.billing_status || status || "none",
  ).toLowerCase();
  const accessStatus = String(
    record.accessStatus || record.access_status || "legacy",
  ).toLowerCase();
  const trialEndsAt = record.trialEndsAt || record.trial_ends_at || null;
  const stripeSubscriptionId =
    record.stripeSubscriptionId || record.stripe_subscription_id || "";
  const paused = Boolean(record.accessPausedAt || record.access_paused_at);
  const trialDaysLeft = daysUntil(trialEndsAt);
  const hasStripeSubscription = Boolean(stripeSubscriptionId);
  const isStripeTrial =
    hasStripeSubscription && plan === "family" && status === "trialing";
  const legacyTrial =
    !hasStripeSubscription && plan === "family" && status === "trialing";
  const cancelled = [
    "canceled",
    "cancelled",
    "unpaid",
    "incomplete",
    "incomplete_expired",
    "inactive",
  ].includes(status);
  const activePaid =
    hasStripeSubscription &&
    plan === "family" &&
    status === "active";
  const legacyActive =
    !hasStripeSubscription && plan === "family" && status === "active";
  const beta = plan === "beta";
  const explicitlyAllowed = [
    "active",
    "approved",
    "legacy",
    "legacy_approved",
    "free",
    "internal",
    "test",
  ].includes(accessStatus);
  const explicitlyLocked = ["locked", "blocked"].includes(accessStatus);
  const explicitlyUnpaid = ["past_due", "canceled", "cancelled", "unpaid"].includes(
    billingStatus,
  );

  let label = "Inactive";
  let tone = "slate";
  let reason = "inactive";
  let canAddLogs = false;
  let canEditLogs = false;
  let canDeleteLogs = false;
  let canAddChild = false;
  let canInviteCarer = false;

  if (explicitlyLocked) {
    label = "Locked";
    tone = "rose";
    reason = "locked";
  } else if (paused) {
    label = "View only";
    tone = "amber";
    reason = "paused";
  } else if (beta) {
    label = "Beta Tester";
    tone = "indigo";
    reason = "beta";
    canAddLogs = true;
    canEditLogs = true;
    canDeleteLogs = true;
    canAddChild = true;
    canInviteCarer = true;
  } else if (explicitlyAllowed && !explicitlyUnpaid) {
    label =
      accessStatus === "free"
        ? "Free/internal"
        : accessStatus === "test"
          ? "Test account"
          : accessStatus === "internal"
            ? "Internal"
            : "Legacy approved";
    tone = accessStatus === "legacy" || accessStatus === "legacy_approved" ? "emerald" : "indigo";
    reason = accessStatus;
    canAddLogs = true;
    canEditLogs = true;
    canDeleteLogs = true;
    canAddChild = true;
    canInviteCarer = true;
  } else if (cancelled) {
    label = status === "incomplete" ? "Finish setup" : "Subscription inactive";
    tone = status === "incomplete" ? "amber" : "rose";
    reason = status === "incomplete" ? "checkout_required" : "cancelled";
  } else if (isStripeTrial || legacyTrial) {
    label = trialDaysLeft > 0
      ? `Trial - ${trialDaysLeft} day${trialDaysLeft === 1 ? "" : "s"} left`
      : "Trial active";
    tone = "sky";
    reason = legacyTrial ? "legacy_trial" : "trial";
    canAddLogs = true;
    canEditLogs = true;
    canDeleteLogs = true;
    canAddChild = true;
    canInviteCarer = true;
  } else if (activePaid || legacyActive) {
    label = legacyActive ? "Active legacy account" : "Active";
    tone = "emerald";
    reason = legacyActive ? "legacy_active" : "active";
    canAddLogs = true;
    canEditLogs = true;
    canDeleteLogs = true;
    canAddChild = true;
    canInviteCarer = true;
  } else if (!hasStripeSubscription) {
    label = "Finish setup";
    tone = "amber";
    reason = "checkout_required";
  }

  return {
    plan,
    status,
    billingStatus,
    accessStatus,
    trialEndsAt,
    trialDaysLeft,
    label,
    tone,
    reason,
    viewOnly: !(canAddLogs || canAddChild || canInviteCarer),
    canAddLogs,
    canEditLogs,
    canDeleteLogs,
    canAddChild,
    canInviteCarer,
  };
}

export async function getFamilyPlanAccess(familyId) {
  await ensurePlanAccessSchema();

  const { rows } = await query(
    `
      SELECT
        COALESCE(s.plan, 'family') AS plan,
        COALESCE(s.status, 'incomplete') AS status,
        COALESCE(s.billing_status, s.status, 'none') AS "billingStatus",
        COALESCE(s.access_status, 'legacy') AS "accessStatus",
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
      GROUP BY f.id, s.plan, s.status, s.billing_status, s.access_status, s.stripe_subscription_id, s.trial_ends_at, s.access_paused_at
      LIMIT 1
    `,
    [familyId],
  );

  return buildPlanAccess(rows[0] || {});
}

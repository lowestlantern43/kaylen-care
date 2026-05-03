import { query } from "../db/pool.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const planAccessSchemaSql = `
ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS trial_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS trial_ends_at timestamptz,
  ADD COLUMN IF NOT EXISTS access_paused_at timestamptz,
  ADD COLUMN IF NOT EXISTS access_pause_reason text NOT NULL DEFAULT '',
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
    WHEN plan IS NULL OR trim(plan) = '' OR plan = 'free' THEN 'trial'
    ELSE plan
  END,
  status = CASE
    WHEN status IS NULL OR trim(status) = '' OR status = 'inactive' THEN 'trialing'
    ELSE status
  END,
  trial_started_at = COALESCE(trial_started_at, created_at, now()),
  trial_ends_at = COALESCE(trial_ends_at, COALESCE(created_at, now()) + interval '30 days')
WHERE plan IS NULL
   OR trim(plan) = ''
   OR plan = 'free'
   OR trial_started_at IS NULL
   OR trial_ends_at IS NULL;
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
  const trialEndsAt = record.trialEndsAt || record.trial_ends_at || null;
  const paused = Boolean(record.accessPausedAt || record.access_paused_at);
  const childCount = Number(record.childCount || record.child_count || 0);
  const memberCount = Number(record.memberCount || record.member_count || 0);
  const trialDaysLeft = daysUntil(trialEndsAt);
  const isTrial = plan === "trial" || status === "trialing";
  const trialExpired = isTrial && trialDaysLeft <= 0;
  const cancelled = ["canceled", "unpaid", "incomplete_expired"].includes(status);
  const activePaid = ["family", "professional"].includes(plan) && ["active", "trialing", "past_due"].includes(status);
  const beta = plan === "beta";

  let label = "Inactive";
  let tone = "slate";
  let reason = "inactive";
  let canAddLogs = false;
  let canEditLogs = false;
  let canDeleteLogs = false;
  let canAddChild = false;
  let canInviteCarer = false;

  if (paused) {
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
  } else if (cancelled) {
    label = "Cancelled";
    tone = "rose";
    reason = "cancelled";
  } else if (isTrial && !trialExpired) {
    label = `Trial - ${trialDaysLeft} day${trialDaysLeft === 1 ? "" : "s"} left`;
    tone = "sky";
    reason = "trial";
    canAddLogs = true;
    canEditLogs = true;
    canDeleteLogs = true;
    canAddChild = childCount < 1;
    canInviteCarer = memberCount < 2;
  } else if (isTrial && trialExpired) {
    label = "View only";
    tone = "amber";
    reason = "expired";
  } else if (activePaid) {
    label = status === "past_due" ? "Payment issue" : "Active";
    tone = status === "past_due" ? "amber" : "emerald";
    reason = status === "past_due" ? "past_due" : "active";
    canAddLogs = true;
    canEditLogs = true;
    canDeleteLogs = true;
    canAddChild = true;
    canInviteCarer = true;
  }

  return {
    plan,
    status,
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
        COALESCE(s.plan, 'trial') AS plan,
        COALESCE(s.status, 'trialing') AS status,
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
      GROUP BY f.id, s.plan, s.status, s.trial_ends_at, s.access_paused_at
      LIMIT 1
    `,
    [familyId],
  );

  return buildPlanAccess(rows[0] || {});
}

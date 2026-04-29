import { Router } from "express";
import crypto from "node:crypto";
import { config } from "../config.js";
import { query } from "../db/pool.js";
import { requireAuth } from "../middleware/auth.js";
import { requirePlatformAdmin } from "../middleware/platformAdmin.js";
import { listStripeCustomerSubscriptions } from "../services/stripe.js";
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

const memberRoles = ["owner", "parent", "carer", "viewer"];
const issueStatuses = ["open", "reviewing", "fixed", "closed"];

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
  const { rows } = await query(
    `
      SELECT value
      FROM platform_settings
      WHERE key = 'feedback'
      LIMIT 1
    `,
  );

  return {
    enabled: rows[0]?.value?.enabled !== false,
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

  const plan =
    subscription.items?.data?.[0]?.price?.nickname ||
    subscription.items?.data?.[0]?.price?.lookup_key ||
    "family";

  const updated = await query(
    `
      UPDATE subscriptions
      SET
        stripe_customer_id = $1,
        stripe_subscription_id = $2,
        status = $3,
        plan = $4,
        current_period_end = $5,
        cancel_at_period_end = $6
      WHERE family_id = $7
      RETURNING
        family_id AS "familyId",
        stripe_customer_id AS "stripeCustomerId",
        stripe_subscription_id AS "stripeSubscriptionId",
        status,
        plan,
        current_period_end AS "currentPeriodEnd",
        cancel_at_period_end AS "cancelAtPeriodEnd"
    `,
    [
      subscription.customer,
      subscription.id,
      subscription.status || "inactive",
      plan,
      normalisePeriodEnd(subscription.current_period_end),
      Boolean(subscription.cancel_at_period_end),
      familyId,
    ],
  );

  return updated.rows[0];
}

adminRouter.get(
  "/overview",
  asyncHandler(async (req, res) => {
    const [families, users, children, logs, subscriptions] = await Promise.all([
      query("SELECT count(*)::int AS count FROM families WHERE deleted_at IS NULL"),
      query("SELECT count(*)::int AS count FROM users WHERE deleted_at IS NULL"),
      query("SELECT count(*)::int AS count FROM children WHERE deleted_at IS NULL"),
      query("SELECT count(*)::int AS count FROM care_logs WHERE deleted_at IS NULL"),
      query(
        `
          SELECT
            count(*) FILTER (WHERE status IN ('active', 'trialing'))::int AS active,
            count(*) FILTER (WHERE status NOT IN ('active', 'trialing'))::int AS inactive
          FROM subscriptions
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
        stripeSetup: {
          hasSecretKey: Boolean(config.stripeSecretKey),
          hasWebhookSecret: Boolean(config.stripeWebhookSecret),
          hasPriceId: Boolean(config.stripePriceId),
          priceId: config.stripePriceId || null,
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

    const { rows } = await query(
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

    await writeAudit(req, {
      entityType: "platform_setting",
      entityId: null,
      action: "platform_feedback_setting_updated",
      metadata: { enabled },
    });

    res.json({
      data: {
        enabled: rows[0]?.value?.enabled !== false,
      },
      error: null,
    });
  }),
);

adminRouter.get(
  "/issues",
  asyncHandler(async (req, res) => {
    const { rows } = await query(
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

    res.json({ data: rows, error: null });
  }),
);

adminRouter.patch(
  "/issues/:issueId",
  asyncHandler(async (req, res) => {
    const issueId = requireUuid(req.params.issueId, "Issue ID");
    const status = requireEnum(req.body, "status", issueStatuses, "Status");

    const { rows } = await query(
      `
        UPDATE issue_reports
        SET status = $1,
            updated_at = now()
        WHERE id = $2
        RETURNING
          id,
          status,
          updated_at AS "updatedAt"
      `,
      [status, issueId],
    );

    if (!rows[0]) {
      throw notFound("Issue report not found.");
    }

    await writeAudit(req, {
      entityType: "issue_report",
      entityId: issueId,
      action: "platform_issue_status_updated",
      metadata: { status },
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
          COALESCE(s.plan, 'free') AS plan,
          count(DISTINCT fm.id)::int AS "memberCount",
          count(DISTINCT c.id)::int AS "childCount",
          count(DISTINCT cl.id)::int AS "logCount"
        FROM families f
        LEFT JOIN users u ON u.id = f.created_by_user_id
        LEFT JOIN subscriptions s ON s.family_id = f.id
        LEFT JOIN family_members fm ON fm.family_id = f.id AND fm.deleted_at IS NULL
        LEFT JOIN children c ON c.family_id = f.id AND c.deleted_at IS NULL
        LEFT JOIN care_logs cl ON cl.family_id = f.id AND cl.deleted_at IS NULL
        WHERE f.deleted_at IS NULL
        GROUP BY f.id, u.full_name, u.email, s.status, s.plan
        ORDER BY f.created_at DESC
        LIMIT 100
      `,
    );

    res.json({ data: rows, error: null });
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
          COALESCE(s.status, 'inactive') AS "subscriptionStatus",
          COALESCE(s.plan, 'free') AS plan,
          s.current_period_end AS "currentPeriodEnd",
          s.stripe_customer_id AS "stripeCustomerId",
          s.stripe_subscription_id AS "stripeSubscriptionId",
          s.cancel_at_period_end AS "cancelAtPeriodEnd"
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
          SELECT
            id,
            first_name AS "firstName",
            last_name AS "lastName",
            date_of_birth::text AS "dateOfBirth",
            created_at AS "createdAt"
          FROM children
          WHERE family_id = $1
            AND deleted_at IS NULL
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
          count(DISTINCT cl.id)::int AS "logCount"
        FROM users u
        LEFT JOIN family_members fm ON fm.user_id = u.id AND fm.deleted_at IS NULL
        LEFT JOIN care_logs cl ON cl.created_by_user_id = u.id AND cl.deleted_at IS NULL
        WHERE u.deleted_at IS NULL
        GROUP BY u.id
        ORDER BY u.created_at DESC
        LIMIT 100
      `,
    );

    res.json({ data: rows, error: null });
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
            COALESCE(s.status, 'inactive') AS "subscriptionStatus"
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

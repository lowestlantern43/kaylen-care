import { Router } from "express";
import { query, withTransaction } from "../db/pool.js";
import { requireAuth } from "../middleware/auth.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { badRequest, unauthorized } from "../utils/httpError.js";
import { sendAppEmail, welcomeEmail } from "../services/email.js";
import { hashPassword, verifyPassword } from "../utils/passwords.js";
import {
  clearSessionCookie,
  createSessionToken,
  setSessionCookie,
} from "../utils/sessions.js";
import {
  optionalDate,
  optionalString,
  requireEmail,
  requirePassword,
  requireString,
} from "../validators/simple.js";
import { buildPlanAccess, ensurePlanAccessSchema } from "../services/planAccess.js";

export const authRouter = Router();

function publicUser(row) {
  return {
    id: row.id,
    email: row.email,
    fullName: row.full_name,
    isPlatformAdmin: row.is_platform_admin,
    platformStatus: row.platform_status,
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at,
  };
}

async function loadMemberships(userId) {
  await ensurePlanAccessSchema();

  const { rows } = await query(
    `
      SELECT
        fm.family_id AS "familyId",
        fm.role,
        f.name AS "familyName",
        f.platform_status AS "platformStatus",
        COALESCE(s.status, 'trialing') AS "subscriptionStatus",
        COALESCE(s.plan, 'trial') AS plan,
        s.trial_ends_at AS "trialEndsAt",
        s.access_paused_at AS "accessPausedAt",
        count(DISTINCT c.id)::int AS "childCount",
        count(DISTINCT active_fm.id)::int AS "memberCount"
      FROM family_members fm
      INNER JOIN families f ON f.id = fm.family_id
      LEFT JOIN subscriptions s ON s.family_id = f.id
      LEFT JOIN children c ON c.family_id = f.id AND c.deleted_at IS NULL
      LEFT JOIN family_members active_fm ON active_fm.family_id = f.id AND active_fm.deleted_at IS NULL
      WHERE fm.user_id = $1
        AND fm.deleted_at IS NULL
        AND f.deleted_at IS NULL
        AND f.platform_status <> 'suspended'
      GROUP BY fm.family_id, fm.role, f.name, f.platform_status, s.status, s.plan, s.trial_ends_at, s.access_paused_at, fm.joined_at
      ORDER BY fm.joined_at ASC
    `,
    [userId],
  );

  return rows.map((row) => ({ ...row, access: buildPlanAccess(row) }));
}

authRouter.post(
  "/signup",
  asyncHandler(async (req, res) => {
    const email = requireEmail(req.body);
    const password = requirePassword(req.body);
    const fullName = requireString(req.body, "fullName", "Full name");
    const familyName = optionalString(req.body, "familyName");
    const childFirstName = optionalString(req.body, "childFirstName");
    const childDateOfBirth = optionalDate(req.body, "childDateOfBirth");
    const passwordHash = await hashPassword(password);
    await ensurePlanAccessSchema();

    const result = await withTransaction(async (client) => {
      const existing = await client.query(
        "SELECT id FROM users WHERE lower(email) = lower($1) AND deleted_at IS NULL LIMIT 1",
        [email],
      );

      if (existing.rows[0]) {
        throw badRequest("An account already exists for that email.");
      }

      const createdUser = await client.query(
        `
          INSERT INTO users (email, password_hash, full_name)
          VALUES ($1, $2, $3)
          RETURNING
            id,
            email,
            full_name,
            is_platform_admin,
            platform_status,
            created_at,
            last_login_at
        `,
        [email, passwordHash, fullName],
      );

      const user = createdUser.rows[0];
      let family = null;
      let child = null;

      if (familyName) {
        const createdFamily = await client.query(
          `
            INSERT INTO families (name, created_by_user_id)
            VALUES ($1, $2)
            RETURNING id, name
          `,
          [familyName, user.id],
        );

        family = createdFamily.rows[0];

        await client.query(
          "INSERT INTO family_members (family_id, user_id, role) VALUES ($1, $2, 'owner')",
          [family.id, user.id],
        );

        await client.query(
          `
            INSERT INTO subscriptions (
              family_id,
              status,
              plan,
              trial_started_at,
              trial_ends_at
            )
            VALUES ($1, 'trialing', 'trial', now(), now() + interval '30 days')
          `,
          [family.id],
        );

        if (childFirstName) {
          const createdChild = await client.query(
            `
              INSERT INTO children (family_id, first_name, date_of_birth, created_by_user_id)
              VALUES ($1, $2, $3, $4)
              RETURNING id, first_name AS "firstName", date_of_birth::text AS "dateOfBirth"
            `,
            [family.id, childFirstName, childDateOfBirth, user.id],
          );

          child = createdChild.rows[0];
        }
      }

      return { user, family, child };
    });

    setSessionCookie(res, createSessionToken(result.user));
    const welcome = welcomeEmail({ fullName: result.user.full_name });
    sendAppEmail({
      to: result.user.email,
      ...welcome,
      metadata: { type: "welcome", userId: result.user.id },
    }).catch((error) =>
      console.error("Welcome email failed:", error.message),
    );

    res.status(201).json({
      data: {
        user: publicUser(result.user),
        family: result.family,
        child: result.child,
      },
      error: null,
    });
  }),
);

authRouter.post(
  "/login",
  asyncHandler(async (req, res) => {
    const email = requireEmail(req.body);
    const password = requireString(req.body, "password", "Password");

    const { rows } = await query(
      `
        SELECT
          id,
          email,
          password_hash,
          full_name,
          is_platform_admin,
          platform_status,
          created_at,
          last_login_at
        FROM users
        WHERE lower(email) = lower($1) AND deleted_at IS NULL
        LIMIT 1
      `,
      [email],
    );

    const user = rows[0];

    if (!user || !(await verifyPassword(password, user.password_hash))) {
      throw unauthorized("Email or password is incorrect.");
    }

    if (user.platform_status === "suspended") {
      throw unauthorized("This account is currently suspended.");
    }

    await query("UPDATE users SET last_login_at = now() WHERE id = $1", [user.id]);
    setSessionCookie(res, createSessionToken(user));

    res.json({
      data: {
        user: publicUser(user),
        memberships: await loadMemberships(user.id),
      },
      error: null,
    });
  }),
);

authRouter.post("/logout", (req, res) => {
  clearSessionCookie(res);
  res.json({ data: { ok: true }, error: null });
});

authRouter.get(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json({
      data: {
        user: publicUser(req.user),
        memberships: await loadMemberships(req.user.id),
      },
      error: null,
    });
  }),
);

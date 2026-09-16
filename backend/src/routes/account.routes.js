import { Router } from "express";
import { query } from "../db/pool.js";
import { requireAuth } from "../middleware/auth.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { badRequest, unauthorized } from "../utils/httpError.js";
import { hashPassword, verifyPassword } from "../utils/passwords.js";
import { requirePassword, requireString } from "../validators/simple.js";
import { ensureAccountDeletionSchema, automaticallyDeleteUnlinkedAccount } from "../services/accountDeletion.js";
import { clearSessionCookie } from "../utils/sessions.js";
import { PRIVACY_VERSION, CONSENT_TEXT, ensurePrivacySchema, privacyStatus } from "../services/privacyConsent.js";

export const accountRouter = Router();

accountRouter.use(requireAuth);

accountRouter.get("/privacy", asyncHandler(async (req, res) => {
  res.json({ data: await privacyStatus(req.user.id), error: null });
}));
accountRouter.post("/privacy", asyncHandler(async (req, res) => {
  if (typeof req.body?.accepted !== "boolean" || req.body.version !== PRIVACY_VERSION) {
    throw badRequest("Review the current privacy notice and explicitly choose whether to continue.");
  }
  await ensurePrivacySchema();
  await query(`INSERT INTO privacy_consent_events (user_id, version, accepted, statement)
    VALUES ($1, $2, $3, $4)`, [req.user.id, PRIVACY_VERSION, req.body.accepted, CONSENT_TEXT]);
  if (!req.body.accepted) {
    // Revoke this user's delivery endpoints without affecting other carers.
    await query("UPDATE push_subscriptions SET enabled = false WHERE user_id = $1", [req.user.id]);
  }
  res.json({ data: await privacyStatus(req.user.id), error: null });
}));

accountRouter.post("/deletion-request", asyncHandler(async (req, res) => {
  if (requireString(req.body, "confirmText", "Confirmation") !== "DELETE") {
    throw badRequest("Type DELETE to request account deletion.");
  }
  const currentPassword = requireString(req.body, "currentPassword", "Current password");
  const { rows: users } = await query(
    "SELECT password_hash FROM users WHERE id = $1 AND deleted_at IS NULL",
    [req.user.id],
  );
  if (!users[0] || !(await verifyPassword(currentPassword, users[0].password_hash))) {
    throw unauthorized("Current password is incorrect.");
  }
  await ensureAccountDeletionSchema();
  const { rows } = await query(`
    INSERT INTO account_deletion_requests (user_id) VALUES ($1)
    ON CONFLICT (user_id) DO UPDATE SET user_id = EXCLUDED.user_id
    RETURNING requested_at AS "requestedAt", completed_at AS "completedAt"
  `, [req.user.id]);
  let deleted = false;
  if (!req.user.is_platform_admin) {
    try { deleted = await automaticallyDeleteUnlinkedAccount(req.user.id); }
    catch (error) {
      // The durable request survives a failed transaction; never report deletion
      // when a new foreign-key reference appeared or the database rejected it.
      console.error("Automatic account deletion deferred", { code: error.code || "unknown" });
    }
  }
  if (deleted) clearSessionCookie(res);
  res.json({ data: { ...rows[0], status: deleted ? "deleted" : "pending" }, error: null });
}));

async function ensureUserPreferencesSchema() {
  await query(`
    CREATE TABLE IF NOT EXISTS user_preferences (
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      key TEXT NOT NULL,
      value JSONB NOT NULL DEFAULT '{}'::JSONB,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, key)
    )
  `);
}

accountRouter.post(
  "/password",
  asyncHandler(async (req, res) => {
    const currentPassword = requireString(
      req.body,
      "currentPassword",
      "Current password",
    );
    const newPassword = requirePassword(req.body, "newPassword");

    if (currentPassword === newPassword) {
      throw badRequest("New password must be different.");
    }

    const { rows } = await query(
      `
        SELECT id, password_hash
        FROM users
        WHERE id = $1
          AND deleted_at IS NULL
        LIMIT 1
      `,
      [req.user.id],
    );

    if (!rows[0] || !(await verifyPassword(currentPassword, rows[0].password_hash))) {
      throw unauthorized("Current password is incorrect.");
    }

    await query(
      `
        UPDATE users
        SET password_hash = $1,
            reset_token_hash = null,
            reset_token_expires_at = null
        WHERE id = $2
      `,
      [await hashPassword(newPassword), req.user.id],
    );

    res.json({ data: { changed: true }, error: null });
  }),
);

accountRouter.get(
  "/preferences/:key",
  asyncHandler(async (req, res) => {
    await ensureUserPreferencesSchema();
    const key = requireString(req.params, "key", "Preference key");

    const { rows } = await query(
      `
        SELECT value
        FROM user_preferences
        WHERE user_id = $1
          AND key = $2
        LIMIT 1
      `,
      [req.user.id, key],
    );

    res.json({ data: rows[0]?.value || {}, error: null });
  }),
);

accountRouter.patch(
  "/preferences/:key",
  asyncHandler(async (req, res) => {
    await ensureUserPreferencesSchema();
    const key = requireString(req.params, "key", "Preference key");
    const value =
      req.body?.value && typeof req.body.value === "object" && !Array.isArray(req.body.value)
        ? req.body.value
        : {};

    const { rows } = await query(
      `
        INSERT INTO user_preferences (user_id, key, value, updated_at)
        VALUES ($1, $2, $3, now())
        ON CONFLICT (user_id, key)
        DO UPDATE SET value = EXCLUDED.value,
                      updated_at = now()
        RETURNING value
      `,
      [req.user.id, key, JSON.stringify(value)],
    );

    res.json({ data: rows[0].value, error: null });
  }),
);

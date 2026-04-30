import { Router } from "express";
import { query } from "../db/pool.js";
import { requireAuth } from "../middleware/auth.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { badRequest, unauthorized } from "../utils/httpError.js";
import { hashPassword, verifyPassword } from "../utils/passwords.js";
import { requirePassword, requireString } from "../validators/simple.js";

export const accountRouter = Router();

accountRouter.use(requireAuth);

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

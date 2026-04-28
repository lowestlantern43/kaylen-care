import { Router } from "express";
import { query } from "../db/pool.js";
import { requireAuth } from "../middleware/auth.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { badRequest, unauthorized } from "../utils/httpError.js";
import { hashPassword, verifyPassword } from "../utils/passwords.js";
import { requirePassword, requireString } from "../validators/simple.js";

export const accountRouter = Router();

accountRouter.use(requireAuth);

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

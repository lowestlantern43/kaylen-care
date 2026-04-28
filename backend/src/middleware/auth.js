import { query } from "../db/pool.js";
import { sessionCookieName, verifySessionToken } from "../utils/sessions.js";
import { forbidden, unauthorized } from "../utils/httpError.js";

export async function requireAuth(req, res, next) {
  try {
    const token = req.cookies?.[sessionCookieName];

    if (!token) {
      throw unauthorized();
    }

    const payload = verifySessionToken(token);

    const { rows } = await query(
      `
        SELECT
          id,
          email,
          full_name,
          is_platform_admin,
          platform_status,
          created_at,
          last_login_at
        FROM users
        WHERE id = $1 AND deleted_at IS NULL
        LIMIT 1
      `,
      [payload.sub],
    );

    if (!rows[0]) {
      throw unauthorized();
    }

    if (rows[0].platform_status === "suspended") {
      throw forbidden("This account is currently suspended.");
    }

    req.user = rows[0];
    next();
  } catch (error) {
    next(error.status ? error : unauthorized());
  }
}

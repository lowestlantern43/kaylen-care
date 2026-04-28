import dotenv from "dotenv";
import { query, pool } from "../db/pool.js";

dotenv.config();

const email = process.argv[2];

if (!email) {
  console.error("Usage: node src/scripts/make-platform-admin.js you@example.com");
  process.exit(1);
}

try {
  const { rows } = await query(
    `
      UPDATE users
      SET is_platform_admin = true
      WHERE lower(email) = lower($1)
        AND deleted_at IS NULL
      RETURNING id, email, full_name
    `,
    [email],
  );

  if (!rows[0]) {
    console.error("No active user found for that email.");
    process.exitCode = 1;
  } else {
    console.log(`Platform admin enabled for ${rows[0].email}.`);
  }
} finally {
  await pool.end().catch(() => null);
}

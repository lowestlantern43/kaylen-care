import { query, withTransaction } from "../db/pool.js";

export async function ensureAccountDeletionSchema() {
  await query(`CREATE TABLE IF NOT EXISTS account_deletion_requests (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at TIMESTAMPTZ
  )`);
}

// The transaction rolls back in full whenever shared ownership, external
// billing/storage, or an unhandled reference needs a separate cleanup step.
export async function automaticallyDeleteUnlinkedAccount(userId) {
  return withTransaction(async (client) => {
    await client.query("SELECT id FROM users WHERE id = $1 FOR UPDATE", [userId]);
    const { rows: families } = await client.query(`
      SELECT f.id, f.created_by_user_id AS "creatorId" FROM families f
      WHERE f.created_by_user_id = $1 OR EXISTS (
        SELECT 1 FROM family_members m WHERE m.family_id = f.id AND m.user_id = $1
      ) ORDER BY f.id FOR UPDATE
    `, [userId]);
    for (const family of families) {
      if (family.creatorId !== userId) return false;
      await client.query("SELECT id FROM family_members WHERE family_id = $1 FOR UPDATE", [family.id]);
      const { rows: blockers } = await client.query(`
        SELECT 1 WHERE
          EXISTS (SELECT 1 FROM family_members WHERE family_id = $1 AND user_id <> $2 AND deleted_at IS NULL)
          OR EXISTS (SELECT 1 FROM subscriptions WHERE family_id = $1 AND
            (stripe_customer_id IS NOT NULL OR stripe_subscription_id IS NOT NULL))
          OR EXISTS (SELECT 1 FROM children WHERE family_id = $1 AND avatar_url IS NOT NULL AND avatar_url <> '')
          OR EXISTS (SELECT 1 FROM family_documents WHERE family_id = $1)
          OR EXISTS (SELECT 1 FROM issue_reports WHERE family_id = $1)
          OR EXISTS (SELECT 1 FROM care_logs WHERE family_id = $1 AND data::text ~* 'https?://')
      `, [family.id, userId]);
      if (blockers.length) return false;
    }
    // All selected workspaces belong exclusively to this account and have no
    // known external billing/files. Their care records cascade with the family.
    for (const family of families) {
      await client.query("DELETE FROM audit_logs WHERE family_id = $1", [family.id]);
      await client.query("DELETE FROM families WHERE id = $1", [family.id]);
    }
    await client.query("DELETE FROM audit_logs WHERE user_id = $1 OR entity_id = $1", [userId]);
    const { rows: references } = await client.query(`
      SELECT ns.nspname AS schema, t.relname AS table, a.attname AS column
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_namespace ns ON ns.oid = t.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
      WHERE c.contype = 'f' AND c.confrelid = 'users'::regclass
        AND array_length(c.conkey, 1) = 1
    `);
    const disposable = new Set(["privacy_consent_events", "account_deletion_requests", "user_preferences", "push_subscriptions", "notification_events"]);
    const quote = (identifier) => `"${identifier.replaceAll('"', '""')}"`;
    for (const reference of references) {
      if (reference.schema === "public" && disposable.has(reference.table) && reference.column === "user_id") {
        await client.query(`DELETE FROM ${quote(reference.schema)}.${quote(reference.table)} WHERE user_id = $1`, [userId]);
        continue;
      }
      const { rows } = await client.query(
        `SELECT 1 FROM ${quote(reference.schema)}.${quote(reference.table)} WHERE ${quote(reference.column)} = $1 LIMIT 1`,
        [userId],
      );
      if (rows.length) {
        // Throw so earlier family deletions are rolled back too.
        const error = new Error("Linked records need additional deletion handling.");
        error.code = "DELETION_REQUIRES_REVIEW";
        throw error;
      }
    }
    await client.query("DELETE FROM account_deletion_requests WHERE user_id = $1", [userId]);
    await client.query("DELETE FROM user_preferences WHERE user_id = $1", [userId]);
    await client.query("DELETE FROM users WHERE id = $1", [userId]);
    return true;
  });
}

export async function pendingAccountDeletions() {
  await ensureAccountDeletionSchema();
  const { rows } = await query(`
    SELECT r.user_id AS "userId", r.requested_at AS "requestedAt",
           u.email, u.full_name AS "fullName"
    FROM account_deletion_requests r JOIN users u ON u.id = r.user_id
    WHERE r.completed_at IS NULL ORDER BY r.requested_at
  `);
  return rows;
}

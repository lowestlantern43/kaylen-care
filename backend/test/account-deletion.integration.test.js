import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import crypto from "node:crypto";
import { config } from "../src/config.js";

test("PostgreSQL deletion respects family, billing and file boundaries", {
  skip: !process.env.PRIVACY_TEST_DATABASE_URL,
}, async () => {
  const url = new URL(process.env.PRIVACY_TEST_DATABASE_URL);
  assert.equal(url.hostname, "127.0.0.1");
  assert.equal(url.pathname, "/familytrack_test");
  config.databaseUrl = url.toString();
  const { query, pool } = await import("../src/db/pool.js");
  const { ensureAccountDeletionSchema, automaticallyDeleteUnlinkedAccount } = await import("../src/services/accountDeletion.js");
  try {
    const directory = new URL("../../database/migrations/", import.meta.url);
    for (const file of (await fs.readdir(directory)).filter(f => f.endsWith(".sql")).sort()) {
      await query(await fs.readFile(new URL(file, directory), "utf8"));
    }
    await ensureAccountDeletionSchema();
    async function fixture() {
      const user = crypto.randomUUID(), family = crypto.randomUUID(), child = crypto.randomUUID();
      await query("INSERT INTO users (id,email,password_hash,full_name) VALUES ($1,$2,'test','Demo')", [user, `${user}@example.invalid`]);
      await query("INSERT INTO families (id,name,created_by_user_id) VALUES ($1,'Demo',$2)", [family,user]);
      await query("INSERT INTO family_members (family_id,user_id,role) VALUES ($1,$2,'owner')", [family,user]);
      await query("INSERT INTO children (id,family_id,first_name,created_by_user_id) VALUES ($1,$2,'Demo',$3)", [child,family,user]);
      await query("INSERT INTO care_logs (family_id,child_id,created_by_user_id,category,log_date) VALUES ($1,$2,$3,'food',CURRENT_DATE)", [family,child,user]);
      await query("INSERT INTO account_deletion_requests (user_id) VALUES ($1)", [user]);
      return { user, family, child };
    }
    const solo = await fixture();
    assert.equal(await automaticallyDeleteUnlinkedAccount(solo.user), true);
    assert.equal((await query("SELECT id FROM users WHERE id=$1", [solo.user])).rowCount, 0);
    assert.equal((await query("SELECT id FROM care_logs WHERE family_id=$1", [solo.family])).rowCount, 0);

    const shared = await fixture(), other = await fixture();
    await query("INSERT INTO family_members (family_id,user_id,role) VALUES ($1,$2,'parent')", [shared.family,other.user]);
    assert.equal(await automaticallyDeleteUnlinkedAccount(shared.user), false);
    assert.equal((await query("SELECT id FROM care_logs WHERE family_id=$1", [shared.family])).rowCount, 1);

    const paid = await fixture();
    await query("INSERT INTO subscriptions (family_id,stripe_customer_id) VALUES ($1,$2)", [paid.family, `cus_test_${paid.user}`]);
    assert.equal(await automaticallyDeleteUnlinkedAccount(paid.user), false);

    const photo = await fixture();
    await query("UPDATE children SET avatar_url='https://example.invalid/photo' WHERE id=$1", [photo.child]);
    assert.equal(await automaticallyDeleteUnlinkedAccount(photo.user), false);

    // An unhandled reference must roll back family deletion, not leave half an account.
    const linked = await fixture();
    await query("INSERT INTO issue_reports (user_id,message) VALUES ($1,'Demo')", [linked.user]);
    await assert.rejects(automaticallyDeleteUnlinkedAccount(linked.user));
    assert.equal((await query("SELECT id FROM families WHERE id=$1", [linked.family])).rowCount, 1);
    assert.equal((await query("SELECT user_id FROM account_deletion_requests WHERE user_id=$1", [linked.user])).rowCount, 1);
  } finally { await pool.end(); }
});

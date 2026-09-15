import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import cookieParser from "cookie-parser";
import { errorHandler } from "../src/middleware/errorHandler.js";
import { config } from "../src/config.js";
import { createSessionToken, sessionCookieName } from "../src/utils/sessions.js";
import { hashPassword } from "../src/utils/passwords.js";
config.databaseUrl = "postgres://test:test@127.0.0.1:1/test";
const { accountRouter } = await import("../src/routes/account.routes.js");
const { pool } = await import("../src/db/pool.js");

test("deletion requests require authentication, password and confirmation; retries keep the same request", async () => {
  config.sessionSecret = "test-only-session-secret";
  const id = "11111111-1111-4111-8111-111111111111";
  const password = "test-only-password";
  const hash = await hashPassword(password);
  const originalQuery = pool.query;
  const originalConnect = pool.connect;
  pool.connect = async () => ({
    query: async (sql) => {
      if (sql.includes("pg_constraint")) return { rows: [{ schema: "public", table: "families", column: "created_by_user_id" }] };
      if (sql.includes('SELECT 1 FROM "public"."families"')) return { rows: [{ exists: 1 }] };
      return { rows: [] };
    }, release() {},
  });
  let writes = 0;
  pool.query = async (sql, params) => {
    if (sql.includes("SELECT password_hash")) return { rows: [{ password_hash: hash }] };
    if (sql.includes("FROM users")) return { rows: [{ id, email: "demo@example.invalid", platform_status: "active" }] };
    if (sql.includes("CREATE TABLE")) return { rows: [] };
    if (sql.includes("INSERT INTO account_deletion_requests")) {
      assert.deepEqual(params, [id]);
      assert.match(sql, /ON CONFLICT \(user_id\)/);
      writes++;
      return { rows: [{ requestedAt: "2026-09-15T12:00:00Z", completedAt: null }] };
    }
    throw new Error("Unexpected database operation");
  };
  const app = express();
  app.use(express.json(), cookieParser());
  app.use("/account", accountRouter);
  app.use(errorHandler);
  const server = await new Promise(resolve => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  const cookie = `${sessionCookieName}=${createSessionToken({ id, email: "demo@example.invalid" })}`;
  async function submit(body, authenticated = true) {
    return fetch(`http://127.0.0.1:${server.address().port}/account/deletion-request`, {
      method: "POST", headers: { "Content-Type": "application/json", ...(authenticated ? { cookie } : {}) },
      body: JSON.stringify(body),
    });
  }
  try {
    assert.equal((await submit({ confirmText: "DELETE", currentPassword: password }, false)).status, 401);
    assert.equal((await submit({ confirmText: "DELETE", currentPassword: "wrong" })).status, 401);
    assert.equal((await submit({ confirmText: "wrong", currentPassword: password })).status, 400);
    assert.equal(writes, 0);
    const first = await (await submit({ confirmText: "DELETE", currentPassword: password })).json();
    const second = await (await submit({ confirmText: "DELETE", currentPassword: password })).json();
    assert.equal(first.data.status, "pending");
    assert.equal(first.data.requestedAt, second.data.requestedAt);
  } finally {
    pool.query = originalQuery;
    pool.connect = originalConnect;
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});

test("automatic deletion commits only for unlinked accounts and rolls back failures", async () => {
  const { automaticallyDeleteUnlinkedAccount } = await import("../src/services/accountDeletion.js");
  const originalConnect = pool.connect;
  const statements = [];
  let rejectDelete = false;
  pool.connect = async () => ({ query: async (sql) => {
    statements.push(sql);
    if (rejectDelete && sql.startsWith("DELETE FROM users")) throw new Error("foreign key restriction");
    return { rows: [] };
  }, release() {} });
  try {
    assert.equal(await automaticallyDeleteUnlinkedAccount("demo-id"), true);
    assert.ok(statements.includes("COMMIT"));
    assert.ok(statements.includes("DELETE FROM users WHERE id = $1"));
    rejectDelete = true;
    statements.length = 0;
    await assert.rejects(automaticallyDeleteUnlinkedAccount("demo-id"));
    assert.ok(statements.includes("ROLLBACK"));
    assert.ok(!statements.includes("COMMIT"));
  } finally { pool.connect = originalConnect; }
});

import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import cookieParser from "cookie-parser";
import { config } from "../src/config.js";
import { createSessionToken, sessionCookieName } from "../src/utils/sessions.js";
import { errorHandler } from "../src/middleware/errorHandler.js";
config.databaseUrl = "postgres://test:test@127.0.0.1:1/test";
config.sessionSecret = "privacy-consent-test-only";
process.env.PRIVACY_CONSENT_REQUIRED = "true";
const { pool } = await import("../src/db/pool.js");
const { accountRouter } = await import("../src/routes/account.routes.js");
const { requireAuth } = await import("../src/middleware/auth.js");
const { PRIVACY_VERSION, requirePrivacyConsent } = await import("../src/services/privacyConsent.js");

test("care access requires current recorded consent, withdrawal revokes access, and account controls stay available", async () => {
  const original = pool.query;
  const id = "11111111-1111-4111-8111-111111111111";
  let latest = null, disabled = false;
  const events = [];
  pool.query = async (sql, params) => {
    if (sql.includes("FROM users")) return { rows: [{ id, email: "test@example.invalid", platform_status: "active" }] };
    if (sql.includes("CREATE TABLE")) return { rows: [] };
    if (sql.includes("INSERT INTO privacy_consent_events")) {
      assert.equal(params[0], id); events.push(params);
      latest = { accepted: params[2], version: params[1], recordedAt: new Date().toISOString() };
      return { rows: [] };
    }
    if (sql.includes("FROM privacy_consent_events")) return { rows: latest ? [latest] : [] };
    if (sql.includes("UPDATE push_subscriptions")) { disabled = true; return { rows: [] }; }
    throw new Error("Unexpected query: " + sql);
  };
  const app = express(); app.use(express.json(), cookieParser());
  app.use("/account", accountRouter);
  app.get("/care", requireAuth, requirePrivacyConsent, (req,res) => res.json({ ok: true }));
  app.use(errorHandler);
  const server = await new Promise(resolve => { const s=app.listen(0,"127.0.0.1",()=>resolve(s)); });
  const cookie = `${sessionCookieName}=${createSessionToken({id,email:"test@example.invalid"})}`;
  const request = (path,body,auth=true) => fetch(`http://127.0.0.1:${server.address().port}${path}`, {
    method: body ? "POST" : "GET", headers: {"Content-Type":"application/json", ...(auth?{cookie}:{})},
    ...(body?{body:JSON.stringify(body)}:{})
  });
  try {
    assert.equal((await request("/care",null,false)).status,401);
    assert.equal((await request("/care")).status,403);
    process.env.PRIVACY_CONSENT_REQUIRED = "false";
    assert.equal((await request("/care")).status,200);
    process.env.PRIVACY_CONSENT_REQUIRED = "true";
    assert.equal((await request("/account/privacy")).status,200);
    assert.equal((await request("/account/privacy",{accepted:"true",version:PRIVACY_VERSION})).status,400);
    assert.equal((await request("/account/privacy",{accepted:true,version:"old"})).status,400);
    assert.equal(events.length,0);
    assert.equal((await request("/account/privacy",{accepted:true,version:PRIVACY_VERSION})).status,200);
    assert.equal((await request("/care")).status,200);
    latest.version="old";
    assert.equal((await request("/care")).status,403);
    assert.equal((await request("/account/privacy",{accepted:false,version:PRIVACY_VERSION})).status,200);
    assert.equal((await request("/care")).status,403);
    assert.equal(disabled,true);
    process.env.PRIVACY_CONSENT_REQUIRED = "false";
    assert.equal((await request("/care")).status,403);
    process.env.PRIVACY_CONSENT_REQUIRED = "true";
    assert.equal(events.length,2);
  } finally { pool.query=original; server.closeAllConnections(); await new Promise(resolve=>server.close(resolve)); }
});

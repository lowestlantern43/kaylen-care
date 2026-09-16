import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, verify } from "node:crypto";
import { applePayload, applePushConfig, applePushReady, providerToken } from "../src/services/applePush.js";

test("Apple configuration remains disabled until credentials are supplied", () => {
  assert.equal(applePushReady(applePushConfig({})), false);
  assert.equal(applePushReady({ keyId: "key", teamId: "team", privateKey: "key", environment: "invalid" }), false);
  assert.equal(applePushConfig({ APNS_PRIVATE_KEY: "a\\nb" }).privateKey, "a\nb");
});

test("APNs provider JWT uses a valid ES256 signature and Apple claims", () => {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const token = providerToken({ keyId: "KEY", teamId: "TEAM", privateKey: privateKey.export({ type: "pkcs8", format: "pem" }) }, 1700000000000);
  const [header, claims, signature] = token.split(".");
  assert.deepEqual(JSON.parse(Buffer.from(header, "base64url")), { alg: "ES256", kid: "KEY" });
  assert.deepEqual(JSON.parse(Buffer.from(claims, "base64url")), { iss: "TEAM", iat: 1700000000 });
  assert.equal(verify("sha256", Buffer.from(`${header}.${claims}`), { key: publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(signature, "base64url")), true);
});

test("Apple payload displays an alert with sound and preserves the app destination", () => {
  const body = JSON.parse(applePayload({ title: "Reminder", body: "Due now", url: "/?section=medication", type: "medication" }));
  assert.deepEqual(body.aps, { alert: { title: "Reminder", body: "Due now" }, sound: "default" });
  assert.equal(body.url, "/?section=medication");
});

const queries = [];
let subscriptions = [];
let appleError;
let appleSends = 0;
let webSends = 0;
let queryHandler;
let consentAccepted = true;
process.env.PRIVACY_CONSENT_REQUIRED = "true";
mock.module("../src/db/pool.js", { namedExports: { query: async (sql, params) => {
  queries.push({ sql, params });
  if (sql.includes("FROM privacy_consent_events")) return { rows: [{ accepted: consentAccepted, version: "2026-09-15" }] };
  if (queryHandler) return { rows: queryHandler(sql, params) };
  if (sql.includes("SELECT id, endpoint, subscription")) return { rows: subscriptions };
  return { rows: [{ endpoint: params?.[1] }] };
} } });
mock.module("../src/config.js", { namedExports: { config: { vapidPublicKey: "", vapidPrivateKey: "" } } });
mock.module("../src/services/email.js", { namedExports: { sendAppEmail: async () => ({}), trialEndingReminderEmail: () => ({}) } });
mock.module("web-push", { defaultExport: { sendNotification: async () => { webSends++; } } });
mock.module("../src/services/applePush.js", { namedExports: {
  applePushReady: () => true,
  sendApplePush: async () => { appleSends++; if (appleError) throw appleError; },
} });
const { savePushSubscription, sendPushToUser, runDueReminderScan } = await import("../src/services/pushNotifications.js");

test("withdrawn consent prevents push delivery even if an endpoint remains enabled", async () => {
  consentAccepted = false; appleSends = 0; webSends = 0;
  try {
    const result = await sendPushToUser("user", { title: "Private reminder" });
    assert.equal(result.skipped, true);
    assert.equal(appleSends + webSends, 0);
  } finally { consentAccepted = true; }
});

test("invalid Apple tokens never reach the database insert", async () => {
  queries.length = 0;
  await assert.rejects(savePushSubscription({ userId: "user", subscription: { platform: "ios", token: "../bad" } }), /Invalid Apple/);
  assert.equal(queries.some(({ sql }) => sql.includes("INSERT INTO push_subscriptions")), false);
});

test("saving an iPhone token disconnects the previous account", async () => {
  queries.length = 0;
  const token = "AB".repeat(32);
  await savePushSubscription({ userId: "new-user", subscription: { platform: "ios", token } });
  const disconnect = queries.find(({ sql }) => sql.includes("user_id <> $2"));
  assert.deepEqual(disconnect.params, [`apns:${token.toLowerCase()}`, "new-user"]);
});

test("native delivery works without VAPID and a test is scoped to its owner and endpoint", async () => {
  queries.length = 0;
  appleSends = 0;
  subscriptions = [{ id: "phone", subscription: { platform: "ios", token: "ab".repeat(32) } }];
  const result = await sendPushToUser("user", { title: "Test" }, "apns:device");
  assert.equal(result.sent, 1);
  assert.equal(appleSends, 1);
  assert.equal(webSends, 0);
  const select = queries.find(({ sql }) => sql.includes("SELECT id, endpoint, subscription"));
  assert.deepEqual(select.params, ["user", "apns:device"]);
  assert.match(select.sql, /user_id = \$1/);
  assert.match(select.sql, /endpoint = \$2/);
});

test("expired Apple tokens are disabled; transient failures stay eligible", async () => {
  for (const permanent of [true, false]) {
    queries.length = 0;
    appleError = Object.assign(new Error(permanent ? "Unregistered" : "ServiceUnavailable"), { statusCode: permanent ? 410 : 503 });
    const result = await sendPushToUser("user", { title: "Test" });
    assert.equal(result.failed, 1);
    assert.equal(result.sent, 0);
    const update = queries.find(({ sql }) => sql.includes("SET last_failure_at"));
    assert.equal(Boolean(update.params[2]), permanent);
  }
  appleError = null;
});

test("appointment scan uses the user's local date across midnight and retries failures", async () => {
  queries.length = 0;
  appleSends = 0;
  queryHandler = (sql) => {
    if (sql.includes("cl.category = 'appointment'")) return [{ id: "appointment", family_id: "family", child_id: "child", first_name: "Test", log_date: "2026-09-12", log_time: "00:15", data: {} }];
    if (sql.includes("FROM family_members")) return [{ id: "user", settings: { pushEnabled: true, timeZone: "Asia/Tokyo", types: { appointments: true } } }];
    if (sql.includes("SELECT id, endpoint, subscription")) return [{ id: "phone", subscription: { platform: "ios" } }];
    return [];
  };
  try {
    // Tokyo: 23:45, upcoming appointment at 00:15 next day.
    const result = await runDueReminderScan(new Date("2026-09-11T14:45:00Z"));
    assert.equal(result.appointments, 1);
    assert.equal(appleSends, 1);
    const duplicateCheck = queries.find(({ sql }) => sql.includes("metadata->>'reminderKey'"));
    assert.match(duplicateCheck.sql, /delivery_status = 'sent'/);
    const event = queries.find(({ sql }) => sql.includes("INSERT INTO notification_events"));
    assert.equal(JSON.parse(event.params[8]).reminderKey, "appointment:appointment:2026-09-12");
  } finally { queryHandler = null; }
});

test("medication scan checks the child's local-day logs before sending", async () => {
  for (const status of ["given", "skipped", "pending"]) {
    queries.length = 0;
    appleSends = 0;
    queryHandler = (sql, params) => {
      if (sql.includes("cp.current_medications")) return [{ family_id: "family", child_id: "child", first_name: "Test", current_medications: "Test medicine|1|ml|08:00,18:00|active||required||every_day" }];
      if (sql.includes("FROM family_members")) return [{ id: "user", settings: { pushEnabled: true, timeZone: "Asia/Tokyo", types: { medication: true } } }];
      if (sql.includes("category = 'medication'")) {
        assert.deepEqual(params, ["family", "child", "2026-09-12"]);
        assert.match(sql, /deleted_at IS NULL/);
        return [{ log_time: "07:55:00", data: { medicine: "Test medicine", status } }];
      }
      if (sql.includes("SELECT id, endpoint, subscription")) return [{ id: "phone", subscription: { platform: "ios" } }];
      return [];
    };
    try {
      const result = await runDueReminderScan(new Date("2026-09-11T23:05:00Z"));
      assert.equal(result.medication, status === "pending" ? 1 : 0, status);
      assert.equal(appleSends, status === "pending" ? 1 : 0, status);
      assert.ok(queries.some(({ sql }) => sql.includes("category = 'medication'")));
    } finally { queryHandler = null; }
  }
});

test("no-log nudge is opt-in, respects quiet hours and stops after a care log", async () => {
  for (const scenario of ["enabled", "disabled", "quiet", "logged"]) {
    queryHandler = (sql) => {
      if (sql.includes("SELECT cp.family_id, cp.child_id, cp.quiet_hours")) return [{ family_id: "family", child_id: "child", first_name: "Test", quiet_hours: { enabled: scenario === "quiet", start: "19:00", end: "07:00" } }];
      if (sql.includes("FROM family_members")) return [{ id: "user", settings: { pushEnabled: true, timeZone: "Europe/London", types: { noLogsToday: scenario !== "disabled" } } }];
      if (sql.includes("SELECT id FROM care_logs")) return scenario === "logged" ? [{ id: "log" }] : [];
      if (sql.includes("SELECT id, endpoint, subscription")) return [{ id: "phone", subscription: { platform: "ios" } }];
      return [];
    };
    try {
      const result = await runDueReminderScan(new Date("2026-09-11T19:05:00Z"));
      assert.equal(result.noLogsToday, scenario === "enabled" ? 1 : 0, scenario);
    } finally { queryHandler = null; }
  }
});

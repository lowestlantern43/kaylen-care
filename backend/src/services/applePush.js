import http2 from "node:http2";
import { createPrivateKey, sign } from "node:crypto";

export function applePushConfig(env = process.env) {
  return {
    keyId: env.APNS_KEY_ID,
    teamId: env.APNS_TEAM_ID,
    privateKey: env.APNS_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    topic: env.APNS_TOPIC || "care.familytrack.app",
    environment: env.APNS_ENVIRONMENT || "production",
  };
}

export function applePushReady(settings = applePushConfig()) {
  return Boolean(settings.keyId && settings.teamId && settings.privateKey &&
    ["production", "sandbox"].includes(settings.environment));
}

export function applePayload(payload) {
  return JSON.stringify({
    aps: { alert: { title: payload.title, body: payload.body }, sound: "default" },
    url: payload.url || "/",
    type: payload.type,
  });
}

export function providerToken(settings, now = Date.now()) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const content = `${encode({ alg: "ES256", kid: settings.keyId })}.${encode({ iss: settings.teamId, iat: Math.floor(now / 1000) })}`;
  return `${content}.${sign("sha256", Buffer.from(content), {
    key: createPrivateKey(settings.privateKey), dsaEncoding: "ieee-p1363",
  }).toString("base64url")}`;
}

export async function sendApplePush(subscription, payload, settings = applePushConfig()) {
  if (!applePushReady(settings)) throw new Error("Apple notifications are awaiting server setup.");
  // The server chooses the APNs environment; clients cannot choose a destination.
  const host = settings.environment === "sandbox" ? "api.sandbox.push.apple.com" : "api.push.apple.com";
  const body = applePayload(payload);
  if (Buffer.byteLength(body) > 4096) throw new Error("Apple notification is too large.");
  const authorization = `bearer ${providerToken(settings)}`;
  return new Promise((resolve, reject) => {
    const client = http2.connect(`https://${host}`);
    let done = false;
    const finish = (error) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      client.destroy();
      error ? reject(error) : resolve();
    };
    const timer = setTimeout(() => finish(new Error("Apple notification request timed out.")), 15000);
    client.on("error", finish);
    const request = client.request({
      ":method": "POST", ":path": `/3/device/${subscription.token}`,
      authorization, "apns-topic": settings.topic, "apns-push-type": "alert",
      "apns-priority": "10", "apns-expiration": String(Math.floor(Date.now() / 1000) + 3600),
    });
    let status;
    let response = "";
    request.on("response", (headers) => { status = headers[":status"]; });
    request.on("data", (chunk) => { response += chunk; });
    request.on("error", finish);
    request.on("end", () => {
      if (status === 200) return finish();
      let reason = "Apple notification request failed.";
      try { reason = JSON.parse(response).reason || reason; } catch { /* No JSON response. */ }
      const error = new Error(reason);
      error.statusCode = status;
      error.disableSubscription = status === 410 || ["BadDeviceToken", "DeviceTokenNotForTopic"].includes(reason);
      finish(error);
    });
    request.end(body);
  });
}

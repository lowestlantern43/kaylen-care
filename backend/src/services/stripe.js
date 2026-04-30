import crypto from "crypto";
import { config } from "../config.js";
import { badRequest } from "../utils/httpError.js";

const stripeApiBaseUrl = "https://api.stripe.com/v1";

function requireStripeConfig() {
  if (!config.stripeSecretKey) {
    throw badRequest("Stripe is not configured yet. Add STRIPE_SECRET_KEY to the backend environment.");
  }
}

async function stripeRequest(path, { method = "POST", body } = {}) {
  requireStripeConfig();

  const response = await fetch(`${stripeApiBaseUrl}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${config.stripeSecretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    const message =
      payload?.error?.message || "Stripe returned an unexpected error.";
    throw badRequest(message);
  }

  return payload;
}

export async function createStripeCustomer({ email, name, familyId, familyName }) {
  const params = new URLSearchParams();
  params.set("email", email);
  if (name) params.set("name", name);
  params.set("metadata[family_id]", familyId);
  params.set("metadata[family_name]", familyName);

  return stripeRequest("/customers", { body: params });
}

export async function createStripeCheckoutSession({
  customerId,
  familyId,
  familyName,
}) {
  if (!config.stripePriceId) {
    throw badRequest("Stripe price is not configured yet. Add STRIPE_FAMILY_PRICE_ID to the backend environment.");
  }

  const params = new URLSearchParams();
  params.set("mode", "subscription");
  params.set("customer", customerId);
  params.set("line_items[0][price]", config.stripePriceId);
  params.set("line_items[0][quantity]", "1");
  params.set(
    "success_url",
    `${config.frontendUrl}?billing=success&session_id={CHECKOUT_SESSION_ID}`,
  );
  params.set("cancel_url", `${config.frontendUrl}?billing=cancelled`);
  params.set("client_reference_id", familyId);
  params.set("metadata[family_id]", familyId);
  params.set("metadata[family_name]", familyName);
  params.set("metadata[plan]", "family");
  params.set("subscription_data[metadata][family_id]", familyId);
  params.set("subscription_data[metadata][family_name]", familyName);
  params.set("subscription_data[metadata][plan]", "family");

  return stripeRequest("/checkout/sessions", { body: params });
}

export async function createStripeBillingPortalSession(customerId) {
  const params = new URLSearchParams();
  params.set("customer", customerId);
  params.set("return_url", config.frontendUrl);

  return stripeRequest("/billing_portal/sessions", { body: params });
}

export async function listStripeCustomerSubscriptions(customerId) {
  return stripeRequest(
    `/subscriptions?customer=${encodeURIComponent(customerId)}&status=all&limit=10`,
    { method: "GET" },
  );
}

export async function retrieveStripeSubscription(subscriptionId) {
  return stripeRequest(`/subscriptions/${subscriptionId}`, { method: "GET" });
}

export function verifyStripeWebhookSignature(rawBody, signatureHeader) {
  if (!config.stripeWebhookSecret) {
    throw badRequest("Stripe webhook secret is not configured.");
  }

  const parts = String(signatureHeader || "")
    .split(",")
    .map((part) => part.split("="));
  const timestamp = parts.find(([key]) => key === "t")?.[1];
  const signatures = parts
    .filter(([key]) => key === "v1")
    .map(([, value]) => value);

  if (!timestamp || !signatures.length) {
    throw badRequest("Stripe webhook signature is missing.");
  }

  const expected = crypto
    .createHmac("sha256", config.stripeWebhookSecret)
    .update(`${timestamp}.${rawBody.toString("utf8")}`)
    .digest("hex");

  const isValid = signatures.some((signature) => {
    const expectedBuffer = Buffer.from(expected, "hex");
    const receivedBuffer = Buffer.from(signature, "hex");
    return (
      expectedBuffer.length === receivedBuffer.length &&
      crypto.timingSafeEqual(expectedBuffer, receivedBuffer)
    );
  });

  if (!isValid) {
    throw badRequest("Stripe webhook signature is invalid.");
  }
}

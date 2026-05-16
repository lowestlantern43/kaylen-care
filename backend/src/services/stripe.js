import crypto from "crypto";
import { config } from "../config.js";
import { getStripeBillingSettings } from "./stripeBillingSettings.js";
import { badRequest } from "../utils/httpError.js";
import { safeFrontendUrl } from "../utils/frontendUrl.js";

const stripeApiBaseUrl = "https://api.stripe.com/v1";

function requireStripeConfig() {
  if (!config.stripeSecretKey) {
    throw badRequest("Stripe is not configured yet. Add STRIPE_SECRET_KEY to the backend environment.");
  }
}

async function stripeRequest(path, { method = "POST", body } = {}) {
  requireStripeConfig();

  const options = {
    method,
    headers: {
      Authorization: `Bearer ${config.stripeSecretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
  };

  if (body) {
    options.body = body;
  }

  const response = await fetch(`${stripeApiBaseUrl}${path}`, options);

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

export function normalisePromotionCode(value = "") {
  return String(value).trim().toUpperCase();
}

export async function findActiveStripePromotionCode(code) {
  const promotionCode = normalisePromotionCode(code);
  if (!promotionCode) return null;

  const payload = await stripeRequest(
    `/promotion_codes?code=${encodeURIComponent(promotionCode)}&active=true&limit=1`,
    { method: "GET" },
  );

  return payload.data?.[0] || null;
}

export function extractStripeDiscountInfo(subscription = {}) {
  const discount =
    subscription.discount ||
    (Array.isArray(subscription.discounts) ? subscription.discounts[0] : null) ||
    null;
  const coupon = discount?.coupon || null;
  const promotionCode = discount?.promotion_code || null;

  return {
    stripePromotionCodeId:
      typeof promotionCode === "string" ? promotionCode : promotionCode?.id || null,
    stripePromotionCode:
      promotionCode && typeof promotionCode === "object"
        ? promotionCode.code || null
        : null,
    stripeCouponId: coupon?.id || null,
    stripeCouponName: coupon?.name || null,
    stripeDiscountPercentOff: coupon?.percent_off ?? null,
    stripeDiscountAmountOff: coupon?.amount_off ?? null,
    stripeDiscountCurrency: coupon?.currency || null,
  };
}

export async function createStripeCheckoutSession({
  customerId,
  familyId,
  familyName,
  userId = "",
  email = "",
  priceId = "",
  plan = "family",
  trialPeriodDays = config.proTrialDays,
  successPath = "",
  cancelPath = "",
  metadata = {},
  promotionCodeId = "",
  promotionCode = "",
  frontendUrl = "",
}) {
  const effectiveBilling = priceId
    ? null
    : await getStripeBillingSettings();
  const resolvedPriceId =
    priceId || effectiveBilling?.stripeMonthlyPriceId || "";

  if (!resolvedPriceId) {
    throw badRequest(
      "Stripe price is not configured yet. Add it in Owner Platform - Billing or set STRIPE_PRICE_ID in the backend environment.",
    );
  }

  const checkoutFrontendUrl = safeFrontendUrl(frontendUrl);
  const successDestination = successPath || "/billing/success";
  const cancelDestination = cancelPath || "/billing/cancelled?billing=cancelled";
  const successQueryJoiner = String(successDestination).includes("?")
    ? "&"
    : "?";
  const params = new URLSearchParams();
  params.set("mode", "subscription");
  params.set("customer", customerId);
  params.set("payment_method_collection", "always");
  params.set("line_items[0][price]", resolvedPriceId);
  params.set("line_items[0][quantity]", "1");
  if (Number(trialPeriodDays) > 0) {
    params.set("subscription_data[trial_period_days]", String(Number(trialPeriodDays)));
  }
  if (promotionCodeId) {
    params.set("discounts[0][promotion_code]", promotionCodeId);
  } else {
    params.set("allow_promotion_codes", "true");
  }
  params.set(
    "success_url",
    `${checkoutFrontendUrl}${successDestination}${successQueryJoiner}session_id={CHECKOUT_SESSION_ID}`,
  );
  params.set("cancel_url", `${checkoutFrontendUrl}${cancelDestination}`);
  params.set("client_reference_id", userId || familyId);
  params.set("metadata[family_id]", familyId);
  params.set("metadata[account_id]", familyId);
  if (userId) params.set("metadata[user_id]", userId);
  if (email) params.set("metadata[email]", email);
  params.set("metadata[family_name]", familyName);
  params.set("metadata[plan]", plan);
  params.set("metadata[price_id]", resolvedPriceId);
  Object.entries(metadata).forEach(([key, value]) => {
    if (value !== null && typeof value !== "undefined" && value !== "") {
      params.set(`metadata[${key}]`, String(value));
    }
  });
  if (promotionCode) params.set("metadata[promotion_code]", promotionCode);
  params.set("subscription_data[metadata][family_id]", familyId);
  params.set("subscription_data[metadata][account_id]", familyId);
  if (userId) params.set("subscription_data[metadata][user_id]", userId);
  if (email) params.set("subscription_data[metadata][email]", email);
  params.set("subscription_data[metadata][family_name]", familyName);
  params.set("subscription_data[metadata][plan]", plan);
  params.set("subscription_data[metadata][price_id]", resolvedPriceId);
  Object.entries(metadata).forEach(([key, value]) => {
    if (value !== null && typeof value !== "undefined" && value !== "") {
      params.set(`subscription_data[metadata][${key}]`, String(value));
    }
  });
  if (promotionCode) {
    params.set("subscription_data[metadata][promotion_code]", promotionCode);
  }

  return stripeRequest("/checkout/sessions", { body: params });
}

export async function createStripeBillingPortalSession(customerId, frontendUrl = "") {
  const params = new URLSearchParams();
  params.set("customer", customerId);
  params.set("return_url", safeFrontendUrl(frontendUrl));

  return stripeRequest("/billing_portal/sessions", { body: params });
}

export async function retrieveStripeCheckoutSession(sessionId) {
  const encodedSessionId = encodeURIComponent(sessionId);
  return stripeRequest(
    `/checkout/sessions/${encodedSessionId}?expand[]=customer&expand[]=subscription`,
    { method: "GET" },
  );
}

export async function listStripeCustomerSubscriptions(customerId) {
  return stripeRequest(
    `/subscriptions?customer=${encodeURIComponent(customerId)}&status=all&limit=10`,
    { method: "GET" },
  );
}

export async function listStripePaidInvoices({ limit = 100 } = {}) {
  const params = new URLSearchParams();
  params.set("status", "paid");
  params.set("limit", String(Math.min(Math.max(Number(limit) || 100, 1), 100)));
  params.set("expand[]", "data.customer");
  params.append("expand[]", "data.subscription");
  params.append("expand[]", "data.lines.data.price.product");

  return stripeRequest(`/invoices?${params.toString()}`, { method: "GET" });
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

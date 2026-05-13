import { config } from "../config.js";

function normaliseOrigin(value = "") {
  try {
    const url = new URL(value);
    return url.origin;
  } catch {
    return "";
  }
}

function isLocalhostOrigin(origin = "") {
  try {
    const { hostname } = new URL(origin);
    return ["localhost", "127.0.0.1", "::1"].includes(hostname);
  } catch {
    return false;
  }
}

export function safeFrontendUrl(value = "") {
  const origin = normaliseOrigin(value);
  if (origin && !(config.isProduction && isLocalhostOrigin(origin))) {
    return origin;
  }

  const configured = normaliseOrigin(config.frontendUrl);
  if (configured && !(config.isProduction && isLocalhostOrigin(configured))) {
    return configured;
  }

  return config.isProduction ? "https://familytrack.care" : "http://localhost:5173";
}

export function frontendUrlFromRequest(req) {
  const origin = normaliseOrigin(req.get("origin") || "");
  if (origin && !(config.isProduction && isLocalhostOrigin(origin))) return origin;

  const forwardedHost = req.get("x-forwarded-host");
  const forwardedProto = req.get("x-forwarded-proto") || "https";
  if (forwardedHost) {
    return safeFrontendUrl(
      `${forwardedProto.split(",")[0]}://${forwardedHost.split(",")[0]}`,
    );
  }

  return safeFrontendUrl();
}

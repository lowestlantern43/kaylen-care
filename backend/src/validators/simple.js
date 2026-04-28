import { badRequest } from "../utils/httpError.js";

export function requireString(body, field, label = field) {
  const value = body?.[field];

  if (typeof value !== "string" || !value.trim()) {
    throw badRequest(`${label} is required.`);
  }

  return value.trim();
}

export function optionalString(body, field) {
  const value = body?.[field];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function requireEmail(body) {
  const email = requireString(body, "email", "Email").toLowerCase();

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw badRequest("Enter a valid email address.");
  }

  return email;
}

export function requirePassword(body, field = "password", label = "Password") {
  const password = requireString(body, field, label);

  if (password.length < 10) {
    throw badRequest(`${label} must be at least 10 characters.`);
  }

  return password;
}

export function requireUuid(value, label = "ID") {
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  ) {
    throw badRequest(`${label} must be a valid ID.`);
  }

  return value;
}

export function requireEnum(body, field, allowedValues, label = field) {
  const value = requireString(body, field, label);

  if (!allowedValues.includes(value)) {
    throw badRequest(`${label} is not valid.`);
  }

  return value;
}

export function optionalDate(body, field) {
  const value = body?.[field];
  if (!value) return null;

  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw badRequest(`${field} must be in YYYY-MM-DD format.`);
  }

  return value;
}

export function optionalTime(body, field) {
  const value = body?.[field];
  if (!value) return null;

  if (typeof value !== "string" || !/^\d{2}:\d{2}$/.test(value)) {
    throw badRequest(`${field} must be in HH:mm format.`);
  }

  return value;
}

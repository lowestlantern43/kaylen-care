import crypto from "node:crypto";
import { config } from "../config.js";
import { badRequest } from "../utils/httpError.js";

const allowedImageTypes = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
]);

function hmac(key, value, encoding) {
  return crypto.createHmac("sha256", key).update(value).digest(encoding);
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function encodePathSegment(value) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function encodeObjectKey(objectKey) {
  return objectKey.split("/").map(encodePathSegment).join("/");
}

function normalizeEndpoint(endpoint) {
  const cleanEndpoint = endpoint.trim().replace(/\/+$/, "");
  return cleanEndpoint.startsWith("http")
    ? cleanEndpoint
    : `https://${cleanEndpoint}`;
}

function normalizePublicUrl(publicUrl) {
  return publicUrl.trim().replace(/\/+$/, "");
}

function getSigningKey(secretKey, dateStamp, region) {
  const dateKey = hmac(`AWS4${secretKey}`, dateStamp);
  const regionKey = hmac(dateKey, region);
  const serviceKey = hmac(regionKey, "s3");
  return hmac(serviceKey, "aws4_request");
}

function buildAmzDates(date = new Date()) {
  const iso = date.toISOString().replace(/[:-]|\.\d{3}/g, "");
  return {
    amzDate: iso,
    dateStamp: iso.slice(0, 8),
  };
}

export function requireSpacesConfig() {
  const missing = [];

  if (!config.spacesKey) missing.push("DO_SPACES_KEY");
  if (!config.spacesSecret) missing.push("DO_SPACES_SECRET");
  if (!config.spacesBucket) missing.push("DO_SPACES_BUCKET");
  if (!config.spacesRegion) missing.push("DO_SPACES_REGION");
  if (!config.spacesEndpoint) missing.push("DO_SPACES_ENDPOINT");
  if (!config.spacesPublicUrl) missing.push("DO_SPACES_PUBLIC_URL");

  if (missing.length) {
    throw badRequest(
      `DigitalOcean Spaces is not configured. Missing: ${missing.join(", ")}.`,
    );
  }
}

export function getProfilePhotoExtension(fileType) {
  const extension = allowedImageTypes.get(fileType);

  if (!extension) {
    throw badRequest("Profile photos must be JPG, PNG, or WebP images.");
  }

  return extension;
}

export function buildProfilePhotoObjectKey({ familyId, childId, fileType }) {
  const extension = getProfilePhotoExtension(fileType);
  return `families/${familyId}/children/${childId}/profile-${Date.now()}.${extension}`;
}

export function buildPublicSpacesUrl(objectKey) {
  return `${normalizePublicUrl(config.spacesPublicUrl)}/${encodeObjectKey(objectKey)}`;
}

export function createSignedPutUrl({ objectKey, fileType, expiresInSeconds = 300 }) {
  requireSpacesConfig();
  getProfilePhotoExtension(fileType);

  const endpoint = normalizeEndpoint(config.spacesEndpoint);
  const uploadUrl = new URL(`/${config.spacesBucket}/${encodeObjectKey(objectKey)}`, endpoint);
  const host = uploadUrl.host;
  const { amzDate, dateStamp } = buildAmzDates();
  const credentialScope = `${dateStamp}/${config.spacesRegion}/s3/aws4_request`;
  const signedHeaders = "content-type;host";

  const queryParams = new URLSearchParams({
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${config.spacesKey}/${credentialScope}`,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": String(expiresInSeconds),
    "X-Amz-SignedHeaders": signedHeaders,
    "X-Amz-Content-Sha256": "UNSIGNED-PAYLOAD",
  });

  const canonicalQueryString = [...queryParams.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(
      ([key, value]) =>
        `${encodeURIComponent(key)}=${encodeURIComponent(value).replace(
          /[!'()*]/g,
          (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
        )}`,
    )
    .join("&");

  const canonicalHeaders = `content-type:${fileType}\nhost:${host}\n`;
  const canonicalRequest = [
    "PUT",
    uploadUrl.pathname,
    canonicalQueryString,
    canonicalHeaders,
    signedHeaders,
    "UNSIGNED-PAYLOAD",
  ].join("\n");

  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    sha256(canonicalRequest),
  ].join("\n");

  const signingKey = getSigningKey(
    config.spacesSecret,
    dateStamp,
    config.spacesRegion,
  );
  const signature = hmac(signingKey, stringToSign, "hex");

  queryParams.set("X-Amz-Signature", signature);
  uploadUrl.search = queryParams.toString();

  return uploadUrl.toString();
}

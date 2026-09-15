import { createSignedGetUrl, getProfilePhotoObjectKeyFromPublicUrl } from "./spaces.js";
import { badRequest } from "../utils/httpError.js";

export function privatePhotoChild(child) {
  const key = getProfilePhotoObjectKeyFromPublicUrl(child.avatarUrl);
  // Never expose arbitrary external images or issue signatures for another child.
  if (!key || !key.includes(`/children/${child.id}/`)) return { ...child, avatarUrl: null };
  return { ...child, avatarUrl: createSignedGetUrl({ objectKey: key, expiresInSeconds: 3600 }) };
}

export function retainedAvatar(incoming, existing, childId) {
  if (!incoming) return null;
  const key = getProfilePhotoObjectKeyFromPublicUrl(existing);
  if (!key || !key.includes(`/children/${childId}/`)) throw badRequest("Please upload the profile photo again.");
  if (incoming === existing) return existing;
  try {
    const supplied = new URL(incoming);
    const expected = new URL(createSignedGetUrl({ objectKey: key }));
    if (supplied.origin === expected.origin && supplied.pathname === expected.pathname) return existing;
  } catch { /* Reject malformed URLs below. */ }
  throw badRequest("Use the photo upload control to change a profile photo.");
}

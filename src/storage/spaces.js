export const spacesConfig = {
  endpoint: import.meta.env.VITE_DO_SPACES_ENDPOINT || "",
  bucket: import.meta.env.VITE_DO_SPACES_BUCKET || "",
  region: import.meta.env.VITE_DO_SPACES_REGION || "",
  publicUrl: import.meta.env.VITE_DO_SPACES_PUBLIC_URL || "",
};

export const isSpacesConfigured = Boolean(
  spacesConfig.endpoint &&
    spacesConfig.bucket &&
    spacesConfig.region &&
    spacesConfig.publicUrl,
);

export function createChildPhotoObjectKey({ familyId, childId, fileName }) {
  const extension = fileName?.split(".").pop()?.toLowerCase() || "jpg";
  return `families/${familyId}/children/${childId}/profile-${Date.now()}.${extension}`;
}

export function getSpacesUploadNotReadyMessage() {
  if (!isSpacesConfigured) {
    return "Child photo storage is not configured yet. Add the DigitalOcean Spaces env vars, then connect a backend signed-upload endpoint.";
  }

  return "DigitalOcean Spaces is configured for public URLs, but browser uploads need a backend signed-upload endpoint so secret keys are never exposed.";
}

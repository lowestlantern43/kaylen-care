const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "/api";

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    ...options,
  });

  const payload = await response.json().catch(() => ({
    data: null,
    error: {
      code: "invalid_response",
      message: "The server returned an unreadable response.",
    },
  }));

  if (!response.ok) {
    const message =
      payload?.error?.message || "Something went wrong. Please try again.";
    throw new Error(message);
  }

  return payload.data;
}

async function uploadToSignedUrl(signedUploadUrl, file) {
  let response;

  try {
    response = await fetch(signedUploadUrl, {
      method: "PUT",
      headers: {
        "Content-Type": file.type,
        "x-amz-acl": "public-read",
      },
      body: file,
    });
  } catch {
    throw new Error(
      "The photo upload could not reach DigitalOcean Spaces. Check the Space CORS settings allow PUT from this app URL.",
    );
  }

  if (!response.ok) {
    const details = await response.text().catch(() => "");
    throw new Error(
      `The photo upload failed (${response.status}). ${details || "Please check the Spaces bucket name, endpoint, CORS, and access key permissions."}`,
    );
  }
}

async function uploadProfilePhoto({ familyId, childId, file }) {
  const params = new URLSearchParams({
    familyId,
    childId,
    fileName: file.name,
  });

  const response = await fetch(`${API_BASE_URL}/uploads/profile-photo?${params}`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": file.type,
      "X-File-Name": file.name,
    },
    body: file,
  });

  const payload = await response.json().catch(() => ({
    data: null,
    error: {
      message: "The server returned an unreadable upload response.",
    },
  }));

  if (!response.ok) {
    throw new Error(
      payload?.error?.message || "The photo upload failed. Please try again.",
    );
  }

  return payload.data;
}

export const api = {
  me: () => request("/auth/me"),
  login: ({ email, password }) =>
    request("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),
  signup: ({ email, password, fullName, familyName, childFirstName }) =>
    request("/auth/signup", {
      method: "POST",
      body: JSON.stringify({
        email,
        password,
        fullName,
        familyName,
        childFirstName,
      }),
    }),
  logout: () =>
    request("/auth/logout", {
      method: "POST",
    }),
  changePassword: ({ currentPassword, newPassword }) =>
    request("/account/password", {
      method: "POST",
      body: JSON.stringify({ currentPassword, newPassword }),
    }),
  listFamilies: () => request("/families"),
  createFamily: ({ name }) =>
    request("/families", {
      method: "POST",
      body: JSON.stringify({ name }),
    }),
  updateFamily: (familyId, payload) =>
    request(`/families/${familyId}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  listChildren: (familyId) => request(`/families/${familyId}/children`),
  createChild: (familyId, { firstName, dateOfBirth }) =>
    request(`/families/${familyId}/children`, {
      method: "POST",
      body: JSON.stringify({ firstName, dateOfBirth }),
    }),
  updateChild: (familyId, childId, payload) =>
    request(`/families/${familyId}/children/${childId}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  signProfilePhotoUpload: ({ familyId, childId, fileName, fileType }) =>
    request("/uploads/profile-photo/sign", {
      method: "POST",
      body: JSON.stringify({ familyId, childId, fileName, fileType }),
    }),
  uploadToSignedUrl,
  uploadProfilePhoto,
  listChildCareOptions: (familyId, childId) =>
    request(`/families/${familyId}/children/${childId}/care-options`),
  createChildCareOption: (familyId, childId, payload) =>
    request(`/families/${familyId}/children/${childId}/care-options`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  deleteChildCareOption: (familyId, childId, optionId) =>
    request(
      `/families/${familyId}/children/${childId}/care-options/${optionId}`,
      {
        method: "DELETE",
      },
    ),
  getChildProfile: (familyId, childId) =>
    request(`/families/${familyId}/children/${childId}/profile`),
  updateChildProfile: (familyId, childId, payload) =>
    request(`/families/${familyId}/children/${childId}/profile`, {
      method: "PUT",
      body: JSON.stringify(payload),
    }),
  listImportantEvents: (familyId, childId) =>
    request(`/families/${familyId}/children/${childId}/important-events`),
  createImportantEvent: (familyId, childId, payload) =>
    request(`/families/${familyId}/children/${childId}/important-events`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  deleteImportantEvent: (familyId, childId, eventId) =>
    request(
      `/families/${familyId}/children/${childId}/important-events/${eventId}`,
      {
        method: "DELETE",
      },
    ),
  listCareLogs: (familyId, query = {}) => {
    const params = new URLSearchParams();
    Object.entries(query).forEach(([key, value]) => {
      if (value) params.set(key, value);
    });
    const suffix = params.toString() ? `?${params.toString()}` : "";
    return request(`/families/${familyId}/care-logs${suffix}`);
  },
  createCareLog: (familyId, payload) =>
    request(`/families/${familyId}/care-logs`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  updateCareLog: (familyId, logId, payload) =>
    request(`/families/${familyId}/care-logs/${logId}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  getIncompleteSleepLog: (familyId, childId) =>
    request(
      `/families/${familyId}/care-logs/sleep/incomplete?childId=${encodeURIComponent(
        childId,
      )}`,
    ),
  listMembers: (familyId) => request(`/families/${familyId}/members`),
  updateMemberRole: (familyId, memberId, role) =>
    request(`/families/${familyId}/members/${memberId}`, {
      method: "PATCH",
      body: JSON.stringify({ role }),
    }),
  removeMember: (familyId, memberId) =>
    request(`/families/${familyId}/members/${memberId}`, {
      method: "DELETE",
    }),
  listInvitations: (familyId) =>
    request(`/families/${familyId}/members/invitations`),
  createInvitation: (familyId, { email, role }) =>
    request(`/families/${familyId}/members/invitations`, {
      method: "POST",
      body: JSON.stringify({ email, role }),
    }),
  getSubscription: (familyId) => request(`/families/${familyId}/subscription`),
  feedbackConfig: () => request("/feedback/config"),
  submitIssue: (payload) =>
    request("/feedback/issues", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  createCheckoutSession: (familyId) =>
    request(`/families/${familyId}/subscription/checkout`, {
      method: "POST",
    }),
  createBillingPortalSession: (familyId) =>
    request(`/families/${familyId}/subscription/portal`, {
      method: "POST",
    }),
  adminOverview: () => request("/admin/overview"),
  adminFamilies: () => request("/admin/families"),
  adminFamilyDetail: (familyId) => request(`/admin/families/${familyId}`),
  adminUpdateFamily: (familyId, payload) =>
    request(`/admin/families/${familyId}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  adminSyncFamilyStripe: (familyId) =>
    request(`/admin/families/${familyId}/sync-stripe`, {
      method: "POST",
    }),
  adminAddFamilyMember: (familyId, payload) =>
    request(`/admin/families/${familyId}/members`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  adminUpdateFamilyMember: (familyId, memberId, payload) =>
    request(`/admin/families/${familyId}/members/${memberId}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  adminRemoveFamilyMember: (familyId, memberId) =>
    request(`/admin/families/${familyId}/members/${memberId}`, {
      method: "DELETE",
    }),
  adminUsers: () => request("/admin/users"),
  adminUserDetail: (userId) => request(`/admin/users/${userId}`),
  adminUpdateUser: (userId, payload) =>
    request(`/admin/users/${userId}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  adminResetUserPassword: (userId, payload) =>
    request(`/admin/users/${userId}/password`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  adminIssues: () => request("/admin/issues"),
  adminUpdateIssueStatus: (issueId, status) =>
    request(`/admin/issues/${issueId}`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    }),
  adminFeedbackSettings: () => request("/admin/feedback-settings"),
  adminUpdateFeedbackSettings: (payload) =>
    request("/admin/feedback-settings", {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
};

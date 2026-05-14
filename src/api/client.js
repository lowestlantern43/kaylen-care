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
      payload?.error?.message ||
      `${response.status} ${response.statusText || "Request failed"} from ${path}`;
    const error = new Error(message);
    error.status = response.status;
    error.code = payload?.error?.code || "request_failed";
    error.details = payload?.error?.details || null;
    error.url = `${API_BASE_URL}${path}`;
    throw error;
  }

  return payload.data;
}

async function requestOptional(path, options = {}) {
  try {
    return await request(path, options);
  } catch (error) {
    if (
      error.message?.includes("No route found") ||
      error.message?.includes('invalid input syntax for type uuid: "archived"')
    ) {
      return null;
    }
    throw error;
  }
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

async function uploadFamilyDocument(familyId, payload, file) {
  const params = new URLSearchParams({
    title: payload.title,
    category: payload.category,
    fileName: file.name,
  });

  if (payload.childId) params.set("childId", payload.childId);
  if (payload.documentDate) params.set("documentDate", payload.documentDate);
  if (payload.notes) params.set("notes", payload.notes);

  const response = await fetch(
    `${API_BASE_URL}/families/${familyId}/documents?${params.toString()}`,
    {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": file.type,
      },
      body: file,
    },
  );

  const responsePayload = await response.json().catch(() => ({
    data: null,
    error: {
      message: "The server returned an unreadable document upload response.",
    },
  }));

  if (!response.ok) {
    throw new Error(
      responsePayload?.error?.message ||
        "The document upload failed. Please try again.",
    );
  }

  return responsePayload.data;
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
  publicPricing: () => requestOptional("/public/pricing"),
  changePassword: ({ currentPassword, newPassword }) =>
    request("/account/password", {
      method: "POST",
      body: JSON.stringify({ currentPassword, newPassword }),
    }),
  getPreference: (key) => request(`/account/preferences/${encodeURIComponent(key)}`),
  updatePreference: (key, value) =>
    request(`/account/preferences/${encodeURIComponent(key)}`, {
      method: "PATCH",
      body: JSON.stringify({ value }),
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
  deleteCareLog: (familyId, logId) =>
    request(`/families/${familyId}/care-logs/${logId}`, {
      method: "DELETE",
    }),
  sendReportEmail: (familyId, payload) =>
    request(`/families/${familyId}/reports/email`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  listDocuments: (familyId, query = {}) => {
    const params = new URLSearchParams();
    Object.entries(query).forEach(([key, value]) => {
      if (value && value !== "All") params.set(key, value);
    });
    const suffix = params.toString() ? `?${params.toString()}` : "";
    return request(`/families/${familyId}/documents${suffix}`);
  },
  uploadFamilyDocument,
  deleteDocument: (familyId, documentId) =>
    request(`/families/${familyId}/documents/${documentId}`, {
      method: "DELETE",
    }),
  documentDownloadUrl: (familyId, documentId) =>
    `${API_BASE_URL}/families/${familyId}/documents/${documentId}/download`,
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
  refreshSubscription: (familyId) =>
    request(`/families/${familyId}/subscription/refresh`, {
      method: "POST",
    }),
  notificationConfig: () => request("/notifications/config"),
  notificationSettings: () => request("/notifications/settings"),
  updateNotificationSettings: (payload) =>
    request("/notifications/settings", {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  savePushSubscription: (payload) =>
    request("/notifications/subscriptions", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  disablePushSubscription: (endpoint) =>
    request("/notifications/subscriptions", {
      method: "DELETE",
      body: JSON.stringify({ endpoint }),
    }),
  sendTestNotification: () =>
    request("/notifications/test", {
      method: "POST",
    }),
  feedbackConfig: () => request("/feedback/config"),
  submitIssue: (payload) =>
    request("/feedback/issues", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  resolvedIssueNotifications: () =>
    request("/feedback/issues/resolved-notifications"),
  markResolvedIssueNotificationsSeen: () =>
    request("/feedback/issues/resolved-notifications/mark-seen", {
      method: "POST",
    }),
  createCheckoutSession: (familyId, payload = {}) =>
    request(`/families/${familyId}/subscription/checkout`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  syncCheckoutSession: (familyId, payload = {}) =>
    request(`/families/${familyId}/subscription/checkout/sync`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  syncBillingCheckoutSession: (payload = {}) =>
    request("/billing/sync-checkout-session", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  verifyStripeSession: (sessionId) =>
    request(`/stripe/verify-session?session_id=${encodeURIComponent(sessionId)}`),
  createDocumentVaultCheckoutSession: (familyId, payload = {}) =>
    request(`/families/${familyId}/subscription/document-vault/checkout`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  createBillingPortalSession: (familyId) =>
    request(`/families/${familyId}/subscription/portal`, {
      method: "POST",
    }),
  adminOverview: () => request("/admin/overview"),
  adminFamilies: () => request("/admin/families"),
  adminArchivedFamilies: async () => {
    const archivedFamilies = await requestOptional("/admin/archived-families");
    if (archivedFamilies) return archivedFamilies;

    const legacyArchivedFamilies = await requestOptional("/admin/families/archived");
    return legacyArchivedFamilies || [];
  },
  adminCreateFamilyAccount: (payload) =>
    request("/admin/family-accounts", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  adminFamilyDetail: (familyId) => request(`/admin/families/${familyId}`),
  adminUpdateFamily: (familyId, payload) =>
    request(`/admin/families/${familyId}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  adminUpdateFamilyProfile: (familyId, payload) =>
    request(`/admin/families/${familyId}/profile`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  adminUpdateFamilyChild: (familyId, childId, payload) =>
    request(`/admin/families/${familyId}/children/${childId}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  adminDeleteFamily: (familyId, payload) =>
    request(`/admin/families/${familyId}`, {
      method: "DELETE",
      body: JSON.stringify(payload),
    }),
  adminPermanentDeleteFamily: (familyId, payload) =>
    request(`/admin/families/${familyId}/permanent`, {
      method: "DELETE",
      body: JSON.stringify(payload),
    }),
  adminSendArchiveWarning: (familyId, payload) =>
    request(`/admin/families/${familyId}/archive-warning`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  adminRestoreFamily: (familyId) =>
    request(`/admin/families/${familyId}/restore`, {
      method: "PATCH",
    }),
  adminSyncFamilyStripe: (familyId) =>
    request(`/admin/families/${familyId}/sync-stripe`, {
      method: "POST",
    }),
  adminUpdateFamilyPlan: (familyId, payload) =>
    request(`/admin/families/${familyId}/plan`, {
      method: "PATCH",
      body: JSON.stringify(payload),
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
  adminCreatePasswordReset: (userId) =>
    request(`/admin/users/${userId}/password-reset`, {
      method: "POST",
    }),
  adminDeleteUser: (userId, payload) =>
    request(`/admin/users/${userId}`, {
      method: "DELETE",
      body: JSON.stringify(payload),
    }),
  adminIssues: () => request("/admin/issues"),
  adminUpdateIssueStatus: (issueId, payload) =>
    request(`/admin/issues/${issueId}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  adminFeedbackSettings: () => request("/admin/feedback-settings"),
  adminUpdateFeedbackSettings: (payload) =>
    request("/admin/feedback-settings", {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  adminUpdateDocumentVaultSettings: (payload) =>
    request("/admin/document-vault-settings", {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  adminUpdatePublicPricing: (payload) =>
    request("/admin/public-pricing", {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  adminUpdateMarketingSettings: (payload) =>
    request("/admin/marketing-settings", {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  adminUpdateFamilyDocumentVault: (familyId, payload) =>
    request(`/admin/families/${familyId}/document-vault`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
};

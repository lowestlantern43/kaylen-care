import { config } from "../config.js";

function plainTextFromLines(lines) {
  return lines.filter(Boolean).join("\n");
}

export async function sendAppEmail({ to, subject, text, html, metadata = {} }) {
  if (!to) return { sent: false, skipped: true };

  if (!config.emailWebhookUrl) {
    console.log(
      `Email skipped because EMAIL_WEBHOOK_URL is not configured: ${subject} -> ${to}`,
    );
    return { sent: false, skipped: true };
  }

  const response = await fetch(config.emailWebhookUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: config.emailFrom,
      replyTo: config.supportEmail,
      to,
      subject,
      text,
      html,
      metadata,
    }),
  });

  if (!response.ok) {
    const details = await response.text().catch(() => "");
    console.error(
      `Email provider failed (${response.status}) for ${subject}: ${details}`,
    );
    return { sent: false, skipped: false };
  }

  return { sent: true, skipped: false };
}

export function welcomeEmail({ fullName }) {
  return {
    subject: "Welcome to FamilyTrack",
    text: plainTextFromLines([
      `Hi ${fullName || "there"},`,
      "",
      "Welcome to FamilyTrack. Your family workspace is ready to help track daily care, routines, reports and Care Snapshot information.",
      "",
      `If you need help, just reply or contact ${config.supportEmail}.`,
      "",
      "FamilyTrack",
    ]),
  };
}

export function passwordResetEmail({ fullName, resetUrl }) {
  return {
    subject: "Reset your FamilyTrack password",
    text: plainTextFromLines([
      `Hi ${fullName || "there"},`,
      "",
      "A password reset link was created for your FamilyTrack account.",
      resetUrl,
      "",
      "If you did not ask for this, please contact us and ignore this email.",
      "",
      `Support: ${config.supportEmail}`,
      "",
      "FamilyTrack",
    ]),
  };
}

export function issueResolvedEmail({ fullName }) {
  return {
    subject: "Your FamilyTrack issue report has been updated",
    text: plainTextFromLines([
      `Hi ${fullName || "there"},`,
      "",
      "One of the issues you reported in FamilyTrack has been marked as resolved.",
      "You will also see a one-time notification in the app when you log in.",
      "",
      `If something still does not look right, contact ${config.supportEmail}.`,
      "",
      "FamilyTrack",
    ]),
  };
}

export function deletionReminderEmail({ fullName, days }) {
  return {
    subject: `FamilyTrack account check-in: ${days} days`,
    text: plainTextFromLines([
      `Hi ${fullName || "there"},`,
      "",
      "We are gently checking in because this FamilyTrack account may become eligible for data cleanup in the future.",
      `There are around ${days} days before any cleanup step would be considered.`,
      "",
      "Nothing has been removed. You can log in, review your account, or contact us if you need help.",
      "",
      `Support: ${config.supportEmail}`,
      "",
      "FamilyTrack",
    ]),
  };
}

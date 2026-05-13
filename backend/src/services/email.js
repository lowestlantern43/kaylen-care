import { config } from "../config.js";

function plainTextFromLines(lines) {
  return lines.filter(Boolean).join("\n");
}

function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildEmailHtml({ subject, text }) {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trimEnd());
  const firstUrl = lines.find((line) => /^https?:\/\//i.test(line.trim()));
  const iconUrl = config.emailLogoUrl;
  const bodyHtml = lines
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return '<div style="height:12px;line-height:12px">&nbsp;</div>';
      if (/^https?:\/\//i.test(trimmed)) {
        return `
          <p style="margin:18px 0">
            <a href="${escapeHtml(trimmed)}" style="display:inline-block;border-radius:14px;background:#2563eb;color:#ffffff;font-weight:700;text-decoration:none;padding:13px 18px">
              Open FamilyTrack
            </a>
          </p>
        `;
      }
      return `<p style="margin:0 0 12px;color:#334155;font-size:15px;line-height:1.65">${escapeHtml(line)}</p>`;
    })
    .join("");

  return `
    <!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width,initial-scale=1">
        <title>${escapeHtml(subject)}</title>
      </head>
      <body style="margin:0;background:#f4f7fb;font-family:Inter,Segoe UI,Arial,sans-serif;color:#0f172a">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f7fb;padding:24px 12px">
          <tr>
            <td align="center">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px;border-radius:26px;background:#ffffff;border:1px solid #dbeafe;box-shadow:0 18px 45px rgba(15,23,42,0.08);overflow:hidden">
                <tr>
                  <td style="background:linear-gradient(135deg,#eff6ff,#ecfeff);padding:26px 28px 20px">
                    <table role="presentation" cellspacing="0" cellpadding="0">
                      <tr>
                        <td style="vertical-align:middle">
                          <img src="${escapeHtml(iconUrl)}" alt="FamilyTrack care icon" width="44" height="44" style="display:block;width:44px;height:44px;border-radius:14px;border:1px solid #bfdbfe;background:#ffffff;outline:none;text-decoration:none">
                        </td>
                        <td style="vertical-align:middle;padding-left:12px">
                          <div style="color:#0369a1;font-weight:900;font-size:14px;letter-spacing:.12em;text-transform:uppercase">
                            FamilyTrack
                          </div>
                          <div style="color:#64748b;font-size:13px;line-height:1.4">Care tracking for families</div>
                        </td>
                      </tr>
                    </table>
                    <h1 style="margin:18px 0 0;font-size:25px;line-height:1.25;color:#0f172a">${escapeHtml(subject)}</h1>
                  </td>
                </tr>
                <tr>
                  <td style="padding:26px 28px 8px">
                    ${bodyHtml}
                  </td>
                </tr>
                <tr>
                  <td style="padding:18px 28px 28px">
                    <div style="border-top:1px solid #e2e8f0;padding-top:18px;color:#64748b;font-size:13px;line-height:1.6">
                      <p style="margin:0">Need help? Contact <a href="mailto:${escapeHtml(config.supportEmail)}" style="color:#2563eb;font-weight:700;text-decoration:none">${escapeHtml(config.supportEmail)}</a>.</p>
                      ${firstUrl ? `<p style="margin:10px 0 0">If the button does not work, copy this link: <br><span style="word-break:break-all">${escapeHtml(firstUrl)}</span></p>` : ""}
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
    </html>
  `;
}

function normalizeRecipients(to) {
  return Array.isArray(to) ? to.filter(Boolean) : [to].filter(Boolean);
}

async function sendViaResend({ to, subject, text, html, attachments = [] }) {
  if (!config.resendApiKey) {
    console.log(
      `Email skipped because RESEND_API_KEY is not configured: ${subject} -> ${to.join(", ")}`,
    );
    return { sent: false, skipped: true };
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.resendApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: config.emailFrom,
      reply_to: config.supportEmail,
      to,
      subject,
      text,
      html,
      attachments,
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

async function sendViaWebhook({ to, subject, text, html, metadata, attachments = [] }) {
  if (!config.emailWebhookUrl) {
    console.log(
      `Email skipped because EMAIL_WEBHOOK_URL is not configured: ${subject} -> ${to.join(", ")}`,
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
      attachments,
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

export async function sendAppEmail({
  to,
  subject,
  text,
  html,
  metadata = {},
  attachments = [],
}) {
  const recipients = normalizeRecipients(to);
  if (!recipients.length) return { sent: false, skipped: true };
  const htmlBody = html || buildEmailHtml({ subject, text });

  if (config.emailProvider === "resend") {
    return sendViaResend({
      to: recipients,
      subject,
      text,
      html: htmlBody,
      attachments,
    });
  }

  return sendViaWebhook({
    to: recipients,
    subject,
    text,
    html: htmlBody,
    metadata,
    attachments,
  });
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

export function trialEndingReminderEmail({
  fullName,
  daysLeft,
  monthlyPriceGbp,
  appUrl,
}) {
  const dayLabel = `${daysLeft} day${daysLeft === 1 ? "" : "s"}`;
  return {
    subject: `FamilyTrack trial: ${dayLabel} left`,
    text: plainTextFromLines([
      `Hi ${fullName || "there"},`,
      "",
      `A gentle reminder that your FamilyTrack free trial has ${dayLabel} remaining.`,
      `FamilyTrack will continue at £${monthlyPriceGbp}/month after the trial unless cancelled.`,
      "",
      "You can manage or cancel your subscription securely through FamilyTrack billing at any time.",
      appUrl || config.frontendUrl,
      "",
      `If you need help, contact ${config.supportEmail}.`,
      "",
      "FamilyTrack",
    ]),
  };
}

export function archivedFamilyDeletionWarningEmail({
  fullName,
  familyName,
  days,
}) {
  return {
    subject: `FamilyTrack archived account reminder: ${days} days`,
    text: plainTextFromLines([
      `Hi ${fullName || "there"},`,
      "",
      `${familyName || "Your FamilyTrack family account"} is currently archived.`,
      `If it remains archived, it may become eligible for permanent deletion in around ${days} days.`,
      "",
      "Nothing has been permanently deleted. If you need the account restored or want to discuss anything, please contact us.",
      "",
      `Support: ${config.supportEmail}`,
      "",
      "FamilyTrack",
    ]),
  };
}

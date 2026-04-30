import { Router } from "express";
import { query } from "../db/pool.js";
import { requireAuth } from "../middleware/auth.js";
import { requireFamilyMember } from "../middleware/familyAccess.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { badRequest, notFound } from "../utils/httpError.js";
import { sendAppEmail } from "../services/email.js";
import {
  optionalString,
  requireEmail,
  requireString,
  requireUuid,
} from "../validators/simple.js";

export const reportsRouter = Router({ mergeParams: true });

reportsRouter.use(requireAuth, requireFamilyMember);

function normalizeBase64Pdf(value) {
  const raw = requireString({ pdfBase64: value }, "pdfBase64", "PDF file");
  const cleaned = raw.includes(",") ? raw.split(",").pop() : raw;

  if (!/^[A-Za-z0-9+/=]+$/.test(cleaned)) {
    throw badRequest("PDF file is not valid.");
  }

  const approxBytes = Math.floor((cleaned.length * 3) / 4);
  if (approxBytes > 8 * 1024 * 1024) {
    throw badRequest("PDF is too large to email.");
  }

  return cleaned;
}

reportsRouter.post(
  "/email",
  asyncHandler(async (req, res) => {
    const familyId = req.familyMember.family_id;
    const recipientEmail = requireEmail({
      email: req.body?.recipientEmail,
    });
    const childId = requireUuid(req.body?.childId, "Child ID");
    const childName = optionalString(req.body, "childName") || "Child";
    const dateRange = optionalString(req.body, "dateRange") || "Selected range";
    const senderMessage = optionalString(req.body, "message");
    const filename =
      optionalString(req.body, "filename") || "familytrack-care-report.pdf";
    const pdfBase64 = normalizeBase64Pdf(req.body?.pdfBase64);

    const child = await query(
      `
        SELECT id, first_name AS "firstName", last_name AS "lastName"
        FROM children
        WHERE id = $1
          AND family_id = $2
          AND deleted_at IS NULL
        LIMIT 1
      `,
      [childId, familyId],
    );

    if (!child.rows[0]) {
      throw notFound("Child not found.");
    }

    const sent = await sendAppEmail({
      to: recipientEmail,
      subject: `FamilyTrack report for ${childName}`,
      text: [
        `${req.user.full_name || req.user.email} has sent you a FamilyTrack care report for ${childName}.`,
        "",
        `Date range: ${dateRange}`,
        senderMessage ? "" : null,
        senderMessage ? `Message: ${senderMessage}` : null,
        "",
        "The PDF report is attached to this email.",
      ]
        .filter(Boolean)
        .join("\n"),
      attachments: [
        {
          filename: filename.replace(/[^\w.\- ]+/g, "").slice(0, 120),
          content: pdfBase64,
        },
      ],
      metadata: {
        type: "care_report_email",
        familyId,
        childId,
        recipientEmail,
      },
    });

    await query(
      `
        INSERT INTO audit_logs (family_id, user_id, action, entity_type, entity_id, metadata)
        VALUES ($1, $2, 'report_emailed', 'child', $3, $4)
      `,
      [
        familyId,
        req.user.id,
        childId,
        JSON.stringify({
          recipientEmail,
          childName,
          dateRange,
          sent: sent.sent,
          skipped: sent.skipped,
        }),
      ],
    );

    if (!sent.sent) {
      throw badRequest("Report email failed. Please try again.");
    }

    res.json({
      data: {
        sent: true,
        recipientEmail,
      },
      error: null,
    });
  }),
);

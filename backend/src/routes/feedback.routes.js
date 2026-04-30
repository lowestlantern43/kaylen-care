import { Router } from "express";
import { query } from "../db/pool.js";
import { requireAuth } from "../middleware/auth.js";
import { config } from "../config.js";
import { sendAppEmail } from "../services/email.js";
import { ensureIssueReportingSchema } from "../services/issueReportingSchema.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { badRequest, forbidden, notFound } from "../utils/httpError.js";
import { optionalString, requireEnum, requireString, requireUuid } from "../validators/simple.js";

export const feedbackRouter = Router();

const severities = ["small", "annoying", "blocking"];

function isMissingFeedbackTable(error) {
  return error?.code === "42P01";
}

async function getFeedbackSettings() {
  let rows = [];

  try {
    await ensureIssueReportingSchema();
    const result = await query(
      `
        SELECT value
        FROM platform_settings
        WHERE key = 'feedback'
        LIMIT 1
      `,
    );
    rows = result.rows;
  } catch (error) {
    if (isMissingFeedbackTable(error)) {
      return {
        enabled: false,
        setupRequired: true,
      };
    }
    throw error;
  }

  return {
    enabled: rows[0]?.value?.enabled !== false,
    setupRequired: false,
  };
}

async function assertFamilyContext(req, familyId, childId) {
  if (!familyId) return;

  const family = await query(
    `
      SELECT
        f.id
      FROM families f
      LEFT JOIN family_members fm
        ON fm.family_id = f.id
        AND fm.user_id = $2
        AND fm.deleted_at IS NULL
      WHERE f.id = $1
        AND f.deleted_at IS NULL
        AND ($3 = true OR fm.id IS NOT NULL)
      LIMIT 1
    `,
    [familyId, req.user.id, Boolean(req.user.is_platform_admin)],
  );

  if (!family.rows[0]) {
    throw notFound("Family not found.");
  }

  if (!childId) return;

  const child = await query(
    `
      SELECT id
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
}

feedbackRouter.use(requireAuth);

feedbackRouter.get(
  "/config",
  asyncHandler(async (req, res) => {
    const settings = await getFeedbackSettings();

    res.json({
      data: {
        enabled: settings.enabled,
        setupRequired: settings.setupRequired,
        isPlatformAdmin: Boolean(req.user.is_platform_admin),
      },
      error: null,
    });
  }),
);

feedbackRouter.post(
  "/issues",
  asyncHandler(async (req, res) => {
    const settings = await getFeedbackSettings();

    if (!settings.enabled && !req.user.is_platform_admin) {
      throw forbidden("Issue reporting is currently disabled.");
    }

    const familyId = req.body?.familyId
      ? requireUuid(req.body.familyId, "Family ID")
      : null;
    const childId = req.body?.childId
      ? requireUuid(req.body.childId, "Child ID")
      : null;
    const message = requireString(req.body, "message", "Issue details");
    const severity = requireEnum(req.body, "severity", severities, "Severity");
    const route = optionalString(req.body, "route") || "";
    const contextSection = optionalString(req.body, "contextSection");
    const deviceType = optionalString(req.body, "deviceType");
    const appVersion = optionalString(req.body, "appVersion");
    const browserInfo =
      req.body?.browserInfo && typeof req.body.browserInfo === "object"
        ? req.body.browserInfo
        : {};
    const screenshotUrl = optionalString(req.body, "screenshotUrl");

    if (childId && !familyId) {
      throw badRequest("Family ID is required when a child is attached.");
    }

    if (screenshotUrl && screenshotUrl.length > 1_200_000) {
      throw badRequest("Screenshot is too large. Please submit without it.");
    }

    await assertFamilyContext(req, familyId, childId);

    let rows = [];

    try {
      await ensureIssueReportingSchema();
      const result = await query(
        `
          INSERT INTO issue_reports (
            user_id,
            family_id,
            child_id,
            route,
            message,
            severity,
            browser_info,
            app_version,
            screenshot_url,
            context_section,
            device_type,
            status
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'new')
          RETURNING
            id,
            route,
            context_section AS "contextSection",
            device_type AS "deviceType",
            message,
            severity,
            status,
            created_at AS "createdAt"
        `,
        [
          req.user.id,
          familyId,
          childId,
          route,
          message,
          severity,
          JSON.stringify(browserInfo),
          appVersion,
          screenshotUrl,
          contextSection,
          deviceType,
        ],
      );
      rows = result.rows;
    } catch (error) {
      if (isMissingFeedbackTable(error)) {
        throw badRequest(
          "Issue reporting tables are not installed yet. Run the database migrations.",
        );
      }
      throw error;
    }

    res.status(201).json({ data: rows[0], error: null });

    sendAppEmail({
      to: config.supportEmail,
      subject: `FamilyTrack issue report: ${severity}`,
      text: [
        "A FamilyTrack issue report was submitted.",
        "",
        `User: ${req.user.email}`,
        `Route: ${route || "Not captured"}`,
        `Device: ${deviceType || browserInfo.deviceType || "Not captured"}`,
        "",
        message,
      ].join("\n"),
      metadata: {
        type: "issue_report",
        issueId: rows[0]?.id,
        userId: req.user.id,
        familyId,
        childId,
      },
    }).catch((error) =>
      console.error("Support issue email failed:", error.message),
    );
  }),
);

feedbackRouter.get(
  "/issues/resolved-notifications",
  asyncHandler(async (req, res) => {
    await ensureIssueReportingSchema();

    const { rows } = await query(
      `
        SELECT
          id,
          message,
          route,
          context_section AS "contextSection",
          updated_at AS "updatedAt"
        FROM issue_reports
        WHERE user_id = $1
          AND resolved = true
          AND notified = false
        ORDER BY updated_at DESC
        LIMIT 20
      `,
      [req.user.id],
    );

    res.json({ data: rows, error: null });
  }),
);

feedbackRouter.post(
  "/issues/resolved-notifications/mark-seen",
  asyncHandler(async (req, res) => {
    await ensureIssueReportingSchema();

    const { rows } = await query(
      `
        UPDATE issue_reports
        SET notified = true,
            updated_at = now()
        WHERE user_id = $1
          AND resolved = true
          AND notified = false
        RETURNING id
      `,
      [req.user.id],
    );

    res.json({
      data: {
        marked: rows.length,
      },
      error: null,
    });
  }),
);

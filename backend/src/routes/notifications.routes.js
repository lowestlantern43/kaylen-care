import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { requirePlatformAdmin } from "../middleware/platformAdmin.js";
import { query } from "../db/pool.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { badRequest } from "../utils/httpError.js";
import {
  disablePushSubscription,
  ensureNotificationSchema,
  getPushConfig,
  savePushSubscription,
  sendPushToUser,
  runDueReminderScan,
} from "../services/pushNotifications.js";

export const notificationsRouter = Router();

notificationsRouter.use(requireAuth);

const DEFAULT_NOTIFICATION_SETTINGS = {
  pushEnabled: false,
  emailEnabled: false,
  types: {
    medication: true,
    appointments: true,
    hydration: false,
    noLogsToday: false,
  },
  childSettings: {},
  timeZone: "Europe/London",
};

function normaliseSettings(value = {}) {
  const types = value.types && typeof value.types === "object" ? value.types : {};
  const childSettings =
    value.childSettings && typeof value.childSettings === "object"
      ? value.childSettings
      : {};

  return {
    pushEnabled: Boolean(value.pushEnabled),
    emailEnabled: Boolean(value.emailEnabled),
    types: {
      ...DEFAULT_NOTIFICATION_SETTINGS.types,
      medication: types.medication !== false,
      appointments: types.appointments !== false,
      hydration: Boolean(types.hydration),
      noLogsToday: Boolean(types.noLogsToday),
    },
    childSettings,
    timeZone:
      typeof value.timeZone === "string" && value.timeZone.trim()
        ? value.timeZone.trim()
        : DEFAULT_NOTIFICATION_SETTINGS.timeZone,
  };
}

async function ensureUserPreferencesSchema() {
  await query(`
    CREATE TABLE IF NOT EXISTS user_preferences (
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      key TEXT NOT NULL,
      value JSONB NOT NULL DEFAULT '{}'::JSONB,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, key)
    )
  `);
}

async function getNotificationSettings(userId) {
  await ensureUserPreferencesSchema();

  const { rows } = await query(
    `
      SELECT value
      FROM user_preferences
      WHERE user_id = $1
        AND key = 'notification-settings'
      LIMIT 1
    `,
    [userId],
  );

  return normaliseSettings(rows[0]?.value || DEFAULT_NOTIFICATION_SETTINGS);
}

async function saveNotificationSettings(userId, settings) {
  await ensureUserPreferencesSchema();

  const cleanSettings = normaliseSettings(settings);
  const { rows } = await query(
    `
      INSERT INTO user_preferences (user_id, key, value, updated_at)
      VALUES ($1, 'notification-settings', $2, now())
      ON CONFLICT (user_id, key)
      DO UPDATE SET value = EXCLUDED.value,
                    updated_at = now()
      RETURNING value
    `,
    [userId, JSON.stringify(cleanSettings)],
  );

  return normaliseSettings(rows[0]?.value || cleanSettings);
}

notificationsRouter.get(
  "/config",
  asyncHandler(async (req, res) => {
    res.json({
      data: {
        ...getPushConfig(),
        schedulerEnabled:
          String(process.env.ENABLE_NOTIFICATION_SCHEDULER || "").toLowerCase() ===
          "true",
      },
      error: null,
    });
  }),
);

notificationsRouter.get(
  "/status",
  asyncHandler(async (req, res) => {
    await ensureNotificationSchema();
    const settings = await getNotificationSettings(req.user.id);
    const { rows } = await query(
      `
        SELECT
          count(*) FILTER (WHERE enabled = true)::int AS "activeSubscriptions",
          max(last_success_at) AS "lastSuccessAt",
          max(last_failure_at) AS "lastFailureAt",
          max(failure_reason) AS "lastFailureReason"
        FROM push_subscriptions
        WHERE user_id = $1
      `,
      [req.user.id],
    );
    const recentEvents = await query(
      `
        SELECT notification_type AS "type",
               delivery_status AS "status",
               delivery_channel AS "channel",
               title,
               created_at AS "createdAt"
        FROM notification_events
        WHERE user_id = $1
        ORDER BY created_at DESC
        LIMIT 5
      `,
      [req.user.id],
    );

    res.json({
      data: {
        config: getPushConfig(),
        schedulerEnabled:
          String(process.env.ENABLE_NOTIFICATION_SCHEDULER || "").toLowerCase() ===
          "true",
        settings,
        push: rows[0] || {
          activeSubscriptions: 0,
          lastSuccessAt: null,
          lastFailureAt: null,
          lastFailureReason: null,
        },
        recentEvents: recentEvents.rows,
      },
      error: null,
    });
  }),
);

notificationsRouter.get(
  "/settings",
  asyncHandler(async (req, res) => {
    const settings = await getNotificationSettings(req.user.id);
    res.json({ data: settings, error: null });
  }),
);

notificationsRouter.patch(
  "/settings",
  asyncHandler(async (req, res) => {
    const settings = await saveNotificationSettings(req.user.id, req.body || {});
    res.json({ data: settings, error: null });
  }),
);

notificationsRouter.post(
  "/subscriptions",
  asyncHandler(async (req, res) => {
    const subscription = req.body?.subscription;
    if (!subscription || typeof subscription !== "object") {
      throw badRequest("Push subscription is required.");
    }

    const saved = await savePushSubscription({
      userId: req.user.id,
      subscription,
      deviceLabel:
        typeof req.body?.deviceLabel === "string" ? req.body.deviceLabel : "",
      userAgent: req.get("user-agent") || "",
    });

    const settings = await getNotificationSettings(req.user.id);
    if (!settings.pushEnabled) {
      await saveNotificationSettings(req.user.id, {
        ...settings,
        pushEnabled: true,
      });
    }

    res.json({ data: saved, error: null });
  }),
);

notificationsRouter.delete(
  "/subscriptions",
  asyncHandler(async (req, res) => {
    const endpoint =
      typeof req.body?.endpoint === "string" ? req.body.endpoint : "";
    if (!endpoint) throw badRequest("Push endpoint is required.");

    await disablePushSubscription({ userId: req.user.id, endpoint });
    res.json({ data: { disabled: true }, error: null });
  }),
);

notificationsRouter.post(
  "/test",
  asyncHandler(async (req, res) => {
    await ensureNotificationSchema();
    const result = await sendPushToUser(req.user.id, {
      title: "FamilyTrack reminders are on",
      body: "You can now receive medication and appointment reminders on this device.",
      url: "/",
      tag: "familytrack-test",
      type: "test",
    });

    if (result.skipped) {
      throw badRequest(result.reason || "Push notifications are not configured.");
    }

    if (!result.sent) {
      throw badRequest(
        "No active push subscription was found for this device. Turn push off and enable notifications again.",
      );
    }

    res.json({ data: result, error: null });
  }),
);

notificationsRouter.post(
  "/run-due",
  requirePlatformAdmin,
  asyncHandler(async (req, res) => {
    const result = await runDueReminderScan();
    res.json({ data: result, error: null });
  }),
);

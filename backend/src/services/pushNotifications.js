import webPush from "web-push";
import { config } from "../config.js";
import { query } from "../db/pool.js";
import { sendAppEmail } from "./email.js";

const hasPushConfig = Boolean(config.vapidPublicKey && config.vapidPrivateKey);

if (hasPushConfig) {
  webPush.setVapidDetails(
    config.vapidSubject,
    config.vapidPublicKey,
    config.vapidPrivateKey,
  );
}

export function getPushConfig() {
  return {
    enabled: hasPushConfig,
    publicKey: config.vapidPublicKey || "",
    setupRequired: !hasPushConfig,
  };
}

export async function ensureNotificationSchema() {
  await query(`
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      endpoint TEXT NOT NULL,
      subscription JSONB NOT NULL,
      device_label TEXT,
      user_agent TEXT,
      enabled BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_success_at TIMESTAMPTZ,
      last_failure_at TIMESTAMPTZ,
      failure_reason TEXT,
      UNIQUE (user_id, endpoint)
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS notification_events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID REFERENCES users(id) ON DELETE SET NULL,
      family_id UUID REFERENCES families(id) ON DELETE CASCADE,
      child_id UUID REFERENCES children(id) ON DELETE SET NULL,
      notification_type TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      deep_link TEXT,
      scheduled_for TIMESTAMPTZ,
      sent_at TIMESTAMPTZ,
      delivery_status TEXT NOT NULL DEFAULT 'pending',
      delivery_channel TEXT NOT NULL DEFAULT 'push',
      metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

export async function savePushSubscription({
  userId,
  subscription,
  deviceLabel = "",
  userAgent = "",
}) {
  await ensureNotificationSchema();

  const endpoint = subscription?.endpoint;
  if (!endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
    throw new Error("Push subscription is incomplete.");
  }

  const { rows } = await query(
    `
      INSERT INTO push_subscriptions (
        user_id,
        endpoint,
        subscription,
        device_label,
        user_agent,
        enabled,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, true, now())
      ON CONFLICT (user_id, endpoint)
      DO UPDATE SET subscription = EXCLUDED.subscription,
                    device_label = EXCLUDED.device_label,
                    user_agent = EXCLUDED.user_agent,
                    enabled = true,
                    updated_at = now(),
                    failure_reason = null
      RETURNING id, endpoint, device_label, enabled, updated_at
    `,
    [
      userId,
      endpoint,
      JSON.stringify(subscription),
      deviceLabel || null,
      userAgent || null,
    ],
  );

  return rows[0];
}

export async function disablePushSubscription({ userId, endpoint }) {
  await ensureNotificationSchema();

  await query(
    `
      UPDATE push_subscriptions
      SET enabled = false,
          updated_at = now()
      WHERE user_id = $1
        AND endpoint = $2
    `,
    [userId, endpoint],
  );
}

export async function sendPushToUser(userId, payload) {
  await ensureNotificationSchema();

  if (!hasPushConfig) {
    return { sent: 0, failed: 0, skipped: true, reason: "Push is not configured." };
  }

  const { rows } = await query(
    `
      SELECT id, endpoint, subscription
      FROM push_subscriptions
      WHERE user_id = $1
        AND enabled = true
      ORDER BY updated_at DESC
    `,
    [userId],
  );

  let sent = 0;
  let failed = 0;

  await Promise.all(
    rows.map(async (row) => {
      try {
        await webPush.sendNotification(row.subscription, JSON.stringify(payload));
        sent += 1;
        await query(
          `
            UPDATE push_subscriptions
            SET last_success_at = now(),
                failure_reason = null
            WHERE id = $1
          `,
          [row.id],
        );
      } catch (error) {
        failed += 1;
        const shouldDisable = [404, 410].includes(Number(error.statusCode));
        await query(
          `
            UPDATE push_subscriptions
            SET last_failure_at = now(),
                failure_reason = $2,
                enabled = CASE WHEN $3 THEN false ELSE enabled END
            WHERE id = $1
          `,
          [row.id, error.message || "Push delivery failed.", shouldDisable],
        );
      }
    }),
  );

  return { sent, failed, skipped: false };
}

const cleanText = (value) => {
  const text = String(value ?? "").trim();
  return ["null", "undefined"].includes(text.toLowerCase()) ? "" : text;
};

const medicationWeekDays = [
  ["sun", 0],
  ["mon", 1],
  ["tue", 2],
  ["wed", 3],
  ["thu", 4],
  ["fri", 5],
  ["sat", 6],
];
const medicationWeekDayKeys = medicationWeekDays.map(([key]) => key);

const normaliseMedicationScheduleDays = (value, { requiredDaily = false } = {}) => {
  const rawText = Array.isArray(value)
    ? value.join(",")
    : String(value || "").trim().toLowerCase();
  if (rawText === "prn" || rawText === "as_needed") return ["prn"];
  if (!rawText || rawText === "every_day" || rawText === "daily") {
    return requiredDaily ? ["every_day"] : [];
  }

  const days = Array.from(
    new Set(
      rawText
        .split(",")
        .map((item) => cleanText(item).toLowerCase())
        .filter((item) => medicationWeekDayKeys.includes(item)),
    ),
  );

  return days.length ? days : requiredDaily ? ["every_day"] : [];
};

const isMedicineScheduledForDate = (medicine, date) => {
  if (!medicine?.requiredDaily) return false;
  const days = normaliseMedicationScheduleDays(medicine.scheduleDays, {
    requiredDaily: medicine.requiredDaily,
  });
  if (days.includes("prn")) return false;
  if (!days.length || days.includes("every_day")) return true;
  const dayKey = medicationWeekDays.find(([, dayNumber]) => dayNumber === date.getDay())?.[0];
  return dayKey ? days.includes(dayKey) : false;
};

const parseMedicationProfile = (value = "") =>
  String(value || "")
    .split(/\n|;/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [
        name = "",
        doseAmount = "",
        doseUnit = "",
        times = "",
        active = "active",
        notes = "",
        requiredDaily = "",
        timeWindow = "",
        scheduleDays = "",
      ] = line.split("|").map(cleanText);
      const isRequiredDaily = requiredDaily === "required";

      return {
        name,
        dose: [doseAmount, doseUnit].filter(Boolean).join(" "),
        times: times
          .split(",")
          .map((time) => time.trim())
          .filter((time) => /^\d{2}:\d{2}$/.test(time)),
        active: active !== "inactive",
        notes,
        requiredDaily: isRequiredDaily,
        timeWindow,
        scheduleDays: normaliseMedicationScheduleDays(scheduleDays, {
          requiredDaily: isRequiredDaily,
        }),
      };
    })
    .filter((medicine) => medicine.name && medicine.active && medicine.requiredDaily);

const londonParts = (date = new Date()) => {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(date).map((part) => [part.type, part.value]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
  };
};

const minutesFromTime = (time = "00:00") => {
  const [hours, minutes] = String(time).split(":").map(Number);
  return hours * 60 + minutes;
};

async function familyReminderUsers(familyId, type) {
  const { rows } = await query(
    `
      SELECT DISTINCT
        u.id,
        u.email,
        u.full_name,
        COALESCE(up.value, '{}'::jsonb) AS settings
      FROM family_members fm
      JOIN users u ON u.id = fm.user_id
      LEFT JOIN user_preferences up
        ON up.user_id = u.id
       AND up.key = 'notification-settings'
      WHERE fm.family_id = $1
        AND fm.deleted_at IS NULL
        AND u.deleted_at IS NULL
    `,
    [familyId],
  );

  return rows.filter((row) => {
    const settings = row.settings || {};
    return (
      (settings.pushEnabled === true || settings.emailEnabled === true) &&
      settings.types?.[type] !== false
    );
  });
}

async function sendReminderOnce({
  user,
  familyId,
  childId,
  type,
  reminderKey,
  title,
  body,
  url = "/",
}) {
  const userId = typeof user === "string" ? user : user.id;
  const settings = typeof user === "object" ? user.settings || {} : {};
  const { rows } = await query(
    `
      SELECT id
      FROM notification_events
      WHERE user_id = $1
        AND notification_type = $2
        AND metadata->>'reminderKey' = $3
        AND created_at > now() - interval '30 hours'
      LIMIT 1
    `,
    [userId, type, reminderKey],
  );

  if (rows[0]) return { skippedDuplicate: true };

  const delivery = await sendPushToUser(userId, {
    title,
    body,
    url,
    tag: reminderKey,
    type,
  });

  let emailDelivery = null;
  if (!delivery.sent && settings.emailEnabled === true && user?.email) {
    emailDelivery = await sendAppEmail({
      to: user.email,
      subject: title,
      text: `${body}\n\nOpen FamilyTrack: ${config.frontendUrl}${url}`,
      metadata: { notificationType: type, reminderKey },
    });
  }

  await query(
    `
      INSERT INTO notification_events (
        user_id,
        family_id,
        child_id,
        notification_type,
        title,
        body,
        deep_link,
        sent_at,
        delivery_status,
        metadata
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, now(), $8, $9)
    `,
    [
      userId,
      familyId,
      childId,
      type,
      title,
      body,
      url,
      delivery.sent > 0 || emailDelivery?.sent ? "sent" : "failed",
      JSON.stringify({ reminderKey, delivery, emailDelivery }),
    ],
  );

  return delivery;
}

export async function runDueReminderScan(now = new Date()) {
  await ensureNotificationSchema();

  const current = londonParts(now);
  const currentMinutes = minutesFromTime(current.time);
  const currentDate = new Date(`${current.date}T12:00:00`);
  const results = { medication: 0, appointments: 0, duplicates: 0 };

  const { rows: medicationRows } = await query(
    `
      SELECT cp.family_id, cp.child_id, c.first_name, cp.current_medications
      FROM child_profiles cp
      JOIN children c ON c.id = cp.child_id
      WHERE c.deleted_at IS NULL
        AND cp.current_medications IS NOT NULL
        AND trim(cp.current_medications) <> ''
    `,
  );

  for (const row of medicationRows) {
    const medicines = parseMedicationProfile(row.current_medications);
    for (const medicine of medicines) {
      if (!isMedicineScheduledForDate(medicine, currentDate)) continue;
      for (const time of medicine.times) {
        const dueMinutes = minutesFromTime(time);
        if (Math.abs(currentMinutes - dueMinutes) > 5) continue;

        const users = await familyReminderUsers(row.family_id, "medication");
        for (const user of users) {
          const result = await sendReminderOnce({
            user,
            familyId: row.family_id,
            childId: row.child_id,
            type: "medication",
            reminderKey: `medication:${row.child_id}:${current.date}:${medicine.name}:${time}`,
            title: "Medication reminder",
            body: `${row.first_name}: ${medicine.name}${medicine.dose ? ` (${medicine.dose})` : ""} is due.`,
            url: "/",
          });
          if (result.skippedDuplicate) results.duplicates += 1;
          else results.medication += result.sent || 0;
        }
      }
    }
  }

  const { rows: appointmentRows } = await query(
    `
      SELECT
        cl.id,
        cl.family_id,
        cl.child_id,
        c.first_name,
        cl.log_date,
        cl.log_time,
        cl.data
      FROM care_logs cl
      JOIN children c ON c.id = cl.child_id
      WHERE cl.category = 'appointment'
        AND cl.deleted_at IS NULL
        AND cl.log_date BETWEEN CURRENT_DATE AND CURRENT_DATE + interval '1 day'
        AND cl.log_time IS NOT NULL
    `,
  );

  for (const row of appointmentRows) {
    const appointmentDate = String(row.log_date).slice(0, 10);
    if (appointmentDate !== current.date) continue;
    const minutesUntil = minutesFromTime(String(row.log_time).slice(0, 5)) - currentMinutes;
    if (minutesUntil < 0 || minutesUntil > 60) continue;

    const users = await familyReminderUsers(row.family_id, "appointments");
    for (const user of users) {
      const result = await sendReminderOnce({
        user,
        familyId: row.family_id,
        childId: row.child_id,
        type: "appointments",
        reminderKey: `appointment:${row.id}:${current.date}`,
        title: "Appointment reminder",
        body: `${row.first_name}: ${row.data?.title || row.data?.category || "Appointment"} at ${String(row.log_time).slice(0, 5)}.`,
        url: "/",
      });
      if (result.skippedDuplicate) results.duplicates += 1;
      else results.appointments += result.sent || 0;
    }
  }

  return results;
}

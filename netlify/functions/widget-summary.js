const https = require("https");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, x-widget-token",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Content-Type": "application/json",
};

function response(statusCode, body) {
  return {
    statusCode,
    headers: corsHeaders,
    body: JSON.stringify(body),
  };
}

function parseNotesValue(notes, label) {
  if (!notes) return "";
  const prefix = `${label}:`;
  const parts = String(notes).split("|").map((part) => part.trim());
  const match = parts.find((part) => part.startsWith(prefix));
  return match ? match.slice(prefix.length).trim() : "";
}

function formatDateTime(dateText, timeText) {
  const bits = [dateText, timeText].filter(Boolean);
  return bits.length ? bits.join(" | ") : "No recent entry";
}

function parseDurationToMinutes(durationText) {
  const text = String(durationText || "").toLowerCase();
  const hourMatch = text.match(/(\d+(?:\.\d+)?)\s*h/);
  const minuteMatch = text.match(/(\d+(?:\.\d+)?)\s*m/);
  const plainMinuteMatch = text.match(/(\d+(?:\.\d+)?)\s*min/);

  const hours = hourMatch ? Number(hourMatch[1]) : 0;
  const minutes = minuteMatch
    ? Number(minuteMatch[1])
    : plainMinuteMatch
      ? Number(plainMinuteMatch[1])
      : 0;

  const total = Math.round(hours * 60 + minutes);
  return total > 0 ? total : null;
}

function formatMinutes(totalMinutes) {
  if (totalMinutes === null) return "";
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours && minutes) return `${hours}h ${minutes}m`;
  if (hours) return `${hours}h`;
  return `${minutes}m`;
}

function buildSleepSummary(row) {
  const dateText = parseNotesValue(row.notes ?? "", "Date");
  const wakeDateText = parseNotesValue(row.notes ?? "", "Wake Date") || dateText;
  const bedtime = row.bedtime ?? "";
  const wakeTime = row.wake_time ?? "";

  if (!wakeTime) {
    return {
      value: bedtime ? `Started ${bedtime}` : "Sleep started",
      time: formatDateTime(dateText, bedtime ? `bed ${bedtime}` : ""),
    };
  }

  let duration = "";
  if (dateText && wakeDateText && bedtime) {
    const [startDay, startMonth, startYear] = dateText.split("/");
    const [endDay, endMonth, endYear] = wakeDateText.split("/");
    const start = new Date(`${startYear}-${startMonth}-${startDay}T${bedtime}:00`);
    const end = new Date(`${endYear}-${endMonth}-${endDay}T${wakeTime}:00`);

    if (!Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime())) {
      const minutes = Math.round((end.getTime() - start.getTime()) / 60000);
      if (minutes > 0) duration = formatMinutes(minutes);
    }
  }

  return {
    value: `${bedtime} to ${wakeTime}${duration ? ` (${duration})` : ""}`,
    time: formatDateTime(dateText, `wake ${wakeTime}`),
  };
}

function requestJson(url, headers) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, { method: "GET", headers }, (res) => {
      let body = "";
      res.on("data", (chunk) => {
        body += chunk;
      });
      res.on("end", () => {
        const status = res.statusCode || 0;
        if (status < 200 || status >= 300) {
          reject(new Error(`Supabase request failed: ${status} ${body}`));
          return;
        }

        try {
          resolve(JSON.parse(body));
        } catch (error) {
          reject(new Error(`Invalid JSON from Supabase: ${body}`));
        }
      });
    });

    req.on("error", (error) => {
      reject(new Error(`HTTPS request failed: ${error.message}`));
    });

    req.end();
  });
}

async function fetchLatest(path, url, serviceRoleKey) {
  const cleanUrl = String(url || "").trim().replace(/\/+$/, "");
  const cleanKey = String(serviceRoleKey || "").trim();
  const data = await requestJson(`${cleanUrl}/rest/v1/${path}`, {
    Authorization: `Bearer ${cleanKey}`,
    apikey: cleanKey,
    Accept: "application/json",
  });
  return Array.isArray(data) ? data[0] ?? null : null;
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: corsHeaders, body: "ok" };
  }

  if (event.httpMethod !== "GET") {
    return response(405, { error: "Method not allowed" });
  }

  const supabaseUrl = String(process.env.SUPABASE_URL || "").trim();
  const supabaseServiceRoleKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  const widgetToken = String(process.env.WIDGET_TOKEN || "").trim();

  if (!supabaseUrl || !supabaseServiceRoleKey || !widgetToken) {
    return response(500, {
      error: "Missing server environment variables",
      debug: {
        hasSupabaseUrl: !!supabaseUrl,
        hasServiceRoleKey: !!supabaseServiceRoleKey,
        hasWidgetToken: !!widgetToken,
      },
    });
  }

  const requestToken = String(
    event.headers["x-widget-token"] || event.headers["X-Widget-Token"] || "",
  ).trim();

  if (requestToken !== widgetToken) {
    return response(401, { error: "Unauthorized" });
  }

  try {
    const [medication, milk, food, sleep, seizure] = await Promise.all([
      fetchLatest("medication_logs?select=*&order=time.desc&limit=1", supabaseUrl, supabaseServiceRoleKey),
      fetchLatest("milk_logs?select=*&order=time.desc&limit=1", supabaseUrl, supabaseServiceRoleKey),
      fetchLatest("food_logs?select=*&order=time.desc&limit=1", supabaseUrl, supabaseServiceRoleKey),
      fetchLatest("sleep_logs?select=*&order=time.desc&limit=1", supabaseUrl, supabaseServiceRoleKey),
      fetchLatest("health_logs?select=*&event=eq.Seizure&order=time.desc&limit=1", supabaseUrl, supabaseServiceRoleKey),
    ]);

    const milkTime = milk?.time ? new Date(milk.time).getTime() : 0;
    const foodTime = food?.time ? new Date(food.time).getTime() : 0;
    const latestFeed = milkTime >= foodTime ? milk : food;
    const latestFeedType = milkTime >= foodTime ? "milk" : "food";

    const feedValue = latestFeed
      ? latestFeedType === "milk"
        ? `${parseNotesValue(latestFeed.notes ?? "", "Item") || "Milk"} ${latestFeed.amount || 0}oz`
        : `${latestFeed.item || "Food"} ${latestFeed.amount || ""}`.trim()
      : "Nothing logged";

    const feedTime = latestFeed
      ? formatDateTime(
          parseNotesValue(latestFeed.notes ?? "", "Date"),
          parseNotesValue(latestFeed.notes ?? "", "Time"),
        )
      : "No recent entry";

    const seizureDuration = seizure?.duration
      ? formatMinutes(parseDurationToMinutes(seizure.duration)) || seizure.duration
      : "Nothing logged";

    return response(200, {
      medication: medication
        ? {
            value: `${medication.medicine || "Medication"} ${medication.dose || ""}`.trim(),
            time: formatDateTime(
              parseNotesValue(medication.notes ?? "", "Date"),
              parseNotesValue(medication.notes ?? "", "Time"),
            ),
          }
        : { value: "Nothing logged", time: "No recent entry" },
      feed: {
        value: feedValue,
        time: feedTime,
      },
      sleep: sleep
        ? buildSleepSummary(sleep)
        : { value: "Nothing logged", time: "No recent entry" },
      seizure: seizure
        ? {
            value: seizureDuration,
            time: formatDateTime(
              parseNotesValue(seizure.notes ?? "", "Date"),
              parseNotesValue(seizure.notes ?? "", "Time"),
            ),
          }
        : { value: "Nothing logged", time: "No recent entry" },
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    return response(500, {
      error: error instanceof Error ? error.message : "Unknown error",
      debug: {
        supabaseHost: supabaseUrl,
        tokenLength: widgetToken.length,
      },
    });
  }
};

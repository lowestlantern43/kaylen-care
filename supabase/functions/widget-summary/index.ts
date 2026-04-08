const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-widget-token",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Content-Type": "application/json",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const WIDGET_TOKEN = Deno.env.get("WIDGET_TOKEN") ?? "";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: corsHeaders,
  });
}

function parseNotesValue(notes: string | null, label: string) {
  if (!notes) return "";
  const prefix = `${label}:`;
  const parts = notes.split("|").map((part) => part.trim());
  const match = parts.find((part) => part.startsWith(prefix));
  return match ? match.slice(prefix.length).trim() : "";
}

function formatDateTime(dateText: string, timeText: string) {
  const bits = [dateText, timeText].filter(Boolean);
  return bits.length ? bits.join(" | ") : "No recent entry";
}

function parseDurationToMinutes(durationText: string) {
  const text = durationText.toLowerCase();
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

function formatMinutes(totalMinutes: number | null) {
  if (totalMinutes === null) return "";
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours && minutes) return `${hours}h ${minutes}m`;
  if (hours) return `${hours}h`;
  return `${minutes}m`;
}

function buildSleepSummary(row: Record<string, string | null>) {
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

async function fetchLatest(path: string) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Supabase request failed: ${response.status} ${text}`);
  }

  const data = await response.json();
  return Array.isArray(data) ? data[0] ?? null : null;
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (request.method !== "GET") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return jsonResponse({ error: "Missing Supabase function secrets" }, 500);
  }

  if (!WIDGET_TOKEN) {
    return jsonResponse({ error: "Missing widget token secret" }, 500);
  }

  const token = request.headers.get("x-widget-token");
  if (token !== WIDGET_TOKEN) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  try {
    const [medication, milk, food, sleep, seizure] = await Promise.all([
      fetchLatest("medication_logs?select=*&order=time.desc&limit=1"),
      fetchLatest("milk_logs?select=*&order=time.desc&limit=1"),
      fetchLatest("food_logs?select=*&order=time.desc&limit=1"),
      fetchLatest("sleep_logs?select=*&order=time.desc&limit=1"),
      fetchLatest("health_logs?select=*&event=eq.Seizure&order=time.desc&limit=1"),
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

    return jsonResponse({
      medication: medication
        ? {
            value: `${medication.medicine || "Medication"} ${medication.dose || ""}`.trim(),
            time: formatDateTime(
              parseNotesValue(medication.notes ?? "", "Date"),
              parseNotesValue(medication.notes ?? "", "Time"),
            ),
          }
        : {
            value: "Nothing logged",
            time: "No recent entry",
          },
      feed: {
        value: feedValue,
        time: feedTime,
      },
      sleep: sleep
        ? buildSleepSummary(sleep)
        : {
            value: "Nothing logged",
            time: "No recent entry",
          },
      seizure: seizure
        ? {
            value: seizureDuration,
            time: formatDateTime(
              parseNotesValue(seizure.notes ?? "", "Date"),
              parseNotesValue(seizure.notes ?? "", "Time"),
            ),
          }
        : {
            value: "Nothing logged",
            time: "No recent entry",
          },
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    return jsonResponse(
      { error: error instanceof Error ? error.message : "Unknown error" },
      500,
    );
  }
});


const normalise = (value) => String(value || "").trim().replace(/\s+/g, " ").toLowerCase();
const minutes = (value) => {
  const match = /^(\d{2}):(\d{2})(?::\d{2})?$/.exec(String(value || ""));
  return match && Number(match[1]) < 24 && Number(match[2]) < 60
    ? Number(match[1]) * 60 + Number(match[2]) : null;
};
const windowFor = (minute) => minute >= 360 && minute < 720 ? "morning"
  : minute >= 720 && minute < 1080 ? "afternoon" : "evening";

// A log can resolve only one scheduled dose. Ambiguous old logs leave reminders on.
export function hasResolvedDose(medicine, dueTime, logs) {
  const schedule = [...new Set(medicine.times)].map((time) => ({ time, minute: minutes(time) }))
    .filter((item) => item.minute !== null);
  return logs.some((log) => {
    const data = log.data || {};
    if (normalise(data.medicine) !== normalise(medicine.name)) return false;
    if (!["given", "skipped"].includes(normalise(data.status || "given"))) return false;
    if (data.scheduled_time) return data.scheduled_time === dueTime;
    let candidates = schedule;
    const window = normalise(data.scheduled_window);
    if (["morning", "afternoon", "evening"].includes(window)) {
      candidates = candidates.filter((item) => windowFor(item.minute) === window);
      if (candidates.length === 1) return candidates[0].time === dueTime;
    }
    const loggedMinute = minutes(log.log_time);
    if (loggedMinute === null) return false;
    const nearest = candidates.map((item) => ({ ...item, distance: Math.abs(item.minute - loggedMinute) }))
      .filter((item) => item.distance <= 120).sort((a, b) => a.distance - b.distance);
    if (!nearest.length || (nearest[1] && nearest[0].distance === nearest[1].distance)) return false;
    return nearest[0].time === dueTime;
  });
}

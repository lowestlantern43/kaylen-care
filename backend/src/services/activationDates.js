export function safeTimeZone(value) {
  try { new Intl.DateTimeFormat('en', { timeZone: value }).format(); return value || 'Europe/London'; }
  catch { return 'Europe/London'; }
}
export function localDay(date, zone) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: safeTimeZone(zone), year:'numeric', month:'2-digit', day:'2-digit' }).formatToParts(new Date(date));
  const get = key => parts.find(p => p.type === key).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
export function dayDifference(first, today) {
  return Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${first}T00:00:00Z`)) / 86400000);
}
export function summaryWindow(first, today) {
  const age = dayDifference(first, today);
  if (age < 1) return null;
  const days = age >= 6 ? 7 : age >= 2 ? 3 : 1;
  const end = new Date(Date.parse(`${first}T00:00:00Z`) + days * 86400000).toISOString().slice(0,10);
  return { start:first, end, days };
}
export function morningDue(first, zone, now = new Date()) {
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone:safeTimeZone(zone), hour:'2-digit', hourCycle:'h23' }).format(now));
  return dayDifference(first, localDay(now, zone)) === 1 && hour >= 9 && hour < 12;
}

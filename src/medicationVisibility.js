// Presentation only: does not change dose schedules, reminders or recorded administrations.
export function medicationVisibleNow(medicine, now) {
  const validTimes = (medicine.times || []).filter(time => /^([01]\d|2[0-3]):[0-5]\d$/.test(time));
  const hour = { morning: 6, afternoon: 12, evening: 18 }[String(medicine.timeWindow || '').toLowerCase()];
  const times = validTimes.filter(time => hour === undefined || (Number(time.slice(0,2)) >= hour && Number(time.slice(0,2)) < hour + 6));
  if (times.length) return times.some(time => {
    const due = new Date(now); const [h,m] = time.split(':').map(Number);
    due.setHours(h,m,0,0);
    return now.getTime() >= due.getTime() - 2 * 60 * 60 * 1000;
  });
  return hour === undefined || now.getHours() >= hour;
}

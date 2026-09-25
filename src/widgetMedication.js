const normalise = value => String(value || '').trim().toLowerCase();
const windowFor = hour => hour >= 18 ? 'evening' : hour >= 12 ? 'afternoon' : hour >= 6 ? 'morning' : '';

// Match a recorded administration to only one unambiguous scheduled dose.
// Never use free-text substring matches or let one log complete several doses.
export function pendingWidgetDoses({ medicines, entries, scheduled, entryDate, now }) {
  const doses = [];
  for (let day = 0; day < 2; day++) {
    const date = new Date(now);
    date.setDate(date.getDate() + day);
    for (const med of medicines.filter(m => m.active !== false && !m.scheduleDays?.includes('prn') && scheduled(m, date))) {
      for (const time of new Set(med.times || [])) {
        if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) continue;
        const due = new Date(date);
        const [hour, minute] = time.split(':').map(Number);
        due.setHours(hour, minute, 0, 0);
        doses.push({ name: String(med.name || ''), dose: String(med.dose || ''), due, taken: false });
      }
    }
  }
  const seen = new Set();
  for (const entry of entries) {
    if (entry.section !== 'Medication' || !['given', 'late', 'taken'].includes(normalise(entry.medicationStatus))) continue;
    if (entry.id && seen.has(entry.id)) continue;
    if (entry.id) seen.add(entry.id);
    const date = entryDate(entry);
    if (!date || !Number.isFinite(date.getTime()) || date > now || !entry.medicationName) continue;
    let candidates = doses.filter(d => d.due.toDateString() === date.toDateString() &&
      normalise(d.name) === normalise(entry.medicationName) && normalise(d.dose) === normalise(entry.medicationDose));
    if (entry.medicationWindow) candidates = candidates.filter(d => windowFor(d.due.getHours()) === normalise(entry.medicationWindow));
    const exact = candidates.filter(d => d.due.getHours() === date.getHours() && d.due.getMinutes() === date.getMinutes());
    if (exact.length === 1) candidates = exact;
    if (candidates.length === 1) candidates[0].taken = true;
  }
  return doses.filter(d => !d.taken).sort((a, b) => a.due - b.due).slice(0, 60)
    .map(d => ({ name: d.name.slice(0, 80), dose: d.dose.slice(0, 50), timestamp: d.due.getTime() / 1000 }));
}

import assert from 'node:assert/strict';
import { pendingWidgetDoses } from '../src/widgetMedication.js';
const now = new Date(2026, 8, 25, 13);
const medicine = { name: 'Demo medicine', dose: 'Sample', times: ['08:00', '20:00'] };
const log = (time, extra = {}) => ({ id: time, section: 'Medication', medicationName: medicine.name,
  medicationDose: medicine.dose, medicationStatus: 'given', at: new Date(2026, 8, 25, ...time.split(':').map(Number)), ...extra });
const pending = (entries = [], medicines = [medicine]) => pendingWidgetDoses({ medicines, entries, now,
  scheduled: () => true, entryDate: e => e.at });
assert.equal(pending().length, 4, 'Overdue morning dose must remain');
assert.equal(pending([log('08:00')]).length, 3, 'Taken dose disappears, other doses remain');
assert.equal(pending([log('08:15', { medicationWindow: 'morning', medicationStatus: 'late' })]).length, 3);
for (const status of ['missed', 'refused', 'skipped', 'unknown']) {
  assert.equal(pending([log('08:00', { medicationStatus: status })]).length, 4);
}
assert.equal(pending([log('08:00'), log('08:00')]).length, 3, 'Duplicate cannot complete a second dose');
assert.equal(pending([log('08:15')]).length, 4, 'Ambiguous administration must not hide a dose');
assert.equal(pending([log('08:00', { medicationName: 'Demo' })]).length, 4, 'No substring matching');
assert.equal(pending([log('08:00', { medicationDose: 'Different' })]).length, 4);
assert.equal(pending([log('20:00')]).length, 4, 'Future records do not complete doses');
assert.equal(pending([log('08:00', { at: new Date(2026, 8, 24, 8) })]).length, 4);
assert.equal(pending([], [{ ...medicine, active: false }]).length, 0);
assert.equal(pending([], [{ ...medicine, scheduleDays: ['prn'] }]).length, 0);
assert.equal(pending([], [{ ...medicine, times: ['25:00', '08:00', '08:00'] }]).length, 2);
console.log('PASS: outstanding doses, matching, duplicate logs, status, date and schedule guards');
const morning = { ...medicine, times: [], timeWindow: 'morning' };
assert.equal(pending([], [morning]).length, 2);
assert.equal(pending([], [morning])[0].window, 'morning');
assert.equal(new Date(pending([], [morning])[0].windowEnd * 1000).getHours(), 12);
assert.equal(pending([log('09:15')], [morning]).length, 1);
const twice = { ...morning, timeWindows: ['morning', 'evening'] };
assert.equal(pending([log('09:15')], [twice]).length, 3);
assert.equal(pending([log('09:15', { medicationStatus: 'refused' })], [twice]).length, 4);
assert.equal(pending([], [{ ...medicine, timeWindows: ['morning'] }]).length, 4, 'No duplicate window dose when exact times exist');
assert.equal(pending([], [{ ...morning, timeWindow: 'unknown' }]).length, 0);
assert.equal(pending([], [{ ...morning, timeWindow: 'evening' }])[0].windowEnd,
  new Date(2026, 8, 26, 0).getTime() / 1000, 'Evening ends at next midnight');
console.log('PASS: window-only doses, completion, exact-time precedence and midnight boundary');

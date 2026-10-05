import {test,mock} from 'node:test';
import assert from 'node:assert/strict';
import {localDay,dayDifference,summaryWindow,morningDue,safeTimeZone} from '../src/services/activationDates.js';

test('return days follow local calendar boundaries including DST, not 24-hour timers',()=>{
  assert.equal(localDay('2026-03-29T23:30:00Z','Europe/London'),'2026-03-30');
  assert.equal(dayDifference('2026-03-29','2026-03-30'),1);
  assert.equal(dayDifference('2026-10-25','2026-10-26'),1);
  assert.equal(safeTimeZone('not/a/zone'),'Europe/London');
  assert.equal(morningDue('2026-03-28','Europe/London',new Date('2026-03-29T08:00:00Z')),true);
  assert.equal(morningDue('2026-03-28','Europe/London',new Date('2026-03-29T11:00:00Z')),false);
  assert.equal(morningDue('2026-03-27','Europe/London',new Date('2026-03-29T08:00:00Z')),false);
});
test('summaries become available on next day, day three and day seven',()=>{
  assert.equal(summaryWindow('2026-10-05','2026-10-05'),null);
  assert.deepEqual(summaryWindow('2026-10-05','2026-10-06'),{start:'2026-10-05',end:'2026-10-06',days:1});
  assert.equal(summaryWindow('2026-10-05','2026-10-07').days,3);
  assert.equal(summaryWindow('2026-10-05','2026-10-11').days,7);
});

let claimed=false,sent=0,optedIn=true;
const query=async(sql,params=[])=>{
  if(sql.includes('SELECT a.*,a.first_entry_day'))return {rows:optedIn?[{user_id:'test',family_id:'family',time_zone:'Europe/London',first_day:'2026-10-05'}]:[]};
  if(sql.includes("SET reminder_claimed_at=$2")){
    if(claimed)return {rows:[],rowCount:0};claimed=true;return {rows:[{user_id:'test'}],rowCount:1};
  }
  return {rows:[],rowCount:0};
};
mock.module('../src/db/pool.js',{namedExports:{query}});
mock.module('../src/services/pushNotifications.js',{namedExports:{ensureNotificationSchema:async()=>{},sendPushToUser:async(user,payload)=>{sent++;assert.equal(payload.title,'Your first FamilyTrack day is ready');assert.equal(JSON.stringify(payload).includes('family'),false);return {sent:1};}}});
const {runActivationReminders}=await import('../src/services/activation.js');
test('concurrent scheduler runs claim a single notification and do not repeat it',async()=>{
  await Promise.all([runActivationReminders(new Date('2026-10-06T08:00:00Z')),runActivationReminders(new Date('2026-10-06T08:00:00Z'))]);
  assert.equal(sent,1);
  await runActivationReminders(new Date('2026-10-06T09:00:00Z'));assert.equal(sent,1);
  optedIn=false;claimed=false;await runActivationReminders(new Date('2026-10-06T09:00:00Z'));assert.equal(sent,1);
});

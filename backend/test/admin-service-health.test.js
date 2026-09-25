import test from 'node:test';
import assert from 'node:assert/strict';
import { getAdminServiceHealth } from '../src/services/adminServiceHealth.js';
test('reminder reset filters observations without deleting historical records', async()=>{
  let cutoff;
  const report = await getAdminServiceHealth({now:new Date('2026-09-25T15:00:00Z'),config:{reminderHealthSince:'2026-09-25T14:00:00Z'},query:async(sql,params)=>{
    assert.match(sql,/^SELECT /);
    if(sql.includes('FROM notification_events')) cutoff=params[0];
    return {rows:[{processed:0,failed:0,stalled:0,sent:0,skipped:0}]};
  }});
  assert.equal(cutoff,'2026-09-25T14:00:00.000Z');
  assert.equal(report.checks.find(x=>x.id==='reminders').status,'unknown');
});
test('health observations use only reads, and absent activity is not success', async () => {
  const report = await getAdminServiceHealth({config:{}, query:async sql => {
    assert.match(sql, /^SELECT /);
    assert.doesNotMatch(sql, /\b(INSERT|UPDATE|DELETE|CREATE|ALTER)\b/);
    return {rows:[{processed:0,failed:0,stalled:0,sent:0,skipped:0}]};
  }});
  assert.equal(report.checks.find(x=>x.id==='stripe').status,'unknown');
  assert.equal(report.checks.find(x=>x.id==='email').status,'attention');
  assert.equal(report.checks.find(x=>x.id==='reminders').status,'unknown');
  assert.equal(report.checks.find(x=>x.id==='backups').status,'unknown');
});
test('failed reads are isolated and do not expose internal errors', async () => {
  const report = await getAdminServiceHealth({config:{}, query:async()=>{throw Error('secret connection string');}});
  assert.equal(report.checks.length,8);
  assert.equal(report.checks.find(x=>x.id==='database').status,'unknown');
  assert.doesNotMatch(JSON.stringify(report),/secret connection/);
});
test('delivery failures take precedence over successful records',async()=>{
  const report=await getAdminServiceHealth({config:{emailProvider:'resend',resendApiKey:'test'},query:async()=>({rows:[{processed:5,failed:1,stalled:0,sent:4,skipped:0}]})});
  assert.equal(report.checks.find(x=>x.id==='stripe').status,'attention');
  assert.equal(report.checks.find(x=>x.id==='email').status,'attention');
});

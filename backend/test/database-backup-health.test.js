import test from 'node:test';
import assert from 'node:assert/strict';
import {assessDatabaseBackups,readDatabaseBackupHealth} from '../src/services/databaseBackupHealth.js';
const now = new Date('2026-09-25T14:00:00Z');
test('recent provider backups are distinguished from restore verification',()=>{
  const result = assessDatabaseBackups({backups:[{created_at:'2026-09-25T02:00:00Z'},{created_at:'2026-09-24T02:00:00Z'}]},now);
  assert.equal(result.status,'working');
  assert.equal(result.lastSuccessAt,'2026-09-25T02:00:00.000Z');
  assert.match(result.detail,/not a tested restore/);
});
test('missing, stale and invalid evidence never reports working',()=>{
  assert.equal(assessDatabaseBackups({backups:[]},now).status,'attention');
  assert.equal(assessDatabaseBackups({backups:[{created_at:'2026-09-20'}]},now).status,'attention');
  for (const created_at of ['bad','2027-01-01']) assert.equal(assessDatabaseBackups({backups:[{created_at}]},now).status,'unknown');
  assert.throws(()=>assessDatabaseBackups({},now));
});
test('monitor only reads the fixed cluster and never returns token',async()=>{
  const result = await readDatabaseBackupHealth({now,env:{DO_DATABASE_BACKUP_MONITOR_TOKEN:'private-test-token'},fetchImpl:async(url,options)=>{
    assert.equal(url,'https://api.digitalocean.com/v2/databases/e4c5932d-c82a-44fa-9e9b-547de0ca012e/backups');
    assert.equal(options.method,'GET'); assert.equal(options.redirect,'error');
    return {ok:true,json:async()=>({backups:[{created_at:'2026-09-25T02:00:00Z'}]})};
  }});
  assert.doesNotMatch(JSON.stringify(result),/private-test-token/);
  assert.equal((await readDatabaseBackupHealth({env:{}})).status,'unknown');
  await assert.rejects(readDatabaseBackupHealth({env:{DO_DATABASE_BACKUP_MONITOR_TOKEN:'test'},fetchImpl:async()=>({ok:false})}));
});

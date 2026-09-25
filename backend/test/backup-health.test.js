import test from 'node:test';
import assert from 'node:assert/strict';
import { assessBackupReceipt, readUploadsBackupHealth } from '../src/services/backupHealth.js';
const now = new Date('2026-09-25T12:00:00Z');
const receipt = {scope:'uploaded_files_only',status:'success',restoreVerified:true,recordedAt:now.toISOString(),completedAt:now.toISOString()};
test('only recent restored copies are working',()=>{
  assert.equal(assessBackupReceipt(receipt,now).status,'working');
  assert.equal(assessBackupReceipt({...receipt,completedAt:'2026-09-23T12:00:00Z'},now).status,'attention');
  assert.equal(assessBackupReceipt({...receipt,status:'failed'},now).status,'attention');
  assert.equal(assessBackupReceipt({...receipt,restoreVerified:false},now).status,'unknown');
  assert.equal(assessBackupReceipt({...receipt,scope:'database'},now).status,'unknown');
  assert.equal(assessBackupReceipt({...receipt,recordedAt:'2027-01-01'},now).status,'unknown');
});
test('private receipt request is signed, bounded and does not return secrets',async()=>{
  const result = await readUploadsBackupHealth({now,env:{BACKUP_STATUS_ACCESS_KEY:'test-key',BACKUP_STATUS_SECRET_KEY:'test-secret'},fetchImpl:async(url,options)=>{
    assert.equal(url,'https://familytrack-backups-lon1.lon1.digitaloceanspaces.com/monitoring/uploads-latest.json');
    assert.match(options.headers.authorization,/AWS4-HMAC-SHA256/);
    assert.equal(options.redirect,'error');
    return {ok:true,text:async()=>JSON.stringify({...receipt,secret:'must-not-return'})};
  }});
  assert.equal(result.status,'working');
  assert.doesNotMatch(JSON.stringify(result),/must-not-return|test-secret/);
});

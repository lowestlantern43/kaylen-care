import {test,mock} from 'node:test';
import assert from 'node:assert/strict';
let run=null,sends=0,enabled=true,testClaimed=false;
const end=new Date(),start=new Date(end-86400000);
mock.module('../src/db/pool.js',{namedExports:{query:async(sql,params)=>{
  if(sql.startsWith('SELECT recipient'))return {rows:[{recipient:'owner@example.com'}]};
  if(sql.startsWith('INSERT INTO admin_digest_tests')){if(testClaimed)return {rowCount:0};testClaimed=true;return {rowCount:1};}
  if(sql.includes('SELECT * FROM admin_digest_settings'))return {rows:[{enabled,recipient:'owner@example.com',enabled_at:new Date(end-1000)}]};
  if(sql.startsWith('SELECT 1'))return {rowCount:run?1:0};
  if(sql.startsWith('INSERT INTO admin_digest_runs')){run={period_end:params[0],recipient:params[1],subject:params[2],body:params[3],html:params[4],status:'pending'};return {};}
  if(sql.includes("SET status='sending'")){if(run.status==='sent')return {rowCount:0};return {rowCount:1,rows:[run]};}
  if(sql.includes('SET status=$2')){run.status=params[1];return {};}
  return {rows:[],rowCount:0};
}}});
mock.module('../src/services/adminInsights.js',{namedExports:{ensureInsights:async()=>{},digestWindow:async()=>({start,end}),buildDigest:async()=>({subject:'FamilyTrack Admin Update — test',body:'Aggregate data only',html:'<p>Aggregate data only</p>'})}});
mock.module('../src/config.js',{namedExports:{config:{resendApiKey:'fake-test-key',emailProvider:'resend',emailFrom:'test@example.com'}}});
const {runAdminDigest,deliverDigest,sendAdminDigestTest}=await import('../src/services/adminDigest.js');
test('nightly job respects disabled setting and does not resend accepted periods',async()=>{
  mock.method(globalThis,'fetch',async()=>{sends++;return {ok:true};});
  enabled=false;await runAdminDigest();assert.equal(sends,0);
  enabled=true;await Promise.all([runAdminDigest(),runAdminDigest()]);assert.equal(sends,1);
  await runAdminDigest();assert.equal(sends,1);
  mock.restoreAll();
});
test('test email is separate from nightly run and duplicate clicks are suppressed',async()=>{
  const before=JSON.stringify(run);let request;
  mock.method(globalThis,'fetch',async(url,options)=>{request=options;return {ok:true};});
  assert.equal((await sendAdminDigestTest()).sent,true);
  assert.ok(JSON.parse(request.body).subject.startsWith('TEST — '));
  assert.ok(request.headers['Idempotency-Key'].includes('test-'));
  assert.equal((await sendAdminDigestTest()).sent,false);
  assert.equal(JSON.stringify(run),before);
  mock.restoreAll();
});
test('retries use identical content and provider idempotency key',async()=>{
  const requests=[];const fetcher=async(url,options)=>{requests.push({url,options});return {ok:false};};
  assert.equal(await deliverDigest(run,fetcher),false);await deliverDigest(run,fetcher);
  assert.equal(requests[0].options.body,requests[1].options.body);
  assert.equal(requests[0].options.headers['Idempotency-Key'],requests[1].options.headers['Idempotency-Key']);
  assert.equal(JSON.parse(requests[0].options.body).to[0],'owner@example.com');
  assert.equal(JSON.parse(requests[0].options.body).html,'<p>Aggregate data only</p>');
});
